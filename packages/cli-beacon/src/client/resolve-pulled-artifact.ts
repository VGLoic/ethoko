import { LocalArtifactStore } from "@/local-artifact-store";
import { ArtifactKey, ResolvedArtifactKey } from "@/utils/artifact-key";
import { toAsyncResult } from "@/utils/result";
import { CliError } from "./error";

/**
 * Resolve an artifact ID from the Local Artifact Store if it exists, otherwise return null.
 * @param artifactKey The artifact key to resolve, either by tag or by ID.
 * @param localArtifactStore The Local Artifact Store
 * @param opts Options for resolving the artifact ID, such as debug mode.
 * @returns The artifact ID if it exists in the Local Artifact Store, otherwise null.
 */
export async function resolvePulledArtifact(
  artifactKey: ArtifactKey,
  localArtifactStore: LocalArtifactStore,
  opts: { debug: boolean },
): Promise<ResolvedArtifactKey | null> {
  if (artifactKey.type === "id") {
    const hasIdResult = await toAsyncResult(
      localArtifactStore.hasId(artifactKey.project, artifactKey.id),
      { debug: opts.debug },
    );
    if (!hasIdResult.success) {
      throw new CliError(
        "Error checking for artifact ID in Local Artifact Store, is the script not allowed to read from the filesystem? Run with debug mode for more info",
      );
    }
    if (hasIdResult.value) {
      return { project: artifactKey.project, id: artifactKey.id, tag: null };
    }
  } else {
    const hasTagResult = await toAsyncResult(
      localArtifactStore.hasTag(artifactKey.project, artifactKey.tag),
      { debug: opts.debug },
    );
    if (!hasTagResult.success) {
      throw new CliError(
        "Error checking for artifact tag in Local Artifact Store, is the script not allowed to read from the filesystem? Run with debug mode for more info",
      );
    }
    if (hasTagResult.value) {
      const artifactIdResult = await toAsyncResult(
        localArtifactStore.retrieveArtifactId(
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
      return {
        project: artifactKey.project,
        id: artifactIdResult.value,
        tag: artifactKey.tag,
      };
    }
  }

  return null;
}
