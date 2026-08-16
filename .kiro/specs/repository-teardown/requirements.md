# Requirements Document

## Introduction

This spec covers a subtractive change to the `agentic-canvas-os` repository. The
repository's process machinery has grown far past the product it ships. The goal
is to remove that machinery without losing any shipped capability, and to make
both the preservation and the reduction verifiable rather than asserted.

Every requirement below is about capability preservation, evidence-gated
removal, or measurable reduction. No requirement adds product behavior.

### Baseline_Measurement (measured 2026-08, treat as the reduction denominator)

| Surface | Files | Lines |
|---|---|---|
| `worker/` + `src/` + `agent-api/src/` | 78 | 19,228 |
| `agent-api/src/` modules | 59 | — |
| `scripts/` | 361 | 110,186 |
| `__tests__/` | 296 | 89,206 |
| `docs/*.md` (top level) | 100 | 17,924 |
| `package.json` npm scripts | 116 | — |
| Git worktrees | 15 | — |
| Git refs from `git branch -a` | 392 (306 local) | — |

Naming families inside `scripts/`: 49 `*-contract.mjs`, 30 `*-controller.mjs`,
24 `*-repository-adapter.mjs`, 22 `*-evidence.mjs`, 5 `*-store.mjs`,
2 `*-cli.mjs`. `README.md` uses the word `unverified` 15 times.

### Known risk to resolve, not assume

The 223 lane-lifecycle scripts have not been read individually. A subset may
encode a real constraint that plain Git and GitHub cannot express, for example
concurrent-writer safety across worktrees on one machine, or coordination with
the sibling `knowgrph` monorepo. Requirement 1 and Requirement 2 exist to force
that determination before any deletion. Requirement 3 exists because branch and
worktree deletion is irreversible in places.

## Glossary

- **Repository**: the Git repository rooted at `agentic-canvas-os`.
- **Repository_Root**: the absolute filesystem path of the Repository top level.
- **Shipped_Product**: tracked files under `worker/`, `src/`, `agent-api/src/`, and `web/`.
- **Worker_Runtime**: the Cloudflare Worker defined by `wrangler.jsonc` with entrypoint `worker/index.js`.
- **Preserved_Route_Set**: the exact route list fixed by Requirement 4.
- **Lane_Lifecycle_Layer**: the `device:*` commands, writer leases, parking, claim reconciliation, recovery, disposition, projection, and evidence modules under `scripts/`, together with their tests under `__tests__/` and their documents under `docs/`.
- **Removal_Candidate**: any tracked file under `scripts/`, `__tests__/`, `docs/`, or `agent-api/src/` at the pre-teardown commit.
- **Classification**: exactly one of `redundant`, `constrained`, `dead`, or `retained`.
  - `redundant`: the capability is already provided by Git or GitHub.
  - `constrained`: the capability encodes a constraint Git and GitHub do not express, and must survive in reduced form.
  - `dead`: the capability has no reachable caller and no recorded constraint.
  - `retained`: the file stays in the Repository unchanged in purpose.
- **Capability_Inventory**: a machine-readable record holding one entry per Removal_Candidate.
- **Live_Proof_Record**: `docs/LIVE-REVIEWED-FUNCTION-PROOF.md` or `docs/LIVE-AGENT-PROVIDER-PROOF.md`.
- **Proven_Path**: a module in `agent-api/src/`, `src/`, or `worker/` that is reachable by static import from a Preserved_Route_Set handler, or that a Live_Proof_Record names in its `runtime_owner` or `runtime_proof` frontmatter.
- **Archive_Ref**: an annotated Git tag on the pre-teardown commit, plus a Git bundle containing every ref that the Teardown_Process deletes.
- **Removal_Manifest**: a tracked file listing every path the Teardown_Process deletes, with the pre-teardown blob SHA of each path.
- **Contributor_Workflow**: the single surviving document that describes the branch, worktree, pull-request, required-check, and merge procedure.
- **Process_State_Directory**: one gitignored directory inside Repository_Root that holds all generated process state.
- **External_State_Directory**: the `.agentic-codex/`, `.agentic-recoveries/`, `.agentic-receipts/`, `.agentic-manifests/`, `.agentic-inputs/` directories and the `.agentic-change-manifest-*.json` files in the parent directory of Repository_Root.
- **State_Path_Check**: a repository-owned check that inspects surviving scripts for write targets outside Repository_Root.
- **Check_Suite**: the command bound to `npm run check`.
- **Documentation_Set**: the `*.md` files directly under `docs/`.
- **Teardown_Process**: the ordered sequence of Teardown_Stage units that performs this change.
- **Teardown_Stage**: one ordered unit of the Teardown_Process that ends in a single commit.
- **Reduction_Report**: a tracked file recording Baseline_Measurement and post-teardown counts for each surface.
- **Operator**: the human who authorizes irreversible Git operations.

## Requirements

### Requirement 1: Capability Inventory And Removal Classification

