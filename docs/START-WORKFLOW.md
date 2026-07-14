---
title: "Knowgrph Conflict-Safe Session Start Workflow"
graphId: "md:knowgrph-conflict-safe-session-start-workflow"
doc_type: "Session Start Workflow Contract"
date: "2026-07-14"
lang: "en-US"
schema: "knowgrph-start-workflow/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "Knowgrph Codex session-start and single-checkout operating model"
publish_policy: "Dev-only; no Prod mirror or Cloudflare authority"
runtime_scope: "remote synchronization, ownership inspection, and task-branch activation in one canonical Dev checkout"
runtime_claim: "bounded session-start contract; reading or resolving this document performs no Git mutation"
runtime_proof: "RUNTIME-PROOF.md"
contradiction_policy: "any instruction to create, retain, or use a secondary worktree is invalid and blocks startup"
invocation:
  action: "/session.start"
  semantics: ["#multi-agent-collaboration", "#runtime-ready"]
  bindings: ["@operator", "@working-directory", "@runtime-proof"]
workspace:
  root: "$GITHUB_ROOT"
  invocation_ssot: "$GITHUB_ROOT/agentic-canvas-os/docs"
  invocation_ssot_ref: "origin/main"
  memory_contract: "$GITHUB_ROOT/agentic-canvas-os/docs/MEMORY-LOG.md"
  memory_root: "$GITHUB_ROOT/agentic-canvas-os/memory"
  planning_contract: "$GITHUB_ROOT/agentic-canvas-os/docs/TODO.md"
  planning_root: "$GITHUB_ROOT/agentic-canvas-os/todo"
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
  one_worktree_per_repository: true
  direct_main_push: false
  handoff_identity: "pushed commit SHA"
stage_order: ["discover", "fetch", "inspect", "claim", "activate", "verify", "memory", "planning", "start"]
completion_requires:
  - "fetched remote refs"
  - "clean canonical Agentic Canvas OS checkout at fetched origin/main"
  - "clean source checkout"
  - "unique semantic-scope ownership"
  - "exactly one registered worktree per repository"
  - "task branch active in the canonical Knowgrph checkout"
  - "recorded branch and base SHA"
  - "memory-log structural compliance"
  - "monthly planning-shard structural compliance"
---

# Knowgrph Conflict-Safe Session Start Workflow

## Authoritative Rule

Fetch before starting every Codex session; require exactly one registered worktree in each repository; activate the task branch only in the canonical checkout; pull only when intentionally updating a clean, exclusively owned branch.

The single canonical checkout rule has precedence over every older workflow, template, script description, task note, or historical example. Any instruction to create, retain, or use a secondary worktree is contradictory and invalid. Stop and correct the source contract instead of executing that instruction.

`/session.start #multi-agent-collaboration #runtime-ready @operator @working-directory @runtime-proof` requests this pre-build workflow. It grants no release, Prod mirror, Cloudflare, force-push, cleanup, or unrelated-work mutation authority.

`START-WORKFLOW.md` owns session startup. `RELEASE-WORKFLOW.md` owns integration and release after development is complete. The three invocation dictionaries remain the only `/`, `#`, and `@` token authority.

## Session Context Contract

Use this context for every Knowgrph Codex build session. Resolve all paths from `$GITHUB_ROOT`; never persist a developer username or machine-specific absolute path in source, fixtures, tests, generated assets, or documentation.

| Context | Runtime-ready rule |
|---|---|
| Operating model | Operator-led, AI-native startup using typed harnesses and bounded orchestration. Optimize minimum-viable maximum-value, time-to-value, ROI, TCO, and token/cache economics. Prefer FOSS, local, zero-egress, and zero-spend paths when capability is equivalent. |
| Agentic Canvas OS | `$GITHUB_ROOT/agentic-canvas-os/docs` is the global, centralized, frontmatter-first SSOT. Exactly one registered worktree is allowed, and its canonical checkout must be clean and exactly equal to fetched `origin/main` before a normal Knowgrph Dev port starts; Knowgrph task mode does not relax this dependency. `/`, `#`, and `@` resolve only through the three dictionaries and their shared runtime projection. Do not copy invocation catalogs downstream. |
| Memory log | `$GITHUB_ROOT/agentic-canvas-os/memory/YYYY-MM.md` is append-only history governed by `MEMORY-LOG.md`. YAML owns only file identity; entries must use exact `## @mem-YYYYMMDDTHHmmssZ` UTC sigil-header blocks. A malformed shard blocks session startup. |
| Cross-repository planning | `$GITHUB_ROOT/agentic-canvas-os/todo/YYYY-MM.md` is append-only planning history governed by `TODO.md`. Load the active month by default, keep closed months immutable, and block startup on malformed identity, month, lifecycle, ordering, or size. |
| Dev | Author and run Knowgrph only in the canonical `$GITHUB_ROOT/knowgrph` checkout. Use `npm run dev:apex` and `npm run dev` through repository-owned scripts. |
| Planning authority | `TODO.md` plus the active `$GITHUB_ROOT/agentic-canvas-os/todo/YYYY-MM.md` shard are the sole live planning owner. Repository-local todo files are forbidden. |
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
memory_base_ref: <fetched-agentic-canvas-os-origin-main-sha>
memory_compliance: passed
planning_base_ref: <fetched-agentic-canvas-os-origin-main-sha>
planning_shard: todo/<utc-year-month>.md
planning_context: <exact-unique-cross-repository-task-context>
planning_compliance: structure-passed
checkout: $GITHUB_ROOT/knowgrph
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
| Canonical checkout branch activation | Keep the running Dev port and edited source on the same filesystem path. | The only build lane; `git worktree add` is forbidden. |

