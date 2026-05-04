# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — points at the per-context `CONTEXT.md` files. May also hold shared vocabulary (terms used by both the CLI and the backend, e.g. artifact, project, user).
- **Per-context `CONTEXT.md`**:
  - `packages/cli-beacon/CONTEXT.md` — vocabulary specific to the CLI side
  - `apps/central/CONTEXT.md` — vocabulary specific to the backend service
- **`docs/adr/`** at the repo root — system-wide architectural decisions.
- **Per-context `docs/adr/`**:
  - `packages/cli-beacon/docs/adr/`
  - `apps/central/docs/adr/`

Read whichever contexts are relevant to the topic at hand. If your work spans both surfaces, read both.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← system-wide decisions
├── packages/
│   └── cli-beacon/
│       ├── CONTEXT.md
│       └── docs/adr/                  ← CLI-specific decisions
└── apps/
    └── central/
        ├── CONTEXT.md
        └── docs/adr/                  ← backend-specific decisions
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant `CONTEXT.md` (or `CONTEXT-MAP.md` for shared terms). Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
