---
title: "Knowgrph Conflict-Safe Session Start Workflow"
graphId: "md:knowgrph-conflict-safe-session-start-workflow"
doc_type: "Session Start Workflow Contract"
date: "2026-07-18"
lang: "en-US"
schema: "knowgrph-start-workflow/v2"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "Knowgrph Codex session-start and same-device multi-worktree operating model"
publish_policy: "Dev-only; no Prod mirror or Cloudflare authority"
runtime_scope: "remote synchronization, ownership inspection, and isolated task-branch activation in registered worktrees"
runtime_claim: "bounded session-start contract; reading or resolving this document performs no Git mutation"
runtime_proof: "RUNTIME-PROOF.md"
contradiction_policy: "unregistered, shared-branch, unleased, or runtime-serving task worktrees are invalid and block startup"
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
  dev_commands: ["npm run dev:apex", "npm run dev", "npm run dev:latest"]
production_routes: ["https://airvio.co", "https://airvio.co/knowgrph"]
deploy_gate:
  prod_mirror: "automatic only after protected main integration under CANONICAL-LIFECYCLE.md"
  cloudflare: "automatic only through the repository-owned release controller after protected main integration"
operating_priorities: ["minimum-viable-maximum-value", "time-to-value", "high-ROI", "TCO", "token-economics", "FOSS-first"]
coordination:
  base_ref: "origin/main"
  branch_pattern: "^agent/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$"
  device_segment_contract: "lowercase alphanumeric boundaries with interior dot, underscore, or hyphen"
  semantic_scope_segment_contract: "lowercase alphanumeric boundaries with interior hyphen only"
  one_active_writer_per_worktree: true
  parallel_worktrees_per_repository: true
  canonical_main_worktree: true
  direct_main_push: false
  handoff_identity: "pushed commit SHA"
  writer_lease_schema: "agentic-writer-lease/v2"
  writer_lease_registry_schema: "agentic-writer-lease-registry/v2"
  writer_lease_ttl_seconds: 1800
  writer_lease_registry: "one atomic Git-common-directory registry keyed by branch plus one draft ownership pull request per semantic scope"
  fencing_identity: "monotonic lease epoch plus claim commit SHA"
stage_order: ["discover", "fetch", "inspect", "claim", "activate", "verify", "memory", "planning", "start"]
completion_requires:
  - "fetched remote refs"
  - "clean canonical Agentic Canvas OS checkout at fetched origin/main"
  - "clean source checkout"
  - "unique semantic-scope ownership"
  - "unexpired session-bound writer lease with matching draft pull request and fencing SHA"
  - "one clean registered main worktree plus zero or more isolated registered task worktrees"
  - "task branch active only in its leased task worktree"
  - "recorded branch and base SHA"
  - "visible runtime identity with exact Knowgrph, Agentic Canvas OS, and catalog revisions"
  - "one application-root canonical identity owner with a MainPanel Settings KTV projection"
  - "repository-owned collaboration gate pass with two isolated runtime peers and one common verification digest when parity is claimed"
  - "fresh revision-keyed catalog hydration within at most two explicit refresh attempts"
  - "memory-log structural compliance"
  - "monthly planning-shard structural compliance"
---

# Knowgrph Conflict-Safe Session Start Workflow

## Authoritative Rule

Fetch before starting every Codex session; keep one clean registered `main` worktree as the runtime and synchronization owner; activate each task branch only in its own registered task worktree; pull only when intentionally updating a clean, exclusively owned branch.

The canonical `main` worktree remains the only Dev runtime and synchronization owner. Linked task worktrees are mutation lanes only: each must be registered, detached at fetched `origin/main` before claim, bound to one distinct `agent/<device>/<semantic-scope>` branch, protected by its own unexpired lease, and excluded from canonical ports. The Agentic Canvas OS supervisor may own those ports only after both canonical repositories are clean exact fetched `origin/main` revisions with required protected checks successful. Unregistered copies, the same branch in multiple worktrees, `--ignore-other-worktrees`, and task-worktree runtime sources are forbidden.

Parallel chats on the same device may mutate different semantic scopes concurrently when each owns a different registered task worktree, branch, lease, and draft pull request. The Git common directory holds one atomic lease registry across all linked worktrees. The same worktree, branch, or semantic scope always serializes behind the current fencing SHA.

