import fs from "node:fs/promises";
import { styleText } from "node:util";

import { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { z } from "zod";
import { boxHeader, error as cliError, LOG_COLORS } from "@ethoko/core/cli-ui";
import {
  exportContractArtifact,
  type ExportContractArtifactResult,
  CliError,
} from "@ethoko/core/cli-client";
import { LocalStorage } from "@ethoko/core/local-storage";

interface ExportTaskArguments {
  contract?: string;
  id?: string;
  tag?: string;
  project?: string;
  output?: string;
  debug?: boolean;
  silent?: boolean;
}

export default async function (
  taskArguments: ExportTaskArguments,
  hre: HardhatRuntimeEnvironment,
) {
  const ethokoConfig = hre.config.ethoko;
  if (!ethokoConfig) {
    cliError("Ethoko is not configured");
    process.exitCode = 1;
    return;
  }

  const optsParsingResult = z
    .object({
      contract: z.string().min(1),
      id: z.string().optional(),
      tag: z.string().optional(),
      project: z.string().optional().default(ethokoConfig.project),
      output: z.string().optional(),
      debug: z.boolean().default(ethokoConfig.debug),
      silent: z.boolean().default(false),
    })
    .safeParse(taskArguments);
  if (!optsParsingResult.success) {
    cliError("Invalid arguments");
    if (ethokoConfig.debug) {
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

  if (optsParsingResult.data.output) {
    boxHeader(
      `Exporting contract artifact for "${optsParsingResult.data.contract}" from "${optsParsingResult.data.project}:${search.type === "tag" ? search.tag : search.id}"`,
      optsParsingResult.data.silent,
    );
  }

  const localStorage = new LocalStorage(ethokoConfig.pulledArtifactsPath);

  await exportContractArtifact(
    { project: optsParsingResult.data.project, search },
    optsParsingResult.data.contract,
    localStorage,
    {
      debug: optsParsingResult.data.debug,
      silent: optsParsingResult.data.silent,
    },
  )
    .then(async (result: ExportContractArtifactResult) => {
      if (optsParsingResult.data.output) {
        const artifactJson = JSON.stringify(result, null, 2);

        try {
          await fs.access(optsParsingResult.data.output);
          if (!optsParsingResult.data.silent) {
            console.error(
              styleText(
                LOG_COLORS.warn,
                `⚠ File ${optsParsingResult.data.output} already exists, overwriting...`,
              ),
            );
          }
        } catch {
          // File does not exist. We create the necessary directories if they don't exist, and then create the file.
          const dir = optsParsingResult.data.output
            .split("/")
            .slice(0, -1)
            .join("/");
          await fs.mkdir(dir, { recursive: true });
        }

        await fs.writeFile(optsParsingResult.data.output, `${artifactJson}\n`);

        if (!optsParsingResult.data.silent) {
          const contractIdentifier = `${result.sourceName}:${result.contractName}`;
          const artifactLabel = result.tag
            ? `${result.project}:${result.tag}`
            : `${result.project}:${result.id}`;
          console.error(
            styleText(
              LOG_COLORS.success,
              `\n✔ Exported contract artifact for ${contractIdentifier} from ${artifactLabel} to ${optsParsingResult.data.output}`,
            ),
          );
        }
        return;
      }

      console.log(JSON.stringify(result, null, 2));
    })
    .catch((err: unknown) => {
      if (err instanceof CliError) {
        cliError(err.message);
      } else {
        cliError(
          "An unexpected error occurred, please fill an issue with the error details if the problem persists",
        );
        if (err instanceof Error) {
          console.error(err);
        }
      }
      process.exitCode = 1;
    });
}