**User Story:** As the repository owner, I want every removal candidate classified against recorded evidence, so that deletion is a decision rather than an assumption.

#### Acceptance Criteria

1. THE Capability_Inventory SHALL contain exactly one entry for every tracked file under `scripts/`, `__tests__/`, `docs/`, and `agent-api/src/` at the pre-teardown commit, keyed by the Repository_Root-relative path of that file.
2. THE Capability_Inventory SHALL assign exactly one Classification to each entry.
3. THE Capability_Inventory SHALL record, for each entry and resolved at the named pre-teardown commit, five evidence lists holding the referencing `package.json` script names, the referencing static imports, the referencing `.github/workflows` job steps, the referencing `.githooks` hooks, and the referencing tracked `*.md` files, recording an explicit empty list for each list that has no member.
4. WHERE an entry has Classification `redundant`, THE Capability_Inventory SHALL name the Git command or GitHub feature that provides the same capability.
5. WHERE an entry has Classification `constrained`, THE Capability_Inventory SHALL record the constraint statement, the evidence that Git and GitHub do not express the constraint, and a reduced-form replacement that names a surviving `scripts/` file, a Git command, a GitHub feature, or a Contributor_Workflow procedure.
6. WHERE an entry has Classification `dead`, THE Capability_Inventory SHALL record an empty list for each of the five evidence lists named in criterion 3.
7. IF an entry records one or more members across the five evidence lists named in criterion 3, THEN THE Capability_Inventory SHALL assign Classification `redundant`, `constrained`, or `retained` to that entry.
8. WHERE a module satisfies the definition of Proven_Path, THE Capability_Inventory SHALL assign Classification `retained`.
9. IF a Removal_Candidate has no Capability_Inventory entry, THEN THE Teardown_Process SHALL retain that Removal_Candidate.
10. IF a Removal_Candidate has Classification `constrained` and no recorded reduced-form replacement, THEN THE Teardown_Process SHALL retain that Removal_Candidate.
11. IF an entry has Classification `redundant` and names no Git command and no GitHub feature, THEN THE Teardown_Process SHALL retain the file that entry keys.
12. IF a reference recorded in one of the five evidence lists named in criterion 3 resolves to no single tracked file, THEN THE Capability_Inventory SHALL assign Classification `retained` to the entry holding that reference.
13. WHEN the Capability_Inventory is complete, THE Capability_Inventory SHALL record the count of entries per Classification for each of `scripts/`, `__tests__/`, `docs/`, and `agent-api/src/`, and the four Classification counts for a directory SHALL sum to the count of tracked files under that directory at the pre-teardown commit.

### Requirement 2: Cross-Repository And Concurrency Constraint Evidence

**User Story:** As the repository owner, I want the concurrency and cross-repository claims of the lifecycle layer tested before removal, so that a real constraint is not deleted along with the ceremony around it.

#### Acceptance Criteria

1. THE Capability_Inventory SHALL record, for every Lane_Lifecycle_Layer entry, an explicit true or false value for whether the entry reads or writes any path outside Repository_Root, and WHERE that value is true SHALL record each such path with the file and line number of the read or write.
2. THE Capability_Inventory SHALL record, for every Lane_Lifecycle_Layer entry, an explicit true or false value for whether the entry invokes the sibling `knowgrph` repository, a `knowgrph` MCP endpoint, or a `knowgrph` runtime command, and WHERE that value is true SHALL record each invoked path or command with the file and line number of the invocation.
3. THE Capability_Inventory SHALL record, for every Lane_Lifecycle_Layer entry, either the shared resource that the entry protects by acquiring, holding, and releasing a lock, a lease, a claim, or a parking record, with the file and line number of each acquire and each release and the name of any Git or GitHub mechanism that protects the same resource, or an explicit statement that the entry operates no such mechanism.
4. IF the trial defined in criterion 10 records for a Lane_Lifecycle_Layer entry a protected resource state or an exit status with the mechanism bypassed that differs from the protected resource state or the exit status with the mechanism active, THEN THE Capability_Inventory SHALL assign Classification `constrained` to that entry.
5. WHERE a Lane_Lifecycle_Layer entry encodes a constraint of another kind that Git and GitHub do not express, THE Capability_Inventory SHALL assign Classification `constrained` to that entry and SHALL record the constraint kind and the observable failure that occurs when the constraint is unenforced.
6. IF a Lane_Lifecycle_Layer entry invokes the sibling `knowgrph` repository, THEN THE Capability_Inventory SHALL assign Classification `constrained` to that entry where the entry records one or more members across the five evidence lists named in Requirement 1 criterion 3, and SHALL assign Classification `dead` to that entry where the entry records an empty list for each of those five evidence lists.
7. THE Capability_Inventory SHALL record an explicit true or false value for whether any tracked file in the sibling `knowgrph` repository reads the External_State_Directory, together with the count of such files and the path of each such file.
8. IF a tracked file in the sibling `knowgrph` repository reads the External_State_Directory, THEN THE Teardown_Process SHALL record the replacement source for that read in the Capability_Inventory entry for the read path before the Teardown_Stage that removes the External_State_Directory.
9. IF the replacement source for a sibling-repository read cannot be determined, or the criterion 7 read determination is marked undetermined under criterion 12, THEN THE Teardown_Process SHALL record a warning in the Reduction_Report naming the reading file or the checked path and SHALL continue.
10. WHERE the Capability_Inventory records under criterion 3 that a Lane_Lifecycle_Layer entry operates a lock, a lease, a claim, or a parking record, THE Teardown_Process SHALL run a trial of two concurrent writers on one machine in two Git worktrees within the same 5-second window, comprising at least 3 runs with the mechanism active and at least 3 runs with the mechanism bypassed, and SHALL record the protected resource state and the exit status of each run.
11. IF the trial defined in criterion 10 records the same protected resource state and the same exit status with the mechanism bypassed as with the mechanism active, THEN THE Capability_Inventory SHALL record for that entry no concurrency ground for Classification `constrained`.
12. IF the sibling `knowgrph` repository is absent from the checked path, THEN THE Capability_Inventory SHALL record the absent-repository condition and the checked path and SHALL mark the criterion 7 read determination as undetermined.

