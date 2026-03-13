import fs from "fs/promises";
import os from "os";
import path from "path";
import { LocalStorage } from "@/local-storage";
import { TEST_CONSTANTS } from "./test-constants";

export async function createTestLocalStorage(): Promise<{
  localStorage: LocalStorage;
  cleanup: () => Promise<void>;
}> {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), TEST_CONSTANTS.PATHS.TEMP_DIR_PREFIX),
  );

  const localStorage = new LocalStorage(tempDir);

  const cleanup = async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  };

  return { localStorage, cleanup };
}
