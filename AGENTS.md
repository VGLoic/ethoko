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

## Build System

**Package Manager:** pnpm 9.0.0 (required)
**Build Tool:** Turborepo
**Node Version:** `nvm use`

## Test

### E2E Test Pattern for `@ethoko/cli-beacon`

**Test Framework:** Vitest with global setup, 60s timeout, located in `test/**/*.e2e.test.ts`.

**Key Points:**

- All tests automatically run against both filesystem and S3 (LocalStack) providers
- Fixtures (`storageProvider`, `pulledArtifactStore`) are auto-setup and auto-cleaned
- No manual `beforeEach`/`afterEach` needed
- Use `storageProviderTest.for()` instead of `describe.each()` for parameterized tests
- Always use `as const` on test data arrays for better type inference

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

## Code Style Guidelines

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

**Zod Schemas:** Suffix with `Schema`

```typescript
const BuildInfoSchema = z.object({...});
const AbiSchema = z.array(...);
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
export type EthokoCliUserConfig = {
  project: string;
  pulledArtifactsPath?: string;
  // ...
};
```

**Prefer Zod schemas for runtime validation:**

```typescript
const EthokoCliConfigSchema = z.object({
  project: z.string().min(1),
  pulledArtifactsPath: z.string().default(".ethoko"),
});

const result = EthokoCliConfigSchema.safeParse(userInput);
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

**Use custom error classes for CLI client methods:**

All CLI client methods (packages/cli-beacon/src/client/\*) MUST throw `CliError` class instance.

```typescript
export class CliError extends Error {
  constructor(message: string) {
    super(message);
  }
}
```

```typescript
// client method example
const ensureResult = await toAsyncResult(
  pulledArtifactStore.ensureProjectSetup(project),
  { debug: opts.debug },
);
if (!ensureResult.success) {
  steps.fail("Failed to setup pulled artifact store");
  throw new CliError(
    "Error setting up pulled artifact store, is the script not allowed to write to the filesystem? Run with debug mode for more info",
  );
}
```

**Use standard `Error` for internal methods:**

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
await pullProject(
  optsParsingResult.data.project,
  storageProvider,
  pulledArtifactStore,
  {
    force: optsParsingResult.data.force,
    debug: ethokoConfig.debug || optsParsingResult.data.debug,
  },
)
  .then((result) => displayPullResults(optsParsingResult.data.project, result))
  .catch((err) => {
    if (err instanceof CliError) {
      logger.error(err.message);
    } else {
      logger.error(
        "An unexpected error occurred, please file an issue with the error details if the problem persists",
      );
      console.error(err);
    }
    process.exitCode = 1;
  });
```

### Console Output

Use the instance of `CommandLogger` (packages/cli-beacon/src/ui/index.ts) passed to command handlers for consistent logging.

```typescript
logger.success("Operation successful");
logger.error("Operation failed");
logger.warn("Warning message");
logger.info("Info message");
```

Note: Use `process.stderr` for task output (not `process.stdout`) to ensure proper streaming in Hardhat tasks.

Without access to a logger instance, use `console.error` with `LOG_COLORS` for colored output:

```typescript
console.error(
  styleText(LOG_COLORS.error, "Error message"),
);
```

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

## Best Practices

1. **Always validate user input with Zod** before processing
3. **Prefer explicit return types** for public functions
4. **Use `opts` pattern** for function options (better than multiple params)
5. **Handle both CliError and unexpected errors** in all task handlers
6. **Use descriptive variable names** - clarity over brevity
7. **Comment complex algorithms** but keep code self-documenting
8. **Use TypeScript's strict null checks** - avoid `!` assertions
9. **Leverage Zod's `safeParse`** instead of `parse` to handle errors gracefully
10. **Use `process.exitCode`** instead of `process.exit()` in tasks

## Git Workflow

- Commit messages should be concise and descriptive
- Run the complete validation workflow (see "Validation Workflow" section) before committing

## Plan Mode

When creating multi-step plans:

- Keep plans extremely concise - sacrifice grammar for brevity
- End each plan with unresolved questions (if any)