`/session.start #multi-agent-collaboration #runtime-ready @operator @working-directory @runtime-proof` requests this pre-build workflow. It grants no release, Prod mirror, Cloudflare, force-push, cleanup, or unrelated-work mutation authority.

`START-WORKFLOW.md` owns session startup. `RELEASE-WORKFLOW.md` owns integration and release after development is complete. The three invocation dictionaries remain the only `/`, `#`, and `@` token authority.

## Session Context Contract

Use this context for every Knowgrph Codex build session. Resolve all paths from `$GITHUB_ROOT`; never persist a developer username or machine-specific absolute path in source, fixtures, tests, generated assets, or documentation.

| Context | Runtime-ready rule |
|---|---|
| Operating model | Operator-led, AI-native startup using typed harnesses and bounded orchestration. Optimize minimum-viable maximum-value, time-to-value, ROI, TCO, and token/cache economics. Prefer FOSS, local, zero-egress, and zero-spend paths when capability is equivalent. |
| Agentic Canvas OS | `$GITHUB_ROOT/agentic-canvas-os/docs` in the registered `main` worktree is the global, centralized, frontmatter-first SSOT. It must be clean and exactly equal to fetched `origin/main` before a normal Knowgrph Dev port starts. Additional registered task worktrees may author isolated branches but never become runtime docs sources. `/`, `#`, and `@` resolve only through the three dictionaries and their shared runtime projection. |
| Memory log | `$GITHUB_ROOT/agentic-canvas-os/memory/YYYY-MM.md` is append-only history governed by `MEMORY-LOG.md`. YAML owns only file identity; entries must use exact `## @mem-YYYYMMDDTHHmmssZ` UTC sigil-header blocks. A malformed shard blocks session startup. |
| Cross-repository planning | `$GITHUB_ROOT/agentic-canvas-os/todo/YYYY-MM.md` is append-only planning history governed by `TODO.md`. Load the active month by default, keep closed months immutable, and block startup on malformed identity, month, lifecycle, ordering, or size. |
| Dev | Author in leased task worktrees. Run Knowgrph only from the clean registered `main` worktree at `$GITHUB_ROOT/knowgrph`; Agentic Canvas OS owns the fixed Apex `5173` and storage `8787` supervisor after exact-main and protected-check verification. |
| Immutable publication | Use Knowgrph's repository-owned `npm run release:publish:immutable -- ...` object lane only for an already-created commit whose writer stopped or when recovering a checkout-independent delivery. Require the exact source SHA, target ref, expected remote SHA, pinned Agentic Canvas OS SHA, and generated manifest; forbid branch switching, staging, worktree creation, application startup, merge, release, or deployment. |
| Planning authority | `TODO.md` plus the active `$GITHUB_ROOT/agentic-canvas-os/todo/YYYY-MM.md` shard are the sole live planning owner. Repository-local todo files are forbidden. |
| Prod mirror | `$GITHUB_ROOT/huijoohwee/content/knowgrph` is generated release output, never a default edit target. Only the protected-main automatic release controller may publish it. |
| Cloudflare | `https://airvio.co` and `https://airvio.co/knowgrph` are deployment targets, not completion criteria. Only the protected-main automatic release controller may deploy them. |

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
knowgrph_runtime_sha: <visible-running-knowgrph-sha>
agentic_canvas_os_runtime_sha: <visible-running-docs-sha>
catalog_revision: <visible-running-docs-sha>
catalog_hydration: <fresh|blocked|stale>
catalog_refresh_attempts: <integer-0-to-2>
memory_base_ref: <fetched-agentic-canvas-os-origin-main-sha>
memory_compliance: passed
planning_base_ref: <fetched-agentic-canvas-os-origin-main-sha>
planning_shard: todo/<utc-year-month>.md
planning_context: <exact-unique-cross-repository-task-context>
planning_compliance: structure-passed
main_worktree: $GITHUB_ROOT/knowgrph
task_worktree: <registered-task-worktree-path>
active_writer: <single-owner>
writer_session: <stable-chat-or-task-id>
writer_repository: <registered-task-worktree-path>
writer_lease_epoch: <positive-integer>
writer_lease_expires_at: <utc-instant>
writer_fence_sha: <40-hex-claim-commit>
acceptance: <observable-vcc>
deploy_boundary: dev-only
```

The declaration is coordination metadata, not a second invocation registry. Values must reflect inspected state; do not insert guessed SHAs, paths, ownership, or completion claims.

## Why Fetch, Not Blind Pull

| Operation | Session-start role | Rule |
|---|---|---|
| `git fetch --prune origin` | Refresh remote-tracking refs without changing the current branch or worktree. | Required before ownership and divergence inspection. |
| `git pull` | Fetch and integrate into the checked-out branch. | Forbidden as a default startup action; allowed only for a clean branch with one confirmed writer and an intentional integration choice. |
| `npm run dev:latest` | Explicitly refresh clean canonical `main` sources and start Knowgrph. | Allowed only from each registered main worktree when it is clean and fast-forwardable; task worktrees do not participate in runtime refresh. |
| Registered task worktree activation | Isolate a semantic scope without disturbing `main` or another task. | Create detached at fetched `origin/main`, then claim exactly one branch and per-worktree lease; never use `--ignore-other-worktrees`. |

A pull can merge or rebase into the current branch before its ownership and dirt are understood. Fetch preserves inspection as a read-only-first step.

### Explicit Canonical Dev Refresh

Use the repository-owned command when a normal canonical Dev restart reports that clean local `main` is behind a fetched `origin/main`:

```sh
git -C "$KNOWGRPH_ROOT" status --short --branch
npm --prefix "$KNOWGRPH_ROOT" run dev:latest
```

The command reads the canonical source registry, fetches every source, and completes a two-phase safety check before changing a main worktree. Every main source must have no local changes, its canonical branch active, and `HEAD` as an ancestor of the fetched canonical ref. Registered task worktrees are inspected for conflicts but are never switched, merged, or used as runtime source. Only after the full set passes does the command apply `git merge --ff-only` to the main worktrees and delegate to ordinary fail-closed Dev startup.

Do not use `dev:latest` for an owned task branch. On a contract-valid `agent/<device>/<semantic-scope>` branch, start with `npm run dev` or `npm run dev:apex`; the Knowgrph guard selects task mode automatically. `KG_DEV_SOURCE_MODE` remains an expert override. Reconcile task-branch upstream history through the task workflow rather than changing it during Dev startup.

### Checkout-Free Immutable Publication

The object lane remains available only for an already-created commit whose writer has stopped. Normal authoring now belongs in a leased registered task worktree, so immutable publication is a recovery/integration path rather than the concurrency mechanism. The command must verify the source commit and tree, require an expected remote head, prove fast-forward ancestry, read the pinned docs SHA from that source object, generate a schema-valid app/docs/catalog manifest under Git metadata, push the exact SHA to one unprotected task ref, and verify the resulting remote ref. It must never switch, stage, reset, stash, restore, merge, create a worktree, touch authored files, or deploy.

```sh
npm --prefix "$KNOWGRPH_ROOT" run release:publish:immutable -- \
  --source-sha "<exact-source-sha>" \
  --target-ref "refs/heads/agent/<device>/<semantic-scope>" \
  --expected-remote-sha "<exact-current-remote-sha>"
