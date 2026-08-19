---
title: "Orchestration Projection Visualization Requirements"
graphId: "md:orchestration-projection-visualization-requirements"
doc_type: "Feature Requirements"
date: "2026-08-17"
lang: "en-US"
schema: "agentic-orchestration-projection-visualization-requirements/v1"
frontmatter_contract: "required"
status: "spec-complete"
publish_policy: "Dev-only; no Prod mirror or Cloudflare authority"
---

# Requirements Document

## Introduction

An operator cannot currently see the harnessing and orchestration state of the
`agentic-canvas-os` (ACOS) repository as a picture. The state exists: lane
lifecycle, workspace parallelism, coordination waves, collaboration gates, local
runtime readiness, and writer leases are all already emitted as typed `--json`
receipts by repository-owned scripts. Nothing assembles them into one
renderable document.

This feature adds one repository-owned ACOS projector that reads receipts ACOS
already emits and produces one markdown-with-frontmatter Projection_Document.
Knowgrph renders that document through its existing generic 2D surfaces. No new
Knowgrph renderer mode is added.

### Approved architectural direction (settled; not re-opened by this spec)

ACOS emits a projection; Knowgrph renders it with existing generic surfaces.

The rejected alternative was adding a `2D Renderer: Orchestration` mode to
Knowgrph. It requires five renderer-registry touch points, a new headless model,
and a new guard test, and it couples Knowgrph's renderer registry to ACOS schema
identifiers. That fails Knowgrph's renderer-neutrality contract and carries a
worse total cost of ownership than a document projection.

### Increment order (minimum-viable-maximum-value)

1. Projector plus Storyboard rendering (lanes by stages). This is Min-Viable Scope.
2. Multi-dimensional Table drill-down on raw receipt JSON.
3. Dashboard rollup.
4. Deferred, named as future work and explicitly out of scope here: Flowchart or
   D3 integration DAG, GitGraph lane lineage, Gantt lease and wave timeline.

### Deploy boundary

Dev-only. This spec grants no Prod mirror authority, no Cloudflare authority,
and no deployment authority of any kind.

---

## Verified Repository Facts

Confirmed directly against both repositories. Implementers should not re-derive
these. Paths are repository-relative; workspace-level paths are rooted at
`$GITHUB_ROOT`.

### Knowgrph render targets (`$GITHUB_ROOT/knowgrph`)

| Fact | Evidence |
|---|---|
| The renderer registry single source of truth declares 12 renderer ids and 11 surfaces, with `DEFAULT_CANVAS_2D_RENDERER = 'storyboard'`. | `canvas/src/lib/config.render.ts`: `CANVAS_2D_RENDERERS` line 1, `CANVAS_2D_SURFACES` line 6, `CANVAS_2D_RENDERER_SPECS` lines 24-128, default line 141, `resolveCanvas2dRendererId` line 147, `getCanvas2dSurfaceId` line 253. |
| Storyboard is the only renderer with `supportsStoryboardFlowFrontmatterSyntax: true`. | `canvas/src/lib/config.render.ts` lines 108-115. |
| Storyboard entry chain is `canvas/src/components/StoryboardWidgetCanvas.tsx` to `.runtime.tsx` to `StoryboardWidgetCanvas/runtime/StoryboardWidgetCanvasSurface.tsx`; the headless model is `buildStoryboardBoardModel({graphData, graphRevision, widgetRegistry})`. | `canvas/src/components/StoryboardCanvas/storyboardModel.ts:537`. |
| Storyboard groups cards into lanes by the **first present** key in an ordered list: `['status','stage','column','lane','phase','track','swimlane','group','bucket','category','columnKey']`. Absent all of them, the lane label falls back to `STORYBOARD_EMPTY_LANE = 'Storyboard'` and the reported lane property key defaults to `'stage'`. | `canvas/src/lib/graph/keywordTerms.ts:4` (`GRAPH_KEYWORD_LANE_PROPERTY_KEYS`); `storyboardModel.ts:44,46,338-355`. |
| Within-lane card order is read from `['order','sort','sequence','sceneOrder','shotOrder','index','rank']`, and the displayed index label from `['frame','frameNumber','sceneNumber','shotNumber','panelNumber','number','index','step','stepNumber','sequenceNumber','position','ordinal']`. | `storyboardModel.ts:50-51`. |
| Multi-dimensional Table accepts markdown text **or** raw JSON text through `source.jsonSourceDocumentText`. | `canvas/src/features/markdown-workspace/main/viewer/MultiDimTableSurface.tsx:20`, hook `useCanvasWorkspaceDataViewSource('multi-dimensional-table.md')`, JSON branch lines 33-36. |
| Dashboard is schema-agnostic and pure-headless, with a fixed five-metric model: nodes, edges, density, signals, grid. | `canvas/src/components/DashboardCanvas/dashboardModel.ts:270` `buildDashboardCanvasModel(graphData, schema)`, metrics lines 307-313; entry `canvas/src/components/DashboardCanvas/index.tsx`. |
| Only three renderers are valid workspace URL/file/folder import targets: `['d3','design','storyboard']`. | `canvas/src/features/markdown-workspace/workspaceImport/canvasPresets.ts:5`, presets lines 32-58; fallbacks in `canvas/src/features/toolbar/launchDropdownFallbacks.ts` (`importLocalFilesFallback:34`, `importLocalFolderFallback:108`, `importUrlFallback:172`). |
| The frontmatter preset contract exposes optional keys including `canvasSurfaceMode`, `canvasRenderMode`, `canvas2dRenderer`, `multiDimTableModeEnabled`, `frontmatterModeEnabled`. | `canvas/src/lib/markdown/frontmatter.ts`: `CanvasWorkspaceFrontmatterPreset:16`, `readCanvasWorkspaceFrontmatterPresetFromMeta:302`, `parseCanvasWorkspaceFrontmatterPreset:360`, `readCanvas2dRendererPreset:171`. |
| Text and JSON loading route through one parser entry with a dedicated `.json` branch. | `canvas/src/features/parsers/loader.ts:200` `loadGraphDataFromTextViaParser`, `.json` branch line 226 onward via `parseGraphFromJson` in `canvas/src/lib/graph/io/adapter.ts`. |
| A renderer-pipeline neutrality guard test exists and currently passes. | `canvas/src/__tests__/rendererPipelineNeutrality.test.ts`. |
| **Defect A (confirmed):** `CANVAS_VIEW_RENDERER_ANIMATIC_TITLE` is set to `'2D Renderer: Gantt-timeline'`, duplicating the Gantt title, and the renderer toggle tooltip omits Gallery, Media, and Animatic. | `canvas/src/lib/config-copy/uiCopy.ts:19` (Gantt), `:21` (Animatic, wrong), `:25-26` (tooltip). |
| **Defect B (confirmed):** `canvas/src/components/StoryboardCanvas.tsx` is an orphan module. A repository-wide search for `from '@/components/StoryboardCanvas'` returns no matches; only modules inside the `StoryboardCanvas/` directory are live. | Search returned zero matches. |

