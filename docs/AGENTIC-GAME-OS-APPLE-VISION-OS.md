---
title: "Agentic Game OS Apple visionOS Control Contract"
graphId: "md:agentic-game-os-apple-vision-os"
doc_type: "Runtime Control Contract"
date: "2026-08-09"
lang: "en-US"
schema: "agentic-game-os-apple-vision-os-control/v1"
frontmatter_contract: "required"
status: "spec-complete"
authority: "Agentic Canvas OS invocation, source-hygiene, and pipeline gates for the cross-repository Agentic Game OS feature"
runtime_scope: "provider-neutral invocation resolution, model-free audits, and receipt-oriented Dev-to-delivery sequencing"
runtime_claim: "source contract and focused local proof only; shared gameplay, Apple adapters, physical-device proof, protected integration, Production, and Cloudflare remain separately gated"
publish_policy: "protected green main authorizes Dev integration only; an exact-candidate human authorization is required independently for each Production stage"
source_spec: "$GITHUB_ROOT/.kiro/specs/agentic-game-os-apple-vision-os"
---
<!-- Responsibility: Specify the Agentic Game OS Apple visionOS portability contract and its evidence gates. -->

# Agentic Game OS Apple visionOS Control Contract

## Outcome

This document defines the Agentic Canvas OS part of the cross-repository
Agentic Game OS Apple portability feature. It establishes one canonical
invocation tuple, four read-only source auditors, and one fail-closed pipeline
controller. It does not move shared capability logic, game state, rendering,
persistence, Apple platform adapters, deployment, or credentials into this
repository.

The control surface is intentionally small:

1. resolve one source-backed invocation tuple;
2. reject duplicate, non-portable, oversized, or responsibility-ambiguous
   authored sources;
3. admit clean canonical Dev evidence;
4. require an independent one-use authorization for the mirror and delivery
   stages;
5. preserve one immutable audit entry for each stage outcome.

The feature is not `production-runtime-ready` merely because these source
contracts pass. Production readiness requires all cross-repository owners,
protected exact-head checks, native and browser proof, physical-device gates,
mirror equality, public-route equality, and the repository-owned release
lifecycle for one exact candidate.

## Ownership boundary

| Concern | Sole owner | This repository's role |
|---|---|---|
| Invocation truth | Agentic Canvas OS dictionaries | Define and resolve the tuple without aliases or mirrors. |
| Shared gameplay and backend behavior | Knowgrph shared substrate | Name the boundary; never duplicate its capability or utility logic. |
| Browser and native presentation | GameXR | Name the boundary; never own visuals, input presentation, scene values, or local adapters. |
| Dev-to-delivery control | Agentic Canvas OS product pipeline plus pinned ADLC repository workflow | Validate product ordering, identity, and authorization; delegate repository effects only to ADLC. |
| Production artifacts and public routes | Knowgrph product-deployment owner | Consume exact-candidate authorization and return product evidence; this document grants no authority. |

The Prod mirror boundaries are `$GITHUB_ROOT/huijoohwee/content/knowgrph` and
`$GITHUB_ROOT/huijoohwee/content/gamexr`. The Delivery surface boundaries are `airvio.co`,
`airvio.co/knowgrph`, and `airvio.co/gamexr`. These paths and routes hold no
world data; persistent world state remains source-owned by the shared Knowgrph
substrate.

GameXR may host Flight Simulator, City Building Sim, RTS-MMO, and future games.
Those games share Knowgrph domain owners and may differ only in visual
projection, interaction presentation, scene configuration, and local
persistence adapters. A new game does not create a new shared capability
registry or backend utility owner.

## Canonical invocation register

The only feature tuple is:

`/game.portability #game-portability @portability-layer`

| Token | Prefix role | Source |
|---|---|---|
| `/game.portability` | command route | `agentic-canvas-os/docs/DICTIONARY-COMMAND.md` |
| `#game-portability` | semantic filter or topic route | `agentic-canvas-os/docs/DICTIONARY-SEMANTIC.md` |
| `@portability-layer` | source, actor, or runtime binding | `agentic-canvas-os/docs/DICTIONARY-BINDING.md` |

The tuple selects the source-backed, capability-detected Agentic Game OS
portability contract across browser and native projections. Knowgrph remains
the shared capability and backend owner. GameXR remains visual projection,
interaction, scene, and local-adapter only. The tuple itself grants no
renderer, persistence, provider, model, credential, Production, Cloudflare, or
deployment authority.

Resolution is model-free and read-only. A `/`, `#`, or `@` prefix selects
exactly one dictionary. Malformed input reads no dictionary. An absent,
unreadable, or multiply declared token returns a typed failure with zero
substitution and zero nearest-match behavior. The associated cost record is
therefore `modelIdentity: null`, zero prompt tokens, zero completion tokens,
and zero estimated cost.

