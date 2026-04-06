# Agent Guidelines for Ethoko Monorepo

Guidelines for AI coding agents working in the Ethoko monorepo.

## Project Overview

Ethoko is a warehouse for smart-contract compilation artifacts. It enables teams to version, store, and share smart-contract compilation artifacts, decoupling compilation from operation.
**Monorepo Structure:**

- `packages/cli-beacon`: Standalone CLI for Ethoko artifact management (main package)
- `apps/*`: Integration examples with different frameworks (e.g., Foundry and Hardhat)

## Documentation

CLI delivery strategy overview: `docs/CLI_DELIVERY.md`
Configuration strategy overview: `docs/CONFIG.md`
cli-beacon code style guideline: `docs/CLI_BEACON_CODE_STYLE_GUIDELINE.md`

## Build System

**Package Manager:** pnpm 9.0.0 (required)
**Build Tool:** Turborepo
**Node Version:** `nvm use`

## Test

### E2E Test Pattern for `@ethoko/cli-beacon`

See the skill .opencode/skills/cli-beacon-contributor/SKILL.md for detailed instructions on writing E2E tests for `@ethoko/cli-beacon`.

### E2E Test Pattern for integration apps in `apps/`

**Test Framework:** Vitest with global setup, 60s timeout, located in `e2e-test/*.e2e.test.ts`.

**Key Points:**

- All tests run with the filesystem provider.
- All tests use the same `setup.ts`, `compilation-targets.ts` and `helpers/` for utilites.

## Validation Workflow

**Critical:** Run this validation suite after completing each logical unit of work (feature, bug fix, todo item).

### Steps (run at root level in order)

1. **`pnpm build`** - Build all packages (Turborepo handles dependency order)
2. **`pnpm check-types`** - Typecheck all packages
3. **`pnpm lint`** - Lint all packages (max 0 warnings)
4. **`pnpm format`** - Format all packages
5. **`pnpm test:e2e:core`** - Run all E2E tests for `@ethoko/cli-beacon`
6. **`pnpm test:e2e:apps`** - Run all E2E tests for integration apps

### Failure Handling

If any check fails, **immediately fix the issue** before proceeding with additional work.

### Key Notes

- **When to Run:** After completing a logical unit of work, not after every single file edit.
- **Root-Level Execution:** Always run these commands at the monorepo root to validate all packages.

## @package/cli-beacon File Organization

```
packages/cli-beacon/
├── src/                               # Source backing package exports
│   ├── client/                        # CLI core functionality (pull/push/search implementations)
│   ├── commands/                      # CLI command definitions and handlers (consumes client methods)
│   ├── config/                        # CLI configuration management
│   ├── ethoko-artifacts/              # Ethoko artifact definitions
│   ├── pulled-artifact-store/         # Pulled artifact store read/write logic
│   ├── solc-artifacts/                # Solc artifact definitions
│   ├── storage-provider/              # Storage provider interfaces and implementations
│   ├── supported-origins/             # Supported origins for artifacts with mapping logic (e.g., Hardhat, Foundry)
│   ├── ui/                            # CLI UI command logger (spinners, loggers, etc.) and colours
│   └── utils/                         # Utility functions and helpers
├── templates-builder/                 # Template for generated typescript typings (through `typings` command)
├── test/                              # End to end tests for `client` methods (Vitest)
├── package.json                       # Package metadata and exports map
└── README.md                          # Public API overview and usage
```

## Git Workflow

- Commit messages should be concise and descriptive
- Run the complete validation workflow (see "Validation Workflow" section) before committing

## Plan Mode

When creating multi-step plans:

- Keep plans extremely concise - sacrifice grammar for brevity
- End each plan with unresolved questions (if any)
