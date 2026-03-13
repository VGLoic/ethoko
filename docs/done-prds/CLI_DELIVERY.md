# Product Requirements Document: Ethoko Standalone CLI

**Document Version:** 1.1  
**Last Updated:** March 11, 2026  
**Status:** Draft - Ready for Implementation  
**Owner:** Engineering Team

---

## 1. Executive Summary

### Overview

Create a standalone Ethoko CLI tool that enables Foundry users and CI/CD pipelines to use Ethoko without requiring Hardhat installation. The CLI uses a **Beacon Pattern**: `@ethoko/cli-beacon` is the source package (managed by Changesets), while `@ethoko/cli` is a generated wrapper that resolves platform-specific binaries via `optionalDependencies`.

### Goals

- **Primary:** Enable Foundry projects to use Ethoko artifact management
- **Secondary:** Simplify CI/CD integration (no Hardhat dependency)
- **Tertiary:** Maintain 100% backward compatibility with existing Hardhat plugins

### Key Decisions

| Decision           | Choice                                                                          |
| ------------------ | ------------------------------------------------------------------------------- |
| CLI Framework      | Commander.js                                                                    |
| Config Format      | JSON only (`ethoko.json`)                                                       |
| Binary Compiler    | Bun (`bun build --compile`)                                                     |
| Distribution Model | Beacon Pattern (`@ethoko/cli-beacon` source + generated `@ethoko/cli` wrapper)  |
| Release Cadence    | Automatic with every Changesets release of `@ethoko/cli-beacon`                 |
| Platform Packages  | Public on npm (generated at publish time, not committed)                        |
| Versioning         | Independent from `@ethoko/core`; `@ethoko/cli-beacon` starts at `0.1.1`         |
| Node.js Fallback   | None — wrapper errors if binary not found; use `@ethoko/cli-beacon` for Node.js |

### Success Criteria

- All 8 commands work identically to Hardhat plugin
- Binaries build for 5 platforms (Linux x64/arm64, macOS x64/arm64, Windows x64)
- npm installation works: `npm install -g @ethoko/cli` (resolves platform binary automatically)
- Curl installation works: `curl -fsSL https://...install.sh | bash`
- Zero breaking changes to existing Hardhat users
- GitHub Actions automatically builds binaries and publishes all packages when `@ethoko/cli-beacon` is released
- Integration test apps use `@ethoko/cli-beacon` (Node.js mode) for E2E testing

---

## 2. Problem Statement

### Current Limitations

1. **Foundry users cannot use Ethoko** - Requires Hardhat installation
2. **CI/CD complexity** - Must install Hardhat even for artifact management only
3. **Dependency bloat** - Hardhat brings 100+ dependencies for simple push/pull operations
4. **User confusion** - "Why do I need Hardhat to manage artifacts?"

### Impact

- **Market limitation:** Missing entire Foundry ecosystem
- **User friction:** Complex setup for simple use cases
- **Competitive disadvantage:** Other artifact tools offer standalone CLIs

### Solution

Standalone CLI that:

- Works with zero dependencies (standalone binary)
- Works with Node.js (npm installation)
- Uses same `@ethoko/core` business logic (no duplication)
- Maintains Hardhat plugin for existing users (no breaking changes)

---

## 3. User Personas & Use Cases

### Persona 1: Foundry Developer

**Profile:** Smart contract developer using Foundry for compilation and testing

**Pain Points:**

- Cannot use Ethoko without installing Hardhat
- Wants lightweight artifact management

**Use Cases:**

- Push Foundry compilation artifacts to S3
- Pull artifacts in deployment scripts
- Compare local artifacts with remote versions

**Example Workflow:**

```bash
# Compile with Foundry
forge build

# Push to Ethoko
ethoko push --artifact-path out/build-info --tag v1.0.0

# In deployment script
ethoko pull --tag v1.0.0
```

---

### Persona 2: DevOps Engineer

**Profile:** Manages CI/CD pipelines, prefers minimal dependencies

**Pain Points:**

- CI images bloated with unnecessary dependencies
- Hardhat installation adds minutes to build time
- Wants single binary for artifact operations

**Use Cases:**

- Push artifacts in GitHub Actions
- Pull artifacts in deployment pipelines
- Validate artifact integrity before deployment

**Example Workflow:**

```yaml
# GitHub Actions
- name: Install Ethoko
  run: curl -fsSL https://...install.sh | bash

- name: Push artifacts
  run: ethoko push --artifact-path artifacts/build-info --tag ${{ github.sha }}
```

---

### Persona 3: Existing Hardhat User

**Profile:** Already using `hardhat-ethoko` plugin

**Pain Points:**

- None (satisfied with current solution)

**Use Cases:**

- Continue using Hardhat plugin (no migration required)
- Optionally adopt CLI for specific workflows

**Example Workflow:**

```bash
# Continues to work
npx hardhat ethoko push --tag v1.0.0

# Optional: Use CLI for faster operations
ethoko push --tag v1.0.0
```

---

## 4. Product Overview

### What We're Building

Two npm packages following the **Beacon Pattern**:

**1. `@ethoko/cli-beacon` (Source Package)**

- Contains all CLI source code (8 commands, config system, Commander.js)
- Managed by Changesets (versioning, changelogs, npm publish)
- Can be installed directly for Node.js execution (`npx @ethoko/cli-beacon push ...`)
- Lives in `packages/cli-beacon/` in the monorepo
- Integration test apps depend on this package via `workspace:*`

**2. `@ethoko/cli` (Generated Wrapper Package)**

- Thin wrapper (~15 lines) with `bin/ethoko` that resolves the platform binary via `require.resolve`
- Has `optionalDependencies` on 5 platform packages (`@ethoko/cli-{os}-{arch}`)
- Generated at publish time by `scripts/publish-cli.ts` — NOT committed to git
- This is what end-users install: `npm install -g @ethoko/cli`
- No Node.js fallback — errors if binary not found

**3. `@ethoko/cli-{os}-{arch}` (5 Generated Platform Packages)**

- Each contains a single Bun-compiled binary for one platform
- Generated at publish time alongside `@ethoko/cli`
- npm's `os`/`cpu` fields ensure only the matching package is installed

### Architecture Principle

```
Source (committed, Changesets-managed):
  @ethoko/cli-beacon (packages/cli-beacon/)
    ├── src/commands/*.ts → @ethoko/core (business logic)
    ├── scripts/build-binary.ts → 5 Bun binaries
    └── scripts/publish-cli.ts → generates:

Generated (at publish time, not committed):
  @ethoko/cli (wrapper)
    ├── bin/ethoko (require.resolve → platform binary)
    └── optionalDependencies:
        ├── @ethoko/cli-darwin-arm64
        ├── @ethoko/cli-darwin-x64
        ├── @ethoko/cli-linux-arm64
        ├── @ethoko/cli-linux-x64
        └── @ethoko/cli-windows-x64

Unchanged:
  hardhat-ethoko → @ethoko/core (business logic)
```

**Key Insight:** `@ethoko/core` has ZERO Hardhat dependencies. All business logic already extracted.

### Non-Goals (Out of Scope)

- ❌ Deprecating Hardhat plugins
- ❌ Web UI or graphical interface
- ❌ Interactive prompts (CLI is scriptable)
- ❌ Smart contract compilation (use Hardhat/Foundry)
- ❌ Blockchain interaction (use Hardhat/Foundry)

---

## 5. Technical Architecture

### Package Structure

#### Source Package: `@ethoko/cli-beacon`

Lives in the monorepo at `packages/cli-beacon/`. Managed by Changesets. Published to npm for changelog tracking. Can be installed directly for Node.js execution.

```
packages/cli-beacon/
├── src/
│   ├── index.ts              # Commander.js entry point
│   ├── config.ts             # Load ethoko.json
│   ├── commands/
│   │   ├── push.ts
│   │   ├── pull.ts
│   │   ├── diff.ts
│   │   ├── inspect.ts
│   │   ├── artifacts.ts
│   │   ├── typings.ts
│   │   ├── export.ts
│   │   └── restore.ts
│   └── utils/
│       └── storage-provider.ts  # Factory for LocalStorage/S3
├── scripts/
│   ├── build-binary.ts      # Bun build script (5 platform binaries)
│   └── publish-cli.ts       # Generate + publish @ethoko/cli and platform packages
├── package.json             # name: "@ethoko/cli-beacon"
├── tsup.config.ts
└── README.md
```

#### Generated Packages (not committed to git)

The following packages are generated at publish time by `scripts/publish-cli.ts`. They are written to a temporary directory, published to npm, and never committed.

**`@ethoko/cli` (Wrapper)**

```
@ethoko/cli/
├── package.json             # bin, optionalDependencies
└── bin/
    └── ethoko               # Node.js wrapper (~15 lines, require.resolve)
```

**`@ethoko/cli-{os}-{arch}` (5 Platform Packages)**

```
@ethoko/cli-darwin-arm64/
├── package.json             # os: ["darwin"], cpu: ["arm64"]
└── bin/
    └── ethoko               # Bun-compiled binary
```

Repeat for: `cli-darwin-x64`, `cli-linux-arm64`, `cli-linux-x64`, `cli-windows-x64`

---

### Distribution Architecture

#### Method 1: npm Installation (Primary)

```bash
npm install -g @ethoko/cli
```

**Flow:**

1. npm installs `@ethoko/cli` wrapper package
2. npm resolves `optionalDependencies` → installs platform-specific binary package
3. Wrapper script (`bin/ethoko`) uses `require.resolve` to find the platform binary → executes it

**Generated `@ethoko/cli/package.json`:**

