# Agent Guidelines for Ethoko Monorepo

Guidelines for AI coding agents working in the Ethoko monorepo.

## Project Overview

Ethoko is a warehouse for smart-contract compilation artifacts. It enables teams to version, store, and share smart-contract compilation artifacts, decoupling compilation from deployment.
**Monorepo Structure:**

- `packages/core`: Core functionalities of the Ethoko CLI (main package)
- `packages/hardhat-ethoko`: Hardhat V3 plugin for Ethoko
- `packages/hardhat-v2-ethoko`: Hardhat V2 plugin for Ethoko
- `packages/eslint-config`: Shared ESLint configurations
- `packages/typescript-config`: Shared TypeScript configurations
- `apps/*`: Integration examples with different frameworks (e.g., Foundry, Hardhat V2, Hardhat V3)

## Build System

**Package Manager:** pnpm 9.0.0 (required)
**Build Tool:** Turborepo
**Node Version:** >=18 (use `nvm use`)

### Commands

```bash
# Root level
pnpm build              # Build all packages
pnpm test               # Run all tests
pnpm test:e2e:core      # Run E2E tests for @ethoko/core
pnpm test:e2e:apps      # Run E2E tests for integration apps
pnpm lint               # Lint all packages
pnpm format             # Format all packages
pnpm check-types        # Typecheck all packages

# Package-specific (from package directory)
cd packages/core
pnpm build              # Build using tsup
pnpm lint               # ESLint with max 0 warnings
pnpm test:e2e           # Run E2E tests (uses Vitest)

# Run single test file
pnpm vitest run test/e2e/push-pull.e2e.test.ts

# Run single test by name pattern
pnpm vitest run -t "test name pattern"
```

**Test Framework:** Vitest with global setup, 60s timeout, located in `test/**/*.e2e.test.ts` for `packages/core` and `e2e-test/*.e2e.test.ts` for integration apps `apps/`.

### E2E Test Pattern for `@ethoko/core`

E2E tests use a fixture-based pattern with Vitest's `test.extend()` for automatic setup/cleanup:

**Structure:**

```typescript
import {
  STORAGE_PROVIDER_STRATEGIES,
  storageProviderTest,
} from "@test/helpers/storage-provider-test";

describe.for(STORAGE_PROVIDER_STRATEGIES)(
  "Test Suite Name (%s)", // %s = storage provider name
  ([, storageProviderFactory]) => {
    // Scope the storage provider factory for all tests in this suite
    storageProviderTest.scoped({ storageProviderFactory });

    // Simple test
    storageProviderTest(
      "test name",
      async ({ storageProvider, localStorage }) => {
        // Test implementation - fixtures auto-cleanup on completion
      },
    );

    // Parameterized test
    storageProviderTest.for([
      ["Case 1", data1],
      ["Case 2", data2],
    ] as const)(
      "test: %s",
      async ([name, data], { storageProvider, localStorage }) => {
        // Test implementation
      },
    );
  },
);
```

**Key Points:**

- All tests automatically run against both Local Storage and S3 (LocalStack) providers
- Fixtures (`storageProvider`, `localStorage`) are auto-setup and auto-cleaned
- No manual `beforeEach`/`afterEach` needed
- Use `storageProviderTest.for()` instead of `describe.each()` for parameterized tests
- Always use `as const` on test data arrays for better type inference

**Build Dependencies:** Turborepo manages task dependencies. `lint`, `check-types`, and `test` depend on `build` completing first.

## Validation Workflow

**Critical:** Run this validation suite after completing each logical unit of work (feature, bug fix, todo item).

### Steps (run at root level in order)

1. **`pnpm build`** - Build all packages (Turborepo handles dependency order)
2. **`pnpm check-types`** - Typecheck all packages
3. **`pnpm lint`** - Lint all packages (max 0 warnings)
4. **`pnpm format`** - Format all packages
5. **`pnpm test:e2e:core`** - Run all E2E tests for `@ethoko/core`
6. **`pnpm test:e2e:apps`** - Run all E2E tests for integration apps

