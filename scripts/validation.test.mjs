import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const exec = promisify(execFile);
const pnpm = (await exec("which", ["pnpm"])).stdout.trim();

async function validate(t, suite, fail = "") {
  const directory = await mkdtemp(join(tmpdir(), "ethoko-validation-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const log = join(directory, "commands.jsonl");
  await writeFile(
    join(directory, "pnpm"),
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.COMMAND_LOG, JSON.stringify(args) + '\\n');
if (args.includes(process.env.FAIL_OPERATION)) process.exit(23);
`,
    { mode: 0o755 },
  );
  let result;
  try {
    result = await exec(pnpm, [`validate:${suite}`], {
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        COMMAND_LOG: log,
        FAIL_OPERATION: fail,
      },
      timeout: 15_000,
    });
  } catch (error) {
    result = error;
  }
  const commands = await readFile(log, "utf8").catch(() => "");
  return {
    result,
    commands: commands.trim().split("\n").filter(Boolean).map(JSON.parse),
  };
}

test("Central validates API and UI without CLI or framework work", async (t) => {
  const { result, commands } = await validate(t, "central");
  assert.equal(result.code, undefined, result.stderr);
  for (const name of ["central", "central-ui"]) {
    for (const operation of ["build", "check-types", "lint", "check-format"]) {
      assert.ok(
        commands.some(
          (args) => args.includes(name) && args.includes(operation),
        ),
        `${name} ${operation}`,
      );
    }
  }
  for (const operation of [
    "test:unit",
    "test:integration",
    "test:e2e",
    "test:e2e:verify-harness",
  ]) {
    assert.ok(
      commands.some((args) => args.includes(operation)),
      operation,
    );
  }
  assert.ok(
    commands.every(
      (args) =>
        (args[0] === "--filter" &&
          ["central", "central-ui"].includes(args[1])) ||
        args[0] === "test:integration:db:status",
    ),
  );
  assert.deepEqual(commands[0], ["test:integration:db:status"]);
});

test("CLI validates the CLI and framework apps without Central", async (t) => {
  const { result, commands } = await validate(t, "cli");
  assert.equal(result.code, undefined, result.stderr);
  for (const operation of [
    "build",
    "check-types",
    "lint",
    "check-format",
    "test:unit",
    "test:e2e:apps",
  ]) {
    assert.ok(
      commands.some(
        (args) =>
          args.includes(operation) &&
          args.includes("--filter=!central") &&
          args.includes("--filter=!central-ui"),
      ),
      operation,
    );
  }
  assert.ok(
    commands.some(
      (args) =>
        args.includes("@ethoko/cli-beacon") && args.includes("test:e2e"),
    ),
  );
  assert.ok(
    commands.findIndex((args) => args.includes("build")) <
      commands.findIndex((args) => args.includes("check-types")),
  );
  assert.ok(
    commands.every(
      (args) => !args.includes("central") && !args.includes("central-ui"),
    ),
  );
});

for (const suite of ["central", "cli"]) {
  test(`${suite} reports a failed required check and fails validation`, async (t) => {
    const { result, commands } = await validate(t, suite, "lint");
    assert.equal(result.code, 23);
    assert.match(result.stderr, /FAILED: pnpm .*lint/);
    assert.ok(commands.at(-1).includes("lint"));
    assert.ok(!commands.some((args) => args.includes("test:e2e")));
  });
}
