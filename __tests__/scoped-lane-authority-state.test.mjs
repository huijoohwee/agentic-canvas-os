import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  evaluateScopedLaneAdmission,
  normalizeDeclaredWriteScopeManifest,
} from "../scripts/scoped-lane-admission-lib.mjs";
import { assertPeersUnchanged } from "../scripts/scoped-lane-admission-state.mjs";
import {
  classifyExistingLane,
  isOperationDerivedDormantPreservation,
  isReadyRemoteInventory,
  verifyCurrentCloudInventory,
  verifyDormantPreservation,
} from "../scripts/scoped-lane-authority-state.mjs";

const HEAD_SHA = "a".repeat(40);
const TREE_SHA = "b".repeat(40);
const LEDGER_SHA = "c".repeat(40);
const LEDGER_DIGEST = "d".repeat(64);
const OPERATOR_DECISION_DIGEST = "e".repeat(64);
const FUTURE = "2099-08-04T00:00:00.000Z";
const REPOSITORY_PATH = "/workspace/repository";
const REPOSITORY_NAME = "owner/repository";

function inventoryVerification(claims = []) {
  return verifyCurrentCloudInventory({
    ledgerRepository: "owner/ledger",
    targetRepository: REPOSITORY_NAME,
    inspect: () => ({
      schema: "agentic-cloud-collaboration-result/v1",
      ok: true,
      action: "status",
      status: "ready",
      ledgerRevision: LEDGER_SHA,
      ledgerDigest: LEDGER_DIGEST,
      claims,
    }),
  });
}

function lane({
  lanePath = "/workspace/worktrees/legacy",
  branch = "refs/heads/agent/old-device/new-scope",
  detached = false,
  dirty = true,
  lease = null,
} = {}) {
  return {
    path: lanePath,
    head: HEAD_SHA,
    treeSha: TREE_SHA,
    branch,
    detached,
    dirty,
    invalid: false,
    leaseAmbiguous: false,
    indexDigest: "1".repeat(64),
    workingTreeDigest: "2".repeat(64),
    stateDigest: "3".repeat(64),
    lease,
  };
}

function githubJson({ actorLogin = "owner", pullRequestHead = HEAD_SHA } = {}) {
  return argumentsList => {
    if (argumentsList[0] === "api") return { id: 42, login: actorLogin };
    if (argumentsList[0] === "repo") {
      return {
        id: "R_repo",
        nameWithOwner: REPOSITORY_NAME,
        owner: { login: "owner" },
      };
    }
    if (argumentsList[0] === "pr") {
      return {
        id: "PR_90",
        number: 90,
        url: "https://github.test/owner/repository/pull/90",
        state: "OPEN",
        isDraft: true,
        headRefName: "agent/old-device/new-scope",
        headRefOid: pullRequestHead,
        headRepository: { nameWithOwner: REPOSITORY_NAME },
        baseRefName: "main",
        baseRefOid: "f".repeat(40),
        mergeStateStatus: "DIRTY",
      };
    }
    throw new Error(`Unexpected gh invocation: ${argumentsList.join(" ")}`);
  };
}

function dormantReceipt({
  sourceLane = lane(),
  remoteAuthorityVerification = inventoryVerification(),
  pullRequestReferences = ["90"],
  ghJson = githubJson(),
} = {}) {
  return verifyDormantPreservation({
    repository: REPOSITORY_PATH,
    targetRepository: REPOSITORY_NAME,
    lanes: [sourceLane],
    worktreePaths: [sourceLane.path],
    pullRequestReferences,
    operatorDecisionDigest: OPERATOR_DECISION_DIGEST,
    sessionId: "operator-session",
    remoteAuthorityVerification,
    ghJson,
    verifiedAt: "2026-08-04T00:00:00.000Z",
  });
}

function publicClaim({
  workItem = "other-scope",
  reviewRequestId = null,
  declaredWriteScope = ["path:docs/other", "semantic:other-scope"],
} = {}) {
  const core = {
    claimId: "4".repeat(64),
    state: "active",
    actorId: "github-user:7",
    repositoryId: "github-repository:R_repo",
    workItemId: pseudonymousIdentifier("work-item", workItem),
    canonicalBaseRevision: "5".repeat(40),
    laneRevision: "6".repeat(40),
    declaredWriteScope,
    writeSetDigest: digestValue(declaredWriteScope),
    leaseEpoch: 1,
    transitionCounter: 1,
    heartbeatCounter: 0,
    reviewRequestId,
    expiresAt: FUTURE,
    fenceRevision: "7".repeat(64),
    transitionDigest: "8".repeat(64),
  };
  return core;
}

