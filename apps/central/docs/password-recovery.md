# Password recovery

Central UI owns `/forgot-password` and `/reset-password?token=…`. Central owns
eligibility, password policy, issuance, cooldown, queued delivery and reset completion.
Recovery only replaces an existing password credential; it does not verify email,
register a handle, attach credentials, or sign the User in.

## Configuration and delivery

- `WEB_APP_URL` is the public Central UI origin used for reset links.
- `PASSWORD_RESET_COOLDOWN_SECONDS` defaults to `60`. Central returns this public
  duration in every successful forgot-password response, including suppressed or
  ineligible requests, so the UI countdown never reveals eligibility.
- Links expire one hour after issuance. Validation storage contains only SHA-256
  verification hashes. Reset state is independent of verification OTPs and sessions.
- Issuance, supersession and the PostgreSQL email job commit in one transaction.
  The job contains the deliverable URL and original expiry; treat queue payloads,
  database backups and reset URLs as secrets. Delivery retries never write token state.
- Configure the Resend **`password-reset`** template with variables **`reset_url`**
  and **`expires_at`** (RFC 3339). Its link should target `reset_url` directly.
  Obsolete queued emails may still be delivered; their links are rejected.

## BFF boundary

`POST /auth/forgot-password` takes `{email}`. `POST /auth/reset-password` takes
`{token, password}`. `POST /auth/reset-password/validate` takes `{token}` and checks
the link without consuming it. All require the Machine Credential, no User Session
Token, and the BFF-asserted `X-Ethoko-Client-IP` source address. Invalid, expired,
used and superseded links share `422 / ETKARP01`; password validation uses the
existing `ETKAG01` convention. IP-wide limits may return `429`.

Both the UI's `dev` Vite adapter and its `start` Node adapter overwrite a reserved
internal source-IP header from the socket before React Router handles the request.
Browser-supplied internal headers and ordinary forwarding headers are not trusted.
Central trusts the asserted address only alongside a valid Machine Credential.

For a reverse-proxied UI, explicitly set `TRUSTED_PROXY_IPS` to the comma-separated
ingress **peer IPs**. That ingress must overwrite `X-Forwarded-For` with exactly one
browser IP, not append a forwarding chain. Leave this configuration empty for direct
traffic. Do not allow arbitrary internet peers into the trusted list. A trusted peer
without a valid single address fails closed for recovery. This does not configure or
change hosting infrastructure.

Successful completion consumes the current link, replaces the password, and revokes
every existing session in one transaction. The UI clears its browser session cookie
and offers an explicit login action; no new session is issued. Recovery pages disable
caching and referrer forwarding.

## Tests

- `pnpm --filter central test:integration --test password_recovery_test` uses real
  PostgreSQL, authenticated HTTP, the existing controlled worker and captured email
  service. Isolated test databases prevent PostgreSQL delivery jobs crossing tests.
  Storage-failure injection is fixture setup; outcomes are asserted through HTTP.
- `pnpm --filter central-ui exec playwright install chromium` installs the browser.
- `pnpm --filter central-ui test:browser` starts the UI through **`dev`** and verifies
  browser behavior against a controlled public API fixture. Real backend invariants
  remain covered by the Central tests above.
