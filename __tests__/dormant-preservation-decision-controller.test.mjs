// Responsibility: Verify exact-authority admission orchestration, live replay recovery, and effect selection.
import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  createDormantPreservationAdmissionController,
} from "../scripts/dormant-preservation-decision-controller.mjs";
const digest = label => digestValue({ label });
const sha = label => digest(label).slice(0, 40);
const TARGET_PATH = "/workspace/worktrees/candidate";

test("plan is read-only and returns its repository-derived exact authorization", async () => {
  const harness = createHarness();
  const result = await harness.controller.plan();

  assert.equal(result.status, "planned");
  assert.equal(result.planDigest, result.plan.planDigest);
  assert.equal(result.exactAuthorization,
    `authorize dormant-preservation-admission ${result.planDigest}`);
  assert.deepEqual(harness.counts, {
    classifications: 0, continuationEffects: 0, fences: 0,
    sourceReads: 1, startEffects: 0, writes: 0,
  });
});

test("direct run rejects a missing plan digest before the fence or journal", async () => {
  const harness = createHarness();
  await assert.rejects(harness.controller.run({
    authorization: `authorize dormant-preservation-admission ${digest("unbound")}`,
  }), /requires an exact plan digest/u);
  assert.equal(harness.counts.fences, 0);
  assert.equal(harness.counts.writes, 0);
  assert.equal(harness.counts.startEffects, 0);
});

test("absent target revalidates exact evidence, provisions once, and journals complete", async () => {
  const harness = createHarness();
  const planned = await harness.controller.plan();
  const result = await harness.controller.run({
    planDigest: planned.planDigest, authorization: planned.exactAuthorization,
  });

  assert.equal(result.status, "complete");
  assert.equal(result.receipt.planDigest, planned.planDigest);
  assert.equal(harness.counts.startEffects, 1);
  assert.equal(harness.counts.continuationEffects, 0);
  assert.equal(harness.counts.sourceReads, 3);
  assert.deepEqual(harness.persistedStatuses, ["authorized", "admitted", "complete"]);
});

test("lost provision response is recovered live and replay never repeats the effect", async () => {
  const harness = createHarness({ loseEffectResponse: "start" });
  const planned = await harness.controller.plan();
  const input = { planDigest: planned.planDigest, authorization: planned.exactAuthorization };

  assert.equal((await harness.controller.run(input)).status, "complete");
  assert.equal(harness.counts.startEffects, 1);
  const classifications = harness.counts.classifications;
  assert.equal((await harness.controller.run(input)).status, "complete");
  assert.equal(harness.counts.startEffects, 1);
  assert.equal(harness.counts.classifications, classifications);
});

test("admitted and complete journal replay use sealed evidence without live classification", async () => {
  const harness = createHarness({ failAfterPersist: "admitted" });
  const planned = await harness.controller.plan();
  const input = { planDigest: planned.planDigest, authorization: planned.exactAuthorization };

  await assert.rejects(harness.controller.run(input), /simulated admitted journal crash/u);
  assert.equal(harness.intent.status, "admitted");
  const afterCrash = { ...harness.counts };
  assert.equal((await harness.controller.run(input)).status, "complete");
  assert.equal(harness.counts.classifications, afterCrash.classifications);
  assert.equal(harness.counts.startEffects, afterCrash.startEffects);
  const afterComplete = { ...harness.counts };
  assert.equal((await harness.controller.run(input)).status, "complete");
  assert.equal(harness.counts.classifications, afterComplete.classifications);
  assert.equal(harness.counts.startEffects, afterComplete.startEffects);
});

test("planned candidate continues admission while already-current candidate performs no effect", async () => {
  for (const initialState of ["planned", "complete"]) {
    const harness = createHarness({ initialState });
    const planned = await harness.controller.plan();
    const result = await harness.controller.run({
      planDigest: planned.planDigest, authorization: planned.exactAuthorization,
    });
    assert.equal(result.status, "complete");
    assert.equal(harness.counts.startEffects, 0);
    assert.equal(harness.counts.continuationEffects, initialState === "planned" ? 1 : 0);
  }
});

test("authorization and pre-effect replan drift fail before candidate mutation", async () => {
  const unauthorized = createHarness();
  const firstPlan = await unauthorized.controller.plan();
  await assert.rejects(unauthorized.controller.run({
    planDigest: firstPlan.planDigest, authorization: "authorize something-else",
  }), /requires exact authorization/u);
  assert.equal(unauthorized.counts.startEffects, 0);
  assert.equal(unauthorized.intent, null);

  const drifted = createHarness({ driftOnRevalidation: true });
  const planned = await drifted.controller.plan();
  await assert.rejects(drifted.controller.run({
    planDigest: planned.planDigest, authorization: planned.exactAuthorization,
  }), /plan drifted before device:start/u);
  assert.equal(drifted.counts.startEffects, 0);
  assert.equal(drifted.intent.status, "authorized");
});

