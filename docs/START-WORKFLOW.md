---
title: "Knowgrph Conflict-Safe Session Start Workflow"
graphId: "md:knowgrph-conflict-safe-session-start-workflow"
doc_type: "Session Start Workflow Contract"
date: "2026-08-21"
lang: "en-US"
schema: "knowgrph-start-workflow/v2"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "Knowgrph multi-user, multi-device, multi-session, parallel-worktree session-start operating model"
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
  prod_mirror: "only after exact-candidate human authorization under CANONICAL-LIFECYCLE.md"
  cloudflare: "only through the repository-owned release controller after exact-candidate human authorization"
operating_priorities: ["minimum-viable-maximum-value", "time-to-value", "high-ROI", "TCO", "token-economics", "FOSS-first"]
coordination:
  base_ref: "origin/main"
  actor_identity: "authenticated source-control principal recorded on the ownership pull request and integration evidence"
  collaboration_identity: "actor + device + session + worktree + branch + semantic scope + lease epoch + fence revision"
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
  writer_lease_registry: "device-local Git-common-directory projection; the cloud collaboration CAS ledger is cross-device authority and the draft ownership pull request is its review projection"
  fencing_identity: "monotonic lease epoch plus claim commit SHA"
  post_baseline_authored_state: "new or untracked paths remain in their physical owning task worktree and pull request"
  owned_untracked_state: "preserve in place; block only the owning semantic scope; forbid cleanup, stash, masking, or adoption"
stage_order: ["discover", "fetch", "inspect", "claim", "activate", "verify", "memory", "planning", "start"]
completion_requires:
  - "fetched remote refs"
  - "clean canonical Agentic Canvas OS checkout at fetched origin/main"
  - "clean source checkout"
  - "unique cloud-authoritative semantic scope plus normalized declared write-set ownership"
  - "unexpired session-bound writer lease with matching draft pull request and fencing SHA"
  - "one clean registered main worktree plus zero or more isolated registered task worktrees"
  - "task branch active only in its leased task worktree"
  - "recorded branch and base SHA"
  - "declared runtime requirement mapped by the repository profile to required or not-required"
  - "when runtime is required, visible runtime identity with exact Knowgrph, Agentic Canvas OS, and catalog revisions plus the deterministic catalog digest"
  - "one application-root canonical identity owner with a MainPanel Settings KTV projection"
  - "repository-owned collaboration gate pass with two isolated runtime peers and one common verification digest when parity is claimed"
  - "when runtime is required, fresh revision-keyed catalog hydration with identical MCP counts and digest plus browser recomputation within at most two explicit refresh attempts"
  - "memory-log structural compliance"
  - "context-record planning structural compliance"
---
# Knowgrph Conflict-Safe Session Start Workflow

## Authoritative Rule

Fetch before starting every Codex session; keep one clean registered `main` worktree as the runtime and synchronization owner; activate each task branch only in its own registered task worktree; pull only when intentionally updating a clean, exclusively owned branch.

The canonical `main` worktree remains the only Dev runtime and synchronization owner. Linked task worktrees are mutation lanes only: each must be registered, detached at fetched `origin/main` before claim, bound to one distinct `agent/<device>/<semantic-scope>` branch, protected by its own unexpired lease, and excluded from canonical ports. The Agentic Canvas OS supervisor may own those ports only after both canonical repositories are clean exact fetched `origin/main` revisions with required protected checks successful. Unregistered copies, the same branch in multiple worktrees, `--ignore-other-worktrees`, and task-worktree runtime sources are forbidden.

Protected-branch policy, remotely addressable task refs, provider review, required checks, and integration receipts form the upstream publication contract. The authenticated cloud collaboration ledger is the sole authority for writer ownership, integration authorization, and retirement. Git refs, provider review requests, local leases, worktree registration, lifecycle reports, and runtime reports are required evidence projections; none can transfer authority. Reconcile each observation as `aligned`, `stale`, `missing`, or `contradictory` against an authenticated ledger readback. Only an accepted ledger compare-and-swap transition changes authority. A stale projection is a typed diagnostic, never grounds for a new recovery lane, ownership transfer, or cleanup.

The GitHub adapter normally creates ledger objects through the Git Data API. If GitHub rejects an oversized ledger blob request as malformed, the same validated transition may fall back to a depth-one smart Git clone and a normal fast-forward push from the exact observed ledger parent. The fallback must preserve the controller-computed bytes and commit parent, use configured authentication without placing credentials in arguments, reject stale parents before mutation, and leave the ordinary API compare-and-swap/readback path in control of the public receipt. It is a transport substitution only; manual ledger edits, force pushes, alternate transition semantics, or target-repository mutation remain forbidden.

Canonical, task, and review refs are repository-adapter inputs. This repository profile maps them to `origin/main`, `main`, `agent/<device>/<semantic-scope>`, and a GitHub pull request; another provider may map them differently without changing the authority, evidence, or lifecycle semantics. In this GitHub profile, the shared remote pull-request set is the cross-user and cross-device scope registry projection, not authority. A normal local commit on an admitted task ref records lane-local progress only and does not bypass the protected publication boundary.

Parallel users, devices, sessions, and chats may mutate different semantic scopes only through distinct registered worktrees, task refs, current non-overlapping ledger claims, and aligned projections. The authenticated principal supplies Actor ID; the claim binds device, session, worktree, scope, epoch, declared paths, and fence. An active overlapping claim is an upstream blocker, not a downstream cleanup task. Continue only after the ledger records an accepted release, handoff, or reclaim for the exact overlap and fence; local expiry, review state, mergeability, or protected-source advancement cannot imply release. Every new writer also requires the external capability defined by `TASK-BOUND-LANE-AUTHORITY.md`. Dirty, expired, dormant, or ambiguous lanes preserve their bytes and binding. Distinct names or review requests do not make write sets independent when they can publish different revisions for the same path. See `CLOUD-COLLABORATION.md` and `SCOPED-LANE-ADMISSION.md`.

The coordination model is one clean registered canonical `main` worktree plus zero or more isolated registered task worktrees. Each lane has one active writer, one current cloud fence, and one declared write scope. A same-scope peer waits for an exact pushed-SHA handoff; a release or review wait does not transfer ownership from an older fence to a newer protected `origin/main` revision.

Capture each registered worktree's status baseline after fetch and ownership inspection, then rescan before mutation, review, integration, and cleanup. A path first observed after that baseline is post-baseline authored state, not disposable residue. Attribute it to its physical worktree, semantic scope, writer session, lease epoch, branch, and pull request; creation time never makes it orphaned.

