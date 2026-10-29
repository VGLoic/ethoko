import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  readFile,
  readdir,
  mkdtemp,
  mkdir,
  copyFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const exec = promisify(execFile);
const command = (name, options = {}) =>
  exec("pnpm", [`playground:${name}`], { timeout: 240_000, ...options });
const status = async () => {
  const { stdout } = await command("status");
  return JSON.parse(stdout.slice(stdout.indexOf("{")));
};
async function waitForCapturedEmail(directory, recipient) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const files = await readdir(directory).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const file of files.filter((name) => name.endsWith(".json"))) {
      const capture = JSON.parse(await readFile(join(directory, file), "utf8"));
      if (capture.recipient === recipient) return capture;
    }
    await sleep(250);
  }
  assert.fail(
    "normal PostgreSQL queue/worker delivers the email within 30 seconds",
  );
}

test("clean discards stopped local output and tolerates absent targets", async () => {
  assert.equal((await status()).state, "stopped");
  const base = join(process.cwd(), ".central-playground");
  const unrelated = await mkdtemp(
    join(tmpdir(), "playground-clean-unrelated-"),
  );
  const volume = `playground-clean-unrelated-${randomUUID()}`;
  try {
    await exec("docker", ["volume", "create", volume]);
    await writeFile(join(unrelated, "keep.txt"), "unrelated");
    for (const file of [
      "runs/historical/api.log",
      "runs/historical/emails/message.json",
      "runs/historical/environment.json",
      "browser/profile/cookies",
      "browser/evidence/screenshot.png",
      "browser/evidence/snapshot.yml",
    ]) {
      await mkdir(join(base, file, ".."), { recursive: true });
      await writeFile(join(base, file), "generated output");
    }
    const result = await command("clean");
    assert.match(result.stdout, /cleaned.*stopped/i);
    await assert.rejects(readdir(base), { code: "ENOENT" });
    await command("clean");
    assert.equal((await status()).state, "stopped");
    await assert.rejects(readdir(base), { code: "ENOENT" });
    assert.equal(
      await readFile(join(unrelated, "keep.txt"), "utf8"),
      "unrelated",
    );
    await exec("docker", ["volume", "inspect", volume]);
    await readFile("scripts/central-playground-browser.json");
  } finally {
    await exec("docker", ["volume", "rm", volume]);
    await rm(unrelated, { recursive: true });
  }
});

test("clean retains unresolved lifecycle files and refuses an unrecognized volume", async () => {
  const active = join(process.cwd(), ".central-playground/active");
  await mkdir(active, { recursive: true });
  try {
    await assert.rejects(command("clean"), /must already be stopped/);
    assert.deepEqual(await readdir(active), []);
    await writeFile(join(active, "resources.json.tmp"), "interrupted JSON");
    await assert.rejects(command("clean"), /JSON/);
    assert.equal(
      await readFile(join(active, "resources.json.tmp"), "utf8"),
      "interrupted JSON",
    );
  } finally {
    await rm(active, { recursive: true });
  }
  const volume = "ethoko-central-playground-data";
  await assert.rejects(
    exec("docker", ["volume", "inspect", volume]),
    /no such volume/i,
  );
  await exec("docker", ["volume", "create", volume]);
  try {
    await assert.rejects(command("clean"), /unrecognized database volume/);
    await exec("docker", ["volume", "inspect", volume]);
    // A failed clean must release its own reservation, not block future use.
    await assert.rejects(
      exec("docker", ["inspect", "ethoko-central-playground-reservation"]),
      /No such object/i,
    );
  } finally {
    await exec("docker", ["volume", "rm", volume]);
  }
});

