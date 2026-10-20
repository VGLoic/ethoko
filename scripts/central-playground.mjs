import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
  rmdir,
  open,
  stat,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

const exec = promisify(execFile);
const script = fileURLToPath(import.meta.url);
const checkout = resolve(dirname(script), "..");
const base = join(checkout, ".central-playground");
const browserConfig = JSON.parse(
  await readFile(
    new URL("./central-playground-browser.json", import.meta.url),
    "utf8",
  ),
);
const browserProfile = resolve(checkout, browserConfig.browser.userDataDir);
const active = join(base, "active");
const recordPath = join(active, "resources.json");
const project = "ethoko-central-playground";
const reservationName = `${project}-reservation`;
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TEMP|TMP|LANG|LC_.*|CARGO_HOME|RUSTUP_HOME|RUSTUP_TOOLCHAIN|DOCKER_HOST|DOCKER_CONTEXT|DOCKER_CONFIG)$/.test(
      key,
    ),
  ),
);
const run = (cmd, args, options = {}) =>
  exec(cmd, args, { env: cleanEnv, timeout: 120_000, ...options });
const compose = (record, args) =>
  run("docker", ["compose", "-p", project, "-f", record.composeFile, ...args]);
const load = async () => {
  try {
    return JSON.parse(await readFile(recordPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      try {
        return JSON.parse(await readFile(`${recordPath}.tmp`, "utf8"));
      } catch (pendingError) {
        if (pendingError.code === "ENOENT") return null;
        throw new Error(
          `Cannot read interrupted resource record ${recordPath}.tmp: ${pendingError.message}`,
        );
      }
    }
    throw error;
  }
};
async function reservation(record) {
  try {
    const { stdout } = await run("docker", ["inspect", reservationName]);
    const container = JSON.parse(stdout)[0];
    return container.Config.Labels?.["ethoko.playground.run"] === record.token
      ? container.Id
      : null;
  } catch (error) {
    if (/no such object/i.test(error.stderr ?? "")) return null;
    throw error;
  }
}
async function releaseReservation(record) {
  const id = await reservation(record);
  if (id) await run("docker", ["rm", "-v", id]);
}
async function assertNoExistingReservation() {
  let container;
  try {
    const { stdout } = await run("docker", ["inspect", reservationName]);
    container = JSON.parse(stdout)[0];
  } catch (error) {
    if (/no such object/i.test(error.stderr ?? "")) return;
    throw error;
  }
  const location = container.Config.Labels?.["ethoko.playground.checkout"];
  throw new Error(
    `An existing playground is reserved at ${location ?? "an unknown checkout"}. Run pnpm playground:status and pnpm playground:stop from that checkout; this instance will not be replaced.`,
  );
}
async function save(record) {
  await writeFile(`${recordPath}.tmp`, JSON.stringify(record, null, 2), {
    mode: 0o600,
  });
  await rename(`${recordPath}.tmp`, recordPath);
}
async function processTable() {
  const { stdout } = await run("ps", ["-axo", "pid=,pgid=,lstart=,command="]);
  return stdout
    .trim()
    .split("\n")
    .map((line) => {
      const [, pid, pgid, started, command] = line.match(
        /^\s*(\d+)\s+(\d+)\s+(.{24})\s+(.*)$/,
      );
      return { pid: Number(pid), pgid: Number(pgid), started, command };
    });
}
async function inspectBrowser(table) {
  const candidates = table.filter(
    (p) =>
      ` ${p.command} `.includes(` --user-data-dir=${browserProfile} `) &&
      p.command.includes(" --remote-debugging-pipe") &&
      !p.command.includes(" --type="),
  );
  const processes = [];
  for (const candidate of candidates) {
    try {
      // ps's executable identity is separate from the flattened arguments:
      // wrappers can carry all of Chromium's flags without being a browser.
      const { stdout } = await run("ps", [
        "-p",
        String(candidate.pid),
        "-o",
        "comm=",
      ]);
      if (
        ["chrome", "Chromium", "Google Chrome for Testing"].includes(
          basename(stdout.trim()),
        )
      )
        processes.push(candidate);
    } catch (error) {
      if (error.code !== 1) throw error; // The process may have just exited.
    }
  }
  return {
    profileDirectory: browserProfile,
    evidenceDirectory: resolve(checkout, browserConfig.outputDir),
    processes,
  };
}
async function closeBrowser() {
  const browsers = (await inspectBrowser(await processTable())).processes;
  for (const browser of browsers) {
    // Revalidate the live command and start time, never trust a saved PID or
    // signal the MCP/OpenCode process group. Chromium closes its own children.
    const current = (await processTable()).find((p) => p.pid === browser.pid);
    if (
      current?.started === browser.started &&
      current.command === browser.command
    ) {
      try {
        process.kill(browser.pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  }
  const deadline = Date.now() + 10_000;
  while ((await inspectBrowser(await processTable())).processes.length) {
    if (Date.now() >= deadline)
      throw new Error(
        "Playground browser did not close; use the playground MCP browser_close tool and retry stop. Application resource record retained.",
      );
    await sleep(100);
  }
}
function keeperIn(table, resource, token) {
  return table.some(
    (p) =>
      p.pid === resource.pid &&
      p.pgid === resource.pid &&
      p.command.includes(`_service ${token} ${resource.name} `),
  );
}
function launcherIn(table, record) {
  return table.some(
    (p) =>
      p.pid === record.launcher &&
      (record.launcherIdentity
        ? p.started === record.launcherIdentity.started &&
          p.command === record.launcherIdentity.command
        : p.command.includes(script) && / (start|reset)$/.test(p.command)),
  );
}
function servicesIn(record, table) {
  const services = [...record.services];
  // A hard crash can land between spawn and saving the keeper PID. The
  // token-bearing command line identifies that keeper without trusting a PID.
  for (const name of ["api", "ui", "exploration"]) {
    for (const p of table) {
      if (
        p.pid === p.pgid &&
        p.command.includes(
          `${script} _service ${record.token} ${name} ${record.configFile} `,
        ) &&
        !services.some((s) => s.pid === p.pid)
      )
        services.push({ name, pid: p.pid });
    }
  }
  return services;
}
async function freePort(port = 0, host = "127.0.0.1") {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const selected = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return selected;
}
function configuredPort(key) {
  const value = process.env[key];
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) {
    throw new Error(`${key} must be a port between 1024 and 65535`);
  }
  return Number(value);
}
async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}
async function inspect(record) {
  const table = await processTable();
  const browser = await inspectBrowser(table);
  if (!record) {
    const directory = await stat(active).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    return directory
      ? {
          state: "degraded",
          checkout,
          resourceRecord: recordPath,
          browser,
          recovery:
            "Resource record missing; run pnpm playground:stop to remove an empty startup directory. Inspect any remaining files manually.",
        }
      : { state: "stopped", browser };
  }
  const services = servicesIn(record, table);
  const processes = services.flatMap((service) => {
    if (!keeperIn(table, service, record.token)) return [];
    return table
      .filter((p) => p.pgid === service.pid)
      .map((p) => ({ ...p, service: service.name }));
  });
  let containers = [];
  let databaseReady = false;
  let reserved = false;
  let containerInspectionError;
  try {
    const { stdout } = await compose(record, ["ps", "-aq"]);
    containers = stdout.trim().split(/\s+/).filter(Boolean);
    if (containers.length) {
      const inspected = await run("docker", ["inspect", ...containers]);
      databaseReady = JSON.parse(inspected.stdout).every(
        (container) =>
          container.Config.Labels?.["ethoko.playground.run"] === record.token &&
          container.State.Running &&
          container.State.Health?.Status === "healthy",
      );
    }
    const id = await reservation(record);
    reserved = Boolean(id);
    if (id) containers.push(id);
  } catch {
    containerInspectionError =
      "Container inspection unavailable; check Docker and the recorded Compose file";
  }
  const healthy =
    record.state === "running" &&
    (
      await Promise.all([
        reachable(`${record.urls.api}/health`),
        reachable(`${record.urls.ui}/login`),
      ])
    ).every(Boolean);
  return {
    state:
      record.state === "running" &&
      ["api", "ui"].every((name) => services.some((s) => s.name === name)) &&
      services.every((s) =>
        processes.some((p) => p.service === s.name && p.pid !== s.pid),
      ) &&
      containers.length &&
      databaseReady &&
      reserved &&
      healthy
        ? "running"
        : record.state === "starting" && launcherIn(table, record)
          ? "starting"
          : "degraded",
    checkout: record.checkout,
    stage: record.stage,
    processes,
    containers,
    containerInspectionError,
    urls: record.urls,
    logs: record.logs,
    emailCaptureDirectory: record.emailCaptureDirectory,
    launcher: record.state === "starting" ? record.launcher : null,
    resourceRecord: recordPath,
    configuration: record.configFile,
    browser,
    dataVolume: "ethoko-central-playground-data",
  };
}
async function cleanup(record) {
  // A hard-killed launcher can leave its Docker CLI child running. In
  // particular, Compose may still create containers after an initial snapshot.
  // Let identified resource-creating commands settle before taking that snapshot;
  // never release the reservation while one can still create resources.
  const deadline = Date.now() + 180_000;
  while (
    (await processTable()).some(
      (p) =>
        (p.command.includes(record.composeFile) &&
          p.command.includes(" up ")) ||
        (p.command.includes(`create --name ${reservationName} `) &&
          p.command.includes(`ethoko.playground.run=${record.token}`)),
    )
  ) {
    if (Date.now() >= deadline)
      throw new Error(
        "A playground Docker operation is still running; resource record retained. Restore Docker and retry stop.",
      );
    await sleep(250);
  }
  const table = await processTable();
  const services = servicesIn(record, table);
  for (const service of services) {
    if (
      !keeperIn(table, service, record.token) &&
      table.some((p) => p.pgid === service.pid)
    ) {
      throw new Error(
        `Cannot safely identify ${service.name} process group ${service.pid}; resource record retained for manual inspection`,
      );
    }
  }
  const owned = services.filter((s) => keeperIn(table, s, record.token));
  for (const service of owned) process.kill(-service.pid, "SIGTERM");
  await sleep(2000);
  const remaining = await processTable();
  for (const service of owned) {
    if (keeperIn(remaining, service, record.token))
      process.kill(-service.pid, "SIGKILL");
  }
  // Stop exploration execution before the browser: otherwise an in-flight tool
  // can relaunch Chromium while explicit stop is cleaning up after a hard crash.
  await closeBrowser();
  // Keepers intentionally remain alive through TERM so group identity can be
  // checked before escalation, even if pnpm or the application exits first.
  // Select immutable IDs by this run's label, never by the shared project name.
  const { stdout: ids } = await run("docker", [
    "ps",
    "-aq",
    "--filter",
    `label=ethoko.playground.run=${record.token}`,
  ]);
  const reserved = await reservation(record);
  for (const id of ids.trim().split(/\s+/).filter(Boolean)) {
    if (reserved?.startsWith(id)) continue;
    await run("docker", ["rm", "-f", "-v", id]);
  }
  const { stdout: networks } = await run("docker", [
    "network",
    "ls",
    "-q",
    "--filter",
    `label=ethoko.playground.run=${record.token}`,
  ]);
  for (const id of networks.trim().split(/\s+/).filter(Boolean)) {
    await run("docker", ["network", "rm", id]);
  }
  await releaseReservation(record);
  await writeFile(
    join(dirname(record.composeFile), "stopped.json"),
    JSON.stringify(record, null, 2),
    { mode: 0o600 },
  );
  await unlink(`${recordPath}.tmp`).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  await unlink(recordPath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  await rmdir(active);
}
async function start(reset = false) {
  await mkdir(base, { recursive: true, mode: 0o700 });
  try {
    await mkdir(active, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const report = await inspect(await load());
    if (report.state === "running") {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    throw new Error(
      `A playground resource record already exists at ${active}. Use pnpm playground:status and pnpm playground:stop; it will not be overwritten.`,
    );
  }
  const token = randomUUID();
  const directory = join(base, "runs", token);
  const record = {
    token,
    checkout,
    state: "starting",
    stage: "configuration",
    services: [],
    launcher: process.pid,
    composeFile: join(directory, "compose.json"),
    configFile: join(directory, "environment.json"),
    emailCaptureDirectory: join(directory, "emails"),
    urls: {},
    logs: {
      api: join(directory, "api.log"),
      worker: join(directory, "api.log"),
      ui: join(directory, "ui.log"),
    },
  };
  let interrupted = false;
  let reservationAttempted = false;
  const interrupt = () => {
    interrupted = true;
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  const check = () => {
    if (interrupted) throw new Error("Launcher interrupted");
  };
  const stage = async (name) => {
    check();
    record.stage = name;
    await save(record);
    console.log(`Playground: ${name}`);
  };
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    record.launcherIdentity = (await processTable()).find(
      (p) => p.pid === process.pid,
    );
    await save(record);
    await stage("prerequisites");
    if (process.platform === "win32")
      throw new Error("POSIX process groups require macOS or Linux");
    await run("docker", ["info"]);
    await run("docker", ["compose", "version"]);
    await assertNoExistingReservation();
    const existing = await run("docker", [
      "ps",
      "-aq",
      "--filter",
      `label=com.docker.compose.project=${project}`,
    ]);
    if (existing.stdout.trim()) {
      throw new Error(
        "A playground Docker stack already exists. Stop it from its originating checkout before starting here.",
      );
    }
    // Docker atomically reserves this name across checkouts, while every file
    // remains checkout-local. Never remove a reservation with another run token.
    reservationAttempted = true;
    await run("docker", [
      "create",
      "--name",
      reservationName,
      "--label",
      `ethoko.playground.run=${token}`,
      "--label",
      `ethoko.playground.checkout=${checkout}`,
      "postgres:18",
      "true",
    ]);
    // Hold the machine-wide reservation before deleting data, so another
    // checkout cannot start using the volume during reset.
    if (reset) await resetData();
    await run("pnpm", ["--version"]);
    await run("cargo", ["--version"]);
    const apiPort =
      configuredPort("CENTRAL_PLAYGROUND_API_PORT") ?? (await freePort());
    let uiPort =
      configuredPort("CENTRAL_PLAYGROUND_UI_PORT") ?? (await freePort());
    if (uiPort === apiPort && process.env.CENTRAL_PLAYGROUND_UI_PORT)
      throw new Error("UI and API ports must differ");
    while (uiPort === apiPort) uiPort = await freePort();
    record.urls = {
      ui: `http://127.0.0.1:${uiPort}`,
      api: `http://127.0.0.1:${apiPort}`,
    };
    await writeFile(
      record.composeFile,
      JSON.stringify(
        {
          services: {
            db: {
              image: "postgres:18",
              labels: {
                "ethoko.playground.run": token,
                "ethoko.playground.checkout": checkout,
              },
              environment: {
                POSTGRES_USER: "playground",
                POSTGRES_PASSWORD: "playground-local-only",
                POSTGRES_DB: "central",
              },
              ports: [{ target: 5432, published: "0", host_ip: "127.0.0.1" }],
              volumes: ["data:/var/lib/postgresql"],
              healthcheck: {
                test: ["CMD-SHELL", "pg_isready -U playground -d central"],
                interval: "1s",
                timeout: "5s",
                retries: 60,
              },
            },
          },
          volumes: { data: { name: "ethoko-central-playground-data" } },
          networks: { default: { labels: { "ethoko.playground.run": token } } },
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await stage("PostgreSQL readiness");
    await compose(record, ["up", "-d", "--wait", "--wait-timeout", "90"]);
    const { stdout } = await compose(record, ["port", "db", "5432"]);
    const dbPort = stdout.trim().split(":").at(-1);
    const secret = randomBytes(32).toString("hex");
    const environment = {
      SELF_URL: record.urls.api,
      WEB_APP_URL: record.urls.ui,
      PORT: String(apiPort),
      DATABASE_URL: `postgresql://playground:playground-local-only@127.0.0.1:${dbPort}/central`,
      CENTRAL_ENVIRONMENT: "development",
      CENTRAL_EMAIL_TRANSPORT: "local-capture",
      CENTRAL_EMAIL_CAPTURE_DIR: record.emailCaptureDirectory,
      RESEND_API_KEY: "",
      LOG_LEVEL: "INFO",
      CENTRAL_UI_BFF_SHARED_SECRET: secret,
      ETHOKO_CENTRAL_URL: record.urls.api,
      SESSION_SECRET: randomBytes(32).toString("hex"),
      GITHUB_OAUTH_CLIENT_ID: "playground-non-live",
      GITHUB_OAUTH_CLIENT_SECRET: "playground-non-live",
      GITHUB_OAUTH_CALLBACK_URL: `${record.urls.ui}/auth/github/callback`,
      GITHUB_OAUTH_AUTH_URL: "http://127.0.0.1:1/github-unavailable",
      GITHUB_OAUTH_AUTH_TOKEN_URL: "http://127.0.0.1:1/github-unavailable",
      GITHUB_API_URL: "http://127.0.0.1:1/github-unavailable",
      OAUTH_TRANSACTION_TTL_SECONDS: "600",
    };
    await writeFile(record.configFile, JSON.stringify(environment, null, 2), {
      mode: 0o600,
    });
    async function application(name, args) {
      const log = await open(record.logs[name], "a", 0o600);
      const child = spawn(
        process.execPath,
        [script, "_service", token, name, record.configFile, ...args],
        { detached: true, env: cleanEnv, stdio: ["ignore", log.fd, log.fd] },
      );
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      record.services.push({ name, pid: child.pid });
      child.unref();
      await log.close();
      await save(record);
    }
    async function readiness(url, name) {
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        await sleep(500);
        check();
        const table = await processTable();
        const keeper = record.services.find((s) => s.name === name);
        const hasChildren = table.some(
          (p) => p.pgid === keeper.pid && p.pid !== keeper.pid,
        );
        if (Date.now() > deadline - 175_000 && !hasChildren) {
          throw new Error(
            `${name} exited before readiness; see ${record.logs[name]}`,
          );
        }
        if (hasChildren && (await reachable(url))) return;
      }
      throw new Error(
        `Readiness timed out for ${url}; see ${record.logs[name]}`,
      );
    }
    await stage("API migrations, queue/worker and HTTP readiness");
    await freePort(apiPort, "0.0.0.0");
    await application("api", ["--filter", "central", "dev"]);
    await readiness(`${record.urls.api}/health`, "api");
    await stage("UI/BFF readiness");
    await freePort(uiPort);
    await application("ui", [
      "--filter",
      "central-ui",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(uiPort),
      "--strictPort",
    ]);
    await readiness(`${record.urls.ui}/login`, "ui");
    check();
    record.state = "running";
    record.stage = "ready";
    await save(record);
    const report = await inspect(record);
    check();
    if (report.state !== "running")
      throw new Error("Applications lost readiness before startup completed");
    console.log(JSON.stringify(report, null, 2));
    console.log(
      "Local email delivery enabled; capture directory is reported above. GitHub flows are not supported. Stop with pnpm playground:stop.",
    );
  } catch (error) {
    console.error(
      `Playground startup failed at ${record.stage}: ${error.message}`,
    );
    // A prerequisite/configuration failure may precede creation of the Compose file.
    try {
      await readFile(record.composeFile);
      await cleanup(record);
    } catch (cleanupError) {
      if (cleanupError.code === "ENOENT" && record.services.length === 0) {
        if (reservationAttempted) await releaseReservation(record);
        await unlink(recordPath).catch(() => {});
        await rmdir(active);
      } else {
        console.error(
          `Cleanup incomplete; resource record retained: ${cleanupError.message}`,
        );
      }
    }
    throw error;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}

async function service() {
  const [, , , , name, configFile, ...args] = process.argv;
  // This group leader must outlive pnpm and its descendants, including when
  // signalled. Explicit stop verifies this token-bearing keeper before killing.
  process.on("SIGTERM", () => {});
  process.on("SIGINT", () => {});
  setInterval(() => {}, 60_000);
  const environment = JSON.parse(await readFile(configFile, "utf8"));
  const child = spawn(
    name === "exploration" ? args[0] : "pnpm",
    name === "exploration" ? args.slice(1) : args,
    {
      cwd: checkout,
      env:
        name === "exploration" ? process.env : { ...cleanEnv, ...environment },
      stdio: "inherit",
    },
  );
  child.on("error", (error) => {
    if (process.connected) process.send({ error: error.message });
    else console.error(`${name} launch failed: ${error.message}`);
  });
  child.on("exit", (code, signal) => {
    if (process.connected) process.send({ code, signal });
    else console.error(`${name} dev command exited (${code ?? signal})`);
  });
}

async function explore() {
  const args = process.argv.slice(3);
  const handoff = args[0] === "--handoff";
  if (handoff) args.shift();
  if (args.shift() !== "--" || !args.length)
    throw new Error(
      "Usage: pnpm playground:explore [--handoff] -- <command> [args...]",
    );
  let interrupted;
  let wake;
  let child;
  let record;
  const interruption = new Promise((resolve) => {
    wake = resolve;
  });
  const interrupt = (signal) => {
    interrupted = signal;
    wake({ signal });
  };
  const onInt = () => interrupt("SIGINT");
  const onTerm = () => interrupt("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  let successful = false;
  try {
    await start();
    if (interrupted) throw new Error("Exploration interrupted during startup");
    record = await load();
    child = spawn(
      process.execPath,
      [
        script,
        "_service",
        record.token,
        "exploration",
        record.configFile,
        ...args,
      ],
      {
        cwd: checkout,
        detached: true,
        stdio: ["inherit", "inherit", "inherit", "ipc"],
      },
    );
    const completed = new Promise((resolve, reject) => {
      child.once("message", resolve);
      child.once("error", reject);
      child.once("exit", () =>
        reject(new Error("Exploration command keeper exited unexpectedly")),
      );
    });
    // Startup/IPC failure can arrive while the resource record is being saved.
    // Observe rejection immediately; the await below still reports it normally.
    completed.catch(() => {});
    record.services.push({ name: "exploration", pid: child.pid });
    await save(record);
    const result = await Promise.race([completed, interruption]);
    if (result.error) throw new Error(result.error);
    successful = !interrupted && result.code === 0;
    process.exitCode =
      interrupted === "SIGINT" ? 130 : interrupted ? 143 : (result.code ?? 1);
  } finally {
    try {
      if (child?.pid) {
        const keeper = keeperIn(
          await processTable(),
          { pid: child.pid, name: "exploration" },
          record.token,
        );
        if (keeper) {
          process.kill(-child.pid, "SIGTERM");
          await sleep(500);
          process.kill(-child.pid, "SIGKILL");
          await new Promise((resolve) => {
            if (child.signalCode || child.exitCode !== null) resolve();
            else child.once("exit", resolve);
          });
          record.services = record.services.filter((s) => s.pid !== child.pid);
          await save(record);
        }
      }
    } catch (error) {
      successful = false;
      throw error;
    } finally {
      try {
        if (successful && handoff && !interrupted) {
          await closeBrowser();
          console.log("Explicit human handoff; application left running:");
          console.log(JSON.stringify(await inspect(await load()), null, 2));
          console.log("Stop later from this checkout: pnpm playground:stop");
        } else {
          const { stdout } = await run(process.execPath, [script, "stop"], {
            timeout: 300_000,
          });
          process.stdout.write(stdout);
        }
      } finally {
        process.off("SIGINT", onInt);
        process.off("SIGTERM", onTerm);
      }
    }
  }
}

async function main() {
  const command = process.argv[2];
  if (command === "explore") return explore();
  if (command === "_service") return service();
  if (command === "start") return start();
  if (command === "status")
    return console.log(JSON.stringify(await inspect(await load()), null, 2));
  if (command === "stop" || command === "reset") {
    const record = await load();
    if (!record) {
      await closeBrowser();
      // Before the first record is written, startup has created no resources.
      // Only remove an empty directory; unknown contents require inspection.
      await rmdir(active).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      if (command === "reset") {
        return start(true);
      }
      console.log("Playground is stopped.");
      return;
    }
    if (record.state === "starting") {
      // Avoid racing the launcher creating resources while stop removes them.
      const table = await processTable();
      if (launcherIn(table, record)) {
        process.kill(record.launcher, "SIGTERM");
        for (let i = 0; i < 250; i++) {
          if (!(await load())) {
            if (command === "reset") {
              return start(true);
            }
            return;
          }
          await sleep(1000);
        }
        throw new Error(
          "Launcher cleanup has not completed; inspect status and logs before retrying stop",
        );
      }
    }
    await cleanup(record);
    if (command === "reset") {
      return start(true);
    }
    console.log("Playground stopped; PostgreSQL data and logs preserved.");
    return;
  }
  console.log(
    "Usage: pnpm playground:start | playground:status | playground:stop | playground:reset\npnpm playground:explore [--handoff] -- <command> [args...]\nSee docs/central-playground.md for prerequisites and limitations.",
  );
  if (command && command !== "--help") process.exitCode = 1;
}
async function resetData() {
  const name = "ethoko-central-playground-data";
  let volume;
  try {
    const { stdout } = await run("docker", ["volume", "inspect", name]);
    volume = JSON.parse(stdout)[0];
  } catch (error) {
    if (/no such volume/i.test(error.stderr ?? "")) return;
    throw error;
  }
  if (volume.Labels?.["com.docker.compose.project"] !== project)
    throw new Error("Refusing to reset an unrecognized database volume");
  await run("docker", ["volume", "rm", name]);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
