import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { Audit } from "./protocol.ts";

for (const probe of ["unattributed", "late", "absorbed", "cleanup"]) {
  const result = spawnSync("pnpm", ["test:e2e", "--retries=0"], {
    env: {
      ...process.env,
      E2E_HARNESS_PROBE: probe,
    },
    encoding: "utf8",
    timeout: 120_000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const directory = `harness-results/${probe}`;
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/output.log`, output);
  await cp("test-results", `${directory}/test-results`, { recursive: true });
  assert.ifError(result.error);
  assert.equal(
    result.status,
    1,
    `${probe} must exit 1, not silently pass:\n${output}`,
  );
  const audit = Audit.parse(
    JSON.parse(await readFile("test-results/mock-api.json", "utf8")),
  );
  assert(
    audit.scenarios.every((scenario) => !scenario.active),
    `${probe} leaked an active scenario`,
  );
  if (probe === "cleanup") {
    assert.equal(audit.scenarios.length, 1);
    assert.equal(audit.violations.length, 0);
    assert.match(output, /deliberate assertion failure/);
  } else {
    assert.equal(audit.violations.length, 1);
    assert.match(
      audit.violations[0],
      probe === "unattributed"
        ? /unknown identity.*unattributed/
        : /request after scenario retirement/,
    );
    assert.match(output, /Mock API audit failed/);
    if (probe !== "absorbed") assert.match(output, /1 passed/);
  }
  console.log(
    `${probe}: verified nonzero exit, diagnostics, and scenario cleanup`,
  );
}
