---
title: "Offline Python Learning Workspace"
graphId: "md:agentic-canvas-os-python-learning"
doc_type: "Product Consumer Contract"
date: "2026-09-22"
lang: "en-US"
schema: "agentic-canvas-os-python-learning/v1"
frontmatter_contract: "required"
status: "implementation-in-progress"
owner: "agentic-canvas-os"
publish_policy: "Dev-only until explicit operator approval"
runtime_scope: "Graph-owned local learning workspace; Canvas consumer documentation"
runtime_proof: "agentic-graph/docs/documents/python-learning-runtime-evidence.md"
continuity_id: "OFFLINE-PYTHON-LEARNING-WORKSPACE-001"
plan_revision: "1.0.0"
plan_commit: "f69d48f9a862fee6328b7d716d6b79e9fa5d23d4"
---
# Offline Python learning workspace

Open a `.py` file through Explorer and use the Python pane immediately after
`bin` in the existing Editor Workspace. Run and Step execute the documented
`learning-python-1` subset in a bounded browser worker. Three original lessons
teach variable-controlled travel, loops and sensor-conditioned functions through
procedural scenes, visible state, a common rubric and authored staged hints.

Selecting a file, importing a debrief, changing a lesson or displaying a worked
solution never executes source. Applying a starter or restoring debrief source
requires its explicit UI action. Unsupported syntax reports its source location.
This is not unrestricted Python, package execution or a desktop GUI runtime.

## Owners and invocation

| Owner | Responsibility |
|---|---|
| Agentic OS | Shared `/`, `@`, `#` dictionary metadata and repository lifecycle. |
| Agentic Canvas OS | This consumer contract and existing catalog projection. |
| agentic-graph | Editor, interpreter worker, procedural ECS/physics scenes, shared rubric, persistence and browser tools. |

The intended invocation is `/python.learning @canvas #learning`. It is a
discovery/handoff route, not an execution permission. Its dictionary registration
and Graph's central WebMCP registration are pending their current owners. Until
both are registered and proven, treat the route as unavailable and use the
ordinary Python pane. Never install an alternate catalog or claim that this
document makes the route executable.

| Graph tool contract | Input | Effect |
|---|---|---|
| `agentic-graph.inspect_local_python_learning` | Empty closed object. | Read current document/run identity, limits, lesson, state, diagnostics and rubric. |
| `agentic-graph.control_local_python_learning` | Fresh full inspection binding, operation and request ID. | Apply one bounded operation through the same controller and persistence as the UI. |

The Graph source owners are
`canvas/src/features/python-learning/learningToolContract.mjs` and
`canvas/src/features/python-learning/learningWebMcp.ts`. Consumers load their
registered schemas; this document does not duplicate an executable schema.

The binding includes workspace and document IDs, source and scene SHA-256,
lesson and runtime revisions, lesson ID, seed and expected run ID. A mutation
requires the user's applicable instruction and a fresh matching binding.
Supported operations are `validate`, `run`, `step`, `pause`, `stop`, `reset`,
`hint` and `save`. Tools do not edit source. `save` saves a debrief; it does not
replace the native source-file Save action.

Run acknowledges a run ID and status within two seconds; it does not assert
completion. Inspect at most five times for a requested run, then return its
observed status. A stale identity, cancelled request or changed source must not
affect another run. Repeated request IDs reuse the bounded native result memo;
consumers must not invent retries or polling services. Absent WebMCP leaves the
ordinary UI usable. Core hints and grading call no model and incur no provider
fee; an external agent's own costs belong to its host.

## Save, offline installation and recovery

Use **Save source** in the Python pane to delegate to the existing Workspace
Save action. Wait for the native Saved acknowledgement before reopening. Source
save and **Save debrief** have separate receipts. A debrief preserves its exact
source snapshot and source/scene/run identity in the existing workspace store.
Export/import is portable and bounded; import does not run the saved program.

Explicitly install and verify the offline workspace while its assets are
available. The existing service worker verifies one complete build manifest and
all member digests before activating it, retaining a prior complete version.
Open the verified offline workspace link before disconnecting. A first uncached
visit still needs a connection or a local distribution. Missing or corrupt
assets fail visibly; recovery changes the selected verified installation without
deleting source or debriefs. Browser storage eviction is detectable, not
preventable. Keep a portable debrief export when preservation matters.

Graph owns the service worker, revision authority and existing storage. Canvas
adds no worker, database, model, gateway, interpreter, grader or renderer. The
offline guarantee covers the installed learning workspace; unrelated connected
features may attempt requests and report unavailable status without blocking it.

## Acceptance and delivery boundary

The Graph evidence file identifies exact candidate builds, scoped tests, offline
browser reload and corruption checks. Consumer acceptance additionally requires
registered-schema parity, exact invocation discovery and UI/tool parity through
the central registry. Current local evidence does not establish a protected
merge, production deployment, physical-device or screen-reader session, learner
completion time, buyer demand or learning efficacy.

Install-time bytes and measured timings belong to the exact candidate manifest
and browser artifact. Runtime limits belong to Graph's `pythonModel.ts`; do not
fork those constants here. Rollback preserves native source/debrief storage and
uses the existing verified prior installation. Production effects remain under
the product's release and deployment authorities.
