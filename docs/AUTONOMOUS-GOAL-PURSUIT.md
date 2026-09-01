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

## Deadlock Avoidance

A retry loop and a repair chain are different failures with the same symptom: forward motion that never terminates. Both are avoided by locating the defect at its owner instead of at the surface that reported it.

| Rule | Requirement |
|---|---|
| Classify before retrying | A rejection is either *contended* or *deterministic*. Contended means an authoritative value moved between read and write; re-read and retry within the bound. Deterministic means the request violated a contract; the identical request can never succeed, so retrying it is a defect. A message naming a required value, an exact expected value, or a rejected field is deterministic. |
| Read the contract, do not probe it | Once a rejection is deterministic, read the validating source and take the complete field, value, and ordering requirement in one pass. Discovering a contract one rejection at a time is `incomplete-input-report` on the caller's side and is forbidden past the first occurrence. |
| Repair at the owner, never the projection | When a value is wrong, correct it where it is authored. A local cache, lease record, marker, body, or report is a projection: patching one satisfies its own gate and invalidates every later gate derived from the same stale source. |
| Cascade means upstream | Treat three or more gates failing in sequence, where each failure is caused by the previous fix, as proof that the defect is upstream of all of them. Stop patching, identify the earliest wrong value, and re-derive the whole chain from its owner. |
| Bound the whole goal | Attempt budgets are per goal, not per command. Reaching the budget across all commands and variants stops the goal and escalates; a new command name does not reset it. |
| Cap shared-state repair | A repair that mutates shared state gets one attempt. If its own result needs repair, stop: preserve state, report the exact residue, and escalate. Chained repair against shared state converts one inconsistency into several. |
| Leave no residue | Every shared-state attempt names in advance how it is undone. An attempt that cannot state its own reversal is not attempted. |
| Escalate a decision, not a status | Terminating reports the earliest wrong value, its owning source, the exact residue left behind, and the specific decision required. A status dump is not an escalation. |

## What This Never Permits

| Forbidden | Reason |
|---|---|
| Inferring an operator decision from silence, elapsed time, or convenience | An absent decision is a blocked state, never an assumed yes. |
| Fabricating a derivable value that cannot be derived | An unavailable identity fails closed; a guessed identity is worse than a stall. |
| Copying another lane's public projection to satisfy a binding | A copied projection is not a successor claim and impersonates its owner. |
| Widening declared write scope, capability, or authority to continue | Scope expansion is an admitted transition, not a workaround. |
| Treating a passing local check as protected, runtime, or deployed proof | Layer claims stay separate and evidence-derived. |
| Retrying past a declared bound, or raising a bound to rescue an attempt | A bound raised under pressure no longer bounds. |
| Retrying a deterministic rejection unchanged | The contract already refused this exact request; only the request or the source can change. |
| Patching a projection so its own gate passes | It masks the upstream defect and invalidates every later gate derived from the same stale source. |
| Chaining a second shared-state repair onto a failed first | It multiplies inconsistency instead of preserving one recoverable state. |

## Session-Start Application

Preflight resolves and reports, in one pass: fetched canonical revision, canonical cleanliness, registered worktrees, live overlapping claims for the declared scope, the declared write-scope manifest, task-authority availability, and every identity the lifecycle derives rather than accepts. A missing input is named with the exact command that supplies it.

Device and session identity are derived, never requested: the device projection comes from the registered lease or the `agent/<device>/<scope>` branch, normalized through the shared cloud identifier normalizer, and a session identifier already in normalized form passes through unchanged. Read the ledger digest and canonical frontier immediately before the claim transition, because both move under a concurrent writer.

## Release Application

Validate every delivery constraint that is locally knowable before the first publish attempt, not at the remote boundary: commit subject bounds, review-request template conformance, declared scope token equality, and changed-path containment within the admitted write scope.

Autonomous continuation carries the receipt chain forward without restating machine tokens. The exact-candidate human authorization, and every irreversible or credential-bearing effect, remain operator decisions and are unaffected by anything in this document.

## VCC

Given one goal, its declared inputs, and its recorded prior attempts, when the harness pursues completion, then every required input is reported once and completely; every machine-derivable operand is derived from authoritative local state; every locally knowable constraint fails locally; volatile identity is bound immediately before its transition; environment-only remediation precedes any failing verdict; every blocked attempt is recorded as a consumable outcome; each actual operator prompt maps to exactly one unresolved semantic decision; and no ownership, fence, approval, scope, or deploy gate is relaxed, inferred, or bypassed.

Given a rejected operation, when the harness responds, then the rejection is classified contended or deterministic; a deterministic rejection is never retried unchanged and its validating source is read once for the complete requirement; every correction is applied at the owning source rather than a projection; a cascade of three gates each broken by the previous fix terminates patching and re-derives from the earliest wrong value; the goal-wide attempt budget bounds every command and variant together; shared-state repair is capped at one attempt whose reversal was stated in advance; and termination reports the earliest wrong value, its owner, the exact residue, and the one decision required.
