import z from "zod";
import { Command } from "commander";
import { CommandLogger } from "@/ui";
import { toAsyncResult } from "@/utils/result";
import { LocalArtifactStore } from "@/local-artifact-store";
import { ProjectOrArtifactKeySchema } from "./utils/parse-project-or-artifact-key";
import type { EthokoCliConfig } from "../config";
import {
  CliError,
  pruneArtifact,
  pruneOrphanedAndUntaggedArtifacts,
  pruneProjectArtifacts,
  PruneResult,
} from "@/client";

type GetConfig = () => Promise<EthokoCliConfig>;

export function registerPruneCommand(
  program: Command,
  getConfig: GetConfig,
): void {
  program
    .command("prune")
    .description("Remove pulled artifacts from the local cache")
    .argument("[artifact-key]", "PROJECT, PROJECT:TAG, or PROJECT@ID to prune")
    .option(
      "--dry-run",
      "Preview what would be removed without deleting",
      false,
    )
    .option("--debug", "Enable debug logging", false)
    .option("--silent", "Suppress output", false)
    .action(async (artifactKey: string | undefined, options) => {
      const debug = options.debug as boolean;
      const logger = new CommandLogger(options.silent);

      const configResult = await toAsyncResult(getConfig(), { debug });
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
      const localArtifactStore = new LocalArtifactStore(
        config.localArtifactStorePath,
      );
      const dryRun = Boolean(options.dryRun);

      if (!artifactKey) {
        const configuredProjects = new Set([
          ...config.localProjectNames,
          ...config.globalProjectNames,
        ]);
        await runPruneCommand(
          { type: "all", projects: configuredProjects },
          {
            localArtifactStore,
            logger,
          },
          {
            dryRun,
            debug,
          },
        ).catch((error) => {
          if (error instanceof CliError) {
            logger.error(error.message);
          } else {
            logger.error(
              "An unexpected error occurred, please fill an issue with the error details if the problem persists",
            );
            console.error(error);
          }
          process.exitCode = 1;
        });
        return;
      }

      const parsedKeyResult = ProjectOrArtifactKeySchema.safeParse(artifactKey);
      if (!parsedKeyResult.success) {
        logger.error(
          `Invalid artifact argument:\nThe artifact argument must be a string in the format PROJECT OR PROJECT[:TAG|@ID]`,
        );
        process.exitCode = 1;
        return;
      }

      await runPruneCommand(
        { type: "specific", artifactKey: parsedKeyResult.data },
        {
          localArtifactStore,
          logger,
        },
        {
          dryRun,
          debug,
        },
      ).catch((error) => {
        if (error instanceof CliError) {
          logger.error(error.message);
        } else {
          logger.error(
            "An unexpected error occurred, please fill an issue with the error details if the problem persists",
          );
          console.error(error);
        }
        process.exitCode = 1;
      });
    });
}

export async function runPruneCommand(
  target:
    | { type: "all"; projects: Set<string> }
    | {
        type: "specific";
        artifactKey: z.infer<typeof ProjectOrArtifactKeySchema>;
      },
  dependencies: {
    localArtifactStore: LocalArtifactStore;
    logger: CommandLogger;
  },
  opts: {
    debug: boolean;
    dryRun: boolean;
  },
): Promise<PruneResult> {
  const debugLogger = dependencies.logger.toDebugLogger();
  let pruneResult: PruneResult;
  if (target.type === "all") {
    dependencies.logger.intro("Pruning orphaned and untagged artifacts");
    pruneResult = await pruneOrphanedAndUntaggedArtifacts(
      target.projects,
      {
        localArtifactStore: dependencies.localArtifactStore,
        logger: debugLogger,
      },
      opts,
    );
  } else if (target.artifactKey.type === "project") {
    dependencies.logger.intro(
      `Pruning artifacts for project "${target.artifactKey.project}"`,
    );
    pruneResult = await pruneProjectArtifacts(
      target.artifactKey.project,
      {
        localArtifactStore: dependencies.localArtifactStore,
        logger: debugLogger,
      },
      opts,
    );
  } else {
    dependencies.logger.intro(
      `Pruning artifact "${target.artifactKey.project}${
        target.artifactKey.type === "tag"
          ? `:${target.artifactKey.tag}`
          : `@${target.artifactKey.id}`
      }"`,
    );
    pruneResult = await pruneArtifact(
      target.artifactKey,
      {
        localArtifactStore: dependencies.localArtifactStore,
        logger: debugLogger,
      },
      opts,
    );
  }

  displayPrunedArtifacts(pruneResult, dependencies.logger, opts.dryRun);

  return pruneResult;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)}GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)}MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(2)}KB`;
  return `${bytes}B`;
}

function displayPrunedArtifacts(
  prunedArtifacts: {
    project: string;
    id: string;
    tag: string | null;
    size: number;
  }[],
  logger: CommandLogger,
  dryRun: boolean,
): void {
  if (prunedArtifacts.length === 0) {
    logger.success(
      dryRun ? "No artifacts would be pruned." : "No artifacts found to prune.",
    );
    return;
  }

  const lines = prunedArtifacts.map(({ project, id, tag, size }) =>
    tag
      ? `• ${project}:${tag} (ID: ${id}, ${formatBytes(size)})`
      : `• ${project}@${id} (${formatBytes(size)})`,
  );

  logger.note(
    lines.join("\n"),
    dryRun ? "Artifacts that would be pruned" : "Pruned artifacts",
  );
}
