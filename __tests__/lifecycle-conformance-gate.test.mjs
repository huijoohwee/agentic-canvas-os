import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  LIFECYCLE_FINDING_TYPES,
  LIFECYCLE_STAGES,
  assertLifecycleStageReady,
  evaluateLifecycleStage,
  verifyLifecycleStageReceipt,
} from "../scripts/lifecycle-conformance-gate.mjs";

const policy = Object.freeze({
  repository: "huijoohwee/huijoohwee.github.io",
  revision: "a".repeat(40),
  digest: digest("policy"),
  guidelineVersion: "1.8.0",
});
const collaboration = Object.freeze({
  actorId: "actor:implementer",
  deviceId: "device:local",
  sessionId: "session:one",
  worktreeId: "worktree:task",
  branchId: "agent/device/task",
  scopeId: "scope:task",
  leaseEpoch: 7,
  fenceRevision: "f".repeat(40),
});
const boundaries = Object.freeze({
  admission: "closed",
  review: "closed",
  integration: "closed",
  runtime: "closed",
  candidate: "closed",
  authorization: "human-authorized",
  deployment: "authorized",
  publication: "live-verified",
});

test("finding counts use only the guideline-owned lifecycle vocabulary", () => {
  assert.deepEqual(LIFECYCLE_FINDING_TYPES, [
    "runtime-readiness-unproven", "stale-collaboration-fence",
    "parallel-scope-collision", "unreviewed-release-candidate",
    "dependency-closure-drift", "authorization-evidence-unjoined",
    "authorization-interaction-unjoined", "duplicate-release-controller",
    "production-authorization-drift", "post-authorization-rebuild",
    "integration-order-cycle", "integration-before-dependency",
    "canonical-frontier-unverified", "duplicate-change-reintegrated",
    "stale-candidate-frontier", "assumed-operator-decision",
    "unproven-property", "evidence-without-run",
  ]);
});

test("all lifecycle stages form one deterministic digest-joined ready chain", () => {
  const chain = buildChain();
  assert.deepEqual(chain.map(({ receipt }) => receipt.stage), LIFECYCLE_STAGES);
  for (const { operation, receipt } of chain) {
    assert.equal(receipt.ready, true);
    assert.equal(receipt.verdict, "verified");
    assert.equal(receipt.claimScope, "lifecycle-stage");
    assert.equal(verifyLifecycleStageReceipt(receipt), true);
    assert.equal(Object.isFrozen(receipt), true);
    assert.deepEqual(Object.keys(receipt.findingCounts), LIFECYCLE_FINDING_TYPES);
    assert.ok(Object.values(receipt.findingCounts).every((count) => count === 0));
    assert.deepEqual(evaluateLifecycleStage(operation), receipt);
  }
  const replay = evaluateLifecycleStage(clone(chain.at(-1).operation));
  assert.deepEqual(replay, chain.at(-1).receipt);
  assert.equal(replay.receiptDigest, chain.at(-1).receipt.receiptDigest);
});

test("receipt verification rejects finding and count laundering", () => {
  const blocked = evaluateLifecycleStage({
    ...clone(buildChain()[0].operation),
    checks: [],
  });
  assert.equal(blocked.ready, false);
  assert.equal(verifyLifecycleStageReceipt(blocked), true);
  const countDrift = clone(blocked);
  countDrift.findingCounts["evidence-without-run"] = 0;
  assert.equal(verifyLifecycleStageReceipt(countDrift), false);
  const severityDrift = clone(blocked);
  severityDrift.findings[0].severity = "minor";
  assert.equal(verifyLifecycleStageReceipt(severityDrift), false);
});

test("missing and malformed policy, subject, collaboration, and evidence block", () => {
  const admission = buildChain()[0].operation;
  for (const [mutate, finding] of [
    [(value) => { value.policy.revision = "not-a-sha"; }, "runtime-readiness-unproven"],
    [(value) => { value.subject.commit = "bad"; }, "runtime-readiness-unproven"],
    [(value) => { value.subject.collaboration = null; }, "runtime-readiness-unproven"],
    [(value) => { value.evidence.callerReady = true; }, "runtime-readiness-unproven"],
  ]) {
    const operation = clone(admission);
    mutate(operation);
    expectFinding(operation, finding);
  }
});

test("causal stage, predecessor, digest, and collaboration fence failures block", () => {
  const chain = buildChain();
  const review = clone(chain[1].operation);
  review.predecessor = null;
  expectFinding(review, "runtime-readiness-unproven");

  const integration = clone(chain[2].operation);
  integration.predecessor = {
    operation: clone(chain[0].operation),
    receipt: clone(chain[0].receipt),
  };
  integration.predecessorDigest = chain[0].receipt.receiptDigest;
  expectFinding(integration, "integration-before-dependency");

  const drift = clone(chain[1].operation);
  drift.predecessorDigest = digest("wrong predecessor");
  expectFinding(drift, "runtime-readiness-unproven");

  const staleFence = clone(chain[1].operation);
  staleFence.subject.collaboration = {
    ...staleFence.subject.collaboration,
    fenceRevision: "e".repeat(40),
  };
  expectFinding(staleFence, "stale-collaboration-fence");

  const competingScope = clone(chain[1].operation);
  competingScope.subject.collaboration = {
    ...competingScope.subject.collaboration,
    scopeId: "scope:other",
  };
  expectFinding(competingScope, "parallel-scope-collision");
});