```json
{
  "name": "@ethoko/cli",
  "version": "0.1.1",
  "description": "Ethoko CLI - Standalone tool for smart-contract artifact management",
  "bin": {
    "ethoko": "./bin/ethoko"
  },
  "optionalDependencies": {
    "@ethoko/cli-linux-x64": "0.1.1",
    "@ethoko/cli-linux-arm64": "0.1.1",
    "@ethoko/cli-darwin-x64": "0.1.1",
    "@ethoko/cli-darwin-arm64": "0.1.1",
    "@ethoko/cli-windows-x64": "0.1.1"
  },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/VGLoic/ethoko-monorepo"
  }
}
```

**Generated Wrapper Script (`bin/ethoko`):**

```javascript
#!/usr/bin/env node
const { spawnSync } = require("child_process");
const os = require("os");

const platformMap = { darwin: "darwin", linux: "linux", win32: "windows" };
const archMap = { x64: "x64", arm64: "arm64" };

const platform = platformMap[os.platform()];
const arch = archMap[os.arch()];

if (!platform || !arch) {
  console.error(`Unsupported platform: ${os.platform()}-${os.arch()}`);
  process.exit(1);
}

const binaryName = platform === "windows" ? "ethoko.exe" : "ethoko";

let binaryPath;
try {
  binaryPath = require.resolve(
    `@ethoko/cli-${platform}-${arch}/bin/${binaryName}`,
  );
} catch {
  console.error(
    `Could not find Ethoko binary for ${os.platform()}-${os.arch()}.\n` +
      `The platform package @ethoko/cli-${platform}-${arch} is not installed.\n` +
      `Try reinstalling: npm install -g @ethoko/cli`,
  );
  process.exit(1);
}

const result = spawnSync(binaryPath, process.argv.slice(2), {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
```

**Key design decisions:**

- Uses `require.resolve` instead of walking `node_modules` — simpler, works with all package managers
- No Node.js fallback — if binary not found, errors with actionable message
- Users who need Node.js execution install `@ethoko/cli-beacon` directly

**For development / integration tests:**

Integration test apps depend on `@ethoko/cli-beacon: "workspace:*"` and run CLI commands via Node.js directly (no binary needed during development).

---

#### Method 2: Direct Binary Installation (Alternative)

```bash
curl -fsSL https://raw.githubusercontent.com/VGLoic/ethoko-monorepo/main/install.sh | bash
```

**Flow:**

1. Script detects OS/arch
2. Queries GitHub API for latest CLI release
3. Downloads binary from GitHub Releases
4. Installs to `~/.ethoko/bin/ethoko`
5. Adds to PATH (updates .bashrc/.zshrc)

**Implementation:** See `install.sh` specification in Section 5

---

#### Method 3: GitHub Releases (Backing Store)

Every release uploads 5 binaries:

- `ethoko-linux-x64`
- `ethoko-linux-arm64`
- `ethoko-darwin-x64`
- `ethoko-darwin-arm64`
- `ethoko-windows-x64.exe`

**Release Tag Format:** `cli-v{version}`  
**Example:** `cli-v0.1.1`

---

### Build System

#### Binary Compilation with Bun

```bash
# Build for single platform
bun build src/index.ts --compile --target=bun-linux-x64 --outfile=ethoko-linux-x64

# Build all platforms
bun scripts/build-binary.ts
```

**Platforms:**

- `bun-linux-x64` (Linux x86_64)
- `bun-linux-arm64` (Linux ARM64)
- `bun-darwin-x64` (macOS Intel)
- `bun-darwin-arm64` (macOS Apple Silicon)
- `bun-windows-x64` (Windows x86_64)

**Binary Characteristics:**

- Size: ~30-50MB (includes Bun runtime + dependencies)
- Standalone: No Node.js required
- Fast startup: ~50ms cold start

---

### Configuration System

#### File: `ethoko.json`

Location: Project root (searches parent directories up to filesystem root)

**Schema:**

```typescript
{
  project: string;                     // Required: Project name
  compilationOutputPath?: string;      // Path to artifacts (optional)
  pulledArtifactsPath?: string;        // Default: ".ethoko"
  typingsPath?: string;                // Default: ".ethoko-typings"
  storage: {
    type: "local" | "aws";
    // Local storage
    path?: string;                     // If type: "local"
    // AWS S3 storage
    awsBucketName?: string;            // If type: "aws"
    awsRegion?: string;                // If type: "aws"
    awsAccessKeyId?: string;           // Optional (uses env vars)
    awsSecretAccessKey?: string;       // Optional (uses env vars)
    awsRoleArn?: string;               // Optional (AssumeRole ARN)
    awsRoleExternalId?: string;        // Optional (AssumeRole external ID)
    awsRoleSessionName?: string;       // Optional (default: "ethoko-cli-session")
    awsRoleDurationSeconds?: number;   // Optional (default: 3600)
  };
  debug?: boolean;                     // Default: false
}
```

**Example:**

```json
{
  "project": "my-contracts",
  "compilationOutputPath": "out/build-info",
  "pulledArtifactsPath": ".ethoko",
  "storage": {
    "type": "aws",
    "awsBucketName": "my-ethoko-bucket",
    "awsRegion": "us-east-1"
  },
  "debug": false
}
```

**Config Discovery:**

1. Check `--config <path>` flag
2. Search current directory for `ethoko.json`
3. Search parent directories up to filesystem root (standard pattern like ESLint)
4. Error if not found (show example config in error message)

---

### Command Mapping

All 8 Hardhat plugin commands become CLI commands:

| Hardhat Command            | CLI Command        | Description                             |
| -------------------------- | ------------------ | --------------------------------------- |
| `hardhat ethoko push`      | `ethoko push`      | Upload compilation artifacts to storage |
| `hardhat ethoko pull`      | `ethoko pull`      | Download artifacts from storage         |
| `hardhat ethoko diff`      | `ethoko diff`      | Compare local artifacts with remote     |
| `hardhat ethoko inspect`   | `ethoko inspect`   | View artifact details                   |
| `hardhat ethoko artifacts` | `ethoko artifacts` | List pulled artifacts                   |
| `hardhat ethoko typings`   | `ethoko typings`   | Generate TypeScript typings             |
| `hardhat ethoko export`    | `ethoko export`    | Export contract artifact                |
| `hardhat ethoko restore`   | `ethoko restore`   | Restore original artifacts              |

**Backward Compatibility:** Hardhat plugin commands continue to work unchanged.

---

## 6. Feature Requirements

### 6.1 Command: `ethoko push`

**Description:** Upload compilation artifacts to storage

**Usage:**

```bash
ethoko push [options]
```

**Options:**

- `--artifact-path <path>` - Path to compilation artifact (overrides config)
- `--tag <tag>` - Tag to associate with artifact (e.g., "v1.0.0")
- `--force` - Force push even if tag exists
- `--debug` - Enable debug logging
- `--silent` - Suppress output (errors still shown)
- `--config <path>` - Config file path (default: search upwards)

**Example:**

```bash
# Push with auto-detected path (from config)
ethoko push --tag v1.0.0

# Push specific artifact
ethoko push --artifact-path out/build-info --tag v1.0.0 --force

# Push in CI (silent mode)
ethoko push --tag $CI_COMMIT_SHA --silent
```

**Exit Codes:**

- `0` - Success
- `1` - Error (artifact not found, tag exists, upload failed, etc.)

**Output:**

```
╔════════════════════════════════════════════════════════════╗
║ Pushing artifact to "my-contracts" with tag "v1.0.0"      ║
╚════════════════════════════════════════════════════════════╝

✓ Hardhat v3 compilation artifact found
✓ Compilation artifact is valid
✓ Tag is available
✓ Artifact uploaded successfully

Artifact ID: 0x1234567890abcdef...
```

---

### 6.2 Command: `ethoko pull`

**Description:** Download artifacts from storage

**Usage:**

```bash
ethoko pull [options]
```

**Options:**

- `--id <id>` - Artifact ID (mutually exclusive with --tag)
- `--tag <tag>` - Artifact tag (mutually exclusive with --id)
- `--project <project>` - Project name (overrides config)
- `--force` - Overwrite existing local artifacts
- `--debug` - Enable debug logging
- `--silent` - Suppress output
- `--config <path>` - Config file path

**Example:**

```bash
# Pull by tag
ethoko pull --tag v1.0.0

# Pull by ID
ethoko pull --id 0x1234567890abcdef

# Pull from different project
ethoko pull --project other-contracts --tag latest

# Force overwrite
ethoko pull --tag v1.0.0 --force
```

**Exit Codes:**

- `0` - Success
- `1` - Error (artifact not found, download failed, etc.)

---

### 6.3 Command: `ethoko diff`

**Description:** Compare local compilation artifacts with remote version

**Usage:**

```bash
ethoko diff [options]
```

**Options:**

- `--artifact-path <path>` - Local artifact path
- `--id <id>` - Remote artifact ID (mutually exclusive with --tag)
- `--tag <tag>` - Remote artifact tag (mutually exclusive with --id)
- `--debug` - Enable debug logging
- `--silent` - Suppress output
- `--config <path>` - Config file path

**Example:**

```bash
# Compare with tagged version
ethoko diff --artifact-path out/build-info --tag v1.0.0

# Compare with ID
ethoko diff --id 0x1234567890abcdef
```

**Output:**

```
Comparing local artifact with remote "v1.0.0"...

✓ Artifacts are identical
```

or

```
⚠ Artifacts differ:
  - Contract "Counter" bytecode differs
  - Contract "Token" not present in remote
```

---

### 6.4 Command: `ethoko inspect`

**Description:** View details of a pulled artifact

**Usage:**

```bash
ethoko inspect [options]
```

**Options:**

