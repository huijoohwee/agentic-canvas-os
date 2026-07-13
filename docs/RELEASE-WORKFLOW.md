---
title: "Knowgrph Runtime-Ready Release Workflow"
graphId: "md:knowgrph-runtime-ready-release-workflow"
doc_type: "Release Workflow Contract"
date: "2026-07-13"
lang: "en-US"
schema: "knowgrph-release-workflow/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "end-to-end Knowgrph release operating model"
publish_policy: "execution requires explicit @operator invocation"
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
  dev: "$GITHUB_ROOT/knowgrph"
  prod_mirror: "$GITHUB_ROOT/huijoohwee/content/knowgrph"
production_routes: ["https://airvio.co", "https://airvio.co/knowgrph"]
stage_order: ["preflight", "reconcile", "ssot", "validate", "integrate", "promote", "deploy", "verify", "report"]
coordination:
  branch_pattern: "agent/<device>/<semantic-scope>"
  one_active_writer: true
  direct_main_push: false
  handoff_identity: "pushed commit SHA"
cost_policy:
  malformed_input_spend: 0
  unauthorized_paid_calls: 0
  proof_provider_mode: "local-or-mock"
completion_requires:
  - "unique semantic-scope ownership"
  - "all required gates pass"
  - "one invocation grammar SSOT"
  - "protected integration"
  - "Prod mirrors the promoted Dev SHA"
  - "both production routes return verified evidence"
---

# Knowgrph Runtime-Ready Release Workflow

## Purpose

`/release.complete #runtime-ready #multi-agent-collaboration @operator @source.frontmatter @runtime-proof` requests the complete Knowgrph release workflow. The invocation opens the release lane but does not weaken validation, ownership, approval, cost, or stop conditions.

The three invocation dictionaries in this folder remain the only `/`, `#`, and `@` authority. Knowgrph and its deployed routes consume their MCP projection; production never reads a developer-machine filesystem path.

## Inputs and Outputs

| Contract | Required fields |
|---|---|
| Input | Operator approval, device identity, semantic scope, task branch, base branch, base SHA, Dev repository, Prod mirror, production routes. |
| Output | Reconciliation ledger, validation ledger, Dev commits and merge SHA, promoted SHA, mirror parity proof, deployment identifiers, production verification, remaining risks. |
| Failure | Typed blocking stage, failed check, unchanged downstream stages, zero fabricated completion claims. |
| Cost | Model, prompt tokens, completion tokens, cache hits, estimated cost, paid-call count, and actual cost when a model-bearing path runs. |

## Operating Model

- Use one task, semantic scope, worktree, branch, and active writer.
- Create `agent/<device>/<semantic-scope>` from the latest `origin/main`.
- Declare `/`, `#`, `@`, base SHA, and ownership before editing.
- Stop when another open pull request owns the semantic scope or the same branch has another writer.
- Hand off only after the sender stops and pushes an exact commit SHA.
- Never push directly to `main`; integrate only through the protected Integration Gate.
- Resolve conflicts at the source owner. Do not stack aliases, backfill generated output, or overwrite unexplained work.

## Stage Contract

### 1. Preflight

Read repository instructions and release contracts. Fetch remotes, then inspect branches, worktrees, open pull requests, nested repositories, remote divergence, and every staged, unstaged, or untracked path. Record the action, semantic scope, actor, branch, base SHA, current Dev SHA, current Prod SHA, and ownership conflicts.

Stop before mutation when ownership is ambiguous, history is non-fast-forward, or another device is writing the same branch.

### 2. Reconcile

Classify dirty paths as requested work, valid concurrent work, generated output, stale or duplicate residue, or unresolved ownership. Preserve valid work. Remove confirmed residue at its source. Forbid destructive reset, force checkout, force-push, silent indefinite stash, broad untracked deletion, and unrelated change absorption.

The stage completes only when no dirty path is unexplained.

### 3. Verify Invocation SSOT

Confirm `agentic-canvas-os` is the expected Git checkout and its required facts and dictionary files parse. Verify every requested token resolves through `FACTS.md` and the three dictionaries. Scan authored Dev and Prod source for copied dictionaries, hardcoded catalogs, invented document aliases, compatibility remaps, and machine-specific absolute paths.

Remove duplicate owners; do not edit generated Prod assets directly.

### 4. Validate Dev

Run repository-declared collaboration, protected-ref, hygiene, source-conflict, affected-test, type, build, runtime-ready, and integration gates. Runtime proof must show the pinned docs dependency, deterministic replay, bounded execution, zero test failures, zero unauthorized paid calls, zero unexplained cost, no proof-harness repository writes, and no deployment side effects.

Stop on any required failure. Never promote by skipping tests, editing fixtures to hide defects, or adding downstream aliases.

### 5. Integrate Dev

Separate unrelated scopes. Commit intentionally, push without force, and open or update a pull request containing action, semantic scope, actor, base SHA, validation, cost, and handoff evidence. Merge only after the protected Integration Gate succeeds. Record the merged Dev SHA as the sole promotion input.

### 6. Promote Prod

Use only canonical publish and synchronization scripts. Treat Dev as authored source and Prod as a generated mirror. Synchronize the merged Dev SHA, remove stale hashed artifacts through the canonical process, and run production build, publish-contract, schema, asset-manifest, and mirror-parity checks.

Require zero unexplained Dev/Prod drift. Never manually patch or backfill the mirror.

### 7. Deploy Cloudflare

Deploy only the verified promoted SHA with repository-owned Cloudflare configuration. Never expose secrets or hardcode account ids, credentials, routes, local paths, or invocation catalogs. Prevent concurrent deployments to the same environment and capture immutable version evidence.

On partial success, stop further mutation and report the exact state. Do not loop or stack patches.

### 8. Verify Production

Verify `https://airvio.co` and `https://airvio.co/knowgrph` for HTTP status, route ownership, primary HTML and assets, stale asset references, MCP availability, invocation catalog resolution, runtime health, promoted-SHA evidence, local-path leakage, legacy aliases, and required responsive smoke paths.

### 9. Report

Report invocation intent, ownership, worktrees, base SHA, handoffs, reconciled paths, SSOT commit, Dev commits and pull request, Integration Gate, merge SHA, validation and cost evidence, Prod parity, Cloudflare deployment identifiers, verified routes, and remaining risks.

## Stop Conditions

Stop without downstream mutation when any of these is true:

- semantic-scope or branch ownership conflicts;
- dirty work cannot be attributed safely;
- required dictionary or runtime proof is missing;
- a required gate fails;
- Dev, Prod, and promoted SHA cannot be reconciled;
- credentials or deployment authority are absent;
- deployment is partial or production verification disagrees with release evidence.

## Completion VCC

Given an explicit `/release.complete` invocation with the required semantics and bindings, when every ordered stage succeeds, then Dev is merged through protected integration, Prod represents the exact promoted Dev SHA, both production routes return matching live evidence, and the final ledger reports ownership, validation, cost, deployment, and residual risk.

VCC: verify all required checks exit zero, the invocation catalog resolves from this repository, Dev and Prod release evidence names one promoted SHA, both production URLs pass their canonical probes, and execution stops after the first blocking stage rather than retrying without a new state change.
