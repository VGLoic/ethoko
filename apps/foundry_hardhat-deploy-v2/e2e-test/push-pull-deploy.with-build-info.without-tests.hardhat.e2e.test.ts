import { E2E_FOLDER_PATH } from "./e2e-folder-path.js";
import { foundryDescribe } from "./foundry-describe.js";

const outputArtifactsPath = `./${E2E_FOLDER_PATH}/out-2026-hardhat-plugin-forge-build-info`;

foundryDescribe({
  title:
    "[Foundry Hardhat-deploy v2] - Compilation WITH --build-info WITHOUT test and scripts - Push artifact, pull artifact, deploy",
  build: {
    command: `forge build --skip test --skip script --build-info --out ${outputArtifactsPath} --cache-path ${outputArtifactsPath}-cache`,
    outputArtifactsPath,
  },
  runner: "hardhat",
});
