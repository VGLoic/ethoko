import fs from "fs/promises";
import path from "path";
import { createReadStream, Dirent } from "fs";
import { Stream } from "stream";
import { styleText } from "node:util";
import { LOG_COLORS } from "@/ui";
import {
  EthokoContractOutputArtifact,
  EthokoInputArtifact,
  TagManifest,
  TagManifestSchema,
} from "../ethoko-artifacts/v0";
import { StorageProvider } from "./storage-provider.interface";
import { AbsolutePath, RelativePath } from "@/utils/path";

type FilesystemStorageProviderConfig = {
  path: AbsolutePath;
  debug?: boolean;
};

/**
 * Filesystem storage provider.
 *
 * Storage layout (relative to storagePath)
 * - {project}/ids/{id}/input.json
 * - {project}/ids/{id}/original/** (original compilation content)
 * - {project}/tags/{tag}.json (manifest: { id })
 */
export class FilesystemStorageProvider implements StorageProvider {
  private readonly storagePath: AbsolutePath;
  private readonly debug: boolean;

  constructor(config: FilesystemStorageProviderConfig) {
    this.storagePath = config.path;
    this.debug = config.debug ?? false;
  }

  public getStoragePath(): AbsolutePath {
    return this.storagePath;
  }

  public async listTags(project: string): Promise<string[]> {
    const tagsPath = this.tagsPath(project);
    const entries = await this.safeReadDir(tagsPath);
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.replace(".json", ""));
  }

  public async listIds(project: string): Promise<string[]> {
    const idsPath = this.idsPath(project);
    const entries = await this.safeReadDir(idsPath);
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  public async listOriginalContent(
    project: string,
    id: string,
  ): Promise<RelativePath[]> {
    const originalContentRoot = this.originalContentRootPath(project, id);
    const rootExists = await this.exists(originalContentRoot);
    if (!rootExists) {
      return [];
    }
    const files: AbsolutePath[] = [];
    await this.collectJsonFilePaths(originalContentRoot, files);
    return files.map((filePath) => filePath.relativeTo(originalContentRoot));
  }

  private async listContractOutputArtifacts(
    project: string,
    id: string,
  ): Promise<{ sourceName: string; contractName: string }[]> {
    const outputsPath = this.contractOutputsPath(project, id);
    const filePaths: AbsolutePath[] = [];
    await this.collectJsonFilePaths(outputsPath, filePaths);
    const outputArtifacts: { sourceName: string; contractName: string }[] = [];
    for (const filePath of filePaths) {
      const relativePath = filePath.relativeTo(outputsPath);
      const pathParts = relativePath.relativePath.split(path.sep);
      const contractNameWithExt = pathParts.pop();
      if (!contractNameWithExt || !contractNameWithExt.endsWith(".json")) {
        continue;
      }
      const contractName = contractNameWithExt.replace(".json", "");
      const sourceName = pathParts.join(path.sep);
      outputArtifacts.push({ sourceName, contractName });
    }
    return outputArtifacts;
  }

  public async hasArtifactByTag(
    project: string,
    tag: string,
  ): Promise<boolean> {
    return this.exists(this.tagFilePath(project, tag));
  }

  public async hasArtifactById(project: string, id: string): Promise<boolean> {
    return this.exists(this.idDirPath(project, id));
  }

  public async uploadArtifact(
    project: string,
    inputArtifact: EthokoInputArtifact,
    outputContractArtifacts: EthokoContractOutputArtifact[],
    tag: string | undefined,
    originalContent: { rootPath: AbsolutePath; paths: RelativePath[] },
  ): Promise<void> {
    await this.ensureProjectSetup(project);

    await fs.mkdir(this.idDirPath(project, inputArtifact.id).resolvedPath, {
      recursive: true,
    });
    await Promise.all([
      ...outputContractArtifacts.map((artifact) => {
        const contractPath = this.contractOutputFilePath(
          project,
          inputArtifact.id,
          artifact.sourceName,
          artifact.contract,
        );
        return fs
          .mkdir(contractPath.dirname().resolvedPath, { recursive: true })
          .then(() =>
            fs.writeFile(contractPath.resolvedPath, JSON.stringify(artifact)),
          );
      }),
      fs.writeFile(
        this.inputFilePath(project, inputArtifact.id).resolvedPath,
        JSON.stringify(inputArtifact),
      ),
    ]);

    if (tag) {
      const tagFilePath = this.tagFilePath(project, tag);
      const manifest: TagManifest = { id: inputArtifact.id };
      await fs.writeFile(tagFilePath.resolvedPath, JSON.stringify(manifest));
    }

    for (const originalContentPath of originalContent.paths) {
      const targetPath = this.originalContentPath(
        project,
        inputArtifact.id,
        originalContentPath,
      );
      await this.copyOriginalContent(
        originalContent.rootPath.join(originalContentPath),
        targetPath,
      );
    }

    if (this.debug) {
      console.error(
        styleText(
          LOG_COLORS.log,
          `Stored artifact ${project}:${tag || inputArtifact.id} in ${this.storagePath}`,
        ),
      );
    }
  }

  public async downloadArtifactById(
    project: string,
    id: string,
  ): Promise<{
    input: Stream;
    contractOutputArtifacts: {
      sourceName: string;
      contractName: string;
      stream: Stream;
    }[];
  }> {
    const contractOutputArtifacts = await this.listContractOutputArtifacts(
      project,
      id,
    );
    return {
      input: createReadStream(this.inputFilePath(project, id).resolvedPath),
      contractOutputArtifacts: contractOutputArtifacts.map((artifact) => ({
        sourceName: artifact.sourceName,
        contractName: artifact.contractName,
        stream: createReadStream(
          this.contractOutputFilePath(
            project,
            id,
            artifact.sourceName,
            artifact.contractName,
          ).resolvedPath,
        ),
      })),
    };
  }

  public async downloadArtifactByTag(
    project: string,
    tag: string,
  ): Promise<{
    id: string;
    input: Stream;
    contractOutputArtifacts: {
      sourceName: string;
      contractName: string;
      stream: Stream;
    }[];
  }> {
    const tagFilePath = this.tagFilePath(project, tag);
    const manifestContent = await fs.readFile(
      tagFilePath.resolvedPath,
      "utf-8",
    );
    const manifest = TagManifestSchema.parse(JSON.parse(manifestContent));
    const streams = await this.downloadArtifactById(project, manifest.id);
    return {
      id: manifest.id,
      ...streams,
    };
  }

  public async downloadOriginalContent(
    project: string,
    id: string,
    relativePath: RelativePath,
  ): Promise<Stream> {
    const filePath = this.originalContentRootPath(project, id).join(
      relativePath,
    );
    return createReadStream(filePath.resolvedPath);
  }

  private idsPath(project: string): AbsolutePath {
    return this.storagePath.join(project, "ids");
  }

  private tagsPath(project: string): AbsolutePath {
    return this.storagePath.join(project, "tags");
  }

  private originalContentRootPath(project: string, id: string): AbsolutePath {
    return this.idDirPath(project, id).join("original");
  }

  private idDirPath(project: string, id: string): AbsolutePath {
    return this.idsPath(project).join(id);
  }

  private tagFilePath(project: string, tag: string): AbsolutePath {
    return this.tagsPath(project).join(`${tag}.json`);
  }

  private originalContentPath(
    project: string,
    id: string,
    sourcePath: RelativePath,
  ): AbsolutePath {
    return this.idDirPath(project, id).join("original", sourcePath);
  }

  private inputFilePath(project: string, id: string): AbsolutePath {
    return this.idDirPath(project, id).join("input.json");
  }

  private contractOutputsPath(project: string, id: string): AbsolutePath {
    return this.idDirPath(project, id).join("outputs");
  }

  private contractOutputFilePath(
    project: string,
    id: string,
    sourceName: string,
    contract: string,
  ): AbsolutePath {
    return this.contractOutputsPath(project, id).join(
      sourceName,
      `${contract}.json`,
    );
  }

  private async copyOriginalContent(
    sourcePath: AbsolutePath,
    targetPath: AbsolutePath,
  ): Promise<void> {
    await fs.mkdir(targetPath.dirname().resolvedPath, { recursive: true });
    await fs.copyFile(sourcePath.resolvedPath, targetPath.resolvedPath);
  }

  private async ensureProjectSetup(project: string): Promise<void> {
    const pathsToEnsure = [
      this.storagePath,
      this.storagePath.join(project),
      this.idsPath(project),
      this.tagsPath(project),
    ];

    for (const pathToEnsure of pathsToEnsure) {
      await fs.mkdir(pathToEnsure.resolvedPath, { recursive: true });
    }
  }

  private async safeReadDir(dirPath: AbsolutePath): Promise<Dirent[]> {
    try {
      return await fs.readdir(dirPath.resolvedPath, { withFileTypes: true });
    } catch {
      return [];
    }
  }

  private async exists(filePath: AbsolutePath): Promise<boolean> {
    return fs
      .stat(filePath.resolvedPath)
      .then(() => true)
      .catch(() => false);
  }

  private async collectJsonFilePaths(
    dirPath: AbsolutePath,
    files: AbsolutePath[],
  ): Promise<void> {
    const entries = await this.safeReadDir(dirPath);
    if (entries.length === 0) {
      return;
    }
    for (const entry of entries) {
      const entryPath = dirPath.join(entry.name);
      if (entry.isDirectory()) {
        await this.collectJsonFilePaths(entryPath, files);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(entryPath);
      }
    }
  }
}
