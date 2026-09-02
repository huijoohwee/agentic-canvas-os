import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateRepositoryProfile } from 'agentic-os';

test('the committed agentic-os profile preserves refs while opting into exact worktree quarantine', () => {
  const profile = JSON.parse(readFileSync(new URL('../.agentic-os.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateRepositoryProfile(profile), profile);
  assert.deepEqual(profile.requiredChecks, [
    'budgets', 'build', 'collaboration-integration', 'docs-contract', 'test',
  ]);
  assert.equal(profile.cleanup.worktreeProjection, 'quarantine');
  assert.equal(profile.cleanup.worktreeRegistration, 'quarantine');
  for (const target of ['remoteTrackingRef', 'localBranch', 'remoteBranch', 'unreachableObjects']) {
    assert.equal(profile.cleanup[target], 'retain', target);
  }
  assert.ok(profile.capabilities.includes('quarantine-worktree-cleanup-opt-in'));
  assert.equal(profile.capabilities.includes('retain-all-cleanup'), false);
  assert.equal(profile.profileDigest,
    '934ae07b9602bfe6c8368a161648750adf569096560893f6554a0be06203c1fe');
});
