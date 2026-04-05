import { PulledArtifactStore } from "@/pulled-artifact-store";
import { StorageProvider } from "@/storage-provider";
import { CommandLogger } from "@/ui";
import { toAsyncResult } from "@/utils/result";
import { CliError } from "../error";
import { pullArtifact } from "../pull";
import { ArtifactKey } from "@/utils/artifact-key";

/**
 * Retrieve an artifact ID from the pulled artifact store if it exists, otherwise pull the artifact and then retrieve the ID.
 * @param project The project name of the artifact to retrieve or pull.
 * @param search The search criteria for the artifact, either by tag or by ID.
 * @param storageProvider The storage provider to use for pulling the artifact if it does not exist in the pulled artifact store.
 * @param pulledArtifactStore The pulled artifact store to check for the artifact and to store the pulled artifact if it does not exist.
 * @param opts Options for debugging and logging.
 * @returns The artifact ID of the retrieved or pulled artifact.
 */
export async function retrieveOrPullArtifact(
  artifactKey: ArtifactKey,
  storageProvider: StorageProvider,
  pulledArtifactStore: PulledArtifactStore,
  opts: { debug: boolean; logger: CommandLogger },
): Promise<string> {
  if (artifactKey.type === "id") {
    const hasIdResult = await toAsyncResult(
      pulledArtifactStore.hasId(artifactKey.project, artifactKey.id),
      { debug: opts.debug },
    );
    if (!hasIdResult.success) {
      throw new CliError(
        "Error checking for artifact ID in pulled artifact store, is the script not allowed to read from the filesystem? Run with debug mode for more info",
      );
    }
    if (hasIdResult.value) {
      return artifactKey.id;
    }
  } else {
    const hasTagResult = await toAsyncResult(
      pulledArtifactStore.hasTag(artifactKey.project, artifactKey.tag),
      { debug: opts.debug },
    );
    if (!hasTagResult.success) {
      throw new CliError(
        "Error checking for artifact tag in pulled artifact store, is the script not allowed to read from the filesystem? Run with debug mode for more info",
      );
    }
    if (hasTagResult.value) {
      const artifactIdResult = await toAsyncResult(
        pulledArtifactStore.retrieveArtifactId(
          artifactKey.project,
          artifactKey.tag,
        ),
        { debug: opts.debug },
      );
      if (!artifactIdResult.success) {
        throw new CliError(
          `The artifact ${artifactKey.project}:${artifactKey.tag} does not have an associated artifact ID. Please pull again. Run with debug mode for more info`,
        );
      }
      return artifactIdResult.value;
    }
  }

  await pullArtifact(artifactKey, storageProvider, pulledArtifactStore, {
    force: false,
    debug: opts.debug,
    logger: opts.logger,
  });

  if (artifactKey.type === "id") {
    return artifactKey.id;
  }
  const artifactIdResult = await toAsyncResult(
    pulledArtifactStore.retrieveArtifactId(
      artifactKey.project,
      artifactKey.tag,
    ),
    { debug: opts.debug },
  );
  if (!artifactIdResult.success) {
    throw new CliError(
      `Failed to retrieve artifact ID for ${artifactKey.project}:${artifactKey.tag} after pulling. Please ensure the pull was successful and try again. Run with debug mode for more info`,
    );
  }
  return artifactIdResult.value;
}
