import { styleText } from "node:util";
import { Command } from "commander";
import { z } from "zod";
import {
  boxHeader,
  boxSummary,
  error as cliError,
  LOG_COLORS,
  success,
} from "@/ui/index.js";
import { CliError, pull, PullResult } from "@/client/index.js";
import { PulledArtifactStore } from "@/pulled-artifact-store/pulled-artifact-store.js";

import type { EthokoCliConfig } from "../config/config.js";
import { createStorageProvider } from "./utils/storage-provider.js";
import { toAsyncResult } from "@/utils/result.js";
import { ArtifactKeySchema } from "./utils/parse-artifact-key.js";

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
      const configResult = await toAsyncResult(getConfig());
      if (!configResult.success) {
        cliError(
          configResult.error instanceof Error
            ? configResult.error.message
            : String(configResult.error),
        );
        process.exitCode = 1;
        return;
      }
      const config = configResult.value;

      const artifactKeyParsingResult = ArtifactKeySchema.transform(
        (artifactKey) => ({
          project: artifactKey.project,
          search: artifactKey.artifact,
        }),
      ).safeParse(projectArg);
      if (!artifactKeyParsingResult.success) {
        cliError(
          `Invalid artifact argument:\nThe artifact argument must be a string in the format PROJECT[:TAG|@ID]`,
        );
        process.exitCode = 1;
        return;
      }
      const projectConfig = config.getProjectConfig(
        artifactKeyParsingResult.data.project,
      );
      if (!projectConfig) {
        cliError(
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
          silent: z
            .boolean('The "silent" option must be a boolean')
            .default(false),
        })
        .safeParse(options);
      if (!optsParsingResult.success) {
        cliError(
          `Invalid command arguments:\n${z.prettifyError(optsParsingResult.error)}`,
        );
        process.exitCode = 1;
        return;
      }

      if (artifactKeyParsingResult.data.search) {
        boxHeader(
          `Pulling artifact "${artifactKeyParsingResult.data.project}:${artifactKeyParsingResult.data.search.type === "id" ? artifactKeyParsingResult.data.search.id : artifactKeyParsingResult.data.search.tag}"`,
          optsParsingResult.data.silent,
        );
      } else {
        boxHeader(
          `Pulling artifacts for "${artifactKeyParsingResult.data.project}"`,
          optsParsingResult.data.silent,
        );
      }

      const storageProvider = createStorageProvider(
        projectConfig.storage,
        optsParsingResult.data.debug,
      );
      const pulledArtifactStore = new PulledArtifactStore(
        config.pulledArtifactsPath,
      );
      await pull(
        artifactKeyParsingResult.data.project,
        artifactKeyParsingResult.data.search,
        storageProvider,
        pulledArtifactStore,
        {
          force: optsParsingResult.data.force,
          debug: optsParsingResult.data.debug,
          silent: optsParsingResult.data.silent,
        },
      )
        .then((result) =>
          displayPullResults(
            artifactKeyParsingResult.data.project,
            result,
            optsParsingResult.data.silent,
          ),
        )
        .catch((err) => {
          if (err instanceof CliError) {
            cliError(err.message);
          } else {
            cliError(
              "An unexpected error occurred, please fill an issue with the error details if the problem persists",
            );
            console.error(err);
          }
          process.exitCode = 1;
        });
    });
}

function displayPullResults(
  project: string,
  data: PullResult,
  silent = false,
): void {
  if (data.remoteTags.length === 0 && data.remoteIds.length === 0) {
    success("No artifacts to pull yet", silent);
  } else if (
    data.failedTags.length === 0 &&
    data.failedIds.length === 0 &&
    data.pulledTags.length === 0 &&
    data.pulledIds.length === 0
  ) {
    success(`You're up to date with project "${project}"`, silent);
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
      boxSummary("Summary", summaryLines, silent);
    }
  }
}
