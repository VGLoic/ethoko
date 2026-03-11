# CLI Multi-Channel Distribution: Research & Options

**Date:** March 11, 2026  
**Context:** Ethoko CLI (`@ethoko/cli`) needs distribution via curl, Homebrew, npm, and potentially other package managers.  
**Current state:** Phase 1 (CLI package + integration tests) completed. Binary compilation via Bun working. No release pipeline for binaries yet.

---

## Table of Contents

1. [Current State Assessment](#1-current-state-assessment)
2. [How Other CLIs Do It](#2-how-other-clis-do-it)
3. [The Industry-Standard Pattern](#3-the-industry-standard-pattern)
4. [Proposed Options for Ethoko](#4-proposed-options-for-ethoko)
5. [Recommendation](#5-recommendation)
6. [Appendix: Detailed Tool Comparisons](#appendix-detailed-tool-comparisons)

---

## 1. Current State Assessment

### What exists

| Component                     | Status         | Details                                                                                                  |
| ----------------------------- | -------------- | -------------------------------------------------------------------------------------------------------- |
| CLI source code               | Done           | `packages/cli/` with 8 commands via Commander.js                                                         |
| tsup build (Node.js)          | Done           | `dist/index.js` with shebang, publishable to npm                                                         |
| Bun binary compilation        | Done           | `scripts/build-binary.ts` builds 5 platform binaries                                                     |
| Changesets                    | Done           | Already configured, `access: "public"`, independent versioning                                           |
| CI smoke test                 | Done           | `build-cli-binary` job in PR workflow                                                                    |
| npm publish (Node.js)         | Partially done | `changeset publish` will publish the tsup output, but `bin` points to `dist/index.js` (requires Node.js) |
| Platform binary npm packages  | Not started    | No `@ethoko/cli-darwin-arm64` etc.                                                                       |
| GitHub Releases with binaries | Not started    | Release job doesn't build or upload binaries                                                             |
| curl install script           | Not started    |                                                                                                          |
| Homebrew tap                  | Not started    |                                                                                                          |

### Key problem with current approach

The PRD (Phase 3) describes generating platform packages (`@ethoko/cli-linux-x64`, etc.) at publish time and using the `optionalDependencies` pattern. This is the correct direction. However, the current code has:

1. **No publish script** -- `scripts/build-binary.ts` builds but nothing packages or publishes
2. **No wrapper script** -- `bin` points directly to `dist/index.js`, not a platform resolver
3. **No CI integration** -- the release job in `main.yaml` doesn't touch binaries
4. **`exports` field mismatch** -- references `.mjs`/`.d.mts` but tsup outputs `.js`/`.d.ts`

---

## 2. How Other CLIs Do It

### 2.1 OpenCode (TypeScript/Bun)

**Most relevant comparison** -- same tech stack (TypeScript, Bun compiler, npm distribution).

| Aspect                 | Details                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Binary compiler**    | Bun `Bun.build({ compile: true })` -- same as Ethoko                                                       |
| **Platforms**          | 11 targets (incl. musl, baseline/AVX2 variants)                                                            |
| **npm package**        | `opencode-ai` (unscoped) with `optionalDependencies` to 11 platform packages                               |
| **npm resolver**       | `bin/opencode` -- Node.js script that detects platform, walks `node_modules`, finds binary                 |
| **postinstall**        | Hard-links platform binary to `bin/.opencode` for fast subsequent runs                                     |
| **curl install**       | Shell script at `https://opencode.ai/install` -- detects OS/arch/musl/AVX2, downloads from GitHub Releases |
| **Homebrew**           | Custom tap (`anomalyco/homebrew-tap`) auto-updated on release. Also in Homebrew core (community)           |
| **Other channels**     | Scoop, Chocolatey, AUR, Nix, Docker, desktop apps (Tauri/Electron)                                         |
| **Release automation** | Custom `publish.yml` workflow. NOT changesets. Version auto-increments from latest npm.                    |
| **Versioning**         | Single version for all packages, auto-incremented patch                                                    |

**Key takeaway:** OpenCode is the gold standard for Bun-compiled CLI distribution but uses a fully custom release pipeline (no changesets). Their wrapper script and install.sh are excellent reference implementations.

### 2.2 SWC (Rust/NAPI-RS)

| Aspect                 | Details                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| **Binary compiler**    | Rust + NAPI-RS framework                                                                        |
| **Platforms**          | 12 targets (incl. musl, ARM, Windows ARM64)                                                     |
| **npm package**        | `@swc/core` (scoped) with `optionalDependencies` injected at publish time by NAPI-RS            |
| **npm resolver**       | Auto-generated `binding.js` -- tries local `.node` file, then `require('@swc/core-{platform}')` |
| **postinstall**        | Validates binary works, auto-installs `@swc/wasm` fallback if native fails                      |
| **curl/Homebrew**      | None -- npm only for JS users, crates.io for Rust users                                         |
| **Release automation** | Manual `workflow_dispatch`, nightly-then-stable pipeline                                        |
| **Versioning**         | NAPI-RS tooling syncs all platform package versions                                             |

**Key takeaway:** NAPI-RS automates the boilerplate of platform packages but is Rust-specific. The pattern of injecting `optionalDependencies` at publish time (not in source) is clean. The WASM fallback is clever but overkill for Ethoko.

### 2.3 Biome (Rust) -- Uses Changesets

| Aspect                      | Details                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------- |
| **Binary compiler**         | Rust cross-compilation                                                             |
| **Platforms**               | 8 targets (incl. musl)                                                             |
| **npm package**             | `@biomejs/biome` (scoped) with `optionalDependencies` to `@biomejs/cli-{platform}` |
| **npm resolver**            | `bin/biome` -- `require.resolve("@biomejs/cli-{platform}/biome")` then `spawnSync` |
| **Platform pkg generation** | `generate-packages.mjs` at publish time -- copies version/metadata, places binary  |
| **Release automation**      | **Changesets** with `"fixed"` groups to keep all packages in sync                  |
| **Homebrew**                | Community formula in homebrew-core                                                 |

**Key takeaway:** **Biome is the only major CLI tool using changesets for native binary distribution.** Their `"fixed"` group config is the reference for how to keep platform packages versioned together:

```json
{
  "fixed": [
    ["@biomejs/biome", "@biomejs/cli-win32-x64", "@biomejs/cli-darwin-arm64", ...]
  ]
}
```

However, Biome commits stub platform package directories to the repo so changesets can track them. The actual binary is placed at publish time.

### 2.4 Turborepo (Rust)

| Aspect                      | Details                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **npm package**             | `turbo` (unscoped) with `optionalDependencies` to `turbo-{platform}`                                             |
| **npm resolver**            | Most sophisticated -- env override, JIT `npm install` fallback, Rosetta emulation fallback, lockfile diagnostics |
| **Platform pkg generation** | Generated in CI, not committed                                                                                   |
| **Release automation**      | Custom `turbo-releaser`, no changesets                                                                           |
| **Homebrew**                | Community formula                                                                                                |

**Key takeaway:** Turbo's JIT install fallback (auto-installs the platform package if missing) is clever but adds complexity. Their resolver is ~200 lines vs Lefthook's ~15 lines.

### 2.5 Lefthook (Go) -- Most Channels

| Aspect                 | Details                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| **Binary compiler**    | GoReleaser                                                                                       |
| **Platforms**          | 10 targets                                                                                       |
| **npm package**        | `lefthook` (unscoped) with `optionalDependencies` to `lefthook-{platform}`                       |
| **npm resolver**       | Simplest -- ~15 lines, just `require.resolve()`                                                  |
| **Release automation** | GoReleaser + per-channel publish jobs                                                            |
| **Channels**           | npm, RubyGems, PyPI, Homebrew core (auto-bump), Winget, Snapcraft, AUR (2 packages), deb/rpm/apk |
| **Homebrew**           | **Auto-bumps Homebrew core formula** via `dawidd6/action-homebrew-bump-formula`                  |

**Key takeaway:** Lefthook demonstrates the widest channel coverage. The Homebrew core auto-bump action (`dawidd6/action-homebrew-bump-formula`) is the easiest path to Homebrew distribution. Their npm resolver is refreshingly simple.

### 2.6 Anti-Pattern: Prisma (postinstall download)

Prisma downloads binaries in `postinstall` via HTTP. This fails with `--ignore-scripts`, requires network at install, doesn't benefit from npm caching, and breaks in air-gapped environments. **Avoid this pattern.**

---

## 3. The Industry-Standard Pattern

All modern CLI tools converge on the same architecture:

```
                          npm install @scope/cli
                                   |
                     +--------------------------+
                     |    @scope/cli (wrapper)   |
                     |                          |
                     |  optionalDependencies:   |
                     |    @scope/cli-darwin-arm64|
                     |    @scope/cli-linux-x64  |
                     |    ...                   |
                     +--------------------------+
                                   |
                    npm resolves os/cpu fields
                                   |
                     +--------------------------+
                     | @scope/cli-darwin-arm64  |
                     |                          |
                     |  os: ["darwin"]          |
                     |  cpu: ["arm64"]          |
                     |  bin/ethoko (binary)     |
                     +--------------------------+
                                   |
                     bin/ethoko (wrapper.js)
                     resolves + spawns binary
```

### The consensus design decisions

| Decision                        | Consensus                                         | Rationale                                           |
| ------------------------------- | ------------------------------------------------- | --------------------------------------------------- |
| **Scoped vs unscoped**          | Scoped (`@scope/cli-*`) preferred                 | Cleaner namespace, org ownership                    |
| **Platform package generation** | At publish time, not committed                    | Keeps repo clean, avoids git bloat                  |
| **Resolver complexity**         | Simple (Lefthook-style) unless you need fallbacks | YAGNI -- start simple                               |
| **postinstall**                 | Optional optimization (OpenCode hard-link)        | Not required, adds friction with `--ignore-scripts` |
| **Version sync**                | All platform pkgs same version as main            | Required -- mismatch = broken installs              |
| **GitHub Releases**             | Attach binaries to release tags                   | Backing store for curl/Homebrew                     |
| **curl install script**         | Download from GitHub Releases                     | Simple, reliable, CDN-backed                        |
| **Homebrew**                    | Start with custom tap, graduate to core           | Core requires established user base                 |

---

## 4. Proposed Options for Ethoko

### Option A: Changesets + Fixed Groups (Biome Pattern)

**Approach:** Commit stub platform package directories to the repo. Use changesets `"fixed"` groups to version them together. Build and place binaries at publish time.

**Repo structure changes:**

```
packages/
  cli/                           # existing
  cli-platform-packages/         # NEW -- stubs for changesets
    darwin-arm64/package.json
    darwin-x64/package.json
    linux-arm64/package.json
    linux-x64/package.json
    windows-x64/package.json
```

**Changesets config:**

```json
{
  "fixed": [
    [
      "@ethoko/cli",
      "@ethoko/cli-darwin-arm64",
      "@ethoko/cli-darwin-x64",
      "@ethoko/cli-linux-arm64",
      "@ethoko/cli-linux-x64",
      "@ethoko/cli-windows-x64"
    ]
  ]
}
```

**Release flow:**

1. Developer creates a changeset for `@ethoko/cli`
2. `changesets/action` creates Version PR bumping all 6 packages
3. On merge, `changeset publish` publishes `@ethoko/cli` (Node.js version)
4. Post-publish CI step:
   - Builds 5 binaries with Bun
   - Places binaries into stub package dirs
   - Publishes 5 platform packages to npm
   - Uploads binaries to GitHub Release

**Pros:**

- Integrates with existing changesets setup
- Version sync is automatic via `"fixed"` groups
- Changesets handles changelog generation
- Matches Biome's proven approach

**Cons:**

- Stub package dirs in repo (5 extra `package.json` files)
- Two-phase publish: changesets publishes main, then custom script publishes platform packages
- The platform packages aren't _really_ managed by changesets (binaries placed post-changeset-publish)
- `pnpm-workspace.yaml` needs to include the stub packages
- Adds complexity to the workspace (turbo, lint, check-types may need `ignore` entries)

---

### Option B: Changesets for Main + Custom Script for Platform Packages (Hybrid)

**Approach:** Only `@ethoko/cli` is managed by changesets. Platform packages are generated and published by a custom script triggered after changesets publishes. No stub directories committed.

**Repo structure changes:**

```
packages/
  cli/
    scripts/
      build-binary.ts          # existing
      publish-platform.ts      # NEW -- generates + publishes platform packages
    bin/
      ethoko                   # NEW -- Node.js wrapper/resolver
```

**Release flow:**

1. Developer creates changeset for `@ethoko/cli`
2. `changesets/action` creates Version PR
3. On merge, `changeset publish` publishes `@ethoko/cli` to npm
4. CI detects `@ethoko/cli` was published (check `changesets.outputs.publishedPackages`)
5. Post-publish steps:
   - Reads version from `@ethoko/cli/package.json`
   - Builds 5 binaries with Bun
   - Generates 5 platform package dirs in `/tmp` or `dist/`
   - Publishes 5 platform packages with same version
   - Creates GitHub Release with binaries attached

**Key script: `publish-platform.ts`**

```typescript
// 1. Read version from packages/cli/package.json
// 2. For each platform:
//    a. Create temp dir with package.json (name, version, os, cpu, files)
//    b. Copy binary from binaries/ into temp dir
//    c. npm publish from temp dir
// 3. Upload binaries to GitHub Release
```

**Main package.json changes:**

```json
{
  "bin": { "ethoko": "./bin/ethoko" },
  "optionalDependencies": {
    "@ethoko/cli-darwin-arm64": "0.1.0",
    "@ethoko/cli-darwin-x64": "0.1.0",
    "@ethoko/cli-linux-arm64": "0.1.0",
    "@ethoko/cli-linux-x64": "0.1.0",
    "@ethoko/cli-windows-x64": "0.1.0"
  }
}
```

Note: The `optionalDependencies` versions need updating on each release. This can be done by:

- A `changeset version` hook (using `onVersion` or a custom script in `preversion`)
- Or the `publish-platform.ts` script updates the main package.json before `changeset publish`

**Pros:**

- Clean repo -- no stub directories
- Simple changesets config (no `"fixed"` groups)
- Full control over platform package generation
- Single source of truth for version (main package.json)
- Matches OpenCode and Turbo patterns

**Cons:**

- `optionalDependencies` version sync requires care (must match published version)
- Custom publish script is more code to maintain
- Two-step publish (changesets, then custom) requires careful CI ordering
- If changesets publish succeeds but platform publish fails, users get a broken install (no binary found)

---

### Option C: Fully Custom Release (OpenCode Pattern)

**Approach:** Drop changesets for the CLI. Use a custom version-bump + publish workflow. Changesets remains for `@ethoko/core` and Hardhat plugins only.

**Release flow:**

1. `@ethoko/core` and Hardhat plugins continue using changesets as-is
2. `@ethoko/cli` gets its own release workflow:
   - Triggered manually (`workflow_dispatch`) or on tag push
   - Bumps version in all package.json files
   - Builds 5 binaries
   - Publishes main package + 5 platform packages in one script
   - Creates GitHub Release
   - Updates Homebrew tap

**Pros:**

- Most flexibility
- Single atomic publish step (all 6 packages at once)
- No version sync issues
- Can add channels easily (Homebrew, AUR, etc.)
- No interference with existing changesets workflow

**Cons:**

- Loses changesets benefits for CLI (changelog generation, version PR, monorepo integration)
- CLI version becomes disconnected from `@ethoko/core` (already independent, but less visibility)
- More custom code
- Two different release systems in one repo

---

### Option D: Changesets + `onPublish` Hook (Cleanest Integration)

**Approach:** Use a changesets lifecycle hook to trigger binary builds and platform package publishing immediately after `changeset publish` succeeds for `@ethoko/cli`.

**How it works:** Changesets doesn't have a native `onPublish` hook, but the CI workflow can detect which packages were published and act on it:

```yaml
- name: Create Release Pull Request or Publish
  id: changesets
  uses: changesets/action@v1
  with:
    publish: "pnpm release"

# changesets outputs `publishedPackages` as JSON array
- name: Check if CLI was published
  id: check_cli
  run: |
    CLI_PUBLISHED=$(echo '${{ steps.changesets.outputs.publishedPackages }}' | jq -r '.[] | select(.name == "@ethoko/cli") | .version')
    echo "version=$CLI_PUBLISHED" >> $GITHUB_OUTPUT

- name: Build and publish CLI binaries
  if: steps.check_cli.outputs.version != ''
  run: |
    pnpm --filter @ethoko/cli build:binary
    node packages/cli/scripts/publish-platform.mjs ${{ steps.check_cli.outputs.version }}
  env:
    NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**For `optionalDependencies` version sync**, use a changesets `preversion` script or a Turborepo `prepublish` step that reads the version from `package.json` and injects the `optionalDependencies` with matching versions. Alternatively, hardcode `optionalDependencies` with `*` or a `^` range and let npm resolve.

**Actually, the cleanest approach:** Don't put `optionalDependencies` in the source `package.json` at all. Instead, have the publish script:

1. Read version from `packages/cli/package.json` (already bumped by changesets)
2. Inject `optionalDependencies` with exact versions into the published package
3. Publish everything

But wait -- changesets already published `@ethoko/cli` without `optionalDependencies`. So npm users would need to install the platform package separately... unless we use a different strategy.

**Better: Two npm packages.**

- `@ethoko/cli` -- the Node.js version (no binary needed, works with `node dist/index.js`). This is what changesets publishes.
- `ethoko` (or `@ethoko/ethoko`) -- the binary wrapper with `optionalDependencies`. Published by custom script after changesets.

This separation is actually cleaner:

- `@ethoko/cli` = library/Node.js CLI (managed by changesets, works without binaries)
- `ethoko` = binary CLI (managed by custom script, delegates to platform packages)

**Pros:**

- Clean separation of concerns
- Changesets handles what it's good at (versioning, changelogs)
- Custom script handles what it's good at (binary distribution)
- `@ethoko/cli` remains a perfectly functional npm package
- Users who want Node.js can use `@ethoko/cli`
- Users who want binary can use `ethoko` (or `npm i -g ethoko`)

**Cons:**

- Two packages for essentially the same thing (may confuse users)
- Extra package to maintain
- Need to keep versions in sync between the two

---

### Option E: Beacon Package Pattern (Source/Distribution Split)

**Approach:** Rename the current `@ethoko/cli` to `@ethoko/cli-beacon`. This is the **source package** -- it contains all the CLI source code, is tracked by changesets, and gets published to npm. But users never install it directly. Instead, `cli-beacon` contains a publish script that **generates** the public-facing `@ethoko/cli` (binary wrapper + `optionalDependencies`) and the 5 platform packages. The generated `@ethoko/cli` changelog is `@ethoko/cli-beacon`'s changelog.

**Repo structure:**

```
packages/
  cli/                              # renamed from @ethoko/cli → @ethoko/cli-beacon
    src/                            # existing CLI source code
    scripts/
      build-binary.ts              # existing Bun compilation
      publish-cli.ts               # NEW: generates + publishes @ethoko/cli + platform pkgs
    bin/
      ethoko                       # NEW: Node.js wrapper (shipped in generated @ethoko/cli)
    package.json                   # name: "@ethoko/cli-beacon", published to npm
    ...
```

**What gets published to npm:**

| Package                    | Published by            | Contains                                               |
| -------------------------- | ----------------------- | ------------------------------------------------------ |
| `@ethoko/cli-beacon`       | Changesets              | CLI source (tsup output), changelog, version tracking  |
| `@ethoko/cli`              | `publish-cli.ts` script | Wrapper script (`bin/ethoko`) + `optionalDependencies` |
| `@ethoko/cli-darwin-arm64` | `publish-cli.ts` script | Standalone Bun binary                                  |
| `@ethoko/cli-darwin-x64`   | `publish-cli.ts` script | Standalone Bun binary                                  |
| `@ethoko/cli-linux-arm64`  | `publish-cli.ts` script | Standalone Bun binary                                  |
| `@ethoko/cli-linux-x64`    | `publish-cli.ts` script | Standalone Bun binary                                  |
| `@ethoko/cli-windows-x64`  | `publish-cli.ts` script | Standalone Bun binary                                  |

**Release flow:**

```
Developer: creates changeset for @ethoko/cli-beacon

CI (on merge to main):
  1. changesets/action creates Version PR (bumps @ethoko/cli-beacon)
  2. On Version PR merge:
     a. turbo run build
     b. changeset publish → publishes @ethoko/cli-beacon to npm
     c. CI detects @ethoko/cli-beacon was published
     d. Reads version from @ethoko/cli-beacon/package.json
     e. Builds 5 binaries with Bun
     f. Runs publish-cli.ts which:
        - Generates @ethoko/cli package (wrapper + optionalDeps at version X)
        - Generates 5 platform packages (binary + os/cpu fields at version X)
        - Publishes all 6 to npm
     g. Creates GitHub Release (tag: cli-vX) with binaries attached
     h. (Future) Updates Homebrew tap
```

**Generated `@ethoko/cli/package.json`:**

```json
{
  "name": "@ethoko/cli",
  "version": "0.2.0",
  "description": "Standalone CLI for Ethoko artifact management",
  "bin": { "ethoko": "./bin/ethoko" },
  "files": ["bin"],
  "os": ["darwin", "linux", "win32"],
  "optionalDependencies": {
    "@ethoko/cli-darwin-arm64": "0.2.0",
    "@ethoko/cli-darwin-x64": "0.2.0",
    "@ethoko/cli-linux-arm64": "0.2.0",
    "@ethoko/cli-linux-x64": "0.2.0",
    "@ethoko/cli-windows-x64": "0.2.0"
  }
}
```

**Generated platform `package.json` (e.g., `@ethoko/cli-darwin-arm64`):**

```json
{
  "name": "@ethoko/cli-darwin-arm64",
  "version": "0.2.0",
  "description": "Ethoko CLI binary for macOS ARM64",
  "os": ["darwin"],
  "cpu": ["arm64"],
  "files": ["bin"],
  "license": "MIT"
}
```

**Pros:**

- **Clean separation:** source package (beacon) vs distribution packages (cli + platforms). No hacks.
- **Full changesets integration:** `cli-beacon` is a normal workspace package. Changesets handles versioning, changelogs, and the Version PR. The changelog for `cli-beacon` _is_ the CLI changelog.
- **No version sync tricks:** `publish-cli.ts` reads `cli-beacon`'s version and stamps it on all 6 generated packages. Single source of truth.
- **No `optionalDependencies` in source:** the source `package.json` is clean. `optionalDependencies` only exist in the generated package.
- **No `prepack` or lifecycle hook hacks:** changesets publishes `cli-beacon` normally. The binary distribution is a separate, explicit step.
- **`@ethoko/cli` is the user-facing name:** users run `npm i -g @ethoko/cli` and get the binary. Clean and expected.
- **Atomic publish:** the script publishes all 6 packages (wrapper + 5 platforms) in one go, after binaries are built.
- **Testable locally:** `cli-beacon` is a working Node.js CLI during development (used by integration apps). The binary distribution is a CI concern.
- **Existing integration apps keep working:** they depend on `@ethoko/cli-beacon: "workspace:*"` and run via Node.js in tests.

**Cons:**

- **Extra npm package** (`cli-beacon`) that's "public but not user-facing." Users may discover it and be confused. Mitigation: README says "This is an internal package. Install `@ethoko/cli` instead."
- **`@ethoko/cli` exists on npm at 0.1.0** already. Need to decide: deprecate that version, or start the generated package at a higher version.
- **publish-cli.ts is custom code.** But it's straightforward (~100-150 lines) and similar to what Biome, OpenCode, and Turbo do.
- **If changesets publish succeeds but binary publish fails:** `cli-beacon` is on npm but `@ethoko/cli` is stale. Mitigation: CI can retry, and `cli-beacon` itself isn't broken (just not the package users install).

---

## 5. Recommendation

### Recommended: Option E (Beacon Pattern)

Option E is the cleanest architecture for Ethoko's situation:

1. **Changesets manages `@ethoko/cli-beacon`** -- full changelog, version PR, monorepo integration
2. **Custom `publish-cli.ts` generates the distribution** -- full control, no hacks
3. **No stub directories, no lifecycle hooks, no version sync gymnastics**
4. **User-facing package is `@ethoko/cli`** -- clean name, binary distribution
5. **Existing integration apps keep working** -- they depend on `cli-beacon` via workspace

### Implementation plan

#### Phase 1: Rename + npm Binary Distribution

**Step 1: Rename package**

- Rename `@ethoko/cli` → `@ethoko/cli-beacon` in `packages/cli/package.json`
- Update all workspace references (`apps/*/package.json` devDependencies)
- Update CI workflows that reference `@ethoko/cli`
- Update pending changesets that reference `@ethoko/cli`

**Step 2: Create wrapper script (`packages/cli/bin/ethoko`)**

Keep it simple (Lefthook-style, ~30 lines) with Node.js fallback:

```js
#!/usr/bin/env node
const { spawnSync } = require("child_process");
const os = require("os");

const PLATFORM_MAP = { darwin: "darwin", linux: "linux", win32: "windows" };
const ARCH_MAP = { x64: "x64", arm64: "arm64" };

const platform = PLATFORM_MAP[os.platform()];
const arch = ARCH_MAP[os.arch()];

if (!platform || !arch) {
  console.error(`Unsupported: ${os.platform()}-${os.arch()}`);
  process.exit(1);
}

const pkg = `@ethoko/cli-${platform}-${arch}`;
const bin = platform === "windows" ? "ethoko.exe" : "ethoko";

let binaryPath;
try {
  binaryPath = require.resolve(`${pkg}/bin/${bin}`);
} catch {
  // No binary available -- fall back to Node.js execution
  require("@ethoko/cli-beacon/dist/index.js");
  return;
}

const result = spawnSync(binaryPath, process.argv.slice(2), {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
```

Note: The fallback `require("@ethoko/cli-beacon/dist/index.js")` means `@ethoko/cli` would need `@ethoko/cli-beacon` as a dependency (not just `optionalDependencies` for platforms). This adds the Node.js fallback but also adds a dependency. Alternative: inline the dist into the generated package, or skip the fallback entirely (keep it simple -- if no binary, error).

**Simpler approach (no fallback):**

```js
#!/usr/bin/env node
const { spawnSync } = require("child_process");
const os = require("os");

const PLATFORM = { darwin: "darwin", linux: "linux", win32: "windows" };
const ARCH = { x64: "x64", arm64: "arm64" };

const p = PLATFORM[os.platform()];
const a = ARCH[os.arch()];

if (!p || !a) {
  console.error(`Unsupported platform: ${os.platform()}-${os.arch()}`);
  process.exit(1);
}

const pkg = `@ethoko/cli-${p}-${a}`;
const bin = p === "windows" ? "ethoko.exe" : "ethoko";

try {
  const binaryPath = require.resolve(`${pkg}/bin/${bin}`);
  const { status } = spawnSync(binaryPath, process.argv.slice(2), {
    stdio: "inherit",
  });
  process.exit(status ?? 1);
} catch {
  console.error(
    `Could not find binary for ${os.platform()}-${os.arch()}.\n` +
      `Expected package: ${pkg}\n` +
      `Try reinstalling: npm install -g @ethoko/cli`,
  );
  process.exit(1);
}
```

**Step 3: Create `publish-cli.ts`**

```typescript
// packages/cli/scripts/publish-cli.ts
//
// Generates and publishes:
//   1. @ethoko/cli (wrapper with optionalDependencies)
//   2. @ethoko/cli-{platform}-{arch} (5 platform packages with binaries)
//
// Usage: bun scripts/publish-cli.ts [--dry-run]

import { readFileSync, mkdirSync, writeFileSync, cpSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const PLATFORMS = [
  { os: "darwin", arch: "arm64", npmOs: "darwin", npmCpu: "arm64" },
  { os: "darwin", arch: "x64", npmOs: "darwin", npmCpu: "x64" },
  { os: "linux", arch: "arm64", npmOs: "linux", npmCpu: "arm64" },
  { os: "linux", arch: "x64", npmOs: "linux", npmCpu: "x64" },
  { os: "windows", arch: "x64", npmOs: "win32", npmCpu: "x64" },
];

const dryRun = process.argv.includes("--dry-run");
const cliDir = join(import.meta.dir, "..");
const version = JSON.parse(
  readFileSync(join(cliDir, "package.json"), "utf-8"),
).version;
const outDir = join(cliDir, "dist-publish");

// 1. Generate platform packages
for (const p of PLATFORMS) {
  const pkgName = `@ethoko/cli-${p.os}-${p.arch}`;
  const dir = join(outDir, `cli-${p.os}-${p.arch}`);
  const binDir = join(dir, "bin");
  mkdirSync(binDir, { recursive: true });

  const ext = p.os === "windows" ? ".exe" : "";
  const binarySource = join(
    cliDir,
    "binaries",
    `ethoko-${p.os}-${p.arch}${ext}`,
  );
  cpSync(binarySource, join(binDir, `ethoko${ext}`));

  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: pkgName,
        version,
        description: `Ethoko CLI binary for ${p.os} ${p.arch}`,
        os: [p.npmOs],
        cpu: [p.npmCpu],
        files: ["bin"],
        license: "MIT",
        repository: {
          type: "git",
          url: "https://github.com/VGLoic/ethoko-monorepo",
        },
      },
      null,
      2,
    ),
  );

  if (!dryRun) {
    execSync("npm publish --access public", { cwd: dir, stdio: "inherit" });
  }
}

// 2. Generate @ethoko/cli wrapper package
const wrapperDir = join(outDir, "cli");
const wrapperBinDir = join(wrapperDir, "bin");
mkdirSync(wrapperBinDir, { recursive: true });

cpSync(join(cliDir, "bin", "ethoko"), join(wrapperBinDir, "ethoko"));

const optionalDeps = Object.fromEntries(
  PLATFORMS.map((p) => [`@ethoko/cli-${p.os}-${p.arch}`, version]),
);

writeFileSync(
  join(wrapperDir, "package.json"),
  JSON.stringify(
    {
      name: "@ethoko/cli",
      version,
      description: "Standalone CLI for Ethoko artifact management",
      bin: { ethoko: "./bin/ethoko" },
      files: ["bin"],
      optionalDependencies: optionalDeps,
      license: "MIT",
      repository: {
        type: "git",
        url: "https://github.com/VGLoic/ethoko-monorepo",
      },
    },
    null,
    2,
  ),
);

if (!dryRun) {
  execSync("npm publish --access public", {
    cwd: wrapperDir,
    stdio: "inherit",
  });
}

console.log(`Published @ethoko/cli@${version} + 5 platform packages`);
```

**Step 4: Update CI workflow (`.github/workflows/main.yaml`)**

```yaml
# After changesets/action publish step:
- name: Check if CLI beacon was published
  id: check_cli
  if: steps.changesets.outputs.published == 'true'
  run: |
    VERSION=$(echo '${{ steps.changesets.outputs.publishedPackages }}' \
      | jq -r '.[] | select(.name == "@ethoko/cli-beacon") | .version')
    echo "version=$VERSION" >> $GITHUB_OUTPUT

- name: Setup Bun
  if: steps.check_cli.outputs.version != ''
  uses: oven-sh/setup-bun@v2

- name: Build CLI binaries
  if: steps.check_cli.outputs.version != ''
  run: pnpm --filter @ethoko/cli-beacon build:binary

- name: Publish @ethoko/cli + platform packages
  if: steps.check_cli.outputs.version != ''
  run: bun packages/cli/scripts/publish-cli.ts
  env:
    NPM_TOKEN: ${{ secrets.NPM_TOKEN }}

- name: Create GitHub Release
  if: steps.check_cli.outputs.version != ''
  uses: softprops/action-gh-release@v2
  with:
    tag_name: "cli-v${{ steps.check_cli.outputs.version }}"
    name: "CLI v${{ steps.check_cli.outputs.version }}"
    files: |
      packages/cli/binaries/ethoko-linux-x64
      packages/cli/binaries/ethoko-linux-arm64
      packages/cli/binaries/ethoko-darwin-x64
      packages/cli/binaries/ethoko-darwin-arm64
      packages/cli/binaries/ethoko-windows-x64.exe
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

#### Phase 2: curl Install Script

Add `install.sh` to repo root. Downloads from GitHub Releases. Reference: OpenCode's install script.

#### Phase 3: Homebrew Tap

Create `VGLoic/homebrew-ethoko` repository with a formula. Auto-update via `dawidd6/action-homebrew-bump-formula` in the release workflow.

```ruby
# Formula/ethoko.rb
class Ethoko < Formula
  desc "Warehouse for smart-contract compilation artifacts"
  homepage "https://github.com/VGLoic/ethoko-monorepo"
  version "0.2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/VGLoic/ethoko-monorepo/releases/download/cli-v#{version}/ethoko-darwin-arm64"
      sha256 "..."
    else
      url "https://github.com/VGLoic/ethoko-monorepo/releases/download/cli-v#{version}/ethoko-darwin-x64"
      sha256 "..."
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/VGLoic/ethoko-monorepo/releases/download/cli-v#{version}/ethoko-linux-arm64"
      sha256 "..."
    else
      url "https://github.com/VGLoic/ethoko-monorepo/releases/download/cli-v#{version}/ethoko-linux-x64"
      sha256 "..."
    end
  end

  def install
    bin.install "ethoko-*" => "ethoko"
  end
end
```

### Key decisions still needed

| Decision                                        | Options                                                              | Recommendation                                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Node.js fallback in wrapper?**                | (a) Error if no binary, (b) Fall back to `@ethoko/cli-beacon`        | (a) Error -- simpler, no extra dependency. Users needing Node.js can install `@ethoko/cli-beacon` directly. |
| **What to do with `@ethoko/cli@0.1.0` on npm?** | (a) Deprecate + start generated at 0.2.0, (b) Unpublish 0.1.0        | (a) Deprecate -- unpublish has a 72h window and may already be past it.                                     |
| **`cli-beacon` README**                         | Should explain it's the source package, point users to `@ethoko/cli` | Yes, mandatory.                                                                                             |
| **Integration apps dependency**                 | Change from `@ethoko/cli` to `@ethoko/cli-beacon`                    | Yes, they use the Node.js build, not binaries.                                                              |

---

## Appendix: Detailed Tool Comparisons

### Distribution Channels Comparison

| Channel             | OpenCode        | SWC | Biome           | Turbo           | Lefthook            |
| ------------------- | --------------- | --- | --------------- | --------------- | ------------------- |
| npm (platform pkgs) | Yes             | Yes | Yes             | Yes             | Yes                 |
| GitHub Releases     | Yes             | Yes | Yes             | Yes             | Yes                 |
| curl install        | Yes             | No  | No              | No              | No                  |
| Homebrew tap        | Yes             | No  | No              | No              | No                  |
| Homebrew core       | Yes (community) | No  | Yes (community) | Yes (community) | **Yes (auto-bump)** |
| Scoop               | Yes             | No  | No              | No              | No                  |
| Chocolatey          | Yes             | No  | No              | No              | No                  |
| AUR                 | Yes             | No  | No              | No              | Yes                 |
| Docker              | Yes             | No  | No              | No              | No                  |
| Nix                 | Yes             | No  | No              | No              | No                  |
| PyPI                | No              | No  | No              | No              | Yes                 |
| RubyGems            | No              | No  | No              | No              | Yes                 |

### Release Automation Comparison

| Tool     | Release System                  | Monorepo Support | Changelog         | Platform Pkg Sync     |
| -------- | ------------------------------- | ---------------- | ----------------- | --------------------- |
| OpenCode | Custom scripts                  | Custom           | Auto from commits | Auto (single version) |
| SWC      | Manual dispatch + NAPI-RS       | Yarn workspaces  | Manual            | NAPI-RS CLI           |
| Biome    | **Changesets** (`fixed` groups) | Yes              | Changesets        | `fixed` groups        |
| Turbo    | Custom `turbo-releaser`         | Yes              | Custom            | Custom                |
| Lefthook | GoReleaser + Raku scripts       | N/A (single pkg) | GoReleaser        | Custom                |

### npm Resolver Complexity

| Tool     | Lines | Fallbacks                                | Env Override        | musl Detection |
| -------- | ----- | ---------------------------------------- | ------------------- | -------------- |
| Lefthook | ~15   | None                                     | No                  | No             |
| Biome    | ~60   | None                                     | `BIOME_BINARY`      | Yes            |
| OpenCode | ~100  | postinstall link, baseline/musl variants | `OPENCODE_BIN_PATH` | Yes            |
| SWC      | ~150  | WASM auto-install                        | No                  | Yes (3-tier)   |
| Turbo    | ~200  | JIT npm install, Rosetta emulation       | `TURBO_BINARY_PATH` | No             |

### Binary Size Comparison

| Tool           | Runtime | Approx. Size |
| -------------- | ------- | ------------ |
| Ethoko (Bun)   | Bun     | 30-50 MB     |
| OpenCode (Bun) | Bun     | 30-50 MB     |
| Biome (Rust)   | Native  | 15-25 MB     |
| Turbo (Rust)   | Native  | 10-20 MB     |
| Lefthook (Go)  | Native  | 5-10 MB      |
| SWC (Rust)     | Native  | 15-30 MB     |

Bun binaries are larger because they embed the Bun runtime. This is a tradeoff vs build simplicity (no need for a separate language toolchain).

### Release System Comparison (General)

| System               | Monorepo             | Changelog                  | Customizable Publish     | Binary Distribution                            |
| -------------------- | -------------------- | -------------------------- | ------------------------ | ---------------------------------------------- |
| **Changesets**       | Excellent            | Yes (auto)                 | Via lifecycle hooks + CI | Not built-in, but extensible (Biome proves it) |
| **semantic-release** | Limited (plugins)    | Yes (auto)                 | Plugin system            | Some plugins exist                             |
| **release-please**   | Good (manifest mode) | Yes (conventional commits) | Custom publish commands  | Not built-in                                   |
| **GoReleaser**       | No (single project)  | From commits               | Yes (hooks, publishers)  | Excellent (built-in)                           |
| **Custom scripts**   | Any                  | Manual                     | Full control             | Full control                                   |

**For Ethoko's situation (already on changesets, monorepo, need binary distribution): stay on changesets and extend the CI pipeline.** Switching release systems would be high effort with marginal benefit.
