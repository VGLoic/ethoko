import * as fs from "fs/promises";
import { styleText } from "node:util";

import { Command } from "commander";
import { z } from "zod";
import { boxHeader, error as cliError, LOG_COLORS } from "@/ui/index.js";
import {
  CliError,
  exportContractArtifact,
  type ExportContractArtifactResult,
} from "@/client/index.js";
import { PulledArtifactStore } from "@/pulled-artifact-store/pulled-artifact-store.js";

import type { EthokoCliConfig } from "../config/config.js";
import { toAsyncResult } from "@/utils/result.js";
import { ArtifactKeySchema } from "./utils/parse-artifact-key.js";

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
        cliError(
          `Invalid artifact argument:\nThe artifact argument must be a string in the format PROJECT[:TAG|@ID]`,
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
            .optional(),
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

      if (optsParsingResult.data.output) {
        boxHeader(
          `Exporting contract artifact for "${optsParsingResult.data.contract}" from "${projectConfig.name}:${artifactKeyParsingResult.data.search.type === "tag" ? artifactKeyParsingResult.data.search.tag : artifactKeyParsingResult.data.search.id}"`,
          optsParsingResult.data.silent,
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
          silent: optsParsingResult.data.silent,
        },
      )
        .then(async (result: ExportContractArtifactResult) => {
          if (optsParsingResult.data.output) {
            const artifactJson = JSON.stringify(result, null, 2);

            try {
              await fs.access(optsParsingResult.data.output);
              if (!optsParsingResult.data.silent) {
                console.error(
                  styleText(
                    LOG_COLORS.warn,
                    `⚠ File ${optsParsingResult.data.output} already exists, overwriting...`,
                  ),
                );
              }
            } catch {
              const dir = optsParsingResult.data.output
                .split("/")
                .slice(0, -1)
                .join("/");
              if (dir.length > 0) {
                await fs.mkdir(dir, { recursive: true });
              }
            }

            await fs.writeFile(
              optsParsingResult.data.output,
              `${artifactJson}\n`,
            );

            if (!optsParsingResult.data.silent) {
              const contractIdentifier = `${result.sourceName}:${result.contractName}`;
              const artifactLabel = result.tag
                ? `${result.project}:${result.tag}`
                : `${result.project}:${result.id}`;
              console.error(
                styleText(
                  LOG_COLORS.success,
                  `\n✔ Exported contract artifact for ${contractIdentifier} from ${artifactLabel} to ${optsParsingResult.data.output}`,
                ),
              );
            }
            return;
          }

          console.log(JSON.stringify(result, null, 2));
        })
        .catch((err: unknown) => {
          if (err instanceof CliError) {
            cliError(err.message);
          } else {
            cliError(
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
