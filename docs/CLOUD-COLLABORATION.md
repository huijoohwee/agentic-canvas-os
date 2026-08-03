---
title: "Cloud Collaboration Contract"
graphId: "md:agentic-cloud-collaboration"
doc_type: "Runtime Contract"
date: "2026-07-30"
lang: "en-US"
schema: "agentic-cloud-collaboration-contract/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "repository-owned cloud claim and fencing contract for concurrent GitHub collaboration"
runtime_scope: "Agentic Canvas OS ledger contract, browser-dispatched GitHub Actions adapter, and provider-neutral lifecycle boundary"
runtime_claim: "GitHub-hosted Agentic Canvas OS coordination is runtime-ready at recorded revisions; private cross-repository writes, merge groups, physical multi-device and mobile execution, Production, and Cloudflare remain gated"
runtime_owner: "../scripts/cloud-collaboration-contract.mjs; ../scripts/cloud-collaboration-primitives.mjs; ../scripts/github-cloud-collaboration-api.mjs; ../scripts/github-cloud-collaboration-mapping.mjs; ../scripts/github-cloud-collaboration-adapter.mjs; ../scripts/cloud-collaboration.mjs; ../scripts/cloud-collaboration-delivery-verifier.mjs; ../scripts/cloud-collaboration-check-run.mjs"
runtime_proof: "../__tests__/cloud-collaboration-contract.test.mjs; ../__tests__/cloud-collaboration-cli.test.mjs; ../__tests__/cloud-collaboration-github-api.test.mjs; ../__tests__/github-cloud-collaboration-adapter.test.mjs; ../__tests__/cloud-collaboration-delivery-verifier.test.mjs; RUNTIME-PROOF.md"
provider_specific_reference_adapter: "GitHub Git Data and repository APIs through the repository-scoped GITHUB_TOKEN"
external_pattern_sources:
  - "https://docs.github.com/en/rest/git/refs"
  - "https://docs.github.com/en/rest/checks/runs"
  - "https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency"
  - "https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows"
external_source_policy: "behavior reference only; forbid copied code, prose, schemas, examples, fixtures, tests, or configuration"
publish_policy: "Dev-only; no Prod mirror or Cloudflare authority"
---

# Cloud Collaboration

## Decision

Use one repository-owned Git branch as the cloud authority for concurrent
collaboration claims:

- Ref: `refs/heads/agentic/collaboration-ledger`
- State path: `.agentic/collaboration-ledger.json`
- Schema: `agentic-cloud-collaboration-ledger/v1`

Every state change is a normal child commit followed by a non-forced ref update.
Two devices that read the same parent may create sibling commits, but only one
can advance the ref by fast-forward. The loser rereads current state and retries
within the bounded adapter limit. Workflow scheduling reduces contention; the
Git compare-and-swap result remains the authority.

This contract does not replace `START-WORKFLOW.md` by its presence alone.
Device lifecycle commands may treat the cloud ledger as canonical only after
their local lease and pull-request projections are integrated, the required
protected check is enabled, and live proof is recorded.

## Ownership Boundary

| Owner | Responsibility | Boundary |
|---|---|---|
| `cloud-collaboration-contract.mjs` | Canonical ledger validation, transition rules, overlap detection, hashing, expiry, fencing, and idempotent replay. | Pure and provider-neutral; no network, Git, checkout, pull request, or deployment mutation. |
| GitHub mapping and API owners | GitHub identity projection, trusted server time, and bounded redacted repository transport primitives. | Provider-specific reference layer; a complete CAS coordinator must join these primitives before Dev-proven status. |
| `cloud-collaboration.mjs` | CLI parsing, trusted Actions context, redacted JSON result, and exit status. | No independent authority; dispatches only to the contract and selected adapter. |
| `cloud-collaboration-check-run.mjs` | Publish one explicit protected check on the exact same-repository pull-request head from trusted default-branch controller code. | It may write only the bounded `cloud-collaboration` Check Run; it never checks out or executes pull-request code. |
| `cloud-collaboration.yml` | Mobile-browser-friendly manual input, trusted event verification, default-branch source checkout, least-privilege token selection, and serialized dispatch. | The browser form and event controller are transports, not claim authority or protected integration proof. |
| Local device lifecycle | Worktree, local writer lease, task branch, pull request, review, and integration projections. | Offline state cannot override a current cloud fence. |

## Ledger Contract

