import "hardhat/types/config";
import { extendConfig, scope } from "hardhat/config";
import { HardhatConfig, HardhatUserConfig } from "hardhat/types/config";
import { z } from "zod";
import fs from "node:fs/promises";
import { styleText } from "node:util";
import { LocalStorage } from "@ethoko/core/local-storage";
import {
  LocalStorageProvider,
  S3BucketProvider,
} from "@ethoko/core/storage-provider";
import {
  boxHeader,
  error as cliError,
  info as cliInfo,
  displayInspectResult,
  displayInspectResultJson,
  displayListArtifactsResults,
  displayPullResults,
  displayPushResult,
  displayDifferences,
  displayListArtifactsResultsJson,
  displayRestoreResult,
} from "@ethoko/core/cli-ui";
import {
  CliError,
  exportContractArtifact,
  generateArtifactsSummariesAndTypings,
  generateDiffWithTargetRelease,
  inspectArtifact,
  listPulledArtifacts,
  pull,
  push,
  restore,
  type ExportContractArtifactResult,
  type RestoreResult,
} from "@ethoko/core/cli-client";
import { EthokoHardhatConfigSchema, EthokoHardhatUserConfig } from "./config";

export { type EthokoHardhatUserConfig };

declare module "hardhat/types/config" {
  export interface HardhatUserConfig {
    ethoko?: EthokoHardhatUserConfig;
  }

  export interface HardhatConfig {
    ethoko?: z.infer<typeof EthokoHardhatConfigSchema>;
  }
}

extendConfig(
  (config: HardhatConfig, userConfig: Readonly<HardhatUserConfig>) => {
    if (userConfig.ethoko === undefined) {
      config.ethoko = undefined;
      return;
    }

    const ethokoParsingResult = EthokoHardhatConfigSchema.safeParse(
      userConfig.ethoko,
    );

    if (!ethokoParsingResult.success) {
      console.error(
        styleText(
          LOG_COLORS.warn,
          `Configuration for Ethoko has been found but seems invalid. Please consult the below errors: \n${ethokoParsingResult.error.issues.map(
            (error) => {
              return `  - ${error.path.join(".")}: ${error.message} (${error.code})`;
            },
          )}`,
        ),
      );
      return;
    }

    config.ethoko = ethokoParsingResult.data;
  },
);

const ethokoScope = scope("ethoko", "Ethoko Hardhat tasks");

ethokoScope
  .task("pull", "Pull one or many artifacts of a project.")
  .setDescription(
    `Pull one or many artifacts of a project.

By default, the project is the one configured in the Hardhat configuration.

One artifact can be pulled by tag
  npx hardhat ethoko pull --tag v1.2.3
or by ID
  npx hardhat ethoko pull --id dcauXtavGLxC

All artifacts for a project can be downloaded
  npx hardhat ethoko pull

A different project can be specified
  npx hardhat ethoko pull --project another-project

Already downloaded artifacts are not downloaded again by default, enable the force flag to force the download.


`,
  )
  .addOptionalParam(
    "id",
    "The ID of the artifact to pull, can not be used with the `tag` parameter",
  )
  .addOptionalParam(
    "tag",
    "The tag of the artifact to pull, can not be used with the `id` parameter",
  )
  .addOptionalParam(
    "project",
    "The project to pull the artifacts from, defaults to the configured project",
  )
  .addFlag(
    "force",
    "Force the pull of the artifacts, replacing previously downloaded ones",
  )
  .addFlag("debug", "Enable debug mode")
  .addFlag("silent", "Suppress CLI output (except errors and warnings)")
  .setAction(async (opts, hre) => {
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
        force: z.boolean().default(false),
        debug: z.boolean().default(ethokoConfig.debug),
        silent: z.boolean().default(false),
      })
      .safeParse(opts);
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

    let search:
      | { type: "id"; id: string }
      | { type: "tag"; tag: string }
      | null = null;
    if (optsParsingResult.data.id) {
      search = { type: "id", id: optsParsingResult.data.id };
    } else if (optsParsingResult.data.tag) {
      search = { type: "tag", tag: optsParsingResult.data.tag };
    }

    if (search) {
      boxHeader(
        `Pulling artifact "${optsParsingResult.data.project}:${search.type === "id" ? search.id : search.tag}"`,
        optsParsingResult.data.silent,
      );
    } else {
      boxHeader(
        `Pulling artifacts for "${optsParsingResult.data.project}"`,
        optsParsingResult.data.silent,
      );
    }

    const storageProvider =
      ethokoConfig.storageConfiguration.type === "aws"
        ? new S3BucketProvider({
            bucketName: ethokoConfig.storageConfiguration.awsBucketName,
            bucketRegion: ethokoConfig.storageConfiguration.awsRegion,
            credentials: ethokoConfig.storageConfiguration.credentials,
            debug: optsParsingResult.data.debug,
          })
        : new LocalStorageProvider({
            path: ethokoConfig.storageConfiguration.path,
            debug: optsParsingResult.data.debug,
          });
    const localStorage = new LocalStorage(ethokoConfig.pulledArtifactsPath);
    await pull(
      optsParsingResult.data.project,
      search,
      storageProvider,
      localStorage,
      {
        force: optsParsingResult.data.force,
        debug: ethokoConfig.debug || optsParsingResult.data.debug,
        silent: optsParsingResult.data.silent,
      },
    )
      .then((result) =>
        displayPullResults(
          optsParsingResult.data.project,
          result,
          optsParsingResult.data.silent,
        ),
      )
      .catch((err) => {
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
  });

