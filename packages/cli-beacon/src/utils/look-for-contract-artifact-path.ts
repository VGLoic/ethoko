import fs from "fs/promises";

export async function* lookForContractArtifactPath(
  path: string,
): AsyncIterable<string> {
  const entries = await fs.readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== "build-info") {
      yield* lookForContractArtifactPath(`${path}/${entry.name}`);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      yield `${path}/${entry.name}`;
    }
  }
}
