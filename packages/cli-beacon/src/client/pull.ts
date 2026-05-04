import { DebugLogger } from "@/utils/debug-logger";
import { LocalArtifactStore } from "../local-artifact-store";
import { StorageProvider } from "../storage-provider";
import { toAsyncResult } from "../utils/result";
import { CliError } from "./error";
import { ArtifactKey } from "@/utils/artifact-key";

export type PullResult = {
  remoteTags: string[];
  remoteIds: string[];
  pulledTags: string[];
  pulledIds: string[];
  failedTags: string[];
  failedIds: string[];
};

/**
 * Pull artifacts for a given project, it consists of four steps:
 * 1. Set up the Local Artifact Store for the project
 * 2. Fetch the list of remote tags and IDs from the storage provider, and filter them based on the provided tagOrId parameter
 * 3. Check which of the filtered tags and IDs are already present in the Local Artifact Store, unless the force option is enabled
 * 4. Download the missing artifacts from the storage provider and save them to the Local Artifact Store
 *
 * The method returns an object containing the list of remote tags and IDs, the list of successfully pulled tags and IDs, and the list of tags and IDs that failed to be pulled.
 * @throws CliError if there is an error setting up the Local Artifact Store, fetching the remote artifacts, checking the Local Artifact Store, or downloading the artifacts. The error messages are meant to be user-friendly and can be directly shown to the user.
 * @param project The project to pull artifacts for
 * @param dependencies.storageProvider The storage provider used to access remote artifacts
 * @param dependencies.localArtifactStore The Local Artifact Store used to persist pulled artifacts
 * @param dependencies.logger The DebugLogger instance to use for debug logging during the pull process
 * @param opts Options for the pull command
 * @param opts.force Force the pull to skip checking existing pulled artifacts
 * @param opts.debug Enable debug mode
 * @returns An object with the remote tags and IDs, pulled tags and IDs, and failed tags and IDs
 */
