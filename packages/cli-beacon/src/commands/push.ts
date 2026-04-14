import { Command } from "commander";
import { z } from "zod";
import { CommandLogger } from "@/ui/index.js";
import { CliError, push } from "@/client/index.js";

import type { EthokoCliConfig } from "../config";
import { createStorageProvider } from "./utils/storage-provider.js";
import { toAsyncResult } from "@/utils/result.js";
import { ProjectOrArtifactKeySchema } from "./utils/parse-project-or-artifact-key.js";
import { generateAbsolutePathSchema, AbsolutePath } from "@/utils/path.js";
import { parseCandidateArtifact } from "@/client/parse-candidate-artifact";
import { EthokoInputArtifact } from "@/ethoko-artifacts/v0";
import { StorageProvider } from "@/storage-provider";

type GetConfig = (configPath?: string) => Promise<EthokoCliConfig>;

export function registerPushCommand(
  program: Command,
  getConfig: GetConfig,
): void {
  program
    .command("push")
    .description("Upload compilation artifacts to storage")
    .argument(
      "<PROJECT[:TAG]>",
      "Target project and optional tag to associate with the pushed artifact",
    )
    .option("--artifact-path <path>", "Path to compilation artifacts")
    .option("--force", "Force push even if tag exists", false)
    .option("--debug", "Enable debug logging", false)
    .option("--silent", "Suppress output", false)
    .action(async (projectArg, options) => {
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

      const artifactKeyParsingResult = ProjectOrArtifactKeySchema.transform(
        (projectOrArtifactKey) => {
          if (projectOrArtifactKey.type === "id") {
            return z.NEVER;
          }
          if (projectOrArtifactKey.type === "project") {
            return {
              project: projectOrArtifactKey.project,
              tag: undefined,
            };
          }
          return {
            project: projectOrArtifactKey.project,
            tag: projectOrArtifactKey.tag,
          };
        },
      ).safeParse(projectArg);
      if (!artifactKeyParsingResult.success) {
        logger.error(
          `Invalid artifact argument:\nThe artifact argument must be a string in the format PROJECT[:TAG]`,
        );
        process.exitCode = 1;
        return;
      }
      const projectConfig = config.getProjectConfig(
        artifactKeyParsingResult.data.project,
      );
      if (!projectConfig) {
        logger.error(
          `Project "${artifactKeyParsingResult.data.project}" not found in configuration`,
        );
        process.exitCode = 1;
        return;
      }

      logger.intro(
        `Pushing artifact "${artifactKeyParsingResult.data.project}${artifactKeyParsingResult.data.tag ? `:${artifactKeyParsingResult.data.tag}"` : '"'}`,
      );

      const optsParsingResult = z
        .object({
          artifactPath: z
            .string('The "artifactPath" option must be a string')
            .min(
              1,
              'The "artifactPath" cannot be empty. Provide a valid path to compilation artifacts or set compilationOutputPath in ethoko.config.json',
            )
            .pipe(
              generateAbsolutePathSchema(() => new AbsolutePath(process.cwd())),
            )
            .optional(),
          force: z
            .boolean('The "force" option must be a boolean')
            .default(false),
          debug: z
            .boolean('The "debug" option must be a boolean')
            .default(config.debug),
        })
        .safeParse(options);

      if (!optsParsingResult.success) {
        logger.error(
          `Invalid command arguments:\n${z.prettifyError(optsParsingResult.error)}`,
        );
        process.exitCode = 1;
        return;
      }

      const finalArtifactPath =
        optsParsingResult.data.artifactPath || config.compilationOutputPath;

      if (!finalArtifactPath) {
        logger.error(
          "Artifact path is required. Provide --artifact-path or set compilationOutputPath in ethoko.config.json",
        );
        process.exitCode = 1;
        return;
      }

      await runPushCommand(
        finalArtifactPath,
        {
          project: artifactKeyParsingResult.data.project,
          tag: artifactKeyParsingResult.data.tag,
        },
        {
          storageProvider: createStorageProvider(
            projectConfig.storage,
            optsParsingResult.data.debug,
          ),
          logger,
        },
        {
          force: optsParsingResult.data.force,
          debug: optsParsingResult.data.debug,
        },
      ).catch((err) => {
        if (err instanceof CliError) {
          logger.error(err.message);
        } else {
          logger.error(
            "An unexpected error occurred, please fill an issue with the error details if the problem persists",
          );
          console.error(err);
        }
        process.exitCode = 1;
      });
    });
}

