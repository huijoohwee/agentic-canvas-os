import { execFileSync } from "node:child_process";

import {
  digestValue,
  validateLedger,
} from "./cloud-collaboration-primitives.mjs";
import { projectRootState } from "./cloud-collaboration-state-projection.mjs";
import { invokeRepositoryCloudVerifier } from "./cloud-collaboration-delivery-verifier.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import { verifyProtectedMainRefreshChain } from "./protected-main-refresh-lib.mjs";

export const DELIVERY_PEER_VERIFICATION_SCHEMA =
  "agentic-delivery-peer-authority-verification/v1";

const PEER_PROOF_SCHEMA = "agentic-delivery-peer-authority-proof/v1";
const BOUND = 128;
const MAX_LEDGER_BYTES = 4_000_000;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const operationDerivedVerifications = new WeakSet();

export function verifyDeliveryAuthorizedPeerAuthorities({
  lanes,
  remoteAuthorityVerification,
  evaluatedAt = remoteAuthorityVerification?.verifiedAt,
  gitText = defaultGitText,
  ghText = defaultGhText,
  invokeCloudVerifier = invokeRepositoryCloudVerifier,
  readLedger = readLedgerSnapshot,
  environment = process.env,
} = {}) {
  const remote = requireRemoteVerification(remoteAuthorityVerification);
  if (!Array.isArray(lanes) || lanes.length > BOUND) {
    throw new Error("Delivery peer verification requires a bounded lane inventory.");
  }
  const evaluationTime = Date.parse(requiredInstant(evaluatedAt, "evaluatedAt"));
  const peers = [];
  for (const lane of lanes) {
    const context = deliveryPeerContext({ lane, remote, evaluationTime });
    if (!context) continue;
    try {
      const first = capturePeerAuthority({
        ...context, gitText, ghText, invokeCloudVerifier, readLedger, environment,
      });
      const second = capturePeerAuthority({
        ...context, gitText, ghText, invokeCloudVerifier, readLedger, environment,
      });
      if (first.authorityDigest !== second.authorityDigest) continue;
      peers.push(first);
    } catch {
      // A partial, stale, or unavailable peer proof is simply not authority.
    }
  }
  peers.sort((left, right) => left.path.localeCompare(right.path));
  const peerSet = peers.map(({ path, claimId, authorityDigest }) => ({
    path, claimId, authorityDigest,
  }));
  const core = {
    schema: DELIVERY_PEER_VERIFICATION_SCHEMA,
    status: "ready",
    remoteClaimInventoryDigest: remote.inventory.inventoryDigest,
    ledgerRevision: remote.ledgerRevision,
    ledgerDigest: remote.ledgerDigest,
    peers,
    peerSetDigest: digestValue(peerSet),
  };
  const verification = deepFreeze({
    ...core,
    operationReceiptDigest: digestValue(core),
  });
  operationDerivedVerifications.add(verification);
  return verification;
}

export function isOperationDerivedDeliveryPeerVerification(value) {
  return operationDerivedVerifications.has(value);
}

function deliveryPeerContext({ lane, remote, evaluationTime }) {
  const lease = lane?.lease;
  const cloud = lease?.cloudAuthority;
  if (
    !lane
    || lane.dirty
    || lane.invalid
    || lane.leaseAmbiguous
    || lease?.status !== "review_ready"
    || cloud?.state !== "review_ready"
    || !SHA_PATTERN.test(String(lane.head || ""))
    || !SHA_PATTERN.test(String(lease.reviewHeadSha || ""))
    || cloud.laneRevision !== lease.reviewHeadSha
    || !DIGEST_PATTERN.test(String(cloud.claimId || ""))
  ) return null;
  const matches = remote.inventory.claims.filter(
    claim => claim.claimId === cloud.claimId,
  );
  if (matches.length !== 1) return null;
  const current = matches[0];
  if (
    normalizeState(current.state) !== "delivery_authorized"
    || current.transitionCounter < cloud.transitionCounter + 1
    || Date.parse(current.expiresAt) <= evaluationTime
  ) return null;
  return { lane, lease, cloud, current, remote };
}