Before classifying tracked dirt as `blocked-dirty`, compare the index and working-tree entries for the complete observed path set with the fetched canonical tree. `canonical-equivalent` requires the exact path set plus identical entry type, mode, and blob identity; untracked, unmerged, deleted, partial, or drifted state does not qualify. This proves only that no novel tracked bytes remain. It grants no authority and permits no deletion, retirement, or cleanup until an exact Integration Receipt and ledger readback classify the lane as `already-integrated`.

New or untracked authored paths stay byte-for-byte in their actual owning task worktree. Do not delete, stash, ignore-mask, relocate to canonical `main`, copy into another task, or adopt them under another session. A durably attributed task lane reports `owned-untracked`, remains registered with its pull request, rejects cleanup and completion, and blocks only its semantic scope. Canonical dirt remains `blocked-canonical` for runtime/parity, but an unrelated scope may activate from a clean detached fetched ref after recording the dirty state as retained overlap; unattributed dirt remains `blocked-dirty`. Neither state authorizes mutation by an unrelated task. If authoring lands on canonical `main`, preserve the exact bytes and move them into one isolated admitted task lane before the next normal commit or publication step. Repository-owned tooling should steer that transition explicitly instead of surfacing a generic protected-branch commit denial for task-lane authoring.

`/session.start #multi-agent-collaboration #runtime-ready @operator @working-directory @runtime-proof` requests this pre-build workflow. It grants no release, Prod mirror, Cloudflare, force-push, cleanup, or unrelated-work mutation authority.

## Split-Lane Work Groups

A requested outcome spanning repositories or authority domains is a dependency-ordered group of minimal work units, never one shared lane or authority envelope.

- Split at repository, authority-owner, or independently verifiable non-overlapping write-set boundaries; keep one unit when bytes share a source owner, generated publish path, or atomic invariant. A profile may adapt presentation, but never collapse separate authority domains. Give every unit its own repository adapter, canonical base, branch, worktree, semantic scope, declared write set, task capability, claim, epoch, fence, review identity, named checks, and receipts; a shared task, session, label, provider, or operator grants none of these across units.
- Localize blockers: a dirty, overlapping, or unavailable unit blocks only itself and its dependents, while an independently admitted disjoint unit may proceed. The group remains partial until dependency closure, and no passing unit promotes another unit's readiness. Leave pre-existing bytes with their physical owner: a disjoint unit may record preservation but cannot clean, stash, adopt, move, reconcile, release, retire, or deploy another unit. Integrate only through explicit dependency edges and each repository's protected controller; branch age or list order creates neither ordering nor shared authority.

`START-WORKFLOW.md` owns session startup. `CANONICAL-LIFECYCLE.md` owns the provider-neutral receipt protocol. `RELEASE-WORKFLOW.md` is its current reference implementation for integration and release after development is complete. The three invocation dictionaries remain the only `/`, `#`, and `@` token authority.

## Session Context Contract

Use this context for every Knowgrph Codex build session. Resolve all paths from `$GITHUB_ROOT`; never persist a developer username or machine-specific absolute path in source, fixtures, tests, generated assets, or documentation.

| Context | Runtime-ready rule |
|---|---|
| Operating model | Operator-led, AI-native startup using typed harnesses and bounded orchestration. Optimize minimum-viable maximum-value, time-to-value, ROI, TCO, and token/cache economics. Prefer FOSS, local, zero-egress, and zero-spend paths when capability is equivalent. |
| Agentic Canvas OS | `$GITHUB_ROOT/agentic-canvas-os/docs` in the registered `main` worktree is the global, centralized, frontmatter-first SSOT. It must be clean and exactly equal to fetched `origin/main` before a normal Knowgrph Dev port starts. Additional registered task worktrees may author isolated branches but never become runtime docs sources. `/`, `#`, and `@` resolve only through the three dictionaries and their shared runtime projection. |
| Memory log | `$GITHUB_ROOT/agentic-canvas-os/memory/YYYY-MM.md` is append-only history governed by `MEMORY-LOG.md`. YAML owns only file identity; entries must use exact `## @mem-YYYYMMDDTHHmmssZ` UTC sigil-header blocks. A malformed shard blocks session startup. |
| Cross-repository planning | `$GITHUB_ROOT/agentic-canvas-os/todo/YYYY-MM/<context>.md` is one immutable task record governed by `TODO.md`; flat monthly files are immutable legacy history. Claim only the exact record path and block on malformed identity, duplicates, dates, or projection. |
| Dev | Author in leased task worktrees. Run Knowgrph only from the clean registered `main` worktree at `$GITHUB_ROOT/knowgrph`; Agentic Canvas OS owns the fixed Apex `5173` and storage `8787` supervisor after exact-main and protected-check verification. |
| Immutable publication | Use Knowgrph's repository-owned `npm run release:publish:immutable -- ...` object lane only for an already-created commit whose writer stopped or when recovering a checkout-independent delivery. Require the exact source SHA, target ref, expected remote SHA, pinned Agentic Canvas OS SHA, and generated manifest; forbid branch switching, staging, worktree creation, application startup, merge, release, or deployment. |
| Planning authority | `TODO.md` plus independently owned `$GITHUB_ROOT/agentic-canvas-os/todo/YYYY-MM/<context>.md` records are the sole live planning owner. Shared writable indexes and repository-local todo files are forbidden. |
| Prod mirror | `$GITHUB_ROOT/huijoohwee/content/knowgrph` is generated release output, never a default edit target. Only the repository-owned controller may publish the exact human-authorized candidate. |
| Cloudflare | `https://airvio.co` and `https://airvio.co/knowgrph` are deployment targets, not completion criteria. Only the repository-owned controller may deploy the exact human-authorized candidate. |

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
authoring_status: <ready|blocked>
parity_status: <passed|deferred|blocked>
block_scope: <none|global|semantic-scope|runtime-proof>
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

The command reads the canonical source registry, fetches every source, and completes a two-phase safety check before changing a main worktree. Every main source must have no local changes, its canonical branch active, and `HEAD` as an ancestor of the fetched canonical ref. Registered task worktrees are inspected for conflicts but are never switched, merged, or used as runtime source. Only after the full set passes does the command apply `git merge --ff-only` to the main worktrees and delegate to ordinary fail-closed Dev startup. If tracked canonical bytes were separately preserved and then merged through their leased protected task pull request, `canonical:main:fast-forward-equivalence -- --repository=... --session=... --expected-local-head=... --expected-origin-head=... --acknowledge-protected-equivalence --json` may reconcile only an unstaged tracked-only working set when every dirty path's mode and blob exactly equal that protected descendant and every other path remains clean against the expected local head; unrelated protected fast-forward changes then materialize from the pinned descendant. It writes a content-bound Git-metadata receipt, proves ignored-state retention, uses compare-and-swap, and rejects untracked, staged, conflicting, deleted, partial, extra, mode-mismatched, or drifted state without creating a commit, stash, branch, pull request, deployment, or Production authority.

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

