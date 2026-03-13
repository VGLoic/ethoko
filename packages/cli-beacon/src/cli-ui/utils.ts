import ora, { Ora } from "ora";
import boxen from "boxen";
import { styleText } from "node:util";

export const LOG_COLORS = {
  log: "cyan",
  success: "green",
  error: "red",
  warn: "yellow",
} as const;

/**
 * CLI UI utilities for enhanced terminal output
 */

/**
 * Creates a simple spinner without step tracking
 */
export function createSpinner(message: string, silent = false): Ora {
  return ora({
    text: message,
    stream: process.stderr,
    isSilent: silent,
  }).start();
}

/**
 * Creates a boxed header message
 */
export function boxHeader(message: string, silent = false): void {
  if (silent) return;
  const boxed = boxen(message, {
    padding: 0,
    margin: { top: 1, bottom: 0, left: 0, right: 0 },
    borderStyle: "round",
    borderColor: "cyan",
  });
  console.error(boxed);
}

/**
 * Creates a boxed summary with multiple lines
 */
export function boxSummary(
  title: string,
  lines: string[],
  silent = false,
): void {
  if (silent) return;
  const boldTitle = styleText("bold", title);
  const content = `${boldTitle}\n\n${lines.join("\n")}`;
  const boxed = boxen(content, {
    padding: 1,
    margin: { top: 1, bottom: 1, left: 0, right: 0 },
    borderStyle: "round",
    borderColor: "cyan",
  });
  console.error(boxed);
}

/**
 * Enhanced success message
 */
export function success(message: string, silent = false): void {
  if (silent) return;
  console.error(styleText(LOG_COLORS.success, `✔ ${message}`));
}

/**
 * Enhanced error message
 */
export function error(message: string): void {
  console.error(styleText(LOG_COLORS.error, `✖ ${message}`));
}

/**
 * Enhanced warning message
 */
export function warn(message: string): void {
  console.error(styleText(LOG_COLORS.warn, `⚠ ${message}`));
}

/**
 * Enhanced info message
 */
export function info(message: string, silent = false): void {
  if (silent) return;
  console.error(styleText(LOG_COLORS.log, `ℹ ${message}`));
}

export type { Ora };
