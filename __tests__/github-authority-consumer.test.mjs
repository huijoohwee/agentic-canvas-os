import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { continue as continueRequest, retire } from 'agentic-os'
import * as githubAuthority from 'agentic-os/adapters/github-authority'
import { verifyGitHubAuthorityIssuanceLive } from 'agentic-os/adapters/github-authority-issuer'
import * as githubTransitionAuthority from 'agentic-os/adapters/github-transition-authority'
import * as githubTransitionClient from 'agentic-os/adapters/github-transition-client'
import * as githubTransitionPolicy from 'agentic-os/adapters/github-transition-policy'
import { createEffectPlan, encodeEffectPlan } from 'agentic-os/records/completion'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PIN = 'https://codeload.github.com/huijoohwee/agentic-os/tar.gz/bafaf3f0dde780461d11f02355c6fc6cac0dd6e0'
const INTEGRITY = 'sha512-ukHEzCOaQflgCxEZmMIpfJ296eUN+hH862jo72p+uoiAkc4qMtMcxMpDNGxQpmn5vIZ9tmgOvKWY/ACT3Ti7NA=='
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const digest = relativePath => createHash('sha256')
  .update(fs.readFileSync(path.join(ROOT, relativePath)))
  .digest('hex')
const sha256 = value => createHash('sha256').update(value).digest('hex')
const hex = digit => digit.repeat(64)

const transitionFixture = () => {
  const source = {
    repository: 'github.com/huijoohwee/agentic-canvas-os',
    authoritySubject: 'github-user:1',
    ownerSubject: 'github-user:1',
    scope: ['refs/heads/agent/device/completion'],
    claimId: hex('1'),
    leaseEpoch: 3,
    fenceRevision: hex('2'),
    immutableRevision: 'a'.repeat(40),
    reviewLocator: 'https://github.com/huijoohwee/agentic-canvas-os/pull/1',
    observedAt: '2026-09-02T00:00:00.000Z',
    expiresAt: '2026-09-02T01:00:00.000Z',
  }
  const continuation = continueRequest(source)
  const plan = createEffectPlan({
    target: {
      repository: source.repository,
      resource: source.scope[0],
      immutableRevision: source.immutableRevision,
    },
    authority: {
      requestedTransition: 'retire',
      authoritySubject: source.authoritySubject,
      ownerSubject: source.ownerSubject,
      claimId: source.claimId,
      leaseEpoch: source.leaseEpoch,
      fenceRevision: source.fenceRevision,
      writeSetDigest: continuation.writeSetDigest,
      reviewLocator: source.reviewLocator,
      predecessorDigest: hex('3'),
    },
    candidateDigest: hex('4'),
    snapshotDigest: hex('5'),
    effectClass: 'claim-retirement-with-cleanup',
    allowedEffects: [
      'quarantine-worktree-projection',
      'quarantine-worktree-registration',
      'retire-claim',
    ],
    forbiddenEffects: [
      'delete-branch',
      'delete-object',
      'delete-ref',
      'delete-reflog',
      'force-push',
      'prune-peer-registration',
      'remove-directory-bytes',
    ],
    parametersDigest: hex('6'),
  })
  const planBytes = encodeEffectPlan(plan)
  const planByteDigest = sha256(planBytes)
  const request = retire({
    ...source,
    dependentWork: [`effect-plan:sha256:${planByteDigest}`],
  })
  const operationInput = githubTransitionClient.createGitHubTransitionInput({
    request, plan, planByteDigest, predecessorIssuance: null,
  })
  const payload = githubTransitionClient.encodeGitHubTransitionInput(operationInput)
    .toString('utf8')
  return { payload, operationInputDigest:
    githubTransitionClient.deriveGitHubTransitionInputDigest(payload) }
}