### Failure Handling

If any check fails, **immediately fix the issue** before proceeding with additional work.

### Key Notes

- **Package Dependencies:** `hardhat-ethoko` and `hardhat-v2-ethoko` depend on `@ethoko/core`. When core changes, Turborepo automatically rebuilds dependent packages during `pnpm build`.
- **When to Run:** After completing a logical unit of work, not after every single file edit.
- **Root-Level Execution:** Always run these commands at the monorepo root to validate all packages.

## Code Style Guidelines

### TypeScript Configuration

**Base Config:** All packages extend `@ethoko/typescript-config/node-base.json`

Key compiler options:

- **Strict mode enabled:** All strict TypeScript checks
- **Module:** NodeNext (ESM + CJS dual output)
- **Target:** ES2022
- **Lib:** ES2022
- **noUncheckedIndexedAccess:** true (array/object access returns `T | undefined`)
- **noUnusedParameters:** true
- **noUnusedLocals:** true
- **isolatedModules:** true

### Import Style

```typescript
// Standard library imports first
import { Dirent } from "fs";
import fs from "fs/promises";
import crypto from "crypto";

// Third-party imports
import { z } from "zod";
import { keccak256 } from "@ethersproject/keccak256";

// Internal imports
import { LOG_COLORS } from "./utils/colors";
import { S3BucketProvider } from "./storage-provider/s3-bucket-provider";
```

**Order:** Built-in modules → External packages → Internal modules

### Formatting

**Formatter:** Prettier (default config, empty `.prettierrc.json`)

- Always run `pnpm format` before committing
- For Solidity files: use `prettier-plugin-solidity`

### ESLint Configuration

**Base:** `@ethoko/eslint-config/base` which includes:

- `@eslint/js` recommended rules
- `typescript-eslint` recommended rules
- `eslint-config-prettier` (disables conflicting rules)
- `eslint-plugin-turbo` (for monorepo-specific rules)
- `eslint-plugin-only-warn` (converts all errors to warnings)

**Max Warnings:** 0 (treat warnings as errors in CI)

**Ignored Paths:** `dist/**`

### Naming Conventions

**Variables/Functions:** camelCase

```typescript
const projectName = "doubtful-counter";
function retrieveFreshCompilationArtifact() {}
```

**Types/Interfaces/Classes:** PascalCase

```typescript
interface StorageProvider {}
class S3BucketProvider implements StorageProvider {}
type CompilerOutputContract = z.infer<typeof ZCompilerOutputContract>;
```

**Zod Schemas:** Prefix with `Z`

```typescript
const ZBuildInfo = z.object({...});
const ZAbi = z.array(...);
```

**Constants:** SCREAMING_SNAKE_CASE for log colors and configuration:

```typescript
export const LOG_COLORS = {
  log: "cyan",
  success: "green",
} as const;
```

### Type Safety

**Use explicit types for public APIs:**

```typescript
export type EthokoHardhatUserConfig = {
  project: string;
  pulledArtifactsPath?: string;
  // ...
};
```

**Prefer Zod schemas for runtime validation:**

```typescript
const EthokoHardhatConfig = z.object({
  project: z.string().min(1),
  pulledArtifactsPath: z.string().default(".ethoko"),
});

const result = EthokoHardhatConfig.safeParse(userInput);
if (!result.success) {
  // Handle validation error
}
```

**Use discriminated unions for results:**

```typescript
type Result<T> =
  | { status: "success"; value: T }
  | { status: "error"; reason: string };
```

### Error Handling

**Use custom error classes for CLI methods:**

All CLI methods (packages/core/src/cli-client/\*) MUST throw `CliError` class instance.

```typescript
export class CliError extends Error {
  constructor(message: string) {
    super(message);
  }
}
```

