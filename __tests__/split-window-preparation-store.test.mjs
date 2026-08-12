import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createBundle, createOperation, appendOperationPhase } from "../scripts/split-window-preparation-contract.mjs";
import { createSplitWindowStore } from "../scripts/split-window-preparation-store.mjs";

const d = value => String(value).padStart(64, "0"); const s = value => String(value).padStart(40, "0");
test("publishes one immutable object and CASes journals", () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "split-window-")); const store = createSplitWindowStore({ root: path.join(root, "store") }); const bytes = Buffer.from("x"); const artifact = crypto.createHash("sha256").update(bytes).digest("hex");
  const bundle = createBundle({ bundleId: "b", source: { repositoryIdentityDigest: d(1), baseRevision: s(1), baseTreeDigest: s(2), sourceStateDigest: d(2) }, target: { repositoryIdentityDigest: d(3), semanticScope: "scope", canonicalBaseSha: s(3), manifestDigest: d(4), writeSetDigest: d(5) }, paths: ["x"], artifacts: [{ kind: "blob", digest: artifact, sizeBytes: 1, mediaType: "application/octet-stream", paths: ["x"] }], boundsPolicyDigest: d(6) });
  assert.equal(store.publishBundle(bundle, new Map([[artifact, bytes]])).bundleDigest, bundle.bundleDigest); let operation = createOperation({ bundleDigest: bundle.bundleDigest, operationId: "op" }); store.compareAndSwapOperation(null, operation); const prior = operation.operationDigest; operation = appendOperationPhase(operation, "sealed", { bundleDigest: bundle.bundleDigest }); store.compareAndSwapOperation(prior, operation); assert.throws(() => store.compareAndSwapOperation(prior, operation)); fs.rmSync(root, { recursive: true, force: true }); });
