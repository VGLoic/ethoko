import { test } from "vitest";
import { asyncExec } from "./helpers/async-exec.js";
import { GlobalFolder } from "./helpers/global-folder.js";

export function testPushPullDeploy(payload: {
  ethokoCommand: string;
  tag: string;
  hardhatConfigPath: string;
  outputArtifactsPath: string;
}) {
  test("it pushes the tag", () =>
    asyncExec(
      `${payload.ethokoCommand} push --tag ${payload.tag} --artifact-path ${payload.outputArtifactsPath}`,
    ));

  test("it pulls the tag", () => asyncExec(`${payload.ethokoCommand} pull`));

  // We generates the typings with the default project in the repository in order to have the deployment script ready for compilation
  test("it generates the typings", () =>
    asyncExec(
      `pnpm hardhat ethoko typings && ${payload.ethokoCommand} typings`,
    ));

  // We allow for three retries as recognition of the fresh typings might take a bit of time, especially on CI
  test("it deploys", { retry: 3 }, () =>
    asyncExec(
      `pnpm hardhat --config ${payload.hardhatConfigPath} deploy --tags ${payload.tag}`,
    ),
  );

  test("it restores the original artifacts", async () => {
    await asyncExec(
      `${payload.ethokoCommand} restore --tag ${payload.tag} --output ./${GlobalFolder.path}/restored-artifacts-${payload.tag}`,
    );
    await asyncExec(
      `ls -la ./${GlobalFolder.path}/restored-artifacts-${payload.tag}`,
    );
  });
}
