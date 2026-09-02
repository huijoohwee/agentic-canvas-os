---
title: "Hybrid Cloud Workspace Contract"
graphId: "md:agentic-canvas-os-hybrid-cloud-workspace"
doc_type: "Runtime Contract"
date: "2026-08-29"
lang: "en-US"
schema: "agentic-hybrid-cloud-workspace/v1"
frontmatter_contract: "required"
status: "focused-tested"
authority: "provider-neutral execution-placement evidence and read-only canonical-checkout bootstrap"
publish_policy: "Dev source integration only; no Production or Cloudflare authority"
runtime_scope: "portable Dev Container configuration and deterministic read-only inspection of one clean canonical checkout"
runtime_claim: "the CLI reports locally observed placement and canonical-checkout readiness with mutationAuthority false; it does not evaluate live remote state, scoped admission, browser, mobile, MCP, WebMCP, integration, release, deployment, or cleanup"
runtime_proof: "../__tests__/cloud-workspace.test.mjs"
external_pattern_sources:
  - "https://github.com/webmachinelearning/webmcp"
  - "https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md"
external_reference_policy: "attribution-only clean-room research"
external_dependency: "forbidden"
---
<!-- Responsibility: Keep execution placement replaceable without creating alternate Git authority. -->

# Hybrid Cloud Workspace Contract

## Outcome

A governed task may be admitted from a local computer, an existing cloud
workspace, or a portable container. The bootstrap inspects only the clean
canonical entry checkout; it does not validate an active task lane. Execution
placement is replaceable evidence and never changes the work item, scope,
claim, fence, review, integration, or receipt contract.

Moving or resuming authored work on another device requires an existing
authenticated handoff, reclaim, or successor transition and a fresh verified
fence. Placement alone never transfers a lane. Protected Git and the
authenticated compare-and-swap ledger remain the shared authority for claims,
concurrent ownership, review, integration, retirement, and cleanup.

This patch supplies an optional portable container descriptor and a
deterministic read-only bootstrap for the canonical entry checkout. It creates
no project-managed workspace service, scheduler, queue, or alternate lifecycle
owner.

## Independent Dimensions

| Dimension | Examples | Authority |
|---|---|---|
| `executionPlacement` | `local`, `cloud` | Describes where the current process runs; grants no mutation. |
| `workspaceTopology` | `isolated-worktree`, `guarded-single-checkout`, `provider-managed-queue` | Declares how authored bytes are isolated. |
| `integrationMethod` | `squash`, `rebase-linear`, `merge-commit` | Declares how one reviewed candidate may enter the protected frontier. |
| invocation adapter | CLI implemented; backend MCP, WebMCP, browser, and mobile are not enrolled by this patch | May invoke an enrolled owner; grants no Git or release authority. |

No placement implies a topology or integration method. A cloud container can
host an isolated Git worktree, and a local computer can invoke a
provider-managed queue. Any future adapter must carry content-bound authority
and receipt semantics instead of translating them into host assumptions.

## Portable Environment

`.devcontainer/devcontainer.json` is the minimal portable projection:

- the unmodified Node.js 22 Bookworm image;
- the non-root `node` user with UID adaptation;
- one direct Node.js, repository-byte-read-only post-create bootstrap command
  that bypasses package lifecycle hooks; and
- no provider extension, host mount, forwarded port, embedded credential,
  preinstalled paid service, or new project-managed resource.

The descriptor is optional. Its post-create command does not invoke npm hooks,
install dependencies, fetch Git state, configure credentials, start an
application runtime, or prove a specific hosted workspace provider.

## Read-Only Bootstrap

Run the bootstrap from the checkout being inspected:

```sh
npm run workspace:cloud:bootstrap
```

The machine result uses `agentic-hybrid-workspace-bootstrap/v1` and contains:

- `status: ready|blocked`;
- neutral placement `{ kind, source, containerized }`;
- sanitized current-checkout repository evidence;
- lifecycle `{ status: deferred-to-admission, scope: declared-write-scope,
  nextWorkflow: node_modules/agentic-os/docs/START-WORKFLOW.md }`;
- typed sanitized findings; and
- `mutationAuthority: false`.

The lifecycle `scope` value names the input class for the next workflow. The
bootstrap accepts no scope manifest, reads no scope, and provides no admission
evidence.

Placement can be selected with
`AGENTIC_WORKSPACE_PLACEMENT=local|cloud` or the higher-priority
`--placement=local|cloud` option. Invalid explicit values block. Without an
override, the bootstrap reduces known runtime signals to neutral booleans and
otherwise reports the local default. It never returns signal names or values,
remote URLs, Git stderr, status paths, credentials, or provider identity.

Its exact Git allowlist first establishes network-free object safety. Git 2.45
or newer receives the global `--no-lazy-fetch` control on every repository
probe. Older Git may proceed only after an included-config probe proves that no
partial-clone or promisor key is present; an unavailable proof or legacy
promisor checkout blocks before commit, status, or ancestry inspection.
Before any commit or status probe, effective `filter.*.clean` or
`filter.*.process` configuration blocks with a sanitized finding so repository
configuration cannot launch an external filter. The remaining probes resolve
the current root and commit, check for one `origin` without reading its URL,
observe the locally available `origin/main`, read current status without
descending into submodules, validate only the current worktree registration,
and perform bounded ancestry probes. They never fetch, pull, merge, rebase,
reset, check out, write Git configuration, install, push, claim, review,
integrate, release, deploy, or clean up.

## Current-Checkout Gate

