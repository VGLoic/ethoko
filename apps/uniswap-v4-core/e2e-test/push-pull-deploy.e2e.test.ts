import { beforeAll, describe } from "vitest";
import crypto from "crypto";
import { testPushPull } from "./test-push-pull.js";
import { CliConfigSetup, ConfigSetup } from "./helpers/test-setup.js";

describe("[Uniswap v4 Core] - Default compilation without test - Push artifact, pull artifact - CLI", () => {
  const testId = crypto.randomBytes(16).toString("hex");
  const tag = testId;

  const config = new ConfigSetup(testId);
  const cliConfigSetup = new CliConfigSetup(config);

  const ethokoCommand = `pnpm ethoko --config ${cliConfigSetup.cliConfigPath}`;

  beforeAll(async () => {
    const configCleanup = await config.setup();
    const cliCleanup = await cliConfigSetup.setup();

    return async () => {
      await cliCleanup();
      await configCleanup();
    };
  });

  testPushPull({
    ethokoCommand,
    tag,
  });
});
