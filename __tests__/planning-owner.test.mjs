import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validatePlanningOwner } from '../scripts/planning-owner.mjs';

test('Canvas routes both planning surfaces to the sole central owner', () => {
  assert.deepEqual(validatePlanningOwner(), []);
});
test('recreated local ledgers and writable compatibility documents are rejected', t => {
  const root = mkdtempSync(join(tmpdir(), 'planning-route-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'docs')); mkdirSync(join(root, 'todo'));
  for (const file of ['TODO.md', 'kanban.md']) {
    writeFileSync(join(root, 'docs', file), readFileSync(new URL(`../docs/${file}`, import.meta.url)));
  }
  assert(validatePlanningOwner(root).some(message => message.includes('competing local planning owner')));
  writeFileSync(join(root, 'docs', 'kanban.md'), '---\nowner: "agentic-canvas-os"\n---\n| writable | row |\n');
  const failures = validatePlanningOwner(root);
  assert(failures.some(message => message.includes('missing or stale')));
  assert(failures.some(message => message.includes('cannot contain task rows')));
});