test(
  "stop closes only the dedicated playground browser, even without applications",
  { timeout: 60_000 },
  async () => {
    const unrelated = await chromium.launch({ headless: true });
    let playground;
    let wrapper;
    try {
      const config = JSON.parse(
        await readFile("scripts/central-playground-browser.json", "utf8"),
      );
      wrapper = spawn(
        process.execPath,
        [
          "-e",
          "setInterval(() => {}, 1000)",
          "--",
          `--user-data-dir=${join(process.cwd(), config.browser.userDataDir)}`,
          "--remote-debugging-pipe",
        ],
        { stdio: "ignore" },
      );
      playground = await chromium.launchPersistentContext(
        config.browser.userDataDir,
        config.browser.launchOptions,
      );
      const page = await unrelated.newPage();
      await page.goto("data:text/html,<h1>Unrelated browser</h1>");
      const before = await status();
      assert.equal(before.state, "stopped");
      assert.equal(before.browser.processes.length, 1);
      assert.ok(
        before.browser.profileDirectory.startsWith(
          `${process.cwd()}/.central-playground/`,
        ),
      );
      await assert.rejects(command("clean"), /must already be stopped/);
      assert.equal((await status()).browser.processes.length, 1);
      await readdir(before.browser.profileDirectory);
      await command("stop");
      assert.deepEqual((await status()).browser.processes, []);
      for (const processInfo of before.browser.processes)
        assert.throws(() => process.kill(processInfo.pid, 0));
      assert.equal(unrelated.isConnected(), true);
      assert.equal(await page.textContent("h1"), "Unrelated browser");
      assert.equal(process.kill(wrapper.pid, 0), true);
      await command("stop");
    } finally {
      wrapper?.kill();
      await playground?.close();
      await unrelated.close();
      await command("stop");
    }
  },
);

