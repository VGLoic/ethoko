import fs from "fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { pull, push, restore } from "@/cli-client";
import { createTestLocalStorage } from "@test/helpers/local-storage-factory";
import {
  createTestLocalStorageProvider,
  createTestS3StorageProvider,
} from "@test/helpers/storage-provider-factory";
import { TEST_CONSTANTS } from "@test/helpers/test-constants";
import { createTestProjectName } from "@test/helpers/test-utils";
import type { LocalStorage } from "@/local-storage";
import type { StorageProvider } from "@/storage-provider";

describe.each([
  ["Local Storage Provider", createTestLocalStorageProvider],
  ["Amazon S3 Storage Provider", createTestS3StorageProvider],
])("Restore E2E Tests (%s)", (_, createStorageProvider) => {
  let storageProvider: StorageProvider;
  let localStorage: LocalStorage;
  let tempOutputDir: string;

  beforeEach(async () => {
    const providerSetup = await createStorageProvider();
    storageProvider = providerSetup.storageProvider;

    const localStorageSetup = await createTestLocalStorage();
    localStorage = localStorageSetup.localStorage;

    tempOutputDir = await fs.mkdtemp(
      path.join(os.tmpdir(), TEST_CONSTANTS.PATHS.TEMP_DIR_PREFIX),
    );

    return async () => {
      await localStorageSetup.cleanup();
      await providerSetup.cleanup();
      await fs.rm(tempOutputDir, { recursive: true, force: true });
    };
  });

  describe("generic restore functionality", () => {
    test("restore to absolute path", async () => {
      const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);
      const tag = TEST_CONSTANTS.TAGS.V1;
      const artifactFixture =
        TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER;

      await localStorage.ensureProjectSetup(project);

      await push(artifactFixture.folderPath, project, tag, storageProvider, {
        force: false,
        debug: false,
        silent: true,
      });

      await pull(project, { type: "tag", tag }, storageProvider, localStorage, {
        force: false,
        debug: false,
        silent: true,
      });

      const outputPath = path.join(tempOutputDir, "absolute-path-test");
      const result = await restore(
        { project, search: { type: "tag", tag } },
        outputPath,
        storageProvider,
        localStorage,
        { force: false, debug: false, silent: true },
      );

      expect(result.filesRestored.length).toBeGreaterThan(0);
      expect(result.outputPath).toBe(outputPath);

      const stat = await fs.stat(outputPath);
      expect(stat.isDirectory()).toBe(true);
    });

    test("restore to relative path", async () => {
      const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);
      const tag = TEST_CONSTANTS.TAGS.V1;
      const artifactFixture =
        TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER;

      await localStorage.ensureProjectSetup(project);

      await push(artifactFixture.folderPath, project, tag, storageProvider, {
        force: false,
        debug: false,
        silent: true,
      });

      await pull(project, { type: "tag", tag }, storageProvider, localStorage, {
        force: false,
        debug: false,
        silent: true,
      });

      const relativeOutputPath = path.join(
        path.relative(process.cwd(), tempOutputDir),
        "relative-path-test",
      );
      const outputPath = path.resolve(relativeOutputPath);
      const result = await restore(
        { project, search: { type: "tag", tag } },
        relativeOutputPath,
        storageProvider,
        localStorage,
        { force: false, debug: false, silent: true },
      );

      expect(result.filesRestored.length).toBeGreaterThan(0);
      expect(result.outputPath).toBe(outputPath);

      const stat = await fs.stat(outputPath);
      expect(stat.isDirectory()).toBe(true);
    });

    test("error: output directory exists without --force", async () => {
      const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);
      const tag = TEST_CONSTANTS.TAGS.V1;
      const artifactFixture =
        TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER;

      await localStorage.ensureProjectSetup(project);

      await push(artifactFixture.folderPath, project, tag, storageProvider, {
        force: false,
        debug: false,
        silent: true,
      });

      await pull(project, { type: "tag", tag }, storageProvider, localStorage, {
        force: false,
        debug: false,
        silent: true,
      });

      const outputPath = path.join(tempOutputDir, "existing-dir-test");
      await fs.mkdir(outputPath, { recursive: true });
      await fs.writeFile(path.join(outputPath, "dummy.txt"), "content");

      await expect(
        restore(
          { project, search: { type: "tag", tag } },
          outputPath,
          storageProvider,
          localStorage,
          { force: false, debug: false, silent: true },
        ),
      ).rejects.toThrow(/not empty|overwrite/);
    });

    test("success: output directory exists with --force", async () => {
      const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);
      const tag = TEST_CONSTANTS.TAGS.V1;
      const artifactFixture =
        TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER;

      await localStorage.ensureProjectSetup(project);

      await push(artifactFixture.folderPath, project, tag, storageProvider, {
        force: false,
        debug: false,
        silent: true,
      });

      await pull(project, { type: "tag", tag }, storageProvider, localStorage, {
        force: false,
        debug: false,
        silent: true,
      });

      const outputPath = path.join(tempOutputDir, "force-overwrite-test");
      await fs.mkdir(outputPath, { recursive: true });
      await fs.writeFile(path.join(outputPath, "dummy.txt"), "content");

      const result = await restore(
        { project, search: { type: "tag", tag } },
        outputPath,
        storageProvider,
        localStorage,
        { force: true, debug: false, silent: true },
      );

      expect(result.filesRestored.length).toBeGreaterThan(0);
    });

    test("error: artifact not pulled (tag not found locally)", async () => {
      const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);
      const outputPath = path.join(tempOutputDir, "not-pulled-test");

      await localStorage.ensureProjectSetup(project);

      await expect(
        restore(
          { project, search: { type: "tag", tag: "non-pulled-tag" } },
          outputPath,
          storageProvider,
          localStorage,
          { force: false, debug: false, silent: true },
        ),
      ).rejects.toThrow();
    });

    test("error: invalid project", async () => {
      const outputPath = path.join(tempOutputDir, "invalid-project-test");

      await expect(
        restore(
          {
            project: "non-existent-project",
            search: { type: "tag", tag: TEST_CONSTANTS.TAGS.V1 },
          },
          outputPath,
          storageProvider,
          localStorage,
          { force: false, debug: false, silent: true },
        ),
      ).rejects.toThrow();
    });
  });

  describe.each([
    [
      "Hardhat V3",
      TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER,
      [
        TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER.buildInfoPath,
        TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER.buildInfoPath.replace(
          ".json",
          ".output.json",
        ),
        path.resolve(
          TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V3_COUNTER.folderPath,
          "contracts/Counter.sol/Counter.json",
        ),
      ],
    ],
    [
      "Hardhat V2",
      TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V2_COUNTER,
      [TEST_CONSTANTS.ARTIFACTS_FIXTURES.HARDHAT_V2_COUNTER.buildInfoPath],
    ],
    [
      "Forge default",
      TEST_CONSTANTS.ARTIFACTS_FIXTURES.FOUNDRY_COUNTER,
      [
        TEST_CONSTANTS.ARTIFACTS_FIXTURES.FOUNDRY_COUNTER.buildInfoPath,
        path.resolve(
          TEST_CONSTANTS.ARTIFACTS_FIXTURES.FOUNDRY_COUNTER.folderPath,
          "Counter.sol/Counter.json",
        ),
      ],
    ],
    [
      "Forge with build-info",
      TEST_CONSTANTS.ARTIFACTS_FIXTURES.FOUNDRY_BUILD_INFO_COUNTER,
      [
        TEST_CONSTANTS.ARTIFACTS_FIXTURES.FOUNDRY_BUILD_INFO_COUNTER
          .buildInfoPath,
        path.resolve(
          TEST_CONSTANTS.ARTIFACTS_FIXTURES.FOUNDRY_BUILD_INFO_COUNTER
            .folderPath,
          "Counter.sol/Counter.json",
        ),
      ],
    ],
  ])("%s artifacts", (_, artifactFixture, expectedOriginalPaths) => {
    test("restore by tag", async () => {
      const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);
      const tag = TEST_CONSTANTS.TAGS.V1;

      await localStorage.ensureProjectSetup(project);

      await push(artifactFixture.folderPath, project, tag, storageProvider, {
        force: false,
        debug: false,
        silent: true,
      });

      await pull(project, { type: "tag", tag }, storageProvider, localStorage, {
        force: false,
        debug: false,
        silent: true,
      });

      const outputPath = path.join(tempOutputDir, `${tag}-tag-test`);
      const result = await restore(
        { project, search: { type: "tag", tag } },
        outputPath,
        storageProvider,
        localStorage,
        { force: false, debug: false, silent: true },
      );

      expect(result.project).toBe(project);
      expect(result.tag).toBe(tag);
      const expectedPaths = expectedOriginalPaths.map(sanitizePath);

      expect(result.filesRestored.length).toBe(expectedPaths.length);

      for (const expectedPath of expectedPaths) {
        const fullPath = path.join(outputPath, expectedPath);
        const stat = await fs.stat(fullPath);
        expect(stat.isFile()).toBe(true);
      }
    });

    test("restore by ID", async () => {
      const project = createTestProjectName(TEST_CONSTANTS.PROJECTS.DEFAULT);

      await localStorage.ensureProjectSetup(project);

      const artifactId = await push(
        artifactFixture.folderPath,
        project,
        undefined,
        storageProvider,
        {
          force: false,
          debug: false,
          silent: true,
        },
      );

      await pull(
        project,
        { type: "id", id: artifactId },
        storageProvider,
        localStorage,
        {
          force: false,
          debug: false,
          silent: true,
        },
      );

      const outputPath = path.join(tempOutputDir, `${artifactId}-id-test`);
      const result = await restore(
        { project, search: { type: "id", id: artifactId } },
        outputPath,
        storageProvider,
        localStorage,
        { force: false, debug: false, silent: true },
      );

      expect(result.project).toBe(project);
      expect(result.tag).toBe(null);
      expect(result.id).toBe(artifactId);
      const expectedPaths = expectedOriginalPaths.map(sanitizePath);

      expect(result.filesRestored.length).toBe(expectedPaths.length);

      for (const expectedPath of expectedPaths) {
        const fullPath = path.join(outputPath, expectedPath);
        const stat = await fs.stat(fullPath);
        expect(stat.isFile()).toBe(true);
      }
    });
  });
});

function sanitizePath(filePath: string): string {
  if (filePath.startsWith("/")) {
    return filePath.substring(1);
  }
  if (filePath.startsWith("./")) {
    return filePath.substring(2);
  }
  return filePath;
}
