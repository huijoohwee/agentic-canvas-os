import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  digestValue,
  normalizeWriteSet,
} from "./cloud-collaboration-primitives.mjs";
import { assertLeaseWorktree } from "./device-branch-ownership-lib.mjs";
import { readOwnershipPullRequest } from "./device-pull-request-state.mjs";
import { requireCloudAdmission } from "./expired-committed-heartbeat-contract.mjs";
export { requireCloudAdmission };
import {
  captureProtectedMainPathEquivalence,
  captureProtectedMainSharedAncestorPathEquivalence,
  RECOVERY_PATH_EVIDENCE_MAX_BYTES,
  RECOVERY_PATH_EVIDENCE_MAX_PATHS,
} from "./protected-main-path-equivalence-lib.mjs";
import {
  normalizeReviewedLaneSourceCorrectionIntent,
} from "./reviewed-lane-source-correction-contract.mjs";
import {
  normalizeReviewedForwardChildIntent,
} from "./reviewed-forward-child-recovery-contract.mjs";
import {
  parseDeviceBranch,
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
} from "./writer-lease-lib.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
export function captureCommittedDescendantEvidence({
  lease,
  gitText,
  bindProtectedMain = true,
  bindPublishedPrefix = true,
  sourceRemoteHeadSha = lease.fenceSha,
}) {
  const headSha = gitText(["rev-parse", "HEAD"]).trim();
  if (!SHA_PATTERN.test(headSha) || headSha === lease.fenceSha) {
    throw new Error(
      "Expired committed recovery requires a strict committed descendant of the fence.",
    );
  }
  const fenceParents = gitText([
    "rev-list",
    "--parents",
    "-n",
    "1",
    lease.fenceSha,
  ]).trim().split(/\s+/);
  if (isDirectFenceOverBase({ fenceParents, lease })) {
    // Direct authored fence; continue with ordinary descendant evidence.
  } else if (isCompletedSourceCorrectionFence({ fenceParents, lease, gitText })) {
    // Completed source-correction fence; receipt-bound lineage verified.
  } else if (isCompletedReviewedForwardChildFence({ fenceParents, lease, gitText })) {
    // Completed reviewed forward-child fence; receipt-bound lineage verified.
  } else {
    throw new Error(
      "Expired committed recovery requires the exact single-parent fence over its source base.",
    );
  }
  gitText(["merge-base", "--is-ancestor", lease.fenceSha, headSha]);
  requireSourceRemotePrefix({
    sourceFenceSha: lease.fenceSha,
    sourceRemoteHeadSha,
    headSha,
    gitText,
  });
  const sourceRemotePrefix = bindPublishedPrefix
    ? captureSourceRemotePrefixEvidence({
      lease,
      sourceRemoteHeadSha,
      worktreeHeadSha: headSha,
      gitText,
      bindProtectedMain,
    })
    : null;
  const treeSha = gitText(["rev-parse", `${headSha}^{tree}`]).trim();
  if (!SHA_PATTERN.test(treeSha)) {
    throw new Error("Expired committed recovery could not resolve the descendant tree.");
  }
  const changedPaths = uniqueSorted(splitNul(gitText([
    "diff",
    "--name-only",
    "-z",
    "--no-renames",
    lease.fenceSha,
    headSha,
    "--",
  ])));
  if (!changedPaths.length) {
    const fenceTreeSha = gitText(["rev-parse", `${lease.fenceSha}^{tree}`]).trim();
    if (!SHA_PATTERN.test(fenceTreeSha) || fenceTreeSha !== treeSha) {
      throw new Error(
        "Expired committed recovery empty descendant does not preserve the exact fence tree.",
      );
    }
  }
  requireBoundedChangedPaths(changedPaths);
  const partition = partitionChangedPathsByScope({
    changedPaths,
    declaredWriteSet: lease.admission.declaredWriteSet,
  });
  if (!bindProtectedMain && partition.protectedEquivalentPaths.length) {
    throw new Error(
      `Expired committed recovery path is outside declared write scope: ${partition.protectedEquivalentPaths[0]}`,
    );
  }
  const protectedMainEquivalence = bindProtectedMain
    ? captureProtectedMainPathEquivalence({
      baseSha: lease.baseSha,
      headSha,
      exemptPaths: partition.protectedEquivalentPaths,
      gitText,
    })
    : null;
  if (
    protectedMainEquivalence &&
    protectedMainEquivalence.headTreeSha !== treeSha
  ) {
    throw new Error(
      "Expired committed recovery descendant tree drifted during evidence capture.",
    );
  }
  if (
    sourceRemotePrefix?.sharedAncestorEquivalence &&
    (
      sourceRemotePrefix.sharedAncestorEquivalence.protectedMainRef !==
        protectedMainEquivalence?.protectedMainRef ||
      sourceRemotePrefix.sharedAncestorEquivalence.protectedMainSha !==
        protectedMainEquivalence?.protectedMainSha ||
      sourceRemotePrefix.sharedAncestorEquivalence.protectedMainTreeSha !==
        protectedMainEquivalence?.protectedMainTreeSha
    )
  ) {
    throw new Error(
      "Expired committed recovery protected-main anchor drifted between published-prefix and full-range capture.",
    );
  }
  const rangeDiffDigest = sha256(gitText([
    "diff",
    "--binary",
    "--no-renames",
    lease.fenceSha,
    headSha,
    "--",
  ]));
  return Object.freeze({
    sourceRemoteHeadSha,
    ...(sourceRemotePrefix ? { sourceRemotePrefix } : {}),
    headSha,
    treeSha,
    changedPaths: Object.freeze(changedPaths),
    declaredChangedPaths: Object.freeze(partition.declaredChangedPaths),
    protectedEquivalentPaths: Object.freeze(
      partition.protectedEquivalentPaths,
    ),
    ...(protectedMainEquivalence ? {
      protectedMainEquivalence,
      protectedMainEquivalenceDigest: digestValue(
        protectedMainEquivalence,
      ),
    } : {}),
    rangeDiffDigest,
  });
}

