import fs from "fs/promises";
import path from "path";
import { createReadStream, Dirent } from "fs";
import { Stream } from "stream";
import { styleText } from "node:util";
import { LOG_COLORS } from "@/cli-ui/utils";
import { EthokoArtifact } from "../utils/artifacts-schemas/ethoko-v0";
import { StorageProvider } from "./storage-provider.interface";

type LocalStorageProviderConfig = {
  path: string;
  debug?: boolean;
};

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
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.replace(".json", ""));
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
    return this.exists(this.idFilePath(project, id));
  }

  public async uploadArtifact(
    project: string,
    artifact: EthokoArtifact,
    tag: string | undefined,
    originalContentPaths: string[],
  ): Promise<void> {
    await this.ensureProjectSetup(project);

    const idFilePath = this.idFilePath(project, artifact.id);
    await fs.writeFile(idFilePath, JSON.stringify(artifact));

    if (tag) {
      const tagFilePath = this.tagFilePath(project, tag);
      await fs.copyFile(idFilePath, tagFilePath);
    }

    for (const originalContentPath of originalContentPaths) {
      const targetPath = this.originalContentPath(
        project,
        artifact.id,
        originalContentPath,
      );
      await this.copyOriginalContent(originalContentPath, targetPath);
    }

    if (this.debug) {
      console.error(
        styleText(
          LOG_COLORS.log,
          `Stored artifact ${project}:${tag || artifact.id} in ${this.storagePath}`,
        ),
      );
    }
  }

  public async downloadArtifactById(
    project: string,
    id: string,
  ): Promise<Stream> {
    const idFilePath = this.idFilePath(project, id);
    return createReadStream(idFilePath);
  }

  public async downloadArtifactByTag(
    project: string,
    tag: string,
  ): Promise<Stream> {
    const tagFilePath = this.tagFilePath(project, tag);
    return createReadStream(tagFilePath);
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
    return path.join(this.idsPath(project), id, "original-content");
  }

  private idFilePath(project: string, id: string): string {
    return path.join(this.idsPath(project), `${id}.json`);
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
    return path.join(this.idsPath(project), id, "original-content", sanitized);
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
