import { PulledArtifactStore } from "@/pulled-artifact-store/pulled-artifact-store";
import { toAsyncResult } from "@/utils/result";
import { CliError } from "./error";
import { CommandLogger } from "@/ui";

export type PruneResult = {
  project: string;
  id: string;
  tag: string | null;
  size: number;
}[];
export async function pruneOrphanedAndUntaggedArtifacts(
  store: PulledArtifactStore,
  configuredProjects: Set<string>,
  opts: {
    dryRun: boolean;
    debug: boolean;
    logger: CommandLogger;
  },
): Promise<PruneResult> {
  const storedProjectsResult = await toAsyncResult(store.listProjects(), {
    debug: opts.debug,
  });
  if (!storedProjectsResult.success) {
    throw new CliError(
      "Failed to list projects locally. Run with debug for more details. File an issue if the problem persists.",
    );
  }

  const orphanedProjects: string[] = [];
  const configuredStoredProjects: string[] = [];
  for (const p of storedProjectsResult.value) {
    if (configuredProjects.has(p)) {
      configuredStoredProjects.push(p);
    } else {
      orphanedProjects.push(p);
    }
  }

  const artifactsToPrune = [];

  // Retrieve all artifacts for orphaned projects
  const orphanedArtifactsSettlements = await Promise.allSettled(
    orphanedProjects.map((project) =>
      listProjectArtifacts(project, store).catch((err) => {
        throw new ProjectError(project, err);
      }),
    ),
  );
  let hasOrphanedArtifactsError = false;
  for (const settlement of orphanedArtifactsSettlements) {
    if (settlement.status === "fulfilled") {
      artifactsToPrune.push(...settlement.value);
    } else {
      hasOrphanedArtifactsError = true;
      if (opts.debug) {
        const reason = settlement.reason as ProjectError;
        opts.logger.error(
          `Failed to list artifacts for an orphaned project "${reason.project}". Error: ${reason.error}`,
        );
      }
    }
  }
  if (hasOrphanedArtifactsError) {
    throw new CliError(
      "Failed to list artifacts for orphaned projects. Run with debug for more details. File an issue if the problem persists.",
    );
  }

  // Retrieve all untagged artifacts for configured projects
  const untaggedArtifactsSettlements = await Promise.allSettled(
    configuredStoredProjects.map((project) =>
      listProjectArtifacts(project, store)
        .then((artifacts) => artifacts.filter((a) => a.tag === null))
        .catch((err) => {
          throw new ProjectError(project, err);
        }),
    ),
  );
  let hasUntaggedArtifactsError = false;
  for (const settlement of untaggedArtifactsSettlements) {
    if (settlement.status === "fulfilled") {
      artifactsToPrune.push(...settlement.value);
    } else {
      hasUntaggedArtifactsError = true;
      if (opts.debug) {
        const reason = settlement.reason as ProjectError;
        opts.logger.error(
          `Failed to list untagged artifacts for a configured project "${reason.project}". Error: ${reason.error}`,
        );
      }
    }
  }
  if (hasUntaggedArtifactsError) {
    throw new CliError(
      "Failed to list untagged artifacts for configured projects. Run with debug for more details. File an issue if the problem persists.",
    );
  }

  const artifactsWithSizeSettlements = await Promise.allSettled(
    artifactsToPrune.map((artifact) =>
      store
        .getIdSize(artifact.project, artifact.id)
        .then((size) => ({ ...artifact, size })),
    ),
  );
  const artifactsWithSize: PruneResult = [];
  let hasGetSizeError = false;
  for (const settlement of artifactsWithSizeSettlements) {
    if (settlement.status === "fulfilled") {
      artifactsWithSize.push(settlement.value);
    } else {
      hasGetSizeError = true;
      if (opts.debug) {
        opts.logger.error(
          `Failed to get size for an artifact "${settlement.reason.project}@${settlement.reason.id}". Error: ${settlement.reason.error}`,
        );
      }
    }
  }
  if (hasGetSizeError) {
    throw new CliError(
      "Failed to get size for some artifacts. Run with debug for more details. File an issue if the problem persists.",
    );
  }

  if (opts.dryRun) {
    return artifactsWithSize;
  }

  const deleteSettlements = await Promise.allSettled(
    artifactsWithSize.map((artifact) => {
      const promise = artifact.tag
        ? store
            .deleteTag(artifact.project, artifact.tag)
            .then(() => store.deleteId(artifact.project, artifact.id))
        : store.deleteId(artifact.project, artifact.id);
      return promise
        .then(() => artifact)
        .catch((err) => {
          throw new ArtifactError(
            artifact.project,
            artifact.id,
            artifact.tag,
            err,
          );
        });
    }),
  );
  let hasDeleteError = false;
  for (const settlement of deleteSettlements) {
    if (settlement.status === "rejected") {
      hasDeleteError = true;
      if (opts.debug) {
        const reason = settlement.reason as ArtifactError;
        const artifactDisplay = reason.tag
          ? `${reason.project}:${reason.tag}`
          : `${reason.project}@${reason.id}`;
        opts.logger.error(
          `Failed to delete an artifact "${artifactDisplay}". Error: ${reason.error}`,
        );
      }
    }
  }
  if (hasDeleteError) {
    throw new CliError(
      "Failed to delete some artifacts. Run with debug for more details. File an issue if the problem persists.",
    );
  }

  return artifactsWithSize;
}

