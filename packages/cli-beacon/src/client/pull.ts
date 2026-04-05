import { CommandLogger } from "@/ui";
import { PulledArtifactStore } from "../pulled-artifact-store/pulled-artifact-store";
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
 * 1. Set up the pulled artifact store for the project
 * 2. Fetch the list of remote tags and IDs from the storage provider, and filter them based on the provided tagOrId parameter
 * 3. Check which of the filtered tags and IDs are already present in the pulled artifact store, unless the force option is enabled
 * 4. Download the missing artifacts from the storage provider and save them to the pulled artifact store
 *
 * The method returns an object containing the list of remote tags and IDs, the list of successfully pulled tags and IDs, and the list of tags and IDs that failed to be pulled.
 * @throws CliError if there is an error setting up the pulled artifact store, fetching the remote artifacts, checking the pulled artifact store, or downloading the artifacts. The error messages are meant to be user-friendly and can be directly shown to the user.
 * @param project The project to pull artifacts for
 * @param storageProvider The storage provider used to access remote artifacts
 * @param pulledArtifactStore The pulled artifact store used to persist pulled artifacts
 * @param opts Options for the pull command
 * @param opts.force Force the pull to skip checking existing pulled artifacts
 * @param opts.debug Enable debug mode
 * @param opts.logger The CommandLogger instance to use for logging and prompting the user during the pull process
 * @returns An object with the remote tags and IDs, pulled tags and IDs, and failed tags and IDs
 */
