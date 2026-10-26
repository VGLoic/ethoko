import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Explicit identity prevents worktree names and COMPOSE_PROJECT_NAME from
// selecting different services or volumes. This is separate from playground.
const compose = [
  "compose",
  "--project-name",
  "ethoko-integration",
  "--file",
  fileURLToPath(new URL("../compose.integration.yaml", import.meta.url)),
];
const action = process.argv[2];
const readiness = [
  "exec",
  "-T",
  "integration-db",
  "pg_isready",
  "-U",
  "admin",
  "-d",
  "central",
];
const operations = {
  start: ["up", "--detach", "--wait", "--wait-timeout", "30"],
  stop: ["stop"],
  clean: ["down", "--volumes", "--remove-orphans"],
  status: readiness,
  check: readiness,
};
if (!Object.hasOwn(operations, action)) {
  console.error(`Unknown integration database operation: ${action}`);
  process.exit(1);
}
const checking = action === "check" || action === "status";
const result = spawnSync("docker", [...compose, ...operations[action]], {
  stdio: checking ? "pipe" : "inherit",
  timeout: checking ? 5_000 : 60_000,
});
if (result.error || result.status !== 0) {
  console.error(
    checking
      ? "Integration database is not ready. Run pnpm test:integration:db:start."
      : `Integration database ${action} failed. See Docker output above.`,
  );
  if (result.error) console.error(result.error.message);
  process.exit(result.status || 1);
}
if (action !== "check")
  console.log(
    `Integration database ${action === "status" || action === "start" ? "ready" : action === "stop" ? "stopped (data retained)" : "cleaned (test data deleted)"}.`,
  );
