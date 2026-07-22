---
title: "Agentic Canvas OS Prompt Presets"
graphId: "md:agentic-canvas-os-prompt-presets"
doc_type: "Prompt Preset Catalog"
date: "2026-07-18"
lang: "en-US"
schema: "agentic-os-prompt-preset-catalog/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "shared prompt presets for Knowgrph FloatingPanel Chat"
runtime_scope: "zero-spend prompt selection with explicit Chat-response and MCP-resolution routes"
runtime_claim: "source-backed prompt text and invocation metadata only; selection and MCP metadata resolution do not approve execution, provider spend, persistence, Prod, or Cloudflare mutation"
publish_policy: "Dev-only until explicit operator approval"
preset_invocation_authority: "PROMPT-PRESETS.md"
probe_tree_contract: "PROBE-TREE.md"
runtime_command_authority: "SKILLS.md and DICTIONARY-COMMAND.md"
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
    invocation_modes: ["llm-chat-response", "mcp-invocation"]
    chat_route: "active Chat provider, endpoint, and model"
    mcp_tool: "knowgrph.agentic_canvas_os.docs.invoke"
    mcp_token: "/video-agent"
    prompt: |-
      /video-agent @video-generation-demo-script @provider.byteplus @text @image @audio @video #spec.low #thinking.type.enabled #token-cap.medium

      Build a 45-second, 16:9 Hong Kong live-action drama sequence from the referenced eight-shot script. Generate a structured text package containing a Character sheet, Scene sheet, Dialogue sheet, Visual asset sheet, Audio sheet, Timing sheet, Metadata sheet, and Prompt sheet, plus source-consistent image keyframes, Chinese/Cantonese/English narration, synchronized Chinese/English subtitles, and a playable master video. Persist returned artifacts, read them back, and project the same typed identities into Canvas Cards, Widgets, Rich Media Panels, and BottomPanel Timeline video/FBF/audio lanes. Stop when approval, credentials, entitlement, budget, persistence, read-back, or a required capability is unavailable.
  - id: "image-to-threejs"
    label: "Image to Three.js"
    slash_command: "/image.to-threejs"
    runtime_command: "/image.to-threejs"
    description: "Native Widget Card prompt preset for a selected PNG, JPG, JPEG, or SVG source."
    activation: "card-inline"
    invocation_modes: ["native-chat-response", "mcp-invocation"]
    chat_route: "active native shared runtime"
    mcp_tool: "knowgrph.agentic_canvas_os.docs.invoke"
    mcp_token: "/image.to-threejs"
    prompt: |-
      /image.to-threejs @image-to-threejs #image-to-threejs

      Convert the selected or attached PNG, JPG, JPEG, or SVG source into a native Three.js render. Keep the source Widget Card and input media unchanged; publish the generated result as a separate Three.js Rich Media Panel. Return a typed source error for an unsupported source. Do not use a provider, external plugin, or copied implementation.
  - id: "image-to-glb"
    label: "Image to GLB"
    slash_command: "/image.to-glb"
    runtime_command: "/image.to-glb"
    description: "Native Widget Card preset for a compact, quality-gated contour-volume GLB and editable external-buffer glTF from one selected image reference."
    activation: "card-inline"
    invocation_modes: ["native-chat-response", "mcp-invocation"]
    chat_route: "active native shared runtime"
    mcp_tool: "knowgrph.agentic_canvas_os.docs.invoke"
    mcp_token: "/image.to-glb"
    prompt: |-
      /image.to-glb @image-to-glb #image-to-glb

      Rebuild the selected or attached PNG, JPG, JPEG, or SVG reference as code-only procedural Three.js without mutating the source Widget Card or input media. Use the universal connected-silhouette contour-volume lane: preserve disconnected negative spaces, quantize a compact plan, and reject object-specific templates, horizontal box bands, baked geometry, serialized geometry, data URIs, loaders, network calls, and external modules. Enforce bounded component, outline, material, triangle, source, and three-pass review/correction budgets. Keep geometry, PBR material, reference, and action gates separate; record the visible front as observed and every rear, interior, or occluded surface as inferred with bounded confidence. Create stable rigid-part pivots and attachment sockets plus one four-second loop-continuous inspection clip bounded to +/-12 degrees yaw; do not claim skinning, morph targets, or deformable readiness. Export the same admitted scene as a full GLB and editable glTF JSON with an external .bin buffer. Use `validated` for deterministic evidence; use `approved` only for a proven optional independent provider review. Treat https://github.com/hoainho/img2threejs and https://github.com/microsoft/TRELLIS.2 as conceptual inspiration only; copy or depend on none of their code, prompts, schemas, examples, tests, fixtures, prose, assets, weights, models, packages, configuration, services, layout, or runtime. Keep the result Dev-only until explicit operator release authority.
  - id: "knowgrph-probe-tree"
    label: "Knowgrph Probe-Tree"
    slash_command: "/knowgrph-probe-tree-prompt-preset"
    runtime_command: "/knowgrph.probe-tree"
    description: "Native Widget Card preset for bounded, editable next-question branches and a separate Rich Media branch ledger."
    activation: "card-inline"
    invocation_modes: ["llm-chat-response", "mcp-invocation"]
    chat_route: "active Chat provider, endpoint, and model"
    mcp_tool: "knowgrph.agentic_canvas_os.docs.invoke"
    mcp_token: "/knowgrph.probe-tree"
    semantic_contract: "PROBE-TREE.md"
    clarification_action_topics: ["RECOMMEND", "COMPARE", "ASSESS", "PLAN"]
    clarification_topic_match: "semantic and case-insensitive"
    clarification_card_kind: "semantic"
    clarification_card_minimum: 2
    clarification_card_maximum: 4
    terminal_bypass: "runtime-recognized selected-child terminal continuation only"
    model_route: "active Chat provider, endpoint, and model"
    fallback_policy: "fail closed; query-specific hardcoding and zero-model fallback cards are forbidden"
    prompt: |-
      /knowgrph.probe-tree

      Generate 2-4 bounded, editable next-question cards from this Widget Card under the semantic clarification contract in PROBE-TREE.md. Derive every question and every 2-4 answer choice from the selected user input, give every card a different user-named focus, and attach 2-6 short context anchors copied verbatim from that input. Every answer choice must express a decision-relevant preference, tradeoff, or consequence rather than a mechanical number, range, unit, named entity, or topic fragment. Never reuse a choice label, one card's complete choice set, or a subset/superset of it in another card. For a continuation, the selected child and its committed Output own the next topic; the root is lineage only. Classify the action-topic families RECOMMEND, COMPARE, ASSESS, and PLAN semantically and case-insensitively as clarification requests; an imperative or action verb never establishes terminal intent. Only a runtime-recognized selected-child terminal continuation bypasses card generation. Never substitute stock evidence, policy, reviewer, approval, system-of-record, recalled-exemplar, or fixture content unless the user actually named it. Keep the source card unchanged, connect each candidate branch, and atomically connect the source to its single owned Probe-Tree Branches Rich Media ledger. Preserve user-authored output targets; for a runtime-recognized selected-child terminal continuation, atomically create or reuse one owned Generated Result Rich Media Panel and one typed output edge from that child without merging targets or attaching an unrelated panel. Stop visibly at depth 8. Widget Run authorizes the bounded MCP context call followed by the active Chat provider, endpoint, and model. Never use stale card-local routing or materialize query-specific hardcoding or zero-model fallback cards; fail closed when fewer than two semantic cards survive.
  - id: "sme-care-agent"
    label: "SME Care Agent"
    slash_command: "/sme-care-prompt-preset"
    runtime_command: "/sme-care-agent"
    description: "Review-ready SME exposure, coverage-gap, unknown-risk, and provider-neutral protection guidance."
    activation: "chat-agent"
    invocation_modes: ["llm-chat-response", "mcp-invocation"]
    chat_route: "active Chat provider, endpoint, and model"
    mcp_tool: "knowgrph.agentic_canvas_os.docs.invoke"
    mcp_token: "/sme-care-agent"
    prompt: |-
      /sme-care-agent @source.frontmatter @source.body @local-harness @cost-log @runtime-proof #frontmatter #harness #token-economics #runtime-ready #approval-gate

      Assess the active SME workspace sources across cyber, supply-chain, physical-asset, and growth-stage exposure. Keep exposure, current coverage, apparent gaps, unknown risks, evidence confidence, and urgency distinct. Produce provider-neutral protection guidance, evidence-needed fields, rationale, and a review-ready licensed-adviser handoff. Stop before quote, bind, purchase, contact, paid-provider, persistence, Prod, or Cloudflare actions unless each required approval and capability is available. Never treat unknown coverage as safe.
  - id: "investment-research-agent"
    label: "Investment Research Agent"
    slash_command: "/investment-research-prompt-preset"
    runtime_command: "/investment-research-agent"
    description: "Source-grounded investment research with evidence, contradictions, assumptions, and review-first graph candidates."
    activation: "chat-agent"
    invocation_modes: ["llm-chat-response", "mcp-invocation"]
    chat_route: "active Chat provider, endpoint, and model"
    mcp_tool: "knowgrph.agentic_canvas_os.docs.invoke"
    mcp_token: "/investment-research-agent"
    prompt: |-
      /investment-research-agent @source.frontmatter @source.body @cost-log @runtime-proof #frontmatter #token-economics #runtime-ready #approval-gate

      Analyze the investment question using the active workspace sources. Separate claims, evidence, assumptions, contradictions, open questions, freshness, and verification steps; mark unsupported material claims as unknown. Produce a concise research brief, evidence ledger, contradiction ledger, risk/catalyst view, and review-first graph candidates. This is research support, not financial advice. Stop before paid-provider, graph mutation, persistence, transaction, Prod, or Cloudflare actions unless each required approval and capability is available.
  - id: "crawler-agent"
    label: "Crawler Agent"
    slash_command: "/crawler-prompt-preset"
    runtime_command: "/crawler-agent"
    description: "Native headless website crawl with reference-policy gating, file downloads, proxy rotation, and persistent Canvas outputs."
    activation: "chat-agent"
    invocation_modes: ["native-chat-response", "mcp-invocation"]
    chat_route: "active native shared runtime"
    mcp_tool: "knowgrph.agentic_canvas_os.docs.invoke"
    mcp_token: "/crawler-agent"
    prompt: |-
      /crawler-agent @url:https://example.com @reference-policy #canvas

      Crawl the referenced website with the native headless browser automation runtime. Reuse the Import URL pipeline, download supported website files, persist the crawl report and Markdown pipe-table artifacts, and project the result into Canvas. Keep the input prompt unchanged; create separate connected Rich Media Panel outputs for the report and multi-dimensional table. Report processed pages, successful pages, errors, and stored files. Stop before paid-provider, authenticated, or external mutation actions unless each required approval and capability is available.
  - id: "sme-risk-assessment"
    label: "SME Risk Assessment"
    slash_command: "/sme-risk-assessment-prompt-preset"
    runtime_command: "/sme-care-agent"
    description: "Decision-focused SME exposure assessment with missing-input clarification, evidence confidence, and review boundaries."
    activation: "chat-agent"
    invocation_modes: ["llm-chat-response", "mcp-invocation"]
    chat_route: "active Chat provider, endpoint, and model"
    mcp_tool: "knowgrph.agentic_canvas_os.docs.invoke"
    mcp_token: "/sme-care-agent"
    prompt: |-
      /sme-care-agent @source.frontmatter @source.body @local-harness @cost-log @runtime-proof #frontmatter #harness #token-economics #runtime-ready #approval-gate

      Assess the SME's material exposures using only the active request and workspace sources. If sector, operating footprint, assets, current coverage, or decision horizon is missing and would change the assessment, ask one focused clarification before concluding. Separate observed exposure, inferred exposure, existing protection, gaps, unknowns, evidence confidence, and urgency. Return prioritized review questions and provider-neutral risk actions; do not invent quotes, policies, providers, limits, or user facts.
  - id: "sme-protection-comparison"
    label: "SME Protection Comparison"
    slash_command: "/sme-protection-comparison-prompt-preset"
    runtime_command: "/sme-care-agent"
    description: "Semantic comparison of SME protection choices against user-named priorities and unresolved evidence."
    activation: "chat-agent"
    invocation_modes: ["llm-chat-response", "mcp-invocation"]
    chat_route: "active Chat provider, endpoint, and model"
    mcp_tool: "knowgrph.agentic_canvas_os.docs.invoke"
    mcp_token: "/sme-care-agent"
    prompt: |-
      /sme-care-agent @source.frontmatter @source.body @local-harness @cost-log @runtime-proof #frontmatter #harness #token-economics #runtime-ready #approval-gate

      Compare the user-named SME protection choices against the decision variables present in the active request and workspace sources. Ask a focused clarification when a missing priority, exposure, limit, or tradeoff would change the comparison. Distinguish coverage relevance, exclusions or unknowns, operational fit, evidence confidence, and adviser-review needs. Do not fabricate product terms, rankings, premiums, providers, or a recommendation unsupported by the supplied context.
  - id: "investment-options-comparison"
    label: "Investment Options Comparison"
    slash_command: "/investment-options-comparison-prompt-preset"
    runtime_command: "/investment-research-agent"
    description: "Source-grounded comparison of user-named investment options, tradeoffs, evidence quality, and decision gaps."
    activation: "chat-agent"
    invocation_modes: ["llm-chat-response", "mcp-invocation"]
    chat_route: "active Chat provider, endpoint, and model"
    mcp_tool: "knowgrph.agentic_canvas_os.docs.invoke"
    mcp_token: "/investment-research-agent"
    prompt: |-
      /investment-research-agent @source.frontmatter @source.body @cost-log @runtime-proof #frontmatter #token-economics #runtime-ready #approval-gate

      Compare only the investment options named by the user or supported by active workspace sources. If objective, horizon, liquidity need, downside tolerance, jurisdiction, or comparison basis is missing and material, ask one focused clarification. Separate evidence, assumptions, contradictions, risk drivers, potential catalysts, liquidity, and verification gaps. Return a decision-useful comparison without inventing prices, returns, products, entities, or personalized financial advice.
  - id: "investment-plan-assessment"
    label: "Investment Plan Assessment"
    slash_command: "/investment-plan-assessment-prompt-preset"
    runtime_command: "/investment-research-agent"
    description: "Review-first assessment of an investment plan against user goals, constraints, evidence, and unresolved risks."
    activation: "chat-agent"
    invocation_modes: ["llm-chat-response", "mcp-invocation"]
    chat_route: "active Chat provider, endpoint, and model"
    mcp_tool: "knowgrph.agentic_canvas_os.docs.invoke"
    mcp_token: "/investment-research-agent"
    prompt: |-
      /investment-research-agent @source.frontmatter @source.body @cost-log @runtime-proof #frontmatter #token-economics #runtime-ready #approval-gate

      Assess the proposed investment plan against the user-named objective, constraints, evidence, and review horizon. Ask one focused clarification when a missing constraint or decision variable would materially change the assessment. Separate supported strengths, unsupported assumptions, concentration or liquidity risks, contradictions, monitoring triggers, and verification steps. Do not invent portfolio facts, expected returns, market data, transactions, or personalized financial advice.