### Requirement 3: Reversible Archive Before Removal

**User Story:** As the repository owner, I want every deletion recoverable from a pushed reference, so that a wrong classification costs a restore rather than the work.

#### Acceptance Criteria

1. THE Archive_Ref bundle SHALL contain one entry for every ref reported by `git branch -a` at the time the Teardown_Process starts, recording the ref name and the pre-teardown tip SHA of that ref, and the entry count SHALL equal the Baseline_Measurement ref count of 392.
2. WHEN the Teardown_Process starts, THE Teardown_Process SHALL push the Archive_Ref tag to the `origin` remote before the first deletion commit.
3. IF the Archive_Ref push to `origin` returns a non-zero exit status, or `git ls-remote --tags origin` does not report the Archive_Ref tag at the local Archive_Ref tag SHA, THEN THE Teardown_Process SHALL stop before the first deletion commit.
4. IF the Archive_Ref push to `origin` returns a non-zero exit status after the Teardown_Process has created the Archive_Ref tag or the Archive_Ref bundle, THEN THE Teardown_Process SHALL delete the locally created Archive_Ref tag and the locally created Archive_Ref bundle and SHALL stop with HEAD at the pre-teardown commit and with `git status --porcelain` reporting zero lines.
5. IF `git bundle verify` on the Archive_Ref bundle exits with a non-zero status, or the Archive_Ref bundle omits a ref or a path that a Teardown_Stage is about to delete, or `git ls-remote --tags origin` no longer reports the Archive_Ref tag at the local Archive_Ref tag SHA, THEN THE Teardown_Process SHALL stop and SHALL record the detected condition in the Reduction_Report.
6. THE Removal_Manifest SHALL list every deleted path with the pre-teardown blob SHA of that path.
7. WHEN a Teardown_Stage commit deletes one or more tracked paths, THE Teardown_Process SHALL add every path that commit deletes to the Removal_Manifest in that same commit, so that the count of Removal_Manifest entries added by that commit equals the count of tracked paths that commit deletes.
8. WHEN the Teardown_Process reaches deletion of a Git branch, THE Teardown_Process SHALL verify that the Archive_Ref bundle already lists that branch name and tip SHA before performing that deletion.
9. WHEN the Teardown_Process reaches removal of the External_State_Directory, THE Teardown_Process SHALL verify that the Archive_Ref bundle contains a ref whose committed tree holds the External_State_Directory contents with blob SHAs identical to the pre-removal blob SHAs before performing that removal.
10. WHEN the Teardown_Process reaches a Git branch deletion, a worktree removal, or an External_State_Directory removal, THE Teardown_Process SHALL require recorded Operator authorization naming the exact refs and paths before performing that operation.
11. WHEN the Teardown_Process reaches removal of a Git worktree, THE Teardown_Process SHALL verify that the Archive_Ref bundle records that worktree path and the HEAD SHA of that worktree before performing that removal.
12. IF `git status --porcelain` run in a Git worktree selected for removal reports one or more lines, THEN THE Teardown_Process SHALL stop before removing that worktree and SHALL record the worktree path and the reported line count in the Reduction_Report.
13. IF the recorded Operator authorization for a Git branch deletion, a worktree removal, or an External_State_Directory removal names a set of refs and paths that differs from the set of refs and paths the operation targets, THEN THE Teardown_Process SHALL stop before performing that operation and SHALL record the authorized set and the targeted set in the Reduction_Report.

### Requirement 4: Worker Runtime Contract Preservation

**User Story:** As a consumer of the deployed Worker, I want the shipped request contract unchanged, so that the teardown is invisible from outside the Repository.

