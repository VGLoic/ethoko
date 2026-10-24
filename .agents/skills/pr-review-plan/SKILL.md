---
name: pr-review-plan
description: Turn PR review comments into a shared checklist of bounded changes and points needing human intervention.
disable-model-invocation: true
---

# PR Review Plan

Analyze a review and publish a small, evidence-backed plan on the PR. This skill owns planning and tracking links; implementation, completion updates, and substantive review replies belong to later work.

## 1. Read the review and current plan

Use `gh` to identify the requested PR, or the current branch's PR when none is supplied. Ask if the target is ambiguous. Read the PR description, head commit, diff, review summaries, inline threads with replies, and conversation comments. Paginate collections so the whole review is covered.

Find conversation comments containing the exact marker `<!-- pr-review-plan -->`. The latest by creation time is the sole canonical plan; update it even if older plans exist. If none exists, create one in step 4. Preserve its item IDs, checkboxes, and implementation references. Read marked tracking replies as bookkeeping, rather than new review requests.

Finish when every review point and the existing canonical plan are available, with source URLs and the reviewed head SHA recorded.

## 2. Identify bounded changes

For each review point, inspect the relevant code at the recorded PR head, including affected consumers and tests as needed. Establish that the inspected code matches that revision; identify any evidence gap explicitly.

Classify each outstanding point:

- **Ready:** the review identifies both the problem and an acceptable solution, and targeted inspection confirms a bounded change with a concrete verification method. Record the inspected paths or symbols supporting that boundary.
- **Needs human intervention:** a decision, acceptable solution, necessary evidence, or independence from an unresolved point is missing. State the specific question or missing information in one sentence. Questions requiring a substantive response belong here for this first version.

Small changes still need evidence: documentation can depend on unsettled error types, and removing a response field can affect consumers. A dependency on an unresolved decision makes the dependent change need human intervention too.

Keep investigation targeted. When qualifying a point would require substantial design or planning, record the blocker and move on. An empty ready list is a valid result. For already addressed points or irrelevant notices, record a short disposition and source link so review coverage is explicit.

Finish when every review point is accounted for and every ready change has an inspected boundary, verification method, and scope stop condition. Keep the code unchanged.

## 3. Assemble the checklist

Consolidate comments only when they share one bounded change intention; retain every source link. Keep independently implementable intentions separate.

Assign each actionable or human-intervention item a stable ID (`R1`, `R2`, …). Match existing items by source links and intention. Preserve their IDs across reordering and allocate new IDs above the existing maximum. Retain historical items and completion records; if an intention is superseded, label it and link its replacement rather than repurposing its ID.

Order ready items by smallest verified scope first, with prerequisites preceding dependents. Include dependency IDs when present; numerical size scores are unnecessary.

Use this comment structure:

```markdown
<!-- pr-review-plan -->
## PR review action plan

Reviewed head: <commit SHA>

### Ready

- [ ] **R1 — <title>**
  - Sources: <review comment links>
  - Change: <intended outcome and bounded scope; inspected paths/symbols>
  - Depends on: <IDs, if any>
  - Verify: <specific check and expected result>
  - Scope stop condition: <discovery that would require a new decision or wider change>

### Needs human intervention

- [ ] **R2 — <title>**
  - Sources: <review comment links>
  - Open point: <specific question or missing information>

### Completed / otherwise accounted for

<Preserved completed items and implementation references; dispositions and
source links for already addressed points or irrelevant notices.>
```

Use “None” for empty sections. The plan describes scope and dependencies; execution batch size and execution-session policy belong to the execution skill.

Finish when the checklist covers the whole review, preserves existing progress, and has no ready item conditional on an unresolved decision.

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
