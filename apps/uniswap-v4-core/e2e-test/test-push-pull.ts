import { test } from "vitest";
import { asyncExec } from "./helpers/async-exec.js";
import { COMPILATION_TARGETS } from "./compilation-targets.js";
import { GlobalFolder } from "./helpers/global-folder.js";
import { PROJECT_NAME } from "./helpers/test-setup.js";

export function testPushPull(payload: { ethokoCommand: string; tag: string }) {
  // We allow for retries because the newly created artifacts are not always discoverable by the plugin on the first try, which causes the push command to fail.
  // This is likely due to some eventual consistency in the file system, but we haven't investigated further as allowing for retries is a simple workaround.
  test("it pushes the tag", { retry: 3 }, () =>
    asyncExec(
      `${payload.ethokoCommand} push ${PROJECT_NAME}:${payload.tag} --artifact-path ${COMPILATION_TARGETS.WITHOUT_BUILD_INFO_WITHOUT_TEST.outputPath} --debug`,
    ),
  );

  test("it pulls the tag", () =>
    asyncExec(`${payload.ethokoCommand} pull ${PROJECT_NAME}:${payload.tag}`));

  test("it generates the typings", () =>
    asyncExec(
      `${payload.ethokoCommand} typings ${PROJECT_NAME}:${payload.tag}`,
    ));

  test("it restores the original artifacts", async () => {
    await asyncExec(
      `${payload.ethokoCommand} restore ${PROJECT_NAME}:${payload.tag} --output ./${GlobalFolder.path}/restored-artifacts-${payload.tag}`,
    );
    await asyncExec(
      `ls -la ./${GlobalFolder.path}/restored-artifacts-${payload.tag}`,
    );
  });
}
