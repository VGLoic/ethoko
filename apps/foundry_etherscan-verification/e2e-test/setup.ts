import fs from "fs/promises";
import { E2E_FOLDER_PATH } from "./e2e-folder-path.js";

export async function setup(): Promise<void> {
  console.log("\n========================================");
  console.log("🚀 Starting [Foundry - Etherscan Verification] E2E Test Suite");
  console.log("========================================\n");

  await cleanUpLocalEthokoStorage();

  console.log("\n✅ Test ready to be run!\n");
}

export async function teardown(): Promise<void> {
  console.log("\n========================================");
  console.log("🧹 Cleaning Up Test Suite");
  console.log("========================================\n");

  await cleanUpLocalEthokoStorage();

  console.log("\n✅ Cleanup complete!\n");
}

async function cleanUpLocalEthokoStorage() {
  const doesExist = await fs
    .stat(E2E_FOLDER_PATH)
    .then(() => true)
    .catch(() => false);
  if (doesExist) {
    await fs.rm(E2E_FOLDER_PATH, { recursive: true });
  }
}