- `--id <id>` - Artifact ID
- `--tag <tag>` - Artifact tag
- `--project <project>` - Project name
- `--json` - Output JSON format
- `--debug` - Enable debug logging
- `--silent` - Suppress output
- `--config <path>` - Config file path

**Example:**

```bash
# Inspect by tag
ethoko inspect --tag v1.0.0

# JSON output
ethoko inspect --tag v1.0.0 --json
```

---

### 6.5 Command: `ethoko artifacts`

**Description:** List all pulled artifacts

**Usage:**

```bash
ethoko artifacts [options]
```

**Options:**

- `--json` - Output JSON format
- `--debug` - Enable debug logging
- `--silent` - Suppress output
- `--config <path>` - Config file path

**Example:**

```bash
# List all pulled artifacts
ethoko artifacts

# JSON output for scripting
ethoko artifacts --json | jq '.[] | .tag'
```

---

### 6.6 Command: `ethoko typings`

**Description:** Generate TypeScript typings from pulled artifacts

**Usage:**

```bash
ethoko typings [options]
```

**Options:**

- `--debug` - Enable debug logging
- `--silent` - Suppress output
- `--config <path>` - Config file path

**Example:**

```bash
# Generate typings
ethoko typings

# Output location: .ethoko-typings/ (configurable)
```

---

### 6.7 Command: `ethoko export`

**Description:** Export contract artifact from pulled artifact

**Usage:**

```bash
ethoko export [options]
```

**Options:**

- `--contract <name>` - Contract name or FQN (source:contract)
- `--id <id>` - Source artifact ID
- `--tag <tag>` - Source artifact tag
- `--project <project>` - Project name
- `--output <path>` - Output file (default: stdout)
- `--debug` - Enable debug logging
- `--silent` - Suppress output
- `--config <path>` - Config file path

**Example:**

```bash
# Export to stdout
ethoko export --contract Counter --tag v1.0.0

# Export to file
ethoko export --contract Counter --tag v1.0.0 --output Counter.json

# Pipe to deployment script
ethoko export --contract Counter --tag v1.0.0 | jq '.abi'
```

---

### 6.8 Command: `ethoko restore`

**Description:** Restore original compilation artifacts from pulled artifact

**Usage:**

```bash
ethoko restore [options]
```

**Options:**

- `--id <id>` - Artifact ID
- `--tag <tag>` - Artifact tag
- `--project <project>` - Project name
- `--output <path>` - Output directory (required)
- `--force` - Overwrite existing directory
- `--debug` - Enable debug logging
- `--silent` - Suppress output
- `--config <path>` - Config file path

**Example:**

```bash
# Restore to specific directory
ethoko restore --tag v1.0.0 --output restored-artifacts

# Force overwrite
ethoko restore --tag v1.0.0 --output artifacts --force
```

---

### 6.9 Global Options

All commands support:

- `--version` - Show CLI version
- `--help` - Show command help
- `--config <path>` - Config file path (default: search upwards)
- `--debug` - Enable debug logging (shows full stack traces)
- `--silent` - Suppress CLI output (errors/warnings still shown)

---

## 7. Distribution Strategy

### 7.1 npm Distribution (Beacon Pattern)

**Registry:** npmjs.com  
**Visibility:** All packages public

The npm distribution uses the **Beacon Pattern** — two published packages with distinct roles:

**`@ethoko/cli-beacon` (Source Package)**

- Published by Changesets as part of the normal release flow
- Contains CLI source code compiled to JS (`dist/index.js`)
- Can be installed directly for Node.js execution: `npx @ethoko/cli-beacon push ...`
- Developers and integration test apps use this package
- Starts at version `0.1.1`

**`@ethoko/cli` (Generated Wrapper Package)**

- Generated and published by `scripts/publish-cli.ts` AFTER `@ethoko/cli-beacon` is published
- Contains only `bin/ethoko` wrapper script + `optionalDependencies`
- This is the primary user-facing package
- Version mirrors `@ethoko/cli-beacon` version
- The existing `@ethoko/cli@0.1.0` on npm will be deprecated; generated versions start at the next available version

**Installation:**

```bash
# End-users: binary execution (recommended)
npm install -g @ethoko/cli
pnpm add -g @ethoko/cli
yarn global add @ethoko/cli

# End-users: local project (CI/CD)
npm install --save-dev @ethoko/cli

# Developers: Node.js execution (no binary needed)
npm install -g @ethoko/cli-beacon
```

**Platform Packages:** All public on npm (generated at publish time, not committed)

- `@ethoko/cli-linux-x64`
- `@ethoko/cli-linux-arm64`
- `@ethoko/cli-darwin-x64`
- `@ethoko/cli-darwin-arm64`
- `@ethoko/cli-windows-x64`

**Version Strategy:** Independent from `@ethoko/core`

- `@ethoko/cli-beacon` depends on `@ethoko/core` with `^` range
- Example: `@ethoko/cli-beacon@0.1.1` depends on `@ethoko/core@^0.8.0`
- `@ethoko/cli` and platform packages mirror `@ethoko/cli-beacon` version

---

### 7.2 Direct Binary Distribution

**Install Script URL:**

```
https://raw.githubusercontent.com/VGLoic/ethoko-monorepo/main/install.sh
```

**Installation:**

```bash
curl -fsSL https://raw.githubusercontent.com/VGLoic/ethoko-monorepo/main/install.sh | bash

# With custom install directory
ETHOKO_INSTALL_DIR=/usr/local curl -fsSL https://...install.sh | bash
```

**Install Location:**

- Default: `~/.ethoko/bin/ethoko`
- Custom: `$ETHOKO_INSTALL_DIR/bin/ethoko`

**PATH Management:** Script automatically adds to PATH by updating:

- `~/.bashrc` (bash)
- `~/.zshrc` (zsh)

---

### 7.3 GitHub Releases

**Repository:** `VGLoic/ethoko-monorepo`  
**Release Tag Format:** `cli-v{version}`  
**Example:** `cli-v0.1.1`

**Release Assets:**

- `ethoko-linux-x64`
- `ethoko-linux-arm64`
- `ethoko-darwin-x64`
- `ethoko-darwin-arm64`
- `ethoko-windows-x64.exe`

**Release Notes:** Auto-generated from changeset

**Direct Download:**

```bash
# Linux x64
curl -L https://github.com/VGLoic/ethoko-monorepo/releases/download/cli-v0.1.1/ethoko-linux-x64 -o ethoko

# macOS ARM64
curl -L https://github.com/VGLoic/ethoko-monorepo/releases/download/cli-v0.1.1/ethoko-darwin-arm64 -o ethoko

chmod +x ethoko
./ethoko --version
```

---

### 7.4 Future Distribution Channels

The following channels are planned as future work, after the core npm + curl distribution is stable:

**Homebrew (macOS/Linux):**

```bash
brew install ethoko/tap/ethoko
```

Requires creating a Homebrew tap repository (`ethoko/homebrew-tap`) with a formula that downloads the correct binary from GitHub Releases. This is a natural next step once the release pipeline is proven.

**AUR (Arch Linux):**

```bash
yay -S ethoko-cli
```

**Scoop (Windows):**

```powershell
scoop install ethoko
```

**Docker:**

```dockerfile
FROM oven/bun:alpine
COPY ethoko /usr/local/bin/ethoko
```

---

## 8. Implementation Roadmap

### Phase 1: CLI Package Structure + Integration Tests (11-12 hours)

**Status:** ✅ Completed  
**Last Updated:** March 9, 2026

**Goal:** Create `@ethoko/cli` package with all commands runnable with Node.js, AND update all integration apps to test both Hardhat plugin and CLI in parallel.

**Key User Decisions:**

- ✅ Config filename: `ethoko.json` (not `ethoko.config.json`)
- ✅ Tag naming: Simple prefix (`2026-hardhat-plugin`, `2026-cli`)
- ✅ Test execution: Parallel (Hardhat plugin + CLI run simultaneously)
- ✅ Compilation: Once in global `setup.ts` (not per test suite)
- ✅ Foundry tests: Separate CLI test files (not two invocations)
- ✅ Deployment scripts: Duplicate per tag (Option A)
- ✅ All 8 apps confirmed to have ethoko tests

---

#### Part A: CLI Beacon Package Implementation (6.25 hours)

**Tasks:**

1. **Create package structure** (30 min)
   - Create `packages/cli-beacon/` directory
   - Setup `package.json` with Commander.js dependency
   - Setup `tsup.config.ts` for TypeScript build (ESM only)
   - Add shebang: `#!/usr/bin/env node`

2. **Implement config system** (1.5 hours)
   - Create `src/config.ts`
   - JSON parsing with Zod validation
   - Upward directory search (cwd → filesystem root)
   - `--config` flag override
   - Error message shows example JSON config
   - **Config structure:** FLATTENED (no nested storage config)
     ```typescript
     {
       project: string;
       pulledArtifactsPath?: string;
       typingsPath?: string;
       compilationOutputPath?: string;
       storage: {
         type: "local" | "aws";
         path?: string;              // local only
         awsBucketName?: string;     // aws only
         awsRegion?: string;         // aws only
         awsAccessKeyId?: string;    // aws only (optional)
         awsSecretAccessKey?: string;// aws only (optional)
         awsRoleArn?: string;        // aws only (optional)
         awsRoleExternalId?: string; // aws only (optional)
         awsRoleSessionName?: string;// aws only (optional)
         awsRoleDurationSeconds?: number; // aws only (optional)
       };
       debug?: boolean;
     }
     ```

