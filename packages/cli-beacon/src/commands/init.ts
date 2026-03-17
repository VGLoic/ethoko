import { Command } from "commander";
import fs from "fs/promises";
import path from "path";
import { CommandLogger } from "@/ui";
import { CliError } from "@/client/error";

/**
 * Register the CLI init command.
 */
export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize Ethoko configuration interactively")
    .option("--config <path>", "Custom config file path", "ethoko.config.json")
    .option("--force", "Overwrite existing config without prompting")
    .action(async (opts) => {
      const logger = new CommandLogger();
      try {
        await runInit(logger, opts);
      } catch (err) {
        if (err instanceof CliError) {
          logger.error(err.message);
        } else {
          logger.error(
            "An unexpected error occurred, please fill an issue with the error details if the problem persists",
          );
          console.error(err);
        }
        process.exitCode = 1;
      }
    });
}

type ConfigData = {
  pulledArtifactsPath: string;
  typingsPath: string;
  compilationOutputPath?: string;
  projects: Array<ProjectConfig>;
  debug: boolean;
};

type ProjectConfig = {
  name: string;
  storage: StorageConfig;
};
type StorageConfig =
  | {
      type: "aws";
      awsRegion: string;
      awsBucketName: string;
      awsProfile?: string;
      awsAccessKeyId?: string;
      awsSecretAccessKey?: string;
      awsRoleArn?: string;
      awsRoleExternalId?: string;
      awsRoleSessionName?: string;
      awsRoleDurationSeconds?: number;
    }
  | {
      type: "filesystem";
      path: string;
    };

