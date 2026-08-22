---
title: "Managed Autonomous Implementation Runs"
graphId: "md:agentic-canvas-os-managed-implementation-runs"
doc_type: "Runtime Contract"
date: "2026-07-29"
lang: "en-US"
schema: "managed-implementation-runs/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "invocation grammar and protected repository lifecycle for managed implementation work"
publish_policy: "Dev delivery-ready run state by default; an immutable opt-in may enable protected auto-merge, while runtime-ready completion remains enforced locally"
runtime_scope: "isolated work-item planning, provisioning, execution handoff, verification, review, and lifecycle evidence"
runtime_claim: "Agentic Canvas OS owns invocation and fenced Git lifecycle; Knowgrph owns the durable local MCP run supervisor and management projection"
runtime_proof: "RUNTIME-PROOF.md"
invocation:
  action: "/implementation.run"
  semantics: ["#managed-implementation-run", "#multi-agent-collaboration", "#runtime-ready"]
  bindings: ["@work-item", "@implementation-run", "@sandbox-workspace", "@runtime-proof", "@operator"]
mcp_tools:
  - "knowgrph.implementation_run.plan"
  - "knowgrph.implementation_run.start"
  - "knowgrph.implementation_run.list"
  - "knowgrph.implementation_run.control"
  - "knowgrph.agentic_sdlc.observe"
external_pattern_sources:
  - "https://github.com/openai/symphony/blob/1f3219bb1ea5f69a1305dc594e79b0db57c113c5/SPEC.md"
  - "https://openai.com/index/open-source-codex-orchestration-symphony/"
external_dependency: "forbidden"
---

# Managed Autonomous Implementation Runs

## Outcome

One work item becomes one observable, isolated implementation run. A team manages the work item, acceptance state, evidence, and review decision instead of watching an agent conversation or approving every ordinary implementation step.

The managed-run default terminal state is `delivery_ready`: durable run evidence is complete and the ACOS lease/CLI has reached `review_ready`, meaning the matching PR is ready for team review. Neither status means delivered, merged, released, deployed, or accepted. Protected integration requires a later `delivery_authorized` cloud receipt that binds the unchanged reviewed head, evidence, scope, claim, epoch, fence, ledger revision, and explicit operator integration intent without reopening authoring. This policy is never inferred from an ordinary message, chat, session, or thread ending. The repository-owned release controller remains the only production authority.

## Canonical Invocation

```text
/implementation.run #managed-implementation-run @work-item @implementation-run @sandbox-workspace @runtime-proof
```

The exact `/`, `#`, and `@` tokens resolve only from the three dictionaries. Unknown tokens remain unknown and must fail before provisioning, model spend, mutation, or lifecycle claims. A dictionary match supplies invocation metadata; it does not itself grant execution or approval.

The separate read-only observation composition is:

```text
/sdlc.observe #agentic-sdlc-observability @implementation-run @canvas @runtime-proof
```

It reads an immutable run-ledger receipt and projects source state through existing KGC, GraphData, and Canvas owners. It does not invoke `/implementation.run`, control a run, grade a task, or grant delivery or deployment authority.

## Ownership

| Owner | Responsibilities | Forbidden ownership |
|---|---|---|
| Agentic Canvas OS | Canonical invocation, branch grammar, safe task-worktree provisioning, writer lease, fencing epoch and SHA, pull-request identity, heartbeat, park, resume, review-ready handoff, delivery authorization, protected integration, and completion proof. | Durable run scheduling, runner process supervision, application UI state, implicit merge authority, or deployment. |
| Knowgrph local stdio MCP | Durable run ledger, idempotency, configured runner selection, child-process supervision, event and evidence capture, bounded verification, recovery, and team-facing list/control projection. | A second Git lock, copied invocation registry, arbitrary shell commands, direct main mutation, automatic merge, or deployment. |
| Configured runner | Work-item implementation inside the leased task worktree and allowed-path boundary. | Canonical main, sibling worktrees, credentials, lifecycle metadata, PR merge, or deployment. |
| Operator or reviewer | Approval, rejection, requested changes, and explicit selection of protected delivery when appropriate. | Implicit approval inferred from a run reaching `delivery_ready`. |

