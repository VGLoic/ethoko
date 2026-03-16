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
import { toAsyncResult } from "@/utils/result.js";
import { ArtifactKeySchema } from "./utils/parse-artifact-key.js";

type GetConfig = (configPath?: string) => Promise<EthokoCliConfig>;

export function registerPushCommand(
  program: Command,
  getConfig: GetConfig,
): void {
  program
    .command("push")
    .description("Upload compilation artifacts to storage")
    .argument(
      "<PROJECT[:TAG]>",
      "Target project and optional tag to associate with the pushed artifact",
    )
    .option("--artifact-path <path>", "Path to compilation artifacts")
    .option("--force", "Force push even if tag exists", false)
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
          if (artifactKey.artifact?.type === "id") {
            return z.NEVER;
          }
          return {
            project: artifactKey.project,
            tag: artifactKey.artifact?.tag,
          };
        },
      ).safeParse(projectArg);
      if (!artifactKeyParsingResult.success) {
        cliError(
          `Invalid artifact argument:\nThe artifact argument must be a string in the format PROJECT[:TAG]`,
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
          artifactPath: z
            .string('The "artifactPath" option must be a string')
            .min(
              1,
              'The "artifactPath" cannot be empty. Provide a valid path to compilation artifacts or set compilationOutputPath in ethoko.config.json',
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
        `Pushing artifact to "${artifactKeyParsingResult.data.project}"${artifactKeyParsingResult.data.tag ? ` with tag "${artifactKeyParsingResult.data.tag}"` : ""}`,
        optsParsingResult.data.silent,
      );

      const storageProvider = createStorageProvider(
        projectConfig.storage,
        optsParsingResult.data.debug,
      );

      await push(
        finalArtifactPath,
        artifactKeyParsingResult.data.project,
        artifactKeyParsingResult.data.tag,
        storageProvider,
        {
          force: optsParsingResult.data.force,
          debug: optsParsingResult.data.debug,
          isCI: process.env.CI === "true" || process.env.CI === "1",
          silent: optsParsingResult.data.silent,
        },
      )
        .then((result) =>
          displayPushResult(
            artifactKeyParsingResult.data.project,
            artifactKeyParsingResult.data.tag,
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
