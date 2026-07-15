---
title: "Image To Three.js Skill Contract"
graphId: "md:image-to-threejs-skill"
doc_type: "Skill Contract"
date: "2026-07-14"
lang: "en-US"
schema: "agentic-canvas-os-skill/v1"
frontmatter_contract: "required"
status: "runtime-ready-dev"
skill_id: "image.to-threejs"
owner: "$GITHUB_ROOT/knowgrph/canvas/src/features/image-to-threejs"
runtime_scope: "Knowgrph Card, Widget, and Rich Media Panel projections"
runtime_claim: "native Dev runtime proven for PNG, JPEG, and SVG Card, Widget, Storyboard, and Rich Media Panel projections with typed fallback and bounded disposal"
publish_policy: "Dev-only until explicit operator approval"
runtime_proof: "RUNTIME-PROOF.md"
source_docs:
  - "SKILLS.md"
  - "FACTS.md"
  - "AGENTS.md"
external_pattern_sources:
  - "https://github.com/vinhhien112/Three.js-Object-Sculptor-Codex-Plugin"
copy_policy: "behavioral reference only; forbid copied code, prompts, schemas, fixtures, prose, packages, plugin installation, or runtime dependency"
---

# Image To Three.js Skill

`image.to-threejs` is a model-free Knowgrph skill that converts supported image sources into a typed Three.js render contract and projects the result through existing Card, Widget, and Rich Media Panel owners. It is not an agent, provider, photogrammetry pipeline, external plugin, or compatibility alias.

## Shared Invocation

| Route | Value | Rule |
|---|---|---|
| Command | `/image.to-threejs` | Resolve through the shared native contract from a skill node or inline Card/Widget prompt before generic text/provider execution; do not add a card-local parser. |
| Semantic | `#image-to-threejs` | Identify the typed native Three.js conversion capability. |
| Binding | `@image-to-threejs` | Bind exactly one `.png`, `.jpg`, `.jpeg`, or `.svg` source. |
| Proof | `@runtime-proof` | Surface typed conversion, focused checks, cost state, and deploy boundary. |

## Typed Contract

```yaml
input:
  source_url: "string ending in .png, .jpg, .jpeg, or .svg, or an equivalent image data URL"
output:
  schema: "knowgrph-image-to-threejs/v1"
  source_kind: "raster | svg"
  render_engine: "three"
  primitive: "textured-plane | shape-geometry"
  render_mode: "threejs"
fallback:
  errors: ["missing-source", "unsupported-format"]
  projection: "original image surface after a typed Three.js load error"
bounds:
  max_iterations: 1
  circuit_breaker: "stop on invalid source, loader error, unmount, or aborted SVG request"
cost:
  model: "local-threejs"
  prompt_tokens: 0
  completion_tokens: 0
  cache_hits: 0
  estimated_cost_usd: 0
```

## Render Rules

- `.png`, `.jpg`, and `.jpeg` use native Three.js texture loading, `SRGBColorSpace`, a textured plane, and explicit texture disposal.
- `.svg` uses native `SVGLoader`, `ShapeGeometry`, stroke geometry, bounded fitting, and explicit geometry/material disposal.
- Source replacement is keyed to the canonical URL so a late loader completion cannot overwrite the current Card, Widget, Storyboard, or Rich Media Panel projection.
- A manual inline `/image.to-threejs` Card Run stays scoped to its invoking Widget Card even when a Rich Media Panel is connected as input. Attached album media, inline Markdown image media, and connected inputs share one source resolver.
- An inline Card conversion creates or reuses a marker-scoped `Three.js Rich Media Panel` owned by that Card. Its generated manifest and `mediaRenderMode: threejs` patch are published only to this output panel; fresh runs do not mutate the input Widget Card or input Rich Media Panel. An explicit rerun may remove only a prior legacy derived-output signature while preserving the prompt and raw media, and never touches marker-owned or authored Three.js panels.
- Card, Widget, Storyboard, 2D overlay, Three overlay, and Rich Media Panel projections preserve the same `mediaRenderMode: threejs` value.
- Load failures return to the original image projection without provider spend, generated-media backfill, or hidden retry.

## Widget Card Presentation

The default public card presents as `Widget Card`. It suppresses the legacy visible `Text Generation` metadata rail while retaining query-visible `/`, `#`, and `@` invocation chips. This is a presentation cleanup only; it does not add a compatibility parser or an external skill dependency.

## External Boundary

The named Object Sculptor repository informs only the staged, code-first modeling capability class. Knowgrph imports none of its code, prompts, schema, tests, fixtures, prose, package metadata, plugin layout, or runtime dependencies. The local skill uses dependencies already owned by the Canvas runtime.

## VCCs

| VCC | Check |
|---|---|
| Formats are bounded | PNG, JPG, JPEG, and SVG resolve; unsupported formats fail closed before render work. |
| Surfaces agree | Card, Widget, and Rich Media Panel projections receive one canonical `threejs` render mode. |
| Native lifecycle is bounded | Raster textures and SVG geometry/material resources dispose on replacement or unmount. |
| Spend is exact | The manifest reports zero model tokens and zero estimated cost. |
| External dependency is absent | Dependency manifests and runtime imports contain no Object Sculptor plugin package or copied source. |
| Deployment stays closed | Focused Dev proof performs no Prod mirror or Cloudflare mutation. |

## Runtime-ready Dev Proof

| Gate | Evidence |
|---|---|
| Typed conversion and lifecycle | `npm --prefix canvas run test:ci:unit -- imageToThreeJs` reports 17/17 focused selectors passing, including inline Card/Widget invocation, a Card-owned `Three.js Rich Media Panel` with no input mutation, legacy derived-output recovery, source replacement, fallback, and disposal events. |
| Browser contract | `npm --prefix canvas run test:ci:unit -- richMedia.browserSmokeContract` reports 1/1 passing. |
| Shared-surface browser proof | `npm --prefix canvas run test:smoke:rich-media:browser` on a contract-valid Knowgrph task branch renders a PNG Rich Media Panel, runtime-generated JPEG Card, SVG Rich Media Panel, SVG Storyboard Widget, and the typed fallback on the visual Canvas. |
| Static gates | Canvas TypeScript and repository hygiene checks pass for the validated source diff. |
| Dependency boundary | Package manifests are unchanged; the runtime continues to use the repository-owned, deduplicated `three` dependency and imports no Object Sculptor package or source. |
| Deployment boundary | Proof is local to the validated Knowgrph Dev task branch. Protected integration, Prod mirror synchronization, and Cloudflare remain separate operator-gated steps. |
