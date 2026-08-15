import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildActiveDirtyScopeExpansionPlan }
  from "../scripts/active-dirty-scope-expansion-contract.mjs";
import { projectActiveDirtyScopeExpansionSuccessor }
  from "../scripts/active-dirty-scope-expansion-successor-projection.mjs";
import {
  createActiveDirtyScopeExpansionControllerAdapter,
  runActiveDirtyScopeExpansion,
} from "../scripts/active-dirty-scope-expansion-controller.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "../scripts/scoped-lane-admission-lib.mjs";
import { writeTaskAuthorityCapability }
  from "../scripts/task-bound-lane-authority-store.mjs";
import {
  advanceScopeExpansionIntent,
  beginScopeExpansionIntent,
  readScopeExpansionIntent,
  writerLeaseDigest,
} from "../scripts/writer-lease-registry-cas.mjs";
import { createWriterLeaseStore } from "../scripts/writer-lease-lib.mjs";

const BASE = "a".repeat(40);
const FENCE = "b".repeat(40);
const C1 = "1".repeat(64);
const C2 = "2".repeat(64);
const BRANCH = "agent/device/scope-expansion-successor-projection";
const REVIEW = "github-pull-request:PR_projection";
const EXPIRES = "2099-08-15T12:00:00.000Z";

test("C1 lease, task binding, and successor-bound intent become one atomic C2 local-cas projection", () => {
  const fixture = createFixture();
  try {
    const sourceBindingDigest = fixture.sourceLease.taskAuthority.bindingDigest;
    const beforeRevision = fixture.store.readRegistry().revision;
    const result = fixture.project();
    const registry = fixture.store.readRegistry();
    const lease = registry.leases[BRANCH];
    const intent = readScopeExpansionIntent({ leaseStore: fixture.store, branch: BRANCH });

    assert.equal(result.adopted, false);
    assert.equal(registry.revision, beforeRevision + 1);
    assert.equal(lease.cloudAuthority.claimId, C2);
    assert.equal(lease.taskAuthority.bindingMode, "continuation");
    assert.equal(lease.taskAuthority.priorBindingDigest, sourceBindingDigest);
    assert.equal(intent.status, "local-cas");
    assert.equal(intent.localProjection.leaseDigest, writerLeaseDigest(lease));
    assert.equal(intent.localProjection.sourceTaskAuthorityBindingDigest, sourceBindingDigest);
    assert.equal(intent.localProjection.targetTaskAuthorityBindingDigest,
      lease.taskAuthority.bindingDigest);
    assert.match(intent.localProjectionReceiptDigest, /^[0-9a-f]{64}$/u);
    assert.equal(result.intent.localProjectionReceiptDigest,
      intent.localProjectionReceiptDigest);
  } finally {
    fixture.remove();
  }
});

test("response loss re-adopts the exact C2 lease and local-cas intent without another registry write", () => {
  const fixture = createFixture();
  try {
    const first = fixture.project();
    const revision = fixture.store.readRegistry().revision;
    const second = fixture.project();

    assert.equal(first.adopted, false);
    assert.equal(second.adopted, true);
    assert.equal(fixture.store.readRegistry().revision, revision);
    assert.equal(second.projection.leaseDigest, first.projection.leaseDigest);
    assert.equal(second.receiptDigest, first.receiptDigest);
    assert.notEqual(fixture.validationReceipts[0], fixture.validationReceipts[1]);
  } finally {
    fixture.remove();
  }
});

test("wrong capability or failed mutation validation leaves both C1 lease and intent unchanged", () => {
  const fixture = createFixture();
  const otherRoot = realpathSync(mkdtempSync(path.join(
    os.tmpdir(),
    "scope-expansion-other-capability-",
  )));
  try {
    const otherCapability = writeTaskAuthorityCapability({
      outputPath: path.join(otherRoot, "task-authority.json"),
    }).path;
    const before = fixture.store.readRegistry();
    assert.throws(() => fixture.project({ taskAuthorityFile: otherCapability }),
      /does not own the task authority binding/u);
    assert.deepEqual(fixture.store.readRegistry(), before);

    assert.throws(() => fixture.project({
      validateLease: () => { throw new Error("validation failed"); },
    }), /validation failed/u);
    assert.deepEqual(fixture.store.readRegistry(), before);

    assert.throws(() => fixture.project({
      validateLease: lease => mutationReceipt({
        lease,
        authority: fixture.targetAuthority,
        verificationCounter: 3,
        values: { claimId: C1 },
      }),
    }), /returned no receipt/u);
    assert.deepEqual(fixture.store.readRegistry(), before);

    assert.equal(readScopeExpansionIntent({ leaseStore: fixture.store, branch: BRANCH }).status,
      "successor-bound");
  } finally {
    fixture.remove();
    rmSync(otherRoot, { recursive: true, force: true });
  }
});