function isCompletedReviewedForwardChildFence({ fenceParents, lease, gitText }) {
  if (
    fenceParents.length !== 2 ||
    fenceParents[0] !== lease.fenceSha ||
    !lease?.cloudAuthority?.claimId
  ) {
    return false;
  }
  const directory = path.resolve(
    gitText(["rev-parse", "--git-common-dir"]).trim(),
    "agentic-canvas-os",
    "reviewed-forward-child-recovery",
  );
  const matches = [];
  for (const filePath of recursiveJsonFiles(directory, 2)) {
    let intent;
    try {
      intent = normalizeReviewedForwardChildIntent(
        JSON.parse(readFileSync(filePath, "utf8")),
      );
    } catch {
      continue;
    }
    const plan = intent.planSnapshot;
    const source = plan.source;
    const sourceLease = source.lease;
    const completion = intent.completion;
    if (
      intent.status === "complete" &&
      completion?.status === "authoring-restored" &&
      completion.childHeadSha === lease.fenceSha &&
      completion.successorClaimId === lease.cloudAuthority.claimId &&
      plan.childHeadSha === lease.fenceSha &&
      plan.sourceHeadSha === fenceParents[1] &&
      plan.candidate.parentShas.length === 1 &&
      plan.candidate.parentShas[0] === fenceParents[1] &&
      source.source.headSha === fenceParents[1] &&
      sourceLease.baseSha === lease.baseSha &&
      sourceLease.branch === lease.branch &&
      sourceLease.sessionId === lease.sessionId &&
      sourceLease.device === lease.device &&
      sourceLease.scope === lease.scope &&
      sourceLease.pullRequestUrl === lease.pullRequestUrl &&
      sourceLease.manifestDigest === lease.admission?.manifestDigest &&
      sourceLease.writeSetDigest === lease.admission?.writeSetDigest &&
      source.claim.claimId === completion.sourceClaimId &&
      source.claim.canonicalBaseSha === lease.baseSha &&
      source.claim.writeSetDigest === lease.admission?.writeSetDigest &&
      lease.cloudAuthority.laneRevision === lease.fenceSha &&
      lease.cloudAuthority.canonicalBaseSha === lease.baseSha &&
      lease.cloudAuthority.writeSetDigest === lease.admission?.writeSetDigest
    ) {
      matches.push(intent);
    }
  }
  return matches.length === 1;
}

