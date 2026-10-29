# Central playground

Run the real Central UI/BFF, Central API, PostgreSQL, and normal queue/worker from this checkout. This complements automated tests when you need to inspect the connected application; it is not a replacement for them.

Email signup and verification work locally. Runtime configuration explicitly selects `development` + `local-capture`, with a per-run capture directory and no Resend key. The real PostgreSQL queue and normal worker deliver readable messages to files. GitHub configuration is non-live and points at an unavailable loopback endpoint; **do not exercise GitHub flows**. No live provider credentials, authentication bypass, fake API, or prepared Users are used.

## Prerequisites

- macOS or Linux with POSIX process groups and `ps`.
- Node.js: use `nvm use` at the repository root (see `.nvmrc`).
- pnpm matching root `package.json` (`packageManager`), with `pnpm install` completed.
- Rust/Cargo supporting edition 2024, plus the native build dependencies used by `apps/central`.
- Running Docker with Compose v2+ (`docker info`, `docker compose version`). The first run needs network access to pull `postgres:18` and obtain uncached Rust dependencies.

No SQLx CLI, locally installed PostgreSQL, or `.env` editing is required. Browser installation is only needed for interactive exploration and browser-resource acceptance below. Run on a trusted development machine: the existing API dev server binds all interfaces; this is not a production deployment.

## Commands

From the repository root:

```sh
pnpm playground:start
pnpm playground:status
pnpm playground:stop
pnpm playground:reset
pnpm playground:clean # only after stop
```

Start returns once `/health` on the API and `/login` on the UI respond successfully. Open the reported UI URL in your browser; `GET <api-url>/health` provides an API check. Applications run in the background through `pnpm --filter central dev` and `pnpm --filter central-ui dev`. The API dev command applies migrations before serving and runs both the PostgreSQL queue and normal worker in the same process.

Ports are selected automatically; PostgreSQL and UI bind loopback. Optional `CENTRAL_PLAYGROUND_API_PORT` / `CENTRAL_PLAYGROUND_UI_PORT` environment variables pin application ports (1024–65535). An occupied port causes startup failure, not silently switching to a different port.

Status emits JSON after pnpm's script banner, including the originating checkout, readiness/running state, launcher PID during startup, application process/group IDs and children, container IDs, URLs, configuration/resource-record paths, `emailCaptureDirectory`, and UI/API/worker log paths. Worker logs share the API log because the worker runs within that binary. `degraded` means resources are recorded but not all application readiness/process checks pass. Docker inspection failures are reported without hiding the recorded process/log information.

Starting again from the same checkout returns the existing healthy instance's details without spawning more resources. A degraded or interrupted instance is never silently repaired or replaced: inspect it and explicitly stop it first. Starting from another checkout reports the originating checkout and how to stop it; it never connects to that instance. A stopped Docker reservation container (`ethoko-central-playground-reservation`) atomically reserves the shared stack name across checkouts, including during startup and reset. Commands act directly on the identified instance; there are no agent/session ownership checks or takeover flows.

## Isolation, persistence, and cleanup

Configuration, per-run logs, and resource records live under `.central-playground/` at the checkout root, with private directory/file permissions. This entire directory is git-ignored: `active/` holds the active resource record/reservation and `runs/<run-id>/` holds generated configuration and logs. Existing checkout `.env` files are not changed; generated application configuration is supplied in the child environment, overriding the ordinary dotenv defaults. Live provider variables from the launching shell are not forwarded. Do not publish generated configuration: it contains the local Machine Credential and session secret.

PostgreSQL uses the dedicated Compose project `ethoko-central-playground` and named volume `ethoko-central-playground-data`. Stop removes the identified run's containers/network, preserving the database volume, captures, logs, and generated configuration. Each start generates a new BFF Machine Credential and session secret; browser sessions need not survive a restart. Sign in normally with the existing User's email/password after restarting.

