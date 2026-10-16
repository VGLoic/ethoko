# Ivory & Vermilion

Central UI uses a calm, precise, compact identity for a technical audience. The
selected reference is round 3 A (unchanged in round 4 A), archived at
`8e9e675a88d636f9c03c989944bc11540c54372c` on
`prototype/central-ui-ivory-vermilion`. Its palette and typography are references,
not its sidebar, page composition, sample projects, artwork, or interactions.

## Tokens

`app/app.css` owns the semantic CSS properties. Tailwind's inline theme exposes
background, surface, primary/secondary text, accent, divider, and font utilities.
Prefer semantic roles over literal colors or gray/red utility classes.

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| `--background` | `#eeede8` | `#323232` | Page canvas |
| `--surface` | `#f8f7f2` | `#3e3e3e` | Content and controls |
| `--text` | `#383634` | `#f0e9dc` | Primary text |
| `--text-secondary` | `#6b6661` | `#c4bfba` | Supporting text |
| `--divider` | `#d0cbc5` | `#65615f` | Decorative dividers, not control boundaries |
| `--control-border` | `#8b827b` | `#a29b95` | Interactive boundaries |
| `--accent` | `#ac4b37` | `#f47b48` | Primary actions and focus |
| `--accent-text` | `#ac4b37` | `#ff966b` | Underlined links |
| `--accent-soft` | `#eaded7` | `#49403c` | Feedback background |
| `--on-accent` | `#fffaf3` | `#291b16` | Text on primary actions |
| `--success` | `#506570` | `#bacbd4` | Success text |
| `--error` | `#a63730` | `#ffb4a9` | Error text and invalid boundaries |

The dark link role is lighter than the selected accent to meet normal-text
contrast on graphite surfaces; light success text is slightly darker for contrast
on the soft feedback surface. Control borders are stronger than decorative lines.
Do not interchange these roles. Neutral graphite (not brown or green), ivory, and
restrained red-orange remain the dark theme's foundation.

## Typography and density

- Page headings: Georgia/system serif, 32px, normal weight, 1.2 line height.
- Secondary headings: same serif, 24px. Use sentence case.
- Body, labels, controls: Inter/system sans-serif, 14px, 1.6 line height.
  Inter is optional; system fallback keeps the interface readable if remote fonts
  are blocked.
- Handles, technical identifiers, and code: system monospace (`identifier` or
  `font-mono`). Do not use monospace for explanatory prose.
- Spacing tokens use a 4px base: 4, 8, 12, 16, 24, and 32px. Controls are at least
  40px tall, with 4px radii and 1px borders. Responsive page padding is 16–32px.

## Shared components and states

`app/components/ui.tsx` contains only primitives used by existing screens:

```tsx
<Page>
  <h1>Register handle</h1>
  <Form method="post">
    <Field
      label="Handle"
      name="handle"
      required
      error={errors?.handle}
      hint="Your handle becomes your namespace. It’s permanent."
    />
    <Feedback>{errors?.reason}</Feedback>
    <SubmitButton pendingLabel="Registering…">Register handle</SubmitButton>
  </Form>
</Page>
```

- `Page` is a basic responsive surface; it does not establish new navigation or
  information architecture.
- `Field` associates its label, hint, and error with the input, and marks invalid
  inputs with `aria-invalid`. Keep native input types and autocomplete hints.
- `SubmitButton` disables duplicate submissions during navigation and gives the
  submitted action a textual loading label. Pass its form's `intent` when several
  forms share a route. Use `secondary` for alternative actions.
- Buttons have default, hover, pressed, disabled, and loading styles. Inputs have
  hover, invalid, and disabled styles. Every interactive control has a visible
  2px focus outline with a 3px offset. Links remain underlined.
- `Feedback` uses explicit Error/Success/Note prefixes, not color alone. Errors
  use `role="alert"`; success and notice use `role="status"`. Never hide a
  meaningful error solely in a border color.
- Keep lengthy IDs and email addresses wrappable; code blocks scroll horizontally
  rather than widening the page. No animation is required.

## Theme behavior

The initial default is the system color scheme (`color-scheme: light dark` and
CSS `light-dark()`, supported by current evergreen browsers). The shared Appearance
control offers System, Light, and Dark. An explicit choice persists in local
storage under `ethoko-theme`, survives reloads and client navigation, and syncs
across tabs. Selecting System removes the override and follows live system
changes. If storage is blocked, the choice still works for the current document.

A small synchronous script in the document head restores the validated preference
before styles load. Only the intentionally mutated HTML attribute suppresses
hydration warnings; rendering the select uses a server snapshot until hydration.
If a Content Security Policy is introduced, authorize this bootstrap with a
nonce/hash rather than removing it and introducing a wrong-theme flash. With
JavaScript disabled, system colors still work; explicit selection needs JavaScript.

## Writing

Be direct, concise, and helpful. Reassurance comes from clarity, not jokes,
marketing slogans, decorative Japanese wording, or exclamation marks. Use
sentence case and consistent verbs: Sign in, Sign up, Register handle, Verify
email, Resend verification email, Sign out. Follow `GLOSSARY.md` and the root
`GLOSSARY-MAP.md`: a handle becomes a permanent namespace; a project is not a git
repository; tags point to artifact IDs.

| Situation | Example |
| --- | --- |
| Credential failure | “We couldn’t sign you in. Check your email and password, then try again.” |
| Service failure | “The sign-in service is unavailable. Try again in a moment.” |
| Onboarding | “Your handle becomes your namespace. It’s permanent, so choose one you’ll keep.” |
| Handle taken | “This handle is taken. Choose another handle.” |
| Verification | “Enter the code sent to [email].” |
| Verification expired | “The provided code has expired. Request a new one.” |
| Empty state (future screens only) | “No artifacts yet. Push an artifact with the Ethoko CLI to get started.” |

Only credential failures should suggest checking the password. Preserve distinct
expired-code, cooldown, session-expiry, and service-failure meanings. Explain
irreversible choices before submission and provide a concrete next step.
