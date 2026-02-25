import { foundryDescribe } from "./foundry-describe.js";

const outputArtifactsPath = "./ethoko-e2e/out-2026-forge-default-full";

foundryDescribe(
  "[Foundry Hardhat-deploy v2] - Default compilation WITHOUT --build-info WITH test and scripts - Push artifact, pull artifact, deploy",
  `forge build --out ${outputArtifactsPath} --cache-path ${outputArtifactsPath}-cache`,
  "2026-forge-default-full",
  outputArtifactsPath,
);
