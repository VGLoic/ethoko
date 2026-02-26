import { LocalStorage } from "../local-storage";
import { StorageProvider } from "../storage-provider";
import { StepTracker } from "@/cli-ui/utils";
import { toAsyncResult } from "../utils/result";
import { CliError } from "./error";

export type PullResult = {
  remoteTags: string[];
  remoteIds: string[];
  pulledTags: string[];
  pulledIds: string[];
  failedTags: string[];
  failedIds: string[];
};

/**
 * Run the pull command of the CLI clients, it consists of four steps:
 * 1. Set up the local storage for the project
 * 2. Fetch the list of remote tags and IDs from the storage provider, and filter them based on the provided tagOrId parameter
 * 3. Check which of the filtered tags and IDs are already present in the local storage, unless the force option is enabled
 * 4. Download the missing artifacts from the storage provider and save them to the local storage
 *
 * The method returns an object containing the list of remote tags and IDs, the list of successfully pulled tags and IDs, and the list of tags and IDs that failed to be pulled.
 * @throws CliError if there is an error setting up the local storage, fetching the remote artifacts, checking the local artifacts, or downloading the artifacts. The error messages are meant to be user-friendly and can be directly shown to the user.
 * @param project The project name
 * @param search An optional object to specify a tag or ID to pull, if not provided all tags and IDs will be pulled
 * @param storageProvider The storage provider used to access remote artifacts
 * @param localStorage The local storage used to persist pulled artifacts
 * @param opts Options for the pull command
 * @param opts.force Force the pull to skip checking existing local artifacts
 * @param opts.debug Enable debug mode
 * @param opts.silent Suppress CLI output (errors and warnings still shown)
 * @returns An object with the remote tags and IDs, pulled tags and IDs, and failed tags and IDs
 *
 */