### ACOS source receipts (`$GITHUB_ROOT/agentic-canvas-os`)

Existing `--json` emitters, to be used as projector inputs. No new orchestration
state is invented by this feature.

| npm script | Schema id | Notable fields / evidence |
|---|---|---|
| `worktree:lifecycle:check` | `agentic-worktree-lifecycle-report/v1` | `schema, repository, canonicalSha, status, worktrees` (`scripts/worktree-lifecycle-lib.mjs:123-127`). |
| `workspace:parallelism:check` | `agentic-workspace-parallelism-report/v1` | `schema, workspaceRoot, generatedAt, repositories, sessions, lanes, parallelLanes, unrecoverableLanes, forbiddenOperationClasses, ready` (`scripts/workspace-parallelism-lib.mjs:391-401`). |
| `coordination:schedule` | `agentic-coordination-scheduler-report/v1` | Formal schema `docs/schemas/coordination-scheduler-report.v1.schema.json`; `schema, inputDigest, capacity, waves, ready, waiting, blocked, nonBlockingAttention, summary, mutation, reportDigest`. |
| `collaboration:gate` | `agentic-collaboration-gate-result/v2` | `scripts/collaboration-gate.mjs:120-155`. |
| `turn:end`, `runtime:local:status` | `agentic-local-runtime-readiness/v1` | Formal schema `docs/schemas/local-runtime-readiness.v1.schema.json`. Its JSON output **already redacts** `sessionId` and `ownershipTokenDigest` (`scripts/local-runtime.mjs:60-76`). |
| (registry file, not a script) | `agentic-writer-lease-registry/v2`, `agentic-writer-lease/v2` | `scripts/writer-lease-lib.mjs:22-23`; stored at `<git-common-dir>/agentic-canvas-os/writer-leases.json` (`writer-lease-lib.mjs:125-138`); branch grammar `DEVICE_BRANCH_PATTERN` at `writer-lease-lib.mjs:32-33`. |

Axis vocabularies:

- Stage axis authored source: `docs/START-WORKFLOW.md` frontmatter
  `stage_order: ["discover","fetch","inspect","claim","activate","verify","memory","planning","start"]`.
- Lane claim-state vocabulary: `scripts/workspace-parallelism-lib.mjs:14-24` -
  `current, waiting-successor, reviewed, integrated-preserved, dormant-preserved, retired`.

Deferred-increment sources, named for traceability only and not specified here:
integration DAG in `scripts/integration-order-contract.mjs:5-125`
(`agentic-integration-order-plan/v1`, `deriveIntegrationWaves`, `assertAcyclic`),
and cross-repository `dependencyEdges` in
`docs/schemas/cross-repository-coordination-task.v1.schema.json`.

State locations, all outside the repository working tree. The projector reads
them and never relocates them:

1. `<git-common-dir>/agentic-canvas-os/` - writer leases and journals.
2. `<workspaceRoot>/.runtime-state/agentic-canvas-os/` -
   `collaboration-gates/allocations.json`,
   `knowgrph-local-runtime/readiness.json`, `review-candidate.json`.
3. `<workspaceRoot>/.agentic-runtime/` - workflow claim, verify, task-authority,
   and write-scope-manifest JSON.

### No-hardcode enforcement: current state and gaps

| Fact | Evidence |
|---|---|
| `scripts/audit/path-portability-auditor.mjs` emits `agentic-game-os-path-portability-audit/v1` with `schema, status(passed|failed|incomplete), outcome, violations[], unscannedFiles[], summary`. It scopes `AUDITED_REPOSITORY_NAMES = ['agentic-canvas-os','knowgrph','GameXR']` (lines 8-12) and forbids POSIX absolute roots (44-45), Windows drive and UNC roots (46-49), account-name extraction from user-home path shapes (398-402), `USER|USERNAME|LOGNAME|account|account_name|os_account` assignments (409-419), unresolvable workspace-root variable references (line 50), and unrooted repository-relative references (51-52). | Read directly. |
| **Gap:** the path-portability auditor has no npm script. It is reachable only through the `npm test` glob by way of `__tests__/agentic-game-os-apple-vision-os-auditors.test.mjs`. | `package.json` contains no script invoking `scripts/audit/path-portability-auditor.mjs`. |
| `scripts/state-path-check.mjs` fails on the first **statically resolvable** write target outside the repository. `WRITE_CALL` list at line 10; `os.homedir()` resolved at line 63. Runtime-resolved targets are not flagged. | Read directly. |
| **Gap:** `scripts/state-path-check.mjs` has no npm script either. | `package.json`. |
| `npm run docs:check` runs `scripts/docs-contract.mjs`. `REQUIRED_AUTHORED_KEYS` are `title, graphId, doc_type, date, lang, schema, frontmatter_contract, status` (lines 23-32). `ARTIFACT_PATTERNS` (lines 33-43) forbid `https?://localhost[:/]`, `kg_media_token`, `data:image`, `VIDEO_DB_API_KEY`, `SENSENOVA_API_KEY`, `generation_job_id`, `index_job_id`, `upload-[0-9a-f]`, `airvio/runs`. Non-ASCII is forbidden outside `docs/workspace-seeds/`. Limits are 600 lines and 500000 bytes. | Read directly. |
| `npm run check` is `npm test && npm run web:build && npm run docs:check` - narrow relative to the audit surface above. | `package.json`. |
| `docs/DICTIONARY-COMMAND.md:12` declares `catalog_digest` and `catalog_entry_count: 415`, but nothing under `scripts/` or `__tests__/` computes or verifies that digest. SEMANTIC and BINDING declare no top-level digest. The producer is the cross-repository MCP tool `knowgrph.agentic_canvas_os.docs.invoke` (`docs/MCP-GATEWAY.md:118`). | Read directly. |
| 754 distinct `<name>/vN` schema identifiers exist in the repository; only 22 have formal JSON Schemas under `docs/schemas/`; Ajv is imported in only 9 files. | Repository survey. |

