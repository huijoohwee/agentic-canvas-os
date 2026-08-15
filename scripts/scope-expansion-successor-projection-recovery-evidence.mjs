// Responsibility: Capture and seal the one source-retired scope-expansion checkpoint this recovery may repair.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson, digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
import { normalizeActiveDirtyScopeExpansionPlan } from "./active-dirty-scope-expansion-contract.mjs";
import { assertTaskAuthorityBinding } from "./task-bound-lane-authority-contract.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import { projectWriterLeasePullRequestMarker } from "./writer-lease-lib.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";

export const RECOVERED_SCOPE_EXPANSION_PLAN_DIGEST =
  "c9028c510bad6b44aa7538e7e6cc8829adebdc24a2284da4ed598e8aa69bbff9";
export const EVIDENCE_SCHEMA =
  "agentic-scope-expansion-successor-projection-recovery-evidence/v1";

export function buildScopeExpansionSuccessorProjectionRecoveryEvidence(input = {}) {
  const controller = snapshot(input.controller, "protected controller");
  const lane = snapshot(input.lane, "source lane");
  const lease = snapshot(input.lease, "source lease");
  const intent = snapshot(input.scopeExpansionIntent, "scope-expansion intent");
  const pullRequest = snapshot(input.pullRequest, "pull request");
  const sourceRetirement = snapshot(input.sourceRetirement, "source retirement");
  const successor = snapshot(input.successor, "successor claim");
  const cloud = snapshot(input.cloud, "cloud observation");
  const plan = normalizeActiveDirtyScopeExpansionPlan(intent.planSnapshot);

  assertController(controller);
  assertCheckpoint({ controller, lane, lease, intent, plan, pullRequest });
  assertRetiredSource({ sourceRetirement, lease, plan });
  assertCurrentSuccessor({ successor, intent, lease, plan, sourceRetirement });
  assertCloudObservation({ cloud, sourceRetirement, successor });

  const core = {
    schema: EVIDENCE_SCHEMA,
    controller,
    lane,
    lease,
    leaseDigest: writerLeaseDigest(lease),
    sourceTaskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
    scopeExpansionIntent: intent,
    scopeExpansionIntentDigest: digestValue(intent),
    originalPlan: plan,
    originalPlanDigest: plan.planDigest,
    pullRequest,
    sourceRetirement,
    successor,
    cloud,
  };
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}

export function scopeExpansionSuccessorProjectionRecoveryDecisionSubject(value) {
  const source = value?.schema === EVIDENCE_SCHEMA
    ? normalizeScopeExpansionSuccessorProjectionRecoveryEvidence(value)
    : buildScopeExpansionSuccessorProjectionRecoveryEvidence(value);
  return deepFreeze({
    schema: "agentic-scope-expansion-successor-projection-recovery-decision-subject/v1",
    controller: source.controller,
    lane: source.lane,
    leaseDigest: source.leaseDigest,
    sourceTaskAuthorityBindingDigest: source.sourceTaskAuthorityBindingDigest,
    scopeExpansionIntentDigest: source.scopeExpansionIntentDigest,
    originalPlanDigest: source.originalPlanDigest,
    pullRequest: source.pullRequest,
    sourceRetirement: source.sourceRetirement,
    successor: source.successor,
    sourceLineageDigest: source.cloud.sourceLineageDigest,
    successorLineageDigest: source.cloud.successorLineageDigest,
  });
}

export function readScopeExpansionSuccessorProjectionRecoveryLane({ repository, git }) {
  const branch = git(["branch", "--show-current"]);
  const changedPaths = splitNul(git(["diff", "--name-only", "-z", "HEAD", "--"])).sort();
  const untrackedPaths = splitNul(git(["ls-files", "--others", "--exclude-standard", "-z"])).sort();
  const stagedPatch = git(["diff", "--cached", "--binary"]);
  const unstagedPatch = git(["diff", "--binary"]);
  const entries = changedPaths.map(relativePath => fileEntry(repository, git, relativePath));
  const status = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const subject = { statusDigest: digestValue(status), stagedPatchDigest: digestValue(stagedPatch),
    unstagedPatchDigest: digestValue(unstagedPatch), changedPaths, untrackedPaths, entries };
  return { branch, headSha: git(["rev-parse", "HEAD"]), remoteHeadSha: firstSha(git([
    "ls-remote", "--heads", "origin", `refs/heads/${branch}`])), dirty: Boolean(status),
    changedPaths, untrackedPaths, legacyDirtyDigest: digestValue({ stagedPatch,
      unstagedPatch, changedPaths, untracked: untrackedPaths }), ...subject,
    dirtDigest: digestValue(subject) };
}

