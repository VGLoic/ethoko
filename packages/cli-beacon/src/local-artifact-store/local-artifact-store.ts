import fs from "fs/promises";
import path from "path";
import { Stream } from "stream";
import {
  type EthokoContractOutputArtifact,
  EthokoContractOutputArtifactSchema,
  type EthokoInputArtifact,
  EthokoInputArtifactSchema,
  type TagManifest,
  TagManifestSchema,
} from "../ethoko-artifacts/v0";
import { Dirent } from "fs";
import { AbsolutePath } from "@/utils/path";

/**
 * Local Artifact Store: on-disk store for Ethoko artifacts.
 *
 * Methods favour use of ID instead of tag.
 *
 * Storage layout (relative to rootPath)
 * - {project}/ids/{id}/input.json
 * - {project}/ids/{id}/outputs/{sourceName}/{contractName}.json
 * - {project}/tags/{tag}.json (manifest: { id })
 */
export class LocalArtifactStore {
  public readonly rootPath: AbsolutePath;

  constructor(rootPath: AbsolutePath) {
    this.rootPath = rootPath;
  }

  /**
   * Checks if an ID exists for a given project in the store.
   * @param project The project name.
   * @param id The artifact ID.
   * @returns True if the ID exists, false otherwise.
   */
  public async hasId(project: string, id: string): Promise<boolean> {
    return this.exists(this.rootPath.join(project, "ids", id));
  }

  /**
   * Checks if a tag exists for a given project in the store.
   * @param project The project name.
   * @param tag The tag name.
   * @returns True if the tag exists, false otherwise.
   */
  public async hasTag(project: string, tag: string): Promise<boolean> {
    return this.exists(this.tagPath(project, tag));
  }

