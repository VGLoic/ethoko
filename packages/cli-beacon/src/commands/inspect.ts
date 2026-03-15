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
import { LocalStorage } from "@/local-storage/local-storage.js";

import type { EthokoCliConfig } from "../config/config.js";

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
          id: z.string().optional(),
          tag: z.string().optional(),
          project: z.string().optional().default(config.project),
          json: z.boolean().default(false),
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

      boxHeader(
        `Inspecting artifact "${optsParsingResult.data.project}:${search.type === "tag" ? search.tag : search.id}"`,
        optsParsingResult.data.silent,
      );

      const localStorage = new LocalStorage(config.pulledArtifactsPath);

      await inspectArtifact(
        { project: optsParsingResult.data.project, search },
        localStorage,
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
