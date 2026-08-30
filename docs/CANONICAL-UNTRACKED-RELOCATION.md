---
title: "Canonical Untracked Relocation Contract"
graphId: "md:agentic-canonical-untracked-relocation"
doc_type: "Runtime Contract"
date: "2026-08-30"
lang: "en-US"
schema: "agentic-canonical-untracked-relocation-contract/v1"
frontmatter_contract: "required"
status: "foundation-tested-execution-fenced"
authority: "read-only exact-plan preparation for preservation-backed canonical untracked bytes"
runtime_scope: "canonical-untracked-retention recovery packages, task-bound local leases, current cloud authority, atomic filesystem transaction primitives, recoverable source quarantine, and content-bound receipts"
runtime_claim: "planning is read-only; public execution remains fail-closed until the two-sided heartbeat and relocation registry-intent owner is installed"
runtime_owner: "../scripts/canonical-untracked-relocation-contract.mjs; ../scripts/canonical-untracked-relocation-transaction.mjs; ../scripts/canonical-untracked-relocation-repository-adapter.mjs; ../scripts/canonical-untracked-relocation.mjs; ../scripts/collaboration-gate.mjs"
runtime_proof: "../__tests__/canonical-untracked-relocation.test.mjs; ../__tests__/scoped-lane-bootstrap-canonical-dirty-main.test.mjs"
publish_policy: "Dev planning and transaction foundation; no relocation, Production, or deployment authority"
---

# Canonical Untracked Relocation

## Decision

Canonical `main` is not an authoring lane. When untracked bytes already exist
there, preserve them first with the `canonical-untracked-retention` capture
profile. Admit a clean task worktree with the exact write-scope manifest and
current cloud claim. This controller then relocates one common untracked
regular-file subtree into that admitted lane.

Capture, admission, relocation, review, integration, deployment, and cleanup
remain separate receipts. A recovery package or cloud claim alone never grants
source mutation authority.

## Required evidence

The plan fails closed unless all of these remain true:

- source and target are registered worktrees of one Git common directory;
- canonical `main`, `HEAD`, and fetched `origin/main` equal the recovery
  package's protected tip;
- the package verifies as `canonical-untracked-retention`, contains no tracked
  changes, and contains 1 to 256 bounded regular files under one non-root
  subtree;
- canonical bytes, modes, path set, source-state digest, and write-set digest
  exactly match the package;
- the target is clean, its subtree is absent, and its coordination commit has
  the canonical base tree;
- the target's active task-bound lease, admitted manifest, draft pull request,
  current cloud claim, fence, session, and expiry revalidate together; and
- every recovery path is owned by the admitted path manifest.

The initial plan is read-only. It is saved outside both repositories and emits
one literal authorization bound to source bytes, recovery digest, the current
target lease/cloud fence, and transaction paths. The authoritative receipt path
is derived under the transaction root and cannot be redirected by a caller.

## Commands

```sh
npm run workspace:canonical-untracked-relocation -- plan \
  --source="$CANONICAL_WORKTREE" \
  --recovery="$RECOVERY_DIRECTORY" \
  --target="$ADMITTED_TASK_WORKTREE" \
  --session="$AGENTIC_SESSION_ID" \
  --task-authority="$TASK_AUTHORITY_FILE" \
  --write-scope-manifest="$WRITE_SCOPE_MANIFEST" \
  --output="$EXTERNAL_PLAN" --json
```

The `execute` surface is deliberately fenced in this foundation release. It
rejects before repository effects until the writer-lease registry atomically
coordinates both pending heartbeat attempts and active relocation attempts.
After that owner is installed, execution will additionally require the plan's
literal `exactAuthorization` value:

```sh
npm run workspace:canonical-untracked-relocation -- execute \
  --source="$CANONICAL_WORKTREE" \
  --recovery="$RECOVERY_DIRECTORY" \
  --target="$ADMITTED_TASK_WORKTREE" \
  --session="$AGENTIC_SESSION_ID" \
  --task-authority="$TASK_AUTHORITY_FILE" \
  --write-scope-manifest="$WRITE_SCOPE_MANIFEST" \
  --plan="$EXTERNAL_PLAN" \
  --authorization="$EXACT_AUTHORIZATION" --json
```