#### Acceptance Criteria

1. THE Preserved_Route_Set SHALL consist of exactly these 17 method-and-path pairs: `GET /`, `POST /api/auth/session`, `POST /auth/session`, `POST /api/invoke`, `POST /invoke`, `POST /api/run`, `POST /run`, `GET /api/ready`, `GET /ready`, `GET /api/canvas/room`, `GET /canvas/room`, `POST /api/function-call`, `POST /function-call`, `POST /api/function-call/recover`, `POST /function-call/recover`, `POST /api/function-call/resume`, and `POST /function-call/resume`.
2. WHEN the post-teardown Worker_Runtime receives a request from the request corpus fixed by criterion 14 in the environment fixed by criterion 14, THE Worker_Runtime SHALL return the HTTP status code that the recorded pre-teardown response baseline holds for that identical request.
3. WHEN the post-teardown Worker_Runtime receives a request whose path matches a Preserved_Route_Set path and whose method differs from every method paired with that path in criterion 1, THE Worker_Runtime SHALL return status 405 and SHALL leave stored state unchanged.
4. WHEN the post-teardown Worker_Runtime receives a `GET /api/ready` request, THE Worker_Runtime SHALL return a payload containing the keys `configured`, `auth`, `controlPlane`, `modelProviders`, and `functionCalling`.
5. WHEN the post-teardown Worker_Runtime evaluates readiness, THE Worker_Runtime SHALL derive the `auth`, `controlPlane`, and `modelProviders` values from the environment bindings present in the current environment, SHALL report false for a value whose binding is absent, and SHALL report `configured` as true only where `auth`, `controlPlane`, and `modelProviders` are each true.
6. WHEN the post-teardown readiness result differs from the pre-teardown readiness result for an identical environment, THE Reduction_Report SHALL record the differing key and the reason for the difference.
7. WHERE the Teardown_Process removes a subsystem that none of the `configured`, `auth`, `controlPlane`, `modelProviders`, and `functionCalling` readiness keys reports, THE Worker_Runtime SHALL generate no readiness key for that subsystem.
8. THE `wrangler.jsonc` file SHALL retain the `CANVAS_ROOM` and `AGENT_STATE` Durable Object bindings and the `v1-canvas-room` and `v2-agent-state` migration tags in the top-level configuration and in every named environment block that declares Durable Object bindings or migration tags.
9. THE `wrangler.jsonc` file SHALL retain the `AGENT_API_JWT_SECRET` and `AGENT_REVIEW_JWT_SECRET` required-secret declarations in the top-level configuration and in every named environment block that declares required secrets.
10. THE `wrangler.jsonc` `run_worker_first` list SHALL contain a literal entry or a glob entry that matches every Preserved_Route_Set path other than `/`, and SHALL contain no entry that matches `/`.
11. IF a Removal_Candidate is reachable from a Preserved_Route_Set handler through a chain of one or more static imports, THEN THE Teardown_Process SHALL retain that Removal_Candidate.
12. WHEN the Teardown_Process completes, THE Repository SHALL contain a test that the Check_Suite invokes and that asserts one request and one expected status code for each of the 17 Preserved_Route_Set method-and-path pairs.
13. THE Capability_Inventory SHALL record exactly one Classification for the `POST /api/agent/run` route, citing that `docs/LIVE-AGENT-PROVIDER-PROOF.md` proves the composed-agent modules through a Node harness while `README.md` states the shipped Worker keeps autonomous execution off.
14. THE Teardown_Process SHALL record the pre-teardown response baseline before the first deletion commit by sending, against the pre-teardown Worker_Runtime in one named environment, a fixed request corpus holding at least one request with recorded headers and body for each of the 17 Preserved_Route_Set method-and-path pairs, and SHALL record the returned status code of each request in a tracked file together with the name of that environment.
15. WHERE one of the `configured`, `auth`, `controlPlane`, `modelProviders`, and `functionCalling` readiness keys reports a subsystem, THE Teardown_Process SHALL retain that subsystem.
16. WHEN the Teardown_Process removes the `POST /api/agent/run` route, THE Teardown_Process SHALL remove the `POST /agent/run` unprefixed alias and every `wrangler.jsonc` `run_worker_first` entry that matches `/api/agent/run` or `/agent/run` in the same Teardown_Stage.

### Requirement 5: Agent-API Surface Reduction To Proven Paths

**User Story:** As a maintainer, I want `agent-api/src/` to contain only paths with a live caller or a live proof, so that the module count reflects working capability.

#### Acceptance Criteria

