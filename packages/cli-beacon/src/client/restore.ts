import fs from "node:fs/promises";
import { LocalArtifactStore } from "@/local-artifact-store";
import { StorageProvider } from "@/storage-provider";
import { toAsyncResult } from "@/utils/result";
import { CliError } from "./error";
import { AbsolutePath, RelativePath } from "@/utils/path";
import { ResolvedArtifactKey } from "@/utils/artifact-key";
import { DebugLogger } from "@/utils/debug-logger";

export type RestoreResult = {
  project: string;
  tag: string | null;
  id: string;
  filesRestored: RelativePath[];
  outputPath: AbsolutePath;
};

/**
 * Restore original compilation artifacts to an input local destination
 * @param artifactKey Project, ID and optionally tag of the artifact
 * @param outputPath The local path where the artifacts will be restored
 * @param dependencies.storageProvider The storage provider
 * @param dependencies.localArtifactStore Pulled artifact store
 * @param dependencies.logger Debug logger
 * @param opts Options
 * @param opts.force Whether or not the method should overwrite the output dir if existing
 * @param opts.debug Debug mode
 * @throws CliError in case of error
 */
export async function restore(
  artifactKey: ResolvedArtifactKey,
  outputPath: AbsolutePath,
  dependencies: {
    storageProvider: StorageProvider;
    localArtifactStore: LocalArtifactStore;
    logger: DebugLogger;
  },
  opts: { force: boolean; debug: boolean },
): Promise<RestoreResult> {
  const ensureResult = await toAsyncResult(
    dependencies.localArtifactStore.ensureProjectSetup(artifactKey.project),
    { debug: opts.debug },
  );
  if (!ensureResult.success) {
    throw new CliError(
      "Error setting up Local Artifact Store, is the script not allowed to write to the filesystem? Run with debug mode for more info",
    );
  }

  const outputStatResult = await toAsyncResult(
    fs.stat(outputPath.resolvedPath),
    {
      debug: opts.debug,
    },
  );
  if (outputStatResult.success) {
    if (!outputStatResult.value.isDirectory()) {
      throw new CliError(
        `Output path "${outputPath}" exists but is not a directory`,
      );
    }
    const outputEntriesResult = await toAsyncResult(
      fs.readdir(outputPath.resolvedPath),
      {
        debug: opts.debug,
      },
    );
    if (!outputEntriesResult.success) {
      throw new CliError(
        `Unable to read output directory "${outputPath}". Run with debug mode for more info`,
      );
    }
    if (outputEntriesResult.value.length > 0 && !opts.force) {
      throw new CliError(
        `Output directory "${outputPath}" is not empty. Use the --force flag to overwrite`,
      );
    }
    if (opts.debug) {
      dependencies.logger.debug(
        `Output directory "${outputPath}" is not empty. Overwriting due to --force flag`,
      );
    }
    if (outputEntriesResult.value.length > 0 && opts.force) {
      const removeResult = await toAsyncResult(
        fs.rm(outputPath.resolvedPath, { recursive: true, force: true }),
        { debug: opts.debug },
      );
      if (!removeResult.success) {
        throw new CliError(
          `Unable to clear output directory "${outputPath}". Run with debug mode for more info`,
        );
      }
    }
  } else if (
    !(
      outputStatResult.error &&
      typeof outputStatResult.error === "object" &&
      "code" in outputStatResult.error &&
      outputStatResult.error.code === "ENOENT"
    )
  ) {
    throw new CliError(
      `Unable to access output directory "${outputPath}". Run with debug mode for more info`,
    );
  }
  if (opts.debug) {
    dependencies.logger.debug(`Output directory "${outputPath}" is ready`);
  }
  const mkdirOutputResult = await toAsyncResult(
    fs.mkdir(outputPath.resolvedPath, { recursive: true }),
    { debug: opts.debug },
  );
  if (!mkdirOutputResult.success) {
    throw new CliError(
      `Unable to create output directory "${outputPath}". Run with debug mode for more info`,
    );
  }

  if (opts.debug) {
    dependencies.logger.debug(
      `Output directory "${outputPath}" created successfully`,
    );
  }

  const originalContentResult = await toAsyncResult(
    dependencies.storageProvider.listOriginalContent(
      artifactKey.project,
      artifactKey.id,
    ),
    { debug: opts.debug },
  );
  if (!originalContentResult.success) {
    throw new CliError(
      "Unable to list original content files from the storage. Run with debug mode for more info",
    );
  }
  const originalContentPaths = originalContentResult.value;
  if (originalContentPaths.length === 0) {
    throw new CliError(
      "No original content files were found for this artifact. Run with debug mode for more info",
    );
  }
  if (opts.debug) {
    dependencies.logger.debug(
      `Found ${originalContentPaths.length} original content files for artifact "${artifactKey.project}@${artifactKey.id}"`,
    );
  }

  const downloadResults = await Promise.all(
    originalContentPaths.map(async (relativePath) => {
      const downloadResult = await toAsyncResult(
        dependencies.storageProvider.downloadOriginalContent(
          artifactKey.project,
          artifactKey.id,
          relativePath,
        ),
        { debug: opts.debug },
      );
      if (!downloadResult.success) {
        throw new CliError(
          `Unable to download original content file "${relativePath}". Run with debug mode for more info`,
        );
      }

      const targetPath = outputPath.join(relativePath);
      const mkdirResult = await toAsyncResult(
        fs.mkdir(targetPath.dirname().resolvedPath, { recursive: true }),
        { debug: opts.debug },
      );
      if (!mkdirResult.success) {
        throw new CliError(
          `Unable to create directory for "${targetPath}". Run with debug mode for more info`,
        );
      }

      const writeResult = await toAsyncResult(
        fs.writeFile(targetPath.resolvedPath, downloadResult.value),
        { debug: opts.debug },
      );
      if (!writeResult.success) {
        throw new CliError(
          `Unable to write file "${targetPath}". Run with debug mode for more info`,
        );
      }

      if (opts.debug) {
        dependencies.logger.debug(
          `Original content file "${relativePath}" restored successfully`,
        );
      }

      return relativePath;
    }),
  );

  if (opts.debug) {
    dependencies.logger.debug(
      `All original content files for artifact "${artifactKey.project}@${artifactKey.id}" restored successfully`,
    );
  }

  return {
    project: artifactKey.project,
    tag: artifactKey.tag,
    id: artifactKey.id,
    filesRestored: downloadResults,
    outputPath,
  };
}
