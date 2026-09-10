---
title: "Dictionary Ownership"
graphId: "md:dictionary-ownership"
doc_type: "Contract"
date: "2026-09-10"
lang: "en-US"
schema: "dictionary-ownership/v1"
frontmatter_contract: "required"
status: "metadata-only"
source_docs:
  - "../package-lock.json"
  - "../node_modules/agentic-os/guides/INVOCATION-DICTIONARIES.md"
---

# Dictionary ownership

Author reusable command, semantic and binding metadata only in
`agentic-os/catalog/dictionaries/DICTIONARY-{COMMAND,SEMANTIC,BINDING}.md`.
The exact installed revision is recorded in this repository's package lock.
Catalog parsing and digest validation are imported from `agentic-os/invocation`;
the local script supplies Node hashing and the CLI only.

The three historical paths under `docs/` remain byte-identical published
projections for Graph's pinned raw-Markdown reader and existing document links.
Do not edit them. After reviewing and advancing the upstream dependency pin:

1. Install the lockfile with `npm ci --ignore-scripts`.
2. Run `npm run dictionary:project`.
3. Run `npm run dictionary-catalog:check` and the affected product contracts.

`npm run docs:check` rejects any projected byte that differs from the installed
asset, including edits outside the digest-bearing table. A valid recomputed
catalog digest alone cannot establish source ownership. Missing package assets
fail; neither sibling discovery nor a network fallback is permitted.

Consumers that can resolve package assets directly should use the installed
export. Graph's existing pinned transport remains a compatibility consumer;
its source URL identifies a projection, and its pinned Canvas package lock
identifies the dictionary owner revision. Retire these projections when all
published raw-document consumers have migrated.

This migration preserves the 406 entries and product routing semantics.
The canonical catalog sourcePath and digest identify agentic-os; old downstream
digests are historical evidence. Metadata and dictionary membership grant no
runtime, payment, deployment or approval authority.

Common YAML authoring rules live in the website's
`guidelines/runtime-frontmatter-guidelines.md`; product field validation remains
local. Source checks do not prove deployed runtime readiness.
