---
name: pr-review-plan
description: Turn PR review comments into a shared checklist of bounded changes and points needing human intervention.
disable-model-invocation: true
---

# PR Review Plan

Analyze a review and publish an evidence-backed plan of bounded changes on the PR. This skill owns planning and tracking links; implementation, completion updates, and substantive review replies belong to later work.

## 1. Read the review and current plan

Use `gh` to identify the requested PR, or the current branch's PR when none is supplied. Ask if the target is ambiguous. Read the PR description, head commit, diff, review summaries, inline threads with replies, and conversation comments. Paginate collections so the whole review is covered.

Find conversation comments containing the exact marker `<!-- pr-review-plan -->`. The latest by creation time is the sole canonical plan; update it even if older plans exist. If none exists, create one in step 4. Preserve its item IDs, checkboxes, and implementation references. Read marked tracking replies as bookkeeping, rather than new review requests.

Find the originating PRD/task through the supplied reference, PR/commit issue links, or relevant repository specs. Read its requirements and explicit exclusions. If none exists, use the PR description when it establishes the intended outcome; otherwise ask for the scope reference. Record the source used.

Finish when every review point and the existing canonical plan are available, with source URLs, the scope reference, and the reviewed head SHA recorded.

## 2. Identify bounded changes

For each review point, inspect the relevant code at the recorded PR head. Resolve accessible factual questions by tracing affected callers, consumers, tests, dependencies, and execution context. Establish that the inspected code matches that revision. Check whether a suspected failure is reachable in the supported execution model before treating it as a blocker.

Choose a bounded implementation using the review direction, documented standards, and existing conventions. The reviewer need not prescribe types, methods, or internal boundaries. Explain material implementation choices briefly; multiple possible implementations alone are not a reason to escalate.

Classify each outstanding point against three gates:

1. **Clear direction:** the intended outcome of the review comment is understood.
2. **In scope:** both the outcome and proposed implementation fit the scope reference, preserving its requirements and exclusions. Supporting refactors or convention fixes qualify when directly needed for the correction, even if not individually named in the task. Keep unrelated improvements and speculative capabilities outside the item.
3. **Two-way door:** the item's additional effects are cheap to reverse in the actual deployment context, without significant lasting consequences. Assess the item rather than inheriting the whole PR's classification. Reverting code alone is insufficient when data changes, external effects, or consumer commitments persist.

- **Ready:** inspection supports all three gates and a concrete verification method. Record the inspected paths or symbols, scope rationale, and reversibility evidence.
- **Needs human intervention:** after targeted investigation, a specific obstacle to a gate remains: unclear intent, a scope conflict, a one-way door, unavailable necessary evidence, or a material trade-off the available guidance cannot settle. State the obstacle and the question or decision needed in one sentence. Points requiring only a substantive discussion reply remain here for this version.

Separate independent portions before propagating a blocker. A prerequisite that meets the gates is sequencing: its dependents can remain ready with an explicit dependency. Only a concrete dependency on an unresolved obstacle requires human intervention too; identify that obstacle. For example, error documentation can follow a planned error-type change, while documentation for unaffected errors stays independent.

An empty ready list is valid. For already addressed points or irrelevant notices, record a short disposition and source link so review coverage is explicit.

Finish when every review point is accounted for, each escalation names a remaining obstacle after investigation, and every ready change has evidence for the gates, a verification method, and a scope stop condition. Keep the code unchanged.

## 3. Assemble the checklist

Consolidate comments only when they share one bounded change intention; retain every source link. Keep independently implementable intentions separate.

Assign each actionable or human-intervention item a stable ID (`R1`, `R2`, …). Match existing items by source links and intention. Preserve their IDs across reordering and allocate new IDs above the existing maximum. Retain historical items and completion records; if an intention is superseded, label it and link its replacement rather than repurposing its ID.

Order ready items by smallest verified scope first, with prerequisites preceding dependents. Include dependency IDs when present; numerical size scores are unnecessary.

Use this comment structure:

```markdown
<!-- pr-review-plan -->
## PR review action plan

Reviewed head: <commit SHA>
Scope reference: <PRD/task link or path; PR description if used as fallback>

### Ready

- [ ] **R1 — <title>**
  - Sources: <review comment links>
  - Change: <intended outcome and bounded scope; inspected paths/symbols>
  - Basis: <why in scope and cheap to reverse in the actual context>
  - Depends on: <IDs, if any>
  - Verify: <specific check and expected result>
  - Scope stop condition: <discovery that would invalidate direction, scope, or reversibility>

### Needs human intervention

- [ ] **R2 — <title>**
  - Sources: <review comment links>
  - Open point: <remaining obstacle and the question or decision needed>

### Completed / otherwise accounted for

<Preserved completed items and implementation references; dispositions and
source links for already addressed points or irrelevant notices.>
```

Use “None” for empty sections. The plan describes scope and dependencies; execution batch size and execution-session policy belong to the execution skill.

Finish when the checklist covers the whole review, preserves existing progress, orders prerequisites before dependents, and has no ready item conditional on an unresolved human-intervention obstacle.

## 4. Publish and link

Re-read the canonical comment immediately before editing and preserve progress added since the initial read. Use `gh` to create or update the plan and retain its URL. If the PR head changed during analysis, refresh affected evidence before publishing the reviewed SHA.

For every original review thread mapped to an item, add a tracking reply with visible attribution and the exact hidden marker below. Multiple source threads may reference the same item; a thread covering several intentions may reference several IDs.

```markdown
<!-- pr-review-plan:tracking -->
*Automated tracking reply from the pr-review-plan skill.*

Tracked as **R1** in the [PR review action plan](<plan URL>).
Proposed change: <short intention>.
```

For human-intervention items, replace the last line with `Needs human intervention: <open point>.` This records tracking, without promising implementation or claiming the concern is answered or resolved.

Before posting, look for the tracking marker in that source thread. Reuse the latest matching reply: update its plan link or item mapping only when needed; otherwise leave it as is. For top-level comments or review summaries without threaded replies, post a PR conversation comment that also links the exact source; deduplicate by marker plus source URL.

If permissions prevent editing a canonical plan or tracking reply, report the blocked update rather than creating a duplicate. Keep successfully published work and report any remaining publication failures.

Finish by returning the canonical plan URL and a short count of ready and human-intervention items. Publication is complete when every mapped source has a marked tracking link to the canonical plan.
