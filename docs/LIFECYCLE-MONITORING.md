---
title: "Lifecycle Monitoring"
graphId: "md:lifecycle-monitoring"
doc_type: "Runtime Contract"
date: "2026-08-12"
lang: "en-US"
schema: "agentic-lifecycle-monitor-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "provider-neutral adaptive observation monitoring"
runtime_scope: "read-only lifecycle convergence observation"
runtime_claim: "bounded deterministic monitoring can wake an independent controller from exact target evidence without using fixed expiry or granting mutation authority"
runtime_proof: "__tests__/lifecycle-monitor-contract.test.mjs; __tests__/lifecycle-monitor-controller.test.mjs; __tests__/lifecycle-monitor-cli.test.mjs"
publish_policy: "protected green main authorizes Dev integration only; Production requires exact-candidate human authorization"
source_docs:
  - "ADAPTIVE-CLAIM-RECOVERY.md"
  - "CANONICAL-LIFECYCLE.md"
  - "HARNESS-CONTRACTS.md"
---

# Lifecycle Monitoring

## Purpose

The lifecycle monitor observes an opaque subject until exact source evidence
matches a requested target. It replaces fixed-expiry waiting with adaptive,
condition-driven observation while preserving bounded cost and fail-closed
authority.

The runtime is universal across repositories, agents, models, source-control
hosts, schedulers, transports, and deployment providers. Adapters normalize
their evidence into one versioned observation. The core has no collaboration
subsystem, provider SDK, remote session, tool, model, credential, repository,
or deployment dependency.

## Ownership

| Owner | Single responsibility |
|---|---|
| `scripts/lifecycle-monitor-contract.mjs` | Normalize requests, observations, and checkpoints; evaluate target evidence; derive deterministic schedules and content-bound resume signals. |
| `scripts/lifecycle-monitor-controller.mjs` | Perform one sequential observation at a time, honor cancellation and budgets, and stop on a typed terminal checkpoint. |
| `scripts/lifecycle-monitor-json-adapter.mjs` | Read bounded regular-file JSON artifacts and project them into the neutral contract. |
| `scripts/lifecycle-monitor.mjs` | Bind the JSON adapter to the controller as a local CLI without source or authority mutation. |

Provider-specific observation producers belong in replaceable adapters. They
must not be imported into the contract or controller.

## Heartbeat Boundary

An observed heartbeat is evidence that the subject advanced. It is not a
writer-lease heartbeat and never renews, continues, claims, releases, or
reassigns authority. The monitor does not call collaboration, source-control,
review, integration, publication, deployment, or cleanup operations.

These events never satisfy a target by themselves:

- silence or a missed observation;
- elapsed time or budget exhaustion;
- an expiry timestamp;
- a successful read or process exit;
- an adapter retry or rate-limit interval;
- a final model answer or tool response.

Every checkpoint, result, and resume signal carries
`mutationAuthority: false`. A resume signal means only: wake the independently
authorized owner and revalidate canonical state. Its subject, identity, target,
minimum generation, minimum heartbeat sequence, observation, and issue instant
are rebound to the request and terminal checkpoint during every normalization.

## Request Contract

`agentic-lifecycle-monitor-request/v1` binds:

- an opaque subject identifier and immutable identity digest;
- one exact target state plus minimum monotonic generation and heartbeat sequence;
- minimum and maximum observation delay, backoff multiplier, deterministic
  jitter, unchanged-evidence growth threshold, and clock-skew bound;
- maximum attempts, elapsed observation time, and adapter read units.

The elapsed bound is a TCO stop budget, not an expiry or completion predicate.
Stopping emits no resume signal.

## Observation Contract

`agentic-lifecycle-monitor-observation/v1` carries:

- a derived content-addressed observation identifier and timestamp;
- exact subject and identity bindings;
- an opaque source revision;
- monotonic generation and heartbeat sequence;
- current state and read-unit cost;
- an optional retry delay and typed `transient`, `rate-limited`, `permanent`,
  or `integrity` error.

Adapters classify evidence but cannot declare readiness. Readiness requires the
contract to observe all of the following:

```text
subject identity matches
AND observation has no error
AND observed state equals target state
AND observed generation is at least the target minimum
AND observed heartbeat sequence is at least the request-bound baseline
```

Set the minimum heartbeat sequence to the next source-owned sequence when the
monitor must prove a heartbeat after request creation. This monotonic baseline
rejects old target snapshots without introducing a wall-clock freshness expiry.

Identity drift, reused observation IDs with changed content, clock regression,
generation regression, heartbeat regression, permanent errors, and integrity
errors block without retry.

## Adaptive Schedule

Progress resets the delay to the request minimum. Unchanged or transient
evidence increases a bounded exponential delay after the declared threshold.
Rate-limit advice may extend that delay within the declared maximum. Jitter is
derived from the monitor, attempt, and observation digests; it never uses
process randomness.

The next evaluation is derived from current evidence and policy. No
`expiresAt` field exists in the request, observation, checkpoint, or resume
signal. Restarting from a validated checkpoint preserves attempts, cost,
backoff, and replay identity. An exact same-instant evaluation is idempotent;
each later poll of unchanged evidence consumes its declared read/attempt budget
and receives a new adaptive schedule, preventing zero-delay loops.

## JSON Runtime

The local adapter rereads one bounded JSON observation file on each scheduled
evaluation. A producer may replace that file atomically with fresher normalized
evidence. Symlinks, non-files, oversized input, malformed JSON, and unknown
contract fields fail closed.

```bash
node scripts/lifecycle-monitor.mjs \
  --request=/absolute/path/to/request.json \
  --observation=/absolute/path/to/observation.json
```

Use `--checkpoint=/absolute/path/to/checkpoint.json` to resume from a validated
nonterminal checkpoint emitted by the contract or controller library. The CLI
itself writes only its terminal result to standard output.

## Cost And Completion

The runtime performs zero model calls and consumes zero model tokens. TCO is
bounded by explicit attempt, elapsed-time, and adapter read-unit stop budgets
plus the caller's observation producer. The controller passes a remaining-time
abort signal to every read; live adapters must honor cancellation and declare
read units conservatively. Only `ready` includes a resume signal;
`blocked` and `stopped` are terminal, non-authoritative outcomes.

Production completion still requires the canonical joined release receipt
chain. Lifecycle monitoring neither shortens nor replaces human authorization,
integration, deployment, reconciliation, live verification, publication, or
cleanup requirements.
