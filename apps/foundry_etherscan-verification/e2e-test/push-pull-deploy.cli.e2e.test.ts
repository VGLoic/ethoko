import { beforeAll, describe } from "vitest";
import crypto from "crypto";
import {
  CliConfigSetup,
  ConfigSetup,
  HardhatConfigSetup,
  IgnitionDeployScriptSetup,
} from "./helpers/test-setup.js";
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
    const configCleanup = await config.setup();
    const cliCleanup = await cliConfigSetup.setup();
    const hardhatCleanup = await hardhatConfigSetup.setup();
    const ignitionDeployCleanup = await ignitionDeployScriptSetup.setup();

    return async () => {
      await ignitionDeployCleanup();
      await hardhatCleanup();
      await cliCleanup();
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