export async function pullProject(
  project: string,
  dependencies: {
    storageProvider: StorageProvider;
    localArtifactStore: LocalArtifactStore;
    logger: DebugLogger;
  },
  opts: { force: boolean; debug: boolean },
): Promise<PullResult> {
  // Step 1: Set up Local Artifact Store
  const ensureResult = await toAsyncResult(
    dependencies.localArtifactStore.ensureProjectSetup(project),
    { debug: opts.debug },
  );
  if (!ensureResult.success) {
    throw new CliError(
      "Error setting up Local Artifact Store, is the script not allowed to write to the filesystem? Run with debug mode for more info",
    );
  }
  if (opts.debug) {
    dependencies.logger.debug(
      `Pulled artifact store set up at ${dependencies.localArtifactStore.rootPath}`,
    );
  }

  // Step 2: Fetch remote artifacts
  const remoteListingResult = await toAsyncResult(
    Promise.all([
      dependencies.storageProvider.listTags(project),
      dependencies.storageProvider.listIds(project),
    ]),
    { debug: opts.debug },
  );
  if (!remoteListingResult.success) {
    throw new CliError(
      "Error interacting with the storage, please check the configuration or run with debug mode for more info",
    );
  }
  const [remoteTags, remoteIds] = remoteListingResult.value;

  if (opts.debug) {
    dependencies.logger.debug(`Remote tags: ${remoteTags.join(", ")}`);
    dependencies.logger.debug(`Remote IDs: ${remoteIds.join(", ")}`);
  }

  const tagsToDownload = remoteTags;
  const idsToDownload = remoteIds;

  if (opts.debug) {
    dependencies.logger.debug(`Tags to download: ${tagsToDownload.join(", ")}`);
    dependencies.logger.debug(`IDs to download: ${idsToDownload.join(", ")}`);
  }

  // Step 3: Check Local Artifact Store
  let filteredTagsToDownload: string[] = [];
  let filteredIdsToDownload: string[] = [];
  if (opts.force) {
    filteredTagsToDownload = tagsToDownload;
    filteredIdsToDownload = idsToDownload;
  } else {
    const localListingResult = await toAsyncResult(
      Promise.all([
        dependencies.localArtifactStore
          .listTags(project)
          .then(
            (tagMetadatas) =>
              new Set(tagMetadatas.map((metadata) => metadata.tag)),
          ),
        dependencies.localArtifactStore
          .listIds(project)
          .then(
            (idMetadatas) =>
              new Set(idMetadatas.map((metadata) => metadata.id)),
          ),
      ]),
      { debug: opts.debug },
    );
    if (!localListingResult.success) {
      throw new CliError(
        "Error checking pulled artifacts, is the script not allowed to read from the filesystem? Run with debug mode for more info",
      );
    }

    const [localTags, localIds] = localListingResult.value;

    filteredTagsToDownload = tagsToDownload.filter(
      (tag) => !localTags.has(tag),
    );
    filteredIdsToDownload = idsToDownload.filter((id) => !localIds.has(id));
  }

  if (opts.debug) {
    dependencies.logger.debug(
      `Filtered tags to download: ${filteredTagsToDownload.join(", ")}`,
    );
    dependencies.logger.debug(
      `Filtered IDs to download: ${filteredIdsToDownload.join(", ")}`,
    );
  }

  // Step 4: Download artifacts
  if (
    filteredTagsToDownload.length === 0 &&
    filteredIdsToDownload.length === 0
  ) {
    return {
      remoteTags,
      remoteIds,
      pulledTags: [],
      pulledIds: [],
      failedTags: [],
      failedIds: [],
    };
  }

  if (opts.debug) {
    const missingArtifactCount =
      filteredTagsToDownload.length + filteredIdsToDownload.length;
    dependencies.logger.debug(
      `Total artifacts to download: ${missingArtifactCount} (${filteredTagsToDownload.length} tags and ${filteredIdsToDownload.length} IDs)`,
    );
  }

  const tagsPromises: Promise<{ tag: string; id: string }>[] =
    filteredTagsToDownload.map(async (tag) => {
      const downloadResult = await toAsyncResult(
        dependencies.storageProvider.downloadArtifactByTag(project, tag),
        { debug: opts.debug },
      );
      if (!downloadResult.success) {
        throw new PullTagError(tag);
      }

      const createResult = await toAsyncResult(
        dependencies.localArtifactStore.createArtifact(
          project,
          downloadResult.value.id,
          tag,
          {
            input: downloadResult.value.input,
            outputs: downloadResult.value.contractOutputArtifacts,
          },
        ),
        { debug: opts.debug },
      );
      if (!createResult.success) {
        throw new PullTagError(tag);
      }

      return { tag, id: downloadResult.value.id };
    });

  const tagsSettlements = await Promise.allSettled(tagsPromises);
  const pulledTags: string[] = [];
  const pulledIds: string[] = [];
  const failedTags: string[] = [];
  for (const settlement of tagsSettlements) {
    if (settlement.status === "fulfilled") {
      if (opts.debug) {
        dependencies.logger.debug(
          `Successfully pulled tag "${settlement.value.tag}" with ID "${settlement.value.id}".`,
        );
      }
      pulledTags.push(settlement.value.tag);
      pulledIds.push(settlement.value.id);
    } else {
      // We know that the only possible error is PullTagError, we check for safety but we don't want any other error to be silently ignored
      if (settlement.reason instanceof PullTagError) {
        if (opts.debug) {
          dependencies.logger.debug(
            `Failed to pull tag "${settlement.reason.tag}".`,
          );
        }
        failedTags.push(settlement.reason.tag);
      } else {
        throw new CliError(
          "Unexpected error while pulling tags, please fill an issue",
        );
      }
    }
  }

  // We filter IDs that were pulled as part of the tag pulling
  filteredIdsToDownload = filteredIdsToDownload.filter(
    (id) => !pulledIds.includes(id),
  );

  if (opts.debug) {
    const remainingIdsCount = filteredIdsToDownload.length;
    dependencies.logger.debug(
      `Remaining IDs to download after filtering: ${remainingIdsCount}`,
    );
  }

  const idsPromises: Promise<{ id: string }>[] = filteredIdsToDownload.map(
    async (id) => {
      const downloadResult = await toAsyncResult(
        dependencies.storageProvider.downloadArtifactById(project, id),
        { debug: opts.debug },
      );
      if (!downloadResult.success) {
        throw new PullIdError(id);
      }

      const createResult = await toAsyncResult(
        dependencies.localArtifactStore.createArtifact(project, id, null, {
          input: downloadResult.value.input,
          outputs: downloadResult.value.contractOutputArtifacts,
        }),
        { debug: opts.debug },
      );
      if (!createResult.success) {
        throw new PullIdError(id);
      }

      return { id };
    },
  );

  const idsSettlements = await Promise.allSettled(idsPromises);
  const failedIds: string[] = [];
  for (const settlement of idsSettlements) {
    if (settlement.status === "fulfilled") {
      if (opts.debug) {
        dependencies.logger.debug(
          `Successfully pulled ID "${settlement.value.id}".`,
        );
      }
      pulledIds.push(settlement.value.id);
    } else {
      if (opts.debug) {
        dependencies.logger.debug(
          `Failed to pull ID "${settlement.reason.id}".`,
        );
      }
      // We know that the only possible error is PullIdError, we check for safety but we don't want any other error to be silently ignored
      if (settlement.reason instanceof PullIdError) {
        failedIds.push(settlement.reason.id);
      } else {
        throw new CliError(
          "Unexpected error while pulling IDs, please fill an issue",
        );
      }
    }
  }

  if (opts.debug) {
    const totalPulled = pulledTags.length + pulledIds.length;
    const totalFailed = failedTags.length + failedIds.length;
    dependencies.logger.debug(
      `Total pulled: ${totalPulled}, Total failed: ${totalFailed}`,
    );
  }

  return {
    remoteTags,
    remoteIds,
    pulledTags,
    pulledIds,
    failedTags,
    failedIds,
  };
}

