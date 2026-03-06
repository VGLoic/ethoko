import { beforeAll, describe } from "vitest";
import crypto from "crypto";
import { COMPILATION_TARGETS } from "./compilation-targets.js";
import {
  ConfigSetup,
  CliConfigSetup,
  HardhatConfigSetup,
  HardhatDeployScriptSetup,
} from "./helpers/test-setup.js";
import { testPushPullDeploy } from "./test-push-pull-deploy.js";

describe("[Foundry Hardhat-deploy v2] - Compilation WITH --build-info WITHOUT test and scripts - Push artifact, pull artifact, deploy - CLI", () => {
  // The testId is used to create unique paths for the storage, pulled artifacts and typings for each test run
  const testId = crypto.randomBytes(16).toString("hex");
  const tag = testId;

  const config = new ConfigSetup(testId);
  const cliConfigSetup = new CliConfigSetup(config);
  const hardhatConfigSetup = new HardhatConfigSetup(config);
  const deploymentScriptSetup = new HardhatDeployScriptSetup(config);

  const ethokoCommand = `pnpm ethoko --config ${cliConfigSetup.cliConfigPath}`;

  beforeAll(async () => {
    const configCleanup = await config.setup();
    const cliCleanup = await cliConfigSetup.setup();
    const hardhatCleanup = await hardhatConfigSetup.setup();
    const deploymentScriptCleanup = await deploymentScriptSetup.setup();

    return async () => {
      await cliCleanup();
      await hardhatCleanup();
      await deploymentScriptCleanup();
      await configCleanup();
    };
  });

  testPushPullDeploy({
    ethokoCommand,
    tag,
    hardhatConfigPath: hardhatConfigSetup.hardhatConfigPath,
    outputArtifactsPath:
      COMPILATION_TARGETS.WITH_BUILD_INFO_WITHOUT_TEST.outputPath,
  });
});
