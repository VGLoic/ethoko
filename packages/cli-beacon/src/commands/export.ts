import * as fs from "fs/promises";
import { styleText } from "node:util";

import { Command } from "commander";
import { z } from "zod";
import { boxHeader, error as cliError, LOG_COLORS } from "@ethoko/core/cli-ui";
import {
  CliError,
  exportContractArtifact,
  type ExportContractArtifactResult,
} from "@ethoko/core/cli-client";
import { LocalStorage } from "@ethoko/core/local-storage";

import type { EthokoCliConfig } from "../config.js";

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
      let config: EthokoCliConfig;
      try {
        config = await getConfig();
      } catch (err) {
        cliError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
        return;
      }

      const optsParsingResult = z
        .object({
          contract: z.string().min(1),
          id: z.string().optional(),
          tag: z.string().optional(),
          project: z.string().optional().default(config.project),
          output: z.string().optional(),
          debug: z.boolean().default(config.debug),
          silent: z.boolean().default(false),
        })
        .safeParse(options);
      if (!optsParsingResult.success) {
        cliError("Invalid arguments");
        if (config.debug) {
          console.error(optsParsingResult.error);
        }
        process.exitCode = 1;
        return;
      }

      if (optsParsingResult.data.id && optsParsingResult.data.tag) {
        cliError("Use either --id or --tag, not both");
        process.exitCode = 1;
        return;
      }

      let search: { type: "tag"; tag: string } | { type: "id"; id: string };
      if (optsParsingResult.data.id) {
        search = { type: "id", id: optsParsingResult.data.id };
      } else if (optsParsingResult.data.tag) {
        search = { type: "tag", tag: optsParsingResult.data.tag };
      } else {
        cliError("Provide --id or --tag to identify the artifact");
        process.exitCode = 1;
        return;
      }

      if (optsParsingResult.data.output) {
        boxHeader(
          `Exporting contract artifact for "${optsParsingResult.data.contract}" from "${optsParsingResult.data.project}:${search.type === "tag" ? search.tag : search.id}"`,
          optsParsingResult.data.silent,
        );
      }

      const localStorage = new LocalStorage(config.pulledArtifactsPath);

      await exportContractArtifact(
        { project: optsParsingResult.data.project, search },
        optsParsingResult.data.contract,
        localStorage,
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
