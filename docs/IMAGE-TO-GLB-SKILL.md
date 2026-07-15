---
title: "Image To GLB Skill Contract"
graphId: "md:image-to-glb-skill"
doc_type: "Skill Contract"
date: "2026-07-15"
lang: "en-US"
schema: "agentic-canvas-os-skill/v1"
frontmatter_contract: "required"
status: "spec-complete"
skill_id: "image.to-glb"
owner: "$GITHUB_ROOT/knowgrph/canvas/src/features/image-to-glb"
runtime_scope: "Knowgrph Widget Card prompt, procedural scene, GLB asset pipeline, and separate output projection"
runtime_claim: "source-backed native procedural-GLB contract; no external LLM/provider run is claimed by this document"
publish_policy: "Dev-only until explicit operator approval"
runtime_proof: "RUNTIME-PROOF.md"
source_docs:
  - "SKILLS.md"
  - "FACTS.md"
  - "AGENTS.md"
  - "IMAGE-TO-THREEJS-SKILL.md"
external_pattern_sources:
  - "https://github.com/VAST-AI-Research/TripoSR"
  - "https://github.com/vinhhien112/Three.js-Object-Sculptor-Codex-Plugin"
copy_policy: "behavioral reference only; forbid copied code, dependencies, prompts, schemas, fixtures, prose, tests, plugin installation, layout, or runtime dependency"
---

# Image To GLB Skill

`image.to-glb` is the native Knowgrph contract for turning one supported image source into a procedural Three.js scene and a GLB asset. It reuses the existing image-to-threejs source-resolution and preview utilities; it does not replace the source Widget Card or its input media.

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
| Scene source | Procedural JS/TS that constructs the scene with native Three.js operations, such as `new THREE.BoxGeometry(...)`, `new THREE.BufferGeometry().setFromPoints(...)`, existing in-repo CSG operations, or parametric surfaces. | Baked mesh blobs, mesh JSON, base64 geometry, serialized buffer attributes, or any generated geometry payload that bypasses construction code. |
| Asset pipeline | Build the scene at runtime and export the resulting artifact as `.glb`. | Treating an input image, static preview, or serialized geometry object as the output asset. |
| LLM loop | When an approved LLM runtime exists, it may produce or edit procedural JS/TS and record bounded vision-review passes against the source image. | Claiming an LLM run without proof, allowing unreviewed code to execute, or using LLM output that is a serialized geometry format. |
| Existing-scene edit | Structural scene edits serialize as `.gltf` with external `.bin` buffers and external resources. | Embedded `data:` buffers, inline binary payloads, or GLB/embedded-buffer output for the structural-edit interchange path. |

## Bounds

- The prompt preset adds exactly `/image.to-glb @image-to-glb #image-to-glb` and leaves attached input media unchanged.
- Review passes are bounded and must surface a pass/fail ledger. A missing approved LLM runtime is a typed capability gap, not a fabricated review.
- Unsupported source formats, procedural-code validation failures, exporter failures, embedded glTF buffers, and copied/external dependency paths fail closed.
- The named TripoSR and Object Sculptor repositories are high-level behavioral references only. Knowgrph imports none of their code, packages, prompts, schemas, tests, fixtures, prose, layout, or runtime dependencies.

## VCCs

| VCC | Check |
|---|---|
| Invocation is reusable | The shared Skills & Commands catalog inserts the canonical `/`, `@`, and `#` preset grammar into the selected Widget Card. |
| Source is preserved | Prompt insertion and output publication never replace the source Card or input media. |
| Construction is procedural | Validation accepts native Three.js construction code and rejects baked or serialized geometry payloads. |
| Artifact is explicit | Runtime asset output is a GLB; structural scene-edit interchange is glTF with external buffers only. |
| Review is honest | Every LLM-assisted pass has code, reference, verdict, and bounded iteration evidence; absent runtime remains a typed gap. |
| External boundary is closed | No TripoSR or Object Sculptor code, dependency, prompt, schema, test, fixture, prose, or UI is copied or installed. |
