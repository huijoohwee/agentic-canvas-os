import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowDirectory = path.join(repositoryRoot, '.github', 'workflows');

async function readWorkflow(name) {
  return readFile(path.join(workflowDirectory, name), 'utf8');
}

test('required CI is merge-queue safe and every workflow pins actions immutably', async () => {
  const ci = await readWorkflow('ci.yml');
  assert.match(ci, /^\s*merge_group:/m);
  assert.match(ci, /^\s*timeout-minutes:\s*\d+/m);

  for (const name of await readdir(workflowDirectory)) {
    if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;
    const source = await readWorkflow(name);
    assert.doesNotMatch(
      source,
      /^\s*-?\s*uses:\s*[^\s]+@v\d+/m,
      `${name} must pin actions to full commit SHAs`,
    );
  }
});


test('supported GitHub Actions use approved Node 24 runtime pins', async () => {
  const approvedPins = new Map([
    ['actions/checkout', '3d3c42e5aac5ba805825da76410c181273ba90b1'],
    ['actions/setup-node', '820762786026740c76f36085b0efc47a31fe5020'],
    ['actions/dependency-review-action', 'a1d282b36b6f3519aa1f3fc636f609c47dddb294'],
    ['github/codeql-action/init', 'e4fba868fa4b1b91e1fdab776edc8cfbe6e9fb81'],
    ['github/codeql-action/analyze', 'e4fba868fa4b1b91e1fdab776edc8cfbe6e9fb81'],
  ]);
  const observedActions = new Set();

  for (const name of await readdir(workflowDirectory)) {
    if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;
    const source = await readWorkflow(name);
    const matches = source.matchAll(
      /uses:\s+(actions\/checkout|actions\/setup-node|actions\/dependency-review-action|github\/codeql-action\/(?:init|analyze))@([0-9a-f]{40})/g,
    );
    for (const [, action, revision] of matches) {
      observedActions.add(action);
      assert.equal(
        revision,
        approvedPins.get(action),
        `${name} must use the approved ${action} revision`,
      );
    }
  }

  assert.deepEqual(observedActions, new Set(approvedPins.keys()));
});
test('CI uses Node 22 slim runners without dependency caches', async () => {
  const source = await readWorkflow('ci.yml');
  assert.match(
    source,
    /on:\n\s+pull_request:\n\s+types: \[opened, synchronize, reopened, ready_for_review\]\n\s+merge_group:/,
  );
  assert.doesNotMatch(source, /pull_request:\n\s+paths:/);
  for (const name of ['test', 'build', 'docs-contract', 'collaboration-integration']) {
    assert.match(source, new RegExp(`^\\s+name: ${name}$`, 'm'));
  }
  const testJob = source.slice(source.indexOf('\n  test:'), source.indexOf('\n  test_aggregate:'));
  assert.match(testJob, /^\s+- run: npm ci --ignore-scripts --no-audit --no-fund$/m);
  assert.equal((source.match(/^\s+- run: npm ci\b/gm) || []).length, 2);
  assert.equal((source.match(/^\s+cache: npm$/gm) || []).length, 0);
  assert.equal((source.match(/^\s+runs-on: ubuntu-slim$/gm) || []).length, 7);
  assert.equal((source.match(/^\s+node-version: 22$/gm) || []).length, 5);
  assert.doesNotMatch(source, /timeout-minutes: (?:1[1-9]|[2-9]\d)/);
});

test('CI shards the complete Node test suite and preserves one fail-closed required context', async () => {
  const source = await readWorkflow('ci.yml');
  const shards = source.slice(source.indexOf('\n  test:'), source.indexOf('\n  test_aggregate:'));
  const aggregate = source.slice(source.indexOf('\n  test_aggregate:'), source.indexOf('\n  build:'));

  assert.match(shards, /^\s+name: test$/m);
  assert.match(shards, /^\s+timeout-minutes: 10$/m);
  assert.match(shards, /^\s+fail-fast: false$/m);
  assert.match(shards, /^\s+shard: \[1, 2, 3, 4\]$/m);
  assert.match(
    shards,
    /^\s+- run: node --test --test-shard=\$\{\{ matrix\.shard \}\}\/4 __tests__\/\*\.test\.mjs$/m,
  );
  assert.doesNotMatch(source, /^\s+- run: npm test$/m);

  assert.match(aggregate, /^\s+name: test$/m);
  assert.match(aggregate, /^\s+needs: \[authorization, test\]$/m);
  assert.match(aggregate, /^\s+if: \$\{\{ always\(\) \}\}$/m);
  assert.match(aggregate, /^\s+timeout-minutes: 5$/m);
  assert.match(aggregate, /AUTHORIZATION_RESULT: \$\{\{ needs\.authorization\.result \}\}/);
  assert.match(aggregate, /TEST_SHARDS_RESULT: \$\{\{ needs\.test\.result \}\}/);
  assert.match(aggregate, /\[ "\$AUTHORIZATION_RESULT" = "success" \] \|\| exit 1/);
  assert.match(aggregate, /\[ "\$TEST_SHARDS_RESULT" = "success" \] \|\| exit 1/);
});