`ready` requires Node.js 22 or newer, proven network-free Git object reads,
valid/default placement, an available Git worktree and HEAD, exactly one
`origin`, a locally observed `origin/main`, a readable clean checkout attached
to `main`, no executable repository Git content filter, one unambiguous and
unlocked current registration, and equality between `HEAD` and `origin/main`.

Ahead, behind, truly diverged, shallow-unproven, and probe-unavailable histories
remain distinct. The bootstrap does not reconcile them. It does not inspect
sibling-worktree contents or dirt; peer ownership, overlap, preservation, and
remote authority remain deferred to scoped admission.

## Concurrent Multi-Device Authoring

Each authored unit retains an exact work item, scope, branch, base,
device/session projection, epoch, fence, task capability, and registered
workspace. Current claims with pairwise-disjoint normalized write sets may
proceed concurrently from different devices and placements.

An overlapping newcomer remains non-writing until the predecessor is retired
or a repository-owned successor transition grants a fresh fence. Expiry ends
write authority but preserves bytes and reservation evidence. No device may
adopt, reset, stash, overwrite, or prune another lane to manufacture readiness.

Host, editor, directory spelling, container image digest, latency, and provider
metadata do not require brittle exact parity. Exactness is reserved for the
protected base and candidate, declared scope, claim and epoch, immutable review
head, named checks, integration result, runtime proof, retirement, and cleanup
receipts.

## Validation Completion Criteria (VCC)

Focused proof must establish deterministic schema and findings, Git-admin byte
preservation, modern no-lazy-fetch enforcement, legacy-promisor blocking,
configured-filter blocking before external execution, clean-canonical-only
readiness, invalid-override blocking, dirty-current and dirty-sibling
preservation, sanitized output, the exact Git allowlist, `mutationAuthority:
false`, and explicit lifecycle deferral. It does not claim a browser, mobile,
MCP, WebMCP, hosted-provider, Production, or Cloudflare runtime.

VCC: run `npm run workspace:cloud:check` once; require exit 0 with deterministic
schema and findings, Git-admin byte preservation, modern no-lazy-fetch
enforcement, legacy-promisor blocking, configured-filter blocking before
external execution, clean-canonical-only readiness, invalid-override blocking,
dirty-current and dirty-sibling preservation, sanitized output, the exact Git
allowlist, `mutationAuthority: false`, and lifecycle deferral, with no network,
provider, protected-Git, Production, or Cloudflare mutation.

## MCP, WebMCP, Browser, And Mobile Boundary

This patch implements one local Node.js CLI only. It adds no dictionary route,
backend MCP tool, WebMCP page tool, browser adapter, or mobile adapter. Those
transports remain separately enrolled future owners. Headless automation
belongs in the CLI or a future backend MCP owner; WebMCP is an optional in-page
human-in-the-loop surface that complements backend MCP and does not provide
autonomous repository authority.

The WebMCP sources in frontmatter are clean-room design references only. No
external code, prose, schema, test, example, dependency, browser-support claim,
or runtime authority is copied or required. A future adapter must preserve the
same sanitized evidence and content-bound lifecycle receipts. An unavailable
adapter yields an explicit unsupported handoff; this contract implements no
automatic fallback.

## Sync, Review, And Delivery

After scoped admission, every placement uses the same lifecycle:

1. create one registered ADLC lane with `npm run lane -- <scope>`;
2. author only inside its printed worktree;
3. run focused checks and preserve the exact candidate commit;
4. publish the exact head with `npm run land`; and
5. run `npm run reap` after protected integration; exact worktree projection and
   registration may be quarantined only by their own authorized receipts, while
   branches, remote-tracking refs, and unreachable objects remain retained.

When review, CI, or a current-base check fails, resume through the pinned ADLC
start workflow, fix the source owner, and rerun focused checks. Publication,
integration, retry, and retirement semantics come only from `agentic-os`; this
product document creates no local merge, force-update, lease, or recovery
exception.

Completion requires protected integration, declared product runtime proof, and
the distinct ADLC receipts required by the installed release workflow. This
document cannot authorize or infer any lifecycle effect.

## Offline Boundary

Bootstrap is local, model-free, token-free, and network-free: unsupported
lazy-fetch safety blocks before object-reading probes. An already isolated
local lane may read, author, test, and commit while disconnected only as
preserved unshared work. No prior cloud observation is inferred current while
disconnected, and offline work must not claim shared ownership, push, dispatch
review, assert review readiness, hand off, integrate, or retire.

Reconnection requires fetch, live branch and pull-request observation, and
focused checks before publication. Divergence, missing proof, or overlapping
ownership yields a typed stop, never automatic adoption or history rewriting.

## Repository Ownership Audit

Agentic Canvas OS owns its product and workspace-placement adapters. The pinned
`agentic-os` package owns branch grammar, lane creation, protected integration
proof, and exact task-worktree retirement. No placement adapter may recreate a
second lifecycle state machine.

## Economics And Non-Goals

The baseline reuses Git, Node.js, the repository host, the protected ledger,
and an optional existing container runtime. It adds no new project-managed or
always-on service, daemon, database, queue, cluster, paid control plane, model
call, or token spend. A hosted workspace may be used when measured
time-to-value justifies its cost, but it stays replaceable and
non-authoritative. The optional container and host remain external execution
infrastructure rather than project-managed infrastructure.

This contract does not implement collaborative text editing, live presence,
repository hosting, credential synchronization, a cloud IDE, remote execution
scheduling, Production deployment, or Cloudflare publication. Those remain
separate owners requiring their own demand, authority, cost, and runtime proof.