The closed schema is an append-only hash chain:

```text
ledger = schema + ledgerRepositoryId + sequence + headDigest + entries
entry  = sequence + parentDigest + action + repositoryId + claimId
         + idempotencyKey + requestDigest + evaluationTime
         + claimCore + claimDigest + digest
```

The ledger holds at most 512 entries. Its deterministic projection permits at
most 128 current non-terminal claims, and each declared write scope permits at
most 128 normalized unique items. Released entries remain evidence, while only
non-terminal claims participate in current ownership and overlap decisions.
The history therefore preserves the prior lease epoch and prevents reuse.
`ledgerRepositoryId` identifies the repository that owns the ledger ref.
Each entry and claim-core `repositoryId` independently identifies its target
repository, so one ACOS ledger may coordinate several explicitly resolved
repositories without treating their names as immutable identity.

Each `claimCore` binds:

- immutable provider-neutral actor and target-repository identities;
- pseudonymous device, session, and work-item identities;
- canonical base and current lane revisions;
- a normalized, sorted, unique declared write scope and its SHA-256 digest;
- lease epoch plus transition and heartbeat counters;
- `active`, `review-ready`, `delivery-authorized`, `parked`, or `released` state;
- expiry, evidence digest, review-request identity, and predecessor claim; and
- an optional `actor` or `open` handoff plus terminal release evidence.

The ledger never stores credentials, tokens, raw idempotency keys, local paths,
chat or task identifiers, source contents, diffs, prompts, or secrets. A digest
is an identity and integrity binding, not encryption; callers must not hash
low-entropy secret material into the public ledger.

Despite its field name, `idempotencyKey` stores only the SHA-256 digest of the
caller's bounded opaque replay key. `requestDigest` separately binds the
normalized logical intent, so reuse of one key for different input fails.
`claimDigest` is computed over `claimCore` and stored beside it in the entry,
never inside the claim core itself. It fences one claim without changing when
an unrelated claim advances. `headDigest` closes the entry hash chain. The
GitHub reference adapter additionally returns
`ledgerRevision`, the Git commit containing that exact ledger. Verification of
a projected state proves that its Git revision is current or ancestral and
that the exact historical revision contained the expected claim digest.

## Lifecycle

| Action | Mutation | Required outcome |
|---|---:|---|
| `status` | No | Return bounded public state, optionally filtered to one exact repository. |
| `verify` | No | Prove current identities, revisions, review request, epoch, digest, ancestry, write scope, and unexpired fence. |
| `claim` | Yes | Reserve one non-overlapping write scope and increment its monotonic epoch. |
| `bind` | Yes | Internal-only binding of the exact lane revision and evidence after branch and review-request creation. It is intentionally absent from the browser form. |
| `heartbeat` | Yes | Extend only the current actor's exact active claim using server time. |
| `review-ready` | Yes | Bind the exact reviewed pull-request head and stop ordinary authoring transitions. |
| `delivery-authorize` | Yes | Bind explicit operator intent, the unchanged reviewed head, review/check evidence, and protected-integration intent without reopening authoring or granting deployment authority. |
| `handoff` | Yes | Record an exact, fenced successor or parked handoff state without transferring dirty local bytes. |
| `release` | Yes | Remove the exact terminal claim only after its required lifecycle evidence is complete. |

The normal GitHub device order is cloud claim, local branch and lease, branch
push and pull request, then cloud bind of the provider-neutral lane revision and
review-request identity. Heartbeat updates cloud before local projection.
Review, delivery authorization, handoff, integration, and release reverify the current cloud claim
immediately before their irreversible boundary. An interrupted operation
replays with the same idempotency identity rather than creating a second
transition.

If the commit push succeeds but `review-ready` fails closed because the cloud
verifier momentarily resolves a different review-request head, treat that
mismatch as transient authority observation drift inside this contract. Recovery
must reverify the exact claim identity, review-request identity, and intended
reviewed head, then rerun the same bounded verification and compare-and-swap
transition against the verified head. Local fence rewrites, downstream
projection patches, synthetic rebases, or alternate transition selection are
forbidden.

GitHub Actions derives workflow idempotency from trusted `GITHUB_RUN_ID`, never
`GITHUB_RUN_ATTEMPT`. A rerun therefore replays the same logical transition.
Local CLI callers must supply their own stable opaque idempotency key; only its
digest may enter the ledger.

## Browser And Multi-Device Adapter

