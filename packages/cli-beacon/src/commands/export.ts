import * as fs from "fs/promises";
import { Command } from "commander";
import { z } from "zod";
import { CommandLogger } from "@/ui/index.js";
import {
  CliError,
  exportContractArtifact,
  type ExportContractArtifactResult,
} from "@/client/index.js";
import { PulledArtifactStore } from "@/pulled-artifact-store/pulled-artifact-store.js";

import type { EthokoCliConfig } from "../config";
import { toAsyncResult } from "@/utils/result.js";
import { ArtifactKeySchema } from "./utils/parse-artifact-key.js";
import { generateAbsolutePathSchema, AbsolutePath } from "@/utils/path.js";

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

      const artifactKeyParsingResult = ArtifactKeySchema.transform(
        (artifactKey) => {
          if (!artifactKey.artifact) {
            return z.NEVER;
          }
          return {
            project: artifactKey.project,
            search: artifactKey.artifact,
          };
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
          `Exporting contract artifact for "${optsParsingResult.data.contract}" from "${projectConfig.name}:${artifactKeyParsingResult.data.search.type === "tag" ? artifactKeyParsingResult.data.search.tag : artifactKeyParsingResult.data.search.id}" to ${optsParsingResult.data.output}`,
        );
      }

      const pulledArtifactStore = new PulledArtifactStore(
        config.pulledArtifactsPath,
      );

      await exportContractArtifact(
        {
          project: projectConfig.name,
          search: artifactKeyParsingResult.data.search,
        },
        optsParsingResult.data.contract,
        pulledArtifactStore,
        {
          debug: optsParsingResult.data.debug,
          logger,
        },
      )
        .then(async (result: ExportContractArtifactResult) => {
          if (optsParsingResult.data.output) {
            const artifactJson = JSON.stringify(result, null, 2);

            try {
              await fs.access(optsParsingResult.data.output.resolvedPath);
              logger.warn(
                `File ${optsParsingResult.data.output.resolvedPath} already exists, overwriting...`,
              );
            } catch {
              const dir = optsParsingResult.data.output.dirname();
              await fs.mkdir(dir.resolvedPath, { recursive: true });
            }

            await fs.writeFile(
              optsParsingResult.data.output.resolvedPath,
              `${artifactJson}\n`,
            );

            const contractIdentifier = `${result.sourceName}:${result.contractName}`;
            const artifactLabel = result.tag
              ? `${result.project}:${result.tag}`
              : `${result.project}:${result.id}`;
            logger.success(
              `Exported contract artifact for ${contractIdentifier} from ${artifactLabel} to ${optsParsingResult.data.output.resolvedPath}`,
            );
            return;
          }

          console.log(JSON.stringify(result, null, 2));
        })
        .catch((err: unknown) => {
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
