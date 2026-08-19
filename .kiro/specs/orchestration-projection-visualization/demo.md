---
title: "Orchestration Projection Visualization To-Be Demo"
graphId: "md:orchestration-projection-visualization-demo"
doc_type: "Feature Demo Walkthrough"
date: "2026-08-19"
lang: "en-US"
schema: "agentic-orchestration-projection-visualization-demo/v1"
frontmatter_contract: "required"
status: "spec-complete"
publish_policy: "Dev-only; no Prod mirror or Cloudflare authority"
---

# To-Be Demo: Orchestration Projection Visualization

## What this document is, and is not

This is a **to-be** walkthrough. It shows the target operator experience and
traces how this spec bridges the as-is codebase toward it.

Two labels are used throughout and never mixed:

- **[AS-IS, CAPTURED]** marks output actually executed and observed on
  2026-08-19 against the revisions named below. Reproducible now.
- **[TO-BE, TARGET]** marks the intended shape once the bridge is complete.
  Illustrative. Not evidence.

This document makes **no production readiness claim**. Requirement 13 confines
the feature to Dev only, with no Prod mirror, no Cloudflare, and no deployment
authority. Per `CANONICAL-LIFECYCLE.md`, only an
`agentic-device-integration-result/v1` with status `runtime_ready` proves
completion, and no local command, turn, user, or agent may synthesise a Human
Authorization Receipt. Nothing here substitutes for that.

Baseline revisions: Agentic Canvas OS `eeff7997d271960f2fbc3a709adeee07cf2e839a`,
Knowgrph `57296e28aec0cfe7350ab311061fb79e900d5ee3`. Both clean at fetched
`origin/main`. All paths are repository-relative or rooted at `$GITHUB_ROOT`.

---

## The problem this closes

ACOS already knows its own orchestration state. Six repository-owned emitters
produce typed `--json` receipts covering lane lifecycle, workspace parallelism,
coordination waves, collaboration gates, local runtime readiness, and writer
leases.

Nothing assembles them into something an operator can look at. The state is
real, typed, and invisible.

Knowgrph already has twelve 2D renderer surfaces, three of which are generic
enough to render orchestration state with no renderer change at all. The gap is
not a missing view. It is a missing projection.

---

## As-is baseline

### What already works [AS-IS, CAPTURED]

Six projector modules plus a gate runner exist, every file far under the
600-line budget of Requirement 11.1, each carrying the one-line responsibility
header Requirement 11.2 asks for.

```
129  scripts/orchestration-projection-contract.mjs
 99  scripts/orchestration-projection-controller.mjs
 75  scripts/orchestration-projection-repository-adapter.mjs
 70  scripts/orchestration-projection-document.mjs
 38  scripts/orchestration-projection-evidence.mjs
 36  scripts/orchestration-projection.mjs
 67  scripts/audit/path-portability-gate.mjs
```

The contract module declares the projection identity once:

```
// Responsibility: Own orchestration projection schema identifiers, failure
// reasons, receipt descriptors, and structural validation.
export const PROJECTION_SCHEMA_ID = "agentic-orchestration-projection/v1";
```

**Both Requirement 8 gates are green.** This is the more interesting half,
because neither passed before this work.

```
$ npm run paths:state:check
                                        exit 0
```

That gate exited 1 on a clean checkout until the discard-sink predicate landed.
The offender was `.githooks/git-guarded:22`, target `/dev/null`, coming from the
stderr discard in `command -v -a git 2>/dev/null`. The classifier now treats
character-device discard sinks as non-repository targets, and the hook wrapper
guarding destructive operations was left untouched.

```
$ npm run paths:portability:check
{"schema":"agentic-game-os-path-portability-audit/v1","status":"passed",
 "outcome":"portable","violations":[],"unscannedFiles":[],
 "summary":{"scannedFileCount":12,"violationCount":0,"unscannedFileCount":0},
 "omittedFileCount":1033}
                                        exit 0
```

