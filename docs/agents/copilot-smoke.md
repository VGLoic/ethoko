# Copilot runner smoke test

This is the feasibility gate for #205, before the review automation in #198. It runs the same `copilot-smoke` skill separately with `github-copilot/gpt-6-astra#medium` and `github-copilot/gpt-6-sol#medium`. Each coordinator delegates to a text-only `smoke-message` subagent pinned to its model, then publishes a marked PR conversation comment with the workflow's `GITHUB_TOKEN` (`GH_TOKEN` for `gh`). No GitHub App is needed. There is no provider/model fallback or real review work.

## Provision or renew Copilot authentication

1. Use a maintainer-controlled GitHub account with Copilot Chat access and permission to use both requested models (including organization policy approval where applicable). Catalog presence alone does not prove entitlement. This uses the account's Copilot allowance; the Actions token is only for PR publication.
2. Install OpenCode V2 locally (`npm install --global @opencode/cli`). Run `opencode auth login github-copilot` interactively and complete GitHub's browser/device OAuth flow. In OpenCode, use `/models` to check both exact model IDs and their medium variants. Do not replace unavailable IDs with newer models.
3. Export only that provider to a private temporary file and upload it as an Actions repository secret, never as a committed file, issue attachment, or log:

   ```bash
   umask 077
   credential_file=$(mktemp)
   opencode auth export github-copilot > "$credential_file"
   gh secret set OPENCODE_COPILOT_AUTH --repo VGLoic/ethoko-monorepo < "$credential_file"
   rm -f "$credential_file"
   ```

   The export contains secrets. If multiple Copilot accounts are saved, use a dedicated local profile with only the intended account before exporting. The runner imports it using `opencode auth import --standalone`; V2 stores credentials in its SQLite database. Do not copy your database or use V1 `auth.json` instructions. The import file is mode-restricted and deleted immediately after import; the database remains only on the ephemeral hosted runner. No credential or database artifacts are uploaded.

4. Renew by repeating the interactive login, export, and secret replacement when credentials expire, are revoked, or account/organization access changes. Runner-side refreshes do not update the repository secret. Revoke compromised authorization in GitHub's account settings and replace the secret. No guaranteed credential lifetime or unattended refresh is assumed; the trial must establish whether the exported credential works unattended.

Only `OPENCODE_COPILOT_AUTH` must be provisioned. GitHub supplies `GITHUB_TOKEN` automatically. Repository/organization Actions policy must permit the workflow's `pull-requests: write` permission. Restrict dispatch and secret administration to trusted maintainers.

## Dispatch and verify (maintainer-owned)

Once the workflow is on the default branch, select **Actions → OpenCode Copilot smoke test → Run workflow** and supply a same-repository PR number. For a pre-merge trial, the workflow must already exist on the default branch for dispatch to be available; select the trusted implementation branch with `--ref` if needed:

```bash
gh workflow run opencode-smoke.yaml --repo VGLoic/ethoko-monorepo -f pr=NUMBER
# Optionally add --ref TRUSTED_BRANCH to select the implementation revision.
gh run list --workflow opencode-smoke.yaml --repo VGLoic/ethoko-monorepo
gh run view RUN_ID --repo VGLoic/ethoko-monorepo --log
```

Use a disposable PR if test comments would distract reviewers. This workflow checks out the dispatch revision, not PR code. It does not prove default-branch instruction isolation; that and GitHub App publication are subsequent tickets. Run only trusted revisions because checked-out instructions/configuration execute with credentials. The nested smoke config disables the repository's unrelated playground MCP server, so no workspace dependency install is needed. The CLI is installed from the current V2 npm release; record the printed version with trial evidence.

Confirm all of the following manually:

- Both model jobs finish within the 15-minute bound without browser login, permission prompts, or other human input. A failure in one job does not cancel the other.
- Each job's JSON event output shows the smoke skill, a successful `smoke-message` child invocation using that job's exact model and medium variant, its returned message, and successful comment publication/readback. Inspect actual child-session model evidence, not just the model's self-description in a comment. The final output includes the child session ID and comment URL.
- The supplied PR has two new `ethoko:copilot-smoke` comments from `github-actions[bot]`, one per model, marked **not a review**, each with its delegated message and the correct run link. No code, commits, lifecycle labels, reviews, or thread resolutions changed.

Record the run URL, CLI version, two comment URLs, child session IDs/model evidence, and explicit pass/fail for each model in #205. If JSON output does not expose the actual child model/variant, mark that check inconclusive and request a maintainer decision about further diagnostics; successful comments are not a substitute. Logs or comments alone do not constitute maintainer confirmation. If credentials, model access, delegation, or publication fail, record the failing step and stop rollout for a maintainer decision; do not fall back or claim the prerequisite passed. Check logs for secrets before sharing them.

No feature-specific automated tests or orchestration harness are intended here. Documentation/configuration checks cannot establish unattended Copilot access; the maintainer-run trial remains pending until confirmed.

## OpenCode V2 references

- [Simple standalone CI pattern and credential export/import](https://opencode.ai/v2/docs/cli/commands/)
- [Copilot device OAuth and entitlement](https://opencode.ai/v2/docs/providers/#copilot)
- [Credential storage](https://opencode.ai/v2/docs/cli/providers/#storage)
- [Model variants](https://opencode.ai/v2/docs/models/#variants) and [subagent model selection](https://opencode.ai/v2/docs/agents/#model)
