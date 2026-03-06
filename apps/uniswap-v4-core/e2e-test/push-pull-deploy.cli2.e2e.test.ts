import { beforeAll, describe } from "vitest";
import fs from "fs/promises";
import crypto from "crypto";
import { testPushPull } from "./test-push-pull.js";
import { E2E_FOLDER_PATH } from "./config.js";

describe("[Uniswap v4 Core] - Default compilation without test - Push artifact, pull artifact - CLI", () => {
  const testId = crypto.randomBytes(16).toString("hex");
  const tag = testId;
  const cliConfigPath = `${E2E_FOLDER_PATH}/ethoko.config.e2e.${testId}.json`;
  const ethokoCommand = `pnpm ethoko --config ${cliConfigPath}`;

  beforeAll(async () => {
    const cliConfigTemplate = await fs.readFile(
      "e2e-test/templates/ethoko.config.e2e.template.json",
      "utf-8",
    );
    const cliConfigContent = cliConfigTemplate
      .replace(
        "PULLED_ARTIFACTS_PATH",
        `./../${E2E_FOLDER_PATH}/pulled-artifacts-${testId}`,
      )
      .replace("TYPINGS_PATH", `./../${E2E_FOLDER_PATH}/typings-${testId}`)
      .replace("STORAGE_PATH", `./../${E2E_FOLDER_PATH}/storage-${testId}`);
    await fs.writeFile(cliConfigPath, cliConfigContent);

    return async () => {
      await fs.rm(cliConfigPath);
      for (const folder of [
        `pulled-artifacts-${testId}`,
        `typings-${testId}`,
        `storage-${testId}`,
        `restored-artifacts-${testId}`,
      ]) {
        await fs.rm(`${E2E_FOLDER_PATH}/${folder}`, { recursive: true });
      }
    };
  });

  testPushPull({
    ethokoCommand,
    tag,
  });
});
