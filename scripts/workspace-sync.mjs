#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const agenticRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = path.resolve(agenticRoot, '..')
const watch = process.argv.includes('--watch')
const intervalOption = process.argv.find(value => value.startsWith('--interval='))
const intervalSeconds = Math.max(30, Math.min(3600, Number(intervalOption?.split('=')[1] || 300)))
const repositories = [
  { id: 'agentic-canvas-os', root: agenticRoot, verify: ['npm', ['run', 'docs:check']] },
  { id: 'knowgrph', root: path.resolve(workspaceRoot, 'knowgrph'), verify: ['npm', ['run', 'runtime:check']] },
  { id: 'huijoohwee', root: path.resolve(workspaceRoot, 'huijoohwee'), verify: ['npm', ['run', 'runtime:check']] },
]
const stateRoot = path.resolve(workspaceRoot, '.runtime-state')
const lockId = createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 16)
const lockPath = path.resolve(os.tmpdir(), `agentic-canonical-sync-${lockId}.lock`)

await cycle()
if (watch) {
  console.log(`Watching canonical workspace every ${intervalSeconds}s.`)
  while (true) {
    await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000))
    try {
      await cycle()
    } catch (error) {
      console.error(`[workspace-sync] ${error.message}`)
    }
  }
}

async function cycle() {
  const lock = acquireLock()
  try {
    for (const repository of repositories) syncRepository(repository)
  } finally {
    fs.closeSync(lock)
    fs.rmSync(lockPath, { force: true })
  }
}

function syncRepository(repository) {
  if (!fs.existsSync(path.resolve(repository.root, '.git'))) {
    throw new Error(`${repository.id} canonical checkout is missing: ${repository.root}`)
  }
  if (git(repository.root, ['branch', '--show-current']) !== 'main') {
    throw new Error(`${repository.id} canonical checkout is not on main`)
  }

  run(repository.root, 'git', ['fetch', '--quiet', '--prune', 'origin', 'main'])
  quarantineUntracked(repository)
  const status = git(repository.root, ['status', '--porcelain'])
  if (status) throw new Error(`${repository.id} canonical checkout contains tracked or unexplained changes`)

  const before = git(repository.root, ['rev-parse', 'HEAD'])
  const remote = git(repository.root, ['rev-parse', 'origin/main'])
  if (!isAncestor(repository.root, before, remote)) {
    throw new Error(`${repository.id} canonical history is ahead or diverged from origin/main`)
  }
  if (before !== remote) run(repository.root, 'git', ['merge', '--ff-only', 'origin/main'])

  const head = git(repository.root, ['rev-parse', 'HEAD'])
  if (head !== remote || git(repository.root, ['status', '--porcelain'])) {
    throw new Error(`${repository.id} did not converge cleanly to origin/main`)
  }
  if (before !== head) {
    run(repository.root, repository.verify[0], repository.verify[1])
    console.log(`[workspace-sync] ${repository.id} verified ${head}`)
  }
}

function quarantineUntracked(repository) {
  const entries = git(repository.root, ['status', '--porcelain', '-z']).split('\0').filter(Boolean)
  const untracked = entries.filter(entry => entry.startsWith('?? ')).map(entry => entry.slice(3))
  const unexplained = entries.filter(entry => !entry.startsWith('?? '))
  if (unexplained.length > 0 || untracked.length === 0) return

  const stamp = new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z')
  const quarantineRoot = path.resolve(stateRoot, 'quarantine', repository.id, stamp)
  for (const rel of untracked) {
    const source = path.resolve(repository.root, rel)
    const destination = path.resolve(quarantineRoot, rel)
    if (!source.startsWith(`${repository.root}${path.sep}`) || !destination.startsWith(`${quarantineRoot}${path.sep}`)) {
      throw new Error(`unsafe untracked path in ${repository.id}: ${rel}`)
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.renameSync(source, destination)
  }
  fs.writeFileSync(path.resolve(quarantineRoot, 'manifest.json'), `${JSON.stringify({
    schema: 'canonical-checkout-quarantine/v1',
    repository: repository.id,
    paths: untracked.sort(),
  }, null, 2)}\n`)
  console.log(`[workspace-sync] quarantined ${untracked.length} untracked path(s) from ${repository.id} at ${quarantineRoot}`)
}

function acquireLock() {
  try {
    return fs.openSync(lockPath, 'wx')
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`another canonical synchronization owns ${lockPath}`)
    throw error
  }
}

function isAncestor(cwd, ancestor, descendant) {
  return spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd }).status === 0
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function run(cwd, command, args) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed in ${cwd}`)
}
