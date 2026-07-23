---
title: "Knowgrph Runtime-Ready Release Workflow"
graphId: "md:knowgrph-runtime-ready-release-workflow"
doc_type: "Release Workflow Contract"
date: "2026-07-18"
lang: "en-US"
schema: "knowgrph-release-workflow/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "end-to-end Knowgrph release operating model"
publish_policy: "protected green main automatically invokes the repository-owned release controller"
runtime_scope: "Dev integration, Prod mirror promotion, Cloudflare deployment, and verification"
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
stage_order: ["preflight", "reconcile", "ssot", "memory", "planning", "validate", "integrate", "promote", "deploy", "verify", "report"]
coordination:
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
  - "all required gates pass"
  - "visible runtime identity with exact cross-device SHA parity"
  - "one application-root canonical identity owner with a MainPanel Settings KTV projection"
  - "catalog revision equals the Agentic Canvas OS docs revision after no more than two refresh attempts"
  - "one invocation grammar SSOT"
  - "append-only memory-log compliance"
  - "append-only monthly planning-shard compliance"
  - "centralized planning task-row compliance"
  - "protected integration"
  - "Prod mirrors the promoted Dev SHA"
  - "both production routes return verified evidence"
---

# Knowgrph Runtime-Ready Release Workflow

## Purpose

Protected integration of a green Knowgrph `main` revision automatically requests the complete release workflow. `/release.complete #runtime-ready #multi-agent-collaboration @operator @source.frontmatter @runtime-proof` remains the explicit diagnostic or recovery invocation and does not weaken validation, ownership, cost, or stop conditions.

The three invocation dictionaries in this folder remain the only `/`, `#`, and `@` authority. Knowgrph and its deployed routes consume their MCP projection; production never reads a developer-machine filesystem path.

## Inputs and Outputs

| Contract | Required fields |
|---|---|
| Input | Operator approval, device identity, semantic scope, task branch, base branch, base SHA, memory base ref, planning base ref, planning shard, planning context, exact app/docs/catalog manifest, Dev repository, Prod mirror, production routes. |
| Output | Reconciliation ledger, memory and planning compliance, validation ledger, immutable manifest digest, Dev commits and merge SHA, promoted SHA, mirror parity proof, deployment identifiers, production verification, remaining risks. |
| Failure | Typed blocking stage, failed check, unchanged downstream stages, zero fabricated completion claims. |
| Cost | Model, prompt tokens, completion tokens, cache hits, estimated cost, paid-call count, and actual cost when a model-bearing path runs. |

## Operating Model

- Complete `START-WORKFLOW.md` before build work: fetch first, preserve one clean registered `main` worktree, inspect every registered worktree, and activate the task branch only in its leased task worktree; pull only on a clean, exclusively owned branch when updating it intentionally.
- Require the current worktree-bound session lease, scope-owned draft pull request, and ancestral fencing SHA for any source mutation or Dev publication; unrelated semantic-scope worktrees and pull requests may coexist, but duplicate active scope ownership blocks release.
- Use one task, semantic scope, registered task worktree, branch, and active writer. Keep normal runtime and synchronization on the registered `main` worktree.
- Create a contract-valid `agent/<device>/<semantic-scope>` from the latest `origin/main`; preserve interior `.`, `_`, and `-` in the device segment, but normalize semantic scope to lowercase alphanumerics and hyphens before any checkout mutation.
- Declare `/`, `#`, `@`, base SHA, and ownership before editing.
- Stop when another open pull request owns the semantic scope or the same branch has another writer.
- Hand off only after the sender stops and pushes an exact commit SHA.
- Use `release:publish:immutable` only for an already-created commit whose writer stopped or for checkout-independent recovery; require the expected remote SHA and retain the generated manifest digest. Manual hook bypass, raw refspec push, branch switching, or a missing manifest is not a release lane.
- Treat branch names as informational. Cross-device and promoted-runtime parity require visible, identical exact Knowgrph and Agentic Canvas OS SHAs.
- Require the canonical identity runtime at the application root and the visible gate as a MainPanel Settings body section using shared KTV rows. Settings, Skills & Commands, Chat, FloatingPanel, and invocation catalogs must remain projections or facet publishers, never identity owners.
- Require `npm run collaboration:gate` to exit zero with two isolated authenticated runtime peers, at least two active room peers, exact document propagation, and one common non-empty verification digest. The gate owns local orchestration and cleanup; it does not require physical devices or exported JSON. `Copy diagnostic JSON` is optional troubleshooting only.
- Require CI to build, upload, download, and revalidate one immutable manifest that binds its exact pull-request head to the exact Agentic Canvas OS checkout and catalog revision. Individually green repositories without this paired artifact do not satisfy integration.
- Key catalog hydration to the Agentic Canvas OS docs SHA; invalidate revision changes and allow at most two explicit refresh attempts before a visible blocked or stale result.
- Never push directly to `main`; integrate only through the protected Integration Gate.
- Resolve conflicts at the source owner. Do not stack aliases, backfill generated output, or overwrite unexplained work.
- Treat `memory/YYYY-MM.md` as append-only evidence: validate its hybrid format and compare historical bytes with the recorded Agentic Canvas OS memory base ref before integration.
- Treat `todo/YYYY-MM.md` as append-only cross-repository planning evidence: validate the index and shards, compare historical bytes with the recorded Agentic Canvas OS planning base ref, and require the declared strict task row before integration.
- Require one appended active-shard row matching the declared `planning_context`; reject repository-local todo files before integration.

