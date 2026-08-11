// Responsibility: Verify byte-exact recovery authorization, monotonic intent replay, receipts, and schemas.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_PHASES,
  advanceExpiredActiveDirtyScopeExpansionRecoveryIntent,
  authorizeExpiredActiveDirtyScopeExpansionRecovery,
  buildExpiredActiveDirtyScopeExpansionRecoveryNoEffectSupersessionReceipt,
  buildExpiredActiveDirtyScopeExpansionRecoveryPlan,
  buildExpiredActiveDirtyScopeExpansionRecoveryReceipt,
  createExpiredActiveDirtyScopeExpansionRecoveryIntent,
  expiredActiveDirtyScopeExpansionRecoveryOperationKey,
  normalizeExpiredActiveDirtyScopeExpansionRecoveryIntent,
  normalizeExpiredActiveDirtyScopeExpansionRecoveryNoEffectSupersessionReceipt,
  normalizeExpiredActiveDirtyScopeExpansionRecoveryPlan,
  normalizeExpiredActiveDirtyScopeExpansionRecoveryReceipt,
} from "../scripts/expired-active-dirty-scope-expansion-recovery-contract.mjs";
import {
  EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_PHASE_OBSERVATION_SCHEMA,
  buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence,
} from "../scripts/expired-active-dirty-scope-expansion-recovery-evidence.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";

const digest = label => digestValue({ label });
const sha = label => digest(label).slice(0, 40);

test("plan embeds exact source evidence and derives one byte-exact token", () => {
  const plan = planFixture();
  assert.deepEqual(normalizeExpiredActiveDirtyScopeExpansionRecoveryPlan(plan), plan);
  assert.deepEqual(EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_PHASES, [
    "cloud-recovered", "local-rebound", "pr-projected", "complete",
  ]);
  assert.equal(
    plan.exactAuthorization,
    `authorize expired-active-dirty-scope-expansion-recovery ${plan.planDigest}`,
  );
  assert.equal(plan.sourceEvidenceDigest, plan.sourceEvidence.sourceEvidenceDigest);
  assert.equal(plan.ttlSeconds, 1_800);

  const extra = { ...plan, ignored: true };
  assert.throws(
    () => normalizeExpiredActiveDirtyScopeExpansionRecoveryPlan(extra),
    /unexpected or missing fields/u,
  );
  const changedTtl = { ...plan, ttlSeconds: 1_801 };
  assert.throws(
    () => normalizeExpiredActiveDirtyScopeExpansionRecoveryPlan(changedTtl),
    /digest or exact authorization drifted/u,
  );
  assert.throws(
    () => buildExpiredActiveDirtyScopeExpansionRecoveryPlan({
      sourceEvidence: plan.sourceEvidence,
      ttlSeconds: 59,
    }),
    /Recovery TTL/u,
  );
});

test("authorization rejects every byte variation and seals its source", () => {
  const plan = planFixture();
  const receipt = authorizeExpiredActiveDirtyScopeExpansionRecovery(
    plan,
    plan.exactAuthorization,
  );
  assert.equal(receipt.planDigest, plan.planDigest);
  assert.equal(receipt.sourceEvidenceDigest, plan.sourceEvidenceDigest);
  assert.equal(receipt.operatorDecisionDigest, plan.planDigest);
  for (const changed of [
    ` ${plan.exactAuthorization}`,
    `${plan.exactAuthorization} `,
    `${plan.exactAuthorization}\n`,
    plan.exactAuthorization.toUpperCase(),
  ]) {
    assert.throws(
      () => authorizeExpiredActiveDirtyScopeExpansionRecovery(plan, changed),
      /exact authorization/u,
    );
  }
  assert.throws(
    () => createExpiredActiveDirtyScopeExpansionRecoveryIntent(
      plan,
      { ...receipt, ignored: true },
    ),
    /unexpected or missing fields/u,
  );
  const forgedIntent = structuredClone(
    createExpiredActiveDirtyScopeExpansionRecoveryIntent(plan, receipt),
  );
  forgedIntent.authorizationDigest = digest("forged authorization");
  resealIntent(forgedIntent);
  assert.throws(
    () => normalizeExpiredActiveDirtyScopeExpansionRecoveryIntent(forgedIntent),
    /malformed or digest-invalid/u,
  );
});

test("operation keys bind authorization and phase", () => {
  const fixture = authorizedFixture();
  const first = expiredActiveDirtyScopeExpansionRecoveryOperationKey(
    fixture.plan.planDigest,
    fixture.authorization.authorizationDigest,
    "cloud-recovered",
  );
  assert.notEqual(
    first,
    expiredActiveDirtyScopeExpansionRecoveryOperationKey(
      fixture.plan.planDigest,
      digest("other authorization"),
      "cloud-recovered",
    ),
  );
  assert.notEqual(
    first,
    expiredActiveDirtyScopeExpansionRecoveryOperationKey(
      fixture.plan.planDigest,
      fixture.authorization.authorizationDigest,
      "local-rebound",
    ),
  );
});

