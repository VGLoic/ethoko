import { beforeAll, describe, expect, test } from "vitest";
import fs from "fs/promises";
import os from "node:os";
import path from "path";
import { loadLocalConfig } from "./local-config";
import { AbsolutePath } from "@/utils/path";

describe('"loadLocalConfig" must parse accordingly to rules', () => {
  let tmpDirPath: string;
  beforeAll(async () => {
    // Create a temporary directory for the tests
    tmpDirPath = path.join(
      os.tmpdir(),
      `ethoko-local-config-test-${Date.now()}`,
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
    // Without projects considerations
    [
      "Typings path and local artifact store path are equal",
      {
        typingsPath: "path/to/typings",
        localArtifactStorePath: "path/to/typings",
      },
      /"typingsPath" and "localArtifactStorePath" cannot be in a parent-child relationship/,
    ],
    [
      "Typings path parent of local artifact store path",
      {
        typingsPath: "path/to/",
        localArtifactStorePath: "path/to/typings",
      },
      /"typingsPath" and "localArtifactStorePath" cannot be in a parent-child relationship/,
    ],
    [
      "Typings path child of local artifact store path",
      {
        typingsPath: "path/to/typings",
        localArtifactStorePath: "path/to/",
      },
      /"typingsPath" and "localArtifactStorePath" cannot be in a parent-child relationship/,
    ],
    [
      "Local artifact store path empty",
      {
        localArtifactStorePath: "",
      },
      /'localArtifactStorePath' cannot be an empty string/,
    ],
    [
      "Typings path empty",
      {
        typingsPath: "",
      },
      /'typingsPath' cannot be an empty string/,
    ],
    // Bad projects configuration
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
    // Storage path is a child of typings path
    [
      "Storage path is a child of typings path",
      {
        typingsPath: "path/to/typings",
        projects: [
          {
            name: "dummy",
            storage: { type: "filesystem", path: "path/to/typings/storage" },
          },
        ],
      },
      /For project "dummy", the "storage.path" cannot be a child or parent of "typingsPath"./,
    ],
    // Storage path is a parent of typings path
    [
      "Storage path is a parent of typings path",
      {
        typingsPath: "path/to/typings",
        projects: [
          {
            name: "dummy",
            storage: { type: "filesystem", path: "path/to/" },
          },
        ],
      },
      /For project "dummy", the "storage.path" cannot be a child or parent of "typingsPath"./,
    ],
    // Storage path is a child of local artifact store path
    [
      "Storage path is a child of local artifact store path",
      {
        localArtifactStorePath: "path/to/artifacts",
        projects: [
          {
            name: "dummy",
            storage: { type: "filesystem", path: "path/to/artifacts/storage" },
          },
        ],
      },
      /For project "dummy", the "storage.path" cannot be a child or parent of "localArtifactStorePath"./,
    ],
    // Storage path is a parent of local artifact store path
    [
      "Storage path is a parent of local artifact store path",
      {
        localArtifactStorePath: "path/to/artifacts",
        projects: [
          {
            name: "dummy",
            storage: { type: "filesystem", path: "path/to/" },
          },
        ],
      },
      /For project "dummy", the "storage.path" cannot be a child or parent of "localArtifactStorePath"./,
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
        await expect(loadLocalConfig(configPath)).rejects.toThrow(
          expectedError,
        );
      });
    },
  );

  const validCases = [
    ["Empty config (should use defaults)", {}],
    // Filesystem storage valid cases
    [
      "Minimal valid config with filesystem storage",
      {
        projects: [{ name: "dummy", storage: { type: "filesystem" } }],
      },
    ],
    [
      "Valid config with filesystem storage and custom paths",
      {
        projects: [
          {
            name: "dummy",
            typingsPath: "path/to/typings",
            localArtifactStorePath: "path/to/artifacts",
            storage: { type: "filesystem", path: "path/to/storage" },
          },
        ],
      },
    ],
    // AWS storage valid cases
    [
      "Minimal valid config with AWS storage",
      {
        projects: [
          {
            name: "dummy",
            storage: {
              type: "aws",
              awsRegion: "us-east-1",
              awsBucketName: "my-bucket",
            },
          },
        ],
      },
    ],
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
      const loadedConfig = await loadLocalConfig(configPath);
      expect(loadedConfig).toBeDefined();
    });
  });

  test("should load default config if config file does not exist", async () => {
    const nonExistentConfigPath = path.join(
      tmpDirPath,
      "non-existent-config.json",
    );
    await expect(loadLocalConfig(nonExistentConfigPath)).resolves.toEqual({
      typingsPath: new AbsolutePath(".ethoko-typings"),
      projects: [],
      debug: false,
      configPath: undefined,
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
      await expect(loadLocalConfig(invalidJsonConfigPath)).rejects.toThrow(
        /Failed to parse local config file at/,
      );
    });
  });
});
