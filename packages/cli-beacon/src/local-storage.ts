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
} from "./utils/ethoko-artifacts-schemas/v0";
import { Dirent } from "fs";

/**
 * Local storage implementation for storing artifacts on the local filesystem.
 *
 * Methods favour use of ID instead of tag.
 *
 * Storage layout (relative to rootPath)
 * - {project}/ids/{id}/input.json
 * - {project}/ids/{id}/outputs/{sourceName}/{contractName}.json
 * - {project}/tags/{tag}.json (manifest: { id })
 */
export class LocalStorage {
  public readonly rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  /**
   * Checks if an ID exists for a given project in the local storage.
   * @param project The project name.
   * @param id The artifact ID.
   * @returns True if the ID exists, false otherwise.
   */
  public async hasId(project: string, id: string): Promise<boolean> {
    return this.exists(`${this.rootPath}/${project}/ids/${id}`);
  }

  /**
   * Checks if a tag exists for a given project in the local storage.
   * @param project The project name.
   * @param tag The tag name.
   * @returns True if the tag exists, false otherwise.
   */
  public async hasTag(project: string, tag: string): Promise<boolean> {
    return this.exists(`${this.rootPath}/${project}/tags/${tag}.json`);
  }

  /**
   * Lists all projects in the local storage.
   * @returns The list of project names.
   */
  public async listProjects(): Promise<string[]> {
    const entries = await fs.readdir(this.rootPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  /**
   * Lists all IDs for a given project in the local storage.
   * @param project The project name.
   * @returns The list of IDs with their last modified timestamps.
   */
  public async listIds(project: string): Promise<
    {
      id: string;
      lastModifiedAt: string;
    }[]
  > {
    const entries = await fs.readdir(`${this.rootPath}/${project}/ids`, {
      withFileTypes: true,
    });
    const ids = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const statsPromises = ids.map((id) =>
      fs
        .stat(`${this.rootPath}/${project}/ids/${id}`)
        .then((stat) => ({ id, stat })),
    );
    const allStats = await Promise.all(statsPromises);

    return allStats.map(({ id, stat }) => ({
      id,
      lastModifiedAt: stat.mtime.toISOString(),
    }));
  }

  /**
   * Lists all tags for a given project in the local storage.
   * @param project The project name.
   * @returns The list of tags with their last modified timestamps.
   */
  public async listTags(project: string): Promise<
    {
      tag: string;
      lastModifiedAt: string;
    }[]
  > {
    const entries = await fs.readdir(`${this.rootPath}/${project}/tags`, {
      withFileTypes: true,
    });
    const tags = [];
    for (const entry of entries) {
      if (entry.isFile()) {
        tags.push(entry.name.replace(".json", ""));
      }
    }
    const statsPromises = tags.map((tag) =>
      fs
        .stat(`${this.rootPath}/${project}/tags/${tag}.json`)
        .then((stat) => ({ tag, stat })),
    );
    const allStats = await Promise.all(statsPromises);
    return allStats.map(({ tag, stat }) => ({
      tag,
      lastModifiedAt: stat.mtime.toISOString(),
    }));
  }

  /**
   * List all contract artifacts associated with a given ID for a project in the local storage.
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
    const jsonFilePaths: string[] = [];
    await this.collectJsonFilePaths(
      `${this.rootPath}/${project}/ids/${id}/outputs`,
      jsonFilePaths,
    );
    const contractArtifacts: { sourceName: string; contractName: string }[] =
      [];
    for (const filePath of jsonFilePaths) {
      const relativePath = path.relative(
        `${this.rootPath}/${project}/ids/${id}/outputs`,
        filePath,
      );
      const items = relativePath.split(path.sep);
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
    const idDir = `${this.rootPath}/${project}/ids/${id}`;
    await fs.mkdir(idDir, { recursive: true });
    const promises = [
      fs.writeFile(`${idDir}/input.json`, artifacts.input),
      ...artifacts.outputs.map(({ sourceName, contractName, stream }) => {
        const contractPath = `${idDir}/outputs/${sourceName}/${contractName}.json`;
        return fs
          .mkdir(path.dirname(contractPath), { recursive: true })
          .then(() => fs.writeFile(contractPath, stream));
      }),
    ];
    if (tag) {
      const manifest: TagManifest = { id };
      promises.push(
        fs.writeFile(
          `${this.rootPath}/${project}/tags/${tag}.json`,
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
      await fs.rm(idDir, { recursive: true, force: true });
      if (tag) {
        await fs.rm(`${this.rootPath}/${project}/tags/${tag}.json`, {
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
      `${this.rootPath}/${project}/ids/${id}/input.json`,
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
      `${this.rootPath}/${project}/ids/${id}/outputs/${sourceName}/${contractName}.json`,
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
      `${this.rootPath}/${project}/tags/${tag}.json`,
      "utf-8",
    );
    const rawArtifact = JSON.parse(artifactContent);
    const manifest = TagManifestSchema.parse(rawArtifact);
    return manifest.id;
  }

  /**
   * Ensures that the root path for local storage exists by creating it if necessary.
   */
  public async ensureSetup(): Promise<void> {
    const doesRootPathExist = await this.exists(this.rootPath);
    if (!doesRootPathExist) {
      await fs.mkdir(this.rootPath, { recursive: true });
    }
  }

  /**
   * Ensures that the necessary directories for a given project exist by creating them if necessary.
   * @param project The project name.
   */
  public async ensureProjectSetup(project: string): Promise<void> {
    const pathsToEnsure = [
      this.rootPath,
      `${this.rootPath}/${project}`,
      `${this.rootPath}/${project}/ids`,
      `${this.rootPath}/${project}/tags`,
    ];
    for (const path of pathsToEnsure) {
      const doesPathExist = await this.exists(path);
      if (!doesPathExist) {
        await fs.mkdir(path, { recursive: true });
      }
    }
  }

  private exists(path: string): Promise<boolean> {
    return fs
      .stat(path)
      .then(() => true)
      .catch(() => false);
  }

  private async collectJsonFilePaths(
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
        await this.collectJsonFilePaths(entryPath, files);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(entryPath);
      }
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