1. THE Capability_Inventory SHALL record, for each of the 59 `agent-api/src/` modules, whether the module satisfies the definition of Proven_Path, and SHALL cite for each satisfying module either the Preserved_Route_Set handler path whose static import chain reaches it or the Live_Proof_Record and the `runtime_owner` or `runtime_proof` frontmatter entry that names it.
2. WHERE an `agent-api/src/` module implements a subsystem that `README.md` reports as `configured: false`, IF no Live_Proof_Record names that module and the Capability_Inventory records a constraint statement for that module, THEN THE Capability_Inventory SHALL assign Classification `constrained` to that module.
3. WHEN the Teardown_Process removes an `agent-api/src/` module, THE Teardown_Process SHALL remove, in the same Teardown_Stage, every route handler, readiness key, `package.json` script, test file, and `docs/` or `README.md` passage that references the removed module by static import or by module path.
4. WHERE a Teardown_Stage removes no `agent-api/src/` module, THE Teardown_Process SHALL permit removal of route handlers, readiness keys, `package.json` scripts, test files, and documents that reference no surviving `worker/`, `src/`, or `agent-api/src/` module and no Preserved_Route_Set route.
5. WHEN the Teardown_Process completes, THE `agent-api/src/` directory SHALL contain at most 20 modules, counting each tracked `.js` file at any depth under `agent-api/src/` as one module.
6. IF the `agent-api/src/` module count after the final Teardown_Stage exceeds 20, THEN THE Teardown_Process SHALL record that count and an incomplete status in the Reduction_Report and SHALL withhold any completion report.
7. WHEN the Teardown_Process completes, THE `worker/`, `src/`, and `agent-api/src/` directories SHALL contain at most 8,000 lines in total across their tracked files, counted by the method that produced the Baseline_Measurement total of 19,228 lines.
8. WHEN the Teardown_Process completes, THE Repository SHALL resolve every static import in `worker/`, `src/`, and `agent-api/src/` to an existing tracked file.
9. WHERE the Teardown_Process removes the only `worker/`, `src/`, or `agent-api/src/` module that reads a `wrangler.jsonc` variable, THE Teardown_Process SHALL remove that variable declaration in the same Teardown_Stage.
10. THE Capability_Inventory SHALL name the `agent-api/src/` modules that implement each of the Agent Swarm, Agent Toolkit, Agent Orchestration, Agent Runtime Composition, Progressive Agents, Tool Search, Programmatic Tool Calling, Sandbox Agents, Agent Definitions, Autonomous Runtime, and Application Composition subsystems that `README.md` reports as `configured: false`.
11. WHERE an `agent-api/src/` module implements a subsystem that `README.md` reports as `configured: false`, IF no Live_Proof_Record names that module and the Capability_Inventory records no constraint statement for that module, THEN THE Capability_Inventory SHALL assign Classification `dead` to that module.
12. IF a Teardown_Stage leaves a static import in `worker/`, `src/`, or `agent-api/src/` unresolved to an existing tracked file, THEN THE Teardown_Process SHALL revert that Teardown_Stage and SHALL record the unresolved import and the removed module in the Reduction_Report.

### Requirement 6: Plain Git And GitHub Contributor Workflow Replacement

**User Story:** As a contributor, I want one short documented workflow built on Git and GitHub primitives, so that recovering from a broken worktree does not require a recovery subsystem.

#### Acceptance Criteria

1. THE Contributor_Workflow SHALL document, in execution order, exactly one procedure for each of the seven steps branch creation, worktree creation with `git worktree add`, push to `origin`, pull-request creation, GitHub required-check evaluation, merge, and worktree removal with `git worktree remove`, and SHALL name the Git command or the GitHub action that performs each step.
2. THE Contributor_Workflow SHALL document, for a worktree in which `git status` exits with a non-zero status, a recovery procedure of at most 3 commands with no other prerequisite step that removes that worktree and creates a new branch from `origin/main`.
3. THE Contributor_Workflow SHALL be a single Markdown file of at most 200 lines.
4. WHEN the Teardown_Process completes, THE `package.json` scripts object SHALL contain no key that matches `device:*`, `runtime:session:*`, `turn:end`, `canonical:main:*`, `workspace:legacy-*`, `worktree:lifecycle:*`, `lifecycle:conformance*`, `history:lifecycle*`, `alignment-audit:*`, or `agentic-sdlc:*`.
5. WHILE the Teardown_Process is in progress and the Teardown_Stage that removes the Lane_Lifecycle_Layer has not completed, THE `package.json` scripts object SHALL retain every `device:*` key with the command string that key held at the pre-teardown commit.
6. WHEN the Teardown_Process completes, THE `package.json` scripts object SHALL contain at most 20 entries.
7. WHERE a Capability_Inventory entry has Classification `constrained`, THE Contributor_Workflow SHALL describe the reduced-form replacement that the Capability_Inventory records for that entry under Requirement 1 criterion 5.
8. THE Repository SHALL retain exactly one GitHub Actions workflow that runs the Check_Suite on every pull request targeting `main`.
9. WHEN the Teardown_Process completes, THE `.githooks` directory SHALL contain at most 2 hook files counted recursively, and THE Contributor_Workflow SHALL name each surviving hook file by filename.
10. WHEN the Teardown_Process completes, THE `scripts/` directory SHALL contain at most 15 tracked files counted recursively and at most 3,000 lines totalled across those tracked files.
11. IF the Check_Suite exits with a non-zero status on a pull request targeting `main`, THEN THE Repository SHALL report a failed check on that pull request and SHALL leave that pull request unmerged.
12. IF a measured value exceeds a completion limit stated in criterion 3, criterion 6, criterion 9, or criterion 10, THEN THE Teardown_Process SHALL report the Teardown_Process as incomplete and SHALL record the exceeded limit and the measured value in the Reduction_Report.