## Work Item And Run Identity

`@work-item` binds the durable request: stable work-item id, objective, acceptance criteria, repository root, human `semanticScope`, allowed paths, verifier profile ids, runner id, attempt limit, and time bound. Knowgrph resolves each verifier profile to an exact host-owned command; the work item contains no verification argv, arbitrary executable string, or secret.

Knowgrph retains caller `semanticScope` as human metadata and derives a distinct ACOS lane scope of at most 48 characters with a 96-bit run-id suffix. ACOS does not reinterpret or truncate that value: `device:start` receives and proves the exact supplied lane scope in the branch, lease, PR marker, and machine result, so separate runs cannot collide merely because their human scopes match.

`@implementation-run` binds one immutable run id to that work item plus its current versioned state. The run record references the exact repository base, task worktree, branch, lease epoch, fence SHA, pull request, runner attempt, evidence, and last transition. Mutable writes use idempotency and compare-and-set behavior; history is append-only evidence.

## Local MCP Surface

| Tool | Role | Mutation boundary |
|---|---|---|
| `knowgrph.implementation_run.plan` | Validate invocation, work item, repository, runner availability, sandbox-policy preflight, bounds, and proposed worktree without creating it. | Read-only and zero model spend. |
| `knowgrph.implementation_run.start` | Persist one idempotent run request, provision and claim its fenced task lane through Agentic Canvas OS, then start the configured supervisor. | Mutates only the run ledger, new task worktree, task branch, lease, and ownership PR. |
| `knowgrph.implementation_run.list` | Return bounded run summaries, blockers, evidence references, and next team action. | Read-only; no polling loop or model call. |
| `knowgrph.implementation_run.control` | Pause, cancel, retry, request review, or record an operator decision against a current run version. Retry performs fenced ACOS resumption when the prior lane must reactivate. | Explicit control plus state precondition required; delivery remains a separate operator-authorized action. |
| `knowgrph.agentic_sdlc.observe` | Validate one exact immutable ledger receipt and return a deterministic, bounded end-to-end KGC and GraphData projection for the existing Canvas. | Read-only, local, model-free, network-free, zero-token, zero-cost, and Dev-only; no run, ledger, source, Canvas, review, release, Prod, or Cloudflare mutation. |

The tools are MCP-invocable. The exact invocation tokens also make the capability `/`, `#`, and `@` discoverable through the existing catalog projection; they do not create alternate tool names or a second dispatcher.

## Observation Boundary

The observer request names the exact invocation, `runId`, bounded `view`, `expectedRevision`, and `expectedLedgerDigest`, plus an optional cursor and limit. Its prerequisite is the receipt at `state.result.agenticSdlcLedger` with schema `agentic-sdlc-ledger-receipt/v1`, local artifact reference, digest, byte count, canonical run id, ledger revision, and exact Agentic Canvas OS revision. The receipt and artifact bytes must agree before projection.

The tool returns `knowgrph-agentic-sdlc-observation/v1`. Its `projection` is `agentic-sdlc-canvas-projection/v1`, containing deterministic GraphData plus KGC Markdown rather than a copied run store, graph database, dashboard, or renderer. Run, criterion, VCC, task, transition, dispatch, return, check, evidence, finding, budget, receipt, gate, and checkpoint records retain their source identities and typed relationships. Views and pages are digest-bound, stubs preserve typed missing endpoints, and cache reuse requires the same receipt digest, revision, view, cursor, and limit.

Managed run evidence may project `delivery_ready` only when it is joined to ACOS `review_ready` at the exact review head. That operational state is not the canonical Agentic SDLC success state `verified`; only the named independent Evaluator can produce the latter in a conforming ledger. `deployed` is a third release-lifecycle observation that requires exact existing Human Authorization and Live Verification receipts. The observer never converts among these claims and never supplies missing canonical VCC, grant, budget, role, transition, consumption, receipt, authorization, or deployment evidence.