---

## Recorded Tensions

These are real and must be resolved by the requirements below, not assumed away.

### Tension 1 - Where the Projection_Document is written

`scripts/state-path-check.mjs` fails statically resolvable writes outside the
repository, which pushes generated output inward. `scripts/docs-contract.mjs`
governs everything under `docs/`, imposing authored-frontmatter keys, an ASCII
restriction, a 600-line cap, and a 500000-byte cap on anything written there.
Meanwhile all three orchestration state locations are deliberately outside the
working tree. The Projection_Document is runtime-generated, so committing it
into `docs/` would put a churning artifact under an authored-document contract.
Requirement 2 fixes the output location rule and Requirement 9 makes it
gate-clean either way.

**Resolved.** The output location is Projection_Output_Root,
`<Workspace_Root>/.runtime-state/agentic-canvas-os/orchestration-projection/`,
resolved at runtime and never authored as an absolute literal. This follows
established repository precedent: `scripts/local-runtime-lib.mjs:755-769`
`runtimeLocations(workspaceRoot)` joins `workspaceRoot` with
`.runtime-state/agentic-canvas-os/knowgrph-local-runtime` and derives every
state, log, and token path from it; `scripts/collaboration-gate-sandbox.mjs:31-38`
resolves `workspaceRoot` as the parent of the repository root, honours a single
env override, and otherwise falls back to
`.runtime-state/agentic-canvas-os/collaboration-gates`. Requirement 2 criteria
11 through 16 encode that resolution.

### Tension 2 - Storyboard lane grouping is first-key-wins over 11 keys

Storyboard resolves a card's lane from the first present key in
`GRAPH_KEYWORD_LANE_PROPERTY_KEYS`, where `status` precedes `stage` and `lane`.
If the projection emits an ACOS lane claim state under `status` and an ACOS
worktree lane identity under `lane`, grouping silently keys on the claim state.
Requirement 4 pins exactly one lane-determining key per card and forbids
emitting any other key from that list.

**Resolved.** The Lane_Grouping_Key is `lane`, and Lane_Claim_State is emitted
under Lane_Claim_State_Property `claimState`, which is not a member of
`GRAPH_KEYWORD_LANE_PROPERTY_KEYS`. `readLaneLabel`
(`storyboardModel.ts:339-343`) walks the ordered list and takes the first key
present and non-empty, skipping absent keys, so emitting only `lane` resolves
the lane from `lane`; `readLanePropertyKey` (`storyboardModel.ts:345-355`)
likewise reports `lane` rather than its `'stage'` fallback, and the
`STORYBOARD_EMPTY_LANE = 'Storyboard'` fallback label
(`storyboardModel.ts:44`) is never reached. Avoiding a second list key is not
only about grouping: `readGraphKeywordTermsFromProperties`
(`keywordTerms.ts:44-48`) splits every member of the 11-key list into keyword
terms, so a second key pollutes keyword statistics even where it loses the
grouping race. Within-lane ordering uses `order` for the numeric Stage_Axis
index and `step` for the human-readable stage label; `index` is forbidden
because it appears in both `ORDER_PROPERTY_KEYS` and `INDEX_PROPERTY_KEYS`
(`storyboardModel.ts:50-51`) and would serve two distinct roles at once.
Requirement 4 criteria 10 through 17 encode that resolution.

### Tension 3 - Dashboard's five metrics are graph-generic, not orchestration-specific

`buildDashboardCanvasModel` computes a fixed five-metric model (nodes, edges,
density, signals, grid) and cannot be extended without editing Knowgrph, which
this spec forbids. Requirement 6 therefore states the orchestration meaning
those five generic metrics carry once the Projection_Document graph is loaded,
rather than pretending a bespoke rollup is available.

### Tension 4 - `stage_order` lives in authored frontmatter, not in a code export

The stage axis vocabulary is authored in `docs/START-WORKFLOW.md` frontmatter.
Copying the nine literals into projector source would create a second source of
truth that drifts. Requirement 3 requires runtime derivation from the authored
document.

**Extended and resolved.** The same derive-do-not-duplicate rule governs the
staleness bound of Requirement 2 criterion 6. The bound is authored once as
`coordination.writer_lease_ttl_seconds: 1800` in `docs/START-WORKFLOW.md`
frontmatter and is already mirrored in code as
`DEFAULT_WRITER_LEASE_TTL_MS = 30 * 60 * 1000` (`scripts/writer-lease-lib.mjs:31`),
so a third copy inside projector source would be a third drift surface. The
projector derives the bound at runtime from the authored frontmatter value and
compares observation timestamps within the Receipt_Input_Set rather than against
wall-clock at emit time, keeping Requirement 10 criterion 6 intact.
Requirement 2 criteria 17 through 20 encode that resolution.

---

## Glossary