Generic approval text cannot substitute for the literal digest-bound
authorization, and exact authorization cannot substitute for the missing
two-sided registry intent.

## Transaction and recovery

The implemented transaction primitives perform no commit, ref update, push,
pull-request transition, cloud transition, merge, deployment, or deletion. A
worktree-wide source slot lock under the Git common directory serializes every
subtree, capture, base, and target contender. Before a transaction directory or stage exists, its durable
source intent binds the exact source subject, stable target subject, selected
recovery package, layout, and fixed receipt. A later base, package, or target
therefore cannot open a second lock lane or install a duplicate projection.
Ordinary heartbeat changes are excluded from the stable target subject. They
require a separately exact-authorized fresh plan but reuse the same intent and
layout.

Recovery files are copied and fsynced into a unique temporary stage. Only a
complete, rehashed stage is atomically published as the canonical stage; a
partial predecessor is retained as transaction residue and never reused. Task,
cloud, lease, manifest, fence, and expiry evidence is refreshed immediately
before effects. Lock order is source slot, writer registry, then recoverable,
owner-bound native Git index/HEAD/ref locks plus the linked-worktree `locked`
marker on the native files-ref backend. Exact dead owners are recoverable;
live, malformed, ambiguous, or foreign owners fail closed. The marker blocks
ordinary and single-force worktree removal; double-force or out-of-band removal
is not claimed as excluded and instead leaves recovery bytes authoritative.
Under those fences the controller re-reads both
branches, HEADs, trees, `origin/main`, whole-worktree status, exact bytes, and
the actual rename endpoint devices. It repeats live state and device checks
between target installation and source quarantine. A non-cooperative
`git clean` is detected by those checks; if it races after quarantine, the
durable quarantine and rebuilt stage reinstall the target on exact replay.
Both atomic renames and receipt publication complete before the fences are
released.

The original recovery package remains unchanged. Completion requires all three
postconditions: source subtree absent, target subtree exact, and quarantine
subtree exact. The receipt binds both task-capability and fresh mutation-
authority receipts. The effect journal and receipt preserve separate authority
attempts for target installation and source quarantine, so a heartbeat recovery
never misattributes the first rename to its continuation plan. Intents and
receipts publish through physically rooted, symlink-rejecting, fsynced
same-directory temporary files and atomic links or renames, so a crash cannot
expose a partial final JSON file or redirect metadata outside recovery. A
terminal state without its receipt is reconstructed from the original durable
pre-effect attempt and does not require a new mutation grant. Any retry that
still needs a rename must acquire and exactly authorize fresh authority. Every
new intent directory is parent-fsynced before effects. Every other state
combination blocks. Thus an interruption preserves at least the original
package plus either source or quarantine bytes.

The remaining production gate is intentionally explicit: a heartbeat must
persist its pending registry intent before any cloud transition, and relocation
must persist an active mutually-exclusive registry intent before its final
cloud verification. Heartbeat projection and relocation receipt publication
must terminalize their own intent in the same local CAS. Until that owner ships,
the public executor does not call the filesystem transaction.

## Root-source bootstrap correction

Root-source bootstrap may now carry zero `preservedLanes` only after the
maintenance proof establishes `canonical-dirty-main`: registered canonical
`main`, dirty, unleased, not retired-preserved, and exact its allowlisted
maintenance manifest. Separate maintenance lanes still require at least one
preserved lane. This makes the documented dirty-canonical bootstrap reachable
without weakening ordinary lane preservation.

## Limits

Version 1 relocates one common subtree of bounded regular files. Symlinks,
special files, tracked patches, multiple roots, cross-filesystem moves,
unfetched protected tips, unrelated target dirt, expired authority, and path or
content drift fail closed. A later controller version may add those shapes only
with their own typed evidence and recovery model.
