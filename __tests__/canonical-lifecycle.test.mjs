import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const lifecycle = fs.readFileSync(new URL('../docs/CANONICAL-LIFECYCLE.md', import.meta.url), 'utf8')
const startWorkflow = fs.readFileSync(new URL('../docs/START-WORKFLOW.md', import.meta.url), 'utf8')
const releaseWorkflow = fs.readFileSync(new URL('../docs/RELEASE-WORKFLOW.md', import.meta.url), 'utf8')
const synchronizer = fs.readFileSync(new URL('../scripts/workspace-sync.mjs', import.meta.url), 'utf8')
const synchronizerLibrary = fs.readFileSync(new URL('../scripts/workspace-sync-lib.mjs', import.meta.url), 'utf8')
const synchronizationRuntime = `${synchronizer}\n${synchronizerLibrary}`
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('canonical lifecycle delegates one guarded lane state machine to the pinned ADLC harness', () => {
  assert.match(lifecycle, /schema: "acos-canonical-adlc-lifecycle\/v1"/)
  assert.match(lifecycle, /`agentic-os` is the lifecycle owner/)
  assert.match(lifecycle, /exact commit pinned as the\s+`agentic-os` package in `package-lock\.json`/)
  assert.match(lifecycle, /planned -> active -> published -> queued -> integrated -> retired/)
  assert.match(lifecycle, /does not own a second claim,\s+lease, recovery-scenario, or integration state machine/)
  assert.match(lifecycle, /One row in the ADLC transition table represents a scenario/)
  assert.match(lifecycle, /`main` is the read-only runtime and synchronization owner/)
  assert.match(lifecycle, /remotely addressable branch plus its pull request is the claim/)
  assert.match(lifecycle, /Local ADLC\s+lane records are a cache and never grant authority/)
  assert.match(lifecycle, /Required checks run on the exact published head/)
  assert.match(lifecycle, /provider owns landing\s+order through merge queue or auto-merge with strict up-to-date disabled/)
  assert.match(lifecycle, /queued lane is never author-restacked for ordering/)
  assert.match(lifecycle, /ancestry, a byte-exact `Source-Head` trailer,\s+patch identity, or squash identity/)
  assert.match(lifecycle, /green check or closed pull request alone\s+is not integration proof/)
  assert.match(lifecycle, /removes only the exact clean registered\s+worktree and exact branch and refuses owned untracked paths/)
  assert.match(lifecycle, /Dirty, untracked, ambiguous, or concurrently owned bytes are preserved/)
  assert.match(lifecycle, /No\s+stash, reset, force checkout, force push, broad prune, or inferred ownership/)
  assert.match(lifecycle, /compatibility shims[\s\S]*do not recreate legacy\s+writer authority/)
  assert.doesNotMatch(lifecycle, /canonical-runtime-lifecycle\/v7|Durable Owner Coordination SSOT/)
  assert.ok(lifecycle.trimEnd().split('\n').length < 600)
})

test('start workflow preserves user bytes while resolving bounded mechanical work autonomously', () => {
  assert.match(startWorkflow, /Preflight is one pass/)
  assert.match(startWorkflow, /Report every missing, malformed, or unresolvable input\s+together/)
  assert.match(startWorkflow, /derive every machine-derivable operand/)
  assert.match(startWorkflow, /Validate locally knowable\s+constraints before publication/)
  assert.match(startWorkflow, /Bind volatile refs and provider identity\s+immediately before the transition that consumes them/)
  assert.match(startWorkflow, /Classify a rejection as contended or deterministic/)
  assert.match(startWorkflow, /Re-read and retry a\s+contended value within the declared bound/)
  assert.match(startWorkflow, /never retry a deterministic request\s+unchanged/)
  assert.match(startWorkflow, /Correct wrong values at their owning source/)
  assert.match(startWorkflow, /Escalate only a semantic decision,\s+irreversible effect, credential grant, authority change, or unresolved\s+contradiction/)
  assert.match(startWorkflow, /environment-only bootstrap once/)
  assert.match(startWorkflow, /Cap shared-state repair at one attempt/)
  assert.match(startWorkflow, /state its reversal in\s+advance, and preserve exact residue if it does not converge/)
  assert.match(startWorkflow, /git fetch origin main[\s\S]*npm run doctor[\s\S]*npm run status[\s\S]*npm run lane -- <lowercase-scope>/)
  assert.match(startWorkflow, /Existing dirty bytes in any other checkout remain untouched/)
  assert.match(startWorkflow, /Do not author on `main`, adopt another lane, activate one branch in two\s+worktrees, or manufacture readiness by hiding changes/)
  assert.match(startWorkflow, /npm test[\s\S]*npm run web:build[\s\S]*npm run docs:check[\s\S]*npm run authored-line-budget:check/)
  assert.ok(startWorkflow.trimEnd().split('\n').length < 600)
})

test('release workflow requires exact-head integration proof before exact retirement', () => {
  assert.match(releaseWorkflow, /exact clean task worktree after its bounded checks pass/)
  assert.match(releaseWorkflow, /`land` pushes the lane, creates or reuses its pull request, records a\s+byte-exact `Source-Head` trailer, and hands ordering to the provider/)
  assert.match(releaseWorkflow, /Do not\s+direct-push `main`, raw-merge locally, repeatedly restack, or rewrite the\s+published head while checks are attached to it/)
  for (const orderedStep of [
    /Required checks pass on the exact pull-request head/,
    /provider merges through its protected path/,
    /Re-fetch `origin\/main`/,
    /Compute integration proof against the exact published head/,
    /Run `npm run reap` from the canonical checkout/,
    /survey reports the lane integrated, run\s+`npm run reap -- --apply`/,
    /exact worktree is absent, the exact local and remote lane refs are\s+retired/,
    /Synchronize a clean canonical checkout by fast-forward/,
  ]) assert.match(releaseWorkflow, orderedStep)
  assert.match(releaseWorkflow, /If canonical bytes\s+are dirty, reconcile only after every byte is proven target-equivalent or\s+preserved by an explicit crash-safe transaction/)
  assert.match(releaseWorkflow, /merge commit, green check, clean worktree, or HTTP response is never a\s+substitute for the other receipts/)
  assert.match(releaseWorkflow, /Derive all available operands, surface all missing inputs at once, and validate\s+local constraints before provider mutation/)
  assert.match(releaseWorkflow, /compare-and-swap loss may be retried within its\s+bound; a deterministic rejection is repaired at its owner/)
  assert.match(releaseWorkflow, /Production,\s+publication, credentials, irreversible effects, and any authority-controlling\s+change remain exact-candidate operator decisions/)
  assert.doesNotMatch(releaseWorkflow, /canonical-runtime-lifecycle\/v7|collaborative-release-lifecycle\/v2/)
  assert.ok(releaseWorkflow.trimEnd().split('\n').length < 600)
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
