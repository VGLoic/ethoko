import { beforeAll, describe, expect, test } from "vitest";
import fs from "fs/promises";
import os from "node:os";
import path from "path";
import { loadConfig } from "./config.js";

describe('"loadConfig" must parse accordingly to rules', () => {
  let tmpDirPath: string;
  beforeAll(async () => {
    // Create a temporary directory for the tests
    tmpDirPath = path.join(os.tmpdir(), `ethoko-config-test-${Date.now()}`);
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
  const defaultStorageConfig = { type: "local" };
  const invalidCases = [
    // Without storage considerations
    ['Missing "project" field', {}, /"project" field must be a string/],
    [
      'Empty "project" field',
      { project: "" },
      /"project" field is required in ethoko.config.json/,
    ],
    [
      'Missing "storage" field',
      { project: "dummy" },
      /"storage" field must be a valid storage configuration object/,
    ],
    [
      "Typings path and pulled artifacts path are equal",
      {
        project: "dummy",
        typingsPath: "path/to/typings",
        pulledArtifactsPath: "path/to/typings",
        storage: defaultStorageConfig,
      },
      /"typingsPath" and "pulledArtifactsPath" cannot be in a parent-child relationship/,
    ],
    [
      "Typings path parent of pulled artifacts path",
      {
        project: "dummy",
        typingsPath: "path/to/",
        pulledArtifactsPath: "path/to/typings",
        storage: defaultStorageConfig,
      },
      /"typingsPath" and "pulledArtifactsPath" cannot be in a parent-child relationship/,
    ],
    [
      "Typings path child of pulled artifacts path",
      {
        project: "dummy",
        typingsPath: "path/to/typings",
        pulledArtifactsPath: "path/to/",
        storage: defaultStorageConfig,
      },
      /"typingsPath" and "pulledArtifactsPath" cannot be in a parent-child relationship/,
    ],
    // Bad storage configuration
    [
      'Storage "type" field is missing',
      {
        project: "dummy",
        storage: {},
      },
      /"storage" field must be a valid storage configuration object/,
    ],
    [
      'Storage "type" field is invalid',
      {
        project: "dummy",
        storage: { type: "invalid" },
      },
      /"storage" field must be a valid storage configuration object/,
    ],
    // Local storage specific cases
    [
      '"path" field is equal to "typingsPath"',
      {
        project: "dummy",
        typingsPath: "path/to/typings",
        storage: { type: "local", path: "path/to/typings" },
      },
      /For "local" storage, the "storage.path" cannot be in a child relationship with "typingsPath" or "pulledArtifactsPath"/,
    ],
    [
      '"path" field is equal to "pulledArtifactsPath"',
      {
        project: "dummy",
        pulledArtifactsPath: "path/to/artifacts",
        storage: { type: "local", path: "path/to/artifacts" },
      },
      /For "local" storage, the "storage.path" cannot be in a child relationship with "typingsPath" or "pulledArtifactsPath"/,
    ],
    [
      '"path" field is a child of "typingsPath"',
      {
        project: "dummy",
        typingsPath: "path/to/typings",
        storage: { type: "local", path: "path/to/typings/subdir" },
      },
      /For "local" storage, the "storage.path" cannot be in a child relationship with "typingsPath" or "pulledArtifactsPath"/,
    ],
    [
      '"path" field is a child of "pulledArtifactsPath"',
      {
        project: "dummy",
        pulledArtifactsPath: "path/to/typings",
        storage: { type: "local", path: "path/to/typings/subdir" },
      },
      /For "local" storage, the "storage.path" cannot be in a child relationship with "typingsPath" or "pulledArtifactsPath"/,
    ],
    // AWS storage specific cases
    [
      'Missing "awsRegion" field for "aws" storage',
      {
        project: "dummy",
        storage: { type: "aws", awsBucketName: "my-bucket" },
      },
      /The "awsRegion" field must be a string when "type" is "aws"/,
    ],
    [
      'Missing "awsBucketName" field for "aws" storage',
      {
        project: "dummy",
        storage: { type: "aws", awsRegion: "us-east-1" },
      },
      /The "awsBucketName" field must be a string when "type" is "aws"/,
    ],
    [
      '"awsAccessKeyId" cannot be provided if "awsProfile" filled',
      {
        project: "dummy",
        storage: {
          type: "aws",
          awsRegion: "us-east-1",
          awsBucketName: "my-bucket",
          awsProfile: "profile",
          awsAccessKeyId: "access-key-id",
        },
      },
      /When "awsProfile" is provided, credential fields \("awsAccessKeyId", "awsSecretAccessKey"\) and role configuration fields \("awsRoleArn", "awsRoleExternalId", "awsRoleSessionName", "awsRoleDurationSeconds"\) must be empty/,
    ],
    [
      '"awsAccessKeyId" empty while "awsSecretAccessKey" provided for "aws" storage',
      {
        project: "dummy",
        storage: {
          type: "aws",
          awsRegion: "us-east-1",
          awsBucketName: "my-bucket",
          awsSecretAccessKey: "secret",
        },
      },
      /Both "awsAccessKeyId" and "awsSecretAccessKey" must be provided together when "type" is "aws"/,
    ],
    [
      '"awsSecretAccessKey" empty while "awsAccessKeyId" provided for "aws" storage',
      {
        project: "dummy",
        storage: {
          type: "aws",
          awsRegion: "us-east-1",
          awsBucketName: "my-bucket",
          awsAccessKeyId: "access-key-id",
        },
      },
      /Both "awsAccessKeyId" and "awsSecretAccessKey" must be provided together when "type" is "aws"/,
    ],
    [
      '"awsRoleArn" cannot be provided if missing credentials for "aws" storage',
      {
        project: "dummy",
        storage: {
          type: "aws",
          awsRegion: "us-east-1",
          awsBucketName: "my-bucket",
          awsRoleArn: "arn:aws:iam::123456789012:role/MyRole",
        },
      },
      /When no AWS credentials are provided, role configuration fields \("awsRoleArn", "awsRoleExternalId", "awsRoleSessionName", "awsRoleDurationSeconds"\) must be empty/,
    ],
    [
      '"awsRoleExternalId" cannot be provided if "awsRoleArn" is missing for "aws" storage',
      {
        project: "dummy",
        storage: {
          type: "aws",
          awsRegion: "us-east-1",
          awsBucketName: "my-bucket",
          awsAccessKeyId: "access-key-id",
          awsSecretAccessKey: "secret",
          awsRoleExternalId: "external-id",
        },
      },
      /When "awsRoleArn" is not provided, role configuration fields \("awsRoleExternalId", "awsRoleSessionName", "awsRoleDurationSeconds"\) must be empty/,
    ],
  ] as const;

  describe.for(invalidCases)("%s", ([, configToTest, expectedError]) => {
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

    test("should throw an error with invalid config", async () => {
      await expect(loadConfig(configPath)).rejects.toThrow(expectedError);
    });
  });

  const validCases = [
    // Local storage valid cases
    [
      "Minimal valid config with local storage",
      {
        project: "dummy",
        storage: { type: "local" },
      },
    ],
    [
      "Valid config with local storage and custom paths",
      {
        project: "dummy",
        typingsPath: "path/to/typings",
        pulledArtifactsPath: "path/to/artifacts",
        storage: { type: "local", path: "path/to/storage" },
      },
    ],
    // AWS storage valid cases
    [
      "Minimal valid config with AWS storage and without credentials",
      {
        project: "dummy",
        storage: {
          type: "aws",
          awsRegion: "us-east-1",
          awsBucketName: "my-bucket",
        },
      },
    ],
    [
      "Minimal valid config with AWS and profile-based credentials",
      {
        project: "dummy",
        storage: {
          type: "aws",
          awsRegion: "us-east-1",
          awsBucketName: "my-bucket",
          awsProfile: "profile",
        },
      },
    ],
    [
      "Valid config with AWS storage and static credentials",
      {
        project: "dummy",
        storage: {
          type: "aws",
          awsRegion: "us-east-1",
          awsBucketName: "my-bucket",
          awsAccessKeyId: "access-key-id",
          awsSecretAccessKey: "secret",
        },
      },
    ],
    [
      "Valid config with AWS storage and role configuration",
      {
        project: "dummy",
        storage: {
          type: "aws",
          awsRegion: "us-east-1",
          awsBucketName: "my-bucket",
          awsAccessKeyId: "access-key-id",
          awsSecretAccessKey: "secret",
          awsRoleArn: "arn:aws:iam::123456789012:role/MyRole",
          awsRoleExternalId: "external-id",
          awsRoleSessionName: "session-name",
          awsRoleDurationSeconds: 3600,
        },
      },
    ],
  ] as const;

  describe.for(validCases)("%s", ([, configToTest]) => {
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

    test("should load config without errors", async () => {
      const loadedConfig = await loadConfig(configPath);
      expect(loadedConfig).toBeDefined();
      expect(loadedConfig.project).toBe(configToTest.project);
    });
  });

  test("should throw an error if config file does not exist", async () => {
    const nonExistentConfigPath = path.join(
      tmpDirPath,
      "non-existent-config.json",
    );
    await expect(loadConfig(nonExistentConfigPath)).rejects.toThrow(
      /Failed to read ethoko.config.json at/,
    );
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
      await expect(loadConfig(invalidJsonConfigPath)).rejects.toThrow(
        /Invalid JSON in ethoko.config.json at/,
      );
    });
  });
});
