// Responsibility: verify exact admission authorization, nested argv binding, monotonic intent, receipt integrity, and schemas.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  DORMANT_PRESERVATION_ADMISSION_PLAN_SCHEMA,
  DORMANT_PRESERVATION_ADMISSION_PHASES,
  advanceDormantPreservationAdmissionIntent,
  assertDormantPreservationAdmissionPreProvision,
  authorizeDormantPreservationAdmission,
  buildDormantPreservationAdmissionPlan,
  buildDormantPreservationAdmissionReceipt,
  createDormantPreservationAdmissionIntent,
  dormantPreservationAdmissionOperationKey,
  materializeDormantPreservationDeviceStartArgv,
  normalizeDormantPreservationAdmissionIntent,
  normalizeDormantPreservationAdmissionPlan,
  normalizeDormantPreservationAdmissionReceipt,
} from "../scripts/dormant-preservation-decision-contract.mjs";
import {
  buildDormantPreservationAdmissionExecutionEvidence,
} from "../scripts/dormant-preservation-decision-evidence.mjs";
import {
  markOperationDerivedCloudVerification, verifyDormantPreservation,
} from "../scripts/scoped-lane-authority-state.mjs";

const digest = label => digestValue({ label });
const sha = label => digest(label).slice(0, 40);
const TARGET_PATH = "/workspace/worktrees/candidate";

test("plan deterministically binds source evidence and one materialized device:start argv", () => {
  const plan = planFixture();
  assert.deepEqual(normalizeDormantPreservationAdmissionPlan(plan), plan);
  assert.equal(plan.schema, DORMANT_PRESERVATION_ADMISSION_PLAN_SCHEMA);
  assert.equal(
    plan.sourceEvidence.cloudDecision.schema,
    "agentic-dormant-preservation-admission-cloud-decision/v2",
  );
  assert.equal(Object.hasOwn(plan.sourceEvidence, "cloudInventory"), false);
  assert.deepEqual(materializeDormantPreservationDeviceStartArgv(plan), plan.deviceStartArgv);
  assert.deepEqual(DORMANT_PRESERVATION_ADMISSION_PHASES, ["admitted", "complete"]);
  assert.equal(
    plan.exactAuthorization,
    `authorize dormant-preservation-admission ${plan.planDigest}`,
  );
  assert.equal(
    plan.deviceStartArgv.filter(item => item === `--operator-decision-digest=${plan.planDigest}`).length,
    1,
  );
  assert.equal(
    plan.deviceStartArgv.filter(item => item === `--dormant-preservation-authorization=${plan.exactAuthorization}`).length,
    1,
  );

  const malicious = structuredClone(plan);
  malicious.nestedDeviceStart.argvTemplate.push(`--operator-decision-digest=${digest("other")}`);
  resealPlan(malicious);
  assert.throws(() => normalizeDormantPreservationAdmissionPlan(malicious), /one exact/);
  const foreignController = structuredClone(plan);
  foreignController.nestedDeviceStart.argvTemplate[0] = "/workspace/other/scripts/device-branch.mjs";
  resealPlan(foreignController);
  assert.throws(() => normalizeDormantPreservationAdmissionPlan(foreignController), /script subject drifted/);
});

test("authorization is byte-exact and receipt-bound to the plan and nested argv", () => {
  const plan = planFixture();
  const authorization = authorizeDormantPreservationAdmission(plan, plan.exactAuthorization);
  assert.equal(authorization.operatorDecisionDigest, plan.planDigest);
  assert.equal(authorization.deviceStartArgvDigest, plan.deviceStartArgvDigest);
  assert.throws(() => createDormantPreservationAdmissionIntent(
    plan, { ...authorization, ignored: true },
  ), /unexpected or missing fields/);
  for (const changed of [
    ` ${plan.exactAuthorization}`,
    `${plan.exactAuthorization} `,
    `${plan.exactAuthorization}\n`,
    plan.exactAuthorization.toUpperCase(),
  ]) {
    assert.throws(() => authorizeDormantPreservationAdmission(plan, changed), /exact authorization/);
  }
});