test("task-bound canonical-base drift fails before intent or cloud effects", async () => {
  const fixture = createFixture();
  try {
    let intentEffects = 0;
    let cloudEffects = 0;
    const state = {
      source: fixture.source,
      intent: null,
      requireTaskAuthoritySuccessor: true,
      reviewRequestId: REVIEW,
      targetCanonicalBaseSha: "f".repeat(40),
      sourceStateDigest: "1".repeat(64),
      targetObservationDigest: "2".repeat(64),
    };
    const effect = () => { cloudEffects += 1; throw new Error("must not run"); };
    const adapter = createActiveDirtyScopeExpansionControllerAdapter({
      readState: () => state,
      beginIntent: () => { intentEffects += 1; throw new Error("must not begin"); },
      markIntent: effect,
      claimWaitingSuccessor: effect,
      retireSource: effect,
      promoteSuccessor: effect,
      bindSuccessor: effect,
      projectLocal: effect,
      projectPullRequest: effect,
      finalize: effect,
    });
    await assert.rejects(() => runActiveDirtyScopeExpansion({
      targetManifest: fixture.targetManifest,
      authorization: "unreachable",
    }, { adapter }), /cannot preserve the C1 stable lane identity/u);
    assert.equal(intentEffects, 0);
    assert.equal(cloudEffects, 0);
  } finally {
    fixture.remove();
  }
});

test("backdated proof time and a capability inside the worktree fail before registry mutation", () => {
  const fixture = createFixture();
  try {
    const before = fixture.store.readRegistry();
    assert.throws(() => fixture.project({
      now: () => new Date("2020-01-01T00:00:00.000Z"),
    }), /execution time is not fresh/u);
    assert.deepEqual(fixture.store.readRegistry(), before);

    const insideCapability = writeTaskAuthorityCapability({
      outputPath: path.join(fixture.worktreePath, "inside-task-authority.json"),
    }).path;
    assert.throws(() => fixture.project({ taskAuthorityFile: insideCapability }),
      /outside the writer worktree/u);
    assert.deepEqual(fixture.store.readRegistry(), before);
  } finally {
    fixture.remove();
  }
});

test("recovery may supply only an exact successor-bound extension and still lands directly at local-cas", () => {
  const fixture = createFixture({ intentStatus: "source-retired" });
  try {
    const current = readScopeExpansionIntent({ leaseStore: fixture.store, branch: BRANCH });
    const successorIntent = fixture.successorIntent(current);
    const result = fixture.project({ successorIntent });
    assert.equal(result.intent.status, "local-cas");
    assert.equal(result.intent.sourceRetirementReceiptDigest,
      current.sourceRetirementReceiptDigest);

    const owner = createFixture({ intentStatus: "source-retired" });
    try {
      const ownerSource = readScopeExpansionIntent({ leaseStore: owner.store, branch: BRANCH });
      const driftedAuthority = { ...owner.targetAuthority, sessionId: "other-session" };
      assert.throws(() => owner.project({
        authority: driftedAuthority,
        successorIntent: owner.successorIntent(ownerSource, driftedAuthority),
      }), /immutable C1 owner identity/u);
      assert.equal(owner.store.read(BRANCH).cloudAuthority.claimId, C1);
    } finally {
      owner.remove();
    }

    const drifted = createFixture({ intentStatus: "source-retired" });
    try {
      const recoverySource = readScopeExpansionIntent({ leaseStore: drifted.store, branch: BRANCH });
      assert.throws(() => drifted.project({
        successorIntent: {
          ...drifted.successorIntent(recoverySource),
          sourceRetirementReceiptDigest: "8".repeat(64),
        },
      }), /changed historical intent field/u);
      assert.equal(drifted.store.read(BRANCH).cloudAuthority.claimId, C1);

      const malformed = drifted.successorIntent(recoverySource);
      assert.throws(() => drifted.project({
        successorIntent: {
          ...malformed,
          promoted: { ...malformed.promoted, claimLedgerRevision: "f".repeat(64) },
        },
      }), /sealed transition evidence/u);
      assert.equal(drifted.store.read(BRANCH).cloudAuthority.claimId, C1);
    } finally {
      drifted.remove();
    }
  } finally {
    fixture.remove();
  }
});