test("intent advances in order and permits only identical phase replay", () => {
  const fixture = authorizedFixture();
  assert.deepEqual(
    normalizeExpiredActiveDirtyScopeExpansionRecoveryIntent(fixture.intent),
    fixture.intent,
  );
  assert.throws(
    () => advanceExpiredActiveDirtyScopeExpansionRecoveryIntent(
      fixture.intent,
      "local-rebound",
      observationFixture(fixture, "local-rebound"),
    ),
    /cannot advance/u,
  );
  let intent = fixture.intent;
  for (const phase of EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_PHASES) {
    const observation = observationFixture({ ...fixture, intent }, phase);
    intent = advanceExpiredActiveDirtyScopeExpansionRecoveryIntent(
      intent,
      phase,
      observation,
    );
    const replay = advanceExpiredActiveDirtyScopeExpansionRecoveryIntent(
      intent,
      phase,
      observation,
    );
    assert.equal(replay.intentDigest, intent.intentDigest);
  }
  const changed = structuredClone(intent.phases.complete.observation);
  changed.values.liveStateDigest = digest("changed live state");
  resealObservation(changed);
  assert.throws(
    () => advanceExpiredActiveDirtyScopeExpansionRecoveryIntent(
      intent,
      "complete",
      changed,
    ),
    /replay drifted/u,
  );
});

test("terminal receipt deterministically binds every phase and complete intent", () => {
  const complete = completeIntentFixture();
  const receipt = buildExpiredActiveDirtyScopeExpansionRecoveryReceipt(complete);
  assert.equal(receipt.completeIntentDigest, complete.intentDigest);
  assert.deepEqual(
    normalizeExpiredActiveDirtyScopeExpansionRecoveryReceipt(receipt, complete),
    receipt,
  );
  const extra = { ...receipt, ignored: true };
  assert.throws(
    () => normalizeExpiredActiveDirtyScopeExpansionRecoveryReceipt(extra),
    /unexpected or missing fields/u,
  );
  const tampered = { ...receipt, completionObservationDigest: digest("forged") };
  resealReceipt(tampered);
  assert.throws(
    () => normalizeExpiredActiveDirtyScopeExpansionRecoveryReceipt(
      tampered,
      complete,
    ),
    /changed its complete intent/u,
  );
  const forgedAuthorization = {
    ...receipt,
    authorizationDigest: digest("forged authorization"),
  };
  resealReceipt(forgedAuthorization);
  assert.throws(
    () => normalizeExpiredActiveDirtyScopeExpansionRecoveryReceipt(
      forgedAuthorization,
    ),
    /malformed or digest-invalid/u,
  );
  const forgedOperation = {
    ...receipt,
    localReboundOperationKey: digest("forged operation key"),
  };
  resealReceipt(forgedOperation);
  assert.throws(
    () => normalizeExpiredActiveDirtyScopeExpansionRecoveryReceipt(forgedOperation),
    /malformed or digest-invalid/u,
  );
  const incomplete = authorizedFixture().intent;
  assert.throws(
    () => buildExpiredActiveDirtyScopeExpansionRecoveryReceipt(incomplete),
    /complete intent/u,
  );
});