ethokoScope
  .task("push", "Push a compilation artifact.")
  .setDescription(
    `Push a compilation artifact.

The artifact will be stored in the configured project. An identifier is derived for the artifact.
  npx hardhat ethoko push --artifact-path ./path/to-my-artifact/artifact.json

If a compilationOutputPath is configured, the --artifact-path flag is optional:
  npx hardhat ethoko push --tag v1.2.3

If a tag is provided, the artifact will also be identified by it:
  npx hardhat ethoko push --artifact-path ./path/to-my-artifact/artifact.json --tag v1.2.3

If the provided tag already exists in the storage, the push will be aborted unless the force flag is enabled.
`,
  )
  .addOptionalParam("artifactPath", "The compilation artifact path to push")
  .addOptionalParam("tag", "Tag of the artifact")
  .addFlag(
    "force",
    "Force the push of the artifact even if it already exists in the storage",
  )
  .addFlag("debug", "Enable debug mode")
  .addFlag("silent", "Suppress CLI output (except errors and warnings)")
  .setAction(async (opts, hre) => {
    const ethokoConfig = hre.config.ethoko;
    if (!ethokoConfig) {
      cliError("Ethoko is not configured");
      process.exitCode = 1;
      return;
    }

    const optsParsingResult = z
      .object({
        artifactPath: z.string().min(1).optional(),
        tag: z.string().optional(),
        force: z.boolean().default(false),
        debug: z.boolean().default(ethokoConfig.debug),
        silent: z.boolean().default(false),
      })
      .safeParse(opts);

    if (!optsParsingResult.success) {
      cliError("Invalid arguments");
      if (ethokoConfig.debug) {
        console.error(optsParsingResult.error);
      }
      process.exitCode = 1;
      return;
    }

    const finalArtifactPath =
      optsParsingResult.data.artifactPath || ethokoConfig.compilationOutputPath;

    if (!finalArtifactPath) {
      cliError(
        "Artifact path must be provided either via --artifact-path flag or compilationOutputPath in config",
      );
      process.exitCode = 1;
      return;
    }

    boxHeader(
      `Pushing artifact to "${ethokoConfig.project}"${optsParsingResult.data.tag ? ` with tag "${optsParsingResult.data.tag}"` : ""}`,
      optsParsingResult.data.silent,
    );

    const storageProvider =
      ethokoConfig.storageConfiguration.type === "aws"
        ? new S3BucketProvider({
            bucketName: ethokoConfig.storageConfiguration.awsBucketName,
            bucketRegion: ethokoConfig.storageConfiguration.awsRegion,
            credentials: ethokoConfig.storageConfiguration.credentials,
            debug: optsParsingResult.data.debug,
          })
        : new LocalStorageProvider({
            path: ethokoConfig.storageConfiguration.path,
            debug: optsParsingResult.data.debug,
          });

    await push(
      finalArtifactPath,
      ethokoConfig.project,
      optsParsingResult.data.tag,
      storageProvider,
      {
        force: optsParsingResult.data.force,
        debug: ethokoConfig.debug || optsParsingResult.data.debug,
        isCI: process.env.CI === "true" || process.env.CI === "1",
        silent: optsParsingResult.data.silent,
      },
    )
      .then((result) =>
        displayPushResult(
          ethokoConfig.project,
          optsParsingResult.data.tag,
          result,
          optsParsingResult.data.silent,
        ),
      )
      .catch((err) => {
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
  });

ethokoScope
  .task("typings", "Generate typings based on the existing artifacts.")
  .setDescription(
    `Generate typings based on the existing artifacts.
The typings will be generated in the configured typings path.
`,
  )
  .addFlag("debug", "Enable debug mode")
  .addFlag("silent", "Suppress CLI output (except errors and warnings)")
  .setAction(async (opts, hre) => {
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
      .safeParse(opts);

    if (!parsingResult.success) {
      cliError("Invalid arguments");
      if (ethokoConfig.debug || opts.debug) {
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
      .then(async () => {
        // We path the `import { ... } from "./summary-exports.js" to `import { ... } from "./summary-exports"` in the generated typings files to avoid issues with different module resolutions (commonjs vs es modules) in different projects.
        // This is a bit of a hack but it works and avoids having to configure the module resolution in each project.
        try {
          const indexFileContent = await fs.readFile(
            `${ethokoConfig.typingsPath}/index.ts`,
            "utf-8",
          );
          const updatedIndexFileContent = indexFileContent.replace(
            /from "\.\/summary-exports\.js"/g,
            'from "./summary-exports"',
          );
          await fs.writeFile(
            `${ethokoConfig.typingsPath}/index.ts`,
            updatedIndexFileContent,
          );
        } catch (err) {
          if (ethokoConfig.debug || parsingResult.data.debug) {
            console.error(err);
          }
          throw new CliError(
            "An error occurred while updating the generated index.ts file, please check the error details and try again",
          );
        }
      })
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
          if (err instanceof Error) {
            console.error(err);
          }
        }
        process.exitCode = 1;
      });
  });

ethokoScope
  .task(
    "artifacts",
    "List the artifacts that have been pulled with their associated projects.",
  )
  .addFlag("debug", "Enable debug mode")
  .addFlag("silent", "Suppress CLI output (except errors and warnings)")
  .addFlag("json", "Output results in JSON format")
  .setAction(async (opts, hre) => {
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
        json: z.boolean().default(false),
      })
      .safeParse(opts);

    if (!parsingResult.success) {
      cliError("Invalid arguments");
      if (ethokoConfig.debug) {
        console.error(parsingResult.error);
      }
      process.exitCode = 1;
      return;
    }

    boxHeader("Listing artifacts", parsingResult.data.silent);

    const localStorage = new LocalStorage(ethokoConfig.pulledArtifactsPath);

    await listPulledArtifacts(localStorage, {
      debug: parsingResult.data.debug,
      silent: parsingResult.data.silent,
    })
      .then((result) => {
        if (parsingResult.data.json) {
          displayListArtifactsResultsJson(result, parsingResult.data.silent);
        } else {
          displayListArtifactsResults(result, parsingResult.data.silent);
        }
      })
      .catch((err) => {
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
  });

ethokoScope
  .task("inspect", "Inspect a local compilation artifact.")
  .setDescription(
    `Inspect a locally pulled artifact.

The artifact must be identified by tag or ID. By default, the project is the one configured in the Hardhat configuration.

Inspect by tag
  npx hardhat ethoko inspect --tag v1.2.3

Inspect by ID
  npx hardhat ethoko inspect --id dcauXtavGLxC

Target a different project
  npx hardhat ethoko inspect --project another-project --tag v1.2.3

Output JSON for scripting
  npx hardhat ethoko inspect --tag v1.2.3 --json
`,
  )
  .addOptionalParam(
    "id",
    "The ID of the artifact to inspect, can not be used with the `tag` parameter",
  )
  .addOptionalParam(
    "tag",
    "The tag of the artifact to inspect, can not be used with the `id` parameter",
  )
  .addOptionalParam(
    "project",
    "The project to inspect the artifacts from, defaults to the configured project",
  )
  .addFlag("json", "Output results in JSON format")
  .addFlag("debug", "Enable debug mode")
  .addFlag("silent", "Suppress CLI output (except errors and warnings)")
  .setAction(async (opts, hre) => {
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
        json: z.boolean().default(false),
        debug: z.boolean().default(ethokoConfig.debug),
        silent: z.boolean().default(false),
      })
      .safeParse(opts);
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
      search = { type: "tag", tag: optsParsingResult.data.tag! };
    } else {
      cliError("The artifact must be identified by a tag or an ID");
      process.exitCode = 1;
      return;
    }

    boxHeader(
      `Inspecting artifact "${optsParsingResult.data.project}:${search.type === "tag" ? search.tag : search.id}"`,
      optsParsingResult.data.silent,
    );

    const localStorage = new LocalStorage(ethokoConfig.pulledArtifactsPath);

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
  });

