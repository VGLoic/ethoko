import { spawnSync } from "node:child_process";

const suites = {
  central: [
    "pnpm test:integration:db:status",
    "pnpm --filter central build",
    "pnpm --filter central-ui build",
    "pnpm --filter central check-types",
    "pnpm --filter central-ui check-types",
    "pnpm --filter central lint",
    "pnpm --filter central-ui lint",
    "pnpm --filter central check-format",
    "pnpm --filter central-ui check-format",
    "pnpm --filter central test:unit",
    "pnpm --filter central test:integration",
    "pnpm --filter central-ui test:e2e",
    "pnpm --filter central-ui test:e2e:verify-harness",
  ],
  cli: [
    "pnpm exec turbo run build --filter=!central --filter=!central-ui",
    // Refresh workspace binary links after the CLI has been built.
    "pnpm install --frozen-lockfile",
    "pnpm exec turbo run check-types --filter=!central --filter=!central-ui",
    "pnpm exec turbo run lint --filter=!central --filter=!central-ui",
    "pnpm exec turbo run check-format --filter=!central --filter=!central-ui",
    "pnpm exec turbo run test:unit --filter=!central --filter=!central-ui",
    "pnpm --filter @ethoko/cli-beacon test:e2e",
    "pnpm exec turbo run test:e2e:apps --filter=!central --filter=!central-ui",
  ],
};

const suite = process.argv[2];
if (!Object.hasOwn(suites, suite)) {
  console.error(`Unknown validation suite: ${suite}`);
  process.exit(1);
}

for (const command of suites[suite]) {
  console.log(`\n[validate:${suite}] ${command}`);
  const result = spawnSync(command, { shell: true, stdio: "inherit" });
  if (result.error || result.status !== 0) {
    console.error(`[validate:${suite}] FAILED: ${command}`);
    if (result.error) console.error(result.error.message);
    process.exit(result.status || 1);
  }
}
