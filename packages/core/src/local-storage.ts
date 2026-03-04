import fs from "fs/promises";
import { Stream } from "stream";
import {
  EthokoInputArtifact,
  EthokoInputArtifactSchema,
  EthokoOutputArtifact,
  EthokoOutputArtifactSchema,
  TagManifest,
  TagManifestSchema,
} from "./utils/ethoko-artifacts-schemas/v0";

/**
 * Local storage implementation for storing artifacts on the local filesystem.
 *
 * Storage layout (relative to rootPath)
 * - {project}/ids/{id}/input.json
 * - {project}/ids/{id}/output.json
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
   * Creates an artifact associated with the given ID.
   * @param project The project name.
   * @param id The artifact ID.
   * @param inputArtifact The input artifact content.
   * @param outputArtifact The output artifact content.
   */
  public async createArtifactById(
    project: string,
    id: string,
    inputArtifact: Stream,
    outputArtifact: Stream,
  ): Promise<void> {
    const idDir = `${this.rootPath}/${project}/ids/${id}`;
    await fs.mkdir(idDir, { recursive: true });
    await Promise.all([
      fs.writeFile(`${idDir}/input.json`, inputArtifact),
      fs.writeFile(`${idDir}/output.json`, outputArtifact),
    ]);
  }

  /**
   * Creates an artifact associated with the given tag.
   * @param project The project name.
   * @param tag The tag name.
   * @param id The artifact ID.
   * @param inputArtifact The input artifact content.
   * @param outputArtifact The output artifact content.
   */
  public async createArtifactByTag(
    project: string,
    tag: string,
    id: string,
    inputArtifact: Stream,
    outputArtifact: Stream,
  ): Promise<void> {
    await this.createArtifactById(project, id, inputArtifact, outputArtifact);
    const manifest: TagManifest = { id };
    await fs.writeFile(
      `${this.rootPath}/${project}/tags/${tag}.json`,
      JSON.stringify(manifest),
    );
  }

  /**
   * Retrieves the input artifact associated with the given tag.
   * @param project The project name.
   * @param tag The tag name.
   * @returns The input artifact.
   */
  public async retrieveInputArtifactByTag(
    project: string,
    tag: string,
  ): Promise<EthokoInputArtifact> {
    const id = await this.retrieveArtifactId(project, tag);
    return this.retrieveInputArtifactById(project, id);
  }

  /**
   * Retrieves the output artifact associated with the given tag.
   * @param project The project name.
   * @param tag The tag name.
   * @returns The output artifact.
   */
  public async retrieveOutputArtifactByTag(
    project: string,
    tag: string,
  ): Promise<EthokoOutputArtifact> {
    const id = await this.retrieveArtifactId(project, tag);
    return this.retrieveOutputArtifactById(project, id);
  }

  /**
   * Retrieves the input artifact associated with the given ID.
   * @param project The project name.
   * @param id The artifact ID.
   * @returns The input artifact.
   */
  public async retrieveInputArtifactById(
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
   * Retrieves the output artifact associated with the given ID.
   * @param project The project name.
   * @param id The artifact ID.
   * @returns The output artifact.
   */
  public async retrieveOutputArtifactById(
    project: string,
    id: string,
  ): Promise<EthokoOutputArtifact> {
    const artifactContent = await fs.readFile(
      `${this.rootPath}/${project}/ids/${id}/output.json`,
      "utf-8",
    );
    const rawArtifact = JSON.parse(artifactContent);
    return EthokoOutputArtifactSchema.parse(rawArtifact);
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
}
