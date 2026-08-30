---
title: "Canonical Squash Attribution Recovery Terminalization"
graphId: "md:canonical-squash-attribution-recovery-terminalization"
doc_type: "Recovery Contract"
date: "2026-08-30"
lang: "en-US"
schema: "agentic-canonical-squash-attribution-recovery-terminalization-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "repository-owned terminalization after one exact append-only squash-attribution recovery"
runtime_scope: "integrated cloud retirement and local completion-ready projection only"
runtime_proof: "focused contract, controller, CLI, repository-adapter, response-loss, and provider-inventory tests"
---

# Canonical Squash Attribution Recovery Terminalization

## Purpose

This controller terminalizes one preserved delivery lane whose protected squash
commit retained the reviewed tree but whose provider-rendered message placed the
four Agentic attribution trailers outside the final trailer block. It applies
only after a separate append-only evidence pull request has protected-merged,
passed its pull-request and post-main Integration runs, and completed its own
claim, task, worktree, and cleanup lifecycle.

The controller does not rewrite history or reinterpret the malformed commit as
valid. It proves the original reviewed head and tree, the malformed one-parent
squash, the exact one-file runtime-pin change, the provider auto-merge request
that carried a null body, and the append-only recovery commit. The recovery must
add exactly one regular evidence blob, preserve the original tree contents, and
carry its own valid final Agentic trailer block. Complete provider inventory,
verified Git commit objects, exact workflow events and jobs, raw collaboration
ledger lineage, local task binding, and cleanup evidence are all authoritative.

## Applicability

Planning requires:

- one completed recovery pull request and one still-preserved original delivery
  lease, each joined to its exact provider node, branch, head, base, merge,
  source tree, and first-parent ancestry;
- a full normalized public task-authority binding whose binding digest matches
  the original lease; planning validates the external capability's private-file
  boundary, while exact generation and binding proof occurs before each effect;
- the original integrated-preserved cloud transition and the recovery lane's
  reviewed, integrated, and retired ledger lineage;
- complete paginated Actions inventory where the newest matching Integration
  run at every required head and event is itself completed successfully;
- a clean, remote-exact protected main containing the recovery blob and the
  protected controller revision; and
- byte-exact frontmatter, commit-message framing, modes, blobs, pin transition,
  checks, task completion, and cleanup receipts.

Unknown frontmatter, duplicate keys, symlinks, extra or changed paths, side
branches, incomplete or newer failed runs, foreign capabilities, provider drift,
and stale claim, lease, PR, tree, ref, session, or scope identities fail closed.

## Authorized Effects

The only effects are:

1. retire or exactly adopt retirement of the original integrated cloud claim;
2. begin or exactly adopt local completion for the same preserved delivery lane;
3. detach the registered worktree from the reviewed branch to one captured clean
   protected-main revision; and
4. return a `completion-ready` receipt whose sole continuation is ordinary
   repository-owned `device:integrate`.

The authored branch and reviewed tree remain exact. The controller does not
author or stage source and does not write authored refs, pull requests,
auto-merge state, remote refs, new claims, runtime, cleanup, release, or
deployment. The index and worktree change only through the sealed detach to the
captured canonical main. It neither runs probes nor grants Production authority.

## Protected-Main Advance and Response Loss

The plan seals protected anchor `M`. Before cloud retirement, every effect still
requires exact `M`. Once the exact retirement is durably proven, completion may
capture one clean remote-exact protected descendant `N`, provided `M <= N`, the
recovery merge is an ancestor of `N`, and the exact evidence blob remains at its
path. The completion intent seals task authorization before the effect;
`completion-projected` then persists captured `M`, `N`, and their topology
digest after projection or exact response-loss adoption.

A crash after cloud retirement may therefore resume at a later protected `N`
without minting a replacement claim or plan. A crash after the lease enters
`completing` may resume from either the exact attached reviewed head and tree or
the exact detached `N` projection. Every other worktree state is rejected.

If later ordinary `device:integrate` completes and cleans the lane at `R`, replay
requires `N <= R <= C`, where `C` is the current clean local/origin/remote
protected main, and re-proves the recovery blob, authored ref and tree, terminal
cloud lineage, PR identity, and absence of stale worktree registrations. The
public recovery receipt remains derived from sealed `N`; later main movement,
cleanup timing, projected-versus-adopted disposition, and task-proof timestamps
cannot change its digest.

Terminal verification and the public receipt are persisted in one journal
compare-and-swap. A legacy `verified` phase is reverified before completion.
Every pending effect reauthorizes the external task capability immediately
before execution; response-loss adoption still verifies the typed final state.
Immediately before the irreversible cloud call, two stable reads under the
live lane fence must re-prove the complete subject, authored ref and tree,
clean registered worktree, provider PR, newest checks, recovery commit, terminal
task/claim projection, and preservation contract. Only observation time,
evidence digest, and an independently proven protected-main descendant may vary;
such a descendant is accepted before replay only when exact subject retirement
is already observable as the response-loss result.

## Private Files and Commands

The journal, task capability, and authorization file must be external to the
canonical repository, subject worktree, controller checkout, and Git common
directory. They must resolve through nonsymlink physical ancestors. Capability
and authorization files are owner-held, single-link, mode-0600 regular files;
the authorization file contains exactly one generated line.

Plan read-only evidence first:

```sh
node scripts/canonical-squash-attribution-recovery-terminalization.mjs plan \
  --repository=/absolute/path/to/canonical-target \
  --subject-worktree=/absolute/path/to/preserved-original-worktree \
  --target-repository=owner/repository \
  --subject-pull-request=893 \
  --recovery-pull-request=894 \
  --recovery-evidence-path=docs/exact-recovery.md \
  --recovery-cleanup-receipt-digest=<64-hex-digest> \
  --controller-root=/absolute/path/to/protected-controller \
  --state-path=/external/private/recovery-state.json \
  --task-authority=/external/private/task-authority.json \
  --json
```

Persist the emitted exact line
`authorize canonical-squash-attribution-recovery <planDigest>` in a private
authorization file. Run the identical subject with `--plan-digest` and
`--auth-file`. A complete replay may use the same absent subject-worktree path
after cleanup; the CLI accepts only an absolute normalized path whose existing
physical ancestors are nonsymlinks, while the adapter requires live presence
before any effect.

## Proof Boundary

Focused proof is:

```sh
node --test __tests__/canonical-squash-attribution-recovery-terminalization.test.mjs
```

Repository review and protected integration remain mandatory for this
controller. A successful `completion-ready` receipt is not cleanup: run the
receipt's unchanged-session `device:integrate` continuation and require its
ordinary runtime-ready cleanup receipt before releasing the original lane.