test('CI reports policy-runtime readiness without claiming consumer-run conformance', async () => {
  const source = await readWorkflow('ci.yml');
  const evaluateJob = source.slice(
    source.indexOf('\n  evaluate:'),
    source.indexOf('\n  conformance:'),
  );
  const policyRuntimeJob = source.slice(source.indexOf('\n  conformance:'));

  assert.match(evaluateJob, /^\s+name: policy-runtime-readiness$/m);
  assert.match(
    evaluateJob,
    /npm run lifecycle:conformance:check/,
  );
  assert.match(evaluateJob, /npm run agentic-sdlc:source:check/);
  assert.match(
    evaluateJob,
    /repository: huijoohwee\/huijoohwee\.github\.io\n\s+ref: \$\{\{ steps\.guideline-source\.outputs\.revision \}\}[\s\S]*?fetch-depth: 0/,
  );
  assert.match(
    evaluateJob,
    /LIFECYCLE_POLICY_SOURCE.*scripts\/lifecycle-conformance-policy\.mjs/,
  );
  assert.match(
    evaluateJob,
    /GITHUB_ROOT: \$\{\{ github\.workspace \}\}\/\.agentic-sdlc-source/,
  );
  assert.doesNotMatch(evaluateJob, /agentic-sdlc:verify|consumer run conformance/i);

  assert.match(policyRuntimeJob, /^\s+name: agentic-sdlc-policy-runtime$/m);
  assert.doesNotMatch(policyRuntimeJob, /^\s+name: agentic-sdlc-conformance$/m);
  assert.match(policyRuntimeJob, /^\s+needs: evaluate$/m);
  assert.match(policyRuntimeJob, /^\s+if: \$\{\{ always\(\) \}\}$/m);
  assert.match(policyRuntimeJob, /EVALUATE_RESULT: \$\{\{ needs\.evaluate\.result \}\}/);
  assert.match(policyRuntimeJob, /if \[ "\$EVALUATE_RESULT" != "success" \]/);
});

test('source and dependency security use separate minimal trigger scopes', async () => {
  const security = await readWorkflow('security.yml');
  assert.match(security, /pull_request:\n\s+paths:/);
  assert.match(security, /push:\n\s+branches: \[main\]\n\s+paths:/);
  assert.doesNotMatch(security, /^\s*merge_group:/m);
  assert.doesNotMatch(security, /npm audit|dependency-review-action/);
  assert.match(security, /trap-caching: false/);

  const dependencySecurity = await readWorkflow('dependency-security.yml');
  assert.match(dependencySecurity, /"package\.json"/);
  assert.match(dependencySecurity, /"package-lock\.json"/);
  assert.match(dependencySecurity, /npm audit --package-lock-only --audit-level=high/);
  assert.match(dependencySecurity, /actions\/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294/);
  assert.match(dependencySecurity, /runs-on: ubuntu-slim/);
  assert.match(dependencySecurity, /node-version: 22/);
  assert.doesNotMatch(dependencySecurity, /^\s+- run: npm ci\b/gm);
  assert.doesNotMatch(dependencySecurity, /^\s+cache: npm$/gm);

  const sync = await readWorkflow('sync-open-prs.yml');
  assert.match(sync, /runs-on: ubuntu-slim/);
  assert.match(sync, /node-version: 22/);
  assert.doesNotMatch(sync, /^\s+- run: npm ci\b/gm);
  assert.doesNotMatch(sync, /^\s+cache: npm$/gm);
  assert.match(sync, /timeout-minutes: 5/);

  const autoDelivery = await readWorkflow('auto-delivery.yml');
  assert.match(autoDelivery, /runs-on: ubuntu-slim/);
  assert.match(autoDelivery, /node-version: 22/);
});