Stop when a listed worktree is missing, prunable, unregistered, on a duplicate checked-out branch, or contains dirt that remains unexplained after the exact canonical-equivalence check; when the configured canonical ref is unavailable; when either registered canonical worktree differs from its fetched canonical ref; or when another current ledger claim owns the same or overlapping write set. Resolve overlap only through the protected handoff, release, or reclaim protocol. Attributed canonical dirt blocks canonical mutation and runtime, but not activation of an unrelated clean detached fetched-ref lane; bind it to an Overlap Preservation Receipt and leave its bytes in place. `owned-untracked` in another task worktree blocks only that worktree and overlapping scopes, not an unrelated isolated lane.

### 4. Claim

Choose one device identity, one stable chat/task session id, and one semantic scope. Derive `agent/<device>/<semantic-scope>` without a compatibility alias. Record the intended action, branch, base ref, base SHA, active writer, lease epoch, expiry, and fencing SHA in the task and draft pull-request metadata.

The device segment preserves valid lowercase hostname identity, including interior dots such as `.local`, underscores, and hyphens, while requiring alphanumeric boundaries. The semantic-scope segment permits only lowercase alphanumerics and interior hyphens. Normalize and validate both segments before fetch, branch switch, lease claim, commit, push, or pull-request mutation so rejected identity input cannot change checkout state.

One task worktree, branch, and semantic scope have one writer. A second chat on the same device may claim another detached registered task worktree for a different scope. A same-scope chat waits for an exact pushed-SHA handoff. Draft pull requests for different scopes may coexist; duplicate active scope ownership fails closed.

### 5. Activate

Use `SCOPED-LANE-ADMISSION.md` for every new cross-device lane. Its operation-derived cloud `status` plus `verify` inventory, exact current candidate claim, double-read local inventory, and target-observation digest may produce only `authoringAdmission: planned` before mutation. Every accepted peer must join one local projection to one exact live remote claim across identity, revisions, normalized write set, epoch/counter, state, expiry, and review request; legacy or partial projections fail closed. Combined provisioning locks the local registry, proves exactly one clean detached candidate registration whose HEAD/tree equals the admitted base, then joins accepted Admission and Preservation Receipts plus a final cloud/local authority check to derive `authoringAdmission: admitted`. Its final JSON contains the full admitted report and fresh mutation-authority receipt. `runtimeReadiness`, `lifecycleReadiness`, and `admissionRuntimeConformance` stay independently `unevaluated`; peer drift blocks admission without synthesizing any conformance result. A clean frozen peer whose local projection remains `review_ready` may be preserved as disjoint only when an operation-derived proof joins that exact historical ledger entry to a counter-plus-one `delivery-authorize` transition, a heartbeat-only live suffix, the current claim record, the exact open non-draft provider PR, and the reviewed head or its bounded protected-main refresh. The proof is bound into the lane-state digest and rerun after candidate registration. This narrow attribution is admission evidence for an unrelated candidate; it cannot mutate, reopen, author, resume, review, merge, release, reconcile, run, or deploy the peer.

In the root-source `agentic-canvas-os` repository, fresh task activation now fails closed unless `device:start` is invoked through this combined provisioned path with both scoped-lane admission and cloud authority. If dirty historical root-source lanes must be preserved first, generate the exact bootstrap authorization with `scoped-lane-admission.mjs bootstrap` before provisioning. A pre-existing local-only root-source lane may become cloud-admitted only through repository-owned `device:review`, which derives its exact committed write scope, claims the canonical base, and rebinds the reviewed head before the ordinary cloud review transition continues. Local-only fresh claims remain allowed only in downstream repositories that do not own the root collaboration ledger.

```sh
node "$AGENTIC_CANVAS_OS_ROOT/scripts/device-branch.mjs" start \
  "<semantic-scope>" --session="$AGENTIC_SESSION_ID" \
  --repository="$KNOWGRPH_ROOT" --provision --worktree="$TASK_WORKTREE" \
  --write-scope-manifest="<external-manifest.json>" \
  --cloud-authority="<external-cloud-claim-result.json>" \
  --target-repository="<owner/repository>" --json
```

If this combined call is interrupted after the claim, an exact-session retry from the recorded `$TASK_WORKTREE` without `--provision` may reconcile only the activation base, claim subject, fence, remote head, and single draft pull request; it does not reconstruct a missing Preservation Receipt or authorize source edits. Keep a `planned` recovery lane untouched until owner-led lifecycle recovery closes it and a fresh admission completes. An expired same-session planned lane with a clean committed descendant may run `planned-clean-committed-recovery.mjs`; it recovers only the exact dormant cloud claim and local lease projection, preserves `planned` status and every ref and byte, returns no mutation authority, and still requires the exact dormant-preservation admission before review, publication, or integration. The external cloud claim remains its owner's authority: a failed check/start never silently releases or replaces it, so the owner must retry compatibly or explicitly release/reclaim the exact claim through `CLOUD-COLLABORATION.md`. A target, branch, lease, PR, session, ledger, or expiry mismatch fails closed. Before first and every later mutation batch, including heartbeat renewal, revalidate the current cloud claim and local lease/epoch/fence/expiry; local expiry never exceeds cloud expiry.

A task-bound `planned` lane with owned dirt at its unchanged fence may widen
scope only through `planned-owned-dirt-scope-expansion-recovery.mjs`. Its
read-only plan requires an exact strict-superset manifest; execution requires
the returned `authorize planned-owned-dirt-scope-expansion-recovery
<planDigest>` text and original external task capability. The journaled cloud
successor and local registry CAS preserve every byte, index entry, ref, draft
review, and task subject. Success restores scoped mutation authority only; see
`PLANNED-OWNED-DIRT-SCOPE-EXPANSION-RECOVERY.md`.

Heartbeat before the 30-minute default TTL expires:

```sh
npm --prefix "$AGENTIC_CANVAS_OS_ROOT" run device:heartbeat -- \
  --session="$AGENTIC_SESSION_ID" --repository="$TASK_WORKTREE"
```

Heartbeat renews cloud authority before the local lease, re-verifies the live
claim after local renewal, returns the joined mutation-authority receipt with
`--json`, then independently proves the exact ownership PR remains draft.
Cloud, PR, or identity failure blocks source mutation; cloud or pre-local
authority failure leaves local expiry unchanged, while a post-local or
PR-projection failure preserves the already renewed local evidence for explicit recovery without granting another edit batch. Run `npm run doctor` from the repository root before and during longer sessions to catch near-expiry authority, branch or lane-revision drift, and in-progress pull-request projection repair before a lane decays into stale residue.

If GitHub's pull-request projection remains at a strict ancestor after the
active branch and remote fence agree, run the same heartbeat command with
`--repair-pr-projection`; it binds owned dirt and both PR identities, while
review and publish independently require the exact pushed head.

