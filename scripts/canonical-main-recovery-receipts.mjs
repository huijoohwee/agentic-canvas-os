import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const ZERO_SHA = "0".repeat(40);
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
export const CANONICAL_MAIN_RECOVERY_JOURNAL_SCHEMA = "agentic-canonical-main-recovery/v1";

export function createPreparedReceiptBody(journal) {
  return withReceiptDigest({
    schema: "agentic-canonical-main-recovery-prepared/v1",
    recoveryId: journal.recoveryId,
    sessionId: journal.sessionId,
    repository: journal.repository,
    branch: journal.branch,
    remoteRef: journal.remoteRef,
    expectedLocalHead: journal.expectedLocalHead,
    expectedOriginHead: journal.expectedOriginHead,
    preparedAt: journal.preparedAt,
    equivalence: journal.equivalence,
    manifest: journal.manifest,
    manifestDigest: journal.manifestDigest,
    ignoredRetention: journal.ignoredRetention,
    refs: journal.refs,
  });
}

export function createCaptureReceiptBody(journal) {
  const stashDisposition = journal.stash
    ? {
        disposition: "parked",
        recoveryRef: journal.stash.ref,
        recoverySha: journal.stash.sha,
      }
    : {
        disposition: "clean",
        recoveryRef: null,
        recoverySha: null,
      };
  return withReceiptDigest({
    schema: "agentic-canonical-main-recovery-capture/v1",
    recoveryId: journal.recoveryId,
    sessionId: journal.sessionId,
    repository: journal.repository,
    expectedLocalHead: journal.expectedLocalHead,
    expectedOriginHead: journal.expectedOriginHead,
    preparedReceipt: journal.preparedReceipt,
    manifestDigest: journal.manifestDigest,
    ignoredRetention: journal.ignoredRetention,
    stash: journal.stash,
    dispositions: journal.manifest.map(entry => ({
      path: entry.path,
      originalPath: entry.originalPath,
      status: entry.status,
      ...stashDisposition,
    })),
  });
}

export function createCompletionReceiptBody(journal) {
  return withReceiptDigest({
    schema: "agentic-canonical-main-recovery-completed/v1",
    recoveryId: journal.recoveryId,
    sessionId: journal.sessionId,
    repository: journal.repository,
    branch: "main",
    preservedHead: {
      sha: journal.expectedLocalHead,
      ref: journal.refs.head,
    },
    protectedHead: {
      sha: journal.expectedOriginHead,
      remoteRef: journal.remoteRef,
    },
    preparedReceipt: journal.preparedReceipt,
    captureReceipt: journal.captureReceipt,
    manifestDigest: journal.manifestDigest,
    ignoredRetention: journal.ignoredRetention,
    finalDisposition: "clean-protected-main",
  });
}

export function pinReceipt({ ref, body, gitText, gitOptional, gitHashObject, run }) {
  const payload = `${canonicalJson(body)}\n`;
  const oid = requireSha(gitHashObject(payload), `Receipt object for ${ref}`);
  ensureRef({ ref, sha: oid, expectedType: "blob", gitText, gitOptional, run });
  if (gitText(["cat-file", "-p", oid]) !== payload) {
    throw new Error(`Receipt object ${oid} content does not match its canonical payload.`);
  }
  return Object.freeze({ ref, oid, digest: body.receiptDigest });
}

export function ensureCommitRef({ ref, sha, gitText, gitOptional, run }) {
  ensureRef({ ref, sha, expectedType: "commit", gitText, gitOptional, run });
}

export function readJournal(journalPath) {
  if (!existsSync(journalPath)) return null;
  let journal;
  try {
    journal = JSON.parse(readFileSync(journalPath, "utf8"));
  } catch {
    throw new Error(`Canonical recovery journal is unreadable: ${journalPath}`);
  }
  const { journalDigest, ...body } = journal;
  const observedDigest = digestValue(body);
  if (!DIGEST_PATTERN.test(String(journalDigest || "")) || journalDigest !== observedDigest) {
    throw new Error(
      `Canonical recovery journal digest is invalid: ${journalPath} ` +
      `(recorded ${journalDigest || "missing"}, observed ${observedDigest}).`,
    );
  }
  return journal;
}

export function requireJournalIdentity(journal, expected) {
  for (const [field, value] of Object.entries({
    schema: CANONICAL_MAIN_RECOVERY_JOURNAL_SCHEMA,
    recoveryId: expected.recoveryId,
    repository: expected.repoRoot,
    sessionId: expected.sessionId,
    expectedLocalHead: expected.expectedLocalHead,
    expectedOriginHead: expected.expectedOriginHead,
  })) {
    if (journal[field] !== value) throw new Error(`Canonical recovery journal identity disagrees on ${field}.`);
  }
  if (canonicalJson(journal.refs) !== canonicalJson(expected.refs) ||
      journal.manifestDigest !== digestValue(journal.manifest)) {
    throw new Error("Canonical recovery journal refs or working-state manifest digest is invalid.");
  }
}

export function updateJournal(journalPath, journal, values) {
  const next = withJournalDigest({ ...withoutJournalDigest(journal), ...values });
  writeJournal(journalPath, next);
  return next;
}

export function writeJournal(journalPath, journal) {
  mkdirSync(path.dirname(journalPath), { recursive: true });
  const temporary = `${journalPath}.tmp.${process.pid}`;
  try {
    writeFileSync(temporary, `${canonicalJson(journal)}\n`, { mode: 0o600 });
    renameSync(temporary, journalPath);
  } finally {
    if (existsSync(temporary)) rmSync(temporary);
  }
}

export function withJournalDigest(value) {
  const body = withoutJournalDigest(value);
  return Object.freeze({ ...body, journalDigest: digestValue(body) });
}

export function digestValue(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function requireSha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} must be an exact 40-character Git object id.`);
  }
  return value;
}

function ensureRef({ ref, sha, expectedType, gitText, gitOptional, run }) {
  const current = gitOptional(["show-ref", "--hash", "--verify", ref]).trim();
  if (!current) {
    run("git", ["update-ref", ref, sha, ZERO_SHA]);
  } else if (current !== sha) {
    throw new Error(`Immutable recovery ref ${ref} points to ${current}, not ${sha}.`);
  }
  if (gitOptional(["show-ref", "--hash", "--verify", ref]).trim() !== sha ||
      gitText(["cat-file", "-t", sha]).trim() !== expectedType) {
    throw new Error(`Immutable recovery ref ${ref} does not resolve to the expected ${expectedType} ${sha}.`);
  }
}

function withoutJournalDigest(value) {
  const { journalDigest: _ignored, ...body } = value;
  return body;
}

function withReceiptDigest(value) {
  return Object.freeze({ ...value, receiptDigest: digestValue(value) });
}
