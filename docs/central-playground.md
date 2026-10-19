# Central playground (startup-only)

Run the real Central UI/BFF, Central API, PostgreSQL, and normal queue/worker from this checkout. This complements automated tests when you need to inspect the connected application; it is not a replacement for them.

**Signup and email delivery do not work in this slice.** Runtime configuration explicitly selects `development` + `resend` with a non-live placeholder key. GitHub configuration is also non-live and points at an unavailable loopback endpoint. Do not exercise email/signup/verification or GitHub flows. Working local email capture is a subsequent ticket. No live provider credentials, authentication bypass, fake API, or prepared Users are used.

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
```

Start returns once `/health` on the API and `/login` on the UI respond successfully. Open the reported UI URL in your browser; `GET <api-url>/health` provides an API check. Applications run in the background through `pnpm --filter central dev` and `pnpm --filter central-ui dev`. The API dev command applies migrations before serving and runs both the PostgreSQL queue and normal worker in the same process.

Ports are selected automatically; PostgreSQL and UI bind loopback. Optional `CENTRAL_PLAYGROUND_API_PORT` / `CENTRAL_PLAYGROUND_UI_PORT` environment variables pin application ports (1024–65535). An occupied port causes startup failure, not silently switching to a different port.

Status emits JSON after pnpm's script banner, including the originating checkout, readiness/running state, launcher PID during startup, application process/group IDs and children, container IDs, URLs, configuration/resource-record paths, and UI/API/worker log paths. Worker logs share the API log because the worker runs within that binary. `degraded` means resources are recorded but not all application readiness/process checks pass. Docker inspection failures are reported without hiding the recorded process/log information.

Start reserves a checkout-local resource record. A second start refuses to overwrite it; inspect and explicitly stop the recorded playground first. An existing playground Docker stack also blocks startup from another checkout: stop it from its originating checkout first. Healthy-instance reuse, reset, and automatic stale-resource recovery are deferred to the lifecycle ticket.

## Isolation, persistence, and cleanup

Configuration, per-run logs, and resource records live under `.central-playground/` at the checkout root, with private directory/file permissions. This entire directory is git-ignored: `active/` holds the active resource record/reservation and `runs/<run-id>/` holds generated configuration and logs. Existing checkout `.env` files are not changed; generated application configuration is supplied in the child environment, overriding the ordinary dotenv defaults. Live provider variables from the launching shell are not forwarded. Do not publish generated configuration: it contains the local Machine Credential and session secret.

PostgreSQL uses the dedicated Compose project `ethoko-central-playground` and named volume `ethoko-central-playground-data`. Stop removes that project's containers/network, preserving the database volume, logs, and generated configuration. Each start generates a new BFF Machine Credential and session secret; browser sessions need not survive a restart. There is no reset command in this slice.

Stop is harmless when repeated. It verifies token-bearing process-group keepers before signalling their groups, allowing pnpm, Cargo, the API/worker, Vite and their spawned children to be stopped together. It never selects processes by application name or port. It does not stop unrelated containers/services, Docker itself, or OpenCode. A missing keeper with surviving group members is reported for manual inspection rather than blindly killing potentially reused process IDs or discarding the record.

Startup errors report the failing stage and clean up resources from that attempt. SIGINT/SIGTERM to the launcher during startup trigger the same cleanup (an in-flight Docker operation may need to finish or time out first). After successful start, the explicit stop command is the lifecycle boundary. A hard crash/SIGKILL does not guarantee automatic cleanup: use status and stop. An incomplete cleanup retains its resource record so it cannot be silently replaced.

Run the small real-service command acceptance suite with **no existing playground**:

```sh
pnpm test:playground
```

It checks accessible UI/API, a normal BFF login rejection against the real API, duplicate-start refusal, process/container shutdown, repeated stop, occupied-port startup cleanup, preservation of an unrelated listener, and launcher-interruption cleanup. It preserves database data and does not exercise delivery/GitHub flows.
