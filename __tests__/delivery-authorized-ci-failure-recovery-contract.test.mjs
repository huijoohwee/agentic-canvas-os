// Responsibility: Prove the exact authorized-CI-failure recovery contract and its rejection fences.
import assert from "node:assert/strict";
import test from "node:test";

import { digestValue, normalizeRootIntent, normalizeWriteSet }
  from "../scripts/cloud-collaboration-primitives.mjs";
import {
  advanceDeliveryAuthorizedCiFailureRecoveryIntent as advance,
  authorizeDeliveryAuthorizedCiFailureRecovery as authorize,
  buildDeliveryAuthorizedCiFailureRecoveryArchive as buildArchive,
  buildDeliveryAuthorizedCiFailureRecoveryCloudRequest as cloudRequest,
  buildDeliveryAuthorizedCiFailureRecoveryCompletion as buildCompletion,
  buildDeliveryAuthorizedCiFailureRecoveryPlan as buildPlan,
  createDeliveryAuthorizedCiFailureRecoveryIntent as createIntent,
  createDeliveryAuthorizedCiFailureRecoveryMarker as createMarker,
  normalizeDeliveryAuthorizedCiFailureRecoveryArchive as normalizeArchive,
  normalizeDeliveryAuthorizedCiFailureRecoveryIntent as normalizeIntent,
  parseDeliveryAuthorizedCiFailureRecoveryMarker as parseMarker,
  PHASES,
  projectDeliveryAuthorizedCiFailureTerminalLease as projectLease,
  upsertDeliveryAuthorizedCiFailureRecoveryMarker as upsertMarker,
} from "../scripts/delivery-authorized-ci-failure-recovery-contract.mjs";
import {
  buildDeliveryAuthorizedCiFailureRecoveryEvidence as buildEvidence,
} from "../scripts/delivery-authorized-ci-failure-recovery-evidence.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import { normalizeCurrentClaimInventory }
  from "../scripts/scoped-lane-cloud-reconciliation.mjs";
import { projectWriterLeasePullRequestMarker } from "../scripts/writer-lease-lib.mjs";

const h = (value, size = 64) => value.repeat(size);
const BASE = h("a", 40), CHECK_BASE = h("b", 40), PR_BASE = h("c", 40);
const MAIN = h("d", 40), CONTROLLER = h("e", 40), HEAD = h("f", 40), TREE = h("1", 40);
const REPOSITORY = { fullName: "org/repo", nodeId: "R_repo", databaseId: 1253998204 };
const ACTOR = { id: 8945812, nodeId: "U_owner", login: "owner", type: "User" };
const BRANCH = "agent/device.local/recovery-artifact-retirement";
const SESSION = "codex-recovery-artifact-retirement-20260813";
const DEVICE = "device.local", SCOPE = "recovery-artifact-retirement";
const PR_NODE = "PR_node_461", PR_URL = "https://github.com/org/repo/pull/461";
const REVIEW = `github-pull-request:${PR_NODE}`;
const WRITE_SET = normalizeWriteSet([
  "path:scripts/a.mjs", "path:__tests__/a.test.mjs", `semantic:${SCOPE}`,
]);
const WRITE_DIGEST = digestValue(WRITE_SET), F148 = h("2"), SOURCE_CLAIM = h("3");
const SOURCE_FENCE = h("4"), SOURCE_TRANSITION = h("5"), MANIFEST = h("6");
const CHECK_ID = 94329944401, RUN_ID = 31662386276, CHECK_SUITE = 81123;
const SOURCE_TIME = "2026-08-13T02:58:08.216Z", PROJECTED_AT = "2026-08-13T05:00:00.000Z";
const CLOUD_TIME = "2026-08-13T04:59:00.000Z", SUCCESSOR_EXPIRY = "2026-08-13T05:59:00.000Z";

