import { styleText } from "node:util";
import { Command } from "commander";
import { z } from "zod";
import {
  boxHeader,
  error as cliError,
  LOG_COLORS,
  success,
} from "@/ui/index.js";
import { CliError, push } from "@/client/index.js";

import type { EthokoCliConfig } from "../config/config.js";
import { createStorageProvider } from "./utils/storage-provider.js";

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
          artifactPath: z
            .string('The "artifactPath" option must be a string')
            .min(
              1,
              'The "artifactPath" cannot be empty. Provide a valid path to compilation artifacts or set compilationOutputPath in ethoko.config.json',
            )
            .optional(),
          tag: z
            .string('The "tag" option must be a string')
            .min(
              1,
              'If provided, the "tag" cannot be empty. Provide a meaningful tag like "v1.0.0" or "latest"',
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
        .safeParse(options);

      if (!optsParsingResult.success) {
        cliError(
          `Invalid command arguments:\n${z.prettifyError(optsParsingResult.error)}`,
        );
        process.exitCode = 1;
        return;
      }

      const finalArtifactPath =
        optsParsingResult.data.artifactPath || config.compilationOutputPath;

      if (!finalArtifactPath) {
        cliError(
          "Artifact path is required. Provide --artifact-path or set compilationOutputPath in ethoko.config.json",
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

function displayPushResult(
  project: string,
  tag: string | undefined,
  artifactId: string,
  silent = false,
): void {
  if (silent) return;
  console.error("");
  success(`Artifact "${project}:${tag || artifactId}" pushed successfully`);
  console.error(styleText(LOG_COLORS.log, `  ID: ${artifactId}`));
  console.error("");
}
