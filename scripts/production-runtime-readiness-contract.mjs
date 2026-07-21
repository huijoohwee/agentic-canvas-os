import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PRODUCTION_RUNTIME_READINESS_SCHEMA = 'knowgrph-production-runtime-readiness/v2'
export const PRODUCTION_RUNTIME_READINESS_SCHEMA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'docs',
  'schemas',
  'production-runtime-readiness.v2.schema.json',
)

const SHA_PATTERN = /^[0-9a-f]{40}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

const isExactObject = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
}

const assertDigest = (value, label) => {
  if (!isExactObject(value, ['algorithm', 'digest'])) throw new Error(`${label} must contain only algorithm and digest`)
  if (value.algorithm !== 'sha256' || !SHA256_PATTERN.test(String(value.digest || ''))) {
    throw new Error(`${label} must be an exact SHA-256 digest`)
  }
}

export function validateProductionRuntimeReadiness(value) {
  const keys = [
    'schema',
    'status',
    'source',
    'agenticCanvasOs',
    'catalogRevision',
    'artifact',
    'immutableManifest',
    'mirror',
    'surfaces',
  ]
  if (!isExactObject(value, keys)) throw new Error('runtime readiness contains missing or unknown fields')
  if (value.schema !== PRODUCTION_RUNTIME_READINESS_SCHEMA || value.status !== 'verified-build') {
    throw new Error('runtime readiness schema or status is invalid')
  }
  if (!isExactObject(value.source, ['repository', 'revision', 'tree'])) throw new Error('source identity is invalid')
  if (!REPOSITORY_PATTERN.test(value.source.repository) || !SHA_PATTERN.test(value.source.revision) || !SHA_PATTERN.test(value.source.tree)) {
    throw new Error('source identity must contain an exact repository, revision, and tree')
  }
  if (!isExactObject(value.agenticCanvasOs, ['repository', 'revision'])) throw new Error('Agentic Canvas OS identity is invalid')
  if (!REPOSITORY_PATTERN.test(value.agenticCanvasOs.repository) || !SHA_PATTERN.test(value.agenticCanvasOs.revision)) {
    throw new Error('Agentic Canvas OS identity must contain an exact repository and revision')
  }
  if (value.catalogRevision !== value.agenticCanvasOs.revision) throw new Error('catalog revision must equal Agentic Canvas OS revision')
  assertDigest(value.artifact, 'artifact')
  assertDigest(value.immutableManifest, 'immutable manifest')
  if (!isExactObject(value.mirror, ['repository']) || value.mirror.repository !== 'huijoohwee/huijoohwee') {
    throw new Error('mirror identity is invalid')
  }
  if (!Array.isArray(value.surfaces) || value.surfaces.length !== 2 || !value.surfaces.includes('/') || !value.surfaces.includes('/knowgrph')) {
    throw new Error('runtime readiness must bind the apex and /knowgrph surfaces')
  }
  return value
}

export function readProductionRuntimeReadinessSchema() {
  return JSON.parse(fs.readFileSync(PRODUCTION_RUNTIME_READINESS_SCHEMA_PATH, 'utf8'))
}
