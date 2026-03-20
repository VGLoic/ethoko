# Global Config PRD

## Implementation Status

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Foundation (global config discovery, `~` path expansion, config validation) | ✅ Complete (commit `10673b9`) |
| Phase 2 | Core Global Features (global pulled artifacts path, global projects, merge logic) | ✅ Complete (commit `10673b9`) |
| Phase 3 | User Experience (`ethoko init` rework, `ethoko config`) | ✅ Complete (commit `381ecf0`) |
| Phase 4 | Cache Management (`ethoko prune`) | ⬜ Not Started |
| Phase 5 | Advanced Features (XDG support) | ⬜ Not Started |

---

## Executive Summary

This document analyzes the feasibility, implications, and design considerations for migrating Ethoko's configuration from a repository-centric model to a global configuration model. The research covers each configuration field and provides recommendations for a hybrid approach that maintains backward compatibility while enabling global defaults.

## Current Architecture

### Configuration Model

Ethoko currently uses a **repository-centric** configuration model:

- **Config location**: `ethoko.config.json` in the repository (or parent directories)
- **Config discovery**: Walks up from `process.cwd()` to filesystem root
- **Path resolution**: All relative paths resolve from `process.cwd()`
- **Project scope**: Projects defined per-repository
- **Isolation**: Complete isolation between repositories

### Current Configuration Schema

```json
{
  "pulledArtifactsPath": "./.ethoko", // Where pulled artifacts are stored locally
  "typingsPath": "./.ethoko-typings", // Where TypeScript typings are generated
  "compilationOutputPath": "./artifacts", // Where to find compilation artifacts to push
  "projects": [
    // List of projects with storage configs
    {
      "name": "my-project",
      "storage": {
        "type": "filesystem",
        "path": "./.ethoko-storage"
      }
    }
  ],
  "debug": false
}
```

### Storage Layout (Current)

**Pulled Artifacts Store** (`pulledArtifactsPath`):

```
.ethoko/
  {project}/
    ids/
      {id}/
        input.json
        outputs/
          {sourceName}/
            {contractName}.json
    tags/
      {tag}.json  (manifest: { id })
```

**Storage Provider** (filesystem type):

```
.ethoko-storage/
  {project}/
    ids/{id}/...
    tags/{tag}.json
```

**TypeScript Typings** (`typingsPath`):

```
.ethoko-typings/
  summary-exports.ts
  summary.json
  index.ts
  abis/
    {project}/
      {tag}/
        {sourceName}/
          {contract}.d.ts
```

## Field-by-Field Analysis

### 1. `pulledArtifactsPath`

**Current Behavior:**

- Default: `./.ethoko` (relative to repository root)
- Stores artifacts pulled from remote storage
- Scoped by project name within the directory

**Global Config Feasibility:** ✅ **HIGH - Recommended**

**Rationale:**

- Pulled artifacts are project-namespaced, avoiding conflicts
- Similar to npm's global cache (`~/.npm`) or Docker's image cache
- Reduces disk usage when same project used across multiple repos
- No repository-specific content in the artifacts themselves

**Global Location Recommendation:**

```
~/.ethoko/pulled-artifacts/
  {project}/
    ids/{id}/...
    tags/{tag}.json
```

**Implementation Considerations:**

1. **Conflict handling**: Already handled by project namespacing
2. **Cross-repo sharing**: Feature, not bug - enables artifact reuse
3. **Cleanup**: Need `ethoko prune` command to remove old artifacts
4. **Permissions**: Standard user directory permissions sufficient

**Implementation Path:**

- Add global default: `~/.ethoko/pulled-artifacts/`
- Allow local override in `ethoko.config.json`
- Priority: Local config > Global config > Built-in default

**Breaking Changes:** None (local override supported for backward compatibility)

---

### 2. `typingsPath`

**Current Behavior:**

