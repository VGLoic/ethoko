import { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { z } from "zod";
import {
  boxHeader,
  error as cliError,
  displayRestoreResult,
} from "@ethoko/core/cli-ui";
import { CliError, restore, type RestoreResult } from "@ethoko/core/cli-client";
import {
  LocalStorageProvider,
  S3BucketProvider,
} from "@ethoko/core/storage-provider";
import { LocalStorage } from "@ethoko/core/local-storage";

interface RestoreTaskArguments {
  id?: string;
  tag?: string;
  project?: string;
  output?: string;
  force?: boolean;
  debug?: boolean;
  silent?: boolean;
}

export default async function (
  taskArguments: RestoreTaskArguments,
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
      id: z.string().optional(),
      tag: z.string().optional(),
      project: z.string().optional().default(ethokoConfig.project),
      output: z.string().min(1),
      force: z.boolean().default(false),
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

  let search: { type: "id"; id: string } | { type: "tag"; tag: string };
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
    `Restoring artifact "${optsParsingResult.data.project}:${search.type === "id" ? search.id : search.tag}"`,
    optsParsingResult.data.silent,
  );

  const storageProvider =
    ethokoConfig.storageConfiguration.type === "aws"
      ? new S3BucketProvider({
          bucketName: ethokoConfig.storageConfiguration.awsBucketName,
          bucketRegion: ethokoConfig.storageConfiguration.awsRegion,
          accessKeyId: ethokoConfig.storageConfiguration.awsAccessKeyId,
          secretAccessKey: ethokoConfig.storageConfiguration.awsSecretAccessKey,
          role: ethokoConfig.storageConfiguration.awsRole,
          debug: optsParsingResult.data.debug,
        })
      : new LocalStorageProvider({
          path: ethokoConfig.storageConfiguration.path,
          debug: optsParsingResult.data.debug,
        });
  const localStorage = new LocalStorage(ethokoConfig.pulledArtifactsPath);

  await restore(
    { project: optsParsingResult.data.project, search },
    optsParsingResult.data.output,
    storageProvider,
    localStorage,
    {
      force: optsParsingResult.data.force,
      debug: ethokoConfig.debug || optsParsingResult.data.debug,
      silent: optsParsingResult.data.silent,
    },
  )
    .then((result: RestoreResult) =>
      displayRestoreResult(result, optsParsingResult.data.silent),
    )
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
