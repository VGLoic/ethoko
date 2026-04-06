# Reference: cli-beacon Architecture

## Source directory map

```
src/
├── index.ts                        # CLI entrypoint: Commander program, registers all commands
├── version.ts                      # VERSION constant (build-time injected via __ETHOKO_VERSION__)
├── client/                         # Core business logic (consumed by commands)
│   ├── index.ts                    # Barrel re-export of all client methods + CliError
│   ├── error.ts                    # CliError class
│   ├── pull.ts                     # pullProject(), pullArtifact()
│   ├── push.ts                     # push()
│   ├── diff.ts                     # generateDiffWithTargetRelease()
│   ├── inspect.ts                  # inspectArtifact()
│   ├── prune.ts                    # pruneArtifact(), pruneProjectArtifacts(), pruneOrphanedAndUntaggedArtifacts()
│   ├── export-contract-artifact.ts # exportContractArtifact()
│   ├── list-pulled-artifacts.ts    # listPulledArtifacts()
│   ├── restore.ts                  # restore()
│   ├── generate-typings.ts         # generateProjectTypings(), generateTagTypings()
│   └── helpers/                    # Internal helpers (not re-exported)
├── commands/                       # Commander command definitions (register + handle)
│   ├── utils/
│   │   ├── parse-project-or-artifact-key.ts  # Zod schema for PROJECT[:TAG|@ID]
│   │   ├── storage-provider.ts               # createStorageProvider() factory
│   │   └── installation.ts                   # detectInstallMethod(), upgrade helpers
│   └── *.ts                        # One file per command: registerXCommand()
├── config/                         # Configuration loading and merging
│   └── index.ts                    # EthokoCliConfig class, loadConfig(), mergeConfigs()
├── ethoko-artifacts/               # Ethoko artifact Zod schemas and ID derivation
├── pulled-artifact-store/          # Local filesystem artifact store (PulledArtifactStore class)
├── solc-artifacts/                 # Solidity compiler artifact Zod schemas
├── storage-provider/               # Remote storage backends
│   ├── storage-provider.interface.ts  # StorageProvider interface
│   ├── filesystem-storage-provider.ts
│   └── s3-bucket-provider.ts
├── supported-origins/              # Compiler artifact format detection and mapping
│   ├── infer-original-artifact-format.ts
│   ├── map-original-artifact-to-ethoko-artifact.ts
│   ├── forge-v1/                   # Foundry artifact support
│   ├── hardhat-v2/                 # Hardhat v2 artifact support
│   └── hardhat-v3/                 # Hardhat v3 artifact support
├── ui/
│   └── index.ts                    # CommandLogger class, LOG_COLORS, Spinner interface
└── utils/
    ├── result.ts                   # toAsyncResult(), toResult()
    ├── path.ts                     # AbsolutePath, RelativePath classes
    └── artifact-key.ts             # ArtifactKey discriminated union type
```

## Key types

| Type                            | Location                                             | Description                                                                                                             |
| ------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `CliError`                      | `src/client/error.ts`                                | User-facing error. All client methods throw this, never raw `Error`                                                     |
| `StorageProvider`               | `src/storage-provider/storage-provider.interface.ts` | Interface for remote storage (S3, filesystem)                                                                           |
| `PulledArtifactStore`           | `src/pulled-artifact-store/`                         | Local filesystem cache for pulled artifacts                                                                             |
| `EthokoCliConfig`               | `src/config/index.ts`                                | Merged global + local config with `.getProjectConfig()`                                                                 |
| `CommandLogger`                 | `src/ui/index.ts`                                    | Structured terminal output (all to stderr). Methods: `.success()`, `.error()`, `.warn()`, `.info()`, `.createSpinner()` |
| `ArtifactKey`                   | `src/utils/artifact-key.ts`                          | `{ project, type: "tag", tag } \| { project, type: "id", id }`                                                          |
| `AbsolutePath` / `RelativePath` | `src/utils/path.ts`                                  | Path wrapper classes with `.join()`, `.dirname()`, `.relativeTo()`                                                      |

## Error handling tiers

| Layer                                   | Throw                                                  | Catch                                                                                                |
| --------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **Client** (`src/client/*`)             | `CliError` only. Wrap async ops with `toAsyncResult()` | Never catches -- propagates up                                                                       |
| **Internal** (`src/` outside `client/`) | Standard `Error`                                       | N/A                                                                                                  |
| **Commands** (`src/commands/*`)         | Never throws                                           | Catches all: `CliError` -> show message; other -> generic message + dump. Set `process.exitCode = 1` |

## E2E test architecture

- **Location:** `test/e2e/*.e2e.test.ts`
- **Global setup:** `test/setup.ts` starts LocalStack (Docker), creates TestSession with unique ID
- **Dual-provider testing:** Every test runs against both Filesystem and S3 via `describe.for(STORAGE_PROVIDER_STRATEGIES)`
- **Scoped fixtures:** `storageProviderTest.scoped({ storageProviderFactory })` provides `storageProvider` and `pulledArtifactStore` -- auto-created and auto-cleaned per test
- **Parameterized tests:** `storageProviderTest.for(ARTIFACTS_STRATEGIES)` iterates over all fixture formats (Foundry, Hardhat v2/v3 variants)
- **Project isolation:** `createTestProjectName()` generates `{sessionId}-{name}` to prevent collisions across parallel runs
- **Fixtures:** Real compilation artifacts in `test/fixtures/` from Foundry and Hardhat
- **Debugging:** `inspectS3Bucket()`, `inspectFilesystemStorage()` helpers; `pnpm test:localstack:logs`

## Key dependencies

| Package              | Purpose                                                                               |
| -------------------- | ------------------------------------------------------------------------------------- |
| `commander`          | CLI framework (commands, options, arguments)                                          |
| `zod` (v4)           | Schema validation. Use `safeParse` for user input, `parse` for trusted data           |
| `@clack/prompts`     | Interactive terminal UI (select, confirm, text). Accessed via `CommandLogger.prompts` |
| `@aws-sdk/client-s3` | S3 storage provider                                                                   |
| `tsup`               | Build tool (ESM, `.d.mts` types, shebang injection)                                   |
| `vitest` (v4)        | Test framework (3 projects: e2e, unit, typecheck)                                     |

## Build configuration

- **Entry:** `src/index.ts` -> `dist/index.js` (ESM only)
- **Shebang:** `#!/usr/bin/env node` injected by tsup
- **Version:** `__ETHOKO_VERSION__` replaced at build time from `package.json`
- **Templates:** `templates/` copied to `dist/` via tsup `publicDir`
- **Path aliases:** Resolved by tsup at build time (`@/` -> `src/`)
