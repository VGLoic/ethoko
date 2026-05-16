import { Command } from "commander";
import { z } from "zod";
import { CommandLogger } from "@/ui";
import {
  CliError,
  lookForBuildInfos,
  mapBuildInfoToEthokoArtifact,
} from "@/client";

import type { EthokoCliConfig } from "@/config";
import { toAsyncResult } from "@/utils/result";
import {
  generateAbsolutePathSchema,
  AbsolutePath,
  RelativePath,
} from "@/utils/path";
import { createStorageProvider } from "./utils/storage-provider";
import { ProjectOrArtifactReferenceSchema } from "./utils/parse-project-or-artifact-ref";
import {
  EthokoContractOutputArtifact,
  EthokoInputArtifact,
} from "@/ethoko-artifacts/v0";
import { StorageProvider } from "@/storage-provider";
import { BuildInfoPaths } from "@/supported-origins/map-build-info-to-ethoko-artifact";
import { promptUserSelection } from "./utils/prompt-select";

type GetConfig = (configPath?: string) => Promise<EthokoCliConfig>;

export function registerPushCommand(
  program: Command,
  getConfig: GetConfig,
): void {
  program
    .command("push")
    .description("Upload compilation artifacts to storage")
    .argument(
      "<PROJECT[:TAG]>",
      "Target project and optional tag to associate with the pushed artifact",
    )
    .option("--artifact-path <path>", "Path to compilation artifacts")
    .option("--force", "Force push even if tag exists", false)
    .option("--debug", "Enable debug logging", false)
    .option("--silent", "Suppress output", false)
    .action(async (projectArg, options) => {
      const logger = new CommandLogger(options.silent);

      const configResult = await toAsyncResult(getConfig());
      if (!configResult.success) {
        logger.error(
          configResult.error instanceof Error
            ? configResult.error.message
            : String(configResult.error),
        );
        process.exitCode = 1;
        return;
      }
      const config = configResult.value;

      const artifactRefParsingResult =
        ProjectOrArtifactReferenceSchema.transform((projectOrArtifactRef) => {
          if (projectOrArtifactRef.type === "id") {
            return z.NEVER;
          }
          if (projectOrArtifactRef.type === "project") {
            return {
              project: projectOrArtifactRef.project,
              tag: undefined,
            };
          }
          return {
            project: projectOrArtifactRef.project,
            tag: projectOrArtifactRef.tag,
          };
        }).safeParse(projectArg);
      if (!artifactRefParsingResult.success) {
        logger.error(
          `Invalid artifact argument:\nThe artifact argument must be a string in the format PROJECT[:TAG]`,
        );
        process.exitCode = 1;
        return;
      }
      const projectConfig = config.getProjectConfig(
        artifactRefParsingResult.data.project,
      );
      if (!projectConfig) {
        logger.error(
          `Project "${artifactRefParsingResult.data.project}" not found in configuration`,
        );
        process.exitCode = 1;
        return;
      }

      logger.intro(
        `Pushing artifact "${artifactRefParsingResult.data.project}${artifactRefParsingResult.data.tag ? `:${artifactRefParsingResult.data.tag}"` : '"'}`,
      );

      const optsParsingResult = z
        .object({
          artifactPath: z
            .string('The "artifactPath" option must be a string')
            .min(
              1,
              'The "artifactPath" cannot be empty. Provide a valid path to compilation artifacts or set compilationOutputPath in ethoko.config.json',
            )
            .pipe(
              generateAbsolutePathSchema(() => new AbsolutePath(process.cwd())),
            )
            .optional(),
          force: z
            .boolean('The "force" option must be a boolean')
            .default(false),
          debug: z
            .boolean('The "debug" option must be a boolean')
            .default(config.debug),
        })
        .safeParse(options);

      if (!optsParsingResult.success) {
        logger.error(
          `Invalid command arguments:\n${z.prettifyError(optsParsingResult.error)}`,
        );
        process.exitCode = 1;
        return;
      }

      const finalArtifactPath =
        optsParsingResult.data.artifactPath || config.compilationOutputPath;

      if (!finalArtifactPath) {
        logger.error(
          "Artifact path is required. Provide --artifact-path or set compilationOutputPath in ethoko.config.json",
        );
        process.exitCode = 1;
        return;
      }

      await runPushCommand(
        finalArtifactPath,
        {
          project: artifactRefParsingResult.data.project,
          tag: artifactRefParsingResult.data.tag,
        },
        {
          storageProvider: createStorageProvider(
            projectConfig.storage,
            logger.toDebugLogger(),
            optsParsingResult.data.debug,
          ),
          logger,
        },
        {
          force: optsParsingResult.data.force,
          debug: optsParsingResult.data.debug,
        },
      ).catch((err) => {
        if (err instanceof CliError) {
          logger.error(err.message);
        } else {
          logger.error(
            "An unexpected error occurred, please fill an issue with the error details if the problem persists",
          );
          console.error(err);
        }
        process.exitCode = 1;
      });
    });
}

