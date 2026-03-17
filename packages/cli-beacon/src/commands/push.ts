import { Command } from "commander";
import { z } from "zod";
import { CommandLogger } from "@/ui/index.js";
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
        logger.error(
          `Invalid artifact argument:\nThe artifact argument must be a string in the format PROJECT[:TAG]`,
        );
        process.exitCode = 1;
        return;
      }
      const projectConfig = config.getProjectConfig(
        artifactKeyParsingResult.data.project,
      );
      if (!projectConfig) {
        logger.error(
          `Project "${artifactKeyParsingResult.data.project}" not found in configuration`,
        );
        process.exitCode = 1;
        return;
      }

      logger.intro(
        `Pushing artifact "${artifactKeyParsingResult.data.project}${artifactKeyParsingResult.data.tag ? `:${artifactKeyParsingResult.data.tag}"` : '"'}`,
      );

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
        })
        .safeParse(options);

      if (!optsParsingResult.success) {
        logger.error(
          `Invalid command arguments:\n${z.prettifyError(optsParsingResult.error)}`,
        );
        process.exitCode = 1;
        return;
      }

      const finalArtifactPath =
        optsParsingResult.data.artifactPath || config.compilationOutputPath;

      if (!finalArtifactPath) {
        logger.error(
          "Artifact path is required. Provide --artifact-path or set compilationOutputPath in ethoko.config.json",
        );
        process.exitCode = 1;
        return;
      }

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
          logger,
        },
      )
        .then((result) => {
          displayPushResult(
            logger,
            artifactKeyParsingResult.data.project,
            artifactKeyParsingResult.data.tag,
            result,
          );
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

function displayPushResult(
  logger: CommandLogger,
  project: string,
  tag: string | undefined,
  artifactId: string,
): void {
  if (tag) {
    logger.success(
      `Artifact "${project}:${tag}" (ID: ${artifactId}) pushed successfully`,
    );
  } else {
    logger.success(`Artifact "${project}@${artifactId}" pushed successfully`);
  }
}
