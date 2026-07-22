import { createHash, randomUUID } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const STATE_SCHEMA = 'canonical-workspace-readiness/v2'
const LOCK_SCHEMA = 'canonical-workspace-sync-lock/v1'
const QUARANTINE_SCHEMA = 'canonical-checkout-quarantine/v2'
const MAX_BACKOFF_SECONDS = 3600

const sha256 = value => createHash('sha256').update(value).digest('hex')
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

const run = (cwd, command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? 'pipe' : 'inherit',
    env: options.env || process.env,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = options.capture ? String(result.stderr || '').trim() : ''
    throw new Error(detail || `${command} ${args.join(' ')} failed in ${cwd}`)
  }
  return options.capture ? String(result.stdout || '').trim() : ''
}

const git = (cwd, args) => run(cwd, 'git', args, { capture: true })

const repositorySlug = root => {
  const remote = git(root, ['remote', 'get-url', 'origin'])
  const match = remote.match(/(?:github\.com[/:])([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/)
  if (!match) throw new Error(`origin is not a GitHub repository: ${remote}`)
  return match[1]
}

const verifyProtectedRevision = (repository, revision) => {
  const response = JSON.parse(run(repository.root, 'gh', [
    'api',
    `repos/${repositorySlug(repository.root)}/commits/${revision}/check-runs?per_page=100`,
  ], { capture: true }))
  const runs = Array.isArray(response.check_runs) ? response.check_runs : []
  for (const name of repository.requiredChecks || []) {
    const matches = runs.filter(check => check?.name === name)
    if (!matches.some(check => check.status === 'completed' && check.conclusion === 'success')) {
      throw new Error(`${repository.id} protected check is not successful at ${revision}: ${name}`)
    }
  }
}

const statusEntries = root => git(root, ['status', '--porcelain=v1', '-z'])
  .split('\0')
  .filter(Boolean)
  .map(entry => ({ status: entry.slice(0, 2), relativePath: entry.slice(3) }))

const collectPathRecords = (root, entries) => {
  const records = []
  const visit = (absolute, relativePath, status) => {
    if (!fs.existsSync(absolute)) {
      records.push({ path: relativePath, status, kind: 'missing' })
      return
    }
    const stat = fs.lstatSync(absolute)
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) visit(path.resolve(absolute, name), `${relativePath}/${name}`, status)
      return
    }
    if (stat.isSymbolicLink()) {
      records.push({ path: relativePath, status, kind: 'symlink', target: fs.readlinkSync(absolute) })
      return
    }
    records.push({ path: relativePath, status, kind: 'file', digest: sha256(fs.readFileSync(absolute)) })
  }
  for (const entry of entries) {
    const relativePath = entry.relativePath.split(' -> ').at(-1)
    if (!relativePath || path.isAbsolute(relativePath) || relativePath.split(path.sep).includes('..')) {
      throw new Error(`unsafe checkout path: ${entry.relativePath}`)
    }
    visit(path.resolve(root, relativePath), relativePath, entry.status)
  }
  return records.sort((left, right) => left.path.localeCompare(right.path))
}

const preserveUnexpectedState = (repository, stateRoot, entries, now) => {
  const records = collectPathRecords(repository.root, entries)
  const contentDigest = sha256(JSON.stringify(records))
  const stamp = now().toISOString().replace(/[-:.]/g, '')
  const quarantineRoot = path.resolve(stateRoot, 'quarantine', repository.id, `${stamp}-${contentDigest.slice(0, 16)}`)
  fs.mkdirSync(quarantineRoot, { recursive: true })
  for (const entry of entries) {
    const relativePath = entry.relativePath.split(' -> ').at(-1)
    const source = path.resolve(repository.root, relativePath)
    const destination = path.resolve(quarantineRoot, 'files', relativePath)
    if (!source.startsWith(`${repository.root}${path.sep}`) || !destination.startsWith(`${quarantineRoot}${path.sep}`)) {
      throw new Error(`unsafe quarantine path: ${relativePath}`)
    }
    if (!fs.existsSync(source)) continue
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.cpSync(source, destination, { recursive: true, dereference: false })
  }
  fs.writeFileSync(path.resolve(quarantineRoot, 'manifest.json'), `${JSON.stringify({
    schema: QUARANTINE_SCHEMA,
    repository: repository.id,
    contentDigest,
    records,
  }, null, 2)}\n`)
  return quarantineRoot
}

const processIsAlive = pid => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const acquireLock = ({ lockPath, workspaceRoot, now, staleAfterMs }) => {
  const token = randomUUID()
  const lock = { schema: LOCK_SCHEMA, token, pid: process.pid, workspaceRoot, createdAt: now().toISOString() }
  const write = () => fs.writeFileSync(lockPath, `${JSON.stringify(lock)}\n`, { flag: 'wx' })
  try {
    write()
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    let existing = null
    try { existing = JSON.parse(fs.readFileSync(lockPath, 'utf8')) } catch { existing = null }
    const createdAtMs = Date.parse(String(existing?.createdAt || ''))
    const stale = !processIsAlive(Number(existing?.pid)) || !Number.isFinite(createdAtMs) || now().getTime() - createdAtMs > staleAfterMs
    if (!stale) throw new Error(`another canonical synchronization owns ${lockPath}`)
    fs.rmSync(lockPath)
    write()
  }
  return () => {
    try {
      const current = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
      if (current.token === token) fs.rmSync(lockPath)
    } catch {
      // The exact lock disappeared; there is no broader cleanup fallback.
    }
  }
}

const readState = statePath => {
  try {
    const value = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    return value.schema === STATE_SCHEMA && value.repositories ? value : { schema: STATE_SCHEMA, repositories: {} }
  } catch {
    return { schema: STATE_SCHEMA, repositories: {} }
  }
}