ethokoScope
  .task("export", "Export contract artifact from a pulled artifact.")
  .setDescription(
    `Export a contract ABI from a locally pulled artifact.

The artifact must be identified by tag or ID. By default, the project is the one configured in the Hardhat configuration.

Export by tag
  npx hardhat ethoko export --tag v1.2.3 --contract Counter

Export by ID
  npx hardhat ethoko export --id dcauXtavGLxC --contract contracts/Counter.sol:Counter

Export to a file (overwrites if exists)
  npx hardhat ethoko export --tag v1.2.3 --contract Counter --output ./Counter.abi.json

Pipe to another tool
  npx hardhat ethoko export --tag v1.2.3 --contract Counter | jq
`,
  )
  .addOptionalParam(
    "contract",
    "Contract name or fully qualified name (sourcePath:contractName)",
  )
  .addOptionalParam(
    "id",
    "The ID of the artifact to export from, can not be used with the `tag` parameter",
  )
  .addOptionalParam(
    "tag",
    "The tag of the artifact to export from, can not be used with the `id` parameter",
  )
  .addOptionalParam(
    "project",
    "The project to export from, defaults to the configured project",
  )
  .addOptionalParam(
    "output",
    "Output file path (prints to stdout if omitted, allowing piping/redirection)",
  )
  .addFlag("debug", "Enable debug mode")
  .addFlag("silent", "Suppress CLI output (except errors and warnings)")
  .setAction(async (opts, hre) => {
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
      .safeParse(opts);
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

          await fs.writeFile(
            optsParsingResult.data.output,
            `${artifactJson}\n`,
          );

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
  });

