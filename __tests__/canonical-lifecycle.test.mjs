import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const lifecycle = fs.readFileSync(new URL('../docs/CANONICAL-LIFECYCLE.md', import.meta.url), 'utf8')
const synchronizer = fs.readFileSync(new URL('../scripts/workspace-sync.mjs', import.meta.url), 'utf8')
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('canonical lifecycle defines protected automatic promotion and SHA convergence', () => {
  assert.match(lifecycle, /protected, green `main`/)
  assert.match(lifecycle, /automatic promotion/)
  assert.match(lifecycle, /origin\/main SHA/)
  assert.match(lifecycle, /production runtime identity SHA/)
  assert.match(lifecycle, /rolls Pages back/)
})

test('workspace synchronization is bounded, fast-forward-only, and recoverable', () => {
  for (const repository of ['agentic-canvas-os', 'knowgrph', 'huijoohwee']) {
    assert.match(synchronizer, new RegExp(`id: '${repository}'`))
  }
  assert.match(synchronizer, /'merge', '--ff-only', 'origin\/main'/)
  assert.match(synchronizer, /canonical-checkout-quarantine\/v1/)
  assert.match(synchronizer, /Math\.max\(30, Math\.min\(3600/)
  assert.doesNotMatch(synchronizer, /reset|git clean|\bstash\b|\brebase\b/)
  assert.equal(pkg.scripts['sync:workspace'], 'node ./scripts/workspace-sync.mjs')
  assert.equal(pkg.scripts['sync:workspace:watch'], 'node ./scripts/workspace-sync.mjs --watch')
})
