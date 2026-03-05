import { beforeAll, describe, test } from "vitest";
import fs from "fs/promises";
import { asyncExec } from "./async-exec.js";
import { E2E_FOLDER_PATH } from "./e2e-folder-path.js";
import crypto from "crypto";

export function foundryDescribe(args: {
  title: string;
  build: {
    command: string;
    outputArtifactsPath: string;
  };
  runner: "hardhat" | "cli";
}) {
  const { title, build, runner } = args;
  const testId = `${runner}-${crypto.randomBytes(8).toString("hex")}`;
  const tag = testId;
  const hardhatConfigPath = `${E2E_FOLDER_PATH}/hardhat.config.e2e.${testId}.ts`;
  const cliConfigPath = `${E2E_FOLDER_PATH}/ethoko.config.e2e.${testId}.json`;

  const ignitionDeployPath = `./ignition/modules/release-${tag}.ts`;

  const ethokoCommand =
    runner === "hardhat"
      ? `pnpm hardhat --config ${hardhatConfigPath} ethoko`
      : `pnpm ethoko --config ${cliConfigPath}`;

  describe(title, () => {
    beforeAll(async () => {
      // We create:
      // - A temporary Hardhat config file based on the template, with the appropriate placeholders replaced with the actual values for this test
      // - A temporary ignition deployment script based on the template, with the appropriate placeholders replaced with the actual values for this test
      // - if the runner is CLI, we create a temporary config file for the CLI as well
      const hardhatConfigTemplate = await fs.readFile(
        "e2e-test/hardhat.config.e2e.template.ts",
        "utf-8",
      );
      const hardhatConfigContent = hardhatConfigTemplate
        .replaceAll(
          "PULLED_ARTIFACTS_PATH",
          `${E2E_FOLDER_PATH}/pulled-artifacts-${testId}`,
        )
        .replaceAll("TYPINGS_PATH", `${E2E_FOLDER_PATH}/typings-${testId}`)
        .replaceAll("STORAGE_PATH", `${E2E_FOLDER_PATH}/storage-${testId}`);

      await fs.writeFile(hardhatConfigPath, hardhatConfigContent);

      if (runner === "cli") {
        const cliConfigTemplate = await fs.readFile(
          "e2e-test/ethoko.config.e2e.template.json",
          "utf-8",
        );
        const cliConfigContent = cliConfigTemplate
          .replaceAll(
            "PULLED_ARTIFACTS_PATH",
            `./../${E2E_FOLDER_PATH}/pulled-artifacts-${testId}`,
          )
          .replaceAll(
            "TYPINGS_PATH",
            `./../${E2E_FOLDER_PATH}/typings-${testId}`,
          )
          .replaceAll(
            "STORAGE_PATH",
            `./../${E2E_FOLDER_PATH}/storage-${testId}`,
          );
        await fs.writeFile(cliConfigPath, cliConfigContent);
      }

      const deploymentScriptContent = await fs.readFile(
        "ignition/modules/release-2026-02-02.ts",
        "utf-8",
      );
      const updatedScriptContent = deploymentScriptContent
        .replaceAll("2026-02-02", tag)
        .replaceAll(
          "../.ethoko-typings",
          `../${E2E_FOLDER_PATH}/typings-${testId}`,
        );

      await fs.writeFile(ignitionDeployPath, updatedScriptContent);
      return async () => {
        await fs.rm(ignitionDeployPath);
      };
    });

    test("it compiles", () => asyncExec(build.command));

    test("it pushes the tag", () =>
      asyncExec(
        `${ethokoCommand} push --tag ${tag} --artifact-path ${build.outputArtifactsPath}`,
      ));

    test("it pulls the tag", () => asyncExec(`${ethokoCommand} pull`));

    test("it generates the typings", () =>
      asyncExec(`${ethokoCommand} typings`));

    test("it checks types", () => asyncExec("pnpm tsc --noEmit"));

    // We allow for three retries as recognition of the fresh typings might take a bit of time, especially on CI
    test("it deploys", { retry: 3 }, () =>
      asyncExec(
        `npx hardhat ignition deploy ${ignitionDeployPath} --config ${hardhatConfigPath}`,
      ),
    );

    test("it restores the original artifacts", async () => {
      await asyncExec(
        `${ethokoCommand} restore --tag ${tag} --output ./${E2E_FOLDER_PATH}/restored-artifacts-${tag}`,
      );
      await asyncExec(`ls -la ./${E2E_FOLDER_PATH}/restored-artifacts-${tag}`);
    });
  });
}