function recursiveJsonFiles(directory, depth) {
  if (!existsSync(directory) || depth < 0) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && depth > 0) {
      files.push(...recursiveJsonFiles(target, depth - 1));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(target);
    }
  }
  return files;
}

function isDirectFenceOverBase({ fenceParents, lease }) {
  return fenceParents.length === 2 &&
    fenceParents[0] === lease.fenceSha &&
    fenceParents[1] === lease.baseSha;
}

function isCompletedSourceCorrectionFence({ fenceParents, lease, gitText }) {
  if (
    fenceParents.length !== 2 ||
    fenceParents[0] !== lease.fenceSha ||
    !lease?.cloudAuthority?.claimId
  ) {
    return false;
  }
  const completed = matchingCompletedSourceCorrections({ lease, gitText });
  return completed.length === 1 &&
    completed[0].plan.source.lease.fenceSha === fenceParents[1];
}

function matchingCompletedSourceCorrections({ lease, gitText }) {
  const directory = path.resolve(
    gitText(["rev-parse", "--git-common-dir"]).trim(),
    "agentic-canvas-os",
    "reviewed-lane-source-correction",
  );
  if (!existsSync(directory)) return [];
  const matches = [];
  for (const name of readdirSync(directory)) {
    if (!name.endsWith(".json")) continue;
    let intent;
    try {
      intent = normalizeReviewedLaneSourceCorrectionIntent(
        JSON.parse(readFileSync(path.join(directory, name), "utf8")),
      );
    } catch {
      continue;
    }
    const plan = intent.planSnapshot;
    const source = plan.source;
    const sourceLease = source.lease;
    const completion = intent.completion;
    if (
      intent.status === "complete" &&
      completion?.status === "authoring-restored" &&
      completion.sourceHeadSha === lease.fenceSha &&
      completion.successorClaimId === lease.cloudAuthority.claimId &&
      plan.sourceHeadSha === lease.fenceSha &&
      source.localHeadSha === lease.fenceSha &&
      source.remoteHeadSha === lease.fenceSha &&
      sourceLease.reviewHeadSha === lease.fenceSha &&
      sourceLease.baseSha === lease.baseSha &&
      sourceLease.branch === lease.branch &&
      sourceLease.sessionId === lease.sessionId &&
      sourceLease.device === lease.device &&
      sourceLease.scope === lease.scope &&
      sourceLease.pullRequestUrl === lease.pullRequestUrl &&
      source.authority?.claimId === completion.sourceClaimId &&
      source.authority?.laneRevision === lease.fenceSha &&
      source.authority?.canonicalBaseSha === lease.baseSha &&
      source.authority?.writeSetDigest === lease.admission?.writeSetDigest &&
      source.claim?.claimId === completion.sourceClaimId &&
      source.claim?.laneRevision === lease.fenceSha &&
      source.claim?.canonicalBaseRevision === lease.baseSha &&
      source.claim?.writeSetDigest === lease.admission?.writeSetDigest
    ) {
      matches.push({ intent, plan, completion });
    }
  }
  return matches;
}