test("ordered checks fail closed on order, subject, result, and named digest", () => {
  const admission = buildChain()[0].operation;
  for (const [mutate, finding] of [
    [(value) => { value.checks[0].sequence = 2; }, "evidence-without-run"],
    [(value) => { value.checks[0].subjectCommit = "e".repeat(40); }, "evidence-without-run"],
    [(value) => {
      value.checks[0].status = "failed";
      value.evidence.namedChecksDigest = stableDigest(value.checks);
    }, "unproven-property"],
    [(value) => { value.evidence.namedChecksDigest = digest("stale checks"); }, "evidence-without-run"],
  ]) {
    const operation = clone(admission);
    mutate(operation);
    expectFinding(operation, finding);
  }
});

test("source, dependency, candidate, and authorization joins reject drift", () => {
  const chain = buildChain();
  const runtimeSource = clone(chain[3].operation);
  runtimeSource.subject.sourceDigest = digest("other source");
  runtimeSource.evidence.sourceDigest = runtimeSource.subject.sourceDigest;
  expectFinding(runtimeSource, "canonical-frontier-unverified");

  const runtimeDependency = clone(chain[3].operation);
  runtimeDependency.subject.dependencyClosureDigest = digest("other dependency");
  runtimeDependency.evidence.dependencyClosureDigest =
    runtimeDependency.subject.dependencyClosureDigest;
  expectFinding(runtimeDependency, "dependency-closure-drift");

  const authorization = clone(chain[5].operation);
  authorization.evidence.targetDigest = digest("other target");
  expectFinding(authorization, "stale-candidate-frontier");

  const deployment = clone(chain[6].operation);
  deployment.evidence.authorizedActorId = "actor:other";
  expectFinding(deployment, "authorization-evidence-unjoined");
});

test("human authorization, one controller, live proof, and publication are mandatory", () => {
  const chain = buildChain();
  const authorization = clone(chain[5].operation);
  authorization.evidence.decisionKind = "machine";
  expectFinding(authorization, "assumed-operator-decision");

  const detachedInteraction = clone(chain[5].operation);
  detachedInteraction.evidence.authorityAdapterId = "";
  expectFinding(detachedInteraction, "authorization-interaction-unjoined");

  const deployment = clone(chain[6].operation);
  deployment.evidence.activeControllerId = "controller:other";
  expectFinding(deployment, "duplicate-release-controller");

  const publication = clone(chain[7].operation);
  publication.evidence.liveStatus = "unverified";
  expectFinding(publication, "runtime-readiness-unproven");

  const unpublished = clone(chain[7].operation);
  unpublished.evidence.publicationStatus = "pending";
  expectFinding(unpublished, "runtime-readiness-unproven");
});

test("assertion export returns ready receipts and exposes blocked receipts", () => {
  const chain = buildChain();
  assert.equal(assertLifecycleStageReady(chain[0].operation).ready, true);
  const blocked = clone(chain[6].operation);
  blocked.evidence.deployedArtifactDigest = digest("rebuilt artifact");
  assert.throws(
    () => assertLifecycleStageReady(blocked),
    (error) => error.code === "AGENTIC_SDLC_LIFECYCLE_BLOCKED" &&
      error.receipt.findingCounts["post-authorization-rebuild"] > 0,
  );
});