```typescript
// cli-client method example
const ensureResult = await toAsyncResult(
  localStorage.ensureProjectSetup(project),
  { debug: opts.debug },
);
if (!ensureResult.success) {
  steps.fail("Failed to setup local storage");
  throw new CliError(
    "Error setting up local storage, is the script not allowed to write to the filesystem? Run with debug mode for more info",
  );
}
```

**Use standard `Error` for internal methods:**

Internal methods can diretly throw `Error` instances, no further wrapping is needed for now.

**Use result wrappers for async operations:**

```typescript
export function toAsyncResult<T, TError = Error>(
  promise: Promise<T>,
  opts: {
    debug?: boolean;
  } = {},
): Promise<{ success: true; value: T } | { success: false; error: TError }> {
  return promise
    .then((value) => ({ success: true as const, value }))
    .catch((error) => {
      if (opts.debug) {
        console.error(
          styleText(
            LOG_COLORS.error,
            error instanceof Error
              ? error.stack || error.message
              : String(error),
          ),
        );
      }
      return { success: false as const, error };
    });
}
```

**Error handling pattern when interacting with CLI methods:**

```typescript
await pull(
  optsParsingResult.data.project,
  search,
  storageProvider,
  localStorage,
  {
    force: optsParsingResult.data.force,
    debug: ethokoConfig.debug || optsParsingResult.data.debug,
  },
)
  .then((result) => displayPullResults(optsParsingResult.data.project, result))
  .catch((err) => {
    if (err instanceof CliError) {
      cliError(err.message);
    } else {
      cliError(
        "An unexpected error occurred, please fill an issue with the error details if the problem persists",
      );
      console.error(err);
    }
    process.exitCode = 1;
  });
```

### Console Output

Use `LOG_COLORS` and `styleText` for all console output:

```typescript
console.error(styleText(LOG_COLORS.success, "\nOperation successful"));
console.error(styleText(LOG_COLORS.error, "❌ Operation failed"));
console.error(styleText(LOG_COLORS.warn, "⚠️ Warning message"));
console.error(styleText(LOG_COLORS.log, "Info message"));
```

Note: Use `console.error()` for task output (not `console.log()`) to ensure proper streaming in Hardhat tasks.

## File Organization

```
packages/core/
├── src/                               # Source backing package exports
│   ├── cli-client/                    # CLI client entrypoints (push/pull/diff/typings)
│   ├── cli-ui/                        # CLI UI primitives (spinners, output helpers)
│   ├── storage-provider/              # Storage provider interfaces and implementations
│   ├── utils/                         # Utility functions and helpers
│   │   ├── supported-origins/         # Logic for mapping supported artifact formats to Ethoko format
│   │   ├── ethoko-artifacts-schemas/  # Zod schemas for Ethoko artifact formats
│   │   └── solc-artifact-schemas/     # Zod schemas for standard solc artifact formats
│   └── local-storage.ts               # Local artifact storage read/write utilities
├── package.json                       # Package metadata and exports map
└── README.md                          # Public API overview and usage
```

## Best Practices

1. **Always validate user input with Zod** before processing
2. **Use async/await** over raw promises
3. **Prefer explicit return types** for public functions
4. **Use `opts` pattern** for function options (better than multiple params)
5. **Handle both ScriptError and unexpected errors** in all task handlers
6. **Use descriptive variable names** - clarity over brevity
7. **Comment complex algorithms** but keep code self-documenting
8. **Use TypeScript's strict null checks** - avoid `!` assertions
9. **Leverage Zod's `safeParse`** instead of `parse` to handle errors gracefully
10. **Use `process.exitCode`** instead of `process.exit()` in tasks

## Git Workflow

- Commit messages should be concise and descriptive
- Run the complete validation workflow (see "Validation Workflow" section) before committing
- Generated files in `.ethoko/` and `.ethoko-typings/` are gitignored
- Build outputs (`dist/`, `.next/`, etc.) are gitignored

## Plan Mode

When creating multi-step plans:

- Keep plans extremely concise - sacrifice grammar for brevity
- End each plan with unresolved questions (if any)
