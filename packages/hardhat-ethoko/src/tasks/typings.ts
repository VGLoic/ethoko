import { styleText } from "node:util";

import { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { z } from "zod";
import { boxHeader, error as cliError, LOG_COLORS } from "@ethoko/core/cli-ui";
import {
  CliError,
  generateArtifactsSummariesAndTypings,
} from "@ethoko/core/cli-client";
import { LocalStorage } from "@ethoko/core/local-storage";

interface TypingsTaskArguments {
  debug?: boolean;
  silent?: boolean;
}

export default async function (
  taskArguments: TypingsTaskArguments,
  hre: HardhatRuntimeEnvironment,
) {
  const ethokoConfig = hre.config.ethoko;
  if (!ethokoConfig) {
    cliError("Ethoko is not configured");
    process.exitCode = 1;
    return;
  }

  const parsingResult = z
    .object({
      debug: z.boolean().default(ethokoConfig.debug),
      silent: z.boolean().default(false),
    })
    .safeParse(taskArguments);

  if (!parsingResult.success) {
    cliError("Invalid arguments");
    if (ethokoConfig.debug) {
      console.error(parsingResult.error);
    }
    process.exitCode = 1;
    return;
  }

  boxHeader("Generating typings", parsingResult.data.silent);

  const localStorage = new LocalStorage(ethokoConfig.pulledArtifactsPath);

  await generateArtifactsSummariesAndTypings(
    ethokoConfig.typingsPath,
    localStorage,
    {
      debug: parsingResult.data.debug,
      silent: parsingResult.data.silent,
    },
  )
    .then(() => {
      if (!parsingResult.data.silent) {
        console.error(
          styleText(
            LOG_COLORS.success,
            `\n✔ Typings generated at ${ethokoConfig.typingsPath}`,
          ),
        );
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
}