test("pre-provision check rejects source or nested argv drift", () => {
  const plan = planFixture();
  assert.equal(
    assertDormantPreservationAdmissionPreProvision(
      plan, plan.sourceEvidence, plan.deviceStartArgv,
    ).plan.planDigest,
    plan.planDigest,
  );
  const changedSource = structuredClone(plan.sourceEvidence);
  changedSource.controller.treeSha = sha("changed tree");
  resealSourceEvidence(changedSource);
  assert.throws(() => assertDormantPreservationAdmissionPreProvision(
    plan, changedSource, plan.deviceStartArgv,
  ), /source evidence drifted/);
  assert.throws(() => assertDormantPreservationAdmissionPreProvision(
    plan, plan.sourceEvidence, [...plan.deviceStartArgv, "--json"],
  ), /argv drifted/);
});

test("intent advances authorized to admitted to complete with exact replay only", () => {
  const fixture = admittedFixture();
  const replay = advanceDormantPreservationAdmissionIntent(
    fixture.admitted, "admitted", fixture.execution,
  );
  assert.equal(replay.intentDigest, fixture.admitted.intentDigest);
  assert.throws(() => advanceDormantPreservationAdmissionIntent(
    fixture.authorized, "complete", { schema: "not-a-receipt" },
  ));
  const changedExecution = structuredClone(fixture.execution);
  changedExecution.admissionReportDigest = digest("changed report");
  const { evidenceDigest: ignored, ...executionCore } = changedExecution;
  changedExecution.evidenceDigest = digestValue(executionCore);
  assert.throws(() => advanceDormantPreservationAdmissionIntent(
    fixture.admitted, "admitted", changedExecution,
  ), /replay drifted/);

  const receipt = buildDormantPreservationAdmissionReceipt(fixture.admitted);
  assert.throws(() => normalizeDormantPreservationAdmissionReceipt(
    { ...receipt, ignored: true },
  ), /unexpected or missing fields/);
  const complete = advanceDormantPreservationAdmissionIntent(
    fixture.admitted, "complete", receipt,
  );
  assert.deepEqual(normalizeDormantPreservationAdmissionIntent(complete), complete);
  assert.equal(
    advanceDormantPreservationAdmissionIntent(complete, "complete", receipt).intentDigest,
    complete.intentDigest,
  );
});

test("recomputed receipt and journal hashes cannot conceal changed admission evidence", () => {
  const fixture = admittedFixture();
  const receipt = buildDormantPreservationAdmissionReceipt(fixture.admitted);
  const complete = advanceDormantPreservationAdmissionIntent(fixture.admitted, "complete", receipt);
  const tampered = structuredClone(complete);
  tampered.phases.complete.values.receipt.finalClaimId = digest("forged claim");
  resealReceipt(tampered.phases.complete.values.receipt);
  resealIntent(tampered);
  assert.throws(
    () => normalizeDormantPreservationAdmissionIntent(tampered),
    /changed its admitted intent/,
  );
});

test("plan and receipt JSON schemas declare exact top-level artifacts and reject extras", () => {
  const fixture = admittedFixture();
  const receipt = buildDormantPreservationAdmissionReceipt(fixture.admitted);
  const planSchema = JSON.parse(readFileSync(
    new URL("../docs/schemas/dormant-preservation-decision-plan.v2.schema.json", import.meta.url),
    "utf8",
  ));
  const receiptSchema = JSON.parse(readFileSync(
    new URL("../docs/schemas/dormant-preservation-decision-receipt.v1.schema.json", import.meta.url),
    "utf8",
  ));
  assert.equal(validatesTopLevel(planSchema, fixture.plan), true);
  assert.equal(validatesTopLevel(receiptSchema, receipt), true);
  assert.equal(validatesTopLevel(planSchema, { ...fixture.plan, ignored: true }), false);
  assert.equal(validatesTopLevel(receiptSchema, { ...receipt, ignored: true }), false);
});

function admittedFixture() {
  const plan = planFixture();
  const authorization = authorizeDormantPreservationAdmission(plan, plan.exactAuthorization);
  const authorized = createDormantPreservationAdmissionIntent(plan, authorization);
  const execution = executionFixture(plan);
  const admitted = advanceDormantPreservationAdmissionIntent(authorized, "admitted", execution);
  return { plan, authorization, authorized, execution, admitted };
}

