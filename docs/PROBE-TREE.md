---
title: "Agentic Canvas OS Probe-Tree Contract"
graphId: "md:agentic-canvas-os-probe-tree"
doc_type: "Probe-Tree Semantic Clarification Contract"
date: "2026-07-18"
lang: "en-US"
schema: "agentic-os-probe-tree/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "semantic clarification classification for /knowgrph.probe-tree"
runtime_scope: "source-backed Probe-Tree question generation and selected-child continuation"
runtime_claim: "model-free contract validation only; card generation requires the active Chat provider, endpoint, and model"
publish_policy: "Dev-only until explicit operator approval"
runtime_command: "/knowgrph.probe-tree"
prompt_preset: "PROMPT-PRESETS.md#knowgrph-probe-tree"
clarification_topics: ["RECOMMEND", "COMPARE", "ASSESS", "PLAN"]
clarification_topic_match: "semantic and case-insensitive"
clarification_card_kind: "semantic"
clarification_card_minimum: 2
clarification_card_maximum: 4
terminal_bypass: "runtime-recognized selected-child terminal continuation only"
continuation_owner: "selected child card and its committed Output"
root_role: "lineage only"
model_route: "active Chat provider, endpoint, and model"
fallback_policy: "fail closed; query-specific hardcoding and zero-model fallback cards are forbidden"
dictionary_links:
  command: "DICTIONARY-COMMAND.md#/knowgrph.probe-tree"
  semantic: "DICTIONARY-SEMANTIC.md#knowgrph.probe-tree"
  binding: "DICTIONARY-BINDING.md#knowgrph.probe-tree"
runtime_proof: "RUNTIME-PROOF.md"
---

# Probe-Tree

`PROBE-TREE.md` is the semantic clarification authority for
`/knowgrph.probe-tree`. `PROMPT-PRESETS.md` projects this contract into the
source-backed preset consumed by Knowgrph; the three dictionaries project its
command, semantic, and binding tokens. None of those projections may redefine
the classification rules.

## Clarification Topic Families

`RECOMMEND`, `COMPARE`, `ASSESS`, and `PLAN` are clarification topic families.
Classification is semantic and case-insensitive: capitalization, inflection,
word order, or omission of the literal family label does not change the intent.
The runtime evaluates the request meaning and the missing decision variables,
not an exact keyword or action-verb match.

| Topic family | Semantic intent | Clarification focus |
|---|---|---|
| `RECOMMEND` | Choose, prioritize, shortlist, or identify a suitable course. | Objective, constraints, tradeoff priority, and acceptance criteria. |
| `COMPARE` | Contrast alternatives, differences, fit, or consequences. | Named alternatives, comparison basis, decision criteria, and material tradeoffs. |
| `ASSESS` | Evaluate suitability, exposure, quality, readiness, or risk. | Evidence threshold, decision standard, uncertainty, and tolerated downside. |
| `PLAN` | Sequence actions, define a roadmap, or organize a path to an outcome. | Target outcome, horizon, constraints, dependencies, and stopping conditions. |

For example, `recommend`, `Recommendation`, and mixed-case variants remain in
the `RECOMMEND` family. A request such as "which option best fits the stated
constraints" also belongs to that family even when the literal word is absent.
Equivalent semantic treatment applies to the other three families. These are
intent examples, not query-specific response fixtures or hardcoded cards.

## Card Generation

An initial or root request in any clarification family produces 2-4 semantic,
editable cards. Each card must introduce a distinct missing decision variable
that could materially change the answer. Its 2-4 choices must express
context-relevant preferences, tradeoffs, or consequences derived from the
active request and workspace sources.

Mechanical extraction is invalid. A number, range, unit, named entity, topic
fragment, repeated choice set, or rephrased source query does not become a
clarification merely because it can be placed in a card. The active Chat
provider, endpoint, and model generates the cards; stale card-local routing and
zero-model LLM synthesis are forbidden.

## Continuation Ownership

The selected child card and its committed Output own the next request. The root
alias is lineage only and must not replace, prepend, or mechanically dominate
the selected-child context.

Only a runtime-recognized selected-child terminal continuation bypasses card
generation. An imperative, action verb, root topic, or family label never
establishes terminal intent by itself. If terminal recognition is absent or
fewer than two semantic cards survive validation, the operation fails closed
with a visible error.

## Invocation And Publication Boundaries

Widget Card **Run** authorizes the bounded MCP context call followed by the
active Chat provider, endpoint, and model. MCP resolution, preset selection,
and contract validation alone do not execute a model, approve spend, or grant
mutation authority.

User-authored edges to explicitly targeted Widget Cards or Rich Media Panels
remain authoritative. A runtime-recognized selected-child terminal continuation
atomically creates or reuses one owned `Generated Result` Rich Media Panel and
one typed output edge from that selected child. The runtime must not merge
targets, attach an unrelated panel, or infer edges for non-terminal output.

## Validation Contract

`npm run probe-tree-contract:check` must fail when:

- any clarification topic family is missing or reordered;
- matching becomes case-sensitive, keyword-only, or action-verb terminal;
- the card kind or 2-4 bounds become mechanical or unbounded;
- selected-child continuation ownership or the terminal boundary drifts;
- the active Chat route is replaced by stale card-local routing;
- query-specific hardcoding or zero-model fallback cards are permitted; or
- the preset or dictionary projections diverge from this document.

The validation path is local and zero-spend. It proves source consistency, not
live-provider output quality, deployment, Prod mirror, or Cloudflare readiness.