export function captureExpiredCommittedHeartbeatSnapshot({
  repo,
  branch,
  gitText,
  gitOptional,
  ghText,
  leaseStore,
  sessionId,
  now = () => new Date(),
}) {
  const instant = now();
  const lease = leaseStore.read(branch);
  if (
    !lease ||
    lease.status !== "active" ||
    lease.sessionId !== sessionId ||
    lease.branch !== branch
  ) {
    throw new Error("Expired committed recovery requires its exact active session lease.");
  }
  assertLeaseWorktree(lease, repo);
  const identity = parseDeviceBranch(branch);
  if (
    !identity ||
    identity.device !== lease.device ||
    identity.scope !== lease.scope
  ) {
    throw new Error("Expired committed recovery branch identity drifted from its lease.");
  }
  if (Date.parse(lease.expiresAt) > instant.getTime()) {
    throw new Error("Expired committed recovery requires an expired local writer lease.");
  }
  requireCloudAdmission({ lease, instant, requireLive: false });
  if (gitText(["status", "--porcelain=v1", "-z", "--untracked-files=all"])) {
    throw new Error("Expired committed recovery requires a clean worktree.");
  }

  const remoteHeadSha = remoteBranchHead({ branch, gitOptional });
  const projection = readExactPullRequestProjection({
    lease,
    branch,
    ghText,
    expectedHeadSha: remoteHeadSha,
  });
  const descendant = captureCommittedDescendantEvidence({
    lease,
    gitText,
    bindProtectedMain: true,
    sourceRemoteHeadSha: remoteHeadSha,
  });
  const {
    sourceRemotePrefix,
    headSha,
    treeSha,
    changedPaths,
    declaredChangedPaths,
    protectedEquivalentPaths,
    protectedMainEquivalence,
    protectedMainEquivalenceDigest,
    rangeDiffDigest,
  } = descendant;
  const snapshot = {
    schema: "agentic-expired-committed-heartbeat-snapshot/v3",
    branch,
    sourceLeaseDigest: digestValue(lease),
    sourceMarkerDigest: projection.markerDigest,
    pullRequestBodyDigest: projection.bodyDigest,
    remoteHeadSha,
    pullRequestHeadSha: projection.pullRequest.headRefOid,
    sourceRemotePrefix,
    headSha,
    treeSha,
    changedPaths,
    declaredChangedPaths,
    protectedEquivalentPaths,
    protectedMainEquivalence,
    protectedMainEquivalenceDigest,
    rangeDiffDigest,
  };
  return Object.freeze({
    ...snapshot,
    snapshotDigest: digestValue(snapshot),
    lease,
    recoveryEvidence: Object.freeze({
      sourceEpoch: lease.epoch,
      sourceSessionId: lease.sessionId,
      sourceDevice: lease.device,
      sourceScope: lease.scope,
      sourceBranch: lease.branch,
      sourceBaseSha: lease.baseSha,
      sourceFenceSha: lease.fenceSha,
      sourceRemoteHeadSha: remoteHeadSha,
      sourceRemoteTreeSha: sourceRemotePrefix.treeSha,
      sourceRemoteChangedPathCount:
        sourceRemotePrefix.changedPaths.length,
      sourceRemoteChangedPathsDigest: digestValue(
        sourceRemotePrefix.changedPaths,
      ),
      sourceRemoteDeclaredChangedPathCount:
        sourceRemotePrefix.declaredChangedPaths.length,
      sourceRemoteDeclaredChangedPathsDigest: digestValue(
        sourceRemotePrefix.declaredChangedPaths,
      ),
      sourceRemoteProtectedEquivalentPathCount:
        sourceRemotePrefix.protectedEquivalentPaths.length,
      sourceRemoteProtectedEquivalentPathsDigest: digestValue(
        sourceRemotePrefix.protectedEquivalentPaths,
      ),
      sourceRemoteSharedAncestorEquivalence:
        sourceRemotePrefix.sharedAncestorEquivalence,
      sourceRemoteSharedAncestorEquivalenceDigest:
        sourceRemotePrefix.sharedAncestorEquivalenceDigest,
      sourceRemoteRangeDiffDigest: sourceRemotePrefix.rangeDiffDigest,
      sourcePullRequestUrl: lease.pullRequestUrl,
      sourceClaimId: lease.cloudAuthority.claimId,
      sourceClaimDigest: lease.cloudAuthority.claimDigest,
      sourceLedgerRevision: lease.cloudAuthority.ledgerRevision,
      sourceClaimLedgerRevision: lease.cloudAuthority.claimLedgerRevision,
      sourceCloudTransitionCounter:
        lease.cloudAuthority.transitionCounter,
      headSha,
      treeSha,
      changedPathCount: changedPaths.length,
      changedPathsDigest: digestValue(changedPaths),
      declaredChangedPathCount: declaredChangedPaths.length,
      declaredChangedPathsDigest: digestValue(declaredChangedPaths),
      protectedEquivalentPathCount: protectedEquivalentPaths.length,
      protectedEquivalentPathsDigest: digestValue(
        protectedEquivalentPaths,
      ),
      protectedMainEquivalence,
      protectedMainEquivalenceDigest,
      sourceMarkerDigest: projection.markerDigest,
      pullRequestBodyDigest: projection.bodyDigest,
      rangeDiffDigest,
    }),
  });
}