- Default: `./.ethoko-typings` (relative to repository root)
- Generates TypeScript type definitions from pulled artifacts
- References `ETHOKO_PATH` constant pointing to `pulledArtifactsPath`

**Global Config Feasibility:** ⚠️ **MEDIUM - Possible but Not Recommended**

**Rationale Against Global:**

- Typings should be version-controlled (`.gitignore` or committed)
- Each repository may pull different tags for same project
- IDE autocomplete expects project-local typings
- `ETHOKO_PATH` in generated typings points to pulled artifacts location

**Issues with Global Typings:**

```typescript
// Generated in global typings
export const ETHOKO_PATH = "~/.ethoko/pulled-artifacts";

// Problem: Code references this in current repo
import { ETHOKO_PATH } from "./.ethoko-typings"; // Won't work if typings are global
```

**Recommendation:** **Keep repository-local by default**

**Rationale For Keeping Local:**

1. **IDE integration**: TypeScript language server expects project-local types
2. **Version control**: Teams can commit typings for reproducibility
3. **Per-repo customization**: Different repos can use different project tags
4. **Import paths**: Existing codebases expect relative imports

**Implementation:**

- Keep default: `./.ethoko-typings` (relative to current directory)
- No global option needed
- Generated typings reference appropriate `pulledArtifactsPath` (global or local)

---

### 3. `compilationOutputPath`

**Current Behavior:**

- Optional field
- Points to where compilation artifacts are located (e.g., `./artifacts`, `./out`)
- Used by `push` and `diff` commands
- Framework-dependent (Hardhat uses `./artifacts`, Foundry uses `./out`)

**Global Config Feasibility:** ❌ **LOW - Not Recommended**

**Rationale:**

- Compilation artifacts are inherently repository-specific
- Different frameworks use different paths
- Path must be relative to where contracts are compiled
- No benefit to globalization

**Recommendation:** **Keep repository-local only**

**Rationale:**

1. **Framework coupling**: Each repo uses specific framework (Hardhat/Foundry)
2. **Build artifacts**: Generated during compilation, not portable
3. **Repository context**: Must resolve relative to contract source files
4. **No sharing potential**: Artifacts tied to specific repository's contracts

**Implementation:**

- Keep as repository-local config field
- No global equivalent
- Can be omitted if `--artifact-path` CLI flag is used

---

### 4. `projects`

**Current Behavior:**

- Array of project configurations
- Each project has:
  - `name`: Project identifier
  - `storage`: Storage provider config (AWS S3 or filesystem)

**Global Config Feasibility:** ✅ **HIGH - Recommended with Caveats**

**Rationale:**

- Projects represent shared artifact namespaces
- Storage credentials (AWS keys, S3 bucket) are user-specific, not repo-specific
- Similar to Docker registries or npm registry config

**Implementation Model: Hybrid Approach**

**Global Projects** (`~/.ethoko/config.json`):

```json
{
  "projects": [
    {
      "name": "company-contracts",
      "storage": {
        "type": "aws",
        "awsRegion": "eu-west-3",
        "awsBucketName": "company-ethoko-artifacts",
        "awsProfile": "work-profile"
      }
    },
    {
      "name": "personal-experiments",
      "storage": {
        "type": "filesystem",
        "path": "~/.ethoko/storage/personal"
      }
    }
  ]
}
```

**Local Projects Override** (`./ethoko.config.json`):

```json
{
  "projects": [
    {
      "name": "local-dev-project",
      "storage": {
        "type": "filesystem",
        "path": "./ethoko-storage"
      }
    }
  ]
}
```

**Merge Strategy:**

1. Load global config projects
2. Load local config projects
3. **Local project names override global** (by name)
4. Merge both lists for final project registry

**Use Cases Enabled:**

✅ **Company-wide shared projects**:

- DevOps sets up global config with company AWS credentials
- Developers can use `ethoko pull company-contracts:latest` from any repo

✅ **Per-repository local testing**:

- Use local filesystem storage for dev/testing
- No need to configure AWS for simple local work

