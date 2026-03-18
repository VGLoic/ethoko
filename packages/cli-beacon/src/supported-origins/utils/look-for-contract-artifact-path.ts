import { AbsolutePath } from "@/utils/path";
import fs from "fs/promises";

export async function* lookForContractArtifactPath(
  basePath: AbsolutePath,
): AsyncIterable<AbsolutePath> {
  const entries = await fs.readdir(basePath.resolvedPath, {
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== "build-info") {
      const entryPath = basePath.join(entry.name);
      yield* lookForContractArtifactPath(entryPath);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      yield basePath.join(entry.name);
    }
  }
}