export function captureSourceRemotePrefixEvidence({
  lease,
  sourceRemoteHeadSha,
  worktreeHeadSha,
  gitText,
  bindProtectedMain = true,
}) {
  if (!SHA_PATTERN.test(String(sourceRemoteHeadSha || ""))) {
    throw new Error(
      "Expired committed recovery source remote head is not an exact Git SHA.",
    );
  }
  if (!SHA_PATTERN.test(String(worktreeHeadSha || ""))) {
    throw new Error(
      "Expired committed recovery worktree head is not an exact Git SHA.",
    );
  }
  const treeSha = gitText([
    "rev-parse",
    `${sourceRemoteHeadSha}^{tree}`,
  ]).trim();
  if (!SHA_PATTERN.test(treeSha)) {
    throw new Error(
      "Expired committed recovery could not resolve the source remote tree.",
    );
  }
  const changedPaths = uniqueSorted(splitNul(gitText([
    "diff",
    "--name-only",
    "-z",
    "--no-renames",
    lease.fenceSha,
    sourceRemoteHeadSha,
    "--",
  ])));
  requireBoundedChangedPaths(changedPaths);
  const partition = partitionChangedPathsByScope({
    changedPaths,
    declaredWriteSet: lease.admission.declaredWriteSet,
  });
  if (!bindProtectedMain && partition.protectedEquivalentPaths.length) {
    throw new Error(
      `Expired committed recovery published-prefix path is outside declared write scope: ${partition.protectedEquivalentPaths[0]}`,
    );
  }
  const sharedAncestorEquivalence = bindProtectedMain
    ? captureProtectedMainSharedAncestorPathEquivalence({
      baseSha: lease.baseSha,
      headSha: sourceRemoteHeadSha,
      exemptPaths: partition.protectedEquivalentPaths,
      gitText,
      worktreeHeadSha,
    })
    : null;
  if (
    sharedAncestorEquivalence &&
    sharedAncestorEquivalence.headTreeSha !== treeSha
  ) {
    throw new Error(
      "Expired committed recovery source remote tree drifted during published-prefix capture.",
    );
  }
  const rangeDiffDigest = sha256(gitText([
    "diff",
    "--binary",
    "--no-renames",
    lease.fenceSha,
    sourceRemoteHeadSha,
    "--",
  ]));
  return Object.freeze({
    headSha: sourceRemoteHeadSha,
    treeSha,
    changedPaths: Object.freeze(changedPaths),
    declaredChangedPaths: Object.freeze(partition.declaredChangedPaths),
    protectedEquivalentPaths: Object.freeze(
      partition.protectedEquivalentPaths,
    ),
    ...(sharedAncestorEquivalence ? {
      sharedAncestorEquivalence,
      sharedAncestorEquivalenceDigest: digestValue(
        sharedAncestorEquivalence,
      ),
    } : {}),
    rangeDiffDigest,
  });
}

export function readExactPullRequestProjection({
  lease,
  branch,
  ghText,
  expectedBody = null,
  expectedHeadSha = lease.fenceSha,
}) {
  const projection = readPullRequestProjection({
    lease,
    branch,
    ghText,
    expectedBody,
    expectedHeadSha,
  });
  const marker = parseWriterLeasePullRequestBody(projection.pullRequest.body);
  const expectedMarker = projectWriterLeasePullRequestMarker(lease);
  if (
    projection.markerDigest !== digestValue(expectedMarker) &&
    !isImmediateCloudAuthorityRenewalMarker({ marker, expectedMarker })
  ) {
    throw new Error(
      "Expired committed recovery pull-request marker differs from the local lease.",
    );
  }
  return projection;
}

export function readPullRequestProjection({
  lease,
  branch,
  ghText,
  expectedBody = null,
  expectedHeadSha = lease.fenceSha,
}) {
  const pullRequest = readOwnershipPullRequest({
    url: lease.pullRequestUrl,
    branch,
    ghText,
  });
  const expectedRepository = repositoryFromPullRequestUrl(lease.pullRequestUrl);
  if (
    pullRequest.isDraft !== true ||
    !SHA_PATTERN.test(String(expectedHeadSha || "")) ||
    pullRequest.headRefOid !== expectedHeadSha ||
    pullRequest.headRepository?.nameWithOwner !== expectedRepository ||
    (expectedBody !== null && pullRequest.body !== expectedBody)
  ) {
    throw new Error(
      "Expired committed recovery requires the exact open draft ownership pull request.",
    );
  }
  const marker = parseWriterLeasePullRequestBody(pullRequest.body);
  if (!marker) {
    throw new Error(
      "Expired committed recovery pull request has no valid lease marker.",
    );
  }
  return Object.freeze({
    pullRequest,
    markerDigest: digestValue(marker),
    bodyDigest: sha256(pullRequest.body),
  });
}