function createFixture({ intentStatus = "successor-bound" } = {}) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "scope-expansion-successor-")));
  const worktreePath = path.join(root, "worktree");
  mkdirSync(worktreePath);
  const capabilityPath = writeTaskAuthorityCapability({
    outputPath: path.join(root, "task-authority.json"),
  }).path;
  const now = () => new Date("2026-08-15T00:00:00.000Z");
  const store = createWriterLeaseStore({
    gitCommonDir: root,
    now,
    taskAuthorityFile: capabilityPath,
    taskAuthorityPolicy: "required",
  });
  const sourceManifest = manifest(["scripts/source.mjs"]);
  const targetManifest = manifest(["scripts/source.mjs", "scripts/target.mjs"]);
  const sourceAuthority = authority({
    claimId: C1,
    claimDigest: "3".repeat(64),
    manifest: sourceManifest,
    transitionCounter: 3,
    operationReceiptDigest: "4".repeat(64),
  });
  const sourceAdmission = admission({
    manifest: sourceManifest,
    planReceiptDigest: "5".repeat(64),
    admissionReceiptDigest: sourceAuthority.operationReceiptDigest,
  });
  let sourceLease = store.claim({
    sessionId: "session",
    device: "device",
    scope: "scope-expansion-successor-projection",
    branch: BRANCH,
    worktreePath,
    baseSha: BASE,
    admission: sourceAdmission,
    cloudAuthority: sourceAuthority,
  });
  sourceLease = store.annotate({
    sessionId: "session",
    branch: BRANCH,
    values: { fenceSha: FENCE, pullRequestUrl: "https://github.com/o/r/pull/1" },
  });
  const source = {
    lease: sourceLease,
    branch: BRANCH,
    fenceSha: FENCE,
    claimId: C1,
    claimDigest: sourceAuthority.claimDigest,
    changedPaths: ["scripts/source.mjs"],
    untrackedPaths: [],
    dirtyDigest: "6".repeat(64),
  };
  const plan = buildActiveDirtyScopeExpansionPlan({
    source,
    targetManifest,
    targetCanonicalBaseSha: BASE,
  });
  const targetAuthority = authority({
    claimId: C2,
    claimDigest: "7".repeat(64),
    manifest: targetManifest,
    transitionCounter: 3,
    operationReceiptDigest: "8".repeat(64),
  });
  beginScopeExpansionIntent({
    leaseStore: store,
    branch: BRANCH,
    expectedLeaseDigest: plan.sourceLeaseDigest,
    expectedClaimId: C1,
    plan,
  });
  const waiting = claimSnapshot({
    claimId: C2,
    claimDigest: "0".repeat(64),
    transitionCounter: 1,
  });
  const promoted = {
    claimId: C2,
    claimDigest: "6".repeat(64),
    ledgerRevision: "6".repeat(40),
    claimLedgerRevision: "5".repeat(64),
    transitionCounter: 2,
    expiresAt: targetAuthority.expiresAt,
  };
  const successorValues = {
    promoted,
    promotedReceiptDigest: "a".repeat(64),
    boundAuthority: targetAuthority,
    boundReceiptDigest: "b".repeat(64),
    targetClaimId: C2,
    targetClaimDigest: targetAuthority.claimDigest,
    targetReviewRequestId: REVIEW,
  };
  const phaseValues = intentStatus === "source-retired"
    ? {
      status: "source-retired",
      waiting,
      waitingReceiptDigest: "9".repeat(64),
      sourceRetirementReceiptDigest: "c".repeat(64),
      targetClaimId: C2,
      targetClaimDigest: waiting.claimDigest,
    }
    : {
      status: "successor-bound",
      waiting,
      waitingReceiptDigest: "9".repeat(64),
      sourceRetirementReceiptDigest: "c".repeat(64),
      ...successorValues,
    };
  advanceScopeExpansionIntent({
    leaseStore: store,
    branch: BRANCH,
    expectedLeaseDigest: plan.sourceLeaseDigest,
    expectedClaimId: C1,
    expectedPlanDigest: plan.planDigest,
    values: phaseValues,
  });
  const successorIntent = (current, boundAuthority = targetAuthority) => ({
    ...current,
    status: "successor-bound",
    targetClaimDigest: boundAuthority.claimDigest,
    targetReviewRequestId: REVIEW,
    ...successorValues,
    boundAuthority,
  });
  let validationCounter = 0;
  const validationReceipts = [];
  const project = (overrides = {}) => projectActiveDirtyScopeExpansionSuccessor({
    leaseStore: store,
    branch: BRANCH,
    expectedLeaseDigest: plan.sourceLeaseDigest,
    expectedClaimId: C1,
    plan,
    authority: targetAuthority,
    taskAuthorityFile: capabilityPath,
    ...(intentStatus === "source-retired" ? { promotedEvidence: promoted } : {}),
    validateLease: lease => {
      const receipt = mutationReceipt({
        lease,
        authority: targetAuthority,
        verificationCounter: ++validationCounter,
      });
      validationReceipts.push(receipt.receiptDigest);
      return receipt;
    },
    ...overrides,
  });
  return {
    store,
    sourceLease,
    source,
    plan,
    targetAuthority,
    targetManifest,
    validationReceipts,
    worktreePath,
    successorIntent,
    project,
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}

