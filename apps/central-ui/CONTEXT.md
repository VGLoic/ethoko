# central-ui

Vocabulary specific to Ethoko Central UI — the React Router application used by users to interact with Ethoko Central. Shared concepts (Project, Namespace, Visibility, User, Ethoko Artifact, Tag, ID, Artifact Reference, Storage Backend, etc.) are defined in [`../../CONTEXT-MAP.md`](../../CONTEXT-MAP.md).

## Language

(No central-ui-specific domain vocabulary yet. From this context's perspective, Ethoko Central UI is a UI + thin BFF/server layer consuming Ethoko Central API.)

## Notes

- Ethoko Central API (`apps/central`) remains the source of truth for core domain/application logic.
- Central UI backend concerns are intentionally light and UI-focused (for example session cookie handling and UI-oriented orchestration).
- Add terms here only as real domain concepts emerge in code. Resist projecting end-state vocabulary.
