import fs from "fs/promises";
import { asyncExec } from "./async-exec.js";

export async function setup(): Promise<void> {
  console.log("\n========================================");
  console.log("🚀 Starting [Foundry - Hardhat-deploy v2] E2E Test Suite");
  console.log("========================================\n");

  // Install forge dependencies before running the tests to avoid concurrent installations when running multiple test files
  await asyncExec("forge install");

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
    .stat("ethoko-e2e")
    .then(() => true)
    .catch(() => false);
  if (doesExist) {
    await fs.rm("ethoko-e2e", { recursive: true });
  }
}
