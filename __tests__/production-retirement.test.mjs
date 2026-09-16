import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

test('retired production deployment has no workflow, package command or controller', () => {
  const removed = [
    '.github/workflows/production-release.yml',
    'scripts/acos-production-release-artifact.mjs',
    'scripts/acos-production-release-contract.mjs',
    'scripts/acos-production-release-controller.mjs',
    'scripts/acos-production-release-live.mjs',
  ];
  for (const file of removed) assert.equal(existsSync(file), false, file);
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(scripts['production-release:prepare'], undefined);
  assert.equal(scripts['production-release:execute'], undefined);
  for (const command of Object.values(scripts)) {
    assert.doesNotMatch(command, /acos-production-release-(?:controller|live|artifact|contract)\.mjs/);
  }
  for (const file of readdirSync('.github/workflows')) {
    assert.doesNotMatch(readFileSync(`.github/workflows/${file}`, 'utf8'),
      /acos-production-release-(?:controller|live|artifact|contract)\.mjs/);
  }
});
