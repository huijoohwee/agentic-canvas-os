// Responsibility: verify stable complete projections and fail-closed dormant-preservation admission evidence joins.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  DORMANT_PRESERVATION_ADMISSION_SELECTION_SCHEMA,
  DORMANT_PRESERVATION_ADMISSION_SOURCE_EVIDENCE_SCHEMA,
  assertDormantPreservationAdmissionPlannedContinuation,
  assertDormantPreservationAdmissionSourceEvidence,
  buildDormantPreservationAdmissionExecutionEvidence,
  buildDormantPreservationAdmissionSourceEvidence,
  classifyDormantPreservationAdmissionExecution,
  normalizeDormantPreservationAdmissionSelection,
  normalizeDormantPreservationAdmissionSourceEvidence,
  projectDormantPreservationAdmissionCloudDecision,
  projectDormantPreservationAdmissionCloudInventory,
  projectDormantPreservationAdmissionReceipt,
} from "../scripts/dormant-preservation-decision-evidence.mjs";
import {
  verifyCurrentCloudInventory,
  verifyDormantPreservation,
} from "../scripts/scoped-lane-authority-state.mjs";

const digest = label => digestValue({ label });
const sha = label => digest(label).slice(0, 40);
const REPOSITORY_PATH = "/workspace/repository";
const DORMANT_PATH = "/workspace/worktrees/legacy";
const TARGET_PATH = "/workspace/worktrees/candidate";
const SESSION_ID = "decision-session";

test("selection normalization is bounded, ordered, unique, and exact", () => {
  const normalized = normalizeDormantPreservationAdmissionSelection({
    schema: DORMANT_PRESERVATION_ADMISSION_SELECTION_SCHEMA,
    lanes: [
      { worktreePath: "/workspace/z", pullRequest: null },
      { worktreePath: "/workspace/a", pullRequest: 17 },
    ],
  });
  assert.deepEqual(normalized.lanes.map(lane => lane.worktreePath), [
    "/workspace/a", "/workspace/z",
  ]);
  assert.throws(() => normalizeDormantPreservationAdmissionSelection({
    schema: DORMANT_PRESERVATION_ADMISSION_SELECTION_SCHEMA,
    lanes: [
      { worktreePath: "/workspace/a", pullRequest: null },
      { worktreePath: "/workspace/a", pullRequest: null },
    ],
  }), /unique/);
  assert.throws(() => normalizeDormantPreservationAdmissionSelection({
    schema: DORMANT_PRESERVATION_ADMISSION_SELECTION_SCHEMA,
    lanes: [{ worktreePath: "/workspace/a", pullRequest: null, ignored: true }],
  }), /unexpected/);
  assert.throws(() => normalizeDormantPreservationAdmissionSelection({
    schema: DORMANT_PRESERVATION_ADMISSION_SELECTION_SCHEMA,
    lanes: [{ worktreePath: "/workspace/a", pullRequest: "90" }],
  }), /canonical GitHub/);
});

test("cloud inventory projection binds every claim while excluding observation metadata", () => {
  const first = inventoryVerification([claimFixture("candidate"), claimFixture("peer")]);
  const reordered = structuredClone(first);
  reordered.inventory.claims.reverse();
  reordered.inventory.evaluationTime = "2099-01-01T00:00:00.000Z";
  reordered.verifiedAt = "2099-01-01T00:00:00.000Z";
  reordered.receiptDigest = digest("untrusted outer receipt");
  assert.deepEqual(
    projectDormantPreservationAdmissionCloudInventory(first),
    projectDormantPreservationAdmissionCloudInventory(reordered),
  );

  const mutated = structuredClone(first);
  mutated.inventory.claims[0].state = "parked";
  assert.throws(
    () => projectDormantPreservationAdmissionCloudInventory(mutated),
    /record digest drifted/,
  );
  const omitted = structuredClone(first);
  omitted.inventory.claims.pop();
  assert.notEqual(
    projectDormantPreservationAdmissionCloudInventory(first).inventoryStateDigest,
    projectDormantPreservationAdmissionCloudInventory(omitted).inventoryStateDigest,
  );
});

