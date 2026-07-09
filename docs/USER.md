---
title: "Agentic OS User Profile"
graphId: "md:agentic-os-user-profile"
doc_type: "User Profile Contract"
date: "2026-07-08"
lang: "en-US"
schema: "agentic-os-user-profile/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "bounded user preference and expectation layer for Agentic Canvas OS docs"
runtime_scope: "Agentic Canvas OS docs control surface"
runtime_claim: "bounded user profile contract only; no personal-data inference, memory runtime, provider panel, or deploy claim"
publish_policy: "Dev-only until explicit operator approval"
runtime_proof: "RUNTIME-PROOF.md"
source_docs:
  - "FACTS.md"
  - "MEMORY.md"
  - "SOUL.md"
  - "AGENTS.md"
external_pattern_sources:
  - "https://github.com/NousResearch/hermes-agent"
  - "https://hermes-agent.nousresearch.com/docs/user-guide/features/memory"
user_profile_contract:
  version: "agentic-os-user-profile/v1"
  owner: "operator"
  target: "user"
  limit_chars: 1375
  storage_policy: "bounded, curated, explicit, non-secret"
  snapshot_policy: "frozen at session start when an approved runtime injects profile context"
  write_policy: "operator-approved or explicit-preference evidence only"
  forbidden_content:
    - "unsupported personal inference"
    - "secrets or credentials"
    - "sensitive profiling"
    - "temporary session details"
    - "large raw data"
    - "project operations that belong in AGENTS.md"
profile_entries: []
---

# Agentic OS User Profile

`USER.md` is the bounded profile contract for explicit operator preferences, communication style, and expectations. It is separate from `SOUL.md`, which defines the agent's identity and voice, and from `MEMORY.md`, which stores agent notes about projects, environment, conventions, and lessons learned.

This file is inspired by public bounded-memory systems, but it is a local Agentic OS source contract. Do not copy external memory code, database schemas, prompt renderers, sample entries, tests, fixtures, or prose.

## Profile Scope

| Profile field | Allowed content | Forbidden content |
|---|---|---|
| Preferences | Explicit operator preferences that affect future interaction. | Guesses, personality profiling, or sensitive traits. |
| Communication style | Explicit format, detail, tone, and review expectations. | Inferred emotional state or unsupported personal claims. |
| Workflow expectations | Stable expectations for approval, proof, cost, and boundaries. | Project commands, architecture rules, paths, ports, or deploy instructions. |
| Technical context | Explicitly stated skill level or tool comfort when useful. | Assumptions from one task or private/sensitive data. |

## Write Rules

| Rule | Requirement |
|---|---|
| Explicit evidence | Save only when the operator states a durable preference or approves a proposed profile entry. |
| Bounded capacity | Keep `user_profile_contract.limit_chars` enforced before writes. |
| No silent overwrite | Replacement requires a matching existing entry and a visible before/after summary. |
| No unsupported inference | Reject profile claims that are not grounded in operator statements. |
| No secrets | Never store credentials, tokens, private keys, payment data, or sensitive personal data. |

## Snapshot Contract

| Layer | Rule |
|---|---|
| Snapshot timing | Approved runtimes may inject a frozen `USER.md` snapshot at session start. |
| Mid-session writes | Writes persist for future sessions and tool responses, but do not rewrite the active prompt snapshot. |
| Capacity signal | Prompt or tool state should expose usage count and limit so the agent can compact deliberately. |
| Search | Historical sessions can be searched on demand; search results are not automatically profile entries. |

## Empty State

No profile entries are asserted by this file. Add entries only through `/user.profile` or an approved memory write with explicit operator evidence.

## VCCs

| VCC | Check |
|---|---|
| Profile parses | Frontmatter parses and `user_profile_contract.limit_chars` is present. |
| Profile is bounded | Any write checks character limit before persistence. |
| Profile is explicit | Entries cite operator statement or approval; unsupported inferences are rejected. |
| Profile is separate | Project operations stay in `AGENTS.md`; agent notes stay in `MEMORY.md`; identity stays in `SOUL.md`. |
| External reference is not copied | Diff contains local neutral contracts only and no Hermes memory code, sample entries, database schema, tests, fixtures, or prose. |
