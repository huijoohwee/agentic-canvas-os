---
title: "Reviewed CI Revision Recovery"
graphId: "md:reviewed-ci-revision-recovery"
doc_type: "Lifecycle Capability"
date: "2026-08-09"
lang: "en-US"
schema: "agentic-reviewed-ci-revision-recovery-plan/v1"
frontmatter_contract: "required"
status: "focused-tested-hard-stopped"
authority: "exact same-owner recovery planning for a reviewed pull request with one deterministic required CI failure"
---

# Reviewed CI revision recovery

This controller plans a same-owner revision after one deterministic required GitHub Actions failure. It never edits source bytes, commits, pushes, reruns CI, merges, deploys, or recovers dormant authority.

Production execution is intentionally hard-stopped. The plan and tests describe the required transition, but the hard stop must remain until every protected prerequisite below is implemented and independently reviewed.

## Public authorization contract

`plan` is read-only. Its public JSON names the destructive provider consequences covered by the exact authorization digest:

- `close-unmerged-and-preserve`: close the selected source pull request only as `CLOSED` and unmerged, and preserve its history;
- `create-one-distinct-open-draft`: create exactly one distinct `OPEN` draft replacement on the same repository, branch, head, and base;
- disclose the deterministic replacement title, bootstrap-body digest, recovery nonce, and backlink to the preserved source pull request;
- carry over no review decisions, labels, auto-merge request, or merge-queue entry;
- bind the successor authority to the provider-assigned replacement pull request; and
- replace the local lease's pull-request URL only in the terminal atomic projection.

The public base policy distinguishes the immutable source cloud canonical base from the replacement's exact protected-`main` base. It discloses both SHAs and the unchanged head SHA, requires bounded ancestry proof, and forbids a silent rebase or head mutation.

The output also says explicitly that the operation performs no source edit, commit, push, or merge. The replacement body itself and private device, session, path, lease, authority, and journal values are not public.

Plan:

```sh
node scripts/reviewed-ci-revision.mjs plan \
  --repository=/absolute/registered/worktree \
  --session=codex-session-id \
  --pr=344 \
  --check-run=93199054519
```

Execute or resume only the exact stored subject and authorization:

```sh
node scripts/reviewed-ci-revision.mjs execute \
  --repository=/absolute/registered/worktree \
  --session=codex-session-id \
  --pr=344 \
  --check-run=93199054519 \
  --authorize='authorize reviewed-ci-revision-recovery <planDigest>'
```

A stored replay rejects a different PR number, check-run ID, or authorization string. Successful CLI output is a bounded public projection containing status and digests only. The terminal registry CAS removes the active journal and retains one digest-bound archive record for exact replay.

## Admission predicates

Planning fails closed unless all of these identities agree:

- registered realpath, unique `agent/<device>/<scope>` branch, clean HEAD/tree/index, remote branch head, and protected `main` base;
- byte-exact local `review_ready` lease, admission manifest/write set, writer marker, cloud authority, private claim, device, and session;
- exact source repository, canonical PR URL/number/node/author/branch/base/head and cloud review-request identity;
- open, non-draft, unmerged source PR with auto-merge and merge queue disabled;
- strict `main` branch protection and the exact required GitHub Actions context/app;
- complete exact-head check inventory whose newest matching run/job is a completed failure, with no queued, running, or newer attempt;
- fresh repository server time with the configured expiry margin; and
- no foreign overlapping private reservation.

The source cloud canonical base remains part of the preserved review provenance. The replacement targets the exact protected `main` observed by its authorized plan. If those bases differ, protected logic must prove bounded ancestry and the unchanged head/range tree before provider mutation; it may not silently brand, rebase, or rewrite the head. The current hard-stopped prototype continues to fail closed where that proof is unavailable.

Dormant or expired authority is rejected. Re-entry requires the protected repository-owned reclaim path, exact same device/session postconditions, updated projections, private-owner proof, and a fresh live `review_ready` verifier receipt. Generic actor-only recovery is forbidden.

## Target provider fence

After the reviewed source is lawfully retired, the controller must reread and close the old PR as unmerged. Closing preserves its review and discussion while fencing stale `device:review` replays to the old URL. A response-lost close is adopted only after an exact reread proves the same node, URL, branch, head, base, repository, author, `CLOSED` state, and null merge evidence.

Replacement creation uses the authorized nonce and bootstrap digest. Response loss may adopt only one exact distinct open draft with the same immutable Git subject and author. A wrong or duplicate nonce, competing branch PR, copied labels or reviews, auto-merge, merge-queue membership, or any identity drift blocks.

The old failed check is immutable provenance. It is freshly revalidated immediately before closing the source PR. Opening the replacement can start new checks on the same SHA; those new runs do not rewrite the historical evidence and the controller must not apply the old "latest check" predicate to the replacement.

## Required delivery-won abort

An overlapping waiting successor does not currently prevent source integration in the shared cloud reducer. Therefore source retirement must be the irreversible success gate.

If delivery or integration wins first, recovery must not close the source PR, create a replacement, promote, bind, or activate locally. A protected `delivery-won-aborted` transition must:

1. prove the exact integrated source and its integration receipt;
2. retire only this plan's exact waiting or current derivative with a stable idempotency receipt;
3. verify the derivative is absent and the integrated source remains canonical;
4. restore or terminalize only this plan's old-PR marker when exact body/state proof permits; and
5. atomically terminalize the journal while leaving the source lease available to normal integration completion.

The same cleanup is required if integration wins before the waiter is observed. No actor-only, dormant, or ambiguous cleanup is permitted.

## Protected prerequisites before enabling execute

The repository hard stop may be removed only after focused reducer, provider, registry, and CLI tests prove:

- delivery-won classification and exact waiting/current derivative cleanup;
- response-ahead reconciliation for claim, retire, close, create, promote, bind, remote body projection, and terminal CAS;
- bind replay through the exact operation request and receipt, including the narrow bind-ahead state;
- stale review isolation to the closed source URL;
- bounded same-phase remote reprojection when another lane advances the global writer epoch;
- semantic validation of every typed phase receipt and final proof;
- generated replacement/final body-size bounds before source closure; and
- terminal activation as the last mutation, with exact live cloud margin and canonical full-lease projection.

Enablement must also close two provider creation boundaries: every possible final body size must be proved before the source PR is closed, and a draft created against a concurrently changed protected base or authenticated actor must be retired through a typed, replayable cleanup. The terminal recovery marker must be archived or removed without blocking a later reviewed-CI recovery on the replacement PR.

Until those prerequisites pass protected review, `execute` must remain fail-closed. Diagnostics suppress child-process output, cap messages, and redact credentials plus Unix and Windows user paths.
