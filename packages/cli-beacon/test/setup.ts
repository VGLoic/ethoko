import { LocalStackHelper } from "./helpers/localstack";
import { TestSession } from "./helpers/test-session";

let localStackHelper: LocalStackHelper;

export async function setup(): Promise<void> {
  console.log("\n========================================");
  console.log("🚀 Starting E2E Test Suite");
  console.log("========================================\n");

  TestSession.getInstance();

  localStackHelper = new LocalStackHelper();
  await localStackHelper.start();

  console.log("\n✅ Test infrastructure ready!\n");
}

export async function teardown(): Promise<void> {
  console.log("\n========================================");
  console.log("🧹 Cleaning Up Test Suite");
  console.log("========================================\n");

  if (localStackHelper) {
    await localStackHelper.cleanupSession();
    await localStackHelper.stop();
  }

  console.log("\n✅ Cleanup complete!\n");
}
