import test from "node:test";
import assert from "node:assert/strict";
import { createBundle, createOperation, appendOperationPhase, normalizeBundle } from "../scripts/split-window-preparation-contract.mjs";

const d = value => String(value).padStart(64, "0"); const s = value => String(value).padStart(40, "0");
function bundle() { return createBundle({ bundleId: "bundle-1", source: { repositoryIdentityDigest: d(1), baseRevision: s(1), baseTreeDigest: s(2), sourceStateDigest: d(2) },
  target: { repositoryIdentityDigest: d(3), semanticScope: "example", canonicalBaseSha: s(3), manifestDigest: d(4), writeSetDigest: d(5) },
  paths: ["docs/a.md"], artifacts: [{ kind: "blob", digest: d(6), sizeBytes: 1, mediaType: "application/octet-stream", paths: ["docs/a.md"] }], boundsPolicyDigest: d(7) }); }

test("bundle is authority-less and content deterministic", () => { const value = bundle(); assert.equal(value.authority.kind, "none"); assert.deepEqual(value.authority.mutationCapabilities, []); assert.equal(normalizeBundle(value).bundleDigest, value.bundleDigest); });
test("unsafe and case-colliding paths fail", () => { for (const paths of [["../x"], [".git/config"], ["A", "a"]]) assert.throws(() => createBundle({ ...bundle(), paths })); });
test("artifact paths exactly cover the declared bundle paths", () => {
  assert.throws(() => createBundle({ ...bundle(), paths: ["docs/a.md", "docs/b.md"] }), /path union/);
  assert.throws(() => createBundle({ ...bundle(), artifacts: [{ ...bundle().artifacts[0], paths: ["docs/b.md"] }] }), /path union/);
});
test("operation accepts only an exact typed ordered hash chain", () => { let value = createOperation({ bundleDigest: bundle().bundleDigest, operationId: "op" }); value = appendOperationPhase(value, "sealed", { bundleDigest: bundle().bundleDigest }); assert.equal(value.phases[0].state, "sealed"); assert.throws(() => appendOperationPhase(value, "armed", {})); assert.throws(() => appendOperationPhase(value, "planned", { planDigest: d(1) }), /fields/); });
