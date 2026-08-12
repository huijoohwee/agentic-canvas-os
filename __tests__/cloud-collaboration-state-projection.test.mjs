import assert from "node:assert/strict";
import test from "node:test";
import { projectRootAuthorityState } from "../scripts/cloud-collaboration-state-projection.mjs";

test("root authority projection derives writing and reservation semantics from canonical state", () => {
  assert.deepEqual(projectRootAuthorityState("current"), {
    state: "active", writeAuthority: true, scopeReserved: true,
  });
  assert.deepEqual(projectRootAuthorityState("dormant-preserved"), {
    state: "parked", writeAuthority: false, scopeReserved: true,
  });
  assert.deepEqual(projectRootAuthorityState("waiting-successor"), {
    state: "waiting-successor", writeAuthority: false, scopeReserved: false,
  });
  assert.deepEqual(projectRootAuthorityState("retired"), {
    state: "released", writeAuthority: false, scopeReserved: false,
  });
});