/**
 * Pull a specific artifact by tag or ID, it consists of the same four steps as pullProject but without the need to fetch and filter the list of remote artifacts, since we already know which artifact we want to pull. The method returns an object containing the list of remote tags and IDs (which will contain only the pulled artifact), the list of successfully pulled tags and IDs, and the list of tags and IDs that failed to be pulled.
 * @throws CliError if there is an error setting up the Local Artifact Store, checking the Local Artifact Store, verifying the existence of the artifact remotely, or downloading the artifact. The error messages are meant to be user-friendly and can be directly shown to the user.
 * @param artifactKey The key of the artifact to pull, which should specify the project and either a tag or an ID
 * @param dependencies.storageProvider The storage provider used to access remote artifacts
 * @param dependencies.localArtifactStore The store used to manage pulled artifacts locally
 * @param dependencies.logger The DebugLogger instance to use for debug logging during the pull process
 * @param opts Options for the pull command
 * @param opts.force Force the pull to skip checking existing pulled artifacts
 * @param opts.debug Enable debug mode
 * @returns An object with the remote tags and IDs, pulled tags and IDs, and failed tags and IDs
 */
export async function pullArtifact(
  artifactKey: ArtifactKey,
  dependencies: {
    storageProvider: StorageProvider;
    localArtifactStore: LocalArtifactStore;
    logger: DebugLogger;
  },
  opts: { force: boolean; debug: boolean },
): Promise<{
  tag: string | null;
  id: string;
  pulled: boolean;
}> {
  // Step 1: Set up Local Artifact Store
  const ensureResult = await toAsyncResult(
    dependencies.localArtifactStore.ensureProjectSetup(artifactKey.project),
    { debug: opts.debug },
  );
  if (!ensureResult.success) {
    throw new CliError(
      "Error setting up Local Artifact Store, is the script not allowed to write to the filesystem? Run with debug mode for more info",
    );
  }
  if (opts.debug) {
    dependencies.logger.debug(
      `Pulled artifact store set up at ${dependencies.localArtifactStore.rootPath}`,
    );
  }

  if (artifactKey.type === "tag") {
    return await pullArtifactByTag(
      artifactKey.project,
      artifactKey.tag,
      dependencies,
      opts,
    );
  } else if (artifactKey.type === "id") {
    return await pullArtifactById(
      artifactKey.project,
      artifactKey.id,
      dependencies,
      opts,
    );
  } else {
    throw new CliError(
      `The tag or ID "${artifactKey satisfies never}" does not exist remotely`,
    );
  }
}

async function pullArtifactById(
  project: string,
  id: string,
  dependencies: {
    storageProvider: StorageProvider;
    localArtifactStore: LocalArtifactStore;
    logger: DebugLogger;
  },
  opts: { force: boolean; debug: boolean },
): Promise<{ tag: null; id: string; pulled: boolean }> {
  // Check if already pulled
  const hasAlreadyPulledResult = await toAsyncResult(
    dependencies.localArtifactStore.hasId(project, id),
    { debug: opts.debug },
  );
  if (!hasAlreadyPulledResult.success) {
    throw new CliError(
      "Error checking pulled artifacts, is the script not allowed to read from the filesystem? Run with debug mode for more info",
    );
  }

  // If already pulled and not force, skip
  if (hasAlreadyPulledResult.value && !opts.force) {
    if (opts.debug) {
      dependencies.logger.debug(
        `Artifact "${project}@${id}" already pulled, skipping`,
      );
    }
    return { tag: null, id, pulled: false };
  }

  // Verify existence remotely
  const hasRemoteResult = await toAsyncResult(
    dependencies.storageProvider.hasArtifactById(project, id),
    { debug: opts.debug },
  );
  if (!hasRemoteResult.success) {
    throw new CliError(
      "Error interacting with the storage, please check the configuration or run with debug mode for more info",
    );
  }
  if (!hasRemoteResult.value) {
    throw new CliError(
      `The artifact "${project}@${id}" does not exist remotely`,
    );
  }

  if (opts.debug) {
    dependencies.logger.debug(
      `Artifact "${project}@${id}" exists remotely, starting download...`,
    );
  }

  // Download artifact
  const downloadResult = await toAsyncResult(
    dependencies.storageProvider.downloadArtifactById(project, id),
    { debug: opts.debug },
  );
  if (!downloadResult.success) {
    throw new CliError(
      `Error downloading the artifact "${project}@${id}", please check the configuration or run with debug mode for more info`,
    );
  }

  if (opts.debug) {
    dependencies.logger.debug(
      `Artifact "${project}@${id}" downloaded successfully`,
    );
  }

  const createResult = await toAsyncResult(
    dependencies.localArtifactStore.createArtifact(project, id, null, {
      input: downloadResult.value.input,
      outputs: downloadResult.value.contractOutputArtifacts,
    }),
    { debug: opts.debug },
  );
  if (!createResult.success) {
    throw new CliError(
      `Error saving the artifact "${project}@${id}" locally, is the script not allowed to write to the filesystem? Run with debug mode for more info`,
    );
  }
  if (opts.debug) {
    dependencies.logger.debug(
      `Artifact "${project}@${id}" saved locally successfully`,
    );
  }

  return {
    tag: null,
    id,
    pulled: true,
  };
}

