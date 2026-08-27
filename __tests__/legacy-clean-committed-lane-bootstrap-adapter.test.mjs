import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { digestValue, normalizeWriteSet } from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import { normalizeCloudAuthority } from "../scripts/scoped-lane-admission-lib.mjs";
import { assertTaskAuthorityBinding } from "../scripts/task-bound-lane-authority-contract.mjs";
import { writeTaskAuthorityCapability } from "../scripts/task-bound-lane-authority-store.mjs";
import { createWriterLeaseStore } from "../scripts/writer-lease-lib.mjs";
import { adoptLegacyBootstrapTaskBindingContinuation, legacyBootstrapAuthorityNeedsProjection,
  legacyBootstrapLeaseProjectionValues, legacyBootstrapPredecessorDescendantProof,
  normalizeLegacyBootstrapLiveAuthority, projectCloudAuthorityAndTaskBinding,
  projectedLegacyBootstrapClaimIds, requireLegacyBootstrapProtectedBaseProof,
  requireLegacyBootstrapProtectedBaseSubject,
  requireLegacyBootstrapContinuationPrefix,
  requireCurrentLegacyBootstrapTaskBindingContinuation,
  recoverDormantLegacyBootstrapClaim,
  requireLegacyBootstrapAdoptedFinalRefresh,
  runLegacyBootstrapFinalReconciliationSequence,
  verifyLegacyBootstrapFinalBoundary }
  from "../scripts/legacy-clean-committed-lane-bootstrap-adapter.mjs";
import {
  createLegacyBootstrapRecoveryRequest,
  findLegacyBootstrapCheckpointClaim,
  findRecoverableLegacyBootstrapClaim,
  findLegacyReviewCurrentBaseCandidate,
  legacyBootstrapAdmissionManifest,
  legacyBootstrapRecoveryEvidenceDigest,
  proveLegacyReviewCanonicalDescendant,
  projectRecoveredLegacyBootstrapResult,
  requireRecoveredLegacyBootstrapClaim,
} from "../scripts/legacy-clean-committed-lane-bootstrap-adapter-lib.mjs";

const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const TREE_SHA = "9".repeat(40);
const CLAIM_ID = "c".repeat(64);
const FENCE_REVISION = "d".repeat(64);
const OPERATION_RECEIPT_DIGEST = "e".repeat(64);
const IDENTITY_DIGEST = "f".repeat(64);
const TEST_CONTINUATION_SIGNATURE = Buffer.alloc(64, 7).toString("base64");
const BRANCH = "agent/device.local/legacy-bootstrap-response-loss-adoption";
const DECLARED_WRITE_SCOPE = normalizeWriteSet([
  "path:scripts/legacy-clean-committed-lane-bootstrap-adapter.mjs",
  "semantic:legacy-bootstrap-response-loss-adoption",
]);
const REQUEST = Object.freeze({
  targetRepository: "owner/repository",
  ledgerRepository: "owner/repository",
  sessionId: "session-1",
  deviceId: "device.local",
  semanticScope: "legacy-bootstrap-response-loss-adoption",
  branch: BRANCH,
  expectedBaseSha: BASE_SHA,
  expectedHeadSha: HEAD_SHA,
  expectedTreeSha: TREE_SHA,
  declaredWriteScope: DECLARED_WRITE_SCOPE,
  writeSetDigest: digestValue(DECLARED_WRITE_SCOPE),
});
const IDENTITY = Object.freeze({ identityDigest: IDENTITY_DIGEST });
const CHECKPOINT = Object.freeze({
  schema: "agentic-legacy-clean-committed-lane-bootstrap-checkpoint/v1",
  status: "prepared",
  identity: IDENTITY,
  outputs: {},
});

function claim(overrides = {}) {
  return {
    claimId: CLAIM_ID,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    state: "current",
    writeAuthority: true,
    scopeReserved: true,
    deviceId: pseudonymousIdentifier("device", REQUEST.deviceId),
    sessionId: pseudonymousIdentifier("session", REQUEST.sessionId),
    workItemId: pseudonymousIdentifier("work-item", REQUEST.branch),
    canonicalBaseRevision: BASE_SHA,
    laneRevision: BASE_SHA,
    declaredWriteScope: DECLARED_WRITE_SCOPE,
    writeSetDigest: REQUEST.writeSetDigest,
    leaseEpoch: 1,
    transitionCounter: 1,
    heartbeatCounter: 0,
    reviewRequestId: null,
    predecessorClaimId: null,
    expiresAt: "2099-01-01T00:00:00.000Z",
    fenceRevision: FENCE_REVISION,
    transitionDigest: "1".repeat(64),
    operationReceiptDigest: OPERATION_RECEIPT_DIGEST,
    integrationReceiptDigest: null,
    integration: null,
    ...overrides,
  };
}

test("prepared bootstrap adopts only its exact response-ahead claim", () => {
  const exact = claim();
  assert.equal(findRecoverableLegacyBootstrapClaim({
    claims: [claim({ claimId: "0".repeat(64), sessionId: "session:foreign" }), exact],
    request: REQUEST,
    checkpoint: CHECKPOINT,
    identity: IDENTITY,
    canonicalBaseSha: BASE_SHA,
  }), exact);
  assert.equal(findRecoverableLegacyBootstrapClaim({
    claims: [exact],
    request: REQUEST,
    checkpoint: { ...CHECKPOINT, outputs: { cloudClaim: {} } },
    identity: IDENTITY,
    canonicalBaseSha: BASE_SHA,
  }), null);
});

test("dormant response-ahead recovery request is content-bound and stable", () => {
  const dormant = claim({ state: "dormant-preserved", writeAuthority: false });
  const request = createLegacyBootstrapRecoveryRequest({
    claim: dormant,
    request: REQUEST,
    identity: IDENTITY,
  });
  assert.equal(request.claimId, CLAIM_ID);
  assert.equal(request.expectedFenceRevision, FENCE_REVISION);
  assert.equal(request.expectedTransitionCounter, 1);
  assert.equal(request.mode, "recovery");
  assert.equal(request.recoveryEvidenceDigest,
    legacyBootstrapRecoveryEvidenceDigest({ request: REQUEST, identity: IDENTITY }));
  assert.match(request.idempotencyKey,
    /^legacy-bootstrap-response-loss-recovery:[0-9a-f]{64}:[0-9a-f]{64}:1:[0-9a-f]{64}$/u);
});

