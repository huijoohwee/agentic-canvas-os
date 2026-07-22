---
title: "Image To GLB Skill Contract"
graphId: "md:image-to-glb-skill"
doc_type: "Skill Contract"
date: "2026-07-22"
lang: "en-US"
schema: "agentic-canvas-os-skill/v1"
frontmatter_contract: "required"
status: "spec-complete"
skill_id: "image.to-glb"
owner: "$GITHUB_ROOT/knowgrph/canvas/src/features/image-to-glb"
runtime_scope: "Knowgrph Widget Card prompt, compact contour reconstruction, action-ready procedural scene, GLB and editable glTF asset pipeline, and separate output projection"
runtime_claim: "source-backed native single-reference procedural image-to-3D contract; deterministic validation is not an independent visual approval"
publish_policy: "Dev-only until explicit operator approval"
runtime_proof: "RUNTIME-PROOF.md"
source_docs:
  - "SKILLS.md"
  - "FACTS.md"
  - "AGENTS.md"
  - "IMAGE-TO-THREEJS-SKILL.md"
external_pattern_sources:
  - "https://github.com/hoainho/img2threejs"
  - "https://github.com/microsoft/TRELLIS.2"
copy_policy: "conceptual inspiration only; forbid copied code, dependencies, prompts, schemas, examples, fixtures, prose, tests, assets, weights, models, configuration, services, layout, or runtime dependency"
---

# Image To GLB Skill

`image.to-glb` is the native Knowgrph contract for rebuilding one supported image reference as reviewable TypeScript, a trusted Three.js scene, a full GLB, and editable glTF JSON with an external `.bin` buffer. It reuses the existing image-to-threejs source-resolution utilities; it does not replace the source Widget Card or its input media.

## Shared Invocation

| Route | Value | Rule |
|---|---|---|
| Command | `/image.to-glb` | Resolve through the shared Card/Widget invocation catalog before generic text or provider execution. |
| Semantic | `#image-to-glb` | Identify the native procedural image-to-GLB asset capability. |
| Binding | `@image-to-glb` | Bind exactly one `.png`, `.jpg`, `.jpeg`, or `.svg` source. |
| Proof | `@runtime-proof` | Surface the procedural-code validation, review ledger, export result, and deploy boundary. |

## Construction Contract

| Area | Required behavior | Rejected behavior |
|---|---|---|
| Reference reconstruction | Every supported source uses connected silhouette runs, quantized outlines, and centered beveled `ExtrudeGeometry` contour volumes. Disconnected runs remain disconnected so negative spaces survive. | Object-specific templates, ring/frame shortcuts, generic horizontal box bands, whole-object bounding volumes, or a claim that one front image observed hidden surfaces. |
| Scene source | Reviewable JS/TS constructs shapes, PBR materials, meshes, hierarchy, and animation with the installed Three.js runtime. | Baked mesh blobs, mesh JSON, typed-array literals, encoded geometry, data URIs, loaders, arbitrary modules, network calls, or serialized buffer attributes. |
| Action readiness | A stable model root owns one rigid pivot and attachment socket per semantic mesh plus one four-second loop-continuous inspection clip bounded to `+/-12` degrees yaw. | Duplicate or unstable identities, malformed bindings, non-finite transforms, pre-existing animations, skinning, morph targets, or any deformable-readiness claim. |
| Asset pipeline | Export the quality-admitted trusted scene as a full `.glb` and editable `.gltf` JSON with an external `.bin`; preserve geometry, PBR materials, transforms, names, hierarchy, sockets, and animation. | Treating an input image or static preview as the output asset, emitting an embedded editable glTF buffer, or exporting stale provenance or scene evidence. |
| Review ledger | Native mechanical evidence uses `validated`; only a separately configured independent provider review may use `approved`, and every pass must bind the exact reference, program, projection, views, parts, score, and unresolved issues. | Labelling deterministic self-checks as approved, fabricating a provider run, accepting unresolved issues, or allowing an open-ended correction loop. |

