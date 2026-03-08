import { Command } from "commander";
import { z } from "zod";
import {
  boxHeader,
  displayInspectResult,
  displayInspectResultJson,
  error as cliError,
} from "@ethoko/core/cli-ui";
import { CliError, inspectArtifact } from "@ethoko/core/cli-client";
import { LocalStorage } from "@ethoko/core/local-storage";

import type { EthokoCliConfig } from "../config.js";

type GetConfig = (configPath?: string) => Promise<EthokoCliConfig>;

export function registerInspectCommand(
  program: Command,
  getConfig: GetConfig,
): void {
  program
    .command("inspect")
    .description("Inspect a pulled artifact")
    .option("--id <id>", "Artifact ID")
    .option("--tag <tag>", "Artifact tag")
    .option("--project <project>", "Project name")
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

      const optsParsingResult = z
        .object({
          id: z.string().optional(),
          tag: z.string().optional(),
          project: z.string().optional().default(config.project),
          json: z.boolean().default(false),
          debug: z.boolean().default(config.debug),
          silent: z.boolean().default(false),
        })
        .safeParse(options);
      if (!optsParsingResult.success) {
        cliError("Invalid arguments");
        if (config.debug) {
          console.error(optsParsingResult.error);
        }
        process.exitCode = 1;
        return;
      }

      if (optsParsingResult.data.id && optsParsingResult.data.tag) {
        cliError("The ID and tag parameters can not be used together");
        process.exitCode = 1;
        return;
      }

      let search: { type: "tag"; tag: string } | { type: "id"; id: string };
      if (optsParsingResult.data.id) {
        search = { type: "id", id: optsParsingResult.data.id };
      } else if (optsParsingResult.data.tag) {
        search = { type: "tag", tag: optsParsingResult.data.tag };
      } else {
        cliError("The artifact must be identified by a tag or an ID");
        process.exitCode = 1;
        return;
      }

      boxHeader(
        `Inspecting artifact "${optsParsingResult.data.project}:${search.type === "tag" ? search.tag : search.id}"`,
        optsParsingResult.data.silent,
      );

      const localStorage = new LocalStorage(config.pulledArtifactsPath);

      await inspectArtifact(
        { project: optsParsingResult.data.project, search },
        localStorage,
        {
          debug: optsParsingResult.data.debug,
          silent: optsParsingResult.data.silent,
        },
      )
        .then((result) => {
          if (optsParsingResult.data.json) {
            displayInspectResultJson(result, optsParsingResult.data.silent);
          } else {
            displayInspectResult(result, optsParsingResult.data.silent);
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