export async function runPushCommand(
  artifactPath: AbsolutePath,
  artifact: {
    project: string;
    tag: string | undefined;
  },
  dependencies: {
    storageProvider: StorageProvider;
    logger: CommandLogger;
  },
  opts: {
    force: boolean;
    debug: boolean;
  },
): Promise<string> {
  const spinner1 = dependencies.logger.createSpinner(
    "Looking for compilation artifacts...",
  );
  const buildInfo = await parseBuildInfo(artifactPath, {
    debug: opts.debug,
    logger: dependencies.logger,
    isCI: process.env.CI === "true" || process.env.CI === "1",
  }).catch((err) => {
    spinner1.fail("Fail to parse compilation artifacts");
    throw err;
  });
  spinner1.succeed(
    artifactOriginToSuccessText(buildInfo.inputArtifact.origin.type),
  );

  // We verify that the input sources contain the `content` field.
  // It is not required for Ethoko but may ensure an easy verification later on.
  const missingContentInSource = Object.values(
    buildInfo.inputArtifact.input.sources,
  ).some((source) => !("content" in source));
  if (missingContentInSource) {
    // For Forge, we encourage users to use the `--use-literal-content` option to ensure the content is included in the artifact, which can help with later verification and debugging
    if (
      buildInfo.inputArtifact.origin.type ===
        "forge-v1-with-build-info-option" ||
      buildInfo.inputArtifact.origin.type === "forge-v1-default"
    ) {
      dependencies.logger.warn(
        `The provided Forge compilation artifacts do not include the literal content of the sources. We recommend using the "--use-literal-content" option when generating the build info files with Forge to include the content in the artifact, which can help with later verification and debugging.`,
      );
    } else {
      dependencies.logger.warn(
        `The provided compilation artifact does not include the literal content of the sources. This may make later verification and debugging more difficult. If possible, please provide artifacts that include the source content.`,
      );
    }
  }

  const tagExistenceSpinner = dependencies.logger.createSpinner(
    "Checking if tag exists...",
  );
  if (!artifact.tag) {
    tagExistenceSpinner.succeed(
      "No tag provided, skipping tag existence check",
    );
  } else {
    const hasTagResult = await toAsyncResult(
      dependencies.storageProvider.hasArtifactByTag(
        artifact.project,
        artifact.tag,
      ),
      { debug: opts.debug },
    );
    if (!hasTagResult.success) {
      tagExistenceSpinner.fail("Failed to check tag existence");
      throw new CliError(
        `Error checking if the tag "${artifact.tag}" exists on the storage, please check the storage configuration or run with debug mode for more info`,
      );
    }
    if (hasTagResult.value) {
      if (!opts.force) {
        tagExistenceSpinner.fail("Tag already exists");
        throw new CliError(
          `The tag "${artifact.tag}" already exists on the storage. Please, make sure to use a different tag.`,
        );
      } else {
        tagExistenceSpinner.warn(
          `Tag "${artifact.tag}" already exists, forcing push`,
        );
      }
    } else {
      tagExistenceSpinner.succeed("Tag is available");
    }
  }

  const uploadSpinner = dependencies.logger.createSpinner(
    "Uploading artifact...",
  );
  const pushResult = await toAsyncResult(
    dependencies.storageProvider.uploadArtifact(
      artifact.project,
      buildInfo.inputArtifact,
      buildInfo.outputContractArtifacts,
      artifact.tag,
      buildInfo.originalContent,
    ),
    { debug: opts.debug },
  );

  if (!pushResult.success) {
    uploadSpinner.fail("Failed to upload artifact");
    throw new CliError(
      `Error pushing the artifact "${artifact.project}${artifact.tag ? `:${artifact.tag}` : `@:${buildInfo.inputArtifact.id}`}" to the storage, please check the storage configuration or run with debug mode for more info`,
    );
  }
  uploadSpinner.succeed("Artifact uploaded successfully");

  displayPushResult(
    dependencies.logger,
    artifact.project,
    artifact.tag,
    buildInfo.inputArtifact.id,
  );

  return buildInfo.inputArtifact.id;
}

