---
title: "Knowgrph Runtime-Ready Release Workflow"
graphId: "md:knowgrph-runtime-ready-release-workflow"
doc_type: "Release Workflow Contract"
date: "2026-08-12"
lang: "en-US"
schema: "knowgrph-release-workflow/v4"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "Knowgrph reference implementation adapter for the provider-neutral lifecycle"
profile_type: "reference-implementation"
protocol_contract: "CANONICAL-LIFECYCLE.md"
publish_policy: "protected green main authorizes Dev integration only; exact-candidate human authorization opens Production"
runtime_scope: "Dev integration, runtime-ready localhost review, immutable candidate authorization, Cloudflare deployment, direct D1 reconciliation, transport-separated verification, publication, rollback, and cleanup"
runtime_claim: "bounded release contract; no deployment occurs by reading this document"
runtime_proof: "RUNTIME-PROOF.md"
invocation:
  action: "/release.complete"
  semantics: ["#runtime-ready", "#multi-agent-collaboration"]
  bindings: ["@operator", "@source.frontmatter", "@runtime-proof"]
workspace:
  root: "$GITHUB_ROOT"
  invocation_ssot: "$GITHUB_ROOT/agentic-canvas-os/docs"
  planning_contract: "$GITHUB_ROOT/agentic-canvas-os/docs/TODO.md"
  planning_root: "$GITHUB_ROOT/agentic-canvas-os/todo"
  dev: "$GITHUB_ROOT/knowgrph"
  prod_mirror: "$GITHUB_ROOT/huijoohwee/content/knowgrph"
production_routes: ["https://airvio.co", "https://airvio.co/knowgrph"]
stage_order: ["preflight", "reconcile", "ssot", "memory", "planning", "validate", "integrate", "review", "prepare", "authorize", "deploy", "state-reconcile", "verify-immutable", "verify-public", "publish", "close"]
coordination:
  actor_identity: "authenticated source-control and Production-authorization principals"
  collaboration_identity: "actor + device + session + worktree + branch + semantic scope + lease epoch + fence revision"
  branch_pattern: "^agent/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$"
  device_segment_contract: "lowercase alphanumeric boundaries with interior dot, underscore, or hyphen"
  semantic_scope_segment_contract: "lowercase alphanumeric boundaries with interior hyphen only"
  one_active_writer_per_worktree: true
  canonical_main_worktree: true
  direct_main_push: false
  handoff_identity: "pushed commit SHA"
cost_policy:
  malformed_input_spend: 0
  unauthorized_paid_calls: 0
  proof_provider_mode: "local-or-mock"
completion_requires:
  - "unique semantic-scope ownership"
  - "complete actor, device, session, worktree, branch, scope, lease epoch, and fence identity"
  - "all required gates pass"
  - "visible runtime identity with exact cross-device SHA parity"
  - "one application-root canonical identity owner with a MainPanel Settings KTV projection"
  - "catalog revision equals the Agentic Canvas OS docs revision after no more than two refresh attempts"
  - "one invocation grammar SSOT"
  - "append-only memory-log compliance"
  - "immutable context-record planning compliance"
  - "centralized planning task-row compliance"
  - "protected integration"
  - "joined Overlap Preservation, Overlap Disposition, Integration, Runtime Review, Candidate, Authorization Interaction, Human Authorization, Deployment, State Reconciliation, Live Verification, Publication, and Rollback receipts for every claimed stage"
  - "runtime-ready authorization prompt bound to the exact candidate, source, release run, and supervised localhost review URL"
  - "one target-and-candidate idempotency key and one target-scoped deployment controller"
  - "one exact immutable deployment origin bound to the deployed artifact"
  - "direct D1 readback with document, chunk, graph, content, and path-hash parity"
  - "immutable-origin smoke, public-route smoke, browser fidelity, and returning-user service-worker convergence"
  - "byte-identical readiness markers across immutable and public transports"
  - "Prod mirrors the promoted Dev SHA"
  - "both production routes return verified evidence"
  - "only clean integrated completion-proven task lanes are removed"
---

# Knowgrph Runtime-Ready Release Workflow

## Purpose

Protected integration of a green Knowgrph `main` revision closes Dev and creates no Production authority. The repository-owned controller may prepare one immutable candidate, but forward deployment remains stopped until an authenticated human explicitly authorizes that exact candidate digest in the protected Production environment. `/release.complete #runtime-ready #multi-agent-collaboration @operator @source.frontmatter @runtime-proof` remains the explicit diagnostic or recovery invocation and does not weaken validation, ownership, cost, or stop conditions.

The three invocation dictionaries in this folder remain the only `/`, `#`, and `@` authority. Knowgrph and its deployed routes consume their MCP projection; production never reads a developer-machine filesystem path.

This document is a reference implementation profile for the provider-neutral
receipt protocol in `CANONICAL-LIFECYCLE.md`. GitHub, `main`, `turn:end`,
localhost, the protected `production` environment, Cloudflare, and the
`huijoohwee` mirror are adapter mappings only. Replacing an adapter must preserve
the neutral receipt chain, complete dependency closure, authenticated human
boundary, target-scoped concurrency fence, idempotency, and drift invalidation.

