import { Command } from "commander";
import fs from "fs/promises";
import path from "path";
import { CommandLogger } from "@/ui";
import { CliError } from "@/client/error";
import { AbsolutePath, RelativePath } from "@/utils/path";
import { EthokoCliConfig, loadConfig } from "@/config";
import {
  getEthokoGlobalConfigPath,
  getEthokoGlobalPath,
  GlobalEthokoConfigInput,
} from "@/config/global-config";
import { LocalEthokoConfigInput } from "@/config/local-config";
import { toAsyncResult } from "@/utils/result";

/**
 * Register the CLI init command.
 */
export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize Ethoko configuration interactively")
    .option("--config <path>", "Custom config file path", "ethoko.config.json")
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

type ProjectConfigInput = NonNullable<
  LocalEthokoConfigInput["projects"]
>[number];

/**
 * Run the interactive initialization process to create or update the global and local Ethoko configuration files.
 *
 * Flow is as follows:
 * 1. Welcome message and intro
 * 2. Load global and local config if they exist
 * 3. Look at projects
 *  3.A. If no project exists, ask if user wants to add a first project
 *    3.A.A. If yes, use `promptProject` to ask for project name, storage configuration (AWS S3 or filesystem),
 *           and scope (global saved to ~/.ethoko/config.json, or local saved to ./ethoko.config.json)
 *    3.A.B. If no, go to step 4
 *  3.B. If projects exist, show summary of existing projects and ask if user wants to add a new project
 *   3.B.A. If yes, use `promptProject` to configure the new project and add it to the list
 *   3.B.B. If no, go to step 4
 * 4. Check if Hardhat or Foundry project based on common files
 *  4.A. If detected, suggest default compilation output path (./artifacts for Hardhat, ./out for Foundry) and ask user to confirm or input another path, go to step 5
 *  4.B. If not detected, go to step 5
 * 5. Check if .git directory exists,
 *  5.A. If it exists and `.gitignore` exists, add the typings path to .gitignore if not already present. If the pulled artifacts path is local (relative path), add it to .gitignore if not already present. Inform the user about the changes made to .gitignore.
 *  5.B. If it exists and `.gitignore` does not exist, create a .gitignore file with the typings path and, if applicable, the pulled artifacts path. Inform the user about the creation of .gitignore.
 *  5.C. If it does not exist, skip .gitignore handling and inform the user that they should manually ignore the typings path and pulled artifacts path if they are local.
 * 6. Show summary of the changed configuration and inform user where the config files are located, next steps, and how to edit the config file to add more projects or customize further.
 */
async function runInit(
  logger: CommandLogger,
  opts: {
    config: string;
  },
): Promise<void> {
  logger.intro("Welcome to Ethoko CLI Configuration!");

  const introLines = [
    "This interactive setup will guide you through configuring your Ethoko projects and settings.",
    "If the script is not enough, we encourage you to edit the configuration files directly for full customization.",
  ];
  logger.note(introLines.join("\n"));

  // Step 1: Load existing configs
  const config = await loadConfig({ localConfigPath: opts.config });

  // Step 2: Projects
  if (config.projects.length === 0) {
    const wants = await logger.prompts.confirm({
      message:
        "No projects have been configured yet. Do you want to add your first project?",
      initialValue: true,
    });
    if (logger.prompts.isCancel(wants)) {
      logger.cancel("Configuration cancelled");
      return;
    }
    if (wants) {
      const result = await handleProject(logger, config);
      if (result.cancelled) {
        logger.cancel("Operation cancelled during project configuration");
        return;
      }
    }
  } else {
    const lines = config.projects.map(
      (p) =>
        ` • ${p.name} (${p.storage.type}) [${config.globalProjectNames.has(p.name) ? "global" : "local"}]`,
    );
    logger.note(lines.join("\n"), "Existing projects");
    const wants = await logger.prompts.confirm({
      message: "Do you want to add another project?",
      initialValue: true,
    });
    if (logger.prompts.isCancel(wants)) {
      logger.cancel("Configuration cancelled");
      return;
    }
    if (wants) {
      const result = await handleProject(logger, config);
      if (result.cancelled) {
        logger.cancel("Operation cancelled during project configuration");
        return;
      }
    }
  }

  // Step 3: Compilation output path
  const compilationOutputPathResult = await handleCompilationOutputPath(
    logger,
    config,
  );
  if (compilationOutputPathResult.cancelled) {
    logger.cancel(
      "Operation cancelled during compilation output path configuration",
    );
    return;
  }

  // Step 4: .gitignore handling
  await handleGitignore(
    logger,
    new AbsolutePath(process.cwd()),
    config.typingsPath,
    config.pulledArtifactsPath,
  );

  const outroLines: string[] = [
    "For further customization, edit the configuration files directly:",
    ` - Global config: ${config.globalConfigPath?.resolvedPath ?? getEthokoGlobalConfigPath().resolvedPath}`,
    ` - Local config: ${config.localConfigPath?.resolvedPath ?? new AbsolutePath(process.cwd(), "ethoko.config.json").resolvedPath}`,
    "You can use this init script again anytime to add more projects or update your configuration.",
  ];
  logger.note(outroLines.join("\n"));
  logger.outro("Configuration completed");
}

