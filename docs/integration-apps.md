# Integration apps

All repositories in `/apps`, except `apps/central` are integration applications for the Ethoko CLI. They all contain smart contracts, integration with Ethoko is done to showcase and ensure the CLI's compatibility with different frameworks and compilation outputs.

They import the CLI as a local NPM package as `"@ethoko/cli-beacon": "workspace:*"`.

## E2E Test Pattern for integration apps

**Test Framework:** Vitest with global setup, 60s timeout, located in `e2e-test/*.e2e.test.ts`.

**Key Points:**

- All tests run with the filesystem provider.
- All tests use the same `setup.ts`, `compilation-targets.ts` and `helpers/` for utilites.