This profile inherits the universal composition, capability, adaptive-decision,
single-owner, typed-receipt, and file-size constraints from
`CANONICAL-LIFECYCLE.md` without redefining them.

## Reference Adapter Mapping

| Neutral receipt or boundary | Knowgrph reference adapter |
|---|---|
| Overlap Preservation and Disposition Receipts | Registered worktree/PR ownership for active lanes; locked content-addressed recovery object and durable ref only for required canonical isolation; exact retained-or-restored accounting before convergence |
| Integration Receipt | Protected GitHub merge SHA, checks, paired immutable manifest, scope PR, actor, lease epoch, and fence SHA |
| Runtime Review Receipt | `turn:end` emits `agentic-local-review-candidate/v1` from canonical localhost runtime proof |
| Candidate Manifest | `agentic-production-release-candidate/v1` binds app, Agentic Canvas OS, catalog, policy, target, mirror, artifact, and manifest digests |
| Authorization prompt | ACOS `agentic-production-authorization-prompt/v1` revalidates runtime readiness and renders candidate, source, run, supervised localhost URL, and exact reply |
| Authorization Interaction Receipt | `npm run production:authorize` records the authenticated terminal challenge and response for the same candidate and target without browser dependence |
| Human Authorization Receipt | Protected GitHub `production` environment records reviewer, candidate digest, target, issue time, expiry, and consumption |
| Deployment Receipt | Exact Cloudflare Pages deployment identifier and immutable candidate origin joined to the consumed authorization and artifact digest |
| State Reconciliation Receipt | Repository-owned direct D1 reconciliation and readback with exact counts plus content and path-hash parity |
| Live Verification Receipt | Immutable Pages origin smoke, public route identity and smoke, browser fidelity, returning-user service-worker convergence, and rollback target |
| Publication Receipt | Exact verified `huijoohwee` mirror revision, emitted only after live verification |
| Rollback Receipt | Restored last-known-good Pages deployment, state disposition, restored probes, and unchanged mirror identity when recovery runs |

The reference adapter persists terminal evidence in the closed
`agentic-collaborative-release-lifecycle/v2` carrier:

| Terminal receipt | Executable schema and required join |
|---|---|
| Deployment | `agentic-deployment-receipt/v1`; authorization, candidate, target, controller, artifact, and rollback target agree |
| State reconciliation | `agentic-state-reconciliation-receipt/v1`; bounded operations, direct readback, exact counts, and parity agree with deployment |
| Live verification | `agentic-live-verification-receipt/v2`; predecessor, controller, proof-surface, marker-byte, artifact, target, and rollback identities agree |
| Publication | `agentic-publication-receipt/v2`; only the validated live-verification predecessor may create publication |
| Rollback | `agentic-rollback-receipt/v1`; deployment, failed stage, last-known-good target, restoration probes, and unchanged mirror agree |

Unknown fields, stale predecessors, indirect readback, unbounded operations,
parity failure, partial rollback, or mirror advancement fail before emission.
The v2 carrier's `completion` is exactly `in-progress`,
`production-complete`, or `rolled-back`. Production completion requires joined
Deployment, State Reconciliation, Live Verification v2, and Publication v2
receipts. Rollback requires joined Deployment and Rollback receipts, names the
exact failed stage and successful predecessor prefix, and forbids publication.
Before either terminal state, the carrier recomputes the complete receipt chain
and validity windows; the interaction and human decision must both occur before
Runtime Review Receipt expiry.

ACOS also exposes
`createProviderNeutralProductionAuthorizationPrompt` for consumers such as
GameXR. It reads the observation-only `collaborative-release-lifecycle/v1`
carrier, which cannot accept v2 terminal receipts or satisfy a production
terminal discriminator. The prompt adds no provider fields to lifecycle
receipts and keeps its existing schema and rendered output.

### Remote Continuation Mapping

The remote transport adapter may inspect, wake, or continue one exact existing
run through `/release.complete`. It owns no receipt semantics, state machine,
controller, store, ledger, or authority source and is replaceable across models,
agents, schedulers, queues, webhooks, hosts, platforms, and interfaces.

Its bounded envelope binds a stable request ID and transport-delivery
idempotency key; `inspect` or `continue`; the existing run, target, candidate,
source, dependency-closure, policy, artifact, and manifest identities; canonical
release key, state, highest valid receipt, claim, epoch, fence, and ledger
revision; one typed blocker, owner, and transition; deadline, attempt, payload,
cancellation, and cost ceilings; and capability, adapter-revision, caller
attestation, observation-time, and evidence digests. Credentials, full
transcripts, repository archives, mutable selectors, and unrestricted
executable input are forbidden.

