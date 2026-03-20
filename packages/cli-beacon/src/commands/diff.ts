import { styleText } from "node:util";
import { Command } from "commander";
import { z } from "zod";
import { CommandLogger, LOG_COLORS } from "@/ui/index.js";
import {
  CliError,
  Difference,
  generateDiffWithTargetRelease,
} from "@/client/index.js";
import { PulledArtifactStore } from "@/pulled-artifact-store/pulled-artifact-store.js";

import type { EthokoCliConfig } from "../config";
import { toAsyncResult } from "@/utils/result.js";
import { ArtifactKeySchema } from "./utils/parse-artifact-key.js";
import { AbsolutePath, generateAbsolutePathSchema } from "@/utils/path.js";

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

      const artifactKeyParsingResult = ArtifactKeySchema.transform(
        (artifactKey) => {
          if (!artifactKey.artifact) {
            return z.NEVER;
          }
          return {
            project: artifactKey.project,
            search: artifactKey.artifact,
          };
        },
      ).safeParse(projectArg);
      if (!artifactKeyParsingResult.success) {
        logger.error(
          `Invalid artifact argument:\nThe artifact argument must be a string in the format PROJECT[:TAG|@ID]`,
        );
        process.exitCode = 1;
        return;
      }
      const projectConfig = config.getProjectConfig(
        artifactKeyParsingResult.data.project,
      );
      if (!projectConfig) {
        logger.error(
          `Project "${artifactKeyParsingResult.data.project}" not found in configuration`,
        );
        process.exitCode = 1;
        return;
      }
      logger.intro(
        `Comparing with artifact "${artifactKeyParsingResult.data.project}:${
          artifactKeyParsingResult.data.search.type === "id"
            ? artifactKeyParsingResult.data.search.id
            : artifactKeyParsingResult.data.search.tag
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

      const pulledArtifactStore = new PulledArtifactStore(
        config.pulledArtifactsPath,
      );

      await generateDiffWithTargetRelease(
        finalArtifactPath,
        {
          project: artifactKeyParsingResult.data.project,
          search: artifactKeyParsingResult.data.search,
        },
        pulledArtifactStore,
        {
          debug: paramParsingResult.data.debug,
          isCI: process.env.CI === "true" || process.env.CI === "1",
          logger,
        },
      )
        .then((result) => {
          displayDifferences(logger, result);
        })
        .catch((err) => {
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

export function displayDifferences(
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
