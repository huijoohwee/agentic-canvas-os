---
title: "Cinematic Production Skill Contract"
graphId: "md:cinematic-production-skill"
doc_type: "Skill Contract"
date: "2026-10-13"
lang: "en-US"
schema: "agentic-canvas-os-skill/v1"
frontmatter_contract: "required"
status: "spec-complete"
skill_id: "cinematic.production"
owner: "$GITHUB_ROOT/agentic-graph/data/config/agents/agent-definitions.json#agent.video"
runtime_scope: "provider-neutral cinematic planning, source-grounded media intake, and existing Canvas projections"
runtime_claim: "source-backed contract only; provider execution, media persistence, and browser or device proof remain separately gated"
publish_policy: "Dev-only until explicit operator approval"
runtime_proof: "RUNTIME-PROOF.md"
load_policy: "selected-skill-only"
source_docs:
  - "SKILLS.md"
  - "DICTIONARY-COMMAND.md"
  - "DICTIONARY-SEMANTIC.md"
  - "DICTIONARY-BINDING.md"
  - "HARNESS-CONTRACTS.md"
  - "RUNTIME-READINESS.md"
copy_policy: "source-grounded capability contract; no external code, prompts, schemas, fixtures, prose, packages, or runtime dependency"
---

# Cinematic Production Skill

`cinematic.production` describes a source-grounded production workflow that joins
story, scene, shot, timing, camera, cast, prop, and rich-media planning through
existing Agentic Graph owners. It is provider-neutral and modular: a source can
produce a reviewable plan without a media-generation provider, and an unavailable
surface returns a typed gap rather than selecting a substitute runtime.

## Canonical Invocation

| Route | Contract |
|---|---|
| Command | `/video-agent` remains the sole cinematic command. This skill does not add an alias or a second parser. |
| Bindings | Use the dictionary-defined `@operator`, `@video-generation-demo-script`, modality, provider, cost, and proof bindings. A generation request requires one available registered provider binding; local planning does not. |
| Semantics | Use one dictionary-defined `#spec.*`, `#thinking.type.*`, and `#token-cap.*` value with `#approval-gate`, `#token-economics`, and `#vcc`. Camera and performance intent retain the existing `#camera-shot`, `#camera-motion`, `#character-motion`, and `#action-path` meanings. |
| Discovery | The source-backed catalog may expose this selected skill and the existing `agent.video` variant in FloatingPanel Skills and Commands. Discovery does not execute, persist media, spend, or publish. |

The invocation dictionaries own the `/`, `@`, and `#` grammar. Agentic Canvas OS
projects that grammar as metadata; Agentic Graph owns dispatch, validation, and
native Canvas surfaces.

Control ownership defaults to Agent (AI/LLM/MCP). Human mode explicitly enables
direct panel edits. Both modes use the same scene, camera, and Timeline owners;
the selector does not imply an LLM call, provider choice, or spend.

## Production Contract

| Stage | Input | Output | Owner and boundary |
|---|---|---|---|
| Source intake | Authored script, operator-supplied reference media, annotations, location facts, and rights state. | Source identities, observed/inferred distinction, and a typed missing-source or rights gap. | Existing media and evidence owners; no implied download, license, or provider call. |
| Control ownership | Agent (AI/LLM/MCP) by default, or explicit Human selection. | One owner for edits at a time; both read the same current scene, camera, and Timeline state. | Shared cinematic control-mode owner and the existing guarded UI/MCP routes; no per-panel mode state. |
| Story and scene plan | Valid source intake. | Editable Character, Scene, Dialogue, Visual asset, Audio, Timing, Metadata, and Prompt sheets. | Existing `/video-agent` text stage; a plan is not generated media. |
| Shot and choreography plan | Scene plan with stable scene, shot, camera, subject, and prop identities. | Ordered shot timing, camera marks, action paths, and subject or prop marks linked to the same identities. | Existing Timeline and Camera owners; one transport remains authoritative. |
| Optional Geo and XR previs | A locally available scene projection and source-backed location facts. | A non-authoritative spatial blocking preview or a typed unavailable result. | Existing Media, Assets, Geo, and XR owners; no claim that a map, raster, or reference image establishes 3D fidelity. |
| Media generation | Explicit operator approval, registered provider capability, budget, source state, and selected modality. | Provider-specific typed result, persistence state, read-back evidence, actual cost, or terminal failure. | Registered modality adapter only; provider choice is never encoded in the skill contract. |
| Review and output | A valid plan or persisted artifact. | Shared Canvas, Rich Media Panel, and Timeline projection with provenance and status. | Existing native projection owners; publish remains a separate approval-gated action. |

