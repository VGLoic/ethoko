import { beforeAll, describe, expect, test } from "vitest";
import fs from "fs/promises";
import os from "node:os";
import path from "path";
import { loadGlobalConfig } from "./global-config";
import { AbsolutePath } from "@/utils/path";

describe('"loadGlobalConfig" must parse accordingly to rules', () => {
  let tmpDirPath: string;
  beforeAll(async () => {
    // Create a temporary directory for the tests
    tmpDirPath = path.join(
      os.tmpdir(),
      `ethoko-global-config-test-${Date.now()}`,
    );
    await fs.mkdir(tmpDirPath, { recursive: true });
    return async () => {
      // Clean up the temporary directory after all tests have run
      await fs.rm(tmpDirPath, { recursive: true, force: true });
    };
  });

  /**
   * Invalid cases are described here as an array of tuples
   * - the first element is the test title,
   * - the second element is the config object to test,
   * - the third element is the expected error message (or a regex to match it). See EthokoConfigSchema for more details on the validation rules.
   */
  const defaultStorageConfig = { type: "filesystem" };
  const invalidCases = [
    [
      "Pulled artifacts path intentionally empty",
      {
        pulledArtifactsPath: "",
      },
      /"pulledArtifactsPath" cannot be an empty string/,
    ],
    [
      "Pulled artifacts path equal to 'config.json'",
      {
        pulledArtifactsPath: "config.json",
      },
      /"pulledArtifactsPath" cannot be equal to "config.json"/,
    ],
    [
      '"projects" field is not an array',
      {
        projects: "stuff",
      },
      /"projects" field must be an array/,
    ],
    // Duplicate project names
    [
      "Duplicate project names",
      {
        projects: [
          { name: "dummy", storage: defaultStorageConfig },
          { name: "dummy", storage: defaultStorageConfig },
        ],
      },
      /Duplicate project name "dummy" found. Each project must have a unique name./,
    ],
    // Storage path is a child of pulled artifacts path
    [
      "Storage path is a child of pulled artifacts path",
      {
        pulledArtifactsPath: "artifacts",
        projects: [
          {
            name: "project1",
            storage: { type: "filesystem", path: "artifacts/project1-storage" },
          },
        ],
      },
      / cannot be a child of project "/,
    ],
    // Storage path is equal to pulled artifacts path
    [
      "Storage path is equal to pulled artifacts path",
      {
        pulledArtifactsPath: "artifacts",
        projects: [
          {
            name: "project1",
            storage: { type: "filesystem", path: "artifacts" },
          },
        ],
      },
      /" cannot be the same as project "/,
    ],
    // Storage path is a parent of pulled artifacts path
    [
      "Storage path is a parent of pulled artifacts path",
      {
        pulledArtifactsPath: "artifacts/project1-storage",
        projects: [
          {
            name: "project1",
            storage: { type: "filesystem", path: "artifacts" },
          },
        ],
      },
      / cannot be a parent of project "/,
    ],
  ] as const;

  describe.for(invalidCases)(
    "%s",
    ([description, configToTest, expectedError]) => {
      let configPath: string;
      beforeAll(async () => {
        // Create a temporary config file with the provided configToTest
        configPath = path.join(tmpDirPath, "ethoko.config.json");
        await fs.writeFile(configPath, JSON.stringify(configToTest));
        return async () => {
          // Clean up the temporary config file after the test
          await fs.rm(configPath, { force: true });
        };
      });

      test(`${description} - should throw an error with invalid config`, async () => {
        await expect(loadGlobalConfig(configPath)).rejects.toThrow(
          expectedError,
        );
      });
    },
  );

  const validCases = [
    ["Empty config (should use defaults)", {}],
    ["Relative path", { pulledArtifactsPath: "relative/path" }],
    ["Absolute path", { pulledArtifactsPath: "/absolute/path" }],
  ] as const;

  describe.for(validCases)("%s", ([description, configToTest]) => {
    let configPath: string;
    beforeAll(async () => {
      // Create a temporary config file with the provided configToTest
      configPath = path.join(tmpDirPath, "ethoko.config.json");
      await fs.writeFile(configPath, JSON.stringify(configToTest));
      return async () => {
        // Clean up the temporary config file after the test
        await fs.rm(configPath, { force: true });
      };
    });

    test(`${description} - should load config without errors`, async () => {
      const loadedConfig = await loadGlobalConfig(configPath);
      expect(loadedConfig).toBeDefined();
    });
  });

  describe("should resolve relative pulledArtifactsPath against global config directory", async () => {
    let configPath: string;
    beforeAll(async () => {
      // Create a temporary config file with a relative pulledArtifactsPath
      configPath = path.join(tmpDirPath, "ethoko.config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({ pulledArtifactsPath: "relative/path" }),
      );
      return async () => {
        // Clean up the temporary config file after the test
        await fs.rm(configPath, { force: true });
      };
    });

    test("should resolve relative path against global config directory", async () => {
      const loadedConfig = await loadGlobalConfig(configPath);
      expect(loadedConfig).toBeDefined();
      const expectedPath = new AbsolutePath(os.homedir(), ".ethoko").join(
        "relative/path",
      ).resolvedPath;
      expect(loadedConfig.pulledArtifactsPath.resolvedPath).toBe(expectedPath);
    });
  });

  describe("should allow for absolute pulledArtifactsPath", async () => {
    let configPath: string;
    beforeAll(async () => {
      // Create a temporary config file with an absolute pulledArtifactsPath
      configPath = path.join(tmpDirPath, "ethoko.config.json");
      await fs.writeFile(
        configPath,
        JSON.stringify({ pulledArtifactsPath: "/absolute/path" }),
      );
      return async () => {
        // Clean up the temporary config file after the test
        await fs.rm(configPath, { force: true });
      };
    });

    test("should use the absolute path as is", async () => {
      const loadedConfig = await loadGlobalConfig(configPath);
      expect(loadedConfig).toBeDefined();
      expect(loadedConfig.pulledArtifactsPath.resolvedPath).toBe(
        "/absolute/path",
      );
    });
  });

  test("should load default config if config file does not exist", async () => {
    const nonExistentConfigPath = path.join(
      tmpDirPath,
      "non-existent-config.json",
    );
    await expect(loadGlobalConfig(nonExistentConfigPath)).resolves.toEqual({
      pulledArtifactsPath: new AbsolutePath(
        os.homedir(),
        ".ethoko",
        "pulled-artifacts",
      ),
      projects: [],
    });
  });

  describe("should throw an error if config file contains invalid JSON", async () => {
    let invalidJsonConfigPath: string;
    beforeAll(async () => {
      const tmpDirPath = path.join(
        os.tmpdir(),
        `ethoko-invalid-config-test-${Date.now()}`,
      );
      await fs.mkdir(tmpDirPath, { recursive: true });
      invalidJsonConfigPath = path.join(tmpDirPath, "invalid-json-config.json");
      // Create a temporary config file with invalid JSON content
      await fs.writeFile(invalidJsonConfigPath, "{ invalid json }");
      return async () => {
        // Clean up the temporary folder
        await fs.rm(tmpDirPath, { recursive: true, force: true });
      };
    });
    test("should throw an error with invalid JSON content", async () => {
      await expect(loadGlobalConfig(invalidJsonConfigPath)).rejects.toThrow(
        /Failed to parse global config file at/,
      );
    });
  });
});