- **ACOS**: The `agentic-canvas-os` repository, the owner of every artifact this feature adds.
- **Knowgrph**: The `$GITHUB_ROOT/knowgrph` repository, the rendering consumer.
- **Orchestration_Projector**: The new repository-owned ACOS module set that reads the Receipt_Input_Set and emits one Projection_Document. Holds no orchestration authority and performs no Git mutation.
- **Projection_Document**: The single markdown-with-frontmatter artifact emitted by Orchestration_Projector, carrying one YAML frontmatter header and one markdown body.
- **Projection_Schema_Id**: The one versioned schema identifier declared in the Projection_Document frontmatter `schema` key.
- **Workspace_Root**: The directory resolved at runtime as the parent of the ACOS repository root, matching `scripts/collaboration-gate-sandbox.mjs:31-38` and the `workspaceRoot` argument of `runtimeLocations` at `scripts/local-runtime-lib.mjs:755-769`. Never an authored absolute literal.
- **Runtime_State_Root**: `<Workspace_Root>/.runtime-state/agentic-canvas-os/`, the existing sibling parent of `knowgrph-local-runtime` and `collaboration-gates`.
- **Projection_Output_Root**: The `orchestration-projection` directory beneath Runtime_State_Root, that is `<Workspace_Root>/.runtime-state/agentic-canvas-os/orchestration-projection/`, the directory the Projection_Document and the raw receipt projection are written to.
- **Projection_Output_Root_Override**: The single documented environment variable `AGENTIC_ORCHESTRATION_PROJECTION_STATE_ROOT`, which when set and non-empty replaces the derived Projection_Output_Root, matching the `AGENTIC_COLLABORATION_STATE_ROOT` precedent.
- **Receipt_Input_Set**: The set of already-emitted ACOS receipts consumed as input, each identified by its exact schema id: `agentic-worktree-lifecycle-report/v1`, `agentic-workspace-parallelism-report/v1`, `agentic-coordination-scheduler-report/v1`, `agentic-collaboration-gate-result/v2`, `agentic-local-runtime-readiness/v1`, `agentic-writer-lease-registry/v2`.
- **Receipt_Input_Record**: One member of the Receipt_Input_Set together with its resolved source location, observed schema id, and observation timestamp.
- **Typed_Failure_Reason**: A machine-readable enumerated reason emitted when an input is missing, stale, or malformed, or when the emitted output violates a declared budget. One of `input-absent`, `schema-id-mismatch`, `malformed-json`, `stale-observation`, `schema-validation-failed`, `budget-exceeded`.
- **Staleness_Bound_Source**: The authored `coordination.writer_lease_ttl_seconds` value in `docs/START-WORKFLOW.md` frontmatter, the single authored source of the staleness bound.
- **Staleness_Bound**: The maximum permitted age of a Receipt_Input_Record observation timestamp, derived at runtime from Staleness_Bound_Source and expressed in seconds.
- **Newest_Observation_Timestamp**: The most recent observation timestamp across the Receipt_Input_Set, used as the reference point for staleness comparison instead of wall-clock at emit time.
- **Formally_Schematized_Receipt_Set**: The Receipt_Input_Set members that have a formal JSON Schema under `docs/schemas/`: `agentic-coordination-scheduler-report/v1` (`coordination-scheduler-report.v1.schema.json`) and `agentic-local-runtime-readiness/v1` (`local-runtime-readiness.v1.schema.json`).
- **Structurally_Validated_Receipt_Set**: The Receipt_Input_Set members that have no formal JSON Schema under `docs/schemas/`: `agentic-worktree-lifecycle-report/v1`, `agentic-workspace-parallelism-report/v1`, `agentic-collaboration-gate-result/v2`, `agentic-writer-lease-registry/v2`.
- **Schema_Validator_Loader**: The established ACOS Ajv 2020 loading pattern using `ajv/dist/2020.js`, as implemented in `scripts/agentic-sdlc/schema-validation.mjs:38-52` and `scripts/agentic-sdlc/admission-schema-validation.mjs:9-16`.
- **Structural_Validation**: Validation of a Structurally_Validated_Receipt_Set member by exact schema-id match plus the presence and type of the fields this feature consumes, without a formal JSON Schema.
- **Stage_Axis_Source**: The authored `stage_order` sequence in `docs/START-WORKFLOW.md` frontmatter, the single source of truth for the stage axis.
- **Stage_Axis**: The ordered stage vocabulary derived at runtime from Stage_Axis_Source.
- **Lane_Axis**: The set of orchestration lanes derived from `agentic-worktree-lifecycle-report/v1` and `agentic-workspace-parallelism-report/v1`.
- **Lane_Claim_State**: A value from the vocabulary at `scripts/workspace-parallelism-lib.mjs:14-24`: `current`, `waiting-successor`, `reviewed`, `integrated-preserved`, `dormant-preserved`, `retired`.
- **Lane_Grouping_Key**: The single property key the Projection_Document sets on each card node to determine Storyboard lane grouping. Must be one member of `GRAPH_KEYWORD_LANE_PROPERTY_KEYS`. Resolved for this feature as `lane`.
- **Lane_Property_Key_List**: `GRAPH_KEYWORD_LANE_PROPERTY_KEYS` at `canvas/src/lib/graph/keywordTerms.ts:4`, the ordered 11-member list `['status','stage','column','lane','phase','track','swimlane','group','bucket','category','columnKey']`.
- **Lane_Claim_State_Property**: `claimState`, the card-node property name carrying Lane_Claim_State. Not a member of Lane_Property_Key_List.
- **Order_Property_Key_List**: `ORDER_PROPERTY_KEYS` at `storyboardModel.ts:50`, `['order','sort','sequence','sceneOrder','shotOrder','index','rank']`.
- **Index_Property_Key_List**: `INDEX_PROPERTY_KEYS` at `storyboardModel.ts:51`, `['frame','frameNumber','sceneNumber','shotNumber','panelNumber','number','index','step','stepNumber','sequenceNumber','position','ordinal']`.
- **Stage_Order_Property**: `order`, the card-node property carrying the zero-based Stage_Axis index. A member of Order_Property_Key_List and not of Index_Property_Key_List.
- **Stage_Label_Property**: `step`, the card-node property carrying the human-readable stage label. A member of Index_Property_Key_List and not of Order_Property_Key_List.
- **Storyboard_Surface**: Knowgrph's existing Storyboard renderer surface, unchanged by this feature.
- **MultiDim_Table_Surface**: Knowgrph's existing Multi-dimensional Table surface, unchanged by this feature.
- **Dashboard_Surface**: Knowgrph's existing Dashboard surface, unchanged by this feature.
- **Renderer_Neutrality_Test**: `canvas/src/__tests__/rendererPipelineNeutrality.test.ts`.
- **Import_Target_Set**: `WORKSPACE_URL_IMPORT_CANVAS_RENDERERS` = `['d3','design','storyboard']`, the only valid workspace import renderer targets.
- **Projection_Digest**: A content digest computed over the Projection_Document body and declared in its frontmatter, excluding the digest key itself.
- **Digest_Helper**: The existing exported helper `digestValue` at `scripts/cloud-collaboration-primitives.mjs:102-105`, a SHA-256 over `canonicalJson(value)` (`:99-101`) rendered as lowercase hex.
- **Digest_Pattern**: The repository-wide digest shape `^[0-9a-f]{64}$`, already declared as `DIGEST_PATTERN` in `scripts/writer-lease-lib.mjs`, `scripts/integration-order-contract.mjs`, and `scripts/workspace-parallelism-lib.mjs`.
- **Portability_Gate**: An npm-visible script that runs `scripts/audit/path-portability-auditor.mjs` and exits non-zero on `status: failed` or `status: incomplete`.
- **State_Path_Gate**: An npm-visible script that runs `scripts/state-path-check.mjs` and exits non-zero on any reported offender.
- **Redaction_Contract**: The existing redaction of `sessionId` and `ownershipTokenDigest` in `scripts/local-runtime.mjs:60-76`.
- **Runtime_Resolved_Value**: A value obtained at execution time from the environment, Git, the filesystem, or a Receipt_Input_Record, rather than written as a literal in authored source, fixtures, tests, or documentation.
- **Deferred_Increment_Set**: Flowchart or D3 integration DAG, GitGraph lane lineage, and Gantt lease and wave timeline. Named as future work; out of scope.
- **Min_Viable_Scope**: Requirements 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14. Requirement 6 is Increment 2, Requirement 7 is Increment 3.

