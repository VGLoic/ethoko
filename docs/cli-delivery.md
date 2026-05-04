# CLI Delivery Strategy

## Goal

Provide a standalone Ethoko CLI that works for Foundry and CI/CD without Hardhat.

## Core Idea: Beacon Pattern

We publish two types of npm packages with distinct roles:

- `@ethoko/cli-beacon` (source package)
  - Contains the CLI source code, including command declarations and core logic.
  - Published by Changesets and can run in Node.js: `npx @ethoko/cli-beacon ...`.
  - Lives in `packages/cli-beacon/` and is used by integration tests.

- `@ethoko/cli` (generated wrapper)
  - Thin `bin/ethoko` wrapper with `optionalDependencies` on platform packages.
  - Resolves the correct platform binary via `require.resolve`.
  - No Node.js fallback; if the platform package is missing, it errors with guidance.
  - Generated at publish time by `packages/cli-beacon/scripts/publish-cli.ts` and not committed.

Each supported platform has a generated package:

- `@ethoko/cli-darwin-arm64`
- `@ethoko/cli-darwin-x64`
- `@ethoko/cli-linux-arm64`
- `@ethoko/cli-linux-x64`
- `@ethoko/cli-windows-x64`

These packages contain the compiled Bun binary and are published alongside `@ethoko/cli`.

## Distribution Paths

1. **npm (primary):**
   - Users install `@ethoko/cli` and get the right binary automatically.
   - Developers and CI can use `@ethoko/cli-beacon` directly for Node.js execution.

2. **Curl install (alternative):**
   - `install.sh` downloads the correct binary from GitHub Releases and installs it to `~/.ethoko/bin`.

3. **GitHub Releases (backing store):**
   - Every release uploads five binaries with tag `cli-v{version}`.

## Release Flow (High Level)

1. Changesets publishes `@ethoko/cli-beacon`.
2. CI builds the 5 Bun binaries.
3. `publish-cli.ts` generates and publishes `@ethoko/cli` and platform packages.
4. CI creates a GitHub Release and uploads binaries.

## Compatibility Guarantees

- All 8 commands mirror the CLI behavior.
