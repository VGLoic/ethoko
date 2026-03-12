import { Command } from "commander";
import { z } from "zod";
import {
  boxHeader,
  displayDifferences,
  error as cliError,
} from "@ethoko/core/cli-ui";
import {
  CliError,
  generateDiffWithTargetRelease,
} from "@ethoko/core/cli-client";
import { LocalStorage } from "@ethoko/core/local-storage";

import type { EthokoCliConfig } from "../config.js";

type GetConfig = (configPath?: string) => Promise<EthokoCliConfig>;

export function registerDiffCommand(
  program: Command,
  getConfig: GetConfig,
): void {
  program
    .command("diff")
    .description("Compare local artifacts with a pulled artifact")
    .option("--artifact-path <path>", "Path to compilation artifacts")
    .option("--id <id>", "Artifact ID")
    .option("--tag <tag>", "Artifact tag")
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

      const paramParsingResult = z
        .object({
          artifactPath: z.string().min(1).optional(),
          id: z.string().optional(),
          tag: z.string().optional(),
          debug: z.boolean().default(config.debug),
          silent: z.boolean().default(false),
        })
        .safeParse(options);
      if (!paramParsingResult.success) {
        cliError("Invalid arguments");
        if (config.debug) {
          console.error(paramParsingResult.error);
        }
        process.exitCode = 1;
        return;
      }
      if (paramParsingResult.data.id && paramParsingResult.data.tag) {
        cliError("Use either --id or --tag, not both");
        process.exitCode = 1;
        return;
      }

      if (!paramParsingResult.data.id && !paramParsingResult.data.tag) {
        cliError("Provide --id or --tag to identify the artifact");
        process.exitCode = 1;
        return;
      }

      const finalArtifactPath =
        paramParsingResult.data.artifactPath || config.compilationOutputPath;

      if (!finalArtifactPath) {
        cliError(
          "Artifact path is required. Provide --artifact-path or set compilationOutputPath in ethoko.json",
        );
        process.exitCode = 1;
        return;
      }

      let search: { type: "id"; id: string } | { type: "tag"; tag: string };
      if (paramParsingResult.data.id) {
        search = { type: "id", id: paramParsingResult.data.id };
      } else if (paramParsingResult.data.tag) {
        search = { type: "tag", tag: paramParsingResult.data.tag };
      } else {
        cliError("Provide --id or --tag to identify the artifact");
        process.exitCode = 1;
        return;
      }

      boxHeader(
        `Comparing with artifact "${config.project}:${search.type === "id" ? search.id : search.tag}"`,
        paramParsingResult.data.silent,
      );

      const localStorage = new LocalStorage(config.pulledArtifactsPath);

      await generateDiffWithTargetRelease(
        finalArtifactPath,
        { project: config.project, search },
        localStorage,
        {
          debug: paramParsingResult.data.debug,
          isCI: process.env.CI === "true" || process.env.CI === "1",
          silent: paramParsingResult.data.silent,
        },
      )
        .then((result) =>
          displayDifferences(result, paramParsingResult.data.silent),
        )
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
