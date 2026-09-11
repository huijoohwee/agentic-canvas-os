import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildWeb } from '../web/build.mjs';

test('HTML builds reuse verified output and retain the previous artifact on overflow', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-build-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'web'));
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
  const source = path.join(root, 'web/index.html'), output = path.join(root, 'web/dist/index.html');
  fs.writeFileSync(source, '<html><head></head><body>first</body></html>');
  assert.equal((await buildWeb(root)).reused, false);
  const before = fs.statSync(output).mtimeMs;
  assert.equal((await buildWeb(root)).reused, true);
  assert.equal(fs.statSync(output).mtimeMs, before);
  fs.writeFileSync(source, '<html><head></head><body>second</body></html>');
  assert.equal((await buildWeb(root)).reused, false);
  assert.match(fs.readFileSync(output, 'utf8'), /second/);
  fs.writeFileSync(output, 'corrupt');
  assert.equal((await buildWeb(root)).reused, false);
  const valid = fs.readFileSync(output);
  fs.writeFileSync(source, `<html><head></head><body>${'x'.repeat(500000)}</body></html>`);
  await assert.rejects(buildWeb(root), /output-byte-budget/);
  assert.deepEqual(fs.readFileSync(output), valid);
  assert.deepEqual(fs.readdirSync(path.join(root, 'node_modules/.cache/agentic-os')).sort(),
    ['web-canvas.css.json', 'web-canvas.js.json', 'web-index.html.json']);
});

test('the authored inline extraction contract rejects malformed or extra active tags', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-build-markup-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'web')); fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
  for (const body of ['<script>run()</script >', '<scr<script>run()</script>ipt>',
    '<script src="external.js"></script>', '<script>first()</script><script>second()</script>']) {
    fs.writeFileSync(path.join(root, 'web/index.html'), `<html><head></head><body>${body}</body></html>`);
    await assert.rejects(buildWeb(root), /web_build_inline_contract/);
  }
});
