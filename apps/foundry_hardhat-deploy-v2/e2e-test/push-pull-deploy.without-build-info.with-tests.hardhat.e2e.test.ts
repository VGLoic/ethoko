import { E2E_FOLDER_PATH } from "./e2e-folder-path.js";
import { foundryDescribe } from "./foundry-describe.js";

const outputArtifactsPath = `${E2E_FOLDER_PATH}/out-2026-hardhat-plugin-forge-default-full`;

foundryDescribe({
  title:
    "[Foundry Hardhat-deploy v2] - Default compilation WITHOUT --build-info WITH test and scripts - Push artifact, pull artifact, deploy",
  build: {
    command: `forge build --out ${outputArtifactsPath} --cache-path ${outputArtifactsPath}-cache`,
    outputArtifactsPath,
  },
  runner: "hardhat",
});