---

## Requirements

### Requirement 1: Projection document contract

**User Story:** As an operator, I want one versioned projection document whose frontmatter is accepted by both repositories, so that orchestration state renders in Storyboard without manual configuration.

#### Acceptance Criteria

1. THE Orchestration_Projector SHALL emit exactly one Projection_Document per invocation.
2. THE Projection_Document SHALL declare one Projection_Schema_Id in its frontmatter `schema` key, matching the pattern `^[a-z0-9-]+/v[0-9]+$`.
3. THE Projection_Document frontmatter SHALL contain all eight keys required by `scripts/docs-contract.mjs` `REQUIRED_AUTHORED_KEYS`: `title`, `graphId`, `doc_type`, `date`, `lang`, `schema`, `frontmatter_contract`, `status`.
4. THE Projection_Document frontmatter SHALL contain `canvas2dRenderer: storyboard` so that `readCanvas2dRendererPreset` resolves the Storyboard renderer.
5. WHEN the Projection_Document frontmatter is parsed by `parseCanvasWorkspaceFrontmatterPreset`, THE parser SHALL return a preset whose `canvas2dRenderer` equals `storyboard`.
6. THE Projection_Document SHALL contain characters in the ASCII range only.
7. IF the Projection_Document would exceed 600 lines, THEN THE Orchestration_Projector SHALL fail with Typed_Failure_Reason `budget-exceeded` rather than emit a truncated document.
8. WHEN the Projection_Document is loaded through `loadGraphDataFromTextViaParser`, THE loader SHALL produce a graph containing at least one node for every lane present in the Lane_Axis.

**VCC:** An automated test parses a generated Projection_Document with the ACOS docs-contract frontmatter validator and with a fixture mirroring Knowgrph's preset parser, and both accept it. A second test asserts the emitted `schema` value matches the declared Projection_Schema_Id constant exactly once in the repository.

---

### Requirement 2: Input binding to already-emitted receipts

**User Story:** As a maintainer, I want the projector to consume only receipts ACOS already emits, so that no second source of orchestration truth is created.

#### Acceptance Criteria

1. THE Orchestration_Projector SHALL derive every projected value from a Receipt_Input_Record or from Stage_Axis_Source.
2. THE Orchestration_Projector SHALL identify each Receipt_Input_Record by its exact schema id string.
3. IF an input's observed `schema` value differs from the expected schema id, THEN THE Orchestration_Projector SHALL fail with Typed_Failure_Reason `schema-id-mismatch` and name the expected and observed values.
4. IF a required input is absent, THEN THE Orchestration_Projector SHALL fail with Typed_Failure_Reason `input-absent` and name the resolved location searched.
5. IF a required input is not parseable as JSON, THEN THE Orchestration_Projector SHALL fail with Typed_Failure_Reason `malformed-json`.
6. WHERE a Receipt_Input_Record carries an observation timestamp older than a configured staleness bound, THE Orchestration_Projector SHALL fail with Typed_Failure_Reason `stale-observation`.
7. WHERE a formal JSON Schema exists under `docs/schemas/` for a Receipt_Input_Record, THE Orchestration_Projector SHALL validate that record against it and fail with Typed_Failure_Reason `schema-validation-failed` on rejection.
8. THE Orchestration_Projector SHALL read the three external state locations without creating, moving, renaming, or deleting any path within them.
9. THE Orchestration_Projector SHALL write the Projection_Document to a location resolved at runtime, and SHALL NOT write it into `docs/`.
10. THE Orchestration_Projector SHALL perform zero model provider calls, zero paid API calls, and zero network egress.
11. THE Orchestration_Projector SHALL resolve Workspace_Root at runtime as the parent directory of the ACOS repository root.
12. THE Orchestration_Projector SHALL write the Projection_Document into Projection_Output_Root, a directory named `orchestration-projection` sibling to `knowgrph-local-runtime` and `collaboration-gates` beneath Runtime_State_Root.
13. WHERE Projection_Output_Root_Override is set to a non-empty value, THE Orchestration_Projector SHALL resolve Projection_Output_Root from that value instead of from Workspace_Root.
14. THE Orchestration_Projector SHALL construct the Projection_Document output path by joining a workspace-root variable with fixed relative path segments, and SHALL NOT contain any authored absolute path literal for that output path.
15. THE Orchestration_Projector SHALL write no file inside the ACOS repository working tree.
16. THE Orchestration_Projector SHALL create Projection_Output_Root when that directory is absent, and SHALL leave every path under the three external state locations unmodified.
17. THE Orchestration_Projector SHALL derive Staleness_Bound at runtime by reading `coordination.writer_lease_ttl_seconds` from Staleness_Bound_Source.
18. THE Orchestration_Projector source SHALL NOT contain the Staleness_Bound value as an authored numeric literal in any form, including a seconds value, a milliseconds value, or a product of factors equal to either.
19. WHEN evaluating criterion 6, THE Orchestration_Projector SHALL compare each Receipt_Input_Record observation timestamp against Newest_Observation_Timestamp rather than against wall-clock time read at emit time.
20. WHEN the authored `coordination.writer_lease_ttl_seconds` value changes, THE Orchestration_Projector SHALL apply the changed Staleness_Bound on its next invocation without source modification.
21. WHERE a Receipt_Input_Record is a member of Formally_Schematized_Receipt_Set, THE Orchestration_Projector SHALL validate that record against its `docs/schemas/` JSON Schema using Schema_Validator_Loader.
22. WHERE a Receipt_Input_Record is a member of Structurally_Validated_Receipt_Set, THE Orchestration_Projector SHALL apply Structural_Validation to that record and SHALL fail with Typed_Failure_Reason `schema-validation-failed` on rejection.
23. THE Orchestration_Projector SHALL NOT add a formal JSON Schema under `docs/schemas/` for any Receipt_Input_Set member.

