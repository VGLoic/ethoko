import { beforeAll, describe } from "vitest";
import crypto from "crypto";
import { testPushPull } from "./test-push-pull.js";
import { ConfigSetup, HardhatConfigSetup } from "./helpers/test-setup.js";

describe("[Uniswap v4 Core] - Default compilation without test - Push artifact, pull artifact - Hardhat Plugin", () => {
  const testId = crypto.randomBytes(16).toString("hex");
  const tag = testId;

  const config = new ConfigSetup(testId);
  const hardhatConfigSetup = new HardhatConfigSetup(config);

  const ethokoCommand = `pnpm hardhat --config ${hardhatConfigSetup.hardhatConfigPath} ethoko`;

  beforeAll(async () => {
    const configCleanup = await config.setup();
    const hardhatCleanup = await hardhatConfigSetup.setup();

    return async () => {
      await hardhatCleanup();
      await configCleanup();
    };
  });

  testPushPull({
    ethokoCommand,
    tag,
  });
});
