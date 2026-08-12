---
title: "Coordination Claim Child Authority"
graphId: "md:agentic-coordination-claim-child-authority"
doc_type: "Runtime Contract"
date: "2026-08-13"
lang: "en-US"
schema: "agentic-coordination-claim-child-authority-contract/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "least-authority child-process boundary for repository coordination claims"
runtime_scope: "device lifecycle child environments and coordination-claim pre-commit proof"
runtime_claim: "prevents capability-scrubbing self-deadlock without granting ambient child authority"
runtime_owner: "../scripts/device-child-process-policy.mjs; ../scripts/device-branch.mjs"
runtime_proof: "../__tests__/device-child-process-policy.test.mjs"
publish_policy: "Dev-only control-plane repair; protected release and exact-candidate Production authorization remain required"
---
<!-- Responsibility: Define the one child-process exception needed to fence a task-bound lane. -->

# Coordination Claim Child Authority v1

## Purpose

The device lifecycle treats a private task-authority file as controller input,
not ambient process authority. Generic children must never inherit its locator.
The lifecycle also creates an empty coordination-claim commit before recording
the lane fence. The repository's pre-commit guard verifies task authority for
that exact mutation. Scrubbing the locator from that commit prevents the guard
from proving possession and leaves a planned lane unable to fence itself.

This contract resolves that circular dependency with one narrow,
provider-neutral child-process policy. It does not depend on a particular
model, agent product, hosting provider, operating system identity, or chat
session implementation.

## Default-deny policy

`scripts/device-child-process-policy.mjs` owns all child adapters used by the
device entrypoint:

- Git reads and optional probes;
- provider command reads and optional probes;
- generic mutating commands;
- text-returning commands, including validation and release helpers.

Every adapter clones its input environment and removes
`AGENTIC_TASK_AUTHORITY_FILE`. A caller-supplied environment cannot reintroduce
the locator. The caller's environment is never mutated.

Generic command adapters never infer authority from executable names or
argument shapes, even when an argument list resembles a coordination claim.
Only the typed `commitCoordinationClaim` operation can expose the exact external
locator, and it constructs the Git arguments internally after validating:

1. a non-empty absolute external capability locator;
2. a canonical lowercase ASCII scope of at most 48 characters;
3. a positive safe-integer lease epoch;
4. a strict boolean owned-dirt preservation choice; and
5. the resulting subject is exactly
   `chore(coordination): claim <normalized-scope> lease <positive-epoch>`.

The start/resume adapter additionally joins that scope and epoch to the exact
active local lease, session, branch, worktree, unset fence, and owned-dirt
mode. A canonical-looking subject that does not match that live lease stays on
the generic scrubbed path. For an ordinary claim, a scrubbed Git probe must
also prove that the staged index is empty before the privileged commit starts.
Both claim modes use Git's exact `--only` form, so a concurrent staged-index
change cannot enter the coordination commit; owned-dirt recovery relies on the
same isolation while preserving its worktree bytes.

Additional options, alternate executable paths, reordered arguments, invalid
scope characters, non-positive epochs, suffixes, and whitespace changes remain
unprivileged. In a real repository, the unchanged pre-commit guard then rejects
an unauthorized or malformed commit.

The locator identifies the capability file; it is not the private capability
content. Git passes it only through the exact claim subprocess so the existing
guard can perform proof-of-possession. The writer lease remains the source of
the expected subject, binding, scope, epoch, base, and cloud join.

## Lifecycle coverage

`scripts/device-branch.mjs` gives only start, resume, and interrupted-resume
replay a narrow adapter that translates their already-canonical generated claim
arguments into the typed operation after matching the live lease. All other
calls through that adapter, and every other lifecycle operation, use the
generic scrubbed runner. This avoids duplicating child-environment logic inside
lifecycle-specific modules.

This division follows single responsibility:

- `device-command-input.mjs` parses command input;
- `device-child-process-policy.mjs` owns child authority;
- lifecycle modules own state transitions; and
- the pre-commit guard owns mutation proof.

## Recovery from the former self-deadlock

When a repository-owned start or resume stopped at its coordination commit
because the guard could not locate the capability:

1. preserve the worktree, branch, lease, cloud claim, and capability unchanged;
2. integrate this policy through protected review;
3. re-run the same repository lifecycle controller with the same session,
   external capability, declared scope, and current authority evidence; and
4. accept continuation only if the controller reconciles the recorded planned
   state and emits its typed mutation-authority receipt.

Do not run a raw commit, disable hooks, use `--no-verify`, copy the capability
into the repository, edit the writer registry, mint a replacement task subject,
or infer ownership from Git author data. Drift still fails closed and requires
the repository's explicit recovery or handoff controller.

## Release and deployment boundary

This repair restores the local lifecycle's ability to acquire its exact fence.
It grants no review, merge, protected-branch, release-candidate, Production, or
Cloudflare authority. After the repair is protected, the release owner must:

1. finish the ordinary reviewed-lane integration and cleanup;
2. regenerate evidence on the then-current protected revisions;
3. seal a fresh exact release candidate;
4. obtain the candidate's exact human authorization through the protected
   Production environment; and
5. use only the repository-owned release controller to deploy and verify the
   resulting runtime receipts.

An earlier candidate or authorization is stale after protected-head drift.
Direct provider deployment, historical workflow replay, and local success are
not substitutes for that joined evidence.

## Focused proof

`__tests__/device-child-process-policy.test.mjs` proves that generic Git,
provider, text, and validation children cannot observe the locator, including
exact-looking claim arguments; both typed claim variants can; malformed typed
inputs fail before spawn; staged ordinary commits fail before privilege; live
lease scope/epoch mismatches stay scrubbed; no privileged form disables hooks;
and the caller environment remains unchanged. The existing lifecycle and hook
tests continue to prove the state transition and proof-of-possession behavior.
