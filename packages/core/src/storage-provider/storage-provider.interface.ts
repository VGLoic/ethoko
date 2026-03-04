import { Stream } from "stream";
import {
  EthokoInputArtifact,
  EthokoOutputArtifact,
} from "../utils/ethoko-artifacts-schemas/v0";

/**
 * Storage providers implement the persistence layer for Ethoko artifacts.
 *
 * Responsibilities
 * - Store input/output artifacts and tag manifests
 * - Expose list and existence checks for tags/ids
 * - Stream artifacts and original content on demand
 *
 * Storage layout (logical)
 * - {project}/ids/{id}/input.json
 * - {project}/ids/{id}/output.json
 * - {project}/ids/{id}/original/** (original compilation content)
 * - {project}/tags/{tag}.json (manifest: { id })
 */
export interface StorageProvider {
  /** List available tags for a project. */
  listTags(project: string): Promise<string[]>;
  /** List available artifact IDs for a project. */
  listIds(project: string): Promise<string[]>;
  /** List paths under the original content folder for an artifact ID. */
  listOriginalContent(project: string, id: string): Promise<string[]>;
  /** Check if a tag manifest exists for a project. */
  hasArtifactByTag(project: string, tag: string): Promise<boolean>;
  /** Check if an artifact ID exists for a project. */
  hasArtifactById(project: string, id: string): Promise<boolean>;
  /** Upload input/output artifacts, plus optional tag manifest and originals. */
  uploadArtifact(
    project: string,
    inputArtifact: EthokoInputArtifact,
    outputArtifact: EthokoOutputArtifact,
    tag: string | undefined,
    originalContentPaths: string[],
  ): Promise<void>;
  /** Download input/output artifact streams by ID. */
  downloadArtifactById(
    project: string,
    id: string,
  ): Promise<{ input: Stream; output: Stream }>;
  /** Download input/output artifact streams by tag, plus resolved ID. */
  downloadArtifactByTag(
    project: string,
    tag: string,
  ): Promise<{ id: string; input: Stream; output: Stream }>;
  /** Download an original content file by relative path. */
  downloadOriginalContent(
    project: string,
    id: string,
    relativePath: string,
  ): Promise<Stream>;
}
