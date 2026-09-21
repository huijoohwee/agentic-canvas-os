---
title: "Procedural Asset Skill Contract"
graphId: "md:procedural-asset-skill"
doc_type: "Skill Contract"
date: "2026-09-22"
lang: "en-US"
schema: "agentic-canvas-os-skill/v1"
frontmatter_contract: "required"
status: "spec-complete"
skill_id: "asset.create"
owner: "$GITHUB_ROOT/agentic-graph/canvas/src/features/image-to-glb"
runtime_scope: "native text-to-editable Three.js construction, procedural controls, artifact persistence and GLB export"
runtime_claim: "source-backed bounded capability contract; runtime and cross-surface proof require the exact Graph implementation"
publish_policy: "Dev-only until explicit operator approval"
runtime_proof: "RUNTIME-PROOF.md"
load_policy: "selected-skill-only"
source_docs:
  - "SKILLS.md"
  - "FACTS.md"
  - "PRD-TAD-ADR-MVP-GTM.md"
  - "IMAGE-TO-GLB-SKILL.md"
---

# Procedural Asset Skill

`asset.create` turns text into an editable native Three.js asset. Canvas owns this
authored skill and preset. Graph owns construction, controls, persistence, scene
projection and export. Agentic OS owns invocation tokens; Canvas dictionary files
are exact projections of its pinned source. Discovery does not execute creation.

## Invocation and capability

| Route | Contract |
|---|---|
| `/asset.create @text #procedural-asset` | Resolve the intended native construction contract. The current implementation candidate executes through Card Run; Chat Send, MCP execution, WebMCP execution and XR projection are pending. |
| Preset selection | Load the source-backed prompt without submitting, mutating the document or calling a provider. |
| Card Run | Execute only when the integrated Graph candidate advertises this capability and normal target/mutation checks pass. Preserve the input Card and its attachments. |
| Chat, MCP and WebMCP | Discovery or metadata resolution grants no execution capability. Return unavailable until the shared runtime entry is integrated and proven; never fall back to a provider or unrelated runtime. |
| Connected agent | Supply a typed recipe through the same validator and mutation owner; never execute agent-generated JavaScript. |
| Missing capability | Return a typed unsupported or unavailable result with the supported vocabulary. Keep the last valid asset and unapplied intent. |

The preset explicitly declares `execution_surface: card-run` and pending surfaces.
Legacy invocation-mode fields describe discovery vocabulary, not delivered Chat or
agent execution. Source promotion, preset loading and runtime proof are separate.

The first local vocabulary is explicit: robot, character, tree, palm, chair,
table, box, sphere and cylinder. These are original native part assemblies,
not unrestricted natural-language modeling or image reconstruction. An agent
may supply a bounded typed primitive recipe outside that vocabulary. A provider
is optional and never required for local construction or control changes.

## Editable source and controls

Persist one asset identity with its schema version, original intent, seed, typed
part recipe, stable part IDs, hierarchy, pivots, sockets, control schema, current
values, and reviewable generated source. The executable owner validates data and
constructs the scene with trusted code. Generated JS/TS is an inspectable export
companion; arbitrary supplied source is never evaluated or imported.

The recipe schema is `agentic-graph-procedural-asset/v1`; its typed primitives are
`box`, `sphere`, `cylinder` and `cone`. Part records declare position, rotation,
size, pivot, color, visibility and a parent ID. Controls bind to an exact part;
clips bind ordered rotation keys to stable part IDs.

| Control | Required behavior |
|---|---|
| Numeric | Label, finite minimum/maximum/step/default and bounded current value for width, height or depth. |
| Color | Valid bounded color value with default; body and accent edits affect the admitted material targets. |
| Enum | Labelled closed options and valid default/current value; detail selection stays within the geometry budget. |
| Boolean | Explicit default and current value for a declared visibility or feature target. |
| Reset | Restore declared defaults deterministically without changing stable part identity or calling a model. |

Controls identify their affected part or parameter. Unchanged inputs reuse valid
results; a relevant change rebuilds only the affected native asset. Reloading the
source preserves recipes, values and selection identity instead of reconstructing
editability from a rendered mesh. Persist last-valid state separately from an
unapplied draft; validation failure never destroys either.

## Bounds and transaction semantics

- Cap a recipe at 65,536 UTF-8 bytes, 48 parts, 32 controls, eight clips and 32
  keys per track. Cap scene geometry at 120,000 triangles. Declare and enforce
  material, generated-source and execution-time limits before scene admission.
- Reject duplicate IDs, dangling parent/target references, hierarchy cycles,
  non-finite transforms, unsupported primitives and out-of-range controls.
- Build from validated data; forbid arbitrary code evaluation, dynamic imports,
  network loaders, encoded geometry and uncontrolled external resources.
- Stage changes before committing. Reject late work after document revision,
  target, generation or selection authority changes; cancellation and failure
  dispose temporary resources and preserve the last-valid asset and draft.
- Use the existing scene, selection, camera and transport owners. Card, Widget,
  Rich Media and XR projections refer to one persisted asset identity.
- Keep the native image route's reference validation intact. Text creation does
  not manufacture an image reference to pass its admission gates.

## Evidence and export

Text-only evidence binds the exact intent, recipe, parameter values, generated
source and scene. Mechanical checks report `validated` with geometry, material,
hierarchy and export findings. They do not claim visual matching, an observed
front, a silhouette score, an image digest or independent provider approval.

Export an immutable snapshot of the admitted scene as GLB. Reimport must preserve
geometry, colors/PBR values, transforms, hierarchy, stable names, pivots, sockets
and any supported animation clips. Later edits must not alter an in-flight
export. The editable recipe and generated source accompany the mesh artifact;
GLB alone does not preserve procedural controls or source logic. Editable glTF
may reuse Graph's external-buffer exporter with the same fidelity checks.

Model, rigid-part rigging and animation reuse the existing XR authoring owners.
A static asset is not evidence of animation or general skeletal deformation.
MP4 remains a separately probed native recording capability; unsupported output
returns a typed result and never relabels another media container as MP4.

## Acceptance and verification

| ID | Observable result |
|---|---|
| B01 | Supported text creates an original typed asset with no image input or provider call; unsupported intent returns declared bounds. |
| B02 | Save and reload retain intent, recipe, seed, stable IDs, values and generated source; supplied code cannot execute. |
| B03 | Numeric, color, enum, boolean and reset controls change the intended target deterministically with zero provider calls. |
| B04 | Invalid input, cancellation and stale completion preserve last-valid state and the unapplied draft; resource limits reject before commit. |
| B05 | Text evidence contains no fabricated image or provider claims; the image route still rejects missing reference evidence. |
| B06 | Reimported GLB matches the export snapshot, including clips when present; editable recipe/source companions are emitted. |
| B07 | Card, Widget, Rich Media and XR share asset identity and existing selection/transport; rig and animation remain source-owned. |
| B08 | Canvas preset and skill resolve the pinned OS dictionary through Graph's shared dispatcher; no alternate gateway or runtime is introduced. |

Run the affected Graph contract, builder, persistence, cancellation and GLB
round-trip checks, then the Canvas preset and documentation checks. Dictionary
projections require an exact protected OS source revision before regeneration.
Source contracts and passing local checks remain separate from integrated runtime,
browser/device proof and deployment. All local construction and controls are
free-tier/FOSS, with no new paid service or runtime dependency.