---

# Prompt Presets

This document is the single prompt-text owner for the Knowgrph FloatingPanel **Prompt Presets** catalog. The runtime reads `prompt_presets` from frontmatter and projects the selected prompt into the existing shared composer.

Selection and loading are zero-spend. **Send** remains the Chat execution boundary. An `llm-chat-response` preset must use the active Chat provider, endpoint, and model; it cannot inherit stale card-local routing. A `native-chat-response` preset resolves through its named shared runtime without inventing a model route. The image-to-threejs, image-to-glb, and Probe-Tree presets may also be inserted from the shared Skills & Commands catalog into the selected Widget Card, where each expands to its canonical `/`, `@`, and `#` tokens without replacing attached source media. The Widget Card **Run** action is the execution boundary for those card-inline presets. The video preset additionally activates its authored Canvas document and source script through the existing source-backed video path; each changed multi-card stage is tracked by the shared active-source GitGraph owner as `Chat Run All i/n: <card>`, while an identical already-published graph remains an accepted no-op. SME Care and Investment Research presets use the shared slash-agent response contracts; Crawler Agent uses the native Import URL workflow.

Every `slash_command` is a catalog-owned selection alias matching `/*-prompt-preset`, except the two native image routes that intentionally reuse their executable slash commands. Every `runtime_command` remains the executable route owned by `SKILLS.md` and the command dictionary. Selecting a preset resolves its `runtime_command` and loads the source-backed prompt without submitting, persisting a chat turn, or rewriting the alias into another catalog entry. `mcp-invocation` calls `knowgrph.agentic_canvas_os.docs.invoke` with `mcp_token` to resolve the same command metadata; that read-only resolution is not command execution, a model call, or approval to spend or mutate.

