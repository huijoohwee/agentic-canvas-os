#!/usr/bin/env node

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCanonicalWorkspaceSynchronizer } from './workspace-sync-lib.mjs'

const agenticRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = path.resolve(agenticRoot, '..')
const watch = process.argv.includes('--watch')
const intervalOption = process.argv.find(value => value.startsWith('--interval='))
const intervalSeconds = Math.max(30, Math.min(3600, Number(intervalOption?.split('=')[1] || 300)))

const repositories = [
  {
    id: 'agentic-canvas-os',
    root: agenticRoot,
    requiredChecks: ['test', 'build', 'docs-contract', 'collaboration-integration'],
    prepare: ['npm', ['ci']],
    verify: ['npm', ['run', 'docs:check']],
  },
  {
    id: 'knowgrph',
    root: path.resolve(workspaceRoot, 'knowgrph'),
    requiredChecks: ['Integration Gate'],
    prepare: ['npm', ['ci']],
    verify: ['npm', ['run', 'runtime:check']],
  },
  {
    id: 'huijoohwee',
    root: path.resolve(workspaceRoot, 'huijoohwee'),
    requiredChecks: ['Runtime Readiness Gate'],
    prepare: ['npm', ['ci']],
    verify: ['npm', ['run', 'runtime:check']],
  },
]

const synchronizer = createCanonicalWorkspaceSynchronizer({ workspaceRoot, repositories })

if (watch) {
  await synchronizer.watch({ intervalSeconds })
} else {
  const report = await synchronizer.cycle()
  process.stdout.write(`${JSON.stringify(report)}\n`)
}
