import { describe, test } from "vitest";
import { asyncExec } from "./async-exec.js";

const TAG = `v4-core-ethoko-e2e-test-${Date.now()}`;
describe("[Uniswap v4 Core] - Default compilation without test - Push artifact, pull artifact", () => {
  test("it compiles", () => asyncExec("forge build --skip test/**/* --skip src/test/**/* --force"));

  test("it pushes the tag", () => asyncExec(`npx hardhat --config ./hardhat.config.e2e.ts ethoko push --tag ${TAG}`));

  test("it pulls the tag", () => asyncExec("npx hardhat --config ./hardhat.config.e2e.ts ethoko pull"));

  test("it generates the typings", () => asyncExec("npx hardhat --config ./hardhat.config.e2e.ts ethoko typings"));

  test("it restores the original artifacts", async () => {
    await asyncExec(
      `npx hardhat --config ./hardhat.config.e2e.ts ethoko restore --tag ${TAG} --output ./ethoko-e2e/restored-artifacts-${TAG}`,
    );
    await asyncExec(`ls -la ./ethoko-e2e/restored-artifacts-${TAG}`);
  });
});