## Stage Contract

### 1. Preflight

Confirm the startup ledger from `START-WORKFLOW.md`. Read repository instructions and release contracts. Fetch remotes again, then inspect branches, worktrees, open pull requests, nested repositories, remote divergence, and every staged, unstaged, or untracked path. Record the action, semantic scope, actor, branch, startup base SHA, memory base ref, planning base ref, planning shard, planning context, current base SHA, current Dev SHA, current Prod SHA, visible Knowgrph runtime SHA, visible Agentic Canvas OS runtime SHA, catalog revision, catalog hydration status and attempts, immutable manifest digest, and ownership conflicts.

Stop before mutation when ownership is ambiguous, history is non-fast-forward, or another worktree or device is writing the same branch or semantic scope.

### 2. Reconcile

Classify dirty paths as requested work, valid concurrent work, generated output, stale or duplicate residue, or unresolved ownership. Preserve valid work. Remove confirmed residue at its source. Forbid destructive reset, force checkout, force-push, silent indefinite stash, broad untracked deletion, and unrelated change absorption.

The stage completes only when no dirty path is unexplained.

### 3. Verify Invocation SSOT

Confirm `agentic-canvas-os` is the expected Git checkout and its required facts and dictionary files parse. Verify every requested token resolves through `FACTS.md` and the three dictionaries. Scan authored Dev and Prod source for copied dictionaries, hardcoded catalogs, invented document aliases, compatibility remaps, and machine-specific absolute paths.

Remove duplicate owners; do not edit generated Prod assets directly.

### 4. Verify Memory Log Compliance

Run both commands under `Memory Log Compliance Checks` in `VALIDATION-RUNBOOK.md`. The structural command must validate every current shard. Set `MEMORY_BASE_REF` to the exact Agentic Canvas OS base SHA recorded at session start; the append-only comparison must prove that every shard present at that base remains byte-for-byte unchanged as a prefix of the current file.

New monthly shards are permitted only when their complete frontmatter and first `## @mem-YYYYMMDDTHHmmssZ` UTC sigil entry validate. Existing shard deletion, rename, frontmatter edits, entry edits, reordering, compaction, insertion before EOF, local-time or minute-only sigils, table conversion, pure-YAML conversion, bolded sigils, or incomplete appended entries block release before Dev integration.

When a prior fact is wrong or obsolete, restore the prior bytes and append a new record that cites or supersedes the earlier decision. Never repair compliance by rewriting history.

### 5. Verify Monthly Planning Shard Compliance

Run both commands under `Planning Shard Compliance Checks` in `VALIDATION-RUNBOOK.md`. Set `PLANNING_BASE_REF`, `PLANNING_SHARD`, and `PLANNING_CONTEXT` from the startup declaration.

The structural gate validates `TODO.md` and every shard. The release gate preserves every committed shard as an exact byte prefix, requires the declared Context exactly once in the active shard, and strictly validates rows at or after the adoption boundary. A closed-shard mutation, historical rewrite, wrong-month heading, duplicate Context, empty cell, overlong Directive, wrong Updated Date, or size overflow blocks release.

### 6. Validate Dev

Run `npm run collaboration:gate`, then the repository-declared protected-ref, hygiene, source-conflict, affected-test, type, build, runtime-ready, integration, and immutable-manifest gates. Runtime proof must show two isolated authenticated peers, at least two active room peers, exact document propagation, exact visible app/docs SHA parity, catalog revision equal to the docs revision after no more than two explicit refresh attempts, one common verification digest, the pinned docs dependency, a round-tripped exact app/docs/catalog manifest, deterministic replay, bounded execution, zero test failures, zero unauthorized paid calls, zero unexplained cost, no proof-harness repository writes, and no deployment side effects.