**VCC:** A test suite drives the projector with fixture receipt sets covering each Typed_Failure_Reason and asserts the exact reason string. A separate test asserts the projector module set imports no HTTP, fetch, or provider-client module. A test asserts the projector's write target resolves outside `docs/`. A test asserts the resolved output path equals Workspace_Root joined with `.runtime-state/agentic-canvas-os/orchestration-projection`, asserts the documented override redirects it, and asserts the path lies outside the repository working tree. A test mutates a fixture `coordination.writer_lease_ttl_seconds` and asserts the effective Staleness_Bound changes with no source edit, while a source scan asserts no authored literal equals the authored TTL in seconds or milliseconds. A test asserts the two Formally_Schematized_Receipt_Set members are rejected by the Ajv-backed validator when a required field is removed, and that each Structurally_Validated_Receipt_Set member fails with `schema-validation-failed` when its schema id mismatches or a consumed field is absent or of the wrong type. A repository-diff test asserts this feature adds no file under `docs/schemas/`.

---

### Requirement 3: Stage axis derived from the authored source

**User Story:** As a maintainer, I want the stage axis read from its authored owner, so that the vocabulary cannot drift into a duplicated literal.

#### Acceptance Criteria

1. THE Orchestration_Projector SHALL derive the Stage_Axis at runtime by reading `stage_order` from the `docs/START-WORKFLOW.md` frontmatter.
2. THE Orchestration_Projector SHALL preserve the authored order of Stage_Axis_Source entries in the Stage_Axis.
3. THE Orchestration_Projector source SHALL NOT contain any Stage_Axis_Source member as an authored string literal.
4. IF `stage_order` is absent or empty in Stage_Axis_Source, THEN THE Orchestration_Projector SHALL fail with Typed_Failure_Reason `input-absent`.
5. WHEN a Stage_Axis_Source entry is added, removed, or reordered, THE Orchestration_Projector SHALL reflect that change on its next invocation without source modification.

**VCC:** A test asserts that no file under the projector module set contains any of the nine stage literals. A second test mutates a fixture `stage_order` and asserts the emitted Stage_Axis changes correspondingly.

---

### Requirement 4: Lanes by stages Storyboard projection

**User Story:** As an operator, I want lanes as swimlanes and stages as ordered positions, so that I can see at a glance which lane is at which stage and in what claim state.

#### Acceptance Criteria

1. THE Orchestration_Projector SHALL derive the Lane_Axis from `agentic-worktree-lifecycle-report/v1` and `agentic-workspace-parallelism-report/v1`.
2. THE Projection_Document SHALL emit one card node per lane-and-stage pair present in the projected state.
3. THE Projection_Document SHALL set exactly one Lane_Grouping_Key on each card node, and SHALL NOT set any other member of `GRAPH_KEYWORD_LANE_PROPERTY_KEYS` on that node.
4. WHEN the Projection_Document is loaded and passed to `buildStoryboardBoardModel`, THE resulting board model SHALL contain one lane per Lane_Axis member and SHALL contain no lane labelled `Storyboard`.
5. THE Projection_Document SHALL set each card node's within-lane ordering property to that card's zero-based index in the Stage_Axis.
6. WHEN two cards share a lane, THE resulting board model SHALL order them by ascending Stage_Axis index.
7. THE Projection_Document SHALL record each lane's Lane_Claim_State as a value drawn from the claim-state vocabulary.
8. IF a lane's observed claim state is absent from the claim-state vocabulary, THEN THE Orchestration_Projector SHALL fail with Typed_Failure_Reason `schema-validation-failed` and name the unrecognized value.
9. THE Orchestration_Projector SHALL represent lane identity using Runtime_Resolved_Value data only, and SHALL NOT emit a machine path, an account name, or a session id as lane identity.
10. THE Projection_Document SHALL set `lane` as the Lane_Grouping_Key on every card node.
11. THE intersection of each card node's property-key set with Lane_Property_Key_List SHALL have cardinality exactly 1 and SHALL equal the single-member set containing `lane`.
12. THE Projection_Document SHALL carry each lane's Lane_Claim_State under Lane_Claim_State_Property, whose name is absent from Lane_Property_Key_List.
13. THE Projection_Document SHALL set Stage_Order_Property `order` on each card node to that card's zero-based index in the Stage_Axis.
14. THE Projection_Document SHALL set Stage_Label_Property `step` on each card node to that card's Stage_Axis member name.
15. THE Projection_Document SHALL NOT set a property named `index` on any card node.
16. THE Projection_Document SHALL draw Stage_Order_Property from the set difference of Order_Property_Key_List minus Index_Property_Key_List, and SHALL draw Stage_Label_Property from the set difference of Index_Property_Key_List minus Order_Property_Key_List.
17. WHEN the Projection_Document is loaded and passed to `buildStoryboardBoardModel`, THE reported lane property key SHALL be `lane` rather than the `'stage'` fallback.

**VCC:** A test loads a generated Projection_Document through a fixture of Knowgrph's graph loader and Storyboard model, then asserts lane count, absence of the fallback lane, and ascending stage order within every lane. A second test asserts each card node carries exactly one lane-grouping key. A third test asserts the intersection of every card node's property keys with the Lane_Property_Key_List literal read from Knowgrph equals `{lane}`, asserts no card node carries `index`, and asserts Lane_Claim_State_Property is absent from that list. A fourth test asserts Stage_Order_Property and Stage_Label_Property fall in the two disjoint set differences of Order_Property_Key_List and Index_Property_Key_List, and asserts the board model's reported lane property key is `lane`.

---

### Requirement 5: Operator ingestion through existing surfaces

**User Story:** As an operator, I want to open the projection in Knowgrph through an existing import path, so that no Knowgrph change is needed to view it.

#### Acceptance Criteria

1. THE Projection_Document SHALL be importable through the existing workspace import paths whose renderer target is a member of Import_Target_Set.
2. THE Projection_Document frontmatter `canvas2dRenderer` value SHALL be a member of Import_Target_Set.
3. THE Orchestration_Projector SHALL emit the Projection_Document as a single self-contained file requiring no sibling asset to render.
4. THE Projection_Document SHALL NOT reference any `localhost` URL, `data:image` payload, or credential-shaped token.
5. WHERE an operator opens the Projection_Document without setting any renderer control, THE resolved renderer SHALL be Storyboard.

