import { beforeAll, describe } from "vitest";
import crypto from "crypto";
import { COMPILATION_TARGETS } from "./compilation-targets.js";
import {
  ConfigSetup,
  HardhatConfigSetup,
  HardhatDeployScriptSetup,
} from "./helpers/test-setup.js";
import { testPushPullDeploy } from "./test-push-pull-deploy.js";

describe("[Foundry Hardhat-deploy v2] - Compilation WITHOUT --build-info WITHOUT test and scripts - Push artifact, pull artifact, deploy - Hardhat Plugin", () => {
  // The testId is used to create unique paths for the storage, pulled artifacts and typings for each test run
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
    outputArtifactsPath:
      COMPILATION_TARGETS.WITHOUT_BUILD_INFO_WITHOUT_TEST.outputPath,
  });
});