test("recovery adoption accepts only the exact counter-plus-one authority", () => {
  const dormant = claim({ state: "dormant-preserved", writeAuthority: false });
  const recovered = claim({
    transitionCounter: 2,
    fenceRevision: "2".repeat(64),
    transitionDigest: "3".repeat(64),
    recovery: {
      evidenceDigest: legacyBootstrapRecoveryEvidenceDigest({
        request: REQUEST,
        identity: IDENTITY,
      }),
    },
  });
  assert.equal(requireRecoveredLegacyBootstrapClaim({
    claim: recovered,
    sourceClaim: dormant,
    request: REQUEST,
    identity: IDENTITY,
    canonicalBaseSha: BASE_SHA,
  }), recovered);
  const result = projectRecoveredLegacyBootstrapResult({
    statusResult: { ledgerRevision: "3".repeat(40), ledgerDigest: "4".repeat(64) },
    claim: recovered,
  });
  assert.equal(result.action, "continue");
  assert.equal(result.claimDigest, recovered.fenceRevision);
  const authority = normalizeCloudAuthority({
    ledgerRepository: REQUEST.ledgerRepository,
    targetRepository: REQUEST.targetRepository,
    result,
  }, {
    canonicalBaseSha: BASE_SHA,
    manifest: {
      declaredWriteSet: DECLARED_WRITE_SCOPE,
      writeSetDigest: REQUEST.writeSetDigest,
    },
  });
  assert.equal(authority.state, "active");
  assert.equal(authority.claimId, CLAIM_ID);
  assert.throws(() => requireRecoveredLegacyBootstrapClaim({
    claim: { ...recovered, laneRevision: HEAD_SHA },
    sourceClaim: dormant,
    request: REQUEST,
    identity: IDENTITY,
    canonicalBaseSha: BASE_SHA,
  }), /changed its exact response-loss subject/u);
});

test("dormant successor recovery preserves predecessor proof through response loss", () => {
  const predecessorClaimId = "8".repeat(64);
  const canonicalDescendantProof = {
    schema: "agentic-legacy-review-current-base-disjoint-proof/v1",
    evidenceDigest: "9".repeat(64),
  };
  const dormant = claim({
    state: "dormant-preserved",
    writeAuthority: false,
    predecessorClaimId,
    canonicalDescendantProof,
  });
  const recovered = claim({
    transitionCounter: 2,
    fenceRevision: "2".repeat(64),
    transitionDigest: "3".repeat(64),
    predecessorClaimId,
    canonicalDescendantProof,
    recovery: {
      evidenceDigest: legacyBootstrapRecoveryEvidenceDigest({
        request: REQUEST,
        identity: IDENTITY,
      }),
    },
  });
  assert.equal(requireRecoveredLegacyBootstrapClaim({
    claim: recovered,
    sourceClaim: dormant,
    request: REQUEST,
    identity: IDENTITY,
    canonicalBaseSha: BASE_SHA,
  }), recovered);

  let continuationCalls = 0;
  let inventoryCalls = 0;
  const responseLoss = recoverDormantLegacyBootstrapClaim({
    claim: dormant,
    request: REQUEST,
    identity: IDENTITY,
    canonicalBaseSha: BASE_SHA,
    expectedLaneRevision: BASE_SHA,
    expectedReviewRequestId: null,
  }, {
    continueCloud: ({ recoveryRequest }) => {
      continuationCalls += 1;
      assert.equal(recoveryRequest.claimId, dormant.claimId);
      throw new Error("provider response lost");
    },
    readInventory: () => {
      inventoryCalls += 1;
      return {
        result: {
          ledgerRevision: "4".repeat(40),
          ledgerDigest: "5".repeat(64),
        },
        claims: [recovered],
      };
    },
  });
  assert.equal(responseLoss.claim, recovered);
  assert.equal(continuationCalls, 1);
  assert.equal(inventoryCalls, 1);
  for (const drifted of [
    { ...recovered, predecessorClaimId: "7".repeat(64) },
    { ...recovered, canonicalDescendantProof: { ...canonicalDescendantProof,
      evidenceDigest: "6".repeat(64) } },
  ]) {
    assert.throws(() => requireRecoveredLegacyBootstrapClaim({
      claim: drifted,
      sourceClaim: dormant,
      request: REQUEST,
      identity: IDENTITY,
      canonicalBaseSha: BASE_SHA,
    }), /changed its exact response-loss subject/u);
  }
});

test("authored-head live authority normalization accepts base distinct from head only exactly", () => {
  const authored = claim({
    laneRevision: HEAD_SHA,
    transitionCounter: 2,
    fenceRevision: "2".repeat(64),
    transitionDigest: "3".repeat(64),
  });
  const result = projectRecoveredLegacyBootstrapResult({
    statusResult: {
      ledgerRevision: "4".repeat(40),
      ledgerDigest: "5".repeat(64),
    },
    claim: authored,
  });
  const manifest = legacyBootstrapAdmissionManifest(REQUEST);
  const authority = normalizeLegacyBootstrapLiveAuthority({
    result,
    seedAuthority: {
      ledgerRepository: REQUEST.ledgerRepository,
      targetRepository: REQUEST.targetRepository,
    },
    manifest,
    request: REQUEST,
    canonicalBaseSha: BASE_SHA,
    expectedLaneRevision: HEAD_SHA,
  });
  assert.equal(authority.canonicalBaseSha, BASE_SHA);
  assert.equal(authority.laneRevision, HEAD_SHA);
  assert.equal(authority.state, "active");
  const baseRevisionResult = projectRecoveredLegacyBootstrapResult({
    statusResult: {
      ledgerRevision: "6".repeat(40),
      ledgerDigest: "7".repeat(64),
    },
    claim: claim({ transitionCounter: 2 }),
  });
  assert.equal(normalizeLegacyBootstrapLiveAuthority({
    result: baseRevisionResult,
    seedAuthority: authority,
    manifest,
    request: REQUEST,
    canonicalBaseSha: BASE_SHA,
    expectedLaneRevision: BASE_SHA,
  }).laneRevision, BASE_SHA);
  assert.throws(() => normalizeLegacyBootstrapLiveAuthority({
    result,
    seedAuthority: authority,
    manifest,
    request: REQUEST,
    canonicalBaseSha: "0".repeat(40),
    expectedLaneRevision: HEAD_SHA,
  }), /drifted from its exact authored subject/u);
  assert.throws(() => normalizeLegacyBootstrapLiveAuthority({
    result,
    seedAuthority: authority,
    manifest,
    request: REQUEST,
    canonicalBaseSha: BASE_SHA,
    expectedLaneRevision: "0".repeat(40),
  }), /drifted from its exact authored subject/u);
});