ethokoScope
  .task(
    "restore",
    "Restore original compilation artifacts from a pulled artifact.",
  )
  .setDescription(
    `Restore original compilation artifacts from a locally pulled artifact.

The artifact must be identified by tag or ID. By default, the project is the one configured in the Hardhat configuration.

Restore by tag
  npx hardhat ethoko restore --tag v1.2.3 --output ./restored

Restore by ID
  npx hardhat ethoko restore --id dcauXtavGLxC --output ./restored

Force overwrite existing directory
  npx hardhat ethoko restore --tag v1.2.3 --output ./restored --force
`,
  )
  .addOptionalParam(
    "id",
    "The ID of the artifact to restore, can not be used with the `tag` parameter",
  )
  .addOptionalParam(
    "tag",
    "The tag of the artifact to restore, can not be used with the `id` parameter",
  )
  .addOptionalParam(
    "project",
    "The project to restore from, defaults to the configured project",
  )
  .addParam(
    "output",
    "Output directory path where the artifacts will be restored",
  )
  .addFlag("force", "Overwrite output directory if it already exists")
  .addFlag("debug", "Enable debug mode")
  .addFlag("silent", "Suppress CLI output (except errors and warnings)")
  .setAction(async (opts, hre) => {
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
      .safeParse(opts);
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

    boxHeader(
      `Restoring artifact "${optsParsingResult.data.project}:${search.type === "tag" ? search.tag : search.id}"`,
      optsParsingResult.data.silent,
    );

    const storageProvider =
      ethokoConfig.storageConfiguration.type === "aws"
        ? new S3BucketProvider({
            bucketName: ethokoConfig.storageConfiguration.awsBucketName,
            bucketRegion: ethokoConfig.storageConfiguration.awsRegion,
            credentials: ethokoConfig.storageConfiguration.credentials,
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
  });

ethokoScope
  .task(
    "diff",
    "Compare a local compilation artifacts with an existing release.",
  )
  .addOptionalParam("artifactPath", "The compilation artifact path to compare")
  .addOptionalParam(
    "id",
    "The ID of the artifact to compare with, can not be used with the `tag` parameter",
  )
  .addOptionalParam(
    "tag",
    "The tag of the artifact to compare with, can not be used with the `id` parameter",
  )
  .addFlag("debug", "Enable debug mode")
  .addFlag("silent", "Suppress CLI output (except errors and warnings)")
  .setAction(async (opts, hre) => {
    const ethokoConfig = hre.config.ethoko;
    if (!ethokoConfig) {
      cliError("Ethoko is not configured");
      process.exitCode = 1;
      return;
    }

    const paramParsingResult = z
      .object({
        artifactPath: z.string().min(1).optional(),
        id: z.string().optional(),
        tag: z.string().optional(),
        debug: z.boolean().default(ethokoConfig.debug),
        silent: z.boolean().default(false),
      })
      .safeParse(opts);
    if (!paramParsingResult.success) {
      cliError("Invalid arguments");
      if (ethokoConfig.debug) {
        console.error(paramParsingResult.error);
      }
      process.exitCode = 1;
      return;
    }
    if (paramParsingResult.data.id && paramParsingResult.data.tag) {
      cliError("The ID and tag parameters can not be used together");
      process.exitCode = 1;
      return;
    }

    if (!paramParsingResult.data.id && !paramParsingResult.data.tag) {
      cliError("The artifact must be identified by a tag or an ID");
      process.exitCode = 1;
      return;
    }

    const finalArtifactPath =
      paramParsingResult.data.artifactPath ||
      ethokoConfig.compilationOutputPath;

    if (!finalArtifactPath) {
      cliError(
        "Artifact path must be provided either via --artifact-path flag or compilationOutputPath in config",
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
      cliError("The artifact must be identified by a tag or an ID");
      process.exitCode = 1;
      return;
    }

    boxHeader(
      `Comparing with artifact "${ethokoConfig.project}:${search.type === "id" ? search.id : search.tag}"`,
      paramParsingResult.data.silent,
    );

    const localStorage = new LocalStorage(ethokoConfig.pulledArtifactsPath);

    await generateDiffWithTargetRelease(
      finalArtifactPath,
      { project: ethokoConfig.project, search },
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
  });

ethokoScope
  .task("help", "Use `npx hardhat help ethoko` instead")
  .setAction(async () => {
    cliInfo(
      "This help format is not supported by Hardhat.\nPlease use `npx hardhat help ethoko` instead (change `npx` with what you use).\nHelp on a specific task can be obtained by using `npx hardhat help ethoko <command>`.",
    );
  });

const LOG_COLORS = {
  log: "cyan",
  success: "green",
  error: "red",
  warn: "yellow",
} as const;