function integrationEvidence() {
  return { candidateRevision: HEAD, reviewRequestId: REVIEW, focusedEvidenceDigest: h("7"),
    dependencyClosureDigest: h("8"), namedChecksDigest: h("9"),
    handoffEvidenceDigest: h("a"), operatorDecisionDigest: h("b"),
    integrationIntentDigest: h("c"), integratedAt: "2026-08-13T02:57:20.000Z" };
}
function admission() {
  return { schema: "agentic-lane-admission-lease/v1", status: "admitted",
    semanticScope: SCOPE, declaredWriteSet: WRITE_SET, writeSetDigest: WRITE_DIGEST,
    manifestDigest: MANIFEST, planReceiptDigest: h("d"), admissionReceiptDigest: h("e"),
    existingLaneStateDigest: h("f"), admittedReportDigest: h("0"),
    preservationReceiptDigest: h("1") };
}
function sourceAuthority() {
  return { schema: "agentic-lane-cloud-authority/v1", provider: "github",
    ledgerRepository: REPOSITORY.fullName, targetRepository: REPOSITORY.fullName,
    claimId: SOURCE_CLAIM, claimDigest: SOURCE_FENCE, ledgerRevision: h("2", 40),
    ledgerDigest: h("3"), claimLedgerRevision: SOURCE_TRANSITION,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: F148, mutationAuthorityEligible: true, canonicalBaseSha: BASE,
    laneRevision: HEAD, cloudDeclaredWriteScope: WRITE_SET, writeSetDigest: WRITE_DIGEST,
    deviceId: DEVICE, sessionId: SESSION, reviewRequestId: REVIEW, leaseEpoch: 1,
    transitionCounter: 5, state: "delivery_authorized",
    expiresAt: "2026-08-13T04:23:05.000Z", integrationReceiptDigest: F148,
    integration: integrationEvidence(), focusedEvidenceDigest: h("7"),
    manifestDigest: MANIFEST };
}
function sourceLease() {
  return { schema: "agentic-writer-lease/v2", status: "delivery", epoch: 242,
    sessionId: SESSION, device: DEVICE, scope: SCOPE, branch: BRANCH,
    worktreePath: "/workspace/recovery-artifact-retirement", baseSha: BASE,
    fenceSha: h("4", 40), pullRequestUrl: PR_URL, autoDelivery: true,
    runtimeRequired: true, admission: admission(), cloudAuthority: sourceAuthority(),
    acquiredAt: "2026-08-13T02:24:02.083Z", heartbeatAt: SOURCE_TIME,
    expiresAt: SOURCE_TIME, integration: { schema: "agentic-integration-commit/v1",
      commitSha: HEAD, treeSha: TREE,
      commitMessage: "feat(recovery-artifact-retirement): archive evidence safely",
      manifestDigest: h("4"), stagedDiffDigest: h("5"),
      paths: ["__tests__/a.test.mjs", "scripts/a.mjs"],
      recordedAt: "2026-08-13T02:53:48.945Z" }, deliveryHeadSha: HEAD };
}
function publicClaim() {
  return { claimId: SOURCE_CLAIM, entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2", state: "dormant-preserved",
    writeAuthority: false, scopeReserved: true, actorId: `github-user:${ACTOR.id}`,
    repositoryId: `github-repository:${REPOSITORY.nodeId}`,
    workItemId: pseudonymousIdentifier("work-item", SCOPE), canonicalBaseRevision: BASE,
    laneRevision: HEAD, declaredWriteScope: WRITE_SET, writeSetDigest: WRITE_DIGEST,
    leaseEpoch: 1, transitionCounter: 5, heartbeatCounter: 1, reviewRequestId: REVIEW,
    predecessorClaimId: null, expiresAt: "2026-08-13T04:23:05.000Z",
    fenceRevision: SOURCE_FENCE, transitionDigest: SOURCE_TRANSITION,
    operationReceiptDigest: F148, integrationReceiptDigest: F148,
    integration: integrationEvidence() };
}
function privateClaim() {
  const { transitionDigest, ...claim } = publicClaim();
  return { ...claim, recordedState: "integrated-preserved",
    deviceId: pseudonymousIdentifier("device", DEVICE),
    sessionId: pseudonymousIdentifier("session", SESSION), ledgerRevision: transitionDigest };
}
function inventoryClaim() {
  const claim = publicClaim();
  return { claimId: claim.claimId, entrySchema: claim.entrySchema,
    claimIdentitySchema: claim.claimIdentitySchema,
    operationReceiptDigest: claim.operationReceiptDigest, state: claim.state,
    actorId: claim.actorId, repositoryId: claim.repositoryId, workItemId: claim.workItemId,
    canonicalBaseRevision: claim.canonicalBaseRevision, laneRevision: claim.laneRevision,
    declaredWriteScope: claim.declaredWriteScope, writeSetDigest: claim.writeSetDigest,
    leaseEpoch: claim.leaseEpoch, transitionCounter: claim.transitionCounter,
    heartbeatCounter: claim.heartbeatCounter, reviewRequestId: claim.reviewRequestId,
    expiresAt: claim.expiresAt, fenceRevision: claim.fenceRevision,
    transitionDigest: claim.transitionDigest };
}
function currentInventory(authority) {
  const ledgerRevision = h("6", 40), ledgerDigest = h("7"), claims = [inventoryClaim()];
  const result = normalizeCurrentClaimInventory({ inventoryResult: {
    schema: "agentic-cloud-collaboration-result/v1", ok: true, action: "status",
    status: "ready", ledgerRevision, ledgerDigest, claims }, verificationResult: {
    ledgerRevision, claimDigest: SOURCE_FENCE, claim: { transitionDigest: SOURCE_TRANSITION },
    receipt: { ledgerDigest, evaluationTime: "2026-08-13T04:45:00.000Z" } }, authority });
  return { ...result, complete: true, totalCount: 1, pageCount: 1 };
}
function pull(lease) {
  return { number: 461, nodeId: PR_NODE, url: PR_URL, state: "OPEN", isDraft: false,
    merged: false, title: "feat(recovery-artifact-retirement): archive evidence safely",
    bodyDigest: h("8"), writerMarkerDigest: digestValue(projectWriterLeasePullRequestMarker(lease)),
    writerMarkerCount: 1, headBranch: BRANCH, headSha: HEAD, baseBranch: "main",
    baseSha: PR_BASE, author: ACTOR, headRepository: REPOSITORY, baseRepository: REPOSITORY,
    isInMergeQueue: false, mergeQueueEntry: null, autoMergeRequest: { mergeMethod: "SQUASH",
      commitHeadline: "feat(recovery-artifact-retirement): archive evidence safely",
      commitBody: null, enabledAt: "2026-08-13T02:58:07.000Z", enabledBy: ACTOR } };
}
function checkPull() {
  return { number: 461, headSha: HEAD, headRef: BRANCH, baseSha: CHECK_BASE, baseRef: "main" };
}
function failure() {
  const check = { id: CHECK_ID, checkSuiteId: CHECK_SUITE, name: "test", headSha: HEAD,
    status: "completed", conclusion: "failure", startedAt: "2026-08-13T02:58:33.000Z",
    completedAt: "2026-08-13T03:01:25.000Z",
    detailsUrl: `https://github.com/org/repo/actions/runs/${RUN_ID}/job/${CHECK_ID}`,
    externalIdDigest: h("9"), appId: 15368, appSlug: "github-actions",
    workflowRunId: RUN_ID, pullRequests: [checkPull()] };
  const item = { ...check, workflowRunAttempt: 1 };
  const inventoryCore = { complete: true, totalCount: 1, pageCount: 1, items: [item] };
  return { check, inventory: { ...inventoryCore, inventoryDigest: digestValue(inventoryCore) },
    run: { id: RUN_ID, workflowId: 1234, checkSuiteId: CHECK_SUITE,
      path: ".github/workflows/ci.yml", event: "pull_request", headBranch: BRANCH,
      headSha: HEAD, status: "completed", conclusion: "failure", attempt: 1,
      repository: REPOSITORY, pullRequests: [checkPull()] },
    job: { id: CHECK_ID, runId: RUN_ID, runAttempt: 1, name: "test", headSha: HEAD,
      status: "completed", conclusion: "failure" } };
}
function evidenceInput() {
  const authority = sourceAuthority(), lease = sourceLease(), inventory = currentInventory(authority);
  const publicRecord = publicClaim(), privateRecord = privateClaim(), rest = pull(lease);
  const protectionCore = { repository: REPOSITORY.fullName, branch: "main", strict: true,
    contexts: ["build", "test"], checks: [{ context: "build", appId: 15368 },
      { context: "test", appId: 15368 }] };
  return { repository: REPOSITORY, actor: ACTOR,
    controller: { revisionSha: CONTROLLER, observedMainSha: MAIN },
    source: { branch: BRANCH, headSha: HEAD, treeSha: TREE, remoteHeadSha: HEAD,
      worktreeIdentityDigest: h("a"), indexDigest: h("b"), clean: true },
    lease: { record: lease, leaseDigest: digestValue(lease) },
    authority: { record: authority, recordDigest: digestValue(authority) },
    cloud: { ledgerRevision: inventory.observedLedgerHeadRevision,
      ledgerDigest: inventory.ledgerDigest, inventoryDigest: inventory.inventoryDigest,
      publicClaim: { record: publicRecord, recordDigest: digestValue(publicRecord) },
      privateClaim: { record: privateRecord, recordDigest: digestValue(privateRecord) },
      inventory, overlappingReservedClaimIds: [] },
    provider: { rest, graphql: structuredClone(rest), failure: failure(),
      protection: { ...protectionCore, inventoryDigest: digestValue(protectionCore) } },
    protectedAdvance: { sourceBaseSha: BASE, checkAttemptBaseSha: CHECK_BASE,
      pullRequestBaseSha: PR_BASE, controllerRevisionSha: CONTROLLER, currentMainSha: MAIN,
      changedWriteScope: ["path:docs/disjoint.md"],
      changedWriteScopeDigest: digestValue(["path:docs/disjoint.md"]),
      sourceBaseAncestorOfCheckAttemptBase: true,
      checkAttemptBaseAncestorOfPullRequestBase: true,
      pullRequestBaseAncestorOfCurrentMain: true,
      controllerRevisionAncestorOfCurrentMain: true, disposition: "disjoint-preserved" } };
}
function fixture() {
  const evidence = buildEvidence(evidenceInput()), plan = buildPlan({ evidence, ttlSeconds: 3600 });
  let intent = createIntent(plan, plan.exactAuthorization);
  return { evidence, plan, intent };
}

