import { styleText } from "node:util";
import { Command } from "commander";
import { z } from "zod";
import { LOG_COLORS, CommandLogger } from "@/ui/index.js";
import {
  CliError,
  pullArtifact,
  resolvePulledArtifact,
  restore,
  type RestoreResult,
} from "@/client/index.js";
import { LocalArtifactStore } from "@/local-artifact-store";

import type { EthokoCliConfig } from "../config";
import { createStorageProvider } from "./utils/storage-provider.js";
import { toAsyncResult } from "@/utils/result.js";
import { ProjectOrArtifactKeySchema } from "./utils/parse-project-or-artifact-key.js";
import { generateAbsolutePathSchema, AbsolutePath } from "@/utils/path.js";
import { ArtifactKey } from "@/utils/artifact-key";
import { StorageProvider } from "@/storage-provider";

type GetConfig = (configPath?: string) => Promise<EthokoCliConfig>;

export function registerRestoreCommand(
  program: Command,
  getConfig: GetConfig,
): void {
  program
    .command("restore")
    .description("Restore original artifacts from storage")
    .argument(
      "<PROJECT[:TAG|@ID]>",
      "Target project and artifact identifier (tag or ID)",
    )
    .option("--output <path>", "Output directory")
    .option("--force", "Overwrite existing output directory", false)
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

      const artifactKeyParsingResult = ProjectOrArtifactKeySchema.transform(
        (projectOrArtifactKey) => {
          if (projectOrArtifactKey.type === "project") {
            return z.NEVER;
          }
          return projectOrArtifactKey;
        },
      ).safeParse(projectArg);
      if (!artifactKeyParsingResult.success) {
        logger.error(
          `Invalid artifact argument:\nThe artifact argument must be a string in the format PROJECT[:TAG|@ID]`,
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
        `Restoring artifact "${artifactKeyParsingResult.data.project}${artifactKeyParsingResult.data.type === "id" ? `@${artifactKeyParsingResult.data.id}` : `:${artifactKeyParsingResult.data.tag}`}"`,
      );

      const optsParsingResult = z
        .object({
          output: z
            .string('The "output" option must be a string')
            .min(
              1,
              'The "output" cannot be empty. Provide a valid output directory path.',
            )
            .pipe(
              generateAbsolutePathSchema(() => new AbsolutePath(process.cwd())),
            ),
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

      const storageProvider = createStorageProvider(
        projectConfig.storage,
        logger.toDebugLogger(),
        optsParsingResult.data.debug,
      );

      const localArtifactStore = new LocalArtifactStore(
        config.localArtifactStorePath,
      );

      await runRestoreCommand(
        artifactKeyParsingResult.data,
        optsParsingResult.data.output,
        {
          storageProvider,
          localArtifactStore,
          logger,
        },
        {
          force: optsParsingResult.data.force,
          debug: optsParsingResult.data.debug,
        },
      ).catch((err: unknown) => {
        if (err instanceof CliError) {
          logger.error(err.message);
        } else {
          logger.error(
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

export async function runRestoreCommand(
  artifactKey: ArtifactKey,
  outputPath: AbsolutePath,
  dependencies: {
    storageProvider: StorageProvider;
    localArtifactStore: LocalArtifactStore;
    logger: CommandLogger;
  },
  opts: {
    force: boolean;
    debug: boolean;
  },
): Promise<RestoreResult> {
  let resolvedArtifactKey = await resolvePulledArtifact(
    artifactKey,
    dependencies.localArtifactStore,
    { debug: opts.debug },
  );
  if (!resolvedArtifactKey) {
    const artifactLabel = `${artifactKey.project}${
      artifactKey.type === "id" ? `@${artifactKey.id}` : `:${artifactKey.tag}`
    }`;
    const pullSpinner = dependencies.logger.createSpinner(
      `Artifact "${artifactLabel}" not found locally, pulling...`,
    );
    const pulledArtifact = await pullArtifact(
      artifactKey,
      {
        storageProvider: dependencies.storageProvider,
        localArtifactStore: dependencies.localArtifactStore,
        logger: dependencies.logger.toDebugLogger(),
      },
      {
        force: false,
        debug: opts.debug,
      },
    ).catch((err) => {
      pullSpinner.fail("Fail to pull artifact");
      throw err;
    });
    pullSpinner.succeed(`Artifact "${artifactLabel}" pulled successfully`);
    resolvedArtifactKey = {
      project: artifactKey.project,
      id: pulledArtifact.id,
      tag: artifactKey.type === "tag" ? artifactKey.tag : null,
    };
  }

  const restoreResult = await restore(
    resolvedArtifactKey,
    outputPath,
    {
      localArtifactStore: dependencies.localArtifactStore,
      storageProvider: dependencies.storageProvider,
      logger: dependencies.logger.toDebugLogger(),
    },
    {
      force: opts.force,
      debug: opts.debug,
    },
  );

  displayRestoreResult(dependencies.logger, restoreResult);

  return restoreResult;
}

function displayRestoreResult(
  logger: CommandLogger,
  result: RestoreResult,
): void {
  const summaryLines = result.filesRestored.map((file) =>
    styleText(LOG_COLORS.log, `  • ${file}`),
  );
  if (summaryLines.length > 0) {
    logger.note(summaryLines.join("\n"), "Restored Files");
  }

  logger.success(
    `Restored ${result.filesRestored.length} file${result.filesRestored.length > 1 ? "s" : ""} to ${result.outputPath}`,
  );
}