export async function pruneProjectArtifacts(
  store: PulledArtifactStore,
  project: string,
  opts: {
    dryRun: boolean;
    debug: boolean;
    logger: CommandLogger;
  },
): Promise<PruneResult> {
  const artifacts = await listProjectArtifacts(project, store);
  const artifactsWithSizeSettlements = await Promise.allSettled(
    artifacts.map((artifact) =>
      store
        .getIdSize(artifact.project, artifact.id)
        .then((size) => ({ ...artifact, size }))
        .catch((err) => {
          throw new ArtifactError(
            artifact.project,
            artifact.id,
            artifact.tag,
            err,
          );
        }),
    ),
  );
  const artifactsWithSize: PruneResult = [];
  let hasGetSizeError = false;
  for (const settlement of artifactsWithSizeSettlements) {
    if (settlement.status === "fulfilled") {
      artifactsWithSize.push(settlement.value);
    } else {
      hasGetSizeError = true;
      if (opts.debug) {
        const reason = settlement.reason as ArtifactError;
        const artifactDisplay = reason.tag
          ? `${reason.project}:${reason.tag}`
          : `${reason.project}@${reason.id}`;
        opts.logger.error(
          `Failed to get size for an artifact "${artifactDisplay}". Error: ${reason.error}`,
        );
      }
    }
  }
  if (hasGetSizeError) {
    throw new CliError(
      "Failed to get size for some artifacts. Run with debug for more details. File an issue if the problem persists.",
    );
  }

  if (opts.dryRun) {
    return artifactsWithSize;
  }

  const deleteSettlements = await Promise.allSettled(
    artifactsWithSize.map((artifact) => {
      const promise = artifact.tag
        ? store
            .deleteTag(artifact.project, artifact.tag)
            .then(() => store.deleteId(artifact.project, artifact.id))
        : store.deleteId(artifact.project, artifact.id);
      return promise
        .then(() => artifact)
        .catch((err) => {
          throw new ArtifactError(
            artifact.project,
            artifact.id,
            artifact.tag,
            err,
          );
        });
    }),
  );
  let hasDeleteError = false;
  for (const settlement of deleteSettlements) {
    if (settlement.status === "rejected") {
      hasDeleteError = true;
      if (opts.debug) {
        const reason = settlement.reason as ArtifactError;
        const artifactDisplay = reason.tag
          ? `${reason.project}:${reason.tag}`
          : `${reason.project}@${reason.id}`;
        opts.logger.error(
          `Failed to delete an artifact "${artifactDisplay}". Error: ${reason.error}`,
        );
      }
    }
  }
  if (hasDeleteError) {
    throw new CliError(
      "Failed to delete some artifacts. Run with debug for more details. File an issue if the problem persists.",
    );
  }

  return artifactsWithSize;
}