function providerState(plan, draft, marker = null) {
  const source = plan.evidence.provider.rest;
  return { number: source.number, nodeId: source.nodeId, url: source.url, state: "OPEN",
    isDraft: draft, merged: false, title: source.title,
    bodyDigest: marker?.bodyDigest ?? source.bodyDigest,
    writerMarkerDigest: marker?.writerMarkerDigest ?? source.writerMarkerDigest,
    ...(marker ? { recoveryMarkerDigest: marker.recoveryMarkerDigest } : {}),
    headBranch: source.headBranch, headSha: source.headSha, baseBranch: source.baseBranch,
    baseSha: source.baseSha, authorDigest: digestValue(source.author),
    headRepositoryDigest: digestValue(source.headRepository),
    baseRepositoryDigest: digestValue(source.baseRepository), isInMergeQueue: false,
    mergeQueueEntry: null, autoMergeRequest: null };
}
function providerPhase(plan, intent, name, draft) {
  const before = name === "auto_merge_disabled" ? digestValue(plan.evidence.provider.rest)
    : intent.phases.auto_merge_disabled.values.providerAfterDigest;
  const after = providerState(plan, draft), request = digestValue({
    schema: "agentic-delivery-authorized-ci-failure-provider-request/v1", operation: name,
    planDigest: plan.planDigest, pullRequestNodeId: plan.pullRequestNodeId,
    expectedHeadSha: plan.sourceHeadSha, providerBeforeDigest: before });
  const receipt = { schema: "agentic-delivery-authorized-ci-failure-provider-receipt/v1",
    operation: name, clientMutationId: request, actorId: ACTOR.id, actorLogin: ACTOR.login,
    pullRequestNodeId: PR_NODE, headSha: HEAD, afterDigest: digestValue(after) };
  return { providerRequestDigest: request, providerBeforeDigest: before, providerAfter: after,
    providerAfterDigest: digestValue(after), providerReceipt: receipt,
    providerReceiptDigest: digestValue(receipt) };
}
function cloudPhase(plan, intent, name, state, transition, claimId, claimDigest) {
  const expectedLedger = name === "successor_waiting" ? plan.evidence.cloud.ledgerDigest
    : name === "predecessor_retired" ? intent.phases.successor_waiting.values.ledgerDigest
      : intent.phases.predecessor_retired.values.ledgerDigest;
  const request = cloudRequest(plan, name, intent.phases, expectedLedger,
    ["successor_waiting", "successor_active"].includes(name) ? SUCCESSOR_EXPIRY : null);
  const action = name === "successor_waiting"
    ? "claim" : name === "predecessor_retired" ? "retire" : "continue";
  const result = { claimId, claimDigest,
    claimLedgerRevision: h(String((transition + 2) % 10)), transitionCounter: transition,
    state, ledgerRevision: h(String((transition + 3) % 10), 40),
    ledgerDigest: h(String((transition + 2) % 10)) };
  const receipt = cloudReceipt(action, request, result, transition);
  return { cloudRequestDigest: digestValue(request), operationReceiptDigest: receipt.receiptDigest,
    ...result, cloudRequest: request, operationReceipt: receipt };
}
function cloudReceipt(action, request, result, ledgerSequence) {
  const intent = normalizeRootIntent(action, request, { actorId: request.actorId,
    deviceId: request.deviceId, sessionId: request.sessionId }, request.targetRepositoryId);
  const { expectedLedgerDigest: ignoredLedger, ...semanticIntent } = intent;
  const core = { schema: { claim: "agentic-collaboration-claim-receipt/v1",
      continue: "agentic-collaboration-continuation-receipt/v1",
      retire: "agentic-collaboration-retirement-receipt/v1" }[action],
    operation: action, status: action === "claim" ? "waiting-successor"
      : action === "retire" ? "retired" : "current", repositoryId: request.targetRepositoryId,
    claimId: result.claimId, claimDigest: result.claimDigest, fenceRevision: result.claimDigest,
    ledgerRevision: result.claimLedgerRevision, ledgerSequence,
    idempotencyKey: digestValue(request.idempotencyKey),
    requestDigest: digestValue({ action, intent: semanticIntent }),
    evaluationTime: CLOUD_TIME };
  return { ...core, receiptDigest: digestValue(core) };
}
function successorAuthority(plan, active, operationReceiptDigest) {
  return { schema: "agentic-lane-cloud-authority/v1", provider: "github",
    ledgerRepository: REPOSITORY.fullName, targetRepository: REPOSITORY.fullName,
    claimId: plan.expectedSuccessorClaimId, claimDigest: h("a"),
    ledgerRevision: h("b", 40), ledgerDigest: h("d"), claimLedgerRevision: h("d"),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest, mutationAuthorityEligible: true,
    canonicalBaseSha: BASE, laneRevision: HEAD, cloudDeclaredWriteScope: WRITE_SET,
    writeSetDigest: WRITE_DIGEST, deviceId: DEVICE, sessionId: SESSION,
    reviewRequestId: REVIEW, leaseEpoch: 2, transitionCounter: active.transitionCounter + 1,
    state: "active", expiresAt: SUCCESSOR_EXPIRY,
    integrationReceiptDigest: null, integration: null, manifestDigest: MANIFEST };
}
function runToCandidate(state = fixture()) {
  let { plan, intent } = state;
  intent = advance(intent, { status: "auto_merge_disabled",
    values: providerPhase(plan, intent, "auto_merge_disabled", false) });
  intent = advance(intent, { status: "pull_request_drafted",
    values: providerPhase(plan, intent, "pull_request_drafted", true) });
  const waiting = cloudPhase(plan, intent, "successor_waiting", "waiting-successor", 1,
    plan.expectedSuccessorClaimId, h("6"));
  intent = advance(intent, { status: "successor_waiting", values: waiting });
  const retired = cloudPhase(plan, intent, "predecessor_retired", "retired", 6,
    plan.sourceClaimId, h("7"));
  intent = advance(intent, { status: "predecessor_retired", values: retired });
  const active = cloudPhase(plan, intent, "successor_active", "active", 2,
    plan.expectedSuccessorClaimId, h("8"));
  intent = advance(intent, { status: "successor_active", values: active });
  const request = cloudRequest(plan, "successor_bound", intent.phases,
    intent.phases.successor_active.values.ledgerDigest, null), bound = {
    successorClaimId: active.claimId, successorClaimDigest: h("a"), claimLedgerRevision: h("d"),
    transitionCounter: active.transitionCounter + 1, ledgerRevision: h("b", 40),
    ledgerDigest: h("d") }, operationReceipt = cloudReceipt("continue", request, {
      claimId: active.claimId, claimDigest: bound.successorClaimDigest,
      claimLedgerRevision: bound.claimLedgerRevision, ledgerDigest: bound.ledgerDigest },
    bound.transitionCounter),
    authority = successorAuthority(plan, active, operationReceipt.receiptDigest);
  intent = advance(intent, { status: "successor_bound", values: {
    cloudRequestDigest: digestValue(request), operationReceiptDigest: operationReceipt.receiptDigest,
    ...bound, cloudRequest: request, operationReceipt,
    authority, authorityDigest: digestValue(authority) } });
  const markerTemplateDigest = digestValue({ schema:
    "agentic-delivery-authorized-ci-failure-marker-template/v1", planDigest: plan.planDigest,
    sourceClaimId: plan.sourceClaimId, successorClaimId: authority.claimId,
    successorAuthorityDigest: digestValue(authority), sourceHeadSha: HEAD,
    failureCheckRunId: CHECK_ID,
    sourceRetirementReceiptDigest: intent.phases.predecessor_retired.values.operationReceiptDigest });
  intent = advance(intent, { status: "projection_candidate", values: {
    successorAuthorityDigest: digestValue(authority), sourceLeaseDigest: plan.sourceLeaseDigest,
    providerBodyBeforeDigest: plan.evidence.provider.rest.bodyDigest, markerTemplateDigest } });
  return { ...state, plan, intent, authority };
}
function projectRegistry(state, { maximumPriorEpoch = 300, selectedEpoch = 301 } = {}) {
  const { plan, authority } = state, terminalLease = projectLease({ plan,
    sourceLease: plan.evidence.lease.record, successorAuthority: authority,
    localEpoch: selectedEpoch, projectedAt: PROJECTED_AT });
  const beforeRevision = 88, leaseDigest = digestValue(terminalLease), registryBefore = {
    schema: "agentic-writer-lease-registry/v1", revision: beforeRevision,
    leases: { [BRANCH]: plan.evidence.lease.record, "agent/other.local/other": {
      epoch: maximumPriorEpoch } } }, registryAfter = structuredClone(registryBefore);
  registryAfter.revision += 1; registryAfter.leases[BRANCH] = terminalLease;
  const beforeDigest = digestValue(registryBefore);
  const core = { schema: "agentic-delivery-authorized-ci-failure-registry-receipt/v1",
    branch: BRANCH, beforeRevision, afterRevision: beforeRevision + 1, beforeDigest,
    afterDigest: digestValue(registryAfter), maximumPriorEpoch, selectedEpoch,
    sourceLeaseDigest: plan.sourceLeaseDigest, terminalLeaseDigest: leaseDigest,
    registryBefore, registryAfter,
    mutationId: digestValue({ schema: "agentic-delivery-authorized-ci-failure-lease-cas/v1",
      planDigest: plan.planDigest, branch: BRANCH, sourceLeaseDigest: plan.sourceLeaseDigest,
      beforeRevision, beforeDigest, terminalLeaseDigest: leaseDigest }) };
  return { terminalLease, leaseDigest, registryReceipt: { ...core, receiptDigest: digestValue(core) } };
}
function runLifecycle() {
  let state = runToCandidate(), { plan, intent } = state;
  const projected = projectRegistry(state);
  intent = advance(intent, { status: "lease_projected", values: projected });
  const leaseParent = intent;
  const writerMarker = projectWriterLeasePullRequestMarker(projected.terminalLease);
  const recoveryMarker = createMarker({ plan, intent, terminalLease: projected.terminalLease });
  const bodyDigest = digestValue({ schema:
    "agentic-delivery-authorized-ci-failure-body-projection/v1",
    humanBodyDigest: plan.evidence.provider.rest.bodyDigest,
    writerMarkerDigest: digestValue(writerMarker), recoveryMarkerDigest: recoveryMarker.markerDigest });
  const after = providerState(plan, true, { bodyDigest,
    writerMarkerDigest: digestValue(writerMarker), recoveryMarkerDigest: recoveryMarker.markerDigest });
  const request = digestValue({ schema: "agentic-delivery-authorized-ci-failure-marker-request/v1",
    planDigest: plan.planDigest, pullRequestNodeId: PR_NODE, expectedHeadSha: HEAD,
    providerBeforeDigest: intent.phases.pull_request_drafted.values.providerAfterDigest,
    terminalLeaseDigest: projected.leaseDigest, bodyProjectionDigest: bodyDigest,
    writerMarkerDigest: digestValue(writerMarker), recoveryMarkerDigest: recoveryMarker.markerDigest });
  const receipt = { schema: "agentic-delivery-authorized-ci-failure-provider-receipt/v1",
    operation: "markers_projected", clientMutationId: request, actorId: ACTOR.id,
    actorLogin: ACTOR.login, pullRequestNodeId: PR_NODE, headSha: HEAD,
    afterDigest: digestValue(after) };
  const markers = { providerRequestDigest: request,
    providerBeforeDigest: intent.phases.pull_request_drafted.values.providerAfterDigest,
    providerAfter: after, providerAfterDigest: digestValue(after), writerMarker,
    writerMarkerDigest: digestValue(writerMarker), recoveryMarker,
    recoveryMarkerDigest: recoveryMarker.markerDigest, providerReceipt: receipt,
    providerReceiptDigest: digestValue(receipt) };
  intent = advance(intent, { status: "markers_projected", values: markers });
  const verifiedParent = intent, verificationCore = { successorClaimId: state.authority.claimId,
    successorClaimDigest: state.authority.claimDigest, leaseDigest: projected.leaseDigest,
    pullRequestDigest: markers.providerAfterDigest, writerMarkerDigest: markers.writerMarkerDigest,
    recoveryMarkerDigest: markers.recoveryMarkerDigest,
    sourceInvariantDigest: digestValue(plan.evidence.source), source: plan.evidence.source };
  const verified = { ...verificationCore, verificationDigest: digestValue({ schema:
    "agentic-delivery-authorized-ci-failure-terminal-verification/v1",
    planDigest: plan.planDigest, ...verificationCore }) };
  intent = advance(intent, { status: "verified", values: verified });
  const completion = buildCompletion(plan, verified);
  intent = advance(intent, { status: "complete", values: { completion } });
  return { ...state, plan, intent, projected, markers, verified, completion,
    leaseParent, verifiedParent };
}

