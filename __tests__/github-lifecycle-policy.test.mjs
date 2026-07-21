import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowDirectory = path.join(repositoryRoot, '.github', 'workflows');

async function readWorkflow(name) {
  return readFile(path.join(workflowDirectory, name), 'utf8');
}

test('CI and security workflows are merge-queue safe and immutable', async () => {
  for (const name of ['ci.yml', 'security.yml']) {
    const source = await readWorkflow(name);
    assert.match(source, /^\s*merge_group:/m, `${name} must run for merge groups`);
    assert.match(source, /^\s*timeout-minutes:\s*\d+/m, `${name} must bound job runtime`);
    assert.doesNotMatch(
      source,
      /^\s*-?\s*uses:\s*[^\s]+@v\d+/m,
      `${name} must pin actions to full commit SHAs`,
    );
  }
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