```

The repository-owned command may bypass the checkout-oriented hook only after its own object gate succeeds, and the manifest records that bounded hook mode. Manual `git push --no-verify`, raw refspec publication, force, or a missing manifest fails compliance. The remote Integration Gate remains authoritative and must download and validate the same manifest against its exact pull-request head and pinned Agentic Canvas OS checkout.

## Inputs and Outputs

| Contract | Required fields |
|---|---|
| Input | Repository root, device identity, semantic scope, intended action, remote, and base ref. |
| Output | Fetch result, worktree registration, ownership result, main and task worktree paths, task branch, lease identity, and exact base SHA. |
| Failure | Typed blocking stage and unchanged source, Prod mirror, and Cloudflare state. |
| Cost | Zero model calls and zero paid calls are required for the Git preflight itself. |

## Stage Contract

### 1. Discover

Resolve `$GITHUB_ROOT` from the registered main worktree rather than a user-specific path. Read repository instructions and enumerate every registered worktree before changing Git state.

```sh
export GITHUB_ROOT="$(cd "$(git -C agentic-canvas-os rev-parse --show-toplevel)/.." && pwd)"
export AGENTIC_CANVAS_OS_ROOT="$GITHUB_ROOT/agentic-canvas-os"
export KNOWGRPH_ROOT="$GITHUB_ROOT/knowgrph"
git -C "$AGENTIC_CANVAS_OS_ROOT" worktree list --porcelain -z
git -C "$KNOWGRPH_ROOT" worktree list --porcelain -z
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