✅ **Multi-tenant development**:

- Developer works on multiple companies' projects
- Each company's projects defined globally
- Switch between projects seamlessly

**Challenges:**

⚠️ **Project name conflicts**:

- What if local repo defines project with same name as global?
- **Solution**: Local takes precedence, with warning message

⚠️ **Credential management**:

- AWS credentials in global config could be security risk
- **Mitigation**: Use AWS profiles, not hardcoded keys
- Document best practices (IAM roles, temporary credentials)

⚠️ **Filesystem storage paths**:

- Global config with relative paths ambiguous
- **Solution**: Enforce absolute paths or home-relative (`~`) for global filesystem storage

**Implementation Considerations:**

1. **Backward compatibility**: Existing repos with local config continue working
2. **Flexible adoption**: Teams can use global projects or keep local definitions
3. **Documentation**: Clear precedence rules (local > global)

---

### 5. `debug`

**Current Behavior:**

- Boolean flag to enable debug logging
- Can be overridden by `--debug` CLI flag

**Global Config Feasibility:** ⚠️ **MEDIUM - Possible as Global Default**

**Recommendation:** **Support both global default and local override**

**Implementation:**

- Global config can set default debug mode
- Local config can override
- CLI flag `--debug` takes highest precedence
- Priority: CLI flag > Local config > Global config > `false`

---

## Proposed Architecture: Hybrid Model

### Config Discovery Order

```
1. Command-line flag: --config <path>        (highest priority)
2. Repository-local: ./ethoko.config.json    (walk up from cwd)
3. Global config: ~/.ethoko/config.json      (if exists)
4. Built-in defaults                         (lowest priority)
```

### Merge Strategy

```typescript
const finalConfig = {
  pulledArtifactsPath:
    localConfig.pulledArtifactsPath ||
    globalConfig.pulledArtifactsPath ||
    "~/.ethoko/pulled-artifacts",

  typingsPath: localConfig.typingsPath || "./.ethoko-typings", // No global default

  compilationOutputPath: localConfig.compilationOutputPath, // No global default

  projects: mergeProjects(
    globalConfig.projects || [],
    localConfig.projects || [],
  ), // Merge with local override by name

  debug: cliFlag.debug || localConfig.debug || globalConfig.debug || false,
};
```

### Recommended Global Config Location

**Primary**: `~/.ethoko/config.json`

**Rationale:**

- Consistent with other dev tools (e.g., `~/.docker/`, `~/.npm/`)
- Avoids XDG complexity for now (can add later)
- Simple cross-platform support

**Alternative (Future)**: XDG Base Directory Spec

- Linux: `~/.config/ethoko/config.json`
- macOS: `~/Library/Application Support/ethoko/config.json`
- Windows: `%APPDATA%/ethoko/config.json`

### Recommended Global Directory Structure

```
~/.ethoko/
  config.json                 # Global configuration
  pulled-artifacts/           # Global pulled artifact cache
    {project}/
      ids/{id}/...
      tags/{tag}.json
  storage/                    # Optional: default location for filesystem storage
    {project}/
      ids/{id}/...
      tags/{tag}.json
```

---

## Implementation Roadmap

### Phase 1: Foundation (Required for Global Config)

**1.1 Add Global Config Discovery**

- Implement `findGlobalConfig()` function
- Update `loadConfig()` to check `~/.ethoko/config.json`
- Implement merge logic for projects

**1.2 Support Home-Relative Paths**

- Add `~` expansion in path resolution
- Update `new AbsolutePath()` to handle `~`
- Validate no relative paths in global config (except with `~`)

**1.3 Update Config Validation**

- Different validation rules for global vs local config
- Enforce absolute/home-relative paths in global config
- Validate project name uniqueness (with override warnings)

### Phase 2: Core Global Features

**2.1 Global Pulled Artifacts Path**

- Default to `~/.ethoko/pulled-artifacts/` if no config found
- Add local override capability
- Update all commands to use resolved path

