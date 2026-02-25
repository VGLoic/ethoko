import { describe, test } from "vitest";
import { asyncExec } from "./async-exec";
import { E2E_FOLDER_PATH } from "./e2e-folder-path";

const TAG_NAME = "v1.0.1";

describe("[Hardhat v2 - Hardhat-deploy v0 - external lib] Push artifact, pull artifact, deploy", async () => {
  test("it compiles", () =>
    asyncExec(
      "npx hardhat compile --force --no-typechain --config ./hardhat.config.e2e.ts",
    ));

  test("it pushes the tag", () =>
    asyncExec(
      `npx hardhat --config ./hardhat.config.e2e.ts ethoko push --tag ${TAG_NAME}`,
    ));

  test("it pulls the tag", () =>
    asyncExec("npx hardhat --config ./hardhat.config.e2e.ts ethoko pull"));

  test("it generates the typings", () =>
    asyncExec("npx hardhat --config ./hardhat.config.e2e.ts ethoko typings"));

  test("it checks types", () => asyncExec("pnpm tsc --noEmit"));

  test("it deploys", () =>
    asyncExec(
      "npx hardhat --config ./hardhat.config.e2e.ts deploy --no-compile",
    ));

  test("it restores the original artifacts", async () => {
    await asyncExec(
      `npx hardhat --config ./hardhat.config.e2e.ts ethoko restore --tag ${TAG_NAME} --output ./${E2E_FOLDER_PATH}/restored-artifacts-${TAG_NAME}`,
    );
    await asyncExec(
      `ls -la ./${E2E_FOLDER_PATH}/restored-artifacts-${TAG_NAME}`,
    );
  });
});