A pull can merge or rebase into the current branch before its ownership and dirt are understood. Fetch preserves inspection as a read-only-first step.

## Inputs and Outputs

| Contract | Required fields |
|---|---|
| Input | Repository root, device identity, semantic scope, intended action, remote, and base ref. |
| Output | Fetch result, ownership result, single-worktree proof, canonical checkout path, task branch, and exact base SHA. |
| Failure | Typed blocking stage and unchanged source, Prod mirror, and Cloudflare state. |
| Cost | Zero model calls and zero paid calls are required for the Git preflight itself. |

## Stage Contract

### 1. Discover

Resolve `$GITHUB_ROOT` from the canonical checkout rather than a user-specific path. Read repository instructions and prove that each repository has exactly one registered worktree before changing Git state.

```sh
export GITHUB_ROOT="$(cd "$(git -C agentic-canvas-os rev-parse --show-toplevel)/.." && pwd)"
export AGENTIC_CANVAS_OS_ROOT="$GITHUB_ROOT/agentic-canvas-os"
export KNOWGRPH_ROOT="$GITHUB_ROOT/knowgrph"
git -C "$AGENTIC_CANVAS_OS_ROOT" worktree list --porcelain
git -C "$KNOWGRPH_ROOT" worktree list --porcelain
```

### 2. Fetch

Refresh remote refs before starting Codex or editing files.

```sh
git -C "$AGENTIC_CANVAS_OS_ROOT" fetch --prune origin
git -C "$KNOWGRPH_ROOT" fetch --prune origin
```

Fetch failure blocks startup. Do not build from assumed-current refs or compensate with repeated pull attempts.

### 3. Inspect

Inspect the source checkout, branch tracking, divergence, worktrees, and open semantic-scope ownership.

```sh
git -C "$AGENTIC_CANVAS_OS_ROOT" status --short --branch
git -C "$AGENTIC_CANVAS_OS_ROOT" rev-parse HEAD
git -C "$AGENTIC_CANVAS_OS_ROOT" rev-parse origin/main
git -C "$KNOWGRPH_ROOT" status --short --branch
git -C "$KNOWGRPH_ROOT" branch --verbose --verbose
git -C "$KNOWGRPH_ROOT" worktree list
git -C "$KNOWGRPH_ROOT" rev-parse origin/main
```

Stop when either repository reports other than one registered worktree, either canonical source has unexplained dirt, either `origin/main` is unavailable, Agentic Canvas OS `HEAD` differs from its fetched `origin/main`, or another active branch or pull request owns the same semantic scope.

### 4. Claim

Choose one device identity and one semantic scope. Derive `agent/<device>/<semantic-scope>` without a compatibility alias. Record the intended action, branch, base ref, base SHA, and active writer in the task or pull-request ledger.

One branch has one writer. A second device uses a different semantic scope or waits for an exact pushed-SHA handoff.

### 5. Activate

Create or activate the owned task branch in the one canonical Knowgrph checkout. For a new task branch:

```sh
export DEVICE="<device>"
export SEMANTIC_SCOPE="<semantic-scope>"
export BRANCH="agent/$DEVICE/$SEMANTIC_SCOPE"
git -C "$KNOWGRPH_ROOT" switch --create "$BRANCH" origin/main
```

If the owned branch already exists, inspect its exact SHA and upstream before switching to it. Never run `git worktree add`, create a detached live checkout, reuse a dirty checkout, or activate a branch owned by another session. Branches preserve task history; additional filesystem worktrees create source drift and are forbidden.

### 6. Verify

Verify the canonical checkout before starting the build session.

```sh
git -C "$KNOWGRPH_ROOT" worktree list --porcelain
git -C "$KNOWGRPH_ROOT" status --short --branch
git -C "$KNOWGRPH_ROOT" merge-base --is-ancestor origin/main HEAD
git -C "$KNOWGRPH_ROOT" rev-parse HEAD
```