3. **Implement storage provider factory** (30 min)
   - Create `src/utils/storage-provider.ts`
   - Convert flattened JSON config → nested core provider format
   - Map CLI's flat AWS credentials to core's nested structure
   - Return `LocalStorageProvider` or `S3BucketProvider` instance

4. **Port 8 commands** (2.5 hours - 20 min each)
   - Create `src/commands/push.ts`
   - Create `src/commands/pull.ts`
   - Create `src/commands/diff.ts`
   - Create `src/commands/inspect.ts`
   - Create `src/commands/artifacts.ts`
   - Create `src/commands/typings.ts`
   - Create `src/commands/export.ts`
   - Create `src/commands/restore.ts`

   **Porting pattern:**
   - Copy logic from `packages/hardhat-ethoko/src/tasks/*.ts`
   - Replace `hre.config.ethoko` → `await getConfig()`
   - Replace Hardhat task arguments → Commander options
   - Keep same `@ethoko/core/cli-client` function calls
   - Keep same `@ethoko/core/cli-ui` display functions
   - Keep same error handling (CliError vs unexpected)

5. **Create CLI entry point** (45 min)
   - Create `src/index.ts`
   - Setup Commander program
   - Register all 8 commands
   - Global options: `--version`, `--help`, `--config`
   - Global config access pattern:
     ```typescript
     const getConfig = async () => loadConfig(program.opts().config);
     registerPushCommand(program, getConfig);
     ```

6. **Validation** (30 min)

   ```bash
   cd packages/cli-beacon
   pnpm install
   pnpm build
   node dist/index.js --version
   node dist/index.js --help
   node dist/index.js push --help

   # Test with config
   echo '{"project":"test","storage":{"type":"local","path":".test"}}' > ethoko.json
   node dist/index.js artifacts
   ```

**Deliverables:**

- ✅ `packages/cli-beacon/` with full source code
- ✅ All 8 commands functional with Node.js
- ✅ Config loading from `ethoko.json` (upward search)
- ✅ Config paths resolved relative to `ethoko.json` location
- ✅ Full TypeScript type safety

---

#### Part B: Integration App Updates (5 hours)

**Goal:** Update all 8 integration apps to test both Hardhat plugin and CLI in parallel.

**Key Architecture Changes:**

1. ✅ **Helper-driven E2E harness** - Shared setup utilities per app (config + storage)
2. ✅ **Per-test config generation** - Temporary Hardhat/CLI config files from templates
3. ✅ **Per-test unique tags** - Randomized tags avoid storage collisions in parallel runs
4. ✅ **Separate CLI/Hardhat suites** - `*.cli.e2e.test.ts` and `*.hardhat.e2e.test.ts`
5. ✅ **Targeted compilation helpers** - Isolated vs non-isolated build targets where needed

---

##### B1: Simple Apps (7 apps × 30 min = 3.5 hours)

**Apps:**

1. `hardhat-v2_hardhat-deploy-v0`
2. `hardhat-v2_hardhat-deploy-v0_external-lib`
3. `hardhat-v3_etherscan-verification`
4. `hardhat-v3_hardhat-deploy-v2`
5. `hardhat-v3_ignition`
6. `foundry_etherscan-verification`
7. `uniswap-v4-core`

**Steps per app:**

**1. Add CLI dependency** (`package.json`):

```json
{
  "devDependencies": {
    "@ethoko/cli-beacon": "workspace:*"
  }
}
```

**2. Add E2E config templates** (Hardhat + CLI):

```json
{
  "project": "PROJECT_NAME",
  "pulledArtifactsPath": "PULLED_ARTIFACTS_PATH",
  "typingsPath": "TYPINGS_PATH",
  "compilationOutputPath": "./artifacts",
  "storage": {
    "type": "local",
    "path": "STORAGE_PATH"
  }
}
```

**3. Use helper setup utilities** - Generate temp configs + folders:

```typescript
import { asyncExec } from "./async-exec.js";

const config = new ConfigSetup(testId);
const cliConfigSetup = new CliConfigSetup(config);
const hardhatConfigSetup = new HardhatConfigSetup(config);
```

**4. Update existing test file** - Use helper + per-test tag:

```typescript
const tag = testId;

describe("[App] Push/pull/deploy - Hardhat Plugin", async () => {
  test("it pushes the tag", () =>
    asyncExec(
      `${ethokoCommand} push --tag ${tag} --artifact-path ${outputArtifactsPath}`,
    ));

  test("it pulls the tag", () => asyncExec(`${ethokoCommand} pull`));

  // ... rest of tests
});
```

**5. Create CLI test file** - `e2e-test/push-pull-deploy.cli.e2e.test.ts`:

```typescript
import { describe, test } from "vitest";
import { asyncExec } from "./async-exec.js";
import { E2E_FOLDER_PATH } from "./e2e-folder-path.js";

const tag = testId;

describe("[App] Push/pull/deploy - CLI", async () => {
  test("it pushes the tag", () =>
    asyncExec(
      `${ethokoCommand} push --tag ${tag} --artifact-path ${outputArtifactsPath}`,
    ));

  test("it pulls the tag", () => asyncExec(`${ethokoCommand} pull`));

  test("it generates the typings", () => asyncExec(`${ethokoCommand} typings`));

  test("it checks types", () => asyncExec("pnpm tsc --noEmit"));

  test("it deploys", () =>
    asyncExec(
      `npx hardhat ignition deploy ./ignition/modules/counter-${TAG_NAME}.ts --config ./hardhat.config.e2e.ts`,
    ));

  test("it restores the original artifacts", async () => {
    await asyncExec(
      `${ethokoCommand} restore --tag ${tag} --output ./${E2E_FOLDER_PATH}/restored-artifacts-${tag}`,
    );
    await asyncExec(`ls -la ./${E2E_FOLDER_PATH}/restored-artifacts-${tag}`);
  });
});
```

**6. Duplicate deployment scripts** (if app uses them):

- Keep: `counter-2026-02-02.ts` (original, unused after update)
- Create: `counter-2026-hardhat-plugin.ts` (for Hardhat plugin tests)
- Create: `counter-2026-cli.ts` (for CLI tests)

**Files created per app:**

- `e2e-test/helpers/templates/ethoko.config.e2e.template.json`
- `e2e-test/helpers/templates/hardhat.config.e2e.template.ts`
- `e2e-test/push-pull-deploy.cli.e2e.test.ts`
- Deployment script duplicates (if applicable)

**Files modified per app:**

- `package.json` (add CLI dependency + `ethoko` script)
- `e2e-test/push-pull-deploy.*.e2e.test.ts` (use helpers + per-test tags)

---

##### B2: Foundry App (1 app × 1.5 hours = 1.5 hours)

**App:** `foundry_hardhat-deploy-v2`

**Structure:**

- 1 helper file: `e2e-test/foundry-describe.ts`
- 4 test files using the helper

**Steps:**

**1. Add CLI dependency + E2E config templates** (same as simple apps)

**2. Update `e2e-test/setup.ts`** - NO compilation (Foundry compiles per suite):

```typescript
export async function setup(): Promise<void> {
  console.log("\n🚀 Starting [Foundry Hardhat-deploy v2] E2E Test Suite\n");
  await cleanUpLocalEthokoStorage();
  console.log("\n✅ Tests ready to run!\n");
}
```

**3. Update `e2e-test/foundry-describe.ts`** - Use helper-based config + per-test tag:

```typescript
import { beforeAll, describe, test } from "vitest";
import fs from "fs/promises";
import { asyncExec } from "./async-exec.js";
import { E2E_FOLDER_PATH } from "./e2e-folder-path.js";

export function foundryDescribe(
  title: string,
  buildCommand: string,
  tag: string,
  outputArtifactsPath: string,
  ethokoRunner: "hardhat" | "cli",
) {
  const ethokoCmd =
    ethokoRunner === "hardhat"
      ? `pnpm hardhat --config ${hardhatConfigPath} ethoko`
      : `pnpm ethoko --config ${cliConfigPath}`;

  describe(`${title} - ${ethokoRunner === "hardhat" ? "Hardhat Plugin" : "CLI"}`, () => {
    beforeAll(async () => {
      const configCleanup = await config.setup();
      const cliCleanup = await cliConfigSetup.setup();
      const hardhatCleanup = await hardhatConfigSetup.setup();
      const deployCleanup = await deployScriptSetup.setup();
      const buildCleanup = await buildSetup.setup();

      return async () => {
        await buildCleanup();
        await deployCleanup();
        await hardhatCleanup();
        await cliCleanup();
        await configCleanup();
      };
    });

    // NO MORE "it compiles" test

    test("it pushes the tag", () =>
      asyncExec(
        `${ethokoCmd} push --tag ${tag} --artifact-path ${outputArtifactsPath}`,
      ));

    test("it pulls the tag", () => asyncExec(`${ethokoCmd} pull`));

    test("it generates the typings", () => asyncExec(`${ethokoCmd} typings`));

    test("it checks types", () => asyncExec("pnpm tsc --noEmit"));

    test("it deploys", () =>
      asyncExec(
        `npx hardhat --config ./hardhat.config.e2e.ts deploy --tags ${tag}`,
      ));

    test("it restores the original artifacts", async () => {
      await asyncExec(
        `${ethokoCmd} restore --tag ${tag} --output ./${E2E_FOLDER_PATH}/restored-artifacts-${tag}`,
      );
      await asyncExec(`ls -la ./${E2E_FOLDER_PATH}/restored-artifacts-${tag}`);
    });
  });
}
```

**4. Update existing test files** (4 files) - Add 5th parameter:

