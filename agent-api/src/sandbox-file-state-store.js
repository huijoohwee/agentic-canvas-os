import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import { assertIdentifier, assertPositiveInteger } from "./sandbox-agent-contract.js";
import { normalizeJson, serializedJsonLength } from "./json-contract.js";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function createSandboxFileStateStore({ root, maxValueChars = 500_000 } = {}) {
  if (typeof root !== "string" || !path.isAbsolute(root)) {
    throw new TypeError("root must be an absolute state-store path.");
  }
  assertPositiveInteger(maxValueChars, "maxValueChars");
  const entriesRoot = path.join(root, "entries");
  const claimsRoot = path.join(root, "claims");

  async function prepare() {
    await mkdir(root, { recursive: true, mode: 0o700 });
    await mkdir(entriesRoot, { recursive: true, mode: 0o700 });
    await mkdir(claimsRoot, { recursive: true, mode: 0o700 });
    await Promise.all([chmod(root, 0o700), chmod(entriesRoot, 0o700), chmod(claimsRoot, 0o700)]);
  }

  function entryPath(key) {
    return path.join(entriesRoot, `${digest(assertIdentifier(key, "state key"))}.json`);
  }

  function claimPath(key, claimId) {
    return path.join(
      claimsRoot,
      `${digest(assertIdentifier(key, "state key"))}-${digest(assertIdentifier(claimId, "claimId"))}.json`,
    );
  }

  async function atomicWrite(filePath, value) {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(value, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporaryPath, filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  function envelope(key, value) {
    const safeValue = normalizeJson(value, "state value");
    const record = JSON.stringify({ schema: "sandbox-file-state/v1", key, value: safeValue });
    if (record.length > maxValueChars) throw new RangeError(`state value exceeds ${maxValueChars} characters.`);
    return record;
  }

  async function readRecord(filePath, key) {
    try {
      const record = JSON.parse(await readFile(filePath, "utf8"));
      if (record?.schema !== "sandbox-file-state/v1" || record.key !== key) {
        throw new Error("Sandbox state record identity is invalid.");
      }
      const value = normalizeJson(record.value, "stored state value");
      if (serializedJsonLength(value) > maxValueChars) throw new RangeError("Stored state value exceeds capacity.");
      return value;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async function put(key, value) {
    await prepare();
    await atomicWrite(entryPath(key), envelope(key, value));
  }

  async function get(key) {
    await prepare();
    return readRecord(entryPath(key), key);
  }

  async function remove(key) {
    await prepare();
    return rm(entryPath(key), { force: true });
  }

  async function claim(key, claimId) {
    await prepare();
    const source = entryPath(key);
    const target = claimPath(key, claimId);
    try {
      await rename(source, target);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    return readRecord(target, key);
  }

  async function commit(key, claimId) {
    await prepare();
    const target = claimPath(key, claimId);
    if (!await exists(target)) throw new Error("Sandbox state claim is missing.");
    await rm(target);
  }

  async function release(key, claimId) {
    await prepare();
    const source = claimPath(key, claimId);
    const target = entryPath(key);
    if (!await exists(source)) throw new Error("Sandbox state claim is missing.");
    if (await exists(target)) throw new Error("Sandbox state key is already active.");
    await rename(source, target);
  }

  return Object.freeze({ put, get, delete: remove, claim, commit, release });
}