export async function pruneArtifactById(
  store: PulledArtifactStore,
  project: string,
  id: string,
  opts: {
    dryRun: boolean;
    debug: boolean;
    logger: CommandLogger;
  },
): Promise<PruneResult> {
  const hasIdResult = await toAsyncResult(store.hasId(project, id), {
    debug: opts.debug,
  });
  if (!hasIdResult.success) {
    throw new CliError(
      `Failed to check if the artifact exists. Run with debug for more details. File an issue if the problem persists.`,
    );
  }
  if (!hasIdResult.value) {
    throw new CliError(
      `Artifact "${project}@${id}" not found. Run with debug for more details. File an issue if the problem persists.`,
    );
  }
  const sizeResult = await toAsyncResult(store.getIdSize(project, id), {
    debug: opts.debug,
  });
  if (!sizeResult.success) {
    throw new CliError(
      `Failed to get size for the artifact "${project}@${id}". Run with debug for more details. File an issue if the problem persists.`,
    );
  }
  const artifactWithSize = {
    project,
    id,
    tag: null,
    size: sizeResult.value,
  };

  if (opts.dryRun) {
    return [artifactWithSize];
  }

  const deleteResult = await toAsyncResult(store.deleteId(project, id), {
    debug: opts.debug,
  });
  if (!deleteResult.success) {
    throw new CliError(
      `Failed to delete the artifact "${project}@${id}". Run with debug for more details. File an issue if the problem persists.`,
    );
  }

  return [artifactWithSize];
}

export async function pruneArtifactByTag(
  store: PulledArtifactStore,
  project: string,
  tag: string,
  opts: {
    dryRun: boolean;
    debug: boolean;
    logger: CommandLogger;
  },
): Promise<PruneResult> {
  const hasTagResult = await toAsyncResult(store.hasTag(project, tag), {
    debug: opts.debug,
  });
  if (!hasTagResult.success) {
    throw new CliError(
      `Failed to check if the artifact exists. Run with debug for more details. File an issue if the problem persists.`,
    );
  }
  if (!hasTagResult.value) {
    throw new CliError(
      `Artifact "${project}:${tag}" not found. Run with debug for more details. File an issue if the problem persists.`,
    );
  }
  const idResult = await toAsyncResult(store.retrieveArtifactId(project, tag), {
    debug: opts.debug,
  });
  if (!idResult.success) {
    throw new CliError(
      `Failed to retrieve the artifact ID for "${project}:${tag}". Run with debug for more details. File an issue if the problem persists.`,
    );
  }
  const id = idResult.value;
  const sizeResult = await toAsyncResult(store.getIdSize(project, id), {
    debug: opts.debug,
  });
  if (!sizeResult.success) {
    throw new CliError(
      `Failed to get size for the artifact "${project}:${tag}". Run with debug for more details. File an issue if the problem persists.`,
    );
  }
  const artifactWithSize = {
    project,
    id,
    tag,
    size: sizeResult.value,
  };

  if (opts.dryRun) {
    return [artifactWithSize];
  }

  const deleteResult = await toAsyncResult(store.deleteId(project, id), {
    debug: opts.debug,
  });
  if (!deleteResult.success) {
    throw new CliError(
      `Failed to delete the artifact "${project}:${tag}". Run with debug for more details. File an issue if the problem persists.`,
    );
  }

  return [artifactWithSize];
}

async function listProjectArtifacts(
  project: string,
  store: PulledArtifactStore,
): Promise<
  {
    project: string;
    id: string;
    tag: string | null;
  }[]
> {
  const tags = await store.listTags(project);
  const idFromTags = new Set();
  const artifacts: {
    project: string;
    id: string;
    tag: string | null;
  }[] = [];
  for (const tagInfo of tags) {
    idFromTags.add(tagInfo.id);
    artifacts.push({
      project,
      id: tagInfo.id,
      tag: tagInfo.tag,
    });
  }
  const ids = await store.listIds(project);
  for (const idInfo of ids) {
    if (!idFromTags.has(idInfo.id)) {
      artifacts.push({
        project,
        id: idInfo.id,
        tag: null,
      });
    }
  }
  return artifacts;
}

// Identify a project and an underlying error
class ProjectError extends Error {
  constructor(
    public project: string,
    public error: unknown,
  ) {
    super(
      `Error in project "${project}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

class ArtifactError extends Error {
  constructor(
    public project: string,
    public id: string,
    public tag: string | null,
    public error: unknown,
  ) {
    super(
      `Error in artifact "${project}@${id}"${tag ? ` with tag "${tag}"` : ""}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