async function pullArtifactByTag(
  project: string,
  tag: string,
  dependencies: {
    storageProvider: StorageProvider;
    localArtifactStore: LocalArtifactStore;
    logger: DebugLogger;
  },
  opts: { force: boolean; debug: boolean },
): Promise<{ tag: string; id: string; pulled: boolean }> {
  // Check if already pulled
  const hasAlreadyPulledResult = await toAsyncResult(
    dependencies.localArtifactStore.hasTag(project, tag),
    { debug: opts.debug },
  );
  if (!hasAlreadyPulledResult.success) {
    throw new CliError(
      "Error checking pulled artifacts, is the script not allowed to read from the filesystem? Run with debug mode for more info",
    );
  }
  if (opts.debug) {
    dependencies.logger.debug(
      `Checked if artifact "${project}:${tag}" is already pulled: ${
        hasAlreadyPulledResult.value ? "Yes" : "No"
      }`,
    );
  }

  // If already pulled and not force, skip
  if (hasAlreadyPulledResult.value && !opts.force) {
    const artifactIdResult = await toAsyncResult(
      dependencies.localArtifactStore.retrieveArtifactId(project, tag),
      { debug: opts.debug },
    );
    if (artifactIdResult.success) {
      if (opts.debug) {
        dependencies.logger.debug(
          `Artifact "${project}:${tag}" already pulled, skipping`,
        );
      }
      return {
        tag,
        id: artifactIdResult.value,
        pulled: false,
      };
    } else {
      if (opts.debug) {
        dependencies.logger.debug(
          `Artifact "${project}:${tag}" already pulled but failed to retrieve the associated ID, pulling again. Run with debug mode for more info`,
        );
      }
    }
  }

  // Verify existence remotely
  const hasRemoteResult = await toAsyncResult(
    dependencies.storageProvider.hasArtifactByTag(project, tag),
    { debug: opts.debug },
  );
  if (!hasRemoteResult.success) {
    throw new CliError(
      "Error interacting with the storage, please check the configuration or run with debug mode for more info",
    );
  }
  if (!hasRemoteResult.value) {
    throw new CliError(
      `The artifact "${project}:${tag}" does not exist remotely`,
    );
  }

  if (opts.debug) {
    dependencies.logger.debug(
      `Artifact "${project}:${tag}" exists remotely, starting download...`,
    );
  }

  // Download artifact
  const downloadResult = await toAsyncResult(
    dependencies.storageProvider.downloadArtifactByTag(project, tag),
    { debug: opts.debug },
  );
  if (!downloadResult.success) {
    throw new CliError(
      `Error downloading the artifact "${project}:${tag}", please check the configuration or run with debug mode for more info`,
    );
  }

  const createResult = await toAsyncResult(
    dependencies.localArtifactStore.createArtifact(
      project,
      downloadResult.value.id,
      tag,
      {
        input: downloadResult.value.input,
        outputs: downloadResult.value.contractOutputArtifacts,
      },
    ),
    { debug: opts.debug },
  );
  if (!createResult.success) {
    throw new CliError(
      `Error saving the artifact "${project}:${tag}" locally, is the script not allowed to write to the filesystem? Run with debug mode for more info`,
    );
  }

  if (opts.debug) {
    dependencies.logger.debug(
      `Artifact "${project}:${tag}" saved locally successfully`,
    );
  }

  return {
    tag,
    id: downloadResult.value.id,
    pulled: true,
  };
}

class PullTagError extends Error {
  public tag: string;
  constructor(tag: string) {
    super(`Error pulling the tag "${tag}"`);
    this.tag = tag;
  }
}

class PullIdError extends Error {
  public id: string;
  constructor(id: string) {
    super(`Error pulling the ID "${id}"`);
    this.id = id;
  }
}
