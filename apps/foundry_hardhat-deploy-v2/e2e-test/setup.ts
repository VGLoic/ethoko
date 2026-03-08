import fs from "fs/promises";
import { COMPILATION_TARGETS } from "./compilation-targets.js";
import { asyncExec } from "./helpers/async-exec.js";
import { GlobalFolder } from "./helpers/global-folder.js";

export async function setup(): Promise<void> {
  console.log("\n========================================");
  console.log("🚀 Starting [Foundry - Hardhat-deploy v2] E2E Test Suite");
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
  const [firstCommand, ...restCommands] = Object.values(
    COMPILATION_TARGETS,
  ).map((target) => target.command);
  // We run one command before the others in order to load solc once and not have concurrent lazy load of solc
  // See https://github.com/foundry-rs/foundry/issues/4736
  await asyncExec(firstCommand);
  for (const command of restCommands) {
    await asyncExec(command);
  }
}

async function cleanUpCompiledArtifacts() {
  for (const target of Object.values(COMPILATION_TARGETS)) {
    await fs.rm(target.outputPath, { recursive: true, force: true });
  }
}