export async function pullProject(
  project: string,
  storageProvider: StorageProvider,
  pulledArtifactStore: PulledArtifactStore,
  opts: { force: boolean; debug: boolean; logger: CommandLogger },
): Promise<PullResult> {
  // Step 1: Set up pulled artifact store
  const ensureResult = await toAsyncResult(
    pulledArtifactStore.ensureProjectSetup(project),
    { debug: opts.debug },
  );
  if (!ensureResult.success) {
    throw new CliError(
      "Error setting up pulled artifact store, is the script not allowed to write to the filesystem? Run with debug mode for more info",
    );
  }
  if (opts.debug) {
    opts.logger.message(
      `Pulled artifact store set up at ${pulledArtifactStore.rootPath}`,
    );
  }

  // Step 2: Fetch remote artifacts
  const spinner2 = opts.logger.createSpinner(
    "Checking for remote artifacts...",
  );
  const remoteListingResult = await toAsyncResult(
    Promise.all([
      storageProvider.listTags(project),
      storageProvider.listIds(project),
    ]),
    { debug: opts.debug },
  );
  if (!remoteListingResult.success) {
    spinner2.fail("Failed to fetch remote artifacts");
    throw new CliError(
      "Error interacting with the storage, please check the configuration or run with debug mode for more info",
    );
  }
  const [remoteTags, remoteIds] = remoteListingResult.value;
  spinner2.succeed("Remote artifacts checked");

  if (opts.debug) {
    opts.logger.message(`Remote tags: ${remoteTags.join(", ")}`);
    opts.logger.message(`Remote IDs: ${remoteIds.join(", ")}`);
  }

  const tagsToDownload = remoteTags;
  const idsToDownload = remoteIds;

  if (opts.debug) {
    opts.logger.message(`Tags to download: ${tagsToDownload.join(", ")}`);
    opts.logger.message(`IDs to download: ${idsToDownload.join(", ")}`);
  }

  // Step 3: Check pulled artifact store
  const spinner3 = opts.logger.createSpinner(
    "Checking already pulled artifacts...",
  );
  let filteredTagsToDownload: string[] = [];
  let filteredIdsToDownload: string[] = [];
  if (opts.force) {
    filteredTagsToDownload = tagsToDownload;
    filteredIdsToDownload = idsToDownload;
    spinner3.succeed("Pulled artifact store check skipped (force mode)");
  } else {
    const localListingResult = await toAsyncResult(
      Promise.all([
        pulledArtifactStore
          .listTags(project)
          .then(
            (tagMetadatas) =>
              new Set(tagMetadatas.map((metadata) => metadata.tag)),
          ),
        pulledArtifactStore
          .listIds(project)
          .then(
            (idMetadatas) =>
              new Set(idMetadatas.map((metadata) => metadata.id)),
          ),
      ]),
      { debug: opts.debug },
    );
    if (!localListingResult.success) {
      spinner3.fail("Failed to check pulled artifacts");
      throw new CliError(
        "Error checking pulled artifacts, is the script not allowed to read from the filesystem? Run with debug mode for more info",
      );
    }

    const [localTags, localIds] = localListingResult.value;

    filteredTagsToDownload = tagsToDownload.filter(
      (tag) => !localTags.has(tag),
    );
    filteredIdsToDownload = idsToDownload.filter((id) => !localIds.has(id));
    spinner3.succeed("Checked already pulled artifacts");
  }

  // Step 4: Download artifacts
  if (
    filteredTagsToDownload.length === 0 &&
    filteredIdsToDownload.length === 0
  ) {
    const spinner4 = opts.logger.createSpinner("Checking for updates...");
    spinner4.succeed("All artifacts are up to date");
    return {
      remoteTags,
      remoteIds,
      pulledTags: [],
      pulledIds: [],
      failedTags: [],
      failedIds: [],
    };
  }

  const missingArtifactCount =
    filteredTagsToDownload.length + filteredIdsToDownload.length;
  const spinner4 = opts.logger.createSpinner(
    `Downloading ${missingArtifactCount} missing artifact${missingArtifactCount > 1 ? "s" : ""}...`,
  );

  const tagsPromises: Promise<{ tag: string; id: string }>[] =
    filteredTagsToDownload.map(async (tag) => {
      const downloadResult = await toAsyncResult(
        storageProvider.downloadArtifactByTag(project, tag),
        { debug: opts.debug },
      );
      if (!downloadResult.success) {
        throw new PullTagError(tag);
      }

      const createResult = await toAsyncResult(
        pulledArtifactStore.createArtifact(
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
      pulledTags.push(settlement.value.tag);
      pulledIds.push(settlement.value.id);
    } else {
      // We know that the only possible error is PullTagError, we check for safety but we don't want any other error to be silently ignored
      if (settlement.reason instanceof PullTagError) {
        failedTags.push(settlement.reason.tag);
      } else {
        spinner4.fail("Failed to download artifacts");
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

  const idsPromises: Promise<{ id: string }>[] = filteredIdsToDownload.map(
    async (id) => {
      const downloadResult = await toAsyncResult(
        storageProvider.downloadArtifactById(project, id),
        { debug: opts.debug },
      );
      if (!downloadResult.success) {
        throw new PullIdError(id);
      }

      const createResult = await toAsyncResult(
        pulledArtifactStore.createArtifact(project, id, null, {
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
      pulledIds.push(settlement.value.id);
    } else {
      // We know that the only possible error is PullIdError, we check for safety but we don't want any other error to be silently ignored
      if (settlement.reason instanceof PullIdError) {
        failedIds.push(settlement.reason.id);
      } else {
        spinner4.fail("Failed to download artifacts");
        throw new CliError(
          "Unexpected error while pulling IDs, please fill an issue",
        );
      }
    }
  }

  const totalPulled = pulledTags.length + pulledIds.length;
  const totalFailed = failedTags.length + failedIds.length;

  if (totalFailed > 0) {
    spinner4.fail(
      `Downloaded ${totalPulled} artifact${totalPulled > 1 ? "s" : ""}, ${totalFailed} failed`,
    );
  } else {
    spinner4.succeed(
      `Downloaded ${totalPulled} artifact${totalPulled > 1 ? "s" : ""} successfully`,
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
 * @throws CliError if there is an error setting up the pulled artifact store, checking the pulled artifact store, verifying the existence of the artifact remotely, or downloading the artifact. The error messages are meant to be user-friendly and can be directly shown to the user.
 * @param artifactKey The key of the artifact to pull, which should specify the project and either a tag or an ID
 * @param storageProvider The storage provider used to access remote artifacts
 * @param pulledArtifactStore The store used to manage pulled artifacts locally
 * @param opts Options for the pull command
 * @param opts.force Force the pull to skip checking existing pulled artifacts
 * @param opts.debug Enable debug mode
 * @param opts.logger The CommandLogger instance to use for logging and prompting the user during the pull process
 * @returns An object with the remote tags and IDs, pulled tags and IDs, and failed tags and IDs
 */
export async function pullArtifact(
  artifactKey: ArtifactKey,
  storageProvider: StorageProvider,
  pulledArtifactStore: PulledArtifactStore,
  opts: { force: boolean; debug: boolean; logger: CommandLogger },
): Promise<PullResult> {
  // Step 1: Set up pulled artifact store
  const ensureResult = await toAsyncResult(
    pulledArtifactStore.ensureProjectSetup(artifactKey.project),
    { debug: opts.debug },
  );
  if (!ensureResult.success) {
    throw new CliError(
      "Error setting up pulled artifact store, is the script not allowed to write to the filesystem? Run with debug mode for more info",
    );
  }
  if (opts.debug) {
    opts.logger.message(
      `Pulled artifact store set up at ${pulledArtifactStore.rootPath}`,
    );
  }

  if (artifactKey.type === "tag") {
    return await pullArtifactByTag(
      artifactKey.project,
      artifactKey.tag,
      storageProvider,
      pulledArtifactStore,
      opts,
    );
  } else if (artifactKey.type === "id") {
    return await pullArtifactById(
      artifactKey.project,
      artifactKey.id,
      storageProvider,
      pulledArtifactStore,
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
  storageProvider: StorageProvider,
  pulledArtifactStore: PulledArtifactStore,
  opts: { force: boolean; debug: boolean; logger: CommandLogger },
): Promise<PullResult> {
  // Check if already pulled
  const hasAlreadyPulledResult = await toAsyncResult(
    pulledArtifactStore.hasId(project, id),
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
      opts.logger.message(
        `Artifact "${project}@${id}" already pulled, skipping`,
      );
    }
    return {
      remoteTags: [],
      remoteIds: [id],
      pulledTags: [],
      pulledIds: [],
      failedTags: [],
      failedIds: [],
    };
  }

  // Verify existence remotely
  const hasRemoteResult = await toAsyncResult(
    storageProvider.hasArtifactById(project, id),
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

  // Download artifact
  const downloadResult = await toAsyncResult(
    storageProvider.downloadArtifactById(project, id),
    { debug: opts.debug },
  );
  if (!downloadResult.success) {
    throw new CliError(
      `Error downloading the artifact "${project}@${id}", please check the configuration or run with debug mode for more info`,
    );
  }

  const createResult = await toAsyncResult(
    pulledArtifactStore.createArtifact(project, id, null, {
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

  return {
    remoteTags: [],
    remoteIds: [id],
    pulledTags: [],
    pulledIds: [id],
    failedTags: [],
    failedIds: [],
  };
}

async function pullArtifactByTag(
  project: string,
  tag: string,
  storageProvider: StorageProvider,
  pulledArtifactStore: PulledArtifactStore,
  opts: { force: boolean; debug: boolean; logger: CommandLogger },
): Promise<PullResult> {
  // Check if already pulled
  const hasAlreadyPulledResult = await toAsyncResult(
    pulledArtifactStore.hasTag(project, tag),
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
      opts.logger.message(
        `Artifact "${project}:${tag}" already pulled, skipping`,
      );
    }
    return {
      remoteTags: [tag],
      remoteIds: [],
      pulledTags: [],
      pulledIds: [],
      failedTags: [],
      failedIds: [],
    };
  }

  // Verify existence remotely
  const hasRemoteResult = await toAsyncResult(
    storageProvider.hasArtifactByTag(project, tag),
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

  // Download artifact
  const downloadResult = await toAsyncResult(
    storageProvider.downloadArtifactByTag(project, tag),
    { debug: opts.debug },
  );
  if (!downloadResult.success) {
    throw new CliError(
      `Error downloading the artifact "${project}:${tag}", please check the configuration or run with debug mode for more info`,
    );
  }

  const createResult = await toAsyncResult(
    pulledArtifactStore.createArtifact(project, downloadResult.value.id, tag, {
      input: downloadResult.value.input,
      outputs: downloadResult.value.contractOutputArtifacts,
    }),
    { debug: opts.debug },
  );
  if (!createResult.success) {
    throw new CliError(
      `Error saving the artifact "${project}:${tag}" locally, is the script not allowed to write to the filesystem? Run with debug mode for more info`,
    );
  }

  return {
    remoteTags: [tag],
    remoteIds: [downloadResult.value.id],
    pulledTags: [tag],
    pulledIds: [downloadResult.value.id],
    failedTags: [],
    failedIds: [],
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