test("normalizes exact evidence and completes every sealed phase in lease-before-marker order", () => {
  const state = runLifecycle();
  assert.deepEqual(PHASES, ["prepared", "auto_merge_disabled", "pull_request_drafted",
    "successor_waiting", "predecessor_retired", "successor_active", "successor_bound",
    "projection_candidate", "lease_projected", "markers_projected", "verified", "complete"]);
  assert.equal(authorize({ plan: state.plan, authorization: state.plan.exactAuthorization })
    .planDigest, state.plan.planDigest);
  assert.equal(state.intent.status, "complete");
  assert.deepEqual(Object.keys(state.projected.terminalLease).sort(), ["schema", "status", "epoch",
    "sessionId", "device", "scope", "branch", "worktreePath", "baseSha", "fenceSha",
    "pullRequestUrl", "autoDelivery", "runtimeRequired", "admission", "cloudAuthority",
    "acquiredAt", "heartbeatAt", "expiresAt"].sort());
  assert.equal(state.projected.terminalLease.status, "active");
  assert.equal(Object.hasOwn(state.projected.terminalLease, "taskAuthority"), false);
  assert.equal(Object.hasOwn(state.projected.terminalLease, "integration"), false);
  const archived = buildArchive({ intent: state.intent, archivedAt: "2026-08-13T05:01:00.000Z" });
  assert.deepEqual(normalizeArchive(archived), archived);
  assert.deepEqual(normalizeIntent(state.intent), state.intent);
});