The `omittedFileCount` is the honest part. A repository-wide audit returns
`status: incomplete` with 1,558 violations across 4,865 unscannable files, and
Requirement 8.3 makes `incomplete` exit non-zero while 8.5 puts the gate in
`check`. Auditing everything would break `npm run check` on a clean checkout for
pre-existing reasons owned by others. The gate is therefore scoped to this
feature's Gate_Scope per Requirement 8.6: it prevents this feature adding a
violation, and it does not pretend to have fixed the backlog.

Feature suite, twelve tests:

```
$ node --test __tests__/orchestration-projection-*.test.mjs
# pass 12
# fail 0
```

Both Knowgrph defects are fixed, and the change set stayed at exactly two files.
`CANVAS_VIEW_RENDERER_ANIMATIC_TITLE` now reads `2D Renderer: Animatic` instead
of duplicating the Gantt string, the toggle tooltip names all twelve renderers
including the previously omitted Gallery, Media, and Animatic, and the orphan
`canvas/src/components/StoryboardCanvas.tsx` is gone.

The npm surface is wired, including `check`:

```
"orchestration:projection", "orchestration:projection:check",
"paths:portability:check", "paths:state:check"
```

### What does not work yet [AS-IS, CAPTURED]

The projector runs and fails closed. Correctly, but it has never produced a
document:

```
$ npm run orchestration:projection
{"schema":"agentic-orchestration-projection-receipt/v1","status":"failed",
 "reason":"input-absent","detail":{"location":"<Workspace_Root>"},
 "projectionSchema":null,"projectionDigest":null,"observedAt":null,
 "laneCount":0,"cardCount":0,"lineCount":0}
```

Two things are worth reading carefully here. The failure is a typed value, not
an exception, and the location is rendered against the literal
`<Workspace_Root>` token rather than a machine path, which is what keeps
Requirements 8.7 and 8.8 intact on the failure path. That is the design working.

But `reason: input-absent` means the four stdout-emitted receipts have not been
captured, so **no Projection_Document has ever existed**. There is no
end-to-end runtime evidence.

Property coverage is also thin against the design's own bar. Design.md defines
fourteen correctness properties for Increment 1; two are tagged and `fast-check`
appears in one of four test files.

| As-is fact | Evidence |
|---|---|
| Gates green, 12 tests pass | Captured above |
| Both Knowgrph defects fixed | Two-file diff verified |
| No document ever emitted | `input-absent` above |
| 2 of 14 properties tagged | Test-file scan |
| Increment 2 module absent | Expected; outside Increment 1 |

---

## To-be target state

One command turns six typed receipts into one document. The operator opens that
document in Knowgrph and sees every lane against every startup stage, with claim
state on each card. No renderer mode was added to get there.

The registry still declares exactly twelve renderers, because the projection is
a file, not a feature. That is the whole architectural bet.

### The projection contract [TO-BE, TARGET]

```
$GITHUB_ROOT/.runtime-state/agentic-canvas-os/orchestration-projection/
  orchestration-projection.md      <- the Projection_Document
  receipts/                        <- captured stdout receipts
```

Outside the working tree, alongside the existing `knowgrph-local-runtime` and
`collaboration-gates` siblings, resolved at runtime from Workspace_Root with a
single documented override. Never an authored absolute literal.

### The demo, five steps [TO-BE, TARGET]

**Step 1 - capture the four stdout receipts.** Two of the six inputs are files
read in place: readiness and the writer-lease registry. The other four are
stdout emissions with no canonical file, so capture is an explicit operator
step.

The projector deliberately does not run the emitters. `collaboration:gate`
allocates ports and spawns two runtimes; `coordination:schedule` carries a
`mutation` field. Handing a read-only projector a subprocess surface would
destroy determinism and grant an execution capability no requirement asks for.

