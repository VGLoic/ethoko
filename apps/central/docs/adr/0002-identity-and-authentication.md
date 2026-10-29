# Multi-method identity, device-flow + PAT authentication, opaque tokens

A **User** can attach multiple auth methods (email + password, GitHub OAuth) to one persistent identity, independently of their optional **Handle Registration**. Linking only happens from an already-authenticated session; sign-in flows never silently merge accounts, and a GitHub sign-up whose email collides with an existing User is refused (mitigates account takeover via unverified email match — same posture GitHub.com uses). The CLI authenticates via OAuth 2.0 Device Authorization Grant (RFC 8628) for interactive sessions and via Personal Access Tokens for CI / headless use. Both produce **opaque tokens**, validated through one server-side hashed-lookup path. Email verification is OTP-based, gates write and security-sensitive operations (publish, mint PAT, link GitHub, change Visibility), but does not gate sign-in or handle registration; emails reported as `verified` by GitHub's `/user/emails` API are honored without an additional OTP step.

## Current OTP Request per purpose

An OTP Request is generic: both `email_verification` and `password_reset` purposes remain supported by the model. Database uniqueness on `(user_id, purpose)` permits one request of each purpose on the same User. Email-verification lookup, cooldown checks, replacement, and verification select only `email_verification`; another purpose cannot block, replace, or satisfy it.

Issuance locks the persistent User before checking cooldown, including first issuance when there is no request row to lock. After cooldown, a transaction deletes the previous request for that purpose and inserts a fresh request identity, hash, creation time, and expiration. Timestamps are measured after acquiring the lock, not at transaction start. No historical rows are retained. Expired requests remain until replacement and are rejected at verification without a cleanup worker. Existing durations and rate limits are unchanged.

The migration is edited in place for a fresh database; no backfill or upgrade path is provided. HTTP integration tests exercise initial issuance, expired and superseded codes, renewed lifetimes and cooldowns, and competing worker processing through captured emails. With no password-reset HTTP flow, per-purpose isolation and row cardinality are schema/code invariants not directly asserted through this HTTP-only seam; no lower-level tests or test-only endpoints are introduced.

This issuance slice ([#217](https://github.com/VGLoic/ethoko/issues/217)) deliberately leaves consumption and verification/replacement serialization to dependent work. It also preserves the existing queue, signup/enqueue boundaries, and send-before-persist worker ordering: an issuance rejected during cooldown may still have sent an unusable code, so concurrent delivery order does not identify the current request. The persist-before-send correction is separate work under [#214](https://github.com/VGLoic/ethoko/issues/214), not a delivery guarantee introduced here.

## User and Handle Registration contract

The domain has one User entity and an optional Handle Registration identified by that User. Registration presence is authoritative; no User lifecycle is persisted. Creating a registration and clearing the Suggested Handle are atomic. A second registration is rejected, and suggestions never reserve handles.

All User HTTP responses, including signup, expose one shape with nullable `handle_registration` (`null` or `{ "handle": "…" }`) and nullable `suggestedHandle`. There is no identity-state discriminator or top-level handle. The Suggested Handle is retained for onboarding prefill and becomes null on successful registration. Central UI drives onboarding, home, and navigation from registration presence; session handling and identity-linking rules remain unchanged. A User obtains a Namespace only through their Handle Registration.

## Considered alternatives

- *Auto-link auth methods by email match* (Auth0 / Supabase defaults) — rejected as a documented account-takeover vector.
- *JWT tokens* — rejected because instant revocation is required (Visibility flips, PAT revocation, ownership changes must propagate immediately) and we have no federation use-case that would justify the operational cost (key rotation, JWKS, refresh + blocklist choreography). All comparable dev-tool registries (GitHub, GitLab, npm, crates.io, Docker Hub PATs, Stripe, Vercel) use opaque tokens for this reason.
- *PATs only* (original Docker Hub, crates.io) — rejected because day-one onboarding becomes "go to website, click around, mint a token, paste it" before the user has seen any value; device flow makes `ethoko login` work in one command.
- *Pre-login strict email verification* (AWS-style) — rejected as gratuitous friction; the canonical registry pattern is to gate writes, not logins.
