# cli-beacon

Vocabulary specific to `@ethoko/cli-beacon` — the standalone Ethoko CLI. Shared concepts (Project, Ethoko Artifact, Input/Contract Output Artifact, Build Info, Tag, ID, Origin, Storage Backend, Forge, Artifact Reference) are defined in [`../../CONTEXT-MAP.md`](../../CONTEXT-MAP.md).

## Language

### Local Artifact Store

The on-disk store of artifacts the user has brought into their machine. Located at `pulledArtifactsPath` (default `~/.ethoko/pulled-artifacts`). Populated by `pull`; consumed by `typings`, `restore`, `inspect`, `diff`. Acts as a cache for pulled artifacts and as the source of truth for commands that derive from local state.
_Avoid_: "pulled artifact store" (too narrow — commands beyond `pull` use it), "cache" alone (it's authoritative for derived operations like typings).

### Local Config

Repository-level configuration at `./ethoko.config.json`, discovered by walking up from `process.cwd()`. Holds repo-specific paths (`compilationOutputPath`, `typingsPath`) and any local **Project** overrides.

### Global Config

User-level configuration at `~/.ethoko/config.json`. Shared across all repositories on the machine. Typically holds **Project** definitions with their **Storage Backend** credentials.

## Relationships

- **Local Config** and **Global Config** merge at runtime; Local takes precedence per-key. Projects with the same name merge by name, with Local overriding Global.
- The CLI reads **Build Info** from the user's compilation output (`compilationOutputPath` if configured), maps it to an **Ethoko Artifact**, and uploads it to the configured **Project**'s **Storage Backend**.
- The **Local Artifact Store** mirrors the subset of the Storage Backend the user has explicitly pulled. Today, `push` does not populate it; that may change.

## Example dialogue

> **Dev:** "If I have an artifact pulled locally and I run `ethoko typings`, does it call out to my **Storage Backend**?"
> **Domain expert:** "No — `typings` reads from the **Local Artifact Store** only. That's why it's the source of truth for derived commands. If you haven't pulled an artifact, typings won't know about it."
> **Dev:** "And `push` writes to the Storage Backend, but bypasses the Local Artifact Store?"
> **Domain expert:** "Today, yes."
