import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const AwsRoleSchema = z.object({
  awsRoleArn: z.string().min(1),
  awsRoleExternalId: z.string().min(1).optional(),
  awsRoleSessionName: z.string().min(1).default("ethoko-cli-session"),
  awsRoleDurationSeconds: z.number().int().min(900).max(43200).default(3600),
});

const AwsStorageSchema = z.object({
  type: z.literal("aws"),
  awsRegion: z.string().min(1),
  awsBucketName: z.string().min(1),
  awsAccessKeyId: z.string().min(1).optional(),
  awsSecretAccessKey: z.string().min(1).optional(),
  awsRoleArn: z.string().min(1).optional(),
  awsRoleExternalId: z.string().min(1).optional(),
  awsRoleSessionName: z.string().min(1).optional(),
  awsRoleDurationSeconds: z.number().int().min(900).max(43200).optional(),
});

const LocalStorageSchema = z.object({
  type: z.literal("local"),
  path: z.string().min(1),
});

const EthokoConfigSchema = z.object({
  project: z.string().min(1),
  pulledArtifactsPath: z.string().default(".ethoko"),
  typingsPath: z.string().default(".ethoko-typings"),
  compilationOutputPath: z.string().optional(),
  storage: z.discriminatedUnion("type", [AwsStorageSchema, LocalStorageSchema]),
  debug: z.boolean().default(false),
});

export type EthokoCliConfig = z.infer<typeof EthokoConfigSchema> & {
  storage:
    | z.infer<typeof AwsStorageSchema>
    | z.infer<typeof LocalStorageSchema>;
  awsRole?: z.infer<typeof AwsRoleSchema>;
  configPath: string;
};

function isRootPath(currentPath: string): boolean {
  return path.dirname(currentPath) === currentPath;
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

function extractAwsRoleConfig(
  config: z.infer<typeof AwsStorageSchema>,
): z.infer<typeof AwsRoleSchema> | undefined {
  if (
    (config.awsRoleExternalId ||
      config.awsRoleSessionName ||
      config.awsRoleDurationSeconds) &&
    !config.awsRoleArn
  ) {
    throw new Error(
      "AWS role configuration requires awsRoleArn when role fields are provided",
    );
  }

  if (!config.awsRoleArn) {
    return undefined;
  }

  if (!config.awsAccessKeyId || !config.awsSecretAccessKey) {
    throw new Error(
      "AWS role configuration requires awsAccessKeyId and awsSecretAccessKey",
    );
  }

  const roleParsingResult = AwsRoleSchema.safeParse({
    awsRoleArn: config.awsRoleArn,
    awsRoleExternalId: config.awsRoleExternalId,
    awsRoleSessionName: config.awsRoleSessionName,
    awsRoleDurationSeconds: config.awsRoleDurationSeconds,
  });

  if (!roleParsingResult.success) {
    throw new Error("Invalid AWS role configuration in ethoko.json");
  }

  return roleParsingResult.data;
}

function buildConfigErrorMessage(): string {
  return `Ethoko config not found. Create an ethoko.json file with the following example:

{
  "project": "my-contracts",
  "pulledArtifactsPath": "./.ethoko-e2e/.ethoko",
  "typingsPath": "./.ethoko-typings",
  "compilationOutputPath": "./artifacts",
  "storage": {
    "type": "local",
    "path": "./.ethoko-e2e/.storage"
  }
}`;
}

export async function loadConfig(
  configPath?: string,
): Promise<EthokoCliConfig> {
  const resolvedPath = configPath
    ? path.resolve(process.cwd(), configPath)
    : await findConfigPath(process.cwd());

  if (!resolvedPath) {
    throw new Error(buildConfigErrorMessage());
  }

  const configRaw = await fs.readFile(resolvedPath, "utf-8");
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(configRaw);
  } catch {
    throw new Error(`Invalid JSON in ethoko.json at ${resolvedPath}`);
  }

  const parsingResult = EthokoConfigSchema.safeParse(parsedJson);
  if (!parsingResult.success) {
    throw new Error(`Invalid ethoko.json configuration at ${resolvedPath}`);
  }

  const storage = parsingResult.data.storage;
  const resolvedConfigDir = path.dirname(resolvedPath);
  const baseConfig = {
    ...parsingResult.data,
    storage,
    pulledArtifactsPath: path.resolve(
      resolvedConfigDir,
      parsingResult.data.pulledArtifactsPath,
    ),
    typingsPath: path.resolve(
      resolvedConfigDir,
      parsingResult.data.typingsPath,
    ),
    compilationOutputPath: parsingResult.data.compilationOutputPath
      ? path.resolve(
          resolvedConfigDir,
          parsingResult.data.compilationOutputPath,
        )
      : undefined,
    configPath: resolvedPath,
  };

  if (storage.type === "aws") {
    const awsRole = extractAwsRoleConfig(storage);
    return {
      ...baseConfig,
      storage,
      awsRole,
    };
  }

  return {
    ...baseConfig,
    storage: {
      ...storage,
      path: path.resolve(resolvedConfigDir, storage.path),
    },
  };
}