test("binds the deterministic f148 integrated-retirement request", () => {
  const { plan, intent } = runToCandidate();
  const request = cloudRequest(plan, "predecessor_retired", intent.phases,
    intent.phases.successor_waiting.values.ledgerDigest, null);
  assert.equal(request.claimId, SOURCE_CLAIM);
  assert.equal(request.reason, "integrated");
  assert.equal(request.finalRevision, HEAD);
  assert.equal(request.reviewRequestId, REVIEW);
  assert.equal(request.integrationReceiptDigest, F148);
  assert.equal(request.namedChecksDigest, integrationEvidence().namedChecksDigest);
  assert.equal(request.handoffEvidenceDigest, integrationEvidence().handoffEvidenceDigest);
});

test("rejects overlap, wrong inventory target, nonlatest CI, and provider authority drift", () => {
  const overlap = evidenceInput(); overlap.cloud.overlappingReservedClaimIds = [h("f")];
  assert.throws(() => buildEvidence(overlap));
  const target = structuredClone(evidenceInput()); target.cloud.inventory.claims[0].claimId = h("e");
  assert.throws(() => buildEvidence(target));
  const rerun = structuredClone(evidenceInput()), old = rerun.provider.failure.inventory;
  const newer = { ...structuredClone(old.items[0]), id: CHECK_ID + 1,
    detailsUrl: `https://github.com/org/repo/actions/runs/${RUN_ID + 1}/job/${CHECK_ID + 1}`,
    workflowRunId: RUN_ID + 1 };
  old.items.push(newer); old.totalCount = 2;
  old.inventoryDigest = digestValue({ complete: true, totalCount: 2, pageCount: 1,
    items: old.items });
  assert.throws(() => buildEvidence(rerun));
  const actorDrift = structuredClone(evidenceInput());
  for (const side of [actorDrift.provider.rest, actorDrift.provider.graphql]) {
    side.author.id += 1; side.autoMergeRequest.enabledBy.id += 1;
  }
  assert.throws(() => buildEvidence(actorDrift));
  const queue = structuredClone(evidenceInput());
  queue.provider.rest.isInMergeQueue = true; queue.provider.graphql.isInMergeQueue = true;
  assert.throws(() => buildEvidence(queue));
});