test("recovered response-ahead authority remains attributable on replay", () => {
  const recovered = claim({
    transitionCounter: 3,
    fenceRevision: "2".repeat(64),
    transitionDigest: "3".repeat(64),
    recovery: {
      evidenceDigest: legacyBootstrapRecoveryEvidenceDigest({
        request: REQUEST,
        identity: IDENTITY,
      }),
    },
  });
  assert.equal(findRecoverableLegacyBootstrapClaim({
    claims: [recovered],
    request: REQUEST,
    checkpoint: CHECKPOINT,
    identity: IDENTITY,
    canonicalBaseSha: BASE_SHA,
  }), recovered);
});

test("expired recovered authority can renew again from its exact source transition", () => {
  const recoveryEvidenceDigest = legacyBootstrapRecoveryEvidenceDigest({
    request: REQUEST,
    identity: IDENTITY,
  });
  const dormantRecovered = claim({
    state: "dormant-preserved",
    writeAuthority: false,
    transitionCounter: 2,
    fenceRevision: "2".repeat(64),
    transitionDigest: "3".repeat(64),
    recovery: { evidenceDigest: recoveryEvidenceDigest },
  });
  assert.equal(findRecoverableLegacyBootstrapClaim({
    claims: [dormantRecovered],
    request: REQUEST,
    checkpoint: CHECKPOINT,
    identity: IDENTITY,
    canonicalBaseSha: BASE_SHA,
  }), dormantRecovered);

  const recoveryRequest = createLegacyBootstrapRecoveryRequest({
    claim: dormantRecovered,
    request: REQUEST,
    identity: IDENTITY,
  });
  assert.equal(recoveryRequest.expectedTransitionCounter, 2);
  assert.match(recoveryRequest.idempotencyKey,
    /^legacy-bootstrap-response-loss-recovery:[0-9a-f]{64}:[0-9a-f]{64}:2:2{64}$/u);

  const renewed = claim({
    transitionCounter: 3,
    fenceRevision: "4".repeat(64),
    transitionDigest: "5".repeat(64),
    recovery: { evidenceDigest: recoveryEvidenceDigest },
  });
  assert.equal(requireRecoveredLegacyBootstrapClaim({
    claim: renewed,
    sourceClaim: dormantRecovered,
    request: REQUEST,
    identity: IDENTITY,
    canonicalBaseSha: BASE_SHA,
  }), renewed);
});

test("dormant recovered authority rejects a different recovery subject", () => {
  const mismatched = claim({
    state: "dormant-preserved",
    writeAuthority: false,
    transitionCounter: 2,
    recovery: { evidenceDigest: "0".repeat(64) },
  });
  assert.equal(findRecoverableLegacyBootstrapClaim({
    claims: [mismatched],
    request: REQUEST,
    checkpoint: CHECKPOINT,
    identity: IDENTITY,
    canonicalBaseSha: BASE_SHA,
  }), null);
});

test("current canonical descendant requires complete disjoint path proof", () => {
  const target = "1".repeat(40);
  const proof = proveLegacyReviewCanonicalDescendant({
    sourceBaseSha: BASE_SHA,
    targetBaseSha: target,
    protectedMainSha: target,
    canonicalChangedPaths: ["docs/current.md"],
    preservedChangedPaths: ["scripts/preserved.mjs"],
    sourceIsAncestor: true,
    targetIsProtectedAncestor: true,
  });
  assert.equal(proof.overlap, "none");
  assert.equal(proof.targetBaseSha, target);
  assert.match(proof.evidenceDigest, /^[0-9a-f]{64}$/u);
  assert.equal(requireLegacyBootstrapProtectedBaseProof({
    proof,
    reviewBaseSha: target,
  }), proof);
  assert.equal(requireLegacyBootstrapProtectedBaseSubject({
    reviewBaseSha: target,
    trackingBaseSha: target,
    remoteBaseSha: target,
  }), target);
  assert.throws(() => requireLegacyBootstrapProtectedBaseSubject({
    reviewBaseSha: target,
    trackingBaseSha: BASE_SHA,
    remoteBaseSha: target,
  }), /not the exact current protected main/u);
  assert.throws(() => requireLegacyBootstrapProtectedBaseProof({
    proof,
    reviewBaseSha: BASE_SHA,
  }), /does not bind the exact pull-request base/u);
  for (const invalid of [
    { canonicalChangedPaths: ["scripts/preserved.mjs"] },
    { sourceIsAncestor: false },
    { targetIsProtectedAncestor: false },
    { targetBaseSha: "2".repeat(40) },
  ]) {
    assert.throws(() => proveLegacyReviewCanonicalDescendant({
      sourceBaseSha: BASE_SHA,
      targetBaseSha: target,
      protectedMainSha: target,
      canonicalChangedPaths: ["docs/current.md"],
      preservedChangedPaths: ["scripts/preserved.mjs"],
      sourceIsAncestor: true,
      targetIsProtectedAncestor: true,
      ...invalid,
    }), /canonical|ancestry|overlaps/u);
  }
});

