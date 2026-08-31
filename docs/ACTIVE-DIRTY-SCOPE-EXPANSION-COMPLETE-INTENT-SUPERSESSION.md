---
title: "Active-dirty Scope-expansion Complete-intent Supersession"
graphId: "md:active-dirty-scope-expansion-complete-intent-supersession"
doc_type: "Recovery Controller Contract"
date: "2026-08-31"
lang: "en-US"
schema: "agentic-active-dirty-scope-expansion-complete-intent-supersession-doc/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "exact typed authorization and current PR844 task capability"
runtime_scope: "one atomic local writer-registry archive, receipt append, and normal v1 intent seed"
runtime_claim: "no source, index, Git object/ref, cloud, pull-request, merge, cleanup, or deployment effect"
runtime_owner: "../scripts/active-dirty-scope-expansion-complete-intent-supersession-contract.mjs; ../scripts/active-dirty-scope-expansion-complete-intent-supersession-repository-adapter.mjs; ../scripts/active-dirty-scope-expansion-complete-intent-supersession.mjs"
runtime_proof: "../__tests__/active-dirty-scope-expansion-complete-intent-supersession.test.mjs"
publish_policy: "Protected recovery only; ordinary scope expansion and release remain separately gated"
---
<!-- Responsibility: Document the exact completed-intent archive and atomic successor-intent seed. -->

# Active dirty scope-expansion complete-intent supersession

This protected controller repairs one closed lifecycle gap for PR #844. The branch already has a valid completed 13-path scope-expansion intent, while the still-dirty owner lane needs a strict 15-path successor. Ordinary scope expansion correctly refuses to overwrite the completed intent. This controller preserves that terminal record in an immutable history and atomically seeds the ordinary v1 intent for the successor plan.

It is not a general intent reset, a claim takeover, or a way to bypass ownership.

## Exact subject

The contract is closed over all of the following:

- repository `huijoohwee/agentic-canvas-os` and pull request #844;
- branch `agent/huis-macbook-pro-3.local/provisioned-start-pre-bind-descendant-recovery`;
- session `01a0554f-78d4-7221-b216-ed700a4bae72` and semantic scope `provisioned-start-pre-bind-descendant-recovery`;
- the exact active lease, current cloud claim, task-authority binding, open draft provider pull request, writer marker, and pull-request body digests observed while planning;
- the exact completed intent, its full plan snapshot, and its terminal completion receipt;
- tracked dirt on all 13 currently admitted paths, with no untracked paths;
- the exact 13-path current admission and exact strict-superset 15-path target manifest; and
- the current provider `main` base observed on the pull request, joined to the successor plan's target canonical base.

The two added successor paths are:

- `__tests__/helpers/planned-dirty-admission-recovery-fixtures.mjs`
- `__tests__/planned-dirty-admission-recovery.test.mjs`

Every provider, lease, claim, intent, receipt, manifest, write-set, dirt, and plan projection is normalized and digest-sealed. A heartbeat, claim-local transition, pull-request edit, dirt change, manifest change, or provider-base change produces a different plan and invalidates earlier authorization.

## Planning and authorization

Planning is read-only. It captures the complete evidence snapshot, both append-only history heads, and the normal v1 successor intent. The resulting plan prints one byte-exact authorization:

```text
authorize active-dirty-scope-expansion-complete-intent-supersession <planDigest>
```

Execution requires that exact string and a fresh proof from PR #844's current task-authority binding. The supersession authorization receipt and task-authority receipt are both stored in the terminal archive. The fallback implementation lane's capability does not authorize mutation of PR #844's registry record.

Authorization is plan-specific and single-purpose. It authorizes only the local writer-registry compare-and-swap described below; it does not authorize source edits, index changes, Git object or ref changes, provider mutations, merging, cleanup, or deployment.

## One atomic registry transition

Under the repository writer-registry lock, execution must re-read and validate the current lease and claim identity, the exact source intent, and the two history heads. One successful compare-and-swap performs all three projections together:

1. Append an archive to `scopeExpansionCompleteIntentSupersessionArchives[branch]`.
2. Append its seeded-intent receipt to `scopeExpansionCompleteIntentSupersessionReceipts[branch]`.
3. Replace `scopeExpansionIntents[branch]` with the ordinary `agentic-active-dirty-scope-expansion-intent/v1` successor in `intent` status.

Both history values are arrays. Each entry carries the digest of its predecessor, so later supersessions cannot overwrite or silently reorder earlier evidence. The archive contains the full normalized supersession plan and evidence, completed source intent and completion receipt, exact authorization receipt, and task-authority receipt. The seeded receipt contains the exact normal v1 intent, archive join, history predecessor, registry revision, and authorization joins.

No partial state is valid. The controller must not archive without seeding, seed without both history entries, or write either history outside the same registry CAS.

## Replay and rejection rules

An exact retry after a response loss is read-only. It succeeds only when:

- the current branch intent is byte-equivalent to the plan's seeded v1 intent;
- exactly one archive and one seeded receipt match the plan;
- both matching entries are the current append-only heads; and
- every archive, receipt, authorization, predecessor, and digest join validates.

The retry returns the stored archive and seeded receipt with `replayed: true`; it does not request a new task proof or advance the registry revision.

The controller fails closed for a missing or different source intent, replay without both terminal entries, duplicate plan entries, predecessor drift, registry CAS drift, changed lease or claim, changed provider state or body marker, changed dirt, non-exact manifests, malformed task authority, or any digest/shape tampering. An unrelated registry revision may advance between planning and execution only if the target lease, intent, and both branch-local history heads remain exact when the protected CAS runs.

## Effect boundary and handoff

The result explicitly records `false` for source-byte, index, Git-object, Git-ref, cloud, pull-request, merge, cleanup, and deployment effects. The sole mutation is the atomic local writer-registry projection above.

After a successful seed, resume the ordinary active dirty scope-expansion workflow with the same sealed 15-path manifest. That controller remains responsible for the cloud successor, local lease projection, pull-request marker, completion receipts, and later release workflow. This fallback does not perform or claim any of those phases.

Before handoff, verify the contract test, JavaScript syntax, documentation checks, diff whitespace, exact five-path admission, and that PR #845's owner-bound lane remains untouched.
