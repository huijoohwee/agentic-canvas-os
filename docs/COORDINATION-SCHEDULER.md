---
title: "Coordination Scheduler"
graphId: "md:coordination-scheduler"
doc_type: "Runtime Contract"
date: "2026-08-16"
lang: "en-US"
schema: "agentic-coordination-scheduler-report/v1"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_owner: "../scripts/coordination-scheduler.mjs"
runtime_proof: "../__tests__/coordination-scheduler.test.mjs"
---

# Coordination Scheduler

`/coordination.schedule #workspace-parallelism @coordination-plan` partitions
independent work into bounded deterministic waves. It is a read-only planner:
it never creates a claim, grants authority, runs a command, edits a lease,
touches a worktree, closes a pull request, merges, publishes, or deploys.

Each task supplies its exact declared write set, dependency ids, priority,
cloud authority state, and typed findings. Only `current` authority can be
scheduled. Waiting successors stay non-writing; reviewed, dormant, integrated,
and retired states do not become authoring authority.

Global `attention-required` is non-blocking only when the finding includes a
content-bound affected write set that is provably disjoint from the candidate.
Missing or overlapping scope evidence still blocks. Candidate and
semantic-scope findings always block. This preserves fail-closed admission
while preventing unrelated, fully attributed residue from serializing the
whole workspace.

Within each wave, tasks are ordered by descending priority and then stable id.
The configured capacity and declared write-set overlap bound every wave.
Dependencies create later waves; a blocked or waiting dependency propagates a
typed disposition instead of stalling unrelated roots.

Run:

```sh
npm run coordination:schedule -- plan --input=/absolute/external/input.json --json
```

The report contains `ready`, `waiting`, `blocked`, `nonBlockingAttention`, and
`waves`, plus canonical input and report digests. Consumers may invoke only the
ready tasks through their existing admitted owners; the report itself grants
no mutation, review, integration, release, Production, or Cloudflare authority.