## Run State Model

| State | Meaning | Allowed next states |
|---|---|---|
| `planned` | Inputs and zero-mutation preflight passed. | `queued`, `canceled`, `blocked` |
| `queued` | Durable request awaits one supervisor claim. | `claiming`, `paused`, `canceled`, `blocked` |
| `claiming` | ACOS provisioning and fenced lease acquisition are in progress. | `running`, `failed`, `blocked`, `canceled` |
| `running` | Configured runner owns the active attempt in the task worktree. | `verifying`, `paused`, `failed`, `blocked`, `canceled` |
| `verifying` | Declared checks, allowed-path diff, scan, and evidence capture are bounded. | `delivery_ready`, `running`, `failed`, `blocked`, `canceled` |
| `delivery_ready` | Branch and proof are pushed and ACOS reports lease status `review_ready`; the matching PR is ready for team review with no merge automation by default. An immutable `autoDelivery` lease may wake protected auto-merge only for the exact `reviewHeadSha`. | `queued` after fenced resume, `canceled`, or protected delivery |
| `paused` | Supervisor stopped new work and retained resumable evidence. | `queued`, `canceled` |
| `blocked` | A typed external or policy prerequisite prevents progress. | `queued` after the prerequisite changes, `canceled` |
| `failed` | An attempt ended terminally with captured diagnostics. | `queued` within attempt bounds, `canceled` |
| `canceled` | No further runner or verification work may begin. | none |

One supervisor owns transitions for a run. Restart reconstructs from durable state and observed process/worktree evidence; it never infers success from a missing process. A retry revalidates repository, invocation, runner, policy, attempt, and time eligibility before claiming a new attempt. An unexpired same-session active lane may heartbeat; an expired active implementation lane never renews for ordinary work and must park or report blocked. The sole exception is exact same-session reconciliation of an incomplete start or successor resume claim while its worktree, base, epoch, empty-claim shape, draft PR marker, and remote handoff/fence remain unchanged; renewal only enables the missing activation steps, and a competing remote fence wins. Exact same-session parked recovery may retain descendant local commits only when registry, worktree, branch, PR, epoch, fence, and ancestry evidence match; every cross-session handoff requires the exact remote head. Dirty parked work is additionally bound to an immutable repository ref, stash commit, parent branch head, source epoch/fence, and message. Only the exact same session and worktree may restore it; clean parked work retains the generic handoff path.

## Isolated Provisioning

Machine callers may create and claim a lane in one operation:

```sh
node "$AGENTIC_CANVAS_OS_ROOT/scripts/device-branch.mjs" start "<semantic-scope>" \
  --session="<stable-run-session>" \
  --repository="$REPOSITORY_ROOT" \
  --provision \
  --worktree="$GITHUB_ROOT/.worktrees/<repository-name>/<safe-run-name>" \
  --json
```

Provisioning requires a clean registered canonical `main` exactly equal to fetched `origin/main`. The target must not exist and must be a safe direct child of the derived sibling `.worktrees/<repository-name>` root. Existing symbolic-link ancestors, target collisions, unexpected branches, dirt, divergence, duplicate scope ownership, or lease failure stop the operation. Automatic rollback may remove only the just-created clean detached exact-base worktree when the lease registry proves no claim occurred.

Existing callers may continue to create a detached task worktree themselves and call `device:start` without `--provision`.

If the combined operation is interrupted after the lease claim, the durable caller retries `device:start` against the recorded task-worktree path without `--provision`. Start reuses only the same session, worktree, branch, base, epoch claim subject, fence, remote head, and draft PR; a lost PR-create response is reconciled from the one matching open draft. It does not create another claim commit or PR. Any mismatch fails closed.

## Machine Lifecycle Interface

