import test from "node:test";
import assert from "node:assert/strict";

import { digestValue, normalizeWriteSet } from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import { normalizeCloudAuthority } from "../scripts/scoped-lane-admission-lib.mjs";
import { legacyBootstrapLeaseProjectionValues, projectCloudAuthorityAndTaskBinding,
  projectedLegacyBootstrapClaimIds }
  from "../scripts/legacy-clean-committed-lane-bootstrap-adapter.mjs";
import {
  createLegacyBootstrapRecoveryRequest,
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
const CLAIM_ID = "c".repeat(64);
const FENCE_REVISION = "d".repeat(64);
const OPERATION_RECEIPT_DIGEST = "e".repeat(64);
const IDENTITY_DIGEST = "f".repeat(64);
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
  const current = claim({
    canonicalBaseRevision: targetBaseSha,
    laneRevision: HEAD_SHA,
  });
  assert.equal(findLegacyReviewCurrentBaseCandidate({
    claims: [current], request: REQUEST, targetBaseSha,
  }), current);
  assert.throws(() => findLegacyReviewCurrentBaseCandidate({
    claims: [current, { ...current, claimId: "2".repeat(64) }],
    request: REQUEST,
    targetBaseSha,
  }), /multiple live current-base candidates/u);
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

test("same PR-bound claim and later replacement atomically continue the task binding", () => {
  const branch = REQUEST.branch;
  const sourceClaimId = "3".repeat(64);
  const targetClaimId = "4".repeat(64);
  const lease = {
    branch,
    cloudAuthority: { claimId: sourceClaimId },
    taskAuthority: { bindingDigest: "5".repeat(64) },
  };
  const targetBinding = { bindingDigest: "6".repeat(64) };
  for (const sourceWithoutCloud of [true, false]) {
    const projectedClaimId = sourceWithoutCloud ? sourceClaimId : targetClaimId;
    const values = { cloudAuthority: { claimId: projectedClaimId }, baseSha: BASE_SHA };
    let mutationCount = 0;
    const result = projectCloudAuthorityAndTaskBinding({
      leaseStore: {}, lease, request: REQUEST, values, sourceWithoutCloud,
      repairProof: { evidenceDigest: "7".repeat(64) },
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
    });
    assert.equal(mutationCount, 1);
    assert.equal(result.lease.cloudAuthority.claimId, projectedClaimId);
    assert.equal(result.lease.taskAuthority, targetBinding);
    assert.equal(result.continuationReceipt.sourceClaimId, sourceClaimId);
    assert.equal(result.continuationReceipt.targetClaimId, projectedClaimId);
    assert.match(result.continuationReceipt.receiptDigest, /^[0-9a-f]{64}$/u);
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

test("phase inspection attributes both initial and bound successor claims", () => {
  const initialClaimId = "9".repeat(64);
  const successorClaimId = "a".repeat(64);
  const projected = projectedLegacyBootstrapClaimIds({ outputs: {
    cloudClaim: { authority: { claimId: initialClaimId } },
    boundAuthority: { authority: { claimId: successorClaimId } },
  } });
  assert.deepEqual([...projected], [initialClaimId, successorClaimId]);
});