If the owned branch already exists, inspect its exact SHA, draft pull request, lease metadata, task-authority binding, upstream, and registered worktree before switching to it. An expired lease does not authorize silent takeover: the prior writer must park or hand off its exact pushed SHA, after which the receiver claims the next epoch with the bound or explicitly rotated capability. The only renewal exception is exact same-session replay of an incomplete start or resume claim: capability proof, session, worktree, branch, base, epoch, empty-claim shape, draft PR marker, and remote handoff/fence must still match, and a competing remote fence wins. Never reuse a dirty worktree through ordinary start or resume, activate one branch in multiple worktrees, use `--ignore-other-worktrees`, or activate a branch owned by another session; the explicit same-session owned-dirt resume below is the only dirty review-ready exception and still requires the current task capability. An expired cloud-admitted active lane with owned dirt instead uses `node "$AGENTIC_CANVAS_OS_ROOT/scripts/active-owned-dirt-recovery.mjs" plan --repository="$TASK_WORKTREE" --session="$AGENTIC_SESSION_ID" --json`, then `execute` with the exact returned `authorize active-owned-dirt-reclaim <planDigest>` text; it is reclaim-only for the recorded source session and task authority, pins exact index/worktree/untracked/type/mode/blob evidence before same-claim cloud recovery, never changes authored bytes, HEAD, branch refs, remote refs, or PR draft state, and still requires ordinary clean `device:review` to reach `review_ready`. See `MANAGED-IMPLEMENTATION-RUNS.md` for its replay and proof boundary.

Resume and recovery are separate modules. Ordinary `device:resume` accepts only a clean lane whose exact identity, authority, worktree, ref, review projection, fence, and remote head reconcile. Cloud-admitted ownership advances only through its ledger handoff or reclaim; legacy local-only lanes use only their explicit park, handoff, review, or delivery path. Dirty bytes stay with their recorded owner and never transfer through resume.

`MANAGED-IMPLEMENTATION-RUNS.md` owns the bounded recovery commands, compatibility schemas, ancestry and partition proofs, compare-and-swap ordering, provider limits, and idempotent replay rules. Invoke only the named recovery that matches the observed reason code and exact stored evidence. Recovery may restore projection consistency or mutation authority for the same owner; it may not create a generic reconciliation lane, widen scope, hide bytes, transfer ownership, publish, merge, run, clean, or deploy.

```sh
npm --prefix "$AGENTIC_CANVAS_OS_ROOT" run device:resume -- \
  "agent/<origin-device>/<semantic-scope>" --session="$AGENTIC_SESSION_ID" \
  --repository="$TASK_WORKTREE"
```

An admitted continuation may advance from its original fence to one exact controller-prepared integration commit only when the stored integration receipt matches the current commit, tree, declared paths, staged-diff digest, manifest digest, and commit message. Any other descendant remains drift. A legacy local-only auto-delivery lane that is already review-ready may finalize only when its exact pull request is already merged; `device:integrate` then records task completion without inventing cloud authority or dispatching another merge. Open pull requests still require the normal delivery and authorization path. Use `--recover-owned-dirt` only for the explicit same-session review-ready
recovery above. Ordinary resume remains clean-only.

### 6. Verify

Verify the registered task worktree before starting the build session.

```sh
git -C "$TASK_WORKTREE" worktree list --porcelain -z
git -C "$TASK_WORKTREE" status --short --branch
git -C "$TASK_WORKTREE" merge-base --is-ancestor origin/main HEAD
git -C "$TASK_WORKTREE" rev-parse HEAD
```

The task path must appear exactly once in the worktree registry; its branch must appear in no other worktree; the checkout must be clean; the branch must match the claimed scope; the lease session, worktree path, and epoch must be current; its exact open pull request must own that scope and report `isDraft: true`; and the claim commit must be an ancestor of `HEAD`.

Record a zero-content status baseline after this verification. Subsequent rescans compare physical worktree paths, never just branch names. If another lane gains post-baseline untracked paths, retain that lane and continue only when the current lane's scope is distinct. If the current lane gains them, keep authoring in place under its existing lease and pull request; do not move the bytes to make a global check appear clean.

#### Automated Collaboration And Runtime Identity Gate

Before claiming parity or handing off a running surface, run the repository-owned gate from Agentic Canvas OS:

```sh
npm run collaboration:gate
```

The gate allocates a run-scoped owner, guest, worker, persistence root, credentials, proof path, and screenshot prefix outside every repository. It must not reuse, stop, reconfigure, or write through the canonical `5173`/`8787` runtime. Concurrent gates use distinct registered allocations and clean up only their own process groups and persistence. A failed proof preserves bounded diagnostics but grants no parity claim.

Classify startup through `npm run session:start:classify` with the inspected fetch, canonical, scope-ownership, task-worktree, memory, planning, and parity states. `authoring_status: ready` requires every non-runtime gate to pass. `parity_status: deferred` or `blocked` permits read-only work and isolated source authoring only when `authoring_status` is already `ready`; it forbids runtime-ready, browser-parity, review, integration, release, and deployment claims. An unrelated dirty task worktree does not block another unique leased scope, while an overlapping scope remains `block_scope: semantic-scope` and fail-closed.

This command creates isolated local owner and guest browser contexts and a local storage worker or reuses healthy services. It does not require two physical devices, visual comparison, clipboard transfer, or runtime-identity JSON files. Matching branch names, ports, routes, or labels do not satisfy the gate.

Open the gate through MainPanel Settings. `Cross-device Identity Gate` must be one collapsible section inside the Settings body, below the shared KTV header, and every identity field/action must use the shared Key-Type-Value row contract. A gate above the KTV header, in Skills & Commands, or rendered through a private table/list layout fails startup compliance.

The gate's focused checks must prove that Knowgrph mounts exactly one canonical identity runtime at the application root. Settings consumes that global snapshot; `/`, `#`, and `@` catalog hydration may publish the docs revision, counts, and hydration state as one facet but must not define, scope, or own the identity component. Any second store, surface-local owner, or catalog-coupled Settings identity hook blocks parity even when the displayed SHAs happen to match.

The automated peers join the dedicated identity room with separate authenticated sessions and runtime identities. The room issues a short-lived challenge, the reporters read the canonical identity snapshot, and the gate verifies distinct peers plus challenge, TTL, digest, exact revisions, hydration, counts, and remote document propagation. Continue into parity-dependent work only when the command exits zero with `2/2` peers and a non-empty common verification digest. `collecting`, `mismatch`, `stale`, `blocked`, transport failure, duplicate/replayed evidence, room-key mismatch, or different digests blocks startup parity without revoking an otherwise valid isolated authoring lane. `Copy diagnostic JSON` is optional troubleshooting only.