**2.2 Global Projects**

- Implement project merging (global + local)
- Add `ethoko config` command to show effective config

**2.3 Path Expansion**

- Support `~` in all path fields
- Add validation for global config paths
- Update error messages to clarify global vs local

### Phase 3: User Experience

**3.1 Smart `ethoko init` Command**

The `ethoko init` command is a context-aware initialization tool that loads existing configs before prompting, shows existing projects, and lets users add new ones with per-project scope selection.

**Single Command:**

```bash
ethoko init    # Interactive local init — always writes ./ethoko.config.json
```

**6-Step Local Init Flow:**

1. **Welcome** — intro message
2. **Load configs** — merges global (`~/.ethoko/config.json`) + local (`./ethoko.config.json`) configs
3. **Projects** — shows existing projects; offers to add one new project (global or local scope)
4. **Compilation output path** — detects Hardhat/Foundry, suggests defaults (can skip)
5. **`.gitignore` handling** — adds typings path (and relative pulled-artifacts path) automatically
6. **Outro** — shows config file paths and next steps

> Note: `pulledArtifactsPath` and `typingsPath` are **not prompted** — they use defaults and can be changed by editing config files directly. There is no final "Save?" confirmation; writes happen as each step completes.

**Project Scope Selection (step 3):**

When adding a project, the user chooses where to save it:
- **Global** (`~/.ethoko/config.json`) — recommended, accessible from any repo
- **Local** (`./ethoko.config.json`) — repo-specific project config

Filesystem storage path defaults:
- Global: `storage` (resolves to `~/.ethoko/storage`)
- Local: `.ethoko-storage` (relative to cwd)

**Example — No existing config:**

```
$ ethoko init

◆ Welcome to Ethoko CLI Configuration!
│ This interactive setup will guide you through configuring your Ethoko projects and settings.
│ If the script is not enough, we encourage you to edit the configuration files directly for full customization.

✔ No projects configured yet. Add your first project? … yes
✔ Enter the name of your project: … my-contracts
✔ Select the storage type: › AWS S3
✔ Where should this project config be saved? › Global (~/.ethoko/config.json)
✔ Enter AWS Region: … us-east-1
✔ Enter S3 Bucket Name: … my-bucket
✔ Select AWS Authentication method: › Environment (default credentials)
◆ Project summary
│ Global config created at ~/.ethoko/config.json
│
│ New project: "my-contracts" (global)
│  Storage type: AWS S3
│  Authentication: environment (default)
✔ Project configured successfully!

✔ Select the path where your compilation output are stored: › ./out (Foundry default output)

✔ Updated .gitignore with TypeScript typings path

◆ For further customization, edit the configuration files directly:
│  - Global config: ~/.ethoko/config.json
│  - Local config: ./ethoko.config.json
│ You can use this init script again anytime to add more projects or update your configuration.

◆ Configuration completed
```

**Example — Existing projects:**

```
$ ethoko init

Welcome to Ethoko CLI Configuration

┌ Existing projects
│  • company-contracts (aws)
│  • shared-lib (filesystem)
└

✔ Add another project? … no
[continues to compilation output / typings prompts]
```

**Key Points:**

- Single `init` command handles all setup scenarios
- Additive/update-oriented — no destructive overwrite prompt
- Per-project scope: global (cross-repo) or local (repo-specific)
- Detects existing configs and shows them before prompting
- Handles `.gitignore` automatically

**3.2 Direct Config File Editing (Recommended)**

**Primary Method for Ongoing Management**: Edit JSON directly

**Rationale:**

- Developers are comfortable editing JSON
- Enables bulk operations (add multiple projects at once)
- Faster than interactive prompts for experienced users
- Supports copy-paste of project configs (e.g., from team wiki)
- No new commands to learn for simple edits

**Add Project:**

