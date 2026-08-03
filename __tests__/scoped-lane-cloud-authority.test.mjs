import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCloudTransition,
  createEmptyLedger,
  digestValue,
  listCurrentClaims,
  verifyCloudClaim,
} from "../scripts/cloud-collaboration-contract.mjs";
import {
  contractActor,
  contractRepository,
  prepareMutationRequest,
  prepareReadRequest,
  projectPublicClaim,
} from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  attachCloudHeartbeatMachineEvidence,
  authorizeDeliveryAdmissionCloudAuthority,
  bindAdmissionCloudAuthority,
  cloudAuthorityFromResult,
} from "../scripts/scoped-lane-cloud-authority.mjs";
import { heartbeat } from "../scripts/device-branch-lib.mjs";
import { renderWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";

const CLOUD_RESULT_SCHEMA = "agentic-cloud-collaboration-result/v1";
const BASE_SHA = "a".repeat(40);
const FENCE_SHA = "b".repeat(40);
const CLAIM_GIT_REVISION = "c".repeat(40);
const BIND_GIT_REVISION = "d".repeat(40);
const RAW_DEVICE_ID = "reviewer-mac.local";
const RAW_SESSION_ID = "codex-session-bind-recovery";
const BRANCH = "agent/reviewer-mac.local/scoped-cloud-authority";
const PULL_REQUEST_URL = "https://github.test/org/repository/pull/42";
const CLAIM_TIME = "2099-07-31T01:00:00.000Z";
const BIND_TIME = "2099-07-31T01:01:00.000Z";
const VERIFY_TIME = "2099-07-31T01:02:00.000Z";
const READY_GIT_REVISION = "e".repeat(40);
const DELIVERY_GIT_REVISION = "f".repeat(40);
const RAW_ACTOR = { id: 91, login: "runtime-reviewer" };
const RAW_REPOSITORY = {
  id: 17,
  nodeId: "repository-node-17",
  fullName: "org/repository",
  defaultBranch: "main",
};
const PULL_REQUEST = {
  number: 42,
  nodeId: "pull-request-node-42",
  branch: BRANCH,
  headSha: FENCE_SHA,
  baseSha: BASE_SHA,
};
const DECLARED_WRITE_SET = [
  "path:scripts/scoped-lane-cloud-authority.mjs",
  "semantic:scoped-cloud-authority",
];
const MANIFEST = Object.freeze({
  schema: "agentic-declared-write-scope/v1",
  semanticScope: "scoped-cloud-authority",
  paths: ["scripts/scoped-lane-cloud-authority.mjs"],
  declaredWriteSet: DECLARED_WRITE_SET,
  writeSetDigest: digestValue(DECLARED_WRITE_SET),
  manifestDigest: digestValue({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "scoped-cloud-authority",
    paths: ["scripts/scoped-lane-cloud-authority.mjs"],
  }),
});

test("bind response loss reconciles one live pseudonymized GitHub-mapped claim", () => {
  const mappedActor = contractActor(RAW_ACTOR, {
    deviceId: RAW_DEVICE_ID,
    sessionId: RAW_SESSION_ID,
  });
  const repository = contractRepository(RAW_REPOSITORY, BASE_SHA);
  const claimRequest = prepareMutationRequest({
    action: "claim",
    input: {
      workItemId: "scoped-cloud-authority",
      canonicalBaseSha: BASE_SHA,
      headSha: BASE_SHA,
      declaredWriteSet: DECLARED_WRITE_SET,
      leaseEpoch: 1,
      ttlSeconds: 3_600,
      deviceId: RAW_DEVICE_ID,
      sessionId: RAW_SESSION_ID,
      idempotencyKey: "claim-scoped-cloud-authority",
    },
    actor: RAW_ACTOR,
    repository: RAW_REPOSITORY,
    pullRequest: null,
    evaluationTime: CLAIM_TIME,
  });
  const claimed = applyCloudTransition({
    ledger: createEmptyLedger({ nodeId: "ledger-node-1" }),
    action: "claim",
    request: claimRequest,
    actor: mappedActor,
    repository,
    evaluationTime: CLAIM_TIME,
  });
  let liveLedger = claimed.ledger;
  let liveGitRevision = CLAIM_GIT_REVISION;
  const authority = cloudAuthorityFromResult({
    ledgerRepository: "org/ledger",
    targetRepository: RAW_REPOSITORY.fullName,
    deviceId: RAW_DEVICE_ID,
    sessionId: RAW_SESSION_ID,
    result: publicMutationResult({
      action: "claim",
      transition: claimed,
      ledgerRevision: CLAIM_GIT_REVISION,
    }),
  }, {
    manifest: MANIFEST,
    canonicalBaseSha: BASE_SHA,
    now: new Date(CLAIM_TIME),
  });
  let mutationAttempts = 0;
  let statusReads = 0;
  let verificationReads = 0;

  const recovered = bindAdmissionCloudAuthority({
    authority,
    manifest: MANIFEST,
    branch: BRANCH,
    headSha: FENCE_SHA,
    pullRequestNumber: PULL_REQUEST.number,
    deviceId: RAW_DEVICE_ID,
    sessionId: RAW_SESSION_ID,
    invoke: ({ action, request }) => {
      assert.equal(action, "bind");
      mutationAttempts += 1;
      const mappedRequest = prepareMutationRequest({
        action,
        input: request,
        actor: RAW_ACTOR,
        repository: RAW_REPOSITORY,
        pullRequest: PULL_REQUEST,
        evaluationTime: BIND_TIME,
      });
      const bound = applyCloudTransition({
        ledger: liveLedger,
        action,
        request: mappedRequest,
        actor: contractActor(RAW_ACTOR, request),
        repository,
        evaluationTime: BIND_TIME,
      });
      liveLedger = bound.ledger;
      liveGitRevision = BIND_GIT_REVISION;
      throw new Error("transport response lost after bind commit");
    },
    inspect: ({ action }) => {
      assert.equal(action, "status");
      statusReads += 1;
      return publicStatusResult({
        ledger: liveLedger,
        ledgerRevision: liveGitRevision,
        repositoryId: repository.repositoryId,
      });
    },
    verify: ({ request }) => {
      verificationReads += 1;
      assert.equal(request.expectedLedgerRevision, BIND_GIT_REVISION);
      const mappedRequest = prepareReadRequest({
        input: request,
        repository: RAW_REPOSITORY,
        pullRequest: PULL_REQUEST,
      });
      const verification = verifyCloudClaim({
        ledger: liveLedger,
        request: mappedRequest,
        evaluationTime: VERIFY_TIME,
      });
      return publicVerificationResult({
        verification,
        ledger: liveLedger,
        ledgerRevision: liveGitRevision,
      });
    },
  });

  const liveClaim = listCurrentClaims(
    liveLedger,
    VERIFY_TIME,
    { repositoryId: repository.repositoryId },
  )[0];
  assert.equal(mutationAttempts, 1);
  assert.ok(statusReads >= 2);
  assert.equal(verificationReads, 1);
  assert.equal(recovered.claimId, liveClaim.claimId);
  assert.equal(recovered.claimDigest, liveClaim.fenceRevision);
  assert.equal(recovered.claimLedgerRevision, liveClaim.ledgerRevision);
  assert.equal(recovered.ledgerRevision, BIND_GIT_REVISION);
  assert.equal(recovered.laneRevision, FENCE_SHA);
  assert.equal(recovered.transitionCounter, 2);
  assert.equal(recovered.reviewRequestId, "github-pull-request:pull-request-node-42");
  assert.equal(liveClaim.deviceId, mappedActor.deviceId);
  assert.equal(liveClaim.sessionId, mappedActor.sessionId);
  assert.equal(recovered.deviceId, RAW_DEVICE_ID);
  assert.equal(recovered.sessionId, RAW_SESSION_ID);
  assert.equal(JSON.stringify(projectPublicClaim(liveClaim)).includes(RAW_DEVICE_ID), false);
  assert.equal(JSON.stringify(projectPublicClaim(liveClaim)).includes(RAW_SESSION_ID), false);
});

test("cloud heartbeat without its verifier fails before cloud or local mutation", () => {
  const mutations = [];
  const lease = heartbeatLease();

  assert.throws(() => heartbeat({
    invocationPath: process.cwd(),
    repo: process.cwd(),
    gitText: heartbeatGitText,
    gitOptional: () => `${FENCE_SHA}\trefs/heads/${BRANCH}`,
    ghText: () => JSON.stringify({
      url: PULL_REQUEST_URL,
      state: "OPEN",
      isDraft: true,
      headRefName: BRANCH,
      headRefOid: FENCE_SHA,
      baseRefName: "main",
      body: renderWriterLeasePullRequestBody(lease),
    }),
    leaseStore: {
      verify: () => lease,
      annotate: () => {
        mutations.push("local:annotate");
        return lease;
      },
      heartbeat: () => {
        mutations.push("local:heartbeat");
        return lease;
      },
    },
    sessionId: RAW_SESSION_ID,
    leaseTtlMs: 1_800_000,
    heartbeatCloudAuthority: () => {
      mutations.push("cloud:heartbeat");
      throw new Error("unexpected cloud mutation");
    },
    run: (...args) => mutations.push(["command", ...args]),
    log: () => {},
  }), /cloud verifier/u);

  assert.deepEqual(mutations, []);
});

test("delivery authorization replay reconciles the exact authorized cloud claim", () => {
  const manifest = {
    ...MANIFEST,
    admittedReportDigest: "4".repeat(64),
  };
  const mappedActor = contractActor(RAW_ACTOR, {
    deviceId: RAW_DEVICE_ID,
    sessionId: RAW_SESSION_ID,
  });
  const repository = contractRepository(RAW_REPOSITORY, BASE_SHA);
  const claimRequest = prepareMutationRequest({
    action: "claim",
    input: {
      workItemId: "scoped-cloud-authority",
      canonicalBaseSha: BASE_SHA,
      headSha: BASE_SHA,
      declaredWriteSet: DECLARED_WRITE_SET,
      leaseEpoch: 1,
      ttlSeconds: 3_600,
      deviceId: RAW_DEVICE_ID,
      sessionId: RAW_SESSION_ID,
      idempotencyKey: "claim-scoped-cloud-authority-delivery-replay",
    },
    actor: RAW_ACTOR,
    repository: RAW_REPOSITORY,
    pullRequest: null,
    evaluationTime: CLAIM_TIME,
  });
  const claimed = applyCloudTransition({
    ledger: createEmptyLedger({ nodeId: "ledger-node-delivery-replay" }),
    action: "claim",
    request: claimRequest,
    actor: mappedActor,
    repository,
    evaluationTime: CLAIM_TIME,
  });
  const bound = applyCloudTransition({
    ledger: claimed.ledger,
    action: "bind",
    request: prepareMutationRequest({
      action: "bind",
      input: {
        claimId: claimed.claim.claimId,
        expectedFenceRevision: claimed.claim.fenceRevision,
        expectedTransitionCounter: claimed.claim.transitionCounter,
        laneRevision: FENCE_SHA,
        reviewRequestId: "github-pull-request:pull-request-node-42",
        deviceId: RAW_DEVICE_ID,
        sessionId: RAW_SESSION_ID,
        idempotencyKey: "bind-scoped-cloud-authority-delivery-replay",
      },
      actor: RAW_ACTOR,
      repository: RAW_REPOSITORY,
      pullRequest: PULL_REQUEST,
      evaluationTime: BIND_TIME,
    }),
    actor: mappedActor,
    repository,
    evaluationTime: BIND_TIME,
  });
  const focusedEvidenceDigest = digestValue({
    schema: "agentic-focused-review-evidence/v1",
    command: "npm run check",
    branch: BRANCH,
    headSha: FENCE_SHA,
    pullRequestNumber: PULL_REQUEST.number,
    admittedReportDigest: manifest.admittedReportDigest,
  });
  const ready = applyCloudTransition({
    ledger: bound.ledger,
    action: "review-ready",
    request: prepareMutationRequest({
      action: "review-ready",
      input: {
        claimId: bound.claim.claimId,
        expectedFenceRevision: bound.claim.fenceRevision,
        expectedTransitionCounter: bound.claim.transitionCounter,
        laneRevision: FENCE_SHA,
        reviewRequestId: "github-pull-request:pull-request-node-42",
        focusedEvidenceDigest,
        deviceId: RAW_DEVICE_ID,
        sessionId: RAW_SESSION_ID,
        idempotencyKey: "review-ready-scoped-cloud-authority-delivery-replay",
      },
      actor: RAW_ACTOR,
      repository: RAW_REPOSITORY,
      pullRequest: PULL_REQUEST,
      evaluationTime: VERIFY_TIME,
    }),
    actor: mappedActor,
    repository,
    evaluationTime: VERIFY_TIME,
  });
  const authorized = applyCloudTransition({
    ledger: ready.ledger,
    action: "delivery-authorize",
    request: prepareMutationRequest({
      action: "delivery-authorize",
      input: {
        claimId: ready.claim.claimId,
        expectedFenceRevision: ready.claim.fenceRevision,
        expectedTransitionCounter: ready.claim.transitionCounter,
        laneRevision: FENCE_SHA,
        reviewRequestId: "github-pull-request:pull-request-node-42",
        focusedEvidenceDigest,
        deviceId: RAW_DEVICE_ID,
        sessionId: RAW_SESSION_ID,
        operatorDecisionDigest: digestValue({ action: "delivery-authorize", branch: BRANCH }),
        integrationIntentDigest: digestValue({ headSha: FENCE_SHA, claimId: ready.claim.claimId }),
        idempotencyKey: "authorize-delivery-scoped-cloud-authority-delivery-replay",
      },
      actor: RAW_ACTOR,
      repository: RAW_REPOSITORY,
      pullRequest: PULL_REQUEST,
      evaluationTime: VERIFY_TIME,
    }),
    actor: mappedActor,
    repository,
    evaluationTime: VERIFY_TIME,
  });
  const staleAuthority = {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "org/ledger",
    targetRepository: RAW_REPOSITORY.fullName,
    claimId: ready.claim.claimId,
    claimDigest: ready.claim.fenceRevision,
    ledgerRevision: READY_GIT_REVISION,
    claimLedgerRevision: ready.claim.transitionDigest,
    canonicalBaseSha: BASE_SHA,
    laneRevision: FENCE_SHA,
    cloudDeclaredWriteScope: DECLARED_WRITE_SET,
    writeSetDigest: manifest.writeSetDigest,
    deviceId: RAW_DEVICE_ID,
    sessionId: RAW_SESSION_ID,
    reviewRequestId: "github-pull-request:pull-request-node-42",
    leaseEpoch: ready.claim.leaseEpoch,
    transitionCounter: ready.claim.transitionCounter,
    state: "review_ready",
    expiresAt: ready.claim.expiresAt,
    focusedEvidenceDigest,
  };
  let mutationAttempts = 0;
  let statusReads = 0;
  let verificationReads = 0;

  const recovered = authorizeDeliveryAdmissionCloudAuthority({
    authority: staleAuthority,
    manifest,
    branch: BRANCH,
    headSha: FENCE_SHA,
    pullRequestNumber: PULL_REQUEST.number,
    deviceId: RAW_DEVICE_ID,
    sessionId: RAW_SESSION_ID,
    invoke: () => {
      mutationAttempts += 1;
      throw new Error("unexpected delivery-authorize replay mutation");
    },
    inspect: ({ action }) => {
      assert.equal(action, "status");
      statusReads += 1;
      return publicStatusResult({
        ledger: authorized.ledger,
        ledgerRevision: DELIVERY_GIT_REVISION,
        repositoryId: repository.repositoryId,
      });
    },
    verify: ({ request }) => {
      verificationReads += 1;
      assert.equal(request.requiredState, "delivery_authorized");
      assert.equal(request.expectedLedgerRevision, DELIVERY_GIT_REVISION);
      const verification = verifyCloudClaim({
        ledger: authorized.ledger,
        request: prepareReadRequest({
          input: request,
          repository: RAW_REPOSITORY,
          pullRequest: PULL_REQUEST,
        }),
        evaluationTime: VERIFY_TIME,
      });
      return publicVerificationResult({
        verification,
        ledger: authorized.ledger,
        ledgerRevision: DELIVERY_GIT_REVISION,
      });
    },
  });

  assert.equal(mutationAttempts, 0);
  assert.ok(statusReads >= 2);
  assert.equal(verificationReads, 1);
  assert.equal(recovered.authority.state, "delivery_authorized");
  assert.equal(recovered.authority.claimId, authorized.claim.claimId);
  assert.equal(recovered.authority.claimDigest, authorized.claim.fenceRevision);
  assert.equal(recovered.authority.transitionCounter, authorized.claim.transitionCounter);
  assert.equal(recovered.authority.ledgerRevision, DELIVERY_GIT_REVISION);
});

test("cloud heartbeat machine envelope carries the joined authority evidence", () => {
  const lease = {
    ...heartbeatLease(),
    admission: { schema: "agentic-lane-admission-lease/v1", status: "admitted" },
  };
  const receipt = { schema: "agentic-mutation-authority-receipt/v1", receiptDigest: "4".repeat(64) };
  const response = { schema: "agentic-device-command-result/v1", action: "heartbeat" };
  assert.equal(attachCloudHeartbeatMachineEvidence(response, {
    lease,
    result: { mutationAuthorityReceipt: receipt },
  }), response);
  assert.deepEqual(JSON.parse(JSON.stringify(response)), {
    schema: response.schema,
    action: "heartbeat",
    admission: lease.admission,
    cloudAuthority: lease.cloudAuthority,
    mutationAuthorityReceipt: receipt,
  });
});

function publicMutationResult({ action, transition, ledgerRevision }) {
  const claim = projectPublicClaim(transition.claim);
  return {
    schema: CLOUD_RESULT_SCHEMA,
    ok: true,
    action,
    status: claim.state,
    replayed: false,
    attempts: 1,
    ledgerRevision,
    claim,
    claimDigest: transition.claimDigest,
    receipt: {
      receiptDigest: digestValue({
        action,
        claimId: claim.claimId,
        ledgerRevision,
      }),
    },
  };
}

function publicStatusResult({ ledger, ledgerRevision, repositoryId }) {
  return {
    schema: CLOUD_RESULT_SCHEMA,
    ok: true,
    action: "status",
    status: "ready",
    ledgerRevision,
    ledgerDigest: ledger.headDigest,
    sequence: ledger.sequence,
    claims: listCurrentClaims(
      ledger,
      VERIFY_TIME,
      { repositoryId },
    ).map(projectPublicClaim),
  };
}

function publicVerificationResult({ verification, ledger, ledgerRevision }) {
  return {
    schema: CLOUD_RESULT_SCHEMA,
    ok: verification.ok,
    action: "verify",
    status: verification.ok ? "ready" : "blocked",
    ledgerRevision,
    claimDigest: verification.claimDigest,
    claim: verification.claim
      ? projectPublicClaim(verification.claim)
      : null,
    findings: verification.findings,
    receipt: {
      ledgerDigest: ledger.headDigest,
      evaluationTime: VERIFY_TIME,
      receiptDigest: verification.receiptDigest,
    },
  };
}

function heartbeatLease() {
  return {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 4,
    sessionId: RAW_SESSION_ID,
    device: RAW_DEVICE_ID,
    scope: "scoped-cloud-authority",
    branch: BRANCH,
    worktreePath: process.cwd(),
    baseSha: BASE_SHA,
    fenceSha: FENCE_SHA,
    pullRequestUrl: PULL_REQUEST_URL,
    acquiredAt: CLAIM_TIME,
    heartbeatAt: CLAIM_TIME,
    expiresAt: "2099-07-31T01:30:00.000Z",
    cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1",
      provider: "github",
      ledgerRepository: "org/ledger",
      targetRepository: RAW_REPOSITORY.fullName,
      claimId: "1".repeat(64),
      claimDigest: "2".repeat(64),
      ledgerRevision: CLAIM_GIT_REVISION,
      claimLedgerRevision: "3".repeat(64),
      canonicalBaseSha: BASE_SHA,
      laneRevision: FENCE_SHA,
      cloudDeclaredWriteScope: DECLARED_WRITE_SET,
      writeSetDigest: MANIFEST.writeSetDigest,
      deviceId: RAW_DEVICE_ID,
      sessionId: RAW_SESSION_ID,
      reviewRequestId: "github-pull-request:pull-request-node-42",
      leaseEpoch: 1,
      transitionCounter: 2,
      state: "active",
      expiresAt: "2099-07-31T02:00:00.000Z",
    },
  };
}

function heartbeatGitText(args) {
  const key = args.join(" ");
  const values = {
    "worktree list --porcelain -z":
      `worktree ${process.cwd()}\0HEAD ${FENCE_SHA}\0branch refs/heads/${BRANCH}\0`,
    "diff --name-only --diff-filter=U": "",
    "ls-files -u": "",
    "branch --show-current": BRANCH,
  };
  if (!(key in values)) throw new Error(`unexpected git command: ${key}`);
  return values[key];
}
