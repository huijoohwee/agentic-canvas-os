---
title: "Repository Runtime Readiness"
graphId: "md:agentic-repository-runtime-readiness"
doc_type: "Repository Runtime Readiness Contract"
date: "2026-09-05"
lang: "en-US"
schema: "agentic-repository-runtime-readiness/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "bounded read-only source-admission audits for exact local Git worktrees"
runtime_scope: "source-admission audit only; local, browser, integration, deployment, and publication layers remain separate"
runtime_claim: "model-free local evaluator with exact Git identity, bounded metadata-first scanning, typed findings, zero-cost evidence, and fail-closed layer verdicts"
runtime_proof: "RUNTIME-PROOF.md"
invocation:
  action: "/runtime-ready.check"
  semantics: ["#runtime-ready", "#harness", "#vcc", "#foss", "#ttv"]
  bindings: ["@repository-root", "@local-harness", "@runtime-proof"]
guideline_candidate_revision: "5b79529a5c791cdfceed70548543f82358fa100c"
guideline_protected_status: "verified"
reference_source:
  locator: "https://github.com/ava-labs/builders-hub/tree/master"
  revision: "c7714b94b0d7ed2c259d9cbbb272792aa862c12f"
  inspected_at: "2026-07-30T06:00:00Z"
  relationship: "design reference only; no code, prose, prompts, schemas, tests, fixtures, configuration, dependencies, generated content, or repository layout copied"
publish_policy: "Dev-only; no target mutation, target pull request, Prod mirror, or Cloudflare authority"
---

# Repository Runtime Readiness

## Outcome

Agentic Canvas OS now owns an executable source-admission evaluator for one exact local Git worktree:

```text
/runtime-ready.check #runtime-ready #harness #vcc #foss #ttv @repository-root @local-harness @runtime-proof
```

The evaluator is runtime-ready for the `source` layer. It does not run installation, generation, build, browser, provider, testnet, release, or deployment commands. Higher layers remain `unverified` until their own operation-derived receipts are supplied by the owning repository and runtime.

The Builders Hub snapshot is a reference subject, not a dependency or mutation target. Its audit is currently `blocked`, which is the correct runtime result for missing or unjoined proof.

## Source and Clean-Room Boundary

The external snapshot contributes only observable constraints:

- a large browser and server application can combine documentation, APIs, scheduled work, databases, external content, and transaction-bearing flows
- install, generation, build, start, browser, and live-system proof must remain distinct
- responsive source code is not mobile browser proof
- a production deployment event is not candidate browser proof
- an optional live network tier is not deterministic local readiness

All policy, output grammar, code, tests, findings, and recommendations are original repository-owned work. Removing network access and the external repository leaves the evaluator and its focused tests unchanged. A separate human provenance and similarity review remains required before integration.

## Evaluator Contract

```bash
npm run repository-runtime-readiness:audit -- \
  --repository="<exact-local-git-worktree>" \
  --expected-revision="<40-character-commit-sha>" \
  --layer=source \
  --json
```

Inputs are the canonical local Git root, exact expected commit, requested layer, and repository-owned scan bounds.

Outputs:

- schema `agentic-repository-runtime-readiness/v1`
- actual and expected source revisions
- bounded scan counts and typed omissions
- dependency, runtime, configuration, generation, build, start, health, browser, mobile, offline, cost, and dynamic-resolution evidence
- stable reason codes mapped to the existing ADLC finding vocabulary
- independent `source`, `local`, `browser`, `integration`, and `deployed` verdicts
- exact zero model, provider, paid-call, and token cost
- unchanged mutation, network, integration, release, and deployment boundaries

The command exits zero only when the requested supported layer is ready. The first implementation supports a positive `source` verdict; every higher layer is explicitly `unverified`.

## Bounded Discovery

- Resolve the canonical Git root and require the explicit path to equal it
- Enumerate tracked paths from Git and read operational metadata before general content
- Never follow symlinks or read above per-file and aggregate byte caps
- Treat any omission as an incomplete full-repository scan
- Read environment-contract files but never environment values
- Treat package-manager drift, mutable generators, and dynamic tool resolution as evidence gaps rather than executing them
- Keep output secret-free and deterministic for byte-identical inputs

## Builders Hub Snapshot Result

```text
repository: ava-labs/builders-hub
revision: c7714b94b0d7ed2c259d9cbbb272792aa862c12f
requested layer: source
result: blocked
command exit: 1
```

Positive evidence:

- expected Git revision matched and the snapshot was clean
- an immutable dependency-install command exists in pull-request checks
- production build and start scripts exist
- a browser harness exists
- discovery made zero model, provider, paid, integration, release, and deployment calls

Blocking evidence:

| Priority | Reason | Minimum-value recommendation |
|---|---|---|
| P0 | `bounded-scan-incomplete` | Partition runtime owners or raise a declared bounded policy for an intentional full audit |
| P0 | `package-manager-drift` | Use the declared manager consistently across scripts, hooks, CI, and production start |
| P0 | `runtime-version-unpinned` | Add repository-owned runtime metadata and validate it in CI |
| P0 | `configuration-contract-missing` | Add value-free names, build/runtime/public/secret classification, requiredness, validation, and safe failure behavior |
| P0 | `mutable-generation-input` | Separate network refresh from install/build and content-address generated inputs with a stale-safe fallback |
| P1 | `health-contract-missing` | Add cheap process health and a deeper redacted dependency probe |
| P1 | `protected-build-missing` | Run the production build on every protected candidate |
| P1 | `candidate-browser-smoke-missing` | Run deterministic critical-path smoke against each immutable candidate |
| P1 | `mobile-browser-proof-missing` | Add one narrow touch-capable browser project and critical path |
| P1 | `offline-proof-missing` | Test offline or degraded-network behavior, queued state, and recovery |
| P2 | `cost-budget-missing` | Add small bundle, payload, latency, cold-start, and external-call budgets |
| P2 | `dynamic-tool-resolution` | Invoke lockfile-owned tools through the declared package manager |

No target build ran, no environment secret was requested, and no target repository file or pull request changed.

## Solo-Operator Runtime Profile

1. One pinned runtime, package manager, and lock graph.
2. One immutable install and production build on every candidate.
3. One explicit network-generation phase with a content-addressed input manifest and stale-safe local snapshot.
4. One production-like local start from the built artifact, with process and dependency health.
5. One desktop and one narrow mobile critical-path smoke.
6. One offline or degraded-network transition and recovery test.
7. One compact performance and external-call budget.
8. Zero model calls for discovery; AI recommendations load only failed obligations.

Broader browsers, live networks, hosted previews, and paid services remain later optional tiers.

## Zero-Infrastructure Decision

The observed subject is not currently zero-infrastructure: its source includes request-time API routes, persistent database configuration, scheduled work, authentication and secrets, and multiple remote services. A static or browser-only profile can still be extracted for selected public content, but server-backed capabilities retain an explicit runtime owner and TCO.

Default development should prefer FOSS local substitutes, read-only snapshots, or deterministic fixtures. A substitute proves only the local path; it never proves the live service.

## Framework Verification Boundary

The snapshot declares Next.js 16. Current official guidance is used only to validate framework expectations:

- run the production build locally and start its artifact for production-like measurement
- classify public and server-only environment variables because public values can be embedded at build time
- treat cache, image, proxy, streaming, build identity, and multi-instance behavior as deployment concerns
- measure bundle size and Core Web Vitals rather than inferring performance from source

Primary references:

- `https://nextjs.org/docs/app/guides/production-checklist`
- `https://nextjs.org/docs/app/guides/self-hosting`
- `https://nextjs.org/docs/app/guides/package-bundling`

Context7 was attempted first and quota-blocked. Primary official documentation is the fallback evidence source.

## Cross-Repository Dependency Order

The universal guideline is protected at
`5b79529a5c791cdfceed70548543f82358fa100c` through guideline pull request
`#68`. That protected squash revision, rather than its pre-merge task commit,
is the source authority for this adapter.

1. Keep the protected guideline revision and successful guideline checks bound here.
2. Rerun focused evaluator tests, target audit, docs contract, and no-copy review.
3. Integrate Agentic Canvas OS through its protected repository.
4. Advance agentic-graph's exact docs pin in a separately owned downstream scope before MCP or browser parity claims.

No candidate or task head authorizes Prod mirror or Cloudflare action.

## Focused Proof

```bash
npm run repository-runtime-readiness:check
npm run repository-runtime-readiness:audit -- \
  --repository="<reference-worktree>" \
  --expected-revision="c7714b94b0d7ed2c259d9cbbb272792aa862c12f" \
  --layer=source \
  --json
npm run docs:check
```

The reference audit must exit `1` with `ready:false`, `source:blocked`, and higher layers `unverified`. Documentation and invocation contracts must pass.

## VCC

Given one exact local Git worktree, expected revision, requested source layer, and repository-owned bounds, when `/runtime-ready.check #runtime-ready #harness #vcc #foss #ttv @repository-root @local-harness @runtime-proof` runs, then it reads only bounded tracked metadata and text, exposes no secret values, makes zero model/provider/paid calls, changes no repository or external state, emits deterministic typed evidence and parent-vocabulary findings, keeps higher layers unverified without operation-derived receipts, and exits zero only when every source-admission obligation joins to the exact revision.
