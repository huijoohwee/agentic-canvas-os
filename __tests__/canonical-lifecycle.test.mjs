import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const lifecycle = fs.readFileSync(new URL('../docs/CANONICAL-LIFECYCLE.md', import.meta.url), 'utf8')
const startWorkflow = fs.readFileSync(new URL('../docs/START-WORKFLOW.md', import.meta.url), 'utf8')
const durableOwnerCoordination = startWorkflow.match(/## Durable Owner Coordination SSOT\n[\s\S]*?(?=\n## )/)?.[0] ?? ''
const releaseWorkflow = fs.readFileSync(new URL('../docs/RELEASE-WORKFLOW.md', import.meta.url), 'utf8')
const runtimeProof = fs.readFileSync(new URL('../docs/RUNTIME-PROOF.md', import.meta.url), 'utf8')
const synchronizer = fs.readFileSync(new URL('../scripts/workspace-sync.mjs', import.meta.url), 'utf8')
const synchronizerLibrary = fs.readFileSync(new URL('../scripts/workspace-sync-lib.mjs', import.meta.url), 'utf8')
const synchronizationRuntime = `${synchronizer}\n${synchronizerLibrary}`
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('canonical lifecycle defines a universal adaptive provider-neutral joined receipt protocol', () => {
  assert.match(lifecycle, /schema: "canonical-runtime-lifecycle\/v7"/)
  assert.match(lifecycle, /date: "2026-08-14"/)
  for (const term of [
    'Universal and Adaptive Composition',
    'Overlap Preservation Receipt',
    'Overlap Disposition Receipt',
    'Integration Receipt',
    'Runtime Review Receipt',
    'Candidate Manifest',
    'Authorization Interaction Receipt',
    'Human Authorization Receipt',
    'Deployment Receipt',
    'State Reconciliation Receipt',
    'Live Verification Receipt',
    'Publication Receipt',
    'Rollback Receipt',
    'Actor ID',
    'Device ID',
    'Session ID',
    'target-scoped deployment fence',
    'controlled review-surface locator',
    'Immutable deployment origin',
    'Authoritative state readback',
    'returning-client cache',
    'clean, integrated, completion-proven task lanes',
  ]) {
    assert.match(lifecycle, new RegExp(term))
  }
  for (const invariant of [
    /Lifecycle vocabulary describes capabilities, evidence, transitions/,
    /any inference model or no inference model/,
    /metadata is optional observation evidence/,
    /Before candidate sealing/,
    /versioned decision policy/,
    /Adaptive routing, concurrency,\nretry, and fallback choices/,
    /deterministic for\nidentical evidence/,
    /recorded in digest-bound evidence/,
    /required capability is missing or a downgrade/,
    /Each adapter owns one responsibility/,
    /typed, closed receipts/,
    /Duplicate semantic owners, semantic aliases, and\ncompatibility shims that redefine, bypass, or weaken/,
    /fewer than 600 lines/,
  ]) {
    assert.match(lifecycle, invariant)
  }
  for (const brandedTerm of [
    'Claude',
    'Codex',
    'OpenAI',
    'Anthropic',
    'Gemini',
    'GitHub',
    'Cloudflare',
    'Knowgrph',
    'Agentic Canvas OS',
    'huijoohwee',
    'airvio\\.co',
    'origin/main',
    'turn:end',
    'localhost',
  ]) {
    assert.doesNotMatch(lifecycle, new RegExp(brandedTerm, 'i'))
  }
  assert.doesNotMatch(lifecycle, /Reference Implementation Mapping/)
  assert.match(releaseWorkflow, /## Reference Adapter Mapping/)
  assert.match(releaseWorkflow, /inherits the universal composition, capability, adaptive-decision/)
  assert.doesNotMatch(releaseWorkflow, /## Universal and Adaptive Composition/)
  assert.match(releaseWorkflow, /GitHub/)
  assert.match(releaseWorkflow, /`turn:end`/)
  assert.match(releaseWorkflow, /Cloudflare Pages/)
  assert.match(releaseWorkflow, /locked content-addressed recovery object and durable ref/)
  assert.match(releaseWorkflow, /`npm run production:authorize`/)
  assert.match(releaseWorkflow, /without browser dependence/)
  assert.match(releaseWorkflow, /direct D1 reconciliation/)
  assert.match(releaseWorkflow, /Immutable Pages origin smoke/)
  assert.match(releaseWorkflow, /returning-user service-worker convergence/)
  assert.match(releaseWorkflow, /unrelated runtime-document lanes/)
  assert.match(releaseWorkflow, /agentic-production-authorization-prompt\/v1/)
  assert.match(releaseWorkflow, /agentic-collaborative-release-lifecycle\/v2/)
  assert.match(releaseWorkflow, /agentic-live-verification-receipt\/v2/)
  assert.match(releaseWorkflow, /agentic-publication-receipt\/v2/)
  assert.match(releaseWorkflow, /`production-complete`, or `rolled-back`/)
  assert.match(releaseWorkflow, /exact failed stage and successful predecessor prefix/)
  assert.match(releaseWorkflow, /forbids publication/)
  assert.match(releaseWorkflow, /both occur before\nRuntime Review Receipt expiry/)
  assert.match(releaseWorkflow, /observation-only `collaborative-release-lifecycle\/v1`/)
  assert.match(releaseWorkflow, /cannot accept v2 terminal receipts or satisfy a production/)
  assert.match(releaseWorkflow, /### Remote Continuation Mapping/)
  assert.match(releaseWorkflow, /transport-delivery\nidempotency key/)
  assert.match(releaseWorkflow, /source, dependency-closure, policy, artifact, and manifest identities/)
  assert.match(releaseWorkflow, /caller\nattestation, observation-time, and evidence digests/)
  assert.match(releaseWorkflow, /Status discovery, routing, and receipt validation use the existing model-free/)
  assert.match(releaseWorkflow, /Fallback changes only the transport and delivery key/)
  assert.match(releaseWorkflow, /`accepted`, `rejected`, or `unknown`/)
  assert.match(releaseWorkflow, /`advanced`, `awaiting-human-authorization`, `blocked`, or `stale`/)
  assert.match(releaseWorkflow, /create no release authority/)
  assert.match(releaseWorkflow, /The release is verified and awaiting fresh human authorization\./)
  assert.match(releaseWorkflow, /localhost: `\{\{localhost_review_url\}\}`/)
  assert.match(releaseWorkflow, /`authorize \{\{candidate_digest\}\}`/)
  assert.ok(lifecycle.trimEnd().split('\n').length < 600)
  assert.ok(releaseWorkflow.trimEnd().split('\n').length < 600)
})

test('session and release profiles preserve multi-user fences and the human boundary', () => {
  assert.match(startWorkflow, /Parallel users, devices, sessions, and chats/)
  assert.match(startWorkflow, /shared\s+remote pull-request set is the cross-user and cross-device scope registry/)
  assert.match(startWorkflow, /Keep\s+overlapping work retained with its recovery handle/)
  assert.match(startWorkflow, /no local command, terminal turn, merge event, user, device, or\s+agent may synthesize the Human Authorization Receipt/)
  assert.match(releaseWorkflow, /profile_type: "reference-implementation"/)
  assert.match(releaseWorkflow, /Retain overlapping work; restore only exact disjoint state/)
  assert.match(releaseWorkflow, /complete app, Agentic Canvas OS, catalog, schema, generated mirror, build,\s+policy, target, review, and transitive dependency closure/)
  assert.match(releaseWorkflow, /fetch and bind every protected authority in the Release\s+Frontier/)
  assert.match(releaseWorkflow, /cancel or\s+retire the stale unapproved run/)
  assert.match(releaseWorkflow, /Exactly one\s+environment-scoped controller may deploy/)
  assert.match(releaseWorkflow, /record the exact Cloudflare Pages deployment identifier and immutable\s+`pages\.dev` candidate origin/)
  assert.match(releaseWorkflow, /direct authoritative readback/)
  assert.match(releaseWorkflow, /document, chunk,\s+and graph counts plus path-hash and content parity/)
  assert.match(releaseWorkflow, /browser fidelity/)
  assert.match(releaseWorkflow, /returning-user\s+service-worker convergence/)
  assert.match(releaseWorkflow, /readiness-marker\s+bytes to be identical/)
  assert.match(releaseWorkflow, /Remove only task\s+worktrees whose exact pull request is merged/)
  assert.match(releaseWorkflow, /re-prove `runtime-ready`, HTTP 200 canonical probes/)
  assert.match(releaseWorkflow, /localhost URL is a bound review surface, not Production authority/)
  assert.doesNotMatch(runtimeProof, /Automatic after protected integration/)
})

test('session startup owns the shared durable owner-coordination records', () => {
  assert.match(durableOwnerCoordination, /exactly two normative records: \*\*Coordination Request\*\* and \*\*Authority Transition Receipt\*\*/)
  for (const field of [
    'repository', 'authoritySubject', 'ownerSubject', 'scope', 'writeSetDigest',
    'claimId', 'leaseEpoch', 'fenceRevision', 'immutableRevision', 'reviewLocator',
    'blocker', 'requestedTransition', 'dependentWork', 'replyLocator', 'observedAt',
    'expiresAt', 'requestDigest', 'sourceClaimId', 'sourceLeaseEpoch',
    'sourceFenceRevision', 'resultClaimId', 'resultLeaseEpoch', 'resultFenceRevision',
    'resultState', 'operationReceiptDigest', 'transitionedAt', 'receiptDigest',
  ]) assert.ok(durableOwnerCoordination.includes('`' + field + '`'))
  assert.match(durableOwnerCoordination, /`continue`, `retire`, or `handoff`/)
  assert.match(durableOwnerCoordination, /Transport acknowledgement is observation only/)
  assert.match(durableOwnerCoordination, /authoritative compare-and-swap transition and its exact Authority Transition Receipt both verify/)
  assert.match(durableOwnerCoordination, /Missing or ambiguous owner identity and unknown delivery fail closed/)
  assert.match(durableOwnerCoordination, /Independently admitted disjoint work may continue/)
  assert.match(durableOwnerCoordination, /must not mint a claim, controller, authorization, lane, review request, or content commit/)
  assert.doesNotMatch(durableOwnerCoordination, /GitHub|Cloudflare|Codex|task UI|PR #\d+|incident/i)
  assert.ok(startWorkflow.trimEnd().split('\n').length < 600)
})

test('workspace synchronization is bounded, fast-forward-only, and recoverable', () => {
  for (const repository of ['agentic-canvas-os', 'knowgrph', 'huijoohwee']) {
    assert.match(synchronizer, new RegExp(`id: '${repository}'`))
  }
  assert.match(synchronizerLibrary, /\['merge', '--ff-only', inspection\.remote\]/)
  assert.match(synchronizerLibrary, /canonical-checkout-quarantine\/v2/)
  assert.match(synchronizerLibrary, /canonical-workspace-readiness\/v2/)
  assert.match(synchronizer, /Math\.max\(30, Math\.min\(3600/)
  assert.doesNotMatch(synchronizationRuntime, /reset|git clean|\bstash\b|\brebase\b/)
  assert.equal(pkg.scripts['sync:workspace'], 'node ./scripts/workspace-sync.mjs')
  assert.equal(pkg.scripts['sync:workspace:watch'], 'node ./scripts/workspace-sync.mjs --watch')
})
