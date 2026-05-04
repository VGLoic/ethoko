# Context Map

Ethoko is a warehouse for smart-contract compilation artifacts. The repository spans two contexts plus integration apps. This file points at each context's vocabulary and lists terms shared across contexts.

## Contexts

- [`packages/cli-beacon/CONTEXT.md`](./packages/cli-beacon/CONTEXT.md) — the standalone CLI: artifact discovery, mapping, push/pull, typings generation, local cache.
- [`apps/central/CONTEXT.md`](./apps/central/CONTEXT.md) — Ethoko Central, the hosted backend service (in development).

`apps/*` other than `central` are integration apps that exercise the CLI against real Hardhat/Foundry codebases; they don't introduce vocabulary.

## Shared language

These terms appear in both contexts and at user-facing surfaces (CLI, README, future Central API). Use them exactly; avoid the listed synonyms.

### Project

A named namespace within a **Storage Backend** that groups related compilation artifacts. Identified by a name; carries one storage configuration. Users address its artifacts via the **Artifact Reference** syntax.
_Avoid_: "repository" (overloaded with git/Docker), "namespace" (too generic), "warehouse" (Ethoko itself is the warehouse).

### Compilation Artifact

Anything emitted by a Solidity compilation, in any framework's format. Umbrella term. **Build Info**, **Ethoko Artifact**, and Forge's per-contract artifact files are all kinds of Compilation Artifact.

### Build Info

The entry-point compilation artifact that Ethoko reads to produce an **Ethoko Artifact**. Shape depends on **Origin**:

- Hardhat v2 / Forge with `--build-info`: a single self-contained JSON file (compiler input + output bundle).
- Hardhat v3: pairs of input/output JSON files linked by a shared id.
- Forge default: a JSON file containing only an id and references to per-contract artifact files (which Ethoko also reads as part of the mapping).

_Avoid_: "original artifact", "candidate artifact" — both are just Build Info at different lifecycle stages (during discovery vs. during mapping).

### Ethoko Artifact

A **Compilation Artifact** in Ethoko's storage format. The unit users push and pull. Composed of one **Input Artifact** and many **Contract Output Artifacts**. Has one **ID**; zero or more **Tags** can point to it.

### Input Artifact

The compilation-input portion of an **Ethoko Artifact**: the full Solidity compiler input JSON plus **Origin** metadata. One per Ethoko Artifact.

### Contract Output Artifact

The compiler output for one contract within an **Ethoko Artifact** (ABI, bytecode, metadata, …). Many per Ethoko Artifact — one per contract.

### ID

Content-derived hash that uniquely identifies an **Ethoko Artifact**. Generated when pushing. Example: `b5e41181986a`.
_Avoid_: "hash" (loses the identifier role), "version" (Ethoko doesn't order IDs).

### Tag

A human-readable label bound to an **Ethoko Artifact**'s **ID**. Optional. Examples: `v1.2.3`, `2026-02-02`. A tag points to exactly one ID; multiple tags can point to the same ID.
_Avoid_: "version" (no ordering implied), "label" alone (drops the binding semantics).

### Artifact Reference

The user-visible addressing syntax for artifacts:

| Form | Meaning |
| --- | --- |
| `my-project` | The Project itself (no specific artifact) |
| `my-project:v1.2.3` | The Ethoko Artifact tagged `v1.2.3` in `my-project` |
| `my-project@b5e41181986a` | The Ethoko Artifact with that ID in `my-project` |

### Origin

Classification of *what kind of compilation* produced an artifact. Recorded on the **Input Artifact**. Discriminated values: `forge-v1-default`, `forge-v1-with-build-info-option`, `hardhat-v2`, `hardhat-v3`, `hardhat-v3-non-isolated-build`.
_Avoid_: "format" — that word denotes a JSON-schema-version detail (`_format: "ethoko-input-v0"`), not the domain classification.

### Forge

Foundry's Solidity compiler tool. Origin values prefixed `forge-*` describe Forge-produced compilation artifacts.
_Avoid_: "Foundry" as a synonym in technical contexts — Foundry is the umbrella framework; Forge is the actual artifact producer.

### Storage Backend

The configured backend where a **Project**'s artifacts persist. Implementations: filesystem, AWS S3, Ethoko Central. Distinct from the **Local Artifact Store** (defined per-context — see `packages/cli-beacon/CONTEXT.md`) even when both happen to be on local disk — they live at different paths and serve different roles.
_Avoid_: "remote storage" (the filesystem backend can be local), "storage" alone (too vague), "storage provider" in domain conversation (it's the name of the code-level interface, not the domain term).

## Relationships

- A **Project** has zero or many **Ethoko Artifacts**, persisted in its **Storage Backend**.
- An **Ethoko Artifact** has one **Input Artifact** and one-or-more **Contract Output Artifacts**.
- An **Ethoko Artifact** has one **ID** and zero-or-more **Tags** pointing to it.
- An **Ethoko Artifact** has one **Origin** recorded on its **Input Artifact**.
- An **Ethoko Artifact** is produced by mapping a **Build Info** (and any per-contract artifacts the Build Info references, for some Origins) into Ethoko's format.

## Flagged ambiguities

- **"Project" overload**. A user's Hardhat/Foundry codebase is *not* a Project in Ethoko's vocabulary, even though developers naturally call it one. Ethoko's Project is the artifact namespace; the user's codebase is the source of compilation artifacts the CLI ingests. Future docs and error messages should disambiguate explicitly. Decided in alpha: keep "Project" rather than rename — every alternative trades one overload for another, and the term aligns with industry use (GCP, Linear, Sentry, …).
- **"Artifact" without qualifier**. Ambiguous between **Compilation Artifact** (umbrella), **Ethoko Artifact** (the bundle), and **Input/Contract Output Artifact** (constituents). Always qualify when the layer matters; reserve unqualified "Artifact" for prose where the layer is clear from context.

## Example dialogue

> **Dev:** "When I run `ethoko push my-app:v1`, does it upload my whole `out/` directory?"
> **Domain expert:** "No — it looks for the **Build Info** in there, then maps it (plus any per-contract files the Build Info references, for Forge default) into an **Ethoko Artifact**: one **Input Artifact** plus a **Contract Output Artifact** per contract. That bundle gets uploaded to your **Project**'s **Storage Backend** under a fresh **ID**, and `v1` becomes a **Tag** pointing to that ID."
> **Dev:** "And the **Origin** captures which framework I compiled with?"
> **Domain expert:** "Right — for Foundry that's a `forge-v1-*` value. We say **Forge** in technical contexts; Foundry is the umbrella framework."