function requireSourceRemotePrefix({
  sourceFenceSha,
  sourceRemoteHeadSha,
  headSha,
  gitText,
}) {
  if (!SHA_PATTERN.test(String(sourceRemoteHeadSha || ""))) {
    throw new Error(
      "Expired committed recovery source remote head is not an exact Git SHA.",
    );
  }
  try {
    if (sourceRemoteHeadSha !== sourceFenceSha) {
      gitText([
        "merge-base",
        "--is-ancestor",
        sourceFenceSha,
        sourceRemoteHeadSha,
      ]);
    }
    if (sourceRemoteHeadSha !== headSha) {
      gitText([
        "merge-base",
        "--is-ancestor",
        sourceRemoteHeadSha,
        headSha,
      ]);
    }
  } catch {
    throw new Error(
      "Expired committed recovery requires source fence, remote/PR prefix, and local HEAD ancestry.",
    );
  }
}

export function remoteBranchHead({ branch, gitOptional }) {
  const line = gitOptional([
    "ls-remote",
    "--heads",
    "origin",
    `refs/heads/${branch}`,
  ]);
  const sha = line.split(/\s+/)[0] || "";
  if (!SHA_PATTERN.test(sha)) {
    throw new Error("Expired committed recovery could not resolve its remote branch.");
  }
  return sha;
}

export function partitionChangedPathsByScope({
  changedPaths,
  declaredWriteSet,
}) {
  const declaredPaths = normalizeWriteSet(declaredWriteSet)
    .filter(value => value.startsWith("path:"))
    .map(value => value.slice("path:".length));
  if (!declaredPaths.length) {
    throw new Error("Expired committed recovery has no declared path authority.");
  }
  const declaredChangedPaths = [];
  const protectedEquivalentPaths = [];
  for (const changedPath of changedPaths) {
    const normalized = normalizeRecoveryPath(changedPath);
    const authorized = declaredPaths.some(declared => (
      declared === "." ||
      normalized === declared ||
      normalized.startsWith(`${declared}/`)
    ));
    (authorized ? declaredChangedPaths : protectedEquivalentPaths)
      .push(changedPath);
  }
  return Object.freeze({
    declaredChangedPaths: uniqueSorted(declaredChangedPaths),
    protectedEquivalentPaths: uniqueSorted(protectedEquivalentPaths),
  });
}

export function requireChangedPathsWithinScope({
  changedPaths,
  declaredWriteSet,
}) {
  const partition = partitionChangedPathsByScope({
    changedPaths,
    declaredWriteSet,
  });
  if (partition.protectedEquivalentPaths.length) {
    throw new Error(
      `Expired committed recovery path is outside declared write scope: ${partition.protectedEquivalentPaths[0]}`,
    );
  }
}

function requireBoundedChangedPaths(changedPaths) {
  const encodedBytes = Buffer.byteLength(changedPaths.join("\0"), "utf8");
  if (
    changedPaths.length > RECOVERY_PATH_EVIDENCE_MAX_PATHS ||
    encodedBytes > RECOVERY_PATH_EVIDENCE_MAX_BYTES
  ) {
    throw new Error(
      `Expired committed recovery changed-path evidence exceeds ${RECOVERY_PATH_EVIDENCE_MAX_PATHS} paths or ${RECOVERY_PATH_EVIDENCE_MAX_BYTES} bytes.`,
    );
  }
}