test('the project runtime matches the pinned Wrangler engine', async () => {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(repositoryRoot, 'package-lock.json'), 'utf8'));
  assert.equal(packageJson.engines.node, '>=22');
  assert.equal(lock.packages[''].engines.node, '>=22');
  assert.match(lock.packages['node_modules/wrangler'].engines.node, />=22/);
});

test('synchronization avoids unnecessary installs and cache restores', async () => {
  const security = await readWorkflow('security.yml');
  assert.doesNotMatch(security, /^\s+- run: npm ci\b/gm);
  assert.doesNotMatch(security, /^\s+cache: npm$/gm);

  const sync = await readWorkflow('sync-open-prs.yml');
  assert.doesNotMatch(sync, /^\s+- run: npm ci\b/gm);
  assert.doesNotMatch(sync, /^\s+cache: npm$/gm);
  assert.match(sync, /timeout-minutes: 5/);
});

test('auto-delivery revokes stale exact-head authorization without label races', async () => {
  const source = await readWorkflow('auto-delivery.yml');
  assert.match(
    source,
    /types: \[labeled, unlabeled, edited, converted_to_draft, ready_for_review, synchronize, reopened\]/,
  );
  assert.match(source, /workflow_dispatch:\n\s+inputs:\n\s+operation:/);
  assert.match(source, /pull_request_number:\n\s+description:.*\n\s+required: true\n\s+type: number/);
  for (const input of [
    'operation',
    'pull_request_number',
    'branch',
    'delivered_head_sha',
    'observed_head_sha',
    'target_main_sha',
    'canonical_base_sha',
    'claim_id',
    'claim_digest',
    'ledger_revision',
    'review_request_id',
    'pull_request_node_id',
    'pull_request_title',
    'auto_merge_method',
    'auto_merge_enabled_by_database_id',
    'auto_merge_enabled_by_node_id',
    'auto_merge_enabled_by_login',
    'auto_merge_enabled_by_type',
    'auto_merge_commit_title',
    'auto_merge_commit_message',
    'candidate_auto_merge_commit_title',
    'candidate_auto_merge_commit_message',
    'integration_receipt_digest',
    'transition_counter',
    'operation_id',
  ]) {
    assert.match(source, new RegExp(`^      ${input}:$`, 'm'));
  }
  assert.match(source, /cancel-in-progress: false/);
  assert.match(
    source,
    /github\.event_name == 'workflow_dispatch' &&\n\s+github\.ref == 'refs\/heads\/main'/,
  );
  assert.doesNotMatch(source, /inputs\.operation != 'protected-head-refresh'/);
  assert.ok(
    source.indexOf('    concurrency:') > source.indexOf('jobs:\n  auto-delivery:'),
    'concurrency must apply only after the job event filter',
  );
  assert.match(
    source,
    /group: auto-delivery-\$\{\{ github\.event\.pull_request\.number \|\| inputs\.pull_request_number \}\}/,
  );
  assert.match(source, /contains\(github\.event\.pull_request\.labels\.\*\.name, 'agentic\/auto-delivery'\)/);
  assert.match(source, /github\.event\.label\.name == 'agentic\/auto-delivery'/);
  assert.match(source, /github\.event\.label\.name == 'automerge\/conflict'/);
  assert.match(
    source,
    /AUTO_DELIVERY_PR_NUMBER: \$\{\{ github\.event\.pull_request\.number \|\| inputs\.pull_request_number \}\}/,
  );
  assert.match(
    source,
    /AGENTIC_LEDGER_REPOSITORY: \$\{\{ github\.repository \}\}/,
  );
  assert.match(source, /ref: \$\{\{ github\.sha \}\}\n\s+persist-credentials: false\n\s+fetch-depth: 0/);
  assert.match(source, /run: node scripts\/sync-open-pr\.mjs --protected-head-refresh/);
  assert.match(source, /PROTECTED_HEAD_REFRESH_OPERATION_ID: \$\{\{ inputs\.operation_id \}\}/);
  assert.match(source, /PROTECTED_HEAD_REFRESH_TARGET_MAIN_SHA: \$\{\{ inputs\.target_main_sha \}\}/);
  assert.match(source, /PROTECTED_HEAD_REFRESH_CONTROLLER_REVISION: \$\{\{ github\.sha \}\}/);
  assert.match(source, /^permissions: \{\}$/m);
  assert.match(source, /auto-delivery:[\s\S]*?permissions:\n      contents: write\n      pull-requests: write/);
  assert.match(source, /protected-head-refresh:[\s\S]*?permissions:\n      actions: write\n      checks: write\n      contents: write\n      pull-requests: read/);
  const protectedJob = source.slice(source.indexOf('\n  protected-head-refresh:'));
  assert.match(protectedJob, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(protectedJob, /runs-on: ubuntu-slim/);
  assert.match(protectedJob, /timeout-minutes: 60/);
  assert.match(source, /PROTECTED_HEAD_REFRESH_AUTO_MERGE_ENABLED_BY_DATABASE_ID/);
  assert.match(source, /PROTECTED_HEAD_REFRESH_AUTO_MERGE_COMMIT_MESSAGE/);
  assert.match(source, /PROTECTED_HEAD_REFRESH_CANDIDATE_AUTO_MERGE_COMMIT_TITLE/);
  assert.match(source, /PROTECTED_HEAD_REFRESH_CANDIDATE_AUTO_MERGE_COMMIT_MESSAGE/);
  assert.doesNotMatch(source, /AUTO_DELIVERY_EVENT_(?:NAME|ACTION|BEFORE|AFTER|ACTOR|SENDER)/);

  const controller = await readFile(path.join(repositoryRoot, 'scripts', 'sync-open-pr.mjs'), 'utf8');
  assert.ok(
    controller.indexOf('const eventPull') < controller.indexOf('const pulls'),
    'exact event revocation must precede global scope validation',
  );
  assert.match(controller, /--disable-auto/);
  assert.match(controller, /--remove-label", AUTO_DELIVERY_LABEL/);
  assert.match(controller, /"--match-head-commit", headSha/);
  assert.match(
    controller,
    /"--subject", squashSubject, "--match-head-commit", headSha/,
  );
  assert.ok(
    controller.indexOf('if (protectedHeadRefreshOnly)') < controller.indexOf('const pulls'),
    'protected refresh must run before label and global PR selection',
  );
  const [protectedAdapter, protectedProvider, protectedPolicy] = await Promise.all([
    readFile(
      path.join(repositoryRoot, 'scripts', 'protected-head-refresh-github-adapter.mjs'),
      'utf8',
    ),
    readFile(
      path.join(repositoryRoot, 'scripts', 'protected-head-refresh-github-provider.mjs'),
      'utf8',
    ),
    readFile(
      path.join(repositoryRoot, 'scripts', 'protected-head-refresh-repository-policy.mjs'),
      'utf8',
    ),
  ]);
  const protectedController = `${protectedAdapter}\n${protectedProvider}\n${protectedPolicy}`;
  assert.match(protectedController, /invokeRepositoryCloudVerifier/);
  assert.match(protectedController, /expectedLedgerRevision: projection\.ledger_revision/);
  assert.match(protectedController, /requiredEnv\("GITHUB_REF"\) !== "refs\/heads\/main"/);
  assert.match(protectedController, /agentic-protected-head-refresh-result\/v1/);
  assert.match(protectedController, /operationId: projection\.operation_id/);
  assert.match(protectedController, /controllerRevision/);
  assert.ok(
    protectedController.indexOf('requireProtectedHeadRefreshControllerRevision({')
      < protectedController.indexOf('executeProtectedHeadRefreshController({'),
    'controller revision equality must be proven before provider orchestration',
  );
  assert.match(protectedController, /PROTECTED_HEAD_REFRESH_TARGET_MAIN_SHA/);
  assert.match(protectedController, /readProtectedMainSha/);
  assert.match(
    protectedController,
    /--force-with-lease=refs\/heads\/\$\{branch\}:\$\{observedHeadSha\}/,
  );
  assert.doesNotMatch(protectedController, /["'`]--force["'`]/);
  assert.doesNotMatch(protectedController, /update-branch/);
  assert.doesNotMatch(controller, /update-branch/);
  assert.match(protectedController, /GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic \$\{authorization\}`/);
  const protectedPush = protectedController.slice(
    protectedController.indexOf('pushCandidate:'),
    protectedController.indexOf('verifyCandidateWorkflow:'),
  );
  const protectedPushArgv = protectedPush.slice(
    protectedPush.indexOf('git(['),
    protectedPush.indexOf('], {'),
  );
  assert.doesNotMatch(protectedPushArgv, /GH_TOKEN|token|authorization|x-access-token/i);
  assert.match(protectedPush, /GIT_CONFIG_VALUE_0/);
  for (const trace of [
    'GIT_TRACE',
    'GIT_TRACE_PACKET',
    'GIT_TRACE_PACK_ACCESS',
    'GIT_CURL_VERBOSE',
  ]) assert.match(protectedPush, new RegExp(`${trace}: "0"`));
  assert.doesNotMatch(protectedController, /\$\{candidateSha\}:refs\/heads\/main/);
  assert.match(protectedController, /"workflow", "run", policy\.ciWorkflow/);
  assert.match(protectedController, /"-f", "operation=protected-head-refresh"/);
  assert.match(protectedController, /`expected_head_sha=\$\{candidateSha\}`/);
  assert.match(protectedController, /verifyCandidateWorkflow/);
  assert.match(protectedController, /`\$\{candidateSha\}:\$\{workflowPath\}`/);
  assert.match(protectedController, /`\$\{targetMainSha\}:\$\{workflowPath\}`/);
  assert.match(protectedController, /candidateBytes\.equals\(trustedBytes\)/);
  assert.ok(
    protectedController.indexOf('verifyCandidateWorkflow:')
      < protectedController.indexOf('reconcileCandidateCi:'),
    'trusted-main CI bytes must be verified before any workflow dispatch',
  );
  for (const context of [
    'test',
    'build',
    'docs-contract',
    'collaboration-integration',
    'agentic-sdlc-policy-runtime',
    'cloud-collaboration',
  ]) {
    assert.match(protectedController, new RegExp(`"${context}"`));
  }
  assert.match(protectedController, /check-suites\/\$\{ci\.checkSuiteId\}\/check-runs/);
  assert.match(protectedController, /run\?\.app\?\.id === PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID/);
  assert.match(protectedController, /run\?\.app\?\.slug === "github-actions"/);
  assert.match(protectedController, /status: "in_progress"/);
  assert.match(protectedController, /renderProtectedHeadRefreshHandshakeEvidence/);
  assert.match(protectedController, /pending-user-authorization/);
  assert.match(protectedController, /authorization-complete/);
  assert.match(protectedController, /matching\.length !== 1/);
  assert.match(
    protectedController,
    /"--method", "PATCH", `repos\/\$\{repository\}\/check-runs\/\$\{checkRunId\}`/,
  );
  assert.match(protectedController, /branchProtectionRule/);
  assert.match(protectedController, /rules\/branches\/main/);
  assert.match(protectedController, /strict_required_status_checks_policy === true/);
  assert.match(protectedController, /auditedWorkflows: \["auto-delivery\.yml", "cloud-collaboration\.yml"\]/);
  assert.doesNotMatch(protectedController, /enablePullRequestAutoMerge|"--auto"|--disable-auto/);
  assert.doesNotMatch(protectedController, /npm (?:test|run)|node --test/);
  assert.doesNotMatch(controller, /preserveControllerRefreshSynchronize|ProtectedRefreshSynchronize/);
  const mergedVerifier = protectedAdapter.slice(
    protectedAdapter.indexOf('verifyMergedCommit:'),
    protectedAdapter.indexOf('sleep:', protectedAdapter.indexOf('verifyMergedCommit:')),
  );
  assert.match(mergedVerifier, /verifyProtectedHeadRefreshMergedProviderState/);
  const mergedProviderHelper = protectedAdapter.slice(
    protectedAdapter.indexOf('export function verifyProtectedHeadRefreshMergedProviderState'),
    protectedAdapter.indexOf('\nfunction projectionInput'),
  );
  assert.match(mergedProviderHelper, /fetchProtectedMainRef\(providerMainSha\)/);
  assert.doesNotMatch(
    mergedProviderHelper,
    /fetchProtectedHeadRefreshRefs/,
    'merged replay must survive provider deletion of the feature branch',
  );
});

test('cloud collaboration workflow is serialized, least-privilege, and exact-head', async () => {
  const source = await readWorkflow('cloud-collaboration.yml');
  assert.match(source, /^\s*pull_request_target:/m);
  assert.match(source, /^\s*push:\n\s+branches: \[main\]/m);
  assert.match(source, /^\s*workflow_dispatch:/m);
  assert.match(source, /group: agentic-cloud-collaboration-ledger/);
  assert.match(source, /queue: max/);
  assert.doesNotMatch(source, /cancel-in-progress:\s*true/);
  assert.doesNotMatch(source, /merge_group:/);
  assert.match(source, /^\s+name: cloud-collaboration$/m);
  assert.match(source, /checks: write\n\s+contents: read\n\s+pull-requests: read/);
  assert.match(source, /contents: write\n\s+pull-requests: read/);
  assert.doesNotMatch(source, /pull-requests: write|actions: write|id-token: write/);
  assert.equal((source.match(/^\s+cache: npm$/gm) || []).length, 0);
  assert.equal((source.match(/^\s+- run: npm ci\b/gm) || []).length, 0);
  assert.match(source, /AGENTIC_DEVICE_ID: github-actions/);
  assert.match(source, /AGENTIC_SESSION_ID: workflow-run:\$\{\{ github\.run_id \}\}/);
  assert.doesNotMatch(source, /GITHUB_RUN_ATTEMPT/);

  const controller = await readFile(
    path.join(repositoryRoot, 'scripts', 'cloud-collaboration-check-run.mjs'),
    'utf8',
  );
  assert.match(controller, /head_sha: subject\.headSha/);
  assert.match(controller, /status: "in_progress"/);
  assert.match(controller, /status: "completed"/);
  assert.match(controller, /GITHUB_EVENT_NAME !== "pull_request_target"/);

  const configuration = await readFile(
    path.join(repositoryRoot, 'scripts', 'configure-github.mjs'),
    'utf8',
  );
  assert.match(configuration, /checks\.map\(\(context\) => \(\{ context, app_id: actionsAppId \}\)\)/);
  assert.match(configuration, /include: \[ledgerRef\]/);
  assert.match(configuration, /\{ type: "deletion" \}/);
  assert.match(configuration, /\{ type: "non_fast_forward" \}/);
  assert.doesNotMatch(configuration, /bypass_actors: \[[^\]]+\]/);
});

test('auto-delivery retains its retry signal when disable cannot be proven', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'acos-auto-delivery-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const commandLog = path.join(directory, 'commands.ndjson');
  const fakeGh = path.join(directory, 'gh');
  await writeFile(fakeGh, `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.GH_COMMAND_LOG, JSON.stringify(args) + "\\n");
const pull = {
  number: 17,
  draft: false,
  body: "",
  base: { ref: "main" },
  head: { ref: "agent/device/free-tier", sha: "changed-head", repo: { full_name: "owner/repo" } },
  labels: [{ name: "agentic/auto-delivery" }],
  auto_merge: { enabled_by: { login: "github-actions[bot]" } }
};
if (args[0] === "api") {
  process.stdout.write(JSON.stringify(pull));
  process.exit(0);
}
if (args.includes("--disable-auto")) {
  process.stderr.write("simulated disable failure");
  process.exit(1);
}
process.exit(0);
`);
  await chmod(fakeGh, 0o755);

  const result = spawnSync(
    process.execPath,
    [path.join(repositoryRoot, 'scripts', 'sync-open-pr.mjs'), '--auto-delivery'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}${path.delimiter}${process.env.PATH || ''}`,
        GH_COMMAND_LOG: commandLog,
        GITHUB_REPOSITORY: 'owner/repo',
        AUTO_DELIVERY_PR_NUMBER: '17',
      },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Could not confirm auto-merge revocation/);
  const commands = (await readFile(commandLog, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(
    commands.some((args) => args[0] === 'pr' && args[1] === 'edit'),
    false,
    'the authorization label remains as a retry signal',
  );
});

test('Workers observability excludes capability-bearing invocation URLs', async () => {
  const source = await readFile(path.join(repositoryRoot, 'wrangler.jsonc'), 'utf8');
  assert.match(source, /"workers_dev": false/);
  assert.match(source, /"preview_urls": false/);
  assert.equal((source.match(/"head_sampling_rate": 0\.01/g) || []).length, 4);
  assert.equal((source.match(/"invocation_logs": false/g) || []).length, 2);
  assert.equal((source.match(/"traces": \{\s*"enabled": false\s*\}/g) || []).length, 2);
});

test('Agentic Canvas OS cannot regain an independent production deploy lane', async () => {
  for (const name of ['deploy.yml', 'preview.yml', 'rollback.yml']) {
    await assert.rejects(
      access(path.join(workflowDirectory, name)),
      { code: 'ENOENT' },
      `${name} must remain owned by the Knowgrph release lifecycle`,
    );
  }

  const packageSource = await readFile(path.join(repositoryRoot, 'package.json'), 'utf8');
  const packageJson = JSON.parse(packageSource);
  assert.equal(packageJson.scripts.rollback, undefined);
  assert.equal(packageJson.scripts['cloudflare:deploy'], undefined);
});
