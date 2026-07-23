---
title: "Managed Autonomous Implementation Runs"
graphId: "md:agentic-canvas-os-managed-implementation-runs"
doc_type: "Runtime Contract"
date: "2026-07-22"
lang: "en-US"
schema: "managed-implementation-runs/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "invocation grammar and protected repository lifecycle for managed implementation work"
publish_policy: "Dev delivery-ready run state by default; protected delivery requires an explicit operator action"
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
external_pattern_sources:
  - "https://github.com/openai/symphony/blob/1f3219bb1ea5f69a1305dc594e79b0db57c113c5/SPEC.md"
  - "https://openai.com/index/open-source-codex-orchestration-symphony/"
external_dependency: "forbidden"
---

# Managed Autonomous Implementation Runs

## Outcome

One work item becomes one observable, isolated implementation run. A team manages the work item, acceptance state, evidence, and review decision instead of watching an agent conversation or approving every ordinary implementation step.

The managed-run default terminal state is `delivery_ready`: durable run evidence is complete and the ACOS lease/CLI has reached `review_ready`, meaning the matching PR is ready for team review. Neither status means delivered, merged, released, deployed, or accepted. Only an explicit operator-selected delivery path may invoke protected publication, and the repository-owned release controller remains the only production authority.

## Canonical Invocation

```text
/implementation.run #managed-implementation-run @work-item @implementation-run @sandbox-workspace @runtime-proof
```

The exact `/`, `#`, and `@` tokens resolve only from the three dictionaries. Unknown tokens remain unknown and must fail before provisioning, model spend, mutation, or lifecycle claims. A dictionary match supplies invocation metadata; it does not itself grant execution or approval.

## Ownership

| Owner | Responsibilities | Forbidden ownership |
|---|---|---|
| Agentic Canvas OS | Canonical invocation, branch grammar, safe task-worktree provisioning, writer lease, fencing epoch and SHA, pull-request identity, heartbeat, park, resume, review-ready handoff, protected publish, and completion proof. | Durable run scheduling, runner process supervision, application UI state, automatic merge by default, or deployment. |
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

The tools are MCP-invocable. The exact invocation tokens also make the capability `/`, `#`, and `@` discoverable through the existing catalog projection; they do not create alternate tool names or a second dispatcher.

## Run State Model

| State | Meaning | Allowed next states |
|---|---|---|
| `planned` | Inputs and zero-mutation preflight passed. | `queued`, `canceled`, `blocked` |
| `queued` | Durable request awaits one supervisor claim. | `claiming`, `paused`, `canceled`, `blocked` |
| `claiming` | ACOS provisioning and fenced lease acquisition are in progress. | `running`, `failed`, `blocked`, `canceled` |
| `running` | Configured runner owns the active attempt in the task worktree. | `verifying`, `paused`, `failed`, `blocked`, `canceled` |
| `verifying` | Declared checks, allowed-path diff, scan, and evidence capture are bounded. | `delivery_ready`, `running`, `failed`, `blocked`, `canceled` |
| `delivery_ready` | Branch and proof are pushed and ACOS reports lease status `review_ready`; the matching PR is ready for team review with no merge automation. | `queued` after fenced resume, `canceled`, or an operator-owned delivery decision |
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

`review` checks, pushes, updates the PR title from the reviewed commit, preserves authored work-item and evidence text, replaces only hidden lease metadata, records `reviewHeadSha`, and makes the PR ready without an automerge label or merge call. Requested changes use `resume <exact-branch>`; exact reviewed local, remote, PR, and fence evidence is required before a new epoch can reactivate the lane. Review-ready handoff may transfer to a new session. Resume is replay-safe after PR demotion, local claim, empty claim commit, lease annotation, remote push, or PR-body edit: it accepts only the exact same-session successor epoch, worktree, PR, branch, single-parent empty claim subject and base, and exact remote fence, then finishes only the missing steps. Publishing a reviewed head first requires an explicit fenced resume to active ownership; `publish` never consumes `review_ready` directly, retains the protected auto-merge path, and is never the managed-run default.

Runtime handoff is canonical rather than branch-local. `npm run turn:end -- --repository=<canonical-knowgrph-root> --json` first runs the lifecycle audit, then requires both repositories to be clean exact fetched `origin/main` revisions with their required protected checks successful. The Agentic Canvas OS supervisor owns fixed loopback Apex `5173` and storage `8787` through a private token stored outside both repositories, rejects unmanaged listeners, and proves Apex plus direct and proxied storage HTTP readiness. Task branches never serve canonical ports, and the supervisor never merges, deploys, accepts arbitrary commands, or kills an unrelated process.

`park` first proves the matching ownership PR remains draft and verifies the remote fence and local ancestry. Dirty state is stashed with a deterministic lease message, resolved to its exact commit, and pinned under a dedicated immutable `refs/agentic-canvas-os/parked/...` ref; moving selectors such as `stash@{0}` are never durable evidence. Shared stash mutation uses an owned lock that never removes a live or successor owner. Park then writes the projected lease to the PR, re-proves draft state, conditionally releases the unchanged local lease at the same timestamp, and detaches last. If stash capture, PR projection, release, or detachment is interrupted, the same session replays only exact evidence. Resume reclaims and proves draft ownership before applying that exact stash with index state, verifies tracked, staged, untracked, file-mode, and conflict evidence, marks it `restored`, and retains the object/ref proof. A lost apply or PR-edit response is idempotently reconciled without applying a different or moving stash. A later park pins its successor before retiring the prior restored object; completion first records `completing`, preserves the multiset of all unrelated stash entries and immutable refs during exact cleanup, detaches at a pinned canonical commit, and only then records `completed`. Detached retry accepts canonical advancement only after proving the recorded main and merge are ancestors.

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
| Deployment stays closed | A run stops at `delivery_ready` with ACOS lifecycle status `review_ready` unless an explicit operator chooses the separate protected delivery workflow. |
