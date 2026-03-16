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

type GetConfig = (configPath?: string) => Promise<EthokoCliConfig>;

export function registerExportCommand(
  program: Command,
  getConfig: GetConfig,
): void {
  program
    .command("export")
    .description("Export a contract artifact")
    .option("--contract <name>", "Contract name or FQN")
    .option("--id <id>", "Artifact ID")
    .option("--tag <tag>", "Artifact tag")
    .option("--project <project>", "Project name")
    .option("--output <path>", "Output file (default: stdout)")
    .option("--debug", "Enable debug logging", false)
    .option("--silent", "Suppress output", false)
    .action(async (options) => {
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
      const config = configResult.value.config;

      const optsParsingResult = z
        .object({
          contract: z
            .string('The "contract" option must be a string')
            .min(
              1,
              'The "contract" option is required. Provide a contract name or fully qualified name (FQN) like "MyContract" or "contracts/MyContract.sol:MyContract"',
            ),
          id: z
            .string('The "id" option must be a string')
            .min(
              1,
              'If provided, the "id" cannot be empty. Provide a valid artifact ID.',
            )
            .optional(),
          tag: z
            .string('The "tag" option must be a string')
            .min(
              1,
              'If provided, the "tag" cannot be empty. Provide a valid tag name.',
            )
            .optional(),
          project: z
            .string('The "project" option must be a string')
            .min(1, 'The "project" cannot be empty')
            .optional()
            .default(config.project),
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
        .transform((data, ctx) => {
          if (data.id && data.tag) {
            ctx.addIssue({
              code: "custom",
              message:
                "Provide either --id or --tag to identify the artifact, not both",
            });
            return z.NEVER;
          }
          let search:
            | { type: "id"; id: string }
            | { type: "tag"; tag: string }
            | null = null;
          if (data.id) {
            search = { type: "id", id: data.id };
          } else if (data.tag) {
            search = { type: "tag", tag: data.tag };
          }
          if (!search) {
            ctx.addIssue({
              code: "custom",
              message:
                "Either --id or --tag is required to identify the artifact. Example: --tag v1.0.0 or --id abc123def",
            });
            return z.NEVER;
          }
          return {
            contract: data.contract,
            project: data.project,
            output: data.output,
            debug: data.debug,
            silent: data.silent,
            search,
          };
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
          `Exporting contract artifact for "${optsParsingResult.data.contract}" from "${optsParsingResult.data.project}:${optsParsingResult.data.search.type === "tag" ? optsParsingResult.data.search.tag : optsParsingResult.data.search.id}"`,
          optsParsingResult.data.silent,
        );
      }

      const pulledArtifactStore = new PulledArtifactStore(
        config.pulledArtifactsPath,
      );

      await exportContractArtifact(
        {
          project: optsParsingResult.data.project,
          search: optsParsingResult.data.search,
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