`start`, `resume`, `heartbeat`, `review`, `publish`, and `park` accept `--json`. Success emits exactly one stdout object with schema `agentic-device-command-result/v1`: `ok`, `action`, `status`, `repoRoot`, `branch`, `worktreePath`, `provisioned`, `pullRequest: { url, number, isDraft }`, and projected lease/fence evidence. Park also exposes immutable `stashRef`, `stashSha`, and `stashStatus` evidence. Failure exits nonzero with the same schema, `status: error`, and a typed error object. Human and child-process progress never shares machine stdout.

`complete` and `end` retain their existing compatibility result: `completedBranch`, `pullRequestUrl`, `mergeCommitSha`, `mainSha`, and `status: ok`. The separate operator-selected `integrate` action emits `agentic-device-integration-result/v1`; its default success is `runtime_ready` only after the protected merge, durable completion, canonical source convergence, and managed Knowgrph runtime proof all agree. Managed runs do not invoke it implicitly.

GitHub's observed `isDraft` value is a lifecycle invariant, not a value inferred from the local lease marker. Successful `start`, `resume`, `heartbeat`, and managed `park` operations prove `isDraft: true`; successful `review` and `publish` operations prove `isDraft: false`. A manually readied active PR makes heartbeat fail before lease renewal. Review-ready and same-session delivery resume demote a ready PR with `gh pr ready --undo`, then independently re-query and prove draft state before claiming a new epoch or making another writer mutation.

An explicit heartbeat `--repair-pr-projection` transition handles the narrower
case where GitHub keeps an ownership PR at a strict ancestor after the active
branch, local fence, and remote fence agree. It binds the source PR, stale and
expected heads, epoch, and any owned-dirt digest in a replayable lease receipt;
close/reopen is attempted first, and a distinct replacement draft is created
only while the old projection remains stale. Review and publish fail closed
unless the resulting PR head exactly equals the local pushed head.

`review` checks, pushes, updates the PR title from the reviewed commit, preserves authored work-item and evidence text, replaces only hidden lease metadata, records `reviewHeadSha`, and makes the PR ready without an automerge label or merge call by default. An immutable `--auto-delivery` start lease additionally records `autoDelivery` and `runtimeRequired`, then adds the `agentic/auto-delivery` workflow wake label only after the implementing agent has classified the run as terminal, confirmed no required work remains, and persisted its exact review marker. Ordinary conversation, questions, status or read-only turns, waits, partial progress, dirty or parked work, and blocked outcomes never trigger that handoff. The trusted repository controller accepts only that same-repository reviewed SHA and enables GitHub protected auto-merge; it does not rewrite the head, resolve conflicts, bypass checks, deploy, or report completion. Requested changes use `resume <exact-branch>`; exact reviewed local, remote, PR, and fence evidence is required before a new epoch can reactivate the lane. Review-ready handoff may transfer to a new session only while clean. The explicit `--recover-owned-dirt` resume exception is restricted to the exact prior review-owning session, attached branch, worktree, PR, reviewed head, remote head, fence, and epoch; it records an exact dirt-evidence digest on the successor lease and uses an empty `--only` claim commit so no authored byte enters the fence. Only that empty claim push uses `--no-verify`, bracketed by exact dirt-evidence checks; it bypasses the checkout-local pre-push hook, not lifecycle review, publish, integration, protected checks, or deployment. A clean expired active lease with committed descendants is recoverable only by the same session when local registry, worktree, branch, PR head, remote marker/fence, and ancestry agree; the successor atomically retains a local-only pre-claim head/tree and range-diff digest plus exact source status, epoch, session, device, scope, branch, base, fence, PR, and integration evidence. If the prior integration annotation is missing, `device:integrate` requires the original source-base path manifest and intentional commit message, revalidates paths and diff, and runs the full check before publish, without demanding a new authored byte beyond the successor claim fence. Resume is replay-safe after PR demotion, local claim, empty claim commit, lease annotation, remote push, or PR-body edit: it accepts only the exact same-session successor epoch, worktree, PR, branch, single-parent empty claim subject and base, and exact remote fence, then finishes only the missing steps. Publishing a reviewed head first requires an explicit fenced resume to active ownership; `publish` never consumes `review_ready` directly, retains the protected auto-merge path, and is never the managed-run default. The automatic path may be completed only by `device:integrate` with canonical runtime reconciliation; it rejects `--runtime=none` and reports success only as `runtime_ready` after merged-SHA, canonical-source, and supervised runtime proof agree.

