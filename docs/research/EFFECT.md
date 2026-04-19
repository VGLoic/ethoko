# Effect.ts Integration Research

## Overview

[Effect](https://effect.website/) is a TypeScript library that brings typed errors, dependency injection, and composable async workflows into plain TypeScript. This document explores how to progressively integrate it into `cli-beacon` to improve error management.

---

## Why Effect.ts fits cli-beacon

The codebase already leans toward functional patterns — `toAsyncResult`/`toResult` in `src/utils/result.ts` is a hand-rolled Result type, which is exactly what Effect formalises. The gaps Effect fills:

| Current pain point | Effect solution |
|--------------------|-----------------|
| Errors are `unknown` at call-sites — callers can't know what can fail | `Effect<A, E, R>` encodes the error type `E` in the signature |
| Result type is ad-hoc and not composable | Effects compose with `pipe`, `flatMap`, `gen` |
| `CliError` vs raw `Error` vs `unknown` mixed in `catch` blocks | `Data.TaggedError` gives discriminated, typed error variants |
| `StorageProvider` injected manually through every call chain | `Context`/`Layer` makes dependencies explicit and testable |
| No structured way to combine errors from parallel ops | `Effect.all`, `Effect.allSettled` accumulate typed errors |

---

## Core Concepts Needed

### 1. `Effect<A, E, R>`

The main type. Think of it as a `Promise<A>` but with:
- `E` — the typed set of errors that can occur
- `R` — the services/dependencies required to run

```typescript
// Before
async function loadConfig(): Promise<EthokoCliConfig> { ... }
// errors are unknown

// After
import { Effect } from "effect";
function loadConfig(): Effect.Effect<EthokoCliConfig, ConfigError> { ... }
// ConfigError is explicit in the type
```

### 2. `Data.TaggedError` — typed error hierarchy

Replace ad-hoc `CliError extends Error` with a discriminated union of tagged errors:

```typescript
import { Data } from "effect";

// Each variant is its own class with a _tag discriminant
export class ConfigNotFoundError extends Data.TaggedError("ConfigNotFoundError")<{
  path: string;
}> {}

export class ConfigParseError extends Data.TaggedError("ConfigParseError")<{
  path: string;
  cause: unknown;
}> {}

export class StorageError extends Data.TaggedError("StorageError")<{
  project: string;
  cause: unknown;
}> {}

// Union for use in effect signatures
export type CliError = ConfigNotFoundError | ConfigParseError | StorageError;
```

This lets `match` (exhaustive switch) at the boundary instead of `instanceof` chains.

### 3. `Effect.try` / `Effect.tryPromise` — wrapping existing code

These are the migration bridge — they wrap any synchronous or async code into an Effect without rewriting internals:

```typescript
import { Effect } from "effect";

// Wraps a Promise (replaces toAsyncResult)
const result = Effect.tryPromise({
  try: () => fs.readFile(path, "utf8"),
  catch: (cause) => new ConfigParseError({ path, cause }),
});

// Wraps a sync function (replaces toResult)
const parsed = Effect.try({
  try: () => JSON.parse(raw),
  catch: (cause) => new ConfigParseError({ path, cause }),
});
```

### 4. `gen` — async/await style composition

Effect provides an ergonomic generator syntax that mirrors `async/await`:

```typescript
import { Effect } from "effect";

const pushArtifact = Effect.gen(function* () {
  const config = yield* loadConfig();           // typed: fails with ConfigError
  const artifacts = yield* findArtifacts(config); // typed: fails with ArtifactError
  yield* upload(config, artifacts);              // typed: fails with StorageError
  // No try/catch needed — errors propagate up typed
});
// Return type: Effect<void, ConfigError | ArtifactError | StorageError>
```

### 5. `Context` / `Layer` — dependency injection

Replaces the manual threading of `StorageProvider` and `PulledArtifactStore` through function arguments:

```typescript
import { Context, Layer, Effect } from "effect";

// Define a service tag
export class StorageProviderService extends Context.Tag("StorageProviderService")<
  StorageProviderService,
  StorageProvider
>() {}

// Use it anywhere — no need to pass it explicitly
const list = Effect.gen(function* () {
  const storage = yield* StorageProviderService;
  return yield* Effect.tryPromise({
    try: () => storage.listTags(project),
    catch: (cause) => new StorageError({ project, cause }),
  });
});

// Provide the implementation at the CLI entry point
const FilesystemLayer = Layer.succeed(StorageProviderService, new FilesystemStorageProvider(...));
Effect.runPromise(list.pipe(Effect.provide(FilesystemLayer)));
```

### 6. `Effect.runPromise` — the exit point

At the CLI boundary, convert back to a Promise/imperative style:

```typescript
import { Effect, Exit, Cause } from "effect";

// Run and get back a Promise
await Effect.runPromise(myEffect);

// Run and get a structured Exit (Success | Failure) for error reporting
const exit = await Effect.runPromiseExit(myEffect);
Exit.match(exit, {
  onSuccess: () => {},
  onFailure: (cause) => {
    const error = Cause.failureOption(cause);
    // error is typed — match on _tag
  },
});
```

---

## Progressive Migration Strategy

The goal is to migrate incrementally without breaking existing functionality. Each phase is independently shippable.

### Phase 0 — Install & configure (no code changes)

```bash
npm install effect
```

Effect has zero runtime dependencies and tree-shakes well. It can coexist with current code.

---

### Phase 1 — Replace `result.ts` with Effect primitives

**Scope:** `src/utils/result.ts` only.

Replace `toAsyncResult` / `toResult` with thin wrappers that return Effects but expose the same `{ success, value/error }` shape for callers that haven't migrated yet.

```typescript
// src/utils/result.ts — new version
import { Effect, Exit, Cause } from "effect";

// Keep the old shape for backward compat during migration
export type Result<T, E> = { success: true; value: T } | { success: false; error: E };

// Bridge: run an Effect and return a Result (for unmigrated callers)
export async function runToResult<A, E>(
  effect: Effect.Effect<A, E>
): Promise<Result<A, E>> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return { success: true, value: exit.value };
  const err = Cause.failureOption(exit.cause);
  return { success: false, error: err._tag ? err : (err as E) };
}

// New-style helper: wrap Promise → Effect (replaces toAsyncResult)
export function fromPromise<A, E>(
  promise: () => Promise<A>,
  mapError: (cause: unknown) => E
): Effect.Effect<A, E> {
  return Effect.tryPromise({ try: promise, catch: mapError });
}
```

Callers can keep using the `result.success` pattern while new code uses Effect directly.

---

### Phase 2 — Migrate error types to `Data.TaggedError`

**Scope:** `src/client/error.ts`, add `src/errors.ts`.

Create typed error variants. Keep `CliError` as a union type alias for all variants so existing `instanceof CliError` checks still work at the top-level catch in commands.

```typescript
// src/errors.ts
import { Data } from "effect";

export class ConfigNotFoundError extends Data.TaggedError("ConfigNotFoundError")<{
  path: string;
}> {}

export class ConfigParseError extends Data.TaggedError("ConfigParseError")<{
  path: string;
  cause: unknown;
}> {}

export class StorageError extends Data.TaggedError("StorageError")<{
  project: string;
  operation: string;
  cause: unknown;
}> {}

export class ArtifactNotFoundError extends Data.TaggedError("ArtifactNotFoundError")<{
  project: string;
  ref: string; // tag or id
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  message: string;
}> {}

// Union for use at command boundaries
export type CliError =
  | ConfigNotFoundError
  | ConfigParseError
  | StorageError
  | ArtifactNotFoundError
  | ValidationError;
```

---

### Phase 3 — Migrate `config/` to return Effects

**Scope:** `src/config/global-config.ts`, `src/config/local-config.ts`, `src/config/index.ts`.

Config loading is a contained, pure function with no side effects beyond file I/O — ideal first real migration target.

```typescript
// src/config/global-config.ts (excerpt)
import { Effect } from "effect";
import { ConfigNotFoundError, ConfigParseError } from "../errors.js";

export function loadGlobalConfig(
  configPath: string
): Effect.Effect<GlobalConfig, ConfigNotFoundError | ConfigParseError> {
  return Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => fs.readFile(configPath, "utf8"),
      catch: () => new ConfigNotFoundError({ path: configPath }),
    });

    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw),
      catch: (cause) => new ConfigParseError({ path: configPath, cause }),
    });

    const validated = yield* Effect.try({
      try: () => GlobalConfigSchema.parse(parsed),
      catch: (cause) => new ConfigParseError({ path: configPath, cause }),
    });

    return validated;
  });
}
```

Commands that call `getConfig()` stay unchanged because `runToResult` from Phase 1 bridges them.

---

### Phase 4 — Migrate `StorageProvider` to a `Layer`

**Scope:** `src/storage-provider/`, `src/commands/utils/storage-provider.ts`.

Define a service tag and wrap the implementations. This removes the need to pass `storageProvider` through every client function.

```typescript
// src/storage-provider/service.ts
import { Context, Layer, Effect } from "effect";
import type { StorageProvider } from "./storage-provider.interface.js";
import { StorageError } from "../errors.js";

export class StorageProviderService extends Context.Tag("StorageProviderService")<
  StorageProviderService,
  StorageProvider
>() {}

// Helper: lift a StorageProvider method into an Effect
export function callStorage<A>(
  op: (s: StorageProvider) => Promise<A>,
  mapError: (cause: unknown) => StorageError
): Effect.Effect<A, StorageError, StorageProviderService> {
  return Effect.gen(function* () {
    const storage = yield* StorageProviderService;
    return yield* Effect.tryPromise({ try: () => op(storage), catch: mapError });
  });
}
```

---

### Phase 5 — Migrate client functions to full Effects

**Scope:** `src/client/*.ts`, one command at a time.

Start with a self-contained command like `inspect` or `artifacts` (read-only, less risky), then move to `push`/`pull`.

```typescript
// src/client/push.ts (migrated excerpt)
import { Effect } from "effect";
import { callStorage } from "../storage-provider/service.js";

export const pushArtifact = (opts: PushOptions) =>
  Effect.gen(function* () {
    const config = yield* loadConfig();
    const artifacts = yield* findArtifacts(config.artifactPath);

    for (const artifact of artifacts.value) {
      yield* callStorage(
        (s) => s.uploadArtifact(opts.project, artifact),
        (cause) => new StorageError({ project: opts.project, operation: "upload", cause }),
      );
    }
  });
// Type: Effect<void, ConfigError | ArtifactError | StorageError, StorageProviderService>
```

---

### Phase 6 — Migrate command entry points

**Scope:** `src/commands/*.ts`.

The final step: replace manual Result-checking with Effect error handling at the CLI boundary. This is where all error types get matched and turned into user-visible messages.

```typescript
// src/commands/push.ts (migrated)
import { Effect, Exit, Cause, Match } from "effect";

export const pushCommand = new Command("push")
  .action(async (opts) => {
    const program = pushArtifact(opts).pipe(
      Effect.provide(makeStorageLayer(opts)),
    );

    const exit = await Effect.runPromiseExit(program);

    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause);
      // Exhaustive match — TS enforces all variants are handled
      Match.value(error).pipe(
        Match.tag("ConfigNotFoundError", (e) => logger.error(`Config not found: ${e.path}`)),
        Match.tag("ConfigParseError", (e) => logger.error(`Invalid config at ${e.path}`)),
        Match.tag("StorageError", (e) => logger.error(`Storage failed: ${e.operation}`)),
        Match.tag("ArtifactNotFoundError", (e) => logger.error(`Artifact not found: ${e.ref}`)),
        Match.orElse(() => logger.error("An unexpected error occurred")),
      );
      process.exitCode = 1;
    }
  });
```

---

## What to Skip (at least initially)

Effect has a large surface area. These features are powerful but not needed for the migration goals:

- **`Schema`** — Effect ships its own schema library. Replacing Zod is optional and would be a large separate effort. Keep Zod.
- **`Stream`**  — The storage provider uses Node.js `Stream` today. Effect's `Stream` is powerful but the interop adds complexity. Migrate only if streaming logic becomes a pain point.
- **`Fiber` / `Queue` / `Deferred`**  — Concurrency primitives. Not needed unless the CLI gets background workers.
- **`Runtime`**  — Custom runtimes. The default `Effect.runPromise` is sufficient for a CLI.

---

## Interop Cheatsheet

| Current pattern | Effect equivalent |
|---|---|
| `toAsyncResult(promise)` | `Effect.tryPromise({ try, catch })` |
| `toResult(() => fn())` | `Effect.try({ try, catch })` |
| `result.success ? ... : ...` | `Effect.match` or `gen` with typed error |
| `Promise.all([a, b])` | `Effect.all([a, b])` (fails fast) |
| `Promise.allSettled([a, b])` | `Effect.all([a, b], { mode: "either" })` |
| `new CliError("msg")` | `new SomeTaggedError({ ... })` |
| `instanceof CliError` at boundary | `Match.tag(...)` exhaustive match |
| Passing `storageProvider` as argument | `yield* StorageProviderService` inside Effect |
| `async function fn(): Promise<T>` | `fn(): Effect.Effect<T, E, R>` |

---

## Migration Checklist

- [ ] Phase 0: Install `effect`
- [ ] Phase 1: Update `src/utils/result.ts` — add `runToResult` bridge
- [ ] Phase 2: Create `src/errors.ts` with `Data.TaggedError` variants
- [ ] Phase 3: Migrate `src/config/` to return Effects
- [ ] Phase 4: Define `StorageProviderService` tag and `callStorage` helper
- [ ] Phase 5: Migrate client functions one command at a time (start: `inspect`, `artifacts`)
- [ ] Phase 6: Migrate command entry points to use `runPromiseExit` + `Match.tag`
