# central

Vocabulary specific to Ethoko Central — the hosted backend service. Currently in early development; the domain will grow as features land. Shared concepts (Project, Ethoko Artifact, Input/Contract Output Artifact, Build Info, Tag, ID, Origin, Storage Backend, Forge, Artifact Reference) are defined in [`../../GLOSSARY-MAP.md`](../../GLOSSARY-MAP.md).

## Language

### Suggested Handle

A non-reserving handle proposal supplied by an external authentication provider for a **User** without a **Handle Registration**. It may prefill handle registration but does not make a **Namespace** unavailable. It is cleared when the User successfully registers a handle.
_Avoid_: "temporary handle", "reserved handle", "provider handle".

### Authentication

**OTP Request**:
A User's latest retained request for a one-time code for a specific purpose: email verification or password reset. A User has at most one request for each purpose; requests for different purposes are independent. Issuing a replacement invalidates the previous code and starts a fresh lifetime and resend cooldown. Successful email verification consumes its request. Expired and consumed requests remain current until replaced, but their codes cannot be used; retaining the current request does not retain a history of previous requests.
_Avoid_: "OTP history", "latest OTP" (there is only one current request per purpose).

**Principal**:
The authenticated identity making a request to Ethoko Central. Initially the only Principal is the Central UI BFF; a Principal may act alone or convey an authenticated **User** and that User's session-token hash for actions performed on the User's behalf.
_Avoid_: "authenticated user" (a Principal need not be a User), "caller" (too vague)

**Central UI BFF Principal**:
The Principal represented by Ethoko Central UI's server layer. It authenticates with the static secret shared with Ethoko Central and is distinct from any **User** whose session it may convey.
_Avoid_: "service user", "machine user"

## Notes

- **User** and **Handle Registration** are canonical shared concepts defined in the context map. Registration and email verification are independent.
- Add terms here only as real domain concepts emerge in code. Resist projecting end-state vocabulary.
