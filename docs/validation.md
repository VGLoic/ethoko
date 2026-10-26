# Development validation

Use the Node version in `.nvmrc` (`nvm use`) and the pnpm version declared by root `package.json`, then `pnpm install --frozen-lockfile`.

After each logical unit of work, including review-plan items, run the applicable command from the repository root:

| Changes                                                                          | Command                 |
| -------------------------------------------------------------------------------- | ----------------------- |
| Central API or UI                                                                | `pnpm validate:central` |
| Standalone CLI or framework integration apps                                     | `pnpm validate:cli`     |
| Both areas, shared build/lint/type configuration, or workspace-wide dependencies | Both commands           |

Package scripts are the executable source of truth. Both suites check formatting without changing files, stop on a failed required operation, and print its command. Formatting fixes remain available via package `format` scripts.

Central validation covers API and UI builds, typechecks, lint, formatting, API unit and integration tests, UI browser tests, and UI test-harness verification. It invokes the Central packages directly, avoiding the CLI build dependencies of the root Turbo lint/typecheck tasks. Prerequisites are Rust, Docker with Compose v2, the running integration database below, and Chromium (`pnpm --filter central-ui test:e2e:install`).

CLI validation covers CLI and framework-app builds, typechecks, lint, formatting, CLI unit tests and E2Es, and framework-app E2Es. It retains Turbo's CLI build ordering and refreshes workspace binary links after building. Existing prerequisites still apply: Foundry, initialized Git submodules, integration-app artifacts/configuration used by their normal lint/typecheck scripts, and the CLI E2Es' LocalStack configuration (`packages/cli-beacon/.env.localstack`). See [CLI development](cli-beacon.md) and [integration apps](integration-apps.md). Missing prerequisites fail visibly rather than skipping coverage.

## Shared integration database

The repository root owns `compose.integration.yaml`. All worktrees connect to the same PostgreSQL service at `postgresql://admin:admin@localhost:5433/central`, using the stable Compose project `ethoko-integration` regardless of directory name or `COMPOSE_PROJECT_NAME`. This database is for tests only, separate from development, production, and playground databases.

```bash
pnpm test:integration:db:start   # repeatable; waits for readiness, bounded timeout
pnpm test:integration:db:status  # succeeds only when ready
pnpm test:integration           # full Central integration selection
pnpm validate:central          # comprehensive Central validation
```

Tests and validation require an already-running database; neither starts, stops, nor cleans it. An unavailable service fails promptly and names the startup command. A failed start can leave resources for inspection; use status and Docker output to diagnose it.

Focused execution is package-scoped, with normal Cargo arguments:

```bash
pnpm --filter central test:integration --test queue_test
CENTRAL_TEST_LOG=debug pnpm --filter central test:integration --test queue_test
CENTRAL_TEST_LOG=debug pnpm --filter central test:integration --test queue_test a_filter -- --nocapture
```

Without an explicit `--test` target the command uses the existing full `--tests` selection. Filters, Cargo's `--` test-harness separator, tracing controls, and failure status are preserved.

### Sharing and cleanup

Integration tests retain their existing randomized inputs and test-managed migrations/database behavior. Compatible worktrees can run concurrently, and completing or failing tests leaves the database available.

Queue tests still use SQLx-managed temporary databases, with a runtime nonce in each test path to avoid SQLx 0.8's deterministic-name collisions between simultaneous invocations. SQLx still applies migrations and cleans successful tests; this does not create per-worktree services or databases.

Randomized records do **not** solve incompatible migration histories. Concurrent worktrees must have compatible migrations. Coordinate incompatible branches and, when appropriate, an explicit clean/start cycle.

Only stop or clean after coordinating with every active test run in every worktree:

```bash
pnpm test:integration:db:stop    # stop the shared service, retain persisted data
pnpm test:integration:db:start   # reuse that data
pnpm test:integration:db:clean   # remove shared resources AND persisted test data
pnpm test:integration:db:start   # create a fresh database
```

CI integration jobs explicitly start the database and clean it with `if: always()`, even after startup or test failures; failing tests still fail the job. Central's `lint:ci` and `check-types:ci` delegate to its Rust checks in the existing Turbo jobs.

## Orchestration regression checks

`pnpm test:validation` verifies package-command suite selection and failure propagation using stand-in external commands, without running application tests. `pnpm test:integration:db:test` exercises lifecycle/persistence against Docker and integration argument forwarding. The latter **cleans shared test data**, so coordinate it like any clean operation; it is never run automatically by validation.
