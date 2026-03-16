import { styleText } from "node:util";
import { Command } from "commander";
import { z } from "zod";
import { boxHeader, error as cliError, LOG_COLORS, warn } from "@/ui/index.js";
import {
  CliError,
  ListArtifactsResult,
  listPulledArtifacts,
} from "@/client/index.js";
import { PulledArtifactStore } from "@/pulled-artifact-store/pulled-artifact-store.js";

import type { EthokoCliConfig } from "../config/config.js";

type GetConfig = (configPath?: string) => Promise<EthokoCliConfig>;

export function registerArtifactsCommand(
  program: Command,
  getConfig: GetConfig,
): void {
  program
    .command("artifacts")
    .description("List pulled artifacts")
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

      const parsingResult = z
        .object({
          debug: z
            .boolean('The "debug" option must be a boolean')
            .default(config.debug),
          silent: z
            .boolean('The "silent" option must be a boolean')
            .default(false),
          json: z.boolean('The "json" option must be a boolean').default(false),
        })
        .safeParse(options);

      if (!parsingResult.success) {
        cliError(
          `Invalid command arguments:\n${z.prettifyError(parsingResult.error)}`,
        );
        process.exitCode = 1;
        return;
      }

      boxHeader("Listing artifacts", parsingResult.data.silent);

      const pulledArtifactStore = new PulledArtifactStore(
        config.pulledArtifactsPath,
      );

      await listPulledArtifacts(pulledArtifactStore, {
        debug: parsingResult.data.debug,
        silent: parsingResult.data.silent,
      })
        .then((result) => {
          if (parsingResult.data.json) {
            displayListArtifactsResultsJson(result, parsingResult.data.silent);
          } else {
            displayListArtifactsResults(result, parsingResult.data.silent);
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

function displayListArtifactsResultsJson(
  data: ListArtifactsResult,
  silent = false,
): void {
  if (silent) return;
  console.log(JSON.stringify(data, null, 2));
}

function displayListArtifactsResults(
  data: ListArtifactsResult,
  silent = false,
): void {
  if (data.length === 0) {
    warn("No artifacts found");
    return;
  }

  if (silent) return;

  const structuredData = data.map((item) => ({
    Project: item.project,
    Tag: item.tag,
    ID: item.id,
    "Pull date": deriveTimeAgo(item.lastModifiedAt),
  }));

  colorTableHeaders(structuredData, ["Project", "Tag", "ID", "Pull date"]);
}

/**
 * Creates a colored table header row with fixed column widths
 */
function colorTableHeaders(
  data: Record<string, unknown>[],
  headers: string[],
): void {
  if (data.length === 0) {
    return;
  }

  // Calculate the maximum width for each column
  const columnWidths: Record<string, number> = {};
  for (const header of headers) {
    // Start with header length
    columnWidths[header] = header.length;

    // Check all data rows for maximum width
    for (const row of data) {
      const value = row[header];
      const valueLength = String(value).length;
      if (valueLength > columnWidths[header]) {
        columnWidths[header] = valueLength;
      }
    }
  }

  // Pad a string to a specific width
  const pad = (str: string, width: number): string => {
    return str + " ".repeat(Math.max(0, width - str.length));
  };

  // Create header row with fixed widths
  const headerRow = headers
    .map((h) => styleText(["bold", LOG_COLORS.log], pad(h, columnWidths[h]!)))
    .join(" │ ");
  console.error(`\n ${headerRow}`);

  // Create separator row
  const separatorRow = headers
    .map((h) => "─".repeat(columnWidths[h]!))
    .join("─┼─");
  console.error(` ${separatorRow}`);

  // Print data rows with fixed widths
  for (const row of data) {
    const values = headers.map((h) => {
      const value = row[h];
      const strValue = String(value);
      const paddedValue = pad(strValue, columnWidths[h]!);

      // Color the padded value
      if (typeof value === "string") {
        // Color tags (strings that look like versions)
        if (h === "Tag" && value) {
          return styleText(LOG_COLORS.success, paddedValue);
        }
        // Color IDs
        if (h === "ID" && value) {
          return styleText(LOG_COLORS.warn, paddedValue);
        }
        // Color projects
        if (h === "Project" && value) {
          return styleText("magenta", paddedValue);
        }
      }
      return paddedValue;
    });
    console.error(` ${values.join(" │ ")}`);
  }
  console.error();
}

function deriveTimeAgo(time: string): string {
  const now = new Date();
  const then = new Date(time);
  const diff = now.getTime() - then.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ago`;
  }
  if (hours > 0) {
    return `${hours}h ago`;
  }
  if (minutes > 0) {
    return `${minutes}m ago`;
  }
  return `Less than a minute ago`;
}
