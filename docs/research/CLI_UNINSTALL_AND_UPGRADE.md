# CLI Upgrade & Uninstall Commands: Research & Options

**Date:** March 12, 2026
**Context:** Ethoko CLI needs `ethoko upgrade` and `ethoko uninstall` commands that work across all distribution channels (curl install, npm, Homebrew).
**Prerequisite reading:** [CLI_DELIVERY_RESEARCH.md](./CLI_DELIVERY_RESEARCH.md), [CLI_DELIVERY.md](../CLI_DELIVERY.md)

---

## Table of Contents

1. [Current State](#1-current-state)
2. [How Other CLIs Do It](#2-how-other-clis-do-it)
3. [Common Patterns](#3-common-patterns)
4. [Proposed Options for Ethoko](#4-proposed-options-for-ethoko)
5. [Recommendation](#5-recommendation)

---

## 1. Current State

### What exists

| Component                     | Status      | Details                                                                                                              |
| ----------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| CLI binary distribution       | Done        | curl install (`~/.ethoko/bin/`), npm (`@ethoko/cli` wrapper + platform packages), GitHub Releases                    |
| `install.sh`                  | Done        | Downloads binary, places in `~/.ethoko/bin/`, appends PATH to `~/.bashrc`/`~/.zshrc`                                 |
| Version tracking              | Partial     | Hardcoded `.version("0.1.0")` in `src/index.ts` (out of sync with `package.json@0.2.0`). Not injected at build time. |
| Installation method detection | None        | No mechanism to know if installed via curl, npm, or Homebrew                                                         |
| `ethoko upgrade`              | Not started |                                                                                                                      |
| `ethoko uninstall`            | Not started |                                                                                                                      |

### Key challenges

1. **Multiple installation methods:** The CLI can be installed via curl (binary to `~/.ethoko/bin/`), npm global (`npm i -g @ethoko/cli`), npm local (project dependency), or Homebrew (future). Each requires different upgrade/uninstall strategies.
2. **No installation metadata:** `install.sh` doesn't record how the CLI was installed. Detection must be heuristic-based.
3. **npm global vs local:** When installed via npm, the Bun-compiled binary runs from inside `node_modules/@ethoko/cli-{platform}-{arch}/bin/ethoko`. For global installs the prefix is the npm global directory; for local installs it's the project's `node_modules/`. The upgrade/uninstall instructions differ between the two.
4. **Version must be injected at build time** -- currently hardcoded.

---

## 2. How Other CLIs Do It

### 2.1 OpenCode (TypeScript/Bun) -- Most Relevant

**Most relevant comparison** -- same tech stack, same distribution channels.

#### Upgrade (`opencode upgrade [target]`)

- **Installation method detection** (`Installation.method()`):
  - Checks if `process.execPath` contains `.opencode/bin` or `.local/bin` -> `"curl"`
  - Then shells out to each package manager in priority order: `npm list -g`, `yarn global list`, `pnpm list -g`, `bun pm ls -g`, `brew list --formula opencode`, `scoop list opencode`, `choco list opencode`
  - Falls back to `"unknown"`
  - **No metadata file** -- detection is purely runtime heuristic
- **Upgrade dispatch per method:**
  - `curl`: Fetches `https://opencode.ai/install` script, pipes to `bash` with `VERSION=target` env var
  - `npm`: `npm install -g opencode-ai@{target}`
  - `pnpm`: `pnpm install -g opencode-ai@{target}`
  - `bun`: `bun install -g opencode-ai@{target}`
  - `brew`: Detects tap vs core formula, does `brew upgrade`
  - `choco`: `choco upgrade opencode --version={target} -y`
  - `scoop`: `scoop install opencode@{target}`
- **Version checking** (`Installation.latest(method)`):
  - Each method has its own "latest" lookup: npm registry, GitHub Releases API, Homebrew JSON API, etc.
- **Post-upgrade verification:** Runs `process.execPath --version` to confirm
- **`--method` flag:** Allows overriding detected installation method
- **Auto-upgrade:** Background check on TUI/serve startup. Controlled by `config.autoupdate` (`true | false | "notify"`). Skipped if method is `"unknown"`.

#### Uninstall (`opencode uninstall`)

- **Flags:** `--keep-config`, `--keep-data`, `--dry-run`, `--force`
- **For curl installs:**
  - Removes XDG directories: `data`, `cache`, `config`, `state`
  - Cleans shell RC files (`.zshrc`, `.bashrc`, `config.fish`, etc.) by removing lines containing `# opencode` and `.opencode/bin`
  - Prints manual `rm` instruction for the binary (can't delete itself)
- **For package manager installs:**
  - Shells out to the appropriate uninstall command: `npm uninstall -g opencode-ai`, `brew uninstall opencode`, etc.
  - Still removes XDG directories
- **Confirmation prompt** unless `--force`

### 2.2 Deno

#### Upgrade (`deno upgrade [target]`)

- **Mechanism:** Downloads zip from `dl.deno.land` or GitHub Releases, extracts to temp dir, validates by running `deno -V`, then replaces the current exe in-place.
- **Package manager detection:** Indirect -- checks if output exe is owned by root and current user is not root. If so, errors with: _"You don't have write permission... Consider updating deno through your package manager."_
- **No explicit Homebrew/npm detection.** Relies on file permission heuristics.
- **Background update check:** Every 24h, async (500ms startup delay). Controlled by `DENO_NO_UPDATE_CHECK` env var. State persisted in a `CheckVersionFile`.
- **Flags:** `--dry-run`, `--force`, `--output` (write to different path), `--checksum` (SHA256 verification)
- **Windows:** Renames current exe to `.old.exe` before replacing. Kills running `deno lsp` processes.
- **No self-uninstall:** `deno uninstall` only removes globally installed scripts, not Deno itself.

### 2.3 Rustup

#### Upgrade (`rustup self update`)

- **Mechanism:** Downloads `rustup-init` to `$CARGO_HOME/bin/`, runs it with `--self-replace` flag. New binary copies itself over the old one and re-creates all hardlinks/symlinks.
- **Package manager detection:** **Compile-time feature flag** (`no-self-update`). When built with this flag, `self update` and `self uninstall` are entirely disabled. Error: _"self-update is disabled for this build... use your system package manager."_
- **Runtime permission detection:** Tries to create a temp dir next to the binary. If `PermissionDenied`, either skips silently or hard-fails depending on context.
- **`SelfUpdateMode` config:** `Enable`, `Disable`, `CheckOnly`. Auto-disabled in CI.

#### Uninstall (`rustup self uninstall`)

- **Most comprehensive uninstall implementation found:**
  - Deletes `$RUSTUP_HOME` (all toolchains)
  - Removes `$CARGO_HOME/bin` from PATH: removes sourced lines from `.bashrc`/`.zshrc`/`.profile`; on Windows modifies registry
  - Deletes everything in `$CARGO_HOME`
  - Confirmation prompt
- **Windows self-delete trick:** Copies rustup to temp `rustup-gc-XXX.exe`, opens with `FILE_FLAG_DELETE_ON_CLOSE`, gc exe waits for parent to exit, deletes CARGO_HOME, spawns system binary to inherit handle so gc exe is cleaned up.

### 2.4 Bun

#### Upgrade (`bun upgrade`)

- **Mechanism:** Downloads new binary, replaces in-place.
- **Package manager detection:** Checks `process.execPath` path. If it detects npm/Homebrew paths, **refuses to upgrade** with an error: _"bun was installed via npm/Homebrew. Use `npm update -g bun` / `brew upgrade bun` instead."_
- **No self-uninstall command.**

### 2.5 Proto

#### Upgrade (`proto upgrade`)

- **Mechanism:** Downloads new binary from GitHub Releases, replaces in-place.
- **Package manager detection:** Checks if the binary path is within known package manager directories (Homebrew, npm, etc.). Refuses upgrade if detected.
- **Uninstall (`proto clean --purge`):** Removes `~/.proto` directory and shell PATH modifications.

### 2.6 Volta

- Has no self-upgrade command. Users must re-run the install script.
- Has no self-uninstall command.

### 2.7 fnm

- Has no self-upgrade or self-uninstall commands.

---

## 3. Common Patterns

### Installation Method Detection

| Approach                          | Used By              | Pros                            | Cons                                                        |
| --------------------------------- | -------------------- | ------------------------------- | ----------------------------------------------------------- |
| **Check `process.execPath` path** | OpenCode, Bun, Proto | Simple, no metadata needed      | Brittle if user moves the binary                            |
| **Shell out to package managers** | OpenCode             | Covers all cases                | Slow (runs multiple subprocesses), may have false positives |
| **Compile-time feature flag**     | Rustup               | Foolproof for distro packages   | Requires separate builds per channel                        |
| **File permission heuristics**    | Deno                 | No explicit PM detection needed | Imprecise, false positives possible                         |
| **Metadata file from installer**  | None (surprisingly)  | Most reliable                   | Requires installer to write it                              |

### Upgrade Strategy per Installation Method

| Method                     | Consensus Approach                                                            |
| -------------------------- | ----------------------------------------------------------------------------- |
| **curl/direct binary**     | Download new binary, replace in-place (or re-run install script with version) |
| **npm**                    | Shell out to `npm install -g @pkg@version`                                    |
| **Homebrew**               | Shell out to `brew upgrade pkg` or refuse + instruct                          |
| **Other package managers** | Refuse + instruct user to use their package manager                           |

### Uninstall Cleanup Targets

| Target                           | Relevant For      |
| -------------------------------- | ----------------- |
| Binary file                      | curl installs     |
| Install directory (`~/.ethoko/`) | curl installs     |
| Shell RC modifications           | curl installs     |
| XDG/data directories             | All installs      |
| Package manager global package   | npm/brew installs |

### Upgrade Approach Spectrum

There are two schools of thought:

1. **"We handle everything"** (OpenCode): Detect the installation method, then dispatch the appropriate upgrade/uninstall command for each method. Supports 7+ methods.
2. **"We only handle our own"** (Bun, Proto, Deno): Only self-upgrade when installed via the tool's own installer (curl). Refuse and instruct for package manager installs.

---

## 4. Proposed Option: Curl-Only Self-Management + Instruct Others (Bun/Proto Pattern)

**Approach:** Only perform self-upgrade/uninstall for curl-installed binaries. For package manager installs, detect and print instructions.

### How `process.execPath` varies by installation method

When the CLI runs, the Bun-compiled binary is the actual process. Its `process.execPath` points to itself -- the path depends on how it was installed:

| Install method | `process.execPath` example                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **curl**       | `~/.ethoko/bin/ethoko`                                                                                                 |
| **npm global** | `/usr/local/lib/node_modules/@ethoko/cli-darwin-arm64/bin/ethoko` (or `~/.nvm/versions/node/v22/lib/node_modules/...`) |
| **npm local**  | `/path/to/project/node_modules/@ethoko/cli-darwin-arm64/bin/ethoko`                                                    |
| **Homebrew**   | `/opt/homebrew/Cellar/ethoko/0.2.0/bin/ethoko`                                                                         |

Note: The npm wrapper (`@ethoko/cli/bin/ethoko`) is a `#!/usr/bin/env node` script that resolves the platform binary via `require.resolve()` and spawns it with `spawnSync`. So `process.execPath` inside the running binary is always the platform binary, not the wrapper.

### Installation method detection

```typescript
type InstallMethod = "curl" | "npm-global" | "npm-local" | "brew" | "unknown";

function detectInstallMethod(): InstallMethod {
  const execPath = process.execPath;

  // curl install: binary lives in ~/.ethoko/bin/
  if (execPath.includes(".ethoko/bin") || execPath.includes(".ethoko\\bin")) {
    return "curl";
  }

  // Homebrew: binary lives in Homebrew prefix
  if (execPath.includes("/Cellar/") || execPath.includes("/homebrew/")) {
    return "brew";
  }

  // npm: binary lives inside node_modules
  if (execPath.includes("node_modules")) {
    // Distinguish global from local:
    // Global npm prefixes typically contain /lib/node_modules/
    // (e.g. /usr/local/lib/node_modules/, ~/.nvm/.../lib/node_modules/)
    // Local installs have node_modules inside a project directory.
    if (execPath.includes("/lib/node_modules/")) {
      return "npm-global";
    }
    return "npm-local";
  }

  return "unknown";
}
```

### `ethoko upgrade [version]`

```
1. Detect installation method
2. If curl:
   a. Fetch latest version from GitHub Releases API
   b. Download new binary to temp location
   c. Verify new binary (run --version)
   d. Replace current binary in-place
3. If npm-global:
   Print: "ethoko was installed globally via npm. Run: npm install -g @ethoko/cli@latest"
4. If npm-local:
   Print: "ethoko is installed as a project dependency. Update it in your package.json."
5. If brew:
   Print: "ethoko was installed via Homebrew. Run: brew upgrade ethoko"
6. If unknown:
   Print: "Could not detect installation method. To upgrade manually, visit: <url>"
```

### `ethoko uninstall`

```
1. Detect installation method
2. If curl:
   a. Remove ~/.ethoko/ directory (bin + any data)
      On macOS/Linux this works even though the binary is running
      (the OS keeps the file handle open until the process exits)
   b. Clean shell RC files (remove PATH modifications)
3. If npm-global:
   Print: "ethoko was installed globally via npm. Run: npm uninstall -g @ethoko/cli"
4. If npm-local:
   Print: "ethoko is a project dependency. Run: npm uninstall @ethoko/cli"
5. If brew:
   Print: "ethoko was installed via Homebrew. Run: brew uninstall ethoko"
6. If unknown:
   Print manual removal instructions with binary location
```

### Windows handling

OpenCode -- the closest comparable tool (same Bun/TS stack, same distribution channels) -- has **no Windows-specific logic** in its curl upgrade path. Their `upgradeCurl` function spawns `bash` and re-runs the install script with a plain `mv`. No rename trick, no temp-process dance.

This is acceptable because:

1. The `install.sh` is bash-only -- Windows curl installs require MSYS2/Git Bash, making them inherently niche.
2. Windows users are expected to install via npm (or Scoop/Chocolatey in the future), where upgrade/uninstall is handled by the package manager.
3. Adding Windows binary-replacement workarounds (Deno's `.old.exe` rename, Rustup's `DELETE_ON_CLOSE` gc process) adds significant complexity for a marginal use case.

**Decision: No Windows-specific code.** The curl upgrade/uninstall paths use standard file operations (`copyFile`, `rm`). If these fail on Windows due to file locking, the error message will surface naturally. This matches OpenCode's approach.

### Pros

- Simple, focused implementation
- No risk of breaking a user's npm/brew setup by running wrong commands
- Easy to test (only one real code path for actual operations)
- Follows the principle of least surprise -- package manager users expect to manage via their package manager
- npm global vs local distinction gives accurate instructions

### Cons

- npm/brew users get instructions instead of a one-command solution

---

## 5. Recommendation

### Recommended: Curl-Only Self-Management (Section 4 above)

This is the simplest approach that covers the primary use case well:

1. **curl installs get full self-management** -- this is the primary use case for standalone CLI users
2. **npm/brew users get clear instructions** -- no risk of breaking their setup
3. **npm global vs local distinction** -- users get the right command for their situation
4. **No Windows-specific code** -- matches OpenCode's approach, keeps implementation simple
5. **Implementation is focused** -- only the curl upgrade path needs real logic

### Key design decisions

| Decision                   | Choice                                         | Rationale                                                                               |
| -------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Detection approach**     | `process.execPath` path check                  | Simple, reliable for curl vs everything else. No need to shell out to package managers. |
| **npm global vs local**    | Check for `/lib/node_modules/` in path         | Global npm prefix always includes this; local installs don't.                           |
| **Curl upgrade mechanism** | Download binary + replace in-place             | Simpler than re-running install.sh. Verify new binary before replacing.                 |
| **Version source**         | GitHub Releases API                            | Single source of truth for all channels                                                 |
| **Windows**                | No special handling                            | Matches OpenCode. curl installs on Windows are niche (require bash).                    |
| **Shell RC cleanup**       | Remove lines containing `.ethoko/bin`          | Same pattern as install.sh writes                                                       |
| **Version injection**      | Must fix first -- inject version at build time | Prerequisite for upgrade to compare current vs latest                                   |
| **Auto-upgrade**           | No, manual only                                | Keep it simple for v1                                                                   |
| **Checksum verification**  | No, trust HTTPS                                | Can add SHA256 later                                                                    |

### Implementation sketch

#### Prerequisites

1. **Fix version injection:** Replace hardcoded `.version("0.1.0")` with build-time injection (e.g., read from `package.json` in tsup config, or use Bun's `--define` for binary builds)

#### New files

```
packages/cli-beacon/src/
  commands/
    upgrade.ts          # ethoko upgrade [version]
    uninstall.ts        # ethoko uninstall [--force]
  utils/
    installation.ts     # detectInstallMethod(), getLatestVersion(), downloadBinary()
```

#### `installation.ts` -- Core utilities

```typescript
export type InstallMethod =
  | "curl"
  | "npm-global"
  | "npm-local"
  | "brew"
  | "unknown";

export function detectInstallMethod(): InstallMethod {
  const execPath = process.execPath;
  if (execPath.includes(".ethoko/bin") || execPath.includes(".ethoko\\bin"))
    return "curl";
  if (execPath.includes("/Cellar/") || execPath.includes("/homebrew/"))
    return "brew";
  if (execPath.includes("node_modules")) {
    return execPath.includes("/lib/node_modules/") ? "npm-global" : "npm-local";
  }
  return "unknown";
}

export async function getLatestVersion(): Promise<string> {
  // Fetch from GitHub Releases API
  // GET https://api.github.com/repos/VGLoic/ethoko/releases
  // Filter for tags starting with "cli-v", extract version
}

export async function downloadBinary(
  version: string,
  destPath: string,
): Promise<void> {
  // Detect platform + arch
  // Download from GitHub Releases
  // Write to destPath
  // chmod +x
}
```

#### `upgrade.ts` -- Upgrade command

```typescript
export function registerUpgradeCommand(program: Command) {
  program
    .command("upgrade [version]")
    .description("Upgrade ethoko to the latest version")
    .action(async (version) => {
      const method = detectInstallMethod();
      const current = getCurrentVersion(); // build-time injected

      switch (method) {
        case "curl": {
          const target = version ?? (await getLatestVersion());
          if (current === target) {
            console.error(
              styleText(LOG_COLORS.success, `Already at v${current}`),
            );
            return;
          }
          await upgradeCurl(target);
          break;
        }
        case "npm-global":
          console.error(
            "ethoko was installed globally via npm. Run:\n  npm install -g @ethoko/cli@latest",
          );
          break;
        case "npm-local":
          console.error(
            "ethoko is installed as a project dependency. Update it in your package.json:\n  npm install @ethoko/cli@latest",
          );
          break;
        case "brew":
          console.error(
            "ethoko was installed via Homebrew. Run:\n  brew upgrade ethoko",
          );
          break;
        case "unknown":
          console.error("Could not detect installation method.");
          console.error("Download the latest version from:");
          console.error("  https://github.com/VGLoic/ethoko/releases");
          break;
      }
    });
}

async function upgradeCurl(target: string) {
  const tmpPath = path.join(os.tmpdir(), `ethoko-${target}`);

  // 1. Download new binary to temp location
  await downloadBinary(target, tmpPath);

  // 2. Verify new binary
  const { stdout } = execSync(`"${tmpPath}" --version`);
  // Check stdout contains expected version

  // 3. Replace in-place (works on macOS/Linux even while running)
  await fs.copyFile(tmpPath, process.execPath);
  await fs.chmod(process.execPath, 0o755);
  await fs.rm(tmpPath);
  console.error(styleText(LOG_COLORS.success, `Upgraded to v${target}`));
}
```

#### `uninstall.ts` -- Uninstall command

```typescript
export function registerUninstallCommand(program: Command) {
  program
    .command("uninstall")
    .description("Uninstall ethoko from this machine")
    .option("--force", "Skip confirmation prompt")
    .action(async (opts) => {
      const method = detectInstallMethod();

      switch (method) {
        case "curl":
          // Show what will be removed, confirm (unless --force)
          await uninstallCurl(opts);
          break;
        case "npm-global":
          console.error(
            "ethoko was installed globally via npm. Run:\n  npm uninstall -g @ethoko/cli",
          );
          break;
        case "npm-local":
          console.error(
            "ethoko is a project dependency. Run:\n  npm uninstall @ethoko/cli",
          );
          break;
        case "brew":
          console.error(
            "ethoko was installed via Homebrew. Run:\n  brew uninstall ethoko",
          );
          break;
        case "unknown":
          console.error(
            "Could not detect installation method. Manual removal required.",
          );
          console.error(`Binary location: ${process.execPath}`);
          break;
      }
    });
}

async function uninstallCurl(opts: { force: boolean }) {
  const ethokoDir = path.join(os.homedir(), ".ethoko");

  if (!opts.force) {
    // Show what will be removed + confirmation prompt
  }

  // 1. Clean shell RC files
  for (const rc of [".bashrc", ".zshrc"]) {
    const rcPath = path.join(os.homedir(), rc);
    // Remove lines containing ".ethoko/bin"
  }

  // 2. Remove ~/.ethoko/ directory (includes the running binary -- fine on Unix,
  //    the OS keeps the file handle open until the process exits)
  await fs.rm(ethokoDir, { recursive: true, force: true });

  console.error(styleText(LOG_COLORS.success, "Ethoko has been uninstalled."));
  console.error("Restart your shell to update PATH.");
}
```

### Open questions

| Question                                       | Options                                                       | Leaning                                                   |
| ---------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| **Should `install.sh` write a metadata file?** | (a) Yes (`~/.ethoko/.install-method`), (b) No, keep heuristic | (a) would be more reliable, but heuristic is fine for now |