test("effect-absent stale authorized intent is CAS-replaced only with a fresh exact authorization", async () => {
  const harness = createHarness({ driftOnRevalidation: true });
  const stale = await harness.controller.plan();
  await assert.rejects(harness.controller.run({
    planDigest: stale.planDigest, authorization: stale.exactAuthorization,
  }), /plan drifted before device:start/u);
  assert.equal(harness.intent.status, "authorized");
  const fresh = await harness.controller.plan();
  assert.notEqual(fresh.planDigest, stale.planDigest);

  const result = await harness.controller.run({
    planDigest: fresh.planDigest, authorization: fresh.exactAuthorization,
  });
  assert.equal(result.status, "complete");
  assert.equal(result.planDigest, fresh.planDigest);
  assert.equal(harness.counts.startEffects, 1);
  assert.deepEqual(harness.persistedStatuses,
    ["authorized", "authorized", "admitted", "complete"]);
});

function createHarness({
  driftOnRevalidation = false, initialState = "absent", loseEffectResponse = null,
  failAfterPersist = null,
} = {}) {
  const planningInput = planInput();
  let intent = null;
  let liveState = initialState;
  let lost = false;
  let journalFailure = false;
  const persistedStatuses = [];
  const counts = {
    classifications: 0, continuationEffects: 0, fences: 0,
    sourceReads: 0, startEffects: 0, writes: 0,
  };
  const adapter = {
    async withEntrypointFence(_subject, action) {
      counts.fences += 1;
      return action({ fenceDigest: digest("fence") });
    },
    async readSourceEvidence() {
      counts.sourceReads += 1;
      if (driftOnRevalidation && counts.sourceReads >= 3) return driftedPlanInput(planningInput);
      return planningInput;
    },
    async readIntent() { return intent; },
    async writeIntent({ expectedIntent, nextIntent }) {
      counts.writes += 1;
      assert.equal(expectedIntent?.intentDigest || null, intent?.intentDigest || null);
      intent = nextIntent;
      persistedStatuses.push(intent.status);
      if (intent.status === failAfterPersist && !journalFailure) {
        journalFailure = true;
        throw new Error(`simulated ${intent.status} journal crash`);
      }
      return intent;
    },
    async classifyLiveStart({ operationKey, plan }) {
      counts.classifications += 1;
      return liveState === "complete"
        ? { state: "complete", evidence: executionFixture(plan, operationKey) }
        : { state: liveState, evidence: null };
    },
    async invokeProvisionedStart({ operationKey }) {
      counts.startEffects += 1;
      liveState = "complete";
      if (loseEffectResponse === "start" && !lost) {
        lost = true;
        throw new Error("provision response was lost");
      }
      return { operationKey };
    },
    async invokePlannedContinuation({ operationKey }) {
      counts.continuationEffects += 1;
      liveState = "complete";
      return { operationKey };
    },
  };
  return {
    controller: createDormantPreservationAdmissionController({ adapter }),
    counts, get intent() { return intent; }, persistedStatuses,
  };
}

