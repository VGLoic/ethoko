import { StorageProvider } from "../storage-provider";
import { StepTracker } from "@/cli-ui/utils";
import { toAsyncResult } from "../utils/result";
import { CliError } from "./error";
import { lookForBuildInfoJsonFile } from "./helpers/look-for-build-info-json-file";
import { mapBuildInfoToEthokoArtifact } from "./helpers/map-build-info-to-ethoko-artifact";
import { BuildInfoPath } from "./helpers/look-for-build-info-json-file";

function buildInfoPathToSuccessText(buildInfoPath: BuildInfoPath): string {
  if (buildInfoPath.format === "hardhat-v3") {
    return `Hardhat v3 compilation artifact found`;
  }
  if (buildInfoPath.format === "hardhat-v2") {
    return `Hardhat v2 compilation artifact found`;
  }
  if (
    buildInfoPath.format === "forge-default" ||
    buildInfoPath.format === "forge-with-build-info-option"
  ) {
    return `Forge compilation artifact found at ${buildInfoPath.path}`;
  }
  throw new Error(
    `Unsupported build info format: ${buildInfoPath.format satisfies never}`,
  );
}

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
  const steps = new StepTracker(4, opts.silent);

  // Step 1: Look for compilation artifact
  steps.start("Looking for compilation artifact...");
  const buildInfoPathResult = await toAsyncResult(
    lookForBuildInfoJsonFile(artifactPath, steps, {
      debug: opts.debug,
      silent: opts.silent,
      isCI: opts.isCI,
    }),
  );
  if (!buildInfoPathResult.success) {
    steps.fail("Failed to find compilation artifact");
    // @dev the lookForBuildInfoJsonFile function throws a CliError with a user-friendly message, so we can directly re-throw it here without wrapping it in another error or modifying the message
    throw buildInfoPathResult.error;
  }
  steps.succeed(buildInfoPathToSuccessText(buildInfoPathResult.value));

  // Step 2: Parse the compilation artifact, mapping it to the Ethoko format
  steps.start("Analyzing compilation artifact...");
  const ethokoArtifactParsingResult = await toAsyncResult(
    mapBuildInfoToEthokoArtifact(buildInfoPathResult.value, opts.debug),
  );
  if (!ethokoArtifactParsingResult.success) {
    steps.fail("Unable to handle the provided compilation artifact");
    // @dev the mapBuildInfoToEthokoArtifact function throws an Error with a user-friendly message, so we can directly re-throw it here without wrapping it in another error or modifying the message
    throw ethokoArtifactParsingResult.error;
  }
  steps.succeed("Compilation artifact is valid");

  // Step 3: Check if tag exists
  steps.start("Checking if tag exists...");
  if (!tag) {
    steps.succeed("No tag provided, skipping tag existence check");
  } else {
    const hasTagResult = await toAsyncResult(
      storageProvider.hasArtifactByTag(project, tag),
      { debug: opts.debug },
    );
    if (!hasTagResult.success) {
      steps.fail("Failed to check tag existence");
      throw new CliError(
        `Error checking if the tag "${tag}" exists on the storage, please check the storage configuration or run with debug mode for more info`,
      );
    }
    if (hasTagResult.value) {
      if (!opts.force) {
        steps.fail("Tag already exists");
        throw new CliError(
          `The tag "${tag}" already exists on the storage. Please, make sure to use a different tag.`,
        );
      } else {
        steps.warn(`Tag "${tag}" already exists, forcing push`);
      }
    } else {
      steps.succeed("Tag is available");
    }
  }

  // Step 4: Upload artifact
  steps.start("Uploading artifact...");
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
    steps.fail("Failed to upload artifact");
    throw new CliError(
      `Error pushing the artifact "${project}:${tag || ethokoArtifactParsingResult.value.inputArtifact.id}" to the storage, please check the storage configuration or run with debug mode for more info`,
    );
  }
  steps.succeed("Artifact uploaded successfully");

  return ethokoArtifactParsingResult.value.inputArtifact.id;
}
