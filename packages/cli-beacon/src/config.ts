import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const AwsStorageSchema = z
  .object({
    type: z.literal("aws"),
    awsRegion: z
      .string('The "awsRegion" field must be a string when "type" is "aws"')
      .min(
        1,
        'The "awsRegion" field is required when "type" is "aws". Provide a valid AWS region like "eu-west-3".',
      ),
    awsProfile: z
      .string('The "awsProfile" field must be a string when "type" is "aws"')
      .min(1, 'If provided, the "awsProfile" field must not be an empty string when "type" is "aws". Provide the name of the AWS CLI profile to use for credentials.')
      .optional(),
    awsBucketName: z
      .string('The "awsBucketName" field must be a string when "type" is "aws"')
      .min(
        1,
        'The "awsBucketName" field is required when "type" is "aws". Provide the name of the S3 bucket to use for storage.',
      ),
    awsAccessKeyId: z
      .string(
        'The "awsAccessKeyId" field must be a string when "type" is "aws"',
      )
      .min(1, 'If provided, the "awsAccessKeyId" field must not be an empty string when "type" is "aws". Provide a valid AWS access key ID.')
      .optional(),
    awsSecretAccessKey: z
      .string(
        'The "awsSecretAccessKey" field must be a string when "type" is "aws"',
      )
      .min(
        1,
        'If provided, the "awsSecretAccessKey" field must not be an empty string when "type" is "aws". Provide a valid AWS secret access key.',
      )
      .optional(),
    awsRoleArn: z
      .string('The "awsRoleArn" field must be a string when "type" is "aws"')
      .min(
        1,
        'If provided, the "awsRoleArn" field must not be an empty string when "type" is "aws"',
      )
      .optional(),
    awsRoleExternalId: z
      .string(
        'The "awsRoleExternalId" field must be a string when "type" is "aws"',
      )
      .min(
        1,
        'If provided, the "awsRoleExternalId" field must not be an empty string when "type" is "aws"',
      )
      .optional(),
    awsRoleSessionName: z
      .string(
        'The "awsRoleSessionName" field must be a string when "type" is "aws"',
      )
      .min(
        1,
        'If provided, the "awsRoleSessionName" field must not be an empty string when "type" is "aws"',
      )
      .optional(),
    awsRoleDurationSeconds: z
      .number(
        'The "awsRoleDurationSeconds" field must be a number when "type" is "aws"',
      )
      .int(
        'If provided, the "awsRoleDurationSeconds" field must be an integer when "type" is "aws"',
      )
      .min(
        900,
        'If provided, the "awsRoleDurationSeconds" field must be at least 900 seconds when "type" is "aws"',
      )
      .max(
        43200,
        'If provided, the "awsRoleDurationSeconds" field must be at most 43200 seconds when "type" is "aws"',
      )
      .optional(),
  })
  .transform((data, ctx) => {
    // If AWS profile is provided, use profile based credentials
    if (data.awsProfile) {
      // When using profile based credentials, role configuration fields must be empty
      if (
        data.awsAccessKeyId ||
        data.awsSecretAccessKey ||
        data.awsRoleArn ||
        data.awsRoleExternalId ||
        data.awsRoleSessionName ||
        data.awsRoleDurationSeconds
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            'When "awsProfile" is provided, credential fields ("awsAccessKeyId", "awsSecretAccessKey") and role configuration fields ("awsRoleArn", "awsRoleExternalId", "awsRoleSessionName", "awsRoleDurationSeconds") must be empty',
          input: data,
        });
        return z.NEVER;
      }
      return {
        type: "aws" as const,
        region: data.awsRegion,
        bucketName: data.awsBucketName,
        credentials: {
          type: "profile" as const,
          profile: data.awsProfile,
        },
      };
    }

    // For static configuration, access key and secret must be provided together
    const accessKey = data.awsAccessKeyId;
    const secretKey = data.awsSecretAccessKey;
    if (accessKey && secretKey) {
      let roleConfig:
        | {
            roleArn: string;
            externalId?: string;
            sessionName?: string;
            durationSeconds?: number;
          }
        | undefined = undefined;

      if (data.awsRoleArn) {
        roleConfig = {
          roleArn: data.awsRoleArn,
          externalId: data.awsRoleExternalId,
          sessionName: data.awsRoleSessionName,
          durationSeconds: data.awsRoleDurationSeconds,
        };
      } else {
        // If no role ARN provided, all the role related fields must be empty
        if (
          data.awsRoleExternalId ||
          data.awsRoleSessionName ||
          data.awsRoleDurationSeconds
        ) {
          ctx.addIssue({
            code: "custom",
            message:
              'When "awsRoleArn" is not provided, role configuration fields ("awsRoleExternalId", "awsRoleSessionName", "awsRoleDurationSeconds") must be empty',
            input: data,
          });
          return z.NEVER;
        }
      }

      return {
        type: "aws" as const,
        region: data.awsRegion,
        bucketName: data.awsBucketName,
        credentials: {
          type: "static" as const,
          accessKeyId: accessKey,
          secretAccessKey: secretKey,
          role: roleConfig,
        },
      };
    }
    if (accessKey || secretKey) {
      ctx.addIssue({
        code: "custom",
        message:
          'Both "awsAccessKeyId" and "awsSecretAccessKey" must be provided together when "type" is "aws"',
        input: data,
      });
      return z.NEVER;
    }

    // Else, no credentials are provided, all the role related fields must be empty
    if (
      data.awsRoleArn ||
      data.awsRoleExternalId ||
      data.awsRoleSessionName ||
      data.awsRoleDurationSeconds
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          'When no AWS credentials are provided, role configuration fields ("awsRoleArn", "awsRoleExternalId", "awsRoleSessionName", "awsRoleDurationSeconds") must be empty',
        input: data,
      });
      return z.NEVER;
    }

    return {
      type: "aws" as const,
      region: data.awsRegion,
      bucketName: data.awsBucketName,
    };
  });

