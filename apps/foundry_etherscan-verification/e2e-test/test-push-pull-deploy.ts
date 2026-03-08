import { test } from "vitest";
import { asyncExec } from "./helpers/async-exec.js";
import { COMPILATION_TARGETS } from "./compilation-targets.js";
import { GlobalFolder } from "./helpers/global-folder.js";

export function testPushPullDeploy(payload: {
  ethokoCommand: string;
  tag: string;
  ignitionDeployPath: string;
  hardhatConfigPath: string;
}) {
  // We allow for retries because the newly created artifacts are not always discoverable by the plugin on the first try, which causes the push command to fail.
  // This is likely due to some eventual consistency in the file system, but we haven't investigated further as allowing for retries is a simple workaround.
  test("it pushes the tag", () =>
    asyncExec(
      `${payload.ethokoCommand} push --tag ${payload.tag} --artifact-path ${COMPILATION_TARGETS.WITHOUT_BUILD_INFO_WITHOUT_TEST.outputPath}`,
    ));

  test("it pulls the tag", () => asyncExec(`${payload.ethokoCommand} pull`));

  test("it generates the typings", () =>
    asyncExec(`${payload.ethokoCommand} typings`));

  test("it checks types", { retry: 3 }, () =>
    // We ensure that the default typings are generated in order to to pass the type checks on the existing deployment scripts.
    asyncExec("pnpm hardhat ethoko typings && pnpm tsc --noEmit"),
  );

  // We allow for three retries as recognition of the fresh typings might take a bit of time, especially on CI
  test("it deploys", { retry: 3 }, () =>
    asyncExec(
      `pnpm hardhat ignition deploy ${payload.ignitionDeployPath} --config ${payload.hardhatConfigPath}`,
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
