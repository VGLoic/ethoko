import fs from "fs/promises";
import { COMPILATION_TARGETS } from "./compilation-targets";
import { HardhatCompiler } from "./helpers/hardhat-compiler";
import { GlobalFolder } from "./helpers/global-folder";

export async function setup(): Promise<void> {
  console.log("\n========================================");
  console.log("🚀 Starting [Hardhat v2 - Hardhat-deploy v0] E2E Test Suite");
  console.log("========================================\n");

  await GlobalFolder.setup();

  console.log("🔨 Compiling contracts...");
  await compileContracts();

  console.log("\n✅ Test ready to be run!\n");
}

export async function teardown(): Promise<void> {
  console.log("\n========================================");
  console.log("🧹 Cleaning Up Test Suite");
  console.log("========================================\n");

  await cleanUpCompiledArtifacts();
  await GlobalFolder.teardown();

  console.log("\n✅ Cleanup complete!\n");
}

async function compileContracts() {
  await Promise.all([
    HardhatCompiler.compile(
      COMPILATION_TARGETS.DEFAULT.command,
      COMPILATION_TARGETS.DEFAULT.outputPath,
    ),
  ]);
}

async function cleanUpCompiledArtifacts() {
  for (const target of Object.values(COMPILATION_TARGETS)) {
    await fs.rm(target.outputPath, { recursive: true, force: true });
  }
}
