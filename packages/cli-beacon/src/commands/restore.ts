import { styleText } from "node:util";
import { Command } from "commander";
import { z } from "zod";
import {
  boxHeader,
  error as cliError,
  LOG_COLORS,
  boxSummary,
  success,
} from "@/ui/index.js";
import { CliError, restore, type RestoreResult } from "@/client/index.js";
import { PulledArtifactStore } from "@/pulled-artifact-store/pulled-artifact-store.js";

import type { EthokoCliConfig } from "../config/config.js";
import { createStorageProvider } from "./utils/storage-provider.js";
import { toAsyncResult } from "@/utils/result.js";
import { ArtifactKeySchema } from "./utils/parse-artifact-key.js";

type GetConfig = (configPath?: string) => Promise<EthokoCliConfig>;

export function registerRestoreCommand(
  program: Command,
  getConfig: GetConfig,
): void {
  program
    .command("restore")
    .description("Restore original artifacts from storage")
    .argument(
      "<PROJECT[:TAG|@ID]>",
      "Target project and artifact identifier (tag or ID)",
    )
    .option("--output <path>", "Output directory")
    .option("--force", "Overwrite existing output directory", false)
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
          output: z
            .string('The "output" option must be a string')
            .min(
              1,
              'The "output" cannot be empty. Provide a valid output directory path.',
            ),
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

      boxHeader(
        `Restoring artifact "${artifactKeyParsingResult.data.project}:${artifactKeyParsingResult.data.search.type === "id" ? artifactKeyParsingResult.data.search.id : artifactKeyParsingResult.data.search.tag}"`,
        optsParsingResult.data.silent,
      );

      const storageProvider = createStorageProvider(
        projectConfig.storage,
        optsParsingResult.data.debug,
      );

      const pulledArtifactStore = new PulledArtifactStore(
        config.pulledArtifactsPath,
      );

      await restore(
        {
          project: artifactKeyParsingResult.data.project,
          search: artifactKeyParsingResult.data.search,
        },
        optsParsingResult.data.output,
        storageProvider,
        pulledArtifactStore,
        {
          force: optsParsingResult.data.force,
          debug: optsParsingResult.data.debug,
          silent: optsParsingResult.data.silent,
        },
      )
        .then((result: RestoreResult) =>
          displayRestoreResult(result, optsParsingResult.data.silent),
        )
        .catch((err: unknown) => {
          if (err instanceof CliError) {
            cliError(err.message);
          } else {
            cliError(
              "An unexpected error occurred, please fill an issue with the error details if the problem persists",
            );
            if (err instanceof Error) {
              console.error(err);
            }
          }
          process.exitCode = 1;
        });
    });
}

function displayRestoreResult(result: RestoreResult, silent = false): void {
  if (silent) return;

  console.error("");
  success(
    `Restored ${result.filesRestored.length} file${result.filesRestored.length > 1 ? "s" : ""} to ${result.outputPath}`,
    silent,
  );

  const summaryLines = result.filesRestored.map((file) =>
    styleText(LOG_COLORS.log, `  • ${file}`),
  );
  if (summaryLines.length > 0) {
    boxSummary("Restored Files", summaryLines, silent);
  }
}