test('ACOS consumes one protected immutable agentic-os authority adapter', () => {
  const pkg = JSON.parse(read('package.json'))
  const lock = JSON.parse(read('package-lock.json'))
  const installed = lock.packages['node_modules/agentic-os']
  assert.equal(pkg.devDependencies['agentic-os'], PIN)
  assert.equal(lock.packages[''].devDependencies['agentic-os'], PIN)
  assert.equal(installed.resolved, PIN)
  assert.equal(installed.integrity, INTEGRITY)
  assert.equal(installed.bin['agentic-os-authority'], 'bin/agentic-os-authority.mjs')
  assert.equal(installed.bin['agentic-os-transition'], 'bin/agentic-os-transition.mjs')
  assert.equal(Object.hasOwn(githubAuthority, 'GITHUB_ACTIONS_RULESET_BYPASS'), false)
  assert.equal(typeof verifyGitHubAuthorityIssuanceLive, 'function')
  for (const operation of [
    'createGitHubTransitionInput',
    'deriveGitHubTransitionCoordinate',
    'deriveGitHubTransitionInputDigest',
    'deriveGitHubTransitionRunName',
    'encodeGitHubTransitionInput',
    'validateGitHubStoredTransition',
    'validateGitHubTransitionDispatchEvent',
    'validateGitHubTransitionInput',
    'validateGitHubTransitionInputBytes',
    'validateGitHubTransitionWorkflowRun',
  ]) assert.equal(typeof githubTransitionClient[operation], 'function', operation)
  assert.equal(Object.hasOwn(githubTransitionClient, 'publishGitHubTransitionAuthority'), false)
  for (const operation of [
    'prepareGitHubIntegrationProviderProof',
    'publishGitHubTransitionAuthority',
    'createGitHubTransitionAuthorityVerifier',
  ]) assert.equal(typeof githubTransitionAuthority[operation], 'function', operation)
  for (const operation of [
    'assertGitHubTransitionPolicyTarget',
    'encodeGitHubTransitionPolicy',
    'validateGitHubTransitionPolicy',
    'validateGitHubTransitionPolicyExecution',
  ]) assert.equal(typeof githubTransitionPolicy[operation], 'function', operation)
})

test('the installed read-only authority CLI accepts bounded ambient GitHub event metadata', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'acos-authority-envelope-'))
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const eventPath = path.join(temporary, 'event.json')
  const policyName = 'adlc-authority-policy.json'
  fs.writeFileSync(path.join(temporary, policyName),
    fs.readFileSync(path.join(ROOT, '.github', policyName)))
  const event = {
    ambient: 'x'.repeat(70_000),
    inputs: {
      authority_payload: JSON.stringify({ request: {}, candidate: {} }),
      authority_input_digest: hex('a'),
    },
    repository: Object.fromEntries(Array.from({ length: 95 }, (_, index) => [
      `field${index}`, index,
    ])),
  }
  const eventBytes = Buffer.from(JSON.stringify(event))
  assert.ok(eventBytes.length > 64 * 1024 && eventBytes.length < 256 * 1024)
  fs.writeFileSync(eventPath, eventBytes)
  const revision = 'b'.repeat(40)
  const cli = path.join(ROOT, 'node_modules', 'agentic-os', 'bin',
    'agentic-os-authority.mjs')
  const run = () => spawnSync(process.execPath, [cli, 'validate-event', `--event=${eventPath}`,
    `--policy=${policyName}`], {
    cwd: temporary,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REF: 'refs/heads/main',
      GITHUB_REPOSITORY: 'huijoohwee/agentic-canvas-os',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_RUN_ID: '1',
      GITHUB_SHA: revision,
      GITHUB_WORKFLOW_REF:
        'huijoohwee/agentic-canvas-os/.github/workflows/adlc-authority.yml@refs/heads/main',
      GITHUB_WORKFLOW_SHA: revision,
    },
  })
  const result = run()
  assert.equal(result.status, 1)
  assert.match(result.stderr, /authority validation failed/u)
  assert.doesNotMatch(result.stderr, /GitHub event exceeds structural bounds/u)
  fs.writeFileSync(eventPath, JSON.stringify({
    ...event, ambient: 'x'.repeat(256 * 1024),
  }))
  const oversized = run()
  assert.equal(oversized.status, 1)
  assert.match(oversized.stderr, /GitHub event byte budget exceeded/u)
})

