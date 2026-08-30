---
title: "Autonomous Goal Pursuit"
graphId: "md:agentic-os-autonomous-goal-pursuit"
doc_type: "Runtime Contract"
date: "2026-08-30"
lang: "en-US"
schema: "agentic-os-autonomous-goal-pursuit/v1"
frontmatter_contract: "required"
status: "runtime-ready"
owner: "docs harness layer"
delivered_rung: "undocumented"
runtime_readiness_policy: "fail-closed"
runtime_scope: "operator-interaction economy for session start, lane lifecycle, and release"
runtime_claim: "removes interaction round trips that carry no decision; grants no ownership, fence, approval, or deploy authority"
runtime_proof: "RUNTIME-PROOF.md"
publish_policy: "Dev-only; no protected integration, Production, publication, or deployment authority"
invocation:
  action: "/goal.advance"
  semantics: ["#goal-completion"]
  bindings: ["@goal-plan"]
source_docs:
  - "START-WORKFLOW.md"
  - "RELEASE-WORKFLOW.md"
  - "GOAL-COMPLETION-RUNTIME.md"
  - "PROJECT-RULES.md"
---
<!-- Responsibility: Remove operator round trips that carry no decision, without relaxing any gate. -->

# Autonomous Goal Pursuit

The operator owns decisions. The run owns transport, derivation, and retry. Every round trip that carries no decision is pure cost: it spends wall-clock, invalidates volatile bindings such as a lease or ledger digest, and converts a solvable mechanical gap into a stall.

This document removes those round trips. It relaxes nothing. Scope, irreversibility, credentials, authority, ownership, fencing, approval, and deploy gates remain exactly where `START-WORKFLOW.md`, `RELEASE-WORKFLOW.md`, `CANONICAL-LIFECYCLE.md`, and `PROJECT-RULES.md` put them.

## Contract

| Rule | Requirement |
|---|---|
| One-shot completeness | Before the first attempt, report every missing, malformed, or unresolvable required input in one verdict. Surfacing one missing operand per failed attempt is a defect; N sequential refusals spend N round trips delivering what was knowable at the first. |
| Derive, do not ask | Derive every machine-derivable operand from authoritative local state: an identity from its recorded lease or branch projection through the declared normalizer, a digest from the artifact, a revision from the fetched ref. A normalizer present in the source but left unapplied is the same defect as having none. |
| Earliest-point validation | Validate each constraint where it first becomes knowable so a local rule fails locally. Message shape, size and line budgets, template conformance, and scope tokens are all checkable before publication. |
| Late binding | Bind volatile identity immediately before the transition that consumes it, never at plan time. On a compare-and-swap loss, re-read and re-derive within the declared retry bound. |
| Environment before verdict | Attempt the declared environment-only bootstrap once, bounded, before emitting any failing verdict. An absent dependency or uninitialised workspace is transport, and reporting its symptom as a product regression also poisons the outcome record. |
| Record to improve | Record every blocked attempt with its typed reason as an outcome the next selection consumes, so repeated mechanical failure changes ordering instead of repeating. |
| Decision-only escalation | Escalate only an unresolved semantic decision: scope change, irreversibility, credential or authority grant, contradiction, or budget re-authorisation. Transport, identity derivation, field discovery, idempotent retry, and mechanical remediation are never escalations. |
| Stop on repetition | After the same approach fails twice, diagnose the root cause and change approach. A third variation of the same attempt is a loop, not persistence. |

## What This Never Permits

| Forbidden | Reason |
|---|---|
| Inferring an operator decision from silence, elapsed time, or convenience | An absent decision is a blocked state, never an assumed yes. |
| Fabricating a derivable value that cannot be derived | An unavailable identity fails closed; a guessed identity is worse than a stall. |
| Copying another lane's public projection to satisfy a binding | A copied projection is not a successor claim and impersonates its owner. |
| Widening declared write scope, capability, or authority to continue | Scope expansion is an admitted transition, not a workaround. |
| Treating a passing local check as protected, runtime, or deployed proof | Layer claims stay separate and evidence-derived. |
| Retrying past a declared bound, or raising a bound to rescue an attempt | A bound raised under pressure no longer bounds. |

## Session-Start Application

Preflight resolves and reports, in one pass: fetched canonical revision, canonical cleanliness, registered worktrees, live overlapping claims for the declared scope, the declared write-scope manifest, task-authority availability, and every identity the lifecycle derives rather than accepts. A missing input is named with the exact command that supplies it.

Device and session identity are derived, never requested: the device projection comes from the registered lease or the `agent/<device>/<scope>` branch, normalized through the shared cloud identifier normalizer, and a session identifier already in normalized form passes through unchanged. Read the ledger digest and canonical frontier immediately before the claim transition, because both move under a concurrent writer.

## Release Application

Validate every delivery constraint that is locally knowable before the first publish attempt, not at the remote boundary: commit subject bounds, review-request template conformance, declared scope token equality, and changed-path containment within the admitted write scope.

Autonomous continuation carries the receipt chain forward without restating machine tokens. The exact-candidate human authorization, and every irreversible or credential-bearing effect, remain operator decisions and are unaffected by anything in this document.

## VCC

Given one goal, its declared inputs, and its recorded prior attempts, when the harness pursues completion, then every required input is reported once and completely; every machine-derivable operand is derived from authoritative local state; every locally knowable constraint fails locally; volatile identity is bound immediately before its transition; environment-only remediation precedes any failing verdict; every blocked attempt is recorded as a consumable outcome; each actual operator prompt maps to exactly one unresolved semantic decision; and no ownership, fence, approval, scope, or deploy gate is relaxed, inferred, or bypassed.
