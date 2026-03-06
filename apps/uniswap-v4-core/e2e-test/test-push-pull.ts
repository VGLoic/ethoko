import { test } from "vitest";
import { asyncExec } from "./async-exec.js";
import { E2E_FOLDER_PATH, BUILD } from "./config.js";

export function testPushPull({
  ethokoCommand,
  tag,
}: {
  ethokoCommand: string;
  tag: string;
}) {
  // We allow for retries because the newly created artifacts are not always discoverable by the plugin on the first try, which causes the push command to fail.
  // This is likely due to some eventual consistency in the file system, but we haven't investigated further as allowing for retries is a simple workaround.
  test("it pushes the tag", { retry: 3 }, () =>
    asyncExec(
      `${ethokoCommand} push --tag ${tag} --artifact-path ${BUILD.outputPath} --debug`,
    ),
  );

  test("it pulls the tag", () => asyncExec(`${ethokoCommand} pull`));

  test("it generates the typings", () => asyncExec(`${ethokoCommand} typings`));

  test("it restores the original artifacts", async () => {
    await asyncExec(
      `${ethokoCommand} restore --tag ${tag} --output ./${E2E_FOLDER_PATH}/restored-artifacts-${tag}`,
    );
    await asyncExec(`ls -la ./${E2E_FOLDER_PATH}/restored-artifacts-${tag}`);
  });
}
