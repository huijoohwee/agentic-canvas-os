---
title: "Frontmatter Key Reference"
graphId: "md:dictionary-frontmatter"
doc_type: "Frontmatter Key Reference"
schema: "agentic-frontmatter-key-reference/v1"
date: "2026-08-30"
lang: "en-US"
frontmatter_contract: "required"
status: "spec-complete"
local_rung: "spec-complete"
delivered_rung: "undocumented"
owner: "Conformance evaluator function"
lane: "authoring"
runtime_readiness_policy: "fail-closed"
runtime_scope: "generated projection of the frontmatter key dictionary"
runtime_claim: "restates the dictionary for reading; grants no key, tier, or enforcement authority of its own"
runtime_proof: "__tests__/frontmatter-dictionary-projection.test.mjs"
evaluator: "npm run frontmatter-dictionary:check"
publish_policy: "Dev-only; no protected integration, Production, publication, or deployment authority"
projection_owner: "scripts/frontmatter-dictionary-projection.mjs"
projection_source: "schemas/frontmatter-runtime-dictionary.v1.json"
projection_key_count: 19
projection_required_count: 11
projection_digest: "c2d5198ab3832e48d8378e1c029ac4f1975fd3694d47a91a940058ea61231879"
dictionary_version: "1.0.0"
---

# Frontmatter Key Reference

This document is a **projection**, not a source. Every table below is generated
from `docs/schemas/frontmatter-runtime-dictionary.v1.json` and fenced with a
content digest. Hand edits inside the fence fail `npm run docs:check`.

## Authority

Three parties, one responsibility each. None restates another.

| Party | Owns | Location |
|---|---|---|
| Rules | Why each key exists, when a tier binds, what a violation means | `huijoohwee.github.io/guidelines/agentic-sdlc-yaml-frontmatter-runtime-guidelines.md` |
| Dictionary | Which keys exist, their tier, enforcement level, and substitutes | `docs/schemas/frontmatter-runtime-dictionary.v1.json` |
| Enforcement | Tier derivation, findings, and the non-regressing ratchet | `scripts/frontmatter-runtime-contract.mjs` |

The validator reads the dictionary at load time and fails closed if it is
absent, unpinned, or structurally invalid. It holds no key list of its own, so
this reference and the checker cannot disagree.

## Enforcement Levels

`required` keys are gated: absent from a triggered tier, they raise a finding and
exit non-zero. `recommended` keys are documented and reserved but not gated.

The distinction is recorded rather than implied because the previous vocabulary
promised enforcement for five keys no check read. A key is promoted from
`recommended` to `required` as a ratchet step with its own recorded baseline,
never by editing prose.

## Forbidden Value Patterns

The dictionary carries the matching expressions; this projection carries only
their identifiers and reasons. A generated document that embedded the literal
patterns would itself contain the machine paths and credential spellings that
other repository checks reject.

<!-- frontmatter-dictionary:begin keys=19 required=11 digest=c2d5198ab3832e48d8378e1c029ac4f1975fd3694d47a91a940058ea61231879 -->
### Tiers

| tier | id | keys | trigger | derived |
|---|---|---|---|---|
| 1 | `identity` | `title`, `doc_type`, `date`, `lang`, `frontmatter_contract` | Always bound; identity is not conditional | yes |
| 2 | `address` | `schema`, `graphId`, `version` | Any addressTriggerKey is present, or the artifact claims readiness | yes |
| 3 | `accountability` | `owner`, `local_rung`, `delivered_rung`, `status`, `lane`, `runtime_readiness_policy` | Any localRungKey carries a value | yes |
| 4 | `evidence` | `runtime_proof`, `evaluator`, `runtime_scope`, `runtime_claim` | A localRungKey names a rung outside unprovenRungs | yes |
| 5 | `boundary` | `publish_policy` | Authored declaration only; reaching a delivered surface is not derivable from frontmatter alone | no |

### Keys

| key | tier | enforcement | substitutes | contract |
|---|---|---|---|---|
| `title` | `identity` | `required` | none | Human-readable subject; never a file path. |
| `doc_type` | `identity` | `required` | none | Artifact class from the corpus vocabulary. |
| `date` | `identity` | `required` | none | YYYY-MM-DD, last substantive authoring. |
| `lang` | `identity` | `required` | none | BCP-47 language tag. |
| `frontmatter_contract` | `identity` | `required` | none | required where these rules bind; optional only for an explicitly exempt class. |
| `schema` | `address` | `required` | none | <slug>/v<major>, stable while the artifact's contract is unchanged. Its stem matches graphId where both exist. |
| `graphId` | `address` | `recommended` | none | md:<slug> stable address. Required where a graph, canvas, or index resolves the artifact by identity. |
| `version` | `address` | `recommended` | none | Semantic version of this artifact, advanced on every substantive change. Policy digests pin it, so a stale version invalidates every digest that bound it. |
| `owner` | `accountability` | `required` | none | The function accountable for the artifact, named by role, never by person or vendor. |
| `local_rung` | `accountability` | `required` | `status` | Readiness of this artifact in its own lane. |
| `delivered_rung` | `accountability` | `required` | none | Readiness at the delivered surface. Never equal to local_rung by default and never omitted when local_rung is set; a single conflated status is the defect this pair exists to prevent. |
| `status` | `accountability` | `recommended` | none | Where a corpus already requires it, status is local_rung and carries no other meaning. Declaring both requires them to agree. |
| `lane` | `accountability` | `recommended` | none | Current lane; the Deploy Boundary reads it and never infers it. |
| `runtime_readiness_policy` | `accountability` | `recommended` | none | fail-closed unless an explicit, versioned, auditable exception names its alternate boundary. |
| `runtime_proof` | `evidence` | `required` | `proof` | Pointer to the recorded evidence: test path, receipt, or proof ledger. Canonical spelling; proof is a permitted short form only where a declared byte budget makes the canonical key infeasible, and the artifact declares that budget. |
| `evaluator` | `evidence` | `required` | none | The exactly-invocable mechanism that judges this artifact, distinct from whoever authored it. |
| `runtime_scope` | `evidence` | `recommended` | none | Exactly what the artifact governs, bounded. |
| `runtime_claim` | `evidence` | `recommended` | none | Exactly what it asserts and, explicitly, what it does not. |
| `publish_policy` | `boundary` | `recommended` | none | The authority ceiling, stated as what is not granted. |

### Forbidden Values

| id | reason |
|---|---|
| `absolute-home-path` | Machine-specific path defeats corpus portability |
| `absolute-linux-home-path` | Machine-specific path defeats corpus portability |
| `absolute-windows-path` | Machine-specific path defeats corpus portability |
| `credential-assignment` | Frontmatter is world-readable and digest-pinned; a credential here cannot be revoked by rewriting history |
<!-- frontmatter-dictionary:end -->

## Regeneration

```
npm run frontmatter-dictionary:check     # verify the fence against the dictionary
npm run frontmatter-dictionary:project   # regenerate after a dictionary change
```

Adding a key is a two-file change: the dictionary entry, then the regenerated
projection. Adding a key here alone is rejected; adding it to the dictionary
alone leaves this file stale and `docs:check` reports the drift with the expected
digest.