const addCandidateWorktree = (repository, revision) => {
  const tempRoot = fs.mkdtempSync(path.resolve(os.tmpdir(), `canonical-${repository.id}-`))
  const candidateRoot = path.resolve(tempRoot, 'checkout')
  run(repository.root, 'git', ['worktree', 'add', '--detach', candidateRoot, revision])
  return { ...repository, candidateRoot, tempRoot }
}

const removeCandidateWorktree = candidate => {
  try { run(candidate.root, 'git', ['worktree', 'remove', candidate.candidateRoot]) } catch { return }
  fs.rmSync(candidate.tempRoot, { recursive: true, force: true })
}

export function createCanonicalWorkspaceSynchronizer({
  workspaceRoot,
  repositories,
  stateRoot = path.resolve(workspaceRoot, '.runtime-state'),
  now = () => new Date(),
  verifyRevision = verifyProtectedRevision,
  verifyCandidate = null,
}) {
  const statePath = path.resolve(stateRoot, 'canonical-workspace-readiness.json')
  const lockId = sha256(workspaceRoot).slice(0, 16)
  const lockPath = path.resolve(os.tmpdir(), `agentic-canonical-sync-${lockId}.lock`)

  const cycle = async () => {
    fs.mkdirSync(stateRoot, { recursive: true })
    const releaseLock = acquireLock({ lockPath, workspaceRoot, now, staleAfterMs: 2 * MAX_BACKOFF_SECONDS * 1000 })
    const candidates = []
    try {
      const priorState = readState(statePath)
      const inspections = []
      for (const repository of repositories) {
        git(repository.root, ['rev-parse', '--git-dir'])
        if (git(repository.root, ['branch', '--show-current']) !== 'main') throw new Error(`${repository.id} canonical checkout is not on main`)
        run(repository.root, 'git', ['fetch', '--quiet', '--prune', 'origin', 'main'])
        const entries = statusEntries(repository.root)
        if (entries.length > 0) {
          const quarantineRoot = preserveUnexpectedState(repository, stateRoot, entries, now)
          throw new Error(`${repository.id} canonical checkout is dirty; evidence copied to ${quarantineRoot}`)
        }
        const current = git(repository.root, ['rev-parse', 'HEAD'])
        const remote = git(repository.root, ['rev-parse', 'origin/main'])
        if (spawnSync('git', ['merge-base', '--is-ancestor', current, remote], { cwd: repository.root }).status !== 0) {
          throw new Error(`${repository.id} canonical history is ahead or diverged from origin/main`)
        }
        verifyRevision(repository, remote)
        const mustVerify = current !== remote || priorState.repositories[repository.id]?.revision !== remote
        inspections.push({ repository, current, remote, mustVerify })
      }

      for (const inspection of inspections.filter(item => item.mustVerify)) {
        candidates.push(addCandidateWorktree(inspection.repository, inspection.remote))
      }
      const candidateRoots = new Map(candidates.map(candidate => [candidate.id, candidate.candidateRoot]))
      const agenticRepository = repositories.find(item => item.id === 'agentic-canvas-os')
      for (const candidate of candidates) {
        const agenticRoot = candidateRoots.get('agentic-canvas-os') || agenticRepository?.root
        const environment = agenticRoot
          ? { ...process.env, KNOWGRPH_AGENTIC_CANVAS_OS_DOCS_ROOT: path.resolve(agenticRoot, 'docs') }
          : process.env
        if (verifyCandidate) {
          await verifyCandidate(candidate, environment)
        } else {
          if (candidate.prepare) run(candidate.candidateRoot, candidate.prepare[0], candidate.prepare[1], { env: environment })
          run(candidate.candidateRoot, candidate.verify[0], candidate.verify[1], { env: environment })
        }
      }

      for (const inspection of inspections.filter(item => item.current !== item.remote)) {
        run(inspection.repository.root, 'git', ['merge', '--ff-only', inspection.remote])
        const integrated = git(inspection.repository.root, ['rev-parse', 'HEAD'])
        if (integrated !== inspection.remote || statusEntries(inspection.repository.root).length > 0) {
          throw new Error(`${inspection.repository.id} canonical checkout did not integrate exact verified revision ${inspection.remote}`)
        }
      }
      const verifiedAt = now().toISOString()
      const nextState = {
        schema: STATE_SCHEMA,
        workspaceRoot,
        verifiedAt,
        repositories: Object.fromEntries(inspections.map(({ repository, remote }) => [repository.id, {
          revision: remote,
          requiredChecks: repository.requiredChecks || [],
          verifiedAt,
        }])),
      }
      fs.writeFileSync(statePath, `${JSON.stringify(nextState, null, 2)}\n`)
      return { schema: STATE_SCHEMA, status: 'verified', verifiedAt, repositories: nextState.repositories }
    } finally {
      for (const candidate of candidates.reverse()) removeCandidateWorktree(candidate)
      releaseLock()
    }
  }

  const watch = async ({ intervalSeconds }) => {
    let failureCount = 0
    while (true) {
      try {
        const report = await cycle()
        process.stdout.write(`${JSON.stringify(report)}\n`)
        failureCount = 0
      } catch (error) {
        failureCount += 1
        process.stderr.write(`[workspace-sync] ${error.message}\n`)
      }
      const exponential = Math.min(MAX_BACKOFF_SECONDS, intervalSeconds * (2 ** Math.min(failureCount, 5)))
      const jitter = Math.floor(Math.random() * Math.max(1, intervalSeconds * 0.2))
      await sleep((exponential + jitter) * 1000)
    }
  }

  return { cycle, watch, statePath, lockPath }
}

export { LOCK_SCHEMA, QUARANTINE_SCHEMA, STATE_SCHEMA, verifyProtectedRevision }