test("inventory-only status verification is operation-derived without a local peer", () => {
  const verification = inventoryVerification();
  assert.equal(isReadyRemoteInventory(verification), true);
  assert.equal(verification.inventory.claims.length, 0);
  assert.equal(verification.ledgerRevision, LEDGER_SHA);
  assert.equal(verification.ledgerDigest, LEDGER_DIGEST);
});

test("post-bind verification ignores observation time while detecting peer drift", () => {
  const candidate = publicClaim({ workItem: "candidate" });
  const peer = publicClaim({ workItem: "peer" });
  peer.claimId = "9".repeat(64);
  const before = inventoryVerification([candidate, peer]);
  const after = inventoryVerification([
    { ...candidate, transitionCounter: 2, fenceRevision: "a".repeat(64) },
    peer,
  ]);
  const report = {
    cloudAuthority: { claimId: candidate.claimId },
    remoteClaims: before.inventory.claims,
  };
  assert.doesNotThrow(() => assertPeersUnchanged(report, after));
  const peerDrift = inventoryVerification([
    { ...candidate, transitionCounter: 2, fenceRevision: "a".repeat(64) },
    { ...peer, heartbeatCounter: 1 },
  ]);
  assert.throws(
    () => assertPeersUnchanged(report, peerDrift),
    /Peer claim inventory drift/u,
  );
});

test("dormant preservation binds dirty worktree and pull-request bytes", () => {
  const sourceLane = lane();
  const receipt = dormantReceipt({ sourceLane });
  assert.equal(isOperationDerivedDormantPreservation(receipt), true);
  assert.equal(receipt.authorityState, "dormant-preserved");
  assert.deepEqual(receipt.worktrees[0], {
    path: sourceLane.path,
    branch: sourceLane.branch,
    detached: false,
    dirty: true,
    headSha: HEAD_SHA,
    treeSha: TREE_SHA,
    indexDigest: sourceLane.indexDigest,
    workingTreeDigest: sourceLane.workingTreeDigest,
    stateDigest: sourceLane.stateDigest,
    projectedClaimId: null,
  });
  assert.equal(receipt.pullRequests[0].reviewRequestId, "github-pull-request:PR_90");
});

test("verified dormant authority admits a same-scope successor but never the same branch", () => {
  const sourceLane = lane();
  const receipt = dormantReceipt({ sourceLane });
  const common = {
    lane: sourceLane,
    semanticScope: "new-scope",
    declaredWriteSet: ["path:docs/new", "semantic:new-scope"],
    evaluatedAt: new Date("2026-08-04T00:00:00.000Z"),
    currentRemoteClaims: [],
    dormantPreservationReceipt: receipt,
  };
  const successor = classifyExistingLane({
    ...common,
    branch: "agent/new-device/new-scope",
  });
  assert.equal(successor.classification, "disjoint-attributed");
  assert.equal(successor.authorityState, "dormant-preserved");
  const collision = classifyExistingLane({
    ...common,
    branch: "agent/old-device/new-scope",
  });
  assert.equal(collision.classification, "overlapping");
  assert.deepEqual(collision.overlapReasons, ["same-branch"]);
});

test("detached dormant state is byte-bound while a serialized receipt proves nothing", () => {
  const sourceLane = lane({
    lanePath: "/workspace/worktrees/detached",
    branch: null,
    detached: true,
    dirty: false,
  });
  const receipt = dormantReceipt({ sourceLane, pullRequestReferences: [] });
  const verified = classifyExistingLane({
    lane: sourceLane,
    branch: "agent/new-device/new-scope",
    semanticScope: "new-scope",
    declaredWriteSet: ["path:docs/new", "semantic:new-scope"],
    evaluatedAt: new Date("2026-08-04T00:00:00.000Z"),
    currentRemoteClaims: [],
    dormantPreservationReceipt: receipt,
  });
  assert.equal(verified.authorityState, "dormant-preserved");
  const cloned = structuredClone(receipt);
  assert.equal(isOperationDerivedDormantPreservation(cloned), false);
  const replayed = classifyExistingLane({
    lane: sourceLane,
    branch: "agent/new-device/new-scope",
    semanticScope: "new-scope",
    declaredWriteSet: ["path:docs/new", "semantic:new-scope"],
    evaluatedAt: new Date("2026-08-04T00:00:00.000Z"),
    currentRemoteClaims: [],
    dormantPreservationReceipt: cloned,
  });
  assert.equal(replayed.classification, "ambiguous");
  assert.equal(replayed.authorityState, "unattributed");
});