Status discovery, routing, and receipt validation use the existing model-free
owner. Select one eligible transport without speculative fan-out. An absent or
`unknown` acknowledgement requires `/collaboration.status` reconciliation and
retry of the same request and release keys. `/collaboration.continue` and
`/state.checkpoint` retain their own proof rules. A human gate pauses through
`/human.review`; transport presents the challenge, while the independent
Interaction and Authority Adapters record and validate the human decision.
Fallback changes only the transport and delivery key; the canonical release
key, immutable subject, policy, human boundary, controller, and required
receipts remain fixed. No eligible transport returns `blocked`.

| Remote layer | Closed result values |
|---|---|
| Transport acknowledgement | `accepted`, `rejected`, or `unknown` |
| Continuation observation | `advanced`, `awaiting-human-authorization`, `blocked`, or `stale` |

Remote acknowledgement, HTTP or tool success, runner termination, and model
output prove transport observation only. They create no release authority. An
unblock exists only when the canonical owner removes the typed blocker and emits
its existing receipt; `/release.complete` resumes only from unchanged joined
predecessors.

## Inputs and Outputs

| Contract | Required fields |
|---|---|
| Input | Exact joined Overlap Preservation, Overlap Disposition, Integration, and Runtime Review Receipts; authenticated human authorization when deploying; actor, device, session, worktree, branch, semantic scope, lease epoch, and fence; base SHA; memory and planning refs; complete app/docs/catalog dependency closure; policy and target digests; artifact and manifest digests; Dev repository; Prod mirror; production routes. |
| Output | Reconciliation ledger, preservation inventory and dispositions, memory and planning compliance, validation ledger, immutable manifest and candidate digests, Integration Receipt, Runtime Review Receipt, Human Authorization Receipt, Deployment Receipt, State Reconciliation Receipt, Live Verification Receipt, Publication or Rollback Receipt, cleanup disposition, remaining risks. |
| Failure | Typed blocking stage, failed check, unchanged downstream stages, zero fabricated completion claims. |
| Cost | Model, prompt tokens, completion tokens, cache hits, estimated cost, paid-call count, and actual cost when a model-bearing path runs. |

## Operating Model

### Global Release-Control Rule

This workflow enforces the global release-control rule for every enrolled source repository, mirror, generated projection, and delivery target: only the policy-selected protected integration controller may advance that target's canonical release frontier, and only the target-scoped delivery controller may deploy its immutable authorized candidate. The rule is functional and adapter-based; `main`, `origin/main`, GitHub, pull requests, and Cloudflare are this workflow's mappings, not universal requirements.

- Maintain an explicit, versioned enrollment inventory that maps each target to its canonical-remote, canonical-local, protected-integration, delivery, and deterministic-evaluator adapters. A target may use a different control boundary only through an auditable exception record that names the alternate controller and evaluator.
- Reject direct canonical writes, force pushes, raw refspec publication, merge-triggered deployment, and deployment from a branch, label, or local checkout alone. They are control-bypass failures, not recovery shortcuts.
- Before an integration or deployment decision, the evaluator must prove the current remote frontier, exact candidate, policy revision, independent checks, ownership/fence, and required receipts. A remote advance invalidates pending candidates and authorizations rather than being silently retargeted.
- A canonical local mirror may fast-forward only when it is clean, exclusively owned, and its adapter proves the fetched canonical remote descendant or exact authorized tree-equivalence. A dirty, diverged, stale, or ambiguous mirror remains blocked.
- The global evaluator reports each enrolled target's coverage, adapter identities, policy revision, and terminal result. Missing enrollment, missing exception evidence, or a nonconforming target is fail-closed for that target and does not authorize changes to any other target.

- Complete `START-WORKFLOW.md` before build work: fetch first, preserve one clean registered `main` worktree, inspect every registered worktree, and activate the task branch only in its leased task worktree; pull only on a clean, exclusively owned branch when updating it intentionally.
- Require the current worktree-bound session lease, scope-owned draft pull request, and ancestral fencing SHA for any source mutation or Dev publication; unrelated semantic-scope worktrees and pull requests may coexist, but duplicate active scope ownership blocks release.
- Use one task, semantic scope, registered task worktree, branch, and active writer. Parallel users, devices, sessions, and worktrees are valid only for disjoint scopes with distinct remote ownership records and current fences. Keep normal runtime and synchronization on the registered `main` worktree.
- Use one clean registered canonical `main` worktree as the synchronization and release owner, plus zero or more isolated registered task worktrees for disjoint scopes. Each lane has one active writer, one current fence, and one declared write scope; a waiting release run does not keep ownership after `origin/main` advances past its candidate.
- From candidate sealing through authorization interaction, keep the canonical release-owner checkout attached to the same exact protected `main` revision used for review. Do not switch that root checkout to another branch, reuse it for unrelated task work, or accept local-ref drift between prompt emission and authorization consumption; any such movement blocks or retires the run until the owner is restored and the candidate is revalidated.
- Create a contract-valid `agent/<device>/<semantic-scope>` from the latest `origin/main`; preserve interior `.`, `_`, and `-` in the device segment, but normalize semantic scope to lowercase alphanumerics and hyphens before any checkout mutation.
- When opening or updating a pull request, instantiate the repository-owned body template rather than freewriting metadata. Refresh the body after every rebase or base refresh so `base_sha` records the current fetched protected-base ancestor, and require `scope` to equal the `<semantic-scope>` segment of `agent/<device>/<semantic-scope>` exactly.
- Declare `/`, `#`, `@`, base SHA, and ownership before editing.
- Stop when another open pull request owns the semantic scope or the same branch has another writer.
- Hand off only after the sender stops and pushes an exact commit SHA with its
  joined scope, actor, lease-epoch, fence, and check evidence. Mutable local
  state is never a cross-user or cross-device handoff.
