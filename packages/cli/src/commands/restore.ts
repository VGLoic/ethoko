import { Command } from "commander";
import { z } from "zod";
import {
  boxHeader,
  displayRestoreResult,
  error as cliError,
} from "@ethoko/core/cli-ui";
import { CliError, restore, type RestoreResult } from "@ethoko/core/cli-client";
import { LocalStorage } from "@ethoko/core/local-storage";

import type { EthokoCliConfig } from "../config.js";
import { createStorageProvider } from "../utils/storage-provider.js";

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
          "Missing output path. Provide --output or set pulledArtifactsPath in ethoko.json",
        );
        process.exitCode = 1;
        return;
      }

      const optsParsingResult = z
        .object({
          id: z.string().optional(),
          tag: z.string().optional(),
          project: z.string().optional().default(config.project),
          output: z.string().min(1).optional(),
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
        cliError("The ID and tag parameters can not be used together");
        process.exitCode = 1;
        return;
      }

      let search: { type: "id"; id: string } | { type: "tag"; tag: string };
      if (optsParsingResult.data.id) {
        search = { type: "id", id: optsParsingResult.data.id };
      } else if (optsParsingResult.data.tag) {
        search = { type: "tag", tag: optsParsingResult.data.tag };
      } else {
        cliError("The artifact must be identified by a tag or an ID");
        process.exitCode = 1;
        return;
      }

      boxHeader(
        `Restoring artifact "${optsParsingResult.data.project}:${search.type === "id" ? search.id : search.tag}"`,
        optsParsingResult.data.silent,
      );

      const storageProvider = createStorageProvider({
        ...config,
        debug: config.debug || optsParsingResult.data.debug,
      });
      const localStorage = new LocalStorage(config.pulledArtifactsPath);

      await restore(
        { project: optsParsingResult.data.project, search },
        optsParsingResult.data.output ?? config.pulledArtifactsPath,
        storageProvider,
        localStorage,
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
