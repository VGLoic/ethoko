import fs from "fs/promises";
import path from "path";

export async function deriveAllAbsolutePathsInDirectory(
  dirPath: string,
): Promise<string[]> {
  const absoluteDirPath = path.resolve(dirPath);
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
  await walk(absoluteDirPath);
  return paths;
}
