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
  <scope>`, publish with `npm run land`, and observe with `npm run status` and
  `npm run reap`. ACOS opts into exact worktree projection and registration
  quarantine while retaining branches, refs, and unreachable objects; each
  effect still requires ADLC eligibility and exact authority.
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
- Preserve dirty or ambiguous user bytes. All parallel Git mutation, ownership,
  and cleanup decisions come from the pinned ADLC owners.

## Concurrent Sessions

Parallel sessions across sibling repositories are governed exclusively by the
pinned `agentic-os` guideline, start workflow, release workflow, and committed
repository profile. ACOS defines no lane, claim, lease, worktree, recovery,
destructive-operation, integration, synchronization, retirement, or cleanup
exception. Preserve user bytes and stop on any typed ADLC attention result.

## Post-Task

- Update cross-repo and API docs when the change affects them.
- Lifecycle closeout must satisfy the installed ADLC release workflow. This
  product policy neither restates nor weakens its completion receipts.
- Before the final response of every implementation turn, run `npm run turn:end
  -- --repository=<canonical-agentic-graph-root> --json`. Runtime-ready may be
  claimed only when its JSON proves exact protected `main` SHAs, no
  runtime-blocking residue in canonical checkouts, the private-token-owned Apex
  and storage listeners, and all HTTP probes. Foreign parallel residue may be
  tolerated only when it is explicitly classified as non-blocking. The command
  must fail closed without stopping an unrelated listener.
- A Dev `main` merge does not authorize Prod mirror or Cloudflare mutation.
- Suggest next steps in `/GitHub/agentic-canvas-os/{docs/TODO.md, todo/}`,
  `/GitHub/agentic-graph/docs/`, and
  `/GitHub/huijoohwee.github.io/schema/AgenticRAG` when relevant.
