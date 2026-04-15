import { PulledArtifactStore } from "@/pulled-artifact-store";
import { ArtifactKey, ResolvedArtifactKey } from "@/utils/artifact-key";
import { toAsyncResult } from "@/utils/result";
import { CliError } from "./error";

/**
 * Resolve an artifact ID from the pulled artifact store if it exists, otherwise return null.
 * @param artifactKey The artifact key to resolve, either by tag or by ID.
 * @param pulledArtifactStore The pulled artifact store
 * @param opts Options for resolving the artifact ID, such as debug mode.
 * @returns The artifact ID if it exists in the pulled artifact store, otherwise null.
 */
export async function resolvePulledArtifact(
  artifactKey: ArtifactKey,
  pulledArtifactStore: PulledArtifactStore,
  opts: { debug: boolean },
): Promise<ResolvedArtifactKey | null> {
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
      return { project: artifactKey.project, id: artifactKey.id };
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
      return { project: artifactKey.project, id: artifactIdResult.value };
    }
  }

  return null;
}
