---
name: cli-beacon-contributor
description: Guides contributions to the @ethoko/cli-beacon package including adding CLI commands, client methods, E2E tests, storage providers, and supported origins. Use when working in packages/cli-beacon/, adding features to the Ethoko CLI, writing tests for cli-beacon, or implementing new storage backends or compiler artifact formats.
---

# cli-beacon Contributor

## Quick start

- **Package:** `packages/cli-beacon/` (ESM, TypeScript, Commander CLI)
- **Path aliases:** `@/` = `src/`, `@test/` = `test/`
- **Code style:** Read `docs/CLI_BEACON_CODE_STYLE_GUIDELINE.md` before writing code
- **Files:** kebab-case. Co-locate unit tests as `*.test.ts`, type tests as `*.test-d.ts`

## Validation workflow

Run at monorepo root after each logical unit of work:

1. `pnpm build`
2. `pnpm check-types`
3. `pnpm lint` (max 0 warnings)
4. `pnpm format`
5. `pnpm test:e2e:core`
6. `pnpm test:e2e:apps`

Fix failures immediately before proceeding.

## Workflow: New CLI command

1. [ ] Add client method in `src/client/<name>.ts` -- see [EXAMPLES.md](EXAMPLES.md) client skeleton
2. [ ] Re-export from `src/client/index.ts`
3. [ ] Add command handler in `src/commands/<name>.ts` -- see [EXAMPLES.md](EXAMPLES.md) command skeleton
4. [ ] Register in `src/index.ts` via `registerXCommand(program, getConfig)`
5. [ ] Add E2E test in `test/e2e/<name>.e2e.test.ts` -- see [EXAMPLES.md](EXAMPLES.md) test skeleton
6. [ ] Run validation workflow

## Workflow: New client method

1. [ ] Create `src/client/<name>.ts` with explicit return type and `@throws CliError` JSDoc
2. [ ] Use `toAsyncResult()` for async ops, throw `CliError` on failure (never raw `Error`)
3. [ ] Use spinners via `opts.logger.createSpinner()` for user feedback
4. [ ] Re-export from `src/client/index.ts`
5. [ ] Run validation workflow

## Workflow: New E2E test

1. [ ] Create `test/e2e/<name>.e2e.test.ts`
2. [ ] Use `storageProviderTest.for(ARTIFACTS_STRATEGIES)` for parameterized tests
3. [ ] Receive `{ storageProvider, pulledArtifactStore }` from fixtures (auto-cleaned)
4. [ ] Use `createTestProjectName()` for unique names, `CommandLogger` with `silent: true`
5. [ ] Use `as const` on test data arrays for type inference
6. [ ] Run `pnpm test:e2e:core` from monorepo root

## Workflow: New storage provider

1. [ ] Implement `StorageProvider` interface in `src/storage-provider/<name>.ts`
2. [ ] Export from `src/storage-provider/index.ts`
3. [ ] Wire up in `src/commands/utils/storage-provider.ts` factory
4. [ ] Add test factory in `test/helpers/storage-provider-factory.ts`
5. [ ] Run validation workflow

## Workflow: New supported origin

1. [ ] Create `src/supported-origins/<name>/` with `schemas.ts`, `infer-artifact.ts`, `map-to-ethoko-artifact.ts`
2. [ ] Register in `src/supported-origins/infer-original-artifact-format.ts`
3. [ ] Register in `src/supported-origins/map-original-artifact-to-ethoko-artifact.ts`
4. [ ] Add test fixtures in `test/fixtures/`
5. [ ] Add strategy entry to `test/helpers/artifacts-strategy.ts`
6. [ ] Run validation workflow

## References

- **Architecture and key types:** [REFERENCE.md](REFERENCE.md)
- **Code examples:** [EXAMPLES.md](EXAMPLES.md)
- **Code style rules:** `docs/CLI_BEACON_CODE_STYLE_GUIDELINE.md`
- **Test contributing guide:** `packages/cli-beacon/CONTRIBUTING.md`
- **Config model:** `docs/CONFIG.md`
- **CLI delivery:** `docs/CLI_DELIVERY.md`
