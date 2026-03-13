# Contributing to @ethoko/cli-beacon
## Running Tests

This package uses Vitest for E2E testing with LocalStack to simulate AWS S3.

Prerequisites:

- Docker and Docker Compose

Commands:

```bash
# Run all E2E tests
pnpm test:e2e

# Start LocalStack manually (for debugging)
pnpm test:localstack:up

# View LocalStack logs
pnpm test:localstack:logs

# Stop LocalStack
pnpm test:localstack:down
```

Test Architecture:

- Single S3 bucket shared across all tests
- Each test run gets a unique session ID
- Each test uses a scoped project name: `{sessionId}-{projectName}`
- Tests run in parallel (up to 4 concurrent)
- Session cleanup removes all test artifacts

Debugging Failed Tests:

Use debugging helpers in test code:

```ts
await inspectS3Bucket(storageProvider, project);
await inspectLocalStorage(localProvider, project);
```

Or check LocalStack logs:

```bash
pnpm test:localstack:logs
```
