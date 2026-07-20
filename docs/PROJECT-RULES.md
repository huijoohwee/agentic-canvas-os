---
title: "Agentic Canvas OS Project Rules"
graphId: "md:agentic-canvas-os-project-rules"
doc_type: "Project Rules"
date: "2026-07-14"
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
- Allow same-device and cross-device parallel mutation only for different semantic scopes in distinct registered task worktrees or clones. Bind each task worktree to one session lease and branch; reject shared-worktree sessions, duplicate scopes, and stale fencing epochs.

## Post-Task

- Update cross-repo and API docs when the change affects them.
- Never report a task complete while its fix is dirty, stashed, branch-only, in
  an open pull request, absent from `origin/main`, or unverified on the local
  runtime started from that exact Dev `main` SHA.
- For completed work, run `npm run device:complete -- --json` only after the
  protected Dev pull request merges. Require the emitted pull request, merge,
  and main SHAs; fast-forward the registered main worktree with `npm run sync:live`,
  then restart the local runtime from that clean `main` and rerun the original
  acceptance path.
- Use `npm run device:park` only for work explicitly reported as paused or
  blocked. Parking preserves work but never satisfies completion.
- Audit the task worktree at every chat, session, or thread end. Remove it only
  through `worktree:lifecycle:cleanup` after the runtime classifies it as clean,
  detached at exact `origin/main`, and explicitly completed. Retain active,
  delivery, and parked lanes; fail closed on dirt or ambiguity; preserve task
  branches and commits unless branch deletion is separately authorized.
- A Dev `main` merge does not authorize Prod mirror or Cloudflare mutation.
- Suggest next steps in `/GitHub/knowgrph/{todo-log.md, docs/}` and
  `/GitHub/huijoohwee.github.io/schema/AgenticRAG` when relevant.