- Use `release:publish:immutable` only for an already-created commit whose writer stopped or for checkout-independent recovery; require the expected remote SHA and retain the generated manifest digest. Manual hook bypass, raw refspec push, branch switching, or a missing manifest is not a release lane.
- Treat branch names as informational. Cross-device and promoted-runtime parity require visible, identical exact Knowgrph and Agentic Canvas OS SHAs.
- Require the canonical identity runtime at the application root and the visible gate as a MainPanel Settings body section using shared KTV rows. Settings, Skills & Commands, Chat, FloatingPanel, and invocation catalogs must remain projections or facet publishers, never identity owners.
- Require `npm run collaboration:gate` to exit zero with two isolated authenticated runtime peers, at least two active room peers, exact document propagation, and one common non-empty verification digest. The gate owns local orchestration and cleanup; it does not require physical devices or exported JSON. `Copy diagnostic JSON` is optional troubleshooting only.
- Require CI to build, upload, download, and revalidate one immutable manifest that binds its exact pull-request head to the exact Agentic Canvas OS checkout and catalog revision. Individually green repositories without this paired artifact do not satisfy integration.
- Key catalog hydration to the Agentic Canvas OS docs SHA; invalidate revision changes and allow at most two explicit refresh attempts before a visible blocked or stale result.
- Never push directly to `main`; integrate only through the protected Integration Gate.
- End each implementation turn by either carrying the completed lane or worktree payload through protected integration into canonical `origin/main` and re-parking the canonical owner there cleanly, or by preserving incomplete work in its owned lane through the repository-owned parking path while canonical `main` stays clean and exact.
- Resolve conflicts at the source owner. Do not stack aliases, backfill generated output, or overwrite unexplained work.
- Before convergence or canonical review isolation, content-bind every pre-existing non-canonical item and its owner, write set, fence, overlap class, state, preservation mode, and recovery handle. Retain overlapping work; restore only exact disjoint state; never treat preservation as Production authority.
- Before candidate preparation, emit one keep / port / drop inventory for every pre-existing non-canonical lane or worktree. `keep` preserves unrelated or still-active work unchanged, `port` requires the retained value to pass protected Dev integration before the release frontier closes, and `drop` is cleanup-only after exact no-remaining-value proof plus cleanup authority.
- Treat `memory/YYYY-MM.md` as append-only evidence: validate its hybrid format and compare historical bytes with the recorded Agentic Canvas OS memory base ref before integration.
- Treat flat `todo/YYYY-MM.md` files as immutable legacy evidence and `todo/YYYY-MM/<context>.md` as independently owned task records: validate the index and projection, compare legacy bytes with the recorded base, and require the declared new record before integration.
- Require one base-absent immutable record matching the declared `planning_context` and exact path; reject shared planning appends and repository-local todo files before integration.

## Stage Contract

### 1. Preflight

Confirm the startup ledger from `START-WORKFLOW.md`. Read repository instructions and release contracts. Fetch remotes again, then inspect branches, worktrees, open pull requests, nested repositories, remote divergence, and every staged, unstaged, or untracked path. Record the action, semantic scope, actor, branch, startup base SHA, memory base ref, planning base ref, planning Context and record path, current base SHA, current Dev SHA, current Prod SHA, visible Knowgrph runtime SHA, visible Agentic Canvas OS runtime SHA, catalog revision, catalog hydration status and attempts, immutable manifest digest, ownership conflicts, and the exact keep / port / drop classification for every pre-existing non-canonical lane or worktree.

Stop before mutation when ownership is ambiguous, history is non-fast-forward, or another worktree or device is writing the same branch or semantic scope.

### 2. Reconcile

Classify dirty paths as requested work, valid concurrent work, generated output, stale or duplicate residue, or unresolved ownership. Preserve valid work. Remove confirmed residue at its source. Forbid destructive reset, force checkout, force-push, silent indefinite stash, broad untracked deletion, and unrelated change absorption.

The stage completes only when no dirty path is unexplained.

### 3. Verify Invocation SSOT

Confirm `agentic-canvas-os` is the expected Git checkout and its required facts and dictionary files parse. Verify every requested token resolves through `FACTS.md` and the three dictionaries. Scan authored Dev and Prod source for copied dictionaries, hardcoded catalogs, invented document aliases, compatibility remaps, and machine-specific absolute paths.

