# Contributing to Ethoko

Thank you for your interest in contributing to Ethoko! We welcome contributions from the community to help improve and enhance the project. Below are some guidelines to help you get started.

### Prerequisites

This repository is a monorepo managed with [Turborepo](https://turborepo.dev/).

A [.nvmrc](https://github.com/nvm-sh/nvm) file is provided to ensure a consistent `Node.js` version accross the monorepo.

```bash
nvm use
```

### Apps and Packages

- `apps/`: integration example of Ethoko with Hardhat v2, Hardhat v3 and Foundry with Ethoko,
- `@ethoko/eslint-config`: `eslint` configurations,
- `@ethoko/typescript-config`: `tsconfig.json`s used throughout the monorepo,
- `@ethoko/core`: core Ethoko libraries and CLI client logic.
- `@ethoko/cli-beacon`: standalone Ethoko CLI package.

### Scripts

Check the available scripts in the root `package.json` file. The most used ones are:

- `build`: build all packages,
- `lint`: lint all packages,
- `format`: format all packages,
- `check-format`: check code formatting for all packages,
- `check-types`: typecheck all packages,
- `test:e2e:core`: run end-to-end tests for @ethoko/core,
- `test:e2e:apps`: run end-to-end tests for integration apps.

### Changesets

We use [Changesets](https://github.com/changesets/changesets) to manage versioning and release notes.

- Changes under `apps/` do not require a changeset (integration examples only).
- Any change that impacts `@ethoko/core` or `@ethoko/cli-beacon` must include a changeset.

If a changeset is required, add one before opening your PR:

```bash
pnpm changeset
```
