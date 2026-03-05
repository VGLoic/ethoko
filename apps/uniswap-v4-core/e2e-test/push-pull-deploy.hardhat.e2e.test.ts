import { E2E_FOLDER_PATH } from "./e2e-folder-path.js";
import { foundryDescribe } from "./foundry-describe.js";

const outputArtifactsPath = `${E2E_FOLDER_PATH}/out-2026-forge`;

foundryDescribe({
  title:
    "[Uniswap v4 Core] - Default compilation without test - Push artifact, pull artifact - Hardhat Plugin",
  build: {
    command: `forge build --skip test --skip test/**/* --skip src/test/**/* --use-literal-content --force --out ${outputArtifactsPath} --cache-path ${outputArtifactsPath}-cache`,
    outputArtifactsPath,
  },
  runner: "hardhat",
});
