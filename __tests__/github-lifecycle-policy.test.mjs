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

test('CI keeps protected checks on Node 22 slim runners without dependency caches', async () => {
  const source = await readWorkflow('ci.yml');
  assert.match(source, /pull_request:\n\s+paths:\n\s+- "\*\*"/);
  for (const name of ['test', 'build', 'docs-contract', 'collaboration-integration']) {
    assert.match(source, new RegExp(`^\\s+name: ${name}$`, 'm'));
  }
  assert.equal((source.match(/^\s+- run: npm ci\b/gm) || []).length, 0);
  assert.equal((source.match(/^\s+cache: npm$/gm) || []).length, 0);
  assert.equal((source.match(/^\s+runs-on: ubuntu-slim$/gm) || []).length, 4);
  assert.equal((source.match(/^\s+node-version: 22$/gm) || []).length, 4);
  assert.doesNotMatch(source, /timeout-minutes: (?:1[1-9]|[2-9]\d)/);
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
  assert.match(dependencySecurity, /actions\/dependency-review-action@2031cfc080254a8a887f58cffee85186f0e49e48/);
  assert.match(dependencySecurity, /runs-on: ubuntu-slim/);
  assert.match(dependencySecurity, /node-version: 22/);
  assert.doesNotMatch(dependencySecurity, /^\s+- run: npm ci\b/gm);
  assert.doesNotMatch(dependencySecurity, /^\s+cache: npm$/gm);

  const sync = await readWorkflow('sync-open-prs.yml');
  assert.match(sync, /node-version: 22/);
  assert.doesNotMatch(sync, /^\s+- run: npm ci\b/gm);
  assert.doesNotMatch(sync, /^\s+cache: npm$/gm);
  assert.match(sync, /timeout-minutes: 5/);

  const autoDelivery = await readWorkflow('auto-delivery.yml');
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
  assert.match(source, /workflow_dispatch:\n\s+inputs:\n\s+pull_request_number:/);
  assert.match(source, /pull_request_number:\n\s+description:.*\n\s+required: true\n\s+type: number/);
  assert.match(source, /cancel-in-progress: false/);
  assert.ok(
    source.indexOf('    concurrency:') > source.indexOf('jobs:\n  enable:'),
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

  const controller = await readFile(path.join(repositoryRoot, 'scripts', 'sync-open-pr.mjs'), 'utf8');
  assert.ok(
    controller.indexOf('const eventPull') < controller.indexOf('const pulls'),
    'exact event revocation must precede global scope validation',
  );
  assert.match(controller, /--disable-auto/);
  assert.match(controller, /--remove-label", AUTO_DELIVERY_LABEL/);
  assert.match(controller, /"--match-head-commit", headSha/);
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