export function readScopeExpansionSuccessorProjectionRecoveryController({
  controllerRoot, git, repository, implementation,
}) {
  const headSha = git(["rev-parse", "HEAD"], controllerRoot);
  return { repository, origin: git(["config", "--get", "remote.origin.url"], controllerRoot),
    headSha, originMainSha: git(["rev-parse", "origin/main"], controllerRoot),
    remoteMainSha: firstSha(git(["ls-remote", "origin", "refs/heads/main"], controllerRoot)),
    treeSha: git(["rev-parse", "HEAD^{tree}"], controllerRoot),
    clean: git(["status", "--porcelain=v1"], controllerRoot) === "",
    implementationDigest: digestValue(implementation.map(name => ({ name,
      digest: createHash("sha256").update(readFileSync(path.join(controllerRoot, "scripts", name))).digest("hex") }))) };
}

export function assertScopeExpansionSuccessorRecoveryProtectedFrame({
  sealedController, currentController, sealedLane, currentLane,
}) {
  if (digestValue(currentController) !== digestValue(sealedController)
    || currentLane.dirtDigest !== sealedLane.dirtDigest
    || currentLane.branch !== sealedLane.branch
    || currentLane.headSha !== sealedLane.headSha
    || currentLane.remoteHeadSha !== sealedLane.remoteHeadSha) {
    throw new Error("Protected controller or tracked source bytes changed before recovery effect.");
  }
  return Object.freeze({ controller: currentController, lane: currentLane });
}

export function assertScopeExpansionSuccessorRecoveryPullRequest({
  sealed, current, markerDigest, requireOriginalBody,
}) {
  for (const key of ["url", "number", "nodeId", "state", "isDraft", "autoMergeAbsent",
    "headRepository", "headRefName", "headRefOid", "baseRefName", "baseRefOid"]) {
    if (current[key] !== sealed[key]) {
      throw new Error(`Pull-request ${key} changed before recovery effect.`);
    }
  }
  if (current.markerDigest !== markerDigest
    || current.bodyWithoutMarkerDigest !== sealed.bodyWithoutMarkerDigest
    || requireOriginalBody && current.bodyDigest !== sealed.bodyDigest) {
    throw new Error("Pull-request body or writer marker changed before recovery effect.");
  }
  return current;
}

export function assertScopeExpansionRecoverySuccessorUnexpired(expiresAt, now = new Date()) {
  const expiry = Date.parse(expiresAt);
  const instant = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(expiry) || !Number.isFinite(instant) || expiry <= instant) {
    throw new Error("Recovery rejects an expired C2; authenticated same-claim recovery is required.");
  }
  return expiresAt;
}

export function assertScopeExpansionSuccessorRecoveryBoundTransition({
  sealed, current, entry, reviewRequestId, now = new Date(),
}) {
  const core = object(entry?.claimCore, "bound C2 ledger core");
  const stable = ["actorId", "deviceId", "sessionId", "repositoryId", "workItemId",
    "canonicalBaseRevision", "laneRevision", "writeSetDigest", "leaseEpoch",
    "heartbeatCounter", "predecessorClaimId", "expiresAt", "promotedAt"];
  const projected = ["actorId", "repositoryId", "workItemId", "canonicalBaseRevision",
    "laneRevision", "writeSetDigest", "leaseEpoch", "heartbeatCounter",
    "predecessorClaimId", "expiresAt"];
  if (entry.action !== "continue" || entry.claimId !== sealed.claimId
    || entry.claimDigest !== digestValue(core) || current.claimId !== sealed.claimId
    || current.fenceRevision !== entry.claimDigest || current.transitionDigest !== entry.digest
    || current.entrySchema !== entry.schema
    || current.claimIdentitySchema !== sealed.claimIdentitySchema
    || core.transitionCounter !== sealed.transitionCounter + 1
    || current.transitionCounter !== core.transitionCounter
    || core.reviewRequestId !== reviewRequestId || current.reviewRequestId !== reviewRequestId
    || core.state !== "current" || current.state !== "current"
    || current.writeAuthority !== true || current.scopeReserved !== true
    || stable.some(key => core[key] !== sealed.claimCore[key])
    || projected.some(key => current[key] !== core[key])
    || canonicalJson(normalizeWriteSet(core.declaredWriteScope))
      !== canonicalJson(normalizeWriteSet(sealed.claimCore.declaredWriteScope))
    || canonicalJson(normalizeWriteSet(current.declaredWriteScope))
      !== canonicalJson(normalizeWriteSet(core.declaredWriteScope))
    || current.integrationReceiptDigest !== null || current.integration !== null
    || current.operationReceiptDigest !== boundOperationReceiptDigest(entry)) {
    throw new Error("Bound C2 status does not match its exact owner-authenticated ledger transition.");
  }
  assertScopeExpansionRecoverySuccessorUnexpired(current.expiresAt, now);
  return current;
}