test("non-owner, duplicate, drifted, and current-authority projections fail closed", () => {
  assert.throws(() => dormantReceipt({
    ghJson: githubJson({ actorLogin: "not-owner" }),
  }), /authenticated repository owner/);
  assert.throws(() => verifyDormantPreservation({
    repository: REPOSITORY_PATH,
    targetRepository: REPOSITORY_NAME,
    lanes: [lane()],
    worktreePaths: [lane().path, lane().path],
    operatorDecisionDigest: OPERATOR_DECISION_DIGEST,
    sessionId: "operator-session",
    remoteAuthorityVerification: inventoryVerification(),
    ghJson: githubJson(),
  }), /must be unique/);
  let pullRequestReads = 0;
  assert.throws(() => dormantReceipt({
    ghJson: argumentsList => {
      if (argumentsList[0] !== "pr") return githubJson()(argumentsList);
      pullRequestReads += 1;
      return githubJson({
        pullRequestHead: pullRequestReads === 1 ? HEAD_SHA : "9".repeat(40),
      })(argumentsList);
    },
  }), /changed during dormant preservation/);
  assert.throws(() => dormantReceipt({
    remoteAuthorityVerification: inventoryVerification([
      publicClaim({ workItem: "new-scope" }),
    ]),
  }), /matched current cloud authority/);
  assert.throws(() => dormantReceipt({
    remoteAuthorityVerification: inventoryVerification([
      publicClaim({ reviewRequestId: "github-pull-request:PR_90" }),
    ]),
  }), /matched current cloud authority/);
});

test("admission report binds dormant receipts while remote write overlap still blocks", () => {
  const sourceLane = lane();
  const manifest = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "new-scope",
    paths: ["docs/new"],
  });
  const cleanInventory = inventoryVerification();
  const receipt = dormantReceipt({
    sourceLane,
    remoteAuthorityVerification: cleanInventory,
  });
  const canonical = lane({
    lanePath: REPOSITORY_PATH,
    branch: "refs/heads/main",
    dirty: false,
  });
  const evaluate = remoteAuthorityVerification => evaluateScopedLaneAdmission({
    repository: REPOSITORY_PATH,
    canonicalPath: REPOSITORY_PATH,
    canonicalBaseSha: HEAD_SHA,
    targetPath: "/workspace/worktrees/successor",
    branch: "agent/new-device/new-scope",
    semanticScope: "new-scope",
    targetSafe: true,
    manifest,
    lanes: [canonical, sourceLane],
    remoteAuthorityRequired: false,
    remoteAuthorityVerification,
    dormantPreservationReceipt: receipt,
    mode: "plan",
    evaluatedAt: "2026-08-04T00:00:00.000Z",
  });
  const planned = evaluate(cleanInventory);
  assert.equal(planned.authoringAdmission.status, "planned");
  assert.equal(planned.dormantPreservationReceipts[0].receiptDigest, receipt.receiptDigest);
  assert.equal(
    planned.lanes.find(item => item.path === sourceLane.path).authorityState,
    "dormant-preserved",
  );
  const schema = JSON.parse(readFileSync(
    new URL("../docs/schemas/scoped-lane-admission-report.v1.schema.json", import.meta.url),
    "utf8",
  ));
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
  assert.equal(validate(planned), true, JSON.stringify(validate.errors));

  const overlappingInventory = inventoryVerification([
    publicClaim({
      workItem: "independent-current-authority",
      declaredWriteScope: ["path:docs/new", "semantic:independent-current-authority"],
    }),
  ]);
  const blockedReceipt = dormantReceipt({
    sourceLane,
    remoteAuthorityVerification: overlappingInventory,
  });
  const blocked = evaluateScopedLaneAdmission({
    ...planned,
    repository: REPOSITORY_PATH,
    canonicalPath: REPOSITORY_PATH,
    targetPath: "/workspace/worktrees/successor",
    branch: "agent/new-device/new-scope",
    semanticScope: "new-scope",
    targetSafe: true,
    manifest,
    lanes: [canonical, sourceLane],
    cloudAuthority: null,
    remoteAuthorityRequired: false,
    remoteAuthorityVerification: overlappingInventory,
    dormantPreservationReceipt: blockedReceipt,
    mode: "plan",
    evaluatedAt: "2026-08-04T00:00:00.000Z",
  });
  assert.equal(blocked.authoringAdmission.status, "blocked");
  assert.ok(blocked.authoringAdmission.findings.some(
    finding => finding.type === "scope-admission-collision",
  ));
});

