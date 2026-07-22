import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createCanonicalWorkspaceSynchronizer, QUARANTINE_SCHEMA, STATE_SCHEMA } from '../scripts/workspace-sync-lib.mjs'

const command = (cwd, executable, args) => execFileSync(executable, args, { cwd, encoding: 'utf8' }).trim()
const git = (cwd, args) => command(cwd, 'git', args)

const createRepository = root => {
  const remote = path.resolve(root, 'remote.git')
  const seed = path.resolve(root, 'seed')
  const canonical = path.resolve(root, 'canonical')
  fs.mkdirSync(seed, { recursive: true })
  command(root, 'git', ['init', '--bare', remote])
  command(root, 'git', ['init', '-b', 'main', seed])
  git(seed, ['config', 'user.name', 'Test'])
  git(seed, ['config', 'user.email', 'test@example.com'])
  fs.writeFileSync(path.resolve(seed, 'value.txt'), 'one\n')
  git(seed, ['add', 'value.txt'])
  git(seed, ['commit', '-m', 'initial'])
  git(seed, ['remote', 'add', 'origin', remote])
  git(seed, ['push', '-u', 'origin', 'main'])
  command(root, 'git', ['clone', '--branch', 'main', remote, canonical])
  return { remote, seed, canonical }
}

const advance = repository => {
  fs.writeFileSync(path.resolve(repository.seed, 'value.txt'), 'two\n')
  git(repository.seed, ['add', 'value.txt'])
  git(repository.seed, ['commit', '-m', 'advance'])
  git(repository.seed, ['push', 'origin', 'main'])
  return git(repository.seed, ['rev-parse', 'HEAD'])
}

test('canonical sync validates a disposable candidate before fast-forward and records last known good', async t => {
  const root = fs.mkdtempSync(path.resolve(os.tmpdir(), 'canonical-sync-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const repository = createRepository(root)
  const remoteRevision = advance(repository)
  const originalRevision = git(repository.canonical, ['rev-parse', 'HEAD'])
  const observed = []
  const synchronizer = createCanonicalWorkspaceSynchronizer({
    workspaceRoot: root,
    repositories: [{ id: 'sample', root: repository.canonical, requiredChecks: ['gate'] }],
    verifyRevision: (_entry, revision) => assert.equal(revision, remoteRevision),
    verifyCandidate: candidate => {
      observed.push(git(candidate.candidateRoot, ['rev-parse', 'HEAD']))
      assert.equal(git(repository.canonical, ['rev-parse', 'HEAD']), originalRevision)
    },
  })
  const report = await synchronizer.cycle()
  assert.deepEqual(observed, [remoteRevision])
  assert.equal(git(repository.canonical, ['rev-parse', 'HEAD']), remoteRevision)
  assert.equal(report.schema, STATE_SCHEMA)
  assert.equal(JSON.parse(fs.readFileSync(synchronizer.statePath, 'utf8')).repositories.sample.revision, remoteRevision)
})

test('canonical sync integrates the verified object when a sibling fetch advances origin/main', async t => {
  const root = fs.mkdtempSync(path.resolve(os.tmpdir(), 'canonical-sync-pin-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const repository = createRepository(root)
  const verifiedRevision = advance(repository)
  let advancedRevision = null
  const synchronizer = createCanonicalWorkspaceSynchronizer({
    workspaceRoot: root,
    repositories: [{ id: 'sample', root: repository.canonical, requiredChecks: ['gate'] }],
    verifyRevision: (_entry, revision) => assert.equal(revision, verifiedRevision),
    verifyCandidate: candidate => {
      assert.equal(git(candidate.candidateRoot, ['rev-parse', 'HEAD']), verifiedRevision)
      fs.writeFileSync(path.resolve(repository.seed, 'value.txt'), 'three\n')
      git(repository.seed, ['add', 'value.txt'])
      git(repository.seed, ['commit', '-m', 'advance again'])
      git(repository.seed, ['push', 'origin', 'main'])
      advancedRevision = git(repository.seed, ['rev-parse', 'HEAD'])
      git(repository.canonical, ['fetch', '--quiet', 'origin', 'main'])
    },
  })

  const report = await synchronizer.cycle()
  assert.notEqual(advancedRevision, verifiedRevision)
  assert.equal(git(repository.canonical, ['rev-parse', 'origin/main']), advancedRevision)
  assert.equal(git(repository.canonical, ['rev-parse', 'HEAD']), verifiedRevision)
  assert.equal(report.repositories.sample.revision, verifiedRevision)
})

test('canonical sync keeps the prior checkout when candidate validation fails', async t => {
  const root = fs.mkdtempSync(path.resolve(os.tmpdir(), 'canonical-sync-reject-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const repository = createRepository(root)
  advance(repository)
  const originalRevision = git(repository.canonical, ['rev-parse', 'HEAD'])
  const synchronizer = createCanonicalWorkspaceSynchronizer({
    workspaceRoot: root,
    repositories: [{ id: 'sample', root: repository.canonical, requiredChecks: [] }],
    verifyRevision: () => undefined,
    verifyCandidate: () => { throw new Error('candidate rejected') },
  })
  await assert.rejects(synchronizer.cycle(), /candidate rejected/)
  assert.equal(git(repository.canonical, ['rev-parse', 'HEAD']), originalRevision)
})

test('canonical sync copies dirty evidence with hashes and fails closed without moving it', async t => {
  const root = fs.mkdtempSync(path.resolve(os.tmpdir(), 'canonical-sync-dirty-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const repository = createRepository(root)
  fs.writeFileSync(path.resolve(repository.canonical, 'local-note.txt'), 'preserve me\n')
  const synchronizer = createCanonicalWorkspaceSynchronizer({
    workspaceRoot: root,
    repositories: [{ id: 'sample', root: repository.canonical, requiredChecks: [] }],
    verifyRevision: () => undefined,
    verifyCandidate: () => undefined,
  })
  await assert.rejects(synchronizer.cycle(), /canonical checkout is dirty/)
  assert.equal(fs.readFileSync(path.resolve(repository.canonical, 'local-note.txt'), 'utf8'), 'preserve me\n')
  const quarantineBase = path.resolve(root, '.runtime-state', 'quarantine', 'sample')
  const quarantine = path.resolve(quarantineBase, fs.readdirSync(quarantineBase)[0])
  const manifest = JSON.parse(fs.readFileSync(path.resolve(quarantine, 'manifest.json'), 'utf8'))
  assert.equal(manifest.schema, QUARANTINE_SCHEMA)
  assert.match(manifest.records[0].digest, /^[0-9a-f]{64}$/)
})