The manual workflow is available from GitHub's browser UI, including a mobile
browser. It does not claim a dedicated native GitHub Mobile dispatch feature.
The model-free CLI exposes `status`, `verify`, `claim`, `heartbeat`,
`review-ready`, `delivery-authorize`, `handoff`, and `release`; it never exposes
internal `bind`. The browser form exposes the same delivery-authorization
transition with explicit focused-evidence, operator-decision, and protected-
integration-intent digests, so browser and mobile-browser operators use the
same upstream contract rather than a device-specific patch.

One global Actions concurrency group uses `queue: max` with no cancellation.
Every admitted transition remains queued rather than replacing an older pending
transition. Manual status and verification run with `contents: read` and
`pull-requests: read`. Manual ledger mutations add only `contents: write`.
Neither manual lane receives pull-request write, checks write, Actions write,
issues write, `id-token`, packages, or deployment permission.

Default-branch pushes run a trusted `cloud-collaboration` audit that may retire
the exact merged `delivery-authorized` claim for the pushed protected head while still
avoiding pull-request, checks, Actions, `id-token`, package, or deployment
write. `pull_request_target` runs a separate trusted controller for the
selected event types. That controller checks out only the default branch, invokes
`verify-event` with the GitHub-owned `GITHUB_EVENT_PATH`, and receives
`checks: write` solely to create and complete one `cloud-collaboration` Check
Run on the event's exact same-repository pull-request head SHA. It first creates
an in-progress check, then completes it with success or failure; interruption
therefore cannot manufacture a successful result.

`review-ready` and `delivery-authorized` are distinct non-authoring
capabilities. `device:publish` performs exact-head review readiness and then the
explicit delivery authorization before it enables protected auto-merge.
`device:integrate` may consume an existing cloud-admitted `review_ready` local
projection by creating the same delivery authorization, verifying it, and only
then asking the configured provider adapter for protected integration. Any
source edit requires a separate handoff or fresh active epoch; neither delivery
authorization nor protected integration grants deployment authority.
The exact reviewed head remains the protected delivery head for that
continuation even when the lane did not opt into auto-delivery at start.
If the cloud `delivery-authorize` transition succeeds before the local review
projection persists, the bounded repository retry may reconcile the exact same
claim in `delivery-authorized` state and continue without reopening authoring,
changing the reviewed head, or synthesizing a successor claim.

Both lanes:

- check out the repository default branch explicitly;
- disable persisted checkout credentials;
- use SHA-pinned GitHub-owned actions and Node 22 on `ubuntu-slim`;
- run for at most five minutes;
- pass form fields through environment variables, never shell interpolation;
  and
- perform no dependency installation, cache, artifact upload, hosted database,
  scheduler, model call, or external infrastructure provisioning.

The workflow file must exist on the default branch. Repository Actions policy
should restrict `workflow_dispatch` to the operator or Admin role. The
default-branch checkout and runtime ref check are defense in depth, because a
writer who may select and modify another workflow ref must not gain broader
execution authority.

## Security And Repository Scope

The provider-neutral contract treats actor and repository identities as bounded
opaque strings. The GitHub adapter resolves immutable numeric IDs and verifies
them alongside names at the transport boundary. Names alone are not durable
identity. The exact-head controller accepts only same-repository pull requests
and fails closed on repository, actor, branch, base, head, pull request, write
scope, digest, epoch, or expiry drift.

The Actions token is scoped to the Agentic Canvas OS repository. It may advance
that repository's ledger and read public target metadata; it does not authorize
writes to Knowgrph, the upstream guideline repository, or any other target.
Private cross-repository access requires a separately reviewed GitHub App or
fine-grained token design. This reference workflow neither requests nor
pretends to have that authority.

All input strings, arrays, retries, ledger collections, public results, and log
messages are bounded. A transport failure reports a redacted typed error.
Status and verify cannot call mutation endpoints. Every ref update sets
`force: false`. Raw GitHub writes can bypass local hooks, so protected
pre-merge verification remains mandatory.

## Protected Integration

A unique `cloud-collaboration` required check should run on every pull-request
head without a path filter or success-producing skip. The trusted
`pull_request_target` controller publishes it explicitly on
`pull_request.head.sha`; its own base-tip controller job is not the required
check. The exact-head result must verify the target repository, pull request,
branch, head SHA, current claim digest, epoch, expiry, declared write digest,
and absence of overlap.

