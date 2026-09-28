# central

Vocabulary specific to Ethoko Central — the hosted backend service. Currently in early development; the domain will grow as features land. Shared concepts (Project, Ethoko Artifact, Input/Contract Output Artifact, Build Info, Tag, ID, Origin, Storage Backend, Forge, Artifact Reference) are defined in [`../../CONTEXT-MAP.md`](../../CONTEXT-MAP.md).

## Language

### Authentication

**Principal**:
The authenticated identity making a request to Ethoko Central. Initially the only Principal is the Central UI BFF; a Principal may act alone or convey an authenticated **User** and that User's session-token hash for actions performed on the User's behalf.
_Avoid_: "authenticated user" (a Principal need not be a User), "caller" (too vague)

**Central UI BFF Principal**:
The Principal represented by Ethoko Central UI's server layer. It authenticates with the static secret shared with Ethoko Central and is distinct from any **User** whose session it may convey.
_Avoid_: "service user", "machine user"

## Notes

- Add terms here only as real domain concepts emerge in code. Resist projecting end-state vocabulary.
