import { StorageProvider } from "../storage-provider";
import { CommandLogger } from "@/ui";
import { toAsyncResult } from "../utils/result";
import { CliError } from "./error";
import { AbsolutePath, RelativePath } from "@/utils/path";
import {
  EthokoContractOutputArtifact,
  EthokoInputArtifact,
} from "@/ethoko-artifacts/v0";

/**
 * Run the push command of the CLI client, it consists of two steps:
 * 1. If a tag is provided, check if it already exists in the storage and handle it based on the force option
 * 2. Upload the artifact to the storage with the provided project, tag, and a generated ID based on the artifact content
 *
 * The method returns the artifact ID.
 *
 * @throws CliError if there is an error reading the artifact, checking the tag existence, or uploading the artifact. The error messages are meant to be user-friendly and can be directly shown to the user.
 * @param project The project name
 * @param tag The tag to associate with the artifact, if any
 * @param artifact The Ethoko artifact to push
 * @param storageProvider The storage provider used to upload artifacts
 * @param opts Options for the push command
 * @param opts.force Force the push of the artifact even if the tag already exists in the storage
 * @param opts.debug Enable debug mode
 * @param opts.logger The CommandLogger instance to use for logging and prompting the user during the push process
 * @param opts.isCI Whether running in CI environment (disables interactive prompts)
 * @returns The artifact ID
 */
export async function push(
  project: string,
  tag: string | undefined,
  artifact: {
    inputArtifact: EthokoInputArtifact;
    outputContractArtifacts: EthokoContractOutputArtifact[];
    originalContent: { rootPath: AbsolutePath; paths: RelativePath[] };
  },
  storageProvider: StorageProvider,
  opts: {
    force: boolean;
    debug: boolean;
    logger: CommandLogger;
  },
): Promise<string> {
  // Step 3: Check if tag exists
  const spinner3 = opts.logger.createSpinner("Checking if tag exists...");
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
  const spinner4 = opts.logger.createSpinner("Uploading artifact...");
  const pushResult = await toAsyncResult(
    storageProvider.uploadArtifact(
      project,
      artifact.inputArtifact,
      artifact.outputContractArtifacts,
      tag,
      artifact.originalContent,
    ),
    { debug: opts.debug },
  );

  if (!pushResult.success) {
    spinner4.fail("Failed to upload artifact");
    throw new CliError(
      `Error pushing the artifact "${project}:${tag || artifact.inputArtifact.id}" to the storage, please check the storage configuration or run with debug mode for more info`,
    );
  }
  spinner4.succeed("Artifact uploaded successfully");

  return artifact.inputArtifact.id;
}
