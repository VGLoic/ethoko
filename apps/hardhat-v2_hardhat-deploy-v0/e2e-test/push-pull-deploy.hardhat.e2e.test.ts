import { beforeAll, describe } from "vitest";
import crypto from "crypto";
import { COMPILATION_TARGETS } from "./compilation-targets.js";
import {
  ConfigSetup,
  HardhatConfigSetup,
  HardhatDeployScriptSetup,
} from "./helpers/test-setup.js";
import { testPushPullDeploy } from "./test-push-pull-deploy.js";

describe("[Hardhat v2 - Hardhat-deploy v0] Push artifact, pull artifact, deploy - Hardhat Plugin", () => {
  const testId = crypto.randomBytes(16).toString("hex");
  const tag = testId;

  const config = new ConfigSetup(testId);
  const hardhatConfigSetup = new HardhatConfigSetup(config);
  const deploymentScriptSetup = new HardhatDeployScriptSetup(config);

  const ethokoCommand = `pnpm hardhat ethoko --config ${hardhatConfigSetup.hardhatConfigPath}`;

  beforeAll(async () => {
    const configCleanup = await config.setup();
    const hardhatCleanup = await hardhatConfigSetup.setup();
    const deploymentScriptCleanup = await deploymentScriptSetup.setup();

    return async () => {
      await deploymentScriptCleanup();
      await hardhatCleanup();
      await configCleanup();
    };
  });

  testPushPullDeploy({
    ethokoCommand,
    tag,
    hardhatConfigPath: hardhatConfigSetup.hardhatConfigPath,
    outputArtifactsPath: COMPILATION_TARGETS.DEFAULT.outputPath,
    deploymentScriptFolderPath:
      deploymentScriptSetup.deploymentScriptFolderPath,
  });
});