Stop when a listed worktree is missing, prunable, unregistered, on a duplicate checked-out branch, or contains unexplained dirt; when either `origin/main` is unavailable; when either registered main worktree differs from its fetched `origin/main`; or when another active branch, lease, or pull request owns the same semantic scope. Dirt in another task worktree blocks only that worktree and any overlapping scope, not an unrelated isolated task lane.

### 4. Claim

Choose one device identity, one stable chat/task session id, and one semantic scope. Derive `agent/<device>/<semantic-scope>` without a compatibility alias. Record the intended action, branch, base ref, base SHA, active writer, lease epoch, expiry, and fencing SHA in the task and draft pull-request metadata.

The device segment preserves valid lowercase hostname identity, including interior dots such as `.local`, underscores, and hyphens, while requiring alphanumeric boundaries. The semantic-scope segment permits only lowercase alphanumerics and interior hyphens. Normalize and validate both segments before fetch, branch switch, lease claim, commit, push, or pull-request mutation so rejected identity input cannot change checkout state.

One task worktree, branch, and semantic scope have one writer. A second chat on the same device may claim another detached registered task worktree for a different scope. A same-scope chat waits for an exact pushed-SHA handoff. Draft pull requests for different scopes may coexist; duplicate active scope ownership fails closed.

### 5. Activate

Create a detached linked task worktree at fetched `origin/main`, then create the owned task branch and remote draft ownership record through the repository command. The command atomically claims the branch entry in `.git/agentic-canvas-os/writer-leases.json`, increments the shared registry epoch, creates a no-content claim commit, pushes the task branch, and opens the draft pull request before normal authoring:

```sh
export AGENTIC_SESSION_ID="<stable-chat-or-task-id>"
export TASK_WORKTREE="$GITHUB_ROOT/.worktrees/knowgrph/<semantic-scope>"
git -C "$KNOWGRPH_ROOT" worktree add --detach "$TASK_WORKTREE" origin/main
npm --prefix "$AGENTIC_CANVAS_OS_ROOT" run device:start -- \
  "<semantic-scope>" --session="$AGENTIC_SESSION_ID" \
  --repository="$TASK_WORKTREE"
```

Machine supervisors may safely provision the new detached worktree and claim it in one command. Canonical `main` must be clean at fetched `origin/main`, and the absent target must be a safe direct child of the derived sibling `.worktrees/<repository-name>` root:

```sh
npm --prefix "$AGENTIC_CANVAS_OS_ROOT" run device:start -- \
  "<semantic-scope>" --session="$AGENTIC_SESSION_ID" \
  --repository="$KNOWGRPH_ROOT" --provision --worktree="$TASK_WORKTREE" --json
```

If this combined call is interrupted after the claim, retry from the recorded
`$TASK_WORKTREE` without `--provision`. `device:start` reconciles only the exact
same-session activation base, claim subject, fence, remote head, and single
matching draft pull request; it does not add another claim commit or pull
request. A target, branch, lease, PR, or session mismatch fails closed.

Heartbeat before the 30-minute default TTL expires:

```sh
npm --prefix "$AGENTIC_CANVAS_OS_ROOT" run device:heartbeat -- \
  --session="$AGENTIC_SESSION_ID" --repository="$TASK_WORKTREE"
```

Heartbeat independently queries the exact ownership PR and requires it to remain draft before renewing the local lease. Manual readiness or any PR identity mismatch fails closed without extending the TTL.

