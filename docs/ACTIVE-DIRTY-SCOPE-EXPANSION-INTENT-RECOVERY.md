---
title: "Active-dirty Scope-expansion Intent Recovery"
graphId: "md:active-dirty-scope-expansion-intent-recovery"
doc_type: "Runtime Contract"
date: "2026-08-12"
lang: "en-US"
schema: "agentic-active-dirty-scope-expansion-intent-recovery/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "exact-authorized terminal reconciliation of one successor-bound scope-expansion intent after a single heartbeat renewal"
runtime_scope: "read-only planning, exact C3-to-C4 lineage proof, current PR marker proof, original-intent terminal CAS, and crash-safe replay"
runtime_claim: "focused Dev runtime proof only; authoring, integration, cleanup, deployment, and production availability remain separately gated"
runtime_owner: "../scripts/active-dirty-scope-expansion-intent-recovery-contract.mjs; ../scripts/active-dirty-scope-expansion-intent-recovery-evidence.mjs; ../scripts/active-dirty-scope-expansion-intent-recovery-controller.mjs; ../scripts/active-dirty-scope-expansion-intent-recovery-repository-adapter.mjs; ../scripts/active-dirty-scope-expansion-intent-recovery.mjs"
runtime_proof: "../__tests__/active-dirty-scope-expansion-intent-recovery-contract.test.mjs; ../__tests__/active-dirty-scope-expansion-intent-recovery-evidence.test.mjs; ../__tests__/active-dirty-scope-expansion-intent-recovery-controller.test.mjs; ../__tests__/active-dirty-scope-expansion-intent-recovery-repository-adapter.test.mjs; ../__tests__/active-dirty-scope-expansion-intent-recovery-cli.test.mjs"
publish_policy: "Dev-only; no protected integration, cleanup, Production mirror, Cloudflare deployment, or authoring authority"
---
<!-- Responsibility: Document the frozen-plan terminal recovery and its historical-authority boundary. -->

# Active-dirty scope-expansion intent recovery

This controller closes one narrow crash gap. An active dirty scope-expansion intent can remain at
`successor-bound` after its C2 successor was correctly projected to the local writer lease and draft
pull request, then renewed once by a heartbeat. The historical intent records counter C3 while the
joined local lease, cloud claim, and pull-request marker record heartbeat-only counter C4.

The recovery verifies that C4 is exactly one renewal of C3 and marks the original scope-expansion
intent `complete`. It does not replace historical facts with current authority. In particular,
`boundAuthority`, `boundReceiptDigest`, `targetClaimDigest`, waiting evidence, promotion evidence,
source-retirement evidence, and the frozen scope-expansion plan remain byte-identical.

Recovery does not create or renew a cloud claim, change a lease, expand scope, edit authored bytes,
create a commit or ref, push, integrate, clean a worktree, or deploy. A terminal receipt is evidence
of reconciliation, not new write authority.

## Eligibility and source proof

Planning fails closed unless all source subjects join at one stable observation:

- the controller is clean protected `main`, equal to local `origin/main` and remote GitHub `main`;
- the source is the exact attached dirty writer worktree, with local HEAD equal to remote branch HEAD;
- the dirt is tracked only, has no untracked paths, and remains covered by the target write manifest;
- the original scope-expansion intent is exactly `successor-bound` with no local, PR, or final
  projection recorded in that intent;
- its immutable plan, manifest digest, target write-set digest, base, branch, fence, claim, review
  request, waiting record, promotion record, bound authority, and receipts are internally valid;
- the current writer lease is active and admitted to that exact target manifest and write set;
- the current cloud authority and hydrated current claim exactly join the lease, claim, branch,
  base, write set, review request, session, and expiry;
- the open draft pull request has the same repository, branch, HEAD, and exact current writer marker;
- a fresh operation-derived mutation-authority receipt joins that lease and C4 cloud authority; and
- the historical and current collaboration ledgers prove the exact heartbeat lineage below.

The plan embeds these normalized subjects and their digests. It excludes observation timestamps that
do not change the authority subject, but the run still requires the local and cloud expiries to be
current when it re-verifies mutation authority.

## Exact heartbeat lineage

The historical ledger is read at the Git revision recorded by the intent's C3 `boundAuthority`. The
current ledger is read at the fresh operation-derived verification's global-head revision. That global
head may have advanced beyond the locally pinned C4 revision only through an exact validated unrelated
suffix. Both ledgers must pass their full repository validator. The target C4 transition and claim
digests stay pinned to local authority, while the purpose-specific mutation-authority receipt separately
binds the fresh global revision and ledger digest.