## Pipeline contract

The pipeline controller is candidate-scoped. One candidate contains an exact
40-character source revision, one SHA-256 artifact digest, and a dependency pin
status of `matched` or `pin-mismatched`.

| Stage | Admission | Success evidence | Failure boundary |
|---|---|---|---|
| `dev-runtime` | Repository-owned Git inspection proves the exact Knowgrph root and origin, branch `main`, `HEAD == origin/main`, zero tracked modifications, zero untracked files, and one declared Dev command | Reachable local surface within 120 seconds; status becomes `local-runtime-ready` | Caller-supplied cleanliness is ignored; no process starts for non-canonical, stale, or dirty evidence. |
| `prod-mirror` | Successful Dev for the same candidate, matched dependency pins, and one unconsumed authorization no older than 60 minutes | Exact candidate revision and digest are recorded before the delegated write, then independently read back before completion | Missing, mismatched, expired, consumed, errored, or timed-out authorization causes zero mirror mutation and zero retries. |
| `delivery-surface` | Successful mirror outcome, an independently inspected byte-identical artifact digest, and a separate unconsumed authorization | Status becomes `production-runtime-ready` only after a second independent live read proves the exact revision, digest, and reachability | Absent or unequal preflight digest fails before delivery mutation; unequal post-delivery identity withholds readiness. |

`local-runtime-ready` never implies `runtime-ready` or
`production-runtime-ready`. The controller does not build artifacts and does
not implement a second deployment path. Its adapters must delegate to the
existing source, mirror, delivery, authorization, and release owners.

Each immutable audit entry carries:

- the stage;
- the exact source revision;
- the exact artifact digest;
- the authorization identifier actually consumed, or `null` when none was
  consumed; and
- `completed` or `rejected` outcome.

An authorization lookup is attempted once and bounded at ten seconds. A valid
authorization is consumed before a gated adapter is called. Replaying a
completed stage is idempotent; it neither calls the adapter nor appends a
second outcome. One controller-wide operation fence serializes Dev, mirror, and
delivery calls before authorization validation, so concurrent requests cannot
consume one authorization or invoke one effect twice.

## Source-hygiene gates

The four auditors are deterministic, model-free, and write nothing:

| Auditor | Pass condition | Typed failure |
|---|---|---|
| Frontmatter validator | Exact declared fields, valid readiness rungs, required document parts, evidence-aware readiness, and complete validation coverage | `document-missing`, `document-invalid`, `rung-combination`, `coverage-gap`, or `evidence-invalid` |
| Duplicate logic auditor | Each listed shared capability has one tracked, digest-bound Knowgrph owner and public surface, while every GameXR assignment is exact-byte bound and declares only presentation/configuration/local-adapter ownership or an exact delegation to that surface | `duplicate-logic` or `audit-incomplete` |
| Path portability auditor | No machine-root or account-name literal; repository paths begin with `$GITHUB_ROOT` and resolve inside it | `path-portability` |
| File size auditor | At most 600 lines, exactly one correctly placed in-file responsibility marker, and, for the explicitly supported MJS grammar, exact-byte external authority that enumerates every export and maps each symbol to that same statement | `file-size`, `single-responsibility`, or `audit-incomplete` for missing, stale, malformed, or unsupported responsibility/export proof |

An incomplete ownership, path inventory, responsibility, export, or upstream
public-surface scan is never reported as clean. Auditor results name the
complete finding set in one response and leave every scanned byte unchanged.

## Reference implementation and validation

The concrete owners for this slice are:

- `$GITHUB_ROOT/agentic-canvas-os/scripts/invocation-resolve.mjs`;
- `$GITHUB_ROOT/agentic-canvas-os/scripts/pipeline-controller.mjs`;
- `$GITHUB_ROOT/agentic-canvas-os/scripts/audit/frontmatter-validator.mjs`;
- `$GITHUB_ROOT/agentic-canvas-os/scripts/audit/duplicate-logic-auditor.mjs`;
- `$GITHUB_ROOT/agentic-canvas-os/scripts/audit/path-portability-auditor.mjs`;
- `$GITHUB_ROOT/agentic-canvas-os/scripts/audit/file-size-auditor.mjs`.

Focused validation is re-invocable from a clean Agentic Canvas OS task
worktree:

```sh
node --test \
  __tests__/agentic-game-os-apple-vision-os-invocation-resolver.test.mjs \
  __tests__/agentic-game-os-apple-vision-os-auditors.test.mjs \
  __tests__/agentic-game-os-apple-vision-os-pipeline-controller.test.mjs
npm run docs:check
```