test("authorized no-effect supersession seals an exact unchanged dormant target", () => {
  const superseded = authorizedFixture();
  const successorSource = structuredClone(superseded.plan.sourceEvidence);
  successorSource.controller.implementationDigest = digest("successor implementation");
  const successorPlan = buildExpiredActiveDirtyScopeExpansionRecoveryPlan({
    sourceEvidence: buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(successorSource),
    ttlSeconds: 1_800,
  });
  const expected = { supersededIntent: superseded.intent, successorPlan };
  const receipt = buildExpiredActiveDirtyScopeExpansionRecoveryNoEffectSupersessionReceipt(expected);
  assert.equal(receipt.recoveryEvidenceDigest, null);
  assert.equal(receipt.claimDigest, superseded.plan.sourceEvidence.cloud.claim.claimDigest);
  assert.deepEqual(
    normalizeExpiredActiveDirtyScopeExpansionRecoveryNoEffectSupersessionReceipt(receipt, expected),
    receipt,
  );
  assert.throws(
    () => normalizeExpiredActiveDirtyScopeExpansionRecoveryNoEffectSupersessionReceipt(
      { ...receipt, ignored: true }, expected,
    ),
    /unexpected or missing fields/u,
  );
  assert.throws(
    () => normalizeExpiredActiveDirtyScopeExpansionRecoveryNoEffectSupersessionReceipt(
      { ...receipt, successorPlanDigest: digest("forged successor") }, expected,
    ),
    /drifted/u,
  );
  assert.throws(
    () => buildExpiredActiveDirtyScopeExpansionRecoveryNoEffectSupersessionReceipt({
      supersededIntent: completeIntentFixture(), successorPlan,
    }),
    /exact unchanged dormant target claim/u,
  );
  const sameSourcePlan = buildExpiredActiveDirtyScopeExpansionRecoveryPlan({
    sourceEvidence: superseded.plan.sourceEvidence, ttlSeconds: 1_801,
  });
  assert.throws(
    () => buildExpiredActiveDirtyScopeExpansionRecoveryNoEffectSupersessionReceipt({
      supersededIntent: superseded.intent, successorPlan: sameSourcePlan,
    }),
    /exact unchanged dormant target claim/u,
  );
  const recoveredSource = structuredClone(successorSource);
  recoveredSource.cloud.claim.recovery = {
    evidenceDigest: receipt.supersededCloudOperationKey,
    recoveredAt: "2026-08-09T00:01:00.000Z",
  };
  const recoveredPlan = buildExpiredActiveDirtyScopeExpansionRecoveryPlan({
    sourceEvidence: buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence(recoveredSource),
    ttlSeconds: 1_800,
  });
  assert.throws(
    () => buildExpiredActiveDirtyScopeExpansionRecoveryNoEffectSupersessionReceipt({
      supersededIntent: superseded.intent, successorPlan: recoveredPlan,
    }),
    /exact unchanged dormant target claim/u,
  );
});

test("plan and receipt schemas match exact top-level runtime artifacts", () => {
  const plan = planFixture();
  const receipt = buildExpiredActiveDirtyScopeExpansionRecoveryReceipt(
    completeIntentFixture(),
  );
  const planSchema = readSchema(
    "expired-active-dirty-scope-expansion-recovery-plan.v1.schema.json",
  );
  const receiptSchema = readSchema(
    "expired-active-dirty-scope-expansion-recovery-receipt.v1.schema.json",
  );
  assert.equal(validatesTopLevel(planSchema, plan), true);
  assert.equal(validatesTopLevel(receiptSchema, receipt), true);
  assert.equal(validatesTopLevel(planSchema, { ...plan, ignored: true }), false);
  assert.equal(validatesTopLevel(receiptSchema, { ...receipt, ignored: true }), false);
  assert.equal(planSchema.properties.sourceEvidence.additionalProperties, false);
  assert.deepEqual(
    [...planSchema.properties.sourceEvidence.required].sort(),
    Object.keys(plan.sourceEvidence).sort(),
  );
  assert.match(planSchema.responsibility, /exact source-evidence-bound/u);
  assert.match(receiptSchema.responsibility, /deterministic terminal receipt/u);
});

function authorizedFixture() {
  const plan = planFixture();
  const authorization = authorizeExpiredActiveDirtyScopeExpansionRecovery(
    plan,
    plan.exactAuthorization,
  );
  const intent = createExpiredActiveDirtyScopeExpansionRecoveryIntent(
    plan,
    authorization,
  );
  return { authorization, intent, plan };
}

function completeIntentFixture() {
  const fixture = authorizedFixture();
  let intent = fixture.intent;
  for (const phase of EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_PHASES) {
    intent = advanceExpiredActiveDirtyScopeExpansionRecoveryIntent(
      intent,
      phase,
      observationFixture({ ...fixture, intent }, phase),
    );
  }
  return intent;
}

function planFixture() {
  return buildExpiredActiveDirtyScopeExpansionRecoveryPlan({
    sourceEvidence: sourceEvidenceFixture(),
    ttlSeconds: 1_800,
  });
}

