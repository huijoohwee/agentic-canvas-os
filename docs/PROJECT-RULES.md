---
title: "Agentic Canvas OS Project Rules"
graphId: "md:agentic-canvas-os-project-rules"
doc_type: "Project Rules"
date: "2026-08-02"
lang: "en-US"
schema: "agentic-canvas-os-project-rules/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "repository-owned engineering and session-closeout rules for humans and AI tools"
publish_policy: "Dev-only until the operator explicitly authorizes Prod or Cloudflare"
runtime_scope: "project-wide engineering, validation, and session-end behavior"
runtime_claim: "vendor-neutral rules that synchronize through Git across devices and tools"
runtime_proof: "RUNTIME-PROOF.md"
---

# Agentic Canvas OS Project Rules

This document is the repository-owned source of truth for project-wide working
rules. Keep it universal, neutral, provider-agnostic, and modular. Do not move
these rules into vendor-specific IDE or agent config files when a repository
document can express the same contract.

## GitHub-Native Collaboration Baseline

- Treat protected remote GitHub state as the authoritative collaboration
  contract: canonical `main`, remotely addressable task branches, pull-request
  review, required checks, and merge receipts are the shared multi-device cloud
  coordination surface.
- Encode collaboration policy in repository-owned upstream docs, hooks, and
  automation. Do not rely on downstream IDE-specific patches, local aliases, or
  agent-private conventions as the primary rule source.
- A local commit is not shared authority by itself. Cross-device collaboration
  starts when work is represented by a branch and pull request the protected
  remote can evaluate.
- Protected `main` is a remote publication and integration boundary, not a
  blanket prohibition on normal local commits in an owned task lane. Local
  authoring remains allowed on admitted task branches; the protected-branch
  contract applies when publishing, reviewing, and merging.
- Treat any live overlapping protected-remote cloud claim as an upstream
  blocker. Resolve it only through repository-owned remote handoff, release, or
  reclaim, and never infer release from local lease expiry, pull-request state,
  mergeability, or protected-branch advancement.
- Treat "multiple independent writers can publish different revisions for the
  same path" as a failing upstream boundary. Protected remote policy must leave
  one current publish authority per path, even when the competing lanes use
  different semantic-scope labels or branch names.
- If a local tool or orchestration record disagrees with the protected remote
  branch, pull request, or required-check state, fail closed in favor of the
  remote and repair the repository-owned adapter or rule at the source.

## Agentic Orchestration Layer

- `agentic-os` ADLC is the single lifecycle owner. Start with `npm run lane --
  <scope>`, publish with `npm run land`, observe with `npm run status`, and retire
  only integration-proven clean lanes with `npm run reap -- --apply`.
- The remotely addressable branch and pull request are the shared claim. Local
  records and compatibility shims are observations; they never replace GitHub
  branch protection, exact required checks, or pull-request authority.
- Diagnostics surface branch, worktree, provider, check, and integration drift.
  Dirty or ambiguous bytes are preserved and named instead of adopted, hidden,
  restacked for ordering, or converted into inferred authority.
- Local hooks and orchestration should distinguish commit-time authoring from
  protected publication. If work appears on canonical `main`, preserve the
  bytes and route them into a task lane; do not emit a generic "trying to
  commit to a protected branch" denial for ordinary local commits on valid task
  branches.
- Keep the orchestration layer universal, neutral, agnostic, and modular:
  repository-owned, vendor-neutral in rule wording, readable without one IDE or
  agent product, and decomposable into independently checkable rules.
- Do not use orchestration metadata to bypass protected-branch policy,
  reinterpret a failed required check as success, or normalize direct pushes to
  protected `main` when the upstream contract requires pull requests.

## Code Hygiene

- Lean MVP, SSOT, MECE, and single responsibility.
- Keep authored files under 600 lines and 500 kB chunks.
- Use meaningful names; comment why, not what.
- Avoid deep nesting, duplication, circular dependencies, hardcodes, and silent
  failures.

## Architecture

- Centralize config and constants; reuse shared utilities.
- Prefer appropriate data structures, clear abstraction boundaries, and early
  returns.
- Parallelize where possible, defer computation, and release resources promptly.

## Pipeline

- Optimize through batching, caching, chunking, virtualization, sharding, and
  lazy loading when the benefit is real.
- Ensure thread safety and prevent race conditions.

## Conflicts And Stale Code

- Neutralize defects from the root or upstream owner; do not stack downstream
  patches or alias remaps.
- Remove confirmed legacy, stale, conflicting, and duplicate code completely.
- Do not add backward-compatibility shims unless the requirement is explicit and
  proven necessary.

## Validation