function planFixture() {
  return buildDormantPreservationAdmissionPlan({
    sourceEvidence: sourceEvidenceFixture(),
    nestedDeviceStart: {
      schema: "agentic-dormant-preservation-device-start-invocation/v1",
      executable: process.execPath,
      cwd: "/workspace/repository",
      argvTemplate: [
        "/workspace/controller/scripts/device-branch.mjs", "start", "new-scope",
        "--provision", "--repository=/workspace/repository",
        "--operator-decision-digest={planDigest}",
        "--dormant-preservation-authorization={authorization}",
      ],
      derivedBindings: {
        operatorDecisionDigest: "planDigest", authorization: "exactAuthorization",
      },
    },
  });
}

function sourceEvidenceFixture() {
  const declaredWriteScope = ["path:docs/new-scope", "semantic:new-scope"];
  const claimCore = {
    claimId: digest("candidate claim"), state: "active",
    entrySchema: "agentic-cloud-collaboration-entry/v1",
    claimIdentitySchema: "agentic-cloud-collaboration-claim-identity/v1",
    actorId: "github-user:42", repositoryId: "github-repository:R_repo",
    workItemId: "work-item:new-scope", canonicalBaseRevision: sha("canonical"),
    laneRevision: sha("canonical"), declaredWriteScope,
    writeSetDigest: digestValue(declaredWriteScope), leaseEpoch: 1,
    transitionCounter: 1, heartbeatCounter: 0, reviewRequestId: null,
    expiresAt: "2099-08-10T00:00:00.000Z",
    fenceRevision: digest("initial claim fence"),
    transitionDigest: digest("initial claim transition"),
  };
  const candidateClaim = { ...claimCore, recordDigest: digestValue(claimCore) };
  const cloudDecisionCore = {
    schema: "agentic-dormant-preservation-admission-cloud-decision/v2",
    candidateClaimId: candidateClaim.claimId,
    candidateWriteSetDigest: candidateClaim.writeSetDigest,
    selectedClaimIds: [], claims: [candidateClaim],
  };
  const worktree = {
    path: "/workspace/worktrees/legacy", branch: "refs/heads/agent/old/old-scope",
    headSha: sha("legacy head"), treeSha: sha("legacy tree"),
    detached: false, dirty: true, indexDigest: digest("legacy index"),
    workingTreeDigest: digest("legacy working"), stateDigest: digest("legacy state"),
    projectedClaimId: null,
  };
  const selectedCore = {
    path: worktree.path, stateDigest: worktree.stateDigest, worktree, pullRequest: null,
  };
  const selectedLane = { ...selectedCore, selectionDigest: digestValue(selectedCore) };
  const selectionDigest = digestValue({
    schema: "agentic-dormant-preservation-admission-selection/v1",
    lanes: [{
      path: selectedLane.path, stateDigest: selectedLane.stateDigest,
      pullRequestNumber: null, selectionDigest: selectedLane.selectionDigest,
    }],
  });
  const core = {
    schema: "agentic-dormant-preservation-admission-source-evidence/v2",
    controller: {
      path: "/workspace/controller", origin: "git@github.com:owner/controller.git",
      headSha: sha("controller"), originMainSha: sha("controller"),
      remoteMainSha: sha("controller"), treeSha: sha("controller tree"), clean: true,
      deviceBranchScriptDigest: digest("device script"),
    },
    canonical: {
      repositoryPath: "/workspace/repository", canonicalPath: "/workspace/repository",
      origin: "git@github.com:owner/repository.git", targetRepository: "owner/repository",
      headSha: sha("canonical"), originMainSha: sha("canonical"),
      remoteMainSha: sha("canonical"), treeSha: sha("canonical tree"),
      clean: true, canonicalSourceDisposition: "exact",
      canonicalLaneStateDigest: digest("canonical state"), registryDigest: digest("registry"),
      laneSetDigest: digestValue([
        { path: "/workspace/repository", stateDigest: digest("canonical state") },
        { path: worktree.path, stateDigest: worktree.stateDigest },
      ]), existingLanes: [
        { path: "/workspace/repository", stateDigest: digest("canonical state") },
        { path: worktree.path, stateDigest: worktree.stateDigest },
      ],
    },
    candidate: {
      semanticScope: "new-scope", deviceId: "device", branch: "agent/device/new-scope",
      sessionId: "decision-session", targetPath: TARGET_PATH,
      targetObservationDigest: digest("target observation"), ttlSeconds: 3600,
      selectionPath: "/workspace/selection.json", selectionFileDigest: digest("selection file"),
      manifestPath: "/workspace/manifest.json", manifestFileDigest: digest("manifest file"),
      manifest: {
        semanticScope: "new-scope", writeSetDigest: candidateClaim.writeSetDigest,
      },
      cloudAuthorityPath: "/workspace/cloud-authority.json",
      cloudAuthorityFileDigest: digest("authority file"),
      cloudAuthority: { claimId: candidateClaim.claimId, sessionId: "decision-session" },
      candidateClaim, candidateClaimRecordDigest: candidateClaim.recordDigest,
    },
    cloudDecision: {
      ...cloudDecisionCore, decisionStateDigest: digestValue(cloudDecisionCore),
    },
    preservation: {
      authenticatedActor: { actorId: "github-user:42", login: "owner" },
      repository: {
        id: "R_repo", nameWithOwner: "owner/repository", ownerLogin: "owner",
        path: "/workspace/repository",
      },
      sessionId: "decision-session",
      selectedLanes: [selectedLane],
      selectionDigest, projectionDigest: digest("preservation projection"),
    },
  };
  return Object.freeze({ ...core, sourceEvidenceDigest: digestValue(core) });
}