If the owned branch already exists, inspect its exact SHA, draft pull request, lease metadata, upstream, and registered worktree before switching to it. An expired lease does not authorize silent takeover: the prior writer must park or hand off its exact pushed SHA, after which the receiver claims the next epoch. The only renewal exception is exact same-session replay of an incomplete start or resume claim: session, worktree, branch, base, epoch, empty-claim shape, draft PR marker, and remote handoff/fence must still match, and a competing remote fence wins. Never reuse a dirty worktree, activate one branch in multiple worktrees, use `--ignore-other-worktrees`, or activate a branch owned by another session.

Resume only a parked or expired handoff branch, an exact review-ready handoff, or a delivered branch that the same session must revise after a failed protected check. Review-ready and same-session delivery resume first demote a ready PR, independently prove it is draft, and only then claim `remote epoch + 1`. Review-ready work may reactivate in its attached worktree and transfer sessions only when local HEAD, remote HEAD, review-head evidence, PR metadata, and the prior fence match exactly. A same-session parked task may retain committed local descendants ahead of the remote only when its local registry, worktree, branch, pull request, epoch, fence, and ancestry all match; cross-session parked handoff still requires the exact remote head. The command creates a descendant fencing commit and performs a normal fast-forward push; concurrent receivers cannot both win, and another session cannot reclaim delivery. A retry interrupted after demotion, claim, empty commit, annotation, push, or PR-body edit reconciles only the exact same-session successor and single-parent empty claim commit, then completes only the missing steps:

```sh
npm --prefix "$AGENTIC_CANVAS_OS_ROOT" run device:resume -- \
  "agent/<origin-device>/<semantic-scope>" --session="$AGENTIC_SESSION_ID" \
  --repository="$TASK_WORKTREE"
```

### 6. Verify

Verify the registered task worktree before starting the build session.

```sh
git -C "$TASK_WORKTREE" worktree list --porcelain -z
git -C "$TASK_WORKTREE" status --short --branch
git -C "$TASK_WORKTREE" merge-base --is-ancestor origin/main HEAD
git -C "$TASK_WORKTREE" rev-parse HEAD
```

The task path must appear exactly once in the worktree registry; its branch must appear in no other worktree; the checkout must be clean; the branch must match the claimed scope; the lease session, worktree path, and epoch must be current; its exact open pull request must own that scope and report `isDraft: true`; and the claim commit must be an ancestor of `HEAD`.

#### Automated Collaboration And Runtime Identity Gate

Before claiming parity or handing off a running surface, run the repository-owned gate from Agentic Canvas OS:

```sh
npm run collaboration:gate
```

This command creates isolated local owner and guest browser contexts and a local storage worker or reuses healthy services. It does not require two physical devices, visual comparison, clipboard transfer, or runtime-identity JSON files. Matching branch names, ports, routes, or labels do not satisfy the gate.

Open the gate through MainPanel Settings. `Cross-device Identity Gate` must be one collapsible section inside the Settings body, below the shared KTV header, and every identity field/action must use the shared Key-Type-Value row contract. A gate above the KTV header, in Skills & Commands, or rendered through a private table/list layout fails startup compliance.

The gate's focused checks must prove that Knowgrph mounts exactly one canonical identity runtime at the application root. Settings consumes that global snapshot; `/`, `#`, and `@` catalog hydration may publish the docs revision, counts, and hydration state as one facet but must not define, scope, or own the identity component. Any second store, surface-local owner, or catalog-coupled Settings identity hook blocks parity even when the displayed SHAs happen to match.

The automated peers join the dedicated identity room with separate authenticated sessions and runtime identities. The room issues a short-lived challenge, the reporters read the canonical identity snapshot, and the gate verifies distinct peers plus challenge, TTL, digest, exact revisions, hydration, counts, and remote document propagation. Continue only when the command exits zero with `2/2` peers and a non-empty common verification digest. `collecting`, `mismatch`, `stale`, `blocked`, transport failure, duplicate/replayed evidence, room-key mismatch, or different digests blocks startup parity. `Copy diagnostic JSON` is optional troubleshooting only.

The identity must also report `catalogRevision`, `catalogHydration.status`, `catalogHydration.attempts`, and separate `/`, `#`, and `@` counts. Require `catalogRevision == agenticCanvasOsRevision`. Hydration and cache keys must include the docs revision so a revision change invalidates the prior catalog instead of reusing a page-lifetime snapshot.