The property checks for invocation uniqueness, deploy-gate fail-closure, and
pipeline digest continuity run at least 100 generated cases with fixed replay
seeds. A failure records the seed and shrunk case through the test runner.

The broader source specification is owned at
`$GITHUB_ROOT/.kiro/specs/agentic-game-os-apple-vision-os`. Its Apple reference
implementation baseline declares Xcode 26.6, Swift 6.3, iOS and iPadOS 26.5,
visionOS 26.5, Safari 26.6, the RealityKit SDK identity in that Xcode and
visionOS SDK set, Reality Composer Pro 3, and deployment floors iOS 18, iPadOS
18, and visionOS 2. Apple's
[Xcode 26.6 release notes](https://developer.apple.com/documentation/Xcode-Release-Notes/xcode-26_6-release-notes)
bind Xcode, Swift, and the platform SDK set (verified 2026-08-09); Apple's
[Safari release notes](https://developer.apple.com/documentation/safari-release-notes)
record Safari 26.6 (verified 2026-08-09); and Apple's
[Reality Composer Pro release notes](https://developer.apple.com/documentation/realitycomposerpro/reality-composer-pro-release-notes)
identify Reality Composer Pro 3 as an independently distributed tool (verified
2026-08-09). These
values remain declarations until installed-toolchain output, exact native
destinations, and passing build/test evidence all agree.

## Economics and infrastructure

This Agentic Canvas OS slice provisions zero hosted services, managed stores,
servers, container runtimes, scheduled jobs, or paid accounts. Invocation,
auditing, and pipeline state evaluation use zero model calls and zero network
egress. Provider calls occur only inside already-owned release adapters after a
valid exact-candidate authorization.

| Item | Monthly TCO | Twelve-month assumption | FOSS or zero-cost path |
|---|---:|---:|---|
| Invocation and audit runtime | USD 0 | USD 0 | Node.js standard library and repository-pinned test dependencies |
| Local Dev orchestration | USD 0 incremental | USD 0 incremental | Existing local Knowgrph runtime |
| Pipeline state and audit entries | USD 0 | USD 0 | In-process candidate record; durable product-deployment evidence remains with Knowgrph and repository-lifecycle evidence remains with ADLC |

Minimum time to value is six steps and no more than 30 minutes for this source
slice: install pinned dependencies, resolve the tuple, run the audit fixtures,
run the pipeline properties, run the docs contract, and inspect the typed
result. The observable pass condition is zero failing focused tests and a
successful docs-contract exit.

## Readiness and promotion gates

| Component | Current rung | Target | Blocking evidence | Re-invocable gate |
|---|---|---|---|---|
| Invocation resolver | `spec-complete` | `runtime-ready` | Protected exact-head checks and integrated dictionary projection | Focused invocation test followed by protected required checks |
| Source auditors | `spec-complete` | `runtime-ready` | Protected exact-head checks plus cross-repository scans on authoritative roots | Focused auditor test with all three repository roots |
| Pipeline controller | `spec-complete` | `runtime-ready` | Protected exact-head checks and one repository-owned local Dev receipt | Focused pipeline test plus clean canonical Dev proof |
| Shared substrate | `spec-complete` | `runtime-ready` | Terminal scope authority, exact consumer pins, and complete Knowgrph portability owners | Knowgrph focused properties and package checks |
| Browser and native projections | `spec-complete` | `runtime-ready` | Integrated GameXR source, mobile WebKit, iOS Simulator, and native visionOS destination evidence | GameXR browser and native checks |
| Physical Apple devices | `undocumented` | `runtime-ready` | Recorded iPhone and Apple Vision Pro matrices | Device run naming model, OS, date, and every matrix result |
| Production delivery | `undocumented` | `runtime-ready` | Exact-candidate authorization, mirror equality, public digest equality, live-route status, and rollback evidence | Knowgrph product-deployment owner; repository effects remain ADLC-owned |

Simulator, compatibility-destination, headless-browser, HTTP status, preview,
and source-contract results are never promoted into physical-device or
Production evidence. Any unresolved row keeps the delivered result at or below
the lowest component rung.

## Closed deployment boundary

Protected integration proves Dev only. Neither a draft pull request, a task
worktree, a focused test, a `main` label, a locally reachable surface, nor this
document authorizes mirror or public-route mutation. Prod mirror and delivery
each require their own exact-candidate, target-bound, unexpired, unconsumed
human authorization and the Knowgrph product-deployment owner. A missing
token, changed revision, changed digest, changed target, failed check, or
unavailable physical-device gate leaves Production closed.
