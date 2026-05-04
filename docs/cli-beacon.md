# cli-beacon guideline

Code style rules and guidelines for `packages/cli-beacon/`.

## File Organization

```
packages/cli-beacon/
├── src/                               # Source backing package exports
│   ├── client/                        # CLI commands shared abstractions
│   ├── commands/                      # CLI command definitions and handlers (consumes client methods), export `run<CommandName>Command` for testing
│   ├── config/                        # CLI configuration management
│   ├── ethoko-artifacts/              # Ethoko artifact definitions
│   ├── pulled-artifact-store/         # Pulled artifact store read/write logic
│   ├── solc-artifacts/                # Solc artifact definitions
│   ├── storage-provider/              # Storage provider interfaces and implementations
│   ├── supported-origins/             # Supported origins for artifacts with mapping logic (e.g., Hardhat, Foundry)
│   ├── ui/                            # CLI UI command logger (spinners, loggers, etc.) and colours
│   └── utils/                         # Utility functions and helpers
├── templates-builder/                 # Template for generated typescript typings (through `typings` command)
├── test/                              # End to end tests for `commands` methods (Vitest)
├── package.json                       # Package metadata and exports map
└── README.md                          # Public API overview and usage
```

## Imports

**Order:** Built-in modules -> Third-party packages -> Internal modules. Separate each group with a blank line.

```typescript
import fs from "node:fs/promises";

import { z } from "zod";

import { LOG_COLORS } from "@/ui";
import { toAsyncResult } from "@/utils/result";
```

**Aliases:** Use `@/` path aliases for cross-directory imports. Use relative (`./`) for same-directory imports only.

## Naming

| Category                     | Convention                   | Example                                                |
| ---------------------------- | ---------------------------- | ------------------------------------------------------ |
| Zod schemas                  | PascalCase + `Schema` suffix | `TagManifestSchema`, `AbiSchema`                       |
| Types inferred from Zod      | `z.infer<typeof XSchema>`    | `type TagManifest = z.infer<typeof TagManifestSchema>` |
| Constants                    | SCREAMING_SNAKE_CASE         | `LOG_COLORS`, `VERSION`                                |
| Files                        | kebab-case                   | `artifact-key.ts`, `s3-bucket-provider.ts`             |

## Type Safety

- **Public APIs** must have explicit return types.
- **User input** must be validated with `safeParse`. Never use `parse` on untrusted data.
- **Trusted/internal data** may use `parse`.
- **Format Zod errors** with `z.prettifyError(result.error)`.
- **Use `z.NEVER`** in Zod transforms to signal invalid state.
- **Prefer discriminated unions** for result types:

```typescript
type Result<T> =
  | { status: "success"; value: T }
  | { status: "error"; reason: string };
```

## Error handling tiers

| Layer                                   | Throw                                                  | Catch                                                                                                |
| --------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **Client** (`src/client/*`)             | `CliError` only. Wrap async ops with `toAsyncResult()` | Never catches -- propagates up                                                                       |
| **Internal** (`src/` outside `client/`) | Standard `Error`                                       | N/A                                                                                                  |
| **Commands** (`src/commands/*`)         | Never throws in                                           | Catches all: `CliError` -> show message; other -> generic message + dump. Set `process.exitCode = 1` |

## Command handlers (`src/commands/*`)

Export command handlers post-parsing logic as async functions to be used in tests, they MUST throw CliError on errors.
```typescript
export async function runInspectCommand(
  artifactKey: ArtifactKey,
  dependencies: {
    storageProvider: StorageProvider;
    pulledArtifactStore: PulledArtifactStore;
    logger: CommandLogger;
  },
  opts: { debug: boolean; json?: boolean },
): Promise<InspectResult> {
  ...
}
```

Use it in the command definition with error catching: distinguish `CliError` (show message) from unexpected errors (generic message + dump):

```typescript
await runInspectCommand(
    artifactKeyParsingResult.data,
    {
      storageProvider,
      pulledArtifactStore,
      logger,
    },
    {
      debug: optsParsingResult.data.debug,
    },
  ).catch((err) => {
    if (err instanceof CliError) {
      logger.error(err.message);
    } else {
      logger.error(
        "An unexpected error occurred, please fill an issue with the error details if the problem persists",
      );
      console.error(err);
    }
    process.exitCode = 1;
  });
```

Use `process.exitCode = 1` instead of `process.exit()`.


## Exhaustive Checks

Use `satisfies never` for exhaustive switch/if-else checks on discriminated unions:

```typescript
default:
  type satisfies never;
```

## Console Output

- Use `CommandLogger` (from `src/ui/index.ts`) in command handlers: `logger.success()`, `logger.error()`, `logger.warn()`, `logger.info()`.
- Use `DebugLogger` (from `src/utils/debug-logger.ts`) for debug logs in the rest of the codebase, controlled by `opts.debug` flags.
- **All output goes to stderr.** Stdout is reserved exclusively for JSON output (e.g., `inspect` command).

## Function Signatures

Use dependencies as positional params, options as a final `opts` object:

```typescript
async function pullProject(
  project: string,
  dependencies: {
    storageProvider: StorageProvider;
    pulledArtifactStore: PulledArtifactStore;
    logger: DebugLogger;
  },
  opts: { force: boolean; debug: boolean; },
): Promise<PullResult> {}
```


## E2E test architecture

- **Location:** `test/e2e/*.e2e.test.ts`
- **Global setup:** `test/setup.ts` starts LocalStack (Docker), creates TestSession with unique ID
- **Dual-provider testing:** Every test runs against both Filesystem and S3 via `describe.for(STORAGE_PROVIDER_STRATEGIES)`
- **Scoped fixtures:** `storageProviderTest.scoped({ storageProviderFactory })` provides `storageProvider` and `pulledArtifactStore` -- auto-created and auto-cleaned per test
- **Parameterized tests:** `storageProviderTest.for(ARTIFACTS_STRATEGIES)` iterates over all fixture formats (Foundry, Hardhat v2/v3 variants)
- **Project isolation:** `createTestProjectName()` generates `{sessionId}-{name}` to prevent collisions across parallel runs
- **Fixtures:** Real compilation artifacts in `test/fixtures/` from Foundry and Hardhat
- **Debugging:** `inspectS3Bucket()`, `inspectFilesystemStorage()` helpers; `pnpm test:localstack:logs`
