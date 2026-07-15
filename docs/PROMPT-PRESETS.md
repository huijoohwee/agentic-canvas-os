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
preset_invocation_authority: "PROMPT-PRESETS.md"
runtime_command_authority: "SKILLS.md"
invocation_suffix: "-prompt-preset"
dictionary_links:
  command: "DICTIONARY-COMMAND.md"
  semantic: "DICTIONARY-SEMANTIC.md"
  binding: "DICTIONARY-BINDING.md"
prompt_presets:
  - id: "video-agent"
    label: "Video Agent"
    slash_command: "/video-prompt-preset"
    runtime_command: "/video-agent"
    description: "Source-backed multilingual video package, media generation, persistence, read-back, and shared Canvas projection."
    activation: "source-backed-canvas"
    prompt: |-
      /video-agent @video-generation-demo-script @provider.byteplus @text @image @audio @video #spec.low #thinking.type.enabled #token-cap.medium

      Build a 45-second, 16:9 Hong Kong live-action drama sequence from the referenced eight-shot script. Generate a structured text package containing a Character sheet, Scene sheet, Dialogue sheet, Visual asset sheet, Audio sheet, Timing sheet, Metadata sheet, and Prompt sheet, plus source-consistent image keyframes, Chinese/Cantonese/English narration, synchronized Chinese/English subtitles, and a playable master video. Persist returned artifacts, read them back, and project the same typed identities into Canvas Cards, Widgets, Rich Media Panels, and BottomPanel Timeline video/FBF/audio lanes. Stop when approval, credentials, entitlement, budget, persistence, read-back, or a required capability is unavailable.
  - id: "sme-care-agent"
    label: "SME Care Agent"
    slash_command: "/sme-care-prompt-preset"
    runtime_command: "/sme-care-agent"
    description: "Review-ready SME exposure, coverage-gap, unknown-risk, and provider-neutral protection guidance."
    activation: "chat-agent"
    prompt: |-
      /sme-care-agent @source.frontmatter @source.body @local-harness @cost-log @runtime-proof #frontmatter #harness #token-economics #runtime-ready #approval-gate

      Assess the active SME workspace sources across cyber, supply-chain, physical-asset, and growth-stage exposure. Keep exposure, current coverage, apparent gaps, unknown risks, evidence confidence, and urgency distinct. Produce provider-neutral protection guidance, evidence-needed fields, rationale, and a review-ready licensed-adviser handoff. Stop before quote, bind, purchase, contact, paid-provider, persistence, Prod, or Cloudflare actions unless each required approval and capability is available. Never treat unknown coverage as safe.
  - id: "investment-research-agent"
    label: "Investment Research Agent"
    slash_command: "/investment-research-prompt-preset"
    runtime_command: "/investment-research-agent"
    description: "Source-grounded investment research with evidence, contradictions, assumptions, and review-first graph candidates."
    activation: "chat-agent"
    prompt: |-
      /investment-research-agent @source.frontmatter @source.body @cost-log @runtime-proof #frontmatter #token-economics #runtime-ready #approval-gate

      Analyze the investment question using the active workspace sources. Separate claims, evidence, assumptions, contradictions, open questions, freshness, and verification steps; mark unsupported material claims as unknown. Produce a concise research brief, evidence ledger, contradiction ledger, risk/catalyst view, and review-first graph candidates. This is research support, not financial advice. Stop before paid-provider, graph mutation, persistence, transaction, Prod, or Cloudflare actions unless each required approval and capability is available.
  - id: "crawler-agent"
    label: "Crawler Agent"
    slash_command: "/crawler-prompt-preset"
    runtime_command: "/crawler-agent"
    description: "Native headless website crawl with reference-policy gating, file downloads, proxy rotation, and persistent Canvas outputs."
    activation: "chat-agent"
    prompt: |-
      /crawler-agent @url:https://example.com @reference-policy #canvas

      Crawl the referenced website with the native headless browser automation runtime. Reuse the Import URL pipeline, download supported website files, persist the crawl report and Markdown pipe-table artifacts, and project the result into Canvas. Keep the input prompt unchanged; create separate connected Rich Media Panel outputs for the report and multi-dimensional table. Report processed pages, successful pages, errors, and stored files. Stop before paid-provider, authenticated, or external mutation actions unless each required approval and capability is available.
---

# Prompt Presets

This document is the single prompt-text owner for the Knowgrph FloatingPanel **Prompt Presets** catalog. The runtime reads `prompt_presets` from frontmatter and projects the selected prompt into the existing shared composer.

Selection and loading are zero-spend. **Send** remains the execution boundary. The video preset additionally activates its authored Canvas document and source script through the existing source-backed video path; SME Care and Investment Research use the shared slash-agent response contract; Crawler Agent uses the native Import URL workflow.

Every `slash_command` is a catalog-owned selection alias matching `/*-prompt-preset`. Every `runtime_command` remains the executable route owned by `SKILLS.md` and the command dictionary. Selecting a preset resolves its `runtime_command` and loads the source-backed prompt without submitting, persisting a chat turn, or rewriting the alias into another catalog entry.

## Catalog contract

| Preset | Preset invocation | Runtime route | Load behavior | Send behavior |
| --- | --- | --- | --- | --- |
| Video Agent | `/video-prompt-preset` | `/video-agent` | Load the centralized prompt after validating the authored video Canvas and script source. | Activate the committed Canvas and hand it to the shared Run all owner. |
| SME Care Agent | `/sme-care-prompt-preset` | `/sme-care-agent` | Load the centralized prompt into Chat. | Use the shared slash-agent contract and deterministic SME kernel when that runtime is invoked. |
| Investment Research Agent | `/investment-research-prompt-preset` | `/investment-research-agent` | Load the centralized prompt into Chat. | Use the shared slash-agent contract with source, evidence, review, and cost boundaries. |
| Crawler Agent | `/crawler-prompt-preset` | `/crawler-agent` | Load the centralized prompt into Chat with an editable URL. | Use the native headless Import URL workflow and persist separate report and pipe-table Canvas outputs. |

Missing catalog fields, duplicate ids, unknown routes, absent source bindings, or an unavailable centralized document fail closed with a visible composer error. No downstream prompt copy is authoritative.
