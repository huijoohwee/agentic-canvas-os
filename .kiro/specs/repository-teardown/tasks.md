# Implementation Plan: Repository Teardown

## Overview

This plan executes the eleven-stage Teardown_Process defined in the design, in the
order Requirement 11 criterion 1 and the design's stage justifications fix. All
tooling is Node 22 `.mjs` under `scripts/`, invoked by `node`, with zero new
dependencies; `fast-check` 3.23.2 and `ajv` 8.20.0 are already present.

Three things shape the ordering and are not negotiable:

1. **Tools are built before the stage that consumes them.** All six harnesses land
   in one preparatory commit (epic 1) so the rehearsal can run the whole pipeline
   twice, identically.
2. **The rehearsal in epic 6 is a blocking gate.** Epics 1 through 5 are safe
   against the real repository: they build tools, record a baseline, push an
   archive tag, build the inventory, and run the concurrency trial. Nothing before
   epic 6 deletes a tracked path, a ref, or a worktree. Every task that does is
   placed after epic 6 and marked.
3. **Nothing is deleted before the inventory and the archive both exist.**
   Requirement 11 criterion 1. Deletion tasks start at epic 9.

### The Stage Gate procedure (referenced, not repeated)

Each stage's final task is the same procedure. It is stated once here:

- Stage every change of that stage and produce **exactly one commit** containing
  all of it, leaving `git status --porcelain` reporting zero lines before the gate
  runs. _Requirements: 11.2_