## Compact Plan And Review Bounds

The native reference reader samples a maximum dimension of 192 pixels and compresses repeated evidence before constructing geometry. The deterministic native ledger has three sequential stages: reference analysis, procedural geometry, and artifact review. Any optional provider-assisted correction must remain inside that bounded evidence ledger; absent provider capability does not block deterministic validation and never becomes a fabricated approval.

| Plan budget | Limit |
|---|---:|
| Connected components | 24 |
| PBR materials | 6 |
| Outline points per component | 48 |
| Estimated plan triangles | 16,000 |
| Generated procedural source | 28,000 bytes |

The artifact gate separately caps the admitted scene at 96 meshes, 120,000 triangles, 24 PBR materials, and 32,000 reviewable-source characters. Reference admission requires a score of at least `0.72`, at least `0.90` retained contour area, and at least `0.75` retained silhouette spans.

## Quality And Provenance Gates

Geometry, material, reference, and action gates stay separate so one aggregate score cannot hide an identity-critical failure. The compactness report is additional evidence, not a substitute for those gates.

| Gate | Required evidence |
|---|---|
| Geometry | Finite attributes, nondegenerate 3D bounds, triangle/mesh budgets, and exact manifest-to-mesh parity. |
| Material | Supported PBR materials, finite color/metalness/roughness values, and material-count bounds. |
| Reference | Front silhouette score, retained area and spans, observed-front provenance, and inferred-hidden-surface confidence below certainty. |
| Action | Exact root-pivot-mesh/socket hierarchy, preserved world transforms, finite clip bindings and samples, bounded yaw, and identical start/end quaternion. |

Complete geometry buffers, material values, world transforms, bounds, parent paths, and animation tracks are fingerprinted. Export recomputes that evidence and fails closed on reference, program, hierarchy, animation, material, or geometry drift.

## Bounds

- The prompt preset adds exactly `/image.to-glb @image-to-glb #image-to-glb` and leaves attached input media unchanged.
- One front reference observes only its visible projection. Rear depth, occluded surfaces, and interiors remain explicitly inferred with bounded confidence; multi-view reconstruction is a separate capability.
- Unsupported source formats, compact-plan overflow, failed geometry/material/reference/action gates, exporter failures, embedded editable-glTF buffers, and external coupling fail closed.
- Rigid pivots, sockets, and the inspection loop are action-ready evidence. Character skinning, morph deformation, and deformable rigging are not claimed by this contract.
- [hoainho/img2threejs](https://github.com/hoainho/img2threejs) and [microsoft/TRELLIS.2](https://github.com/microsoft/TRELLIS.2) inform only neutral staged-construction, compact-planning, and separated-quality principles. Knowgrph copies or depends on none of their code, packages, prompts, schemas, examples, tests, fixtures, prose, assets, weights, models, configuration, services, layout, or runtime.

## VCCs

| VCC | Check |
|---|---|
| Invocation is reusable | The shared Skills & Commands catalog inserts the canonical `/`, `@`, and `#` preset grammar into the selected Widget Card. |
| Source is preserved | Prompt insertion and output publication never replace the source Card or input media. |
| Reconstruction is universal and compact | Every supported reference uses the same connected-contour lane; quantized plan, source, material, component, point, and triangle budgets pass. |
| Quality remains separable | Geometry, material, reference, action, and compactness evidence pass independently before export. |
| Action evidence is bounded | Stable rigid pivots and sockets plus the four-second `+/-12` degree loop survive artifact round-trip; deformable claims fail closed. |
| Artifact is explicit | The same admitted scene exports as a full GLB and editable glTF with an external `.bin` buffer. |
| Review is honest | Deterministic evidence is `validated`; `approved` requires a proven independent provider review inside the bounded ledger. |
| External boundary is closed | The two exact provenance URLs appear only as conceptual references; no external project artifact or dependency enters runtime or source. |
| Deploy is bounded | Source and focused Dev proof do not authorize Prod or Cloudflare mutation. |
