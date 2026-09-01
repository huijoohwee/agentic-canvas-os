import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as githubAuthority from 'agentic-os/adapters/github-authority'
import { verifyGitHubAuthorityIssuanceLive } from 'agentic-os/adapters/github-authority-issuer'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PIN = 'https://codeload.github.com/huijoohwee/agentic-os/tar.gz/3d27ffd564d311709193ca11dd20746e0851b96a'
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

test('ACOS consumes one protected immutable agentic-os authority adapter', () => {
  const pkg = JSON.parse(read('package.json'))
  const lock = JSON.parse(read('package-lock.json'))
  const installed = lock.packages['node_modules/agentic-os']
  assert.equal(pkg.devDependencies['agentic-os'], PIN)
  assert.equal(lock.packages[''].devDependencies['agentic-os'], PIN)
  assert.equal(installed.resolved, PIN)
  assert.match(installed.integrity, /^sha512-/u)
  assert.equal(installed.bin['agentic-os-authority'], 'bin/agentic-os-authority.mjs')
  assert.equal(Object.hasOwn(githubAuthority, 'GITHUB_ACTIONS_RULESET_BYPASS'), false)
  assert.equal(typeof verifyGitHubAuthorityIssuanceLive, 'function')
})

test('the committed policy is canonical, same-owner, and repository-neutral', () => {
  const policy = JSON.parse(read('.github/adlc-authority-policy.json'))
  assert.deepEqual(policy, {
    targetRepositoryPrefix: 'github.com/huijoohwee/',
    canonicalRef: 'refs/heads/main',
    workflowPath: '.github/workflows/adlc-authority.yml',
    confirmationClass: 'interactive-provider',
    requiredStatusChecks: [
      'budgets', 'build', 'collaboration-integration', 'docs-contract', 'test',
    ],
    allowedMergeMethods: ['squash'],
    evidenceRefPrefix: 'refs/heads/adlc/authority/',
    evidencePathPrefix: 'authority-evidence/',
    validitySeconds: 3600,
  })
  const effective = {
    evidenceRepository: 'github.com/huijoohwee/agentic-canvas-os',
    targetRepositoryPrefix: policy.targetRepositoryPrefix,
    canonicalRef: policy.canonicalRef,
    canonicalRevision: 'a'.repeat(40),
    workflowPath: policy.workflowPath,
    workflowRef: 'refs/heads/main',
    workflowRevision: 'b'.repeat(40),
    confirmationClass: policy.confirmationClass,
    requiredStatusChecks: policy.requiredStatusChecks,
    allowedMergeMethods: policy.allowedMergeMethods,
    evidenceRefPrefix: policy.evidenceRefPrefix,
    evidencePathPrefix: policy.evidencePathPrefix,
    validitySeconds: policy.validitySeconds,
  }
  assert.deepEqual(githubAuthority.validateGitHubAuthorityPolicy(effective), effective)
})

test('the manual workflow binds event bytes without interpolating them into execution', () => {
  const workflow = read('.github/workflows/adlc-authority.yml')
  assert.match(workflow, /^  workflow_dispatch:\n/mu)
  assert.match(workflow, /authority_payload:[\s\S]*required: true[\s\S]*type: string/u)
  assert.match(workflow, /authority_input_digest:[\s\S]*required: true[\s\S]*type: string/u)
  assert.match(workflow,
    /run-name: ADLC authority \$\{\{ inputs\.authority_input_digest \}\} @ \$\{\{ github\.workflow_sha \}\}/u)
  assert.doesNotMatch(workflow, /^\s{2}(?:pull_request|push|schedule|merge_group):/mu)
  assert.match(workflow, /^  actions: read\n  contents: write$/mu)
  assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/u)
  assert.match(workflow, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/u)
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}[\s\S]*persist-credentials: false/u)
  assert.match(workflow, /npm ci --ignore-scripts --no-audit --no-fund/u)
  assert.match(workflow, /agentic-os-authority issue-github --event="\$GITHUB_EVENT_PATH" --policy=\.github\/adlc-authority-policy\.json/u)
  const executionWorkflow = workflow.split('\n')
    .filter(line => !line.startsWith('run-name:'))
    .join('\n')
  assert.doesNotMatch(executionWorkflow, /\$\{\{\s*(?:inputs\.|github\.event\.inputs)/u)

  const writeWorkflows = fs.readdirSync(path.join(ROOT, '.github', 'workflows'))
    .filter(name => /\.ya?ml$/u.test(name))
    .filter(name => /\bcontents:\s*write\b/u.test(read(path.join('.github', 'workflows', name))))
  assert.deepEqual(writeWorkflows, ['adlc-authority.yml'])
})
