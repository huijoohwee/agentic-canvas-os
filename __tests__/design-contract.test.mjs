import test from 'node:test';
import assert from 'node:assert/strict';
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