function planInput() {
  return {
    sourceEvidence: sourceEvidenceFixture(),
    nestedDeviceStart: {
      schema: "agentic-dormant-preservation-device-start-invocation/v1",
      executable: process.execPath, cwd: "/workspace/repository",
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
  };
}

function driftedPlanInput(input) {
  const sourceCore = { ...input.sourceEvidence,
    candidate: { ...input.sourceEvidence.candidate,
      targetObservationDigest: digest("drifted target observation") } };
  delete sourceCore.sourceEvidenceDigest;
  return { ...input,
    sourceEvidence: { ...sourceCore, sourceEvidenceDigest: digestValue(sourceCore) } };
}

function sourceEvidenceFixture() {
  const candidateCore = { claimId: digest("candidate claim"), state: "active" };
  const candidateClaim = { ...candidateCore, recordDigest: digestValue(candidateCore) };
  const decisionCore = {
    schema: "agentic-dormant-preservation-admission-cloud-decision/v2",
    candidateClaimId: candidateClaim.claimId,
    candidateWriteSetDigest: digest("candidate write set"),
    selectedClaimIds: [],
    claims: [{ ...candidateClaim, writeSetDigest: digest("candidate write set") }],
  };
  decisionCore.claims[0].recordDigest = digestValue({
    claimId: decisionCore.claims[0].claimId,
    state: decisionCore.claims[0].state,
    writeSetDigest: decisionCore.claims[0].writeSetDigest,
  });
  const decisionClaim = decisionCore.claims[0];
  const worktree = {
    path: "/workspace/worktrees/legacy", branch: "refs/heads/agent/old/old-scope",
    headSha: sha("legacy head"), treeSha: sha("legacy tree"),
    stateDigest: digest("legacy state"),
  };
  const selectedCore = {
    path: worktree.path, stateDigest: worktree.stateDigest, worktree, pullRequest: null,
  };
  const selectedLane = { ...selectedCore, selectionDigest: digestValue(selectedCore) };
  const selectionDigest = digestValue({
    schema: "agentic-dormant-preservation-admission-selection/v1",
    lanes: [{ path: selectedLane.path, stateDigest: selectedLane.stateDigest,
      pullRequestNumber: null, selectionDigest: selectedLane.selectionDigest }],
  });
  const existingLanes = [
    { path: "/workspace/repository", stateDigest: digest("canonical state") },
    { path: worktree.path, stateDigest: worktree.stateDigest },
  ].sort((left, right) => left.path.localeCompare(right.path));
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
      laneSetDigest: digestValue(existingLanes), existingLanes,
    },
    candidate: {
      semanticScope: "new-scope", deviceId: "device", branch: "agent/device/new-scope",
      sessionId: "decision-session", targetPath: TARGET_PATH,
      targetObservationDigest: digest("target observation"), ttlSeconds: 3600,
      selectionPath: "/workspace/selection.json", selectionFileDigest: digest("selection file"),
      manifestPath: "/workspace/manifest.json", manifestFileDigest: digest("manifest file"),
      manifest: { semanticScope: "new-scope" },
      cloudAuthorityPath: "/workspace/cloud-authority.json",
      cloudAuthorityFileDigest: digest("authority file"),
      cloudAuthority: { claimId: decisionClaim.claimId, sessionId: "decision-session" },
      candidateClaim: decisionClaim, candidateClaimRecordDigest: decisionClaim.recordDigest,
    },
    cloudDecision: { ...decisionCore, decisionStateDigest: digestValue(decisionCore) },
    preservation: {
      authenticatedActor: { actorId: "github-user:42", login: "owner" },
      repository: { id: "R_repo", nameWithOwner: "owner/repository",
        ownerLogin: "owner", path: "/workspace/repository" },
      sessionId: "decision-session",
      selectedLanes: [selectedLane],
      selectionDigest, projectionDigest: digest("projection"),
    },
  };
  return Object.freeze({ ...core, sourceEvidenceDigest: digestValue(core) });
}

function executionFixture(plan, operationKey) {
  const core = {
    schema: "agentic-dormant-preservation-admission-execution-evidence/v1",
    status: "admitted", planDigest: plan.planDigest, operationKey,
    sourceEvidenceDigest: plan.sourceEvidenceDigest,
    deviceStartArgvDigest: plan.deviceStartArgvDigest,
    canonicalStateDigest: digest("canonical state"),
    preexistingLaneSetDigest: digest("preexisting lanes"),
    postLaneSetDigest: digest("post lanes"),
    dormantPreservationReceiptDigest: digest("dormant receipt"),
    admissionReportDigest: digest("admission report"),
    admissionReceiptDigest: digest("admission receipt"),
    preservationReceiptDigest: digest("preservation receipt"),
    mutationAuthorityReceiptDigest: digest("mutation receipt"),
    candidate: {
      path: TARGET_PATH, branch: "agent/device/new-scope", headSha: sha("candidate head"),
      treeSha: plan.sourceEvidence.canonical.treeSha,
      parentSha: plan.sourceEvidence.canonical.headSha, parentCount: 1,
      stateDigest: digest("candidate state"),
      leaseDigest: digest("candidate lease"), leaseEpoch: 1, sessionId: "decision-session",
      pullRequestNumber: 101, pullRequestNodeId: "PR_101",
      pullRequestUrl: "https://github.com/owner/repository/pull/101",
      pullRequestHeadSha: sha("candidate head"),
    },
    finalCloud: {
      claimId: plan.sourceEvidence.candidate.candidateClaim.claimId,
      claimDigest: digest("final claim"), claimTransitionDigest: digest("final transition"),
      claimRecordDigest: digest("final record"), ledgerRevision: sha("final ledger"),
      ledgerDigest: digest("final ledger"), inventoryStateDigest: digest("final inventory"),
      peerSetDigest: digest("final peers"),
    },
  };
  return Object.freeze({ ...core, evidenceDigest: digestValue(core) });
}
