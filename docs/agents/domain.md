# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY-MAP.md`** at the repo root, if it exists: it points to each context's `GLOSSARY.md`. Read every glossary relevant to the topic.
- **`docs/adr/`**: read ADRs affecting the area of work. Also check each relevant context's `docs/adr/` for scoped decisions.

If any of these files do not exist, **proceed silently**. Do not flag their absence or suggest creating them upfront. The `/domain-modeling` skill creates them when terms or decisions are actually resolved.

## File structure

```
/
├── GLOSSARY-MAP.md
├── docs/adr/                          ← system-wide decisions
├── packages/
│   └── cli-beacon/
│       ├── GLOSSARY.md
│       └── docs/adr/                  ← CLI-specific decisions
└── apps/
    ├── central/
    │   ├── GLOSSARY.md
    │   └── docs/adr/                  ← backend-specific decisions
    └── central-ui/
        ├── GLOSSARY.md
        └── docs/adr/                  ← UI-specific decisions
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