The dedicated clean committed heartbeat command chooses its cloud continuation from a fresh exact-claim inventory. An unexpired `current` claim uses ordinary `renewal`; an expiry-projected `dormant-preserved` claim uses authenticated `recovery` bound to the complete committed snapshot digest. A lost response is accepted only by replaying the original idempotency key and exact source fence, counter, write set, revision, review request, and operation receipt. Heartbeat-counter evidence distinguishes renewal replay from recovery replay; when older projections lack that counter, both exact keys may be probed fail-closed, and foreign progress satisfies neither. Only after cloud verification does the controller compare the unchanged snapshot, CAS the local lease, and replace its hidden PR marker. Neither path changes HEAD, index, authored bytes, branch refs, PR draft state, auto-merge, integration, release, or deployment authority.

A planned task-bound lane that already owns dirt at its unchanged fence may
expand its declared scope only through
`planned-owned-dirt-scope-expansion-recovery.mjs`. The read-only plan seals the
source lease, current or dormant-preserved claim, task binding, draft review,
controller revision, exact modified and untracked bytes, and a strict-superset
manifest. Exact typed authorization precedes a journaled waiting-successor,
source-retirement, successor-promotion, review-binding, writer-registry CAS,
and hidden-marker sequence. The target keeps the source base, branch,
worktree, fence, review, session, device, local epoch, and task subject. Replay
uses the same cloud idempotency keys and adopts only the exact local successor.
The completion receipt restores scoped mutation authority only; it changes no
Git bytes, index, refs, review state, merge, runtime, release, deployment, or
cleanup state. See `PLANNED-OWNED-DIRT-SCOPE-EXPANSION-RECOVERY.md`.

An expired cloud-admitted `active` lane that still contains owned modified or untracked bytes is not a resume or handoff subject. Its exact recorded source session may run `active-owned-dirt-recovery.mjs plan`, then `execute` with the returned typed plan authorization. The controller admits only the unchanged attached branch, exact open draft same-repository PR node/URL/body with no delivery request, remote fence, admission manifest, public v2 dormant claim provenance, opaque work item, positive cloud epoch, and in-scope dirt. Its cloud/local base may precede a lagging PR base and current protected `main` only through a proven disjoint descendant chain. It securely reads every dirty path without following observed symlink or non-directory ancestors, prehashes before object writes, and pins exact HEAD/index/worktree/untracked/type/mode/blob evidence under a content-addressed local snapshot ref. That ref is intentionally retained as recovery evidence after success; removal requires a separate exact-ref lifecycle decision and is never broad pruning. The controller replays only the identical idempotent continuation, verifies the producer operation receipt and current outer-ledger receipt, atomically advances the local epoch for the same session/device, and replaces only the hidden PR lease marker. A durable registry intent makes interruption replay single-effect, validates completed replay, supports a later independently authorized expiry recovery, and blocks heartbeat from crossing the transition. The command does not touch authored bytes, the real index, HEAD, branch/remote refs, PR draft state, auto-merge, merge queues, or deployment controls, and it never transfers dirt. Observed symlink or identity drift fails closed under cooperative registry/process serialization; adversarial directory-entry swaps after final path checks are outside this boundary. The managed run resumes authoring only from the returned mutation-authority receipt, then must become clean and use ordinary `device:review` to reach `review_ready`.