- Update the Reduction_Report in that same commit with the file and line counts of
  `worker/`+`src/`+`agent-api/src/`, `scripts/`, `__tests__/`, and `docs/*.md`
  measured on that commit's tree, via `node scripts/teardown-measure.mjs --commit
  <sha> --report <path>`. _Requirements: 11.6, 12.1_
- Remove, in that same commit, every reference resolving to a path the commit
  deletes in any file the Check_Suite executes. _Requirements: 11.7_
- Run the Check_Suite (`npm run check`) with that commit as checked-out HEAD and
  start no later stage until the run exits. _Requirements: 11.3_
- On non-zero exit, revert that stage commit in a single revert commit, then run
  the Check_Suite on the revert commit. Proceed only on status 0; on non-zero,
  **stop** and record the reverted stage in the Reduction_Report.
  _Requirements: 11.4, 11.8, 11.9_
- Treat a Check_Suite that fails to start or does not exit within 600 seconds as
  incomplete and record the start or timeout failure. _Requirements: 9.8, 9.9_

### Markers used below

- **[DELETES TRACKED PATHS]** — removes tracked files; recoverable from the
  Archive_Ref bundle and the Removal_Manifest. Blocked by epic 6.
- **[IRREVERSIBLE]** — deletes a ref, removes a worktree, or removes the
  External_State_Directory. Requires recorded Operator authorization naming the
  exact refs and paths. Blocked by epic 6.
- **[OPERATOR DECISION]** — the task surfaces a choice a coding agent cannot make
  alone and records the answer. It does not guess.
- `*` — optional sub-task (unit-test layer only; see Notes).

## Tasks

- [ ] 1. Build the teardown tooling and its invariant tests
  - One preparatory commit. Adds files, deletes nothing. `state-path-check.mjs`
    lands here but is **not** wired into the Check_Suite until stage 9, because it
    exits non-zero while the lifecycle scripts that write outside Repository_Root
    still exist.
  - [ ] 1.1 Build `scripts/teardown-route-baseline.mjs`
    - Implement `record` and `replay` subcommands over a tracked, fixed corpus of
      at least one request per Preserved_Route_Set method-and-path pair, 17 pairs
      total, each with recorded headers and exact body bytes.
    - Record `environmentName`, `baseUrl`, `workerCommit`, per-id status, and the
      five readiness values in a `RouteBaselineRecord`. Reject a `replay` whose
      environment name differs from the recorded one. Runs against an
      Operator-started `wrangler dev`; the harness spawns no long-running server.
    - _Requirements: 4.1, 4.2, 4.14_
  - [ ] 1.2 Build `scripts/teardown-archive.mjs`
    - Implement `create`, `verify`, and `contains` per the design interface.
      `create` enumerates `git branch -a`, asserts the ref count equals 392,
      records each ref name with its tip SHA and each worktree path with its HEAD
      SHA from `git worktree list --porcelain`, writes a bundle covering every
      enumerated ref, creates the annotated tag on the pre-teardown commit.
    - `verify` runs `git bundle verify` and asserts `git ls-remote --tags origin`
      reports the tag at the local tag SHA. `contains` answers SHA and ref
      reachability queries from `git bundle list-heads`.
    - _Requirements: 3.1, 3.3, 3.5, 3.8, 3.9, 3.11_
  - [ ] 1.3 Build `scripts/teardown-inventory.mjs`
    - Enumerate with `git ls-files -- scripts __tests__ docs agent-api/src` at the
      named commit; one entry per tracked file, keyed by Repository_Root-relative
      path. Emit all five evidence lists explicitly, with `[]` where empty.
    - Implement the reference resolvers: `package.json` script tokens with glob
      expansion, static imports and literal `import()` with reverse edges,
      `.github/workflows` `run:` steps, `.githooks` tokens, and tracked `*.md`
      references. A reference resolving to zero or to more than one tracked file is
      recorded in `unresolvedReferences`.
    - Implement Proven_Path detection by breadth-first walk from the
      Preserved_Route_Set handlers in `worker/index.js` plus the two
      Live_Proof_Record frontmatter keys. Implement the Lane_Lifecycle_Layer
      fields: out-of-root read/write with file and line, `knowgrph` invocation with
      file and line, and the protected-resource record with acquire and release
      line numbers or an explicit no-mechanism statement.
    - Implement the ordered Classification decision procedure exactly as the
      design's Classification Decision Procedure states, first match wins, plus the
      two upward guards. Refuse to write output unless the four Classification
      counts for each directory sum to that directory's tracked file count.
    - Make no assumption about what any lane-lifecycle script does. Everything the
      plan later relies on about those 223 scripts comes from this tool's output.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.12, 1.13, 2.1, 2.2, 2.3, 10.1_
  - [ ] 1.4 Build `scripts/state-path-check.mjs`
    - Inspect every tracked file under `scripts/` and `.githooks`. Collect
      write-capable call sites (`node:fs` and `node:fs/promises` write, append,
      mkdir, rename, copy, rm; shell redirections and `mkdir`, `cp`, `mv`, `tee` in
      hooks). Resolve string-literal, literal-span template, and
      `path.join`/`path.resolve`-of-literals targets against Repository_Root.
    - Report the **first** offending file with its resolved write target and exit
      immediately non-zero; exit 0 having reported nothing when every resolvable
      target is a descendant of Repository_Root.
    - _Requirements: 7.3, 7.4, 7.5_
  - [ ] 1.5 Build `scripts/teardown-measure.mjs`
    - Counting method fixed: file counts from `git ls-files` for the surface, line
      counts over every line of those files including blank and comment lines,
      `docs/*.md` meaning the top level of `docs/` only, `agent-api/src/` modules
      being each tracked `.js` file at any depth, git counts from `git worktree
      list`, `git branch`, and `git branch -r` excluding `origin/HEAD`.
    - Emit `SurfaceRow`, `CountRow`, `classificationTotals`,
      `constrainedWithoutReducedForm`, `archive`, `servedRoutes`,
      `readinessDifferences`, `warnings`, `unmetThresholds`, `retentions`, and
      `revertedStages` into a Markdown report with an embedded JSON block.
    - With `--final`, assert every Requirement 12 threshold plus the Requirement 6
      criterion 12 limits, record the final commit SHA, and exit non-zero with
      `status: "incomplete"` and one `unmetThresholds` row per breach.
    - _Requirements: 12.1, 12.2, 12.3, 12.7, 12.8, 12.9_
  - [ ] 1.6 Build `scripts/teardown-concurrency-trial.mjs`
    - Start two real writers with `node:child_process` in two Git worktrees inside
      a 5000 ms window, record `startSkewMs`, both exit statuses, and a canonical
      serialization of the protected resource state, for at least 3 runs with the
      mechanism active and at least 3 with it bypassed, as
      `ConcurrencyTrialResult` values linked by `trialId` to inventory entries.
    - No mocking. Removed in stage 11 with the other temporary tools.
    - _Requirements: 2.10, 2.11_
  - [ ]* 1.7 Unit tests for the reference tokenizer and import extractor
    - Fixture `package.json` script strings including `__tests__/*.test.mjs`,
      `__tests__/alignment-audit-*.test.mjs`, chained `&&` commands, and
      `node ./scripts/x.mjs arg`. Import fixtures covering static `import`,
      `export ... from`, literal `import()`, and non-literal `import(expr)` which
      must be recorded as unresolvable.
    - _Requirements: 1.3, 1.12_
  - [ ]* 1.8 Unit tests for the `run_worker_first` glob matcher
    - `/api/*` and literal entries against each preserved path; the negative case
      that no entry matches `/`.
    - _Requirements: 4.10_
  - [ ]* 1.9 Unit tests for the State_Path_Check detection forms and blind spots
    - One fixture per detection form, plus failing-to-detect fixtures for the
      stated blind spots: env-var-derived targets, CLI-argument targets, helper
      indirection, and child-process argument vectors built at runtime.
    - _Requirements: 7.4, 7.5_
  - [ ]* 1.10 Unit tests for the Error Handling edge-case rows
    - Corrupted bundle, vanished remote tag, non-zero state move exit, absent
      sibling repository.
    - _Requirements: 2.9, 2.12, 3.5, 7.10_
  - [ ] 1.11 Property tests for inventory shape
    - **Property 1: Classification totality and exclusivity**
    - **Property 2: Evidence structure completeness and dead-emptiness equivalence**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.6, 1.7, 1.13, 2.1, 2.2, 2.3, 2.7, 12.3**
  - [ ] 1.12 Property tests for retention
    - **Property 3: Ambiguity and missing evidence force retention**
    - **Property 17: Retention monotonicity**
    - **Validates: Requirements 1.4, 1.5, 1.8, 1.9, 1.10, 1.11, 1.12, 4.11, 4.15, 12.6**
  - [ ] 1.13 Property test for the decision procedure
    - **Property 4: Classification decision procedure is deterministic and total**
    - Include `ConcurrencyTrialResult` record-shape assertions in the same
      generator, since the trial's observations feed this procedure.
    - **Validates: Requirements 2.4, 2.5, 2.6, 2.11, 5.2, 5.11**
  - [ ] 1.14 Property tests for archive coverage and manifest completeness
    - **Property 5: No deletion without archive coverage**
    - **Property 6: Removal_Manifest completeness per commit**
    - **Validates: Requirements 3.1, 3.6, 3.7, 3.8, 3.9, 3.11, 10.2, 10.3**
  - [ ] 1.15 Property tests for import and reference closure
    - **Property 7: Import closure holds at every stage commit**
    - **Property 8: Same-commit reference closure**
    - **Validates: Requirements 5.3, 5.8, 5.9, 8.5, 8.8, 9.2, 9.7, 9.10, 11.7**
  - [ ] 1.16 Property test for stage sequence discipline
    - **Property 9: Stage sequence discipline**
    - **Validates: Requirements 2.8, 3.2, 4.14, 7.9, 8.12, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.8**
  - [ ] 1.17 Property test for dirty-worktree fail-closed handling
    - **Property 10: Dirty worktree fails closed**
    - Assert the reconciled rule: any porcelain line of any kind blocks removal.
      Requirement 10 criterion 5 is deliberately not asserted as automatic.
    - **Validates: Requirements 3.12, 10.4, 10.7**
  - [ ] 1.18 Property tests for readiness derivation and Worker configuration
    - **Property 12: Readiness is derived from bindings and reports only the five keys**
    - **Property 13: Worker configuration invariants**
    - **Validates: Requirements 4.4, 4.5, 4.7, 4.8, 4.9, 4.10**
  - [ ] 1.19 Property tests for threshold reporting and reduction arithmetic
    - **Property 15: Threshold breaches report incomplete**
    - **Property 18: Reduction arithmetic and measurement integrity**
    - **Validates: Requirements 5.6, 6.12, 9.9, 12.1, 12.5, 12.8, 12.9**
  - [ ] 1.20 Property test for first-offender reporting
    - **Property 16: State_Path_Check reports the first offender and nothing else**
    - **Validates: Requirements 7.3, 7.4, 7.5**
  - [ ] 1.21 Property tests for lifecycle key absence and surviving-set disjointness
    - **Property 19: Lifecycle script keys are absent at completion and intact before their stage**
    - **Property 20: Surviving tests and documents are disjoint from the lifecycle layer**
    - **Validates: Requirements 6.4, 6.5, 8.4, 9.11**
  - [ ] 1.22 Commit the tooling and run the Stage Gate
    - Apply the Stage Gate procedure. All 20 process property tests must run at 100
      or more iterations under `npm test` and pass.
    - _Requirements: 11.2, 11.3, 11.6_

- [ ] 2. Stage 1 — Baseline capture
  - [ ] 2.1 Record the pre-teardown route response baseline
    - Commit the fixed 17-pair request corpus as a tracked file, including the
      requests expected to fail: unauthenticated `POST /api/run` (401),
      `GET /api/canvas/room` with no token (401), malformed-JSON body (400), and
      the non-upgrade `GET /api/canvas/room` path (426).
    - With `wrangler dev` running in one named environment, run
      `teardown-route-baseline.mjs record` and commit the record, including the
      environment name and the five readiness values.
    - _Requirements: 4.1, 4.2, 4.14, 11.1_
  - [ ] 2.2 Scaffold the Reduction_Report with the Baseline_Measurement
    - Write the Baseline_Measurement rows and confirm each by measuring the
      pre-teardown commit with `teardown-measure.mjs`: 78 files / 19,228 lines for
      `worker/`+`src/`+`agent-api/src/`, 59 `agent-api/src/` modules, 361 / 110,186
      for `scripts/`, 296 / 89,206 for `__tests__/`, 100 / 17,924 for `docs/*.md`,
      116 npm scripts, 15 worktrees, 392 refs. Record any measured value that
      differs from the stated baseline as a `warnings` row rather than editing the
      requirements denominator.
    - _Requirements: 12.1, 12.2, 12.3_
  - [ ] 2.3 Commit stage 1 and run the Stage Gate
    - Apply the Stage Gate procedure. The gate additionally requires that the route
      baseline record exists in the commit.
    - _Requirements: 11.2, 11.3, 11.6_

- [ ] 3. Stage 2 — Archive before any deletion
  - [ ] 3.1 Create the Archive_Ref bundle and annotated tag
    - Run `teardown-archive.mjs create`. Assert the enumerated ref count equals
      392, that every ref name and tip SHA is recorded, and that every worktree
      path and HEAD SHA from `git worktree list --porcelain` is recorded. Fail
      before pushing if the count differs.
    - _Requirements: 3.1, 3.11_
  - [ ] 3.2 Push the tag to `origin` and verify it there
    - Push the annotated tag. Run `teardown-archive.mjs verify`: `git bundle
      verify` must exit 0 and `git ls-remote --tags origin` must report the tag at
      the local tag SHA. On a non-zero push, delete the locally created tag and
      bundle, restore HEAD to the pre-teardown commit, confirm `git status
      --porcelain` reports zero lines, and **stop** before any deletion commit.
    - _Requirements: 3.2, 3.3, 3.4, 3.5_
  - [ ] 3.3 Commit stage 2 and run the Stage Gate
    - Apply the Stage Gate procedure. Record the tag name, bundle path, and
      Removal_Manifest path in the Reduction_Report `archive` block. Initialise an
      empty Removal_Manifest in this commit.
    - _Requirements: 3.6, 11.2, 11.3, 12.7_

- [ ] 4. Stage 3 — Capability_Inventory
  - [ ] 4.1 Build the inventory over the four directories
    - Run `teardown-inventory.mjs --commit <pre-teardown sha>`. Verify the totality
      gate passed and that `countsByDirectory` sums to each directory's tracked
      file count. Commit the inventory as a tracked file.
    - _Requirements: 1.1, 1.2, 1.3, 1.13_
  - [ ] 4.2 Record the ref table
    - For every ref reported by `git branch -a` at process start, record the ref
      name, tip SHA, whether `origin/main` contains that tip, and the worktree that
      has it checked out, or null.
    - _Requirements: 10.1_
  - [ ] 4.3 Run and record the sibling `knowgrph` repository check
    - Record `checkedPath`, `repositoryPresent`, `readsExternalStateDirectory` as
      an explicit boolean or null, `determination`, `readingFileCount`, and one
      `readingFiles` row per reading file with its `externalStatePath` and
      `replacementSource`. If the repository is absent, record the absent-repository
      condition and the checked path, mark the determination undetermined, add a
      Reduction_Report warning, and continue. If a replacement source cannot be
      determined, warn naming the reading file and continue.
    - _Requirements: 2.7, 2.8, 2.9, 2.12_
  - [ ] 4.4 Record the `agent-api/src/` Proven_Path and subsystem determination
    - For each of the 59 modules, record whether it satisfies Proven_Path and cite
      either the Preserved_Route_Set handler whose static import chain reaches it
      or the Live_Proof_Record and the `runtime_owner` or `runtime_proof`
      frontmatter entry naming it. Name the modules implementing each of the eleven
      subsystems `README.md` reports as `configured: false`.
    - _Requirements: 5.1, 5.2, 5.10, 5.11_
  - [ ] 4.5 **[OPERATOR DECISION]** Record the `POST /api/agent/run` classification
    - Present the tension to the Operator: `docs/LIVE-AGENT-PROVIDER-PROOF.md`
      proves the composed-agent modules through a Node harness while `README.md`
      states the shipped Worker keeps autonomous execution off and Requirement 4
      criterion 1 omits the route. Record exactly one Classification for the route
      in `agentRunRouteClassification` with that citation, and record the Operator's
      retain-or-remove decision for the composed-agent modules. If the
      Live_Proof_Record names those modules, Proven_Path applies and they are
      `retained` regardless of the route's fate; do not override that.
    - _Requirements: 4.13, 1.8, 5.1_
  - [ ] 4.6 Evaluate the inventory against the reduction targets and record unmet thresholds
    - Compute the projected post-teardown counts implied by the `retained` plus
      `constrained` sets and compare them against the Requirement 5 criterion 5 cap
      of 20 modules, the Requirement 12 criterion 4 ceiling of 32,597 lines, and the
      Requirement 6, 8, and 9 limits. Write one `unmetThresholds` row per projected
      breach with the measured and required values and set `status: "incomplete"`
      where any breach exists.
    - An incomplete Reduction_Report is a valid terminal outcome. Do **not** widen
      any deletion set, downgrade a `constrained` entry, or delete a reachable
      module to reach a number.
    - _Requirements: 5.6, 6.12, 12.9, 12.3, 12.6_
  - [ ] 4.7 Commit stage 3 and run the Stage Gate
    - Apply the Stage Gate procedure.
    - _Requirements: 11.1, 11.2, 11.3, 11.6_

- [ ] 5. Stage 4 — Concurrency trial
  - [ ] 5.1 Run the trial for every entry that operates a mechanism
    - For each inventory entry whose `protectedResource` records a lock, lease,
      claim, or parking record, run `teardown-concurrency-trial.mjs` with two
      concurrent writers on one machine in two Git worktrees inside a 5-second
      window, at least 3 runs active and at least 3 bypassed, recording the
      protected resource state and both exit statuses per run.
    - _Requirements: 2.3, 2.10_
  - [ ] 5.2 Apply the trial results to the inventory
    - Where a bypassed run's protected resource state or exit status differs from
      an active run's, assign Classification `constrained` and record the constraint
      statement, the evidence Git and GitHub do not express it, the observable
      failure when unenforced, and a reduced-form replacement. Where the
      observations are identical, record no concurrency ground for `constrained`
      and leave the other-constraint route of Requirement 2 criterion 5 open. Where
      the trial is inconclusive and the entry looks load-bearing, retain it.
    - Link each entry to its `trialId`. An entry classified `constrained` with a
      null reduced form is retained and still counts toward
      `constrainedWithoutReducedForm`.
    - _Requirements: 2.4, 2.5, 2.11, 1.5, 1.10_
  - [ ] 5.3 Commit stage 4 and run the Stage Gate
    - Apply the Stage Gate procedure.
    - _Requirements: 11.2, 11.3, 11.6_

- [ ] 6. **[BLOCKING GATE]** Full pipeline rehearsal on a throwaway clone
  - No task in epic 9 or later may start until 6.6 records a passing rehearsal.
    Every deletion of a tracked path, every ref deletion, and every worktree
    removal is blocked by this epic.
  - [ ] 6.1 Build the scratch environment
    - `git clone --mirror` the repository into a scratch bare repo that acts as
      `origin`; clone from that into a scratch working clone. Recreate a
      representative subset of worktrees including at least one clean, one with a
      tracked modification, and one with an untracked file.
    - _Requirements: 3.12, 10.4, 10.7_
  - [ ] 6.2 Run the full eleven-stage pipeline against the scratch clone
    - Point every tool at the scratch working clone with the scratch bare repo as
      `origin`. This exercises real `git push --tags`, `git bundle create` and
      `verify`, `git ls-remote`, `git branch -D`, and `git worktree remove` with
      nothing valuable at risk.
    - _Requirements: 11.1, 11.2, 11.3_
  - [ ] 6.3 Assert the rehearsal outcomes
    - The tag is present at the scratch origin at the local tag SHA; the bundle
      verifies; both dirty worktrees are retained with Reduction_Report retention
      rows carrying path and line count; the clean worktree is removed; the
      Removal_Manifest path set equals the set of paths deleted across all stages;
      and Property 7 holds at every stage commit.
    - _Requirements: 3.3, 3.5, 3.6, 3.7, 3.12, 5.8, 9.2, 10.4, 10.7_
  - [ ] 6.4 Rehearse the failure paths
    - Make the scratch origin reject pushes and assert the tag and bundle are
      deleted locally with HEAD at the pre-teardown commit and porcelain empty.
      Corrupt the bundle and assert the stop-and-record path. Remove the tag from
      the scratch origin mid-run and assert the stop. Force a Check_Suite failure at
      a stage boundary and assert exactly one revert commit followed by a gated
      revert; force a failure on the revert commit and assert the process stops with
      the reverted stage recorded.
    - _Requirements: 3.4, 3.5, 11.4, 11.8, 11.9_
  - [ ] 6.5 Rehearse the failing pull-request check on the scratch remote
    - Open one pull request carrying a deliberately failing Check_Suite run and
      assert a failed check is reported and the pull request is left unmerged.
    - _Requirements: 6.11_
  - [ ] 6.6 Record the rehearsal result as the blocking gate
    - Commit a rehearsal result record naming each assertion in 6.3 through 6.5 and
      its outcome. If any assertion failed, **stop**: no destructive task proceeds
      until the pipeline is corrected and the rehearsal re-run.
    - _Requirements: 11.1, 11.3_

- [ ] 7. Checkpoint — rehearsal complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Record the Operator decisions that later stages consume
  - Each task records the decision in a tracked decision record and does not guess
    a default. The authorization records for branch deletion, worktree removal, and
    External_State_Directory removal are separate tasks inside stages 9 and 10,
    because their target sets are not known until then.
  - [ ] 8.1 **[OPERATOR DECISION]** Record which two `.githooks` files survive
    - Present the four candidates with their inventory entries and evidence lists:
      `git-guarded`, `pre-commit`, `pre-push`, `reference-transaction`. Record the
      two survivors by filename; stage 7 removes the rest and the
      Contributor_Workflow names each survivor.
    - _Requirements: 6.9, 6.1_
  - [ ] 8.2 **[OPERATOR DECISION]** Record the surviving Check_Suite workflow
    - Present the six `.github/workflows` files with their inventory entries.
      Record which one becomes the single surviving workflow that runs the
      Check_Suite on every pull request targeting `main`, and record whether
      `dependency-security.yml` and `security.yml` fold into it or leave the
      repository.
    - _Requirements: 6.8, 6.11_
  - [ ] 8.3 **[OPERATOR DECISION]** Record the `wrangler.jsonc` `dev` block decision
    - Present the tension: the block declares OpenAI function-calling variables
      that the `functionCalling` readiness key reports, which Requirement 4
      criterion 15 likely retains, while the same block carries `run_worker_first`
      entries for `/agent/run` that criterion 16 removes. Record whether the block
      survives, and if so which entries it keeps.
    - _Requirements: 4.15, 4.16, 4.8, 4.9, 4.10_

- [ ] 9. Stage 5 — Test suite reduction
  - [ ] 9.1 Compute the removable test set from the inventory
    - Select `__tests__/` files whose static imports of Repository source modules
      resolve only to modules the process removes, and, separately, files that
      import both a doomed and a surviving module so their doomed imports and
      assertions can be stripped in place. Do not select any file on evidence
      grounds: `npm test` expands to `__tests__/*.test.mjs`, so no test file is
      `dead`.
    - _Requirements: 9.7, 9.10, 1.6_
  - [ ] 9.2 Author the permanent route status test
    - One request and one expected status code per each of the 17
      Preserved_Route_Set method-and-path pairs, invoked by the Check_Suite. This is
      the lasting replacement for the baseline harness.
    - _Requirements: 4.12, 9.3_
  - [ ] 9.3 Author per-export assertions for the surviving `agent-api/src/` modules
    - For every exported function of every surviving module, at least one assertion
      on its return value or on the error it throws.
    - _Requirements: 9.4_
  - [ ] 9.4 Write the surviving session token property test
    - **Property 21: Session token round trip, a surviving product property**
    - **Validates: Requirements 9.5**
  - [ ] 9.5 Write the surviving MCP round-trip property test
    - **Property 22: MCP request and response round trip, a surviving product property**
    - **Validates: Requirements 9.6**
  - [ ] 9.6 Write the route and coverage property tests
    - **Property 11: Route status preservation**
    - **Property 14: Surviving tests cover the surviving surface**
    - **Validates: Requirements 4.2, 4.3, 4.12, 9.3, 9.4**
  - [ ] 9.7 **[DELETES TRACKED PATHS]** Remove the lifecycle and orphaned test files
    - Delete the selected set, including the 25 `alignment-audit-property-NN.test.mjs`
      files and every test file that exercises the Lane_Lifecycle_Layer. Strip
      doomed imports and their assertions from mixed files in this same commit.
      Every static import in `__tests__/` must still resolve at this commit.
    - _Requirements: 9.1, 9.2, 9.7, 9.10, 9.11, 9.12_
  - [ ] 9.8 Append the stage 5 Removal_Manifest entries
    - One entry per deleted path with its pre-teardown blob SHA, stage number 5,
      the stage commit, and its Classification. The count of entries added by this
      commit must equal the count of tracked paths the commit deletes.
    - _Requirements: 3.6, 3.7_
  - [ ] 9.9 Commit stage 5 and run the Stage Gate
    - Apply the Stage Gate procedure.
    - _Requirements: 11.2, 11.3, 11.6, 11.7_

- [ ] 10. Stage 6 — Documentation reduction with validator removal in the same commit
  - This stage's coupling is forced, not chosen: `scripts/docs-contract.mjs`
    imports 12 validators and calls each one, and a validator targeting an absent
    `docs/` path exits non-zero.
  - [ ] 10.1 Compute the document removal set
    - Select `docs/` files whose inventory entry holds `redundant` or `dead` and
      whose filename names an individual lifecycle, claim, recovery, projection, or
      disposition episode. Retain `docs/LIVE-REVIEWED-FUNCTION-PROOF.md` and
      `docs/LIVE-AGENT-PROVIDER-PROOF.md` unconditionally. Record the target
      surviving set against the 12-file and 2,500-line limits.
    - _Requirements: 8.1, 8.2, 8.4_
  - [ ] 10.2 **[DELETES TRACKED PATHS]** Delete the selected documents
    - _Requirements: 8.1, 8.4_
  - [ ] 10.3 Remove the matching validator imports and call sites
    - In the same commit, remove each of the 12 `scripts/docs-contract.mjs`
      validator imports whose target document this commit deletes, together with
      every call site of that validator. `npm run docs:check` must exit 0 at this
      commit, including the case where no surviving document is targeted at all.
    - _Requirements: 8.6, 8.7, 8.8, 8.11_
  - [ ] 10.4 Remove every reference to the deleted documents
    - In the same commit, remove references in `docs/`, `README.md`,
      `package.json`, `scripts/`, and `.github/workflows/`.
    - _Requirements: 8.5, 11.7_
  - [ ]* 10.5 Unit tests for `docs-contract.mjs` after validator removal
    - All validators and all targets removed exits 0; one target removed without
      its validator exits non-zero naming the path.
    - _Requirements: 8.7, 8.11_
  - [ ] 10.6 Append the stage 6 Removal_Manifest entries
    - _Requirements: 3.6, 3.7_
  - [ ] 10.7 Commit stage 6 and run the Stage Gate
    - Apply the Stage Gate procedure. The Check_Suite must exit 0 at this commit
      despite the document removals.
    - _Requirements: 8.12, 11.2, 11.3, 11.6, 11.7_

- [ ] 11. Stage 7 — Lane lifecycle scripts, `package.json`, `.githooks`, workflows
  - Requirement 11 criterion 5 keeps `scripts/` deletion and source deletion in
    separate stages. Requirement 6 criterion 5 required every `device:*` key to
    stay intact with its pre-teardown command string until this stage; no earlier
    stage may have touched them.
  - [ ] 11.1 **[DELETES TRACKED PATHS]** Remove the lifecycle scripts the inventory clears
    - Delete only entries the inventory classifies `redundant` with a named Git
      command or GitHub feature, or `dead` with five explicitly empty evidence
      lists. Retain every `constrained` entry with no recorded reduced-form
      replacement, every entry with an unresolvable reference, and every entry with
      no inventory entry at all. Record each retention with its reason.
    - _Requirements: 1.4, 1.6, 1.9, 1.10, 1.11, 1.12, 6.10_
  - [ ] 11.2 Prune the `package.json` scripts object in the same commit
    - Remove every key matching `device:*`, `runtime:session:*`, `turn:end`,
      `canonical:main:*`, `workspace:legacy-*`, `worktree:lifecycle:*`,
      `lifecycle:conformance*`, `history:lifecycle*`, `alignment-audit:*`, or
      `agentic-sdlc:*`, and every key whose command resolves to a path this commit
      deletes. Drive the total toward the 20-entry ceiling; record the measured
      count and an `unmetThresholds` row if it exceeds 20 rather than removing a
      key a surviving path needs.
    - _Requirements: 6.4, 6.5, 6.6, 6.12, 11.7_
  - [ ] 11.3 Reduce `.githooks` to the two authorized survivors
    - Delete the hook files the 8.1 decision record does not name. Preserve the
      `git:configure` binding of `core.hooksPath` to `.githooks`.
    - _Requirements: 6.9_
  - [ ] 11.4 Consolidate to the single surviving Check_Suite workflow
    - Apply the 8.2 decision record: keep exactly one workflow that runs the
      Check_Suite on every pull request targeting `main`, fold or remove the two
      security workflows as recorded, and remove workflow steps referencing paths
      this commit deletes.
    - _Requirements: 6.8, 6.11, 11.7_
  - [ ] 11.5 Append the stage 7 Removal_Manifest entries
    - _Requirements: 3.6, 3.7_
  - [ ] 11.6 Commit stage 7 and run the Stage Gate
    - Apply the Stage Gate procedure.
    - _Requirements: 11.2, 11.3, 11.5, 11.6, 11.7_

- [ ] 12. Checkpoint — process machinery reduced, source untouched
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Stage 8 — `agent-api` modules, routes, readiness keys, Worker configuration
  - [ ] 13.1 **[DELETES TRACKED PATHS]** Remove the `agent-api/src/` modules the inventory clears
    - Delete only modules that are not Proven_Path, that no readiness key reports,
      that no preserved handler reaches through a chain of static imports, and whose
      classification is `dead`, or `redundant` with a named replacement. Retain
      every module reachable from a preserved handler and every module a
      Live_Proof_Record names. If the surviving count exceeds 20, record the count
      and an incomplete status; do not delete a reachable module to reach the cap.
    - _Requirements: 4.11, 5.1, 5.2, 5.5, 5.6, 5.11, 1.8_
  - [ ] 13.2 Remove the unpreserved routes in the same commit
    - Remove the route handlers for the removed modules and, per the 4.5 decision
      record, `POST /api/agent/run` together with its `POST /agent/run` unprefixed
      alias and every `wrangler.jsonc` `run_worker_first` entry matching
      `/api/agent/run` or `/agent/run`. Leave every `run_worker_first` entry that
      matches a preserved path other than `/`, and add none that matches `/`.
    - _Requirements: 4.10, 4.16, 5.3_
  - [ ] 13.3 Reduce the readiness payload to the five keys
    - Remove readiness keys for removed subsystems, including
      `programmaticToolCalling` and the per-subsystem stats blocks, so the payload
      contains exactly `configured`, `auth`, `controlPlane`, `modelProviders`, and
      `functionCalling`. Derive `auth`, `controlPlane`, and `modelProviders` from
      the bindings present in the current environment, report false for an absent
      binding, and report `configured` true only when all three are true. Record any
      readiness value that differs from the stage 1 baseline for an identical
      environment, with the reason.
    - _Requirements: 4.4, 4.5, 4.6, 4.7, 4.15, 5.3_
  - [ ] 13.4 Prune `wrangler.jsonc` variables and preserve the required declarations
    - Remove each variable declaration whose only reader in `worker/`, `src/`, or
      `agent-api/src/` this commit removes, applying the 8.3 decision record for the
      `dev` block. Retain the `CANVAS_ROOM` and `AGENT_STATE` Durable Object
      bindings, the `v1-canvas-room` and `v2-agent-state` migration tags, and the
      `AGENT_API_JWT_SECRET` and `AGENT_REVIEW_JWT_SECRET` required-secret
      declarations in the top-level block and in every named environment block that
      declares bindings, tags, or required secrets.
    - _Requirements: 4.8, 4.9, 5.9_
  - [ ] 13.5 Append the stage 8 Removal_Manifest entries
    - _Requirements: 3.6, 3.7_
  - [ ] 13.6 Commit stage 8 and run the Stage Gate
    - Apply the Stage Gate procedure. Every static import in `worker/`, `src/`, and
      `agent-api/src/` must resolve to a tracked file at this commit; an unresolved
      import reverts the whole stage in one commit and is recorded with the removed
      module. Assert the `worker/`+`src/`+`agent-api/src/` line total against the
      8,000-line target and record an `unmetThresholds` row rather than deleting
      further.
    - _Requirements: 5.7, 5.8, 5.12, 11.2, 11.3, 11.5, 11.6, 11.7_

- [ ] 14. Stage 9 — Process state relocation and External_State_Directory removal
  - [ ] 14.1 Create the Process_State_Directory and repoint the surviving scripts
    - Create exactly one gitignored directory directly under Repository_Root, add
      the `.gitignore` entry excluding it and every path under it, and change every
      surviving script that persists generated process state to resolve its write
      targets under it from one shared literal base constant.
    - _Requirements: 7.1, 7.2, 7.3_
  - [ ] 14.2 Wire the State_Path_Check into the Check_Suite
    - Extend `npm run check` to `npm test && npm run web:build && npm run
      docs:check && node scripts/state-path-check.mjs`, so a non-zero check exit
      makes the Check_Suite exit non-zero. This is the only permitted change to the
      Check_Suite command string.
    - _Requirements: 7.6, 7.7_
  - [ ] 14.3 Move the External_State_Directory state that surviving entries read
    - For every inventory entry classified `retained` or `constrained` that reads
      state held in the External_State_Directory, move that state under the
      Process_State_Directory before any removal. On a non-zero move exit, retain
      the External_State_Directory, stop before the removal, and record the unmoved
      path.
    - _Requirements: 7.9, 7.10_
  - [ ] 14.4 **[OPERATOR DECISION]** Verify archive coverage and record authorization for the removal
    - Re-run `teardown-archive.mjs verify`; stop if the tag no longer appears at
      `origin` at the local tag SHA or the bundle fails verification. Run `contains`
      for each External_State_Directory blob SHA and confirm a bundled ref's
      committed tree holds those contents with identical blob SHAs. Then present the
      exact path list to the Operator and record authorization naming those paths;
      stop and record both sets if the authorized set differs from the targeted set,
      and stop if no authorization is recorded.
    - _Requirements: 3.5, 3.9, 3.10, 3.13_
  - [ ] 14.5 **[IRREVERSIBLE]** Remove the External_State_Directory
    - Remove the `.agentic-codex/`, `.agentic-recoveries/`, `.agentic-receipts/`,
      `.agentic-manifests/`, `.agentic-inputs/` directories and the
      `.agentic-change-manifest-*.json` files from the parent directory of
      Repository_Root, so that zero of them remain. Carry forward any sibling-repository
      warning recorded at 4.3 into the Reduction_Report for this stage.
    - _Requirements: 7.8, 2.8, 2.9_
  - [ ] 14.6 Commit stage 9 and run the Stage Gate
    - Apply the Stage Gate procedure. The gate now includes the State_Path_Check
      and must exit 0 with no write target outside Repository_Root.
    - _Requirements: 7.4, 7.5, 7.6, 11.2, 11.3, 11.6_

- [ ] 15. Stage 10 — Git branch and worktree cleanup
  - [ ] 15.1 Compute the deletion target sets from the inventory ref table
    - Select refs and worktrees for removal. Exclude `main`, `origin/main`, the
      Archive_Ref tag, and every ref a retained worktree has checked out. Record the
      exact ref names, tip SHAs, and worktree paths of the target sets.
    - _Requirements: 10.1, 10.8_
  - [ ] 15.2 **[OPERATOR DECISION]** Record authorization naming the exact refs and worktree paths
    - Present the target sets from 15.1 and record Operator authorization naming
      each ref and each worktree path. Stop before any operation if no authorization
      is recorded, or if the authorized set differs from the targeted set, recording
      both sets in the Reduction_Report.
    - _Requirements: 3.10, 3.13_
  - [ ] 15.3 Run the fail-closed porcelain check in every targeted worktree
    - Run `git status --porcelain` in each worktree selected for removal. On one or
      more lines of any kind, whether tracked modification, staged change, untracked
      file, or a mixture, retain that worktree, record its path and the reported line
      count, and stop before that removal. This is the reconciled authoritative rule;
      the push-then-remove path is available only as a separately authorized Operator
      action, and on a non-zero push the worktree and its branch are retained and
      recorded.
    - _Requirements: 3.12, 10.4, 10.5, 10.6, 10.7_
  - [ ] 15.4 Re-verify archive coverage for every target
    - Re-run `teardown-archive.mjs verify` and stop on failure. Run `contains` per
      targeted ref for its tip SHA and per targeted worktree for its recorded path
      and HEAD SHA. Any target the bundle does not list is retained and recorded
      with its name and tip SHA.
    - _Requirements: 3.5, 3.8, 3.11, 10.2, 10.3_
  - [ ] 15.5 **[IRREVERSIBLE]** Delete the authorized refs and remove the clean worktrees
    - `git branch -D` each authorized, archive-covered ref; `git worktree remove`
      each authorized worktree that reported zero porcelain lines. Never force-push,
      never rewrite published history, never delete a remote ref, and never remove a
      worktree to satisfy a count.
    - _Requirements: 10.2, 10.4, 10.8_
  - [ ] 15.6 Record the retentions and the resulting git counts
    - Write one retention row per retained ref and worktree with its reason and
      detail, then record the worktree, local branch, and remote branch counts
      against the limits of at most 2 worktrees plus one per retained worktree, at
      most 5 local branches plus one per retained ref, and at most 10 remote
      branches excluding `origin/HEAD`. Record `unmetThresholds` rows rather than
      deleting further.
    - _Requirements: 10.3, 10.6, 10.7, 10.9, 10.10, 10.11, 12.2_
  - [ ] 15.7 Commit stage 10 and run the Stage Gate
    - Apply the Stage Gate procedure.
    - _Requirements: 11.2, 11.3, 11.6_

- [ ] 16. Stage 11 — Contributor_Workflow, README, tool removal, final report
  - [ ] 16.1 Author the Contributor_Workflow
    - One Markdown file of at most 200 lines documenting, in execution order,
      exactly one procedure for each of branch creation, worktree creation with
      `git worktree add`, push to `origin`, pull-request creation, GitHub
      required-check evaluation, merge, and worktree removal with `git worktree
      remove`, naming the Git command or GitHub action for each. Include a recovery
      procedure of at most 3 commands, with no other prerequisite step, that removes
      a worktree whose `git status` exits non-zero and creates a new branch from
      `origin/main`. Name each surviving `.githooks` file by filename. Describe the
      recorded reduced-form replacement of every `constrained` inventory entry.
    - _Requirements: 6.1, 6.2, 6.3, 6.7, 6.9_
  - [ ] 16.2 Author the product and runtime reference and the validation document
    - One reference document covering the Preserved_Route_Set, the surviving
      subsystems, and the Worker_Runtime bindings. One validation document covering
      the Check_Suite command and each check it runs, and stating the
      State_Path_Check's blind spots explicitly: dynamically constructed targets,
      env-var and CLI-argument derived paths, helper indirection, and runtime-built
      child-process argument vectors, so the check is not mistaken for a proof of
      containment.
    - _Requirements: 8.3, 7.4_
  - [ ] 16.3 Rewrite `README.md`
    - At most 200 lines, describing the Preserved_Route_Set, the surviving
      subsystems, and the Contributor_Workflow, containing no path listed in the
      Removal_Manifest.
    - _Requirements: 8.9, 8.10_
  - [ ] 16.4 **[DELETES TRACKED PATHS]** Remove the temporary teardown tooling
    - Delete `scripts/teardown-inventory.mjs`, `scripts/teardown-archive.mjs`,
      `scripts/teardown-route-baseline.mjs`, `scripts/teardown-measure.mjs`, and
      `scripts/teardown-concurrency-trial.mjs`, together with the process property
      tests for Properties 1 through 20 and their unit tests. Keep
      `scripts/state-path-check.mjs`, the permanent route status test, the per-export
      assertions, and Properties 21 and 22. Remove every reference to the deleted
      tools from `package.json`, the surviving workflow, and the surviving documents
      in this same commit. Append the Removal_Manifest entries for this stage.
    - _Requirements: 3.6, 3.7, 6.10, 8.5, 11.7_
  - [ ] 16.5 Take the final measurement and report status
    - Run the final measurement against the final commit with no uncommitted
      tracked modifications, recording that commit SHA. Assert the exit thresholds:
      at most 20 `agent-api/src/` modules, at most 8,000 lines across
      `worker/`+`src/`+`agent-api/src/`, at most 20 `package.json` scripts, at most
      15 `scripts/` files and 3,000 lines, at most 20 `__tests__/` files and 3,000
      lines, at most 12 `docs/*.md` files and 2,500 lines, at most 32,597 lines
      across `scripts/`+`__tests__/`+`docs/*.md`, the four Classification counts
      summing to the entry total, zero `constrained` entries with no reduced form,
      the archive block with its manifest entry count, and all 17 preserved routes
      named as served.
    - Where a threshold is unmet, record `status: "incomplete"` with one
      `unmetThresholds` row per breach carrying the measured and required values,
      and withhold any completion report. Do not delete anything further to meet a
      number. An incomplete report backed by evidence is the correct terminal
      outcome.
    - _Requirements: 5.5, 5.6, 5.7, 6.3, 6.6, 6.9, 6.10, 6.12, 8.1, 9.1, 9.8, 9.9, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9_
  - [ ] 16.6 Commit stage 11 and run the final Stage Gate
    - Apply the Stage Gate procedure. `npm run check` must exit 0 within 600
      seconds with the four members `npm test`, `npm run web:build`, `npm run
      docs:check`, and the State_Path_Check.
    - _Requirements: 8.6, 9.8, 11.2, 11.3, 11.6_

- [ ] 17. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- **Ordering is the substance of this plan.** Epics run in numeric order. Epic 6 is
  a hard gate: no task in epic 9 or later may start until 6.6 records a passing
  rehearsal, because every one of them deletes a tracked path, a ref, or a
  worktree.
- **The 223 lane-lifecycle scripts are unread.** No task assumes what any of them
  does. Task 1.3 builds the tool and task 4.1 produces the evidence; every deletion
  task selects its set from that evidence and retains on ambiguity.
- **Incomplete is a valid outcome.** Tasks 4.6 and 16.5 record unmet thresholds.
  No task widens a deletion set to reach a number, and no task downgrades a
  `constrained` classification.
- **Optional marking.** Only the layer-1 unit-test sub-tasks carry `*`. The
  property tests are not marked optional: Properties 1 through 20 are the gate
  invariants this destructive process depends on, and Properties 21 and 22 are
  required deliverables under Requirement 9 criteria 5 and 6.
- **Tool survival.** Of the six harnesses, only `scripts/state-path-check.mjs`
  survives, because Requirement 7 criterion 6 wires it into the Check_Suite. The
  other five are removed in task 16.4 and therefore do not consume the Requirement
  6 criterion 10 budget of 15 `scripts/` files. They are present in the stage 3
  through 10 commits and will appear in those per-stage Reduction_Report rows; that
  is expected, which is why the budget is asserted only against the final commit.
- **Operator decisions** are recorded at 4.5, 8.1, 8.2, 8.3, 14.4, and 15.2. Each
  surfaces the choice with the evidence and records the answer; none guesses.

## Task Dependency Graph

Waves are strictly ordered: every task in wave N requires every task in waves 0
through N-1 to have completed. Wave 23 is the rehearsal gate; waves 24 and later
contain every destructive task.

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6"] },
    { "id": 1, "tasks": ["1.7", "1.8", "1.9", "1.10", "1.11", "1.12", "1.13", "1.14", "1.15", "1.16", "1.17", "1.18", "1.19", "1.20", "1.21"] },
    { "id": 2, "tasks": ["1.22"] },
    { "id": 3, "tasks": ["2.1", "2.2"] },
    { "id": 4, "tasks": ["2.3"] },
    { "id": 5, "tasks": ["3.1"] },
    { "id": 6, "tasks": ["3.2"] },
    { "id": 7, "tasks": ["3.3"] },
    { "id": 8, "tasks": ["4.1"] },
    { "id": 9, "tasks": ["4.2"] },
    { "id": 10, "tasks": ["4.3"] },
    { "id": 11, "tasks": ["4.4"] },
    { "id": 12, "tasks": ["4.5"] },
    { "id": 13, "tasks": ["4.6"] },
    { "id": 14, "tasks": ["4.7"] },
    { "id": 15, "tasks": ["5.1"] },
    { "id": 16, "tasks": ["5.2"] },
    { "id": 17, "tasks": ["5.3"] },
    { "id": 18, "tasks": ["6.1"] },
    { "id": 19, "tasks": ["6.2"] },
    { "id": 20, "tasks": ["6.3"] },
    { "id": 21, "tasks": ["6.4"] },
    { "id": 22, "tasks": ["6.5"] },
    { "id": 23, "tasks": ["6.6"] },
    { "id": 24, "tasks": ["8.1", "8.2", "8.3"] },
    { "id": 25, "tasks": ["9.1"] },
    { "id": 26, "tasks": ["9.2", "9.3", "9.4", "9.5", "9.6"] },
    { "id": 27, "tasks": ["9.7"] },
    { "id": 28, "tasks": ["9.8"] },
    { "id": 29, "tasks": ["9.9"] },
    { "id": 30, "tasks": ["10.1"] },
    { "id": 31, "tasks": ["10.2"] },
    { "id": 32, "tasks": ["10.3"] },
    { "id": 33, "tasks": ["10.4"] },
    { "id": 34, "tasks": ["10.5"] },
    { "id": 35, "tasks": ["10.6"] },
    { "id": 36, "tasks": ["10.7"] },
    { "id": 37, "tasks": ["11.1"] },
    { "id": 38, "tasks": ["11.2"] },
    { "id": 39, "tasks": ["11.3"] },
    { "id": 40, "tasks": ["11.4"] },
    { "id": 41, "tasks": ["11.5"] },
    { "id": 42, "tasks": ["11.6"] },
    { "id": 43, "tasks": ["13.1"] },
    { "id": 44, "tasks": ["13.2"] },
    { "id": 45, "tasks": ["13.3"] },
    { "id": 46, "tasks": ["13.4"] },
    { "id": 47, "tasks": ["13.5"] },
    { "id": 48, "tasks": ["13.6"] },
    { "id": 49, "tasks": ["14.1"] },
    { "id": 50, "tasks": ["14.2"] },
    { "id": 51, "tasks": ["14.3"] },
    { "id": 52, "tasks": ["14.4"] },
    { "id": 53, "tasks": ["14.5"] },
    { "id": 54, "tasks": ["14.6"] },
    { "id": 55, "tasks": ["15.1"] },
    { "id": 56, "tasks": ["15.2"] },
    { "id": 57, "tasks": ["15.3"] },
    { "id": 58, "tasks": ["15.4"] },
    { "id": 59, "tasks": ["15.5"] },
    { "id": 60, "tasks": ["15.6"] },
    { "id": 61, "tasks": ["15.7"] },
    { "id": 62, "tasks": ["16.1", "16.2", "16.3"] },
    { "id": 63, "tasks": ["16.4"] },
    { "id": 64, "tasks": ["16.5"] },
    { "id": 65, "tasks": ["16.6"] }
  ]
}
```