function normalizeRecoveryPath(changedPath) {
  if (
    typeof changedPath !== "string" ||
    !changedPath ||
    changedPath.includes("\0") ||
    changedPath.includes("\\") ||
    changedPath.startsWith("/")
  ) {
    throw new Error(
      `Expired committed recovery path is unsafe: ${changedPath}`,
    );
  }
  return normalizeWriteSet([`path:${changedPath}`])[0]
    .slice("path:".length);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function splitNul(value) {
  return String(value || "").split("\0").filter(Boolean);
}

function isImmediateCloudAuthorityRenewalMarker({ marker, expectedMarker }) {
  if (
    !marker?.cloudAuthority ||
    !expectedMarker?.cloudAuthority ||
    !marker?.taskAuthority ||
    !expectedMarker?.taskAuthority
  ) {
    return false;
  }
  const sameTaskAuthority =
    digestValue(marker.taskAuthority) === digestValue(expectedMarker.taskAuthority);
  const taskAuthorityContinuation = isImmediateTaskAuthorityContinuation({
    previous: marker.taskAuthority,
    next: expectedMarker.taskAuthority,
  });
  if (!sameTaskAuthority && !taskAuthorityContinuation) {
    return false;
  }
  const sourceProjection = {
    ...expectedMarker,
    cloudAuthority: marker.cloudAuthority,
    ...(sameTaskAuthority ? null : { taskAuthority: marker.taskAuthority }),
  };
  if (digestValue(marker) !== digestValue(sourceProjection)) {
    return false;
  }
  return digestValue(marker.cloudAuthority)
      === digestValue(expectedMarker.cloudAuthority)
    || ((sameTaskAuthority || taskAuthorityContinuation)
      && isEquivalentCloudAuthorityLedgerObservation(
        marker.cloudAuthority,
        expectedMarker.cloudAuthority,
      ))
    || isImmediateCloudAuthorityRenewal(
      marker.cloudAuthority,
      expectedMarker.cloudAuthority,
    );
}

function isImmediateCloudAuthorityRenewal(source, target) {
  const renewalFields = new Set([
    "claimDigest",
    "ledgerRevision",
    "ledgerDigest",
    "claimLedgerRevision",
    "operationReceiptDigest",
    "transitionCounter",
    "expiresAt",
    "heartbeatCounter",
  ]);
  const stable = value => Object.fromEntries(Object.entries(value || {})
    .filter(([key]) => !renewalFields.has(key)));
  const sourceTransition = Number(source?.transitionCounter);
  const targetTransition = Number(target?.transitionCounter);
  if (
    !Number.isSafeInteger(sourceTransition) ||
    !Number.isSafeInteger(targetTransition) ||
    targetTransition !== sourceTransition + 1 ||
    digestValue(stable(source)) !== digestValue(stable(target)) ||
    Date.parse(target.expiresAt) < Date.parse(source.expiresAt)
  ) {
    return false;
  }
  if (
    source.heartbeatCounter !== undefined ||
    target.heartbeatCounter !== undefined
  ) {
    const sourceHeartbeat = Number(source.heartbeatCounter || 0);
    const targetHeartbeat = Number(target.heartbeatCounter || 0);
    return Number.isSafeInteger(sourceHeartbeat)
      && Number.isSafeInteger(targetHeartbeat)
      && targetHeartbeat === sourceHeartbeat + 1;
  }
  return true;
}

function isEquivalentCloudAuthorityLedgerObservation(source, target) {
  const omitLedgerObservation = value => Object.fromEntries(
    Object.entries(value || {}).filter(([key]) =>
      key !== "ledgerRevision" && key !== "ledgerDigest"),
  );
  return digestValue(omitLedgerObservation(source))
    === digestValue(omitLedgerObservation(target));
}

function isImmediateTaskAuthorityContinuation({ previous, next }) {
  if (!previous || !next || next.bindingMode !== "continuation") {
    return false;
  }
  return next.priorBindingDigest === previous.bindingDigest &&
    next.authoritySubjectId === previous.authoritySubjectId &&
    next.proofAdapterId === previous.proofAdapterId &&
    next.generation === previous.generation &&
    next.publicKey === previous.publicKey &&
    next.publicKeyDigest === previous.publicKeyDigest;
}

function repositoryFromPullRequestUrl(url) {
  const match = String(url || "").match(
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/[1-9]\d*(?:[/?#]|$)/,
  );
  if (!match) {
    throw new Error("Expired committed recovery requires an exact GitHub pull-request URL.");
  }
  return match[1];
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}
