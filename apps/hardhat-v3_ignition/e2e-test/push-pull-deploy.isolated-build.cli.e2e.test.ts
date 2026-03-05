import { hardhatDescribe } from "./hardhat-describe.js";

hardhatDescribe({
  title:
    "[Hardhat v3 - Hardhat Ignition] Push artifact, pull artifact, deploy - CLI - Isolated Build",
  isolatedBuild: true,
  runner: "cli",
});