test('the transition policy is canonical and authorizes only exact repositories', () => {
  const bytes = fs.readFileSync(path.join(ROOT, '.agentic-os', 'github-transition-policy.json'))
  const policy = JSON.parse(bytes.toString('utf8'))
  assert.deepEqual(policy, {
    authorityRef: 'refs/heads/main',
    authorityRepository: 'github.com/huijoohwee/agentic-canvas-os',
    evidenceRefPrefix: 'refs/heads/adlc/authority/',
    schema: 'agentic-os/github-transition-policy/v1',
    targetRepositories: [
      'github.com/huijoohwee/agentic-canvas-os',
      'github.com/huijoohwee/agentic-commerce-os',
      'github.com/huijoohwee/agentic-os',
      'github.com/huijoohwee/knowgrph',
    ],
    workflowPath: '.github/workflows/adlc-transition.yml',
  })
  assert.equal(githubTransitionPolicy.GITHUB_TRANSITION_POLICY_PATH,
    '.agentic-os/github-transition-policy.json')
  assert.deepEqual(bytes, githubTransitionPolicy.encodeGitHubTransitionPolicy(policy))
  for (const target of policy.targetRepositories) {
    assert.deepEqual(githubTransitionPolicy.assertGitHubTransitionPolicyTarget(policy, target),
      githubTransitionPolicy.validateGitHubTransitionPolicy(policy))
  }
  assert.throws(() => githubTransitionPolicy.assertGitHubTransitionPolicyTarget(
    policy, 'github.com/huijoohwee/unlisted'), /not authorized/u)
  assert.throws(() => githubTransitionPolicy.validateGitHubTransitionPolicy({
    ...policy, targetRepositoryPrefixes: ['github.com/huijoohwee/'],
  }), /fields/u)
})

test('the installed read-only transition CLI validates canonical Actions inputs', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'acos-transition-consumer-'))
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  fs.mkdirSync(path.join(temporary, '.agentic-os'))
  const policyPath = path.join(temporary, '.agentic-os', 'github-transition-policy.json')
  const canonicalPolicy = fs.readFileSync(path.join(ROOT, '.agentic-os',
    'github-transition-policy.json'))
  fs.writeFileSync(policyPath, canonicalPolicy)
  const fixture = transitionFixture()
  const eventPath = path.join(temporary, 'event.json')
  fs.writeFileSync(eventPath, JSON.stringify({ inputs: {
    operation_payload: fixture.payload,
    operation_input_digest: fixture.operationInputDigest,
  } }))
  const revision = 'b'.repeat(40)
  const env = {
    ...process.env,
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_REPOSITORY: 'huijoohwee/agentic-canvas-os',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_SHA: revision,
    GITHUB_WORKFLOW_REF:
      'huijoohwee/agentic-canvas-os/.github/workflows/adlc-transition.yml@refs/heads/main',
    GITHUB_WORKFLOW_SHA: revision,
  }
  const cli = path.join(ROOT, 'node_modules', 'agentic-os', 'bin',
    'agentic-os-transition.mjs')
  const run = nextEnv => spawnSync(process.execPath, [cli, 'validate-event'], {
    cwd: temporary,
    env: nextEnv,
    encoding: 'utf8',
  })
  const valid = run(env)
  assert.equal(valid.status, 0, valid.stderr)
  const repeated = run({ ...env, GITHUB_RUN_ATTEMPT: '2' })
  assert.equal(repeated.status, 1)
  assert.match(repeated.stderr, /workflow identity/u)
  fs.appendFileSync(policyPath, '\n')
  const noncanonical = run(env)
  assert.equal(noncanonical.status, 1)
  assert.match(noncanonical.stderr, /not canonical committed bytes/u)
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
  assert.match(workflow, /^permissions:\n  contents: read$/mu)
  assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/u)
  assert.match(workflow, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/u)
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}[\s\S]*persist-credentials: false/u)
  assert.match(workflow, /npm ci --ignore-scripts --no-audit --no-fund/u)
  assert.match(workflow, /agentic-os-authority validate-event --event="\$GITHUB_EVENT_PATH" --policy=\.github\/adlc-authority-policy\.json/u)
  assert.doesNotMatch(workflow,
    /\bcontents:\s*write\b|\bactions:\s*write\b|GITHUB_TOKEN|github\.token|\bsecrets\.|\bcurl\b|\bgh\s+api\b|upload-artifact/u)
  const executionWorkflow = workflow.split('\n')
    .filter(line => !line.startsWith('run-name:'))
    .join('\n')
  assert.doesNotMatch(executionWorkflow, /\$\{\{\s*(?:inputs\.|github\.event\.inputs)/u)

  const writeWorkflows = fs.readdirSync(path.join(ROOT, '.github', 'workflows'))
    .filter(name => /\.ya?ml$/u.test(name))
    .filter(name => /\bcontents:\s*write\b/u.test(read(path.join('.github', 'workflows', name))))
  assert.deepEqual(writeWorkflows, [])
})

