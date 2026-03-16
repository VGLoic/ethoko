import { styleText } from "node:util";

import { Command } from "commander";
import { z } from "zod";
import { boxHeader, error as cliError, LOG_COLORS } from "@/ui/index.js";
import {
  CliError,
  generateArtifactsSummariesAndTypings,
} from "@/client/index.js";
import { PulledArtifactStore } from "@/pulled-artifact-store/pulled-artifact-store.js";

import type { EthokoCliConfig } from "../config/config.js";

type GetConfig = (configPath?: string) => Promise<EthokoCliConfig>;

export function registerTypingsCommand(
  program: Command,
  getConfig: GetConfig,
): void {
  program
    .command("typings")
    .description("Generate TypeScript typings")
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

      const parsingResult = z
        .object({
          debug: z
            .boolean('The "debug" option must be a boolean')
            .default(config.debug),
          silent: z
            .boolean('The "silent" option must be a boolean')
            .default(false),
        })
        .safeParse(options);

      if (!parsingResult.success) {
        cliError(
          `Invalid command arguments:\n${z.prettifyError(parsingResult.error)}`,
        );
        process.exitCode = 1;
        return;
      }

      boxHeader("Generating typings", parsingResult.data.silent);

      const pulledArtifactStore = new PulledArtifactStore(
        config.pulledArtifactsPath,
      );

      await generateArtifactsSummariesAndTypings(
        config.typingsPath,
        pulledArtifactStore,
        {
          debug: parsingResult.data.debug,
          silent: parsingResult.data.silent,
        },
      )
        .then(() => {
          if (!parsingResult.data.silent) {
            console.error(
              styleText(
                LOG_COLORS.success,
                `\n✔ Typings generated at ${config.typingsPath}`,
              ),
            );
          }
        })
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
