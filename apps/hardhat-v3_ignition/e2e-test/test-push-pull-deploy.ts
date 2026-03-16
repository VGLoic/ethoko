import { test } from "vitest";
import { asyncExec } from "./helpers/async-exec.js";
import { GlobalFolder } from "./helpers/global-folder.js";
import { PROJECT_NAME } from "./helpers/test-setup.js";

export function testPushPullDeploy(payload: {
  ethokoCommand: string;
  tag: string;
  hardhatConfigPath: string;
  outputArtifactsPath: string;
  ignitionDeployPath: string;
}) {
  test("it pushes the tag", () =>
    asyncExec(
      `${payload.ethokoCommand} push ${PROJECT_NAME}:${payload.tag} --artifact-path ${payload.outputArtifactsPath}`,
    ));

  test("it pulls the tag", () =>
    asyncExec(`${payload.ethokoCommand} pull ${PROJECT_NAME}:${payload.tag}`));

  // We generates the typings with the default project in the repository in order to have the deployment script ready for compilation
  test("it generates the typings", () =>
    asyncExec(`pnpm ethoko typings && ${payload.ethokoCommand} typings`));

  // We allow for three retries as recognition of the fresh typings might take a bit of time, especially on CI
  test("it deploys", { retry: 3 }, () =>
    asyncExec(
      `pnpm hardhat ignition deploy ${payload.ignitionDeployPath} --config ${payload.hardhatConfigPath}`,
    ),
  );

  test("it restores the original artifacts", async () => {
    await asyncExec(
      `${payload.ethokoCommand} restore ${PROJECT_NAME}:${payload.tag} --output ./${GlobalFolder.path}/restored-artifacts-${payload.tag}`,
    );
    await asyncExec(
      `ls -la ./${GlobalFolder.path}/restored-artifacts-${payload.tag}`,
    );
  });
}