`pnpm playground:reset` explicitly stops the local instance, deletes the dedicated database volume after verifying its Compose identity, then starts again with normal migrations and a fresh local-email-capture directory. **All application data is lost.** Signup can use the same email again; no prepared Users are installed. Historical captures, logs, and configuration remain in their old run directories as ordinary local evidence, but are not part of the fresh instance. Reset also works after stop; it refuses if another checkout has reserved the playground.

To discard retained resources when exploration is finished, run **`pnpm playground:stop`, then `pnpm playground:clean`**. Clean requires an already-stopped application and dedicated browser; it does not perform shutdown or recovery. It deletes the identity-checked PostgreSQL volume and this checkout's entire `.central-playground/` directory: all historical runs, logs, email captures, generated configuration/credentials, browser profile/cookies, and browser evidence. **All retained application data and local evidence are lost.** It holds the same machine-wide reservation as start/reset and refuses another checkout's reservation or unresolved local lifecycle state. Absent targets are successful no-ops; deletion failures are reported. Clean stays stopped and does not run migrations or recreate runtime files. The installed tool, checked-in configuration, dependencies, browser installation, and unrelated resources remain available; a later explicit start creates fresh usable state normally. Unlike clean, reset restarts the application and retains historical local files.

Stop is harmless when repeated. It verifies token-bearing process-group keepers before signalling their groups, allowing pnpm, Cargo, the API/worker, Vite and their spawned children to be stopped together. It never selects processes by application name or port. It does not stop unrelated containers/services, Docker itself, or OpenCode. A missing keeper with surviving group members is reported for manual inspection rather than blindly killing potentially reused process IDs or discarding the record.

Startup errors report the failing stage and clean up resources from that attempt. SIGINT/SIGTERM to the launcher during startup trigger the same cleanup (an in-flight Docker operation may need to finish or time out first). Plain `start` leaves resources running until explicit stop. For bounded agent work, use `pnpm playground:explore [--handoff] -- <command> [args...]`: it reuses start/stop, automatically cleans up on command completion/failure and handled SIGINT/SIGTERM, and tracks command children in the same resource record. Only successful explicit `--handoff` preserves the application; the dedicated browser and command children still close. See [agent workflow](agents/playground.md). A hard crash/SIGKILL does not guarantee automatic cleanup: use status and stop. An incomplete cleanup retains its resource record so it cannot be silently replaced.

### Restart and manual recovery

1. Run `pnpm playground:status` from the originating checkout. `running` means both applications and PostgreSQL are healthy; `starting` means the startup launcher is still present; `degraded` includes interrupted startup, missing resources, and partial shutdown.
2. Run `pnpm playground:stop`, then `pnpm playground:start` to resume saved application data. Use `pnpm playground:reset` instead only when you want fresh signup state.
3. If Docker inspection is unavailable, restore Docker and retry stop. Stop waits up to three minutes for an identified orphaned resource-creating Docker command to finish before removing containers and releasing the reservation; if it remains stuck, tracking is retained for retry/manual inspection. Do not delete the active record to bypass recovery.
4. If stop cannot identify a surviving process group, inspect the reported group and command lines (`ps -axo pid,pgid,command`), configuration, and logs. Only terminate remaining processes manually after independently confirming their identity; then retry stop. Never kill a PID merely because it appears in an old record. Containers and networks are selected by run labels and immutable IDs, not just the shared project name.
5. A missing record with an empty `active/` directory is reported as degraded; explicit stop removes that empty startup directory. A complete interrupted `resources.json.tmp` is usable for recovery. If JSON is corrupt or unknown files prevent cleanup, preserve those files and inspect the matching run's configuration/logs and Docker run labels before manually recovering; never discard tracking for resources whose identity has not been checked.

**Hard crashes can leave resources running until explicit stop is invoked.** There is no watchdog, automatic stale-resource repair, cross-checkout stop-all command, or support for simultaneous independent playgrounds.

## Retrieve local verification links

