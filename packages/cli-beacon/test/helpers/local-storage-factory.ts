import fs from "fs/promises";
import os from "os";
import path from "path";
import { LocalArtifactStore } from "@/local-artifact-store";
import { TEST_CONSTANTS } from "./test-constants";
import { AbsolutePath } from "@/utils/path";

export async function createTestLocalArtifactStore(): Promise<{
  localArtifactStore: LocalArtifactStore;
  cleanup: () => Promise<void>;
}> {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), TEST_CONSTANTS.PATHS.TEMP_DIR_PREFIX),
  );

  const localArtifactStore = new LocalArtifactStore(new AbsolutePath(tempDir));

  const cleanup = async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  };

  return { localArtifactStore, cleanup };
}
