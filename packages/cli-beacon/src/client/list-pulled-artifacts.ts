import { PulledArtifactStore } from "../pulled-artifact-store/pulled-artifact-store";
import { toAsyncResult } from "../utils/result";
import { CliError } from "./error";

export type ListArtifactsResult = Array<ArtifactItem>;

export type ArtifactItem = {
  project: string;
  id: string;
  tag: string | null;
  lastModifiedAt: string;
};

/**
 * List the artifacts that have been pulled to the pulled artifact store, it consists of two steps:
 * 1. Fetch the list of projects, tags, and IDs from the pulled artifact store
 * 2. Structure the data in a user-friendly format for display
 *
 * The method returns an array of artifact items containing the project, tag, ID, and last modified date.
 *
 * @throws CliError if there is an error fetching the data from the pulled artifact store. The error messages are meant to be user-friendly and can be directly shown to the user.
 * @param pulledArtifactStore The pulled artifact store used to retrieve pulled artifacts
 * @param opts Options for the listing
 * @param opts.debug Enable debug mode
 * @param opts.silent Suppress CLI output (errors and warnings still shown)
 * @returns The list of artifacts in the pulled artifact store with their project, tag, ID, and last modified date
 */
export async function listPulledArtifacts(
  pulledArtifactStore: PulledArtifactStore,
  opts: { debug: boolean; silent?: boolean },
): Promise<ListArtifactsResult> {
  const ensureResult = await toAsyncResult(pulledArtifactStore.ensureSetup(), {
    debug: opts.debug,
  });
  if (!ensureResult.success) {
    throw new CliError(
      "Error setting up pulled artifact store, is the script not allowed to write to the filesystem? Run with debug mode for more info",
    );
  }

  const projectsResult = await toAsyncResult(
    pulledArtifactStore.listProjects(),
    {
      debug: opts.debug,
    },
  );
  if (!projectsResult.success) {
    throw new CliError(
      "Error listing the projects from the pulled artifact store, please run with debug mode for more info",
    );
  }

  const items: ArtifactItem[] = [];
  const idsAlreadyVisited = new Set<string>();
  const projects = projectsResult.value;
  for (const project of projects) {
    const tagsResult = await toAsyncResult(
      pulledArtifactStore.listTags(project),
      {
        debug: opts.debug,
      },
    );
    if (!tagsResult.success) {
      throw new CliError(
        `Error listing the tags for project "${project}", please force pull the project to restore it or run with debug mode for more info`,
      );
    }

    const artifactsPromises = tagsResult.value.map((metadata) =>
      pulledArtifactStore
        .retrieveArtifactId(project, metadata.tag)
        .then((artifactId) => ({
          metadata,
          artifactId,
        })),
    );
    const artifactsResults = await toAsyncResult(
      Promise.all(artifactsPromises),
      { debug: opts.debug },
    );
    if (!artifactsResults.success) {
      throw new CliError(
        `Error retrieving the content for project "${project}", please force pull the project to restore it or run with debug mode for more info`,
      );
    }

    for (const { metadata, artifactId } of artifactsResults.value) {
      items.push({
        project,
        id: artifactId,
        tag: metadata.tag,
        lastModifiedAt: metadata.lastModifiedAt,
      });
      idsAlreadyVisited.add(artifactId);
    }

    const idsResult = await toAsyncResult(
      pulledArtifactStore.listIds(project),
      {
        debug: opts.debug,
      },
    );
    if (!idsResult.success) {
      throw new CliError(
        `Error listing the IDs for project "${project}", please force pull the project to restore it or run with debug mode for more info`,
      );
    }
    for (const metadata of idsResult.value) {
      if (idsAlreadyVisited.has(metadata.id)) {
        continue;
      }
      items.push({
        project: project,
        id: metadata.id,
        tag: null,
        lastModifiedAt: metadata.lastModifiedAt,
      });
      idsAlreadyVisited.add(metadata.id);
    }
  }
  return items;
}
