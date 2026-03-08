import { Command } from "commander";
import { z } from "zod";
import {
  boxHeader,
  displayListArtifactsResults,
  displayListArtifactsResultsJson,
  error as cliError,
} from "@ethoko/core/cli-ui";
import { CliError, listPulledArtifacts } from "@ethoko/core/cli-client";
import { LocalStorage } from "@ethoko/core/local-storage";

import type { EthokoCliConfig } from "../config.js";

type GetConfig = (configPath?: string) => Promise<EthokoCliConfig>;

export function registerArtifactsCommand(
  program: Command,
  getConfig: GetConfig,
): void {
  program
    .command("artifacts")
    .description("List pulled artifacts")
    .option("--json", "Output JSON", false)
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
          debug: z.boolean().default(config.debug),
          silent: z.boolean().default(false),
          json: z.boolean().default(false),
        })
        .safeParse(options);

      if (!parsingResult.success) {
        cliError("Invalid arguments");
        if (config.debug) {
          console.error(parsingResult.error);
        }
        process.exitCode = 1;
        return;
      }

      boxHeader("Listing artifacts", parsingResult.data.silent);

      const localStorage = new LocalStorage(config.pulledArtifactsPath);

      await listPulledArtifacts(localStorage, {
        debug: parsingResult.data.debug,
        silent: parsingResult.data.silent,
      })
        .then((result) => {
          if (parsingResult.data.json) {
            displayListArtifactsResultsJson(result, parsingResult.data.silent);
          } else {
            displayListArtifactsResults(result, parsingResult.data.silent);
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
