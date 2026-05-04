import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";

import { Command } from "commander";
import { z } from "zod";
import { CommandLogger } from "@/ui/index.js";

import {
  detectInstallMethod,
  type InstallMethod,
} from "./utils/installation.js";
import { AbsolutePath } from "@/utils/path.js";

const UNINSTALL_INSTRUCTIONS: Record<Exclude<InstallMethod, "curl">, string> = {
  "npm-global": "npm uninstall -g @ethoko/cli",
  "npm-local": "npm uninstall @ethoko/cli",
  brew: "brew uninstall ethoko",
  unknown:
    "See https://github.com/VGLoic/ethoko/releases for manual cleanup steps",
};

/**
 * Remove Ethoko PATH entries from a shell profile file.
 */
async function removePathFromProfile(
  logger: CommandLogger,
  profilePath: AbsolutePath,
  opts: { debug: boolean },
): Promise<boolean> {
  let contents: string;
  try {
    contents = await readFile(profilePath.resolvedPath, "utf8");
  } catch (err) {
    if (opts.debug) {
      logger.info(`Skipped missing profile ${profilePath}`);
      logger.error(err instanceof Error ? err.message : String(err));
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

  await writeFile(profilePath.resolvedPath, updated, "utf8");
  return true;
}

/**
 * Remove the Ethoko installation directory.
 */
async function removeInstallDirectory(
  logger: CommandLogger,
  installDir: AbsolutePath,
  opts: { debug: boolean },
): Promise<void> {
  try {
    await stat(installDir.resolvedPath);
  } catch (err) {
    if (opts.debug) {
      logger.info(`Install directory not found: ${installDir}`);
      logger.error(err instanceof Error ? err.message : String(err));
    }
    return;
  }

  await rm(installDir.resolvedPath, { recursive: true, force: true });
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
      const logger = new CommandLogger();
      logger.intro("Uninstalling Ethoko CLI");
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
        logger.error(
          `Invalid command arguments:\n${z.prettifyError(optsParsingResult.error)}`,
        );
        process.exitCode = 1;
        return;
      }

      const opts = optsParsingResult.data;
      const installMethod = detectInstallMethod();

      if (installMethod !== "curl") {
        const instruction = UNINSTALL_INSTRUCTIONS[installMethod];
        logger.error(
          `Self-uninstall is unavailable for ${installMethod} installs. Run: ${instruction}`,
        );
        process.exitCode = 1;
        return;
      }

      const shouldProceed = logger.prompts.confirm({
        message: `This will remove:
- ~/.ethoko/bin/ethoko (binary)
- ~/.ethoko/ (all data and local artifact store)
- PATH entries in ~/.bashrc and ~/.zshrc

Proceed with uninstallation?`,
      });
      if (logger.prompts.isCancel(shouldProceed)) {
        logger.cancel("Uninstall cancelled.");
        return;
      }

      if (!shouldProceed) {
        logger.cancel("Uninstall cancelled.");
        return;
      }

      try {
        const installDir = new AbsolutePath(homedir(), ".ethoko");
        await removeInstallDirectory(logger, installDir, opts);

        const profiles = [
          new AbsolutePath(homedir(), ".bashrc"),
          new AbsolutePath(homedir(), ".zshrc"),
        ];

        for (const profile of profiles) {
          const removed = await removePathFromProfile(logger, profile, opts);
          if (opts.debug && removed) {
            logger.info(`Removed PATH entry from ${profile.resolvedPath}`);
          }
        }

        logger.success("Ethoko CLI uninstalled successfully");
      } catch (err) {
        logger.error("Uninstall failed. Run with --debug for details.");
        if (opts.debug) {
          logger.error(err instanceof Error ? err.message : String(err));
        }
        process.exitCode = 1;
      }
    });
}