The identity must also report `catalogRevision`, `catalogHydration.status`, `catalogHydration.attempts`, and separate `/`, `#`, and `@` counts. Require `catalogRevision == agenticCanvasOsRevision`. Hydration and cache keys must include the docs revision so a revision change invalidates the prior catalog instead of reusing a page-lifetime snapshot.

When the catalog revision is absent or mismatched, expose an explicit refresh action. Permit at most two refresh attempts for that revision. A successful attempt reports `fresh`; exhaustion reports `blocked` or `stale`, keeps the mismatched revision visible, and blocks parity and runtime-ready claims. A page reload may be one explicit attempt, but silent or unbounded background retries are forbidden.

### 7. Verify Memory Log

Set `MEMORY_ROOT` to `$AGENTIC_CANVAS_OS_ROOT/memory` and run the structural memory-log command under `Memory Log Compliance Checks` in `VALIDATION-RUNBOOK.md`.

The gate requires `memory-log/v1` frontmatter, matching filename and period, immutable agent/device identity, `timestamp_format: YYYYMMDDTHHmmssZ`, `append-only` policy, exact `## @mem-YYYYMMDDTHHmmssZ` UTC headings that parse to real instants in the containing shard month, unique chronological sigils, and exactly one `type`, `scope`, `summary`, and Markdown-array `refs` field per entry. Local-time, offset, minute-only, hyphenated, impossible-date, or wrong-month sigils, pure YAML entry lists, Markdown tables, bolded sigils, fenced per-entry YAML, empty shards, and unsafe content fail closed.

Record the fetched Agentic Canvas OS `origin/main` SHA as `memory_base_ref`. Do not repair a failure by rewriting, reordering, compacting, or deleting history; restore the canonical bytes or append a new superseding record on an authorized task branch.

### 8. Verify Context-Sharded Planning

Run the structural command under `Planning Context Record Compliance Checks` in `VALIDATION-RUNBOOK.md`.

The gate validates `TODO.md`, immutable legacy shard identities, every `todo-context-record/v2` file, path/frontmatter identity, unique Context ownership, one complete 11-cell row, dates, and deterministic projection. Record the fetched Agentic Canvas OS SHA as `planning_base_ref`, one stable `planning_context`, and its exact `todo/YYYY-MM/<context>.md` path.

Legacy rows remain historical evidence and must not change. New work creates exactly one record absent at the base; independent lanes never append to a shared monthly file.

### 9. Start

Start Codex with `$TASK_WORKTREE` as its working directory. Declare the task invocation, semantic scope, bindings, branch, base SHA, worktree path, ownership, acceptance criteria, and deploy boundary before editing. Normal Vite runtime remains bound to the clean registered main worktree; task worktrees use focused source and test commands unless a separate runtime-port policy explicitly authorizes them.

When one outcome contains multiple independently authored integration units,
load `INTEGRATION-ORDER.md` before protected integration. Declare immutable
change identities, write scopes, dependency edges, named checks, runtime impact,
and the current canonical dependency closure. Integrate dependencies before
consumers, serialize overlapping scopes, fetch after every canonical
advancement, and recompute remaining waves. Branch order, pull-request age, and
task-branch check completion do not define integration order.

## Updating an Existing Owned Branch

Use pull only when all conditions are true:

- the branch is intentionally being updated rather than used as a fresh task lane;
- the owned task worktree is clean;
- the current branch is not `main`;
- exactly one active writer owns the branch;
- its upstream is verified;
- the chosen merge or rebase behavior is explicit.

## Mandatory Completion Protocol

Completion and parking are mutually exclusive states. Dirty, stashed, branch-only, pushed, open-pull-request, or auto-merge-pending work is not complete.

Declare `runtimeRequirement: required|not-required` when the lane is claimed; the current lease adapter projects those values as `runtimeRequired: true|false`. Source integration, runtime proof, and exact-target cleanup are independent facts, not a coupled state ladder. The Integration Receipt proves protected-source convergence, the Runtime Receipt proves the declared canonical runtime profile when required, and the Cleanup Receipt proves removal of one exact checkout. Runtime failure never erases proven source integration, source integration never implies runtime readiness, and neither fact authorizes cleanup.

Task completion requires every obligation declared by the lane profile. A `required` lane must prove `runtime_ready`; a `not-required` lane reports runtime as `not-required`, never `runtime_ready`. Either lane remains retained until its own merge, ledger-retirement, clean-detachment, and target-absence evidence makes cleanup independently eligible.

Managed implementation runs normally stop before completion through `npm run device:review`. For a cloud-admitted lane, that command reconciles the local projection with the exact live active or review-ready claim, runs the focused check, repeats reconciliation immediately before push, pushes and waits for the ownership PR to expose the exact head, rebinds the claim to that pushed HEAD when needed, performs and verifies the cloud `review_ready` transition, then records the reviewed head, marks the PR ready, and releases the local lease to `review_ready`. If a remote bind or transition succeeded before local persistence, retry accepts only the recomputed claim identity, immutable base/write set/epoch, exact PR/head, monotonic counter, state, expiry, fence, and transition digest. If the push succeeded but `review_ready` failed closed because the cloud verifier momentarily resolved a different PR head, recover only by revalidating the unchanged claim, PR, and intended head and rerunning the same bounded verifier-plus-transition path; do not rewrite fences, patch projections, or substitute a different transition. It preserves authored PR context and does not add an automerge label or merge by default. Knowgrph projects this ACOS state as managed-run `delivery_ready`; neither status is task completion. Cloud-admitted changes require explicit cloud handoff/reclaim before resumed mutation or local parking; `device:publish` and `device:integrate` create a separate `delivery_authorized` receipt before requesting protected integration.

If that exact cloud `review_ready` transition completed before the local projection and the local active lease then expired, the same-session `device:review` replay may recover only the unchanged live reviewed claim and exact PR head. It reruns validation and provider verification before recording `reviewHeadSha`; it does not create a successor, renew authoring authority, or repeat the cloud transition.

An operator or durable work-item policy may pre-authorize one terminal-turn protected merge only at `device:start` with `--auto-delivery`. The resulting immutable lease carries `autoDelivery: true` and `runtimeRequired: true`.

### Terminal Delivery Authorization Recommendation

Recommend `device:start --auto-delivery` only when the task request explicitly includes protected merge plus downstream promotion or canonical runtime refresh as the intended terminal outcome. Use ordinary `device:start` for implementation-only review handoff, and never authorize auto-delivery for exploratory, diagnostic, status, wait, or read-only work.

The choice is immutable for the lease. Do not infer merge or promotion authority from words such as `finish`, from the end of a response, or from an ordinary implementation request. If the operator later requests delivery of an already-started or review-ready task, use the explicit protected `device:publish` or `device:integrate` path instead of retrofitting `autoDelivery`.