test("current-base candidate selection rejects multiple live subjects", () => {
  const targetBaseSha = "1".repeat(40);
  const sourceAuthority = {
    claimId: CLAIM_ID,
    canonicalBaseSha: targetBaseSha,
    leaseEpoch: 1,
  };
  const current = claim({
    canonicalBaseRevision: targetBaseSha,
    laneRevision: targetBaseSha,
  });
  assert.equal(findLegacyReviewCurrentBaseCandidate({
    claims: [current], request: REQUEST, targetBaseSha, sourceAuthority,
  }), current);
  const reviewRequestId = "github-pull-request:PR_current";
  const dormant = claim({
    canonicalBaseRevision: targetBaseSha,
    laneRevision: targetBaseSha,
    state: "dormant-preserved",
    writeAuthority: false,
    reviewRequestId,
  });
  assert.equal(findLegacyReviewCurrentBaseCandidate({
    claims: [dormant],
    request: REQUEST,
    targetBaseSha,
    allowedReviewRequestIds: [null, reviewRequestId],
    sourceAuthority,
  }), dormant);
  assert.equal(findLegacyReviewCurrentBaseCandidate({
    claims: [dormant], request: REQUEST, targetBaseSha, sourceAuthority,
  }), null);
  assert.equal(findLegacyReviewCurrentBaseCandidate({
    claims: [{ ...current, claimId: "2".repeat(64) }],
    request: REQUEST,
    targetBaseSha,
    sourceAuthority,
  }), null);
  const descendantProof = proveLegacyReviewCanonicalDescendant({
    sourceBaseSha: BASE_SHA,
    targetBaseSha,
    protectedMainSha: targetBaseSha,
    canonicalChangedPaths: ["docs/current.md"],
    preservedChangedPaths: ["scripts/preserved.mjs"],
    sourceIsAncestor: true,
    targetIsProtectedAncestor: true,
  });
  const successor = claim({
    claimId: "3".repeat(64),
    canonicalBaseRevision: targetBaseSha,
    laneRevision: targetBaseSha,
    predecessorClaimId: CLAIM_ID,
    canonicalDescendantProof: descendantProof,
    leaseEpoch: 2,
  });
  assert.equal(findLegacyReviewCurrentBaseCandidate({
    claims: [successor],
    request: REQUEST,
    targetBaseSha,
    sourceAuthority: {
      claimId: CLAIM_ID,
      canonicalBaseSha: BASE_SHA,
      leaseEpoch: 1,
    },
    canonicalDescendantProof: descendantProof,
  }), successor);
  assert.equal(findLegacyReviewCurrentBaseCandidate({
    claims: [{ ...successor, canonicalDescendantProof: null }],
    request: REQUEST,
    targetBaseSha,
    sourceAuthority: {
      claimId: CLAIM_ID,
      canonicalBaseSha: BASE_SHA,
      leaseEpoch: 1,
    },
    canonicalDescendantProof: descendantProof,
  }), null);
  assert.throws(() => findLegacyReviewCurrentBaseCandidate({
    claims: [current, {
      ...current,
      claimId: "2".repeat(64),
      predecessorClaimId: CLAIM_ID,
      leaseEpoch: 2,
    }],
    request: REQUEST,
    targetBaseSha,
    sourceAuthority,
  }), /multiple live current-base candidates/u);
});

test("same-base predecessor omits a descendant proof while a divergent predecessor carries it", () => {
  const sourceBaseSha = "0".repeat(40);
  const proof = proveLegacyReviewCanonicalDescendant({
    sourceBaseSha,
    targetBaseSha: BASE_SHA,
    protectedMainSha: BASE_SHA,
    canonicalChangedPaths: ["docs/current.md"],
    preservedChangedPaths: ["scripts/preserved.mjs"],
    sourceIsAncestor: true,
    targetIsProtectedAncestor: true,
  });
  assert.equal(legacyBootstrapPredecessorDescendantProof({
    authority: { canonicalBaseSha: BASE_SHA }, reviewBaseSha: BASE_SHA, proof,
  }), null);
  assert.equal(legacyBootstrapPredecessorDescendantProof({
    authority: { canonicalBaseSha: sourceBaseSha }, reviewBaseSha: BASE_SHA, proof,
  }), proof);
  assert.equal(legacyBootstrapPredecessorDescendantProof({
    authority: null, reviewBaseSha: BASE_SHA, proof,
  }), null);
  assert.throws(() => legacyBootstrapPredecessorDescendantProof({
    authority: { canonicalBaseSha: sourceBaseSha },
    reviewBaseSha: "1".repeat(40),
    proof,
  }), /does not bind the exact pull-request base/u);
});

test("legacy admission manifest binds normalized source paths", () => {
  const manifest = legacyBootstrapAdmissionManifest(REQUEST);
  assert.deepEqual(manifest.paths, [
    "scripts/legacy-clean-committed-lane-bootstrap-adapter.mjs",
  ]);
  assert.equal(manifest.manifestDigest, digestValue({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: REQUEST.semanticScope,
    paths: manifest.paths,
  }));
});

test("mid-checkpoint recovery selects only the exact authored-head claim", () => {
  const checkpointClaim = claim({
    laneRevision: HEAD_SHA,
    transitionCounter: 2,
    fenceRevision: "2".repeat(64),
    transitionDigest: "3".repeat(64),
  });
  const checkpoint = {
    ...CHECKPOINT,
    status: "pullRequest",
    outputs: {
      cloudClaim: {
        authority: {
          claimId: CLAIM_ID,
          claimDigest: checkpointClaim.fenceRevision,
          entrySchema: checkpointClaim.entrySchema,
          claimIdentitySchema: checkpointClaim.claimIdentitySchema,
          leaseEpoch: checkpointClaim.leaseEpoch,
          transitionCounter: checkpointClaim.transitionCounter,
        },
      },
    },
  };
  assert.equal(findLegacyBootstrapCheckpointClaim({
    claims: [checkpointClaim],
    request: REQUEST,
    checkpoint,
    identity: IDENTITY,
    canonicalBaseSha: BASE_SHA,
  }), checkpointClaim);
  assert.equal(findLegacyBootstrapCheckpointClaim({
    claims: [{ ...checkpointClaim, laneRevision: BASE_SHA }],
    request: REQUEST,
    checkpoint,
    identity: IDENTITY,
    canonicalBaseSha: BASE_SHA,
  }), null);
  const reviewRequestId = "github-pull-request:PR_exact";
  const reviewBound = {
    ...checkpointClaim,
    transitionCounter: 3,
    fenceRevision: "4".repeat(64),
    transitionDigest: "5".repeat(64),
    reviewRequestId,
  };
  assert.equal(findLegacyBootstrapCheckpointClaim({
    claims: [reviewBound],
    request: REQUEST,
    checkpoint,
    identity: IDENTITY,
    canonicalBaseSha: BASE_SHA,
    allowedReviewRequestIds: [null, reviewRequestId],
  }), reviewBound);
});