### Requirement 7: Repository-Contained Process State

**User Story:** As the owner of sibling repositories, I want this Repository to stop writing into its parent directory, so that unrelated repositories are not downstream of this Repository's process state.

#### Acceptance Criteria

1. THE Repository SHALL contain exactly one Process_State_Directory, located directly under Repository_Root.
2. THE `.gitignore` file SHALL contain an entry that excludes the Process_State_Directory and every path under it from version control.
3. WHERE a surviving script persists generated process state, THE surviving script SHALL resolve every write target of that state to a path under the Process_State_Directory.
4. WHEN the State_Path_Check inspects every tracked file under `scripts/` and `.githooks` and finds the first file that resolves a write target outside Repository_Root, THE State_Path_Check SHALL report that file path and the resolved write target and SHALL exit immediately with a non-zero status.
5. WHEN the State_Path_Check finishes inspecting every tracked file under `scripts/` and `.githooks` without finding a write target outside Repository_Root, THE State_Path_Check SHALL exit with status 0.
6. THE Check_Suite SHALL invoke the State_Path_Check on every run.
7. IF the State_Path_Check exits with a non-zero status, THEN THE Check_Suite SHALL exit with a non-zero status.
8. WHEN the Teardown_Process completes, THE parent directory of Repository_Root SHALL contain zero directories and zero files that the definition of External_State_Directory names.
9. IF a Capability_Inventory entry with Classification `retained` or `constrained` reads state held in the External_State_Directory, THEN THE Teardown_Process SHALL move that state under the Process_State_Directory before removing the External_State_Directory.
10. IF a move of External_State_Directory state under the Process_State_Directory returns a non-zero exit status, THEN THE Teardown_Process SHALL retain the External_State_Directory, SHALL stop before the removal, and SHALL record the unmoved path in the Reduction_Report.

### Requirement 8: Documentation Set Reduction

**User Story:** As a contributor, I want a small canonical document set, so that reading the docs takes minutes and the docs describe the shipped product.

#### Acceptance Criteria

1. WHEN the Teardown_Process completes, THE Documentation_Set SHALL contain at most 12 files and at most 2,500 lines totalled across those files.
2. THE Documentation_Set SHALL retain `docs/LIVE-REVIEWED-FUNCTION-PROOF.md` and `docs/LIVE-AGENT-PROVIDER-PROOF.md`.
3. THE Documentation_Set SHALL retain the Contributor_Workflow, exactly one product and runtime reference document that covers the Preserved_Route_Set, the surviving subsystems, and the Worker_Runtime bindings, and exactly one validation document that covers the Check_Suite command and each check the Check_Suite runs.
4. WHEN the Teardown_Process completes, THE Documentation_Set SHALL contain no file whose Capability_Inventory entry holds Classification `redundant` or `dead` and whose filename names an individual lifecycle episode, claim episode, recovery episode, projection episode, or disposition episode.
5. WHEN the Teardown_Process removes a document, THE Teardown_Process SHALL remove every reference to the removed document in `docs/`, `README.md`, `package.json`, `scripts/`, and `.github/workflows/` in the same Teardown_Stage.
6. WHEN `npm run docs:check` runs at the commit that completes the Teardown_Process, THE `scripts/docs-contract.mjs` file SHALL validate only the surviving Documentation_Set files and SHALL exit with status 0.
7. WHERE the surviving Documentation_Set holds no file that an imported validator of `scripts/docs-contract.mjs` targets, THE `scripts/docs-contract.mjs` file SHALL exit with status 0.
8. WHEN the Teardown_Process removes a document that one of the 12 validator imports of `scripts/docs-contract.mjs` validates, THE Teardown_Process SHALL remove that validator import and every call site of that validator in `scripts/docs-contract.mjs` in the same Teardown_Stage.
9. WHEN the Teardown_Process completes, THE `README.md` file SHALL describe the Preserved_Route_Set, the surviving subsystems, and the Contributor_Workflow, and SHALL contain no path listed in the Removal_Manifest.
10. WHEN the Teardown_Process completes, THE `README.md` file SHALL fit within 200 lines.
11. IF an imported validator of `scripts/docs-contract.mjs` targets a `docs/` path that the surviving Documentation_Set does not hold, THEN THE `scripts/docs-contract.mjs` file SHALL report that path and SHALL exit with a non-zero status.
12. WHEN a Teardown_Stage commit removes a Documentation_Set file, THE Check_Suite SHALL exit with status 0 at that commit.

