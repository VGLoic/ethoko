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

Local capture requires both `CENTRAL_ENVIRONMENT=development` and an explicit `CENTRAL_EMAIL_TRANSPORT=local-capture`, plus a capture directory. It does not require a Resend key. **The local-capture adapter is not implemented yet**, so this selection currently fails with an explicit unavailable error, even with otherwise valid development configuration. It never falls back to Resend. No capture directory is created by configuration validation.

`Config` validates these cross-field constraints before the server opens a database connection, starts workers, or binds a listener. Production rejects local capture, including when `CENTRAL_ENVIRONMENT` is omitted.

Production deployment configuration must explicitly retain `CENTRAL_ENVIRONMENT=production`. This runtime guard cannot prevent an operator from explicitly declaring a production deployment to be `development`. Compile-time exclusion of local capture is outside this configuration guard's scope.

### Integration tests

Run integration tests through the Central package script. It starts the integration database, waits for it to become healthy, runs the tests, and tears the database down afterward:

```bash
pnpm --filter central test:integration
```

To run one integration-test crate while retaining that database lifecycle:

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
