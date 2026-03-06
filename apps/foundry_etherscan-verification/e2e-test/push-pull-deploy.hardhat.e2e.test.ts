import { beforeAll, describe } from "vitest";
import crypto from "crypto";
import {
  ConfigSetup,
  HardhatConfigSetup,
  IgnitionDeployScriptSetup,
} from "./helpers/test-setup.js";
import { testPushPullDeploy } from "./test-push-pull-deploy.js";

describe("[Foundry - Etherscan Verification] - Default compilation without test - Push artifact, pull artifact, deploy - Hardhat Plugin", () => {
  const testId = crypto.randomBytes(16).toString("hex");
  const tag = testId;

  const config = new ConfigSetup(testId);
  const hardhatConfigSetup = new HardhatConfigSetup(config);
  const ignitionDeployScriptSetup = new IgnitionDeployScriptSetup(config);

  const ethokoCommand = `pnpm hardhat --config ${hardhatConfigSetup.hardhatConfigPath} ethoko`;

  beforeAll(async () => {
    const configCleanup = await config.setup();
    const hardhatCleanup = await hardhatConfigSetup.setup();
    const ignitionDeployCleanup = await ignitionDeployScriptSetup.setup();

    return async () => {
      await ignitionDeployCleanup();
      await hardhatCleanup();
      await configCleanup();
    };
  });

  testPushPullDeploy({
    ethokoCommand,
    tag,
    ignitionDeployPath: ignitionDeployScriptSetup.ignitionDeployPath,
    hardhatConfigPath: hardhatConfigSetup.hardhatConfigPath,
  });
});
