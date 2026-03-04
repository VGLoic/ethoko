import { StorageProvider } from "../storage-provider";
import { createSpinner, warn } from "@/cli-ui/utils";
import { toAsyncResult } from "../utils/result";
import { CliError } from "./error";
import {
  lookForCandidateArtifacts,
  promptUserSelection,
} from "./helpers/look-for-candidate-artifacts";
import {
  mapOriginalArtifactToEthokoArtifact,
  OriginalBuildInfoPaths,
} from "@/utils/supported-origins/map-original-artifact-to-ethoko-artifact";

function buildInfoPathToSuccessText(paths: OriginalBuildInfoPaths): string {
  if (paths.format === "hardhat-v3") {
    return `Hardhat v3 compilation artifact found`;
  }
  if (paths.format === "hardhat-v2") {
    return `Hardhat v2 compilation artifact found`;
  }
  if (
    paths.format === "forge-v1-default" ||
    paths.format === "forge-v1-with-build-info-option"
  ) {
    return `Forge compilation artifact found at ${paths.buildInfoPath}`;
  }
  throw new CliError(
    `Unsupported build info format: ${paths.format satisfies never}`,
  );
}

const FORMAT_TO_ERROR_MESSAGE: Record<
  OriginalBuildInfoPaths["format"],
  string
> = {
  "hardhat-v3":
    "Hardhat v3 compilation artifacts have been identified but the mapping to Ethoko artifact format failed. Please provide valid Hardhat v3 compilation files or contact us. Run with debug mode for more info.",
  "hardhat-v2":
    "Hardhat v2 compilation artifacts have been identified but the mapping to Ethoko artifact format failed. Please provide a valid Hardhat v2 build info JSON file or contact us. Run with debug mode for more info.",
  "forge-v1-with-build-info-option":
    "Forge v1 compilation artifacts with the build info option have been identified but the mapping to Ethoko artifact format failed. Please provide a valid Forge v1 build info JSON file or contact us. Run with debug mode for more info.",
  "forge-v1-default":
    "Forge v1 compilation artifacts have been identified but the mapping to Ethoko artifact format failed. Please provide a valid Forge v1 build info JSON file or contact us. Run with debug mode for more info.",
};

/**
 * Run the push command of the CLI client, it consists of three steps:
 * 1. Read the compilation artifact from the provided path and validate it
 * 2. If a tag is provided, check if it already exists in the storage and handle it based on the force option
 * 3. Upload the artifact to the storage with the provided project, tag, and a generated ID based on the artifact content
 *
 * The method returns the generated artifact ID.
 *
 * @throws CliError if there is an error reading the artifact, checking the tag existence, or uploading the artifact. The error messages are meant to be user-friendly and can be directly shown to the user.
 * @param artifactPath The path to the compilation artifact to push
 * @param project The project name
 * @param tag The tag to associate with the artifact, if any
 * @param storageProvider The storage provider used to upload artifacts
 * @param opts Options for the push command
 * @param opts.force Force the push of the artifact even if the tag already exists in the storage
 * @param opts.debug Enable debug mode
 * @param opts.silent Suppress CLI output (errors and warnings still shown)
 * @param opts.isCI Whether running in CI environment (disables interactive prompts)
 * @returns The generated artifact ID
 */
