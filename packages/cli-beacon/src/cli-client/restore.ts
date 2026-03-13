import fs from "node:fs/promises";
import path from "node:path";
import { createSpinner } from "@/cli-ui/utils";
import { LocalStorage } from "@/local-storage";
import { StorageProvider } from "@/storage-provider";
import { toAsyncResult } from "@/utils/result";
import { CliError } from "./error";

export type RestoreResult = {
  project: string;
  tag: string | null;
  id: string;
  filesRestored: string[];
  outputPath: string;
};

export async function restore(
  artifact: {
    project: string;
    search: { type: "tag"; tag: string } | { type: "id"; id: string };
  },
  outputPath: string,
  storageProvider: StorageProvider,
  localStorage: LocalStorage,
  opts: { force: boolean; debug: boolean; silent?: boolean },
): Promise<RestoreResult> {
  const spinner1 = createSpinner("Identifying artifact...", opts.silent);
  const ensureResult = await toAsyncResult(
    localStorage.ensureProjectSetup(artifact.project),
    { debug: opts.debug },
  );
  if (!ensureResult.success) {
    spinner1.fail("Failed to setup local storage");
    throw new CliError(
      "Error setting up local storage, is the script not allowed to write to the filesystem? Run with debug mode for more info",
    );
  }

  let artifactId: string;
  if (artifact.search.type === "tag") {
    const artifactIdResult = await toAsyncResult(
      localStorage.retrieveArtifactId(artifact.project, artifact.search.tag),
      { debug: opts.debug },
    );
    if (!artifactIdResult.success) {
      spinner1.fail("Failed to resolve artifact ID");
      throw new CliError(
        "Unable to retrieve the artifact ID, please ensure the artifact is pulled locally. Run with debug mode for more info",
      );
    }
    artifactId = artifactIdResult.value;
  } else {
    const hasIdResult = await toAsyncResult(
      localStorage.hasId(artifact.project, artifact.search.id),
      { debug: opts.debug },
    );
    if (!hasIdResult.success) {
      spinner1.fail("Failed to verify artifact ID");
      throw new CliError(
        "Unable to verify the artifact ID, please ensure the artifact is pulled locally. Run with debug mode for more info",
      );
    }
    if (!hasIdResult.value) {
      spinner1.fail("Artifact ID not found");
      throw new CliError(
        "Artifact ID not found locally, please ensure the artifact is pulled before restoring",
      );
    }
    artifactId = artifact.search.id;
  }
  spinner1.succeed("Artifact identified");

  const spinner2 = createSpinner("Checking output directory...", opts.silent);
  const resolvedOutputPath = path.resolve(outputPath);
  const outputStatResult = await toAsyncResult(fs.stat(resolvedOutputPath), {
    debug: opts.debug,
  });
  if (outputStatResult.success) {
    if (!outputStatResult.value.isDirectory()) {
      spinner2.fail("Output path is not a directory");
      throw new CliError(
        `Output path "${resolvedOutputPath}" exists but is not a directory`,
      );
    }
    const outputEntriesResult = await toAsyncResult(
      fs.readdir(resolvedOutputPath),
      {
        debug: opts.debug,
      },
    );
    if (!outputEntriesResult.success) {
      spinner2.fail("Failed to read output directory");
      throw new CliError(
        `Unable to read output directory "${resolvedOutputPath}". Run with debug mode for more info`,
      );
    }
    if (outputEntriesResult.value.length > 0 && !opts.force) {
      spinner2.fail("Output directory is not empty");
      throw new CliError(
        `Output directory "${resolvedOutputPath}" is not empty. Use the --force flag to overwrite`,
      );
    }
    if (outputEntriesResult.value.length > 0 && opts.force) {
      const removeResult = await toAsyncResult(
        fs.rm(resolvedOutputPath, { recursive: true, force: true }),
        { debug: opts.debug },
      );
      if (!removeResult.success) {
        spinner2.fail("Failed to clear output directory");
        throw new CliError(
          `Unable to clear output directory "${resolvedOutputPath}". Run with debug mode for more info`,
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
    spinner2.fail("Failed to access output directory");
    throw new CliError(
      `Unable to access output directory "${resolvedOutputPath}". Run with debug mode for more info`,
    );
  }
  const mkdirOutputResult = await toAsyncResult(
    fs.mkdir(resolvedOutputPath, { recursive: true }),
    { debug: opts.debug },
  );
  if (!mkdirOutputResult.success) {
    spinner2.fail("Failed to create output directory");
    throw new CliError(
      `Unable to create output directory "${resolvedOutputPath}". Run with debug mode for more info`,
    );
  }
  spinner2.succeed("Output directory ready");

  const spinner3 = createSpinner("Listing original content...", opts.silent);
  const originalContentResult = await toAsyncResult(
    storageProvider.listOriginalContent(artifact.project, artifactId),
    { debug: opts.debug },
  );
  if (!originalContentResult.success) {
    spinner3.fail("Failed to list original content");
    throw new CliError(
      "Unable to list original content files from the storage. Run with debug mode for more info",
    );
  }
  const originalContentPaths = originalContentResult.value;
  if (originalContentPaths.length === 0) {
    spinner3.fail("No original content files found");
    throw new CliError(
      "No original content files were found for this artifact. Run with debug mode for more info",
    );
  }
  spinner3.succeed(`Found ${originalContentPaths.length} files`);

  const spinner4 = createSpinner(
    `Downloading ${originalContentPaths.length} file${originalContentPaths.length > 1 ? "s" : ""}...`,
    opts.silent,
  );
  const downloadResults = await Promise.all(
    originalContentPaths.map(async (relativePath) => {
      const downloadResult = await toAsyncResult(
        storageProvider.downloadOriginalContent(
          artifact.project,
          artifactId,
          relativePath,
        ),
        { debug: opts.debug },
      );
      if (!downloadResult.success) {
        throw new CliError(
          `Unable to download original content file "${relativePath}". Run with debug mode for more info`,
        );
      }

      const targetPath = path.join(resolvedOutputPath, relativePath);
      const mkdirResult = await toAsyncResult(
        fs.mkdir(path.dirname(targetPath), { recursive: true }),
        { debug: opts.debug },
      );
      if (!mkdirResult.success) {
        throw new CliError(
          `Unable to create directory for "${targetPath}". Run with debug mode for more info`,
        );
      }

      const writeResult = await toAsyncResult(
        fs.writeFile(targetPath, downloadResult.value),
        { debug: opts.debug },
      );
      if (!writeResult.success) {
        throw new CliError(
          `Unable to write file "${targetPath}". Run with debug mode for more info`,
        );
      }

      return relativePath;
    }),
  );

  spinner4.succeed(
    `Downloaded ${downloadResults.length} file${downloadResults.length > 1 ? "s" : ""}`,
  );

  return {
    project: artifact.project,
    tag: artifact.search.type === "tag" ? artifact.search.tag : null,
    id: artifactId,
    filesRestored: downloadResults,
    outputPath: resolvedOutputPath,
  };
}