function executionFixture(plan) {
  const source = plan.sourceEvidence, claimId = source.candidate.candidateClaim.claimId;
  const declaredWriteScope = source.candidate.candidateClaim.declaredWriteScope;
  const { recordDigest: ignoredRecordDigest, ...sourceClaimCore } =
    source.candidate.candidateClaim;
  const postClaimCore = {
    ...sourceClaimCore, claimId, state: "active", declaredWriteScope,
    laneRevision: sha("post lane"), transitionCounter: 2,
    fenceRevision: digest("claim fence"), transitionDigest: digest("claim transition"),
  };
  const postClaim = { ...postClaimCore, recordDigest: digestValue(postClaimCore) };
  const cloudInventoryCore = {
    schema: "agentic-cloud-claim-inventory/v1",
    observedLedgerHeadRevision: sha("post ledger"),
    ledgerDigest: digest("post ledger"),
    evaluationTime: "2026-08-10T00:00:00.000Z", claims: [postClaim],
  };
  const cloudInventory = {
    ...cloudInventoryCore, inventoryDigest: digestValue(cloudInventoryCore),
  };
  const postCloudInventory = markOperationDerivedCloudVerification(Object.freeze({
    schema: "agentic-lane-cloud-verification/v1", status: "ready",
    ledgerRepository: "owner/ledger", targetRepository: "owner/repository",
    ledgerRevision: cloudInventory.observedLedgerHeadRevision,
    ledgerDigest: cloudInventory.ledgerDigest,
    verifiedAt: cloudInventory.evaluationTime,
    remoteClaimInventoryDigest: cloudInventory.inventoryDigest,
    inventory: cloudInventory, receiptDigest: digest("cloud verification receipt"),
  }));
  const dormant = source.preservation.selectedLanes[0].worktree;
  const dormantLane = { path: dormant.path, head: dormant.headSha, treeSha: dormant.treeSha,
    branch: dormant.branch, detached: dormant.detached, dirty: dormant.dirty,
    invalid: false, leaseAmbiguous: false, indexDigest: dormant.indexDigest,
    workingTreeDigest: dormant.workingTreeDigest, stateDigest: dormant.stateDigest, lease: null };
  const dormantPreservationReceipt = verifyDormantPreservation({
    repository: source.canonical.repositoryPath, targetRepository: source.canonical.targetRepository,
    lanes: [dormantLane], worktreePaths: [dormant.path], operatorDecisionDigest: plan.planDigest,
    sessionId: source.candidate.sessionId, remoteAuthorityVerification: postCloudInventory,
    ghJson: githubJson, verifiedAt: "2026-08-10T00:00:00.000Z",
  });
  const candidateHead = sha("candidate head"), candidateState = digest("candidate state");
  const laneProjections = [...source.canonical.existingLanes,
    { path: TARGET_PATH, stateDigest: candidateState }].sort((a, b) => a.path.localeCompare(b.path));
  const executionInput = {
    plan,
    operationKey: dormantPreservationAdmissionOperationKey(plan.planDigest, "admitted"),
    dormantPreservationReceipt, postCloudInventory,
    postLaneState: { canonicalBaseSha: source.canonical.headSha,
      canonicalSourceDisposition: "exact", laneStateDigest: digestValue(laneProjections),
      lanes: [...source.canonical.existingLanes.map(lane => ({ ...lane })), {
        path: TARGET_PATH, stateDigest: candidateState, head: candidateHead,
        treeSha: source.canonical.treeSha, branch: "refs/heads/agent/device/new-scope",
        dirty: false, invalid: false,
      }] },
    admissionReportDigest: digest("admission report"), admissionReceiptDigest: digest("admission receipt"),
    preservationReceiptDigest: digest("preservation receipt"),
    candidate: {
      path: TARGET_PATH, branch: "agent/device/new-scope", headSha: candidateHead,
      treeSha: source.canonical.treeSha, parentSha: source.canonical.headSha,
      parentCount: 1, stateDigest: candidateState,
      leaseDigest: digest("candidate lease"), leaseEpoch: 1, sessionId: "decision-session",
      pullRequestNumber: 101, pullRequestNodeId: "PR_101",
      pullRequestUrl: "https://github.com/owner/repository/pull/101",
      pullRequestHeadSha: candidateHead,
    },
  };
  executionInput.mutationAuthorityReceipt = mutationAuthorityReceipt(executionInput);
  return buildDormantPreservationAdmissionExecutionEvidence(executionInput);
}

