# Global Config Research

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
- Add `ethoko config list` command to show effective config
- Add `ethoko projects` command to list available projects

**2.3 Path Expansion**

- Support `~` in all path fields
- Add validation for global config paths
- Update error messages to clarify global vs local

### Phase 3: User Experience

**3.1 Smart `ethoko init` Command**

The `ethoko init` command becomes a context-aware initialization tool that adapts to the user's situation.

**Single Command, Multiple Contexts:**

```bash
ethoko init    # Smart initialization - adapts to context
```

**Behavior (Context-Aware):**

**Context 1: First-time user (no configs exist)**

```
$ ethoko init

Welcome to Ethoko!

No global configuration found.

Ethoko can store pulled artifacts globally to save disk space.
Create global config? (Y/n) y

✔ Pulled artifacts path: ~/.ethoko/pulled-artifacts (default)

Add a project to get started? (Y/n) y

✔ Project name: my-contracts
✔ Storage type: Filesystem
✔ Storage path: ~/.ethoko/storage/my-contracts

✓ Global config created: ~/.ethoko/config.json

Configure this repository? (Y/n) y

✔ Detected: Foundry
✔ Compilation output path: ./out

✓ Local config created: ./ethoko.config.json
✓ Added .ethoko-typings to .gitignore

Run 'ethoko push my-contracts:v1.0' to push your first artifact!
```

**Context 2: Global config exists, setting up new repo**

```
$ ethoko init

Found global configuration with 2 projects:
  • company-contracts
  • shared-lib

Configure this repository? (Y/n) y

✔ Detected: Hardhat
✔ Compilation output path: ./artifacts

✓ Local config created: ./ethoko.config.json
✓ Added .ethoko-typings to .gitignore

You can now use: ethoko pull company-contracts:latest
```

**Context 3: User wants to add project to existing global config**

```
$ ethoko init

Found global configuration.

This repository is already configured (./ethoko.config.json exists).

What would you like to do?
  › Set up a new repository config
    Add a project to global config
    Edit local config
    Cancel

# If they choose "Add a project to global config":
✔ Project name: new-project
✔ Storage type: AWS S3
# ... storage config prompts ...
✓ Project added to global config: ~/.ethoko/config.json

Run 'ethoko pull new-project:latest' to use it.
```

**Key Points:**

- Single `init` command handles all setup scenarios
- Detects existing configs and adapts behavior
- Can be re-run to add projects or reconfigure
- Guides user through first-time setup
- Minimal friction for experienced users

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
ethoko config show              # Show effective config (merged global + local)
ethoko config show --global     # Show only global config
ethoko config show --local      # Show only local config
ethoko config show --resolved   # Show with all paths resolved
```

**Example Output:**

```
$ ethoko config show

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

**Behavior Details:**

**Local Init (`ethoko init`)**:

- Current behavior maintained
- Prompts for:
  1. Project name and storage config (first project)
  2. Compilation output path
  3. Pulled artifacts path (default: `.ethoko`)
  4. Typings path (default: `.ethoko-typings`)
- Creates `./ethoko.config.json`
- Offers to add more projects at the end: "Add another project? (y/N)"

**Global Init (`ethoko init --global`)**:

- Creates/edits `~/.ethoko/config.json`
- Prompts for:
  1. Pulled artifacts path (default: `~/.ethoko/pulled-artifacts`)
  2. First project (optional): "Would you like to add a project? (Y/n)"
  3. After first project: "Add another project? (Y/n)"
- Does NOT prompt for `compilationOutputPath` or `typingsPath` (local-only fields)
- Shows clear messaging: "Global config will be used across all repositories"

**3.2 Project Management Within `ethoko init`**

Rather than creating separate commands, enhance `ethoko init` to handle project management:

**Interactive Project Addition Flow:**

```
$ ethoko init --global

✔ Use default pulled artifacts path? (~/.ethoko/pulled-artifacts) … yes
✔ Would you like to add a project? … yes

✔ Project name: company-core-contracts
✔ Storage type: AWS S3
✔ AWS Region: us-east-1
✔ S3 Bucket: company-ethoko-prod
✔ Authentication: AWS Profile
✔ AWS Profile: company-sso

✓ Project "company-core-contracts" configured!

✔ Add another project? … yes

✔ Project name: personal-experiments
✔ Storage type: Filesystem
✔ Storage path: ~/.ethoko/storage/personal

✓ Project "personal-experiments" configured!

✔ Add another project? … no

[Summary shown]

✔ Save configuration? … yes

✓ Global configuration saved to ~/.ethoko/config.json

You can edit this file directly to add/remove projects,
or run 'ethoko init --global' again to modify interactively.
```

**3.3 Config Inspection Commands**

Minimal commands for viewing configuration:

```bash
ethoko config show              # Show effective config (merged global + local)
ethoko config show --global     # Show only global config
ethoko config show --local      # Show only local config
ethoko config show --resolved   # Show with all paths resolved and validated
```

**Output Format:**

```
$ ethoko config show

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

Run 'ethoko config show --resolved' to see all resolved absolute paths
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

# Or use ethoko init --global for interactive mode
ethoko init --global
```

**3.5 Validation Command**

```bash
ethoko config validate          # Validate config and show errors
ethoko config validate --global # Validate only global config
ethoko config validate --local  # Validate only local config
```

**Output:**

```
$ ethoko config validate

Validating configuration...

✓ Global config: ~/.ethoko/config.json
  • 2 projects defined
  • All paths are absolute or home-relative

✓ Local config: ./ethoko.config.json
  • 1 project defined
  • Compilation output path exists
  • No path conflicts

⚠ Warnings:
  • Project "local-dev" in local config overrides global definition

✓ Configuration is valid
```

### Phase 4: Advanced Features (Future)

**4.1 XDG Directory Support**

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

1. **Cache management enhancements** (Phase 3+)
   - `ethoko prune` with smart eviction policies
   - Size-based cleanup options
   - TTL-based artifact expiration

2. **Advanced path features** (Future)
   - XDG Base Directory support
   - Platform-specific defaults

---

## Command Summary

### Configuration Commands

```bash
ethoko init              # Smart context-aware initialization (existing, enhanced)
ethoko config show       # View effective config with flags for --global/--local/--resolved (new)
```

**Key Design:**

- **Single `init` command** adapts to context (no `--global` flag needed)
  - First-time user → Creates global config + local repo config
  - Existing global config → Sets up local repo
  - Existing local config → Offers to add project or reconfigure
- **`config show`** for inspection
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

- `ethoko config show` (new)
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

**Phase 1: Global Pulled Artifacts**

1. Add global config discovery (`~/.ethoko/config.json`)
2. Support `~` path expansion
3. Default `pulledArtifactsPath` to `~/.ethoko/pulled-artifacts`
4. Maintain local override capability

**Phase 2: Global Projects**

1. Implement project merging (global + local)
2. Enhance `ethoko init` to be fully context-aware
3. Add `ethoko config show` for inspection
4. Document override behavior

**Phase 3: Enhanced UX**

1. Add `ethoko prune` for cache management
2. Improve error messages for config conflicts
3. Add comprehensive documentation and examples

**Command Summary:**

- `ethoko init` (enhanced to be context-aware)
- `ethoko config show` (new command)
- `ethoko prune` (new command)

**Total New Commands: 2** (enhancing existing `init` doesn't count as new)

**Key Developer Journey Insights:**

- Solo developers: No change to existing workflow
- Team developers: One-time global setup, then seamless across repos
- Config management: Prefer direct file editing over interactive for power users
- CI/CD: Simplified with global config and environment-based credentials
- Backward compatibility: Existing repos continue working without changes