function capturePeerAuthority({
  lane,
  lease,
  cloud,
  current,
  remote,
  gitText,
  ghText,
  invokeCloudVerifier,
  readLedger,
  environment,
}) {
  const path = requiredText(lane.path, "lane path");
  const branch = requiredText(lease.branch, "peer branch");
  const observedHeadSha = requiredSha(
    gitText(path, ["rev-parse", "HEAD"]).trim(),
    "peer HEAD",
  );
  if (observedHeadSha !== lane.head) {
    throw new Error("Delivery peer HEAD changed after lane inspection.");
  }
  if (gitText(path, [
    "status", "--porcelain=v1", "-z", "--untracked-files=all",
  ])) {
    throw new Error("Delivery peer worktree is dirty.");
  }
  const protectedMainRefresh = verifyProtectedMainRefreshChain({
    expectedHeadSha: lease.reviewHeadSha,
    observedHeadSha,
    gitText: args => gitText(path, args),
    mainRef: "origin/main",
  });
  const pullRequest = readPullRequest({ lease, cloud, ghText, path });
  if (pullRequest.headRefOid !== observedHeadSha) {
    throw new Error("Delivery peer provider head differs from local HEAD.");
  }
  if (protectedMainRefresh) {
    const latest = Array.isArray(protectedMainRefresh.refreshes)
      ? protectedMainRefresh.refreshes.at(-1)
      : protectedMainRefresh;
    if (latest.mainParentSha !== pullRequest.baseRefOid) {
      throw new Error("Protected-main refresh does not join the live PR base.");
    }
  } else if (pullRequest.baseRefOid !== cloud.canonicalBaseSha) {
    throw new Error("Unrefreshed delivery peer does not join its reviewed canonical base.");
  }
  const historicalLedger = readLedger({
    ledgerRepository: cloud.ledgerRepository,
    revision: cloud.ledgerRevision,
    cwd: path,
    ghText,
  });
  const currentLedger = readLedger({
    ledgerRepository: cloud.ledgerRepository,
    revision: remote.ledgerRevision,
    cwd: path,
    ghText,
  });
  const chain = verifyLedgerChain({
    historicalLedger,
    currentLedger,
    cloud,
    current,
    currentLedgerDigest: remote.ledgerDigest,
  });
  const pullRequestNumber = parsePullRequestNumber(lease.pullRequestUrl);
  const cloudResult = invokeCloudVerifier({
    ledgerRepository: cloud.ledgerRepository,
    request: {
      targetRepository: cloud.targetRepository,
      pullRequestNumber,
      branch,
      canonicalBaseSha: cloud.canonicalBaseSha,
      headSha: cloud.laneRevision,
      claimId: cloud.claimId,
      expectedClaimDigest: current.fenceRevision,
      expectedLedgerRevision: remote.ledgerRevision,
      requiredState: "delivery_authorized",
      reviewRequestId: cloud.reviewRequestId,
      writeSetDigest: cloud.writeSetDigest,
      leaseEpoch: cloud.leaseEpoch,
      focusedEvidenceDigest: cloud.focusedEvidenceDigest,
      allowProtectedMainRefresh: true,
    },
    environment: sanitizedVerifierEnvironment(environment),
  });
  verifyCloudResult({
    result: cloudResult,
    remote,
    current,
    cloud,
    pullRequest,
    pullRequestNumber,
    branch,
    observedHeadSha,
  });
  const authorityCore = {
    schema: PEER_PROOF_SCHEMA,
    path,
    branch,
    claimId: cloud.claimId,
    reviewedHeadSha: lease.reviewHeadSha,
    observedHeadSha,
    protectedMainRefresh,
    predecessorLedgerRevision: cloud.ledgerRevision,
    predecessorClaimDigest: cloud.claimDigest,
    predecessorTransitionDigest: cloud.claimLedgerRevision,
    predecessorCounter: cloud.transitionCounter,
    deliveryAuthorizationCounter: chain.deliveryEntry.claimCore.transitionCounter,
    heartbeatSuffixCount: chain.heartbeatEntries.length,
    currentRecordDigest: current.recordDigest,
    currentClaimDigest: current.fenceRevision,
    currentTransitionDigest: current.transitionDigest,
    currentCounter: current.transitionCounter,
    currentExpiresAt: current.expiresAt,
    provider: {
      repository: cloud.targetRepository,
      pullRequestNumber,
      reviewRequestId: cloud.reviewRequestId,
      url: pullRequest.url,
      branch: pullRequest.headRefName,
      headSha: pullRequest.headRefOid,
      baseSha: pullRequest.baseRefOid,
      state: pullRequest.state,
      draft: pullRequest.isDraft,
    },
  };
  return deepFreeze({
    ...authorityCore,
    currentLedgerRevision: remote.ledgerRevision,
    currentLedgerDigest: remote.ledgerDigest,
    authorityDigest: digestValue(authorityCore),
  });
}