test("rejects wrong retirement request/receipt and arbitrary successor authority fields", () => {
  let { plan, intent } = fixture();
  intent = advance(intent, { status: "auto_merge_disabled",
    values: providerPhase(plan, intent, "auto_merge_disabled", false) });
  intent = advance(intent, { status: "pull_request_drafted",
    values: providerPhase(plan, intent, "pull_request_drafted", true) });
  intent = advance(intent, { status: "successor_waiting", values:
    cloudPhase(plan, intent, "successor_waiting", "waiting-successor", 1,
      plan.expectedSuccessorClaimId, h("6")) });
  const wrongRequest = cloudPhase(plan, intent, "predecessor_retired", "retired", 6,
    plan.sourceClaimId, h("7")); wrongRequest.cloudRequestDigest = h("f");
  assert.throws(() => advance(intent, { status: "predecessor_retired", values: wrongRequest }));
  const wrongReceipt = structuredClone(cloudPhase(plan, intent, "predecessor_retired", "retired", 6,
    plan.sourceClaimId, h("7")));
  wrongReceipt.operationReceipt.requestDigest = h("f");
  const { receiptDigest: ignoredReceipt, ...wrongReceiptCore } = wrongReceipt.operationReceipt;
  wrongReceipt.operationReceipt.receiptDigest = digestValue(wrongReceiptCore);
  wrongReceipt.operationReceiptDigest = wrongReceipt.operationReceipt.receiptDigest;
  assert.throws(() => advance(intent, { status: "predecessor_retired", values: wrongReceipt }));
  const state = runToCandidate(), authority = { ...state.authority, injected: true };
  assert.throws(() => projectLease({ plan: state.plan,
    sourceLease: state.plan.evidence.lease.record, successorAuthority: authority,
    localEpoch: 301, projectedAt: PROJECTED_AT }));
});

