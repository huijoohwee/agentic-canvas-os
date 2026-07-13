---
title: "Agentic OS Agent Instructions"
graphId: "md:agentic-os-agents"
doc_type: "Agent Instructions"
date: "2026-07-08"
lang: "en-US"
schema: "agentic-os-agents/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "agent role and editing-rule layer for Agentic Canvas OS docs"
runtime_scope: "Agentic Canvas OS docs control surface"
runtime_claim: "agent instructions for source-backed docs edits, validation, and deploy boundaries; no runtime, deploy, or provider claim"
runtime_proof: "RUNTIME-PROOF.md"
publish_policy: "Dev-only until explicit operator approval"
source_docs:
  - "SOUL.md"
  - "FACTS.md"
  - "MEMORY.md"
  - "MEMORY-LOG.md"
  - "USER.md"
  - "SKILLS.md"
  - "SANDBOX-RUNTIME.md"
  - "DICTIONARY-COMMAND.md"
  - "DICTIONARY-SEMANTIC.md"
  - "DICTIONARY-BINDING.md"
  - "START-WORKFLOW.md"
  - "RELEASE-WORKFLOW.md"
---

# Agent Instructions

## Scope

These instructions apply to files under `docs/`. Treat `SOUL.md` as the durable identity and voice layer, `FACTS.md` as the shared truth layer, `MEMORY.md` as the bounded agent-note layer, `USER.md` as the bounded explicit user-profile layer, and this file as the agent role and editing-rule layer.

Before editing or generating files here:

1. Read `FACTS.md` first.
2. Read `SOUL.md` when the task concerns identity, tone, style, personality, or prompt-slot behavior.
3. Read `MEMORY.md` for agent notes, project conventions, prior proof, and reusable routing memory.
4. Read `USER.md` when the task concerns explicit operator preferences, communication style, or expectations.
5. Read `SKILLS.md` when the task concerns skills, tool routing, bundles, progressive disclosure, or skill writes.
6. Preserve Markdown YAML frontmatter as the source of truth.
7. Keep authored Markdown body content aligned with the frontmatter contract.
8. Do not infer behavior from file paths when frontmatter or body fields provide the contract.

## Source Contract

- `SOUL.md` owns durable agent identity, voice, style, and prompt slot 1 identity contract.
- `FACTS.md` owns shared truth, precedence, and direct `/query`, `#truth`, and `@agent` definitions.
- `MEMORY.md` persists bounded agent notes: environment facts, project conventions, lessons learned, and routing context.
- `USER.md` persists bounded explicit operator preferences, communication style, and expectations.
- `SKILLS.md` owns on-demand procedural knowledge, Tool Gateway contracts, progressive disclosure, bundles, and skill write gates.
- `AGENTS.md` owns agent roles, editing rules, and validation behavior.
- External Hermes Agent, SOUL, memory, MoA, context reference, and Tool Gateway references inform patterns only; do not copy code, parsers, default identity text, memory sample entries, database schemas, prompt renderers, personality preset text, prompts, provider names, provider tables, model lists, config examples, tests, fixtures, or prose.
- Source docs named in `MEMORY.md` provide provenance only; do not copy their local media URLs, tokens, provider IDs, transcripts, generated assets, or deploy claims.
- Runtime readers project state from frontmatter and authored body content. Do not add a second registry, parser, provider panel, or compatibility alias in this folder.
- If source and generated content conflict, neutralize the conflict at the source document or shared owner, not by layering downstream patches.

## Invocation Grammar

Use existing shared utilities for invocation content:

| Prefix | Role | Rule |
|---|---|---|
| `/` | Command route | Describe commands such as `/soul.load`, `/memory.write`, `/reference.expand`, `/tool.catalog`, `/tool.route`, `/toolset.enable`, `/toolset.disable`, `/moa`, `/superagent.run`, `/runtime-ready.check`, and `/deploy.guard`; do not invent a separate command runtime. |
| `#` | Semantic route | Use tags such as `#soul`, `#persistent-memory`, `#context-reference`, `#attached-context`, `#tool-gateway`, `#tool-function`, `#toolset`, `#platform-toolset`, `#long-horizon-harness`, `#sandboxed-workspace`, `#message-gateway`, `#frontmatter`, `#harness`, `#token-economics`, `#vcc`, and `#no-hardcode` for filtering and routing. |
| `@` | Binding route | Use bindings such as `@soul-profile`, `@memory-store`, `@file:`, `@attached-context`, `@reference-policy`, `@tool-gateway`, `@tool-function`, `@toolset`, `@platform-surface`, `@tool-policy`, `@sandbox-workspace`, `@message-gateway`, `@operator`, `@source.frontmatter`, `@local-harness`, `@runtime-proof`, and `@dev-only` for actor, source, runtime context, and explicit message-time references. |