### Requirement 9: Test Suite Reduction With Preserved Coverage

**User Story:** As a maintainer, I want the surviving tests to cover the surviving behavior, so that the reduction removes ceremony rather than confidence.

#### Acceptance Criteria

1. WHEN the Teardown_Process completes, THE `__tests__/` directory SHALL contain at most 20 tracked files and at most 3,000 lines.
2. WHEN the Teardown_Process completes, THE `__tests__/` directory SHALL resolve every static import in every tracked file to a file tracked in the post-teardown commit.
3. WHEN the Teardown_Process completes, THE `__tests__/` directory SHALL contain, for every Preserved_Route_Set route, at least one assertion on the HTTP status code that the Worker_Runtime returns for one request to that route.
4. WHEN the Teardown_Process completes, THE `__tests__/` directory SHALL contain, for every exported function of every surviving `agent-api/src/` module, at least one assertion on the value that function returns or on the error that function throws.
5. WHEN the Teardown_Process completes, THE `__tests__/` directory SHALL contain a round-trip property test that asserts, over at least 100 generated claim sets, that decoding an encoded session token yields claims equal field-for-field to the encoded claims.
6. WHEN the Teardown_Process completes, THE `__tests__/` directory SHALL contain a round-trip property test that asserts, over at least 100 generated valid MCP request and response values, that parsing the serialized form of a value yields a value equal field-for-field to the value before serialization.
7. WHEN the Teardown_Process removes a source module, THE Teardown_Process SHALL remove, in the same Teardown_Stage, every test file whose static imports of Repository source modules resolve only to modules that the Teardown_Process removes.
8. WHEN the Teardown_Process completes, THE Check_Suite SHALL exit with status 0 within 600 seconds.
9. IF the Check_Suite fails to start or does not exit within 600 seconds, THEN THE Teardown_Process SHALL report the Teardown_Process as incomplete and SHALL record the start or timeout failure in the Reduction_Report.
10. IF a test file statically imports both a module that the Teardown_Process removes and a surviving module, THEN THE Teardown_Process SHALL remove that file's imports of and assertions on the removed module in the same Teardown_Stage.
11. WHEN the Teardown_Process completes, THE `__tests__/` directory SHALL contain no test file that exercises the Lane_Lifecycle_Layer, including the 25 `alignment-audit-property-NN.test.mjs` files.
12. IF a static import in `__tests__/` resolves to no file tracked in the post-teardown commit, THEN THE Teardown_Process SHALL report the Teardown_Process as incomplete and SHALL record the unresolved import and its containing file in the Reduction_Report.

### Requirement 10: Git Branch And Worktree Cleanup

**User Story:** As the repository owner, I want the Git state reduced to what is in flight, so that branch and worktree listings are readable.

#### Acceptance Criteria

1. THE Capability_Inventory SHALL record, for every ref reported by `git branch -a` at the time the Teardown_Process starts, the ref name, the ref tip SHA, whether `origin/main` contains that tip, and whether a Git worktree has that ref checked out.
2. WHEN the Teardown_Process selects for deletion a ref whose tip `origin/main` does not contain, THE Teardown_Process SHALL verify, before deleting that ref, that the Archive_Ref bundle lists that tip SHA.
3. IF the Archive_Ref bundle does not list the tip SHA of a ref selected for deletion, THEN THE Teardown_Process SHALL retain that ref and SHALL record the retained ref name and tip SHA in the Reduction_Report.
4. WHEN the Teardown_Process selects a Git worktree for removal, THE Teardown_Process SHALL verify, before removing that worktree, that `git status --porcelain` run in that worktree reports zero lines.
5. IF `git status --porcelain` run in a Git worktree selected for removal reports one or more tracked modifications or staged changes, THEN THE Teardown_Process SHALL push that worktree branch to `origin` before removing that worktree.
6. IF a push of a worktree branch to `origin` returns a non-zero exit status, THEN THE Teardown_Process SHALL retain that worktree and that branch and SHALL record the worktree path and branch name in the Reduction_Report.
7. IF `git status --porcelain` run in a Git worktree selected for removal reports one or more untracked files, THEN THE Teardown_Process SHALL retain that worktree and SHALL record the worktree path and the untracked file count in the Reduction_Report.
8. THE Teardown_Process SHALL retain `main`, `origin/main`, the Archive_Ref tag, and every ref that a retained worktree has checked out.
9. WHEN the final Teardown_Stage commit completes, THE Repository SHALL report at most 2 entries from `git worktree list`, counting the main worktree, plus one further permitted entry for each worktree retained under criterion 6 or criterion 7.
10. WHEN the final Teardown_Stage commit completes, THE Repository SHALL report at most 5 entries from `git branch`, counting the currently checked-out branch, plus one further permitted entry for each ref retained under criterion 3, criterion 6, or criterion 8.
11. WHEN the final Teardown_Stage commit completes, THE Repository SHALL report at most 10 entries from `git branch -r`, excluding the `origin/HEAD` entry.