When the catalog revision is absent or mismatched, expose an explicit refresh action. Permit at most two refresh attempts for that revision. A successful attempt reports `fresh`; exhaustion reports `blocked` or `stale`, keeps the mismatched revision visible, and blocks parity and runtime-ready claims. A page reload may be one explicit attempt, but silent or unbounded background retries are forbidden.

### 7. Verify Memory Log

Set `MEMORY_ROOT` to `$AGENTIC_CANVAS_OS_ROOT/memory` and run the structural memory-log command under `Memory Log Compliance Checks` in `VALIDATION-RUNBOOK.md`.

The gate requires `memory-log/v1` frontmatter, matching filename and period, immutable agent/device identity, `timestamp_format: YYYYMMDDTHHmmssZ`, `append-only` policy, exact `## @mem-YYYYMMDDTHHmmssZ` UTC headings that parse to real instants in the containing shard month, unique chronological sigils, and exactly one `type`, `scope`, `summary`, and Markdown-array `refs` field per entry. Local-time, offset, minute-only, hyphenated, impossible-date, or wrong-month sigils, pure YAML entry lists, Markdown tables, bolded sigils, fenced per-entry YAML, empty shards, and unsafe content fail closed.

Record the fetched Agentic Canvas OS `origin/main` SHA as `memory_base_ref`. Do not repair a failure by rewriting, reordering, compacting, or deleting history; restore the canonical bytes or append a new superseding record on an authorized task branch.

### 8. Verify Monthly Planning Shards

Set `PLANNING_ROOT` to `$AGENTIC_CANVAS_OS_ROOT/todo` and run the structural command under `Planning Shard Compliance Checks` in `VALIDATION-RUNBOOK.md`.

The gate validates `TODO.md`, every `todo-log/v1` shard, filename-period identity, one scope, active/closed lifecycle, chronological unique UTC date headings, month boundaries, and the 500,000-byte and 599-line caps. Record the fetched Agentic Canvas OS SHA as `planning_base_ref`, the active shard, and one stable `planning_context` for the task row.

Imported pre-adoption rows remain historical evidence. Do not normalize them in place. New rows append at EOF and follow the strict row contract in `TODO.md`.

### 9. Start

Start Codex with `$TASK_WORKTREE` as its working directory. Declare the task invocation, semantic scope, bindings, branch, base SHA, worktree path, ownership, acceptance criteria, and deploy boundary before editing. Normal Vite runtime remains bound to the clean registered main worktree; task worktrees use focused source and test commands unless a separate runtime-port policy explicitly authorizes them.

## Updating an Existing Owned Branch

Use pull only when all conditions are true:

- the branch is intentionally being updated rather than used as a fresh task lane;
- the owned task worktree is clean;
- the current branch is not `main`;
- exactly one active writer owns the branch;
- its upstream is verified;
- the chosen merge or rebase behavior is explicit.

## Mandatory Completion Protocol

Completion and parking are mutually exclusive states. Dirty, stashed,
branch-only, pushed, open-pull-request, or auto-merge-pending work is not
complete.

Managed implementation runs normally stop before completion through `npm run device:review`. That command checks and pushes the fenced branch, preserves authored PR context, records the exact reviewed head, marks the PR ready without an automerge label or merge call, and independently proves `isDraft: false`. Knowgrph projects this ACOS `review_ready` lease as managed-run state `delivery_ready`; neither status is task completion. Requested changes must use fenced resume, which restores and proves draft ownership before mutation. `device:publish` remains the explicit protected auto-merge path.

### Canonical Local Runtime Handoff

End every implementation turn with the canonical Knowgrph runtime supervised by Agentic Canvas OS:

```sh
npm --prefix "$AGENTIC_CANVAS_OS_ROOT" run turn:end -- \
  --repository="$GITHUB_ROOT/knowgrph" --json
```

The command runs the worktree lifecycle audit and fetches both canonical repositories. It requires clean `main == origin/main`, successful protected checks (`test`, `build`, `docs-contract`, and `collaboration-integration` for Agentic Canvas OS; `Integration Gate` for Knowgrph), and repository-owned runtime scripts. It acquires a host-wide lock, rejects unmanaged listeners before mutation, and may stop only a previously recorded process group whose private token, command, working directory, Git common directory, and port ownership still agree.

