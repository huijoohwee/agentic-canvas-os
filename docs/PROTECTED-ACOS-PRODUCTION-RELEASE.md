---
title: "Protected ACOS Production Release"
graphId: "md:protected-acos-production-release"
doc_type: "Production Release Contract"
date: "2026-09-03"
lang: "en-US"
schema: "acos-protected-production-release/v1"
frontmatter_contract: "required"
status: "source-ready"
runtime_scope: "agentic-canvas-os Worker and private commerce admission provider only"
runtime_claim: "fail-closed release source and offline adversarial proof; no deployment performed"
---

# Protected ACOS Production Release

`production-release.yml` is the only repository-owned Production mutation
entrypoint for the `agentic-canvas-os` Worker. It does not grant repository
integration, AgenticGraph product deployment, mirror publication, or cleanup
authority.

## Authority sequence

1. A first-attempt `workflow_dispatch` run on protected `main` seals a clean,
   exact `GITHUB_SHA` candidate before any Cloudflare credential is available.
2. The `production-release` job waits on the GitHub `production` environment.
   Its controller reads the authenticated run, job, branch-protection, and
   environment-approval APIs and requires one human `User` approval.
3. Only that environment-gated job receives the Cloudflare mutation token.
4. Wrangler uploads an inactive version with `--strict --keep-vars`, the four
   exact candidate bindings, the predecessor-attested unmanaged-binding digest,
   and the configured `CF_VERSION_METADATA` binding.
5. Version readback must prove one UUID, the digest-derived version tag, source,
   candidate, configuration, storage revision, exact managed binding topology,
   required secrets, version metadata, and the `CommerceAdmissionProbe` named
   export. Any unmanaged baseline bindings must survive byte-canonically. A
   managed predecessor must attest that same digest before upload; only a
   pre-controller predecessor may establish the first bootstrap digest, which
   the deployment receipt labels explicitly.
6. GitHub concurrency plus an immediate active-baseline compare refuses drift.
   Cloudflare does not expose a server-side conditional deployment primitive;
   therefore the controller also verifies the resulting one-version 100%
   deployment and emits preserve-required evidence for any uncertain mutation.
   Both jobs and every Git/Wrangler subprocess have explicit timeouts.
7. The controller seals success only after public readiness and the same
   Worker's bearer-guarded release-proof route. That route uses the owned
   `ctx.exports` loopback Service Binding to reach the private admission route
   and relays only its bounded exact readiness envelope with `no-store`.

The checked-in `2026-07-05` compatibility date is later than the runtime's
`ctx.exports` default date (`2025-11-17`). Current workerd rejects a redundant
`enable_ctx_exports` flag; the focused Wrangler/Miniflare integration therefore
proves the named loopback at the exact checked-in date instead.

The deployment identity has exactly six keys:
`schema`, `sourceRevision`, `candidateDigest`, `versionId`, `versionTag`, and
`versionTimestamp`. `productionReady` belongs only to the readiness envelope.
Missing, placeholder, partial, or extra identity fields are not accepted.

## Failure and recovery

Pre-activation drift makes no activation call. After activation, readiness
failure rolls back to the exact predecessor only when the predecessor's
`ACOS_STORAGE_COMPATIBILITY_REVISION` equals the candidate's value. Missing or
different storage evidence produces an
`acos-production-preserve-required-receipt/v1` and requires forward recovery.
Successful activation and safe rollback produce typed deployment and rollback
receipts respectively. A preserve receipt records an exact observed active
deployment or `unknown`; it never assumes the candidate activated. Storage
compatibility is derived from the predecessor and candidate digests.

## Required external configuration

The source cannot invent these values. The repository or Cloudflare operator
must configure them before a real release:

- GitHub `production` environment with required human reviewers and no bypass
- `CLOUDFLARE_API_TOKEN` scoped to the exact Worker mutation
- `CLOUDFLARE_ACCOUNT_ID`
- `ACOS_PUBLIC_READY_URL`
- one `ACOS_RELEASE_PROBE_TOKEN` value configured both as the Worker's required
  secret and the GitHub Production environment secret
- one non-placeholder printable ASCII 32-256 byte `ACOS_ADMISSION_AUTH_SECRET` shared only with the
  Commerce service-binding signer; it never appears in readiness or receipts
- the two Worker JWT secrets already declared in `wrangler.jsonc`

The checked-in source uses release-controller placeholders. Local and Dev
execution therefore expose `productionReady: false`, a null deployment
identity, and a 503 private provider readiness response.

## Source checks

```bash
npm run commerce-admission-provider:check
npm run production-release:check
npx wrangler deploy --dry-run
npm run docs:check
npm run authored-line-budget:check
git diff --check
```

These commands are source validation. None authorizes or performs a Production
deployment.
