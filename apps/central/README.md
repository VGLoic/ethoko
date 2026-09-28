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
