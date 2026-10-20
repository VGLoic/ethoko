# Bounded Central exploration

Use this workflow for connected-boundary gaps, visual/interaction judgment, or a failure existing tests cannot reproduce. Briefly state that confidence gap; no extra approval is required. Use automated tests for ordinary regression verification.

## Run

1. Check prerequisites and browser installation in [Central playground](../central-playground.md). Inspect `pnpm playground:status` before changing a running instance. Coordinate directly if someone is using the single playground; there is no session ownership protocol.
2. Bound the activity to one command, not the current OpenCode conversation. Run from the repository root:

   ```sh
   pnpm playground:explore -- opencode run --standalone 'Read docs/agents/playground.md. You are the bounded exploration worker: the outer runner already started Central and owns cleanup. Use playground browser tools interactively to check the complete email journey described in docs/central-playground.md. Discover URLs from status. Create a unique local User through signup, read the normal worker delivery, verify email, sign in and register a handle. Inspect the resulting Home, console and network diagnostics. Save useful evidence under .central-playground/browser/evidence/. Report journey, outcome, limitations and local evidence locations. Do not start another exploration runner or stop the application; finish browser calls before returning.'
   ```

   Replace the journey with the confidence gap at hand. The bounded worker chooses actions from the observed page, rather than authoring a permanent browser test. It may use normal read/shell tools to retrieve captured email. Use an authenticated model (`opencode run --model <provider/model>` if the CLI default differs from the current agent) and existing permissions; do not add blanket auto-approval. Only one client should call the playground browser tools during the activity. The parent agent waits for runner completion before its final response.

3. Investigate browser/public API first, then existing UI/API/worker logs. Inspect the database only as a diagnostic fallback; never change records to force success. Keep credentials, verification links and captures private. For the supported email journey, follow the [interactive procedure](../central-playground.md#interactive-exploration-in-opencode-v2); GitHub and hosted email-provider behavior are outside its scope.
4. Finish all browser operations before the worker returns, then wait for the runner's [lifecycle handling](../central-playground.md#isolation-persistence-and-cleanup). Check `pnpm playground:status`: application state must be `stopped` and `browser.processes` empty. Avoid browser calls after cleanup because they can launch Chromium again.
5. Summarize the journey, observed outcome, limitations and useful local screenshot/log paths in the session or PR. Leave run-specific reports and evidence uncommitted. If cleanup fails, report it and use the recovery steps below before claiming completion.

## Explicit human handoff

Only when the human explicitly requests a running instance, add `--handoff` before `--`. Tell the worker to report the local User's email, permanent handle, verified/onboarding state, and the locally chosen sign-in password through an appropriate private channel. Do not publish credentials in a PR or committed report.

Use the runner's reported URLs, originating checkout, diagnostics and stop command. Confirm the UI URL responds and the User can sign in from a separate browser context; report that URL and User information with log/capture/evidence locations. Agent browser cookies are not transferred to the human.

Later cleanup is explicit: `pnpm playground:stop` from the originating checkout, followed by status showing `stopped` and no browser processes. Application data remains available for another start.

## Interruption and recovery

Interrupt the bounded runner (Ctrl-C / SIGINT or SIGTERM), not the shared OpenCode server. Use `--standalone` as above so the worker's private server-side execution is bounded too: a shared OpenCode service can otherwise continue generating and relaunch Chromium after its CLI exits. The runner terminates the command group before browser/application cleanup. Unrelated OpenCode services remain running.

Exploration ends when its command returns, not when a conversation becomes idle, a client disconnects, or the entire conversation is supposedly finished. No permanent session-finished hook is assumed. After a hard crash or incomplete cleanup, follow [manual recovery](../central-playground.md#restart-and-manual-recovery).
