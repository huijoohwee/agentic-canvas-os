---
title: "Canvas repository validation adoption"
graphId: "md:canvas-repository-validation"
doc_type: "PRD-TAD-ADR-MVP-GTM"
date: "2026-09-14"
lang: "en-US"
schema: "canvas-repository-validation/v1"
frontmatter_contract: "required"
status: "implementation"
owner: "agentic-canvas-os"
version: "1.0.0"
continuity_id: "CANVAS-VALIDATION-ADOPTION-001"
prd_revision: "1.0.0"
tad_revision: "1.0.0"
adr_revision: "1.0.0"
mvp_revision: "1.0.0"
gtm_revision: "1.0.0"
load_policy: "on-demand"
---

# Canvas validation adoption

## PRD

`CANVAS-VALIDATION-ADOPTION-001@1.0.0`: the solo maintainer validates a changed
Canvas source through the installed Agentic OS owner. Repeated unrelated build
and collaboration checks consume delivery time. Preserve every existing assertion
while selecting affected check groups, retaining unknown-input broadening, and
preserving required CI status names. Revenue and willingness to pay are unmeasured.

Role/Subject: maintainer. Action/Verb: validates. Object: changed Canvas inputs.
Outcome: explicit affected coverage and bounded diagnostics before integration.

## TAD

Agentic OS owns selection, CI event binding, process limits and receipts through
its installed `guides/REPOSITORY-VALIDATION.md` contract. This repository owns only
`.agentic-os-validation.json`, its existing source commands, and CI job wiring.
The exact dependency and integrity stay in `package.json`, `package-lock.json`
and `__tests__/fixtures/agentic-os-pin.mjs`; do not copy the upstream executor.

`npm run check` executes the combined affected plan. `npm run check:plan` previews
it; `npm run check:all` deliberately requests fresh broad local validation.
`check:source` preserves the original unfiltered validation chain. Installed-tool
and environment dependencies make these checks ineligible for local result reuse.

The four existing test shards remain parallel in CI. Each job selects its own
declared partition; build, docs, collaboration and budgets jobs use the same owner.
Together they cover every broad fallback ID. PR jobs fetch the synthetic merge
and both parents (depth two), which contain the verified base and candidate trees.
Push and merge-group events retain full history for their potentially older bases. The existing authorization and aggregate checks remain.

## ADR

Reuse one upstream executor and preserve test sharding. No consumer selector,
process controller, test assertion replacement, new dependency or provider is added.
The initial impact groups are deliberately conservative: source or documentation
changes retain all potentially affected behavioral shards. Web builds and room
integration run only for their declared inputs or a broad fallback. Budgets remain
mandatory. Narrower test partitions require reviewed dependency contracts first.

## MVP

Acceptance: malformed or unknown ownership fails; shared/unknown changes broaden;
CI partition union covers the broad plan; affected plans do not run an unrelated
partition; existing checks pass on the pinned candidate. Validate with the upstream
runner tests, local plan inspection, existing Canvas checks and protected CI.
Receipts identify skipped partitions and do not establish full runtime parity.

## GTM

Compare executed groups and elapsed command time for a source edit, a docs edit,
and unchanged inputs. Keep those measurements separate from CI waiting and buyer
evidence. This adoption changes validation only; deployment and rollback remain
with the existing protected product workflows.