function buildChain() {
  const taskSubject = subject("b", "c", "task-source", "task-dependencies", collaboration);
  const reviewSubject = subject("d", "e", "review-source", "review-dependencies", collaboration);
  const integratedSubject = subject("1", "2", "integrated-source", "integrated-dependencies", collaboration);
  const canonicalSubject = { ...integratedSubject, collaboration: null };
  const chain = [];

  add("admission", taskSubject, {
    authoringBaselineDigest: digest("authoring"),
    taskPlanDigest: digest("task-plan"),
    evaluatorDigest: digest("admission-evaluator"),
    budgetDigest: digest("budgets"),
  });
  add("review", reviewSubject, {
    implementationDigest: digest("implementation"),
    implementerDigest: digest("implementer"),
    evaluatorDigest: digest("review-evaluator"),
    verificationDigest: digest("verification"),
  });
  add("integration", integratedSubject, {
    predecessorCommit: reviewSubject.commit,
    predecessorTree: reviewSubject.tree,
    predecessorSourceDigest: reviewSubject.sourceDigest,
    predecessorDependencyClosureDigest: reviewSubject.dependencyClosureDigest,
    integrationTargetDigest: digest("integration-target"),
    overlapPreservationDigest: digest("preservation"),
    overlapDispositionDigest: digest("disposition"),
  });
  add("runtime", canonicalSubject, {
    sourceDigest: canonicalSubject.sourceDigest,
    dependencyClosureDigest: canonicalSubject.dependencyClosureDigest,
    runtimeDigest: digest("runtime"),
    probesDigest: digest("runtime-probes"),
  });
  add("candidate", canonicalSubject, {
    sourceDigest: canonicalSubject.sourceDigest,
    dependencyClosureDigest: canonicalSubject.dependencyClosureDigest,
    policyDigest: policy.digest,
    targetDigest: digest("production-target"),
    artifactDigest: digest("artifact"),
    manifestDigest: digest("manifest"),
    rollbackTargetDigest: digest("rollback"),
  });
  add("authorization", canonicalSubject, {
    predecessorEvidenceDigest: chain[4].receipt.evidenceDigest,
    targetDigest: chain[4].operation.evidence.targetDigest,
    artifactDigest: chain[4].operation.evidence.artifactDigest,
    manifestDigest: chain[4].operation.evidence.manifestDigest,
    humanActorId: "actor:release-authorizer",
    decisionKind: "human",
    interactionDigest: digest("interaction"),
    authorizationDigest: digest("authorization"),
    authorityAdapterId: "adapter:production",
  });
  add("deployment", canonicalSubject, {
    predecessorEvidenceDigest: chain[5].receipt.evidenceDigest,
    candidateEvidenceDigest: chain[5].operation.evidence.predecessorEvidenceDigest,
    targetDigest: chain[5].operation.evidence.targetDigest,
    artifactDigest: chain[5].operation.evidence.artifactDigest,
    manifestDigest: chain[5].operation.evidence.manifestDigest,
    authorizedActorId: chain[5].operation.evidence.humanActorId,
    controllerId: "controller:release",
    activeControllerId: "controller:release",
    controllerLeaseDigest: digest("controller-lease"),
    deployedArtifactDigest: chain[5].operation.evidence.artifactDigest,
  });
  add("publication", canonicalSubject, {
    predecessorEvidenceDigest: chain[6].receipt.evidenceDigest,
    candidateEvidenceDigest: chain[6].operation.evidence.candidateEvidenceDigest,
    targetDigest: chain[6].operation.evidence.targetDigest,
    deployedArtifactDigest: chain[6].operation.evidence.deployedArtifactDigest,
    controllerId: chain[6].operation.evidence.controllerId,
    observedRuntimeDigest: digest("live-runtime"),
    probesDigest: digest("live-probes"),
    liveVerificationDigest: digest("live-verification"),
    publicationIdentitiesDigest: digest("publication-identities"),
    liveStatus: "verified",
    publicationStatus: "published",
  });
  return chain;

  function add(stage, stageSubject, stageEvidence) {
    const previous = chain.at(-1);
    const checks = checkReceipts(stage, stageSubject.commit);
    const evidence = {
      ...(previous ? { predecessorReceiptDigest: previous.receipt.receiptDigest } : {}),
      ...stageEvidence,
      namedChecksDigest: stableDigest(checks),
      boundary: boundaries[stage],
    };
    const operation = {
      schema: "agentic-sdlc-lifecycle-operation/v1",
      stage,
      policy,
      subject: stageSubject,
      checks,
      predecessor: previous
        ? { operation: previous.operation, receipt: previous.receipt }
        : null,
      predecessorDigest: previous?.receipt.receiptDigest ?? null,
      evidence,
    };
    const receipt = evaluateLifecycleStage(operation);
    assert.equal(receipt.ready, true, `${stage}: ${JSON.stringify(receipt.findings)}`);
    chain.push({ operation, receipt });
  }
}

function subject(commitCharacter, treeCharacter, source, dependencies, collaborationIdentity) {
  return {
    repository: "huijoohwee/agentic-canvas-os",
    commit: commitCharacter.repeat(40),
    tree: treeCharacter.repeat(40),
    sourceDigest: digest(source),
    dependencyClosureDigest: digest(dependencies),
    collaboration: collaborationIdentity,
  };
}

function checkReceipts(stage, commit) {
  return ["contract", "behavior"].map((name, index) => ({
    sequence: index + 1,
    checkId: `${stage}:${name}`,
    subjectCommit: commit,
    commandDigest: digest(`${stage}:${name}:command`),
    resultDigest: digest(`${stage}:${name}:result`),
    status: "passed",
  }));
}

function expectFinding(operation, findingType) {
  const receipt = evaluateLifecycleStage(operation);
  assert.equal(receipt.ready, false);
  assert.ok(receipt.findingCounts[findingType] > 0, JSON.stringify(receipt.findings));
  assert.equal(verifyLifecycleStageReceipt(receipt), true);
}

function clone(value) {
  return structuredClone(value);
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function stableDigest(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
