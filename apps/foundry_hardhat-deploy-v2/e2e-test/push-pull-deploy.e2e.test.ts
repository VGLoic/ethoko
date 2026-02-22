import { beforeAll, describe, test } from "vitest";
import fs from "fs/promises";
import { asyncExec } from "./async-exec.js";

describe.each([
  [
    "~~Default compilation WITHOUT test and scripts~~",
    "forge build --force --skip test --skip script",
    "2026-forge-default",
  ],
  [
    "~~Compilation WITH --build-info WITHOUT test and scripts~~",
    "forge build --force --skip test --skip script --build-info",
    "2026-forge-build-info",
  ],
  [
    "~~Compilation WITH --build-info WITH test and scripts~~",
    "forge build --force --build-info",
    "2026-forge-build-info-full",
  ],
])(
  "[Foundry Hardhat-deploy v2] - %s - Push artifact, pull artifact, deploy",
  (_, buildCommand, tag) => {
    beforeAll(async () => {
      const deploymentScriptContent = await fs.readFile(
        "deploy/00-deploy-counter-2026-02-04.ts",
        "utf-8",
      );
      const updatedScriptContent = deploymentScriptContent.replaceAll(
        "2026-02-04",
        tag,
      );

      const tmpDeploymentScript = `deploy/00-deploy-counter-${tag}.ts`;
      await fs.writeFile(tmpDeploymentScript, updatedScriptContent);
      return async () => {
        await fs.rm(tmpDeploymentScript);
      };
    });

    test("it compiles", () => asyncExec(buildCommand));

    test("it pushes the tag", () =>
      asyncExec(
        `npx hardhat --config ./hardhat.config.e2e.ts ethoko push --tag ${tag}`,
      ));

    test("it pulls the tag", () =>
      asyncExec("npx hardhat --config ./hardhat.config.e2e.ts ethoko pull"));

    test("it generates the typings", () =>
      asyncExec("npx hardhat --config ./hardhat.config.e2e.ts ethoko typings"));

    test("it checks types", () => asyncExec("pnpm tsc --noEmit"));

    test("it deploys", () =>
      asyncExec(
        `npx hardhat --config ./hardhat.config.e2e.ts deploy --tags ${tag}`,
      ));

    test("it restores the original artifacts", async () => {
      await asyncExec(
        `npx hardhat --config ./hardhat.config.e2e.ts ethoko restore --tag ${tag} --output ./ethoko-e2e/restored-artifacts-${tag}`,
      );
      await asyncExec(`ls -la ./ethoko-e2e/restored-artifacts-${tag}`);
    });
  },
);
