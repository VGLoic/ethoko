import { AbsolutePath, AbsolutePathSchema } from "@/utils/path";
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
      .min(
        1,
        'If provided, the "awsProfile" field must not be an empty string when "type" is "aws". Provide the name of the AWS CLI profile to use for credentials.',
      )
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
      .min(
        1,
        'If provided, the "awsAccessKeyId" field must not be an empty string when "type" is "aws". Provide a valid AWS access key ID.',
      )
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

const FilesystemStorageSchema = z.object({
  type: z.literal("filesystem"),
  path: z
    .string('The "path" field must be a string when "type" is "filesystem"')
    .min(
      1,
      'The "path" field can not be an empty string when "type" is "filesystem". Provide a valid path or set it to "." to use the current directory or leave it empty to default to "./.ethoko-storage"',
    )
    .default("./.ethoko-storage")
    .pipe(AbsolutePathSchema),
});

const ProjectConfigSchema = z.object({
  name: z
    .string('"name" field must be a string')
    .min(1, '"name" field must be a non-empty string'),
  storage: z.discriminatedUnion(
    "type",
    [AwsStorageSchema, FilesystemStorageSchema],
    '"storage" field must be a valid storage configuration object. Start with specifying the "type" field as either "aws" or "filesystem" and provide the corresponding configuration fields.',
  ),
});

const EthokoConfigSchema = z
  .object({
    pulledArtifactsPath: z
      .string('"pulledArtifactsPath" field must be a string or left empty')
      .min(
        1,
        "'pulledArtifactsPath' cannot be an empty string. Provide a valid path or set it to '.' to use the current directory or leave it empty to default to './.ethoko'",
      )
      .default(".ethoko")
      .pipe(AbsolutePathSchema),
    typingsPath: z
      .string('"typingsPath" field must be a string or left empty')
      .min(
        1,
        "'typingsPath' cannot be an empty string. Provide a valid path or set it to '.' to use the current directory or leave it empty to default to './.ethoko-typings'",
      )
      .default(".ethoko-typings")
      .pipe(AbsolutePathSchema),
    compilationOutputPath: z
      .string('"compilationOutputPath" field must be a string or left empty')
      .min(
        1,
        "'compilationOutputPath' cannot be an empty string. Provide a valid path or set it to '.' to use the current directory or leave it empty",
      )
      .pipe(AbsolutePathSchema)
      .optional(),
    projects: z
      .array(
        ProjectConfigSchema,
        '"projects" field must be an array of project configurations',
      )
      .default([]),
    debug: z
      .boolean('"debug" field must be a boolean or left empty')
      .default(false),
  })
  .refine(
    (data) => {
      // Typings path and pulled artifacts path must not be a parent/child relationship
      return (
        data.typingsPath.resolvedPath !==
          data.pulledArtifactsPath.resolvedPath &&
        !data.typingsPath.resolvedPath.startsWith(
          data.pulledArtifactsPath.resolvedPath + path.sep,
        ) &&
        !data.pulledArtifactsPath.resolvedPath.startsWith(
          data.typingsPath.resolvedPath + path.sep,
        )
      );
    },
    {
      message:
        '"typingsPath" and "pulledArtifactsPath" cannot be in a parent-child relationship',
    },
  )
  .refine(
    (data) => {
      // In case of storage type "filesystem", the storage path must not be a child of typings path or pulled artifacts path
      const filesystemProjectPaths: string[] = [];
      for (const project of data.projects) {
        if (project.storage.type === "filesystem") {
          filesystemProjectPaths.push(project.storage.path.resolvedPath);
        }
      }
      if (filesystemProjectPaths.length > 0) {
        const resolvedTypingsPath = data.typingsPath.resolvedPath;
        const resolvedPulledArtifactsPath =
          data.pulledArtifactsPath.resolvedPath;
        return filesystemProjectPaths.every((resolvedStoragePath) => {
          return (
            resolvedTypingsPath !== resolvedStoragePath &&
            resolvedPulledArtifactsPath !== resolvedStoragePath &&
            !resolvedStoragePath.startsWith(resolvedTypingsPath + path.sep) &&
            !resolvedStoragePath.startsWith(
              resolvedPulledArtifactsPath + path.sep,
            )
          );
        });
      }
      return true;
    },
    {
      message:
        'For "filesystem" storage, the "storage.path" cannot be in a child relationship with "typingsPath" or "pulledArtifactsPath"',
    },
  );

type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type EthokoStorageConfig = ProjectConfig["storage"];

export class EthokoCliConfig {
  public pulledArtifactsPath: AbsolutePath;
  public typingsPath: AbsolutePath;
  public compilationOutputPath?: AbsolutePath;
  public debug: boolean;
  public configPath: AbsolutePath;
  public projects: ProjectConfig[];

  constructor(
    config: z.infer<typeof EthokoConfigSchema>,
    configPath: AbsolutePath,
  ) {
    this.pulledArtifactsPath = config.pulledArtifactsPath;
    this.typingsPath = config.typingsPath;
    this.compilationOutputPath = config.compilationOutputPath;
    this.debug = config.debug;
    this.configPath = configPath;
    this.projects = config.projects;
  }

  public getProjectConfig(project: string): ProjectConfig | undefined {
    return this.projects.find((p) => p.name === project);
  }
}

export async function loadConfig(
  configPath?: string,
): Promise<EthokoCliConfig> {
  const resolvedPath = configPath
    ? AbsolutePath.from(configPath)
    : await findConfigPath(AbsolutePath.from(process.cwd()));

  if (!resolvedPath) {
    throw new Error(`Ethoko config not found. Searched from ${process.cwd()} to the filesystem root.
Create an ethoko.config.json file or pass --config <path>.

Example ethoko.config.json:

{
  "pulledArtifactsPath": "./.ethoko-e2e/.ethoko",
  "typingsPath": "./.ethoko-typings",
  "compilationOutputPath": "./artifacts",
  "projects": [{
    "name": "my-contracts",
    "storage": {
      "type": "filesystem",
      "path": "./.ethoko-e2e/.storage"
    }
  }]
}`);
  }

  let configRaw: string;
  try {
    configRaw = await fs.readFile(resolvedPath.resolvedPath, "utf-8");
  } catch {
    throw new Error(
      `Failed to read ethoko.config.json at ${resolvedPath}. Please ensure the file exists and is readable.`,
    );
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(configRaw);
  } catch {
    throw new Error(
      `Invalid JSON in ethoko.config.json at ${resolvedPath}. Check for trailing commas or missing quotes.`,
    );
  }

  const parsingResult = EthokoConfigSchema.safeParse(parsedJson);
  if (!parsingResult.success) {
    throw new Error(
      `Invalid ethoko.config.json configuration at ${resolvedPath}.
  The identified errors are:
    ${z.prettifyError(parsingResult.error)}`,
    );
  }

  return new EthokoCliConfig(parsingResult.data, resolvedPath);
}

async function findConfigPath(
  startDir: AbsolutePath,
): Promise<AbsolutePath | null> {
  let currentDir = startDir;
  while (true) {
    const candidate = currentDir.join("ethoko.config.json");
    const exists = await fs
      .stat(candidate.resolvedPath)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      return candidate;
    }

    if (isRootPath(currentDir)) {
      return null;
    }
    currentDir = currentDir.dirname();
  }
}

function isRootPath(currentPath: AbsolutePath): boolean {
  return currentPath.dirname().resolvedPath === currentPath.resolvedPath;
}