Remove duplicate owners; do not edit generated Prod assets directly.

### 4. Verify Memory Log Compliance

Run both commands under `Memory Log Compliance Checks` in `VALIDATION-RUNBOOK.md`. The structural command must validate every current shard. Set `MEMORY_BASE_REF` to the exact Agentic Canvas OS base SHA recorded at session start; the append-only comparison must prove that every shard present at that base remains byte-for-byte unchanged as a prefix of the current file.

New memory shards are permitted only when their complete frontmatter and first `## @mem-YYYYMMDDTHHmmssZ` UTC sigil entry validate. Existing shard deletion, rename, frontmatter edits, entry edits, reordering, compaction, insertion before EOF, local-time or minute-only sigils, table conversion, pure-YAML conversion, bolded sigils, or incomplete appended entries block release before Dev integration.

When a prior fact is wrong or obsolete, restore the prior bytes and append a new record that cites or supersedes the earlier decision. Never repair compliance by rewriting history.

### 5. Verify Context Record Planning Compliance

Run both commands under `Planning Context Record Compliance Checks` in `VALIDATION-RUNBOOK.md`. Set `PLANNING_BASE_REF`, `PLANNING_CONTEXT`, and `PLANNING_RECORD` from the startup declaration.

The structural gate validates `TODO.md` and every shard. The release gate preserves every committed shard as an exact byte prefix, requires the declared Context exactly once in the active shard, and strictly validates rows at or after the adoption boundary. A closed-shard mutation, historical rewrite, wrong-month heading, duplicate Context, empty cell, overlong Directive, wrong Updated Date, or size overflow blocks release.

### 6. Validate Dev

Run `npm run collaboration:gate`, then the repository-declared protected-ref, hygiene, source-conflict, affected-test, type, build, runtime-ready, integration, and immutable-manifest gates. Runtime proof must show two isolated authenticated peers, at least two active room peers, exact document propagation, exact visible app/docs SHA parity, catalog revision equal to the docs revision after no more than two explicit refresh attempts, one common verification digest, the pinned docs dependency, a round-tripped exact app/docs/catalog manifest, deterministic replay, bounded execution, zero test failures, zero unauthorized paid calls, zero unexplained cost, no proof-harness repository writes, and no deployment side effects.

Stop on any required failure. Never promote by skipping tests, editing fixtures to hide defects, or adding downstream aliases.

### 7. Integrate Dev and Emit the Integration Receipt

For a release containing multiple integration units, first validate the
provider-neutral plan in `INTEGRATION-ORDER.md`. Integrate dependency waves
before consumers, permit parallelism only for disjoint write scopes, and fetch
the protected revision after each frontier advancement. Record
`already-integrated` only with equivalence evidence and `superseded` only with
equivalence plus capability-coverage evidence. Recompute the remaining plan
against the new exact canonical revision and complete runtime convergence for
every runtime-impact unit before sealing the release frontier. A stale plan,
duplicate change identity, unresolved dependency, overlapping active scope, or
unsealed release frontier blocks candidate preparation.

Separate unrelated scopes into branch-exclusive leased task worktrees. Commit intentionally, push without force, and open or update a pull request from the repository-owned body template containing action, semantic scope, actor, the current base SHA, validation, cost, immutable manifest digest, and handoff evidence. The pull-request `scope` field must exactly match the branch semantic-scope segment, and any base drift requires rewriting the body before review or merge. Use the repository-owned checkout-free publication command only for a stopped writer's existing commit or recovery path. Merge only after the protected Integration Gate round-trips the exact pair manifest and succeeds. Record the merged Dev SHA as the sole promotion input.

When a direct push to `main` is rejected by protected-branch policy or missing required checks, treat that response as expected integration policy, not as evidence that `pull` is the right next move. Fetch first, inspect `origin/main`, and continue on the task branch through a pull request unless the owned branch intentionally needs a clean upstream update.

If attributed tracked bytes remain in canonical `main` after their exact task
change has passed protected integration, use only the
`canonical:main:fast-forward-equivalence` adapter described in
`START-WORKFLOW.md`. Its completed content-bound receipt must prove every dirty
path's mode and blob is identical to the fetched protected descendant while all
other paths remain clean against the expected local head; unrelated protected
changes may then materialize during canonical ref/index reconciliation. Any
untracked, staged, conflicting, deleted, partial, extra, mode-mismatched, or
drifted state remains blocking.

Before protected convergence, emit the Overlap Preservation Receipt and account
for every item in the joined Disposition Receipt. After convergence, emit the neutral Integration Receipt with the
canonical merge commit and tree, full dependency-closure digest, protected
checks, authenticated pull-request actor, device, session, worktree, branch,
semantic scope, lease epoch, fence SHA, paired immutable-manifest digest, and
both preservation receipt digests.
Candidate preparation must reject a missing, stale, overlapping, or unjoined
Integration Receipt.

Use the explicit integration wrapper from the leased task worktree when the
operator intends protected delivery:

```bash
npm run device:integrate -- --session="$AGENTIC_SESSION_ID" --json
```

For dirty work, also provide the intentional `--commit-message` and exact
external `agentic-change-manifest/v1` through `--paths-manifest`. Require its
commit, manifest/diff digest, pull-request, merge, integrated-source SHA, and
managed-runtime evidence, then rerun the original acceptance path.
Branch-only, stashed, pushed, open-pull-request, or auto-merge-pending work
remains incomplete. `device:park` is only a paused or blocked exit. This Dev
completion gate does not deploy from the checkout. The protected merge event
permits immutable candidate preparation only; Prod and Cloudflare remain closed
until the protected Production environment records exact-candidate human authorization.

### 8. Review and Prepare the Candidate

Use only canonical publish and synchronization scripts. Treat Dev as authored
source and Prod as a generated mirror. Require `turn:end` to join the exact
Integration Receipt and emit the Runtime Review Receipt. Build once, then bind
the complete app, Agentic Canvas OS, catalog, schema, generated mirror, build,
policy, target, review, and transitive dependency closure into one immutable
Candidate Manifest. Run publish-contract, schema, asset-manifest, and
mirror-parity checks without publishing.

Reject candidate sealing when any pre-existing non-canonical lane or worktree
lacks a keep / port / drop disposition, when a `port` item has not reached
protected Dev integration, or when a `drop` item still needs value-closure
proof or cleanup authority.

When mirror-parity fails because the schema mirror is missing a `knowgrph/docs/documents/*` node, regenerate `huijoohwee.github.io/schema/AgenticRAG/knowgrph-documents-map.graph.jsonld` through `python3 $GITHUB_ROOT/huijoohwee.github.io/schema/AgenticRAG/sync_map.py --mode write`, commit that mirror change in `huijoohwee.github.io`, and rerun release verification. Never hand-edit the generated graph file.

Require zero unexplained Dev/Prod drift. Never manually patch or backfill the
mirror. Any new source commit, direct or transitive dependency movement, policy
or target change, tree change, artifact change, manifest change, or rebuild
invalidates the candidate and requires a new runtime review and authorization.

Before dispatch, fetch and bind every protected authority in the Release
Frontier: Knowgrph source, Agentic Canvas OS docs and catalog, schema policy and
generated maps, publication-mirror base, target configuration, and rollback
target. Inspect queued or concurrently merging protected changes. If any bound
authority advances during verification or while authorization waits, cancel or
retire the stale unapproved run, fast-forward only clean canonical owners, rerun
their exact protected checks, reseal `turn:end`, and dispatch a fresh candidate.
Never retarget a waiting run or treat tree-equivalent movement as authorization
for a different policy revision.

When `main` advances because another pull request merges while a release run is
waiting, retire that stale run immediately. Fast-forward the clean canonical
`main` worktree to the new exact `origin/main` SHA, rerun `turn:end`, and seal a
fresh candidate from that fetched revision. Do not approve, resume, or deploy
the older candidate after the newer protected revision exists.

### 9. Authorize and Deploy Cloudflare

#### Canonical production pipeline

Use one target-scoped production release controller. For this reference profile, the canonical sequence is:

1. Capture the last-known-good rollback identity for the target.
2. Generate the exact `agentic-local-review-candidate/v1` from the runtime review surface.
3. Generate `knowgrph-production-release-evidence/v1` that binds the release frontier and rollback identity.
4. Dispatch the repository-owned Production Release workflow for the exact source SHA and evidence payloads.
5. Complete protected terminal authorization at the Production gate for the same candidate digest and target.

These are functional steps, not vendor semantics. Alternate repositories, hosts, CI products, approval systems, or deployment providers must map to the same rollback capture, candidate, evidence, protected dispatch, and human authorization receipts. They must not add a second authority path.

Forbid duplicate or conflicting deploy mechanisms for the same target. Do not use local Pages deploys, direct mirror pushes, secondary workflow dispatches, generated-asset patches, or emergency commands as normal release routes. If recovery requires a manual adapter, it must bind the same source revision, candidate digest, rollback identity, target, receipts, protected reviewer decision, immutable verification, and publication rules, then reconcile the canonical controller state before claiming completion.

#### Provider-neutral authorization prompt

Before a non-Knowgrph consumer asks for authorization, pass its canonical
`{ receipts }` lifecycle carrier, controller-current authority receipt, strict
versioned readiness, exact Candidate Manifest digest, and bounded run reference to
`createProviderNeutralProductionAuthorizationPrompt`. The adapter validates the
closed carrier through the shared lifecycle schema, reconstructs the joined
Preservation, Disposition, Integration, Runtime Review, and Candidate receipts
through their canonical constructors, and rejects a missing, forged, ambiguous,
previously challenged, or previously authorized selected candidate.