## Camera, Subjects, Props, And Motion

A scene plan names stable identities before any spatial or media stage. Camera
marks state the framing or motion intent and time range. Subject marks state the
selected character or object, its action intent, and the relevant shot range.
Prop marks state the object and its relation to the scene or subject. Each mark
keeps its source status: observed reference, authored instruction, or inferred
previs detail.

The current contract permits the existing native camera, character-motion, and
action-path owners to project compatible marks. It does not promise skeletal
animation, physical simulation, photogrammetry, image reconstruction, or visual
fidelity beyond evidence produced by those owners. A static asset remains static
until its selected motion owner returns applied proof.

## Bounds And Fallbacks

- Local plan, catalog, timeline, and provenance inspection make zero paid calls.
- A generation stage stops before spend when approval, provider capability,
  entitlement, budget, source identity, persistence, or read-back evidence is
  missing.
- Unsupported modality, token, binding, semantic, or projection requests return
  a typed gap. They never create hidden aliases, provider fallbacks, media URLs,
  or synthetic proof.
- The same source identity flows through sheets, shot rows, timeline marks, and
  native projections. A late result cannot replace a newer selected source or
  scene revision.
- This contract is document-agnostic. A Markdown file opts in through the
  versioned frontmatter contract and stable source identity; runtime behavior
  must never depend on a seed filename, a hard-coded document path, or a second
  cinema-specific variant. Titles, contact-sheet layout, shot markers, and
  environment-kit identity come from that document's YAML. The shared control
  owner, Skills & Commands catalog, camera playhead, and Timeline remain common
  owners across documents and panels. Unknown schema or kit identities return
  an explicit unavailable result instead of selecting another file's settings.
- Geo and XR are optional local previs surfaces. They must preserve geographic
  source uncertainty and must not turn a local preview into a production,
  licensing, location, or fidelity assertion.

## Verification Conditions

| VCC | Observable check |
|---|---|
| Canonical routing | Cinematic discovery resolves the existing `/video-agent` route and dictionary bindings or reports the exact missing capability. |
| Control ownership | Agent is the default; Human selection enables direct edits while MCP edits fail closed, and both project the same Timeline state. |
| Source truth | Each plan row identifies its source, rights state when supplied, and observed versus authored or inferred status. |
| Shared identity | Scene, shot, camera, subject, and prop rows retain stable identities when shown by Timeline, Media, Assets, or a compatible XR projection. |
| Cross-document reuse | Two documents using the same supported frontmatter schema resolve labels, assets, kit locations, control ownership, and camera keys from their own source identity without runtime filename checks or panel-local copies. |
| Choreography boundary | Camera and action marks use the existing transport and motion owners; no second playhead, path store, or animation runtime appears. |
| Spend boundary | Dry-run and local plan operations report zero paid calls. A provider call has approval, actual provider result, actual cost, persistence, and read-back evidence. |
| Honest fidelity | Reference images, Geo views, and previs surfaces do not imply 3D reconstruction or visual-match proof. |
| Deployment boundary | Skill discovery and planning make no production, Cloudflare, or publication effect. |

## Validation Scope

Validate this documentation contract with the repository documentation and
instruction-audit checks. Validate executable changes in the owning Agentic Graph
runtime, including its focused source, Timeline, Media, Camera, and XR checks.
Passing this document's checks does not establish live-provider, browser, device,
persistence, or deployment readiness.
