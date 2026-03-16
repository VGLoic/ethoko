import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import readline from "node:readline/promises";

import { Command } from "commander";
import { z } from "zod";
import {
  error as cliError,
  info as cliInfo,
  success as cliSuccess,
} from "@/ui/index.js";

import {
  detectInstallMethod,
  type InstallMethod,
} from "./utils/installation.js";

const UNINSTALL_INSTRUCTIONS: Record<Exclude<InstallMethod, "curl">, string> = {
  "npm-global": "npm uninstall -g @ethoko/cli",
  "npm-local": "npm uninstall @ethoko/cli",
  brew: "brew uninstall ethoko",
  unknown:
    "See https://github.com/VGLoic/ethoko/releases for manual cleanup steps",
};

/**
 * Prompt the user for confirmation unless --force is set.
 */
async function confirmUninstall(force: boolean): Promise<boolean> {
  if (force) {
    return true;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    const answer = await rl.question("Proceed with uninstallation? (y/N): ");
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

/**
 * Remove Ethoko PATH entries from a shell profile file.
 */
async function removePathFromProfile(
  profilePath: string,
  opts: { debug: boolean },
): Promise<boolean> {
  let contents: string;
  try {
    contents = await readFile(profilePath, "utf8");
  } catch (err) {
    if (opts.debug) {
      cliInfo(`Skipped missing profile ${profilePath}`, false);
      cliError(err instanceof Error ? err.message : String(err));
    }
    return false;
  }

  const updated = contents
    .split("\n")
    .filter((line) => !line.includes(".ethoko/bin"))
    .join("\n");

  if (updated === contents) {
    return false;
  }

  await writeFile(profilePath, updated, "utf8");
  return true;
}

/**
 * Remove the Ethoko installation directory.
 */
async function removeInstallDirectory(
  installDir: string,
  opts: { debug: boolean },
): Promise<void> {
  try {
    await stat(installDir);
  } catch (err) {
    if (opts.debug) {
      cliInfo(`Install directory not found: ${installDir}`, false);
      cliError(err instanceof Error ? err.message : String(err));
    }
    return;
  }

  await rm(installDir, { recursive: true, force: true });
}

/**
 * Register the CLI uninstall command.
 */
export function registerUninstallCommand(program: Command): void {
  program
    .command("uninstall")
    .description("Uninstall the Ethoko CLI")
    .option("--force", "Skip confirmation prompt", false)
    .option("--debug", "Enable debug logging", false)
    .action(async (options) => {
      const optsParsingResult = z
        .object({
          force: z
            .boolean('The "force" option must be a boolean')
            .default(false),
          debug: z
            .boolean('The "debug" option must be a boolean')
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

      const opts = optsParsingResult.data;
      const installMethod = detectInstallMethod();

      if (installMethod !== "curl") {
        const instruction = UNINSTALL_INSTRUCTIONS[installMethod];
        cliError(
          `Self-uninstall is unavailable for ${installMethod} installs. Run: ${instruction}`,
        );
        process.exitCode = 1;
        return;
      }

      cliInfo("This will remove:", false);
      cliInfo("- ~/.ethoko/bin/ethoko (binary)", false);
      cliInfo("- ~/.ethoko/ (all data and pulled artifacts)", false);
      cliInfo("- PATH entries in ~/.bashrc and ~/.zshrc", false);

      const shouldProceed = await confirmUninstall(opts.force);
      if (!shouldProceed) {
        cliInfo("Uninstall cancelled.", false);
        return;
      }

      try {
        const installDir = path.join(homedir(), ".ethoko");
        await removeInstallDirectory(installDir, opts);

        const profiles = [
          path.join(homedir(), ".bashrc"),
          path.join(homedir(), ".zshrc"),
        ];

        for (const profile of profiles) {
          const removed = await removePathFromProfile(profile, opts);
          if (opts.debug && removed) {
            cliInfo(`Removed PATH entry from ${profile}`, false);
          }
        }

        cliSuccess("Ethoko CLI uninstalled successfully");
      } catch (err) {
        cliError("Uninstall failed. Run with --debug for details.");
        if (opts.debug) {
          cliError(err instanceof Error ? err.message : String(err));
        }
        process.exitCode = 1;
      }
    });
}