The interactive browser procedure below uses these same captures, without direct API calls.

After signup, wait for the worker (normally a few seconds), then use the `emailCaptureDirectory` from `pnpm playground:status`:

```sh
cat /absolute/path/from/status/emails/*.json
jq -r '.verification_url' /absolute/path/from/status/emails/*.json
```

Each completed delivery is a separate JSON file with `recipient`, `kind`, `delivered_at`, and `verification_url`. The directory is created on first delivery; ignore `.tmp` files from interrupted/failed writes. Open the link on the reported UI origin, or read its `email` and `otp` query parameters and POST them as JSON to `<api-url>/auth/verify-email`. Captures contain verification secrets and email addresses: keep them private, separate from logs, and never publish them. Stop preserves them under the originating run directory.

For direct API exploration, the generated `configuration` file contains the local `CENTRAL_UI_BFF_SHARED_SECRET` Machine Credential. Send it as `Authorization: Bearer <secret>` for `POST /auth/signup/email`, `POST /auth/verify-email`, and `POST /auth/login/email`. Signup accepts `{ "email": "...", "password": "..." }` and returns 201. Verification accepts `{ "email": "...", "otp": "..." }`. Login accepts email/password and returns a `token`; send that User Session Token separately as `X-Ethoko-User-Authorization: Bearer <token>` with the Machine Credential to `GET /auth/me`. Pace requests at least two seconds apart to respect the real API's rate limits.

Email verification does **not** register a handle: `/auth/me` still reports `handle_registration: null` with `emailVerified: true`. Complete onboarding through `POST /auth/register-handle` with `{ "handle": "your-unique-handle" }` and both credentials; `/auth/me` then reports `handle_registration: { "handle": "your-unique-handle" }` and `suggestedHandle: null`. Never modify User records or queue contents directly.

## Interactive exploration in OpenCode V2

