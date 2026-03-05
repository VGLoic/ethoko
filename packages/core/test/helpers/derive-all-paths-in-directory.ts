import fs from "fs/promises";
import path from "path";

export async function deriveAllPathsInDirectory(
  dirPath: string,
): Promise<string[]> {
  const paths: string[] = [];
  async function walk(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        paths.push(fullPath);
      }
    }
  }
  await walk(dirPath);
  return paths;
}
