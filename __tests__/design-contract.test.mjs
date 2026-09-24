import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as admittedEngine from 'agentic-os/design';
import { createDesignContractTool, registerDesignContractTool, DESIGN_TOOL_NAME } from '../web/design-contract.mjs';
import { designCommandArguments } from '../scripts/design-contract.mjs';

const pin = 'a'.repeat(64);
const engine = { DESIGN_INPUT_SCHEMA: { type: 'object' },
  async checkDesignContract(input) { return { ok: true, policyDigest: input.expectedPolicyDigest,
    authority: false, runtimeVerified: false, findings: [] }; } };
test('missing upstream or trusted policy pin fails before registration', () => {
  for (const options of [undefined, {}, { engine }, { engine, expectedPolicyDigest: 'invalid' }])
    assert.throws(() => createDesignContractTool(options), /upstream-unadmitted/);
});
test('host policy pin cannot be replaced by tool input', async () => {
  const tool = createDesignContractTool({ engine, expectedPolicyDigest: pin });
  assert.equal((await tool.execute({ expectedPolicyDigest: pin })).ok, true);
  const rejected = await tool.execute({ expectedPolicyDigest: 'b'.repeat(64) });
  assert.equal(rejected.ok, false); assert.equal(rejected.runtimeVerified, false);
  assert.equal(rejected.findings[0].type, 'stale-evidence');
});
test('WebMCP registration is scoped, deterministic and disposable', () => {
  const tools = new Map([['existing-tool', {}]]);
  const context = { registerTool(tool, { signal }) {
    tools.set(tool.name, tool); signal.addEventListener('abort', () => tools.delete(tool.name), { once: true });
  } };
  const options = { engine, expectedPolicyDigest: pin };
  const dispose = registerDesignContractTool(context, options);
  assert.equal(tools.get(DESIGN_TOOL_NAME).annotations.readOnlyHint, true);
  assert.throws(() => registerDesignContractTool(context, options), /already-registered/);
  dispose(); dispose(); assert.deepEqual([...tools.keys()], ['existing-tool']);
  registerDesignContractTool(context, options)();
});
test('CLI preserves exact upstream invocation and rejects mutations or extra arguments', () => {
  const tokens = ['/design.check', '#read-only', '@input:record.json'];
  assert.deepEqual(designCommandArguments(tokens), tokens);
  assert.deepEqual(designCommandArguments(['--input=record.json']), ['design-check', '--input=record.json']);
  for (const input of [[], [...tokens, '--apply'], ['/design.check', '#mutating', '@input:x']])
    assert.throws(() => designCommandArguments(input), /usage:/);
});

test('admitted upstream checker agrees across local CLI and WebMCP adapter', async () => {
  const policy = { schema: 'native-design-policy/v1', id: 'design', revision: '1.0.0',
    requiredConcerns: ['theme'] };
  const sourceRevision = 'a'.repeat(40);
  const text = 'export const theme = "black";';
  const input = { schema: 'native-design-check/v1', policy,
    expectedPolicyDigest: await admittedEngine.designDigest(admittedEngine.designPolicyBytes(policy)),
    record: { continuityId: 'design-pilot', revision: '1.0.0', sourceRevision,
      roles: Object.fromEntries(['prd', 'tad', 'adr', 'mvp', 'gtm'].map(role => [role, '1.0.0'])),
      concerns: [{ id: 'theme', owner: 'native-ui', source: 'ui.js', symbol: 'theme', check: 'test theme' }] },
    sources: [{ id: 'ui.js', revision: sourceRevision, text, sha256: await admittedEngine.designDigest(text) }] };
  const expected = await createDesignContractTool({ engine: admittedEngine,
    expectedPolicyDigest: input.expectedPolicyDigest }).execute(input);
  assert.equal(expected.ok, true);
  assert.equal(expected.runtimeVerified, false);
  const dir = mkdtempSync(join(tmpdir(), 'canvas-design-'));
  try {
    const path = join(dir, 'record.json');
    writeFileSync(path, JSON.stringify(input));
    for (const args of [[`--input=${path}`], ['/design.check', '#read-only', `@input:${path}`]]) {
      const call = spawnSync(process.execPath, ['scripts/design-contract.mjs', ...args],
        { encoding: 'utf8', timeout: 10000 });
      assert.equal(call.status, 0, call.stderr);
      assert.deepEqual(JSON.parse(call.stdout), expected);
    }
  } finally { rmSync(dir, { recursive: true }); }
});
