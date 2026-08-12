// Responsibility: Seal terminal evidence for a cloud-retired planned admission owner.
import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { WRITER_LEASE_SCHEMA } from "./writer-lease-lib.mjs";

export const RETIRED_PLANNED_ADMISSION_OWNER_RECEIPT_SCHEMA =
  "agentic-retired-planned-admission-owner-receipt/v1";

export function buildRetiredPlannedAdmissionOwnerReceipt({
  authorizationDigest,
  source,
  candidate,
  cloud,
  provider,
  retiredAt,
}) {
  const originalLease = structuredClone(requiredObject(source?.lease, "source lease"));
  const core = {
    schema: RETIRED_PLANNED_ADMISSION_OWNER_RECEIPT_SCHEMA,
    status: "completed",
    authorizationDigest: requiredDigest(authorizationDigest, "authorization digest"),
    retiredAt: requiredInstant(retiredAt, "retiredAt"),
    source: {
      worktreePath: path.resolve(requiredText(source.path, "source path")),
      branch: requiredText(source.branch, "source branch").replace(/^refs\/heads\//u, ""),
      headSha: requiredSha(source.head, "source head"),
      treeSha: requiredSha(source.treeSha, "source tree"),
      stateDigest: requiredDigest(source.stateDigest, "source state digest"),
      remoteHeadSha: requiredSha(source.remoteHeadSha, "source remote head"),
      originalLease,
      originalLeaseDigest: digestValue(originalLease),
    },
    candidate: {
      claimId: requiredDigest(candidate?.claimId, "candidate claim ID"),
      branch: requiredText(candidate?.branch, "candidate branch"),
      sessionId: requiredText(candidate?.sessionId, "candidate session"),
      admissionReceiptDigest: requiredDigest(
        candidate?.admissionReceiptDigest,
        "candidate admission receipt",
      ),
    },
    cloud: {
      ledgerRevision: requiredSha(cloud?.ledgerRevision, "cloud ledger revision"),
      ledgerDigest: requiredDigest(cloud?.ledgerDigest, "cloud ledger digest"),
      verificationReceiptDigest: requiredDigest(
        cloud?.verificationReceiptDigest,
        "cloud verification receipt",
      ),
      sourceClaimId: requiredDigest(cloud?.sourceClaimId, "source claim ID"),
      sourceClaimAbsent: cloud?.sourceClaimAbsent === true,
    },
    provider: normalizeProvider(provider),
    preservation: {
      worktree: "preserve",
      branch: "preserve",
      localCommit: "preserve",
      remoteBranch: "preserve",
      pullRequest: "closed-preserved",
      cleanupEligible: false,
      deployment: false,
    },
  };
  if (!core.cloud.sourceClaimAbsent) {
    throw new Error("Retirement requires the source claim to be absent from current authority.");
  }
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeRetiredPlannedAdmissionOwnerReceipt(value) {
  const source = requiredObject(value, "retirement receipt");
  const { receiptDigest, ...core } = source;
  requiredDigest(receiptDigest, "receipt digest");
  if (core.schema !== RETIRED_PLANNED_ADMISSION_OWNER_RECEIPT_SCHEMA
    || core.status !== "completed" || digestValue(core) !== receiptDigest) {
    throw new Error("Retired planned admission owner receipt is invalid.");
  }
  const rebuilt = buildRetiredPlannedAdmissionOwnerReceipt({
    ...core,
    source: {
      path: core.source?.worktreePath,
      branch: core.source?.branch,
      head: core.source?.headSha,
      treeSha: core.source?.treeSha,
      stateDigest: core.source?.stateDigest,
      remoteHeadSha: core.source?.remoteHeadSha,
      lease: core.source?.originalLease,
    },
  });
  if (rebuilt.receiptDigest !== receiptDigest) {
    throw new Error("Retired planned admission owner receipt changed during normalization.");
  }
  return rebuilt;
}

export function isRetiredPlannedAdmissionOwnerLane({ lane = null, record = null, lease = null } = {}) {
  const observed = lane || record;
  const currentLease = lease || lane?.lease || null;
  try {
    const receipt = normalizeRetiredPlannedAdmissionOwnerReceipt(
      currentLease?.admissionOwnerRetirement,
    );
    const source = receipt.source;
    const observedBranch = String(observed?.branch || "").replace(/^refs\/heads\//u, "");
    if (currentLease.schema !== WRITER_LEASE_SCHEMA
      || currentLease.status !== "released"
      || currentLease.admission !== null
      || currentLease.cloudAuthority !== null
      || currentLease.heartbeatAt !== receipt.retiredAt
      || currentLease.expiresAt !== receipt.retiredAt
      || path.resolve(currentLease.worktreePath || "") !== source.worktreePath
      || path.resolve(observed?.path || "") !== source.worktreePath
      || currentLease.branch !== source.branch
      || observedBranch !== source.branch
      || observed?.head !== source.headSha
      || observed?.dirty === true
      || receipt.preservation.cleanupEligible !== false) return false;
    const { admissionOwnerRetirement: _receipt, ...released } = currentLease;
    const reconstructed = {
      ...released,
      status: source.originalLease.status,
      heartbeatAt: source.originalLease.heartbeatAt,
      expiresAt: source.originalLease.expiresAt,
      admission: source.originalLease.admission,
      cloudAuthority: source.originalLease.cloudAuthority,
    };
    return digestValue(reconstructed) === source.originalLeaseDigest
      && digestValue(source.originalLease) === source.originalLeaseDigest
      && (!observed?.treeSha || observed.treeSha === source.treeSha);
  } catch {
    return false;
  }
}

function normalizeProvider(value) {
  const provider = requiredObject(value, "provider evidence");
  if (provider.state !== "CLOSED" || provider.mergedAt !== null || !provider.closedAt) {
    throw new Error("Provider evidence must preserve one closed, unmerged pull request.");
  }
  return {
    url: requiredText(provider.url, "pull request URL"),
    number: positiveInteger(provider.number, "pull request number"),
    state: "CLOSED",
    draft: provider.draft === true,
    mergedAt: null,
    closedAt: requiredInstant(provider.closedAt, "pull request closedAt"),
    headBranch: requiredText(provider.headBranch, "pull request head branch"),
    headSha: requiredSha(provider.headSha, "pull request head SHA"),
    baseBranch: requiredText(provider.baseBranch, "pull request base branch"),
    baseSha: requiredSha(provider.baseSha, "pull request base SHA"),
  };
}

function requiredObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}
function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value;
}
function requiredSha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) throw new Error(`${label} is invalid.`);
  return value;
}
function requiredDigest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) throw new Error(`${label} is invalid.`);
  return value;
}
function requiredInstant(value, label) {
  const instant = new Date(value);
  if (!value || Number.isNaN(instant.getTime()) || instant.toISOString() !== value) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}
function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} is invalid.`);
  return value;
}