When strict protected-main policy leaves an already delivery-authorized pull request behind, the device may dispatch the trusted `protected-head-refresh` operation at canonical `main`; neither the device nor the controller uses GitHub's update-branch API. The dispatch binds the PR number, node, title, same-repository branch and refs, delivered and observed heads, the selected `target_main_sha`, canonical delivery base, integrated-preserved claim fence, ledger projection, review and integration receipts, transition counter, immutable controller revision, and two different SQUASH requests. The original human request retains its exact actor database/node/login/type identity, title, and nullable body. The candidate request retains that actor and title but binds a deterministic, explicit non-null body derived from the PR number, delivered head, and target main; both distinct requests are included in the non-circular operation digest. The trusted controller must itself run at `target_main_sha`. It proves the original request and live authority, constructs one deterministic commit with parents `[observed_head_sha, target_main_sha]`, the conflict-free `merge-tree` result, fixed GitHub Actions bot identity, immutable-first-parent timestamp, and exact operation trailers. Immediately before publication it rereads the exact original armed request and proves that strict protected-main policy requires `cloud-collaboration` from GitHub Actions app `15368` while the deterministic candidate has no such check or success. Only then may the feature ref advance through an environment-authenticated exact `--force-with-lease=<branch>:<observed_head_sha>` compare-and-swap. The required context is therefore absent on the new head and blocks merge before any asynchronous follow-up. The controller never disables or enables auto-merge. An original head already at `auto_merge=null` is a user revocation and stops without mutation. Tracing is scrubbed, no token appears in arguments or logs, the `GITHUB_TOKEN` push must produce no `pull_request_target` synchronize run for either delivery workflow, and protected `main` is never pushed.

Repository enrollment is an adapter boundary, not a controller fork. A validated `agentic-protected-head-refresh-repository-policy/v1` selects the repository-owned CI workflow, exact successful source-check contexts, exact classic branch-protection checks, additional strict ruleset checks, and workflows whose provider-triggered synchronize runs must remain absent. The default profile preserves this repository's existing `ci.yml` and check topology. Consumer profiles may differ only through these bounded inputs; they cannot weaken exact GitHub Actions app binding, strictness, candidate identity, cloud authority, deterministic refresh construction, or the final operation-owned gate. Controller-policy integration must precede consumer enrollment, which must precede replay of any delivery-authorized candidate.

After the compare-and-swap, only the exact carried original request plus an absent required context may create the sole operation-owned pending `cloud-collaboration` gate; an already-null or already-candidate-authorized head without that prerequisite gate is ambiguous and requires explicit recovery. The pending check stores canonical JSON containing the complete normalized projection, operation ID, candidate, and handshake phase, and the controller rereads the candidate as `BLOCKED` before long work. It then proves the trusted `ci.yml` bytes against `target_main_sha`, exact classic and ruleset protection, no synchronize run, live cloud authority, and the newest exact workflow-dispatch suite. The selected suite and effective newest Actions checks must contain successful `test`, `build`, `docs-contract`, `collaboration-integration`, and `agentic-sdlc-policy-runtime` contexts. A separate authenticated user adapter (not this controller) must first observe the exact candidate, sole pending gate, and `BLOCKED` state. In one live interaction it issues raw GraphQL disable, requires a positive response carrying the exact client mutation ID and human actor, rereads the same unmerged candidate with `auto_merge=null`, then immediately enables SQUASH with `expectedHeadOid=<candidate>` and the projected deterministic title/body and rereads that exact candidate request. If its first observation is already null, the disable response is lost or ambiguous, cancellation races either step, or any identity drifts, it never auto-enables; explicit user recovery is required. A lost enable response is accepted only when the exact candidate request is already retained.

When the same serialized controller call completes its exact pending gate and GitHub immediately merges the candidate before the next pull-request read, that call carries the already-normalized terminal completion receipt into merged replay. If the just-completed check is no longer observable, replay accepts only that in-process receipt with the exact operation external ID and sole check-run ID. A later process, session, or chat has no carried receipt and remains fail closed under the explicit absent-merged authorization recovery contract; this exception cannot reconstruct or infer authorization from conversation state.

