import { Command } from "commander";
import { z } from "zod";
import { CommandLogger } from "@/ui/index.js";
import {
  CliError,
  generateAllPulledArtifactsTypings,
  generateEmptyTypings,
  generateProjectTypings,
  generateTagTypings,
  pullArtifact,
  pullProject,
} from "@/client/index.js";
import { LocalArtifactStore } from "@/local-artifact-store";

import type { EthokoCliConfig } from "../config";
import { toAsyncResult } from "@/utils/result.js";
import { ProjectOrArtifactKeySchema } from "./utils/parse-project-or-artifact-key";
import { createStorageProvider } from "./utils/storage-provider";
import { StorageProvider } from "@/storage-provider";
import { AbsolutePath } from "@/utils/path";

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

      const localArtifactStore = new LocalArtifactStore(
        config.localArtifactStorePath,
      );

      let promise: Promise<void>;
      if (parsingResult.data.empty) {
        logger.intro("Generating empty typings");
        promise = generateEmptyTypings(config.typingsPath, localArtifactStore, {
          debug: parsingResult.data.debug,
        });
      } else if (parsingResult.data.all) {
        logger.intro("Generating typings for all pulled artifacts");
        promise = generateAllPulledArtifactsTypings(
          config.typingsPath,
          {
            localArtifactStore,
            logger: logger.toDebugLogger(),
          },
          { debug: parsingResult.data.debug },
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
          logger.toDebugLogger(),
          parsingResult.data.debug,
        );
        if (projectOrArtifactKey.type === "project") {
          logger.intro(
            `Generating typings for project "${projectOrArtifactKey.project}"`,
          );
          promise = runProjectTypingsCommand(
            projectOrArtifactKey.project,
            config.typingsPath,
            {
              storageProvider,
              localArtifactStore,
              logger,
            },
            { debug: parsingResult.data.debug },
          );
        } else if (projectOrArtifactKey.type === "tag") {
          logger.intro(
            `Generating typings for artifact "${projectOrArtifactKey.project}:${projectOrArtifactKey.tag}"`,
          );
          promise = runTagTypingsCommand(
            projectOrArtifactKey.project,
            projectOrArtifactKey.tag,
            config.typingsPath,
            {
              storageProvider,
              localArtifactStore,
              logger,
            },
            { debug: parsingResult.data.debug },
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

async function runProjectTypingsCommand(
  project: string,
  typingsPath: AbsolutePath,
  dependencies: {
    storageProvider: StorageProvider;
    localArtifactStore: LocalArtifactStore;
    logger: CommandLogger;
  },
  opts: { debug: boolean },
): Promise<void> {
  const debugLogger = dependencies.logger.toDebugLogger();
  const hasProjectResult = await toAsyncResult(
    dependencies.localArtifactStore
      .listProjects()
      .then((projects) => projects.includes(project)),
    opts,
  );
  if (!hasProjectResult.success) {
    throw new CliError(
      `Error checking the existence of the project "${project}". Is the script not allowed to read from the filesystem? Run with debug mode for more info`,
    );
  }
  if (!hasProjectResult.value) {
    const pullSpinner = dependencies.logger.createSpinner(
      `Project "${project}" not found locally, pulling...`,
    );
    await pullProject(
      project,
      {
        storageProvider: dependencies.storageProvider,
        localArtifactStore: dependencies.localArtifactStore,
        logger: debugLogger,
      },
      {
        force: false,
        debug: opts.debug,
      },
    ).catch((err) => {
      pullSpinner.fail("Failed to pull project");
      throw err;
    });
    pullSpinner.succeed(`Project "${project}" pulled successfully`);
  }
  await generateProjectTypings(
    project,
    typingsPath,
    {
      storageProvider: dependencies.storageProvider,
      localArtifactStore: dependencies.localArtifactStore,
      logger: debugLogger,
    },
    opts,
  );
}

async function runTagTypingsCommand(
  project: string,
  tag: string,
  typingsPath: AbsolutePath,
  dependencies: {
    storageProvider: StorageProvider;
    localArtifactStore: LocalArtifactStore;
    logger: CommandLogger;
  },
  opts: { debug: boolean },
): Promise<void> {
  const debugLogger = dependencies.logger.toDebugLogger();
  const hasTagResult = await toAsyncResult(
    dependencies.localArtifactStore.hasTag(project, tag),
    { debug: opts.debug },
  );
  if (!hasTagResult.success) {
    throw new CliError(
      `Error checking the existence of the tag "${tag}" for project "${project}". Is the script not allowed to read from the filesystem? Run with debug mode for more info`,
    );
  }
  if (!hasTagResult.value) {
    const pullSpinner = dependencies.logger.createSpinner(
      `Artifact "${project}:${tag}" not found locally, pulling...`,
    );
    await pullArtifact(
      { project, type: "tag", tag },
      {
        storageProvider: dependencies.storageProvider,
        localArtifactStore: dependencies.localArtifactStore,
        logger: debugLogger,
      },
      { force: false, debug: opts.debug },
    ).catch((err) => {
      pullSpinner.fail("Failed to pull artifact");
      throw err;
    });
    pullSpinner.succeed(`Artifact "${project}:${tag}" pulled successfully`);
  }
  await generateTagTypings(
    project,
    tag,
    typingsPath,
    {
      storageProvider: dependencies.storageProvider,
      localArtifactStore: dependencies.localArtifactStore,
      logger: debugLogger,
    },
    opts,
  );
}