function displayPushResult(
  logger: CommandLogger,
  project: string,
  tag: string | undefined,
  artifactId: string,
): void {
  if (tag) {
    logger.success(
      `Artifact "${project}:${tag}" (ID: ${artifactId}) pushed successfully`,
    );
  } else {
    logger.success(`Artifact "${project}@${artifactId}" pushed successfully`);
  }
}

function artifactOriginToSuccessText(
  origin: EthokoInputArtifact["origin"]["type"],
): string {
  if (origin === "hardhat-v3") {
    return `Hardhat v3 compilation artifact found`;
  }
  if (origin === "hardhat-v3-non-isolated-build") {
    return `Hardhat v3 compilation artifact found (non isolated build)`;
  }
  if (origin === "hardhat-v2") {
    return `Hardhat v2 compilation artifact found`;
  }
  if (
    origin === "forge-v1-default" ||
    origin === "forge-v1-with-build-info-option"
  ) {
    return `Forge compilation artifact found`;
  }
  throw new CliError(
    `Unsupported build info format: ${origin satisfies never}`,
  );
}

async function parseBuildInfo(
  artifactPath: AbsolutePath,
  opts: { debug: boolean; logger: CommandLogger; isCI?: boolean },
): Promise<{
  inputArtifact: EthokoInputArtifact;
  outputContractArtifacts: EthokoContractOutputArtifact[];
  originalContent: {
    rootPath: AbsolutePath;
    paths: RelativePath[];
  };
}> {
  const buildInfos = await lookForBuildInfos(
    artifactPath,
    {
      logger: opts.logger.toDebugLogger(),
    },
    {
      debug: opts.debug,
    },
  );

  let selectedBuildInfoPaths: BuildInfoPaths;
  if (buildInfos.buildInfos.type === "single") {
    selectedBuildInfoPaths = buildInfos.buildInfos.buildInfoPaths;
  } else {
    if (opts.isCI) {
      throw new CliError(
        "Multiple Build Info files were found in the provided path. Please provide a more specific path or run the command in interactive mode to select the desired Build Info.",
      );
    }
    const selectedOption = await promptUserSelection(
      opts.logger,
      `Multiple JSON files found in "${buildInfos.finalFolderPath}" (${buildInfos.ignoredFilesCount} ignored). Please select which Build Info file to use:`,
      buildInfos.buildInfos.options,
      30_000,
    );
    selectedBuildInfoPaths = selectedOption;
  }

  const ethokoArtifact = await mapBuildInfoToEthokoArtifact(
    selectedBuildInfoPaths,
    { logger: opts.logger.toDebugLogger() },
    { debug: opts.debug },
  );

  return ethokoArtifact;
}
