import assert from "node:assert/strict";
import test from "node:test";
import * as owner from "agentic-os/agents/swarm";
import * as consumer from "../agent-api/src/agent-swarm.js";
import * as ownerContract from "agentic-os/agents/swarm-contract";
import * as consumerContract from "../agent-api/src/agent-swarm-contract.js";

// The runtime regression suite moved with its implementation to agentic-os.
// Canvas owns this named compatibility boundary and its HTTP composition tests.
test("swarm compatibility exports preserve the exact native owner identities", () => {
  assert.deepEqual(Object.keys(consumer), Object.keys(owner));
  assert.deepEqual(Object.keys(consumerContract), Object.keys(ownerContract));
  for (const name of Object.keys(owner)) assert.equal(consumer[name], owner[name]);
  for (const name of Object.keys(ownerContract)) assert.equal(consumerContract[name], ownerContract[name]);
});