```
npm run worktree:lifecycle:check    -- --json > <receipts>/worktree-lifecycle.json
npm run workspace:parallelism:check -- --json > <receipts>/workspace-parallelism.json
npm run coordination:schedule       -- --json > <receipts>/coordination-scheduler.json
npm run collaboration:gate          -- --json > <receipts>/collaboration-gate.json
```

**Step 2 - project.**

```
$ npm run orchestration:projection
{"schema":"agentic-orchestration-projection-receipt/v1","status":"emitted",
 "reason":null,"detail":null,
 "projectionSchema":"agentic-orchestration-projection/v1",
 "projectionDigest":"<64-hex>","observedAt":"<newest-input-timestamp>",
 "laneCount":<n>,"cardCount":<m>,"lineCount":<k>}
```

Digest and timestamps are shown as placeholders on purpose. Inventing
hex that looks real would be exactly the synthesised evidence the ACOS
contract forbids.

Note what `observedAt` is: the newest observation timestamp across the inputs,
never wall-clock at emit time. That is what makes the run deterministic, and it
is why re-running over unchanged receipts yields byte-identical output.

**Step 3 - read the emitted document.** Frontmatter carries the eight required
authored keys plus `canvas2dRenderer: storyboard`, so Knowgrph resolves the
Storyboard renderer with no operator control touched. Each card node looks like:

```
id: "<repository>::<scope>::<order>"
label: "<stage name>"
type: "OrchestrationStage"
properties:
  lane:       "<repository>::<scope>"
  claimState: "<one of six claim states>"
  order:      <zero-based stage index>
  step:       "<stage name>"
```

Four property names, each load-bearing:

`lane` is the **only** member of the eleven-key lane list present. Storyboard
resolves lanes first-key-wins over
`['status','stage','column','lane','phase',...]`, so emitting a claim state
under `status` would silently swimlane by claim state instead of by lane. Claim
state therefore lives on `claimState`, outside that list entirely - not merely
to lose the grouping race, but because `readGraphKeywordTermsFromProperties`
folds every list member into keyword statistics.

`order` and `step` come from disjoint key lists. `index` is absent deliberately:
it appears in both the order list and the index list, so one value would serve
two roles.

There is also no `category` field on the record, because the frontmatter flow
reader copies `category` into `properties.category`, and `category` is the tenth
member of the lane list. That would lift the cardinality invariant from one to
two without the projector ever writing the property.

**Step 4 - open it in Knowgrph.** Import through any existing workspace import
path. Storyboard renders lanes as swimlanes and stages as ordered positions.
Switch to Multi-dimensional Table for raw receipt rows once Increment 2 lands,
or Dashboard for the five-metric rollup in Increment 3. Zero Knowgrph
modification in all three cases.

**Step 5 - verify rather than trust.** The document body carries a single-line
fenced JSON block holding its own canonical value with the digest key absent.
Re-read it, recompute with the existing `digestValue` helper, and the declared
digest reproduces. No YAML round-trip required, no bespoke hash function
introduced.

### What the operator can see that they could not before [TO-BE, TARGET]

Which lanes exist, how far each has progressed through the nine authored startup
stages, what claim state each holds, whether coordination waves are ready or
blocked, and whether the collaboration gate and local runtime agree - in one
picture, from six receipts that were already being produced and discarded.

---

## The bridge

Three increments. Increment 1 is shippable alone.

| Increment | Requirements | Moves as-is toward to-be by |
|---|---|---|
| 1 | 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14 | Projector emits the Storyboard projection; both no-hardcode gates become npm-visible and green; two Knowgrph defects fixed |
| 2 | 6 | Raw receipt rows in Multi-dimensional Table, via its existing JSON source path |
| 3 | 7 | Dashboard metric semantics documented against the fixed five-metric model |

### Design choices the bridge rests on

