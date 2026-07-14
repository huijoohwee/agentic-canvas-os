---
title: "Agentic Canvas OS Todo Contract"
graphId: "md:agentic-canvas-os-todo-contract"
doc_type: "Planning Ledger Contract"
date: "2026-07-14"
lang: "en-US"
schema: "todo-index/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "Agentic Canvas OS cross-repository planning index and monthly shard contract"
todo_root: "../todo"
shard_pattern: "YYYY-MM.md"
active_shard: "../todo/2026-07.md"
scope_key: "frontmatter scope plus UTC calendar month"
append_policy: "append-only"
size_limit_bytes: 500000
line_limit: 599
adoption_date: "2026-07-14"
publish_policy: "Dev-only; no Prod mirror or Cloudflare authority"
runtime_scope: "bounded planning retrieval, append-only task capture, and release compliance"
runtime_claim: "source contract and index only; reading this document performs no task mutation or deployment"
runtime_proof: "RUNTIME-PROOF.md"
---

# Agentic Canvas OS Todo Contract

## Authority And Boundaries

`TODO.md` is the bounded, always-loadable planning index and schema owner. Actual planning rows live only in `../todo/YYYY-MM.md`; do not rebuild a monolithic table in this file.

The shard key is one declared cross-repository scope plus one UTC calendar month. The flat monthly path is the minimum-viable layout while one cross-repository scope is active. If multiple independent scopes later exceed the size cap, add scope directories through a versioned contract change rather than inventing filenames ad hoc.

Agentic Canvas OS is the sole live planning owner for participating repositories. Repository-local todo files are forbidden because they duplicate authority and drift from the monthly shards. Committed shard rows may retain retired paths as immutable historical provenance, never as current routing instructions.

## Source Layout

| Source | Responsibility | Load policy |
|---|---|---|
| `TODO.md` | Schema, shard routing, lifecycle, retrieval, validation, and escalation. | Load at workflow start. |
| `../todo/YYYY-MM.md` | Append-only planning rows for one declared scope and UTC month. | Load the active month or an exact requested month. |

## Shard Frontmatter

Every shard starts with plain YAML using this contract:

```yaml
---
title: "Agentic Canvas OS Todo YYYY-MM"
doc_type: "Planning Ledger Shard"
schema: "todo-log/v1"
period: "YYYY-MM"
scope: "cross-repository"
status: "append-only"
append_policy: "append-only"
date_heading_format: "YYYY-MM-DD"
source_contract: "../docs/TODO.md"
adoption_date: "2026-07-14"
---
```

`period` must equal the filename and `status` remains `append-only` for the shard's lifetime. `TODO.md`'s `active_shard` pointer is the sole lifecycle owner: every non-active shard is closed and immutable. At UTC month rollover, update the index pointer and create a new shard; never edit the prior shard's frontmatter.

## Row Contract

Each dated section has the canonical 11-column table:

| Context | Intent | Directive | Module | Class/Object | Function/Method | Input | Output | Decision Logic | Next Step Recommendation | Updated Date |
|---|---|---|---|---|---|---|---|---|---|---|

For rows authored on or after `adoption_date`:

- append one complete row at EOF under an exact `## YYYY-MM-DD` UTC heading;
- keep the heading month equal to the shard `period`;
- fill all 11 cells; forbid empty cells and placeholder `-` values;
- keep `Directive` at 50 words or fewer;
- set `Updated Date` equal to the enclosing dated heading;
- name the affected source in `Module` and use a stable, unique `Context`;
- append a superseding row when a prior decision changes; never rewrite history.

Imported pre-adoption rows remain byte-preserved historical evidence. They are exempt from retroactive row normalization but not from shard identity, size, or history-preservation checks.

## Append And Merge Rules

- Record the exact Agentic Canvas OS base ref before the first task write.
- Existing shard bytes at that ref must remain an exact prefix of the release candidate.
- Two concurrent valid appends are both retained and ordered by UTC date, then stable Context when reconciliation is required.
- A conflict is resolved by keeping both independent rows; do not select one history and discard the other.
- Frontmatter is created once. Changing identity, scope, period, adoption boundary, or policy requires a new contract version and migration proof.

## Retrieval And Token Economics

1. Load `TODO.md` plus the active monthly shard by default.
2. Resolve an exact month or Context with `rg` before loading more files.
3. Search adjacent shards only when the exact lookup is empty.
4. Add local BM25 ranking only after exact search becomes noisy.
5. Add embeddings only after measured keyword-retrieval failure and approved TCO review.

This keeps routine planning context bounded to one small index and one relevant shard instead of sending the full history to every model call.

## Size And Rollover

- Each shard must remain below 500,000 bytes and 600 lines.
- Month rollover is mandatory even when the prior file is small.
- If one scope exceeds either cap inside a month, stop and propose a versioned scope-directory extension; do not create numbered overflow files silently.
- Never split a committed shard by rewriting its history. A migration requires preserved source hashes, a mapping ledger, and explicit operator approval.

## Compliance Gates

Startup validates the index, every shard's frontmatter, filename-period match, chronological unique date headings, month boundary, size budget, and active/closed lifecycle. Release additionally compares committed shard prefixes with the recorded base ref and strictly validates the declared task row.

Any malformed shard, historical rewrite, missing declared Context, duplicate task Context, overlong directive, empty cell, wrong-month heading, wrong Updated Date, or size overflow blocks the next workflow stage.

## Completion VCC

Given the Todo index and monthly shard root, when planning compliance runs, then every shard resolves to one scope/month, historical bytes remain append-only, and the declared current task row is complete and bounded.

VCC: verify frontmatter parsing, filename-period equality, chronological headings, byte and line caps, base-prefix preservation, and one strict `PLANNING_CONTEXT` row; stop on the first violation without Prod or Cloudflare mutation.
