import { describe, test } from "vitest";
import { asyncExec } from "./async-exec";

const TAG_NAME = "2026-02-04";

describe("[Hardhat v2 - Hardhat-deploy v0] Push artifact, pull artifact, deploy", async () => {
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
      `npx hardhat --config ./hardhat.config.e2e.ts ethoko restore --tag ${TAG_NAME} --output ./ethoko-e2e/restored-artifacts-${TAG_NAME}`,
    );
    await asyncExec(`ls -la ./ethoko-e2e/restored-artifacts-${TAG_NAME}`);
  });
});
