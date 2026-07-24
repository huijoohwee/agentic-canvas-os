---
title: "Repository Packing"
graphId: "md:repository-packing"
doc_type: "Runtime Contract"
date: "2026-07-24"
lang: "en-US"
schema: "agentic-repository-packing-contract/v1"
frontmatter_contract: "required"
status: "spec-complete"
invocation: "/repository.pack #repository-packing @repository-root @runtime-proof"
skill_id: "repository.pack"
mcp_tool: "knowgrph.repository.pack"
runtime_owner: "$GITHUB_ROOT/knowgrph/mcp/repository-pack-contract.js; $GITHUB_ROOT/knowgrph/mcp/repository-pack-error.js; $GITHUB_ROOT/knowgrph/mcp/repository-pack-format.js; $GITHUB_ROOT/knowgrph/mcp/repository-pack-git.js; $GITHUB_ROOT/knowgrph/mcp/repository-pack-publisher.js; $GITHUB_ROOT/knowgrph/mcp/repository-pack-runtime.js; $GITHUB_ROOT/knowgrph/mcp/local-tool-contract.js; $GITHUB_ROOT/knowgrph/mcp/os-status-runtime.js; $GITHUB_ROOT/knowgrph/mcp/server.js"
runtime_surface: "local stdio MCP"
publish_policy: "Dev-only; no Prod or Cloudflare authority"
runtime_proof: "RUNTIME-PROOF.md"
external_pattern_source: "https://github.com/yamadashy/repomix"
external_reference_policy: "attribution-only clean-room research"
external_dependency: "forbidden"
---

# Repository Packing

Repository packing creates one deterministic, AI-friendly Markdown artifact from
the eligible text files in one local Git worktree. Agentic Canvas OS owns the
invocation, safety, output, and proof contract. Knowgrph owns the executable
local stdio MCP tool.

## Canonical Invocation

| Surface | Exact identity | Role |
|---|---|---|
| Skill | `repository.pack` | Select this contract on demand. |
| Slash command | `/repository.pack` | Request one bounded pack operation. |
| Semantic route | `#repository-packing` | Classify deterministic repository packing. |
| Root binding | `@repository-root` | Bind one exact local Git worktree root. |
| Proof binding | `@runtime-proof` | Bind the structured result and focused checks. |
| MCP wire tool | `knowgrph.repository.pack` | Execute through Knowgrph local stdio MCP only. |

The exact host alias is
`/repository.pack #repository-packing @repository-root @runtime-proof`.
The slash, hash, and at tokens are host metadata; they are not alternate MCP
method names. `/repomix`, `#repomix`, `@repomix`, and `knowgrph.repomix*` are
unsupported aliases.

## Owner Boundary

| Owner | Owns | Does not own |
|---|---|---|
| Agentic Canvas OS | Invocation truth, request/result shape, safety rules, bounds, validation, and readiness language. | Repository traversal, file reads, artifact writes, MCP transport, or deployment. |
| Knowgrph local MCP | Git-backed discovery, path validation, bounded reads, deterministic rendering, atomic artifact publication, and typed proof. | Invocation dictionaries, external compatibility, model calls, remote repositories, Prod, or Cloudflare. |
| Operator | Selects the repository and output request. | Implicit authority outside the selected root or deployment approval. |

The runtime is local-only. It performs no network request, remote clone, package
installation, model call, tokenization service, compression service, or paid
operation. The executable surface is local stdio MCP only.

## Closed Request

The MCP input schema is closed and accepts only these fields:

