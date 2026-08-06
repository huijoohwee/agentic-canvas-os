import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('interrupted planned admission remains owner-led and mutation closed', () => {
  const workflow = readFileSync(path.resolve(repositoryRoot, 'docs/START-WORKFLOW.md'), 'utf8')
  const authorization = readFileSync(
    path.resolve(repositoryRoot, 'scripts/scoped-lane-bootstrap-authorization.mjs'),
    'utf8',
  )

  assert.match(
    workflow,
    /Keep a `planned` recovery lane untouched until owner-led lifecycle recovery closes it and a fresh admission completes\./u,
  )
  assert.match(authorization, /AUTHORIZE ROOT-SOURCE BOOTSTRAP EXCEPTION/u)
  assert.match(
    authorization,
    /\["planned", "admitted"\]\.includes\(admission\?\.status\)/u,
  )
  for (const forbiddenOperation of [
    'cleanup',
    'deployment',
    'manual-ledger-edit',
    'manual-registry-edit',
    'merge',
  ]) {
    assert.match(authorization, new RegExp(`"${forbiddenOperation}"`, 'u'))
  }
})
