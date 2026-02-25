import { beforeAll, describe, test } from "vitest";
import fs from "fs/promises";
import { asyncExec } from "./async-exec.js";
import { E2E_FOLDER_PATH } from "./e2e-folder-path.js";

export function foundryDescribe(
  title: string,
  buildCommand: string,
  tag: string,
  outputArtifactsPath: string,
) {
  describe(title, () => {
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
        `npx hardhat --config ./hardhat.config.e2e.ts ethoko push --tag ${tag} --artifact-path ${outputArtifactsPath}`,
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
        `npx hardhat --config ./hardhat.config.e2e.ts ethoko restore --tag ${tag} --output ./${E2E_FOLDER_PATH}/restored-artifacts-${tag}`,
      );
      await asyncExec(`ls -la ./${E2E_FOLDER_PATH}/restored-artifacts-${tag}`);
    });
  });
}