The historical entry array must be an exact prefix of the current entry array. The suffix may contain
unrelated validated entries, whose exact digest is sealed, but it must contain exactly one entry for
the target claim. That target entry must be a `continue` renewal with:

- transition counter equal to C3 plus one;
- heartbeat counter equal to C3 plus one;
- a strictly later expiry; and
- unchanged claim identity, actor, repository, work item, base, lane, declared scope, write-set
  digest, lease epoch, state, review evidence, device/session projection, promotion, recovery,
  integration, handoff, and retirement evidence.

The current public claim must join the raw C4 entry's claim digest, transition digest, counters, and
expiry. A second target renewal, a projection, a changed review identity, a counter jump, a non-prefix
history, or a forged current projection invalidates the plan.

The target manifest binds through `lease.admission.manifestDigest` and the frozen plan. A current
authority's `manifestDigest` can be a legitimate heartbeat projection digest, so it is not
incorrectly required to equal the source manifest digest.

## Read-only plan and exact authorization

Run planning from the protected controller checkout:

```sh
node scripts/active-dirty-scope-expansion-intent-recovery.mjs plan \
  --source-repository=/absolute/path/to/dirty-worktree \
  --session=<writer-session> \
  --target-repository=owner/repository \
  --pull-request=<number>
```

Planning performs no registry, cloud, pull-request, Git-ref, or worktree mutation. It returns the full
plan, `planDigest`, and this byte-exact token:

```text
authorize active-dirty-scope-expansion-intent-recovery <planDigest>
```

Whitespace, case, digest, source evidence, protected-main, lease, ledger, pull-request, intent, or
dirt drift requires a fresh plan. The run command requires both the exact lowercase plan digest and
the byte-identical authorization token. Operator-selected journal or controller paths are rejected.

## One-shot terminal effect

Before the effect, the controller durably records an `authorized` recovery intent outside the dirty
writer worktree. The sole effect is fenced by the repository Git-common-dir entrypoint lock and the
full writer-lease registry lock.

Inside that terminal operation the repository adapter:

1. re-reads and proves the frozen source evidence and current mutation authority;
2. proves the draft pull request contains the exact current C4 writer marker;
3. compare-and-swaps the exact writer lease digest, C4 claim ID, registry revision, branch, and
   original `successor-bound` intent digest;
4. replaces only `scopeExpansionIntents[branch]` and increments the registry revision; and
5. writes the original intent at `complete` with current local and PR projection receipts plus its
   deterministic final receipt.

The lease object returned by the CAS is unchanged. The original C3 `boundAuthority` and
`boundReceiptDigest` are unchanged. Current C4 authority is carried by the separately authorized
source evidence, terminal observation, and recovery receipt; it is not rewritten into the historical
bound fields.

The recovered intent's local projection binds the unchanged current lease digest, C4 claim ID, and
fresh mutation-authority receipt. Its PR projection binds the already-current marker digest. Its
final receipt binds the frozen expansion plan, current marker, and mutation-authority receipt.

## Crash replay and receipt

The controller observes terminal live state before attempting the effect and again after any error.
If the exact terminal original intent is already present, it adopts that result rather than repeating
the CAS. Recovery-journal writes are digest-checked compare-and-swap operations. A completed replay
returns the same sealed receipt without another registry or provider mutation.

The terminal recovery receipt binds:

- the recovery plan, source evidence, exact authorization, operation key, and complete recovery
  journal intent;
- the source and recovered original scope-expansion intent digests;
- the current C4 authority and exact C3-to-C4 heartbeat-lineage digests;
- the unchanged current lease digest and current PR marker digest;
- the fresh mutation-authority receipt; and
- the original intent's deterministic final receipt.

That receipt sets no authoring or deployment authority. Subsequent review, validation, protected
integration, lifecycle cleanup, or release still requires its repository-owned controller and gates.

## Focused proof

```sh
node --test \
  __tests__/active-dirty-scope-expansion-intent-recovery-contract.test.mjs \
  __tests__/active-dirty-scope-expansion-intent-recovery-evidence.test.mjs \
  __tests__/active-dirty-scope-expansion-intent-recovery-controller.test.mjs \
  __tests__/active-dirty-scope-expansion-intent-recovery-repository-adapter.test.mjs \
  __tests__/active-dirty-scope-expansion-intent-recovery-cli.test.mjs
npm run docs:check
```

Focused local proof does not prove that a live reconciliation ran, protected main integrated it,
cleanup is admissible, or any Production surface changed.