The controller input must be a self-digesting
`agentic-provider-neutral-production-authorization-authority/v1` receipt. It
binds the order-neutral carrier digest, selected candidate, no current
competitor, uninitiated authorization state, canonical and release-owner source,
and current-state observation. The adapter recomputes that authority digest and
joins every field to the selected receipt chain. Readiness must be
`agentic-provider-neutral-production-authorization-readiness/v1` and
`runtime-ready`; it must carry the exact controller authority digest and state,
every integration/review/candidate digest, full source/dependency/check/policy/
target/artifact/manifest/rollback identity, review surface, probes, and observed
instant. Every named probe must be `passed`. The carrier digest proves both
authority and readiness were issued for those exact receipts.

The adapter accepts one canonical HTTPS locator or an HTTP loopback locator with
an explicit port. URL syntax alone does not prove an HTTPS surface immutable;
any immutability claim must be established independently by the controller and
the readiness-bound artifact and manifest identities. The ordered evidence
window is Integration Receipt time, Runtime Review issue time, candidate build
time, current observation time, controller-clock prompt time, then review
expiry. The controller-derived prompt instant is bound into the prompt digest.
Drift or expiry blocks prompt creation.

The provider-neutral formatter renders candidate, target, source, run, review
surface, portable formatter template, and the exact `authorize <digest>` reply.
A loopback or HTTPS surface proves review only. Prompt creation and
presentation create no Authorization Interaction Receipt, Human Authorization
Receipt, Production authority, publication authority, or deployment authority.
GameXR may consume this adapter with the same canonical carrier and without
GitHub, Cloudflare, Pages, Knowgrph, or localhost-specific receipt fields.

Deploy only the already-built candidate whose exact digest and target an
authenticated human reviewer authorized in the protected GitHub `production`
environment. Persist a Human Authorization Receipt with reviewer, authority
adapter, candidate and target digests, issue time, expiry, and single-consumption
state. Revalidate fetched `origin/main`, canonical localhost `main`, the
complete reviewed dependency closure, policy, target, artifact,
immutable-manifest, candidate, and predecessor receipts immediately before
deployment. Never deploy `latest main`, rebuild after authorization, expose
secrets, or hardcode account ids, credentials, routes, local paths, or
invocation catalogs.

Before asking for authorization, call the ACOS prompt contract with the current
`turn:end` result, local-review receipt, immutable candidate, and release-run
reference. It must re-prove `runtime-ready`, HTTP 200 canonical probes, exact
source and Agentic Canvas OS identities, the candidate's local-review digest,
and a supervised loopback Apex URL. On success, display exactly:

```text
The release is verified and awaiting fresh human authorization.

Candidate: `{{candidate_digest}}`
Source: `{{source_revision}}`
Run: `{{release_run_reference}}`
localhost: `{{localhost_review_url}}`

Reply exactly:

`authorize {{candidate_digest}}`
```

The localhost URL is a bound review surface, not Production authority, and may
not be supplied as free-form confirmation input. A stale process, failed probe,
non-loopback URL, source or dependency movement, candidate mismatch, or missing
run reference blocks prompt emission and requires a fresh `turn:end`, candidate,
and human authorization.

Terminal automation that answers this prompt must use a sequential matcher.
First capture the printed exact reply line `authorize {{candidate_digest}}`
from the prompt output, then wait for the live `>` input prompt, and only then
send that exact captured reply. Precomputed input, partial matches, or sending
before the live prompt is ready records no valid Authorization Interaction
Receipt.

Key the controller by target digest plus candidate digest. Exactly one
environment-scoped controller may deploy. Coalesce an exact duplicate dispatch
onto its durable result, reject competing candidates or controllers, and record
authorization consumption before releasing the fence.

Capture the last-known-good Pages deployment, publication mirror revision, and
D1 state contract before target mutation. Deploy the already-built artifact,
record the exact Cloudflare Pages deployment identifier and immutable
`pages.dev` candidate origin in the Deployment Receipt, and use that captured
origin for candidate smoke. The custom domain remains a separately verified
public transport; bot policy, caching, or routing behavior there must not cause
CI to silently retarget or rebuild the candidate.

The GitHub `production` environment must require a human reviewer and provide non-empty `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets before the deploy job starts. Treat absent review or an empty-secret failure as missing deployment authority, not as a reason to weaken the workflow or bypass the environment gate.

On partial success, stop further mutation and report the exact state. Do not loop or stack patches.

### 10. Reconcile State, Verify Production, and Publish

Reconcile canonical documents through the repository-owned direct D1 adapter,
not through a public HTTP route. Require bounded idempotent operations followed
by direct authoritative readback. Record expected and observed document, chunk,
and graph counts plus path-hash and content parity in the State Reconciliation
Receipt. Keep code rollback and D1 disposition separate; restoring Pages does
not reverse state.

Run the repository-owned agent-ready smoke against the immutable candidate
origin and require every named check to pass. Verify exact deployment markers
and browser fidelity against that same origin. Then verify returning-user
service-worker convergence from the prior revision to the authorized source
revision while preserving unrelated sibling caches and storage.

Separately verify `https://airvio.co`, `https://airvio.co/knowgrph`, and the
stable Pages route for HTTP status, route ownership, primary HTML and assets,
stale asset references, MCP availability, invocation catalog resolution,
runtime health, visible exact Knowgrph and Agentic Canvas OS SHA evidence,
catalog/docs revision equality, bounded hydration evidence, local-path leakage,
legacy aliases, and required responsive smoke paths. Require readiness-marker
bytes to be identical across the immutable Pages origin, stable Pages route,
and public custom domain.

