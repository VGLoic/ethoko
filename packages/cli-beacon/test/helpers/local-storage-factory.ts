import fs from "fs/promises";
import os from "os";
import path from "path";
import { PulledArtifactStore } from "@/pulled-artifact-store/pulled-artifact-store";
import { TEST_CONSTANTS } from "./test-constants";
import { AbsolutePath } from "@/utils/path";

export async function createTestPulledArtifactStore(): Promise<{
  pulledArtifactStore: PulledArtifactStore;
  cleanup: () => Promise<void>;
}> {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), TEST_CONSTANTS.PATHS.TEMP_DIR_PREFIX),
  );

  const pulledArtifactStore = new PulledArtifactStore(
    new AbsolutePath(tempDir),
  );

  const cleanup = async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  };

  return { pulledArtifactStore, cleanup };
}