The supervisor starts only Knowgrph's repository-owned Apex and storage commands on `127.0.0.1:5173` and `127.0.0.1:8787`. State, logs, and a private token live outside both repositories. Success records token hash rather than token value and proves Apex, direct storage export, and the same export through the Vite proxy. A raw `npm run dev`, source-only check, prior-turn proof, or HTTP response without matching process ownership cannot support a runtime-ready claim.

Status re-proves source, protected checks, process ownership, listeners, and HTTP without mutation. Stop accepts only token-owned recorded process groups:

```sh
npm --prefix "$AGENTIC_CANVAS_OS_ROOT" run runtime:local:status -- \
  --repository="$GITHUB_ROOT/knowgrph" --json
npm --prefix "$AGENTIC_CANVAS_OS_ROOT" run runtime:local:stop -- \
  --repository="$GITHUB_ROOT/knowgrph" --json
```

This is local runtime supervision, not completion, merge, release, or deployment. Task worktrees never become runtime sources. A read-only follow-up reruns `runtime:local:status` before claiming readiness; an implementation turn reruns `turn:end` idempotently.

For a completed task:

1. Commit intentionally and pass focused validation on the task branch.
2. Publish through the protected Dev pull-request path and wait for `MERGED`.
3. Run `npm --prefix "$AGENTIC_CANVAS_OS_ROOT" run device:complete -- --json --repository="$TASK_WORKTREE"` from that task branch.
4. Fast-forward the clean registered main worktree with `npm run sync:live`, then restart or reload the local runtime from the emitted exact `mainSha` and
   rerun the original browser acceptance path.

The completion wrapper fails closed unless the working tree is clean, the task
branch has a merged pull request targeting `main`, its merge commit is contained
by fetched `origin/main`, the task worktree detaches at that exact commit object,
and the checkout remains clean. It records a durable `completing` intent before
cleanup, retires only fully proven restored stash/ref evidence under the shared
stash-operation lock, and records `completed` only after clean detachment. A
retry may start detached, proves the recorded merge and prior main SHA remain
ancestors of the current canonical tip, and finishes only the missing phase.
Its JSON must name
`completedBranch`, `pullRequestUrl`, `mergeCommitSha`, `mainSha`, and
`"status":"ok"`. `device:end` enforces the same gate for existing callers; it
must never park unmerged work and label the result complete.

For work intentionally paused or blocked, run `npm run device:park` and report
the state explicitly. Parking preserves dirty work under a deterministic message,
exact stash commit, and immutable per-lease `refs/agentic-canvas-os/parked/...`
ref before detaching at `origin/main`. Resume restores that exact object and
verifies staged, tracked, untracked, mode, and conflict state. Repeated park
cycles pin the successor before retiring only the prior restored object; unrelated
worktree stash entries and refs must survive. Parking never satisfies completion.

### Session-End Worktree Lifecycle

Audit the current task worktree at the end of every chat, session, or thread, but
do not equate conversation end with task completion. First choose exactly one
durable state: complete through the protected merge protocol, park unfinished
work, or keep an active leased lane when the same task is intentionally
continuing.

For every implementation lane, `turn:end` must finish ready against the canonical protected SHAs or the final response must report the missing integration or runtime proof. Task heads never replace canonical runtime ownership.

Run the repository-owned lifecycle check from the canonical main worktree:

```sh
npm run worktree:lifecycle:check
```

The check retains the canonical main worktree, active unexpired task lanes,
delivery lanes, and explicitly parked lanes. It fails closed on dirty,
unregistered, stale, ambiguous, invalid, or already-completed residual task
worktrees. A completed task becomes cleanup-eligible only after
`device:complete` verifies its merged pull request, detaches it cleanly at the
exact fetched `origin/main`, and records the completed writer-lease state.

Remove one eligible checkout explicitly from the canonical main worktree:

```sh
npm run worktree:lifecycle:cleanup -- --worktree="$TASK_WORKTREE"
```

Cleanup uses `git worktree remove` without force and then prunes registration
metadata. It preserves the task branch and commits. It never removes canonical,
active, delivery, parked, dirty, divergent, or unclassified worktrees; uncertain
files remain for manual review or recoverable archival. Branch deletion is a
separate operator-authorized action.