Project-local `opencode.json` configures the `playground` stdio server under V2's `mcp.servers`, preserving other settings. It uses lockfile-pinned `@playwright/mcp`; root `playwright` is pinned to the same upstream version for browser installation and lifecycle tests. This is independent of `apps/central-ui`'s Playwright/MSW harness. See the [V2 MCP reference](https://opencode.ai/v2/docs/mcp-servers) and [Playwright MCP capabilities](https://github.com/microsoft/playwright-mcp).

From the repository root, after `pnpm install`:

```sh
pnpm playground:browser:install
opencode mcp list
pnpm playground:start
pnpm playground:status
```

On Linux, install Chromium's OS dependencies with `pnpm exec playwright install --with-deps chromium` (may require administrator access). Repeat browser installation after upgrading MCP/Playwright. In an already running OpenCode, use `/mcps` to connect/reconnect `playground` if needed. Start OpenCode at the repository root: config/profile/output paths resolve from that workspace. `scripts/central-playground-browser.json` selects bundled Chromium, **headless**, with a dedicated persistent profile at `.central-playground/browser/profile`. It never attaches to personal browsers. Only one MCP client can use this profile at a time; do not use it for unrelated browsing or override browser/profile/endpoint settings through `PLAYWRIGHT_MCP_*` environment variables.

For bounded agent use, follow [the workflow](agents/playground.md). Inside that activity (or for manual exploration), perform the following interactively, choosing each next action from the current page, not by running a scripted test:

1. Discover `urls.ui` from status and use `browser_navigate` on the `playground` server to open `<ui-url>/signup`. Inspect `browser_snapshot` (read its returned file if needed), then use its element references with `browser_type`, `browser_click`, and `browser_press_key` to sign up with a unique email and password.
2. Read the real worker's JSON capture for that recipient in `emailCaptureDirectory`. Open its `verification_url` using `browser_navigate` and submit **Verify email** through the UI.
3. Navigate to `<ui-url>/login`, sign in through the form, follow **Register handle** from Home, and submit an available permanent handle. Inspect Home for the handle and **Email verified: Yes**. Signup and verification success pages currently require explicit navigation to the next route.
4. Inspect `browser_console_messages` and `browser_network_requests`; `browser_network_request` provides individual request details. Browser diagnostics show UI/BFF traffic, not server-to-server API calls. Read the existing status-reported `logs.ui` and `logs.api`/`logs.worker` files for server diagnostics. Never enable mocks or bypass authentication.
5. Save a screenshot with `browser_take_screenshot`, plus useful snapshots/console/network listings. Status reports `browser.evidenceDirectory`; automatically named files go there. **Explicit relative filenames resolve from the workspace root**, not the output directory: use `.central-playground/browser/evidence/<name>` to keep them ignored. Report the journey, observed result, evidence locations, and substitution limits in the session/PR, not committed run reports. Only email delivery is locally substituted; real UI/BFF/API/PostgreSQL/worker run, while GitHub and live email-provider delivery are not proven.
6. Finish browser tool calls, optionally call `browser_close` to close the current page, then return to the bounded runner, which performs cleanup (or explicit handoff). For manual exploration without the runner, run `pnpm playground:stop`. This is the authoritative cleanup for the browser **and** applications; closing a tab alone is insufficient. Verify status says `stopped` and `browser.processes` is empty. Do not invoke browser tools after stop: even a tool requiring a page can relaunch Chromium. Unrelated MCP transports and OpenCode services remain available.

### Browser resources and manual cleanup

Status includes `browser.profileDirectory`, `browser.evidenceDirectory`, and live browser PIDs/commands/start times, even when applications are stopped. Application `state` does not describe browser state; inspect `browser.processes` separately.

Stop closes Chromium identified by its executable name, this checkout's exact reserved profile, and Playwright debugging-pipe flag, including without an application record. Lifecycle paths come from the same browser configuration. It rechecks the live command/start time before signalling the browser PID, never the MCP/OpenCode process group. Chromium shuts down its children. If shutdown does not finish within ten seconds, stop fails and retains any application record for inspection/retry. Do not issue browser calls concurrently with cleanup: another navigation can launch a browser again.

Manual cleanup is the same `pnpm playground:status` / `pnpm playground:stop` sequence; no OpenCode shutdown or broad browser kill is needed. If browser shutdown fails, inspect the reported command and profile, close its page through the `playground` MCP tools, and retry stop. Keep browser cookies, captures, screenshots, snapshots, and network details private: they may contain email addresses, verification codes, passwords, or session credentials. Stop preserves evidence and the profile; reset clears application data, not historical evidence or cookies. Sign in again after restart/reset as needed. Bounded completion and human handoff are described in the [agent workflow](agents/playground.md); no automatic exploration timeout is imposed.

## Command and HTTP acceptance

Run the small real-service command acceptance suite with **no existing playground or active playground browser** (install Chromium first):

```sh
pnpm test:playground
```

Browser-resource acceptance launches dedicated and unrelated Chromium instances, verifies identification, stops the dedicated browser even without application resources, and checks the unrelated browser still works. Clean acceptance checks stopped-resource deletion, repeated cleanup, fresh startup, unrelated resource preservation, and refusal of active browsers, unresolved lifecycle files, unrecognized volumes, and another checkout's reservation. The connected interactive UI journey above remains separate from these regression tests.

It starts through the playground command, submits signup with the normal BFF Machine Credential, awaits the actual worker's capture file, verifies using the captured link's parameters, signs in, validates the resulting User Session Token through `/auth/me`, and registers a handle through the public API. It proves persistence through stop/start and normal sign-in, then resets and repeats signup/verification/sign-in for the same email. **The suite resets the playground database.** It also checks healthy reuse, cross-checkout refusal, process/container shutdown, repeated stop, occupied-port failure, unrelated services, handled and hard launcher interruptions, partial-resource status, and safe refusal after loss of a keeper. Browser navigation/cookie acceptance is separate; no real GitHub services are invoked.