```bash
# Edit global config
vim ~/.ethoko/config.json
# Add project to "projects" array

# Or edit local config
vim ./ethoko.config.json
```

**Remove Project:**

```bash
# Edit config to remove project
vim ~/.ethoko/config.json

# Prune pulled artifacts for that project
ethoko prune old-project

# Or just prune all orphaned artifacts after editing config
ethoko prune
```

**Documentation Emphasis:**

```
For ongoing config management, directly edit:
  • Global: ~/.ethoko/config.json
  • Local:  ./ethoko.config.json

Run 'ethoko init' for interactive setup assistance.
```

**3.3 Config Inspection**

```bash
ethoko config              # Show effective config (merged global + local)
```

**Example Output:**

```
$ ethoko config

Config Sources:
  Global: ~/.ethoko/config.json (found)
  Local:  ./ethoko.config.json (found)

Effective Configuration:
  Pulled Artifacts Path: ~/.ethoko/pulled-artifacts (from global)
  Typings Path: ./.ethoko-typings (default)
  Compilation Output Path: ./out (from local)
  Debug: false

Projects (3 total):
  • company-core-contracts [global]
    Storage: AWS S3 (us-east-1, bucket: company-ethoko-prod)

  • personal-experiments [global]
    Storage: Filesystem (~/.ethoko/storage/personal)

  • local-dev [local - overrides global]
    Storage: Filesystem (./ethoko-storage)

To add/remove projects, edit the config files directly
or run 'ethoko init' for interactive guidance.
```

**3.4 Artifact Cache Management**

The `ethoko prune` command follows the same argument pattern as `push` and `pull` for consistency.

**Command Syntax:**

```bash
ethoko prune                       # Remove orphaned artifacts (not in any config)
ethoko prune PROJECT               # Remove all artifacts for PROJECT
ethoko prune PROJECT:TAG           # Remove specific TAG for PROJECT
ethoko prune PROJECT@ID            # Remove specific ID for PROJECT

# Flags:
ethoko prune --all                 # Remove ALL artifacts (nuclear option)
ethoko prune PROJECT --dry-run     # Show what would be removed
ethoko prune PROJECT --yes         # Skip confirmation prompts
```

**Default Behavior (`ethoko prune`):**

Removes artifacts for projects not defined in any config (global or local). This is the **safest and most useful** operation.

```
$ ethoko prune

Scanning for orphaned artifacts in ~/.ethoko/pulled-artifacts...

Found orphaned projects:
  • old-project (890MB, 3 tags, 8 IDs)
  • test-project (120MB, 1 tag, 1 ID)

These projects are not in your global or local config.
Remove orphaned artifacts? (Y/n) y

✓ Removed old-project (890MB)
✓ Removed test-project (120MB)

Total space freed: 1.01GB
```

**Prune Entire Project:**

```
$ ethoko prune old-project

Pruning all artifacts for project "old-project"...

Found:
  • 3 tags (v1.0, v1.1, latest)
  • 8 IDs
  • Total size: 890MB

Remove all artifacts for "old-project"? (Y/n) y

✓ Removed 890MB from old-project
```

**Prune Specific Tag:**

```
$ ethoko prune old-project:v1.0

Pruning "old-project:v1.0"...

✓ Removed tag v1.0
✓ Removed ID abc123 (120MB)

Note: ID was not referenced by other tags
```

**Prune Specific ID:**

```
$ ethoko prune old-project@abc123

Pruning ID "abc123" from "old-project"...

⚠ Warning: This ID is referenced by tags: v1.0, latest
Remove anyway? (y/N) y

✓ Removed tags: v1.0, latest
✓ Removed ID abc123 (120MB)
```

**Dry Run (Preview):**

```
$ ethoko prune old-project --dry-run

Would prune from "old-project":
  • Tag v1.0 → ID abc123 (120MB)
  • Tag v1.1 → ID def456 (130MB)
  • Tag latest → ID def456 (shared, already counted)
  • 6 additional unreferenced IDs (640MB)

Total that would be removed: 890MB

No changes made (dry-run mode)
```

