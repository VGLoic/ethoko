import { Stream } from "stream";
import { EthokoArtifact } from "../utils/artifacts-schemas/ethoko-v0";

export interface StorageProvider {
  listTags(project: string): Promise<string[]>;
  listIds(project: string): Promise<string[]>;
  listOriginalContent(project: string, id: string): Promise<string[]>;
  hasArtifactByTag(project: string, tag: string): Promise<boolean>;
  hasArtifactById(project: string, id: string): Promise<boolean>;
  uploadArtifact(
    project: string,
    artifact: EthokoArtifact,
    tag: string | undefined,
    originalContentPaths: string[],
  ): Promise<void>;
  downloadArtifactById(project: string, id: string): Promise<Stream>;
  downloadArtifactByTag(project: string, tag: string): Promise<Stream>;
  downloadOriginalContent(
    project: string,
    id: string,
    relativePath: string,
  ): Promise<Stream>;
}