  /**
   * Lists all projects in the store.
   * @returns The list of project names.
   */
  public async listProjects(): Promise<string[]> {
    const entries = await fs
      .readdir(this.rootPath.resolvedPath, {
        withFileTypes: true,
      })
      .catch(() => []);
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  /**
   * Lists all IDs for a given project in the store.
   * @param project The project name.
   * @returns The list of IDs with their last modified timestamps.
   */
  public async listIds(project: string): Promise<
    {
      id: string;
      lastModifiedAt: string;
    }[]
  > {
    const entries = await fs.readdir(this.idsPath(project).resolvedPath, {
      withFileTypes: true,
    });
    const ids = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const statsPromises = ids.map((id) =>
      fs
        .stat(this.idPath(project, id).resolvedPath)
        .then((stat) => ({ id, stat })),
    );
    const allStats = await Promise.all(statsPromises);

    return allStats.map(({ id, stat }) => ({
      id,
      lastModifiedAt: stat.mtime.toISOString(),
    }));
  }

  /**
   * Lists all tags for a given project in the store.
   * @param project The project name.
   * @returns The list of tags with their last modified timestamps.
   */
  public async listTags(project: string): Promise<
    {
      tag: string;
      id: string;
      lastModifiedAt: string;
    }[]
  > {
    const entries = await fs.readdir(this.tagsPath(project).resolvedPath, {
      withFileTypes: true,
    });
    const tags = [];
    for (const entry of entries) {
      if (entry.isFile()) {
        tags.push(entry.name.replace(".json", ""));
      }
    }
    const statsAndIdsPromises = tags.map((tag) =>
      fs
        .stat(this.tagPath(project, tag).resolvedPath)
        .then((stat) => ({ tag, stat }))
        .then(({ tag, stat }) =>
          this.retrieveArtifactId(project, tag).then((id) => ({
            tag,
            id,
            stat,
          })),
        ),
    );
    const statAndIds = await Promise.all(statsAndIdsPromises);
    return statAndIds.map(({ tag, id, stat }) => ({
      tag,
      id,
      lastModifiedAt: stat.mtime.toISOString(),
    }));
  }

  /**
   * List all contract artifacts associated with a given ID for a project in the store.
   * @param project The project name.
   * @param id The artifact ID.
   * @returns The list of contract artifacts with their source names and contract names.
   */
  public async listContractArtifacts(
    project: string,
    id: string,
  ): Promise<
    {
      sourceName: string;
      contractName: string;
    }[]
  > {
    const jsonFilePaths: AbsolutePath[] = [];
    await this.collectJsonFilePaths(
      this.outputsPath(project, id),
      jsonFilePaths,
    );
    const contractArtifacts: { sourceName: string; contractName: string }[] =
      [];
    for (const filePath of jsonFilePaths) {
      const relativePath = filePath.relativeTo(this.outputsPath(project, id));
      const items = relativePath.relativePath.split(path.sep);
      const contractNameWithExtension = items.pop();
      if (
        !contractNameWithExtension ||
        !contractNameWithExtension.endsWith(".json")
      ) {
        continue;
      }
      if (items.length === 0) {
        continue;
      }
      const sourceName = items.join(path.sep);
      const contractName = contractNameWithExtension.replace(".json", "");
      contractArtifacts.push({ sourceName, contractName });
    }
    return contractArtifacts;
  }

  /**
   * Creates an artifact associated with the given ID and optional tag
   * @param project The project name.
   * @param id The artifact ID.
   * @param inputArtifact The input artifact content.
   * @param contractOutputArtifacts The contract output artifacts content.
   */
  public async createArtifact(
    project: string,
    id: string,
    tag: string | null,
    artifacts: {
      input: Stream;
      outputs: {
        sourceName: string;
        contractName: string;
        stream: Stream;
      }[];
    },
  ): Promise<void> {
    const idDir = this.idPath(project, id);
    await fs.mkdir(idDir.resolvedPath, { recursive: true });
    const promises = [
      fs.writeFile(
        this.inputArtifactPath(project, id).resolvedPath,
        artifacts.input,
      ),
      ...artifacts.outputs.map(({ sourceName, contractName, stream }) => {
        const contractPath = this.contractOutputPath(
          project,
          id,
          sourceName,
          contractName,
        );
        return fs
          .mkdir(contractPath.dirname().resolvedPath, { recursive: true })
          .then(() => fs.writeFile(contractPath.resolvedPath, stream));
      }),
    ];
    if (tag) {
      const manifest: TagManifest = { id };
      promises.push(
        fs.writeFile(
          this.tagPath(project, tag).resolvedPath,
          JSON.stringify(manifest),
        ),
      );
    }
    const settlements = await Promise.allSettled(promises);

    const firstRejection = settlements.find(
      (settlement): settlement is PromiseRejectedResult =>
        settlement.status === "rejected",
    );
    if (firstRejection) {
      await fs.rm(idDir.resolvedPath, { recursive: true, force: true });
      if (tag) {
        await fs.rm(this.tagPath(project, tag).resolvedPath, {
          force: true,
        });
      }
      throw firstRejection.reason;
    }
  }

  /**
   * Retrieves the input artifact associated with the given ID.
   * @param project The project name.
   * @param id The artifact ID.
   * @returns The input artifact.
   */
  public async retrieveInputArtifact(
    project: string,
    id: string,
  ): Promise<EthokoInputArtifact> {
    const artifactContent = await fs.readFile(
      this.inputArtifactPath(project, id).resolvedPath,
      "utf-8",
    );
    const rawArtifact = JSON.parse(artifactContent);
    return EthokoInputArtifactSchema.parse(rawArtifact);
  }

  /**
   * Retrieves the contract output artifact associated with the given ID, source name and contract name.
   * @param project The project name.
   * @param id The artifact ID.
   * @param sourceName The source name of the contract.
   * @param contractName The contract name.
   * @returns The contract output artifact.
   */
  public async retrieveContractOutputArtifact(
    project: string,
    id: string,
    sourceName: string,
    contractName: string,
  ): Promise<EthokoContractOutputArtifact> {
    const artifactContent = await fs.readFile(
      this.contractOutputPath(project, id, sourceName, contractName)
        .resolvedPath,
      "utf-8",
    );
    const rawArtifact = JSON.parse(artifactContent);
    return EthokoContractOutputArtifactSchema.parse(rawArtifact);
  }

  /**
   * Retrieve the artifact ID from the content of the artifact associated with the given tag.
   * @param project The project name.
   * @param tag The tag name.
   * @returns The retrieved artifact ID.
   */
  public async retrieveArtifactId(
    project: string,
    tag: string,
  ): Promise<string> {
    const artifactContent = await fs.readFile(
      this.tagPath(project, tag).resolvedPath,
      "utf-8",
    );
    const rawArtifact = JSON.parse(artifactContent);
    const manifest = TagManifestSchema.parse(rawArtifact);
    return manifest.id;
  }

  /**
   * Returns the total size in bytes of all files under an artifact ID directory.
   * Returns 0 if the directory does not exist.
   */
  public async getIdSize(project: string, id: string): Promise<number> {
    return this.getDirSize(this.idPath(project, id));
  }

  /**
   * Deletes a specific artifact ID directory.
   */
  public async deleteId(project: string, id: string): Promise<void> {
    await fs.rm(this.idPath(project, id).resolvedPath, {
      recursive: true,
      force: true,
    });
  }

  /**
   * Deletes a specific tag file.
   */
  public async deleteTag(project: string, tag: string): Promise<void> {
    await fs.rm(this.tagPath(project, tag).resolvedPath, { force: true });
  }

  /**
   * Ensures that the root path for store exists by creating it if necessary.
   */
  public async ensureSetup(): Promise<void> {
    const doesRootPathExist = await this.exists(this.rootPath);
    if (!doesRootPathExist) {
      await fs.mkdir(this.rootPath.resolvedPath, { recursive: true });
    }
  }

  /**
   * Ensures that the necessary directories for a given project exist by creating them if necessary.
   * @param project The project name.
   */
  public async ensureProjectSetup(project: string): Promise<void> {
    const pathsToEnsure = [
      this.rootPath,
      this.projectPath(project),
      this.idsPath(project),
      this.tagsPath(project),
    ];
    for (const path of pathsToEnsure) {
      const doesPathExist = await this.exists(path);
      if (!doesPathExist) {
        await fs.mkdir(path.resolvedPath, { recursive: true });
      }
    }
  }
  private projectPath(project: string): AbsolutePath {
    return this.rootPath.join(project);
  }

  private idsPath(project: string): AbsolutePath {
    return this.projectPath(project).join("ids");
  }

  private idPath(project: string, id: string): AbsolutePath {
    return this.idsPath(project).join(id);
  }

  private inputArtifactPath(project: string, id: string): AbsolutePath {
    return this.idPath(project, id).join("input.json");
  }

  private outputsPath(project: string, id: string): AbsolutePath {
    return this.idPath(project, id).join("outputs");
  }

  private contractOutputPath(
    project: string,
    id: string,
    sourceName: string,
    contractName: string,
  ): AbsolutePath {
    return this.outputsPath(project, id).join(
      sourceName,
      `${contractName}.json`,
    );
  }

  private tagsPath(project: string): AbsolutePath {
    return this.projectPath(project).join("tags");
  }

  private tagPath(project: string, tag: string): AbsolutePath {
    return this.tagsPath(project).join(`${tag}.json`);
  }

  private exists(path: AbsolutePath): Promise<boolean> {
    return fs
      .stat(path.resolvedPath)
      .then(() => true)
      .catch(() => false);
  }

  private async collectJsonFilePaths(
    dirPath: AbsolutePath,
    files: AbsolutePath[],
  ): Promise<void> {
    const entries = await this.safeReadDir(dirPath.resolvedPath);
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

  private async getDirSize(dirPath: AbsolutePath): Promise<number> {
    try {
      const entries = await fs.readdir(dirPath.resolvedPath, {
        recursive: true,
        withFileTypes: true,
      });
      const sizes = await Promise.all(
        entries
          .filter((e) => e.isFile())
          .map((e) =>
            fs
              .stat(path.join(e.parentPath, e.name))
              .then((s) => s.size)
              .catch(() => 0),
          ),
      );
      return sizes.reduce((sum, s) => sum + s, 0);
    } catch {
      return 0;
    }
  }

  private async safeReadDir(dirPath: string): Promise<Dirent[]> {
    try {
      return await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }
  }
}
