import { spawnSync } from "node:child_process";

const suites = {
  central: [
    ["test:integration:db:status"],
    ...["build", "check-types", "lint", "check-format"].flatMap((operation) =>
      ["central", "central-ui"].map((name) => ["--filter", name, operation]),
    ),
    ["--filter", "central", "test:unit"],
    ["--filter", "central", "test:integration"],
    ["--filter", "central-ui", "test:e2e"],
    ["--filter", "central-ui", "test:e2e:verify-harness"],
  ],
  cli: [
    [
      "exec",
      "turbo",
      "run",
      "build",
      "--filter=!central",
      "--filter=!central-ui",
    ],
    // Refresh workspace binary links after the CLI has been built.
    ["install", "--frozen-lockfile"],
    ...["check-types", "lint", "check-format", "test:unit"].map((operation) => [
      "exec",
      "turbo",
      "run",
      operation,
      "--filter=!central",
      "--filter=!central-ui",
    ]),
    ["--filter", "@ethoko/cli-beacon", "test:e2e"],
    [
      "exec",
      "turbo",
      "run",
      "test:e2e:apps",
      "--filter=!central",
      "--filter=!central-ui",
    ],
  ],
};

const suite = process.argv[2];
if (!Object.hasOwn(suites, suite)) {
  console.error(`Unknown validation suite: ${suite}`);
  process.exit(1);
}

for (const args of suites[suite]) {
  console.log(`\n[validate:${suite}] pnpm ${args.join(" ")}`);
  const result = spawnSync("pnpm", args, { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    console.error(`[validate:${suite}] FAILED: pnpm ${args.join(" ")}`);
    if (result.error) console.error(result.error.message);
    process.exit(result.status || 1);
  }
}
