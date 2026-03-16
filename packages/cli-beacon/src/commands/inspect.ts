import { styleText } from "node:util";
import { Command } from "commander";
import { z } from "zod";
import {
  boxHeader,
  error as cliError,
  LOG_COLORS,
  boxSummary,
} from "@/ui/index.js";
import { CliError, inspectArtifact, InspectResult } from "@/client/index.js";
import { PulledArtifactStore } from "@/pulled-artifact-store/pulled-artifact-store.js";

import type { EthokoCliConfig } from "../config/config.js";
import { toAsyncResult } from "@/utils/result.js";

type GetConfig = (configPath?: string) => Promise<EthokoCliConfig>;

export function registerInspectCommand(
  program: Command,
  getConfig: GetConfig,
): void {
  program
    .command("inspect")
    .description("Inspect a pulled artifact")
    .option("--id <id>", "Artifact ID")
    .option("--tag <tag>", "Artifact tag")
    .option("--project <project>", "Project name")
    .option("--json", "Output JSON", false)
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
          json: z.boolean('The "json" option must be a boolean').default(false),
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
            project: data.project,
            json: data.json,
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

      boxHeader(
        `Inspecting artifact "${optsParsingResult.data.project}:${optsParsingResult.data.search.type === "tag" ? optsParsingResult.data.search.tag : optsParsingResult.data.search.id}"`,
        optsParsingResult.data.silent,
      );

      const pulledArtifactStore = new PulledArtifactStore(
        config.pulledArtifactsPath,
      );

      await inspectArtifact(
        {
          project: optsParsingResult.data.project,
          search: optsParsingResult.data.search,
        },
        pulledArtifactStore,
        {
          debug: optsParsingResult.data.debug,
          silent: optsParsingResult.data.silent,
        },
      )
        .then((result) => {
          if (optsParsingResult.data.json) {
            displayInspectResultJson(result, optsParsingResult.data.silent);
          } else {
            displayInspectResult(result, optsParsingResult.data.silent);
          }
        })
        .catch((err) => {
          if (err instanceof CliError) {
            cliError(err.message);
          } else {
            cliError(
              "An unexpected error occurred, please fill an issue with the error details if the problem persists",
            );
            console.error(err);
          }
          process.exitCode = 1;
        });
    });
}

function displayInspectResult(result: InspectResult, silent = false): void {
  if (silent) {
    return;
  }

  const summaryLines: string[] = [];
  const artifactLabel = result.tag
    ? `${result.project}:${result.tag}`
    : `${result.project}:${result.id}`;
  summaryLines.push(styleText(LOG_COLORS.log, `Artifact: ${artifactLabel}`));
  summaryLines.push(styleText(LOG_COLORS.log, `ID: ${result.id}`));
  summaryLines.push(
    styleText(LOG_COLORS.log, `Origin: ${originToLabel(result.origin)}`),
  );
  summaryLines.push("");
  summaryLines.push(styleText(["bold", LOG_COLORS.log], "Compiler Settings:"));
  summaryLines.push(
    styleText(
      LOG_COLORS.log,
      `  • Solidity: ${result.compiler.solcLongVersion}`,
    ),
  );
  summaryLines.push(
    styleText(
      LOG_COLORS.log,
      `  • Optimizer: ${result.compiler.optimizer.enabled ? "enabled" : "disabled"} (${result.compiler.optimizer.runs} runs)`,
    ),
  );
  summaryLines.push(
    styleText(LOG_COLORS.log, `  • EVM: ${result.compiler.evmVersion}`),
  );
  if (result.compiler.remappings.length > 0) {
    summaryLines.push(
      styleText(
        LOG_COLORS.log,
        `  • Remappings: ${result.compiler.remappings.join(", ")}`,
      ),
    );
  }
  summaryLines.push("");
  summaryLines.push(styleText(["bold", LOG_COLORS.log], "Source Files:"));
  for (const sourcePath of result.sourceFiles) {
    summaryLines.push(styleText(LOG_COLORS.log, `  • ${sourcePath}`));
  }
  summaryLines.push("");
  summaryLines.push(
    styleText(
      ["bold", LOG_COLORS.log],
      `Contracts (${countContracts(result)}):`,
    ),
  );
  for (const entry of result.contractsBySource) {
    for (const contractName of entry.contracts) {
      summaryLines.push(
        styleText(LOG_COLORS.log, `  • ${entry.sourcePath}:${contractName}`),
      );
    }
  }

  boxSummary("Inspect Artifact", summaryLines, silent);
}

function displayInspectResultJson(result: InspectResult, silent = false): void {
  if (silent) return;
  console.error(JSON.stringify(result, null, 2));
}

function countContracts(result: InspectResult): number {
  return result.contractsBySource.reduce(
    (total, entry) => total + entry.contracts.length,
    0,
  );
}

function originToLabel(origin: InspectResult["origin"]): string {
  if (origin.format === "hardhat-v3") {
    return `Hardhat v3 (${origin.ids.join(", ")})`;
  }
  if (origin.format === "hardhat-v2") {
    return `Hardhat v2 (${origin.id})`;
  }
  if (origin.format === "hardhat-v3-non-isolated-build") {
    return `Hardhat v3 (${origin.id})`;
  }
  return `Forge (${origin.id})`;
}