export function normalizeScopeExpansionSuccessorProjectionRecoveryEvidence(value) {
  object(value, "recovery evidence");
  const { evidenceDigest, ...input } = value;
  const rebuilt = buildScopeExpansionSuccessorProjectionRecoveryEvidence(input);
  if (evidenceDigest !== rebuilt.evidenceDigest || canonicalJson(value) !== canonicalJson(rebuilt)) {
    throw new Error("Scope-expansion successor recovery evidence drifted.");
  }
  return rebuilt;
}

function assertController(value) {
  for (const key of ["headSha", "originMainSha", "remoteMainSha", "treeSha"]) {
    sha(value[key], `controller ${key}`);
  }
  digest(value.implementationDigest, "controller implementation digest");
  text(value.origin, "controller origin");
  text(value.repository, "controller repository");
  if (repositoryFromOrigin(value.origin) !== value.repository
    || value.clean !== true || value.headSha !== value.originMainSha
    || value.headSha !== value.remoteMainSha) {
    throw new Error("Recovery requires one clean exact protected controller revision.");
  }
}

function assertCheckpoint({ controller, lane, lease, intent, plan, pullRequest }) {
  if (intent.schema !== "agentic-active-dirty-scope-expansion-intent/v1"
    || intent.status !== "source-retired"
    || intent.planDigest !== plan.planDigest
    || intent.targetReviewRequestId !== null || intent.completedReceiptDigest !== null
    || intent.promoted !== null || intent.promotedReceiptDigest !== null
    || intent.boundAuthority !== null || intent.boundReceiptDigest !== null
    || intent.localProjection !== null || intent.pullRequestProjection !== null
    || intent.localProjectionReceiptDigest !== null
    || intent.pullRequestProjectionReceiptDigest !== null
    || intent.finalReceiptDigest !== null) {
    throw new Error("Recovery applies only to one exact source-retired scope-expansion checkpoint.");
  }
  if (lease.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
    || lease.branch !== plan.sourceBranch || lease.fenceSha !== plan.sourceFenceSha
    || writerLeaseDigest(lease) !== plan.sourceLeaseDigest
    || lease.cloudAuthority?.claimId !== plan.sourceClaimId
    || lease.cloudAuthority?.claimDigest !== plan.sourceClaimDigest
    || lease.admission?.writeSetDigest !== plan.sourceWriteSetDigest
    || lease.admission?.manifestDigest !== plan.sourceManifestDigest) {
    throw new Error("Local C1 lease changed from the original scope-expansion plan.");
  }
  assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
  const changedPaths = paths(lane.changedPaths, "changed paths");
  if (lane.branch !== plan.sourceBranch || lane.headSha !== plan.sourceFenceSha
    || lane.remoteHeadSha !== plan.sourceFenceSha || lane.dirty !== true
    || lane.legacyDirtyDigest !== plan.sourceDirtyDigest
    || canonicalJson(changedPaths) !== canonicalJson(plan.sourceChangedPaths)
    || paths(lane.untrackedPaths ?? [], "untracked paths").length !== 0
    || !Array.isArray(lane.entries) || lane.entries.length !== changedPaths.length
    || lane.dirtDigest !== digestValue({
      statusDigest: lane.statusDigest,
      stagedPatchDigest: lane.stagedPatchDigest,
      unstagedPatchDigest: lane.unstagedPatchDigest,
      changedPaths,
      untrackedPaths: [],
      entries: lane.entries,
    })) {
    throw new Error("Tracked source dirt, content, or modes changed from the sealed checkpoint.");
  }
  const expectedMarker = projectWriterLeasePullRequestMarker(lease);
  if (pullRequest.number < 1 || pullRequest.state !== "OPEN" || pullRequest.isDraft !== true
    || pullRequest.autoMergeAbsent !== true || pullRequest.headRefName !== plan.sourceBranch
    || pullRequest.headRefOid !== plan.sourceFenceSha
    || pullRequest.url !== lease.pullRequestUrl
    || pullRequest.headRepository !== controller.repository
    || pullRequest.baseRefName !== "main" || pullRequest.baseRefOid !== controller.headSha
    || lease.cloudAuthority.reviewRequestId !== `github-pull-request:${pullRequest.nodeId}`
    || !/^[0-9a-f]{64}$/u.test(String(pullRequest.bodyDigest || ""))
    || !/^[0-9a-f]{64}$/u.test(String(pullRequest.bodyWithoutMarkerDigest || ""))
    || pullRequest.markerDigest !== digestValue(expectedMarker)
    || canonicalJson(pullRequest.marker) !== canonicalJson(expectedMarker)) {
    throw new Error("Pull-request identity, head, or C1 marker changed.");
  }
}

