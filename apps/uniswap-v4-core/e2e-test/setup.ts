import fs from "fs/promises";
import { asyncExec } from "./async-exec.js";
import { E2E_FOLDER_PATH, BUILD } from "./config.js";

export async function setup(): Promise<void> {
  console.log("\n========================================");
  console.log("🚀 Starting [Uniswap v4 Core] E2E Test Suite");
  console.log("========================================\n");

  await cleanUpLocalEthokoStorage();

  await fs.mkdir(E2E_FOLDER_PATH, { recursive: true });

  console.log("🔨 Compiling contracts...");
  await asyncExec(BUILD.command);

  console.log("\n✅ Test ready to be run!\n");
}

export async function teardown(): Promise<void> {
  console.log("\n========================================");
  console.log("🧹 Cleaning Up [Uniswap v4 Core] Test Suite");
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
