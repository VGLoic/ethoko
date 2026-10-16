# Design-system migration validation

Issue: #163. Baseline: `4897e3ad038ab31a2a8a3d002e27df1869313989`.
No tests or test dependencies were introduced, as requested.

## Visual and browser checks

The archived app at `8e9e675a88d636f9c03c989944bc11540c54372c` was
extracted outside the repository and run separately. The selected
`/login?round=4&variant=A&mode=light` and `mode=dark` previews were captured
and visually compared with the migrated sign-in screen at 1280×900.
Paper/stone, graphite, ivory, vermilion, Georgia headings, and compact controls
match the selected direction. The existing product's page contents and ordering
remain intact; the prototype sidebar and sample UI were not adopted.

Ad hoc Chromium inspection (not an added test suite) covered:

- Explicit light/dark selection, persisted selection and colors after reload.
- System preference, including live light/dark system changes and clearing the
  stored override when returning to System.
- Client navigation from the shared 404 surface through the home redirect back
  to sign-in, retaining the explicit choice across error-boundary remounts.
- Sign-in, sign-up, email verification, and 404 surfaces at 375px: no horizontal
  page overflow. The Appearance select remains usable at that width.
- Keyboard Tab focus: the select has a visible 2px vermilion outline.
- Server validation feedback: password errors have text, `role="alert"`,
  `aria-invalid`, and an associated `aria-describedby` target.
- Unreachable API: sign-in shows the service-failure message rather than blaming
  the user's credentials. The credential-failure branch was also inspected in
  the unchanged action flow.

The pre-style bootstrap restores the explicit theme on the HTML element. The
layout also reflects that preference in React so an error-boundary remount does
not discard it. Blocked storage falls back safely to system colors and permits a
document-local override. Cross-tab synchronization is implemented via the
storage event; blocked-storage and cross-tab behavior still merit live browser
verification in the deployment environment.

Authenticated home/handle layouts and successful UI authentication, verification,
and logout were checked by code inspection, not a live authenticated browser
session. API integration checks passed, but they are not a replacement for a
deployed UI smoke check with real credentials/GitHub OAuth. No claim is made of
exhaustive screen-reader or cross-browser coverage.

## Contrast

WCAG relative-luminance calculations were performed on the actual token pairs.
Both themes meet 4.5:1 for normal text on their intended backgrounds: primary and
secondary text on the page/surface, links on the page/surface, action text on the
accent, and success/error/notice text on the soft feedback surface. Interactive
boundaries and focus accents meet 3:1 on adjacent page/surface colors. Decorative
dividers intentionally need not meet interactive-boundary contrast.

The selected dark accent alone is only 3.96:1 as text on the lifted surface, so
links use the lighter `--accent-text` role. The selected light success text was
4.49:1 on the soft surface, so it was darkened slightly. See `DESIGN-SYSTEM.md` for
the final role values. Disabled controls are intentionally visually subdued;
their unavailability is also conveyed by the native disabled state.

## Repository checks

Commands ran with Node v24.21.0 from `.nvmrc` and pnpm 10.28.2, as pinned by the
root `packageManager` (the older pnpm 9 instruction in `AGENTS.md` disagrees with
that pin). Dependencies were installed with the frozen lockfile.

| Command | Result |
| --- | --- |
| `pnpm build` | Passed |
| `pnpm check-types` | Passed |
| `pnpm lint` | Passed, no warnings |
| `pnpm format` | Passed |
| `pnpm test:unit` | Passed (Turborepo cached existing unit results) |
| `pnpm test:e2e:core` | Blocked: `packages/cli-beacon/.env.localstack` is absent; LocalStack setup fails before tests execute |
| `pnpm test:integration` | Passed on rerun; first run hit the existing `test_psql_retry_dead_job` `Option::unwrap()` failure in `apps/central/tests/queue_test.rs:305` |
| `pnpm test:e2e:apps` | Passed on rerun, 64 existing tests across all eight apps |

The first install could not link the CLI executable before it was built. Running
the frozen install again after the build restored the links. Initial app checks
failed with `ethoko: command not found`; interrupted E2E runs also left temporary
deployment files/generated typings that affected typecheck and lint. Those
generated outputs were cleaned up or moved outside the repository before the
successful reruns. No unrelated source changes were made to fix these checks.
