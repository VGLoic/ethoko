# Central playground

Run the real Central UI/BFF, Central API, PostgreSQL, and normal queue/worker from this checkout. This complements automated tests when you need to inspect the connected application; it is not a replacement for them.

Email signup and verification work locally. Runtime configuration explicitly selects `development` + `local-capture`, with a per-run capture directory and no Resend key. The real PostgreSQL queue and normal worker deliver readable messages to files. GitHub configuration is non-live and points at an unavailable loopback endpoint; **do not exercise GitHub flows**. No live provider credentials, authentication bypass, fake API, or prepared Users are used.

## Prerequisites

- macOS or Linux with POSIX process groups and `ps`.
- Node.js: use `nvm use` at the repository root (see `.nvmrc`).
- pnpm matching root `package.json` (`packageManager`), with `pnpm install` completed.
- Rust/Cargo supporting edition 2024, plus the native build dependencies used by `apps/central`.
- Running Docker with Compose v2+ (`docker info`, `docker compose version`). The first run needs network access to pull `postgres:18` and obtain uncached Rust dependencies.

No SQLx CLI, locally installed PostgreSQL, browser automation setup, or `.env` editing is required. Run on a trusted development machine: the existing API dev server binds all interfaces; this is not a production deployment.

## Commands

From the repository root:

```sh
pnpm playground:start
pnpm playground:status
pnpm playground:stop
pnpm playground:reset
```

Start returns once `/health` on the API and `/login` on the UI respond successfully. Open the reported UI URL in your browser; `GET <api-url>/health` provides an API check. Applications run in the background through `pnpm --filter central dev` and `pnpm --filter central-ui dev`. The API dev command applies migrations before serving and runs both the PostgreSQL queue and normal worker in the same process.

Ports are selected automatically; PostgreSQL and UI bind loopback. Optional `CENTRAL_PLAYGROUND_API_PORT` / `CENTRAL_PLAYGROUND_UI_PORT` environment variables pin application ports (1024–65535). An occupied port causes startup failure, not silently switching to a different port.

Status emits JSON after pnpm's script banner, including the originating checkout, readiness/running state, launcher PID during startup, application process/group IDs and children, container IDs, URLs, configuration/resource-record paths, `emailCaptureDirectory`, and UI/API/worker log paths. Worker logs share the API log because the worker runs within that binary. `degraded` means resources are recorded but not all application readiness/process checks pass. Docker inspection failures are reported without hiding the recorded process/log information.

Starting again from the same checkout returns the existing healthy instance's details without spawning more resources. A degraded or interrupted instance is never silently repaired or replaced: inspect it and explicitly stop it first. Starting from another checkout reports the originating checkout and how to stop it; it never connects to that instance. A stopped Docker reservation container (`ethoko-central-playground-reservation`) atomically reserves the shared stack name across checkouts, including during startup and reset. Commands act directly on the identified instance; there are no agent/session ownership checks or takeover flows.

## Isolation, persistence, and cleanup

Configuration, per-run logs, and resource records live under `.central-playground/` at the checkout root, with private directory/file permissions. This entire directory is git-ignored: `active/` holds the active resource record/reservation and `runs/<run-id>/` holds generated configuration and logs. Existing checkout `.env` files are not changed; generated application configuration is supplied in the child environment, overriding the ordinary dotenv defaults. Live provider variables from the launching shell are not forwarded. Do not publish generated configuration: it contains the local Machine Credential and session secret.

PostgreSQL uses the dedicated Compose project `ethoko-central-playground` and named volume `ethoko-central-playground-data`. Stop removes the identified run's containers/network, preserving the database volume, captures, logs, and generated configuration. Each start generates a new BFF Machine Credential and session secret; browser sessions need not survive a restart. Sign in normally with the existing User's email/password after restarting.

`pnpm playground:reset` explicitly stops the local instance, deletes the dedicated database volume after verifying its Compose identity, then starts again with normal migrations and a fresh local-email-capture directory. **All application data is lost.** Signup can use the same email again; no prepared Users are installed. Historical captures, logs, and configuration remain in their old run directories as ordinary local evidence, but are not part of the fresh instance. Reset also works after stop; it refuses if another checkout has reserved the playground.

Stop is harmless when repeated. It verifies token-bearing process-group keepers before signalling their groups, allowing pnpm, Cargo, the API/worker, Vite and their spawned children to be stopped together. It never selects processes by application name or port. It does not stop unrelated containers/services, Docker itself, or OpenCode. A missing keeper with surviving group members is reported for manual inspection rather than blindly killing potentially reused process IDs or discarding the record.

