import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const exec = promisify(execFile);
const command = (name, options = {}) =>
  exec("pnpm", [`playground:${name}`], { timeout: 240_000, ...options });
const status = async () => {
  const { stdout } = await command("status");
  return JSON.parse(stdout.slice(stdout.indexOf("{")));
};

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
      const running = await status();
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

      const configuration = JSON.parse(
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
      let message;
      const deadline = Date.now() + 30_000;
      while (!message && Date.now() < deadline) {
        let files = [];
        try {
          files = await readdir(running.emailCaptureDirectory);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        for (const file of files.filter((name) => name.endsWith(".json"))) {
          const capture = JSON.parse(
            await readFile(join(running.emailCaptureDirectory, file), "utf8"),
          );
          if (capture.recipient === email) message = capture;
        }
        if (!message) await sleep(250);
      }
      assert.ok(message, "normal PostgreSQL queue/worker delivers the email");
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
      const pending = await request("/auth/me", undefined, token);
      assert.equal(pending.email, email);
      assert.equal(pending.emailVerified, true);
      assert.equal(
        pending.state,
        "pending",
        "email verification does not register a handle",
      );
      const handle = `pg${randomUUID().replaceAll("-", "").slice(0, 16)}`;
      const registered = await request(
        "/auth/register-handle",
        { handle },
        token,
      );
      assert.equal(registered.state, "registered");
      assert.equal(registered.handle, handle);
      const me = await request("/auth/me", undefined, token);
      assert.equal(me.state, "registered");
      assert.equal(me.emailVerified, true);
      await assert.rejects(command("start"), /already exists/);
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
