// Responsibility: content-addressed external storage and compare-and-swap journals.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizeBundle, normalizeImportReceipt, normalizeOperation } from "./split-window-preparation-contract.mjs";

export function createSplitWindowStore({ root, assertIsolatedRoot = () => {}, mode = 0o700 }) {
  const storeRoot = realAbsoluteParent(root);
  assertIsolatedRoot(storeRoot);
  const objects = path.join(storeRoot, "objects", "sha256");
  const operations = path.join(storeRoot, "operations");
  const receipts = path.join(storeRoot, "receipts");
  return Object.freeze({
    publishBundle(bundleValue, payloads = new Map()) {
      const bundle = normalizeBundle(bundleValue);
      const destination = path.join(objects, bundle.bundleDigest);
      if (entryExists(destination)) return verifyObject(destination, bundle);
      fs.mkdirSync(objects, { recursive: true, mode }); fsyncDirectory(path.dirname(objects));
      const temporary = fs.mkdtempSync(path.join(objects, `.prepare-${process.pid}-`));
      try {
        atomicJson(path.join(temporary, "bundle.json"), bundle, 0o600);
        const payloadRoot = path.join(temporary, "payloads"); fs.mkdirSync(payloadRoot, { mode });
        for (const artifact of bundle.artifacts) {
          const bytes = payloads.get(artifact.digest);
          if (!Buffer.isBuffer(bytes) || bytes.length !== artifact.sizeBytes || sha256(bytes) !== artifact.digest) {
            throw new Error(`Payload ${artifact.digest} is missing or invalid.`);
          }
          const file = path.join(payloadRoot, artifact.digest); fs.writeFileSync(file, bytes, { mode: 0o600, flag: "wx" }); fsyncFile(file);
        }
        fsyncDirectory(payloadRoot); fsyncDirectory(temporary);
        try { fs.renameSync(temporary, destination); } catch (error) {
          if (error?.code !== "EEXIST" && error?.code !== "ENOTEMPTY") throw error;
        }
        fsyncDirectory(objects); return verifyObject(destination, bundle);
      } finally { if (entryExists(temporary)) fs.rmSync(temporary, { recursive: true, force: true }); }
    },
    readBundle(bundleDigest) { return readJson(path.join(objects, requiredDigest(bundleDigest), "bundle.json")); },
    readPayload(bundleDigest, artifactDigest) {
      const file = path.join(objects, requiredDigest(bundleDigest), "payloads", requiredDigest(artifactDigest));
      const bytes = fs.readFileSync(file); if (sha256(bytes) !== artifactDigest) throw new Error("Stored payload digest drifted."); return bytes;
    },
    readOperation(operationId) { return readJson(operationPath(operations, operationId)); },
    compareAndSwapOperation(expectedDigest, operationValue) {
      const operation = normalizeOperation(operationValue); fs.mkdirSync(operations, { recursive: true, mode });
      return withLock(path.join(operations, `${safeId(operation.operationId)}.lock`), () => {
        const file = operationPath(operations, operation.operationId); const current = entryExists(file) ? normalizeOperation(readJson(file)) : null;
        if ((current?.operationDigest || null) !== expectedDigest) throw new Error("Split-window operation CAS failed.");
        atomicJson(file, operation, 0o600); return operation;
      });
    },
    writeReceipt(operationId, receiptValue) { const receipt = normalizeImportReceipt(receiptValue); if (receipt.operationId !== operationId) throw new Error("Receipt operation ID drifted.");
      fs.mkdirSync(receipts, { recursive: true, mode }); const file = path.join(receipts, `${safeId(operationId)}.json`);
      if (entryExists(file)) { const existing = readJson(file); if (canonicalJson(existing) !== canonicalJson(receipt)) throw new Error("Receipt already exists with different bytes."); return existing; }
      atomicJson(file, receipt, 0o600); return receipt; },
    readReceipt(operationId) { const file = path.join(receipts, `${safeId(operationId)}.json`); return entryExists(file) ? readJson(file) : null; },
  });
}

function verifyObject(destination, expected) { const observed = normalizeBundle(readJson(path.join(destination, "bundle.json")));
  if (canonicalJson(observed) !== canonicalJson(expected)) throw new Error("Content-addressed bundle collision.");
  for (const artifact of observed.artifacts) { const file = path.join(destination, "payloads", artifact.digest); const bytes = fs.readFileSync(file);
    if (bytes.length !== artifact.sizeBytes || sha256(bytes) !== artifact.digest) throw new Error("Stored artifact is incomplete."); }
  return observed; }
function withLock(file, callback) { fs.mkdirSync(path.dirname(file), { recursive: true }); const owner = acquireLock(file);
  try { return callback(); } finally { releaseLock(file, owner); } }
function acquireLock(file) {
  const owner = { pid: process.pid, processIdentity: processIdentity(process.pid), token: crypto.randomUUID() };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { const descriptor = fs.openSync(file, "wx", 0o600); try { fs.writeFileSync(descriptor, canonicalJson(owner)); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); } fsyncDirectory(path.dirname(file)); return owner; }
    catch (error) { if (error?.code !== "EEXIST") throw error; }
    const observed = readLock(file); if (observed && processIdentity(observed.pid) === observed.processIdentity) throw new Error("Split-window operation is locked by a live controller.");
    if (!observed?.token) throw new Error("Split-window lock is malformed.");
    const stale = `${file}.stale.${crypto.randomUUID()}`; fs.renameSync(file, stale);
    const moved = readLock(stale); if (moved?.token !== observed.token) { if (!entryExists(file)) fs.renameSync(stale, file); throw new Error("Split-window lock changed during stale-owner recovery."); }
    fs.unlinkSync(stale); fsyncDirectory(path.dirname(file));
  }
  throw new Error("Split-window lock could not be acquired.");
}
function releaseLock(file, owner) { const observed = readLock(file); if (observed?.token !== owner.token) throw new Error("Split-window lock ownership changed before release."); fs.unlinkSync(file); fsyncDirectory(path.dirname(file)); }
function readLock(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { if (error?.code === "ENOENT") return null; throw error; } }
function processIdentity(pid) { try { return execFileSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" }).trim() || null; } catch { return null; } }
function atomicJson(file, value, fileMode) { const temporary = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`; fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, `${canonicalJson(value)}\n`, { mode: fileMode, flag: "wx" }); fsyncFile(temporary); fs.renameSync(temporary, file); fsyncDirectory(path.dirname(file)); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function operationPath(root, id) { return path.join(root, `${safeId(id)}.json`); }
function safeId(value) { const text = String(value || ""); if (!/^[A-Za-z0-9._-]{1,200}$/u.test(text)) throw new Error("Unsafe operation ID."); return text; }
function requiredDigest(value) { if (!/^[0-9a-f]{64}$/u.test(String(value))) throw new Error("Digest is invalid."); return value; }
function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function fsyncFile(file) { const fd = fs.openSync(file, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function fsyncDirectory(directory) { const fd = fs.openSync(directory, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function entryExists(file) { try { fs.lstatSync(file); return true; } catch (error) { if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false; throw error; } }
function realAbsoluteParent(value) { if (!path.isAbsolute(value) || path.normalize(value) !== value) throw new Error("Store root must be absolute.");
  const parent = fs.realpathSync(path.dirname(value)); const result = path.join(parent, path.basename(value)); if (entryExists(result) && fs.lstatSync(result).isSymbolicLink()) throw new Error("Store root cannot be a symlink."); return result; }
