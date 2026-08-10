// Responsibility: Preserve branch recovery history while fencing one writable generation.
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { digestValue } from "./cloud-collaboration-primitives.mjs";

const INTENT_SCHEMA = "agentic-reviewed-forward-child-recovery-intent/v1";
const SHA256 = /^[0-9a-f]{64}$/u;

export function createReviewedForwardChildJournal({
  commonDirectory,
  branch,
  operatorSessionId,
} = {}) {
  const paths = reviewedForwardChildJournalPaths({
    commonDirectory,
    branch,
    operatorSessionId,
  });

  function readIntent() {
    return existsSync(paths.statePath) ? readJournal(paths.statePath) : null;
  }

  function writeIntent({ expected, value }) {
    if (JSON.stringify(readIntent()) !== JSON.stringify(expected)) invalid("journal CAS");
    if (expected === null) assertNoIncompleteGeneration(paths);
    mkdirSync(paths.generationDirectory, { recursive: true });
    const temporary = `${paths.statePath}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, paths.statePath);
  }

  async function withFence(action) {
    mkdirSync(paths.journalDirectory, { recursive: true });
    const lock = acquireFence(paths.lockPath);
    try {
      return await action();
    } finally {
      releaseFence(paths.lockPath, lock);
    }
  }

  return Object.freeze({ readIntent, writeIntent, withFence });
}

export function reviewedForwardChildJournalPaths({
  commonDirectory,
  branch,
  operatorSessionId,
} = {}) {
  const root = absolute(commonDirectory, "Git common directory");
  const branchName = text(branch, "branch");
  const operator = text(operatorSessionId, "operator session");
  const journalDirectory = path.join(
    root,
    "agentic-canvas-os",
    "reviewed-forward-child-recovery",
  );
  const branchKey = digest(branchName);
  const generationKey = digest(`${branchName}\0${operator}`);
  const generationDirectory = path.join(journalDirectory, branchKey);
  return Object.freeze({
    journalDirectory,
    generationDirectory,
    legacyStatePath: path.join(journalDirectory, `${branchKey}.json`),
    lockPath: path.join(journalDirectory, `${branchKey}.json.lock`),
    statePath: path.join(generationDirectory, `${generationKey}.json`),
  });
}

function assertNoIncompleteGeneration(paths) {
  for (const journalPath of existingGenerationPaths(paths)) {
    if (journalPath === paths.statePath) continue;
    const intent = readJournal(journalPath);
    if (!isCompletedIntent(intent)) invalid("unfinished competing journal generation");
  }
}

function existingGenerationPaths(paths) {
  const journals = existsSync(paths.legacyStatePath) ? [paths.legacyStatePath] : [];
  if (!existsSync(paths.generationDirectory)) return journals;
  for (const entry of readdirSync(paths.generationDirectory, { withFileTypes: true })) {
    if (!entry.name.endsWith(".json")) continue;
    if (!entry.isFile()) invalid("journal generation entry");
    journals.push(path.join(paths.generationDirectory, entry.name));
  }
  return journals;
}

function isCompletedIntent(value) {
  if (!value || value.schema !== INTENT_SCHEMA || value.status !== "complete") return false;
  const { intentDigest, ...core } = value;
  return value.status === "complete"
    && value.planSnapshot && typeof value.planSnapshot === "object"
    && value.authorization && typeof value.authorization === "object"
    && value.phases && typeof value.phases === "object"
    && value.completion?.status === "authoring-restored"
    && SHA256.test(String(intentDigest || ""))
    && intentDigest === digestValue(core);
}

function acquireFence(lockPath) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomUUID();
    try {
      const descriptor = openSync(lockPath, "wx", 0o600);
      writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, token })}\n`);
      closeSync(descriptor);
      return { pid: process.pid, token };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const current = readJournal(lockPath);
      try {
        process.kill(current.pid, 0);
        invalid("concurrent fence");
      } catch (probe) {
        if (probe?.code !== "ESRCH") throw probe;
        unlinkSync(lockPath);
      }
    }
  }
  invalid("fence acquisition");
}

function releaseFence(lockPath, expected) {
  if (!existsSync(lockPath)) return;
  const current = readJournal(lockPath);
  if (current.pid !== expected.pid || current.token !== expected.token) {
    invalid("fence ownership");
  }
  unlinkSync(lockPath);
}

function readJournal(journalPath) {
  try {
    return JSON.parse(readFileSync(journalPath, "utf8"));
  } catch {
    invalid("journal bytes");
  }
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function absolute(value, label) {
  const resolved = path.resolve(text(value, label));
  if (!path.isAbsolute(resolved)) invalid(label);
  return resolved;
}

function text(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) invalid(label);
  return value;
}

function invalid(label) {
  throw new Error(`Reviewed forward-child recovery ${label} is invalid.`);
}
