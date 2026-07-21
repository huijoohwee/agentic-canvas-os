import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PRODUCTION_RUNTIME_READINESS_SCHEMA,
  readProductionRuntimeReadinessSchema,
  validateProductionRuntimeReadiness,
} from '../scripts/production-runtime-readiness-contract.mjs'

const revision = 'a'.repeat(40)
const docsRevision = 'b'.repeat(40)
const digest = 'c'.repeat(64)
const sample = {
  schema: PRODUCTION_RUNTIME_READINESS_SCHEMA,
  status: 'verified-build',
  source: { repository: 'huijoohwee/knowgrph', revision, tree: 'd'.repeat(40) },
  agenticCanvasOs: { repository: 'huijoohwee/agentic-canvas-os', revision: docsRevision },
  catalogRevision: docsRevision,
  artifact: { algorithm: 'sha256', digest },
  immutableManifest: { algorithm: 'sha256', digest: 'e'.repeat(64) },
  mirror: { repository: 'huijoohwee/huijoohwee' },
  surfaces: ['/', '/knowgrph'],
}

test('production runtime readiness binds app docs catalog artifact manifest mirror and surfaces', () => {
  assert.equal(validateProductionRuntimeReadiness(sample), sample)
  const schema = readProductionRuntimeReadinessSchema()
  assert.equal(schema.$id, 'https://agentic-canvas-os.dev/schemas/production-runtime-readiness/v2')
  assert.equal(schema.properties.schema.const, PRODUCTION_RUNTIME_READINESS_SCHEMA)
  assert.equal(schema.additionalProperties, false)
})

test('production runtime readiness rejects revision drift and unknown fields', () => {
  assert.throws(
    () => validateProductionRuntimeReadiness({ ...sample, catalogRevision: revision }),
    /catalog revision must equal/,
  )
  assert.throws(
    () => validateProductionRuntimeReadiness({ ...sample, deploymentId: 'mutable' }),
    /missing or unknown fields/,
  )
})