**VCC:** A test asserts the emitted `canvas2dRenderer` value is a member of the Import_Target_Set literal read from Knowgrph's preset module, and asserts the document text matches none of the `ARTIFACT_PATTERNS` in `scripts/docs-contract.mjs`.

---

### Requirement 6: Raw receipt drill-down through Multi-dimensional Table

**User Story:** As an operator, I want to inspect the underlying receipt records as rows, so that I can drill from a lane card down to the evidence.

*Increment 2. Not part of Min_Viable_Scope.*

#### Acceptance Criteria

1. THE Orchestration_Projector SHALL emit a raw receipt projection as JSON text consumable through `MultiDim_Table_Surface`'s existing `source.jsonSourceDocumentText` path.
2. THE raw receipt projection SHALL contain one record per Receipt_Input_Record, each carrying its schema id and its observation timestamp.
3. THE raw receipt projection SHALL preserve every field value from its source receipt without renaming, and SHALL NOT introduce a derived field absent from the Receipt_Input_Set.
4. WHEN the raw receipt projection is parsed as JSON, THE parser SHALL succeed without error.
5. THE Orchestration_Projector SHALL NOT require any change to `MultiDimTableSurface.tsx` or to `useCanvasWorkspaceDataViewSource`.

**VCC:** A test parses the emitted raw receipt projection as JSON, asserts one record per input schema id, and asserts field-name equality against the source fixtures.

---

### Requirement 7: Dashboard rollup semantics

**User Story:** As an operator, I want the Dashboard rollup to be interpretable, so that I know what each generic metric means for orchestration state.

*Increment 3. Not part of Min_Viable_Scope.*

#### Acceptance Criteria

1. THE Projection_Document SHALL be renderable by `Dashboard_Surface` through `buildDashboardCanvasModel` without any Knowgrph modification.
2. THE Orchestration_Projector documentation SHALL state the orchestration meaning of each of the five fixed Dashboard metrics: nodes, edges, density, signals, grid.
3. WHERE a fixed Dashboard metric carries no orchestration meaning, THE Orchestration_Projector documentation SHALL record that metric as generic rather than assign it an invented meaning.
4. WHEN the Projection_Document graph node count changes, THE Dashboard `nodes` metric SHALL change correspondingly.
5. THE Orchestration_Projector SHALL NOT add, rename, or remove any Dashboard metric.

**VCC:** A test builds the Dashboard model from a generated Projection_Document and asserts the `nodes` metric equals the projected node count. A documentation check asserts all five metric names appear in the projector's authored contract section with either an orchestration meaning or an explicit generic marking.

---

### Requirement 8: No-hardcode validation with npm-visible gates

**User Story:** As a maintainer, I want portability and state-path auditing to be discoverable and to cover the projector output, so that hardcoding is caught rather than merely discouraged.

#### Acceptance Criteria

1. THE ACOS `package.json` SHALL declare a Portability_Gate script that invokes `scripts/audit/path-portability-auditor.mjs`.
2. THE ACOS `package.json` SHALL declare a State_Path_Gate script that invokes `scripts/state-path-check.mjs`.
3. WHEN the Portability_Gate runs and the audit `status` is `failed` or `incomplete`, THE Portability_Gate SHALL exit non-zero.
4. WHEN the State_Path_Gate runs and any offender is reported, THE State_Path_Gate SHALL exit non-zero.
5. THE ACOS `package.json` SHALL include the Portability_Gate and the State_Path_Gate in the aggregate `check` script.
6. THE Orchestration_Projector source, tests, fixtures, and emitted Projection_Document SHALL each pass the Portability_Gate.
7. THE Orchestration_Projector SHALL resolve every machine path, account name, port, session id, token, digest, revision, provider identity, and count as a Runtime_Resolved_Value.
8. THE Orchestration_Projector source, tests, and fixtures SHALL NOT contain a POSIX absolute root path, a Windows drive or UNC root path, a user-home path shape carrying an account name, or an assignment to `USER`, `USERNAME`, `LOGNAME`, `account`, `account_name`, or `os_account`.
9. THE Orchestration_Projector SHALL resolve workspace-relative locations from a workspace-root variable rather than from an authored absolute literal.

**VCC:** Running the two new npm scripts on a clean checkout exits zero. Injecting a hardcoded absolute path into a projector fixture makes the Portability_Gate exit non-zero. The `check` script transitively invokes both gates.

---

### Requirement 9: Secret redaction preserved

**User Story:** As a maintainer, I want existing redaction preserved end to end, so that the projection cannot leak what the receipt already hid.

#### Acceptance Criteria

1. THE Orchestration_Projector SHALL treat the redacted form produced by the Redaction_Contract as the only available value for `sessionId` and `ownershipTokenDigest`.
2. THE Projection_Document SHALL NOT contain an unredacted `sessionId` value or an unredacted `ownershipTokenDigest` value.
3. THE raw receipt projection SHALL NOT contain an unredacted `sessionId` value or an unredacted `ownershipTokenDigest` value.
4. THE Orchestration_Projector SHALL NOT read a session id or ownership token from any source other than a Receipt_Input_Record.
5. IF a Receipt_Input_Record presents a value in a field that the Redaction_Contract declares redacted and that value is not in redacted form, THEN THE Orchestration_Projector SHALL fail with Typed_Failure_Reason `schema-validation-failed`.

**VCC:** A test feeds a fixture receipt carrying an unredacted session id and asserts the projector fails with the typed reason. A second test asserts neither emitted artifact contains the unredacted fixture value.

---

### Requirement 10: Determinism, idempotence, and content digest

**User Story:** As a maintainer, I want byte-identical output for identical input, so that the projection is diffable and verifiable.

#### Acceptance Criteria

