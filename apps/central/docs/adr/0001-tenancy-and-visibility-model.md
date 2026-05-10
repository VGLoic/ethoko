# Personal-namespace tenancy with per-Project Visibility

Each **User** on Ethoko Central owns a **Namespace** equal to their immutable handle; **Projects** live within a Namespace and are addressed as `namespace/project:tag`. Each Project carries a **Visibility** (`public` or `private`); public Projects accept anonymous reads. This mirrors Docker Hub, npm, crates.io, and GHCR — the dominant convention for developer-tool registries.

## Considered alternatives

- *Flat global namespace with per-Project ACLs* (npm-legacy, crates.io shape) — rejected because name squatting is unsolvable at scale and conflicts with personal-handle semantics.
- *Org-first, no personal Namespaces* (Vercel / Linear shape) — rejected because the audience is individual developers and "sign in with GitHub" pairs naturally with personal handles. Org Namespaces remain a forward-compatible extension.
- *Auth required for all reads* — rejected because anonymous public reads unlock the OSS-publishing demo (`ethoko pull oz/contracts:5.0.0` with no account), which is the fastest route to first-value for new users.
