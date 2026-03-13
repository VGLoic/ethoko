import { styleText } from "node:util";
import type { ListArtifactsResult } from "../cli-client";
import { LOG_COLORS, warn } from "./utils";

export function displayListArtifactsResultsJson(
  data: ListArtifactsResult,
  silent = false,
): void {
  if (silent) return;
  console.log(JSON.stringify(data, null, 2));
}

export function displayListArtifactsResults(
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
