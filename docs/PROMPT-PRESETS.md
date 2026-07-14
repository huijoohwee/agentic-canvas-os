---
title: "Agentic Canvas OS Prompt Presets"
graphId: "md:agentic-canvas-os-prompt-presets"
doc_type: "Prompt Preset Catalog"
date: "2026-07-13"
lang: "en-US"
schema: "agentic-os-prompt-preset-catalog/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "shared prompt presets for Knowgrph FloatingPanel Chat"
runtime_scope: "zero-spend prompt selection and loading"
runtime_claim: "source-backed prompt text only; selection does not approve execution, provider spend, persistence, Prod, or Cloudflare mutation"
publish_policy: "Dev-only until explicit operator approval"
invocation_authority: "SKILLS.md"
dictionary_links:
  command: "DICTIONARY-COMMAND.md"
  semantic: "DICTIONARY-SEMANTIC.md"
  binding: "DICTIONARY-BINDING.md"
prompt_presets:
  - id: "video-agent"
    label: "Video Agent"
    slash_command: "/video-agent"
    description: "Source-backed multilingual video package, media generation, persistence, read-back, and shared Canvas projection."
    activation: "source-backed-canvas"
    prompt: |-
      /video-agent @video-generation-demo-script @provider.byteplus @text @image @audio @video #spec.low #thinking.type.enabled #token-cap.medium [AI视频-港岛实景写实风-异城算计与女主绝境求生-终极统一执行总表.md](workspace:/docs/AI视频-港岛实景写实风-异城算计与女主绝境求生-终极统一执行总表.md)

      Build a 45-second, 16:9 Hong Kong live-action drama sequence from the referenced eight-shot script. Generate a structured text package containing a Character sheet, Scene sheet, Dialogue sheet, Visual asset sheet, Audio sheet, Timing sheet, Metadata sheet, and Prompt sheet, plus source-consistent image keyframes, Chinese/Cantonese/English narration, synchronized Chinese/English subtitles, and a playable master video. Persist returned artifacts, read them back, and project the same typed identities into Canvas Cards, Widgets, Rich Media Panels, and BottomPanel Timeline video/FBF/audio lanes. Stop when approval, credentials, entitlement, budget, persistence, read-back, or a required capability is unavailable.
  - id: "sme-care-agent"
    label: "SME Care Agent"
    slash_command: "/sme-care-agent"
    description: "Review-ready SME exposure, coverage-gap, unknown-risk, and provider-neutral protection guidance."
    activation: "chat-agent"
    prompt: |-
      /sme-care-agent @source.frontmatter @source.body @local-harness @cost-log @runtime-proof #frontmatter #harness #token-economics #runtime-ready #approval-gate

      Assess the active SME workspace sources across cyber, supply-chain, physical-asset, and growth-stage exposure. Keep exposure, current coverage, apparent gaps, unknown risks, evidence confidence, and urgency distinct. Produce provider-neutral protection guidance, evidence-needed fields, rationale, and a review-ready licensed-adviser handoff. Stop before quote, bind, purchase, contact, paid-provider, persistence, Prod, or Cloudflare actions unless each required approval and capability is available. Never treat unknown coverage as safe.
  - id: "investment-research-agent"
    label: "Investment Research Agent"
    slash_command: "/investment-research-agent"
    description: "Source-grounded investment research with evidence, contradictions, assumptions, and review-first graph candidates."
    activation: "chat-agent"
    prompt: |-
      /investment-research-agent @source.frontmatter @source.body @cost-log @runtime-proof #frontmatter #token-economics #runtime-ready #approval-gate

      Analyze the investment question using the active workspace sources. Separate claims, evidence, assumptions, contradictions, open questions, freshness, and verification steps; mark unsupported material claims as unknown. Produce a concise research brief, evidence ledger, contradiction ledger, risk/catalyst view, and review-first graph candidates. This is research support, not financial advice. Stop before paid-provider, graph mutation, persistence, transaction, Prod, or Cloudflare actions unless each required approval and capability is available.
  - id: "pmf-agent"
    label: "PMF Agent"
    slash_command: "/pmf-agent"
    description: "Evidence-led product-market-fit hypotheses, gap mapping, and falsifiable experiment planning."
    activation: "chat-agent"
    prompt: |-
      /pmf-agent @pmf-agent @source.frontmatter @source.body @cost-log @runtime-proof #pmf-agent #token-economics #approval-gate

      Evaluate product-market fit from the active workspace and cited evidence. Separate target segment, job to be done, pain frequency and severity, current alternatives, product promise, acquisition, activation, retention, engagement, referral, willingness-to-pay signals, problem-to-solution gaps, evidence confidence, freshness, and unknowns. Produce an ideal-customer profile, ranked problem and solution hypotheses, an evidence ledger, a gap map, falsifiable experiments with decision thresholds and stop conditions, and one continue, iterate, pivot, or insufficient-evidence recommendation. Do not invent customer demand or treat hackathon interest, awards, demos, social attention, or unverified claims as product-market fit. Stop before outreach, paid research, product mutation, persistence, spend, Prod, or Cloudflare unless the required approvals and runtime capabilities are present.
---

# Prompt Presets

This document is the single prompt-text owner for the Knowgrph FloatingPanel **Load preset** selector. The runtime reads `prompt_presets` from frontmatter and projects the selected prompt into the existing shared composer.

Selection and loading are zero-spend. **Send** remains the execution boundary. The video preset additionally activates its authored Canvas document and source script through the existing source-backed video path; SME Care, Investment Research, and PMF Agent use the shared slash-agent response contract. PMF Agent absorbs HackaMap's useful problem-to-solution gap-mapping concept; `HackaMap` is provenance, not an invocation alias or a second prompt owner.

## Catalog contract

| Preset | Runtime route | Load behavior | Send behavior |
| --- | --- | --- | --- |
| Video Agent | `/video-agent` | Load the centralized prompt after validating the authored video Canvas and script source. | Activate the committed Canvas and hand it to the shared Run all owner. |
| SME Care Agent | `/sme-care-agent` | Load the centralized prompt into Chat. | Use the shared slash-agent contract and deterministic SME kernel when that runtime is invoked. |
| Investment Research Agent | `/investment-research-agent` | Load the centralized prompt into Chat. | Use the shared slash-agent contract with source, evidence, review, and cost boundaries. |
| PMF Agent | `/pmf-agent` | Load the centralized prompt into Chat. | Use the shared slash-agent contract with evidence, gap-map, experiment, review, and cost boundaries. |

Missing catalog fields, an empty catalog, duplicate ids or routes, mismatched ids and routes, unknown routes, absent source bindings, or an unavailable centralized document fail closed with a visible composer error. No downstream prompt copy is authoritative.