| Field | Type | Default | Rule |
|---|---|---|---|
| `repositoryPath` | string | `.` | Repository-relative path under the configured Knowgrph MCP root; it must resolve to an exact Git worktree root. |
| `outputDirectory` | string | `data/outputs/repository-packs` | Repository-relative directory beneath the selected Git worktree; it must remain outside the packed inventory. |
| `includePaths` | array of strings | `[]` | Optional repository-relative file or directory prefixes; empty means every eligible path. |
| `excludePaths` | array of strings | `[]` | Optional repository-relative file or directory prefixes applied after inclusion. |
| `maxFiles` | integer | `12000` | Positive selected-candidate limit applied after include/exclude policy; no greater than `20000`. |
| `maxFileBytes` | integer | `2097152` | Positive and no greater than `8388608`. |
| `maxTotalBytes` | integer | `134217728` | Positive and no greater than `268435456`. |

Unknown fields, absolute paths, URL schemes, NUL or control characters,
backslashes, empty path segments, `.` or `..` segments, duplicate policy paths,
and bounds outside their hard ceilings fail before discovery.

Only `maxFiles`, `maxFileBytes`, and `maxTotalBytes` are caller-lowerable.
Policy-path, normalized-path, output-artifact, runtime, and MCP-response limits
are host-owned and cannot be raised or bypassed through MCP input.

## Deterministic Pipeline

1. Resolve the configured MCP root and requested repository with lexical and
   canonical containment checks.
2. Require `git rev-parse --show-toplevel` to equal that canonical repository.
3. Discover tracked and untracked non-ignored candidates with
   `git ls-files --cached --others --exclude-standard -z`.
4. Normalize repository-relative POSIX paths, deduplicate them, apply closed
   include/exclude prefix policy, enforce the selected-candidate limit after include/exclude policy,
   and sort by UTF-8 bytes.
5. Exclude the output directory and staging files before any source read.
6. Reject root escapes and classify symlinks, submodules, directories,
   non-regular files, sensitive paths, binary files, and over-limit files.
7. Open eligible regular files without following symlinks, read within bounds,
   compute SHA-256, and retain their exact bytes.
8. Revalidate file identity and source digest before publication.
9. Render the original Markdown grammar below and publish with an exclusive temporary file plus atomic no-replace publication.
10. Return only bounded structured metadata through MCP; never return the packed
    source bytes in the tool response.

Git supplies ignore semantics. Repository configuration, hooks, source
instructions, and executable files are treated as inert bytes and are never
loaded or executed by the packer.

## Artifact Grammar

The artifact is UTF-8 Markdown with one final newline and these fixed sections:

1. `Repository Pack Manifest` with schema, revision, normalized numeric bounds
   and policy counts (never policy path values), source-set digest, file and
   byte counts, and omission counts.
2. `Path Index` with every selected candidate and its content state.
3. `Source Records` in canonical byte order.

Each embedded record contains the repository-relative path, source byte count,
SHA-256 digest, and exact text inside a dynamically sized Markdown fence.
Absolute roots, usernames, timestamps, random ids, environment values, and
secrets are forbidden. Binary bytes are never embedded; their path, size,
digest, and typed omission reason remain visible in the path index.
Paths omitted by include/exclude policy are counted in aggregate but never named
in the artifact, path index, or MCP result.

The artifact name is its lowercase SHA-256 digest plus `.md`. An identical
existing artifact is reused. A different artifact is never overwritten under
the same name. Failed, cancelled, unsafe, or over-budget runs leave no
valid-looking partial artifact.

## Omission And Failure Semantics

| Condition | Result |
|---|---|
| Git-ignored path | Not discovered or recorded. |
| Path outside include policy or matched by exclude policy | Counted as policy-excluded in aggregate, but never named or indexed. |
| Binary, invalid UTF-8, or NUL-bearing file | Metadata-only omission; bytes are not embedded. |
| Sensitive path or high-confidence credential | Whole operation blocks before publication and reports only safe relative paths. |
| Symlink, submodule, directory, or special file | Typed omission unless it can escape the root, in which case the operation blocks. |
| Per-file, file-count, total-source, output, or time bound | Whole operation blocks before publication. |
| Concurrent source or root identity change | Whole operation blocks before publication. |
| Existing identical content-addressed artifact | Idempotent reuse with the same digest. |