## Operating Defaults

- Resolve `GITHUB_ROOT` as the parent directory of the `agentic-canvas-os` checkout; never encode a user-specific absolute path in this control surface.
- Work Dev-first in `$GITHUB_ROOT/knowgrph`.
- Before every Codex build session, follow `START-WORKFLOW.md`: fetch first, inspect ownership, then create a fresh isolated worktree from `origin/main`.
- Do not use pull as a default startup action. Pull only when intentionally updating a clean, exclusively owned branch with explicit integration behavior.
- Treat `$GITHUB_ROOT/huijoohwee/content/knowgrph` as a Prod mirror, not a default edit target.
- Treat `airvio.co` and `airvio.co/knowgrph` as Cloudflare deployment targets, not completion criteria.
- Forbid Prod or Cloudflare deploy until the operator explicitly authorizes it.
- Prefer FOSS, zero-egress, local, and dry-run paths until ROI, TCO, token budget, and approval gates justify live spend.
- Reuse shared semantic-key, parser, headless, renderer, and routing helpers. Do not add surface-local aliases, stale remaps, hardcoded fixtures, or copied implementations.

## Documentation Rules

- Keep documents universal, neutral, agnostic, modular, and source-backed.
- Maintain spec-complete to runtime-ready progression:
  - Spec-complete requires frontmatter identity, problem hypothesis, acceptance criteria, TCO estimate, token budget, and VCC map.
  - Runtime-ready requires typed harnesses, bounded orchestration, cost logs, fallback paths, focused proof, and clean deploy boundaries.
- Use semantic Markdown structure with clear headings and tables. Avoid prose-only claims when a table, VCC, or harness contract would make the state verifiable.
- Keep files lean. Prefer one responsibility per section and remove stale or conflicting content instead of appending duplicate guidance.

## AI Harness Rules

Every AI-capable memory, PRD/TAD, or agent document must specify:

- Typed input schema.
- Typed output schema.
- Dispatcher, executor, observer, and consumer roles when orchestration is involved.
- Fallback path for malformed input, model failure, approval denial, and token budget breach.
- Cost log fields: `model`, `prompt_tokens`, `completion_tokens`, `cache_hits`, and `estimated_cost_usd`.
- Max-iteration bound and circuit breaker for any loop.
- Long-horizon runs must name sandbox workspace, message gateway, checkpoints, artifacts, verification, stop condition, and no-copy boundary.

Malformed inputs must fail before token spend. Raw, unstructured prompt calls are not runtime-ready.

## Persistent Memory Rules

- Keep `MEMORY.md` for agent notes about environment facts, project conventions, tool quirks, completed-work lessons, and reusable techniques.
- Treat `MEMORY-LOG.md` as the contract for durable Git-synchronized history and `../memory/YYYY-MM.md` as its append-only monthly shards.
- Create shard frontmatter once, then add only complete `## @mem-YYYYMMDDTHHmmssZ` UTC records at end-of-file; never edit, reorder, compact, or delete prior records.
- If concurrent appends conflict, preserve both complete records and append any later superseding decision instead of rewriting history.
- Use exact shard or ripgrep retrieval first, local BM25 only when ranking adds value, and embeddings only after a measured precision gap and approved TCO review.
- Run the `VALIDATION-RUNBOOK.md` memory-log structural gate at session start and its base-ref append-only gate before release; either failure blocks the next workflow stage.
- Treat `$WORKTREE/todo-log.md` as the canonical Knowgrph planning ledger. Record its fetched base ref at startup, declare one `todo_context`, require one changed 11-cell row with no empty cells, a directive of at most 50 words, a matching dated section, and a valid updated date before release, and preserve every non-target baseline row byte-for-byte.
- Keep `USER.md` for explicit operator preferences, communication style, expectations, workflow habits, and stated technical comfort.
- Do not infer user profile facts from behavior. Save profile entries only from explicit operator statements or approved proposed entries.
- `/memory.write` must name target, action, evidence, scan result, capacity result, and source before persistence.
- `/memory.compact` must preserve durable facts, remove stale or duplicate entries deliberately, and report before/after capacity; silent auto-compaction is forbidden.
- `/session.search` is read-only recall. Search results require explicit `/memory.write`, `/user.profile`, or `/experience.capture` before persistence.
- Frozen memory/profile prompt snapshots are captured at session start; mid-session writes persist for future sessions and live tool responses, not by mutating the active prompt.
- Do not copy Hermes memory code, sample entries, database schemas, prompt renderers, tests, fixtures, or prose.