function readPullRequest({ lease, cloud, ghText, path }) {
  const source = JSON.parse(ghText(path, [
    "pr", "view", lease.pullRequestUrl, "--json",
    "id,url,state,isDraft,headRefName,headRefOid,headRepository,baseRefName,baseRefOid",
  ]));
  if (
    source?.url !== lease.pullRequestUrl
    || source.state !== "OPEN"
    || source.isDraft !== false
    || source.headRefName !== lease.branch
    || source.baseRefName !== "main"
    || source.headRepository?.nameWithOwner !== cloud.targetRepository
    || `github-pull-request:${source.id}` !== cloud.reviewRequestId
  ) {
    throw new Error("Delivery peer pull request is not one exact open reviewed subject.");
  }
  requiredSha(source.headRefOid, "provider head");
  requiredSha(source.baseRefOid, "provider base");
  return source;
}

function verifyLedgerChain({
  historicalLedger,
  currentLedger,
  cloud,
  current,
  currentLedgerDigest,
}) {
  const historicalBytes = JSON.stringify(historicalLedger.entries);
  const prefixBytes = JSON.stringify(
    currentLedger.entries.slice(0, historicalLedger.entries.length),
  );
  if (
    historicalLedger.entries.length >= currentLedger.entries.length
    || historicalBytes !== prefixBytes
    || historicalLedger.headDigest !== cloud.claimLedgerRevision
    || currentLedger.headDigest !== currentLedgerDigest
  ) {
    throw new Error("Delivery peer ledger snapshots do not form one exact successor chain.");
  }
  const predecessor = projectLedgerEntry(historicalLedger.entries.at(-1));
  verifyPredecessorEntry(predecessor, cloud);
  const suffix = currentLedger.entries.slice(historicalLedger.entries.length)
    .filter(entry => entry.claimId === cloud.claimId)
    .map(projectLedgerEntry);
  const [deliveryEntry, ...heartbeatEntries] = suffix;
  if (
    !deliveryEntry
    || deliveryEntry.action !== "delivery-authorize"
    || deliveryEntry.claimCore.state !== "delivery-authorized"
    || deliveryEntry.claimCore.transitionCounter !== cloud.transitionCounter + 1
    || heartbeatEntries.some(entry => (
      entry.action !== "heartbeat"
      || entry.claimCore.state !== "delivery-authorized"
    ))
  ) {
    throw new Error("Delivery peer successor is not delivery authorization plus heartbeats only.");
  }
  const latest = suffix.at(-1);
  verifyCurrentEntry(latest, current);
  return { deliveryEntry, heartbeatEntries };
}

