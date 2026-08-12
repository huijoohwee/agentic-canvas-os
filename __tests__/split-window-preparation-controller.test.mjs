import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createBundle } from "../scripts/split-window-preparation-contract.mjs";
import { createImportController, createPreparationController } from "../scripts/split-window-preparation-controller.mjs";

const d = value => createHash("sha256").update(String(value)).digest("hex");
const s = value => d(value).slice(0, 40);
function bundle() { return createBundle({ bundleId: "bundle", source: { repositoryIdentityDigest: d(1), baseRevision: s(1), baseTreeDigest: s(2), sourceStateDigest: d(2) },
  target: { repositoryIdentityDigest: d(3), semanticScope: "scope", canonicalBaseSha: s(3), manifestDigest: d(4), writeSetDigest: d(5) },
  paths: ["docs/a.md"], artifacts: [{ kind: "patch", digest: d(6), sizeBytes: 1, mediaType: "application/vnd.git.patch", paths: ["docs/a.md"] }], boundsPolicyDigest: d(7) }); }

test("preparation rejects serialized authority", () => { const controller = createPreparationController({ source: { capture: () => ({ authority: {}, bundle: {}, payloads: new Map() }) }, store: { publishBundle() {}, readBundle() {} } }); assert.throws(() => controller.prepare({})); });
test("preparation double-captures before publication", () => { let count = 0; const controller = createPreparationController({ source: { capture: () => ({ bundle: { count: ++count }, payloads: new Map() }) }, store: { publishBundle() { throw new Error("must not publish"); }, readBundle() {} } }); assert.throws(() => controller.prepare({}), /changed/); });

test("import writes intent before one authority-consumed effect and replays exact post-state", () => {
  const value = bundle(); let operation = null; let receipt = null; let state = d("pre"); let consumes = 0; let applies = 0;
  const store = { readBundle: () => value, readOperation: () => operation,
    compareAndSwapOperation(expected, next) { assert.equal(operation?.operationDigest || null, expected); operation = next; },
    writeReceipt(_id, next) { receipt = next; return next; }, readReceipt: () => receipt };
  const authority = { status: "ready", singleUse: true, receiptDigest: d("authority"), observation: {
    cloudVerificationDigest: d("cloud"), writerLeaseDigest: d("lease"), registryRevision: 1,
    mutationAuthorityReceiptDigest: d("mutation"), evaluatedAt: "2026-08-12T00:00:00.000Z", expiresAt: "2026-08-12T01:00:00.000Z" },
    consume(callback) { consumes += 1; return callback(); } };
  const target = { inspect: () => ({ targetIdentityDigest: d("target"), stateDigest: state, authorityObservation: authority.observation }),
    preflight: () => ({ expectedPostStateDigest: d("post"), verifierProfileDigests: [d("profile")], receiptDigest: d("preflight") }),
    withJoinedMutationFence(_bundle, _input, callback) { return callback(authority); },
    apply() { applies += 1; assert.equal(operation.phases.at(-1).state, "armed"); state = d("post"); return { beforeStateDigest: d("pre"), postStateDigest: state,
      expectedPostStateDigest: state, receiptDigest: d("effect"), replayed: false }; },
    reconcile() { return { beforeStateDigest: d("pre"), postStateDigest: d("post"), expectedPostStateDigest: d("post"), receiptDigest: d("effect"), replayed: true }; },
    verify() { return { postStateDigest: state, receiptDigests: [d("verify")] }; } };
  const controller = createImportController({ target, store }); const input = { bundleDigest: value.bundleDigest, operationId: "op", importRequest: { purpose: "test" } };
  assert.equal(controller.plan(input).status, "planned"); const first = controller.run(input);
  assert.equal(first.status, "complete"); assert.equal(consumes, 1); assert.equal(applies, 1); assert.equal(first.receipt.mutationAuthority, false);
  const replay = controller.run(input); assert.equal(replay.replayed, true); assert.equal(consumes, 1); assert.equal(applies, 1);
});

test("import fails closed for an ambiguous live state", () => {
  const value = bundle(); let operation = null; const store = { readBundle: () => value, readOperation: () => operation,
    compareAndSwapOperation(_expected, next) { operation = next; }, readReceipt: () => null, writeReceipt() {} };
  const observation = { cloudVerificationDigest: d("cloud"), writerLeaseDigest: d("lease"), registryRevision: 1,
    mutationAuthorityReceiptDigest: d("mutation"), evaluatedAt: "2026-08-12T00:00:00.000Z", expiresAt: "2026-08-12T01:00:00.000Z" };
  let state = d("pre"); const target = { inspect: () => ({ targetIdentityDigest: d("target"), stateDigest: state, authorityObservation: observation }),
    preflight: () => ({ expectedPostStateDigest: d("post"), verifierProfileDigests: [], receiptDigest: d("preflight") }),
    withJoinedMutationFence(_bundle, _input, callback) { return callback({ status: "ready", singleUse: true, receiptDigest: d("authority"), observation, consume: callback }); },
    apply() { throw new Error("must not apply"); }, reconcile() {}, verify() {} };
  const controller = createImportController({ target, store }); const input = { bundleDigest: value.bundleDigest, operationId: "op", importRequest: {} };
  controller.plan(input); state = d("ambiguous"); assert.throws(() => controller.run(input), /neither its exact pre-state/);
});

test("lost apply response reconciles exact post-state without a second effect", () => {
  const value = bundle(); let operation = null; let state = d("pre"); let applies = 0; let reconciles = 0;
  const store = { readBundle: () => value, readOperation: () => operation,
    compareAndSwapOperation(_expected, next) { operation = next; }, readReceipt: () => null,
    writeReceipt(_id, receipt) { return receipt; } };
  const observation = { cloudVerificationDigest: d("cloud"), writerLeaseDigest: d("lease"), registryRevision: 1,
    mutationAuthorityReceiptDigest: d("mutation"), evaluatedAt: "2026-08-12T00:00:00.000Z", expiresAt: "2026-08-12T01:00:00.000Z" };
  const authority = { status: "ready", singleUse: true, receiptDigest: d("authority"), observation,
    consume(callback) { return callback(); } };
  const target = { inspect: () => ({ targetIdentityDigest: d("target"), stateDigest: state, authorityObservation: observation }),
    preflight: () => ({ expectedPostStateDigest: d("post"), verifierProfileDigests: [], receiptDigest: d("preflight") }),
    withJoinedMutationFence(_bundle, _input, callback) { return callback(authority); },
    apply() { applies += 1; state = d("post"); throw new Error("lost response"); },
    reconcile() { reconciles += 1; return { beforeStateDigest: d("pre"), postStateDigest: state,
      expectedPostStateDigest: state, receiptDigest: d("effect"), replayed: true }; },
    verify() { return { postStateDigest: state, receiptDigests: [] }; } };
  const controller = createImportController({ target, store }); const input = { bundleDigest: value.bundleDigest, operationId: "op", importRequest: {} };
  controller.plan(input); assert.throws(() => controller.run(input), /lost response/); const replay = controller.run(input);
  assert.equal(replay.status, "complete"); assert.equal(applies, 1); assert.equal(reconciles, 1);
});