const LocalStorageSchema = z.object({
  type: z.literal("local"),
  path: z
    .string('The "path" field must be a string when "type" is "local"')
    .min(
      1,
      'The "path" field can not be an empty string when "type" is "local". Provide a valid path or set it to "." to use the current directory or leave it empty to default to "./.ethoko-storage"',
    )
    .default("./.ethoko-storage")
    .transform((p) => path.resolve(p)),
});

const EthokoConfigSchema = z
  .object({
    project: z
      .string('"project" field must be a string')
      .min(1, '"project" field is required in ethoko.json'),
    pulledArtifactsPath: z
      .string('"pulledArtifactsPath" field must be a string or left empty')
      .min(
        1,
        "'pulledArtifactsPath' cannot be an empty string. Provide a valid path or set it to '.' to use the current directory or leave it empty to default to './.ethoko'",
      )
      .default(".ethoko")
      .transform((p) => path.resolve(p)),
    typingsPath: z
      .string('"typingsPath" field must be a string or left empty')
      .min(
        1,
        "'typingsPath' cannot be an empty string. Provide a valid path or set it to '.' to use the current directory or leave it empty to default to './.ethoko-typings'",
      )
      .default(".ethoko-typings")
      .transform((p) => path.resolve(p)),
    compilationOutputPath: z
      .string('"compilationOutputPath" field must be a string or left empty')
      .min(
        1,
        "'compilationOutputPath' cannot be an empty string. Provide a valid path or set it to '.' to use the current directory or leave it empty",
      )
      .transform((p) => path.resolve(p))
      .optional(),
    storage: z.discriminatedUnion(
      "type",
      [AwsStorageSchema, LocalStorageSchema],
      '"storage" field must be a valid storage configuration object. Start with specifying the "type" field as either "aws" or "local" and provide the corresponding configuration fields.',
    ),
    debug: z
      .boolean('"debug" field must be a boolean or left empty')
      .default(false),
  })
  .refine(
    (data) => {
      // Typings path and pulled artifacts path must not be a parent/child relationship
      const resolvedTypingsPath = path.resolve(data.typingsPath);
      const resolvedPulledArtifactsPath = path.resolve(
        data.pulledArtifactsPath,
      );
      return (
        path.resolve(data.typingsPath) !==
          path.resolve(data.pulledArtifactsPath) &&
        !resolvedTypingsPath.startsWith(
          resolvedPulledArtifactsPath + path.sep,
        ) &&
        !resolvedPulledArtifactsPath.startsWith(resolvedTypingsPath + path.sep)
      );
    },
    {
      message:
        '"typingsPath" and "pulledArtifactsPath" cannot be in a parent-child relationship',
    },
  )
  .refine(
    (data) => {
      // In case of storage type "local", the storage path must not be a child of typings path or pulled artifacts path
      if (data.storage.type === "local") {
        const resolvedStoragePath = path.resolve(data.storage.path);
        const resolvedTypingsPath = path.resolve(data.typingsPath);
        const resolvedPulledArtifactsPath = path.resolve(
          data.pulledArtifactsPath,
        );
        return (
          resolvedTypingsPath !== resolvedStoragePath &&
          resolvedPulledArtifactsPath !== resolvedStoragePath &&
          !resolvedStoragePath.startsWith(resolvedTypingsPath + path.sep) &&
          !resolvedStoragePath.startsWith(
            resolvedPulledArtifactsPath + path.sep,
          )
        );
      }
      return true;
    },
    {
      message:
        'For "local" storage, the "storage.path" cannot be in a child relationship with "typingsPath" or "pulledArtifactsPath"',
    },
  );

