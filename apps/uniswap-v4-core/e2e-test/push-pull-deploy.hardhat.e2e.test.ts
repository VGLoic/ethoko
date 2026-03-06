import { beforeAll, describe } from "vitest";
import fs from "fs/promises";
import crypto from "crypto";
import { testPushPull } from "./test-push-pull.js";
import { E2E_FOLDER_PATH } from "./config.js";

describe("[Uniswap v4 Core] - Default compilation without test - Push artifact, pull artifact - Hardhat Plugin", () => {
  const testId = crypto.randomBytes(16).toString("hex");
  const tag = testId;
  const hardhatConfigPath = `${E2E_FOLDER_PATH}/hardhat.config.e2e.${testId}.ts`;
  const ethokoCommand = `pnpm hardhat --config ${hardhatConfigPath} ethoko`;

  beforeAll(async () => {
    const hardhatConfigTemplate = await fs.readFile(
      "e2e-test/templates/hardhat.config.e2e.template.ts",
      "utf-8",
    );
    const hardhatConfigContent = hardhatConfigTemplate
      .replace(
        "PULLED_ARTIFACTS_PATH",
        `${E2E_FOLDER_PATH}/pulled-artifacts-${testId}`,
      )
      .replace("TYPINGS_PATH", `${E2E_FOLDER_PATH}/typings-${testId}`)
      .replace("STORAGE_PATH", `${E2E_FOLDER_PATH}/storage-${testId}`);

    await fs.writeFile(hardhatConfigPath, hardhatConfigContent);

    return async () => {
      await fs.rm(hardhatConfigPath);
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