```typescript
// e2e-test/push-pull-deploy.with-build-info.with-tests.e2e.test.ts
import { E2E_FOLDER_PATH } from "./e2e-folder-path.js";
import { foundryDescribe } from "./foundry-describe.js";

const outputArtifactsPath = `${E2E_FOLDER_PATH}/out-2026-hardhat-plugin-forge-build-info-full`;

foundryDescribe(
  "[Foundry Hardhat-deploy v2] - WITH --build-info WITH test and scripts",
  `forge build --build-info --out ${outputArtifactsPath} --cache-path ${outputArtifactsPath}-cache`,
  "2026-hardhat-plugin-forge-build-info-full",
  outputArtifactsPath,
  "hardhat",
);
```

**5. Create 4 new CLI test files:**

```typescript
// e2e-test/push-pull-deploy.with-build-info.with-tests.cli.e2e.test.ts
import { E2E_FOLDER_PATH } from "./e2e-folder-path.js";
import { foundryDescribe } from "./foundry-describe.js";

const outputArtifactsPath = `${E2E_FOLDER_PATH}/out-2026-cli-forge-build-info-full`;

foundryDescribe(
  "[Foundry Hardhat-deploy v2] - WITH --build-info WITH test and scripts",
  `forge build --build-info --out ${outputArtifactsPath} --cache-path ${outputArtifactsPath}-cache`,
  "2026-cli-forge-build-info-full",
  outputArtifactsPath,
  "cli",
);
```

Repeat for:

- `push-pull-deploy.with-build-info.without-tests.cli.e2e.test.ts`
- `push-pull-deploy.without-build-info.with-tests.cli.e2e.test.ts`
- `push-pull-deploy.without-build-info.without-tests.cli.e2e.test.ts`

**Files created:**

- `e2e-test/helpers/templates/ethoko.config.e2e.template.json`
- `e2e-test/push-pull-deploy.with-build-info.with-tests.cli.e2e.test.ts`
- `e2e-test/push-pull-deploy.with-build-info.without-tests.cli.e2e.test.ts`
- `e2e-test/push-pull-deploy.without-build-info.with-tests.cli.e2e.test.ts`
- `e2e-test/push-pull-deploy.without-build-info.without-tests.cli.e2e.test.ts`

**Files modified:**

- `package.json` (add CLI dependency + `ethoko` script)
- `e2e-test/helpers/*.ts`
- `e2e-test/push-pull-deploy.*.e2e.test.ts`

---

#### Part C: Validation & Testing (45 min)

**Step 1: Validate CLI Package (15 min)**

```bash
cd packages/cli
pnpm install
pnpm build
pnpm ethoko --version
pnpm ethoko --help
```

**Step 2: Validate One Simple App (15 min)**

```bash
cd apps/hardhat-v3_ignition
pnpm install
pnpm test:e2e
```

Expected:

```
✓ [Hardhat v3 - Ignition] ... - Hardhat Plugin (6 tests)
✓ [Hardhat v3 - Ignition] ... - CLI (6 tests)
```

**Step 3: Validate Foundry App (15 min)**

```bash
cd apps/foundry_hardhat-deploy-v2
pnpm install
pnpm test:e2e
```

Expected: 16 test suites (8 Hardhat + 8 CLI)

**Step 4: Full Validation (run at root)**

```bash
pnpm build
pnpm check-types
pnpm lint
pnpm format
pnpm test:e2e:core
pnpm test:e2e:apps
```

**Results:**

- ✅ `pnpm test:e2e:apps` (all 12 app test suites passed)
- ⚠️ Re-run recommended after the latest E2E refactor

---

#### Summary

**Total Files Created:** 29

- CLI package: 14 files
- Simple apps: 7 × 2 = 14 files (`ethoko.json` + CLI test file)
- Foundry app: 1 + 4 = 5 files (`ethoko.json` + 4 CLI test files)

**Total Files Modified:** 27

- Simple apps: 7 × 3 = 21 files (`package.json`, `setup.ts`, test file)
- Foundry app: 1 + 1 + 4 = 6 files (`package.json`, `foundry-describe.ts`, 4 test files)

**Total Duration:** 11-12 hours

- Part A (CLI): 6.25 hours
- Part B1 (Simple apps): 3.5 hours
- Part B2 (Foundry app): 1.5 hours
- Part C (Validation): 0.75 hours

**Actual Test Results:**

- Each app runs TWO test suites (Hardhat plugin + CLI)
- Both suites run in parallel (share compilation from `setup.ts`)
- Different tags prevent storage conflicts
- Total: ~96 tests across 8 apps (12 per app: 6 Hardhat + 6 CLI)

---

### Phase 2: Binary Compilation (2-3 hours)

**Goal:** Compile TypeScript → standalone binaries using Bun

**Tasks:**

1. ✅ Install Bun via pnpm devDependency in `packages/cli-beacon`
2. ✅ Create build script (`scripts/build-binary.ts`) using Bun API
   - ✅ Loop through 5 platforms
   - ✅ Use `Bun.build({ compile: { ... } })` for each target
   - ✅ Output to `binaries/` directory
3. ✅ Test local platform binary
4. ✅ Add `build:binary` script to `package.json`
5. ✅ Add CI smoke test (Ubuntu only) for `--version`

**Build Script Implementation:**

```typescript
// packages/cli-beacon/scripts/build-binary.ts
import { mkdirSync } from "fs";
import { join } from "path";

const platforms = [
  { os: "linux", arch: "x64", target: "bun-linux-x64" },
  { os: "linux", arch: "arm64", target: "bun-linux-arm64" },
  { os: "darwin", arch: "x64", target: "bun-darwin-x64" },
  { os: "darwin", arch: "arm64", target: "bun-darwin-arm64" },
  { os: "windows", arch: "x64", target: "bun-windows-x64" },
] as const;

const outDir = join(import.meta.dir, "../binaries");
mkdirSync(outDir, { recursive: true });

for (const platform of platforms) {
  const ext = platform.os === "windows" ? ".exe" : "";
  const outFile = join(outDir, `ethoko-${platform.os}-${platform.arch}${ext}`);

  console.log(`Building ${platform.os}-${platform.arch}...`);
  await Bun.build({
    entrypoints: ["./src/index.ts"],
    compile: {
      target: platform.target as never,
      outfile: outFile,
    },
  });
  console.log(`✓ ${outFile}`);
}
```

**Validation:**

```bash
pnpm build:binary
ls -lh binaries/
./binaries/ethoko-darwin-arm64 --version
./binaries/ethoko-darwin-arm64 push --help
```

**CI Smoke Test (Ubuntu only):**

```bash
pnpm --filter @ethoko/cli-beacon build:binary
./packages/cli-beacon/binaries/ethoko-linux-x64 --version
```

**Deliverables:**

- ✅ 5 compiled binaries in `packages/cli-beacon/binaries/`
- ✅ Binaries are 30-50MB each
- ✅ Binaries run without Node.js

**Implementation Notes:**

- ✅ `packages/cli-beacon/scripts/build-binary.ts` (Bun API build script)
- ✅ `packages/cli-beacon/package.json` includes `build:binary`, `bun`, `@types/bun`
- ✅ `packages/cli-beacon/tsconfig.json` includes `scripts` + `bun` types
- ✅ `.github/workflows/pr.yaml` runs Ubuntu smoke test
- ✅ Root `package.json` allowlists Bun via `pnpm.onlyBuiltDependencies`

---

### Phase 3: Beacon Pattern + Publish Script (2-3 hours)

**Goal:** Create `publish-cli.ts` that generates and publishes `@ethoko/cli` wrapper + 5 platform packages.

**Overview:**

Changesets manages `@ethoko/cli-beacon` versioning and changelogs. A new `scripts/publish-cli.ts` script generates the wrapper and platform packages at publish time, keeping the repo clean with zero committed generated files.

**Tasks:**

1. ✅ **Create publish-cli script entry** (`packages/cli-beacon/package.json`)
   - Keep `"bin": { "ethoko": "./dist/index.js" }` for Node.js execution
   - Add `"publish-cli"` script entry

2. ✅ **Create `scripts/publish-cli.ts`**
   - Read version from `packages/cli-beacon/package.json` (`@ethoko/cli-beacon`)
   - Generate temporary directory structure:
     ```
     tmp/
     ├── @ethoko/cli/
     │   ├── package.json     # wrapper + optionalDependencies (exact versions)
     │   └── bin/ethoko        # require.resolve wrapper script
     ├── @ethoko/cli-darwin-arm64/
     │   ├── package.json     # os: ["darwin"], cpu: ["arm64"]
     │   └── bin/ethoko        # copied from binaries/ethoko-darwin-arm64
     ├── @ethoko/cli-darwin-x64/
     │   └── ...
     ├── @ethoko/cli-linux-arm64/
     │   └── ...
     ├── @ethoko/cli-linux-x64/
     │   └── ...
     └── @ethoko/cli-windows-x64/
         ├── package.json
         └── bin/ethoko.exe
     ```
   - Publish platform packages first (all 5), then `@ethoko/cli` wrapper
   - Support `--dry-run` flag for testing
   - Use `npm publish` with `--access public` and `//registry.npmjs.org/:_authToken=${NPM_TOKEN}`

3. ✅ **Update `.gitignore`**
   - Ensure `packages/cli-beacon/binaries/` is ignored (already is)
   - Add `packages/tmp/` to ignore dry-run outputs

**Wrapper Script Template (generated by `publish-cli.ts`):**