For a task whose immutable lease already carries `autoDelivery: true` and `runtimeRequired: true`, recommend its terminal implementation-turn ending as the delivery checkpoint: run `device:review`, then `device:integrate` to bind the exact reviewed head and evidence into `delivery_authorized`, request protected merge, and continue through canonical runtime reconciliation instead of stopping at `review_ready`. The explicit integration invocation consumes prior operator authority; it does not reactivate authoring or create deployment authority.

Terminal-turn auto-delivery remains an implementation-run completion policy, not a conversational-turn hook. It applies only after the requested work is complete, no required work remains, the task worktree is clean, and `device:review` has bound the exact reviewed head. An ordinary end of message, chat, session, or thread is insufficient, and questions, status reports, read-only work, waits, partial progress, dirty work, parked work, and blocked work never trigger delivery.

At terminal review, ACOS writes the exact `reviewHeadSha` and stops. The explicit `device:integrate` continuation requires the same cloud-admitted review-ready lease, performs an idempotent compare-and-swap `delivery-authorize` transition over the unchanged reviewed head, scope, epoch, fence, ledger revision, review/check evidence, and operator integration intent, verifies the resulting `delivery_authorized` receipt, and only then asks the provider adapter for protected auto-merge. Every automated squash request must pass an explicit validated subject: `device:integrate` derives it from the original reviewed commit, `device:publish` derives it from the exact delivery head, and workflow synchronization validates the eligible PR title. Subjects must be non-empty, single-line, whitespace-exact, and no longer than 72 Unicode code points; provider-generated title decoration is not an authority source. If the provider refreshes the PR head only by merging newer protected `main` into that same delivery-authorized head, continuation may carry the bounded protected-main refresh chain locally while keeping the cloud delivery subject pinned to the original reviewed head; authored advancement, alternate ancestry, malformed markers, forks, stale evidence, or conflicts still fail closed and require a fresh fenced review handoff. Protected merge is not completion: canonical runtime reconciliation remains mandatory and `--runtime=none` is rejected for pre-authorized terminal delivery. Only the resulting `agentic-device-integration-result/v1` status `runtime_ready` proves completion. While that terminal integration is in flight, admission of a disjoint task may attribute the frozen delivery peer only through the exact live successor and bounded-refresh evidence described above. The admission path cannot mutate, reopen, complete, or deploy the delivery peer; those remain exclusively owned by its already-authorized integration operation. An enrolled repository supplies its own bounded protected-refresh adapter policy. The policy names the repository-owned dispatch workflow, required CI contexts, exact classic protection checks, any additional strict ruleset checks, and the workflow set audited for forbidden provider-triggered synchronization. Agentic Canvas OS provides conservative defaults for its own repository, but a consumer may declare a different exact profile without changing controller logic. Empty required-CI or classic-check sets, malformed workflow names, duplicate contexts, unbounded lists, and policy/protection drift fail before candidate publication. Split delivery lanes remain dependency-ordered: integrate the generic controller policy first, then the repository adapter, and only then replay a preserved delivery-authorized candidate. Never copy controller implementation into a consumer repository merely to rename workflows or checks.

### Canonical Local Runtime Handoff

For `runtimeRequirement: required`, end the implementation turn with the canonical Knowgrph runtime supervised by Agentic Canvas OS. For `not-required`, do not start or claim a runtime; report the Runtime Receipt as `not-required`.

```sh
npm --prefix "$AGENTIC_CANVAS_OS_ROOT" run turn:end -- \
  --repository="$GITHUB_ROOT/knowgrph" --json
```

The command runs the worktree lifecycle audit and fetches both canonical repositories. It requires clean `main == origin/main`, successful protected checks (`test`, `build`, `docs-contract`, `collaboration-integration`, and `cloud-collaboration` for Agentic Canvas OS; `Integration Gate` for Knowgrph), and repository-owned runtime scripts. It acquires a host-wide lock, rejects unmanaged listeners before mutation, and may stop only a previously recorded process group whose private token, command, working directory, Git common directory, and port ownership still agree.

The supervisor starts only Knowgrph's repository-owned Apex and storage commands on `127.0.0.1:5173` and `127.0.0.1:8787`. State, logs, and a private token live outside both repositories. A listener may rotate its child PID only while it remains in the recorded supervisor process group with the exact repository, command marker, and private ownership token; those joined invariants prevent adopting an unrelated listener. Success records the token hash rather than the token value and proves Apex, direct storage export, and the same export through the Vite proxy. A raw `npm run dev`, source-only check, prior-turn proof, or HTTP response without matching process ownership cannot support a runtime-ready claim.

Interactive browser work may use a session-owned Vite process when it is launched through Agentic Canvas OS from clean exact canonical Knowgrph `main`:

```sh
npm --prefix "$AGENTIC_CANVAS_OS_ROOT" run runtime:session:start -- \
  --session="$AGENTIC_SESSION_ID" \
  --repository="$GITHUB_ROOT/knowgrph" --json
```

The session launcher may stop only an already-recorded canonical runtime whose private token and process evidence still agree. It then records a separate private session token plus the exact session id, supervisor and listener PIDs, process group, process start identity, Vite command, working directory, Git common directory, source SHA, and fixed Apex port, and it reports `session-dev`, never `runtime-ready`.

`turn:end` automatically performs the inverse handoff when `--session` or `AGENTIC_SESSION_ID` matches that record. After canonical-source, lifecycle, and protected-check preflight, one host lock covers validation of the session listener, graceful process-group stop, port release, canonical storage and Apex startup, and all three HTTP probes. A wrong or missing session, reused PID, changed start time, command, directory, repository, source SHA, token, or listener blocks before termination, and an unrecorded `npm run dev:apex` process remains unmanaged and is never adopted or killed.

Status re-proves source, protected checks, process ownership, listeners, and HTTP without mutation. Stop accepts only token-owned recorded process groups:

```sh
npm --prefix "$AGENTIC_CANVAS_OS_ROOT" run runtime:local:status -- \
  --repository="$GITHUB_ROOT/knowgrph" --json
npm --prefix "$AGENTIC_CANVAS_OS_ROOT" run runtime:local:stop -- \
  --repository="$GITHUB_ROOT/knowgrph" --json
npm --prefix "$AGENTIC_CANVAS_OS_ROOT" run runtime:session:status -- \
  --session="$AGENTIC_SESSION_ID" --repository="$GITHUB_ROOT/knowgrph" --json
npm --prefix "$AGENTIC_CANVAS_OS_ROOT" run runtime:session:stop -- \
  --session="$AGENTIC_SESSION_ID" --repository="$GITHUB_ROOT/knowgrph" --json
```

