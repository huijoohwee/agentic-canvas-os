import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const lifecycle = fs.readFileSync(new URL('../docs/CANONICAL-LIFECYCLE.md', import.meta.url), 'utf8')
const startWorkflow = fs.readFileSync(new URL('../docs/START-WORKFLOW.md', import.meta.url), 'utf8')
const releaseWorkflow = fs.readFileSync(new URL('../docs/RELEASE-WORKFLOW.md', import.meta.url), 'utf8')
const runtimeProof = fs.readFileSync(new URL('../docs/RUNTIME-PROOF.md', import.meta.url), 'utf8')
const synchronizer = fs.readFileSync(new URL('../scripts/workspace-sync.mjs', import.meta.url), 'utf8')
const synchronizerLibrary = fs.readFileSync(new URL('../scripts/workspace-sync-lib.mjs', import.meta.url), 'utf8')
const synchronizationRuntime = `${synchronizer}\n${synchronizerLibrary}`
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('canonical lifecycle defines a provider-neutral joined receipt protocol', () => {
  const [neutralProtocol, referenceMapping] = lifecycle.split('## Reference Implementation Mapping')
  assert.ok(referenceMapping, 'reference implementation mapping must be explicit')
  assert.match(neutralProtocol, /schema: "canonical-runtime-lifecycle\/v6"/)
  for (const term of [
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
    assert.match(neutralProtocol, new RegExp(term))
  }
  for (const brandedTerm of [
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
    assert.doesNotMatch(neutralProtocol, new RegExp(brandedTerm, 'i'))
  }
  assert.match(referenceMapping, /GitHub `origin\/main`/)
  assert.match(referenceMapping, /Agentic Canvas OS `turn:end`/)
  assert.match(referenceMapping, /Cloudflare release controller/)
  assert.match(referenceMapping, /content-addressed stash plus durable recovery ref/)
  assert.match(referenceMapping, /interactive terminal command/)
  assert.match(referenceMapping, /neither launches nor requires a browser/)
  assert.match(referenceMapping, /direct D1 reconciliation/)
  assert.match(referenceMapping, /Immutable Pages origin smoke/)
  assert.match(referenceMapping, /returning-user service-worker revision convergence/)
  assert.match(referenceMapping, /unrelated runtime-document lanes remain preserved/)
  assert.match(referenceMapping, /agentic-production-authorization-prompt\/v1/)
  assert.match(referenceMapping, /The release is verified and awaiting fresh human authorization\./)
  assert.match(referenceMapping, /localhost: `\{\{localhost_review_url\}\}`/)
  assert.match(referenceMapping, /`authorize \{\{candidate_digest\}\}`/)
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