async function runInit(
  logger: CommandLogger,
  opts: {
    config: string;
    force?: boolean;
  },
): Promise<void> {
  logger.intro("Welcome to Ethoko CLI Configuration");

  const configPath = path.resolve(process.cwd(), opts.config);

  // Check if config already exists
  const configExists = await fs
    .stat(configPath)
    .then(() => true)
    .catch(() => false);

  if (configExists && !opts.force) {
    const overwrite = await logger.prompts.confirm({
      message: `Configuration file already exists at ${configPath}. Overwrite?`,
      initialValue: false,
    });

    if (logger.prompts.isCancel(overwrite)) {
      logger.cancel("Configuration cancelled");
      return;
    }

    if (!overwrite) {
      logger.cancel("Configuration cancelled");
      return;
    }
  }

  const projectConfigResult = await promptFirstProject(logger);
  if (projectConfigResult.cancelled) {
    logger.cancel("Operation cancelled during project configuration");
    return;
  }

  logger.note(
    `Project "${projectConfigResult.project.name}" configured successfully!\nLet's finish with the last details!`,
  );

  // Additional paths

  const compilationOutputOptions = await deriveCompilationOutputPathsOptions();
  let compilationOutputPath: string | undefined = undefined;
  if (compilationOutputOptions.length > 0) {
    const compilationOutputSelection = await logger.prompts.select({
      message: "Select the path where your compilation output are stored:",
      options: [
        ...compilationOutputOptions.map((option) => ({
          value: option.path,
          label: `${option.path} (${option.label})`,
        })),
        {
          value: "other",
          label: "Other",
          hint: "Specify another path",
        },
      ],
    });
    if (logger.prompts.isCancel(compilationOutputSelection)) {
      logger.cancel("Configuration cancelled");
      return;
    }
    if (compilationOutputSelection !== "other") {
      compilationOutputPath = compilationOutputSelection;
    }
  }
  if (!compilationOutputPath) {
    const compilationOutputResult = await logger.prompts.text({
      message:
        "Input the path where your compilation output are stored (e.g. `./out` for Forge, `./artifacts` for Hardhat, press Enter to skip):",
    });

    if (logger.prompts.isCancel(compilationOutputResult)) {
      logger.cancel("Configuration cancelled");
      return;
    }
    compilationOutputPath =
      compilationOutputResult.trim().length > 0
        ? compilationOutputResult.trim()
        : undefined;
  }

  const pulledArtifactsPath = await logger.prompts.text({
    message:
      "Choose a path for the pulled artifacts store (default is .ethoko):",
    initialValue: ".ethoko",
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Pulled artifacts path cannot be empty";
      }
      return undefined;
    },
  });

  if (logger.prompts.isCancel(pulledArtifactsPath)) {
    logger.cancel("Configuration cancelled");
    return;
  }

  const typingsPath = await logger.prompts.text({
    message:
      "Choose a path for the generated TypeScript typings (default is .ethoko-typings):",
    initialValue: ".ethoko-typings",
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Typings path cannot be empty";
      }
      return undefined;
    },
  });

  if (logger.prompts.isCancel(typingsPath)) {
    logger.cancel("Configuration cancelled");
    return;
  }

  // Build config object
  const configData: ConfigData = {
    pulledArtifactsPath,
    typingsPath,
    compilationOutputPath,
    projects: [projectConfigResult.project],
    debug: false,
  };

  // Show summary
  const summaryLines: string[] = [
    `Project: ${projectConfigResult.project.name}`,
    ` Storage type: ${projectConfigResult.project.storage.type === "aws" ? "AWS S3" : "Filesystem"}`,
  ];

  if (projectConfigResult.project.storage.type === "aws") {
    summaryLines.push(
      ` AWS region: ${projectConfigResult.project.storage.awsRegion}`,
    );
    summaryLines.push(
      ` S3 bucket: ${projectConfigResult.project.storage.awsBucketName}`,
    );
    if (projectConfigResult.project.storage.awsProfile) {
      summaryLines.push(
        ` AWS profile: ${projectConfigResult.project.storage.awsProfile}`,
      );
    } else if (projectConfigResult.project.storage.awsAccessKeyId) {
      summaryLines.push(
        ` AWS access Key ID: ${projectConfigResult.project.storage.awsAccessKeyId}`,
      );
      summaryLines.push(` AWS Secret Access Key: ****`);
      if (projectConfigResult.project.storage.awsRoleArn) {
        summaryLines.push(
          ` AWS role ARN: ${projectConfigResult.project.storage.awsRoleArn}`,
        );
      }
    } else {
      summaryLines.push(` Authentication: environment (default)`);
    }
  } else {
    summaryLines.push(
      ` Storage path: ${projectConfigResult.project.storage.path}`,
    );
  }

  summaryLines.push("");
  summaryLines.push("Artifact paths:");
  summaryLines.push(` Pulled artifacts path: ${pulledArtifactsPath}`);
  summaryLines.push(` Typings path: ${typingsPath}`);
  if (compilationOutputPath) {
    summaryLines.push(` Compilation output path: ${compilationOutputPath}`);
  }

  logger.note(summaryLines.join("\n"), "Configuration summary");

  const proceed = await logger.prompts.confirm({
    message: "Save this configuration?",
    initialValue: true,
  });

  if (logger.prompts.isCancel(proceed)) {
    logger.cancel("Configuration cancelled");
    return;
  }

  if (!proceed) {
    logger.cancel("Configuration cancelled");
    return;
  }

  // Write config file
  try {
    await fs.writeFile(
      configPath,
      JSON.stringify(configData, null, 2) + "\n",
      "utf-8",
    );
  } catch (error) {
    throw new CliError(
      `Failed to write configuration file to ${configPath}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  logger.outro(
    `Configuration saved to ${opts.config}\n\nEdit this file to add more projects or customize your configuration further.\nRun "ethoko pull ${projectConfigResult.project.name}" to pull artifacts for your project.`,
  );
}

/**
 * Prompt the user to configure their first project, including storage type and related settings.
 * Handles both AWS S3 and filesystem storage options with appropriate follow-up questions.
 * @returns An object containing the configured project or a cancellation flag if the user cancels at any point.
 */
async function promptFirstProject(
  logger: CommandLogger,
): Promise<{ cancelled: false; project: ProjectConfig } | { cancelled: true }> {
  const projectName = await logger.prompts.text({
    message: "Enter the name of your first project:",
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Project name cannot be empty";
      }
      return undefined;
    },
  });

  if (logger.prompts.isCancel(projectName)) {
    return { cancelled: true };
  }

  // Storage type selection
  const storageType = await logger.prompts.select({
    message: `Project "${projectName}" ~ Select the storage type:`,
    options: [
      {
        value: "aws",
        label: "AWS S3",
        hint: "Store artifacts in an S3 bucket",
      },
      {
        value: "filesystem",
        label: "Filesystem",
        hint: "Store artifacts on local filesystem",
      },
    ],
  });

  if (logger.prompts.isCancel(storageType)) {
    return { cancelled: true };
  }

  if (storageType === "aws") {
    const awsConfigResult = await promptAwsS3Config(logger, projectName);
    if (awsConfigResult.cancelled) {
      return { cancelled: true };
    }

    return {
      cancelled: false,
      project: {
        name: projectName,
        storage: awsConfigResult.storageConfig,
      },
    };
  }

  if (storageType === "filesystem") {
    const storagePath = await logger.prompts.text({
      message: `Project "${projectName}" ~ Choose a path for the artifacts store (default is .ethoko-storage):`,
      initialValue: ".ethoko-storage",
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return "Storage path cannot be empty";
        }
        return undefined;
      },
    });

    if (logger.prompts.isCancel(storagePath)) {
      return { cancelled: true };
    }

    return {
      cancelled: false,
      project: {
        name: projectName,
        storage: {
          type: "filesystem",
          path: storagePath,
        },
      },
    };
  }

  throw new Error(`Unsupported storage type: ${storageType satisfies never}`);
}

/**
 * Prompt the user for AWS S3 configuration details, including region, bucket name, and authentication method.
 * Supports multiple authentication methods: environment/default, AWS profile, or direct access keys with optional role assumption.
 * @param projectName Project name for contextualizing the prompts
 * @returns The AWS storage configuration or a cancellation flag if the user cancels at any point.
 */
async function promptAwsS3Config(
  logger: CommandLogger,
  projectName: string,
): Promise<
  | { cancelled: false; storageConfig: Extract<StorageConfig, { type: "aws" }> }
  | { cancelled: true }
> {
  const awsRegionInput = await logger.prompts.text({
    message: `Project "${projectName}" ~ Enter AWS Region:`,
    placeholder: "e.g., us-east-1, eu-west-3",
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "AWS Region is required";
      }
      return undefined;
    },
  });

  if (logger.prompts.isCancel(awsRegionInput)) {
    return { cancelled: true };
  }
  const awsRegion = awsRegionInput.trim();

  const awsBucketNameInput = await logger.prompts.text({
    message: `Project "${projectName}" ~ Enter S3 Bucket Name:`,
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "S3 Bucket Name is required";
      }
      return undefined;
    },
  });

  if (logger.prompts.isCancel(awsBucketNameInput)) {
    return { cancelled: true };
  }
  const awsBucketName = awsBucketNameInput.trim();

  // Auth method
  const authMethod = await logger.prompts.select({
    message: `Project "${projectName}" ~ Select AWS Authentication method:`,
    options: [
      {
        value: "default",
        label: "Environment (default credentials)",
        hint: "Use AWS credentials from environment or instance role",
      },
      {
        value: "profile",
        label: "AWS Profile",
        hint: "Use a named AWS CLI profile",
      },
      {
        value: "access-keys",
        label: "Access Keys",
        hint: "Provide AWS access key and secret",
      },
    ],
  });

  if (logger.prompts.isCancel(authMethod)) {
    return { cancelled: true };
  }

  if (authMethod === "default") {
    return {
      cancelled: false,
      storageConfig: {
        type: "aws",
        awsRegion,
        awsBucketName,
      },
    };
  }

  if (authMethod === "profile") {
    const awsProfileInput = await logger.prompts.text({
      message: `Project "${projectName}" ~ Enter AWS Profile name:`,
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return "Profile name is required";
        }
        return undefined;
      },
    });

    if (logger.prompts.isCancel(awsProfileInput)) {
      return { cancelled: true };
    }

    const awsProfile = awsProfileInput.trim();

    return {
      cancelled: false,
      storageConfig: {
        type: "aws",
        awsRegion,
        awsBucketName,
        awsProfile,
      },
    };
  }

  if (authMethod === "access-keys") {
    const awsAccessKeyIdInput = await logger.prompts.text({
      message: `Project "${projectName}" ~ Enter AWS Access Key ID:`,
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return "Access Key ID is required";
        }
        return undefined;
      },
    });

    if (logger.prompts.isCancel(awsAccessKeyIdInput)) {
      return { cancelled: true };
    }
    const awsAccessKeyId = awsAccessKeyIdInput.trim();

    const awsSecretAccessKeyInput = await logger.prompts.password({
      message: `Project "${projectName}" ~ Enter AWS Secret Access Key:`,
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return "Secret Access Key is required";
        }
        return undefined;
      },
    });

    if (logger.prompts.isCancel(awsSecretAccessKeyInput)) {
      return { cancelled: true };
    }
    const awsSecretAccessKey = awsSecretAccessKeyInput.trim();

    const awsRoleArnInput = await logger.prompts.text({
      message: `Project "${projectName}" ~ Enter AWS Role ARN (optional, press Enter to skip):`,
      placeholder: "arn:aws:iam::123456789012:role/MyRole",
    });

    if (logger.prompts.isCancel(awsRoleArnInput)) {
      return { cancelled: true };
    }
    const awsRoleArn = awsRoleArnInput.trim();

    if (!awsRoleArn) {
      return {
        cancelled: false,
        storageConfig: {
          type: "aws",
          awsRegion,
          awsBucketName,
          awsAccessKeyId,
          awsSecretAccessKey,
        },
      };
    }

    const awsRoleExternalIdInput = await logger.prompts.text({
      message: `Project "${projectName}" ~ Enter Role External ID (optional, press Enter to skip):`,
    });

    if (logger.prompts.isCancel(awsRoleExternalIdInput)) {
      return { cancelled: true };
    }
    const awsRoleExternalId =
      awsRoleExternalIdInput.trim().length > 0
        ? awsRoleExternalIdInput.trim()
        : undefined;

    const awsRoleSessionNameInput = await logger.prompts.text({
      message: `Project "${projectName}" ~ Enter Role Session Name (optional, press Enter to skip):`,
    });

    if (logger.prompts.isCancel(awsRoleSessionNameInput)) {
      return { cancelled: true };
    }
    const awsRoleSessionName =
      awsRoleSessionNameInput.trim().length > 0
        ? awsRoleSessionNameInput.trim()
        : undefined;

    const duration = await logger.prompts.text({
      message: `Project "${projectName}" ~ Enter Role Duration in seconds (900-43200, optional, press Enter to skip):`,
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return undefined; // Allow empty
        }
        const num = parseInt(value, 10);
        if (isNaN(num)) {
          return "Duration must be a number";
        }
        if (num < 900 || num > 43200) {
          return "Duration must be between 900 and 43200 seconds";
        }
        return undefined;
      },
    });

    if (logger.prompts.isCancel(duration)) {
      return { cancelled: true };
    }

    let awsRoleDurationSeconds: number | undefined;
    if (duration && duration.trim().length > 0) {
      awsRoleDurationSeconds = parseInt(duration, 10);
    }

    return {
      cancelled: false,
      storageConfig: {
        type: "aws",
        awsRegion,
        awsBucketName,
        awsAccessKeyId,
        awsSecretAccessKey,
        awsRoleArn,
        awsRoleSessionName,
        awsRoleDurationSeconds,
        awsRoleExternalId,
      },
    };
  }

  throw new Error(
    `Unsupported authentication method: ${authMethod satisfies never}`,
  );
}

/**
 * Identify potential compilation output paths based on common project structures (e.g., Hardhat, Foundry)
 * For Hardhat, checks for hardhat.config.js/ts, package.json with hardhat dependency, or artifacts/ directory to suggest ./artifacts
 * For Foundry, checks for foundry.toml, lib/ or out/ directory to suggest ./out
 * @returns The list of suggested compilation output paths with labels for user selection
 */
async function deriveCompilationOutputPathsOptions(): Promise<
  { path: string; label: string }[]
> {
  // Existence of
  // - hardhat.config.{js,ts}
  // - package.json with hardhat as dependency
  // - artifacts/ directory
  // -> suggest ./artifacts because likely a Hardhat project

  // Existence of
  // - foundry.toml
  // - lib/ directory
  // - out/ directory
  // -> suggest ./out because likely a Foundry project

  const options: { path: string; label: string }[] = [];

  const hardhatConfigExists = await fs
    .stat(path.resolve(process.cwd(), "hardhat.config.js"))
    .then(() => true)
    .catch(() => false);

  const hardhatConfigTsExists = await fs
    .stat(path.resolve(process.cwd(), "hardhat.config.ts"))
    .then(() => true)
    .catch(() => false);

  const packageJsonPath = path.resolve(process.cwd(), "package.json");
  const packageJsonExists = await fs
    .stat(packageJsonPath)
    .then(() => true)
    .catch(() => false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let packageJson: any = {};
  if (packageJsonExists) {
    try {
      const packageJsonContent = await fs.readFile(packageJsonPath, "utf-8");
      packageJson = JSON.parse(packageJsonContent);
    } catch {
      // Ignore JSON parsing errors
    }
  }

  const hardhatDependencyExists =
    packageJson.dependencies?.hardhat || packageJson.devDependencies?.hardhat;

  const artifactsDirExists = await fs
    .stat(path.resolve(process.cwd(), "artifacts"))
    .then(() => true)
    .catch(() => false);

  if (
    hardhatConfigExists ||
    hardhatConfigTsExists ||
    hardhatDependencyExists ||
    artifactsDirExists
  ) {
    options.push({ path: "./artifacts", label: "Hardhat default output" });
  }

  const foundryConfigExists = await fs
    .stat(path.resolve(process.cwd(), "foundry.toml"))
    .then(() => true)
    .catch(() => false);

  const libDirExists = await fs
    .stat(path.resolve(process.cwd(), "lib"))
    .then(() => true)
    .catch(() => false);

  const outDirExists = await fs
    .stat(path.resolve(process.cwd(), "out"))
    .then(() => true)
    .catch(() => false);

  if (foundryConfigExists || libDirExists || outDirExists) {
    options.push({ path: "./out", label: "Foundry default output" });
  }

  return options;
}
