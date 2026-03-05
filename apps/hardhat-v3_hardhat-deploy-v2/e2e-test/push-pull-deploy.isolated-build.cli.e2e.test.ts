import { hardhatDescribe } from "./hardhat-describe.js";

hardhatDescribe({
  title:
    "[Hardhat v3 - Hardhat-deploy v2] Push artifact, pull artifact, deploy - CLI - Isolated Build",
  isolatedBuild: true,
  runner: "cli",
});
