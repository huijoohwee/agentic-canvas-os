---
title: "Knowgrph Two-Lane Convergence Adapter"
graphId: "md:knowgrph-two-lane-convergence-adapter"
doc_type: "Runtime Adapter Contract"
date: "2026-08-24"
lang: "en-US"
schema: "agentic-knowgrph-lane-convergence-adapter/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "Knowgrph reference adapter for the atomic lane-convergence controller"
publish_policy: "Dev-only; no Production, Cloudflare, or mirror authority"
runtime_scope: "PR 827 and PR 828 authority reconciliation, protected integration, and exact worktree cleanup"
runtime_claim: "bounded subject adapter; configuration and controller authorization are required before effects"
runtime_owner: "../scripts/knowgrph-lane-convergence-adapter.mjs; ../scripts/knowgrph-lane-convergence-adapter-contract.mjs"
runtime_proof: "../__tests__/knowgrph-lane-convergence-adapter.test.mjs"
---
# Knowgrph Two-Lane Convergence Adapter

## Outcome

This module is the concrete subject-and-effect adapter required by the atomic
lane-convergence controller for these exact Knowgrph scopes:

- `knowgrph-native-marketplace-layer` at PR 827; and
- `gemini-api-mainpanel-integration` at PR 828.

It supplies the complete `observe`, `next`, `classify`, `execute`,
`verifyTransition`, and `verifyTerminal` surface. The generic controller binds
the adapter module and external configuration bytes into its plan before any
effect.

## Registered Actions

| Action | Repository owner | Maximum effects |
|---|---|---|
| `reconcile-authority` | Existing active-owned-dirt recovery controller | Cloud and local authority projections only |
| `integrate-source` | Existing `device:integrate` protected adapter | Authority continuation, explicit source commit when configured, provider review, protected integration, and Git projections |
| `cleanup-worktree` | Existing lifecycle cleaner | Exact completion-proven worktree removal only |

The adapter has no deployment effect. Source integration, cleanup, Production
authorization, Cloudflare deployment, state reconciliation, public verification,
and mirror publication remain separate receipt boundaries.

## Safety Boundary

The external configuration names the canonical Knowgrph checkout, both exact
worktrees, sessions, pull requests, owner-only task capabilities, and the
Marketplace change manifest. Configuration accepts no arbitrary executable.
The adapter invokes only repository-owned ACOS entry points.

Observation joins the worktree lifecycle report, protected `origin/main`, and
the exact pull-request merge record. A transition is complete only when:

- authority recovery has current local and cloud authority;
- integration has a merged review whose merge commit is contained by fetched
  protected main; or
- cleanup proves the exact worktree registration and path are absent.

A closed unmerged review, an uncontained merge, an unregistered existing path,
configuration drift, missing capability, or failed repository controller stops
without selecting another recovery controller or widening the plan.

## Response-Loss Rule

Before execution, the top-level controller persists the transition. If a point
controller commits its effect but its response is lost, `classify` rereads Git,
provider, and lifecycle state. It adopts only the exact completed transition;
otherwise the same operation remains pending under the original plan and grant.

## VCC

Run:

```sh
node --test __tests__/knowgrph-lane-convergence-adapter.test.mjs
```

The focused evaluator proves the fixed two-subject registry, bounded effect
surface, dependency order, recovery and integration response-loss adoption,
exact cleanup, terminal receipt emission, and fail-closed closed-review handling.