test("rejects registry max-epoch mismatch, stale projection, source mutation, and wrong marker body", () => {
  const state = runToCandidate();
  const epochMismatch = projectRegistry(state, { maximumPriorEpoch: 300, selectedEpoch: 302 });
  assert.throws(() => advance(state.intent, { status: "lease_projected", values: epochMismatch }));
  assert.throws(() => projectLease({ plan: state.plan,
    sourceLease: state.plan.evidence.lease.record, successorAuthority: state.authority,
    localEpoch: 301, projectedAt: SOURCE_TIME }));
  const complete = runLifecycle(), badSource = structuredClone(complete.verified);
  badSource.source.indexDigest = h("f"); badSource.sourceInvariantDigest = digestValue(badSource.source);
  const { verificationDigest: ignoredVerification, ...badCore } = badSource;
  badSource.verificationDigest = digestValue({ schema:
    "agentic-delivery-authorized-ci-failure-terminal-verification/v1",
    planDigest: complete.plan.planDigest, ...badCore });
  assert.throws(() => advance(complete.verifiedParent, { status: "verified", values: badSource }));
  assert.equal(parseMarker("human-only body"), null);
  const duplicated = `${upsertMarker("body", complete.markers.recoveryMarker)}\n${upsertMarker("", complete.markers.recoveryMarker)}`;
  assert.throws(() => parseMarker(duplicated));
  const wrongBody = complete.leaseParent, markerValues = structuredClone(complete.markers);
  markerValues.providerAfter.bodyDigest = h("f");
  markerValues.providerAfterDigest = digestValue(markerValues.providerAfter);
  assert.throws(() => advance(wrongBody, { status: "markers_projected", values: markerValues }));
});

test("rejects phase skipping and altered replay while preserving exact replay", () => {
  const { plan, intent } = fixture();
  assert.throws(() => advance(intent, { status: "pull_request_drafted", values: {} }));
  const values = providerPhase(plan, intent, "auto_merge_disabled", false);
  const next = advance(intent, { status: "auto_merge_disabled", values });
  assert.equal(advance(next, { status: "auto_merge_disabled", values }).intentDigest,
    next.intentDigest);
  const altered = structuredClone(values); altered.providerReceiptDigest = h("f");
  assert.throws(() => advance(next, { status: "auto_merge_disabled", values: altered }));
});