function mutationAuthorityReceipt(input) {
  const claim = input.postCloudInventory.inventory.claims.find(item => item.claimId
    === input.plan.sourceEvidence.candidate.candidateClaim.claimId);
  const core = {
    schema: "agentic-admission-mutation-authority/v1", status: "ready",
    claimId: claim.claimId, claimDigest: claim.fenceRevision,
    ledgerRevision: input.postCloudInventory.ledgerRevision,
    localLeaseEpoch: input.candidate.leaseEpoch, localFenceSha: input.candidate.headSha,
    remoteLeaseEpoch: claim.leaseEpoch,
    cloudVerificationReceiptDigest: digest("cloud observation"),
    evaluatedAt: "2026-08-10T00:00:00.000Z", expiresAt: "2099-08-10T00:00:00.000Z",
  };
  return { ...core, receiptDigest: digestValue(core) };
}

function githubJson(argumentsList) {
  if (argumentsList[0] === "api") return { id: 42, login: "owner" };
  if (argumentsList[0] === "repo") {
    return { id: "R_repo", nameWithOwner: "owner/repository", owner: { login: "owner" } };
  }
  throw new Error(`Unexpected GitHub invocation: ${argumentsList.join(" ")}`);
}

function resealPlan(plan) {
  const core = {
    schema: plan.schema, operation: plan.operation, sourceEvidence: plan.sourceEvidence,
    sourceEvidenceDigest: plan.sourceEvidenceDigest, nestedDeviceStart: plan.nestedDeviceStart,
  };
  plan.planDigest = digestValue(core);
  plan.exactAuthorization = `authorize dormant-preservation-admission ${plan.planDigest}`;
  plan.deviceStartArgv = plan.nestedDeviceStart.argvTemplate.map((item) => (
    item === "--operator-decision-digest={planDigest}"
      ? `--operator-decision-digest=${plan.planDigest}`
      : item === "--dormant-preservation-authorization={authorization}"
        ? `--dormant-preservation-authorization=${plan.exactAuthorization}` : item
  ));
  plan.deviceStartArgvDigest = digestValue(plan.deviceStartArgv);
}

function resealSourceEvidence(source) {
  const { sourceEvidenceDigest: ignored, ...core } = source;
  source.sourceEvidenceDigest = digestValue(core);
}
function resealReceipt(receipt) {
  const { receiptDigest: ignored, ...core } = receipt;
  receipt.receiptDigest = digestValue(core);
}
function resealIntent(intent) {
  const { intentDigest: ignored, ...core } = intent;
  intent.intentDigest = digestValue(core);
}

function validatesTopLevel(schema, value) {
  if (schema.type !== "object" || schema.additionalProperties !== false) return false;
  if (schema.required.some(key => !Object.hasOwn(value, key))) return false;
  if (Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) return false;
  return Object.entries(schema.properties).every(([key, definition]) => {
    if (definition.const !== undefined) return value[key] === definition.const;
    return !definition.pattern || new RegExp(definition.pattern, "u").test(value[key]);
  });
}