The controller merely waits for that fresh candidate request; the carried original request is never treated as re-authorization. It repeats CI, protection, no-synchronize, cloud, exact armed-and-`BLOCKED` PR, freshly fetched feature-ref, candidate-byte, target-main, and sole-pending-check proofs, and only then changes that exact check to success. Every per-ID reread must still match its name, head, external ID, Actions app, pending/null state, and durable projection; terminal failure is never overwritten. `UNKNOWN`, publication, CI visibility, and user authorization use bounded polling on a standard runner with a timeout above the complete bound. Merged replay of a refreshed candidate additionally requires complete owned authorization evidence, the exact deterministic candidate bytes and fetched branch, retained candidate SQUASH request and human merger, a one-parent squash whose direct parent is `target_main_sha`, identical candidate tree, exact subject and explicit body, and ancestry from fetched `origin/main`. Lost responses are replayed only from those exact states; metadata, ref, base, claim, workflow, ruleset, check-suite, authorization, or merge-proof drift fails closed. The original nullable body proves only the pre-publication request and is never mistaken for the candidate's explicit squash body.

Runtime handoff is canonical rather than branch-local. `npm run turn:end -- --repository=<canonical-knowgrph-root> --json` first runs the lifecycle audit, then requires both repositories to match exact fetched `origin/main` revisions with their required protected checks successful and no runtime-blocking residue in canonical checkouts. Foreign parallel residue that stays outside the runtime authority closure may be tolerated only when the repository-owned classifier marks it non-blocking. The Agentic Canvas OS supervisor owns fixed loopback Apex `5173` and storage `8787` through a private token stored outside both repositories, rejects unmanaged listeners, and proves Apex plus direct and proxied storage HTTP readiness. Task branches never serve canonical ports, and the supervisor never merges, deploys, accepts arbitrary commands, or kills an unrelated process.

`park` first proves the matching ownership PR remains draft and verifies the remote fence and local ancestry. Dirty state is stashed with a deterministic lease message, resolved to its exact commit, and pinned under a dedicated immutable `refs/agentic-canvas-os/parked/...` ref; moving selectors such as `stash@{0}` are never durable evidence. Shared stash mutation uses an owned lock that never removes a live or successor owner. Park then writes the projected lease to the PR, re-proves draft state, conditionally releases the unchanged local lease at the same timestamp, and detaches last. If stash capture, PR projection, release, or detachment is interrupted, the same session replays only exact evidence. Resume reclaims and proves draft ownership before applying that exact stash with index state, verifies tracked, staged, untracked, file-mode, and conflict evidence, marks it `restored`, and retains the object/ref proof. A lost apply or PR-edit response is idempotently reconciled without applying a different or moving stash. A later park pins its successor before retiring the prior restored object; completion first records `completing`, preserves the multiset of all unrelated stash entries and immutable refs during exact cleanup, detaches at a pinned canonical commit, and only then records `completed`. Detached retry accepts canonical advancement only after proving the recorded main and merge are ancestors.

Canonical divergence is not a task-lane park. The exceptional
`canonical:main:recover` command accepts only the primary registered `main`
worktree, an explicit acknowledgement, one stable session, and exact expected
local and fetched protected heads. It refuses mutation unless there is genuine
two-sided divergence and every single-parent local-only commit has both a
negative `git cherry` result and a stable patch-id match in the remote
divergence. Under the same shared park lock it pins the old HEAD, records an
exact tracked, staged, and untracked path manifest, captures that dirty state
beneath immutable refs and receipt blobs, and performs a replayable
detached-target and compare-and-swap main-ref transition. Ignored paths remain
in place only when their path digest is stable, ignore rules do not change, and
no protected target path collides. The terminal machine result is
`agentic-canonical-main-recovery-result/v1`; its receipt path, path-manifest
digest, old-HEAD ref, stash ref/SHA, and prepared, capture, and completion
receipt refs are preservation evidence only.

## Runner And Verification Boundary