Startup errors report the failing stage and clean up resources from that attempt. SIGINT/SIGTERM to the launcher during startup trigger the same cleanup (an in-flight Docker operation may need to finish or time out first). After successful start, the explicit stop command is the lifecycle boundary. A hard crash/SIGKILL does not guarantee automatic cleanup: use status and stop. An incomplete cleanup retains its resource record so it cannot be silently replaced.

### Restart and manual recovery

1. Run `pnpm playground:status` from the originating checkout. `running` means both applications and PostgreSQL are healthy; `starting` means the startup launcher is still present; `degraded` includes interrupted startup, missing resources, and partial shutdown.
2. Run `pnpm playground:stop`, then `pnpm playground:start` to resume saved application data. Use `pnpm playground:reset` instead only when you want fresh signup state.
3. If Docker inspection is unavailable, restore Docker and retry stop. Stop waits up to three minutes for an identified orphaned resource-creating Docker command to finish before removing containers and releasing the reservation; if it remains stuck, tracking is retained for retry/manual inspection. Do not delete the active record to bypass recovery.
4. If stop cannot identify a surviving process group, inspect the reported group and command lines (`ps -axo pid,pgid,command`), configuration, and logs. Only terminate remaining processes manually after independently confirming their identity; then retry stop. Never kill a PID merely because it appears in an old record. Containers and networks are selected by run labels and immutable IDs, not just the shared project name.
5. A missing record with an empty `active/` directory is reported as degraded; explicit stop removes that empty startup directory. A complete interrupted `resources.json.tmp` is usable for recovery. If JSON is corrupt or unknown files prevent cleanup, preserve those files and inspect the matching run's configuration/logs and Docker run labels before manually recovering; never discard tracking for resources whose identity has not been checked.

**Hard crashes can leave resources running until explicit stop is invoked.** There is no watchdog, automatic stale-resource repair, cross-checkout stop-all command, or support for simultaneous independent playgrounds.

## Retrieve local verification links

After signup, wait for the worker (normally a few seconds), then use the `emailCaptureDirectory` from `pnpm playground:status`:

```sh
cat /absolute/path/from/status/emails/*.json
jq -r '.verification_url' /absolute/path/from/status/emails/*.json
```

Each completed delivery is a separate JSON file with `recipient`, `kind`, `delivered_at`, and `verification_url`. The directory is created on first delivery; ignore `.tmp` files from interrupted/failed writes. Open the link on the reported UI origin, or read its `email` and `otp` query parameters and POST them as JSON to `<api-url>/auth/verify-email`. Captures contain verification secrets and email addresses: keep them private, separate from logs, and never publish them. Stop preserves them under the originating run directory.

For direct API exploration, the generated `configuration` file contains the local `CENTRAL_UI_BFF_SHARED_SECRET` Machine Credential. Send it as `Authorization: Bearer <secret>` for `POST /auth/signup/email`, `POST /auth/verify-email`, and `POST /auth/login/email`. Signup accepts `{ "email": "...", "password": "..." }` and returns 201. Verification accepts `{ "email": "...", "otp": "..." }`. Login accepts email/password and returns a `token`; send that User Session Token separately as `X-Ethoko-User-Authorization: Bearer <token>` with the Machine Credential to `GET /auth/me`. Pace requests at least two seconds apart to respect the real API's rate limits.

Email verification does **not** register a handle: `/auth/me` still reports `state: "pending"` with `emailVerified: true`. Complete onboarding through `POST /auth/register-handle` with `{ "handle": "your-unique-handle" }` and both credentials; `/auth/me` then reports `state: "registered"`. Never modify User state or queue contents directly.

## Command and HTTP acceptance

Run the small real-service command acceptance suite with **no existing playground**:

```sh
pnpm test:playground
```

It starts through the playground command, submits signup with the normal BFF Machine Credential, awaits the actual worker's capture file, verifies using the captured link's parameters, signs in, validates the resulting User Session Token through `/auth/me`, and registers a handle through the public API. It proves persistence through stop/start and normal sign-in, then resets and repeats signup/verification/sign-in for the same email. **The suite resets the playground database.** It also checks healthy reuse, cross-checkout refusal, process/container shutdown, repeated stop, occupied-port failure, unrelated services, handled and hard launcher interruptions, partial-resource status, and safe refusal after loss of a keeper. Browser navigation/cookie acceptance is separate; no real GitHub services are invoked.
