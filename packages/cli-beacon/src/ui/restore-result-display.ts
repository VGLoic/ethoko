import { styleText } from "node:util";
import type { RestoreResult } from "../client";
import { LOG_COLORS, boxSummary, success } from "./utils";

export function displayRestoreResult(
  result: RestoreResult,
  silent = false,
): void {
  if (silent) return;

  console.error("");
  success(
    `Restored ${result.filesRestored.length} file${result.filesRestored.length > 1 ? "s" : ""} to ${result.outputPath}`,
    silent,
  );

  const summaryLines = result.filesRestored.map((file) =>
    styleText(LOG_COLORS.log, `  • ${file}`),
  );
  if (summaryLines.length > 0) {
    boxSummary("Restored Files", summaryLines, silent);
  }
}