function assertRetiredSource({ sourceRetirement, lease, plan }) {
  if (sourceRetirement.claimId !== plan.sourceClaimId
    || sourceRetirement.state !== "retired"
    || sourceRetirement.priorClaimDigest !== lease.cloudAuthority.claimDigest
    || sourceRetirement.transitionCounter !== plan.sourceClaimTransitionCounter + 1
    || sourceRetirement.retirement?.reason !== "superseded"
    || sourceRetirement.retirement?.finalRevision !== plan.sourceFenceSha
    || sourceRetirement.retirement?.reviewRequestId !== plan.sourceReviewRequestId
    || sourceRetirement.deviceId !== pseudonymousIdentifier("device", lease.device)
    || sourceRetirement.sessionId !== pseudonymousIdentifier("session", lease.sessionId)) {
    throw new Error("Cloud C1 is not the exact retired predecessor.");
  }
  digest(sourceRetirement.transitionDigest, "C1 retirement transition digest");
  digest(sourceRetirement.claimDigest, "C1 retired claim digest");
  for (const key of ["bytesDigest", "namedChecksDigest", "handoffEvidenceDigest"]) {
    digest(sourceRetirement.retirement?.[key], `C1 retirement ${key}`);
  }
  if (sourceRetirement.retirement.integrationReceiptDigest !== null) {
    throw new Error("Superseded C1 retirement cannot carry integration authority.");
  }
}

function assertCurrentSuccessor({ successor, intent, lease, plan, sourceRetirement }) {
  const waiting = intent.waiting;
  if (!waiting || successor.claimId !== waiting.claimId
    || successor.claimId !== intent.targetClaimId
    || successor.state !== "current" || successor.writeAuthority !== true
    || successor.scopeReserved !== true
    || successor.predecessorClaimId !== plan.sourceClaimId
    || successor.canonicalBaseRevision !== plan.targetCanonicalBaseSha
    || successor.laneRevision !== plan.sourceFenceSha
    || successor.writeSetDigest !== plan.targetWriteSetDigest
    || canonicalJson(normalizeWriteSet(successor.declaredWriteScope))
      !== canonicalJson(plan.targetDeclaredWriteSet)
    || successor.leaseEpoch !== 1
    || successor.transitionCounter !== waiting.transitionCounter + 1
    || successor.waitingClaimDigest !== waiting.claimDigest
    || successor.waitingTransitionDigest !== waiting.claimLedgerRevision
    || successor.heartbeatCounter !== 0
    || successor.reviewRequestId !== null
    || successor.integrationReceiptDigest !== null || successor.integration !== null
    || successor.operationReceiptDigest == null) {
    throw new Error("Cloud C2 is not the unique unbound promoted successor.");
  }
  for (const key of ["claimId", "fenceRevision", "transitionDigest", "operationReceiptDigest"]) {
    digest(successor[key], `C2 ${key}`);
  }
  instant(successor.expiresAt, "C2 expiry");
  const core = successor.claimCore;
  if (!core || core.claimId !== successor.claimId || core.actorId !== successor.actorId
    || core.repositoryId !== successor.repositoryId || core.workItemId !== successor.workItemId
    || core.actorId !== sourceRetirement.actorId
    || core.repositoryId !== sourceRetirement.repositoryId
    || core.deviceId !== pseudonymousIdentifier("device", lease.device)
    || core.sessionId !== pseudonymousIdentifier("session", lease.sessionId)
    || core.workItemId !== pseudonymousIdentifier("work-item", lease.scope)
    || core.predecessorClaimId !== plan.sourceClaimId
    || core.transitionCounter !== successor.transitionCounter
    || core.canonicalBaseRevision !== successor.canonicalBaseRevision
    || core.laneRevision !== successor.laneRevision
    || canonicalJson(normalizeWriteSet(core.declaredWriteScope))
      !== canonicalJson(normalizeWriteSet(successor.declaredWriteScope))
    || core.writeSetDigest !== successor.writeSetDigest
    || core.leaseEpoch !== successor.leaseEpoch
    || core.state !== successor.state
    || core.expiresAt !== successor.expiresAt
    || core.heartbeatCounter !== successor.heartbeatCounter
    || core.reviewRequestId !== null || !Number.isFinite(Date.parse(core.promotedAt))) {
    throw new Error("C2 immutable cloud identity drifted from its ledger transition.");
  }
}

