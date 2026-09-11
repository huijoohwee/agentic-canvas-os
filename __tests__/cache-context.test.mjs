import test from "node:test";
import assert from "node:assert/strict";
import { createCacheContextRegistry } from "agentic-os/context/prefix";
import * as upstreamJson from "agentic-os/context/json";
import * as canvasJson from "../agent-api/src/json-contract.js";
import { createAgentApiApp } from "../agent-api/src/app.js";

test("Canvas consumes the upstream prefix registry through app injection and default construction", async () => {
  const cacheContext = createCacheContextRegistry();
  const app = createAgentApiApp({ cacheContext });
  assert.equal(app.cacheContext, cacheContext);
  const entry = await app.cacheContext.register({ namespace: "caller/session", revision: "source-r1",
    stablePrefix: ["reviewed context"] });
  const packet = app.cacheContext.assemble({ handle: entry.handle, dynamicTail: ["request"] });
  assert.deepEqual(packet.prompt, ["reviewed context", "request"]);
  assert.equal(app.readiness().cacheContext.providerCacheStatus, "unverified");
  assert.equal(createAgentApiApp().cacheContext.stats().entries, 0);
});

test("the JSON compatibility boundary re-exports upstream function identities without a second normalizer", () => {
  for (const name of ["canonicalizeJson", "freezeJson", "normalizeJson", "serializedJsonLength"])
    assert.equal(canvasJson[name], upstreamJson[name]);
});