```javascript
#!/usr/bin/env node
const { spawnSync } = require("child_process");
const os = require("os");

const platformMap = { darwin: "darwin", linux: "linux", win32: "windows" };
const archMap = { x64: "x64", arm64: "arm64" };

const platform = platformMap[os.platform()];
const arch = archMap[os.arch()];

if (!platform || !arch) {
  console.error(`Unsupported platform: ${os.platform()}-${os.arch()}`);
  process.exit(1);
}

const binaryName = platform === "windows" ? "ethoko.exe" : "ethoko";

let binaryPath;
try {
  binaryPath = require.resolve(
    `@ethoko/cli-${platform}-${arch}/bin/${binaryName}`,
  );
} catch {
  console.error(
    `Could not find Ethoko binary for ${os.platform()}-${os.arch()}.\n` +
      `The platform package @ethoko/cli-${platform}-${arch} is not installed.\n` +
      `Try reinstalling: npm install -g @ethoko/cli`,
  );
  process.exit(1);
}

const result = spawnSync(binaryPath, process.argv.slice(2), {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
```

**Validation:**

```bash
# Build binaries first
pnpm --filter @ethoko/cli-beacon build:binary

# Dry-run publish (generates packages without publishing)
pnpm --filter @ethoko/cli-beacon exec bun scripts/publish-cli.ts --dry-run

# Verify generated structure
ls -la tmp/@ethoko/cli/
ls -la tmp/@ethoko/cli-darwin-arm64/bin/

# Test wrapper locally (requires platform package in node_modules)
node tmp/@ethoko/cli/bin/ethoko --version
```

**Deliverables:**

- [x] `publish-cli.ts` script committed and tested (dry-run)
- [x] Wrapper uses `require.resolve` (no `node_modules` walking)
- [x] No Node.js fallback in wrapper
- [x] `--dry-run` mode works

---

### Phase 4: GitHub Actions Integration (2-3 hours)

**Goal:** Automatically build binaries, publish `@ethoko/cli` wrapper + platform packages, and create GitHub Release when Changesets publishes `@ethoko/cli-beacon`.

**Changesets Integration:**

Binary publishing happens inside the existing `release` job after `changesets/action` runs. The flow detects whether `@ethoko/cli-beacon` was among the published packages. If so, it builds binaries, runs `publish-cli.ts`, and uploads binaries to GitHub Releases.

**Tasks:**

1. ✅ Detect if `@ethoko/cli-beacon` was published (parse `changesets.outputs.publishedPackages`)
2. ✅ Build binaries in CI (`pnpm --filter @ethoko/cli-beacon build:binary`)
3. ✅ Run `publish-cli.ts` to generate and publish `@ethoko/cli` + 5 platform packages
4. ✅ Create GitHub Release with `cli-v{version}` tag and 5 binary assets

**GitHub Actions Update:**

```yaml
# .github/workflows/main.yaml

release:
  name: Release
  needs:
    [build, check-format, check-types, lint, test, test-e2e-core, test-e2e-apps]
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v5
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v6
      with:
        node-version-file: .nvmrc
        cache: "pnpm"
    - run: pnpm install
    - run: pnpm build
    - name: Create Release Pull Request or Publish to NPM
      id: changesets
      uses: changesets/action@v1
      with:
        publish: "pnpm release"
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        NPM_TOKEN: ${{ secrets.NPM_TOKEN }}

    # Detect if @ethoko/cli-beacon was published
    - name: Detect CLI beacon publish
      id: cli_published
      run: |
        if [ "${{ steps.changesets.outputs.published }}" != "true" ]; then
          echo "published=false" >> $GITHUB_OUTPUT
          exit 0
        fi
        CLI_VERSION=$(echo '${{ steps.changesets.outputs.publishedPackages }}' | jq -r '.[] | select(.name == "@ethoko/cli-beacon") | .version')
        if [ -n "$CLI_VERSION" ] && [ "$CLI_VERSION" != "null" ]; then
          echo "published=true" >> $GITHUB_OUTPUT
          echo "version=$CLI_VERSION" >> $GITHUB_OUTPUT
        else
          echo "published=false" >> $GITHUB_OUTPUT
        fi

    - name: Build binaries
      if: steps.cli_published.outputs.published == 'true'
      run: pnpm --filter @ethoko/cli-beacon build:binary

    - name: Publish CLI wrapper and platform packages
      if: steps.cli_published.outputs.published == 'true'
      run: pnpm --filter @ethoko/cli-beacon exec bun scripts/publish-cli.ts
      env:
        NPM_TOKEN: ${{ secrets.NPM_TOKEN }}

    - name: Upload CLI binaries to GitHub Release
      if: steps.cli_published.outputs.published == 'true'
      uses: softprops/action-gh-release@v2
      with:
        tag_name: "cli-v${{ steps.cli_published.outputs.version }}"
        name: "CLI v${{ steps.cli_published.outputs.version }}"
        files: |
          packages/cli-beacon/binaries/ethoko-linux-x64
          packages/cli-beacon/binaries/ethoko-linux-arm64
          packages/cli-beacon/binaries/ethoko-darwin-x64
          packages/cli-beacon/binaries/ethoko-darwin-arm64
          packages/cli-beacon/binaries/ethoko-windows-x64.exe
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Key differences from previous design:**

- Detects `@ethoko/cli-beacon` (not `@ethoko/cli`) in published packages
- Uses `publishedPackages` JSON output to extract version — only triggers if beacon was actually published
- Runs `publish-cli.ts` instead of `publish:binary` — generates AND publishes wrapper + platform packages
- Version is read from changesets output, not from `package.json`

**Validation:**

1. Create test changeset: `pnpm changeset add` (select `@ethoko/cli-beacon`)
2. Merge Version PR (triggers release)
3. Verify `@ethoko/cli-beacon@0.1.1` published to npm by Changesets
4. Verify `@ethoko/cli@0.1.1` published to npm by `publish-cli.ts`
5. Verify 5 platform packages published to npm
6. Verify GitHub Release created with `cli-v0.1.1` tag and 5 binaries
7. Test installation: `npm install -g @ethoko/cli`

**Deliverables:**

- [x] GitHub Actions workflow updated with beacon detection
- [x] Binaries uploaded to GitHub Releases
- [x] `@ethoko/cli` + 5 platform packages published to npm
- [ ] End-to-end: changeset merge → all packages published + GitHub Release created

---

### Phase 5: Install Script (2 hours)

**Goal:** Enable curl-based installation for non-npm users

**Tasks:**

1. ✅ Create `install.sh` in repo root
2. ✅ Implement platform detection (OS + arch)
3. ✅ Query GitHub API for latest CLI release
4. ✅ Download correct binary from GitHub Releases
5. ✅ Install to `~/.ethoko/bin/` (or `$ETHOKO_INSTALL_DIR`)
6. ✅ Add to PATH (update shell profile)
7. ✅ Verify installation

**Install Script Implementation:**

```bash
#!/usr/bin/env bash
# install.sh

set -euo pipefail

REPO="VGLoic/ethoko-monorepo"
INSTALL_DIR="${ETHOKO_INSTALL_DIR:-$HOME/.ethoko}"
BIN_DIR="$INSTALL_DIR/bin"

detect_platform() {
  local os arch

  case "$(uname -s)" in
    Linux*)   os="linux" ;;
    Darwin*)  os="darwin" ;;
    MINGW*|MSYS*|CYGWIN*) os="windows" ;;
    *)
      echo "Error: Unsupported OS $(uname -s)"
      exit 1
      ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *)
      echo "Error: Unsupported architecture $(uname -m)"
      exit 1
      ;;
  esac

  echo "${os}-${arch}"
}

get_latest_version() {
  curl -s "https://api.github.com/repos/$REPO/releases" \
    | grep '"tag_name"' \
    | grep 'cli-v' \
    | head -n 1 \
    | sed -E 's/.*"cli-v([^"]+)".*/\1/'
}

main() {
  echo "🔍 Detecting platform..."
  local platform=$(detect_platform)
  echo "✓ Platform: $platform"

  echo "🔍 Finding latest version..."
  local version=$(get_latest_version)
  if [ -z "$version" ]; then
    echo "Error: Could not determine latest version"
    exit 1
  fi
  echo "✓ Latest version: $version"

  local binary_name="ethoko-${platform}"
  local ext=""
  if [[ "$platform" == "windows"* ]]; then
    ext=".exe"
  fi

  local download_url="https://github.com/$REPO/releases/download/cli-v$version/$binary_name$ext"

  mkdir -p "$BIN_DIR"
  local tmp_file
  tmp_file=$(mktemp)

  echo "⬇️  Downloading $download_url"
  curl -L "$download_url" -o "$tmp_file"

  local target_name="ethoko"
  if [[ "$platform" == windows* ]]; then
    target_name="ethoko.exe"
  fi

  mv "$tmp_file" "$BIN_DIR/$target_name"
  chmod +x "$BIN_DIR/$target_name"

  ensure_path

  echo "✅ Ethoko installed to $BIN_DIR/$target_name"
  echo "➡️  Restart your shell or run: export PATH=\"${BIN_DIR}:\$PATH\""
  "$BIN_DIR/$target_name" --version || true
}

main
```

**Validation:**

```bash
# Test locally
bash install.sh
~/.ethoko/bin/ethoko --version

# Test from URL (after pushing to main)
curl -fsSL https://raw.githubusercontent.com/VGLoic/ethoko-monorepo/main/install.sh | bash
ethoko --version
```

**Deliverables:**

- ✅ `install.sh` in repo root
- ✅ Works on Linux, macOS, Windows (Git Bash)
- ✅ Detects platform automatically
- ✅ Downloads from GitHub Releases
- ✅ Adds to PATH automatically

---

### Phase 6: Documentation (1-1.5 hours)

**Goal:** Complete documentation and polish user experience

**Tasks:**

1. ✅ Write `packages/cli-beacon/README.md`
   - ✅ Installation instructions: `npm install -g @ethoko/cli` (binary) and `npm install -g @ethoko/cli-beacon` (Node.js)
   - ✅ Explain the two-package model briefly for contributors
   - ✅ Configuration guide
   - ✅ Command reference
   - ✅ Examples
2. ✅ Update root `README.md`
   - ✅ Add CLI installation section
   - ✅ Link to CLI package README
3. ✅ Improve error messages
   - ✅ Review all error cases for clarity
   - ✅ Ensure actionable error messages

**CLI README Structure:**

```markdown
# @ethoko/cli