1. WHEN the Orchestration_Projector runs twice over an identical Receipt_Input_Set and an identical Stage_Axis_Source, THE two Projection_Documents SHALL be byte-identical.
2. THE Projection_Document SHALL declare a Projection_Digest in its frontmatter.
3. THE Projection_Digest SHALL be computed over the Projection_Document content excluding the digest key's own value.
4. WHEN any Receipt_Input_Record value changes, THE Projection_Digest SHALL change.
5. THE Orchestration_Projector SHALL order every emitted collection by a stable, value-derived key rather than by filesystem enumeration order.
6. THE Orchestration_Projector SHALL derive every timestamp it emits from a Receipt_Input_Record observation timestamp rather than from wall-clock read at emit time.
7. THE Projection_Digest SHALL be a lowercase hexadecimal SHA-256 value matching Digest_Pattern `^[0-9a-f]{64}$`.
8. THE Orchestration_Projector SHALL compute the Projection_Digest by calling Digest_Helper `digestValue` over a canonical value that excludes the digest key's own value.
9. THE Orchestration_Projector SHALL NOT define a digest, hash, or canonical-serialization helper of its own.
10. WHEN the Projection_Digest is recomputed from the emitted Projection_Document using Digest_Helper over the same canonical value, THE recomputed value SHALL equal the value declared in the frontmatter.

**VCC:** A property-based test over generated receipt sets asserts repeated invocation yields byte-identical output and that any single-field mutation changes the Projection_Digest. A test asserts recomputing the digest from the emitted document reproduces the declared value. A test asserts the declared digest matches Digest_Pattern. An import-graph test asserts the projector imports `digestValue` from `scripts/cloud-collaboration-primitives.mjs` and declares no `createHash` call or canonical-serialization function of its own.

---

### Requirement 11: File and module budgets

**User Story:** As a maintainer, I want the projector to stay small and single-purpose, so that it does not become another oversized module.

#### Acceptance Criteria

1. THE Orchestration_Projector SHALL comprise modules each under 600 lines.
2. Each Orchestration_Projector module SHALL have one stated responsibility recorded in a header comment.
3. THE Orchestration_Projector SHALL reuse existing ACOS shared helpers for Git resolution, workspace-root resolution, JSON reading, and schema validation rather than reimplement them.
4. THE Orchestration_Projector SHALL NOT duplicate logic across its modules.
5. THE Orchestration_Projector SHALL NOT modify any existing ACOS receipt emitter.

**VCC:** A budget test enumerates the projector module set and asserts every file is under 600 lines and carries a responsibility header. An import-graph test asserts shared-helper reuse and asserts no receipt-emitter script is modified by this feature's diff.

---

### Requirement 12: Knowgrph containment and the two named defect fixes

**User Story:** As a maintainer, I want Knowgrph left alone except for two confirmed defects, so that renderer neutrality is preserved and root-owned bugs still get fixed.

#### Acceptance Criteria

1. THE Knowgrph change set for this feature SHALL be limited to Defect A and Defect B.
2. THE Knowgrph renderer registry SHALL continue to declare exactly the 12 renderer ids present before this feature.
3. WHEN Renderer_Neutrality_Test runs after this feature's Knowgrph change set, THE test SHALL pass.
4. THE `CANVAS_VIEW_RENDERER_ANIMATIC_TITLE` value SHALL name the Animatic renderer and SHALL differ from `CANVAS_VIEW_RENDERER_GANTT_TITLE`.
5. THE renderer toggle tooltip SHALL name every renderer offered by the toggle, including Gallery, Media, and Animatic.
6. THE orphan module `canvas/src/components/StoryboardCanvas.tsx` SHALL be removed, and every live Storyboard import SHALL continue to resolve.
7. WHEN the Knowgrph build and test suite runs after Defect B's removal, THE build SHALL succeed with no unresolved import.
8. THE Knowgrph change set SHALL NOT introduce any reference to an ACOS schema identifier.

**VCC:** A guard test asserts renderer-title uniqueness across all 12 title constants and asserts the toggle tooltip names each toggle-offered renderer. The Knowgrph build passes and Renderer_Neutrality_Test passes. A repository search confirms no ACOS schema id appears in Knowgrph source.

---

### Requirement 13: Deploy boundary

**User Story:** As an operator, I want this feature confined to Dev, so that it carries no release or deployment authority.

#### Acceptance Criteria

1. THE Orchestration_Projector SHALL operate against Dev state only.
2. THE Orchestration_Projector SHALL NOT write to a Prod mirror location.
3. THE Orchestration_Projector SHALL NOT invoke any Cloudflare interface, deployment command, or release controller.
4. THE Orchestration_Projector SHALL NOT perform any Git mutation, including commit, push, branch creation, worktree creation, stash, or cleanup.
5. THE feature's authored artifacts SHALL declare `publish_policy` as Dev-only with no Prod mirror or Cloudflare authority.

**VCC:** A test asserts the projector module set imports no Cloudflare, Wrangler, or release-controller module and invokes no Git write subcommand. A documentation check asserts the Dev-only publish policy declaration.

---

### Requirement 14: Deferred increments held out of scope

**User Story:** As a maintainer, I want the deferred visualizations named but excluded, so that scope stays minimum-viable and traceable.

#### Acceptance Criteria

1. THE Orchestration_Projector SHALL NOT emit a Flowchart, D3 integration DAG, GitGraph lineage, or Gantt timeline projection.
2. THE feature's authored artifacts SHALL name each Deferred_Increment_Set member together with its identified future source.
3. THE Orchestration_Projector SHALL NOT read `agentic-integration-order-plan/v1` or cross-repository `dependencyEdges` data.
4. WHERE a deferred increment is later implemented, THE Projection_Schema_Id SHALL be revised rather than extended in place.
5. THE feature's authored artifacts SHALL record as an explicit non-goal that formal JSON Schemas for the four Structurally_Validated_Receipt_Set members are deferred to the owners of the emitters that produce those receipts.
6. THE Orchestration_Projector SHALL rely on the conditional form of Requirement 2 criterion 7 and SHALL treat the absence of a formal JSON Schema for a Structurally_Validated_Receipt_Set member as satisfied by Structural_Validation.

**VCC:** A test asserts the projector reads only the six Receipt_Input_Set schema ids and none of the deferred sources. A documentation check asserts all three deferred increments are named with their sources. A documentation check asserts the four Structurally_Validated_Receipt_Set schema ids appear in the authored non-goal statement together with the deferral to their emitters' owners.

---

## Requirement-to-Increment Map

| Increment | Requirements |
|---|---|
| 1 - Projector plus Storyboard (Min_Viable_Scope) | 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14 |
| 2 - Multi-dimensional Table drill-down | 6 |
| 3 - Dashboard rollup | 7 |
| Deferred - out of scope | none; excluded by 14 |
