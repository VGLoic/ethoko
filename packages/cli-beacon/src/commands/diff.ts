import { styleText } from "node:util";
import { Command } from "commander";
import { z } from "zod";
import { CommandLogger, LOG_COLORS } from "@/ui";
import {
  CliError,
  Difference,
  generateDiffWithTargetRelease,
  resolveLocalArtifact,
  lookForBuildInfos,
  mapBuildInfoToEthokoArtifact,
  pullArtifact,
} from "@/client";
import { LocalArtifactStore } from "@/local-artifact-store";

import type { EthokoCliConfig } from "../config";
import { toAsyncResult } from "@/utils/result.js";
import { ProjectOrArtifactReferenceSchema } from "./utils/parse-project-or-artifact-ref.js";
import {
  AbsolutePath,
  generateAbsolutePathSchema,
  RelativePath,
} from "@/utils/path.js";
import { createStorageProvider } from "./utils/storage-provider";
import {
  EthokoContractOutputArtifact,
  EthokoInputArtifact,
} from "@/ethoko-artifacts/v0";
import { StorageProvider } from "@/storage-provider";
import { ArtifactReference } from "@/utils/artifact-reference";
import { BuildInfoPaths } from "@/supported-origins/map-build-info-to-ethoko-artifact";
import { promptUserSelection } from "./utils/prompt-select";

type GetConfig = (configPath?: string) => Promise<EthokoCliConfig>;

export function registerDiffCommand(
  program: Command,
  getConfig: GetConfig,
): void {
  program
    .command("diff")
    .description("Compare local artifacts with a pulled artifact")
    .argument(
      "<PROJECT[:TAG|@ID]>",
      "Target project and artifact identifier (tag or ID)",
    )
    .option("--artifact-path <path>", "Path to compilation artifacts")
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
        ProjectOrArtifactReferenceSchema.transform((artifactRef) => {
          if (artifactRef.type === "project") {
            return z.NEVER;
          }
          return artifactRef;
        }).safeParse(projectArg);
      if (!artifactRefParsingResult.success) {
        logger.error(
          `Invalid artifact argument:\nThe artifact argument must be a string in the format PROJECT[:TAG|@ID]`,
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
        `Comparing with artifact "${artifactRefParsingResult.data.project}:${
          artifactRefParsingResult.data.type === "id"
            ? artifactRefParsingResult.data.id
            : artifactRefParsingResult.data.tag
        }"`,
      );

      const paramParsingResult = z
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
          debug: z
            .boolean('The "debug" option must be a boolean')
            .default(config.debug),
        })
        .safeParse(options);
      if (!paramParsingResult.success) {
        logger.error(
          `Invalid command arguments:\n${z.prettifyError(paramParsingResult.error)}`,
        );
        process.exitCode = 1;
        return;
      }

      const finalArtifactPath =
        paramParsingResult.data.artifactPath || config.compilationOutputPath;

      if (!finalArtifactPath) {
        logger.error(
          "Artifact path is required. Provide --artifact-path or set compilationOutputPath in ethoko.config.json",
        );
        process.exitCode = 1;
        return;
      }

      await runDiffCommand(
        finalArtifactPath,
        artifactRefParsingResult.data,
        {
          logger,
          localArtifactStore: new LocalArtifactStore(
            config.localArtifactStorePath,
          ),
          storageProvider: createStorageProvider(
            projectConfig.storage,
            logger.toDebugLogger(),
            paramParsingResult.data.debug,
          ),
        },
        {
          debug: paramParsingResult.data.debug,
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

async function runDiffCommand(
  artifactPath: AbsolutePath,
  artifactRef: ArtifactReference,
  dependencies: {
    localArtifactStore: LocalArtifactStore;
    storageProvider: StorageProvider;
    logger: CommandLogger;
  },
  opts: {
    debug: boolean;
  },
): Promise<void> {
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

  let resolvedArtifactRef = await resolveLocalArtifact(
    artifactRef,
    dependencies.localArtifactStore,
    { debug: opts.debug },
  );
  if (!resolvedArtifactRef) {
    const artifactLabel = `${artifactRef.project}${
      artifactRef.type === "id" ? `@${artifactRef.id}` : `:${artifactRef.tag}`
    }`;
    const pullSpinner = dependencies.logger.createSpinner(
      `Artifact "${artifactLabel}" not found locally, pulling...`,
    );
    const pulledArtifact = await pullArtifact(
      artifactRef,
      {
        storageProvider: dependencies.storageProvider,
        localArtifactStore: dependencies.localArtifactStore,
        logger: dependencies.logger.toDebugLogger(),
      },
      {
        force: false,
        debug: opts.debug,
      },
    ).catch((err) => {
      pullSpinner.fail("Failed to pull artifact");
      throw err;
    });
    pullSpinner.succeed(`Artifact "${artifactLabel}" pulled successfully`);
    resolvedArtifactRef = {
      project: artifactRef.project,
      id: pulledArtifact.id,
      tag: artifactRef.type === "tag" ? "tag" : null,
    };
  }

  const diffResult = await generateDiffWithTargetRelease(
    resolvedArtifactRef,
    buildInfo,
    {
      localArtifactStore: dependencies.localArtifactStore,
      logger: dependencies.logger.toDebugLogger(),
    },
    { debug: opts.debug },
  );

  displayDifferences(dependencies.logger, diffResult);
}

function displayDifferences(
  logger: CommandLogger,
  differences: Difference[],
): void {
  if (differences.length === 0) {
    logger.success("No differences found");
    return;
  }

  const added = differences.filter((d) => d.status === "added");
  const removed = differences.filter((d) => d.status === "removed");
  const changed = differences.filter((d) => d.status === "changed");

  const summaryLines: string[] = [];

  if (changed.length > 0) {
    summaryLines.push(styleText(["bold", LOG_COLORS.warn], "Changed:"));
    changed.forEach((diff) => {
      summaryLines.push(
        styleText(LOG_COLORS.warn, `  • ${diff.name} (${diff.path})`),
      );
    });
  }

  if (added.length > 0) {
    if (summaryLines.length > 0) summaryLines.push("");
    summaryLines.push(styleText(["bold", LOG_COLORS.success], "Added:"));
    added.forEach((diff) => {
      summaryLines.push(
        styleText(LOG_COLORS.success, `  • ${diff.name} (${diff.path})`),
      );
    });
  }

  if (removed.length > 0) {
    if (summaryLines.length > 0) summaryLines.push("");
    summaryLines.push(styleText(["bold", LOG_COLORS.error], "Removed:"));
    removed.forEach((diff) => {
      summaryLines.push(
        styleText(LOG_COLORS.error, `  • ${diff.name} (${diff.path})`),
      );
    });
  }

  logger.note("Differences Found", summaryLines.join("\n"));
  logger.outro(undefined);
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
