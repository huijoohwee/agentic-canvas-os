import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateRepositoryProfile } from 'agentic-os';

test('the committed agentic-os profile preserves ACOS protected-integration policy', () => {
  const profile = JSON.parse(readFileSync(new URL('../.agentic-os.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateRepositoryProfile(profile), profile);
  assert.deepEqual(profile.requiredChecks, [
    'budgets', 'build', 'collaboration-integration', 'docs-contract', 'test',
  ]);
  assert.ok(Object.values(profile.cleanup).every((effect) => effect === 'retain'));
});
