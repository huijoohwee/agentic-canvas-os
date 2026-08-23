---
title: "Atomic Lane Convergence Transaction"
graphId: "md:atomic-lane-convergence-transaction"
doc_type: "Runtime Controller Contract"
date: "2026-08-23"
lang: "en-US"
schema: "agentic-lane-convergence-controller/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "provider-neutral multi-lane convergence orchestration"
publish_policy: "Dev-only; no Production or Cloudflare authority"
runtime_scope: "stable planning, bounded internal grants, durable checkpoints, and terminal receipts"
runtime_claim: "one exact plan and authorization can govern a bounded convergence transaction without observation-driven authorization churn"
runtime_proof: "__tests__/lane-convergence-transaction.test.mjs"
contradiction_policy: "effect escalation, plan drift, adapter drift, unbounded transitions, incomplete terminal evidence, or a different authorization fails closed"
---
# Atomic Lane Convergence Transaction

## Outcome

`scripts/lane-convergence-transaction.mjs` is the runtime owner for the Atomic Lane
Convergence Rule in `RELEASE-WORKFLOW.md`. It replaces a conversational chain of
point-recovery plans with one stable transaction plan, one exact authorization,
bounded adapter actions, durable checkpoints, and one terminal receipt.

The controller is universal and provider-neutral. Repository, provider, cloud,
local projection, integration, deployment, and cleanup behavior remains in an
external adapter whose exact module bytes and configuration bytes are bound into
the plan. The controller grants only the selected subject, action, operation key,
and declared effects for one transition. An adapter may compose existing
repository-owned point controllers under that internal grant; it may not widen
the plan or treat an observation as new human intent.

## Stable Plan Boundary

The plan binds:

- one transaction id and objective;
- every lane subject, repository, target state, and dependency;
- the allowed actions and maximum effects for each subject;
- the adapter identity, version, action effects, module digest, and configuration digest;
- a bounded maximum transition count; and
- the receipt types required at terminal completion.

Timestamps, lease expiry, provider status, current protected head, and other live
observations are adapter inputs. They never change the plan digest. If those facts
invalidate a precondition, the adapter returns a typed blocked result or chooses
another already-authorized action; it does not create a successor plan.

## Execution Contract

Planning is read-only:

```sh
node scripts/lane-convergence-transaction.mjs plan \
  --request=/absolute/request.json \
  --adapter=/absolute/adapter.mjs \
  --configuration=/absolute/configuration.json \
  --json
```

Execution requires the emitted exact authorization and an external private state
path:

```sh
node scripts/lane-convergence-transaction.mjs run \
  --plan=/absolute/plan.json \
  --adapter=/absolute/adapter.mjs \
  --configuration=/absolute/configuration.json \
  --state=/absolute/state.json \
  --authorize="authorize lane-convergence-transaction <plan-digest>" \
  --json
```

Before every effect the controller persists an `attempted` transition. After a
lost response, replay classifies that same operation key and adopts proven
completion or replays only the same idempotent action. Completed transitions and
the original authorization receipt remain immutable. Terminal replay performs no
adapter effects.

## Authority And Safety Boundary

The top-level authorization is reusable only inside its exact plan. Internal
grants are content-bound descendants, not new human authorizations. A grant has no
effect unless the external adapter and the invoked repository controller both
accept their own exact subject evidence.

Source integration does not imply runtime readiness. Runtime readiness does not
imply cleanup. None of these imply Production or Cloudflare deployment authority.
The terminal receipt must contain every receipt type declared by the plan and the
exact target state for every subject.

## VCC

Run:

```sh
node --test __tests__/lane-convergence-transaction.test.mjs
```

The focused proof covers one-authorization recovery/integration/cleanup,
post-effect response loss, checkpoint resume, exact authorization, effect ceiling
enforcement, stable plan digests, and zero-effect terminal replay.