Emit the Live Verification Receipt only when the Deployment and State
Reconciliation Receipts join the Human Authorization Receipt and all required
transport claims pass. Publish the exact generated mirror only afterward,
record its immutable commit, and emit the Publication Receipt. Failed or
ambiguous live proof restores the captured last-known-good deployment, records
the D1 disposition, emits the Rollback Receipt, and leaves the previous mirror
revision unchanged.

### 11. Close, Clean Up, and Report

Persist the completed receipt artifact before cleanup. Remove only task
worktrees whose exact pull request is merged, whose tree is clean and contained
by protected main, and whose lease is completion-proven. Preserve active,
parked, dirty, divergent, ambiguous, and unrelated runtime-document lanes.
Branch deletion remains a separate authorized action.

Report invocation intent, ownership, worktrees, base SHA, memory base ref,
planning base ref, Context record path, immutable legacy comparison
results, the planning task-row result, handoffs, reconciled paths, SSOT commit,
Dev commits and pull request, Integration Gate, merge SHA, Release Frontier,
candidate and authorization digests, validation and cost evidence, Cloudflare
deployment identifier and immutable origin, D1 counts and parity, immutable and
public route results, browser and service-worker proof, mirror commit, receipt
digests, rollback disposition, cleanup disposition, and remaining risks.

## Stop Conditions

Stop without downstream mutation when any of these is true:

- semantic-scope or branch ownership conflicts;
- dirty work cannot be attributed safely;
- required dictionary or runtime proof is missing;
- the immutable publication manifest is missing, malformed, not round-tripped, or does not bind the exact CI head to the checked-out Agentic Canvas OS and catalog revisions;
- visible runtime identity is missing, exact app/docs SHAs differ across participating devices, or only branch names are available as parity evidence;
- identity ownership is not application-global, the gate is outside the MainPanel Settings body or does not use shared KTV rows, or any surface/catalog creates a competing identity owner;
- the automatic attestation transport is unavailable or unauthenticated, fewer than two distinct session-bound device principals and live devices respond, the gate is not `pass`, verification digests are missing or differ, evidence is expired, replayed, malformed, duplicated, or mismatched, reconnect recovery is unbounded or exhausts after a stable connection, or the room/verifier builds, persists, selects, synchronizes, or mutates identity;
- catalog revision differs from the Agentic Canvas OS docs revision, hydration is stale or blocked, or more than two explicit refresh attempts are required;
- any memory shard is malformed or historical bytes differ from the recorded memory base ref;
- any Context record is malformed, duplicated, over cap, misidentified, or missing the declared strict task row;
- the declared record existed at base, more than one record changed, or any immutable legacy monthly shard changed;
- a required gate fails;
- Dev, Prod, and promoted SHA cannot be reconciled;
- schema mirror parity is stale or missing generated document nodes for the promoted Dev SHA;
- any protected Release Frontier authority advances after review or candidate sealing;
- credentials or deployment authority are absent;
- immutable candidate origin, D1 direct readback, required public routes, browser fidelity, client-cache convergence, or marker parity is missing or disagrees;
- publication begins before the Live Verification Receipt;
- cleanup targets a lane that is active, parked, dirty, divergent, ambiguous, unrelated, or not completion-proven;
- deployment is partial or production verification disagrees with release evidence.

## Completion VCC

Given a protected green merge to Knowgrph `main`, when `turn:end` records exact
localhost evidence, the controller builds one immutable candidate, an
authenticated human authorizes its exact digest, and every ordered deployment,
state, transport, publication, and cleanup stage succeeds without drift or
rebuild, then memory and centralized planning history are proven append-only,
the declared planning row is compliant from its recorded base, one
application-root runtime owns identity and MainPanel Settings projects it
through shared KTV rows, participating runtime identities report identical
exact app/docs SHAs, catalog revision equals the docs revision with bounded
fresh hydration, Prod represents the exact authorized Dev artifact, and the
terminal ledger joins deployment, state, live, publication or rollback, and
cleanup evidence.

VCC: verify `npm run collaboration:gate` exits zero with two distinct automated
peers, at least two active room peers, one common verification digest, remote
document propagation, exact app/docs SHA and `/`, `#`, `@` count parity, and
fresh catalog hydration in at most two attempts; the memory and planning gates
pass; every protected Release Frontier identity is current; the immutable
candidate smoke, D1 direct readback, browser fidelity, returning-user
service-worker convergence, stable and public route probes, and byte-identical
readiness-marker checks pass; the mirror commit names the promoted SHA; receipt
artifacts persist; cleanup removes only completion-proven lanes; and execution
stops after the first blocker.