test("same PR-bound claim and later replacement atomically continue the task binding", () => {
  const branch = REQUEST.branch;
  const sourceClaimId = "3".repeat(64);
  const targetClaimId = "4".repeat(64);
  const taskAuthorityIdentity = {
    authoritySubjectId: "task-authority-subject",
    proofAdapterId: "test-ed25519-adapter",
    generation: 1,
    publicKeyDigest: "a".repeat(64),
    publicKey: "test-public-key",
  };
  const lease = {
    branch,
    cloudAuthority: { claimId: sourceClaimId },
    taskAuthority: { ...taskAuthorityIdentity, bindingDigest: "5".repeat(64) },
  };
  const targetBinding = {
    ...taskAuthorityIdentity,
    bindingDigest: "6".repeat(64),
    bindingMode: "continuation",
    priorBindingDigest: lease.taskAuthority.bindingDigest,
  };
  for (const sourceWithoutCloud of [true, false]) {
    const projectedClaimId = sourceWithoutCloud ? sourceClaimId : targetClaimId;
    const values = {
      cloudAuthority: { claimId: projectedClaimId },
      admission: { status: "admitted" },
      baseSha: BASE_SHA,
      fenceSha: HEAD_SHA,
      pullRequestUrl: "https://github.com/owner/repository/pull/573",
      heartbeatAt: "2098-12-31T23:30:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    let mutationCount = 0;
    const result = projectCloudAuthorityAndTaskBinding({
      leaseStore: {}, lease, request: REQUEST, values, sourceWithoutCloud,
      repairProof: { evidenceDigest: "7".repeat(64) },
      bootstrapIdentityDigest: IDENTITY_DIGEST,
    }, {
      authorize: ({ lease: source, operation }) => {
        assert.equal(source.cloudAuthority, sourceWithoutCloud ? null : lease.cloudAuthority);
        assert.equal(operation, sourceWithoutCloud
          ? "legacy-bootstrap-cloud-claim-task-binding-continuation"
          : "legacy-bootstrap-current-base-task-binding-continuation");
        return { receiptDigest: "8".repeat(64) };
      },
      createBinding: ({ lease: target, bindingMode, priorBindingDigest }) => {
        assert.equal(target.cloudAuthority.claimId, projectedClaimId);
        assert.equal(bindingMode, "continuation");
        assert.equal(priorBindingDigest, lease.taskAuthority.bindingDigest);
        return targetBinding;
      },
      mutate: ({ expectedClaimId, action }) => {
        mutationCount += 1;
        assert.equal(expectedClaimId, sourceClaimId);
        const mutation = action({ registry: { leases: { [branch]: lease } } });
        assert.equal(mutation.registry.leases[branch].cloudAuthority.claimId, projectedClaimId);
        assert.equal(mutation.registry.leases[branch].taskAuthority, targetBinding);
        return { lease: mutation.lease, registryRevision: 2 };
      },
      leaseDigest: value => digestValue(value),
      assertBinding: () => {},
      signReceipt: () => TEST_CONTINUATION_SIGNATURE,
      verifyReceipt: () => true,
    });
    assert.equal(mutationCount, 1);
    assert.equal(result.lease.cloudAuthority.claimId, projectedClaimId);
    assert.equal(result.lease.taskAuthority, targetBinding);
    assert.equal(result.continuationReceipt.sourceClaimId, sourceClaimId);
    assert.equal(result.continuationReceipt.targetClaimId, projectedClaimId);
    assert.match(result.continuationReceipt.receiptDigest, /^[0-9a-f]{64}$/u);
  }
});

test("null-cloud migration projects claim and binding atomically and adopts response loss", () => {
  const branch = REQUEST.branch;
  const targetClaimId = "4".repeat(64);
  const lease = {
    branch,
    cloudAuthority: null,
    taskAuthority: {
      authoritySubjectId: "task-authority-subject",
      proofAdapterId: "test-ed25519-adapter",
      generation: 1,
      publicKeyDigest: "a".repeat(64),
      publicKey: "test-public-key",
      bindingDigest: "5".repeat(64),
    },
  };
  const targetBinding = {
    authoritySubjectId: lease.taskAuthority.authoritySubjectId,
    proofAdapterId: lease.taskAuthority.proofAdapterId,
    generation: lease.taskAuthority.generation,
    publicKeyDigest: lease.taskAuthority.publicKeyDigest,
    publicKey: lease.taskAuthority.publicKey,
    bindingDigest: "6".repeat(64),
    bindingMode: "continuation",
    priorBindingDigest: lease.taskAuthority.bindingDigest,
  };
  const values = {
    cloudAuthority: { claimId: targetClaimId },
    admission: { status: "admitted" },
    baseSha: BASE_SHA,
    fenceSha: HEAD_SHA,
    pullRequestUrl: "https://github.com/owner/repository/pull/573",
    heartbeatAt: "2098-12-31T23:30:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  const repairProof = { evidenceDigest: "7".repeat(64) };
  let expectedClaimId = "unexpected";
  const dependencies = {
    authorize: () => ({ receiptDigest: "8".repeat(64) }),
    createBinding: () => targetBinding,
    mutate: input => {
      expectedClaimId = input.expectedClaimId;
      const mutation = input.action({ registry: { leases: { [branch]: lease } } });
      return { lease: mutation.lease, registryRevision: 2 };
    },
    leaseDigest: value => digestValue(value),
    assertBinding: () => {},
    signReceipt: () => TEST_CONTINUATION_SIGNATURE,
    verifyReceipt: () => true,
  };
  const projected = projectCloudAuthorityAndTaskBinding({
    leaseStore: {},
    lease,
    request: REQUEST,
    values,
    sourceWithoutCloud: true,
    repairProof,
    bootstrapIdentityDigest: IDENTITY_DIGEST,
  }, dependencies);
  assert.equal(expectedClaimId, null);
  assert.equal(projected.lease.cloudAuthority.claimId, targetClaimId);
  assert.equal(projected.continuationReceipt.sourceClaimId, null);
  assert.equal(projected.lease.legacyBootstrapTaskBindingContinuation.receiptDigest,
    projected.continuationReceipt.receiptDigest);

  const adopted = adoptLegacyBootstrapTaskBindingContinuation({
    lease: projected.lease,
    request: REQUEST,
    values,
    repairProof,
    bootstrapIdentityDigest: IDENTITY_DIGEST,
  }, { leaseDigest: value => digestValue(value), assertBinding: () => {},
    verifyReceipt: () => true });
  assert.equal(adopted.lease, projected.lease);
  assert.equal(adopted.continuationReceipt.receiptDigest,
    projected.continuationReceipt.receiptDigest);
  assert.throws(() => adoptLegacyBootstrapTaskBindingContinuation({
    lease: {
      ...projected.lease,
      legacyBootstrapTaskBindingContinuation: {
        ...projected.lease.legacyBootstrapTaskBindingContinuation,
        targetClaimId: "0".repeat(64),
      },
    },
    request: REQUEST,
    values,
    repairProof,
    bootstrapIdentityDigest: IDENTITY_DIGEST,
  }, { leaseDigest: value => digestValue(value), assertBinding: () => {},
    verifyReceipt: () => true }),
  /not content-bound|not exact-current/u);

  const forgedCore = {
    ...projected.lease.legacyBootstrapTaskBindingContinuation,
    priorBindingDigest: "9".repeat(64),
  };
  delete forgedCore.receiptDigest;
  const forged = { ...forgedCore, receiptDigest: digestValue(forgedCore) };
  assert.throws(() => adoptLegacyBootstrapTaskBindingContinuation({
    lease: {
      ...projected.lease,
      legacyBootstrapTaskBindingContinuation: forged,
    },
    request: REQUEST,
    values,
    repairProof,
    bootstrapIdentityDigest: IDENTITY_DIGEST,
  }, { leaseDigest: value => digestValue(value), assertBinding: () => {},
    verifyReceipt: () => true }),
  /not content-bound|lineage is not authenticated|does not join the current lease/u);
});

test("null-cloud continuation creates a cryptographically exact target binding", () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "legacy-bootstrap-binding-")));
  const capabilityPath = path.join(root, "task-authority.json");
  const previousCapability = process.env.AGENTIC_TASK_AUTHORITY_FILE;
  try {
    writeTaskAuthorityCapability({ outputPath: capabilityPath });
    process.env.AGENTIC_TASK_AUTHORITY_FILE = capabilityPath;
    const store = createWriterLeaseStore({
      gitCommonDir: root,
      taskAuthorityFile: capabilityPath,
      taskAuthorityPolicy: "required",
    });
    const source = store.claim({
      sessionId: REQUEST.sessionId,
      device: REQUEST.deviceId,
      scope: REQUEST.semanticScope,
      branch: REQUEST.branch,
      worktreePath: "/worktree",
      baseSha: BASE_SHA,
    });
    const values = {
      cloudAuthority: { claimId: CLAIM_ID },
      admission: { status: "admitted" },
      baseSha: BASE_SHA,
      fenceSha: HEAD_SHA,
      pullRequestUrl: "https://github.com/owner/repository/pull/573",
      heartbeatAt: "2098-12-31T23:30:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    const projected = projectCloudAuthorityAndTaskBinding({
      leaseStore: store,
      lease: source,
      request: REQUEST,
      values,
      sourceWithoutCloud: true,
      repairProof: { evidenceDigest: "7".repeat(64) },
      bootstrapIdentityDigest: IDENTITY_DIGEST,
    });
    assert.doesNotThrow(() => assertTaskAuthorityBinding({
      binding: projected.lease.taskAuthority,
      lease: projected.lease,
    }));
    assert.equal(projected.lease.taskAuthority.bindingMode, "continuation");
    assert.equal(projected.lease.taskAuthority.priorBindingDigest,
      source.taskAuthority.bindingDigest);
    assert.equal(store.read(REQUEST.branch).cloudAuthority.claimId, CLAIM_ID);
    const successorClaimId = "2".repeat(64);
    const successorValues = {
      ...values,
      cloudAuthority: { claimId: successorClaimId },
    };
    const successor = projectCloudAuthorityAndTaskBinding({
      leaseStore: store,
      lease: projected.lease,
      request: REQUEST,
      values: successorValues,
      sourceWithoutCloud: false,
      repairProof: { evidenceDigest: "7".repeat(64) },
      bootstrapIdentityDigest: IDENTITY_DIGEST,
    });
    assert.equal(successor.continuationReceipt.rootBindingDigest,
      projected.lease.taskAuthority.bindingDigest);
    assert.equal(successor.continuationReceipt.priorContinuationReceiptDigest,
      projected.continuationReceipt.receiptDigest);
    assert.equal(successor.lease.taskAuthority.priorBindingDigest,
      projected.lease.taskAuthority.bindingDigest);
    const finalClaimId = "3".repeat(64);
    const finalSuccessor = projectCloudAuthorityAndTaskBinding({
      leaseStore: store,
      lease: successor.lease,
      request: REQUEST,
      values: {
        ...values,
        cloudAuthority: { claimId: finalClaimId },
      },
      sourceWithoutCloud: false,
      repairProof: { evidenceDigest: "7".repeat(64) },
      bootstrapIdentityDigest: IDENTITY_DIGEST,
    });
    assert.equal(finalSuccessor.continuationReceipt.lineage.length, 2);
    assert.equal(finalSuccessor.continuationReceipt.lineage[0].receiptDigest,
      projected.continuationReceipt.receiptDigest);
    assert.equal(finalSuccessor.continuationReceipt.lineage[1].receiptDigest,
      successor.continuationReceipt.receiptDigest);
    assert.doesNotThrow(() => requireCurrentLegacyBootstrapTaskBindingContinuation({
      lease: finalSuccessor.lease,
    }));
    assert.equal(requireLegacyBootstrapContinuationPrefix({
      recorded: projected.continuationReceipt,
      current: finalSuccessor.continuationReceipt,
    }).receiptDigest, finalSuccessor.continuationReceipt.receiptDigest);
    assert.throws(() => requireLegacyBootstrapContinuationPrefix({
      recorded: finalSuccessor.continuationReceipt,
      current: projected.continuationReceipt,
    }), /continuation evidence drifted/u);
    const checkpoint = {
      ...CHECKPOINT,
      identity: {
        ...IDENTITY,
        headSha: HEAD_SHA,
        treeSha: TREE_SHA,
      },
      outputs: {
        cloudClaim: { authority: { claimId: "0".repeat(64) } },
      },
    };
    assert.deepEqual([...projectedLegacyBootstrapClaimIds(checkpoint, finalSuccessor.lease)], [
      "0".repeat(64),
      finalClaimId,
    ]);
    for (const [field, replacement] of [
      ["rootBindingDigest", "1".repeat(64)],
      ["priorContinuationReceiptDigest", "2".repeat(64)],
      ["bootstrapIdentityDigest", "3".repeat(64)],
      ["branch", `${REQUEST.branch}-foreign`],
      ["preservedHeadSha", "4".repeat(40)],
      ["preservedTreeSha", "5".repeat(40)],
      ["sourceClaimId", "6".repeat(64)],
      ["sourceLeaseSubjectDigest", "7".repeat(64)],
      ["disjointProofDigest", "8".repeat(64)],
    ]) {
      const tampered = {
        ...finalSuccessor.lease.legacyBootstrapTaskBindingContinuation,
        [field]: replacement,
      };
      const signed = { ...tampered };
      delete signed.lineage;
      delete signed.receiptDigest;
      tampered.receiptDigest = digestValue(signed);
      const tamperedLease = {
        ...finalSuccessor.lease,
        legacyBootstrapTaskBindingContinuation: tampered,
      };
      assert.throws(() => requireCurrentLegacyBootstrapTaskBindingContinuation({
        lease: tamperedLease,
      }), /not authenticated|does not join/u, field);
      assert.deepEqual([...projectedLegacyBootstrapClaimIds(checkpoint, tamperedLease)], [
        "0".repeat(64),
      ]);
    }
    const missingHopLease = {
      ...finalSuccessor.lease,
      legacyBootstrapTaskBindingContinuation: {
        ...finalSuccessor.lease.legacyBootstrapTaskBindingContinuation,
        lineage: finalSuccessor.lease.legacyBootstrapTaskBindingContinuation.lineage.slice(1),
      },
    };
    assert.throws(() => requireCurrentLegacyBootstrapTaskBindingContinuation({
      lease: missingHopLease,
    }), /not content-bound|not authenticated/u);

    const reorderedLineage = [
      ...finalSuccessor.lease.legacyBootstrapTaskBindingContinuation.lineage,
    ].reverse();
    const reordered = {
      ...finalSuccessor.lease.legacyBootstrapTaskBindingContinuation,
      lineage: reorderedLineage,
      lineageDigest: digestValue(reorderedLineage),
    };
    const reorderedSigned = { ...reordered };
    delete reorderedSigned.lineage;
    delete reorderedSigned.receiptDigest;
    reordered.receiptDigest = digestValue(reorderedSigned);
    assert.throws(() => requireCurrentLegacyBootstrapTaskBindingContinuation({
      lease: {
        ...finalSuccessor.lease,
        legacyBootstrapTaskBindingContinuation: reordered,
      },
    }), /not authenticated/u);

    const forgedFirstHop = {
      ...finalSuccessor.lease.legacyBootstrapTaskBindingContinuation.lineage[0],
      bootstrapIdentityDigest: "4".repeat(64),
    };
    const forgedFirstHopSigned = { ...forgedFirstHop };
    delete forgedFirstHopSigned.receiptDigest;
    forgedFirstHop.receiptDigest = digestValue(forgedFirstHopSigned);
    const forgedLineage = [
      forgedFirstHop,
      finalSuccessor.lease.legacyBootstrapTaskBindingContinuation.lineage[1],
    ];
    const forgedIntermediate = {
      ...finalSuccessor.lease.legacyBootstrapTaskBindingContinuation,
      lineage: forgedLineage,
      lineageDigest: digestValue(forgedLineage),
    };
    const forgedIntermediateSigned = { ...forgedIntermediate };
    delete forgedIntermediateSigned.lineage;
    delete forgedIntermediateSigned.receiptDigest;
    forgedIntermediate.receiptDigest = digestValue(forgedIntermediateSigned);
    assert.throws(() => requireCurrentLegacyBootstrapTaskBindingContinuation({
      lease: {
        ...finalSuccessor.lease,
        legacyBootstrapTaskBindingContinuation: forgedIntermediate,
      },
    }), /not authenticated/u);

    assert.throws(() => requireCurrentLegacyBootstrapTaskBindingContinuation({
      lease: {
        ...finalSuccessor.lease,
        expiresAt: "2099-01-01T00:00:01.000Z",
      },
    }), /does not join the current lease/u);

    const foreignRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(),
      "legacy-bootstrap-foreign-binding-")));
    const foreignCapabilityPath = path.join(foreignRoot, "task-authority.json");
    try {
      writeTaskAuthorityCapability({ outputPath: foreignCapabilityPath });
      process.env.AGENTIC_TASK_AUTHORITY_FILE = foreignCapabilityPath;
      const foreignStore = createWriterLeaseStore({
        gitCommonDir: foreignRoot,
        taskAuthorityFile: foreignCapabilityPath,
        taskAuthorityPolicy: "required",
      });
      const foreignSource = foreignStore.claim({
        sessionId: REQUEST.sessionId,
        device: REQUEST.deviceId,
        scope: REQUEST.semanticScope,
        branch: REQUEST.branch,
        worktreePath: "/foreign-worktree",
        baseSha: BASE_SHA,
      });
      const foreign = projectCloudAuthorityAndTaskBinding({
        leaseStore: foreignStore,
        lease: foreignSource,
        request: REQUEST,
        values,
        sourceWithoutCloud: true,
        repairProof: { evidenceDigest: "7".repeat(64) },
        bootstrapIdentityDigest: IDENTITY_DIGEST,
      });
      assert.doesNotThrow(() => requireCurrentLegacyBootstrapTaskBindingContinuation({
        lease: foreign.lease,
      }));
      assert.throws(() => requireLegacyBootstrapContinuationPrefix({
        recorded: projected.continuationReceipt,
        current: foreign.continuationReceipt,
      }), /continuation evidence drifted/u);
    } finally {
      process.env.AGENTIC_TASK_AUTHORITY_FILE = capabilityPath;
      rmSync(foreignRoot, { recursive: true, force: true });
    }

    let bounded = finalSuccessor;
    for (let hopCount = 4; hopCount <= 16; hopCount += 1) {
      bounded = projectCloudAuthorityAndTaskBinding({
        leaseStore: store,
        lease: bounded.lease,
        request: REQUEST,
        values: {
          ...values,
          cloudAuthority: { claimId: digestValue({ hopCount }) },
        },
        sourceWithoutCloud: false,
        repairProof: { evidenceDigest: "7".repeat(64) },
        bootstrapIdentityDigest: IDENTITY_DIGEST,
      });
    }
    assert.equal(bounded.continuationReceipt.lineage.length, 15);
    assert.doesNotThrow(() => requireCurrentLegacyBootstrapTaskBindingContinuation({
      lease: bounded.lease,
    }));
    assert.throws(() => projectCloudAuthorityAndTaskBinding({
      leaseStore: store,
      lease: bounded.lease,
      request: REQUEST,
      values: {
        ...values,
        cloudAuthority: { claimId: digestValue({ hopCount: 17 }) },
      },
      sourceWithoutCloud: false,
      repairProof: { evidenceDigest: "7".repeat(64) },
      bootstrapIdentityDigest: IDENTITY_DIGEST,
    }), /lineage is over capacity/u);
  } finally {
    if (previousCapability === undefined) delete process.env.AGENTIC_TASK_AUTHORITY_FILE;
    else process.env.AGENTIC_TASK_AUTHORITY_FILE = previousCapability;
    rmSync(root, { recursive: true, force: true });
  }
});

