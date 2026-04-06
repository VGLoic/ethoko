import { Command } from "commander";
import { z } from "zod";
import { CommandLogger } from "@/ui/index.js";
import {
  CliError,
  generateAllPulledArtifactsTypings,
  generateEmptyTypings,
  generateProjectTypings,
  generateTagTypings,
} from "@/client/index.js";
import { PulledArtifactStore } from "@/pulled-artifact-store/pulled-artifact-store.js";

import type { EthokoCliConfig } from "../config";
import { toAsyncResult } from "@/utils/result.js";
import { ProjectOrArtifactKeySchema } from "./utils/parse-project-or-artifact-key";
import { createStorageProvider } from "./utils/storage-provider";

type GetConfig = (configPath?: string) => Promise<EthokoCliConfig>;

export function registerTypingsCommand(
  program: Command,
  getConfig: GetConfig,
): void {
  program
    .command("typings")
    .description("Generate TypeScript typings")
    .argument("[PROJECT[:TAG]]", "Target project and optionally artifact tag")
    .option("--empty", "Generate empty typings without artifact details", false)
    .option(
      "--all",
      "Generate typings for all pulled artifacts (overrides PROJECT argument)",
      false,
    )
    .option("--debug", "Enable debug logging", false)
    .option("--silent", "Suppress output", false)
    .action(async (projectArg, options) => {
      console.log("################# PROJECT ARG:", projectArg);
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

      const projectOrArtifactKeyParsingResult =
        ProjectOrArtifactKeySchema.optional()
          .refine((projectOrArtifactKey) => projectOrArtifactKey?.type !== "id")
          .safeParse(projectArg);
      if (!projectOrArtifactKeyParsingResult.success) {
        logger.error(
          `Invalid artifact argument:\nThe artifact argument must be a string in the format PROJECT or PROJECT[:TAG]`,
        );
        process.exitCode = 1;
        return;
      }
      const projectOrArtifactKey = projectOrArtifactKeyParsingResult.data;
      if (projectOrArtifactKey) {
        const projectConfig = config.getProjectConfig(
          projectOrArtifactKey.project,
        );
        if (!projectConfig) {
          logger.error(
            `Project "${projectOrArtifactKey.project}" not found in configuration`,
          );
          process.exitCode = 1;
          return;
        }
      }

      const parsingResult = z
        .object({
          debug: z
            .boolean('The "debug" option must be a boolean')
            .default(config.debug),
          all: z.boolean('The "all" option must be a boolean').default(false),
          empty: z
            .boolean('The "empty" option must be a boolean')
            .default(false),
        })
        .superRefine((opts, ctx) => {
          // If artifact argument is provided, "all" and "empty" options cannot be used
          if (projectOrArtifactKey) {
            if (opts.all) {
              ctx.addIssue({
                code: "custom",
                message:
                  'The "all" option cannot be used when a specific artifact is targeted',
              });
            }
            if (opts.empty) {
              ctx.addIssue({
                code: "custom",
                message:
                  'The "empty" option cannot be used when a specific artifact is targeted',
              });
            }
          } else {
            // If no artifact argument is provided, either "all" or "empty" option must be used
            if (!opts.all && !opts.empty) {
              ctx.addIssue({
                code: "custom",
                message:
                  'Either "all" or "empty" option must be used when no specific artifact is targeted',
              });
            }
          }
        })
        .safeParse(options);

      if (!parsingResult.success) {
        logger.error(
          `Invalid command arguments:\n${z.prettifyError(parsingResult.error)}`,
        );
        process.exitCode = 1;
        return;
      }

      const pulledArtifactStore = new PulledArtifactStore(
        config.pulledArtifactsPath,
      );

      let promise: Promise<void>;
      if (parsingResult.data.empty) {
        logger.intro("Generating empty typings");
        promise = generateEmptyTypings(
          pulledArtifactStore,
          config.typingsPath,
          {
            debug: parsingResult.data.debug,
            logger,
          },
        );
      } else if (parsingResult.data.all) {
        logger.intro("Generating typings for all pulled artifacts");
        promise = generateAllPulledArtifactsTypings(
          config.typingsPath,
          pulledArtifactStore,
          {
            debug: parsingResult.data.debug,
            logger,
          },
        );
      } else if (projectOrArtifactKey) {
        const projectConfig = config.getProjectConfig(
          projectOrArtifactKey.project,
        );
        if (!projectConfig) {
          logger.error(
            `Project "${projectOrArtifactKey.project}" not found in configuration`,
          );
          process.exitCode = 1;
          return;
        }
        const storageProvider = createStorageProvider(
          projectConfig.storage,
          parsingResult.data.debug,
        );
        if (projectOrArtifactKey.type === "project") {
          logger.intro(
            `Generating typings for project "${projectOrArtifactKey.project}"`,
          );
          promise = generateProjectTypings(
            projectOrArtifactKey.project,
            storageProvider,
            pulledArtifactStore,
            config.typingsPath,
            {
              debug: parsingResult.data.debug,
              logger,
            },
          );
        } else if (projectOrArtifactKey.type === "tag") {
          logger.intro(
            `Generating typings for artifact "${projectOrArtifactKey.project}:${projectOrArtifactKey.tag}"`,
          );
          promise = generateTagTypings(
            projectOrArtifactKey.project,
            projectOrArtifactKey.tag,
            storageProvider,
            pulledArtifactStore,
            config.typingsPath,
            {
              debug: parsingResult.data.debug,
              logger,
            },
          );
        } else {
          logger.error(
            "Invalid command usage: artifact argument must be in the format PROJECT or PROJECT:TAG when targeting specific artifacts",
          );
          process.exitCode = 1;
          return;
        }
      } else {
        logger.error(
          'Invalid command usage: either "all" or "empty" option must be used when no specific artifact is targeted',
        );
        process.exitCode = 1;
        return;
      }

      await promise
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
