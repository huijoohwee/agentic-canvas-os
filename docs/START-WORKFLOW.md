---
title: "Knowgrph Conflict-Safe Session Start Workflow"
graphId: "md:knowgrph-conflict-safe-session-start-workflow"
doc_type: "Session Start Workflow Contract"
date: "2026-07-13"
lang: "en-US"
schema: "knowgrph-start-workflow/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "Knowgrph Codex session-start and worktree-isolation operating model"
publish_policy: "Dev-only; no Prod mirror or Cloudflare authority"
runtime_scope: "remote synchronization, ownership inspection, branch creation, and isolated Dev worktree startup"
runtime_claim: "bounded session-start contract; reading or resolving this document performs no Git mutation"
runtime_proof: "RUNTIME-PROOF.md"
invocation:
  action: "/session.start"
  semantics: ["#multi-agent-collaboration", "#runtime-ready"]
  bindings: ["@operator", "@working-directory", "@runtime-proof"]
workspace:
  root: "$GITHUB_ROOT"
  invocation_ssot: "$GITHUB_ROOT/agentic-canvas-os/docs"
  dev: "$GITHUB_ROOT/knowgrph"
  prod_mirror: "$GITHUB_ROOT/huijoohwee/content/knowgrph"
  dev_commands: ["npm run dev:apex", "npm run dev"]
production_routes: ["https://airvio.co", "https://airvio.co/knowgrph"]
deploy_gate:
  prod_mirror: "forbidden until explicit operator instruction"
  cloudflare: "forbidden until explicit operator instruction"
operating_priorities: ["minimum-viable-maximum-value", "time-to-value", "high-ROI", "TCO", "token-economics", "FOSS-first"]
coordination:
  base_ref: "origin/main"
  branch_pattern: "agent/<device>/<semantic-scope>"
  one_active_writer: true
  direct_main_push: false
  handoff_identity: "pushed commit SHA"
stage_order: ["discover", "fetch", "inspect", "claim", "isolate", "verify", "start"]
completion_requires:
  - "fetched remote refs"
  - "clean source checkout"
  - "unique semantic-scope ownership"
  - "fresh isolated worktree from origin/main"
  - "recorded branch and base SHA"
---

# Knowgrph Conflict-Safe Session Start Workflow

## Authoritative Rule

Fetch before starting every Codex session; create a fresh isolated worktree from origin/main; pull only when intentionally updating a clean, exclusively owned branch.

`/session.start #multi-agent-collaboration #runtime-ready @operator @working-directory @runtime-proof` requests this pre-build workflow. It grants no release, Prod mirror, Cloudflare, force-push, cleanup, or unrelated-work mutation authority.

`START-WORKFLOW.md` owns session startup. `RELEASE-WORKFLOW.md` owns integration and release after development is complete. The three invocation dictionaries remain the only `/`, `#`, and `@` token authority.

## Session Context Contract

Use this context for every Knowgrph Codex build session. Resolve all paths from `$GITHUB_ROOT`; never persist a developer username or machine-specific absolute path in source, fixtures, tests, generated assets, or documentation.

| Context | Runtime-ready rule |
|---|---|
| Operating model | Operator-led, AI-native startup using typed harnesses and bounded orchestration. Optimize minimum-viable maximum-value, time-to-value, ROI, TCO, and token/cache economics. Prefer FOSS, local, zero-egress, and zero-spend paths when capability is equivalent. |
| Agentic Canvas OS | `$GITHUB_ROOT/agentic-canvas-os/docs` is the global, centralized, frontmatter-first SSOT. `/`, `#`, and `@` resolve only through its three dictionaries and their shared runtime projection. Do not copy invocation catalogs downstream. |
| Dev | Author and run Knowgrph only in the isolated `$WORKTREE`, derived from `$GITHUB_ROOT/knowgrph`. Use `npm run dev:apex` and `npm run dev` through repository-owned scripts. |
| Prod mirror | `$GITHUB_ROOT/huijoohwee/content/knowgrph` is generated release output, never a default edit target. Mutation is forbidden until the operator explicitly requests promotion or release. |
| Cloudflare | `https://airvio.co` and `https://airvio.co/knowgrph` are deployment targets, not completion criteria. Deployment is forbidden until the operator explicitly requests it. |

