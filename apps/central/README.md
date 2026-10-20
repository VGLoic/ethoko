# Ethoko Central

This repository contains the source code for Ethoko Central, the default backend for Ethoko.

## Local development

To get started with local development, you'll need to set up your environment. Follow these steps:

1. Make sure you have [Rust](https://www.rust-lang.org/tools/install) installed on your machine. Cargo version at the time of writing is 1.88.0.
    ```bash
    cargo --version
    ```

2. Set up the environment variables in a `.env` file, the required ones are indicated with the `REQUIRED` label.
    ```bash
    cp .env.example .env
    ```

3. Verify that the unit tests are running:
    ```bash
    pnpm --filter central test:unit
    ```

4. Launch a local instance of PostgreSQL using Docker:
    ```bash
    docker compose up
    ```

5. Run the application
    ```bash
    pnpm --filter central dev
    ```

The application can also be run using a single `docker compose` command:
```bash
docker compose -f compose.app.yaml up --build
```

### Runtime environment and email transport

The existing `central-server` binary reads these settings from the environment (or `.env`):

| Variable | Values / requirement | Default |
| --- | --- | --- |
| `CENTRAL_ENVIRONMENT` | `production` or `development` | `production` |
| `CENTRAL_EMAIL_TRANSPORT` | `resend` or `local-capture` | `resend` |
| `RESEND_API_KEY` | Required for Resend in either environment | None |
| `CENTRAL_EMAIL_CAPTURE_DIR` | Nonempty directory path required for local capture | None |

Omitted or empty optional settings use their defaults. Unknown environment or transport values fail configuration parsing. `NODE_ENV`, Rust build profiles, and development mode alone do not select local capture.

Local capture requires both `CENTRAL_ENVIRONMENT=development` and an explicit `CENTRAL_EMAIL_TRANSPORT=local-capture`, plus a capture directory. It does not require a Resend key and never falls back to Resend. The normal worker writes one readable JSON file per delivery with `recipient`, `kind`, `delivered_at` (RFC 3339), and `verification_url`. The link uses the same construction as Resend, including query-parameter encoding. Capture failures propagate through normal job handling; delivery succeeds only after the file has been written and published. Configuration validation does not create the directory; delivery creates it as needed.

Captures are email content, not operational logs: they contain email addresses and verification secrets. Keep them private and do not commit or publish them. On Unix, newly created directories/files use owner-only permissions. Completed captures have a `.json` extension; `.tmp` files may remain from interrupted or failed deliveries. See [Central playground](../../docs/central-playground.md) for local startup and retrieval.

`Config` validates these cross-field constraints before the server opens a database connection, starts workers, or binds a listener. Production rejects local capture, including when `CENTRAL_ENVIRONMENT` is omitted.

Production deployment configuration must explicitly retain `CENTRAL_ENVIRONMENT=production`. This runtime guard cannot prevent an operator from explicitly declaring a production deployment to be `development`. Compile-time exclusion of local capture is outside this configuration guard's scope.

### Integration tests

Start the root-owned shared integration database once, then run integration tests through the Central package script. Tests require the service to be running and never manage its lifecycle:

```bash
pnpm test:integration:db:start
pnpm --filter central test:integration
```

To run one integration-test crate against the already-running database:

```bash
pnpm --filter central test:integration --test queue_test
```

Integration-test tracing is disabled by default. Set `CENTRAL_TEST_LOG` to one of `error`, `warn`, `info`, `debug`, or `trace` to capture traces for a failed test without adding noise to successful runs:

```bash
CENTRAL_TEST_LOG=debug pnpm --filter central test:integration --test queue_test
```

For live trace output while investigating a hang or order-dependent behavior, forward Cargo's test-harness `--nocapture` argument after its required separator:

```bash
CENTRAL_TEST_LOG=debug pnpm --filter central test:integration --test queue_test -- --nocapture
```

Arguments are forwarded to Cargo, so standard test selection and filtering remain available. The `--` before `--nocapture` is Cargo's required test-harness separator.

The root `pnpm test:integration` command retains the full integration selection. For comprehensive API and UI validation use `pnpm validate:central`. See [validation and shared-database coordination](../../docs/validation.md) before stopping or cleaning shared data, or testing across branches with different migrations.

### Database interaction and migration

This repository uses [`sqlx`](https://github.com/launchbadge/sqlx) for database connectivity and migrations.

#### Migration commands

- **Create a new migration (no running database required):**
    ```bash
    cargo sqlx migrate add <migration_name>
    ```

- **Run and check migrations (requires running database):**
    - Ensure your database connection is configured in `.env` (see `.env.example` for required variables, e.g. `DATABASE_URL`).
    - Run migrations:
        ```bash
        cargo sqlx migrate run
        ```
    - Check migration status:
        ```bash
        cargo sqlx migrate info
        ```
    - Revert the last migration:
        ```bash
        cargo sqlx migrate revert
        ```

#### Troubleshooting

- If you encounter connection errors, verify that your database is running and your `.env` configuration is correct.
- For more details, see the [`sqlx-cli` documentation](https://github.com/launchbadge/sqlx/blob/main/sqlx-cli/README.md) and the [`sqlx` docs](https://github.com/launchbadge/sqlx).
## Password recovery deployment

Central UI serves `/forgot-password` and `/reset-password`. Central accepts
`POST /auth/forgot-password` (`email`) and `POST /auth/reset-password` (`token`,
`password`); both require the Central UI BFF Machine Credential, not a User
Session Token. Recovery only replaces an existing password credential.

Set `WEB_APP_URL` to the public Central UI origin before deploying. Provision and
publish a Resend template with identifier **`password-reset`**, subject
`[Ethoko Central] Reset your password`, and these variables:

- `reset_url`: the complete, encoded `/reset-password?token=…` link.
- `expiry_minutes`: numeric `60` (one hour from worker issuance).

**Provider-hosted template provisioning is an external deployment prerequisite;
it is not performed by this repository.** Development `local-capture` delivery
writes `password-reset` messages with `reset_url` and `expiry_minutes` to the
configured private email-capture directory, without requiring a provider template.

`PASSWORD_RESET_COOLDOWN_SECONDS` configures resend cooldown (default `60`).
Generic confirmations always return the configured `cooldownSeconds`, including
unknown emails, GitHub-only Users, and cooldown-suppressed requests.

Recovery reuses `otp_request`, retaining consumed history so superseded links
never become usable again. Worker delivery precedes recording, as in verification:
retries may generate replacement links and request order does not determine token
order. Queuing alone does not invalidate a recorded link. These accepted delivery
and cooldown limitations are tracked in #189.
