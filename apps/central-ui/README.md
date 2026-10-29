# Welcome to React Router!

A modern, production-ready template for building full-stack React applications using React Router.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/remix-run/react-router-templates/tree/main/default)

## Features

- 🚀 Server-side rendering
- ⚡️ Hot Module Replacement (HMR)
- 📦 Asset bundling and optimization
- 🔄 Data loading and mutations
- 🔒 TypeScript by default
- 🎉 TailwindCSS for styling
- 📖 [React Router docs](https://reactrouter.com/)

## Getting Started

### Installation

Install the dependencies:

```bash
npm install
```

### Development

Start the development server with HMR:

```bash
npm run dev
```

Your application will be available at `http://localhost:5173`.

## Browser tests

Browser tooling requires **Node 22+** (22.22+ with the current React Router
dependency); use the repository's pinned Node 24 in `.nvmrc`. From the repository root:

```bash
nvm use
pnpm install
pnpm --filter central-ui test:e2e:install
pnpm test:e2e:ui
pnpm --filter central-ui test:e2e:verify-harness
pnpm --filter central-ui test:e2e verification.spec.ts --workers=2
```

On Linux, install system dependencies with
`pnpm --filter central-ui exec playwright install --with-deps chromium`.
Inside this package, `pnpm test:e2e` is the canonical browser-test command;
append Playwright arguments to select a test or enable headed mode.

Playwright owns exactly one real React Router development server on
`127.0.0.1:5174` and one standalone `@msw/serve` API server on
`127.0.0.1:4101`. Both ports must be free; existing servers are never reused.
No Rust API, database, email service, or local `.env` is needed. The test-only
Vite configuration prebundles route dependencies to avoid first-use reloads.
The suite defaults to one Chromium worker and isolated browser contexts.
The signup and contrasting handle-registration tests allow within-file parallel
execution. Verify their isolation with two workers on the same server pair:

```bash
pnpm --filter central-ui test:e2e signup.spec.ts --workers=2
pnpm --filter central-ui test:e2e register-handle.spec.ts --workers=2
```

Tests supply their complete identity and declare outcomes inline using the native
`scenario` fixture. Identity generation is optional and explicit in the test:

```ts
const user = fakeIdentity({ handle: "alice", emailVerified: false });
const login = await scenario({ identity: user, login: "success" });
// Fill the form using user.email and user.password; inspect login.observe().
```

`fakeIdentity` supplies valid defaults for all identity fields and accepts overrides.
Call it inside the test so each attempt/retry gets fresh email addresses and opaque
User Session Tokens. A test can also supply a complete identity object directly.
The mock server never generates identity data; it uses the supplied profile,
credentials, and token. Duplicate scenario IDs, emails, or tokens are rejected.
Email and token select scenario-local responses; the shared Machine
Credential does not. The test-only HTTP control API creates, observes, and
retires only the owning scenario. Retired identities remain as tombstones to
diagnose late requests. There is no global reset or response queue. Email login,
current User, logout, email signup, handle registration, email verification, and
verification-code resend are implemented. Signup tests explicitly
opt into `signup: "success"`; an unconfigured signup is unexpected traffic.
Login defaults to success when omitted. Signup returns the API's email,
emailVerified, createdAt, and updatedAt fields (no User state or session token);
confirmation mismatch stays within the real UI/BFF and must produce no API traffic.

For handle registration, use `fakeIdentity({ handle_registration: null })` and declare
`registration: "success"` or `registration: "taken"` beside the test. The identity's
generated handle is the expected submission, not a handle owned by a User without a registration.
Success adds a Handle Registration only to the token-selected scenario; taken-handle
feedback leaves it without a registration. Profile reads are stable, and neither outcome changes
email verification. There is no shared handle-ownership simulation.

Verification tests configure the submitted six-digit code and
success, invalid-code, or expired-code outcome inline. Query parameters prefill
the form; tests explicitly submit it. No email delivery or verification-state
transition is modeled.

`mock-api.ts` lists Central API methods and URLs in `apiHandlers`, with a separate
handler for each operation (email-based operations share identity/header validation).
Test-control routes live in `controlHandlers`; the
catch-all only reports unexpected requests. Add new operations as explicit MSW
handlers, with any configurable outcomes declared in the test's scenario.

Unexpected traffic is recorded even if the BFF absorbs the error. Fixture
teardown retires scenarios after failed assertions and attaches their traffic.
The suite audit fails on all violations (including unattributed/late requests)
or unretired scenarios and saves `test-results/mock-api.json`. Failure traces
are in `test-results/`; view the HTML report with
`pnpm exec playwright show-report`. Server output is included in command/CI logs.
`test:e2e:verify-harness` deliberately launches failing subprocesses to prove
unattributed traffic, late traffic, absorbed logout errors, and cleanup after an
assertion failure. It succeeds only if those child runs fail as intended and
leak no active scenarios; their diagnostics/traces are saved in `harness-results/`.
PR CI installs Chromium, runs these checks, and retains failure artifacts.

**Review checkpoint:** the login tests, scenario helper, and handlers are
provisional. A maintainer must review this first slice (#167) before sibling
tickets expand it; simplify the helper if that review exposes excess indirection.

## Building for Production

Create a production build:

```bash
npm run build
```

## Deployment

### Docker Deployment

To build and run using Docker:

```bash
docker build -t my-app .

# Run the container
docker run -p 3000:3000 my-app
```

The containerized application can be deployed to any platform that supports Docker, including:

- AWS ECS
- Google Cloud Run
- Azure Container Apps
- Digital Ocean App Platform
- Fly.io
- Railway

### DIY Deployment

If you're familiar with deploying Node applications, the built-in app server is production-ready.

Make sure to deploy the output of `npm run build`

```
├── package.json
├── package-lock.json (or pnpm-lock.yaml, or bun.lockb)
├── build/
│   ├── client/    # Static assets
│   └── server/    # Server-side code
```

## Styling

Central UI uses the [Ivory & Vermilion design system](./DESIGN-SYSTEM.md), built
with shared CSS tokens, Tailwind CSS, and reusable form/feedback primitives.
Consult it before styling screens or writing interface copy.

---

Built with ❤️ using React Router.
