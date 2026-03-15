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
import { LocalStorage } from "@/local-storage/local-storage.js";

import type { EthokoCliConfig } from "../config/config.js";
import { createStorageProvider } from "./utils/storage-provider.js";

type GetConfig = (configPath?: string) => Promise<EthokoCliConfig>;

export function registerPullCommand(
  program: Command,
  getConfig: GetConfig,
): void {
  program
    .command("pull")
    .description("Download artifacts from storage")
    .option("--id <id>", "Artifact ID")
    .option("--tag <tag>", "Artifact tag")
    .option("--project <project>", "Project name")
    .option("--force", "Overwrite existing local artifacts", false)
    .option("--debug", "Enable debug logging", false)
    .option("--silent", "Suppress output", false)
    .action(async (options) => {
      let config: EthokoCliConfig;
      try {
        config = await getConfig();
      } catch (err) {
        cliError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
        return;
      }

      const optsParsingResult = z
        .object({
          id: z.string().optional(),
          tag: z.string().optional(),
          project: z.string().optional().default(config.project),
          force: z.boolean().default(false),
          debug: z.boolean().default(config.debug),
          silent: z.boolean().default(false),
        })
        .safeParse(options);
      if (!optsParsingResult.success) {
        cliError("Invalid arguments");
        if (config.debug) {
          console.error(optsParsingResult.error);
        }
        process.exitCode = 1;
        return;
      }

      if (optsParsingResult.data.id && optsParsingResult.data.tag) {
        cliError("Use either --id or --tag, not both");
        process.exitCode = 1;
        return;
      }

      let search:
        | { type: "id"; id: string }
        | { type: "tag"; tag: string }
        | null = null;
      if (optsParsingResult.data.id) {
        search = { type: "id", id: optsParsingResult.data.id };
      } else if (optsParsingResult.data.tag) {
        search = { type: "tag", tag: optsParsingResult.data.tag };
      }

      if (search) {
        boxHeader(
          `Pulling artifact "${optsParsingResult.data.project}:${search.type === "id" ? search.id : search.tag}"`,
          optsParsingResult.data.silent,
        );
      } else {
        boxHeader(
          `Pulling artifacts for "${optsParsingResult.data.project}"`,
          optsParsingResult.data.silent,
        );
      }

      const storageProvider = createStorageProvider({
        ...config,
        debug: config.debug || optsParsingResult.data.debug,
      });
      const localStorage = new LocalStorage(config.pulledArtifactsPath);
      await pull(
        optsParsingResult.data.project,
        search,
        storageProvider,
        localStorage,
        {
          force: optsParsingResult.data.force,
          debug: config.debug || optsParsingResult.data.debug,
          silent: optsParsingResult.data.silent,
        },
      )
        .then((result) =>
          displayPullResults(
            optsParsingResult.data.project,
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
