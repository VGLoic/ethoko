import { describe, test } from "vitest";
import { asyncExec } from "./async-exec.js";
import { E2E_FOLDER_PATH } from "./e2e-folder-path.js";

const TAG_NAME = "2026-02-02";

describe("[Hardhat v3 - Hardhat-deploy v2] Push artifact, pull artifact, deploy", async () => {
  test("it compiles", () =>
    asyncExec(
      "npx hardhat build --build-profile production --config ./hardhat.config.e2e.ts",
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
    asyncExec("npx hardhat --config ./hardhat.config.e2e.ts deploy"));

  test("it restores the original artifacts", async () => {
    await asyncExec(
      `npx hardhat --config ./hardhat.config.e2e.ts ethoko restore --tag ${TAG_NAME} --output ./${E2E_FOLDER_PATH}/restored-artifacts-${TAG_NAME}`,
    );
    await asyncExec(
      `ls -la ./${E2E_FOLDER_PATH}/restored-artifacts-${TAG_NAME}`,
    );
  });
});
