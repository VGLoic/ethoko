import fs from "fs/promises";
import path from "path";

export async function* lookForContractArtifactPath(
  basePath: string,
): AsyncIterable<string> {
  const entries = await fs.readdir(basePath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== "build-info") {
      const entryPath = path.join(basePath, entry.name);
      yield* lookForContractArtifactPath(entryPath);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      yield path.join(basePath, entry.name);
    }
  }
}