Standalone CLI for Ethoko artifact management.

## Installation

### npm — Binary (recommended)

\`\`\`bash
npm install -g @ethoko/cli
\`\`\`

This installs a thin wrapper that resolves the platform-specific binary automatically.

### npm — Node.js (for development)

\`\`\`bash
npm install -g @ethoko/cli-beacon
\`\`\`

This installs the source package and runs via Node.js directly. Useful for contributors or environments where binaries aren't available.

### Direct binary download (no Node.js required)

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/VGLoic/ethoko-monorepo/main/install.sh | bash
\`\`\`

## Quick Start

1. Create `ethoko.json`:
   \`\`\`json
   {
   "project": "my-contracts",
   "storage": {
   "type": "local",
   "path": ".ethoko-storage"
   }
   }
   \`\`\`

2. Push artifacts:
   \`\`\`bash
   ethoko push --artifact-path out/build-info --tag v1.0.0
   \`\`\`

3. Pull artifacts:
   \`\`\`bash
   ethoko pull --tag v1.0.0
   \`\`\`

## Configuration

[Full config schema and examples]

## Commands

[Full command reference]
```

**Validation:**

```bash
# Review README for clarity
cat packages/cli-beacon/README.md

# Test config examples in README
pnpm --filter @ethoko/cli-beacon lint
pnpm --filter @ethoko/cli-beacon check-types
```

**Deliverables:**

- ✅ Complete CLI README
- ✅ Root README updated
- ✅ Clear error messages

---

### Timeline Summary

| Phase                                  | Duration        | Cumulative  |
| -------------------------------------- | --------------- | ----------- |
| Phase 1: CLI Structure (✅ Completed)  | 4-6 hours       | 4-6 hours   |
| Phase 2: Binary Compilation (✅ Done)  | 2-3 hours       | 6-9 hours   |
| Phase 3: Beacon Pattern + Publish (✅) | 2-3 hours       | 8-12 hours  |
| Phase 4: GitHub Actions (CI) (✅ Done) | 2-3 hours       | 10-15 hours |
| Phase 5: Install Script (curl) (✅)    | 2 hours         | 12-17 hours |
| Phase 6: Documentation (✅ Completed)  | 1-1.5 hours     | 13-18 hours |
| **Total**                              | **13-18 hours** |             |

---

## 9. Success Metrics

### Technical Metrics

**Binary Quality:**

- ✅ Binary size < 60MB per platform
- ✅ Cold start time < 100ms
- ✅ All 8 commands functional
- ✅ Zero runtime errors in common use cases

**Distribution Success:**

- ✅ npm installation works on all 5 platforms
- ✅ Curl install script works on Linux/macOS
- ✅ Binaries uploaded to every release
- ✅ Platform packages published automatically

**Testing:**

- ✅ Integration tests pass for all commands (via apps E2E tests)
- ✅ Manual testing on all 5 platforms
- ✅ Integration tests with real S3 and LocalStack
- ✅ Zero linting/type errors

---

### User Adoption Metrics (Post-Launch)

**Early Adoption (First Month):**

- 50+ npm installs per week
- 10+ GitHub Stars
- 5+ community issues/discussions

**Growth (First Quarter):**

- 500+ npm installs total
- 50+ GitHub Stars
- Usage in at least 1 production project
- Positive feedback in community channels

**Long-term Success (First Year):**

- 5,000+ npm installs total
- 200+ GitHub Stars
- Multiple case studies from Foundry projects
- Community contributions (PRs, issues)

---

### Quality Metrics

**Reliability:**

- < 1% error rate in production
- Zero data loss incidents
- < 1 critical bug per month

**Performance:**

- Push/pull operations < 10s for typical artifacts
- Binary startup < 100ms
- Memory usage < 100MB

**Developer Experience:**

- Clear error messages (no cryptic stack traces)
- Comprehensive documentation
- Quick response to issues (< 48 hours)

---

## 10. Risk Analysis

### Technical Risks

#### Risk 1: Bun Compilation Fails for Some Platforms

**Likelihood:** Low  
**Impact:** High  
**Mitigation:**

- Test compilation early (Phase 2)
- Fallback to `pkg` or `nexe` if needed
- Worst case: Ship Node.js + bundled code (less ideal)

---

#### Risk 2: Binary Size Too Large (>100MB)

**Likelihood:** Low  
**Impact:** Medium  
**Mitigation:**

- Bun produces ~30-50MB binaries (proven with OpenCode)
- If larger, investigate tree-shaking and dead code elimination
- Acceptable up to 100MB for standalone binary

---

#### Risk 3: Platform Detection Edge Cases

**Likelihood:** Medium  
**Impact:** Low  
**Mitigation:**

- Use OpenCode's proven detection logic
- Provide `--platform` override flag
- Document manual installation steps

---

#### Risk 4: Breaking Changesets Workflow

**Likelihood:** Low  
**Impact:** Critical  
**Mitigation:**

- Only extend workflow, don't modify `release` job
- Test with dummy changeset before production
- Rollback plan: remove new job, no impact on existing flow

---

### Product Risks

#### Risk 5: Low User Adoption

**Likelihood:** Medium  
**Impact:** Medium  
**Mitigation:**

- Promote in Foundry community channels
- Create video tutorials and examples
- Showcase in README with clear value proposition

---

#### Risk 6: Compatibility Issues with Foundry

**Likelihood:** Medium  
**Impact:** High  
**Mitigation:**

- Test with multiple Foundry versions
- Document supported Foundry versions
- Provide clear error messages for unsupported formats
- Maintain test suite with Foundry integration

---

#### Risk 7: S3 Configuration Complexity

**Likelihood:** High  
**Impact:** Medium  
**Mitigation:**

- Provide clear AWS setup guide
- Support multiple authentication methods (access keys, IAM roles, env vars)
- Offer local storage as simple alternative
- Create troubleshooting guide

---

### Business Risks

#### Risk 8: Maintenance Burden

**Likelihood:** Medium  
**Impact:** Medium  
**Mitigation:**

- Automated releases (no manual steps)
- Comprehensive integration tests catch regressions (via apps E2E tests)
- Clear contributor guidelines
- Invest in documentation upfront

---

#### Risk 9: Security Vulnerabilities in Dependencies

**Likelihood:** Low  
**Impact:** High  
**Mitigation:**

- Regular dependency updates
- Automated security scanning (Dependabot)
- Minimize dependencies (only Commander.js + @ethoko/core)
- Audit dependencies before major releases

---

## 11. Open Questions

### Q1: Versioning Strategy ✅ DECIDED

**Question:** Should CLI version match `@ethoko/core` version or be independent?

**Decision:** **Independent versioning**

- CLI depends on `@ethoko/core` with `^` range
- Example: `@ethoko/cli@0.1.0` depends on `@ethoko/core@^0.8.0`
- Document compatibility in CLI README

---

### Q2: Config File Discovery ✅ DECIDED

**Question:** Should CLI search parent directories for `ethoko.json`?

**Decision:** **Search upwards** (standard pattern like ESLint, `.git`, `package.json`)

- Check current directory first
- Walk up to filesystem root
- Stop at first `ethoko.json` found
- Provide `--config <path>` to override

---

### Q3: Validation Workflow Frequency ✅ DECIDED

**Question:** Run full validation after each phase or only at end?

**Decision:** **After each phase**

- Phases are small (2-6 hours each)
- Catching issues early saves time
- Run: `pnpm build && pnpm lint && pnpm check-types && pnpm test:e2e:core`

---

### Q4: Config Filename ✅ DECIDED

**Question:** Use `ethoko.config.json` or `ethoko.json`?

**Decision:** **`ethoko.json`**

- Simpler, follows common patterns (`.eslintrc.json` → `eslint.json` trend)
- Less typing for users

---

### Q5: Phase 1 Test Strategy ✅ DECIDED

**Question:** How should integration apps test both Hardhat plugin and CLI?

**Decision:** **Parallel execution with separate test files**

- Compilation in global `setup.ts` (once per app)
- Hardhat plugin tests: existing file, update tag to `2026-hardhat-plugin`
- CLI tests: new file `push-pull-deploy.cli.e2e.test.ts`, tag `2026-cli`
- Tests run in parallel (Vitest handles file-level parallelism)
- Different tags prevent storage conflicts

---

### Q6: Auto-Update Mechanism

**Question:** Should CLI support self-update?

**Context:** Similar to `bun upgrade`, `rustup update`

**Implementation:**

- Add `ethoko update` command
- Check GitHub API for latest release
- Download new binary
- Replace current binary
- Only for direct binary installs (npm users use `npm update`)

**Recommendation:** Phase 7+ enhancement (post-MVP)

- Get CLI stable first
- Add auto-update after user feedback
- Consider security implications (verify signatures)

**Decision:** ⏳ Defer to Phase 7

---

### Q7: `@ethoko/cli-beacon` Starting Version ✅ DECIDED

**Question:** What version should `@ethoko/cli-beacon` start at, given that `@ethoko/cli@0.1.0` already exists on npm?

**Decision:** **`@ethoko/cli-beacon` starts at `0.1.1`**