test("legacy bootstrap projects the verified cloud lifetime into the continued local lease", () => {
  const verifiedAt = "2098-12-31T23:30:00.000Z";
  const expiresAt = "2099-01-01T00:00:00.000Z";
  const authority = { claimId: CLAIM_ID, expiresAt };
  const values = legacyBootstrapLeaseProjectionValues({ baseSha: BASE_SHA,
    headSha: HEAD_SHA, pullRequestUrl: "https://github.com/owner/repository/pull/573",
    admission: { status: "admitted" }, authority, verifiedAt });
  assert.equal(values.heartbeatAt, verifiedAt);
  assert.equal(values.expiresAt, expiresAt);
  assert.equal(values.cloudAuthority, authority);
  assert.throws(() => legacyBootstrapLeaseProjectionValues({ baseSha: BASE_SHA,
    headSha: HEAD_SHA, pullRequestUrl: "https://github.com/owner/repository/pull/573",
    admission: { status: "admitted" }, authority, verifiedAt: expiresAt }),
  /requires current verified cloud expiry/u);
});

test("final authority projection ignores only unrelated ledger movement", () => {
  const sourceAuthority = {
    claimId: CLAIM_ID,
    claimDigest: FENCE_REVISION,
    claimLedgerRevision: "1".repeat(64),
    transitionCounter: 2,
    expiresAt: "2099-01-01T00:00:00.000Z",
    ledgerRevision: "2".repeat(40),
    ledgerDigest: "3".repeat(64),
  };
  assert.equal(legacyBootstrapAuthorityNeedsProjection({
    sourceAuthority,
    targetAuthority: {
      ...sourceAuthority,
      ledgerRevision: "4".repeat(40),
      ledgerDigest: "5".repeat(64),
    },
  }), false);
  assert.equal(legacyBootstrapAuthorityNeedsProjection({
    sourceAuthority,
    targetAuthority: {
      ...sourceAuthority,
      claimDigest: "6".repeat(64),
      claimLedgerRevision: "7".repeat(64),
      transitionCounter: 3,
      expiresAt: "2099-01-02T00:00:00.000Z",
    },
  }), true);
});