test(
  "bounded exploration cleans up after success and handled interruption, but explicit handoff stays usable",
  { timeout: 300_000 },
  async () => {
    const config = JSON.parse(
      await readFile("scripts/central-playground-browser.json", "utf8"),
    );
    const unrelated = await chromium.launch({ headless: true });
    const page = await unrelated.newPage();
    await page.goto("data:text/html,<h1>Unrelated browser</h1>");
    const assertStopped = async (before) => {
      const after = await status();
      assert.equal(after.state, "stopped");
      assert.deepEqual(after.browser.processes, []);
      for (const resource of [...before.processes, ...before.browser.processes])
        assert.throws(() => process.kill(resource.pid, 0));
      for (const id of before.containers)
        await assert.rejects(exec("docker", ["inspect", id]));
      assert.equal(await page.textContent("h1"), "Unrelated browser");
    };
    let browser;
    let runner;
    const begin = async (handoff = false) => {
      runner = spawn(
        process.execPath,
        [
          "scripts/central-playground.mjs",
          "explore",
          ...(handoff ? ["--handoff"] : []),
          "--",
          process.execPath,
          "--input-type=module",
          "-e",
          `import { spawn } from 'node:child_process';
         const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'});
         console.log('EXPLORING ' + process.pid + ' ' + child.pid);
         process.on('SIGUSR1', () => process.exit(0));
         setInterval(() => {}, 1000);`,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      const finished = once(runner, "exit");
      let output = "";
      runner.stdout.on("data", (data) => {
        output += data;
      });
      runner.stderr.on("data", (data) => {
        output += data;
      });
      const deadline = Date.now() + 180_000;
      while (!/EXPLORING \d+ \d+/.test(output)) {
        assert.ok(Date.now() < deadline && runner.exitCode === null, output);
        await sleep(100);
      }
      const [, pid, child] = output.match(/EXPLORING (\d+) (\d+)/);
      browser = await chromium.launchPersistentContext(
        config.browser.userDataDir,
        config.browser.launchOptions,
      );
      await browser.newPage();
      return {
        finished,
        pid: Number(pid),
        child: Number(child),
        before: await status(),
        output: () => output,
      };
    };
    try {
      // A normal bounded command returns; cleanup must happen without a stop call.
      const normal = await begin();
      process.kill(normal.pid, "SIGUSR1");
      assert.deepEqual(await normal.finished, [0, null]);
      await assertStopped(normal.before);
      assert.throws(() => process.kill(normal.child, 0));
      await browser.close();

      const interrupted = await begin(true);
      runner.kill("SIGTERM");
      await interrupted.finished;
      await assertStopped(interrupted.before);
      assert.throws(() => process.kill(interrupted.child, 0));
      await browser.close();

      const finalizing = await begin(true);
      const browserPid = finalizing.before.browser.processes[0].pid;
      process.kill(browserPid, "SIGSTOP");
      try {
        process.kill(finalizing.pid, "SIGUSR1");
        const deadline = Date.now() + 10_000;
        while (!finalizing.output().includes("preparing human handoff")) {
          assert.ok(Date.now() < deadline, finalizing.output());
          await sleep(50);
        }
        runner.kill("SIGTERM");
      } finally {
        process.kill(browserPid, "SIGCONT");
      }
      assert.deepEqual(await finalizing.finished, [143, null]);
      await assertStopped(finalizing.before);
      await browser.close();

      const handoff = await begin(true);
      process.kill(handoff.pid, "SIGUSR1");
      assert.deepEqual(await handoff.finished, [0, null]);
      const handedOff = await status();
      assert.equal(handedOff.state, "running");
      assert.deepEqual(handedOff.browser.processes, []);
      assert.equal((await fetch(`${handedOff.urls.ui}/login`)).status, 200);
      assert.throws(() => process.kill(handoff.child, 0));
      await command("stop");
      await assertStopped(handoff.before);

      const crashed = await begin();
      runner.kill("SIGKILL");
      await crashed.finished;
      const leftovers = await status();
      assert.ok(leftovers.processes.some((p) => p.pid === crashed.child));
      await command("stop");
      await assertStopped(crashed.before);

      await assert.rejects(
        exec(
          "pnpm",
          [
            "playground:explore",
            "--handoff",
            "--",
            process.execPath,
            "-e",
            "process.exit(7)",
          ],
          { timeout: 180_000 },
        ),
      );
      assert.equal((await status()).state, "stopped");

      await command("start");
      const existing = await status();
      const containers = JSON.parse(
        (await exec("docker", ["inspect", ...existing.containers])).stdout,
      );
      const database = containers.find((container) => container.State.Running);
      await exec("docker", ["stop", database.Id]);
      assert.equal((await status()).state, "degraded");
      await assert.rejects(
        exec(
          "pnpm",
          [
            "playground:explore",
            "--",
            process.execPath,
            "-e",
            "process.exit(0)",
          ],
          { timeout: 180_000 },
        ),
        /already exists/,
      );
      const refused = await status();
      assert.equal(
        refused.state,
        "degraded",
        "refused exploration preserves the pre-existing instance for inspection",
      );
      for (const resource of existing.processes)
        assert.equal(process.kill(resource.pid, 0), true);
      await command("stop");
      await assert.rejects(
        exec(
          "pnpm",
          [
            "playground:explore",
            "--",
            "ethoko-nonexistent-exploration-command",
          ],
          { timeout: 180_000 },
        ),
        /ENOENT/,
      );
      assert.equal((await status()).state, "stopped");
    } finally {
      if (runner && runner.exitCode === null && runner.signalCode === null) {
        const finished = once(runner, "exit");
        runner.kill("SIGTERM");
        await finished;
      }
      await browser?.close();
      await command("stop");
      await unrelated.close();
    }
  },
);

test(
  "public commands deliver verification email through the worker, authenticate and stop their resources",
  { timeout: 300_000 },
  async () => {
    assert.equal(
      (await status()).state,
      "stopped",
      "Stop the playground before testing",
    );
    try {
      await command("start");
      let running = await status();
      assert.equal(running.state, "running");
      assert.equal(running.checkout, process.cwd());
      for (const path of [
        running.resourceRecord,
        running.configuration,
        ...Object.values(running.logs),
      ]) {
        assert.ok(path.startsWith(`${process.cwd()}/.central-playground/`));
      }
      assert.ok(running.processes.length >= 2);
      assert.ok(running.containers.length >= 1);
      assert.equal((await fetch(`${running.urls.api}/health`)).status, 200);
      const page = await fetch(`${running.urls.ui}/login`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /Sign in/i);
      const login = await fetch(`${running.urls.ui}/login`, {
        method: "POST",
        body: new URLSearchParams({
          intent: "login-with-email",
          email: "nobody@playground.invalid",
          password: "NotARealPassword123!",
        }),
      });
      assert.equal(login.status, 200);
      assert.match(await login.text(), /Check your email and password/);

      let configuration = JSON.parse(
        await readFile(running.configuration, "utf8"),
      );
      assert.equal(configuration.CENTRAL_ENVIRONMENT, "development");
      assert.equal(configuration.CENTRAL_EMAIL_TRANSPORT, "local-capture");
      assert.equal(
        configuration.CENTRAL_EMAIL_CAPTURE_DIR,
        running.emailCaptureDirectory,
      );
      assert.equal(configuration.RESEND_API_KEY, "");
      const email = `playground+${randomUUID()}@example.com`;
      const password = "PlaygroundPassword123!";
      const request = async (path, body, token, expectedStatus = 200) => {
        // Respect the real API's rate limits; no test-only configuration.
        await sleep(2100);
        const response = await fetch(`${running.urls.api}${path}`, {
          method: body ? "POST" : "GET",
          headers: {
            Authorization: `Bearer ${configuration.CENTRAL_UI_BFF_SHARED_SECRET}`,
            "Content-Type": "application/json",
            ...(token
              ? { "X-Ethoko-User-Authorization": `Bearer ${token}` }
              : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        assert.equal(response.status, expectedStatus, `${path} succeeds`);
        return response.json();
      };
      await request("/auth/signup/email", { email, password }, undefined, 201);
      const message = await waitForCapturedEmail(
        running.emailCaptureDirectory,
        email,
      );
      const originalCaptureDirectory = running.emailCaptureDirectory;
      assert.equal(message.kind, "email-verification-code");
      const link = new URL(message.verification_url);
      assert.equal(link.origin, running.urls.ui);
      assert.equal(link.pathname, "/verify-email");
      assert.equal(link.searchParams.get("email"), email);
      await request(
        "/auth/verify-email",
        Object.fromEntries(link.searchParams),
      );
      const { token } = await request("/auth/login/email", { email, password });
      assert.ok(token.startsWith("etks_"), "API issues a User Session Token");
      const beforeRegistration = await request("/auth/me", undefined, token);
      assert.equal(beforeRegistration.email, email);
      assert.equal(beforeRegistration.emailVerified, true);
      assert.equal(
        beforeRegistration.handle_registration,
        null,
        "email verification does not register a handle",
      );
      const handle = `pg${randomUUID().replaceAll("-", "").slice(0, 16)}`;
      const registered = await request(
        "/auth/register-handle",
        { handle },
        token,
      );
      assert.deepEqual(registered.handle_registration, { handle });
      const me = await request("/auth/me", undefined, token);
      assert.deepEqual(me.handle_registration, { handle });
      assert.equal(me.emailVerified, true);
      await command("start");
      const reused = await status();
      assert.deepEqual(reused.processes, running.processes);
      assert.deepEqual(reused.containers, running.containers);
      assert.deepEqual(reused.urls, running.urls);
      await assert.rejects(command("clean"), /must already be stopped/);
      assert.deepEqual((await status()).processes, running.processes);
      const other = await mkdtemp(
        join(tmpdir(), "central-playground-checkout-"),
      );
      try {
        await mkdir(join(other, "scripts"));
        await copyFile(
          "scripts/central-playground.mjs",
          join(other, "scripts/central-playground.mjs"),
        );
        await copyFile(
          "scripts/central-playground-browser.json",
          join(other, "scripts/central-playground-browser.json"),
        );
        await assert.rejects(
          exec(process.execPath, [
            join(other, "scripts/central-playground.mjs"),
            "start",
          ]),
          (error) => {
            assert.ok(
              error.stderr.includes(process.cwd()),
              "reports the originating checkout",
            );
            assert.match(error.stderr, /pnpm playground:stop/);
            return true;
          },
        );
        await assert.rejects(
          exec(process.execPath, [
            join(other, "scripts/central-playground.mjs"),
            "clean",
          ]),
          /existing playground is reserved/,
        );
        await exec("docker", ["volume", "inspect", running.dataVolume]);
        assert.deepEqual((await status()).processes, running.processes);
      } finally {
        await rm(other, { recursive: true });
      }
      await command("stop");
      await command("start");
      running = await status();
      configuration = JSON.parse(await readFile(running.configuration, "utf8"));
      const resumed = await request("/auth/login/email", { email, password });
      const persisted = await request("/auth/me", undefined, resumed.token);
      assert.deepEqual(persisted.handle_registration, { handle });
      assert.equal(persisted.emailVerified, true);
      const oldCapture = message;
      const preservedEmails = running.emailCaptureDirectory;
      const preservedLogs = Object.values(running.logs);
      await command("reset");
      running = await status();
      assert.equal(running.state, "running");
      assert.notEqual(running.emailCaptureDirectory, preservedEmails);
      for (const log of preservedLogs) assert.ok((await readFile(log)).length);
      const historicalCaptures = await Promise.all(
        (await readdir(originalCaptureDirectory))
          .filter((name) => name.endsWith(".json"))
          .map(async (name) =>
            JSON.parse(
              await readFile(join(originalCaptureDirectory, name), "utf8"),
            ),
          ),
      );
      assert.ok(
        historicalCaptures.some(
          (capture) => capture.verification_url === oldCapture.verification_url,
        ),
      );
      configuration = JSON.parse(await readFile(running.configuration, "utf8"));
      await request("/auth/login/email", { email, password }, undefined, 422);
      await request("/auth/signup/email", { email, password }, undefined, 201);
      const freshMessage = await waitForCapturedEmail(
        running.emailCaptureDirectory,
        email,
      );
      assert.notEqual(
        freshMessage.verification_url,
        oldCapture.verification_url,
      );
      await request(
        "/auth/verify-email",
        Object.fromEntries(new URL(freshMessage.verification_url).searchParams),
      );
      const freshLogin = await request("/auth/login/email", {
        email,
        password,
      });
      assert.equal(
        (await request("/auth/me", undefined, freshLogin.token))
          .handle_registration,
        null,
      );
      await command("stop");
      assert.equal((await status()).state, "stopped");
      for (const url of Object.values(running.urls)) {
        await assert.rejects(fetch(url, { signal: AbortSignal.timeout(2000) }));
      }
      for (const resource of running.processes) {
        assert.throws(() => process.kill(resource.pid, 0));
      }
      for (const id of running.containers) {
        await assert.rejects(exec("docker", ["inspect", id]));
      }
      await command("stop");
      await command("clean");
      await assert.rejects(
        exec("docker", ["volume", "inspect", running.dataVolume]),
        /no such volume/i,
      );
      await assert.rejects(readdir(".central-playground"), { code: "ENOENT" });
      assert.equal((await status()).state, "stopped");
      await command("start");
      running = await status();
      assert.equal(running.state, "running");
      configuration = JSON.parse(await readFile(running.configuration, "utf8"));
      await request("/auth/login/email", { email, password }, undefined, 422);
      await request("/auth/signup/email", { email, password }, undefined, 201);
      await waitForCapturedEmail(running.emailCaptureDirectory, email);
      await command("stop");
    } finally {
      await command("stop");
    }
  },
);

test(
  "failed application startup reports its stage and removes its resources",
  { timeout: 300_000 },
  async () => {
    const occupied = createServer((_request, response) => {
      response.end("An unrelated HTTP service");
    });
    occupied.listen(0, "127.0.0.1");
    await once(occupied, "listening");
    try {
      await assert.rejects(
        command("start", {
          env: {
            ...process.env,
            CENTRAL_PLAYGROUND_UI_PORT: String(occupied.address().port),
          },
        }),
        /startup failed at UI\/BFF readiness/,
      );
      assert.equal((await status()).state, "stopped");
      const { stdout } = await exec("docker", [
        "ps",
        "-aq",
        "--filter",
        "label=com.docker.compose.project=ethoko-central-playground",
      ]);
      assert.equal(stdout.trim(), "");
      assert.equal(
        occupied.listening,
        true,
        "An unrelated listener is preserved",
      );
    } finally {
      occupied.close();
      await command("stop");
    }
  },
);

test(
  "hard launcher termination leaves identifiable partial resources for explicit stop",
  { timeout: 300_000 },
  async () => {
    const unrelated = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore" },
    );
    const child = spawn(
      process.execPath,
      ["scripts/central-playground.mjs", "start"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const finished = once(child, "exit");
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    try {
      const deadline = Date.now() + 120_000;
      while (!output.includes("UI/BFF readiness")) {
        assert.ok(Date.now() < deadline && child.exitCode === null, output);
        await sleep(20);
      }
      child.kill("SIGKILL");
      await finished;
      const partial = await status();
      assert.equal(partial.state, "degraded");
      assert.ok(partial.processes.length > 1);
      assert.ok(partial.containers.length);
      await assert.rejects(command("start"), /already exists/);
      // A missing database must not make status report the healthy HTTP
      // listeners as a healthy playground.
      const { stdout } = await exec("docker", [
        "ps",
        "-q",
        "--filter",
        "label=com.docker.compose.project=ethoko-central-playground",
      ]);
      for (const id of stdout.trim().split(/\s+/).filter(Boolean))
        await exec("docker", ["rm", "-f", id]);
      assert.equal((await status()).state, "degraded");
      await command("stop");
      await command("stop");
      assert.equal((await status()).state, "stopped");
      for (const resource of partial.processes)
        assert.throws(() => process.kill(resource.pid, 0));
      assert.equal(process.kill(unrelated.pid, 0), true);
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await command("stop");
      unrelated.kill();
    }
  },
);

test(
  "stop waits for orphaned Compose startup before removing its resources",
  { timeout: 300_000 },
  async () => {
    const child = spawn(
      process.execPath,
      ["scripts/central-playground.mjs", "start"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const finished = once(child, "exit");
    let output = "";
    let database;
    let operations = [];
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    try {
      const deadline = Date.now() + 120_000;
      while (!database) {
        assert.ok(Date.now() < deadline && child.exitCode === null, output);
        const { stdout } = await exec("docker", [
          "ps",
          "-q",
          "--filter",
          "label=com.docker.compose.project=ethoko-central-playground",
        ]);
        database = stdout.trim();
        if (!database) await sleep(20);
      }
      await exec("docker", ["pause", database]);
      const { stdout: processes } = await exec("ps", ["-axo", "pid=,command="]);
      operations = processes
        .split("\n")
        .filter((line) =>
          /docker.*compose.*ethoko-central-playground.* up -d --wait/.test(
            line,
          ),
        )
        .map((line) => Number(line.trim().split(/\s+/)[0]));
      assert.ok(operations.length);
      // Freeze the observable in-flight CLI to deterministically keep its
      // resource-creation window open across launcher termination.
      for (const pid of operations) process.kill(pid, "SIGSTOP");
      child.kill("SIGKILL");
      await finished;
      let stopped = false;
      const stopping = command("stop").then(() => {
        stopped = true;
      });
      try {
        await sleep(4000);
        assert.equal(
          stopped,
          false,
          "stop keeps tracking while Compose can still create resources",
        );
      } finally {
        for (const pid of operations) process.kill(pid, "SIGCONT");
        await exec("docker", ["unpause", database]);
        await stopping;
      }
      assert.equal((await status()).state, "stopped");
      await assert.rejects(exec("docker", ["inspect", database]));
      const { stdout } = await exec("docker", [
        "ps",
        "-aq",
        "--filter",
        "label=com.docker.compose.project=ethoko-central-playground",
      ]);
      assert.equal(stdout.trim(), "");
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      for (const pid of operations) {
        try {
          process.kill(pid, "SIGCONT");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
      if (database) await exec("docker", ["unpause", database]).catch(() => {});
      await command("stop");
    }
  },
);

test(
  "stop refuses an unidentifiable surviving process group rather than signalling it",
  { timeout: 300_000 },
  async () => {
    let group;
    try {
      await command("start");
      const running = await status();
      const keeper = running.processes.find(
        (p) => p.service === "ui" && p.pid === p.pgid,
      );
      group = keeper.pid;
      const children = running.processes.filter(
        (p) => p.pgid === group && p.pid !== group,
      );
      assert.ok(children.length);
      process.kill(keeper.pid, "SIGKILL");
      await sleep(250);
      assert.equal((await status()).state, "degraded");
      await assert.rejects(
        command("stop"),
        /Cannot safely identify ui process group/,
      );
      for (const child of children)
        assert.equal(process.kill(child.pid, 0), true);
      assert.equal((await fetch(`${running.urls.ui}/login`)).status, 200);
    } finally {
      // This test deliberately destroys the keeper. Only the test, which
      // observed the live group before doing so, can safely finish recovery.
      if (group) {
        try {
          process.kill(-group, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
        await sleep(500);
      }
      await command("stop");
    }
  },
);

test(
  "stop interrupts a reset launcher without racing its new resources",
  { timeout: 300_000 },
  async () => {
    await command("start");
    const child = spawn(
      process.execPath,
      ["scripts/central-playground.mjs", "reset"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const finished = once(child, "exit");
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    try {
      const deadline = Date.now() + 120_000;
      while (
        !output.includes("API migrations, queue/worker and HTTP readiness")
      ) {
        assert.ok(Date.now() < deadline && child.exitCode === null, output);
        await sleep(20);
      }
      assert.equal((await status()).state, "starting");
      await command("stop");
      await finished;
      assert.match(output, /Launcher interrupted/);
      assert.equal((await status()).state, "stopped");
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await command("stop");
    }
  },
);

test(
  "terminating the launcher cleans up resources already started",
  { timeout: 300_000 },
  async () => {
    const child = spawn("pnpm", ["playground:start"], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const finished = once(child, "exit");
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    try {
      const deadline = Date.now() + 120_000;
      while (
        !output.includes("API migrations, queue/worker and HTTP readiness")
      ) {
        assert.ok(Date.now() < deadline && child.exitCode === null, output);
        await sleep(100);
      }
      process.kill(-child.pid, "SIGTERM");
      await finished;
      // pnpm itself can exit before its launcher has finished handling TERM.
      for (let i = 0; i < 120 && (await status()).state !== "stopped"; i++)
        await sleep(500);
      assert.equal((await status()).state, "stopped");
      assert.match(output, /Launcher interrupted/);
      const { stdout } = await exec("docker", [
        "ps",
        "-aq",
        "--filter",
        "label=com.docker.compose.project=ethoko-central-playground",
      ]);
      assert.equal(stdout.trim(), "");
    } finally {
      await command("stop");
    }
  },
);