- `@ethoko/cli-beacon` is a new package name, so `0.1.1` is available
- The existing `@ethoko/cli@0.1.0` on npm will be deprecated
- The generated `@ethoko/cli` wrapper picks up from the next available version (matching `@ethoko/cli-beacon` version)

---

### Q8: Node.js Fallback in Wrapper ✅ DECIDED

**Question:** Should the `@ethoko/cli` wrapper fall back to running via Node.js if the platform binary is not found?

**Decision:** **No fallback**

- If the platform binary is not found, the wrapper errors with an actionable message
- Users who want Node.js execution install `@ethoko/cli-beacon` directly
- This keeps the wrapper simple and avoids shipping Node.js source code in the wrapper package

---

## 12. Appendices

### Appendix A: Command Porting Reference

**Pattern: Hardhat Task → CLI Command**

**Before (Hardhat Task):**

```typescript
// packages/hardhat-ethoko/src/tasks/push.ts
export default async function (taskArguments, hre: HardhatRuntimeEnvironment) {
  const ethokoConfig = hre.config.ethoko;

  // Validate args
  const opts = z.object({ tag: z.string().optional() }).safeParse(taskArguments);

  // Create storage provider
  const storageProvider = ethokoConfig.storageConfiguration.type === "aws"
    ? new S3BucketProvider({ ... })
    : new LocalStorageProvider({ ... });

  // Call core function
  await push(artifactPath, project, tag, storageProvider, opts);
}
```

**After (CLI Command):**

```typescript
// packages/cli-beacon/src/commands/push.ts
import { Command } from "commander";
import { loadConfig } from "../config";
import { createStorageProvider } from "../utils/storage-provider";
import { push } from "@ethoko/core/cli-client";

export function registerPushCommand(program: Command) {
  program
    .command("push")
    .option("--tag <tag>", "Tag to associate with artifact")
    .action(async (options) => {
      const config = await loadConfig(options.config);
      const storageProvider = createStorageProvider(config.storage);
      await push(
        artifactPath,
        config.project,
        options.tag,
        storageProvider,
        opts,
      );
    });
}
```

---

### Appendix B: Platform Package Template

Platform packages are **generated at publish time** by `scripts/publish-cli.ts` and are NOT committed to git.

```
@ethoko/cli-{os}-{arch}/
├── package.json
└── bin/
    └── ethoko[.exe]
```

**package.json Template:**

```json
{
  "name": "@ethoko/cli-{os}-{arch}",
  "version": "0.1.1",
  "description": "Ethoko CLI binary for {OS} {ARCH}",
  "os": ["{os}"],
  "cpu": ["{arch}"],
  "files": ["bin"],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/VGLoic/ethoko-monorepo"
  },
  "homepage": "https://github.com/VGLoic/ethoko-monorepo#readme",
  "bugs": {
    "url": "https://github.com/VGLoic/ethoko-monorepo/issues"
  }
}
```

**README.md Template:**

```markdown
# @ethoko/cli-{os}-{arch}

Ethoko CLI binary for {OS} {ARCH}.

This package is automatically installed as an optional dependency of `@ethoko/cli`.

## Direct Usage

If you need to use this binary directly:

\`\`\`bash
./node_modules/@ethoko/cli-{os}-{arch}/bin/ethoko --version
\`\`\`

## Installation

This package is typically installed automatically via:

\`\`\`bash
npm install -g @ethoko/cli
\`\`\`
```

---

### Appendix C: GitHub Actions Workflow Reference

**Complete workflow file:** `.github/workflows/main.yaml`

Key changes for the Beacon Pattern:

1. Detect if `@ethoko/cli-beacon` was published (parse `publishedPackages` JSON)
2. Build binaries only when `@ethoko/cli-beacon` is in the published set
3. Run `publish-cli.ts` to generate and publish `@ethoko/cli` + 5 platform packages
4. Create GitHub Release with `cli-v{version}` tag

See Phase 4 for full workflow YAML.

---

### Appendix D: Configuration Schema Reference

**TypeScript Schema (for documentation):**

```typescript
interface EthokoConfig {
  project: string;
  compilationOutputPath?: string;
  pulledArtifactsPath?: string;
  storage: LocalStorageConfig | S3StorageConfig;
  debug?: boolean;
}

interface LocalStorageConfig {
  type: "local";
  path: string;
}

interface S3StorageConfig {
  type: "aws";
  awsBucketName: string;
  awsRegion: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsRole?: string;
}
```

**Zod Schema (runtime validation):**

```typescript
const ConfigSchema = z.object({
  project: z.string().min(1),
  compilationOutputPath: z.string().optional(),
  pulledArtifactsPath: z.string().default(".ethoko"),
  storage: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("local"),
      path: z.string(),
    }),
    z.object({
      type: z.literal("aws"),
      awsBucketName: z.string(),
      awsRegion: z.string(),
      awsAccessKeyId: z.string().optional(),
      awsSecretAccessKey: z.string().optional(),
      awsRole: z.string().optional(),
    }),
  ]),
  debug: z.boolean().default(false),
});
```

---

### Appendix E: Testing Checklist

**Pre-Implementation Testing:**

- [x] `@ethoko/core` has no Hardhat dependencies
- [x] All 8 CLI client functions are pure (no HRE dependency)

**Phase 1 Testing:**

- [x] Config loads from JSON file
- [x] Config validation catches invalid configs
- [x] Storage provider factory creates correct instances
- [x] All 8 commands parse arguments correctly
- [x] Commands call correct `@ethoko/core` functions

**Phase 2 Testing:**

- [ ] Bun compiles for all 5 platforms
- [ ] Binaries are 30-60MB each
- [ ] Local platform binary executes successfully
- [ ] Binary shows correct version

**Phase 3 Testing:**

- [x] Source package renamed to `@ethoko/cli-beacon`
- [x] All workspace references updated (`apps/*/package.json`)
- [x] Pending changeset updated to `@ethoko/cli-beacon`
- [x] `publish-cli.ts` generates correct wrapper `package.json`
- [x] `publish-cli.ts` generates correct platform `package.json` (os/cpu fields)
- [x] Wrapper script uses `require.resolve` (no `node_modules` walking)
- [x] Wrapper errors with actionable message when binary not found (no fallback)
- [x] `--dry-run` mode generates packages without publishing
- [x] Generated `@ethoko/cli/bin/ethoko` resolves and spawns binary correctly

**Phase 4 Testing:**

- [x] GitHub Actions detects `@ethoko/cli-beacon` in published packages
- [x] Bun installs in CI
- [x] All binaries build in CI
- [x] `publish-cli.ts` publishes `@ethoko/cli` + 5 platform packages
- [x] GitHub Release created with `cli-v{version}` tag
- [x] All 5 binaries uploaded to GitHub Release
- [x] No errors in CI logs
- [x] End-to-end: `npm install -g @ethoko/cli` resolves binary and runs

**Phase 5 Testing:**

- [x] Install script detects platform correctly
- [x] Install script downloads correct binary
- [x] Install script sets executable permissions
- [x] Install script adds to PATH
- [x] Installed binary works

**Phase 6 Testing:**

- [x] Documentation is accurate
- [x] Examples work as documented
- [x] Error messages are clear and actionable

**Integration Testing:**

Integration testing is scheduled for a later iteration.

---

### Appendix F: Release Checklist

**Pre-Release:**

- [x] All tests passing
- [x] Documentation complete
- [x] CHANGELOG updated
- [x] Version bumped

**Create Changeset:**

```bash
pnpm changeset add
# Select: @ethoko/cli-beacon (minor)
# Summary: "Add standalone CLI"
```

**Merge Version PR:**

- [x] Changesets bot creates PR (bumps `@ethoko/cli-beacon`)
- [x] Review version bump
- [x] Merge PR → triggers release

**Post-Release:**

- [x] Verify `@ethoko/cli-beacon` published to npm (by Changesets)
- [x] Verify `@ethoko/cli` published to npm (by `publish-cli.ts`)
- [x] Verify 5 platform packages published to npm
- [x] Verify GitHub Release created with `cli-v{version}` tag
- [x] Verify binaries uploaded to GitHub Release
- [x] Test npm install: `npm install -g @ethoko/cli@latest`
- [x] Test wrapper resolves binary: `ethoko --version`
- [x] Test curl install
- [x] Announce release

---

### Appendix G: Troubleshooting Guide (Draft)

**Issue: Binary not found after npm install**

- Check platform: `node -p "os.platform() + '-' + os.arch()"`
- Check optional dependency installed: `ls node_modules/@ethoko/cli-*/bin/`
- Reinstall: `npm uninstall -g @ethoko/cli && npm install -g @ethoko/cli`
- Alternative: install Node.js version: `npm install -g @ethoko/cli-beacon`

**Issue: Permission denied**

- Run: `chmod +x $(which ethoko)`
- Or: `chmod +x ~/.ethoko/bin/ethoko`

**Issue: Config file not found**

- Check current directory: `ls ethoko.json`
- Use explicit path: `ethoko push --config /path/to/ethoko.json`

**Issue: S3 authentication fails**

- Check AWS credentials: `aws sts get-caller-identity`
- Check config: `cat ethoko.json | jq .storage`
- Use debug mode: `ethoko push --debug`

---

## Document Change Log

| Version | Date       | Author           | Changes                                                                 |
| ------- | ---------- | ---------------- | ----------------------------------------------------------------------- |
| 1.0     | 2026-03-04 | Engineering Team | Initial PRD draft                                                       |
| 1.1     | 2026-03-11 | Engineering Team | Beacon Pattern: two-package model, Q8/Q9 resolved, phases 3-4 rewritten |

---

## Approval & Sign-off

**Document Status:** Draft  
**Next Review Date:** 2026-03-11


---

**END OF DOCUMENT**
