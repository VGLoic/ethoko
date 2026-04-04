import { PulledArtifactStore } from "@/pulled-artifact-store";
import { StorageProvider } from "@/storage-provider";
import { CommandLogger } from "@/ui";
import { toAsyncResult } from "@/utils/result";
import { CliError } from "../error";
import { pull } from "../pull";

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
  project: string,
  search: { type: "tag"; tag: string } | { type: "id"; id: string },
  storageProvider: StorageProvider,
  pulledArtifactStore: PulledArtifactStore,
  opts: { debug: boolean; logger: CommandLogger },
): Promise<string> {
  if (search.type === "id") {
    const hasIdResult = await toAsyncResult(
      pulledArtifactStore.hasId(project, search.id),
      { debug: opts.debug },
    );
    if (!hasIdResult.success) {
      throw new CliError(
        "Error checking for artifact ID in pulled artifact store, is the script not allowed to read from the filesystem? Run with debug mode for more info",
      );
    }
    if (hasIdResult.value) {
      return search.id;
    }
  } else {
    const hasTagResult = await toAsyncResult(
      pulledArtifactStore.hasTag(project, search.tag),
      { debug: opts.debug },
    );
    if (!hasTagResult.success) {
      throw new CliError(
        "Error checking for artifact tag in pulled artifact store, is the script not allowed to read from the filesystem? Run with debug mode for more info",
      );
    }
    if (hasTagResult.value) {
      const artifactIdResult = await toAsyncResult(
        pulledArtifactStore.retrieveArtifactId(project, search.tag),
        { debug: opts.debug },
      );
      if (!artifactIdResult.success) {
        throw new CliError(
          `The artifact ${project}:${search.tag} does not have an associated artifact ID. Please pull again. Run with debug mode for more info`,
        );
      }
      return artifactIdResult.value;
    }
  }

  await pull(project, search, storageProvider, pulledArtifactStore, {
    force: false,
    debug: opts.debug,
    logger: opts.logger,
  });

  if (search.type === "id") {
    return search.id;
  }
  const artifactIdResult = await toAsyncResult(
    pulledArtifactStore.retrieveArtifactId(project, search.tag),
    { debug: opts.debug },
  );
  if (!artifactIdResult.success) {
    throw new CliError(
      `Failed to retrieve artifact ID for ${project}:${search.tag} after pulling. Please ensure the pull was successful and try again. Run with debug mode for more info`,
    );
  }
  return artifactIdResult.value;
}