Do not activate branch protection until a live same-head observation proves
that the explicit Check Run is emitted by the trusted GitHub Actions app and a
successful default-branch push has produced the same unique check name for
application-ID binding.

A green check can become stale after expiry or another ledger transition.
Auto-delivery and `device:integrate` must repeat the same live verification
immediately before merge or integration. A ledger update made by the
repository `GITHUB_TOKEN` is not assumed to trigger another ordinary push
workflow.

Do not make a shape-only ledger audit a required `merge_group` success. A merge
queue check becomes eligible only when it resolves the exact group membership
and verifies every member's current review claim, head and base, plus unioned
write coverage and non-overlap. Until then, omit that job for `merge_group` or
fail closed.

Protect the ledger ref with a dedicated no-bypass ruleset containing only:

- branch deletion prevention; and
- non-fast-forward prevention.

Do not require pull requests, ordinary status checks, restricted direct
updates, or force bypass on the ledger ref; those rules would block legitimate
compare-and-swap commits. Seed the ref before activating its ruleset.

## Offline-First Boundary

An unexpired locally cached projection may support disconnected editing in its
already-owned worktree. Offline state cannot claim a new scope, renew a lease,
push, mark review-ready, hand off, integrate, release, or prove runtime
readiness. Reconnection requires live verification of the projected revision
and claim digest before any shared mutation.

Local-first therefore means useful isolated authoring without continuous
infrastructure, not offline cloud authority.

## Runtime Readiness

| Level | Required evidence |
|---|---|
| Spec-complete | This contract, the closed append-only ledger schema, browser workflow, and exact-head check controller agree on identities, actions, bounds, permissions, and failure states. |
| Dev-proven | Focused contract, adapter, CLI, schema, workflow-policy, exact-head controller, conflict, idempotency, redaction, and no-mutation tests pass locally with fake GitHub transport. |
| Cloud runtime-ready | The exact default-branch revision owns the live ledger ref and ruleset; workflow execution protection and the required PR check are active; one live claim, conflict-safe verify, heartbeat, review or handoff, and release cycle succeeds with exact revisions. |
| Production-verified | Separately authorized protected integration and public-runtime evidence exist. Cloud collaboration alone grants neither Prod mirror nor Cloudflare authority. |

The complete adapter and focused local suite pass. Protected source
`ab76ef10e4ba1623d560ccc986eead76ad07b285` seeded the live ledger, and
`RUNTIME-PROOF.md` records an exact claim, heartbeat, review-ready verification,
GitHub Actions Check Run, release, app-bound required check, and no-bypass
ledger ruleset. Report repository-owned GitHub coordination as cloud
runtime-ready at those recorded revisions. A live read-only workflow dispatch
also resolved the current ledger through the browser-compatible Actions route.
Private cross-repository writes, merge-group membership proof, physical
second-device or mobile execution, Prod mirror, Cloudflare, and every future
revision remain behind their separate exact evidence gates.

The first live bootstrap observed a transient ref `404` immediately after
GitHub accepted ref creation. Exact replay succeeded without duplicating the
claim. The adapter now continues directly from the authoritative creation
receipt, retries a transient update-side `404` only inside the existing bounded
CAS loop, and has a regression test that makes the created ref temporarily
invisible. It never adds an unbounded sleep, force update, or second authority.

## Economics

The design is zero-infrastructure: Git objects, bounded repository API calls,
and short on-demand GitHub Actions jobs only. It requires no server, database,
queue service, cron sweeper, artifact retention, cache, or model tokens. Expiry
is evaluated lazily when state is read or changed.

`queue: max` preserves logical transitions but does not make runner work free.
The public repository can use standard GitHub-hosted runners without a
separately operated service; private-repository Actions billing remains an
operator cost boundary. The minimum viable path uses one read or mutation job
per manual command and returns compact JSON for fast mobile diagnosis.

## Focused Proof

Run:

```sh
npm run collaboration:cloud:check
npm run docs:check
```

Tests must cover same-parent contention, one winner, exact replay, overlap,
expiry takeover, epoch monotonicity, all lifecycle transitions, bootstrap
races, `409` and `422` retries, retry exhaustion, ancestry verification,
non-forced ref updates, read-only status and verify, public-data bounds,
redaction, stable `GITHUB_RUN_ID`, least-privilege workflow policy, and zero
source, pull-request, Prod, or Cloudflare mutation by local proof.