## Engineering Contract

Apply these rules before accepting or editing a task:

- Keep behavior universal, neutral, provider-agnostic, modular, headless where practical, and source-backed.
- Advance deliberately from `spec-complete` to `runtime-ready`. Runtime-ready work has typed inputs and outputs, bounded orchestration, focused proof, cost evidence, fallbacks, and explicit mutation and deploy gates.
- Forbid repository hardcoding of machine paths, credentials, account identifiers, provider catalogs, runtime-generated values, invocation mirrors, and environment-specific defaults.
- Preserve single responsibility and keep every authored file below 600 lines. Split by owner and behavior, not by arbitrary line slices.
- Reuse shared semantic-key helpers, heuristics, parsers, headless utilities, and unopinionated primitives. Do not fork equivalent logic per surface.
- Neutralize defects at the root source or upstream owner. Do not stack local patches, aliases, compatibility remaps, backfills, or downstream masks.
- Remove confirmed legacy, stale, duplicate, conflicting, and hardcoded behavior completely, including fixtures and tests that preserve obsolete behavior. Do not delete unexplained or concurrently owned work.
- Avoid churn, frozen copies, duplicate state, repeated calculation, recomputation, re-rendering, and unbounded retries or loops. Compute once at the owning boundary, cache only with explicit invalidation, and stop on a typed condition.
- Use semantic HTML elements instead of generic containers when a native element expresses the role.
- Keep media and icon wrappers visible to selection tooling. Do not hide selectable visual structure as `aria-hidden` decoration; retain an accessible name and interaction contract at the owning semantic element.

## Start Declaration

Before editing, record this compact declaration in the task or pull-request ledger:

```yaml
action: /session.start
semantics: ["#multi-agent-collaboration", "#runtime-ready", "#no-hardcode"]
bindings: ["@operator", "@working-directory", "@runtime-proof"]
device: <device>
semantic_scope: <semantic-scope>
branch: agent/<device>/<semantic-scope>
base_ref: origin/main
base_sha: <fetched-origin-main-sha>
worktree: <resolved-sibling-worktree>
active_writer: <single-owner>
acceptance: <observable-vcc>
deploy_boundary: dev-only
```

The declaration is coordination metadata, not a second invocation registry. Values must reflect inspected state; do not insert guessed SHAs, paths, ownership, or completion claims.

## Why Fetch, Not Blind Pull

| Operation | Session-start role | Rule |
|---|---|---|
| `git fetch --prune origin` | Refresh remote-tracking refs without changing the current branch or worktree. | Required before ownership and divergence inspection. |
| `git pull` | Fetch and integrate into the checked-out branch. | Forbidden as a default startup action; allowed only for a clean branch with one confirmed writer and an intentional integration choice. |
| Fresh worktree from `origin/main` | Isolate one task, branch, and writer from other sessions. | Default build lane. |

A pull can merge or rebase into the current branch before its ownership and dirt are understood. Fetch preserves inspection as a read-only-first step.

## Inputs and Outputs

| Contract | Required fields |
|---|---|
| Input | Repository root, device identity, semantic scope, intended action, remote, and base ref. |
| Output | Fetch result, ownership result, source cleanliness, isolated worktree path, task branch, and exact base SHA. |
| Failure | Typed blocking stage and unchanged source, Prod mirror, and Cloudflare state. |
| Cost | Zero model calls and zero paid calls are required for the Git preflight itself. |

## Stage Contract

### 1. Discover

Resolve `$GITHUB_ROOT` from the canonical checkout rather than a user-specific path. Read repository instructions and inspect existing worktrees before changing Git state.

```sh
export GITHUB_ROOT="$(cd "$(git -C agentic-canvas-os rev-parse --show-toplevel)/.." && pwd)"
export KNOWGRPH_ROOT="$GITHUB_ROOT/knowgrph"
git -C "$KNOWGRPH_ROOT" worktree list --porcelain
```

