import { describe, test, expect } from "vitest";
import { generateProjectConfigSchema } from "./projects";
import z from "zod";
import { AbsolutePath } from "@/utils/path";

describe("Project configuration validation", () => {
  /**
   * Invalid cases are described here as an array of tuples
   * - the first element is the test title,
   * - the second element is the config object to test,
   * - the third element is the expected error message (or a regex to match it). See EthokoConfigSchema for more details on the validation rules.
   */
  const defaultStorageConfig = { type: "filesystem" };
  const invalidCases = [
    // Without projects considerations
    // Bad project configuration
    [
      '"name" field is missing in project configuration',
      { storage: defaultStorageConfig },
      /"name" field must be a string/,
    ],
    // Bad storage configuration
    [
      'Storage "type" field is missing',
      { name: "dummy", storage: {} },
      /"storage" field must be a valid storage configuration object/,
    ],
    [
      'Storage "type" field is invalid',
      { name: "dummy", storage: { type: "invalid" } },
      /"storage" field must be a valid storage configuration object/,
    ],
    // AWS storage specific cases
    [
      'Missing "awsRegion" field for "aws" storage',
      {
        name: "dummy",
        storage: { type: "aws", awsBucketName: "my-bucket" },
      },
      /The "awsRegion" field must be a string when "type" is "aws"/,
    ],
    [
      'Missing "awsBucketName" field for "aws" storage',
      { name: "dummy", storage: { type: "aws", awsRegion: "us-east-1" } },
      /The "awsBucketName" field must be a string when "type" is "aws"/,
    ],
    [
      '"awsAccessKeyId" cannot be provided if "awsProfile" filled',
      {
        name: "dummy",
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
        name: "dummy",
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
        name: "dummy",
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
        name: "dummy",
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
        name: "dummy",
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

  test.for(invalidCases)(
    "%s - should throw an error with invalid config",
    async ([, configToTest, expectedError]) => {
      expect(() => {
        try {
          generateProjectConfigSchema(() => new AbsolutePath(".")).parse(
            configToTest,
          );
          throw new Error("Expected validation to fail, but it succeeded.");
        } catch (err) {
          throw z.prettifyError(err as z.ZodError);
          throw err;
        }
      }).toThrow(expectedError);
    },
  );

  const validCases = [
    // Filesystem storage valid cases
    [
      "Minimal valid config with filesystem storage",
      { name: "dummy", storage: { type: "filesystem" } },
    ],
    [
      "Valid config with filesystem storage and custom paths",
      {
        name: "dummy",
        typingsPath: "path/to/typings",
        localArtifactStorePath: "path/to/artifacts",
        storage: { type: "filesystem", path: "path/to/storage" },
      },
    ],
    // AWS storage valid cases
    [
      "Minimal valid config with AWS storage and without credentials",
      {
        name: "dummy",
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
        name: "dummy",
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
        name: "dummy",
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
        name: "dummy",
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

  test.for(validCases)(
    "%s - should load config without errors",
    async ([, configToTest]) => {
      const parsedConfig = generateProjectConfigSchema(
        () => new AbsolutePath("."),
      ).parse(configToTest);
      expect(parsedConfig).toBeDefined();
    },
  );

  test("for filesystem storage, relative path is resolved against the specified base path", () => {
    const basePath = new AbsolutePath("/base/path");
    const configToTest = {
      name: "dummy",
      storage: { type: "filesystem", path: "relative/storage/path" },
    };
    const parsedConfig = generateProjectConfigSchema(() => basePath).parse(
      configToTest,
    );
    expect(parsedConfig.storage).toEqual({
      type: "filesystem",
      path: new AbsolutePath("/base/path/relative/storage/path"),
    });
  });

  test("for filesystem storage, absolute path is not modified", () => {
    const basePath = new AbsolutePath("/base/path");
    const configToTest = {
      name: "dummy",
      storage: { type: "filesystem", path: "/absolute/storage/path" },
    };
    const parsedConfig = generateProjectConfigSchema(() => basePath).parse(
      configToTest,
    );
    expect(parsedConfig.storage).toEqual({
      type: "filesystem",
      path: new AbsolutePath("/absolute/storage/path"),
    });
  });
});