test("expired local authoring projections stop causing global ambiguity once authority lapses", () => {
  const manifest = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "new-scope",
    paths: ["docs/new"],
  });
  const expiredLane = lane({
    branch: "refs/heads/agent/old-device/legacy-scope",
    dirty: false,
    lease: {
      schema: "agentic-writer-lease/v2",
      status: "active",
      epoch: 9,
      sessionId: "expired-session",
      device: "old-device",
      scope: "legacy-scope",
      branch: "agent/old-device/legacy-scope",
      worktreePath: "/workspace/worktrees/legacy",
      baseSha: HEAD_SHA,
      fenceSha: HEAD_SHA,
      pullRequestUrl: "https://github.test/owner/repository/pull/91",
      expiresAt: "2026-08-03T00:00:00.000Z",
    },
  });
  const canonical = lane({
    lanePath: REPOSITORY_PATH,
    branch: "refs/heads/main",
    dirty: false,
  });
  const report = evaluateScopedLaneAdmission({
    repository: REPOSITORY_PATH,
    canonicalPath: REPOSITORY_PATH,
    canonicalBaseSha: HEAD_SHA,
    targetPath: "/workspace/worktrees/successor",
    branch: "agent/new-device/new-scope",
    semanticScope: "new-scope",
    targetSafe: true,
    manifest,
    lanes: [canonical, expiredLane],
    remoteAuthorityRequired: false,
    remoteAuthorityVerification: inventoryVerification(),
    mode: "plan",
    evaluatedAt: "2026-08-04T00:00:00.000Z",
  });
  const observed = report.lanes.find(item => item.path === expiredLane.path);
  assert.equal(observed.classification, "disjoint-attributed");
  assert.equal(observed.authorityState, "unattributed");
  assert.deepEqual(observed.overlapReasons, []);
  assert.equal(report.authoringAdmission.status, "planned");
});

test("queued waiting-successor projections do not trigger missing-authoritative-owner", () => {
  const observed = classifyExistingLane({
    lane: lane({
      lanePath: "/workspace/worktrees/queued",
      branch: "refs/heads/agent/old-device/queued-scope",
      dirty: false,
      lease: {
        schema: "agentic-writer-lease/v2",
        status: "active",
        epoch: 10,
        sessionId: "queued-session",
        device: "old-device",
        scope: "queued-scope",
        branch: "agent/old-device/queued-scope",
        worktreePath: "/workspace/worktrees/queued",
        baseSha: HEAD_SHA,
        fenceSha: HEAD_SHA,
        pullRequestUrl: "https://github.test/owner/repository/pull/92",
        expiresAt: FUTURE,
      },
    }),
    branch: "agent/new-device/new-scope",
    semanticScope: "new-scope",
    declaredWriteSet: ["path:docs/new", "semantic:new-scope"],
    evaluatedAt: new Date("2026-08-04T00:00:00.000Z"),
    currentRemoteClaims: [
      {
        ...publicClaim({ workItem: "agent/old-device/queued-scope" }),
        state: "waiting-successor",
        expiresAt: FUTURE,
      },
    ],
  });
  assert.equal(observed.classification, "disjoint-attributed");
  assert.equal(observed.authorityState, "unattributed");
  assert.deepEqual(observed.overlapReasons, []);
});