function claimSnapshot({ claimId, claimDigest, transitionCounter }) {
  return {
    claimId,
    claimDigest,
    ledgerRevision: String(transitionCounter + 4).repeat(40),
    claimLedgerRevision: String(transitionCounter + 5).repeat(64),
    transitionCounter,
    expiresAt: EXPIRES,
  };
}

function mutationReceipt({ lease, authority: value, verificationCounter, values = {} }) {
  const core = {
    schema: "agentic-admission-mutation-authority/v1",
    status: "ready",
    claimId: value.claimId,
    claimDigest: value.claimDigest,
    ledgerRevision: value.ledgerRevision,
    localLeaseEpoch: lease.epoch,
    localFenceSha: lease.fenceSha,
    remoteLeaseEpoch: value.leaseEpoch,
    cloudVerificationReceiptDigest: digestValue({ verificationCounter }),
    evaluatedAt: new Date().toISOString(),
    expiresAt: value.expiresAt,
    ...values,
  };
  return { ...core, receiptDigest: digestValue(core) };
}

function manifest(paths) {
  return normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "scope-expansion-successor-projection",
    paths,
  });
}

function admission({ manifest: value, planReceiptDigest, admissionReceiptDigest }) {
  return {
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: "scope-expansion-successor-projection",
    declaredWriteSet: value.declaredWriteSet,
    writeSetDigest: value.writeSetDigest,
    manifestDigest: value.manifestDigest,
    planReceiptDigest,
    admissionReceiptDigest,
    existingLaneStateDigest: "d".repeat(64),
    admittedReportDigest: "e".repeat(64),
    preservationReceiptDigest: "f".repeat(64),
  };
}

function authority({
  claimId,
  claimDigest,
  manifest: value,
  transitionCounter,
  operationReceiptDigest,
}) {
  return {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "o/ledger",
    targetRepository: "o/r",
    claimId,
    claimDigest,
    ledgerRevision: String(transitionCounter).repeat(40),
    ledgerDigest: String(transitionCounter).repeat(64),
    claimLedgerRevision: String(transitionCounter + 2).repeat(64),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest,
    mutationAuthorityEligible: true,
    canonicalBaseSha: BASE,
    laneRevision: FENCE,
    cloudDeclaredWriteScope: value.declaredWriteSet,
    writeSetDigest: value.writeSetDigest,
    deviceId: "device",
    sessionId: "session",
    reviewRequestId: REVIEW,
    leaseEpoch: 1,
    transitionCounter,
    heartbeatCounter: 0,
    state: "active",
    expiresAt: EXPIRES,
    integrationReceiptDigest: null,
    integration: null,
    manifestDigest: value.manifestDigest,
  };
}