test("v2 source evidence is stable across an unrelated disjoint ledger append", () => {
  const candidate = claimFixture("candidate");
  const before = operationFixture({
    remoteInventory: inventoryVerification([candidate], { ledgerLabel: "before append" }),
  });
  const after = operationFixture({
    remoteInventory: inventoryVerification(
      [candidate, claimFixture("unrelated")],
      { ledgerLabel: "after append" },
    ),
  });
  const beforeSource = buildDormantPreservationAdmissionSourceEvidence(before.sourceInput);
  const afterSource = buildDormantPreservationAdmissionSourceEvidence(after.sourceInput);

  assert.equal(beforeSource.schema, DORMANT_PRESERVATION_ADMISSION_SOURCE_EVIDENCE_SCHEMA);
  assert.equal(beforeSource.cloudDecision.schema,
    "agentic-dormant-preservation-admission-cloud-decision/v2");
  assert.equal(Object.hasOwn(beforeSource, "cloudInventory"), false);
  assert.deepEqual(afterSource.cloudDecision, beforeSource.cloudDecision);
  assert.equal(afterSource.sourceEvidenceDigest, beforeSource.sourceEvidenceDigest);
  assert.deepEqual(afterSource, beforeSource);
});

test("v2 cloud decision fails closed on overlap, candidate lineage, and candidate identity drift", () => {
  const candidate = claimFixture("candidate");
  const operation = operationFixture({
    remoteInventory: inventoryVerification([candidate], { ledgerLabel: "planned" }),
  });
  const sourceEvidence = buildDormantPreservationAdmissionSourceEvidence(operation.sourceInput);
  const plan = {
    sourceEvidence,
    sourceEvidenceDigest: sourceEvidence.sourceEvidenceDigest,
    planDigest: digest("planned plan"),
    deviceStartArgvDigest: digest("planned argv"),
  };
  const input = executionInput(plan, operation);
  const overlappingInventory = inventoryVerification([
    candidate,
    claimFixture("overlapping", {
      declaredWriteScope: ["path:docs/candidate/child", "semantic:overlapping"],
    }),
  ], { ledgerLabel: "overlapping append" });
  const overlappingDecision = projectDormantPreservationAdmissionCloudDecision(
    overlappingInventory,
    sourceEvidence.candidate,
    sourceEvidence.preservation,
  );

  assert.equal(overlappingDecision.claims.length, 2);
  assert.notEqual(overlappingDecision.decisionStateDigest,
    sourceEvidence.cloudDecision.decisionStateDigest);
  assert.throws(() => buildDormantPreservationAdmissionExecutionEvidence({
    ...input,
    postCloudInventory: overlappingInventory,
  }), /relevant cloud records changed/);

  const candidateLineageInventory = inventoryVerification([
    candidate,
    claimFixture("candidate successor", {
      workItemId: candidate.workItemId,
      declaredWriteScope: ["path:docs/disjoint", "semantic:disjoint-successor"],
    }),
  ], { ledgerLabel: "candidate-lineage append" });
  const candidateLineageDecision = projectDormantPreservationAdmissionCloudDecision(
    candidateLineageInventory,
    sourceEvidence.candidate,
    sourceEvidence.preservation,
  );
  assert.equal(candidateLineageDecision.claims.length, 2);
  assert.notEqual(candidateLineageDecision.decisionStateDigest,
    sourceEvidence.cloudDecision.decisionStateDigest);
  assert.throws(() => buildDormantPreservationAdmissionExecutionEvidence({
    ...input,
    postCloudInventory: candidateLineageInventory,
  }), /relevant cloud records changed/);

  const candidateDriftInventory = inventoryVerification([
    claimFixture("candidate", { leaseEpoch: 2 }),
  ], { ledgerLabel: "candidate drift" });
  assert.throws(() => buildDormantPreservationAdmissionExecutionEvidence({
    ...input,
    postCloudInventory: candidateDriftInventory,
  }), /relevant cloud records changed/);
});

test("dormant receipt projection ignores only circular and observation fields", () => {
  const { dormantReceipt } = operationFixture();
  const changedObservation = structuredClone(dormantReceipt);
  changedObservation.operatorDecisionDigest = digest("next plan");
  changedObservation.verifiedAt = "2099-01-01T00:00:00.000Z";
  changedObservation.receiptDigest = digest("changed outer receipt");
  changedObservation.cloudInventory.verificationReceiptDigest = digest("changed verification");
  assert.deepEqual(
    projectDormantPreservationAdmissionReceipt(dormantReceipt),
    projectDormantPreservationAdmissionReceipt(changedObservation),
  );

  const changedLane = structuredClone(changedObservation);
  changedLane.worktrees[0].stateDigest = digest("changed lane");
  assert.notEqual(
    projectDormantPreservationAdmissionReceipt(dormantReceipt).projectionDigest,
    projectDormantPreservationAdmissionReceipt(changedLane).projectionDigest,
  );
});

