import * as fs from "fs/promises";
import { Command } from "commander";
import { z } from "zod";
import { CommandLogger } from "@/ui/index.js";
import {
  CliError,
  exportContractArtifact,
  pullArtifact,
  resolvePulledArtifact,
  type ExportContractArtifactResult,
} from "@/client";
import { LocalArtifactStore } from "@/local-artifact-store";
import type { EthokoCliConfig } from "../config";
import { toAsyncResult } from "@/utils/result.js";
import { ProjectOrArtifactKeySchema } from "./utils/parse-project-or-artifact-key.js";
import { generateAbsolutePathSchema, AbsolutePath } from "@/utils/path.js";
import { createStorageProvider } from "./utils/storage-provider";
import { ArtifactKey } from "@/utils/artifact-key";
import { StorageProvider } from "@/storage-provider";

type GetConfig = (configPath?: string) => Promise<EthokoCliConfig>;

export function registerExportCommand(
  program: Command,
  getConfig: GetConfig,
): void {
  program
    .command("export")
    .description("Export a contract artifact")
    .argument(
      "<PROJECT[:TAG|@ID]>",
      "Target project and artifact identifier (tag or ID)",
    )
    .option(
      "--contract <name>",
      "Contract name or fully qualified path (e.g. MyContract or contracts/MyContract.sol:MyContract)",
    )
    .option("--output <path>", "Output file (default: stdout)")
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

      const optsParsingResult = z
        .object({
          contract: z
            .string('The "contract" option must be a string')
            .min(
              1,
              'The "contract" option is required. Provide a contract name or fully qualified name (FQN) like "MyContract" or "contracts/MyContract.sol:MyContract"',
            ),
          output: z
            .string('The "output" option must be a string')
            .min(
              1,
              'If provided, the "output" cannot be empty. Provide a valid file path.',
            )
            .pipe(
              generateAbsolutePathSchema(() => new AbsolutePath(process.cwd())),
            )
            .optional(),
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

      if (optsParsingResult.data.output) {
        logger.intro(
          `Exporting contract artifact for "${optsParsingResult.data.contract}" from "${projectConfig.name}${artifactKeyParsingResult.data.type === "tag" ? `:${artifactKeyParsingResult.data.tag}` : `@${artifactKeyParsingResult.data.id}`}" to ${optsParsingResult.data.output}`,
        );
      }

      const localArtifactStore = new LocalArtifactStore(
        config.localArtifactStorePath,
      );
      const storageProvider = createStorageProvider(
        projectConfig.storage,
        logger.toDebugLogger(),
        optsParsingResult.data.debug,
      );

      await runExportCommand(
        artifactKeyParsingResult.data,
        optsParsingResult.data.contract,
        {
          storageProvider,
          localArtifactStore,
          logger,
        },
        {
          debug: optsParsingResult.data.debug,
          output: optsParsingResult.data.output,
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

export async function runExportCommand(
  artifactKey: ArtifactKey,
  shortOrFullyQualifiedContractName: string,
  dependencies: {
    storageProvider: StorageProvider;
    localArtifactStore: LocalArtifactStore;
    logger: CommandLogger;
  },
  opts: {
    debug: boolean;
    output?: AbsolutePath;
  },
): Promise<ExportContractArtifactResult> {
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
      pullSpinner.fail("Failed to pull artifact");
      throw err;
    });
    pullSpinner.succeed(`Artifact "${artifactLabel}" pulled successfully`);
    resolvedArtifactKey = {
      project: artifactKey.project,
      id: pulledArtifact.id,
      tag: artifactKey.type === "tag" ? artifactKey.tag : null,
    };
  }

  const exportResult = await exportContractArtifact(
    resolvedArtifactKey,
    shortOrFullyQualifiedContractName,
    {
      localArtifactStore: dependencies.localArtifactStore,
      logger: dependencies.logger.toDebugLogger(),
    },
    { debug: opts.debug },
  );

  if (exportResult.sourcesWithMissingContent.length > 0) {
    dependencies.logger.warn(
      `Some sources are missing "content", it may cause issues when trying to verify a contract on Etherscan or else.\nSources are: ${exportResult.sourcesWithMissingContent.map((s) => `* ${s}`).join("\n")}`,
    );
  }

  if (opts.output) {
    const artifactJson = JSON.stringify(exportResult, null, 2);

    try {
      await fs.access(opts.output.resolvedPath);
      dependencies.logger.warn(
        `File ${opts.output.resolvedPath} already exists, overwriting...`,
      );
    } catch {
      const dir = opts.output.dirname();
      await fs.mkdir(dir.resolvedPath, { recursive: true });
    }

    await fs.writeFile(opts.output.resolvedPath, `${artifactJson}\n`);

    const contractIdentifier = `${exportResult.sourceName}:${exportResult.contractName}`;
    const artifactLabel = exportResult.tag
      ? `${exportResult.project}:${exportResult.tag}`
      : `${exportResult.project}:${exportResult.id}`;
    dependencies.logger.success(
      `Exported contract artifact for ${contractIdentifier} from ${artifactLabel} to ${opts.output.resolvedPath}`,
    );
  } else {
    if (!dependencies.logger.silent) {
      console.log(JSON.stringify(exportResult, null, 2));
    }
  }

  return exportResult;
}