**Derive, never duplicate.** The nine stage names live once, in
`docs/START-WORKFLOW.md` frontmatter `stage_order`. The staleness bound lives
once, as `coordination.writer_lease_ttl_seconds: 1800` in the same frontmatter.
Both are read at runtime. Copying either into projector source would create a
drift surface, and in the TTL's case a third one, since
`writer-lease-lib.mjs:31` already mirrors it.

That constraint has a real cost, recorded rather than hidden. Requirement 3.3
forbids stage-name literals in source while 3.5 requires axis edits to take
effect with no source change, which rules out per-stage predicates. Lane
progress is therefore an ordered list of evidence-named predicates, one per
receipt, and the mapping to stages is positional. Insert a stage mid-list and
labels shift by one relative to the evidence that produced them. The semantic
alternative needs the literals and is forbidden.

**Reuse, never reinvent.** `digestValue` for digests, the established Ajv 2020
loader for the two formally schematized receipts, `collectTrackedAuthoredFiles`
for the gate inventory, the existing `::` lane-key separator. The feature adds
no digest helper, no canonical serializer, and no file under `docs/schemas/`.

**One IO owner.** The repository adapter alone touches the filesystem. Contract,
controller, and document are pure value-to-value transforms, which is what lets
all sixteen correctness properties run with zero filesystem access.

### Honest gaps in the reasoning

Three of the six receipts carry no observation timestamp at all. The coordination
scheduler report sets `additionalProperties: false` and declares none; the
worktree lifecycle report and collaboration gate result declare none either.
Requirement 2.6 is a `WHERE` clause conditioned on a timestamp being present, so
those three are exempt by the criterion's own guard rather than by an invented
exception, and Requirement 2.23 blocks adding a schema to change that. Staleness
is enforced on the three that do carry one.

The Increment 2 artifact will contain machine paths. `agentic-collaboration-gate-result/v2`
carries `knowgrphRoot`, `artifactRoot`, and `ports`, and Requirement 6.3 forbids
renaming or dropping source fields. Those values flow through into the raw
receipt projection unchanged. That artifact is generated runtime state outside
the working tree and outside the Gate_Scope, so no criterion is violated, but it
is recorded here so nobody reads it later as an oversight. Requirement 9
redaction still applies in full to both artifacts.

---

## Delta to reach the to-be demo

Ordered by what unblocks the most.

| Gap | Why it matters | Tasks |
|---|---|---|
| Four receipts never captured, so nothing has emitted | Blocks every to-be step; the demo cannot be run at all | Step 1 above; then task 10.4 |
| 12 of 14 Increment 1 properties untagged | Determinism, digest round-trip, and the lane cardinality invariant are the guarantees this design rests on, and they are currently unproven | 5.3, 5.4, 6.3, 6.4, 8.3-8.7, 9.5, 9.6, 10.5, 12.2, 12.3 |
| Knowgrph boundary fixtures absent | Nothing yet proves the emitted document actually groups into lanes correctly in Storyboard | 12.1-12.4 |
| Static and diff checks absent | Only automated coverage for the no-literal rules (2.14, 2.18, 3.3, 10.9) | 13.1-13.4 |
| Increment 2 and 3 modules absent | Table drill-down and Dashboard semantics | 16, 17 |

Until the first two rows close, the correct description of this feature is
"gates green, transform not yet proven against its own properties, never run
end-to-end" - not runtime-ready, and not production-ready.

---

## Boundary

Dev-only, per Requirement 13. The projector performs no Git mutation, no network
egress, no model provider call, and no paid API call. It writes exactly one
directory and one file, both outside the repository working tree.

Reaching genuine runtime readiness requires `device:integrate` returning
`agentic-device-integration-result/v1` with status `runtime_ready`, which in turn
requires an admitted task lane, protected checks, and canonical runtime
reconciliation. Reaching production would additionally require amending
Requirement 13 and a human-authorized candidate through
`CANONICAL-LIFECYCLE.md`. Neither is claimed by this document.
