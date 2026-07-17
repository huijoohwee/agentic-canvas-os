---
title: "Agentic Canvas OS Prompt Presets"
graphId: "md:agentic-canvas-os-prompt-presets"
doc_type: "Prompt Preset Catalog"
date: "2026-07-16"
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
  - id: "image-to-threejs"
    label: "Image to Three.js"
    slash_command: "/image.to-threejs"
    description: "Native Widget Card prompt preset for a selected PNG, JPG, JPEG, or SVG source."
    activation: "card-inline"
    prompt: |-
      /image.to-threejs @image-to-threejs #image-to-threejs

      Convert the selected or attached PNG, JPG, JPEG, or SVG source into a native Three.js render. Keep the source Widget Card and input media unchanged; publish the generated result as a separate Three.js Rich Media Panel. Return a typed source error for an unsupported source. Do not use a provider, external plugin, or copied implementation.
  - id: "image-to-glb"
    label: "Image to GLB"
    slash_command: "/image.to-glb"
    description: "Native Widget Card preset for a procedural GLB asset from one selected image source."
    activation: "card-inline"
    prompt: |-
      /image.to-glb @image-to-glb #image-to-glb

      Build a native GLB asset from the selected or attached PNG, JPG, JPEG, or SVG source. Reuse the shared image-to-threejs source-resolution and preview utilities without mutating the source Widget Card or input media. Generate and review only procedural JS/TS scene construction such as `new THREE.BoxGeometry(...)`, `new THREE.BufferGeometry().setFromPoints(...)`, CSG, or parametric-surface operations; reject baked geometry and every serialized geometry payload. Route the runtime asset pipeline to GLB. An approved LLM loop may propose or revise procedural JS/TS and run bounded vision-review passes against the reference image, but it must not emit a serialized mesh format. When editing an existing scene structure, emit glTF with external buffers only; reject embedded buffers and data URIs. Do not use an external plugin or copy external code, dependencies, prompts, schemas, fixtures, prose, or UI.
  - id: "knowgrph-probe-tree"
    label: "Knowgrph Probe-Tree"
    slash_command: "/knowgrph-probe-tree-prompt-preset"
    runtime_command: "/knowgrph.probe-tree"
    description: "Native Widget Card preset for bounded, editable next-question branches and a separate Rich Media branch ledger."
    activation: "card-inline"
    prompt: |-
      /knowgrph.probe-tree

      Generate 2-4 bounded, editable next-question cards from this Widget Card. Derive every question and every 2-4 answer choice from the selected user input, and attach 2-6 short context anchors copied verbatim from that input. Never substitute stock evidence, policy, reviewer, approval, system-of-record, recalled-exemplar, or fixture content unless the user actually named it. Keep the source card unchanged, connect each candidate branch, and publish the branch summary to a separate Rich Media Panel. Stop visibly at depth 8. Run the zero-cost input-derived path before generic provider generation; do not make a provider call unless separately approved.
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

Selection and loading are zero-spend. **Send** remains the Chat execution boundary. The image-to-threejs, image-to-glb, and Probe-Tree presets may also be inserted from the shared Skills & Commands catalog into the selected Widget Card, where each expands to its canonical `/`, `@`, and `#` tokens without replacing attached source media. The Widget Card **Run** action is the execution boundary for those card-inline presets. The video preset additionally activates its authored Canvas document and source script through the existing source-backed video path; SME Care and Investment Research use the shared slash-agent response contract; Crawler Agent uses the native Import URL workflow.

Every `slash_command` is a catalog-owned selection alias matching `/*-prompt-preset`. Every `runtime_command` remains the executable route owned by `SKILLS.md` and the command dictionary. Selecting a preset resolves its `runtime_command` and loads the source-backed prompt without submitting, persisting a chat turn, or rewriting the alias into another catalog entry.

## Catalog contract

| Preset | Preset invocation | Runtime route | Load behavior | Send behavior |
| --- | --- | --- | --- | --- |
| Video Agent | `/video-prompt-preset` | `/video-agent` | Load the centralized prompt after validating the authored video Canvas and script source. | Activate the committed Canvas and hand it to the shared Run all owner. |
| Image to Three.js | `/image.to-threejs` | `/image.to-threejs @image-to-threejs #image-to-threejs` | Load the native prompt in Chat or insert its three invocation tokens into the selected Widget Card. | Resolve only an attached or selected supported image through the native zero-cost conversion owner. |
| Image to GLB | `/image.to-glb` | `/image.to-glb @image-to-glb #image-to-glb` | Load the native procedural prompt in Chat or insert its three invocation tokens into the selected Widget Card. | Require procedural JS/TS construction, a bounded review ledger, and a GLB asset pipeline; source media stays unchanged. |
| Knowgrph Probe-Tree | `/knowgrph-probe-tree-prompt-preset` | `/knowgrph.probe-tree` | Load the source-backed prompt in Chat or insert its slash invocation into the selected Widget Card. The `@` and `#` aliases remain independently authorable. | Materialize 2-4 Type 2 child cards with input-derived numbered multi-select choices, 2-6 verbatim anchors, Other, and a separate Rich Media branch ledger through the native zero-cost path; stop at depth 8. |
| SME Care Agent | `/sme-care-prompt-preset` | `/sme-care-agent` | Load the centralized prompt into Chat. | Use the shared slash-agent contract and deterministic SME kernel when that runtime is invoked. |
| Investment Research Agent | `/investment-research-prompt-preset` | `/investment-research-agent` | Load the centralized prompt into Chat. | Use the shared slash-agent contract with source, evidence, review, and cost boundaries. |
| Crawler Agent | `/crawler-prompt-preset` | `/crawler-agent` | Load the centralized prompt into Chat with an editable URL. | Use the native headless Import URL workflow and persist separate report and pipe-table Canvas outputs. |

Missing catalog fields, duplicate ids, unknown routes, absent source bindings, or an unavailable centralized document fail closed with a visible composer error. No downstream prompt copy is authoritative.
