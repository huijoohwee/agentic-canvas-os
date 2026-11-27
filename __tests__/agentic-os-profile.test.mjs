import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateRepositoryProfile } from 'agentic-os';

test('the committed agentic-os profile removes only clean worktrees and preserves Git refs', () => {
  const profile = JSON.parse(readFileSync(new URL('../.agentic-os.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateRepositoryProfile(profile), profile);
  assert.deepEqual(profile.requiredChecks, [
    'budgets', 'build', 'collaboration-integration', 'docs-contract', 'test',
  ]);
  assert.equal(profile.cleanup.worktreeProjection, 'remove-clean');
  assert.equal(profile.cleanup.worktreeRegistration, 'remove-clean');
  for (const target of ['remoteTrackingRef', 'localBranch', 'remoteBranch', 'unreachableObjects']) {
    assert.equal(profile.cleanup[target], 'retain', target);
  }
  assert.ok(profile.capabilities.includes('remove-clean-worktree-cleanup-opt-in'));
  assert.equal(profile.capabilities.includes('retain-all-cleanup'), false);
  assert.equal(profile.profileDigest,
    '87ccf0f3e37331ca8809bede2e3bf09c605f278c1ee2d65430f50235f2598523');
});
