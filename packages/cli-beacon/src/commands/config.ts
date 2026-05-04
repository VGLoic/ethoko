import { styleText } from "node:util";
import { Command } from "commander";
import { LOG_COLORS, CommandLogger } from "@/ui/index.js";
import { toAsyncResult } from "@/utils/result.js";

import type { EthokoCliConfig } from "../config";
import type { ProjectConfig } from "../config/projects";

type GetConfig = () => Promise<EthokoCliConfig>;

export function registerConfigCommand(
  program: Command,
  getConfig: GetConfig,
): void {
  program
    .command("config")
    .description("Show effective configuration")
    .option("--silent", "Suppress output", false)
    .action(async (options) => {
      const logger = new CommandLogger(options.silent);

      const configResult = await toAsyncResult(getConfig());
      if (!configResult.success) {
        logger.error(
          configResult.error instanceof Error
            ? configResult.error.message
            : String(configResult.error),
        );
        process.exitCode = 1;
        return;
      }

      const config = configResult.value;

      logger.intro("Ethoko Configuration");

      const sourcesLines: string[] = [
        "",
        `  Global: ${config.globalConfigPath ?? "~/.ethoko/config.json"} (${config.globalConfigPath ? "found" : "not found"})`,
        `  Local:  ${config.localConfigPath ?? "./ethoko.config.json"} (${config.localConfigPath ? "found" : "not found"})`,
        "",
      ];
      logger.note(sourcesLines.join("\n"), "Config Sources");

      const effectiveLines: string[] = [
        "",
        `  Local Artifact Store Path: ${config.localArtifactStorePath} ${styleText("dim", `(from ${config.localArtifactStorePathSource})`)}`,
        `  Typings Path: ${config.typingsPath}`,
        `  Compilation Output Path: ${config.compilationOutputPath ?? styleText("dim", "(not set)")}`,
        `  Debug: ${config.debug}`,
        "",
      ];
      logger.note(effectiveLines.join("\n"), "Effective Configuration");

      const { projects, localProjectNames, globalProjectNames } = config;
      if (projects.length > 0) {
        const projectLines: string[] = [""];
        for (const project of projects) {
          const sourceLabel = getSourceLabel(
            project.name,
            localProjectNames,
            globalProjectNames,
          );
          projectLines.push(
            styleText(
              ["bold", LOG_COLORS.log],
              `  • ${project.name} ${styleText("dim", sourceLabel)}`,
            ),
          );
          projectLines.push(
            styleText(LOG_COLORS.log, `    Storage: ${storageLabel(project)}`),
          );
          projectLines.push("");
        }
        logger.note(
          projectLines.join("\n"),
          `Projects (${projects.length} total)`,
        );
      }

      logger.outro();
    });
}

function getSourceLabel(
  name: string,
  localNames: ReadonlySet<string>,
  globalNames: ReadonlySet<string>,
): string {
  const inLocal = localNames.has(name);
  const inGlobal = globalNames.has(name);
  if (inLocal && inGlobal) return "[local - overrides global]";
  if (inLocal) return "[local]";
  return "[global]";
}

function storageLabel(project: ProjectConfig): string {
  const { storage } = project;
  if (storage.type === "aws") {
    return `AWS S3 (${storage.region}, bucket: ${storage.bucketName})`;
  }
  return `Filesystem (${storage.path})`;
}