export async function runPushCommand(
  artifactPath: AbsolutePath,
  artifact: {
    project: string;
    tag: string | undefined;
  },
  dependencies: {
    storageProvider: StorageProvider;
    logger: CommandLogger;
  },
  opts: {
    force: boolean;
    debug: boolean;
  },
): Promise<string> {
  const spinner1 = dependencies.logger.createSpinner(
    "Looking for compilation artifacts...",
  );
  const candidateArtifact = await parseCandidateArtifact(artifactPath, {
    debug: opts.debug,
    logger: dependencies.logger,
    isCI: process.env.CI === "true" || process.env.CI === "1",
  }).catch((err) => {
    spinner1.fail("Fail to parse compilation artifacts");
    throw err;
  });
  spinner1.succeed(
    artifactOriginToSuccessText(candidateArtifact.inputArtifact.origin.type),
  );

  // We verify that the input sources contain the `content` field.
  // It is not required for Ethoko but may ensure an easy verification later on.
  const missingContentInSource = Object.values(
    candidateArtifact.inputArtifact.input.sources,
  ).some((source) => !("content" in source));
  if (missingContentInSource) {
    // For Forge, we encourage users to use the `--use-literal-content` option to ensure the content is included in the artifact, which can help with later verification and debugging
    if (
      candidateArtifact.inputArtifact.origin.type ===
        "forge-v1-with-build-info-option" ||
      candidateArtifact.inputArtifact.origin.type === "forge-v1-default"
    ) {
      dependencies.logger.warn(
        `The provided Forge compilation artifacts do not include the literal content of the sources. We recommend using the "--use-literal-content" option when generating the build info files with Forge to include the content in the artifact, which can help with later verification and debugging.`,
      );
    } else {
      dependencies.logger.warn(
        `The provided compilation artifact does not include the literal content of the sources. This may make later verification and debugging more difficult. If possible, please provide artifacts that include the source content.`,
      );
    }
  }

  const artifactId = await push(
    artifact.project,
    artifact.tag,
    candidateArtifact,
    dependencies.storageProvider,
    {
      force: opts.force,
      debug: opts.debug,
      logger: dependencies.logger,
    },
  );

  displayPushResult(
    dependencies.logger,
    artifact.project,
    artifact.tag,
    artifactId,
  );

  return artifactId;
}

function displayPushResult(
  logger: CommandLogger,
  project: string,
  tag: string | undefined,
  artifactId: string,
): void {
  if (tag) {
    logger.success(
      `Artifact "${project}:${tag}" (ID: ${artifactId}) pushed successfully`,
    );
  } else {
    logger.success(`Artifact "${project}@${artifactId}" pushed successfully`);
  }
}

function artifactOriginToSuccessText(
  origin: EthokoInputArtifact["origin"]["type"],
): string {
  if (origin === "hardhat-v3") {
    return `Hardhat v3 compilation artifact found`;
  }
  if (origin === "hardhat-v3-non-isolated-build") {
    return `Hardhat v3 compilation artifact found (non isolated build)`;
  }
  if (origin === "hardhat-v2") {
    return `Hardhat v2 compilation artifact found`;
  }
  if (
    origin === "forge-v1-default" ||
    origin === "forge-v1-with-build-info-option"
  ) {
    return `Forge compilation artifact found`;
  }
  throw new CliError(
    `Unsupported build info format: ${origin satisfies never}`,
  );
}