function projectLedgerEntry(entry) {
  const state = projectRootState(entry?.claimCore?.state).replaceAll("_", "-");
  const action = String(entry?.action || "").replaceAll("_", "-");
  const projectedAction = action === "continue" && state === "review-ready"
    ? "review-ready"
    : action === "integrate" && state === "delivery-authorized"
      ? "delivery-authorize"
      : action === "continue" && state === "delivery-authorized"
        ? "heartbeat"
        : action;
  return {
    ...entry,
    action: projectedAction,
    claimCore: { ...entry?.claimCore, state },
  };
}

function verifyPredecessorEntry(entry, cloud) {
  const core = entry?.claimCore;
  if (
    entry?.action !== "review-ready"
    || entry.claimId !== cloud.claimId
    || entry.claimDigest !== cloud.claimDigest
    || entry.digest !== cloud.claimLedgerRevision
    || core?.state !== "review-ready"
    || core.transitionCounter !== cloud.transitionCounter
    || core.canonicalBaseRevision !== cloud.canonicalBaseSha
    || core.laneRevision !== cloud.laneRevision
    || core.writeSetDigest !== cloud.writeSetDigest
    || JSON.stringify(core.declaredWriteScope)
      !== JSON.stringify(cloud.cloudDeclaredWriteScope)
    || core.leaseEpoch !== cloud.leaseEpoch
    || core.reviewRequestId !== cloud.reviewRequestId
    || core.expiresAt !== cloud.expiresAt
    || core.evidenceDigest !== cloud.focusedEvidenceDigest
    || core.deviceId !== pseudonymousIdentifier("device", cloud.deviceId)
    || core.sessionId !== pseudonymousIdentifier("session", cloud.sessionId)
  ) {
    throw new Error("Local review-ready projection is not the exact historical claim entry.");
  }
}

function verifyCurrentEntry(entry, current) {
  const core = entry?.claimCore;
  const currentCore = {
    claimId: current.claimId,
    state: normalizeState(current.state).replaceAll("_", "-"),
    actorId: current.actorId,
    repositoryId: current.repositoryId,
    workItemId: current.workItemId,
    canonicalBaseRevision: current.canonicalBaseRevision,
    laneRevision: current.laneRevision,
    declaredWriteScope: current.declaredWriteScope,
    writeSetDigest: current.writeSetDigest,
    leaseEpoch: current.leaseEpoch,
    transitionCounter: current.transitionCounter,
    heartbeatCounter: current.heartbeatCounter,
    reviewRequestId: current.reviewRequestId,
    expiresAt: current.expiresAt,
  };
  if (
    entry?.claimDigest !== current.fenceRevision
    || entry?.digest !== current.transitionDigest
    || !core
    || Object.entries(currentCore).some(
      ([key, value]) => JSON.stringify(core[key]) !== JSON.stringify(value),
    )
  ) {
    throw new Error("Current delivery peer inventory does not match the current ledger entry.");
  }
}

function verifyCloudResult({
  result,
  remote,
  current,
  cloud,
  pullRequest,
  pullRequestNumber,
  branch,
  observedHeadSha,
}) {
  if (
    result?.schema !== "agentic-cloud-collaboration-result/v1"
    || result.ok !== true
    || result.action !== "verify"
    || result.status !== "ready"
    || result.ledgerRevision !== remote.ledgerRevision
    || result.receipt?.ledgerDigest !== remote.ledgerDigest
    || result.claimDigest !== current.fenceRevision
    || result.claim?.transitionDigest !== current.transitionDigest
    || result.claim?.claimId !== cloud.claimId
    || result.claim?.reviewRequestId !== cloud.reviewRequestId
    || normalizeState(result.claim?.state) !== "delivery_authorized"
    || result.subject?.repository !== cloud.targetRepository
    || result.subject?.pullRequestNumber !== pullRequestNumber
    || result.subject?.branch !== branch
    || result.subject?.headSha !== observedHeadSha
    || result.subject?.headSha !== pullRequest.headRefOid
    || result.subject?.canonicalBaseSha !== pullRequest.baseRefOid
  ) {
    throw new Error("Live cloud verification does not join the current provider subject.");
  }
}