test('the transition workflow is read-only exact-input validation', () => {
  const workflow = read('.github/workflows/adlc-transition.yml')
  assert.match(workflow, /^  workflow_dispatch:\n/mu)
  assert.deepEqual([...workflow.matchAll(/^      ([a-z_]+):$/gmu)].map(match => match[1]), [
    'operation_payload', 'operation_input_digest',
  ])
  assert.match(workflow, /operation_payload:[\s\S]*required: true[\s\S]*type: string/u)
  assert.match(workflow, /operation_input_digest:[\s\S]*required: true[\s\S]*type: string/u)
  assert.match(workflow,
    /run-name: ADLC transition \$\{\{ inputs\.operation_input_digest \}\} @ \$\{\{ github\.workflow_sha \}\}/u)
  assert.match(workflow, /^permissions:\n  contents: read$/mu)
  assert.doesNotMatch(workflow, /\bcontents:\s*write\b|GITHUB_TOKEN|github\.token|\bsecrets\./u)
  assert.doesNotMatch(workflow, /^\s{2}(?:pull_request|push|schedule|merge_group):/mu)
  assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/u)
  assert.match(workflow, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/u)
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}[\s\S]*persist-credentials: false/u)
  assert.match(workflow, /npm ci --ignore-scripts --no-audit --no-fund/u)
  assert.match(workflow, /agentic-os-transition validate-event/u)
  assert.doesNotMatch(workflow, /\bcurl\b|\bgh\s+api\b|upload-artifact/u)
  const executionWorkflow = workflow.split('\n')
    .filter(line => !line.startsWith('run-name:'))
    .join('\n')
  assert.doesNotMatch(executionWorkflow, /\$\{\{\s*(?:inputs\.|github\.event\.inputs)/u)
})

test('the retained profile and initial authority surfaces stay byte-identical', () => {
  assert.deepEqual({
    '.agentic-os.json': digest('.agentic-os.json'),
    '.github/adlc-authority-policy.json': digest('.github/adlc-authority-policy.json'),
    '.github/workflows/adlc-authority.yml': digest('.github/workflows/adlc-authority.yml'),
  }, {
    '.agentic-os.json': '3fe2918ca7629edd5aa5f50186dcca5a9169f5f2d384301a6b55d785e88518ba',
    '.github/adlc-authority-policy.json':
      'df118c2eb4bed96b07445602c6f7111b717069ec1e36030402c5f8cef4c818aa',
    '.github/workflows/adlc-authority.yml':
      'b98345f744dbb2aba5f681468d688c537ea5d31d5d56d7b85cd5efe21b9b865e',
  })
})
