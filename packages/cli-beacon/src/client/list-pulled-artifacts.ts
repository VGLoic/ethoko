import { LocalArtifactStore } from "@/local-artifact-store";
import { toAsyncResult } from "@/utils/result";
import { CliError } from "./error";
import { DebugLogger } from "@/utils/debug-logger";

export type ListArtifactsResult = Array<ArtifactItem>;

export type ArtifactItem = {
  project: string;
  id: string;
  tag: string | null;
  lastModifiedAt: string;
};

/**
 * List the artifacts that have been pulled to the Local Artifact Store, it consists of two steps:
 * 1. Fetch the list of projects, tags, and IDs from the Local Artifact Store
 * 2. Structure the data in a user-friendly format for display
 *
 * The method returns an array of artifact items containing the project, tag, ID, and last modified date.
 *
 * @throws CliError if there is an error fetching the data from the Local Artifact Store. The error messages are meant to be user-friendly and can be directly shown to the user.
 * @param dependencies The dependencies
 * @param opts Options for the listing
 * @param opts.debug Enable debug mode
 * @returns The list of artifacts in the Local Artifact Store with their project, tag, ID, and last modified date
 */
export async function listPulledArtifacts(
  dependencies: {
    localArtifactStore: LocalArtifactStore;
    logger: DebugLogger;
  },
  opts: { debug: boolean },
): Promise<ListArtifactsResult> {
  const ensureResult = await toAsyncResult(
    dependencies.localArtifactStore.ensureSetup(),
    {
      debug: opts.debug,
    },
  );
  if (!ensureResult.success) {
    throw new CliError(
      "Error setting up Local Artifact Store, is the script not allowed to write to the filesystem? Run with debug mode for more info",
    );
  }

  const projectsResult = await toAsyncResult(
    dependencies.localArtifactStore.listProjects(),
    {
      debug: opts.debug,
    },
  );
  if (!projectsResult.success) {
    throw new CliError(
      "Error listing the projects from the Local Artifact Store, please run with debug mode for more info",
    );
  }
  if (opts.debug) {
    dependencies.logger.debug(
      `Projects retrieved successfully: ${projectsResult.value.join(", ")}`,
    );
  }

  const items: ArtifactItem[] = [];
  const idsAlreadyVisited = new Set<string>();
  const projects = projectsResult.value;
  for (const project of projects) {
    const tagsResult = await toAsyncResult(
      dependencies.localArtifactStore.listTags(project),
      {
        debug: opts.debug,
      },
    );
    if (!tagsResult.success) {
      throw new CliError(
        `Error listing the tags for project "${project}", please force pull the project to restore it or run with debug mode for more info`,
      );
    }

    for (const { lastModifiedAt, id, tag } of tagsResult.value) {
      items.push({
        project,
        id,
        tag,
        lastModifiedAt,
      });
      idsAlreadyVisited.add(id);
    }

    const idsResult = await toAsyncResult(
      dependencies.localArtifactStore.listIds(project),
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
        if (opts.debug) {
          dependencies.logger.debug(
            `Skipping already visited ID "${metadata.id}" for project "${project}"`,
          );
        }
        continue;
      }
      if (opts.debug) {
        dependencies.logger.debug(
          `Adding ID "${metadata.id}" for project "${project}"`,
        );
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
