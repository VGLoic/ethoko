import { beforeAll, describe } from "vitest";
import crypto from "crypto";
import {
  CliConfigSetup,
  ConfigSetup,
  HardhatConfigSetup,
  IgnitionDeployScriptSetup,
} from "./config.js";
import { testPushPullDeploy } from "./test-push-pull-deploy.js";

describe("[Foundry - Etherscan Verification] - Default compilation without test - Push artifact, pull artifact, deploy - CLI", () => {
  const testId = crypto.randomBytes(16).toString("hex");
  const tag = testId;

  const config = new ConfigSetup(testId);
  const cliConfigSetup = new CliConfigSetup(config);
  const hardhatConfigSetup = new HardhatConfigSetup(config);
  const ignitionDeployScriptSetup = new IgnitionDeployScriptSetup(config);

  const ethokoCommand = `pnpm ethoko --config ${cliConfigSetup.cliConfigPath}`;

  beforeAll(async () => {
    const cliCleanup = await cliConfigSetup.setup();
    const hardhatCleanup = await hardhatConfigSetup.setup();
    const ignitionDeployCleanup = await ignitionDeployScriptSetup.setup();

    return async () => {
      await config.cleanup();
      await cliCleanup();
      await hardhatCleanup();
      await ignitionDeployCleanup();
    };
  });

  testPushPullDeploy({
    ethokoCommand,
    tag,
    ignitionDeployPath: ignitionDeployScriptSetup.ignitionDeployPath,
    hardhatConfigPath: hardhatConfigSetup.hardhatConfigPath,
  });
});
