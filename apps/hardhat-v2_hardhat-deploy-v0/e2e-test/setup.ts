import fs from "fs/promises";

export async function setup(): Promise<void> {
  console.log("\n========================================");
  console.log("🚀 Starting [Hardhat v2 - Hardhat-deploy v0] E2E Test Suite");
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
    .stat("ethoko-e2e")
    .then(() => true)
    .catch(() => false);
  if (doesExist) {
    await fs.rm("ethoko-e2e", { recursive: true });
  }
}