### 2. Fetch

Refresh remote refs before starting Codex or editing files.

```sh
git -C "$KNOWGRPH_ROOT" fetch --prune origin
```

Fetch failure blocks startup. Do not build from assumed-current refs or compensate with repeated pull attempts.

### 3. Inspect

Inspect the source checkout, branch tracking, divergence, worktrees, and open semantic-scope ownership.

```sh
git -C "$KNOWGRPH_ROOT" status --short --branch
git -C "$KNOWGRPH_ROOT" branch --verbose --verbose
git -C "$KNOWGRPH_ROOT" worktree list
git -C "$KNOWGRPH_ROOT" rev-parse origin/main
```

Stop when source dirt is unexplained, `origin/main` is unavailable, or another active branch or pull request owns the same semantic scope.

### 4. Claim

Choose one device identity and one semantic scope. Derive `agent/<device>/<semantic-scope>` without a compatibility alias. Record the intended action, branch, base ref, base SHA, and active writer in the task or pull-request ledger.

One branch has one writer. A second device uses a different semantic scope or waits for an exact pushed-SHA handoff.

### 5. Isolate

Create a sibling worktree directly from the fetched `origin/main`.

```sh
export DEVICE="<device>"
export SEMANTIC_SCOPE="<semantic-scope>"
export BRANCH="agent/$DEVICE/$SEMANTIC_SCOPE"
export WORKTREE="$GITHUB_ROOT/knowgrph-$DEVICE-$SEMANTIC_SCOPE"
git -C "$KNOWGRPH_ROOT" worktree add "$WORKTREE" -b "$BRANCH" origin/main
```

Do not reuse a dirty shared checkout, a branch owned by another session, or an existing path whose state is ambiguous.

### 6. Verify

Verify the new lane before starting the build session.

```sh
git -C "$WORKTREE" status --short --branch
git -C "$WORKTREE" merge-base --is-ancestor origin/main HEAD
git -C "$WORKTREE" rev-parse HEAD
```

The worktree must be clean, the branch must match the claimed scope, and `HEAD` must equal the recorded startup base SHA.

### 7. Start

Start Codex with `$WORKTREE` as its working directory. Declare the task invocation, semantic scope, bindings, branch, base SHA, ownership, acceptance criteria, and deploy boundary before editing.

## Updating an Existing Owned Branch

Use pull only when all conditions are true:

- the branch is intentionally being updated rather than used as a fresh task lane;
- the worktree is clean;
- the current branch is not `main`;
- exactly one active writer owns the branch;
- its upstream is verified;
- the chosen merge or rebase behavior is explicit.

Otherwise fetch, inspect, and create a new reconciliation or task worktree. Never use pull to absorb unexplained dirt or resolve multi-writer ownership.

## Handoff and Conflict Rules

- A handoff names the exact pushed commit SHA; the sender stops writing before the receiver starts.
- Reconcile upstream changes in the isolated task branch before final validation.
- Resolve conflicts at the source owner; remove stale or duplicate logic instead of stacking aliases or downstream patches.
- Use force-with-lease only when repository policy allows it and one writer is reconfirmed; otherwise use a new reconciliation branch.
- Keep `main` read-only for agents and integrate through the protected Integration Gate.

## Stop Conditions

Stop before build mutation when fetch fails, source dirt is unexplained, branch ownership is ambiguous, the semantic scope is already active, the base ref is missing, the worktree path or branch already exists unexpectedly, or the startup SHA cannot be proven.

## Completion VCC

Given a declared device and semantic scope, when `/session.start` completes, then remote refs are fetched, ownership is unique, a clean isolated worktree exists on `agent/<device>/<semantic-scope>` from the fetched `origin/main`, and Codex starts only inside that lane.

VCC: verify the fetch exits zero, the source checkout remains unchanged, the new worktree is clean, its `HEAD` equals the recorded `origin/main` base SHA, one writer owns the branch, and no Prod mirror or Cloudflare action occurred.
