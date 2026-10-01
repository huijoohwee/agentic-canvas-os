---
title: "Repository Validation Adapter"
graphId: "md:agentic-repository-validation-adapter"
doc_type: "Runtime Contract"
date: "2026-08-31"
lang: "en-US"
schema: "agentic-repository-validation-policy/v2"
frontmatter_contract: "required"
status: "focused-tested"
authority: "repository-neutral candidate validation with closed adapter selection"
runtime_scope: "deterministic policy sealing, bounded local validation, and unchanged-repository proof"
runtime_claim: "focused tests prove npm-check and Markdown-only git-content validation; call-site integration remains separate"
runtime_owner: "../scripts/repository-validation-adapter.mjs"
runtime_proof: "../__tests__/repository-validation-adapter.test.mjs"
publish_policy: "Dev validation only; no Git, provider, cloud, integration, release, deployment, or cleanup authority"
---
<!-- Responsibility: Define the closed repository-neutral validation policy and result boundary. -->

# Repository validation adapter

## Purpose

`repository-validation-adapter.mjs` separates candidate validation semantics
from package-manager assumptions. It seals one exact repository subject into an
`agentic-repository-validation-policy/v2`, executes one of two closed adapters,
and returns an `agentic-repository-validation-result/v2` receipt only when the
repository remains unchanged.

This primitive does not select a lifecycle lane, admit a writer, create a
commit, update a ref, push, edit a pull request, mutate cloud coordination,
integrate, release, deploy, or clean a worktree. Call-site adoption is a
separate protected change.

## Closed adapter selection

| Adapter | Exact eligible subject | Validation effect |
| --- | --- | --- |
| `npm-check/v1` | Clean postcommit candidate; all entries are candidate Git blobs; the complete recognized manifest set is exactly root `package.json` plus root `package-lock.json`; both manifest modes, blob SHAs, byte digests, and sizes match the policy; `package.json` defines a non-empty `scripts.check`. | Invoke executable `npm` with argv `run`, `check`, `shell:false`, a ten-minute timeout, and bounded captured output. |
| `git-content/v1` | No recognized manifest; every entry is Markdown; either a clean postcommit Git-blob delta or a precommit subject whose base, candidate, and `HEAD` are identical and whose complete dirt is exact untracked working-tree entries. | Read each bounded regular file and require strict UTF-8, no NUL, and no unresolved conflict marker lines. No child validation command runs. |

The adapter registry contains only those two versioned identifiers. There is
no caller-defined command, shell string, manifest alias, extension fallback, or
best-effort adapter. A repository with a partial npm pair, another recognized
manifest, mixed entry sources, or non-Markdown content does not fall back to
`git-content/v1`.

Recognized manifests cover the common root or nested JavaScript, Deno, Python,
Rust, Go, Java, Ruby, and PHP build manifests defined by the runtime. Presence
is derived from the exact candidate tree plus the complete ordinary and ignored
untracked inventories rather than trusted caller metadata.

## Policy contract

Create a policy with:

```js
const policy = buildRepositoryValidationPolicy({
  adapter: "git-content/v1",
  mode: "precommit",
  baseSha,
  candidateSha,
  candidateTreeSha,
  entries: [{
    path: ".kiro/specs/product/requirements.md",
    source: "working-tree",
    mode: "100644",
    blobSha,
    contentDigest,
    size,
  }],
  manifest: null,
});
```

Each entry binds exactly:

- one NFC repository-relative, traversal-free, case-unique path;
- source `git-blob` or `working-tree`;
- regular Git mode `100644` or `100755`;
- the Git blob SHA computed without filters;
- a SHA-256 digest of the raw bytes; and
- the exact byte size.

Entries are sorted by path bytes and sealed with `entriesDigest`. The policy
also seals base commit, candidate commit, candidate tree, adapter, mode, exact
manifest evidence, fixed bounds, structured command or null command, and
`policyDigest`. Normalization reconstructs the whole policy and rejects any
missing, additional, reordered, or drifted field.

Precommit policies intentionally support only the dirty-untracked Markdown
case. Their base and candidate equal exact `HEAD`, their candidate tree equals
`HEAD^{tree}`, every entry source is `working-tree`, and the complete porcelain
status contains only those exact untracked paths. Tracked, staged, deleted,
renamed, ignored-as-evidence, unmerged, or mixed-source work does not enter this
mode. Ignored files are not candidate evidence, but every ignored regular file
must fit the closed fingerprint bounds; an ignored recognized manifest still
blocks `git-content/v1`.