The repository must report exactly one registered worktree at `$KNOWGRPH_ROOT`; the checkout must be clean, the branch must match the claimed scope, and `HEAD` must equal the recorded startup base SHA.

### 7. Verify Memory Log

Set `MEMORY_ROOT` to `$AGENTIC_CANVAS_OS_ROOT/memory` and run the structural memory-log command under `Memory Log Compliance Checks` in `VALIDATION-RUNBOOK.md`.

The gate requires `memory-log/v1` frontmatter, matching filename and period, immutable agent/device identity, `timestamp_format: YYYYMMDDTHHmmssZ`, `append-only` policy, exact `## @mem-YYYYMMDDTHHmmssZ` UTC headings that parse to real instants in the containing shard month, unique chronological sigils, and exactly one `type`, `scope`, `summary`, and Markdown-array `refs` field per entry. Local-time, offset, minute-only, hyphenated, impossible-date, or wrong-month sigils, pure YAML entry lists, Markdown tables, bolded sigils, fenced per-entry YAML, empty shards, and unsafe content fail closed.

Record the fetched Agentic Canvas OS `origin/main` SHA as `memory_base_ref`. Do not repair a failure by rewriting, reordering, compacting, or deleting history; restore the canonical bytes or append a new superseding record on an authorized task branch.

### 8. Verify Monthly Planning Shards

Set `PLANNING_ROOT` to `$AGENTIC_CANVAS_OS_ROOT/todo` and run the structural command under `Planning Shard Compliance Checks` in `VALIDATION-RUNBOOK.md`.

The gate validates `TODO.md`, every `todo-log/v1` shard, filename-period identity, one scope, active/closed lifecycle, chronological unique UTC date headings, month boundaries, and the 500,000-byte and 599-line caps. Record the fetched Agentic Canvas OS SHA as `planning_base_ref`, the active shard, and one stable `planning_context` for the task row.

Imported pre-adoption rows remain historical evidence. Do not normalize them in place. New rows append at EOF and follow the strict row contract in `TODO.md`.

### 9. Start

Start Codex with `$KNOWGRPH_ROOT` as its working directory. Declare the task invocation, semantic scope, bindings, branch, base SHA, ownership, acceptance criteria, and deploy boundary before editing. Knowgrph `predev` independently rechecks the single-worktree invariant before Vite can bind a port.

## Updating an Existing Owned Branch

Use pull only when all conditions are true:

- the branch is intentionally being updated rather than used as a fresh task lane;
- the canonical checkout is clean;
- the current branch is not `main`;
- exactly one active writer owns the branch;
- its upstream is verified;
- the chosen merge or rebase behavior is explicit.

Otherwise fetch, inspect, and activate a new reconciliation or task branch in the canonical checkout. Never use pull to absorb unexplained dirt or resolve multi-writer ownership.

## Handoff and Conflict Rules

- A handoff names the exact pushed commit SHA; the sender stops writing before the receiver starts.
- Reconcile upstream changes in the owned task branch before final validation.
- Resolve conflicts at the source owner; remove stale or duplicate logic instead of stacking aliases or downstream patches.
- Use force-with-lease only when repository policy allows it and one writer is reconfirmed; otherwise use a new reconciliation branch.
- Keep `main` read-only for agents and integrate through the protected Integration Gate.

## Stop Conditions

Stop before build mutation when either repository has other than one registered worktree, fetch fails, source dirt is unexplained, branch ownership is ambiguous, the semantic scope is already active, the base ref is missing, the branch exists unexpectedly, the startup SHA cannot be proven, any memory or planning shard fails structural compliance, a planning shard exceeds its cap, or a repository-local todo file is presented as live authority.

## Completion VCC

Given a declared device and semantic scope, when `/session.start` completes, then both repositories' remote refs are fetched, each repository reports exactly one registered worktree, the canonical Agentic Canvas OS checkout is clean and exactly equal to fetched `origin/main`, every memory and planning shard is structurally compliant, the active planning shard and Context are declared, no repository-local todo file claims authority, ownership is unique, the canonical Knowgrph checkout is clean on `agent/<device>/<semantic-scope>`, and Codex starts only from that path.

VCC: verify both fetches exit zero, each `git worktree list --porcelain` contains exactly one `worktree` record, Agentic Canvas OS is clean with `HEAD` equal to fetched `origin/main`, the memory and planning structural commands exit zero, the memory and planning base refs plus the declared planning Context are recorded, repository-local todo files are absent, the canonical Knowgrph checkout is clean at its recorded base SHA, one writer owns the branch, and no Prod mirror or Cloudflare action occurred.