Failures are structured, path-safe, and source-byte-free. They contain no
absolute path, environment detail, credential fragment, or packed content.

## Closed Result

The tool returns `knowgrph-repository-pack-result/v1` with:

- `ok`, `status`, `tool`, and `invocation`;
- repository-relative `artifactPath`, `artifactSha256`, and `sourceSetSha256`;
- Git revision or an explicit unavailable state;
- discovered, embedded, binary, omitted, file, source-byte, and output-byte
  counts;
- normalized effective bounds and omission counts by reason;
- `reused`, `networkCalls: 0`, `modelCalls: 0`, `inputTokens: 0`,
  `outputTokens: 0`, and `costUsd: 0`.

No result field contains source content. `ok: true` means the content-addressed
artifact is readable and its returned digest matches the published bytes.

## Hard Bounds

| Dimension | Default | Hard ceiling |
|---|---:|---:|
| Selected candidate files | 12000 | 20000 |
| Bytes per embedded file | 2097152 | 8388608 |
| Total embedded source bytes | 134217728 | 268435456 |
| Output artifact bytes | 268435456 | 536870912 |
| Include prefixes | 0 | 256 |
| Exclude prefixes | 0 | 256 |
| Normalized path bytes | 1024 | 1024 |
| Runtime | 60000 ms | 120000 ms |
| MCP response bytes | 65536 | 65536 |

Bounds are checked before publication. A caller can lower only the three
numeric request bounds; host configuration may lower the output and runtime
defaults but can never exceed their hard ceilings.

## Clean-Room Boundary

The high-level goal was researched with reference to
`https://github.com/yamadashy/repomix`. That repository is attribution-only
prior art. No code, prose, prompt, schema, grammar, example, test, fixture,
default, algorithm, asset, package, binary, service, CLI command, generated
artifact, or repository layout is copied, imported, invoked, vendored, or
required.

The implementation has original names, schemas, defaults, output grammar,
fixtures, tests, and algorithms. Removing network access and the external
repository changes neither this contract nor the runtime.
The automated dependency and reserved-name guard is not a similarity detector.
A separate provenance and similarity review is required.

## Validation Contract

Readiness requires all of the following against exact Agentic Canvas OS and
Knowgrph revisions:

- one and only one canonical `/`, `#`, `@`, skill, and MCP identity;
- MCP `tools/list` schema and annotations equal the source contract;
- real stdio invocation creates a verified content-addressed artifact;
- byte-identical replay, canonical ordering, dynamic fence, self-exclusion, and
  source-set digest proof;
- nested ignore, include/exclude, Unicode, empty, binary, and oversized fixture
  proof;
- absolute, traversal, symlink, source-swap, output-swap, secret, file-count,
  per-file, aggregate, output, and time failures leave no partial artifact;
- source files remain unchanged;
- dependency manifests, lockfiles, imports, subprocess targets, and network
  paths contain no forbidden external runtime dependency;
- model calls, network calls, tokens, and cost all equal zero;
- no Prod mirror mutation or Cloudflare deployment.

## VCCs

| VCC | Pass condition |
|---|---|
| Invocation parity | The exact host tuple resolves once through the three dictionaries and facts. |
| MCP parity | `knowgrph.repository.pack` is listed once and its closed schema matches this request. |
| Determinism | An unchanged fixture produces byte-identical artifacts and the same two digests. |
| Containment | Traversal, symlink, root swap, and output escape cases fail closed. |
| Completeness | Every selected candidate is embedded or receives one typed state in the path index; policy-excluded paths are counted without disclosure. |
| Atomicity | Failure leaves no published or staging artifact; replay safely reuses identical output. |
| Confidentiality | Sensitive content blocks publication and tool results never return source bytes. |
| Independence | No external package, binary, service, network path, copied artifact, or runtime fallback exists. |
| Cost | Network, model, token, and cost counters are exactly zero. |
| Deploy | Runtime proof is local Dev proof only and grants no Prod or Cloudflare authority. |