/**
 * Prompt the user to set up a new project configuration then update the correct config file
 * @returns The new project configuration and its scope, or a cancellation flag if the user cancels at any point
 */
async function handleProject(
  logger: CommandLogger,
  config: EthokoCliConfig,
): Promise<
  | {
      cancelled: false;
      scope: "global" | "local";
      project: ProjectConfigInput;
    }
  | { cancelled: true }
> {
  const promptResult = await promptProject(logger, config);
  if (promptResult.cancelled) {
    return { cancelled: true };
  }

  if (promptResult.scope === "global") {
    if (config.globalConfigPath) {
      // If global config already exists, we update its content with the new project
      const existingGlobalConfigContentResult = await toAsyncResult(
        fs
          .readFile(config.globalConfigPath.resolvedPath, "utf-8")
          .then(JSON.parse),
      );
      if (!existingGlobalConfigContentResult.success) {
        throw new CliError(
          `Global config file at ${config.globalConfigPath.resolvedPath} can not be read or is not a valid JSON. Please fix it before adding a new project.`,
        );
      }
      const updatedContent = {
        ...existingGlobalConfigContentResult.value,
        projects: [
          ...(existingGlobalConfigContentResult.value.projects ?? []),
          promptResult.project,
        ],
      };
      const updateConfigResult = await toAsyncResult(
        fs.writeFile(
          config.globalConfigPath.resolvedPath,
          JSON.stringify(updatedContent, null, 2) + "\n",
          "utf-8",
        ),
      );
      if (!updateConfigResult.success) {
        throw new CliError(
          "Failed to update global config file with the new project. Please verify permissions or contact us if the problem persists.",
        );
      }
    } else {
      // If global config doesn't exist, we create it with the new project
      const ensureDirResult = await toAsyncResult(
        fs.mkdir(getEthokoGlobalPath().resolvedPath, { recursive: true }),
      );
      if (!ensureDirResult.success) {
        throw new CliError(
          `Failed to create directory for global config at ${getEthokoGlobalPath().resolvedPath}. Please verify permissions or contact us if the problem persists.`,
        );
      }
      const config: GlobalEthokoConfigInput = {
        projects: [promptResult.project],
      };
      const writeConfigResult = await toAsyncResult(
        fs.writeFile(
          getEthokoGlobalConfigPath().resolvedPath,
          JSON.stringify(config, null, 2) + "\n",
          "utf-8",
        ),
      );
      if (!writeConfigResult.success) {
        throw new CliError(
          `Failed to write global config file at ${getEthokoGlobalConfigPath().resolvedPath}. Please verify permissions or contact us if the problem persists.`,
        );
      }
    }
  } else {
    if (config.localConfigPath) {
      // If local config already exists, we update its content with the new project
      const existingLocalConfigContentResult = await toAsyncResult(
        fs
          .readFile(config.localConfigPath.resolvedPath, "utf-8")
          .then(JSON.parse),
      );
      if (!existingLocalConfigContentResult.success) {
        throw new CliError(
          `Local config file at ${config.localConfigPath.resolvedPath} can not be read or is not a valid JSON. Please fix it before adding a new project.`,
        );
      }
      const existingLocalConfigContent =
        existingLocalConfigContentResult.value as LocalEthokoConfigInput;
      const updatedLocalConfigContent: LocalEthokoConfigInput =
        existingLocalConfigContent;
      updatedLocalConfigContent.projects = updatedLocalConfigContent.projects
        ? [...updatedLocalConfigContent.projects, promptResult.project]
        : [promptResult.project];
      const updateLocalConfigResult = await toAsyncResult(
        fs.writeFile(
          config.localConfigPath.resolvedPath,
          JSON.stringify(updatedLocalConfigContent, null, 2) + "\n",
          "utf-8",
        ),
      );
      if (!updateLocalConfigResult.success) {
        throw new CliError(
          "Failed to update local config file with the new project. Please verify permissions or contact us if the problem persists.",
        );
      }
    } else {
      // If local config doesn't exist, we will create it in the next step with the new project and compilation output path if applicable
      const localConfigFilePath = new AbsolutePath(
        process.cwd(),
        "ethoko.config.json",
      );
      const content: LocalEthokoConfigInput = {
        projects: [promptResult.project],
      };
      const writeLocalConfigResult = await toAsyncResult(
        fs.writeFile(
          localConfigFilePath.resolvedPath,
          JSON.stringify(content, null, 2) + "\n",
          "utf-8",
        ),
      );
      if (!writeLocalConfigResult.success) {
        throw new CliError(
          `Failed to write local config file at ${localConfigFilePath.resolvedPath}. Please verify permissions or contact us if the problem persists.`,
        );
      }
    }
  }

  const projectLines = [];
  if (promptResult.scope === "global") {
    if (config.globalConfigPath) {
      projectLines.push(
        `Global config updated at ${config.globalConfigPath.resolvedPath}`,
      );
    } else {
      projectLines.push(
        `Global config created at ${getEthokoGlobalConfigPath().resolvedPath}`,
      );
    }
  } else {
    if (config.localConfigPath) {
      projectLines.push(
        `Local config updated at ${config.localConfigPath.resolvedPath}`,
      );
    } else {
      const localConfigFilePath = new AbsolutePath(
        process.cwd(),
        "ethoko.config.json",
      );
      projectLines.push(
        `Local config created at ${localConfigFilePath.resolvedPath}`,
      );
    }
  }

  projectLines.push(
    "",
    `New project: "${promptResult.project.name}" (${promptResult.scope})`,
    ` Storage type: ${promptResult.project.storage.type === "aws" ? "AWS S3" : "Filesystem"}`,
  );
  if (promptResult.project.storage.type === "aws") {
    projectLines.push(` AWS region: ${promptResult.project.storage.awsRegion}`);
    projectLines.push(
      ` S3 bucket: ${promptResult.project.storage.awsBucketName}`,
    );
    if (promptResult.project.storage.awsProfile) {
      projectLines.push(
        ` AWS profile: ${promptResult.project.storage.awsProfile}`,
      );
    } else if (promptResult.project.storage.awsAccessKeyId) {
      projectLines.push(
        ` AWS access key ID: ${promptResult.project.storage.awsAccessKeyId}`,
      );
      projectLines.push(` AWS secret access key: ****`);
      if (promptResult.project.storage.awsRoleArn) {
        projectLines.push(
          ` AWS role ARN: ${promptResult.project.storage.awsRoleArn}`,
        );
      }
    } else {
      projectLines.push(` Authentication: environment (default)`);
    }
  } else {
    projectLines.push(
      ` Storage path: ${promptResult.project.storage.path ?? (promptResult.scope === "global" ? "~/.ethoko/storage" : ".ethoko-storage (relative to project)")} `,
    );
  }
  projectLines.push("");

  logger.note(projectLines.join("\n"), "Project summary");
  logger.success("Project configured successfully!");

  return promptResult;
}