export type EthokoCliConfig = z.infer<typeof EthokoConfigSchema> & {
  configPath: string;
};

export async function loadConfig(
  configPath?: string,
): Promise<EthokoCliConfig> {
  const resolvedPath = configPath
    ? path.resolve(process.cwd(), configPath)
    : await findConfigPath(process.cwd());

  if (!resolvedPath) {
    throw new Error(`Ethoko config not found. Searched from ${process.cwd()} to the filesystem root.
Create an ethoko.json file or pass --config <path>.

Example ethoko.json:

{
  "project": "my-contracts",
  "pulledArtifactsPath": "./.ethoko-e2e/.ethoko",
  "typingsPath": "./.ethoko-typings",
  "compilationOutputPath": "./artifacts",
  "storage": {
    "type": "local",
    "path": "./.ethoko-e2e/.storage"
  }
}`);
  }

  let configRaw: string;
  try {
    configRaw = await fs.readFile(resolvedPath, "utf-8");
  } catch {
    throw new Error(
      `Failed to read ethoko.json at ${resolvedPath}. Please ensure the file exists and is readable.`,
    );
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(configRaw);
  } catch {
    throw new Error(
      `Invalid JSON in ethoko.json at ${resolvedPath}. Check for trailing commas or missing quotes.`,
    );
  }

  const parsingResult = EthokoConfigSchema.safeParse(parsedJson);
  if (!parsingResult.success) {
    throw new Error(
      `Invalid ethoko.json configuration at ${resolvedPath}.
  The identified errors are:
    ${z.prettifyError(parsingResult.error)}`,
    );
  }

  return { ...parsingResult.data, configPath: resolvedPath };
}

async function findConfigPath(startDir: string): Promise<string | null> {
  let currentDir = startDir;
  while (true) {
    const candidate = path.join(currentDir, "ethoko.json");
    const exists = await fs
      .stat(candidate)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      return candidate;
    }

    if (isRootPath(currentDir)) {
      return null;
    }
    currentDir = path.dirname(currentDir);
  }
}

function isRootPath(currentPath: string): boolean {
  return path.dirname(currentPath) === currentPath;
}
