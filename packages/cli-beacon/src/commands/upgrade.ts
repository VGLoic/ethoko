import { Command } from "commander";
import { z } from "zod";
import { CommandLogger } from "@/ui/index.js";

import {
  detectInstallMethod,
  downloadBinary,
  getLatestVersion,
  type InstallMethod,
} from "./utils/installation.js";

const UPGRADE_INSTRUCTIONS: Record<Exclude<InstallMethod, "curl">, string> = {
  "npm-global": "npm install -g @ethoko/cli@latest",
  "npm-local": "npm install @ethoko/cli@latest",
  brew: "brew upgrade ethoko",
  unknown: "See https://github.com/VGLoic/ethoko/releases for manual downloads",
};

/**
 * Register the CLI upgrade command.
 */
export function registerUpgradeCommand(program: Command): void {
  program
    .command("upgrade")
    .description("Upgrade the Ethoko CLI")
    .option("--debug", "Enable debug logging", false)
    .action(async (options) => {
      const logger = new CommandLogger();
      const optsParsingResult = z
        .object({
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
        const instruction = UPGRADE_INSTRUCTIONS[installMethod];
        logger.error(
          `Self-upgrade is unavailable for ${installMethod} installs. Run: ${instruction}`,
        );
        process.exitCode = 1;
        return;
      }

      try {
        logger.info("Fetching latest CLI release...");
        const latestVersion = await getLatestVersion({ debug: opts.debug });
        logger.info(`Latest version is ${latestVersion}`);

        const targetPath = process.execPath;
        logger.info(`Downloading binary to ${targetPath}`);
        await downloadBinary(latestVersion, targetPath, { debug: opts.debug });

        logger.success("Ethoko CLI upgraded successfully");
      } catch (err) {
        logger.error("Upgrade failed. Run with --debug for details.");
        if (opts.debug) {
          logger.error(err instanceof Error ? err.message : String(err));
        }
        process.exitCode = 1;
      }
    });
}