**Skip Confirmations (CI/Automation):**

```
$ ethoko prune old-project --yes

✓ Removed 890MB from old-project
```

**Nuclear Option (Remove Everything):**

```
$ ethoko prune --all

⚠ WARNING: This will remove ALL pulled artifacts!

Found artifacts:
  • company-contracts (450MB, in global config)
  • shared-lib (120MB, in global config)
  • old-project (890MB, orphaned)

Total: 1.46GB across 3 projects

Type 'remove everything' to confirm: remove everything

✓ Removed all artifacts (1.46GB freed)

Note: You can re-pull artifacts with 'ethoko pull PROJECT:TAG'
```

**Safety Features:**

1. **Default prunes only orphaned projects** (safest)
2. **Warns if project is in config:**

   ```
   $ ethoko prune company-contracts

   ⚠ Warning: "company-contracts" is defined in global config
   Remove artifacts anyway? (y/N)
   ```

3. **`--all` requires typing confirmation** (can't be bypassed with `--yes`)
4. **Dry-run mode** shows exactly what will be removed
5. **`--yes` skips confirmations** for automation (but not for `--all`)

**Example Output:**

```
$ ethoko prune

Pulled artifacts location: ~/.ethoko/pulled-artifacts

Projects:
  • company-contracts (2 tags, 5 IDs, 450MB)
  • shared-lib (1 tag, 1 ID, 120MB)
  • old-project (3 tags, 8 IDs, 890MB)

What would you like to prune?
  › Select projects to prune
    Prune all artifacts (1.46GB)
    Prune artifacts not in any config
    Cancel

$ ethoko prune --project old-project
Removed 890MB from old-project
```

**Behavior Details (implemented):**

**`ethoko init`**:

- Loads existing global (`~/.ethoko/config.json`) and local (`./ethoko.config.json`) configs
- Shows existing projects (if any) before prompting
- Offers to add **one** project per run (with scope selection: global or local)
- Prompts for compilation output path (auto-detects Hardhat/Foundry, can skip)
- Does **not** prompt for `pulledArtifactsPath` or `typingsPath` — these use defaults and can be edited directly
- No `--force` flag — additive only, never overwrites existing projects
- No `--global` flag — project scope is selected per-project during the flow
- Writes to global config only if a global-scope project was added; always updates local config for compilation output path

**`ethoko init` (adding a second project, existing config):**

```
$ ethoko init

◆ Welcome to Ethoko CLI Configuration!

◆ Existing projects
│  • my-contracts (aws) [global]

✔ Do you want to add another project? … yes
✔ Enter the name of your project: … local-dev
✔ Select the storage type: › Filesystem
✔ Where should this project config be saved? › Local (./ethoko.config.json)
✔ Choose a path for the artifacts store (default is .ethoko-storage): … .ethoko-storage
◆ Project summary
│ Local config updated at ./ethoko.config.json
│
│ New project: "local-dev" (local)
│  Storage type: Filesystem
│  Storage path: .ethoko-storage (relative to project)
✔ Project configured successfully!

[continues to compilation output / gitignore steps]
```

**3.3 Config Inspection Commands**

Minimal commands for viewing configuration:

```bash
ethoko config             # Show effective config (merged global + local)
```

**Output Format:**

```
$ ethoko config

Config Sources:
  Global: ~/.ethoko/config.json (found)
  Local:  ./ethoko.config.json (found)

Effective Configuration:
  Pulled Artifacts Path: ~/.ethoko/pulled-artifacts (from global)
  Typings Path: ./.ethoko-typings (from local)
  Compilation Output Path: ./out (from local)
  Debug: false

Projects (3 total):
  • company-core-contracts [global]
    Storage: AWS S3 (us-east-1, bucket: company-ethoko-prod)

  • personal-experiments [global]
    Storage: Filesystem (~/.ethoko/storage/personal)

  • local-dev [local - overrides global]
    Storage: Filesystem (./ethoko-storage)

```

**3.4 Direct Config File Editing**

**Recommended Primary Method**: Edit config files directly

**Rationale:**

- Developers are comfortable editing JSON
- Enables bulk operations (add multiple projects)
- Allows commenting (via tools like JSON5 in future)
- Supports copy-paste of project configs
- Faster than interactive prompts for power users

**Documentation Emphasis:**

```bash
# Quick add project to global config
echo "Edit ~/.ethoko/config.json and add to 'projects' array"

# Or use ethoko init for interactive mode
ethoko init
```


### Phase 4: Cache Management

**4.1 `ethoko prune` Command**

- Remove orphaned artifacts (not referenced by any config)
- Prune by project, tag, or ID
- `--dry-run` mode to preview removals
- `--yes` flag for CI/automation (except for `--all`)
- `--all` requires typed confirmation as a safety guard

### Phase 5: Advanced Features (Future)

**5.1 XDG Directory Support**

- Platform-specific config locations
- Maintain backward compatibility

---

## Risk Assessment

### Security Risks

**Risk**: Credentials in global config

- **Severity**: High
- **Mitigation**:
  - Recommend AWS profiles over hardcoded keys
  - Support environment variable expansion (`${ETHOKO_AWS_KEY}`)
  - Add `ethoko config secure` command to check for hardcoded secrets
  - Document secure credential management

**Risk**: World-readable global config

- **Severity**: Medium
- **Mitigation**:
  - Set proper permissions on `~/.ethoko/config.json` (0600)
  - Warn if permissions are too open
  - Add `ethoko config secure-check` command

### Backward Compatibility Risks

**Risk**: Breaking existing workflows

- **Severity**: High
- **Mitigation**:
  - Maintain local config as first priority
  - Global config is purely additive
  - No breaking changes to existing repos

**Risk**: Path resolution ambiguity

- **Severity**: Medium
- **Mitigation**:
  - Clear documentation on path resolution order
  - `ethoko config debug` command shows where paths resolve
  - Warning messages when global overrides local

### Data Consistency Risks

**Risk**: Stale artifacts in global cache

- **Severity**: Low
- **Mitigation**:
  - Add `ethoko clean` command
  - Document cache invalidation strategy
  - Consider TTL or size-based eviction

---

## Recommendations

### Immediate (Phase 1)

1. ✅ **Implement global config for `pulledArtifactsPath`**
   - High value: Reduce disk usage across repos
   - Low risk: Already project-namespaced
   - Default: `~/.ethoko/pulled-artifacts/`

2. ✅ **Implement global config for `projects`**
   - High value: Share credentials and storage configs
   - Medium risk: Requires merge strategy
   - Merge strategy: Local overrides global by project name

3. ✅ **Add `~` path expansion**
   - Necessary for global config
   - Improves local config UX

### Keep Local Only

1. ❌ **Do NOT globalize `compilationOutputPath`**
   - No benefit
   - Inherently repository-specific

2. ⚠️ **Do NOT globalize `typingsPath` by default**
   - Keep repository-local for IDE integration
   - Could add global option for advanced users later

### Future Enhancements

1. **Cache management** (Phase 4)
   - `ethoko prune` with smart eviction policies
   - Size-based cleanup options
   - TTL-based artifact expiration

2. **Advanced path features** (Phase 5)
   - XDG Base Directory support
   - Platform-specific defaults

---

## Command Summary

### Configuration Commands

```bash
ethoko init              # Smart context-aware initialization (existing, enhanced)
ethoko config            # View effective config with flags for --global/--local/--resolved (new)
```

**Key Design:**

- **Single `init` command** adapts to context (no `--global` flag needed)
  - First-time user → Creates global config + local repo config
  - Existing global config → Sets up local repo
  - Existing local config → Offers to add project or reconfigure
- **`config`** for inspection
- **Direct file editing** encouraged for ongoing management (add/remove projects)

### Cache Management

```bash
ethoko prune                 # Remove orphaned artifacts (not in any config)
ethoko prune PROJECT         # Remove all artifacts for PROJECT
ethoko prune PROJECT:TAG     # Remove specific TAG
ethoko prune PROJECT@ID      # Remove specific ID
ethoko prune --all           # Remove ALL artifacts (requires typed confirmation)
ethoko prune --dry-run       # Preview what would be removed
ethoko prune --yes           # Skip confirmations (except for --all)
```

**Rationale**:

- Consistent with `push`/`pull` argument pattern (PROJECT:TAG or PROJECT@ID)
- Default behavior (`ethoko prune`) is safest: removes only orphaned artifacts
- Natural workflow: remove project from config → run `ethoko prune`
- `--yes` for automation, but `--all` always requires typed confirmation

### Total New Commands: 2

- `ethoko config` (new)
- `ethoko prune` (new)
- `ethoko init` (enhanced to be context-aware, not counted as new)

---

### Use Case 1: Company-Wide Development

**Setup**: DevOps creates global config template

```json
// ~/.ethoko/config.json
{
  "pulledArtifactsPath": "~/.ethoko/pulled-artifacts",
  "projects": [
    {
      "name": "company-core-contracts",
      "storage": {
        "type": "aws",
        "awsRegion": "us-east-1",
        "awsBucketName": "company-ethoko-prod",
        "awsProfile": "company-sso"
      }
    }
  ]
}
```

**Benefit**: Every developer can:

```bash
cd any-repository/
ethoko pull company-core-contracts:latest
# Works without configuring AWS in each repo
```

### Use Case 2: Local Development with Global Cache

**Setup**: Developer uses default global cache

```json
// No global config needed
// Uses default: ~/.ethoko/pulled-artifacts/
```

**Local Repo Config**:

```json
// ./ethoko.config.json
{
  "compilationOutputPath": "./out",
  "projects": [
    {
      "name": "my-experiments",
      "storage": {
        "type": "filesystem",
        "path": "./local-storage"
      }
    }
  ]
}
```

**Benefit**:

- Pulled artifacts shared across all repos
- Each repo still has local project definitions

### Use Case 3: Mixed Global and Local Projects

**Global Config**:

```json
// ~/.ethoko/config.json
{
  "projects": [
    {
      "name": "shared-lib",
      "storage": { "type": "aws" /* ... */ }
    }
  ]
}
```

**Local Config**:

```json
// ./ethoko.config.json
{
  "projects": [
    {
      "name": "local-dev",
      "storage": { "type": "filesystem", "path": "./storage" }
    }
  ]
}
```

**Available projects in this repo**:

- `shared-lib` (from global config)
- `local-dev` (from local config)

---

## Conclusion

Moving to a hybrid global/local configuration model is **feasible and recommended** for:

- ✅ `pulledArtifactsPath`: High value, low risk
- ✅ `projects`: High value, medium complexity

Should remain local-only:

- ❌ `compilationOutputPath`: No benefit
- ⚠️ `typingsPath`: Better as local for IDE integration

The hybrid approach maintains **backward compatibility** while enabling:

1. Reduced disk usage (shared artifact cache)
2. Simplified credential management (global projects)
3. Better multi-repo workflows
4. Consistent team configuration

**Implementation Strategy (Phased):**

**Command Summary:**

- `ethoko init` (enhanced to be context-aware)
- `ethoko config` (new command)
- `ethoko prune` (new command)

**Total New Commands: 2** (enhancing existing `init` doesn't count as new)

**Key Developer Journey Insights:**

- Solo developers: No change to existing workflow
- Team developers: One-time global setup, then seamless across repos
- Config management: Prefer direct file editing over interactive for power users
- CI/CD: Simplified with global config and environment-based credentials
- Backward compatibility: Existing repos continue working without changes
