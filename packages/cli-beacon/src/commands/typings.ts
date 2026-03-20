import { Command } from "commander";
import { z } from "zod";
import { CommandLogger } from "@/ui/index.js";
import {
  CliError,
  generateArtifactsSummariesAndTypings,
} from "@/client/index.js";
import { PulledArtifactStore } from "@/pulled-artifact-store/pulled-artifact-store.js";

import type { EthokoCliConfig } from "../config";
import { toAsyncResult } from "@/utils/result.js";

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

      const parsingResult = z
        .object({
          debug: z
            .boolean('The "debug" option must be a boolean')
            .default(config.debug),
        })
        .safeParse(options);

      if (!parsingResult.success) {
        logger.error(
          `Invalid command arguments:\n${z.prettifyError(parsingResult.error)}`,
        );
        process.exitCode = 1;
        return;
      }

      logger.intro("Generating typings");

      const pulledArtifactStore = new PulledArtifactStore(
        config.pulledArtifactsPath,
      );

      await generateArtifactsSummariesAndTypings(
        config.typingsPath,
        pulledArtifactStore,
        {
          debug: parsingResult.data.debug,
          silent: logger.silent,
        },
      )
        .then(() => {
          logger.success(`Typings generated at ${config.typingsPath}`);
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