- Test focused diffs only; do not run indefinite full-codebase sweeps.
- Resolve issues and verify no regressions before handoff.
- Allow same-device and cross-device parallel mutation only for different semantic scopes in distinct registered task worktrees or clones. Bind each task worktree to one session lease, branch, and pull request; preserve post-baseline untracked files in that physical lane as cleanup-ineligible `owned-untracked` state, and reject shared-worktree sessions, duplicate scopes, stale fencing epochs, deletion, stash, masking, relocation, or adoption by another task.

## Concurrent Sessions

Parallel sessions across the sibling repositories in one workspace root are the
intended mode. `docs/WORKSPACE-PARALLELISM.md` is the contract; these are the rules
that bind every session and tool.

- Claim one lane per session: one repository plus one registered worktree. Never
  share a worktree, never check one branch out in two worktrees, and never claim a
  semantic scope another session already holds in that repository.
- Run `npm run workspace:parallelism:check` before any operation in the forbidden
  catalog. Treat a blocked report as a stop, not as a cleanup task.
- Install the enforcement surfaces once per machine with
  `npm run workspace:guards:install`, and put the generated shim directory ahead of
  Git on `PATH` so external tooling is guarded too. Hooks alone leave `clean`,
  forced checkout, and object pruning ungated; the wrapper is not optional.
- Never disable a guard to make a command succeed. The bypass sentinel exists for a
  deliberate, explained decision, not for unblocking a workflow.
- Never reset a working tree, remove untracked files, force a checkout, rewrite
  pushed history, delete a lane, prune objects, or fast-forward a lane while any
  session holds uncommitted or untracked work in that repository. This applies to
  every repository in the workspace, not only the one being worked on.
- Never run a destructive operation on a lane the current session does not own, and
  never assume an idle-looking lane is unowned. Absence of recent output is not
  evidence that a session ended.
- Treat untracked files as unrecoverable until a repository-owned capture has
  written their exact blobs, modes, paths, and tree under an immutable recovery
  ref and content-addressed receipt. Before that proof completes, no destructive
  operation over them is permitted.
- Before any permitted destructive operation on an owned dirty lane, create a durable
  recovery reference: a branch, a tag, or a bundle under the workspace backup
  directory. A moving or raw stash selector does not qualify. The only stash-backed
  exception is a repository-owned adapter that holds the shared park lock, proves
  the exact parent and message, pins the stash commit under an immutable ref,
  records tracked, staged, untracked, symlink, and mode evidence, and emits a
  content-addressed receipt before realignment.
- Ignored local paths may remain in place across canonical realignment only
  after a repository-owned adapter proves a stable path-set digest, unchanged
  ignore rules, and no filesystem-aware exact, ancestor, or descendant
  collision with the target tree. Revalidate that proof at every realignment
  boundary and use Git's no-overwrite-ignore guard for the final switch.
  Otherwise recovery stops before preservation or ref mutation.
- Commit early and on a branch when work must survive a concurrent session. An
  uncommitted edit is the only state this contract cannot fully protect.
- When a collision is found, name it and stop. Resolving it by discarding the other
  side is forbidden regardless of which session is further along.

## Post-Task

- Update cross-repo and API docs when the change affects them.
- End every implementation turn with completed work integrated and exactly
  retired, or incomplete work preserved in its existing ADLC lane with canonical
  `main` untouched.
- Never report a task complete while its fix is dirty, stashed, branch-only, in
  an open pull request, absent from `origin/main`, or unverified on the local
  runtime started from that exact Dev `main` SHA.
- For completed work, run `npm run device:complete -- --json` only after the
  protected Dev pull request merges. Require the emitted pull request, merge,
  and main SHAs; fast-forward the registered main worktree with `npm run sync:live`,
  then restart the local runtime from that clean `main` and rerun the original
  acceptance path.
- Before the final response of every implementation turn, run `npm run turn:end
  -- --repository=<canonical-knowgrph-root> --json`. Runtime-ready may be
  claimed only when its JSON proves exact protected `main` SHAs, no
  runtime-blocking residue in canonical checkouts, the private-token-owned Apex
  and storage listeners, and all HTTP probes. Foreign parallel residue may be
  tolerated only when it is explicitly classified as non-blocking. The command
  must fail closed without stopping an unrelated listener.
- A preserved open lane never satisfies completion.
- Audit the task worktree at every chat, session, or thread end. Remove it only
  through `worktree:lifecycle:cleanup` after the runtime classifies it as clean,
  detached at exact `origin/main`, and explicitly completed. Retain active,
  delivery, and parked lanes; fail closed on dirt or ambiguity; preserve task
  branches and commits unless branch deletion is separately authorized.
- A Dev `main` merge does not authorize Prod mirror or Cloudflare mutation.
- Suggest next steps in `/GitHub/agentic-canvas-os/{docs/TODO.md, todo/}`,
  `/GitHub/knowgrph/docs/`, and
  `/GitHub/huijoohwee.github.io/schema/AgenticRAG` when relevant.
