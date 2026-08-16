// Responsibility: Resolve one exact dormant-recovery replay key from the sealed ledger.
import { execFileSync } from "node:child_process";

import { validateLedger } from "./cloud-collaboration-contract.mjs";
import {
  DEFAULT_LEDGER_PATH,
  DEFAULT_LEDGER_REF,
} from "./github-cloud-collaboration-adapter.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const MAX_LEDGER_BYTES = 8 * 1024 * 1024;
const MAX_GITHUB_RESPONSE_BYTES = 16 * 1024 * 1024;

export function resolveExpiredCommittedRecoveryReplayEvidence({
  source,
  liveClaim,
  status,
  environment = process.env,
  readLedger = readGitHubLedger,
} = {}) {
  const repository = requiredRepository(source?.ledgerRepository);
  const snapshot = readLedger({ repository, environment });
  const ledger = snapshot?.ledger;
  const failures = validateLedger(ledger);
  if (failures.length > 0) {
    throw new Error(`Dormant recovery replay ledger is invalid: ${failures.join("; ")}`);
  }
  const revision = requiredSha(snapshot?.revision, "replay ledger revision");
  if (
    revision !== requiredSha(status?.ledgerRevision, "status ledger revision")
    || ledger.headDigest !== requiredDigest(status?.ledgerDigest, "status ledger digest")
  ) drift();
  const entries = ledger.entries.filter(entry => entry.claimId === source?.claimId);
  const entry = entries.at(-1);
  const recovery = entry?.claimCore?.recovery;
  if (
    !entry
    || entry.action !== "continue"
    || entry.digest !== liveClaim?.transitionDigest
    || entry.claimDigest !== liveClaim?.fenceRevision
    || entry.claimCore.transitionCounter !== liveClaim?.transitionCounter
    || entry.claimCore.heartbeatCounter !== liveClaim?.heartbeatCounter
    || entry.claimCore.laneRevision !== source?.laneRevision
    || entry.claimCore.leaseEpoch !== source?.leaseEpoch
    || !ownerMatches(entry.claimCore.deviceId, "device", source?.deviceId)
    || !ownerMatches(entry.claimCore.sessionId, "session", source?.sessionId)
    || entry.claimCore.reviewRequestId !== source?.reviewRequestId
    || !DIGEST_PATTERN.test(String(recovery?.evidenceDigest || ""))
  ) drift();
  return recovery.evidenceDigest;
}

function ownerMatches(recorded, namespace, source) {
  return recorded === source || recorded === pseudonymousIdentifier(namespace, source);
}

export function readGitHubLedger({ repository, environment, execFile = execFileSync }) {
  const reference = JSON.parse(execFile("gh", [
    "api", `repos/${repository}/git/ref/heads/${encodeURIComponent(DEFAULT_LEDGER_REF)}`,
  ], { encoding: "utf8", env: environment, maxBuffer: MAX_GITHUB_RESPONSE_BYTES }));
  const revision = requiredSha(reference.object?.sha, "replay ledger revision");
  const commit = JSON.parse(execFile("gh", [
    "api", `repos/${repository}/git/commits/${revision}`,
  ], { encoding: "utf8", env: environment, maxBuffer: MAX_GITHUB_RESPONSE_BYTES }));
  const blobSha = resolveLedgerBlobSha({
    repository,
    treeSha: requiredSha(commit.tree?.sha, "replay ledger tree SHA"),
    execFile,
    environment,
  });
  const blob = JSON.parse(execFile("gh", [
    "api", `repos/${repository}/git/blobs/${blobSha}`,
  ], { encoding: "utf8", env: environment, maxBuffer: MAX_GITHUB_RESPONSE_BYTES }));
  const content = blob.content;
  if (blob.encoding !== "base64") throw new Error("Dormant recovery replay ledger blob must use base64 encoding.");
  if (!content) throw new Error("Dormant recovery replay ledger content is unavailable.");
  const bytes = Buffer.from(String(content).replaceAll("\n", ""), "base64");
  if (bytes.length < 1 || bytes.length > MAX_LEDGER_BYTES) {
    throw new Error("Dormant recovery replay ledger exceeds its byte bound.");
  }
  return {
    ledger: JSON.parse(bytes.toString("utf8")),
    revision,
  };
}

function resolveLedgerBlobSha({ repository, treeSha, execFile, environment }) {
  const segments = DEFAULT_LEDGER_PATH.split("/").filter(Boolean);
  let currentTreeSha = treeSha;
  for (const [index, segment] of segments.entries()) {
    const tree = JSON.parse(execFile("gh", [
      "api", `repos/${repository}/git/trees/${currentTreeSha}`,
    ], { encoding: "utf8", env: environment, maxBuffer: MAX_GITHUB_RESPONSE_BYTES }));
    const entry = (Array.isArray(tree.tree) ? tree.tree : []).find(candidate => candidate.path === segment);
    if (!entry?.sha) throw new Error("Dormant recovery replay ledger path was not present in the Git tree.");
    const leaf = index === segments.length - 1;
    if (leaf) {
      if (entry.type !== "blob") throw new Error("Dormant recovery replay ledger path must resolve to a blob.");
      return requiredSha(entry.sha, "replay ledger blob SHA");
    }
    if (entry.type !== "tree") throw new Error("Dormant recovery replay ledger path must resolve through Git trees.");
    currentTreeSha = requiredSha(entry.sha, "replay ledger subtree SHA");
  }
  throw new Error("Dormant recovery replay ledger path is invalid.");
}

function requiredRepository(value) {
  const repository = String(value || "").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error("Dormant recovery replay ledger repository is invalid.");
  }
  return repository;
}

function requiredDigest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) throw new Error(`${label} is invalid.`);
  return value;
}

function requiredSha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) throw new Error(`${label} is invalid.`);
  return value;
}

function drift() {
  throw new Error("Sealed dormant recovery replay evidence does not match the live claim.");
}
