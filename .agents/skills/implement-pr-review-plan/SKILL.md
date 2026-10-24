---
name: implement-pr-review-plan
description: Implement a PR review action plan serially on its branch, with delegated items and a final review.
disable-model-invocation: true
---

# Implement PR Review Plan

Implement the canonical PR review plan on the existing PR branch. The plan is approved scope; its explicit dependencies define a task graph. The **frontier** is every unchecked Ready item whose dependencies are satisfied. Items without `Depends on` are immediately available, including items touching overlapping code.

Communicate with subagents through context pointers: the canonical plan, source comments, shared notes, and commits. Keep session records outside the repository, accessible to all agents. The coordinator owns scheduling and publication; implementers work one at a time directly on the PR branch. Use the existing checkout, with no per-item branches, worktrees, or merger agent.

## 1. Pin the plan and execution baseline

Use `gh` to identify the requested PR, or the current branch's PR when none is supplied. Ask if ambiguous. Read the PR metadata and conversation comments, paginating collections. The latest comment by creation time containing `<!-- pr-review-plan -->` is canonical. If absent, ask the user to run `pr-review-plan` first.

Read the plan and its source threads, including replies. Treat marked tracking replies as bookkeeping. Preserve the plan's IDs, completion history, source links, and `Reviewed head`.

Fetch the PR head and capture its SHA as the immutable **session baseline**. Check out the existing PR branch and establish that its starting tip matches the captured PR head before dispatching agents. If local changes or divergent commits prevent a clean starting state, preserve them and ask how to proceed.

Check each unchecked Ready item against that revision. A changed head alone does not invalidate the plan: proceed where the bounded intention still applies. Record already-satisfied items with evidence as accounted for. Substantive contradictions, missing dependency IDs, cycles, or scope-stop discoveries block affected items and their dependents pending human input. Leave existing human-intervention items blocked.

Finish with a session record containing the plan URL and snapshot, PR branch and baseline, item/dependency graph, and evidence for accounted-for or blocked items.

## 2. Dispatch the frontier

Select the first unchecked Ready item in plan order whose explicit dependencies are satisfied. Launch one **implementer subagent** for that item and wait for its handoff before dispatching another. A prerequisite is satisfied when committed and verified on the PR branch, or evidenced as already satisfied.

Give each implementer pointers to its item and source threads, repository instructions, PR branch and current tip, session record, and this handoff contract:

- Confirm the checkout is clean and on the assigned PR branch and tip before editing.
- Implement only the item's bounded intention, preserving previously completed items. On ambiguity or a scope stop condition, return the exact blocker. Save unfinished edits as a recoverable patch and notes outside the repository, then remove only those edits to restore the starting state. If safe isolation is uncertain, pause execution for the coordinator rather than handing dirty state to another implementer.
- For behavioral changes, call the `tdd` skill and follow its confirmation requirements. For documentation and behavior-preserving refactors, use appropriate existing checks.
- Run the item's `Verify` checks and applicable repository validation, then commit the completed item directly on the PR branch.
- Return the item ID, implementation commit SHA(s), resulting tip, verification commands and outcomes, and any blocker or saved-work paths. Leave publication to the coordinator.

Finish each dispatch with the implementer's report received and exclusive control of the checkout returned to the coordinator.

## 3. Verify the handoff and advance the frontier

Check that the reported commits are on the PR branch, verification evidence covers the item, and the checkout is clean. Count the item complete locally only when all three hold. Resolve an incomplete handoff with the same implementer before dispatching another.

Record completion evidence or the concrete blocker, then recompute the frontier and return to step 2 for the next available item in plan order. Keep failed or blocked items and their dependents pending while independent work continues from a clean checkout.

Finish when no implementer is running and no executable items remain. Every selected item must have commit and verification evidence, an already-satisfied disposition, or a concrete blocker. Completed items remain unpublished until step 5.

## 4. Review the session and fix findings

When `git diff <session-baseline>...HEAD` is nonempty, call `code-review` on the PR branch with the session baseline as its fixed point. Explicitly supply the executed plan items and source comments as the review specification, overriding discovery of the original feature issue. Preserve its separate Standards and Spec reports. An empty diff needs a recorded no-change disposition rather than review agents.

Assess every finding for attribution to this session. Send all actionable, session-related findings to **one implementer subagent**, working directly on the PR branch under the same handoff contract. Verify its handoff as in step 3. Findings requiring a new scope decision remain blocked; pre-existing findings are reported separately.

Run required validation on the final branch state. This is one review and one consolidated fix pass, followed by validation; unresolved findings are reported without starting another automatic review loop.

Finish with the final tip verified, every finding accounted for, and completion evidence updated to include any follow-up commits. If validation fails, retain the work and report the failure before publishing completion claims.

## 5. Publish

Publish the completed subset even when other items remain blocked, in this order:

1. **Push** the PR branch. If the remote advanced, fetch and reconcile serially on the branch, rerun affected checks, and retry a normal push. Preserve remote commits. For conflicts, use `resolving-merge-conflicts` within the plan's scope; stop for human input if reconciliation requires a new decision. Record the published tip before updating GitHub bookkeeping.
2. **Update the canonical plan.** Re-read the latest canonical comment immediately before editing and preserve concurrent changes. Mark only verified, published items complete, with implementation commit links and actual verification outcomes. Record already-satisfied dispositions with evidence and blockers with their open questions; leave blocked items and dependents unchecked. Preserve historical records and the original `Reviewed head`; add the session baseline and published tip to the execution record. If the plan's intention changed during execution, surface the discrepancy rather than claiming the replacement intention complete.
3. **Reply to original source threads.** For each completed item's source, link the implementation commit(s) containing its changes, including relevant reconciliation or review-fix commits. Use the reply contract below; leave review threads unresolved.

If a push fails, retain unpublished work and stop before completion updates. If a plan edit or reply fails, retain successful publication, report the exact remaining bookkeeping, and resume it without duplicate comments or implementation. A forbidden canonical-plan edit is a blocked update, not a reason to create a competing plan.

Finish by reporting the PR and plan URLs, published tip, completed/accounted-for/blocked item IDs, validation outcomes, review findings and their dispositions, and any saved unfinished work or publication failures.

### Source-thread reply contract

Post in the original review thread, with visible attribution and this marker:

```markdown
<!-- implement-pr-review-plan:completion -->

_Automated implementation reply from the implement-pr-review-plan skill._

Implemented **R1** from the [PR review action plan](<plan URL>) in <commit links>.
Verification: <commands and outcomes>.
```

Read existing replies before posting. Deduplicate by marker, canonical plan URL, and item ID within the source thread; update an existing matching reply when evidence changes, otherwise leave it intact. Combine completed IDs when one source thread maps to several items. Keep planning tracking replies separate.

For a source without a thread-reply mechanism, report the source URL as a blocked reply rather than silently posting elsewhere. On resumed runs, use recorded completion evidence to finish missing replies even for items already checked complete.