test("phase inspection attributes both initial and bound successor claims", () => {
  const initialClaimId = "9".repeat(64);
  const successorClaimId = "a".repeat(64);
  const projected = projectedLegacyBootstrapClaimIds({ outputs: {
    cloudClaim: { authority: { claimId: initialClaimId } },
    boundAuthority: { authority: { claimId: successorClaimId } },
  } });
  assert.deepEqual([...projected], [initialClaimId, successorClaimId]);
});

test("final reconciliation persists each exact successor before protected-base revalidation", () => {
  const calls = [];
  const transitions = [];
  let durableLease = "A";
  let durableState = null;
  const execute = ({ source, target, drift }) => runLegacyBootstrapFinalReconciliationSequence({
    requireDurableIntent: () => {
      calls.push(`intent:${source}`);
      durableState = { status: "intent", source, target };
      return durableState;
    },
    resolve: () => {
      calls.push(`resolve:${source}->${target}`);
      transitions.push(`${source}->${target}`);
      return { claimId: target };
    },
    persistResolved: ({ replacement }) => {
      calls.push(`resolved:${replacement.claimId}`);
      durableState = { ...durableState, status: "resolved", claimId: replacement.claimId };
      return durableState;
    },
    project: ({ replacement }) => {
      calls.push(`project:${replacement.claimId}`);
      durableLease = replacement.claimId;
      return { lease: durableLease };
    },
    persistAdopted: ({ replacement }) => {
      calls.push(`adopted:${replacement.claimId}`);
      durableState = { ...durableState, status: "adopted", claimId: replacement.claimId };
      return durableState;
    },
    revalidate: ({ replacement }) => {
      calls.push(`protected:${replacement.claimId}`);
      if (drift) throw new Error("protected base advanced");
      return durableLease;
    },
  });

  assert.throws(() => execute({ source: "A", target: "B", drift: true }),
    /protected base advanced/u);
  assert.equal(durableLease, "B");
  assert.equal(durableState.status, "adopted");
  assert.deepEqual(calls, [
    "intent:A", "resolve:A->B", "resolved:B", "project:B", "adopted:B", "protected:B",
  ]);

  calls.length = 0;
  assert.equal(execute({ source: durableLease, target: "C", drift: false }), "C");
  assert.deepEqual(transitions, ["A->B", "B->C"]);
  assert.ok(!transitions.includes("A->C"));
  assert.deepEqual(calls, [
    "intent:B", "resolve:B->C", "resolved:C", "project:C", "adopted:C", "protected:C",
  ]);
  assert.equal(requireLegacyBootstrapAdoptedFinalRefresh({
    reconciliation: {
      status: "adopted",
      intent: { reviewId: "PR_same", reviewHeadSha: HEAD_SHA, reviewBaseSha: BASE_SHA },
    },
    liveReview: { id: "PR_same", headRefOid: HEAD_SHA, baseRefOid: BASE_SHA },
  }), true);
  assert.throws(() => requireLegacyBootstrapAdoptedFinalRefresh({
    reconciliation: {
      status: "adopted",
      intent: { reviewId: "PR_same", reviewHeadSha: HEAD_SHA },
    },
    liveReview: { id: "PR_foreign", headRefOid: HEAD_SHA, baseRefOid: BASE_SHA },
  }), /review identity drifted/u);
});

test("protected review and marker are the final external observations", () => {
  const calls = [];
  const observation = { headSha: HEAD_SHA };
  assert.equal(verifyLegacyBootstrapFinalBoundary({
    verifyCloud: () => calls.push("cloud"),
    inspect: () => {
      calls.push("inspect");
      return observation;
    },
    requireProtectedReview: () => {
      calls.push("protected");
      return { body: "marker" };
    },
    verifyMarker: () => calls.push("marker"),
  }), observation);
  assert.deepEqual(calls, ["cloud", "inspect", "protected", "marker"]);

  calls.length = 0;
  assert.throws(() => verifyLegacyBootstrapFinalBoundary({
    verifyCloud: () => calls.push("cloud"),
    inspect: () => {
      calls.push("inspect");
      return observation;
    },
    requireProtectedReview: () => {
      calls.push("protected");
      throw new Error("protected base advanced");
    },
    verifyMarker: () => calls.push("marker"),
  }), /protected base advanced/u);
  assert.deepEqual(calls, ["cloud", "inspect", "protected"]);
});