This is the reference adapter for the neutral Runtime Review Receipt, not Production authorization or deployment. Task worktrees never become runtime sources. `turn:end` persists an `agentic-local-review-candidate/v1` receipt that joins the protected Integration Receipt and binds canonical Knowgrph and Agentic Canvas OS commits, trees, dependency closure, policy, live probes, protected checks, and any explicitly tolerated non-blocking foreign residue. Candidate preparation may be dispatched idempotently from that joined receipt, but no local command, terminal turn, merge event, user, device, or agent may synthesize the Human Authorization Receipt. A read-only follow-up reruns `runtime:local:status` before claiming readiness, and an implementation turn reruns `turn:end` idempotently.

For a completed task, use the explicit integration command from the leased task worktree. It validates and commits only an exact approved dirty-path set, preflights and merges the current fetched protected `main`, publishes through the protected pull request, waits a bounded time for `MERGED`, completes the durable lease, fast-forwards the integrated canonical source, and reconciles the managed Knowgrph runtime through the Agentic Canvas OS `turn:end` supervisor. Reconciliation is revision-driven rather than restart-driven: the repository adapter records `no-op` only for an owned runtime already proving the integrated revision, may use `reload` only when it safely attests that revision, and otherwise replaces only its recorded process group with `restart`. Its receipt must bind `integratedSourceSha`, `canonicalSourceSha`, `runtimeSourceSha`, strategy, ownership evidence, functional probes, and status; only equal revisions plus successful probes may report `runtime_ready`, while failure preserves source status `integrated` with runtime status `blocked` and grants no deployment authority:

```sh
npm --prefix "$AGENTIC_CANVAS_OS_ROOT" run device:integrate -- \
  --session="$AGENTIC_SESSION_ID" \
  --repository="$TASK_WORKTREE" \
  --commit-message="<intentional single-line subject>" \
  --paths-manifest="<absolute-path-to-change-manifest.json>" \
  --json
```
The commit options are required only while the worktree is dirty. `--commit-message` must use `<type>(<leased-scope>): <summary>` with `feat`, `fix`, `docs`, `test`, `refactor`, or `chore`, a summary of at most 60 characters, and at most 72 total characters. The controller rejects whitespace or scope drift before validation or staging, then preserves that subject and writes an explanatory body plus a final `Agentic-Task`, `Agentic-Scope`, `Agentic-Lease-Epoch`, and `Agentic-Mechanism` trailer block from the exact writer lease and current cloud claim when present. The external manifest is coordination input, not an authored task file, and has this exact shape:

```json
{"schema":"agentic-change-manifest/v1","branch":"agent/<device>/<scope>","baseSha":"<lease-base-sha>","paths":["path/owned-by-task"]}
```

Changed paths must equal `paths` before and after `npm run check`; the command stages those paths explicitly and rejects any residue. A clean worktree must already contain an authored commit beyond its fence. Runtime reconciliation targets the sibling canonical Knowgrph checkout by default; use `--runtime-repository=<path>` only for a nonstandard workspace layout.
For an ordinary active admitted lane, `device:integrate` invokes the configured authority-continuation adapter before validation, after validation immediately before committing, and again before publication. The adapter retains an already-sufficient expiry and otherwise performs a monotonic `continue(claim)` renewal; each result must keep the same claim, branch, session, semantic scope, admitted write-set digest, and unchanged repository bytes with a current local expiry bounded by the cloud expiry. This does not revive expired authority, add a provider-specific lifecycle state, or turn a prepared commit into recovery or deployment authority.
Repository-owned integration may also converge an ancillary canonical source when its package and origin names are identical safe repository identities and the command supplies an explicit valid Agentic Canvas OS controller root. Canonical runtime reconciliation additionally requires an explicit valid Knowgrph runtime root. The ancillary SHA is bound independently before and after `turn:end`, which must still prove the exact canonical Agentic Canvas OS and Knowgrph revisions before the integration can report `runtime_ready`. Ambiguous identities, implicit controller discovery, source drift, or a mismatched runtime root fail closed.
If protected synchronization advances a published pull request, integration accepts a bounded exact first-parent chain from the recorded delivery head. Every refresh must have exactly two parents, use the preceding head as its first parent, use a second parent contained by current protected `main`, and have the same tree as the deterministic merge of those parents.
It fetches the immutable pull-request head, admits only a clean local HEAD that is an exact chain member, fast-forwards to the observed head, and records either the compatible single-refresh receipt or the ordered refresh-chain proof; authored, non-ancestral, discontinuous, octopus, tree-mismatched, or unbounded movement fails closed.
`--runtime=none` is valid only for a lane declared `runtimeRequirement: not-required`. It emits source status `integrated` and runtime status `not-required`, never `runtime_ready`. For a `required` lane, runtime evidence remains mandatory.
After canonical convergence and any required runtime proof, the command may use
the lifecycle cleaner only when its own exact target is independently cleanup-eligible;
the task branch and commits remain recoverable.

The completion wrapper fails closed unless the working tree is clean, the task
branch has a merged pull request targeting `main`, its merge commit is contained
by fetched `origin/main`, the task worktree detaches at that exact commit object,
and the checkout remains clean. It records a durable `completing` intent before
cleanup, retires only fully proven restored stash/ref evidence under the shared
stash-operation lock, and records `completed` only after clean detachment. A
retry may start detached, proves the recorded merge and prior main SHA remain
ancestors of the current canonical tip, and finishes only the missing phase.
If the attached merged branch lost its local lease record, completion may recover
only the exact writer-lease marker preserved in that merged pull request body; no
session, branch, base, fence, or head evidence may be synthesized locally.
Its JSON must name
`completedBranch`, `pullRequestUrl`, `mergeCommitSha`, `mainSha`, and
`"status":"ok"`. `device:end` keeps that gate for actual completion replay and
must never park unmerged work and label the result complete. When the canonical
worktree is already clean on exact fetched `main` and no active or completing
lease still owns that worktree, `device:end` returns the same compatible JSON as
an idempotent no-op with null branch, pull-request, and merge fields plus a
machine-readable `disposition`; dirty, stale, or actively leased `main` still
fails closed.

For legacy local-only work intentionally paused or blocked, run `npm run device:park` and report
the state explicitly. A cloud-admitted lane fails closed before local parking until explicit cloud handoff/reclaim owns the transition. Legacy parking preserves dirty work under a deterministic message,
exact stash commit, and immutable per-lease `refs/agentic-canvas-os/parked/...`
ref before detaching at `origin/main`. Resume restores that exact object and
verifies staged, tracked, untracked, mode, and conflict state. Repeated park
cycles pin the successor before retiring only the prior restored object; unrelated
worktree stash entries and refs must survive. Parking never satisfies completion.

### Session-End Worktree Lifecycle

Audit the current task worktree at the end of every chat, session, or thread, but do not equate conversation end with task completion. First choose exactly one durable state: complete through the protected merge protocol, park unfinished work, or keep an active leased lane when the same task is intentionally continuing.