## Soul Rules

- Keep `SOUL.md` focused on durable identity, voice, style, directness, uncertainty, disagreement, ambiguity, and stylistic avoid rules.
- Keep project operations, commands, paths, ports, architecture, test commands, and deployment rules in `AGENTS.md`, not `SOUL.md`.
- A runtime that implements `/soul.load` must scan and bound `@soul-profile` before filling `@identity-slot`.
- Missing, empty, unsafe, or unreadable soul source returns a typed fallback; do not silently embed a hardcoded default identity string.

## Skill System Rules

- Discover skill metadata before loading full sources or resources.
- Load selected skill sources only when required; reject deep reference chasing and copied external skill bodies.
- Gate skill writes through scan, focused validation, and operator review when policy requires it.

## Context Reference Rules

- Treat context-reference `@` forms as explicit message-time expansion requests, distinct from normal binding tokens such as `@agent` or `@operator`.
- Support only neutral forms named in the dictionaries: `@file:`, `@folder:`, `@diff`, `@staged`, `@git:`, and `@url:`.
- Scan, bound, and normalize before expansion; block path traversal, sensitive paths, binary content, disallowed URL egress, and hard-limit overflow.
- Unsupported platforms must preserve raw text and return typed unsupported-platform warning.
- Invalid, missing, or refused references must create warnings or refusals in `@attached-context`; do not mutate the composer text or add downstream parser patches.

## Tool Gateway Rules

- Route tool calls through existing `knowgrph` infrastructure: local MCP, Pages HTTP MCP, Browser WebMCP, or approved Cloudflare control-plane owners.
- Treat tools as callable functions with schemas, owners, risk classes, cost posture, and typed fallback.
- Treat toolsets as logical bundles of existing functions that are enabled or disabled per platform surface.
- Keep provider selection per tool category; never store credentials or browser sessions in docs, client state, tests, or fixtures.
- `/tool.route` validates category, provider state, schema, approval, egress, cost, and fallback before execution.
- `/toolset.enable` and `/toolset.disable` require `@toolset`, `@platform-surface`, and `@tool-policy`; paid, mutating, browser-auth, terminal, filesystem, generated-media, or egress toolsets require `@operator`.
- `/tool.gateway.audit` is read-only; it cannot execute tools, mutate provider state, or deploy.
- Do not copy Hermes tool registries, Tool Gateway code, provider tables, model lists, config examples, tests, fixtures, or prose.

## VCC Rules

Acceptance criteria must translate into Verifiable Completion Conditions:

```text
Given [context] When [action] Then [observable outcome]
VCC: Verify [outcome] by [stated check] with [constraint]; stop after [N] iterations.
```

A valid VCC names an observable end state and proof, such as an exit code, parsed field, file count, response shape, latency threshold, queue state, or cost-log value. Avoid "looks good", "is complete", "works better", or any other subjective completion language.

## Forbidden Patterns

Do not introduce:

- Hardcoded source URLs, provider IDs, stream URLs, transcripts, credentials, generated media URLs, or deployment claims.
- Browser-owned secrets, localStorage provider keys, duplicated provider catalogs, or standalone provider panels.
- Raw prompt calls without schema validation, cost logging, and fallback paths.
- Unbounded retry, polling, re-render, or agentic loops.
- Legacy remapping, compatibility aliases, stale fixtures, copied external implementations, or downstream bug masks.
- Generic HTML container guidance where semantic HTML is available.
- Prod or Cloudflare deployment claims without explicit operator authorization and returned live evidence.

## Library And API Docs

When a task here involves a library, framework, SDK, API, CLI, or cloud service, fetch current docs through Context7 before answering or changing implementation guidance. Skip Context7 for pure documentation refactors, scratch scripts, business-logic debugging, code review, or general concepts.

## Validation

For documentation-only changes in this folder, run focused checks only:

- Parse frontmatter when a file has YAML frontmatter.
- Check line count and keep files under local hygiene budgets.
- Scan for copied local runtime artifacts such as local hostnames, media-token markers, inline data-image payloads, provider keys, upload IDs, or generated media URLs.
- Confirm no Prod mirror or Cloudflare deploy action was performed.

If a runtime implementation is touched outside this folder, use the touched repo's focused tests and type checks. Do not run indefinite full-codebase validation.
