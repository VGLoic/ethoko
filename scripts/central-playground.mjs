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
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

const exec = promisify(execFile);
const script = fileURLToPath(import.meta.url);
const checkout = resolve(dirname(script), "..");
const base = join(checkout, ".central-playground");
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
    if (error.code === "ENOENT") return null;
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
    if (error.stderr?.includes("No such object")) return null;
    throw error;
  }
}
async function releaseReservation(record) {
  const id = await reservation(record);
  if (id) await run("docker", ["rm", "-v", id]);
}
async function save(record) {
  await writeFile(`${recordPath}.tmp`, JSON.stringify(record, null, 2), {
    mode: 0o600,
  });
  await rename(`${recordPath}.tmp`, recordPath);
}
async function processTable() {
  const { stdout } = await run("ps", ["-axo", "pid=,pgid=,command="]);
  return stdout
    .trim()
    .split("\n")
    .map((line) => {
      const [, pid, pgid, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
      return { pid: Number(pid), pgid: Number(pgid), command };
    });
}
function keeperIn(table, resource, token) {
  return table.some(
    (p) =>
      p.pid === resource.pid &&
      p.pgid === resource.pid &&
      p.command.includes(`_service ${token} ${resource.name} `),
  );
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
  if (!record) return { state: "stopped" };
  const table = await processTable();
  const processes = record.services.flatMap((service) => {
    if (!keeperIn(table, service, record.token)) return [];
    return table
      .filter((p) => p.pgid === service.pid)
      .map((p) => ({ ...p, service: service.name }));
  });
  let containers = [];
  let databaseReady = false;
  let containerInspectionError;
  try {
    const { stdout } = await compose(record, ["ps", "-aq"]);
    containers = stdout.trim().split(/\s+/).filter(Boolean);
    if (containers.length) {
      const inspected = await run("docker", ["inspect", ...containers]);
      databaseReady = JSON.parse(inspected.stdout).every(
        (container) =>
          container.State.Running &&
          container.State.Health?.Status === "healthy",
      );
    }
    const id = await reservation(record);
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
      record.services.every((s) =>
        processes.some((p) => p.service === s.name && p.pid !== s.pid),
      ) &&
      containers.length &&
      databaseReady &&
      healthy
        ? "running"
        : record.state === "starting"
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
    dataVolume: "ethoko-central-playground-data",
  };
}
async function cleanup(record) {
  const table = await processTable();
  for (const service of record.services) {
    if (
      !keeperIn(table, service, record.token) &&
      table.some((p) => p.pgid === service.pid)
    ) {
      throw new Error(
        `Cannot safely identify ${service.name} process group ${service.pid}; resource record retained for manual inspection`,
      );
    }
  }
  const owned = record.services.filter((s) => keeperIn(table, s, record.token));
  for (const service of owned) process.kill(-service.pid, "SIGTERM");
  await sleep(2000);
  const remaining = await processTable();
  for (const service of owned) {
    if (keeperIn(remaining, service, record.token))
      process.kill(-service.pid, "SIGKILL");
  }
  // Keepers intentionally remain alive through TERM so group identity can be
  // checked before escalation, even if pnpm or the application exits first.
  await compose(record, ["down", "--timeout", "5"]);
  await releaseReservation(record);
  await writeFile(
    join(dirname(record.composeFile), "stopped.json"),
    JSON.stringify(record, null, 2),
    { mode: 0o600 },
  );
  await unlink(recordPath);
  await rmdir(active);
}
async function start() {
  await mkdir(base, { recursive: true, mode: 0o700 });
  try {
    await mkdir(active, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
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
    await save(record);
    await stage("prerequisites");
    if (process.platform === "win32")
      throw new Error("POSIX process groups require macOS or Linux");
    await run("docker", ["info"]);
    await run("docker", ["compose", "version"]);
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
      "postgres:18",
      "true",
    ]);
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
  const child = spawn("pnpm", args, {
    cwd: checkout,
    env: { ...cleanEnv, ...environment },
    stdio: "inherit",
  });
  child.on("error", (error) =>
    console.error(`${name} launch failed: ${error.message}`),
  );
  child.on("exit", (code, signal) =>
    console.error(`${name} dev command exited (${code ?? signal})`),
  );
}

async function main() {
  const command = process.argv[2];
  if (command === "_service") return service();
  if (command === "start") return start();
  if (command === "status")
    return console.log(JSON.stringify(await inspect(await load()), null, 2));
  if (command === "stop") {
    const record = await load();
    if (!record) {
      console.log("Playground is stopped.");
      return;
    }
    if (record.state === "starting") {
      // Avoid racing the launcher creating resources while stop removes them.
      const table = await processTable();
      if (
        table.some(
          (p) =>
            p.pid === record.launcher &&
            p.command.includes(script) &&
            p.command.endsWith(" start"),
        )
      ) {
        process.kill(record.launcher, "SIGTERM");
        for (let i = 0; i < 250; i++) {
          if (!(await load())) return;
          await sleep(1000);
        }
        throw new Error(
          "Launcher cleanup has not completed; inspect status and logs before retrying stop",
        );
      }
    }
    await cleanup(record);
    console.log("Playground stopped; PostgreSQL data and logs preserved.");
    return;
  }
  console.log(
    "Usage: pnpm playground:start | playground:status | playground:stop\nSee docs/central-playground.md for prerequisites and limitations.",
  );
  if (command && command !== "--help") process.exitCode = 1;
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