Given a completion claim, when the protocol runs, then the protected Dev pull
request is merged, the task worktree is detached and clean at the exact fetched
`origin/main` revision containing that merge, the registered main worktree is
fast-forwarded separately, and the original failure is
retested on a local runtime started from that same SHA. Dev integration alone
does not authorize Prod mirror or Cloudflare action.

VCC: Verify `npm run device:complete -- --json` exits zero and emits the required
branch, pull-request, merge, and main evidence; the task worktree is clean and
detached; `npm run sync:live` leaves the registered main worktree aligned with
`origin/main`; the local runtime identifies that
exact `mainSha`; and the original browser acceptance passes. Any missing item
leaves the task pending, paused, or blocked rather than complete.

Session-end VCC: Verify the lifecycle report names every registered worktree and
its state; a runtime-relevant review-ready lane reports one ready server whose
app SHA equals `reviewHeadSha`, docs SHA equals clean canonical Agentic Canvas OS
`origin/main`, listener PID owns its reserved port, and HTTP returns 200; cleanup
accepts only the completed clean detached target; canonical main remains clean;
and no unrelated server, Prod mirror, or Cloudflare action is mutated.

Otherwise fetch, inspect, and activate a new reconciliation or task branch in a detached registered task worktree. Never use pull to absorb unexplained dirt or resolve multi-writer ownership.

## Handoff and Conflict Rules

- A handoff names the exact pushed commit SHA and paired app/docs/catalog manifest digest; the sender stops writing before the receiver starts.
- A writer handoff also marks the prior lease parked, names its final epoch and fence SHA, and requires the receiver to claim a strictly newer epoch before mutation.
- Same-device and different-device chats may mutate different scopes concurrently through distinct registered worktrees or clones. The Git-common-directory registry serializes each local worktree and branch; duplicate scope pull requests, expired sessions, and stale fencing ancestry fail closed.
- A runtime handoff includes the successful `npm run collaboration:gate` summary with two distinct automated peers, exact visible revisions, and the common non-empty verification digest; a branch name, screenshot, clipboard export, or manually assembled JSON never establishes parity.
- Reconcile upstream changes in the owned task branch before final validation.
- Resolve conflicts at the source owner; remove stale or duplicate logic instead of stacking aliases or downstream patches.
- Use force-with-lease only when repository policy allows it and one writer is reconfirmed; otherwise use a new reconciliation branch.
- Keep `main` read-only for agents and integrate through the protected Integration Gate.

## Stop Conditions

Stop before build mutation when a target worktree is unregistered, dirty, prunable, shared by another active session, or not detached at fetched `origin/main` before claim; when a branch is active in another worktree; when fetch fails; when source dirt is unexplained; when the local writer lease is missing, expired, or owned by another session or worktree; when its fencing SHA is not ancestral; when branch ownership is ambiguous; when the semantic scope already has another active pull request; when the base ref is missing; when the branch exists unexpectedly; when the startup SHA cannot be proven; or when any runtime identity, catalog, memory, or planning gate fails.

## Completion VCC

Given a declared device, session, semantic scope, and task worktree, when `/session.start` completes, then both repositories' remote refs are fetched, the registered main worktrees remain clean at their fetched bases, the task path is a distinct registered worktree, one unexpired branch-bound lease and one draft pull request own the semantic scope, the lease worktree path, epoch, and fencing SHA match the task branch, one application-root runtime owns global identity, MainPanel Settings projects the gate as shared KTV rows, every participating running surface visibly reports identical exact Knowgrph and Agentic Canvas OS SHAs, catalog hydration is fresh, memory and planning shards are compliant, and Codex mutates only its leased task worktree.

VCC: verify both fetches exit zero; `git worktree list --porcelain -z` identifies one registered `main` owner plus the declared task worktree; every checked-out branch is unique; the Agentic Canvas OS main worktree is clean with `HEAD` equal to fetched `origin/main`; the task lease registry entry matches its session, branch, and path; `npm run collaboration:gate` exits zero with two distinct automated peers and one common verification digest; memory and planning checks pass; the Knowgrph main worktree remains clean; and no Prod mirror or Cloudflare action occurred.