## Catalog contract

| Preset | Preset invocation | Runtime route | Load behavior | Send behavior |
| --- | --- | --- | --- | --- |
| Video Agent | `/video-prompt-preset` | `/video-agent` | Load the centralized prompt after validating the authored video Canvas and script source. | Activate the committed Canvas and hand it to the shared Run all owner. |
| Image to Three.js | `/image.to-threejs` | `/image.to-threejs @image-to-threejs #image-to-threejs` | Load the native prompt in Chat or insert its three invocation tokens into the selected Widget Card. | Resolve only an attached or selected supported image through the native zero-cost conversion owner. |
| Image to GLB | `/image.to-glb` | `/image.to-glb @image-to-glb #image-to-glb` | Load the native procedural prompt in Chat or insert its three invocation tokens into the selected Widget Card. | Require the compact connected-contour plan, separate geometry/material/reference/action gates, rigid pivots/sockets, bounded inspection loop, full GLB plus editable external-buffer glTF, and honest `validated`/optional `approved` evidence; source media stays unchanged and deploy remains Dev-only. |
| Knowgrph Probe-Tree | `/knowgrph-probe-tree-prompt-preset` | `/knowgrph.probe-tree` | Load the source-backed prompt in Chat or insert its slash invocation into the selected Widget Card. The `@` and `#` aliases remain independently authorable. | Classify RECOMMEND, COMPARE, ASSESS, and PLAN action topics semantically and case-insensitively as clarification requests. Use the active Chat provider, endpoint, and model to materialize 2-4 Type 2 child cards; only a runtime-recognized selected-child terminal continuation bypasses generation. Reject query-specific hardcoding, inferred output edges, and zero-model fallback cards. |
| SME Care Agent | `/sme-care-prompt-preset` | `/sme-care-agent` | Load the centralized prompt into Chat. | Use the shared slash-agent contract and deterministic SME kernel when that runtime is invoked. |
| Investment Research Agent | `/investment-research-prompt-preset` | `/investment-research-agent` | Load the centralized prompt into Chat. | Use the shared slash-agent contract with source, evidence, review, and cost boundaries. |
| Crawler Agent | `/crawler-prompt-preset` | `/crawler-agent` | Load the centralized prompt into Chat with an editable URL. | Use the native headless Import URL workflow and persist separate report and pipe-table Canvas outputs. |
| SME Risk Assessment | `/sme-risk-assessment-prompt-preset` | `/sme-care-agent` | Load a source-backed assessment prompt and preserve missing decision variables as clarifications. | Use the active Chat tuple; resolve route metadata through the named MCP docs tool when invoked from MCP. |
| SME Protection Comparison | `/sme-protection-comparison-prompt-preset` | `/sme-care-agent` | Load a semantic comparison prompt over user-named choices and sources. | Use the active Chat tuple; do not fabricate products, terms, providers, or premiums. |
| Investment Options Comparison | `/investment-options-comparison-prompt-preset` | `/investment-research-agent` | Load a source-grounded comparison prompt over user-named options. | Use the active Chat tuple; keep unknown facts and financial-advice boundaries explicit. |
| Investment Plan Assessment | `/investment-plan-assessment-prompt-preset` | `/investment-research-agent` | Load a review-first plan assessment prompt. | Use the active Chat tuple; clarify material missing constraints before conclusions. |

Missing invocation modes, duplicate ids, unknown runtime or MCP tokens, a mismatched MCP tool, absent source bindings, unavailable active Chat routing, or an unavailable centralized document fail closed with a visible error. Query-specific hardcoding, zero-model LLM fallback responses, and downstream prompt copies are forbidden.
