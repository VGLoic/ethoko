import { Command } from "commander";
import fs from "fs/promises";
import path from "path";
import { prompts, error as cliError } from "@/ui";
import { CliError } from "@/client/error";

/**
 * Register the CLI init command.
 */
export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize Ethoko configuration interactively")
    .requiredOption("--project <name>", "Project name")
    .option("--config <path>", "Custom config file path", "ethoko.config.json")
    .option("--force", "Overwrite existing config without prompting")
    .action(async (opts) => {
      try {
        await runInit(opts);
      } catch (err) {
        if (err instanceof CliError) {
          cliError(err.message);
        } else {
          cliError(
            "An unexpected error occurred, please fill an issue with the error details if the problem persists",
          );
          console.error(err);
        }
        process.exitCode = 1;
      }
    });
}

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

type ConfigData = {
  pulledArtifactsPath: string;
  typingsPath: string;
  compilationOutputPath?: string;
  projects: Array<{
    name: string;
    storage: StorageConfig;
  }>;
  debug: boolean;
};

async function runInit(opts: {
  project: string;
  config: string;
  force?: boolean;
}): Promise<void> {
  prompts.intro("Welcome to Ethoko CLI Configuration");

  const configPath = path.resolve(process.cwd(), opts.config);

  // Check if config already exists
  const configExists = await fs
    .stat(configPath)
    .then(() => true)
    .catch(() => false);

  if (configExists && !opts.force) {
    const overwrite = await prompts.confirm({
      message: `Configuration file already exists at ${configPath}. Overwrite?`,
      initialValue: false,
    });

    if (prompts.isCancel(overwrite)) {
      prompts.cancel("Configuration cancelled");
      return;
    }

    if (!overwrite) {
      prompts.cancel("Configuration cancelled");
      return;
    }
  }

  // Storage type selection
  const storageType = await prompts.select({
    message: "Select storage type:",
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

  if (prompts.isCancel(storageType)) {
    prompts.cancel("Configuration cancelled");
    return;
  }

  let storageConfig: StorageConfig;

  if (storageType === "aws") {
    // AWS Region
    const awsRegion = await prompts.text({
      message: "AWS Region:",
      placeholder: "e.g., us-east-1, eu-west-3",
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return "AWS Region is required";
        }
        return undefined;
      },
    });

    if (prompts.isCancel(awsRegion)) {
      prompts.cancel("Configuration cancelled");
      return;
    }

    // AWS Bucket Name
    const awsBucketName = await prompts.text({
      message: "S3 Bucket Name:",
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return "S3 Bucket Name is required";
        }
        return undefined;
      },
    });

    if (prompts.isCancel(awsBucketName)) {
      prompts.cancel("Configuration cancelled");
      return;
    }

    // Auth method
    const authMethod = await prompts.select({
      message: "AWS Authentication method:",
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

    if (prompts.isCancel(authMethod)) {
      prompts.cancel("Configuration cancelled");
      return;
    }

    if (authMethod === "profile") {
      const awsProfile = await clack.text({
        message: "AWS Profile name:",
        validate: (value) => {
          if (!value || value.trim().length === 0) {
            return "Profile name is required";
          }
          return undefined;
        },
      });

      if (clack.isCancel(awsProfile)) {
        clack.cancel("Configuration cancelled");
        return;
      }

      storageConfig = {
        type: "aws",
        awsRegion,
        awsBucketName,
        awsProfile,
      };
    } else if (authMethod === "access-keys") {
      const awsAccessKeyId = await prompts.text({
        message: "AWS Access Key ID:",
        validate: (value) => {
          if (!value || value.trim().length === 0) {
            return "Access Key ID is required";
          }
          return undefined;
        },
      });

      if (prompts.isCancel(awsAccessKeyId)) {
        prompts.cancel("Configuration cancelled");
        return;
      }

      const awsSecretAccessKey = await prompts.password({
        message: "AWS Secret Access Key:",
        validate: (value) => {
          if (!value || value.trim().length === 0) {
            return "Secret Access Key is required";
          }
          return undefined;
        },
      });

      if (prompts.isCancel(awsSecretAccessKey)) {
        prompts.cancel("Configuration cancelled");
        return;
      }

      // Role configuration (optional for static credentials)
      const awsRoleArn = await prompts.text({
        message: "AWS Role ARN (optional, press Enter to skip):",
        placeholder: "arn:aws:iam::123456789012:role/MyRole",
      });

      if (prompts.isCancel(awsRoleArn)) {
        prompts.cancel("Configuration cancelled");
        return;
      }

      let awsRoleExternalId: string | undefined;
      let awsRoleSessionName: string | undefined;
      let awsRoleDurationSeconds: number | undefined;

      if (awsRoleArn && awsRoleArn.trim().length > 0) {
        const roleExternalIdResult = await prompts.text({
          message: "Role External ID (optional, press Enter to skip):",
        });

        if (prompts.isCancel(roleExternalIdResult)) {
          prompts.cancel("Configuration cancelled");
          return;
        }

        awsRoleExternalId = roleExternalIdResult || undefined;

        const roleSessionNameResult = await prompts.text({
          message: "Role Session Name (optional, press Enter to skip):",
        });

        if (prompts.isCancel(roleSessionNameResult)) {
          prompts.cancel("Configuration cancelled");
          return;
        }

        awsRoleSessionName = roleSessionNameResult || undefined;

        const durationInput = await prompts.text({
          message:
            "Role Duration in seconds (900-43200, optional, press Enter to skip):",
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

        if (prompts.isCancel(durationInput)) {
          prompts.cancel("Configuration cancelled");
          return;
        }

        if (durationInput && durationInput.trim().length > 0) {
          awsRoleDurationSeconds = parseInt(durationInput, 10);
        }
      }

      storageConfig = {
        type: "aws",
        awsRegion,
        awsBucketName,
        awsAccessKeyId,
        awsSecretAccessKey,
        ...(awsRoleArn && awsRoleArn.trim().length > 0
          ? {
              awsRoleArn,
              ...(awsRoleExternalId && awsRoleExternalId.trim().length > 0
                ? { awsRoleExternalId }
                : {}),
              ...(awsRoleSessionName && awsRoleSessionName.trim().length > 0
                ? { awsRoleSessionName }
                : {}),
              ...(awsRoleDurationSeconds !== undefined
                ? { awsRoleDurationSeconds }
                : {}),
            }
          : {}),
      };
    } else {
      // Default credentials
      storageConfig = {
        type: "aws",
        awsRegion,
        awsBucketName,
      };
    }
  } else {
    // Filesystem storage
    const storagePath = await prompts.text({
      message:
        "Choose a path where Ethoko will store artifacts (default is .ethoko-storage):",
      initialValue: ".ethoko-storage",
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return "Storage path cannot be empty";
        }
        return undefined;
      },
    });

    if (prompts.isCancel(storagePath)) {
      prompts.cancel("Configuration cancelled");
      return;
    }

    storageConfig = {
      type: "filesystem",
      path: storagePath,
    };
  }

  // Additional paths
  const pulledArtifactsPath = await prompts.text({
    message:
      "Choose a path where Ethoko will store pulled artifacts (default is .ethoko):",
    initialValue: ".ethoko",
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Pulled artifacts path cannot be empty";
      }
      return undefined;
    },
  });

  if (prompts.isCancel(pulledArtifactsPath)) {
    prompts.cancel("Configuration cancelled");
    return;
  }

  const typingsPath = await prompts.text({
    message:
      "Choose a path where Ethoko will generate TypeScript typings (default is .ethoko-typings):",
    initialValue: ".ethoko-typings",
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Typings path cannot be empty";
      }
      return undefined;
    },
  });

  if (prompts.isCancel(typingsPath)) {
    prompts.cancel("Configuration cancelled");
    return;
  }

  // REMIND ME: improve this by checking in the repository
  const compilationOutputResult = await prompts.text({
    message:
      "Input the path where your compilation output are stored (e.g. `./out` for Forge, `./artifacts` for Hardhat):",
  });

  if (prompts.isCancel(compilationOutputResult)) {
    prompts.cancel("Configuration cancelled");
    return;
  }

  const compilationOutputPath =
    compilationOutputResult.trim().length > 0
      ? compilationOutputResult.trim()
      : undefined;

  // Build config object
  const configData: ConfigData = {
    pulledArtifactsPath,
    typingsPath,
    compilationOutputPath,
    projects: [
      {
        name: opts.project,
        storage: storageConfig,
      },
    ],
    debug: false,
  };

  // Show summary
  const summaryLines: string[] = [
    `Project: ${opts.project}`,
    `Storage Type: ${storageConfig.type === "aws" ? "AWS S3" : "Filesystem"}`,
  ];

  if (storageConfig.type === "aws") {
    summaryLines.push(`AWS Region: ${storageConfig.awsRegion}`);
    summaryLines.push(`S3 Bucket: ${storageConfig.awsBucketName}`);
    if (storageConfig.awsProfile) {
      summaryLines.push(`AWS Profile: ${storageConfig.awsProfile}`);
    } else if (storageConfig.awsAccessKeyId) {
      summaryLines.push(`AWS Access Key ID: ${storageConfig.awsAccessKeyId}`);
      summaryLines.push(`AWS Secret Access Key: ****`);
      if (storageConfig.awsRoleArn) {
        summaryLines.push(`Role ARN: ${storageConfig.awsRoleArn}`);
      }
    } else {
      summaryLines.push(`Authentication: Environment (default)`);
    }
  } else {
    summaryLines.push(`Storage Path: ${storageConfig.path}`);
  }

  summaryLines.push(`Pulled Artifacts Path: ${pulledArtifactsPath}`);
  summaryLines.push(`Typings Path: ${typingsPath}`);
  if (compilationOutputPath) {
    summaryLines.push(`Compilation Output Path: ${compilationOutputPath}`);
  }

  prompts.note(summaryLines.join("\n"), "Configuration Summary");

  const proceed = await prompts.confirm({
    message: "Save this configuration?",
    initialValue: true,
  });

  if (prompts.isCancel(proceed)) {
    prompts.cancel("Configuration cancelled");
    return;
  }

  if (!proceed) {
    prompts.cancel("Configuration cancelled");
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

  prompts.outro(
    `Configuration saved to ${opts.config}\n\nYou can now run: ethoko push <path>`,
  );
}