For a runtime-required lane, `turn:end` must finish ready against the canonical protected SHAs with no runtime-blocking residue, or the final response must report the missing proof. A runtime-not-required lane reports that declaration and does not infer readiness. Task heads never replace canonical runtime ownership.

Before canonical convergence or temporary review isolation, emit joined Overlap Preservation and Disposition Receipts under the shared operation lock. Keep overlapping work retained with its recovery handle; restore only exact disjoint state, and retain it on any path, byte, fence, or protected-tip drift.

Run the repository-owned lifecycle check from the canonical main worktree:

```sh
npm run worktree:lifecycle:check
```

Interpret the lifecycle report at two levels: its global status summarizes all observed lanes, while each target's disposition governs only that exact checkout. Global `attention-required` means at least one retained lane needs attention; it authorizes no broad action and does not by itself veto a different target whose exact receipts prove cleanup eligibility. An implementation that cannot isolate target cleanup must remain fail-closed until its repository adapter can do so.

The check retains the canonical worktree plus active, delivery, parked, `owned-untracked`, and completion-proven lanes. It records attribution and object identity without copying contents, and fails closed on unattributed, unregistered, stale, ambiguous, invalid, or unexplained residual state.

A target becomes cleanup-eligible only after `device:complete` verifies its exact merge, ledger retirement, clean detachment at the fetched canonical ref, and completed lease. `canonical-equivalent` remains retained until an exact reconciliation receipt proves `already-integrated`; byte equality alone never authorizes retirement.

Remove one eligible checkout explicitly from the canonical main worktree:

```sh
npm run worktree:lifecycle:cleanup -- --worktree="$TASK_WORKTREE"
```

Cleanup removes only the named checkout without force, then proves its registration and path are absent without pruning unrelated records. It preserves every other worktree, branch, commit, and recovery handle; uncertain or `owned-untracked` bytes remain with their physical owner. Parking, stashing, and branch deletion require their own explicit authority.

Given a completion claim, the Integration Receipt proves the protected review merged, while the Cleanup Receipt independently proves `registeredAfter:false`, `pathExistsAfter:false`, and `registrationPruned:false` for the exact target. Canonical source converges separately and, when runtime is required, the original failure is retested on that SHA. Integration grants no production or deployment authority.

VCC: Verify `npm run device:integrate -- --json` exits zero with schema `agentic-device-integration-result/v1`. Report Integration, Runtime, and Cleanup Receipts separately: runtime is `runtime_ready` for `required` or `not-required` for `not-required`, and cleanup proves exact target absence without broad pruning while preserving branch and commits. Any missing required item leaves the task pending, paused, or blocked.

Session-end VCC: Verify the lifecycle report names every registered worktree and disposition. A runtime-required review-ready lane proves one owned ready server at the reviewed app and canonical docs SHAs; cleanup accepts only its exact eligible target; canonical source remains clean; and no unrelated runtime or deployment target is mutated.

If new scoped work remains, fetch, inspect, and activate a new task ref in a detached registered worktree. Projection drift uses its owner module's typed recovery; never create a generic reconciliation lane or use pull to absorb unexplained dirt.

## Handoff and Conflict Rules

- A handoff names the exact pushed commit SHA and paired app/docs/catalog manifest digest; the sender stops writing before the receiver starts.
- A writer handoff also marks the prior lease parked, names its final epoch and fence SHA, and requires the receiver to claim a strictly newer epoch before mutation.
- Same-device and different-device chats may mutate different scopes concurrently through distinct registered worktrees or clones only while the cloud CAS ledger verifies non-overlapping declared write sets. The Git-common-directory registry is a local projection; duplicate scopes, expired sessions, incomplete remote inventory, and stale fences fail closed.
- Post-baseline authored or untracked paths remain owned by their physical task worktree and pull request across chat, turn, and session boundaries. An unrelated lane may inspect attribution but must not delete, stash, mask, relocate, commit, park, or claim those paths.
- A runtime handoff includes the successful `npm run collaboration:gate` summary with two distinct automated peers, exact visible revisions, and the common non-empty verification digest; a branch name, screenshot, clipboard export, or manually assembled JSON never establishes parity.
- Reconcile upstream changes in the owned task branch before final validation.
- Resolve conflicts at the source owner; remove stale or duplicate logic instead of stacking aliases or downstream patches.
- Use force-with-lease only when repository policy allows it and one writer is reconfirmed; otherwise use a new reconciliation branch.
- Keep `main` read-only for agents and integrate through the protected Integration Gate.

## Stop Conditions

Stop before build mutation when scoped admission lacks an actual-path manifest, operation-derived complete live cloud inventory, current exact claim, safe absent target, joined Admission and Preservation Receipt digests, or an immediate cloud/local authority recheck; when the canonical worktree is dirty or not exact its fetched canonical ref; when the candidate is dirty before admitted mutation; when a worktree is unregistered, prunable, or shared; when peer dirt is unattributed, ambiguous, overlapping, or drifts without supported typed proof; when source ownership, task ref, lease, review request, epoch, fence, ledger, or expiry is ambiguous or stale; when fetch fails; or when memory, planning, or any declared runtime gate fails. An attributed disjoint dirty peer remains preserved in place and does not by itself block candidate admission.

## Completion VCC

Given a declared device, session, semantic scope, and task worktree, when `/session.start` reports `authoring_status: ready`, then both repositories' remote refs are fetched, the registered main worktrees remain clean at their fetched bases, the task path is a distinct registered worktree, one unexpired branch-bound lease and one draft pull request own the semantic scope, the lease worktree path, epoch, and fencing SHA match the task branch, memory logs and planning Context records are compliant, and Codex mutates only its leased task worktree. When it additionally reports `parity_status: passed`, one application-root runtime owns global identity, MainPanel Settings projects the gate as shared KTV rows, every participating running surface visibly reports identical exact Knowgrph and Agentic Canvas OS SHAs, and catalog hydration is fresh with matching full-catalog counts and one browser-verified SHA-256 catalog digest across `/`, `#`, and `@`.

VCC: verify both fetches exit zero; `git worktree list --porcelain -z` identifies one registered `main` owner plus the declared task worktree; every checked-out branch is unique; the Agentic Canvas OS main worktree is clean with `HEAD` equal to fetched `origin/main`; the task lease registry entry matches its session, branch, and path; memory and planning checks pass; the Knowgrph main worktree remains clean; and no Prod mirror or Cloudflare action occurred. Before any parity-dependent handoff, additionally verify `npm run collaboration:gate -- --json` exits zero with schema `agentic-collaboration-gate-result/v2`, two distinct automated peers, exact revisions, fresh bounded hydration, and one common verification digest.
