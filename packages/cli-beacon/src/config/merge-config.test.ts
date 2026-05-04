import { beforeAll, describe, expect, test } from "vitest";
import fs from "fs/promises";
import os from "node:os";
import path from "path";
import { loadConfig } from "./index";
import { AbsolutePath } from "@/utils/path";

describe("loadConfig", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = path.join(os.tmpdir(), `ethoko-merge-config-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    return async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    };
  });

  async function writeConfigs(
    testName: string,
    globalContent: object,
    localContent: object,
  ): Promise<{ globalConfigPath: string; localConfigPath: string }> {
    const testDir = path.join(tmpDir, testName);
    await fs.mkdir(testDir, { recursive: true });
    const globalConfigPath = path.join(testDir, "global.json");
    const localConfigPath = path.join(testDir, "local.json");
    await fs.writeFile(globalConfigPath, JSON.stringify(globalContent));
    await fs.writeFile(localConfigPath, JSON.stringify(localContent));
    return { globalConfigPath, localConfigPath };
  }

  describe("happy path", () => {
    test("empty configs return EthokoCliConfig with defaults", async () => {
      const { globalConfigPath, localConfigPath } = await writeConfigs(
        "happy-empty",
        {},
        {},
      );
      const config = await loadConfig({ globalConfigPath, localConfigPath });
      expect(config).toBeDefined();
      expect(config.projects).toEqual([]);
      expect(config.debug).toBe(false);
    });

    test("realistic config with projects from both configs", async () => {
      const { globalConfigPath, localConfigPath } = await writeConfigs(
        "happy-realistic",
        {
          projects: [
            {
              name: "global-project",
              storage: {
                type: "filesystem",
                path: "/tmp/ethoko-test-global-storage",
              },
            },
          ],
        },
        {
          typingsPath: "/tmp/ethoko-test-typings",
          localArtifactStorePath: "/tmp/ethoko-test-artifacts",
          projects: [
            {
              name: "local-project",
              storage: {
                type: "filesystem",
                path: "/tmp/ethoko-test-local-storage",
              },
            },
          ],
        },
      );
      const config = await loadConfig({ globalConfigPath, localConfigPath });
      const projectNames = config.projects.map((p) => p.name);
      expect(projectNames).toContain("local-project");
      expect(projectNames).toContain("global-project");
    });
  });

  describe("project merging", () => {
    test("local project takes priority when global has same name", async () => {
      const { globalConfigPath, localConfigPath } = await writeConfigs(
        "project-priority",
        {
          projects: [
            {
              name: "shared",
              storage: {
                type: "filesystem",
                path: "/tmp/ethoko-global-storage",
              },
            },
          ],
        },
        {
          typingsPath: "/tmp/ethoko-typings-priority",
          localArtifactStorePath: "/tmp/ethoko-artifacts-priority",
          projects: [
            {
              name: "shared",
              storage: {
                type: "filesystem",
                path: "/tmp/ethoko-local-storage",
              },
            },
          ],
        },
      );
      const config = await loadConfig({ globalConfigPath, localConfigPath });
      expect(config.projects).toHaveLength(1);
      const project = config.projects[0]!;
      expect(project.name).toBe("shared");
      expect(project.storage.type).toBe("filesystem");
      if (project.storage.type === "filesystem") {
        expect(project.storage.path.resolvedPath).toBe(
          "/tmp/ethoko-local-storage",
        );
      }
    });

    test("global projects added when name not present in local", async () => {
      const { globalConfigPath, localConfigPath } = await writeConfigs(
        "project-add-global",
        {
          projects: [
            {
              name: "global-only",
              storage: {
                type: "filesystem",
                path: "/tmp/ethoko-global-only-storage",
              },
            },
          ],
        },
        {
          typingsPath: "/tmp/ethoko-typings-global",
          localArtifactStorePath: "/tmp/ethoko-artifacts-global",
          projects: [
            {
              name: "local-only",
              storage: {
                type: "filesystem",
                path: "/tmp/ethoko-local-only-storage",
              },
            },
          ],
        },
      );
      const config = await loadConfig({ globalConfigPath, localConfigPath });
      expect(config.projects).toHaveLength(2);
      const projectNames = config.projects.map((p) => p.name);
      expect(projectNames).toContain("local-only");
      expect(projectNames).toContain("global-only");
    });

    test("local projects appear before global projects in result", async () => {
      const { globalConfigPath, localConfigPath } = await writeConfigs(
        "project-order",
        {
          projects: [
            {
              name: "g1",
              storage: { type: "filesystem", path: "/tmp/ethoko-g1-storage" },
            },
          ],
        },
        {
          typingsPath: "/tmp/ethoko-typings-order",
          localArtifactStorePath: "/tmp/ethoko-artifacts-order",
          projects: [
            {
              name: "l1",
              storage: { type: "filesystem", path: "/tmp/ethoko-l1-storage" },
            },
          ],
        },
      );
      const config = await loadConfig({ globalConfigPath, localConfigPath });
      expect(config.projects[0]!.name).toBe("l1");
      expect(config.projects[1]!.name).toBe("g1");
    });
  });

  describe("localArtifactStorePath precedence", () => {
    test("local localArtifactStorePath overrides global", async () => {
      const { globalConfigPath, localConfigPath } = await writeConfigs(
        "artifacts-local-override",
        { localArtifactStorePath: "/tmp/ethoko-global-artifacts" },
        {
          typingsPath: "/tmp/ethoko-typings-artifacts",
          localArtifactStorePath: "/tmp/ethoko-local-artifacts",
        },
      );
      const config = await loadConfig({ globalConfigPath, localConfigPath });
      expect(config.localArtifactStorePath.resolvedPath).toBe(
        "/tmp/ethoko-local-artifacts",
      );
    });

    test("falls back to global localArtifactStorePath when local omits it", async () => {
      const { globalConfigPath, localConfigPath } = await writeConfigs(
        "artifacts-global-fallback",
        { localArtifactStorePath: "/tmp/ethoko-global-fallback-artifacts" },
        { typingsPath: "/tmp/ethoko-typings-fallback" },
      );
      const config = await loadConfig({ globalConfigPath, localConfigPath });
      expect(config.localArtifactStorePath.resolvedPath).toBe(
        "/tmp/ethoko-global-fallback-artifacts",
      );
    });
  });

  describe("cross-config validation", () => {
    test("throws when global localArtifactStorePath equals local typingsPath", async () => {
      const { globalConfigPath, localConfigPath } = await writeConfigs(
        "validation-equal-paths",
        { localArtifactStorePath: "/tmp/ethoko-shared-conflict-path" },
        { typingsPath: "/tmp/ethoko-shared-conflict-path" },
      );
      await expect(
        loadConfig({ globalConfigPath, localConfigPath }),
      ).rejects.toThrow(
        /"typingsPath" and "localArtifactStorePath" cannot be in a parent-child relationship/,
      );
    });

    test("throws when global localArtifactStorePath is parent of local typingsPath", async () => {
      const { globalConfigPath, localConfigPath } = await writeConfigs(
        "validation-parent-path",
        { localArtifactStorePath: "/tmp/ethoko-parent-dir" },
        { typingsPath: "/tmp/ethoko-parent-dir/typings-child" },
      );
      await expect(
        loadConfig({ globalConfigPath, localConfigPath }),
      ).rejects.toThrow(
        /"typingsPath" and "localArtifactStorePath" cannot be in a parent-child relationship/,
      );
    });

    test("throws when a global project storage path is child of local typingsPath", async () => {
      const { globalConfigPath, localConfigPath } = await writeConfigs(
        "validation-project-storage-child",
        {
          projects: [
            {
              name: "conflicting-project",
              storage: {
                type: "filesystem",
                path: "/tmp/ethoko-typings-base/project-storage",
              },
            },
          ],
        },
        {
          typingsPath: "/tmp/ethoko-typings-base",
          localArtifactStorePath: "/tmp/ethoko-artifacts-base",
        },
      );
      await expect(
        loadConfig({ globalConfigPath, localConfigPath }),
      ).rejects.toThrow(
        /For project "conflicting-project", the "storage.path" cannot be a child or parent of "typingsPath"/,
      );
    });

    test("throws when a local project storage path is child of global localArtifactStorePath (fallback)", async () => {
      // Local project has no localArtifactStorePath so it passes local validation,
      // but mergeConfigs uses global localArtifactStorePath, which then conflicts.
      const { globalConfigPath, localConfigPath } = await writeConfigs(
        "validation-project-storage-artifacts",
        { localArtifactStorePath: "/tmp/ethoko-artifacts-conflict-base" },
        {
          typingsPath: "/tmp/ethoko-typings-artifacts-conflict",
          projects: [
            {
              name: "artifacts-conflict-project",
              storage: {
                type: "filesystem",
                path: "/tmp/ethoko-artifacts-conflict-base/project-storage",
              },
            },
          ],
        },
      );
      await expect(
        loadConfig({ globalConfigPath, localConfigPath }),
      ).rejects.toThrow(
        /For project "artifacts-conflict-project", the "storage.path" cannot be a child or parent of "localArtifactStorePath"/,
      );
    });
  });

  describe("config path tracking", () => {
    test("globalConfigPath and localConfigPath are set when files exist", async () => {
      const { globalConfigPath, localConfigPath } = await writeConfigs(
        "path-tracking-exists",
        {},
        {},
      );
      const config = await loadConfig({ globalConfigPath, localConfigPath });
      expect(config.globalConfigPath?.resolvedPath).toBe(
        new AbsolutePath(globalConfigPath).resolvedPath,
      );
      expect(config.localConfigPath?.resolvedPath).toBe(
        new AbsolutePath(localConfigPath).resolvedPath,
      );
    });

    test("globalConfigPath and localConfigPath are undefined when files do not exist", async () => {
      const nonExistentGlobal = path.join(tmpDir, "non-existent-global.json");
      const nonExistentLocal = path.join(tmpDir, "non-existent-local.json");
      const config = await loadConfig({
        globalConfigPath: nonExistentGlobal,
        localConfigPath: nonExistentLocal,
      });
      expect(config.globalConfigPath).toBeUndefined();
      expect(config.localConfigPath).toBeUndefined();
    });
  });
});
