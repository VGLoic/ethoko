import { Command } from "commander";
import { z } from "zod";
import {
  boxHeader,
  error as cliError,
  displayPushResult,
} from "@ethoko/core/cli-ui";
import { CliError, push } from "@ethoko/core/cli-client";

import type { EthokoCliConfig } from "../config.js";
import { createStorageProvider } from "../utils/storage-provider.js";

type GetConfig = (configPath?: string) => Promise<EthokoCliConfig>;

export function registerPushCommand(
  program: Command,
  getConfig: GetConfig,
): void {
  program
    .command("push")
    .description("Upload compilation artifacts to storage")
    .option("--artifact-path <path>", "Path to compilation artifacts")
    .option("--tag <tag>", "Tag to associate with artifacts")
    .option("--force", "Force push even if tag exists", false)
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
          artifactPath: z.string().min(1).optional(),
          tag: z.string().optional(),
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

      const finalArtifactPath =
        optsParsingResult.data.artifactPath || config.compilationOutputPath;

      if (!finalArtifactPath) {
        cliError(
          "Artifact path must be provided either via --artifact-path flag or compilationOutputPath in config",
        );
        process.exitCode = 1;
        return;
      }

      boxHeader(
        `Pushing artifact to "${config.project}"${optsParsingResult.data.tag ? ` with tag "${optsParsingResult.data.tag}"` : ""}`,
        optsParsingResult.data.silent,
      );

      const storageProvider = createStorageProvider({
        ...config,
        debug: config.debug || optsParsingResult.data.debug,
      });

      await push(
        finalArtifactPath,
        config.project,
        optsParsingResult.data.tag,
        storageProvider,
        {
          force: optsParsingResult.data.force,
          debug: config.debug || optsParsingResult.data.debug,
          isCI: process.env.CI === "true" || process.env.CI === "1",
          silent: optsParsingResult.data.silent,
        },
      )
        .then((result) =>
          displayPushResult(
            config.project,
            optsParsingResult.data.tag,
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
