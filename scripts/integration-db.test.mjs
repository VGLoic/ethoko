import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const exec = promisify(execFile);
const command = (action) =>
  exec("pnpm", [`test:integration:db:${action}`], { timeout: 60_000 });
const sql = (query) =>
  exec("docker", [
    "compose",
    "--project-name",
    "ethoko-integration",
    "-f",
    "compose.integration.yaml",
    "exec",
    "-T",
    "integration-db",
    "psql",
    "-U",
    "admin",
    "-d",
    "central",
    "-Atc",
    query,
  ]);

// Explicitly destructive: run only after coordinating with all shared-DB users.
test(
  "shared database is reusable, stop preserves data, and only clean deletes it",
  { timeout: 180_000 },
  async (t) => {
    await command("clean");
    t.after(() => command("clean"));
    await assert.rejects(
      command("status"),
      /not ready.*pnpm test:integration:db:start/s,
    );
    await assert.rejects(
      exec(
        "pnpm",
        ["--filter", "central", "test:integration", "--test", "queue_test"],
        { timeout: 10_000 },
      ),
      /pnpm test:integration:db:start/,
    );
    await assert.rejects(command("status"));
    await assert.rejects(
      exec("pnpm", ["validate:central"], { timeout: 10_000 }),
      /pnpm test:integration:db:start/,
    );
    await command("start");
    await command("start");
    assert.match((await command("status")).stdout, /ready/i);
    await sql(
      "CREATE TABLE lifecycle_probe (value text); INSERT INTO lifecycle_probe VALUES ('retained')",
    );
    await command("stop");
    await assert.rejects(command("status"));
    await command("start");
    assert.equal(
      (await sql("SELECT value FROM lifecycle_probe")).stdout.trim(),
      "retained",
    );

    const directory = await mkdtemp(join(tmpdir(), "ethoko-cargo-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const log = join(directory, "cargo.json");
    await writeFile(
      join(directory, "cargo"),
      `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.CARGO_LOG, JSON.stringify({ args: process.argv.slice(2), url: process.env.DATABASE_URL, tracing: process.env.CENTRAL_TEST_LOG }));
process.exit(Number(process.env.CARGO_EXIT || 0));
`,
      { mode: 0o755 },
    );
    const env = {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      CARGO_LOG: log,
      CENTRAL_TEST_LOG: "debug",
    };
    await exec(
      "pnpm",
      [
        "--filter",
        "central",
        "test:integration",
        "--test",
        "queue_test",
        "a_filter",
        "--",
        "--nocapture",
      ],
      { env },
    );
    assert.deepEqual(JSON.parse(await readFile(log, "utf8")), {
      args: [
        "test",
        "--quiet",
        "--test",
        "queue_test",
        "a_filter",
        "--",
        "--nocapture",
      ],
      url: "postgresql://admin:admin@localhost:5433/central",
      tracing: "debug",
    });
    await exec("pnpm", ["test:integration"], { env });
    assert.deepEqual(JSON.parse(await readFile(log, "utf8")).args, [
      "test",
      "--quiet",
      "--tests",
    ]);
    await assert.rejects(
      exec(
        "pnpm",
        ["--filter", "central", "test:integration", "--test=queue_test"],
        { env: { ...env, CARGO_EXIT: "23" } },
      ),
      (error) => error.code !== 0,
    );
    assert.deepEqual(JSON.parse(await readFile(log, "utf8")).args, [
      "test",
      "--quiet",
      "--test=queue_test",
    ]);
    assert.match((await command("status")).stdout, /ready/i);
    assert.equal(
      (await sql("SELECT value FROM lifecycle_probe")).stdout.trim(),
      "retained",
    );

    // Exercise the real SQLx-managed test databases, not the Cargo stand-in.
    const concurrent = await Promise.allSettled(
      [1, 2].map(() =>
        exec(
          "pnpm",
          [
            "--filter",
            "central",
            "test:integration",
            "--test",
            "queue_test",
            "test_psql_process_timeout",
          ],
          { timeout: 120_000 },
        ),
      ),
    );
    for (const result of concurrent) {
      assert.equal(result.status, "fulfilled", result.reason?.stdout);
      assert.match(result.value.stdout, /2 passed; 0 failed/);
    }
    assert.match((await command("status")).stdout, /ready/i);

    await command("clean");
    await command("start");
    assert.equal(
      (
        await sql("SELECT to_regclass('public.lifecycle_probe') IS NULL")
      ).stdout.trim(),
      "t",
    );
  },
);