### Requirement 11: Staged Execution With A Passing Check Suite

**User Story:** As the repository owner, I want the teardown to advance in reviewable stages that each leave the Repository working, so that a mistake is isolated to one stage.

#### Acceptance Criteria

1. THE Teardown_Process SHALL order Teardown_Stage units so that the Teardown_Stage that produces the Capability_Inventory and the Teardown_Stage that produces the Archive_Ref both precede every Teardown_Stage that deletes a tracked path.
2. WHEN a Teardown_Stage ends, THE Teardown_Process SHALL produce exactly one commit containing every file change of that Teardown_Stage and SHALL leave zero uncommitted tracked changes before running the Check_Suite.
3. WHEN the Teardown_Stage commit exists, THE Teardown_Process SHALL run the Check_Suite with that commit as the checked-out HEAD and SHALL start no later Teardown_Stage until that Check_Suite run exits.
4. IF the Check_Suite exits with a non-zero status at a Teardown_Stage boundary, THEN THE Teardown_Process SHALL revert that Teardown_Stage commit in a single revert commit before starting the next Teardown_Stage.
5. THE Teardown_Process SHALL place deletion of tracked files under `worker/`, `src/`, or `agent-api/src/` and deletion of tracked files under `scripts/` in separate Teardown_Stage units.
6. WHEN a Teardown_Stage ends, THE Teardown_Process SHALL update the Reduction_Report in that Teardown_Stage commit with the file count and line count of `worker/` plus `src/` plus `agent-api/src/`, of `scripts/`, of `__tests__/`, and of `docs/*.md` measured on that commit's tree.
7. WHEN a Teardown_Stage deletes a tracked path, THE Teardown_Process SHALL remove in that same commit every reference that resolves to the deleted path in a file the Check_Suite executes, including static imports, `package.json` script entries, and imported validator registrations.
8. WHEN the Teardown_Process reverts a Teardown_Stage commit, THE Teardown_Process SHALL run the Check_Suite on the revert commit and SHALL start the next Teardown_Stage only if that run exits with status 0.
9. IF the Check_Suite exits with a non-zero status on a revert commit, THEN THE Teardown_Process SHALL stop and SHALL record the reverted Teardown_Stage in the Reduction_Report.

### Requirement 12: Measurable Exit Criteria

**User Story:** As the repository owner, I want the reduction reported as measured counts, so that completion is a number rather than a judgement.

#### Acceptance Criteria

1. THE Reduction_Report SHALL record, for each of `worker/` plus `src/` plus `agent-api/src/`, `scripts/`, `__tests__/`, and top-level `docs/*.md`, the Baseline_Measurement file count and line count, the post-teardown file count and line count, and the percent reduction of each, where the file count counts only the tracked files reported by `git ls-files` for that surface and the line count counts every line of those files including blank and comment lines.
2. THE Reduction_Report SHALL record the Baseline_Measurement value and the post-teardown value for the `package.json` script count, the `agent-api/src/` module count, the worktree count from `git worktree list`, the local branch count from `git branch`, and the remote branch count from `git branch -r`.
3. THE Reduction_Report SHALL record the count of Capability_Inventory entries for each of the four Classification values, recording zero where no entry holds that value, and SHALL record a total that equals the number of Capability_Inventory entries.
4. WHEN the Teardown_Process completes, THE Reduction_Report SHALL record a post-teardown total line count of at most 32,597 lines for `scripts/` plus `__tests__/` plus `docs/*.md`, being a reduction of at least 85 percent from the Baseline_Measurement total of 217,316 lines for those three surfaces.
5. WHEN the Teardown_Process completes, THE Reduction_Report SHALL name every route in the Preserved_Route_Set as served by the post-teardown Worker_Runtime, and the recorded served-route count SHALL equal the Preserved_Route_Set route count fixed by Requirement 4.
6. WHEN the Teardown_Process completes, THE Reduction_Report SHALL record a count of zero for Capability_Inventory entries that hold Classification `constrained` with no recorded reduced-form replacement.
7. WHEN the Teardown_Process completes, THE Reduction_Report SHALL record the Archive_Ref tag name, the Archive_Ref bundle path, the Removal_Manifest path, and the count of paths listed in the Removal_Manifest.
8. WHEN the final Teardown_Stage commit exists, THE Teardown_Process SHALL take every post-teardown measurement recorded in the Reduction_Report against that commit with no uncommitted tracked modifications present, using the counting method stated in criteria 1 and 2, and SHALL record that commit SHA in the Reduction_Report.
9. IF a post-teardown measurement recorded in the Reduction_Report does not satisfy an exit threshold stated in this requirement, THEN THE Teardown_Process SHALL report the Teardown_Process as incomplete and SHALL record, for each unsatisfied threshold, the measured value and the required value.