function requireRemoteVerification(value) {
  const snapshot = structuredClone(value);
  const inventory = snapshot?.inventory;
  const claims = inventory?.claims;
  if (
    snapshot?.schema !== "agentic-lane-cloud-verification/v1"
    || snapshot.status !== "ready"
    || inventory?.schema !== "agentic-cloud-claim-inventory/v1"
    || !Array.isArray(claims)
    || claims.length > BOUND
    || inventory.inventoryDigest !== snapshot.remoteClaimInventoryDigest
    || snapshot.ledgerRevision !== inventory.observedLedgerHeadRevision
    || snapshot.ledgerDigest !== inventory.ledgerDigest
  ) {
    throw new Error("Delivery peer verification requires one exact current cloud inventory.");
  }
  for (const claim of claims) {
    const { recordDigest, ...recordCore } = claim || {};
    if (
      !DIGEST_PATTERN.test(String(recordDigest || ""))
      || digestValue(recordCore) !== recordDigest
    ) {
      throw new Error("Delivery peer verification found a mutated cloud claim record.");
    }
  }
  const { inventoryDigest, ...inventoryCore } = inventory;
  if (digestValue(inventoryCore) !== inventoryDigest) {
    throw new Error("Delivery peer verification found a mutated cloud inventory.");
  }
  return deepFreeze(snapshot);
}

function sanitizedVerifierEnvironment(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Delivery peer verification requires an environment object.");
  }
  return Object.fromEntries(Object.entries(source).filter(
    ([key]) => !key.startsWith("AGENTIC_") && key !== "NODE_OPTIONS" && key !== "NODE_PATH",
  ));
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Reflect.ownKeys(value).map(key => value[key])) {
    deepFreeze(nested, seen);
  }
  return Object.freeze(value);
}

function readLedgerSnapshot({ ledgerRepository, revision, cwd, ghText }) {
  requiredRepository(ledgerRepository, "ledger repository");
  requiredSha(revision, "ledger revision");
  const bytes = ghText(cwd, [
    "api", "--method", "GET",
    "-H", "Accept: application/vnd.github.raw+json",
    `repos/${ledgerRepository}/contents/.agentic/collaboration-ledger.json`,
    "-f", `ref=${revision}`,
  ]);
  if (Buffer.byteLength(bytes) < 1 || Buffer.byteLength(bytes) > MAX_LEDGER_BYTES) {
    throw new Error("Delivery peer ledger snapshot is outside the byte bound.");
  }
  const ledger = JSON.parse(bytes);
  const findings = validateLedger(ledger);
  if (findings.length > 0) {
    throw new Error(`Delivery peer ledger snapshot is invalid: ${findings.join("; ")}`);
  }
  return ledger;
}

function defaultGitText(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function defaultGhText(cwd, args) {
  return execFileSync("gh", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function parsePullRequestNumber(value) {
  const match = String(value || "").match(/\/pull\/([1-9]\d*)\/?$/u);
  if (!match) throw new Error("Delivery peer requires an exact pull-request URL.");
  return Number(match[1]);
}

function normalizeState(value) {
  return String(value || "").replaceAll("-", "_");
}

function requiredText(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function requiredSha(value, label) {
  const normalized = requiredText(value, label);
  if (!SHA_PATTERN.test(normalized)) throw new Error(`${label} must be a Git SHA.`);
  return normalized;
}

function requiredInstant(value, label) {
  const normalized = requiredText(value, label);
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new Error(`${label} must be an ISO instant.`);
  }
  return new Date(normalized).toISOString();
}

function requiredRepository(value, label) {
  const normalized = requiredText(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(normalized)) {
    throw new Error(`${label} must be owner/repository.`);
  }
  return normalized;
}