export async function push(
  artifactPath: string,
  project: string,
  tag: string | undefined,
  storageProvider: StorageProvider,
  opts: { force: boolean; debug: boolean; silent?: boolean; isCI?: boolean },
): Promise<string> {
  // Step 1: Look for compilation artifact
  const spinner1 = createSpinner(
    "Looking for compilation artifact...",
    opts.silent,
  );
  const candidateArtifactsResult = await toAsyncResult(
    lookForCandidateArtifacts(artifactPath, {
      debug: opts.debug,
    }),
  );
  if (!candidateArtifactsResult.success) {
    spinner1.fail("Failed to find compilation artifact");
    // @dev the lookForBuildInfoJsonFile function throws a CliError with a user-friendly message, so we can directly re-throw it here without wrapping it in another error or modifying the message
    throw candidateArtifactsResult.error;
  }
  const firstBuildInfoCandidate =
    candidateArtifactsResult.value.candidateBuildInfoOptions[0];
  if (!firstBuildInfoCandidate) {
    spinner1.fail("No valid compilation artifacts found");
    throw new CliError(
      "No valid compilation artifacts were found in the provided path. Please provide a valid path to a compilation artifact (build info) or a directory containing it.",
    );
  }

  let selectedBuildInfoPaths: OriginalBuildInfoPaths;
  if (candidateArtifactsResult.value.candidateBuildInfoOptions.length === 1) {
    selectedBuildInfoPaths = firstBuildInfoCandidate.value;
  } else {
    if (opts.isCI) {
      spinner1.fail("Multiple compilation artifacts found");
      throw new CliError(
        "Multiple compilation artifacts were found in the provided path. Please provide a more specific path or run the command in interactive mode to select the desired artifact.",
      );
    }
    const userSelectionResult = await toAsyncResult(
      promptUserSelection(
        `Multiple JSON files found in "${candidateArtifactsResult.value.finalFolderPath}" (${candidateArtifactsResult.value.ignoredFilesCount} ignored). Please select which build info file to use:`,
        candidateArtifactsResult.value.candidateBuildInfoOptions,
        30_000,
      ),
      { debug: opts.debug },
    );
    if (!userSelectionResult.success) {
      spinner1.fail("No compilation artifact selected");
      // @dev the promptUserSelection function throws a CliError with a user-friendly message, so we can directly re-throw it here without wrapping it in another error or modifying the message
      throw userSelectionResult.error;
    }
    selectedBuildInfoPaths = userSelectionResult.value;
  }

  spinner1.succeed(buildInfoPathToSuccessText(selectedBuildInfoPaths));

  // Step 2: Parse the compilation artifact, mapping it to the Ethoko format
  const spinner2 = createSpinner(
    "Analyzing compilation artifact...",
    opts.silent,
  );
  const ethokoArtifactParsingResult = await toAsyncResult(
    mapOriginalArtifactToEthokoArtifact(selectedBuildInfoPaths, opts.debug),
    { debug: opts.debug },
  );
  if (!ethokoArtifactParsingResult.success) {
    spinner2.fail("Unable to handle the provided compilation artifact");
    throw new CliError(
      FORMAT_TO_ERROR_MESSAGE[selectedBuildInfoPaths.format] ||
        `An error occurred while mapping the build info to Ethoko artifacts. Please provide valid build info JSON files or contact us. Run with debug mode for more info.`,
    );
  }
  spinner2.succeed("Compilation artifact is valid");

  // We verify that the input sources contain the `content` field.
  // It is not required for Ethoko but may ensure an easy verification later on.
  const missingContentInSource = Object.values(
    ethokoArtifactParsingResult.value.inputArtifact.input.sources,
  ).some((source) => !("content" in source));
  if (missingContentInSource) {
    // For Forge, we encourage users to use the `--use-literal-content` option to ensure the content is included in the artifact, which can help with later verification and debugging
    if (
      ethokoArtifactParsingResult.value.inputArtifact.origin.type ===
        "forge-v1-with-build-info-option" ||
      ethokoArtifactParsingResult.value.inputArtifact.origin.type ===
        "forge-v1-default"
    ) {
      warn(
        `The provided Forge compilation artifacts do not include the literal content of the sources. We recommend using the "--use-literal-content" option when generating the build info files with Forge to include the content in the artifact, which can help with later verification and debugging.`,
      );
    } else {
      warn(
        `The provided compilation artifact does not include the literal content of the sources. This may make later verification and debugging more difficult. If possible, please provide artifacts that include the source content.`,
      );
    }
  }

  // Step 3: Check if tag exists
  const spinner3 = createSpinner("Checking if tag exists...", opts.silent);
  if (!tag) {
    spinner3.succeed("No tag provided, skipping tag existence check");
  } else {
    const hasTagResult = await toAsyncResult(
      storageProvider.hasArtifactByTag(project, tag),
      { debug: opts.debug },
    );
    if (!hasTagResult.success) {
      spinner3.fail("Failed to check tag existence");
      throw new CliError(
        `Error checking if the tag "${tag}" exists on the storage, please check the storage configuration or run with debug mode for more info`,
      );
    }
    if (hasTagResult.value) {
      if (!opts.force) {
        spinner3.fail("Tag already exists");
        throw new CliError(
          `The tag "${tag}" already exists on the storage. Please, make sure to use a different tag.`,
        );
      } else {
        spinner3.warn(`Tag "${tag}" already exists, forcing push`);
      }
    } else {
      spinner3.succeed("Tag is available");
    }
  }

  // Step 4: Upload artifact
  const spinner4 = createSpinner("Uploading artifact...", opts.silent);
  const pushResult = await toAsyncResult(
    storageProvider.uploadArtifact(
      project,
      ethokoArtifactParsingResult.value.inputArtifact,
      ethokoArtifactParsingResult.value.outputArtifact,
      tag,
      ethokoArtifactParsingResult.value.originalContentPaths,
    ),
    { debug: opts.debug },
  );

  if (!pushResult.success) {
    spinner4.fail("Failed to upload artifact");
    throw new CliError(
      `Error pushing the artifact "${project}:${tag || ethokoArtifactParsingResult.value.inputArtifact.id}" to the storage, please check the storage configuration or run with debug mode for more info`,
    );
  }
  spinner4.succeed("Artifact uploaded successfully");

  return ethokoArtifactParsingResult.value.inputArtifact.id;
}