Stop on any required failure. Never promote by skipping tests, editing fixtures to hide defects, or adding downstream aliases.

### 7. Integrate Dev

Separate unrelated scopes into branch-exclusive leased task worktrees. Commit intentionally, push without force, and open or update a pull request containing action, semantic scope, actor, base SHA, validation, cost, immutable manifest digest, and handoff evidence. Use the repository-owned checkout-free publication command only for a stopped writer's existing commit or recovery path. Merge only after the protected Integration Gate round-trips the exact pair manifest and succeeds. Record the merged Dev SHA as the sole promotion input.

When a direct push to `main` is rejected by protected-branch policy or missing required checks, treat that response as expected integration policy, not as evidence that `pull` is the right next move. Fetch first, inspect `origin/main`, and continue on the task branch through a pull request unless the owned branch intentionally needs a clean upstream update.

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
opens Prod and Cloudflare stages only inside the repository-owned automatic
release controller.

### 8. Promote Prod

Use only canonical publish and synchronization scripts. Treat Dev as authored source and Prod as a generated mirror. Synchronize the merged Dev SHA, remove stale hashed artifacts through the canonical process, and run production build, publish-contract, schema, asset-manifest, and mirror-parity checks.

When mirror-parity fails because the schema mirror is missing a `knowgrph/docs/documents/*` node, regenerate `huijoohwee.github.io/schema/AgenticRAG/knowgrph-documents-map.graph.jsonld` through `python3 $GITHUB_ROOT/huijoohwee.github.io/schema/AgenticRAG/sync_map.py --mode write`, commit that mirror change in `huijoohwee.github.io`, and rerun release verification. Never hand-edit the generated graph file.

Require zero unexplained Dev/Prod drift. Never manually patch or backfill the mirror.

### 9. Deploy Cloudflare

Deploy only the verified promoted SHA with repository-owned Cloudflare configuration. Never expose secrets or hardcode account ids, credentials, routes, local paths, or invocation catalogs. Prevent concurrent deployments to the same environment and capture immutable version evidence.

The GitHub `production` environment must provide non-empty `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets before the deploy job starts. Treat an empty-secret failure as missing deployment authority, not as a reason to weaken the workflow or bypass the environment gate.

On partial success, stop further mutation and report the exact state. Do not loop or stack patches.

### 10. Verify Production

Verify `https://airvio.co` and `https://airvio.co/knowgrph` for HTTP status, route ownership, primary HTML and assets, stale asset references, MCP availability, invocation catalog resolution, runtime health, visible exact Knowgrph and Agentic Canvas OS SHA evidence, catalog/docs revision equality, bounded hydration evidence, local-path leakage, legacy aliases, and required responsive smoke paths.

### 11. Report

Report invocation intent, ownership, worktrees, base SHA, memory base ref, planning base ref, planning shard and Context, both append-only comparison results, the planning task-row result, handoffs, reconciled paths, SSOT commit, Dev commits and pull request, Integration Gate, merge SHA, validation and cost evidence, Prod parity, Cloudflare deployment identifiers, verified routes, and remaining risks.

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
- any planning shard is malformed, over cap, historically rewritten, or missing the declared strict task row;
- the active planning shard lacks one appended compliant row for the declared planning Context, or any committed shard prefix changes;
- a required gate fails;
- Dev, Prod, and promoted SHA cannot be reconciled;
- schema mirror parity is stale or missing generated document nodes for the promoted Dev SHA;
- credentials or deployment authority are absent;
- deployment is partial or production verification disagrees with release evidence.

## Completion VCC

Given a protected green merge to Knowgrph `main`, when every ordered automatic stage succeeds, then memory and centralized planning history are proven append-only, the declared planning row is compliant from its recorded base, one application-root runtime owns identity and MainPanel Settings projects it through shared KTV rows, participating runtime identities report identical exact app/docs SHAs, catalog revision equals the docs revision with bounded fresh hydration, Prod represents the exact promoted Dev SHA, both production routes return matching live evidence, and the final ledger reports ownership, validation, cost, deployment, rollback target, and residual risk.

VCC: verify `npm run collaboration:gate` exits zero with two distinct automated peers, at least two active room peers, one common verification digest, remote document propagation, exact app/docs SHA and `/`, `#`, `@` count parity, and fresh catalog hydration in at most two attempts, the memory and planning structural and base-ref commands exit zero, both planning-row commands report their declared Context and a Directive count at or below 50, all other required checks exit zero, the invocation catalog resolves from this repository, Dev and Prod evidence names one promoted SHA, both production URLs pass canonical probes, and execution stops after the first blocker.
