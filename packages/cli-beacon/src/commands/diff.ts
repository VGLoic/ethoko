import { styleText } from "node:util";
import { Command } from "commander";
import { z } from "zod";
import {
  boxHeader,
  boxSummary,
  error as cliError,
  LOG_COLORS,
  success,
} from "@/ui/index.js";
import {
  CliError,
  Difference,
  generateDiffWithTargetRelease,
} from "@/client/index.js";
import { PulledArtifactStore } from "@/pulled-artifact-store/pulled-artifact-store.js";

import type { EthokoCliConfig } from "../config/config.js";

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
          artifactPath: z
            .string('The "artifactPath" option must be a string')
            .min(
              1,
              'The "artifactPath" cannot be empty. Provide a valid path to compilation artifacts or set compilationOutputPath in ethoko.config.json',
            )
            .optional(),
          id: z
            .string('The "id" option must be a string')
            .min(
              1,
              'If provided, the "id" cannot be empty. Provide a valid artifact ID.',
            )
            .optional(),
          tag: z
            .string('The "tag" option must be a string')
            .min(
              1,
              'If provided, the "tag" cannot be empty. Provide a valid tag name.',
            )
            .optional(),
          debug: z
            .boolean('The "debug" option must be a boolean')
            .default(config.debug),
          silent: z
            .boolean('The "silent" option must be a boolean')
            .default(false),
        })
        .transform((data, ctx) => {
          if (data.id && data.tag) {
            ctx.addIssue({
              code: "custom",
              message:
                "Provide either --id or --tag to identify the artifact, not both",
            });
            return z.NEVER;
          }
          let search:
            | { type: "id"; id: string }
            | { type: "tag"; tag: string }
            | null = null;
          if (data.id) {
            search = { type: "id", id: data.id };
          } else if (data.tag) {
            search = { type: "tag", tag: data.tag };
          }
          if (!search) {
            ctx.addIssue({
              code: "custom",
              message:
                "Either --id or --tag is required to identify the artifact. Example: --tag v1.0.0 or --id abc123def",
            });
            return z.NEVER;
          }

          return {
            artifactPath: data.artifactPath,
            debug: data.debug,
            silent: data.silent,
            search,
          };
        })
        .safeParse(options);
      if (!paramParsingResult.success) {
        cliError(
          `Invalid command arguments:\n${z.prettifyError(paramParsingResult.error)}`,
        );
        process.exitCode = 1;
        return;
      }

      const finalArtifactPath =
        paramParsingResult.data.artifactPath || config.compilationOutputPath;

      if (!finalArtifactPath) {
        cliError(
          "Artifact path is required. Provide --artifact-path or set compilationOutputPath in ethoko.config.json",
        );
        process.exitCode = 1;
        return;
      }

      boxHeader(
        `Comparing with artifact "${config.project}:${paramParsingResult.data.search.type === "id" ? paramParsingResult.data.search.id : paramParsingResult.data.search.tag}"`,
        paramParsingResult.data.silent,
      );

      const pulledArtifactStore = new PulledArtifactStore(
        config.pulledArtifactsPath,
      );

      await generateDiffWithTargetRelease(
        finalArtifactPath,
        { project: config.project, search: paramParsingResult.data.search },
        pulledArtifactStore,
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

export function displayDifferences(
  differences: Difference[],
  silent = false,
): void {
  if (differences.length === 0) {
    if (!silent) {
      console.error("");
      success("No differences found");
      console.error("");
    }
    return;
  }

  const added = differences.filter((d) => d.status === "added");
  const removed = differences.filter((d) => d.status === "removed");
  const changed = differences.filter((d) => d.status === "changed");

  const summaryLines: string[] = [];

  if (changed.length > 0) {
    summaryLines.push(styleText(["bold", LOG_COLORS.warn], "Changed:"));
    changed.forEach((diff) => {
      summaryLines.push(
        styleText(LOG_COLORS.warn, `  • ${diff.name} (${diff.path})`),
      );
    });
  }

  if (added.length > 0) {
    if (summaryLines.length > 0) summaryLines.push("");
    summaryLines.push(styleText(["bold", LOG_COLORS.success], "Added:"));
    added.forEach((diff) => {
      summaryLines.push(
        styleText(LOG_COLORS.success, `  • ${diff.name} (${diff.path})`),
      );
    });
  }

  if (removed.length > 0) {
    if (summaryLines.length > 0) summaryLines.push("");
    summaryLines.push(styleText(["bold", LOG_COLORS.error], "Removed:"));
    removed.forEach((diff) => {
      summaryLines.push(
        styleText(LOG_COLORS.error, `  • ${diff.name} (${diff.path})`),
      );
    });
  }

  boxSummary("Differences Found", summaryLines, silent);
}
