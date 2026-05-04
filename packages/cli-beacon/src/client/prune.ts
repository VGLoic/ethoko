import { LocalArtifactStore } from "@/local-artifact-store";
import { toAsyncResult } from "@/utils/result";
import { CliError } from "./error";
import { ArtifactKey } from "@/utils/artifact-key";
import { DebugLogger } from "@/utils/debug-logger";

export type PruneResult = {
  project: string;
  id: string;
  tag: string | null;
  size: number;
}[];
export async function pruneOrphanedAndUntaggedArtifacts(
  configuredProjects: Set<string>,
  dependencies: {
    localArtifactStore: LocalArtifactStore;
    logger: DebugLogger;
  },
  opts: {
    dryRun: boolean;
    debug: boolean;
  },
): Promise<PruneResult> {
  const storedProjectsResult = await toAsyncResult(
    dependencies.localArtifactStore.listProjects(),
    {
      debug: opts.debug,
    },
  );
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
  if (opts.debug) {
    dependencies.logger.debug(
      `Identified ${orphanedProjects.length} orphaned project(s) and ${configuredStoredProjects.length} configured project(s) with stored artifacts.`,
    );

    if (orphanedProjects.length > 0) {
      dependencies.logger.debug(
        `Orphaned projects: ${orphanedProjects.join(", ")}`,
      );
    }
    if (configuredStoredProjects.length > 0) {
      dependencies.logger.debug(
        `Configured projects with stored artifacts: ${configuredStoredProjects.join(
          ", ",
        )}`,
      );
    }
  }

  const artifactsToPrune = [];

  // Retrieve all artifacts for orphaned projects
  const orphanedArtifactsSettlements = await Promise.allSettled(
    orphanedProjects.map((project) =>
      listProjectArtifacts(project, dependencies.localArtifactStore).catch(
        (err) => {
          throw new ProjectError(project, err);
        },
      ),
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
        dependencies.logger.debug(
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

  if (opts.debug) {
    dependencies.logger.debug(
      `Identified ${artifactsToPrune.length} artifact(s) to prune from orphaned projects.`,
    );
  }

  // Retrieve all untagged artifacts for configured projects
  const untaggedArtifactsSettlements = await Promise.allSettled(
    configuredStoredProjects.map((project) =>
      listProjectArtifacts(project, dependencies.localArtifactStore)
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
        dependencies.logger.debug(
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

  if (opts.debug) {
    dependencies.logger.debug(
      `Identified ${artifactsToPrune.length} artifact(s) to prune from orphaned projects and untagged artifacts from configured projects.`,
    );
  }

  const artifactsWithSizeSettlements = await Promise.allSettled(
    artifactsToPrune.map((artifact) =>
      dependencies.localArtifactStore
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
        dependencies.logger.debug(
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

  if (opts.debug) {
    dependencies.logger.debug(
      `Retrieved size for all artifacts to prune. Total size to be freed: ${artifactsWithSize.reduce(
        (acc, a) => acc + a.size,
        0,
      )} bytes.`,
    );
  }
  if (opts.dryRun) {
    return artifactsWithSize;
  }

  const deleteSettlements = await Promise.allSettled(
    artifactsWithSize.map((artifact) => {
      const promise = artifact.tag
        ? dependencies.localArtifactStore
            .deleteTag(artifact.project, artifact.tag)
            .then(() =>
              dependencies.localArtifactStore.deleteId(
                artifact.project,
                artifact.id,
              ),
            )
        : dependencies.localArtifactStore.deleteId(
            artifact.project,
            artifact.id,
          );
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
        dependencies.logger.debug(
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
  project: string,
  dependencies: {
    localArtifactStore: LocalArtifactStore;
    logger: DebugLogger;
  },
  opts: {
    dryRun: boolean;
    debug: boolean;
  },
): Promise<PruneResult> {
  const artifacts = await listProjectArtifacts(
    project,
    dependencies.localArtifactStore,
  );
  const artifactsWithSizeSettlements = await Promise.allSettled(
    artifacts.map((artifact) =>
      dependencies.localArtifactStore
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
        dependencies.logger.debug(
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

  if (opts.debug) {
    dependencies.logger.debug(
      `Retrieved size for all artifacts in project "${project}". Total size to be freed: ${artifactsWithSize.reduce(
        (acc, a) => acc + a.size,
        0,
      )} bytes.`,
    );
  }

  if (opts.dryRun) {
    return artifactsWithSize;
  }

  const deleteSettlements = await Promise.allSettled(
    artifactsWithSize.map((artifact) => {
      const promise = artifact.tag
        ? dependencies.localArtifactStore
            .deleteTag(artifact.project, artifact.tag)
            .then(() =>
              dependencies.localArtifactStore.deleteId(
                artifact.project,
                artifact.id,
              ),
            )
        : dependencies.localArtifactStore.deleteId(
            artifact.project,
            artifact.id,
          );
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
        dependencies.logger.debug(
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
  if (opts.debug) {
    dependencies.logger.debug(
      `Deleted all artifacts for project "${project}". Total size freed: ${artifactsWithSize.reduce(
        (acc, a) => acc + a.size,
        0,
      )} bytes.`,
    );
  }

  return artifactsWithSize;
}

export async function pruneArtifact(
  artifactKey: ArtifactKey,
  dependencies: {
    localArtifactStore: LocalArtifactStore;
    logger: DebugLogger;
  },
  opts: {
    dryRun: boolean;
    debug: boolean;
  },
): Promise<PruneResult> {
  if (artifactKey.type === "id") {
    return pruneArtifactById(
      artifactKey.project,
      artifactKey.id,
      dependencies,
      opts,
    );
  } else {
    return pruneArtifactByTag(
      artifactKey.project,
      artifactKey.tag,
      dependencies,
      opts,
    );
  }
}

async function pruneArtifactById(
  project: string,
  id: string,
  dependencies: {
    localArtifactStore: LocalArtifactStore;
    logger: DebugLogger;
  },
  opts: {
    dryRun: boolean;
    debug: boolean;
  },
): Promise<PruneResult> {
  const hasIdResult = await toAsyncResult(
    dependencies.localArtifactStore.hasId(project, id),
    {
      debug: opts.debug,
    },
  );
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
  const sizeResult = await toAsyncResult(
    dependencies.localArtifactStore.getIdSize(project, id),
    {
      debug: opts.debug,
    },
  );
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

  if (opts.debug) {
    dependencies.logger.debug(
      `Retrieved size for the artifact "${project}@${id}": ${artifactWithSize.size} bytes.`,
    );
  }

  if (opts.dryRun) {
    return [artifactWithSize];
  }

  const deleteResult = await toAsyncResult(
    dependencies.localArtifactStore.deleteId(project, id),
    {
      debug: opts.debug,
    },
  );
  if (!deleteResult.success) {
    throw new CliError(
      `Failed to delete the artifact "${project}@${id}". Run with debug for more details. File an issue if the problem persists.`,
    );
  }

  if (opts.debug) {
    dependencies.logger.debug(
      `Deleted the artifact "${project}@${id}". Size freed: ${artifactWithSize.size} bytes.`,
    );
  }

  return [artifactWithSize];
}

async function pruneArtifactByTag(
  project: string,
  tag: string,
  dependencies: {
    localArtifactStore: LocalArtifactStore;
    logger: DebugLogger;
  },
  opts: {
    dryRun: boolean;
    debug: boolean;
  },
): Promise<PruneResult> {
  const hasTagResult = await toAsyncResult(
    dependencies.localArtifactStore.hasTag(project, tag),
    {
      debug: opts.debug,
    },
  );
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
  const idResult = await toAsyncResult(
    dependencies.localArtifactStore.retrieveArtifactId(project, tag),
    {
      debug: opts.debug,
    },
  );
  if (!idResult.success) {
    throw new CliError(
      `Failed to retrieve the artifact ID for "${project}:${tag}". Run with debug for more details. File an issue if the problem persists.`,
    );
  }
  const id = idResult.value;
  if (opts.debug) {
    dependencies.logger.debug(
      `Retrieved ID for the artifact "${project}:${tag}": ${id}.`,
    );
  }

  const sizeResult = await toAsyncResult(
    dependencies.localArtifactStore.getIdSize(project, id),
    {
      debug: opts.debug,
    },
  );
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

  if (opts.debug) {
    dependencies.logger.debug(
      `Retrieved size for the artifact "${project}:${tag}": ${artifactWithSize.size} bytes.`,
    );
  }

  if (opts.dryRun) {
    return [artifactWithSize];
  }

  const deleteResult = await toAsyncResult(
    Promise.all([
      dependencies.localArtifactStore.deleteId(project, id),
      dependencies.localArtifactStore.deleteTag(project, tag),
    ]),
    {
      debug: opts.debug,
    },
  );
  if (!deleteResult.success) {
    throw new CliError(
      `Failed to delete the artifact "${project}:${tag}". Run with debug for more details. File an issue if the problem persists.`,
    );
  }

  if (opts.debug) {
    dependencies.logger.debug(
      `Deleted the artifact "${project}:${tag}". Size freed: ${artifactWithSize.size} bytes.`,
    );
  }

  return [artifactWithSize];
}

async function listProjectArtifacts(
  project: string,
  store: LocalArtifactStore,
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
