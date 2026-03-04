import fs from "fs/promises";
import path from "path";
import { createReadStream, Dirent } from "fs";
import { Stream } from "stream";
import { styleText } from "node:util";
import { LOG_COLORS } from "@/cli-ui/utils";
import {
  EthokoInputArtifact,
  EthokoOutputArtifact,
  TagManifest,
  TagManifestSchema,
} from "../utils/ethoko-artifacts-schemas/v0";
import { StorageProvider } from "./storage-provider.interface";

type LocalStorageProviderConfig = {
  path: string;
  debug?: boolean;
};

/**
 * Local filesystem storage provider.
 *
 * Storage layout (relative to storagePath)
 * - {project}/ids/{id}/input.json
 * - {project}/ids/{id}/output.json
 * - {project}/ids/{id}/original/** (original compilation content)
 * - {project}/tags/{tag}.json (manifest: { id })
 */
export class LocalStorageProvider implements StorageProvider {
  private readonly storagePath: string;
  private readonly debug: boolean;

  constructor(config: LocalStorageProviderConfig) {
    this.storagePath = config.path;
    this.debug = config.debug ?? false;
  }

  public getPath(): string {
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
  ): Promise<string[]> {
    const originalContentRoot = this.originalContentRootPath(project, id);
    const rootExists = await this.exists(originalContentRoot);
    if (!rootExists) {
      return [];
    }
    const files: string[] = [];
    await this.collectOriginalContentFiles(originalContentRoot, files);
    return files.map((filePath) =>
      path.relative(originalContentRoot, filePath),
    );
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
    outputArtifact: EthokoOutputArtifact,
    tag: string | undefined,
    originalContentPaths: string[],
  ): Promise<void> {
    await this.ensureProjectSetup(project);

    const idDir = this.idDirPath(project, inputArtifact.id);
    await fs.mkdir(idDir, { recursive: true });
    await Promise.all([
      fs.writeFile(
        this.inputFilePath(project, inputArtifact.id),
        JSON.stringify(inputArtifact),
      ),
      fs.writeFile(
        this.outputFilePath(project, inputArtifact.id),
        JSON.stringify(outputArtifact),
      ),
    ]);

    if (tag) {
      const tagFilePath = this.tagFilePath(project, tag);
      const manifest: TagManifest = { id: inputArtifact.id };
      await fs.writeFile(tagFilePath, JSON.stringify(manifest));
    }

    for (const originalContentPath of originalContentPaths) {
      const targetPath = this.originalContentPath(
        project,
        inputArtifact.id,
        originalContentPath,
      );
      await this.copyOriginalContent(originalContentPath, targetPath);
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
  ): Promise<{ input: Stream; output: Stream }> {
    return {
      input: createReadStream(this.inputFilePath(project, id)),
      output: createReadStream(this.outputFilePath(project, id)),
    };
  }

  public async downloadArtifactByTag(
    project: string,
    tag: string,
  ): Promise<{ id: string; input: Stream; output: Stream }> {
    const tagFilePath = this.tagFilePath(project, tag);
    const manifestContent = await fs.readFile(tagFilePath, "utf-8");
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
    relativePath: string,
  ): Promise<Stream> {
    const filePath = path.join(
      this.originalContentRootPath(project, id),
      relativePath,
    );
    return createReadStream(filePath);
  }

  private idsPath(project: string): string {
    return path.join(this.storagePath, project, "ids");
  }

  private tagsPath(project: string): string {
    return path.join(this.storagePath, project, "tags");
  }

  private originalContentRootPath(project: string, id: string): string {
    return path.join(this.idDirPath(project, id), "original");
  }

  private idDirPath(project: string, id: string): string {
    return path.join(this.idsPath(project), id);
  }

  private tagFilePath(project: string, tag: string): string {
    return path.join(this.tagsPath(project), `${tag}.json`);
  }

  private originalContentPath(
    project: string,
    id: string,
    sourcePath: string,
  ): string {
    const sanitized = this.sanitizePath(sourcePath);
    return path.join(this.idDirPath(project, id), "original", sanitized);
  }

  private inputFilePath(project: string, id: string): string {
    return path.join(this.idDirPath(project, id), "input.json");
  }

  private outputFilePath(project: string, id: string): string {
    return path.join(this.idDirPath(project, id), "output.json");
  }

  private sanitizePath(filePath: string): string {
    if (filePath.startsWith("/")) {
      return filePath.substring(1);
    }
    if (filePath.startsWith("./")) {
      return filePath.substring(2);
    }
    return filePath;
  }

  private async copyOriginalContent(
    sourcePath: string,
    targetPath: string,
  ): Promise<void> {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
  }

  private async ensureProjectSetup(project: string): Promise<void> {
    const pathsToEnsure = [
      this.storagePath,
      path.join(this.storagePath, project),
      this.idsPath(project),
      this.tagsPath(project),
    ];

    for (const pathToEnsure of pathsToEnsure) {
      await fs.mkdir(pathToEnsure, { recursive: true });
    }
  }

  private async safeReadDir(dirPath: string): Promise<Dirent[]> {
    try {
      return await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }
  }

  private async collectOriginalContentFiles(
    dirPath: string,
    files: string[],
  ): Promise<void> {
    const entries = await this.safeReadDir(dirPath);
    if (entries.length === 0) {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this.collectOriginalContentFiles(entryPath, files);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }

  private async exists(filePath: string): Promise<boolean> {
    return fs
      .stat(filePath)
      .then(() => true)
      .catch(() => false);
  }
}