function sourceEvidenceFixture() {
  const branch = "agent/device/source-scope";
  const headSha = sha("source head");
  const baseSha = sha("source base");
  const treeSha = sha("same tree");
  const writeSet = ["path:scripts/source.mjs", "semantic:source-scope"];
  const rawDevice = "device";
  const rawSession = "source-session";
  const claim = {
    claimId: digest("claim"),
    claimDigest: digest("claim fence"),
    state: "dormant-preserved",
    recordedState: "current",
    writeAuthority: false,
    scopeReserved: true,
    actorId: "github-user:42",
    deviceId: pseudonymousIdentifier("device", rawDevice),
    sessionId: pseudonymousIdentifier("session", rawSession),
    repositoryId: "github-repository:R_repo",
    workItemId: "work-item:source",
    canonicalBaseRevision: baseSha,
    laneRevision: headSha,
    declaredWriteScope: writeSet,
    writeSetDigest: digestValue(writeSet),
    leaseEpoch: 1,
    transitionCounter: 3,
    heartbeatCounter: 2,
    reviewRequestId: "github-pull-request:PR_source",
    expiresAt: "2026-08-09T00:00:00.000Z",
    transitionDigest: digest("claim transition"),
    operationReceiptDigest: digest("claim operation"),
    recovery: null,
  };
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 225,
    sessionId: rawSession,
    device: rawDevice,
    scope: "source-scope",
    branch,
    worktreePath: "/workspace/source",
    baseSha,
    fenceSha: headSha,
    pullRequestUrl: "https://github.com/owner/repository/pull/358",
    heartbeatAt: "2026-08-08T23:30:00.000Z",
    expiresAt: claim.expiresAt,
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
      declaredWriteSet: writeSet,
      writeSetDigest: digestValue(writeSet),
    },
    cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1",
      ledgerRepository: "owner/repository",
      claimId: claim.claimId,
      claimDigest: claim.claimDigest,
      transitionCounter: claim.transitionCounter,
      laneRevision: headSha,
      canonicalBaseSha: baseSha,
      deviceId: rawDevice,
      sessionId: rawSession,
      reviewRequestId: claim.reviewRequestId,
    },
  };
  const leaseDigest = writerLeaseDigest(lease);
  return buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence({
    controller: {
      path: "/workspace/controller",
      origin: "git@github.com:owner/repository.git",
      targetRepository: "owner/repository",
      headSha: sha("controller"),
      originMainSha: sha("controller"),
      remoteMainSha: sha("controller"),
      treeSha: sha("controller tree"),
      clean: true,
      implementationDigest: digest("implementation"),
    },
    lane: {
      path: lease.worktreePath,
      branch,
      headSha,
      treeSha,
      parentSha: baseSha,
      parentTreeSha: treeSha,
      parentCount: 1,
      remoteHeadSha: headSha,
      detached: false,
      dirty: true,
      invalid: false,
      indexDigest: digest("lane index"),
      workingTreeDigest: digest("lane worktree"),
      stateDigest: digest("lane state"),
    },
    lease,
    leaseDigest,
    cloud: {
      ledgerRepository: "owner/repository",
      ledgerRevision: sha("ledger"),
      ledgerDigest: digest("ledger"),
      sequence: 10,
      claim,
      peers: [],
      authenticatedActor: { actorId: claim.actorId, login: "owner" },
    },
    pullRequest: {
      number: 358,
      nodeId: "PR_source",
      url: lease.pullRequestUrl,
      state: "OPEN",
      isDraft: true,
      baseRepository: "owner/repository",
      baseRefName: "main",
      baseRefOid: sha("controller"),
      headRefName: branch,
      headRefOid: headSha,
      headRepository: "owner/repository",
      markerLeaseDigest: leaseDigest,
      bodyFrameDigest: digest("body frame"),
    },
    dirt: {
      statusDigest: digest("status"),
      indexDigest: digest("dirt index"),
      unstagedDiffDigest: digest("unstaged"),
      stagedDiffDigest: digest("staged"),
      worktreeObjectsDigest: digest("objects"),
      changedPaths: ["scripts/source.mjs"],
      untrackedPaths: [],
      ownedDirtDigest: digest("owned dirt"),
      pathCount: 1,
    },
    scopeExpansionIntent: null,
  });
}

function observationFixture(fixture, phase) {
  const operationKey = expiredActiveDirtyScopeExpansionRecoveryOperationKey(
    fixture.plan.planDigest,
    fixture.authorization.authorizationDigest,
    phase,
  );
  const core = {
    schema: EXPIRED_ACTIVE_DIRTY_SCOPE_EXPANSION_RECOVERY_PHASE_OBSERVATION_SCHEMA,
    state: "complete",
    phase,
    planDigest: fixture.plan.planDigest,
    operationKey,
    sourceEvidenceDigest: fixture.plan.sourceEvidenceDigest,
    values: {
      operationKey,
      evidenceDigest: digest(`${phase} evidence`),
      liveStateDigest: digest(`${phase} live`),
      claimDigest: digest(`${phase} claim`),
      leaseDigest: digest(`${phase} lease`),
      pullRequestMarkerLeaseDigest: digest(`${phase} marker`),
      mutationAuthorityProjectionDigest:
        phase === "complete" ? digest("mutation authority") : null,
    },
  };
  return { ...core, observationDigest: digestValue(core) };
}

function resealObservation(observation) {
  const { observationDigest: ignored, ...core } = observation;
  observation.observationDigest = digestValue(core);
}

function resealReceipt(receipt) {
  const { receiptDigest: ignored, ...core } = receipt;
  receipt.receiptDigest = digestValue(core);
}

function resealIntent(intent) {
  const { intentDigest: ignored, ...core } = intent;
  intent.intentDigest = digestValue(core);
}

function readSchema(name) {
  return JSON.parse(readFileSync(new URL(`../docs/schemas/${name}`, import.meta.url), "utf8"));
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
