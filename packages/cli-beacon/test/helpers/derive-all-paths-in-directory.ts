import { AbsolutePath } from "@/utils/path";
import fs from "fs/promises";

export async function deriveAllAbsolutePathsInDirectory(
  dirPath: AbsolutePath,
): Promise<AbsolutePath[]> {
  const paths: AbsolutePath[] = [];
  async function walk(currentPath: AbsolutePath) {
    const entries = await fs.readdir(currentPath.resolvedPath, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const fullPath = currentPath.join(entry.name);
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