function assertCloudObservation({ cloud, sourceRetirement, successor }) {
  sha(cloud.observedLedgerRevision, "cloud observed ledger revision");
  if (!Number.isSafeInteger(cloud.observedLedgerSequence) || cloud.observedLedgerSequence < 4) {
    throw new Error("Cloud observation does not identify the validated ledger sequence.");
  }
  for (const key of ["observedLedgerDigest", "observedInventoryDigest", "sourceRetirementDigest",
    "successorDigest", "sourceLineageDigest", "successorLineageDigest",
    "validatedLedgerDigest"]) digest(cloud[key], `cloud ${key}`);
  if (cloud.sourceRetirementDigest !== digestValue(sourceRetirement)
    || cloud.successorDigest !== digestValue(successor)
    || cloud.successorCandidateCount !== 1
    || cloud.sourceLineageCount < 2 || cloud.successorLineageCount !== 2) {
    throw new Error("Cloud observation does not prove one exact C2 successor.");
  }
  const lineage = cloud.recoveryLineage;
  if (!Array.isArray(lineage) || lineage.length !== 4
    || lineage.some((entry, index) => index > 0
      && entry.sequence !== lineage[index - 1].sequence + 1)
    || lineage[0].claimId !== sourceRetirement.claimId
    || lineage[0].claimDigest !== sourceRetirement.priorClaimDigest
    || lineage[0].transitionCounter + 1 !== sourceRetirement.transitionCounter
    || lineage[1].claimId !== successor.claimId || lineage[1].action !== "claim"
    || lineage[1].transitionCounter !== 1
    || lineage[2].claimId !== sourceRetirement.claimId || lineage[2].action !== "retire"
    || lineage[2].claimDigest !== sourceRetirement.claimDigest
    || lineage[2].transitionDigest !== sourceRetirement.transitionDigest
    || lineage[3].claimId !== successor.claimId || lineage[3].action !== "continue"
    || lineage[3].claimDigest !== successor.fenceRevision
    || lineage[3].transitionDigest !== successor.transitionDigest
    || lineage[3].transitionCounter !== successor.transitionCounter) {
    throw new Error("Cloud recovery lineage is not the exact interleaved C1/C2 transition suffix.");
  }
}

function snapshot(value, label) {
  object(value, label);
  const serialized = JSON.stringify(value);
  if (serialized.length > 524_288) throw new Error(`${label} is too large.`);
  return JSON.parse(serialized);
}
function boundOperationReceiptDigest(entry) {
  const receipt = { schema: "agentic-collaboration-continuation-receipt/v1",
    operation: "continue", status: "current", repositoryId: entry.repositoryId,
    claimId: entry.claimId, claimDigest: entry.claimDigest, fenceRevision: entry.claimDigest,
    ledgerRevision: entry.digest, ledgerSequence: entry.sequence,
    idempotencyKey: entry.idempotencyKey, requestDigest: entry.requestDigest,
    evaluationTime: entry.evaluationTime };
  return digestValue(receipt);
}
function fileEntry(repository, git, relativePath) {
  const absolute = path.join(repository, relativePath);
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Tracked path ${relativePath} is not a regular file.`);
  const head = git(["ls-tree", "HEAD", "--", relativePath]).split(/\s+/u);
  const index = git(["ls-files", "--stage", "--", relativePath]).split(/\s+/u);
  return { path: relativePath, headMode: head[0], headObject: head[2],
    indexMode: index[0], indexObject: index[1], worktreeMode: (stat.mode & 0o7777).toString(8),
    size: stat.size, contentDigest: createHash("sha256").update(readFileSync(absolute)).digest("hex") };
}
function repositoryFromOrigin(value) { return /^(?:git@github\.com:|https:\/\/github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u.exec(String(value || ""))?.[1] || null; }
function splitNul(value) { return String(value || "").split("\0").filter(Boolean); }
function firstSha(value) { return sha(String(value || "").split(/\s+/u)[0], "remote SHA"); }
function paths(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  const normalized = [...new Set(value.map(item => text(item, label)))].sort();
  if (normalized.some(item => item.startsWith("/") || item.includes(".."))) {
    throw new Error(`${label} contains an unsafe path.`);
  }
  return normalized;
}
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`); return value; }
function text(value, label) { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`); return value; }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) throw new Error(`${label} must be a digest.`); return value; }
function sha(value, label) { if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) throw new Error(`${label} must be a SHA.`); return value; }
function instant(value, label) { if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an instant.`); return value; }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
