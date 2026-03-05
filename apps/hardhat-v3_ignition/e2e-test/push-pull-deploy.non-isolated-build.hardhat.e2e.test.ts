import { hardhatDescribe } from "./hardhat-describe.js";

hardhatDescribe({
  title:
    "[Hardhat v3 - Hardhat Ignition] Push artifact, pull artifact, deploy - Hardhat - Non Isolated Build",
  isolatedBuild: false,
  runner: "hardhat",
});
