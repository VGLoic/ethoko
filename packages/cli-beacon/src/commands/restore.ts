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

type GetConfig = (configPath?: string) => Promise<EthokoCliConfig>;

export function registerRestoreCommand(
  program: Command,
  getConfig: GetConfig,
): void {
  program
    .command("restore")
    .description("Restore original artifacts from storage")
    .option("--id <id>", "Artifact ID")
    .option("--tag <tag>", "Artifact tag")
    .option("--project <project>", "Project name")
    .option("--output <path>", "Output directory")
    .option("--force", "Overwrite existing output directory", false)
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

      if (!options.output && !config.pulledArtifactsPath) {
        cliError(
          "Missing output path. Provide --output or set pulledArtifactsPath in ethoko.config.json",
        );
        process.exitCode = 1;
        return;
      }

      const optsParsingResult = z
        .object({
          id: z
            .string('The "id" option must be a string')
            .min(
              1,
              'If provided, the "id" cannot be empty. Provide a valid artifact ID.',
            )
            .optional(),
          tag: z
            .string('The "tag" option must be a string')
            .min(
              1,
              'If provided, the "tag" cannot be empty. Provide a valid tag name.',
            )
            .optional(),
          project: z
            .string('The "project" option must be a string')
            .min(1, 'The "project" cannot be empty')
            .optional()
            .default(config.project),
          output: z
            .string('The "output" option must be a string')
            .min(
              1,
              'If provided, the "output" cannot be empty. Provide a valid output directory path.',
            )
            .optional(),
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
        .transform((data, ctx) => {
          if (data.id && data.tag) {
            ctx.addIssue({
              code: "custom",
              message:
                "Provide either --id or --tag to identify the artifact, not both",
            });
            return z.NEVER;
          }
          let search:
            | { type: "id"; id: string }
            | { type: "tag"; tag: string }
            | null = null;
          if (data.id) {
            search = { type: "id", id: data.id };
          } else if (data.tag) {
            search = { type: "tag", tag: data.tag };
          }
          if (!search) {
            ctx.addIssue({
              code: "custom",
              message:
                "Either --id or --tag is required to identify the artifact. Example: --tag v1.0.0 or --id abc123def",
            });
            return z.NEVER;
          }
          return {
            project: data.project,
            output: data.output,
            force: data.force,
            debug: data.debug,
            silent: data.silent,
            search,
          };
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
        `Restoring artifact "${optsParsingResult.data.project}:${optsParsingResult.data.search.type === "id" ? optsParsingResult.data.search.id : optsParsingResult.data.search.tag}"`,
        optsParsingResult.data.silent,
      );

      const storageProvider = createStorageProvider({
        ...config,
        debug: config.debug || optsParsingResult.data.debug,
      });
      const pulledArtifactStore = new PulledArtifactStore(
        config.pulledArtifactsPath,
      );

      await restore(
        {
          project: optsParsingResult.data.project,
          search: optsParsingResult.data.search,
        },
        optsParsingResult.data.output ?? config.pulledArtifactsPath,
        storageProvider,
        pulledArtifactStore,
        {
          force: optsParsingResult.data.force,
          debug: config.debug || optsParsingResult.data.debug,
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
