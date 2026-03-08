import { beforeAll, describe } from "vitest";
import crypto from "crypto";
import {
  ConfigSetup,
  HardhatConfigSetup,
  IgnitionDeployScriptSetup,
} from "./helpers/test-setup.js";
import { testPushPullDeploy } from "./test-push-pull-deploy.js";
import { COMPILATION_TARGETS } from "./compilation-targets.js";

describe("[Hardhat v3 - Hardhat Ignition] Push artifact, pull artifact, deploy - Hardhat Plugin - Non Isolated Build", () => {
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
    outputArtifactsPath: COMPILATION_TARGETS.NON_ISOLATED_BUILD.outputPath,
    ignitionDeployPath: ignitionDeployScriptSetup.ignitionDeployPath,
    hardhatConfigPath: hardhatConfigSetup.hardhatConfigPath,
  });
});
