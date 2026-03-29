# Configuration Strategy

## Overview

Ethoko uses a **hybrid global/local configuration model**. Configuration is loaded from up to two JSON files that are merged at runtime, with local settings taking precedence.

```
Priority (high → low):
  1. Local config  ./ethoko.config.json   (walk up from cwd)
  2. Global config ~/.ethoko/config.json
  3. Built-in defaults
```

## Config Files

### Global config — `~/.ethoko/config.json`

User-level configuration. Shared across all repositories on the machine. Typically holds project storage credentials and the pulled artifacts cache path.

```json
{
  "pulledArtifactsPath": "~/.ethoko/pulled-artifacts",
  "projects": [
    {
      "name": "company-contracts",
      "storage": {
        "type": "aws",
        "awsRegion": "us-east-1",
        "awsBucketName": "my-bucket",
        "awsProfile": "work"
      }
    }
  ]
}
```

### Local config — `./ethoko.config.json`

Repository-level configuration. Discovered by walking up from `process.cwd()` to the filesystem root. Holds repo-specific settings like `compilationOutputPath` and any local project overrides.

```json
{
  "compilationOutputPath": "./out",
  "projects": [
    {
      "name": "local-dev",
      "storage": {
        "type": "filesystem",
        "path": "./.ethoko-storage"
      }
    }
  ]
}
```

## Schema

| Field | Scope | Description |
|-------|-------|-------------|
| `pulledArtifactsPath` | global or local | Where pulled artifacts are cached locally. Default: `~/.ethoko/pulled-artifacts` |
| `typingsPath` | local only | Where TypeScript typings are generated. Default: `./.ethoko-typings` |
| `compilationOutputPath` | local only | Where compiled artifacts live (e.g. `./artifacts`, `./out`). Optional |
| `projects` | global and local | List of named projects with storage configs |
| `debug` | global or local | Enable debug logging. Default: `false` |

## Merge Strategy

The two configs are combined into a single `EthokoCliConfig` instance:

- **`pulledArtifactsPath`** — local overrides global; global overrides built-in default
- **`typingsPath`** / **`compilationOutputPath`** — local only, no global equivalent
- **`projects`** — merged by name; a local project with the same name as a global one takes precedence
- **`debug`** — `local || global || false`

```typescript
// Effective project list in this repo:
// - "company-contracts" from global config
// - "local-dev" from local config (would override "company-contracts" if names matched)
const config = await loadConfig();
config.projects;         // merged list
config.localProjectNames;  // Set<string> of names defined in local config
config.globalProjectNames; // Set<string> of names defined in global config
```

## Path Resolution

- **Relative paths** (e.g. `./out`) resolve from `process.cwd()`
- **Home-relative paths** (`~/.ethoko/...`) are expanded to absolute paths
- **Global config** must use absolute or home-relative paths (relative paths are rejected)

```typescript
// Internally, all paths are wrapped in AbsolutePath after resolution
config.pulledArtifactsPath; // AbsolutePath instance, always absolute
```

## Storage Providers

Each project references a storage provider:

```json
// AWS S3
{ "type": "aws", "awsRegion": "us-east-1", "awsBucketName": "bucket", "awsProfile": "default" }

// Filesystem
{ "type": "filesystem", "path": "~/.ethoko/storage/my-project" }
```

## Using Config in Code

Commands load configuration via `loadConfig()` and receive an `EthokoCliConfig` instance:

```typescript
import { loadConfig } from "@/config";

const config = await loadConfig(); // merges global + local automatically
const store = new PulledArtifactStore(config.pulledArtifactsPath);
const storageProvider = buildStorageProvider(config.getProjectConfig("my-project"));
```

For testing, construct `EthokoCliConfig` directly:

```typescript
new EthokoCliConfig({
  pulledArtifactsPath: new AbsolutePath("/tmp/test-artifacts"),
  pulledArtifactsSource: "local",
  typingsPath: new AbsolutePath("/tmp/test-typings"),
  compilationOutputPath: undefined,
  projects: [],
  debug: false,
  localConfigPath: undefined,
  globalConfigPath: undefined,
  localProjectNames: new Set(["my-project"]),
  globalProjectNames: new Set(),
});
```

## Cache Management

Pulled artifacts accumulate over time. The `ethoko prune` command cleans them up:

```bash
ethoko prune                  # Remove orphaned projects + untagged artifacts
ethoko prune my-project       # Remove all artifacts for a project
ethoko prune my-project:v1.0  # Remove a specific tag
ethoko prune my-project@abc12 # Remove a specific ID
ethoko prune --dry-run        # Preview without deleting
```

"Orphaned" means the project is not listed in either config file. This is the natural cleanup flow after removing a project from config.

## Key Source Files

- `packages/cli-beacon/src/config/index.ts` — `EthokoCliConfig` class and `loadConfig()`
- `packages/cli-beacon/src/config/global-config.ts` — global config loading
- `packages/cli-beacon/src/config/local-config.ts` — local config loading and discovery
- `packages/cli-beacon/src/config/merge-config.ts` — merge logic
- `packages/cli-beacon/src/client/prune.ts` — cache management functions