- Runner and verifier selection resolve from repository or operator-configured profiles. Knowgrph expands verifier profile ids to exact host-owned commands; a caller cannot provide raw shell text, verification argv, executable paths, provider credentials, or environment overrides.
- Process launch uses an executable plus argv array without a shell. The supervisor supplies a minimal environment and captures bounded stdout, stderr, exit, timeout, and heartbeat evidence.
- Git worktree isolation is not kernel or container isolation. The result must name the effective containment class; a source-backed sandbox-policy preflight cannot claim host enforcement it does not provide.
- Allowed paths are normalized against the task root. Traversal or symbolic-link path inputs, lifecycle metadata edits, and undeclared task-tree changes fail verification. A worktree diff cannot detect arbitrary writes elsewhere on the host; pre/post canonical and registry evidence may expose drift but does not replace kernel or container containment.
- Verification commands are configured argv arrays with per-command and aggregate time bounds. Empty, unconfigured, or over-limit verification fails closed.
- Evidence redaction replaces exact configured runner environment values and values associated with heuristic secret-key labels; it cannot recognize arbitrary file-derived secrets or environment dumps. Callers and runners must not emit secrets. Output portions beyond `maxOutputBytes` are truncated before durable storage or return, the evidence marks that truncation, and exceeding the capture bound does not by itself reject the producer or run.

## Team Control Semantics

Pause stops scheduling new runner or verification work, records the last safe state, and parks only through the ACOS lifecycle when task-branch preservation is required. Cancel terminates the owned process within a bounded grace period, records the result, and forbids a silent restart. Retry creates a new attempt only after eligibility checks. Review hands off a pushed exact head. No control action may switch canonical main, delete an unrelated worktree, overwrite PR context, merge, release, or deploy.

## External Inspiration Boundary

OpenAI's public Symphony specification and announcement informed one high-level product question: represent autonomous engineering as durable work-item management rather than a collection of supervised agent chats. This contract and implementation were independently authored for the existing ACOS and Knowgrph owners.

No Symphony code, prose, prompt, schema, vocabulary set, algorithm, fixture, test, package, service, executable, repository checkout, or runtime endpoint is copied, imported, downloaded, invoked, or required. Removing network access to Symphony changes no local behavior. The pinned public links in frontmatter are attribution references only.

## VCCs

| VCC | Observable proof |
|---|---|
| Invocation is canonical | All four new exact tokens occur once in dictionary frontmatter and their owning table; catalog validation passes. |
| Provisioning is isolated | Focused tests reject unsafe path, collision, symbolic-link ancestor, dirty/divergent main, and post-claim rollback; canonical main remains unchanged. |
| Machine output is parseable | CLI tests prove exactly one stdout JSON object on success and failure, and every lifecycle action projects authoritative branch/lease state. |
| Review is not delivery | Focused tests prove review updates title/body evidence while invoking no `pr merge`, `--auto`, automerge label, Prod, or Cloudflare action. |
| Reviewed runtime is exact | Focused tests reject dirt, active or mismatched leases, local/remote/PR head drift, draft PRs, missing repository Dev ownership, canonical docs drift, and unrelated listener PIDs; live proof requires HTTP 200 at the recorded loopback URL. |
| Reactivation is fenced | Exact review head, remote branch, PR lease marker, prior epoch, and new fence are proven before another attempt. |
| Runtime is managed | Knowgrph focused tests prove idempotent plan/start, durable restart recovery, configured argv launch, pause/cancel/retry/review controls, bounded verification, and list projection. |
| Observation is source-backed and non-mutating | The ACOS catalog test plus Knowgrph observer tests require one exact immutable ledger receipt, deterministic KGC and GraphData output through existing Canvas owners, typed `verified`/`delivery_ready`/`deployed` separation, and exact zero network, model, token, and cost evidence. |
| Deployment stays closed | A run stops at `delivery_ready` with ACOS lifecycle status `review_ready` unless an explicit operator chooses the separate protected delivery workflow. |
