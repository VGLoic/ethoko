import { E2E_FOLDER_PATH } from "./e2e-folder-path.js";
import { foundryDescribe } from "./foundry-describe.js";

const outputArtifactsPath = `${E2E_FOLDER_PATH}/out-2026-forge-default`;

foundryDescribe(
  "[Foundry Hardhat-deploy v2] - Default compilation WITHOUT --build-info WITHOUT test and scripts - Push artifact, pull artifact, deploy",
  `forge build --skip test --skip script --out ${outputArtifactsPath} --cache-path ${outputArtifactsPath}-cache`,
  "2026-forge-default",
  outputArtifactsPath,
);