/**
 * Prompt the user to configure a new project, including storage type, scope (global or local), and related settings.
 *
 * Flow is as follows:
 * 1. Ask for project name with validation (non-empty, not already in use).
 * 2. Ask user to select storage type (AWS S3 or filesystem).
 * 3. Ask if project is global (saved to ~/.ethoko/config.json, recommended) or local (saved to ./ethoko.config.json).
 *  3.A. AWS S3 selected: use `promptAwsS3Config` to gather AWS-specific configuration details.
 *  3.B. Filesystem selected: ask for the storage path, with default value based on scope:
 *       global: "storage" (resolves to ~/.ethoko/storage), local: ".ethoko-storage" (relative to cwd).
 * @returns An object containing the scope, configured project, or a cancellation flag if the user cancels at any point.
 */
async function promptProject(
  logger: CommandLogger,
  config: EthokoCliConfig,
): Promise<
  | {
      cancelled: false;
      scope: "global" | "local";
      project: ProjectConfigInput;
    }
  | { cancelled: true }
> {
  const projectName = await logger.prompts.text({
    message: "Enter the name of your project:",
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Project name cannot be empty";
      }
      if (
        config.localProjectNames.has(value.trim()) ||
        config.globalProjectNames.has(value.trim())
      ) {
        return `Project name "${value.trim()}" is already in use`;
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

  // Scope selection
  const hints = {
    aws: {
      global:
        "Recommended as project will be accessible from any location on your machine",
      local: "Project will be accessible only from the directory",
    },
    filesystem: {
      global:
        "The project will be accessible from any location on your machine, most suited for personal projects",
      local:
        "The project will be local to the directory and can be committed to version control, most suited for collaborative projects",
    },
  };
  const scope = await logger.prompts.select({
    message: `Project "${projectName}" ~ Where should this project config be saved?`,
    options: [
      {
        value: "global",
        label: "Global (~/.ethoko/config.json)",
        hint: hints[storageType].global,
      },
      {
        value: "local",
        label: "Local (./ethoko.config.json)",
        hint: hints[storageType].local,
      },
    ],
  });

  if (logger.prompts.isCancel(scope)) {
    return { cancelled: true };
  }

  const resolvedScope = scope as "global" | "local";

  if (storageType === "aws") {
    const awsConfigResult = await promptAwsS3Config(logger, projectName);
    if (awsConfigResult.cancelled) {
      return { cancelled: true };
    }

    return {
      cancelled: false,
      scope: resolvedScope,
      project: {
        name: projectName,
        storage: awsConfigResult.storageConfig,
      },
    };
  }

  if (storageType === "filesystem") {
    const defaultPath =
      resolvedScope === "global" ? "storage" : ".ethoko-storage";
    const storagePath = await logger.prompts.text({
      message: `Project "${projectName}" ~ Choose a path for the artifacts store (default is ${defaultPath}):`,
      initialValue: defaultPath,
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
      scope: resolvedScope,
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
  | {
      cancelled: false;
      storageConfig: Extract<
        NonNullable<LocalEthokoConfigInput["projects"]>[number]["storage"],
        { type: "aws" }
      >;
    }
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

async function handleCompilationOutputPath(
  logger: CommandLogger,
  config: EthokoCliConfig,
): Promise<
  | { cancelled: false; compilationOutputPath: RelativePath | undefined }
  | { cancelled: true }
> {
  if (config.compilationOutputPath) {
    return { cancelled: false, compilationOutputPath: undefined };
  }
  const compilationOutputOptions = await deriveCompilationOutputPathsOptions();

  if (compilationOutputOptions.length === 0) {
    return { cancelled: false, compilationOutputPath: undefined };
  }

  let compilationOutputPath: RelativePath | undefined = undefined;

  const compilationOutputSelection = await logger.prompts.select({
    message: "Select the path where your compilation output are stored:",
    options: [
      ...compilationOutputOptions.map((option) => ({
        value: option.path,
        label: `${option.path.relativePath} (${option.label})`,
      })),
      {
        value: RelativePath.unsafeFrom("other"),
        label: "Other",
        hint: "Specify another path",
      },
      {
        value: RelativePath.unsafeFrom("skip"),
        label: "Skip",
        hint: "Skip specifying a path",
      },
    ],
  });

  if (logger.prompts.isCancel(compilationOutputSelection)) {
    return { cancelled: true };
  }

  if (compilationOutputSelection.relativePath === "skip") {
    logger.info("Skipping compilation output path configuration");
    return { cancelled: false, compilationOutputPath: undefined };
  }

  if (compilationOutputSelection.relativePath === "other") {
    const compilationOutputResult = await logger.prompts.text({
      message:
        "Input the path where your compilation output are stored (e.g. `./out` for Forge, `./artifacts` for Hardhat, use empty value to skip):",
      validate: (value) => {
        if (value && value.trim().length > 0) {
          try {
            RelativePath.unsafeFrom(value.trim());
            return undefined;
          } catch {
            return "Invalid relative path";
          }
        } else {
          return undefined; // Allow empty value
        }
      },
    });

    if (logger.prompts.isCancel(compilationOutputResult)) {
      return { cancelled: true };
    }

    compilationOutputPath =
      compilationOutputResult.trim().length > 0
        ? RelativePath.unsafeFrom(compilationOutputResult.trim())
        : undefined;
  }

  if (compilationOutputSelection.relativePath !== "other") {
    compilationOutputPath = compilationOutputSelection;
  }

  if (!compilationOutputPath) {
    logger.info("Skipping compilation output path configuration");
    return { cancelled: false, compilationOutputPath: undefined };
  }

  if (config.localConfigPath) {
    // If local config already exists, we update its content with the new compilation output path
    const existingLocalConfigContentResult = await toAsyncResult(
      fs
        .readFile(config.localConfigPath.resolvedPath, "utf-8")
        .then(JSON.parse),
    );
    if (!existingLocalConfigContentResult.success) {
      throw new CliError(
        `Local config file at ${config.localConfigPath.resolvedPath} can not be read or is not a valid JSON. Please fix it before adding a compilation output path.`,
      );
    }
    const existingLocalConfigContent =
      existingLocalConfigContentResult.value as LocalEthokoConfigInput;
    const updatedLocalConfigContent: LocalEthokoConfigInput =
      existingLocalConfigContent;
    updatedLocalConfigContent.compilationOutputPath =
      compilationOutputPath.relativePath;
    const updateLocalConfigResult = await toAsyncResult(
      fs.writeFile(
        config.localConfigPath.resolvedPath,
        JSON.stringify(updatedLocalConfigContent, null, 2) + "\n",
        "utf-8",
      ),
    );
    if (!updateLocalConfigResult.success) {
      throw new CliError(
        "Failed to update local config file with the compilation output path. Please verify permissions or contact us if the problem persists.",
      );
    }
    logger.info(
      `Local configuration updated with compilation output path ${compilationOutputPath.relativePath}`,
    );
  } else {
    // If local config doesn't exist, we will create it in the next step with the new compilation output path and project config if applicable
    const localConfigFilePath = new AbsolutePath(
      process.cwd(),
      "ethoko.config.json",
    );
    const content: LocalEthokoConfigInput = {
      compilationOutputPath: compilationOutputPath.relativePath,
    };
    const writeLocalConfigResult = await toAsyncResult(
      fs.writeFile(
        localConfigFilePath.resolvedPath,
        JSON.stringify(content, null, 2) + "\n",
        "utf-8",
      ),
    );
    if (!writeLocalConfigResult.success) {
      throw new CliError(
        `Failed to write local config file at ${localConfigFilePath.resolvedPath}. Please verify permissions or contact us if the problem persists.`,
      );
    }
    logger.info(
      `Local configuration created at ${localConfigFilePath.resolvedPath} with compilation output path ${compilationOutputPath.relativePath}`,
    );
  }

  return { cancelled: false, compilationOutputPath };
}

/**
 * Identify potential compilation output paths based on common project structures (e.g., Hardhat, Foundry)
 * For Hardhat, checks for hardhat.config.js/ts, package.json with hardhat dependency, or artifacts/ directory to suggest ./artifacts
 * For Foundry, checks for foundry.toml, lib/ or out/ directory to suggest ./out
 * @returns The list of suggested compilation output paths with labels for user selection
 */
async function deriveCompilationOutputPathsOptions(): Promise<
  { path: RelativePath; label: string }[]
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

  const options: { path: RelativePath; label: string }[] = [];

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
    options.push({
      path: RelativePath.unsafeFrom("./artifacts"),
      label: "Hardhat default output",
    });
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
    options.push({
      path: RelativePath.unsafeFrom("./out"),
      label: "Foundry default output",
    });
  }

  return options;
}

/**
 * Handle .gitignore updates for Ethoko-generated paths.
 * Checks for a .git directory to determine if this is a git repo, then adds the relevant paths to .gitignore.
 * @param logger Command logger instance
 * @param cwd Current working directory
 * @param typingsPath Path to the generated TypeScript typings (always added to .gitignore)
 * @param pulledArtifactsPath Path to pulled artifacts store (added only if relative)
 */
async function handleGitignore(
  logger: CommandLogger,
  cwd: AbsolutePath,
  typingsPath: AbsolutePath,
  pulledArtifactsPath: AbsolutePath | undefined,
): Promise<void> {
  const isInAGitRepo = await isInGitRepository(cwd);
  if (!isInAGitRepo) {
    return;
  }

  // Determine which paths are relevant (relative paths only)
  const pathsToAdd: { path: string; label: string }[] = [];
  if (typingsPath.isChildOf(cwd)) {
    pathsToAdd.push({
      path: typingsPath.relativeTo(cwd).relativePath,
      label: "TypeScript typings path",
    });
  }
  if (pulledArtifactsPath && pulledArtifactsPath.isChildOf(cwd)) {
    pathsToAdd.push({
      path: pulledArtifactsPath.relativeTo(cwd).relativePath,
      label: "pulled artifacts path",
    });
  }

  if (pathsToAdd.length === 0) {
    return; // No relevant paths to add to .gitignore
  }

  const gitignorePath = cwd.join(".gitignore");
  const gitignoreExists = await fs
    .stat(gitignorePath.resolvedPath)
    .then(() => true)
    .catch(() => false);

  if (gitignoreExists) {
    const content = await fs.readFile(gitignorePath.resolvedPath, "utf-8");
    const existingLines = content.split("\n").map((l) => l.trim());
    const missingPaths = pathsToAdd.filter(
      // We are quite soft on the check to avoid duplicates, we check if any existing line includes the path to add, which allows for some flexibility in how users may have already added it
      (p) => !existingLines.some((line) => line.includes(p.path)),
    );
    if (missingPaths.length > 0) {
      const addition =
        "\n# Ethoko\n" + missingPaths.map((p) => p.path).join("\n") + "\n";
      await fs.writeFile(
        gitignorePath.resolvedPath,
        content + addition,
        "utf-8",
      );
      logger.success(
        `Updated .gitignore with ${missingPaths.map((p) => p.label).join(" and ")}`,
      );
    }
  } else {
    const content =
      "# Ethoko\n" + pathsToAdd.map((p) => p.path).join("\n") + "\n";
    await fs.writeFile(gitignorePath.resolvedPath, content, "utf-8");
    logger.success(
      `Created .gitignore with ${pathsToAdd.map((p) => p.label).join(" and ")}`,
    );
  }
}

/**
 * Recursively checks if the given directory is part of a Git repository by looking for a .git folder in the current or parent directories.
 */
async function isInGitRepository(startDir: AbsolutePath): Promise<boolean> {
  let currentDir = startDir;
  while (true) {
    const candidate = currentDir.join(".git");
    const exists = await fs
      .stat(candidate.resolvedPath)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      return true;
    }

    if (isRootPath(currentDir)) {
      return false;
    }
    currentDir = currentDir.dirname();
  }
}

function isRootPath(currentPath: AbsolutePath): boolean {
  return currentPath.dirname().resolvedPath === currentPath.resolvedPath;
}
