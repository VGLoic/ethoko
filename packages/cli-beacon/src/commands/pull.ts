import { styleText } from "node:util";
import { Command } from "commander";
import { z } from "zod";
import { CommandLogger, LOG_COLORS } from "@/ui/index.js";
import {
  CliError,
  pullProject,
  pullArtifact,
  PullResult,
} from "@/client/index.js";
import { PulledArtifactStore } from "@/pulled-artifact-store/pulled-artifact-store.js";

import type { EthokoCliConfig } from "../config";
import { createStorageProvider } from "./utils/storage-provider.js";
import { toAsyncResult } from "@/utils/result.js";
import { ProjectOrArtifactKeySchema } from "./utils/parse-project-or-artifact-key.js";

type GetConfig = (configPath?: string) => Promise<EthokoCliConfig>;

export function registerPullCommand(
  program: Command,
  getConfig: GetConfig,
): void {
  program
    .command("pull")
    .description("Download artifacts from storage")
    .argument(
      "<PROJECT[:TAG|@ID]>",
      "Target project and optionally artifact tag or ID",
    )
    .option("--force", "Overwrite existing local artifacts", false)
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

      const artifactKeyParsingResult =
        ProjectOrArtifactKeySchema.safeParse(projectArg);
      if (!artifactKeyParsingResult.success) {
        logger.error(
          `Invalid artifact argument:\nThe artifact argument must be a string in the format PROJECT or PROJECT[:TAG|@ID]`,
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

      const optsParsingResult = z
        .object({
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

      const storageProvider = createStorageProvider(
        projectConfig.storage,
        optsParsingResult.data.debug,
      );
      const pulledArtifactStore = new PulledArtifactStore(
        config.pulledArtifactsPath,
      );

      let pullPromise: Promise<PullResult>;
      if (artifactKeyParsingResult.data.type === "tag") {
        logger.intro(
          `Pulling artifact "${artifactKeyParsingResult.data.project}:${artifactKeyParsingResult.data.tag}"`,
        );
        pullPromise = pullArtifact(
          artifactKeyParsingResult.data,
          storageProvider,
          pulledArtifactStore,
          {
            force: optsParsingResult.data.force,
            debug: optsParsingResult.data.debug,
            logger,
          },
        );
      } else if (artifactKeyParsingResult.data.type === "id") {
        logger.intro(
          `Pulling artifact "${artifactKeyParsingResult.data.project}@${artifactKeyParsingResult.data.id}"`,
        );
        pullPromise = pullArtifact(
          artifactKeyParsingResult.data,
          storageProvider,
          pulledArtifactStore,
          {
            force: optsParsingResult.data.force,
            debug: optsParsingResult.data.debug,
            logger,
          },
        );
      } else if (artifactKeyParsingResult.data.type === "project") {
        logger.intro(
          `Pulling artifacts for project "${artifactKeyParsingResult.data.project}"`,
        );
        pullPromise = pullProject(
          artifactKeyParsingResult.data.project,
          storageProvider,
          pulledArtifactStore,
          {
            force: optsParsingResult.data.force,
            debug: optsParsingResult.data.debug,
            logger,
          },
        );
      } else {
        logger.error(
          `Unknown artifact key type: ${artifactKeyParsingResult.data satisfies never}`,
        );
        process.exitCode = 1;
        return;
      }

      await pullPromise
        .then((result) => {
          displayPullResults(
            logger,
            artifactKeyParsingResult.data.project,
            result,
          );
        })
        .catch((err) => {
          if (err instanceof CliError) {
            logger.error(err.message);
          } else {
            logger.error(
              "An unexpected error occurred, please fill an issue with the error details if the problem persists",
            );
            logger.error(err);
          }
          process.exitCode = 1;
        });
    });
}

function displayPullResults(
  logger: CommandLogger,
  project: string,
  data: PullResult,
): void {
  if (data.remoteTags.length === 0 && data.remoteIds.length === 0) {
    logger.success("No artifacts to pull yet");
  } else if (
    data.failedTags.length === 0 &&
    data.failedIds.length === 0 &&
    data.pulledTags.length === 0 &&
    data.pulledIds.length === 0
  ) {
    logger.success(`You're up to date with project "${project}"`);
  } else {
    const summaryLines: string[] = [];

    if (data.pulledTags.length > 0) {
      summaryLines.push(
        styleText(["bold", LOG_COLORS.success], "✔ Pulled Tags:"),
      );
      data.pulledTags.forEach((tag) => {
        summaryLines.push(styleText(LOG_COLORS.success, `  • ${tag}`));
      });
    }
    if (data.pulledIds.length > 0) {
      if (summaryLines.length > 0) summaryLines.push("");
      summaryLines.push(
        styleText(["bold", LOG_COLORS.success], "✔ Pulled IDs:"),
      );
      data.pulledIds.forEach((id) => {
        summaryLines.push(styleText(LOG_COLORS.success, `  • ${id}`));
      });
    }
    if (data.failedTags.length > 0) {
      if (summaryLines.length > 0) summaryLines.push("");
      summaryLines.push(
        styleText(["bold", LOG_COLORS.error], "✖ Failed Tags:"),
      );
      data.failedTags.forEach((tag) => {
        summaryLines.push(styleText(LOG_COLORS.error, `  • ${tag}`));
      });
    }
    if (data.failedIds.length > 0) {
      if (summaryLines.length > 0) summaryLines.push("");
      summaryLines.push(styleText(["bold", LOG_COLORS.error], "✖ Failed IDs:"));
      data.failedIds.forEach((id) => {
        summaryLines.push(styleText(LOG_COLORS.error, `  • ${id}`));
      });
    }

    if (summaryLines.length > 0) {
      logger.note(summaryLines.join("\n"), "Summary");
      logger.outro(undefined);
    }
  }
}