Postcommit policies require a clean worktree, candidate equal exact `HEAD`,
candidate tree equality, base ancestry, and exact equality between the policy
path set and `git diff --name-only --no-renames <base> <candidate>`. Every path
must resolve to one regular candidate blob with the sealed mode, blob SHA,
content digest, and size. Deletion, symlink mode `120000`, gitlink mode `160000`,
or another special mode fails closed.

## Bounds

The v2 policy owns fixed bounds rather than caller-selectable limits:

| Surface | Bound |
| --- | ---: |
| Candidate entries | 256 |
| Bytes per entry or manifest | 1,048,576 |
| Aggregate candidate bytes | 8,388,608 |
| Ignored fingerprint entries | 256 |
| Bytes per ignored file | 1,048,576 |
| Aggregate ignored bytes | 8,388,608 |
| Git command output | 16,777,216 |
| Validation command output | 1,048,576 |
| Command runtime | 600,000 ms |
| Repository-relative path | 1,024 UTF-8 bytes |

Invalid UTF-8, NUL-bearing content, conflict markers, binary content, oversized
files, oversized inventories, malformed paths, case collisions, and output or
runtime overflow are validation failures. Nothing is silently skipped or
truncated.

## Execution and result receipt

Run one sealed policy with:

```js
const result = runRepositoryValidation({ repository, policy });
```

The repository must be an absolute, physical, non-symlink Git worktree root.
The runner observes `HEAD`, tree, porcelain-v2 status, unmerged entries, exact
delta or untracked paths, manifest inventory, modes, blobs, byte digests, and
sizes before validation. Separately, it enumerates every ignored file with
`git ls-files --others --ignored --exclude-standard`, securely reads its mode,
size, and bytes under the same closed file/count/aggregate limits, and seals the
sorted content projection into `ignoredDigest`. Each ignored snapshot is
captured twice and must be stable. The runner repeats the complete observation
after validation; status, `HEAD`, tree, unmerged state, ignored-state digest,
and the complete validation subject must remain identical.

When a changed npm manifest is also a candidate entry, its independently sealed
manifest evidence must equal the observed entry in path, source, mode, blob,
content digest, and size. Candidate-entry validation cannot substitute for or
bypass the manifest binding.

A passed result seals adapter, mode, base, candidate, tree, policy, entry and
manifest digests, adapter-specific validation evidence, equal before/after
invariant digests, and a deterministic `receiptDigest`. It contains no clock,
absolute local path, random value, command output, model result, network claim,
or environment-dependent duration. Re-running an unchanged successful subject
therefore produces the same receipt.

For `npm-check/v1`, the validation evidence records only the exact structured
command, exit code zero, and its deterministic execution digest. A thrown,
nonzero, timed-out, or output-overflow command fails without a passed receipt.
For `git-content/v1`, the evidence records checked entry count, checked byte
count, and a digest of the exact content projection.

## Safety boundary

The runtime invokes only `git` with structured argv for observation and, for
`npm-check/v1`, `npm` with structured argv. It never invokes a shell. Git reads
commits, trees, blobs, status, and hashes working-tree bytes without writing an
object. Working-tree and ignored-file reads reject every symlink component and
root escape, open the final file descriptor with `O_NOFOLLOW`, compare path and
descriptor inode/stat identity, read at most `maxFileBytes + 1`, and revalidate
the path and descriptor before accepting the bytes.

The before/after fence is cooperative repository drift detection, not hostile
process isolation. Persistent changes to ordinary or ignored files cannot
produce equal invariant digests, but a process that mutates and restores exact
state between synchronous observations is outside this primitive's isolation
claim. `npm run check` executes repository-owned code and may have effects
outside the repository that this primitive cannot contain. Production use must
retain the existing sandbox, authority, and release boundaries. A passed
receipt proves only the declared local validation contract for one exact
candidate.

## Focused proof

```sh
node --test __tests__/repository-validation-adapter.test.mjs
```

The focused suite covers deterministic policy and result receipts, structured
npm argv, clean postcommit Markdown validation, dirty-untracked Markdown,
closed path and manifest selection, mixed/code/symlink/submodule/binary/NUL/
invalid-UTF-8/conflict/size rejection, changed-manifest evidence equality,
ignored manifest and same-size ignored-content fencing, bounded file growth,
path-swap rejection, and before/after drift detection. It does not prove
call-site integration, a protected merge, Production readiness, deployment, or
cleanup.