test("detached worktrees bind a null branch and reject contradictory or pull-request projections", () => {
  const detachedLane = { ...laneFixture(), branch: null, detached: true };
  const operation = operationFixture({ dormantLane: detachedLane });
  const source = buildDormantPreservationAdmissionSourceEvidence(operation.sourceInput);
  const selected = source.preservation.selectedLanes[0];
  assert.equal(selected.worktree.branch, null);
  assert.equal(selected.worktree.detached, true);
  assert.deepEqual(normalizeDormantPreservationAdmissionSourceEvidence(source), source);

  for (const drift of [
    { branch: null, detached: false },
    { branch: "refs/heads/agent/invented", detached: true },
  ]) {
    const receipt = structuredClone(operation.dormantReceipt);
    Object.assign(receipt.worktrees[0], drift);
    assert.throws(() => projectDormantPreservationAdmissionReceipt(receipt), /branch and detached state/);
  }

  const detachedPullReceipt = pullReceipt(operation);
  assert.throws(() => buildDormantPreservationAdmissionSourceEvidence({
    ...operation.sourceInput,
    dormantReceipt: detachedPullReceipt,
    selection: { schema: DORMANT_PRESERVATION_ADMISSION_SELECTION_SCHEMA,
      lanes: [{ worktreePath: DORMANT_PATH, pullRequest: 90 }] },
  }), /absent or mismatched/);

  const schema = JSON.parse(readFileSync(new URL(
    "../docs/schemas/dormant-preservation-decision-plan.v2.schema.json", import.meta.url,
  ), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile({
    $schema: schema.$schema, $ref: "#/$defs/selectedLane", $defs: schema.$defs,
  });
  assert.equal(validate(selected), true, JSON.stringify(validate.errors));
  for (const drift of [
    { branch: null, detached: false },
    { branch: "refs/heads/agent/invented", detached: true },
  ]) {
    const invalid = structuredClone(selected);
    Object.assign(invalid.worktree, drift);
    assert.equal(validate(invalid), false);
  }
});

test("selected pull request must exactly pair repository, branch, and head with its worktree", () => {
  const operation = operationFixture();
  const build = options => buildDormantPreservationAdmissionSourceEvidence({
    ...operation.sourceInput,
    dormantReceipt: pullReceipt(operation, options),
    selection: { schema: DORMANT_PRESERVATION_ADMISSION_SELECTION_SCHEMA,
      lanes: [{ worktreePath: DORMANT_PATH, pullRequest: 90 }] },
  });
  assert.equal(build({}).preservation.selectedLanes[0].pullRequest.number, 90);
  assert.throws(() => build({ branch: "agent/other/branch" }), /absent or mismatched/);
  assert.throws(() => build({ headSha: sha("other head") }), /absent or mismatched/);
  assert.throws(() => build({ url: "https://github.com/other/repository/pull/90" }), /drifted/);
  assert.throws(() => buildDormantPreservationAdmissionSourceEvidence({
    ...operation.sourceInput,
    selection: { schema: DORMANT_PRESERVATION_ADMISSION_SELECTION_SCHEMA,
      lanes: [{ worktreePath: DORMANT_PATH, pullRequest: 90 }] },
  }), /absent or mismatched/);
  assert.throws(() => pullReceipt(operation, { headRepository: "fork/repository" }), /must be owned/);
  const missingBranch = structuredClone(pullReceipt(operation));
  delete missingBranch.pullRequests[0].branch;
  assert.throws(() => projectDormantPreservationAdmissionReceipt(missingBranch), /branch/);
  const malformedRepository = structuredClone(pullReceipt(operation));
  malformedRepository.pullRequests[0].headRepository = "not-a-repository";
  assert.throws(() => projectDormantPreservationAdmissionReceipt(malformedRepository), /owner\/repository/);
});

test("source evidence binds protected heads, candidate files, relevant cloud decision, and selected lane state", () => {
  const fixture = operationFixture();
  const source = buildDormantPreservationAdmissionSourceEvidence(fixture.sourceInput);
  assert.deepEqual(normalizeDormantPreservationAdmissionSourceEvidence(source), source);
  assert.deepEqual(assertDormantPreservationAdmissionSourceEvidence(source, source), source);
  assert.equal(source.candidate.candidateClaimRecordDigest, fixture.candidateClaim.recordDigest);
  assert.equal(source.preservation.selectedLanes[0].stateDigest, digest("dormant state"));
  assert.throws(() => buildDormantPreservationAdmissionSourceEvidence({
    ...fixture.sourceInput, canonical: { ...fixture.sourceInput.canonical,
      origin: "https://github.com/other/repository.git" },
  }), /clean current protected-main checkout/);
  assert.throws(() => buildDormantPreservationAdmissionSourceEvidence({
    ...fixture.sourceInput, canonical: { ...fixture.sourceInput.canonical, origin: "/tmp/repository.git" },
  }), /canonical GitHub/);

  assert.throws(() => buildDormantPreservationAdmissionSourceEvidence({
    ...fixture.sourceInput,
    dormantReceipt: structuredClone(fixture.dormantReceipt),
  }), /operation-derived/);
  assert.throws(() => buildDormantPreservationAdmissionSourceEvidence({
    ...fixture.sourceInput,
    remoteInventory: structuredClone(fixture.remoteInventory),
  }), /operation-derived complete cloud inventory/);

  const resealedDrift = structuredClone(source);
  resealedDrift.canonical.existingLanes[0].stateDigest = digest("forged lane state");
  const { sourceEvidenceDigest: ignored, ...sourceCore } = resealedDrift;
  resealedDrift.sourceEvidenceDigest = digestValue(sourceCore);
  assert.throws(
    () => normalizeDormantPreservationAdmissionSourceEvidence(resealedDrift),
    /absent or drifted/,
  );
  const forgedLaneSet = structuredClone(source);
  forgedLaneSet.canonical.laneSetDigest = digest("forged lane set");
  const { sourceEvidenceDigest: omittedDigest, ...forgedCore } = forgedLaneSet;
  forgedLaneSet.sourceEvidenceDigest = digestValue(forgedCore);
  assert.throws(() => normalizeDormantPreservationAdmissionSourceEvidence(forgedLaneSet), /absent or drifted/);

  const missingCandidate = inventoryVerification([]);
  assert.throws(() => buildDormantPreservationAdmissionSourceEvidence({
    ...fixture.sourceInput,
    remoteInventory: missingCandidate,
  }), /changed its complete cloud inventory/);
});

test("execution evidence binds the planned candidate and classifies only valid completion", () => {
  const operation = operationFixture();
  const sourceEvidence = buildDormantPreservationAdmissionSourceEvidence(operation.sourceInput);
  const plan = {
    sourceEvidence,
    sourceEvidenceDigest: sourceEvidence.sourceEvidenceDigest,
    planDigest: digest("plan"),
    deviceStartArgvDigest: digest("argv"),
  };
  const input = executionInput(plan, operation);
  const evidence = buildDormantPreservationAdmissionExecutionEvidence(input);
  assert.equal(classifyDormantPreservationAdmissionExecution(null).state, "pending");
  assert.deepEqual(classifyDormantPreservationAdmissionExecution(evidence), {
    state: "complete", evidence,
  });

  const replay = buildDormantPreservationAdmissionExecutionEvidence({
    ...input,
    dormantPreservationReceipt: executionDormantReceipt(plan, operation, "2026-08-10T00:01:00.000Z"),
    mutationAuthorityReceipt: mutationAuthorityReceipt(input, {
      evaluatedAt: "2026-08-10T00:01:00.000Z",
      cloudVerificationReceiptDigest: digest("later cloud observation"),
    }),
  });
  assert.equal(replay.evidenceDigest, evidence.evidenceDigest);
  assert.equal(replay.dormantPreservationReceiptDigest, evidence.dormantPreservationReceiptDigest);
  assert.equal(replay.mutationAuthorityReceiptDigest, evidence.mutationAuthorityReceiptDigest);

  assert.throws(() => buildDormantPreservationAdmissionExecutionEvidence({
    ...input,
    candidate: { ...input.candidate, sessionId: "different-session" },
  }), /planned candidate identity/);
  assert.throws(() => buildDormantPreservationAdmissionExecutionEvidence({
    ...input, candidate: { ...input.candidate,
      pullRequestUrl: "https://github.com/other/repository/pull/101" },
  }), /planned candidate identity/);
});

test("planned continuation requires the exact one-parent same-tree fence child", () => {
  const operation = operationFixture();
  const sourceEvidence = buildDormantPreservationAdmissionSourceEvidence(operation.sourceInput);
  const plan = { sourceEvidence, sourceEvidenceDigest: sourceEvidence.sourceEvidenceDigest,
    planDigest: digest("planned plan"), deviceStartArgvDigest: digest("planned argv") };
  const execution = executionInput(plan, operation), candidate = execution.candidate;
  const planned = {
    controller: sourceEvidence.controller, canonical: sourceEvidence.canonical,
    postLaneState: execution.postLaneState,
    dormantPreservationReceipt: execution.dormantPreservationReceipt,
    postCloudInventory: execution.postCloudInventory, manifest: sourceEvidence.candidate.manifest,
    files: { selectionFileDigest: sourceEvidence.candidate.selectionFileDigest,
      manifestFileDigest: sourceEvidence.candidate.manifestFileDigest,
      cloudAuthorityFileDigest: sourceEvidence.candidate.cloudAuthorityFileDigest },
    candidateLineage: { headSha: candidate.headSha, treeSha: candidate.treeSha,
      parentSha: candidate.parentSha, parentCount: candidate.parentCount },
    candidateLease: { worktreePath: candidate.path, branch: candidate.branch,
      sessionId: candidate.sessionId, scope: sourceEvidence.candidate.semanticScope,
      baseSha: sourceEvidence.canonical.headSha, fenceSha: candidate.headSha,
      admission: { status: "planned", semanticScope: sourceEvidence.candidate.semanticScope,
        manifestDigest: sourceEvidence.candidate.manifest.manifestDigest,
        writeSetDigest: sourceEvidence.candidate.manifest.writeSetDigest },
      cloudAuthority: { claimId: sourceEvidence.candidate.candidateClaim.claimId } },
  };
  assert.equal(
    assertDormantPreservationAdmissionPlannedContinuation(plan, planned).postLaneSetDigest,
    digestValue(execution.postLaneState.lanes.map(lane => ({ path: lane.path,
      stateDigest: lane.stateDigest })).sort((a, b) => a.path.localeCompare(b.path))),
  );
  assert.throws(() => assertDormantPreservationAdmissionPlannedContinuation(plan, {
    ...planned, candidateLineage: { ...planned.candidateLineage, parentSha: sha("other parent") },
  }), /lease, manifest, or source files drifted/);
});

function operationFixture({
  dormantLane = laneFixture(),
  remoteInventory = inventoryVerification([claimFixture("candidate")]),
} = {}) {
  const candidateClaimId = claimFixture("candidate").claimId;
  const candidateClaim = remoteInventory.inventory.claims.find(
    claim => claim.claimId === candidateClaimId,
  );
  assert.ok(candidateClaim, "operation fixture requires the candidate claim");
  const dormantReceipt = verifyDormantPreservation({
    repository: REPOSITORY_PATH,
    targetRepository: "owner/repository",
    lanes: [dormantLane],
    worktreePaths: [DORMANT_PATH],
    pullRequestReferences: [],
    operatorDecisionDigest: digest("pre-plan decision"),
    sessionId: SESSION_ID,
    remoteAuthorityVerification: remoteInventory,
    ghJson: githubJson,
    verifiedAt: "2026-08-10T00:00:00.000Z",
  });
  const sourceInput = {
    controller: {
      path: "/workspace/controller", origin: "git@github.com:owner/controller.git",
      headSha: sha("controller"), originMainSha: sha("controller"),
      remoteMainSha: sha("controller"), treeSha: sha("controller tree"), clean: true,
      deviceBranchScriptDigest: digest("device branch script"),
    },
    canonical: {
      repositoryPath: REPOSITORY_PATH, canonicalPath: REPOSITORY_PATH,
      origin: "git@github.com:owner/repository.git", targetRepository: "owner/repository",
      headSha: sha("canonical"), originMainSha: sha("canonical"),
      remoteMainSha: sha("canonical"), treeSha: sha("canonical tree"),
      clean: true, canonicalSourceDisposition: "exact",
      canonicalLaneStateDigest: digest("canonical state"), registryDigest: digest("registry"),
      laneSetDigest: digestValue([
        { path: REPOSITORY_PATH, stateDigest: digest("canonical state") },
        { path: DORMANT_PATH, stateDigest: dormantLane.stateDigest },
      ].sort((left, right) => left.path.localeCompare(right.path))),
      existingLanes: [
        { path: REPOSITORY_PATH, stateDigest: digest("canonical state") },
        { path: DORMANT_PATH, stateDigest: dormantLane.stateDigest },
      ],
    },
    candidate: {
      semanticScope: "new-scope", deviceId: "device", branch: "agent/device/new-scope",
      sessionId: SESSION_ID, targetPath: TARGET_PATH,
      targetObservationDigest: digest("target observation"), ttlSeconds: 3600,
      selectionPath: "/workspace/selection.json", selectionFileDigest: digest("selection file"),
      manifestPath: "/workspace/manifest.json", manifestFileDigest: digest("manifest file"),
      manifest: { schema: "agentic-declared-write-scope/v1", semanticScope: "new-scope",
        manifestDigest: digest("manifest"), writeSetDigest: candidateClaim.writeSetDigest },
      cloudAuthorityPath: "/workspace/cloud-authority.json",
      cloudAuthorityFileDigest: digest("cloud authority file"),
      cloudAuthority: { claimId: candidateClaim.claimId, sessionId: SESSION_ID },
      candidateClaim, candidateClaimRecordDigest: candidateClaim.recordDigest,
    },
    remoteInventory,
    dormantReceipt,
    selection: {
      schema: DORMANT_PRESERVATION_ADMISSION_SELECTION_SCHEMA,
      lanes: [{ worktreePath: DORMANT_PATH, pullRequest: null }],
    },
  };
  return { sourceInput, remoteInventory, dormantReceipt, candidateClaim, dormantLane };
}

function inventoryVerification(claims, { ledgerLabel = "ledger" } = {}) {
  return verifyCurrentCloudInventory({
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/repository",
    inspect: () => ({
      schema: "agentic-cloud-collaboration-result/v1", ok: true,
      action: "status", status: "ready", ledgerRevision: sha(`${ledgerLabel} revision`),
      ledgerDigest: digest(`${ledgerLabel} digest`), claims,
    }),
  });
}

function claimFixture(label, overrides = {}) {
  const declaredWriteScope = overrides.declaredWriteScope
    || [`path:docs/${label}`, `semantic:${label}`];
  return {
    claimId: digest(`${label} claim`), state: "current", actorId: "github-user:42",
    repositoryId: "github-repository:R_repo", workItemId: `work-item:${label}`,
    canonicalBaseRevision: sha(`${label} base`), laneRevision: sha(`${label} lane`),
    declaredWriteScope, writeSetDigest: digestValue(declaredWriteScope), leaseEpoch: 1,
    transitionCounter: 1, heartbeatCounter: 0, reviewRequestId: null,
    expiresAt: "2099-08-10T00:00:00.000Z", fenceRevision: digest(`${label} fence`),
    transitionDigest: digest(`${label} transition`),
    ...overrides,
    declaredWriteScope,
    writeSetDigest: digestValue(declaredWriteScope),
  };
}

function laneFixture() {
  return {
    path: DORMANT_PATH, head: sha("dormant head"), treeSha: sha("dormant tree"),
    branch: "refs/heads/agent/old-device/old-scope", detached: false, dirty: true,
    invalid: false, leaseAmbiguous: false, indexDigest: digest("dormant index"),
    workingTreeDigest: digest("dormant working"), stateDigest: digest("dormant state"),
    lease: null,
  };
}

function githubJson(argumentsList) {
  if (argumentsList[0] === "api") return { id: 42, login: "owner" };
  if (argumentsList[0] === "repo") {
    return { id: "R_repo", nameWithOwner: "owner/repository", owner: { login: "owner" } };
  }
  throw new Error(`Unexpected GitHub invocation: ${argumentsList.join(" ")}`);
}

function pullReceipt(operation, {
  branch = "agent/old-device/old-scope", headSha = operation.dormantLane.head,
  headRepository = "owner/repository", url = "https://github.com/owner/repository/pull/90",
} = {}) {
  return verifyDormantPreservation({
    repository: REPOSITORY_PATH, targetRepository: "owner/repository",
    lanes: [operation.dormantLane], worktreePaths: [DORMANT_PATH],
    pullRequestReferences: ["90"], operatorDecisionDigest: digest("pre-plan decision"),
    sessionId: SESSION_ID, remoteAuthorityVerification: operation.remoteInventory,
    verifiedAt: "2026-08-10T00:00:00.000Z",
    ghJson: argumentsList => argumentsList[0] === "pr" ? {
      id: "PR_90", number: 90, url,
      state: "OPEN", isDraft: true, headRefName: branch, headRefOid: headSha,
      headRepository: { nameWithOwner: headRepository }, baseRefName: "main",
      baseRefOid: sha("base"), mergeStateStatus: "DIRTY",
    } : githubJson(argumentsList),
  });
}

function executionInput(plan, operation) {
  const source = plan.sourceEvidence, candidateHead = sha("candidate head");
  const laneProjections = [
    { path: REPOSITORY_PATH, stateDigest: digest("canonical state") },
    { path: DORMANT_PATH, stateDigest: operation.dormantLane.stateDigest },
    { path: TARGET_PATH, stateDigest: digest("candidate state") },
  ].sort((left, right) => left.path.localeCompare(right.path));
  const input = {
    plan, operationKey: digest("admitted operation"),
    dormantPreservationReceipt: executionDormantReceipt(plan, operation),
    postCloudInventory: operation.remoteInventory,
    postLaneState: {
      canonicalBaseSha: source.canonical.headSha, canonicalSourceDisposition: "exact",
      laneStateDigest: digestValue(laneProjections),
      lanes: [
        { path: REPOSITORY_PATH, stateDigest: digest("canonical state") },
        operation.dormantLane,
        { path: TARGET_PATH, stateDigest: digest("candidate state"), head: candidateHead,
          treeSha: source.canonical.treeSha, branch: "refs/heads/agent/device/new-scope",
          dirty: false, invalid: false },
      ],
    },
    admissionReportDigest: digest("admission report"), admissionReceiptDigest: digest("admission receipt"),
    preservationReceiptDigest: digest("preservation receipt"),
    candidate: {
      path: TARGET_PATH, branch: "agent/device/new-scope", headSha: candidateHead,
      treeSha: source.canonical.treeSha, parentSha: source.canonical.headSha,
      parentCount: 1, stateDigest: digest("candidate state"),
      leaseDigest: digest("candidate lease"), leaseEpoch: 1, sessionId: SESSION_ID,
      pullRequestNumber: 101, pullRequestNodeId: "PR_101",
      pullRequestUrl: "https://github.com/owner/repository/pull/101",
      pullRequestHeadSha: candidateHead,
    },
  };
  input.mutationAuthorityReceipt = mutationAuthorityReceipt(input);
  return input;
}

function executionDormantReceipt(plan, operation, verifiedAt = "2026-08-10T00:00:00.000Z") {
  return verifyDormantPreservation({
    repository: REPOSITORY_PATH, targetRepository: "owner/repository",
    lanes: [operation.dormantLane], worktreePaths: [DORMANT_PATH],
    operatorDecisionDigest: plan.planDigest, sessionId: SESSION_ID,
    remoteAuthorityVerification: operation.remoteInventory, ghJson: githubJson, verifiedAt,
  });
}

function mutationAuthorityReceipt(input, observations = {}) {
  const claim = input.postCloudInventory.inventory.claims.find(item => item.claimId
    === input.plan.sourceEvidence.candidate.candidateClaim.claimId);
  const core = {
    schema: "agentic-admission-mutation-authority/v1", status: "ready",
    claimId: claim.claimId, claimDigest: claim.fenceRevision,
    ledgerRevision: input.postCloudInventory.ledgerRevision,
    localLeaseEpoch: input.candidate.leaseEpoch, localFenceSha: input.candidate.headSha,
    remoteLeaseEpoch: claim.leaseEpoch,
    cloudVerificationReceiptDigest: observations.cloudVerificationReceiptDigest || digest("cloud observation"),
    evaluatedAt: observations.evaluatedAt || "2026-08-10T00:00:00.000Z",
    expiresAt: "2099-08-10T00:00:00.000Z",
  };
  return { ...core, receiptDigest: digestValue(core) };
}
