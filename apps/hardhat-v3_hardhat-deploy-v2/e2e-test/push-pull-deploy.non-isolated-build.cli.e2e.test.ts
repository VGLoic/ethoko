import { hardhatDescribe } from "./hardhat-describe.js";

hardhatDescribe({
  title:
    "[Hardhat v3 - Hardhat-deploy v2] Push artifact, pull artifact, deploy - CLI - Non Isolated Build",
  isolatedBuild: false,
  runner: "cli",
});