export async function pull(
  project: string,
  search: { type: "tag"; tag: string } | { type: "id"; id: string } | null,
  storageProvider: StorageProvider,
  localStorage: LocalStorage,
  opts: { force: boolean; debug: boolean; silent?: boolean },
): Promise<PullResult> {
  const steps = new StepTracker(4, opts.silent);

  // Step 1: Set up local storage
  steps.start("Setting up local storage...");
  const ensureResult = await toAsyncResult(
    localStorage.ensureProjectSetup(project),
    { debug: opts.debug },
  );
  if (!ensureResult.success) {
    steps.fail("Failed to setup local storage");
    throw new CliError(
      "Error setting up local storage, is the script not allowed to write to the filesystem? Run with debug mode for more info",
    );
  }
  steps.succeed("Local storage ready");

  // Step 2: Fetch remote artifacts
  steps.start("Fetching remote artifact list...");
  const remoteListingResult = await toAsyncResult(
    Promise.all([
      storageProvider.listTags(project),
      storageProvider.listIds(project),
    ]),
    { debug: opts.debug },
  );
  if (!remoteListingResult.success) {
    steps.fail("Failed to fetch remote artifacts");
    throw new CliError(
      "Error interacting with the storage, please check the configuration or run with debug mode for more info",
    );
  }
  const [remoteTags, remoteIds] = remoteListingResult.value;
  steps.succeed("Fetched remote artifact list");

  let tagsToDownload: string[];
  let idsToDownload: string[];
  if (search) {
    if (search.type === "tag" && remoteTags.includes(search.tag)) {
      tagsToDownload = [search.tag];
      idsToDownload = [];
    } else if (search.type === "id" && remoteIds.includes(search.id)) {
      tagsToDownload = [];
      idsToDownload = [search.id];
    } else {
      steps.fail("The tag or ID does not exist in the storage");
      throw new CliError(
        `The tag or ID "${search.type === "tag" ? search.tag : search.id}" does not exist in the storage`,
      );
    }
  } else {
    tagsToDownload = remoteTags;
    idsToDownload = remoteIds;
  }

  if (opts.debug) {
    console.debug("");
    console.debug(`[DEBUG] Remote tags: ${remoteTags.join(", ")}`);
    console.debug(`[DEBUG] Remote IDs: ${remoteIds.join(", ")}`);
    console.debug(`[DEBUG] Tags to download: ${tagsToDownload.join(", ")}`);
    console.debug(`[DEBUG] IDs to download: ${idsToDownload.join(", ")}`);
    console.debug("");
  }

  // Step 3: Check local artifacts
  steps.start("Checking local artifacts...");
  let filteredTagsToDownload: string[] = [];
  let filteredIdsToDownload: string[] = [];
  if (opts.force) {
    filteredTagsToDownload = tagsToDownload;
    filteredIdsToDownload = idsToDownload;
    steps.succeed("Local artifacts check skipped (force mode)");
  } else {
    const localListingResult = await toAsyncResult(
      Promise.all([
        localStorage
          .listTags(project)
          .then(
            (tagMetadatas) =>
              new Set(tagMetadatas.map((metadata) => metadata.tag)),
          ),
        localStorage
          .listIds(project)
          .then(
            (idMetadatas) =>
              new Set(idMetadatas.map((metadata) => metadata.id)),
          ),
      ]),
      { debug: opts.debug },
    );
    if (!localListingResult.success) {
      steps.fail("Failed to check local artifacts");
      throw new CliError(
        "Error checking local storage, is the script not allowed to read from the filesystem? Run with debug mode for more info",
      );
    }

    const [localTags, localIds] = localListingResult.value;

    filteredTagsToDownload = tagsToDownload.filter(
      (tag) => !localTags.has(tag),
    );
    filteredIdsToDownload = idsToDownload.filter((id) => !localIds.has(id));
    steps.succeed("Checked local artifacts");
  }

  // Step 4: Download artifacts
  if (
    filteredTagsToDownload.length === 0 &&
    filteredIdsToDownload.length === 0
  ) {
    steps.start("Checking for updates...");
    steps.succeed("All artifacts are up to date");
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
  steps.start(
    `Downloading ${missingArtifactCount} missing artifact${missingArtifactCount > 1 ? "s" : ""}...`,
  );

  const tagsPromises: Promise<{ tag: string }>[] = filteredTagsToDownload.map(
    async (tag) => {
      const downloadResult = await toAsyncResult(
        storageProvider.downloadArtifactByTag(project, tag),
        { debug: opts.debug },
      );
      if (!downloadResult.success) {
        throw new PullTagError(tag);
      }

      const createResult = await toAsyncResult(
        localStorage.createArtifactByTag(
          project,
          tag,
          downloadResult.value.id,
          downloadResult.value.input,
          downloadResult.value.output,
        ),
        { debug: opts.debug },
      );
      if (!createResult.success) {
        throw new PullTagError(tag);
      }

      return { tag };
    },
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
        localStorage.createArtifactById(
          project,
          id,
          downloadResult.value.input,
          downloadResult.value.output,
        ),
        { debug: opts.debug },
      );
      if (!createResult.success) {
        throw new PullIdError(id);
      }

      return { id };
    },
  );

  const tagsSettlements = await Promise.allSettled(tagsPromises);
  const pulledTags: string[] = [];
  const failedTags: string[] = [];
  for (const settlement of tagsSettlements) {
    if (settlement.status === "fulfilled") {
      pulledTags.push(settlement.value.tag);
    } else {
      // We know that the only possible error is PullTagError, we check for safety but we don't want any other error to be silently ignored
      if (settlement.reason instanceof PullTagError) {
        failedTags.push(settlement.reason.tag);
      } else {
        steps.fail("Failed to download artifacts");
        throw new CliError(
          "Unexpected error while pulling tags, please fill an issue",
        );
      }
    }
  }

  const idsSettlements = await Promise.allSettled(idsPromises);
  const pulledIds: string[] = [];
  const failedIds: string[] = [];
  for (const settlement of idsSettlements) {
    if (settlement.status === "fulfilled") {
      pulledIds.push(settlement.value.id);
    } else {
      // We know that the only possible error is PullIdError, we check for safety but we don't want any other error to be silently ignored
      if (settlement.reason instanceof PullIdError) {
        failedIds.push(settlement.reason.id);
      } else {
        steps.fail("Failed to download artifacts");
        throw new CliError(
          "Unexpected error while pulling IDs, please fill an issue",
        );
      }
    }
  }

  const totalPulled = pulledTags.length + pulledIds.length;
  const totalFailed = failedTags.length + failedIds.length;

  if (totalFailed > 0) {
    steps.fail(
      `Downloaded ${totalPulled} artifact${totalPulled > 1 ? "s" : ""}, ${totalFailed} failed`,
    );
  } else {
    steps.succeed(
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
