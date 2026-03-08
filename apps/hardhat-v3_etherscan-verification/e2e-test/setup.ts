import fs from "fs/promises";
import { GlobalFolder } from "./helpers/global-folder.js";
import { HardhatCompiler } from "./helpers/hardhat-compiler.js";
import { COMPILATION_TARGETS } from "./compilation-targets.js";

export async function setup(): Promise<void> {
  console.log("\n========================================");
  console.log(
    "🚀 Starting [Hardhat v3 - Etherscan Verification] E2E Test Suite",
  );
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
      COMPILATION_TARGETS.ISOLATED_BUILD.command,
      COMPILATION_TARGETS.ISOLATED_BUILD.outputPath,
    ),
  ]);
}

async function cleanUpCompiledArtifacts() {
  for (const target of Object.values(COMPILATION_TARGETS)) {
    await fs.rm(target.outputPath, { recursive: true, force: true });
  }
}
