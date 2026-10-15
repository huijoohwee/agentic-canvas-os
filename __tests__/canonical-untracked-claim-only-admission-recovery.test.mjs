import assert from "node:assert/strict";
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync,
  statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  authorizeCanonicalUntrackedClaimOnlyAdmissionRecovery,
  buildCanonicalUntrackedClaimOnlyAdmissionRecoveryPlan,
} from "../scripts/canonical-untracked-claim-only-admission-recovery-contract.mjs";
import { createCanonicalUntrackedClaimOnlyAdmissionRecoveryController }
  from "../scripts/canonical-untracked-claim-only-admission-recovery-controller.mjs";
import {
  buildCanonicalUntrackedClaimOnlyAdmissionRecoveryEvidence,
} from "../scripts/canonical-untracked-claim-only-admission-recovery-evidence.mjs";
import {
  createCanonicalUntrackedClaimOnlyAdmissionRecoveryStore,
  writeCanonicalUntrackedClaimOnlyPrivateJson,
}
  from "../scripts/canonical-untracked-claim-only-admission-recovery-store.mjs";
import { pseudonymousIdentifier }
  from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  createCanonicalUntrackedClaimOnlyTaskReceiptGate,
  normalizeCanonicalUntrackedClaimOnlySourceAuthoritySelector,
  validateCanonicalUntrackedClaimOnlyPathRoles,
  verifyCanonicalUntrackedClaimOnlyContinuationResult,
} from "../scripts/canonical-untracked-claim-only-admission-recovery-repository-adapter.mjs";

const sha = character => character.repeat(40);
const digest = character => character.repeat(64);

function fixture(overrides = {}) {
  const scope = "agentic-graph-commerce-platform";
  const paths = [
    `specs/${scope}/design.md`,
    `specs/${scope}/requirements.md`,
  ];
  const claim = {
    claimId: digest("1"),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    actorId: "github-user:1",
    repositoryId: "github-repository:R_target",
    workItemId: `work-item:${digest("2")}`,
    canonicalBaseRevision: sha("a"),
    laneRevision: sha("a"),
    declaredWriteScope: [`path:specs/${scope}/`, `semantic:${scope}`].sort(),
    writeSetDigest: null,
    leaseEpoch: 1,
    transitionCounter: 1,
    heartbeatCounter: 0,
    state: "dormant-preserved",
    writeAuthority: false,
    scopeReserved: true,
    reviewRequestId: null,
    predecessorClaimId: null,
    recovery: null,
    integration: null,
    fenceRevision: digest("3"),
    transitionDigest: digest("4"),
    operationReceiptDigest: digest("5"),
    deviceId: pseudonymousIdentifier("device", "test-device"),
    sessionId: pseudonymousIdentifier("session", "test-session"),
    expiresAt: "2026-08-30T00:00:00.000Z",
  };
  const raw = {
    identity: {
      device: "test-device",
      sessionId: "test-session",
      scope,
      branch: `agent/test-device/${scope}`,
      targetWorktreeDigest: digest("8"),
    },
    source: {
      repository: "owner/target",
      repositoryPathDigest: digest("9"),
      gitCommonDirectoryDigest: digest("a"),
      branch: "main",
      headSha: sha("a"),
      originMainSha: sha("a"),
      remoteMainSha: sha("a"),
      primaryCanonical: true,
      registeredWorktree: true,
      trackedPaths: [],
      untrackedPaths: paths,
      stateDigest: digest("b"),
      writeSetDigest: digest("c"),
    },
    preservation: {
      captureProfile: "canonical-untracked-retention",
      packageDigest: digest("d"),
      sourceHeadSha: sha("a"),
      protectedTipSha: sha("a"),
      operatorSessionId: "test-session",
      stateDigest: digest("b"),
      writeSetDigest: digest("c"),
      trackedPaths: [],
      untrackedPaths: paths,
    },
    manifest: {
      schema: "agentic-declared-write-scope/v1",
      semanticScope: scope,
      paths: [`specs/${scope}/`],
    },
    cloud: {
      ledgerRepository: "owner/ledger",
      targetRepository: "owner/target",
      ledgerRevision: sha("e"),
      ledgerDigest: digest("f"),
      inventoryDigest: digest("0"),
      sourceAuthorityDigest: digest("1"),
      claim,
      overlappingClaimIds: [],
    },
    absence: {
      targetPathAbsent: true,
      worktreeRegistrationAbsent: true,
      localBranchAbsent: true,
      remoteBranchAbsent: true,
      writerLeaseAbsent: true,
      pullRequestAbsent: true,
    },
    controller: {
      repository: "owner/agentic-canvas-os",
      branch: "main",
      headSha: sha("f"),
      originMainSha: sha("f"),
      remoteMainSha: sha("f"),
      clean: true,
      protectedMain: true,
      primaryCanonical: true,
      registeredWorktree: true,
    },
  };
  return merge(raw, overrides);
}

function merge(left, right) {
  if (!right || typeof right !== "object" || Array.isArray(right)) return right === undefined ? left : right;
  const output = { ...left };
  for (const [key, value] of Object.entries(right)) {
    output[key] = value && typeof value === "object" && !Array.isArray(value)
      ? merge(left[key] || {}, value) : value;
  }
  return output;
}

async function validEvidence(overrides = {}) {
  const { normalizeDeclaredWriteScopeManifest } = await import("../scripts/scoped-lane-admission-lib.mjs");
  const raw = fixture(overrides);
  raw.cloud.claim.writeSetDigest = normalizeDeclaredWriteScopeManifest(raw.manifest).writeSetDigest;
  return buildCanonicalUntrackedClaimOnlyAdmissionRecoveryEvidence(raw);
}

test("evidence accepts only the canonical-untracked dormant transition-1 claim-only shape", async () => {
  const sealed = await validEvidence();
  assert.equal(sealed.source.trackedPaths.length, 0);
  assert.equal(sealed.cloud.claim.transitionCounter, 1);
  assert.deepEqual(sealed.cloud.overlappingClaimIds, []);
  await assert.rejects(async () => validEvidence({
    cloud: { claim: { transitionCounter: 2 } },
  }), /dormant transition-1 claim-only subject/u);
  await assert.rejects(async () => validEvidence({
    absence: { writerLeaseAbsent: false },
  }), /lane projections absent/u);
  await assert.rejects(async () => validEvidence({
    preservation: { operatorSessionId: "another-session" },
  }), /preservation package\/source equality/u);
  await assert.rejects(async () => validEvidence({
    cloud: { targetRepository: "owner/other" },
  }), /dormant transition-1 claim-only subject/u);
  await assert.rejects(async () => validEvidence({
    cloud: { claim: { deviceId: pseudonymousIdentifier("device", "other-device") } },
  }), /dormant transition-1 claim-only subject/u);
  await assert.rejects(async () => validEvidence({
    source: { untrackedPaths: ["outside-scope.md"] },
    preservation: { untrackedPaths: ["outside-scope.md"] },
  }), /manifest path ownership/u);
});

test("plan has one literal authorization and forbids every lane projection", async () => {
  const plan = buildCanonicalUntrackedClaimOnlyAdmissionRecoveryPlan({ evidence: await validEvidence() });
  assert.equal(plan.exactAuthorization,
    `authorize canonical-untracked-claim-only-admission-recovery ${plan.planDigest}`);
  assert.deepEqual(plan.allowedEffects, [
    "private-journal", "same-claim-dormant-recovery", "private-authority-output",
  ]);
  for (const effect of ["new-claim", "new-branch", "worktree-projection", "writer-lease-projection", "pull-request"]) {
    assert.ok(plan.forbiddenEffects.includes(effect));
  }
  assert.throws(() => authorizeCanonicalUntrackedClaimOnlyAdmissionRecovery({
    plan,
    authorization: `authorize canonical-untracked-claim-only-admission-recovery ${digest("f")}`,
  }), /Exact authorization required/u);
});

test("controller performs one same-claim continuation, returns raw wrapped authority, and replays", async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "claim-only-recovery-")));
  try {
    const calls = [];
    let sourceDrift = false;
    const sealedEvidence = await validEvidence();
    const recoveredClaim = {
      ...sealedEvidence.cloud.claim,
      state: "current",
      writeAuthority: true,
      transitionCounter: 2,
      recovery: { evidenceDigest: sealedEvidence.evidenceDigest },
      fenceRevision: digest("a"),
      transitionDigest: digest("b"),
      operationReceiptDigest: digest("c"),
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    const authority = {
      ledgerRepository: "owner/ledger",
      targetRepository: "owner/target",
      result: {
        schema: "agentic-cloud-collaboration-result/v1",
        ok: true,
        action: "continue",
        status: "current",
        claim: recoveredClaim,
      },
    };
    const adapter = {
      readPlanEvidence: async () => sealedEvidence,
      assertSource: async (_plan, label) => { calls.push(`assert:${label}`); if (sourceDrift) throw new Error("source drift"); return {}; },
      authorizeTask: async plan => { calls.push("task-authority"); return { status: "verified", operation: plan.taskAuthorityOperation, receiptDigest: digest("d") }; },
      sealCloudRequest: async () => { calls.push("seal-request"); return { sealedTransportDigest: digest("e") }; },
      recoverCloud: async () => { calls.push("same-claim-continue"); return { authority, authorityDigest: digest("f"), claimDigest: digest("a") }; },
      verifyTerminal: async () => { calls.push("verify"); return { terminalReceiptDigest: digest("0") }; },
    };
    const store = createCanonicalUntrackedClaimOnlyAdmissionRecoveryStore({
      statePath: path.join(root, "journal.json"),
    });
    const controller = createCanonicalUntrackedClaimOnlyAdmissionRecoveryController({ adapter, store });
    const plan = await controller.plan();
    await assert.rejects(() => controller.run({ plan, authorization: "authorize no" }), /Exact authorization required/u);
    const result = await controller.run({ plan, authorization: plan.exactAuthorization });
    assert.equal(result.ok, true);
    assert.deepEqual(result.authority, authority);
    assert.equal(calls.filter(value => value === "same-claim-continue").length, 1);
    assert.equal(calls.filter(value => value === "task-authority").length, 2);
    assert.equal(calls[calls.indexOf("same-claim-continue") - 1], "task-authority");
    assert.equal(statSync(store.statePath).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(store.statePath, "utf8")).status, "complete");
    const replay = await controller.run({ plan, authorization: plan.exactAuthorization });
    assert.deepEqual(replay, result);
    assert.equal(calls.filter(value => value === "same-claim-continue").length, 1);
    assert.ok(calls.includes("assert:completed-replay"));
    sourceDrift = true;
    await assert.rejects(() => controller.run({ plan, authorization: plan.exactAuthorization }), /source drift/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a resumed continuation re-proves capability immediately before its only mutation", async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "claim-only-proof-")));
  try {
    const sealedEvidence = await validEvidence();
    let proofs = 0;
    let mutations = 0;
    const adapter = {
      readPlanEvidence: async () => sealedEvidence,
      assertSource: async () => ({}),
      authorizeTask: async plan => {
        proofs += 1;
        if (proofs === 2) throw new Error("capability is unavailable");
        return { status: "verified", operation: plan.taskAuthorityOperation, receiptDigest: digest("d") };
      },
      sealCloudRequest: async () => ({ sealedTransportDigest: digest("e") }),
      recoverCloud: async () => { mutations += 1; return {}; },
      verifyTerminal: async () => ({ terminalReceiptDigest: digest("0") }),
    };
    const store = createCanonicalUntrackedClaimOnlyAdmissionRecoveryStore({
      statePath: path.join(root, "journal.json"),
    });
    const controller = createCanonicalUntrackedClaimOnlyAdmissionRecoveryController({ adapter, store });
    const plan = await controller.plan();
    await assert.rejects(() => controller.run({ plan, authorization: plan.exactAuthorization }),
      /capability is unavailable/u);
    assert.equal(proofs, 2);
    assert.equal(mutations, 0);
    assert.equal(JSON.parse(readFileSync(store.statePath, "utf8")).status, "cloud_request_sealed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repository-adapter selector and one-use proof gate reject forged recovery inputs", async () => {
  const selector = normalizeCanonicalUntrackedClaimOnlySourceAuthoritySelector({
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/target",
    result: { schema: "agentic-cloud-collaboration-result/v1", ok: true, claim: { claimId: digest("1") } },
  });
  assert.deepEqual(selector, {
    ledgerRepository: "owner/ledger", targetRepository: "owner/target", claimId: digest("1"),
  });
  assert.throws(() => normalizeCanonicalUntrackedClaimOnlySourceAuthoritySelector({
    result: { schema: "agentic-cloud-collaboration-result/v1", ok: true, claim: { claimId: digest("1") } },
  }), /wrapped ledger repository/u);
  const plan = buildCanonicalUntrackedClaimOnlyAdmissionRecoveryPlan({ evidence: await validEvidence() });
  let gateNow = new Date("2026-08-31T10:00:00.000Z");
  const gate = createCanonicalUntrackedClaimOnlyTaskReceiptGate({ now: () => gateNow });
  const receipt = {
    status: "verified",
    operation: plan.taskAuthorityOperation,
    receiptDigest: digest("d"),
    verifiedAt: "2026-08-31T10:00:00.000Z",
  };
  assert.throws(() => gate.consume({ ...receipt, purpose: "cloud-continuation" }, plan),
    /Fresh plan-bound task authority/u);

  const tamperedReceipt = { ...receipt, receiptDigest: digest("f") };
  gate.issue(tamperedReceipt, plan);
  assert.throws(() => gate.consume({
    ...tamperedReceipt,
    verifiedAt: "2026-08-31T10:00:00.001Z",
    purpose: "cloud-continuation",
  }, plan), /Fresh plan-bound task authority/u);
  assert.throws(() => gate.consume({ ...tamperedReceipt, purpose: "cloud-continuation" }, plan),
    /Fresh plan-bound task authority/u);

  const expiringReceipt = { ...receipt, receiptDigest: digest("e") };
  gate.issue(expiringReceipt, plan);
  gateNow = new Date("2026-08-31T10:01:00.001Z");
  assert.throws(() => gate.consume({ ...expiringReceipt, purpose: "cloud-continuation" }, plan),
    /Fresh plan-bound task authority/u);
  gateNow = new Date("2026-08-31T10:00:00.001Z");
  assert.throws(() => gate.consume({ ...expiringReceipt, purpose: "cloud-continuation" }, plan),
    /Fresh plan-bound task authority/u);
  gate.issue(receipt, plan);
  assert.doesNotThrow(() => gate.consume({ ...receipt, purpose: "cloud-continuation" }, plan));
  assert.throws(() => gate.consume({ ...receipt, purpose: "cloud-continuation" }, plan),
    /Fresh plan-bound task authority/u);

  const recovered = {
    ...plan.evidence.cloud.claim,
    state: "current",
    writeAuthority: true,
    transitionCounter: 2,
    recovery: { evidenceDigest: plan.evidence.evidenceDigest, recoveredAt: "2098-12-31T23:00:00.000Z" },
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  assert.throws(() => verifyCanonicalUntrackedClaimOnlyContinuationResult({
    result: {
      schema: "agentic-cloud-collaboration-result/v1", ok: true, action: "claim", status: "current",
      operationReceipt: { evaluationTime: "2098-12-31T23:00:00.000Z" },
      receipt: { evaluationTime: "2098-12-31T23:00:00.000Z" },
    },
    claim: recovered,
    source: plan.evidence.cloud.claim,
    plan,
    request: { idempotencyKey: "key" },
  }), /Same-claim continuation receipts are invalid/u);
});

test("CLI path roles are external and disjoint, and dangling journal/output paths fail closed", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "claim-only-paths-")));
  try {
    const repository = path.join(root, "source");
    const recoveryDirectory = path.join(root, "package");
    const controllerRoot = path.join(root, "controller");
    const external = path.join(root, "private");
    const targetParent = path.join(root, "targets");
    for (const directory of [repository, recoveryDirectory, controllerRoot, external, targetParent]) {
      mkdirSync(directory, { mode: 0o700 });
    }
    const manifestFile = path.join(recoveryDirectory, "manifest.json");
    const cloudAuthorityFile = path.join(recoveryDirectory, "authority.json");
    const taskAuthorityFile = path.join(external, "capability.json");
    const planFile = path.join(external, "plan.json");
    for (const file of [manifestFile, cloudAuthorityFile, taskAuthorityFile, planFile]) {
      writeFileSync(file, "{}\n", { mode: 0o600 }); chmodSync(file, 0o600);
    }
    const common = {
      repository, recoveryDirectory, controllerRoot,
      targetWorktree: path.join(targetParent, "lane"),
      manifestFile, cloudAuthorityFile,
      statePath: path.join(external, "journal.json"),
    };
    assert.doesNotThrow(() => validateCanonicalUntrackedClaimOnlyPathRoles({
      ...common, planOutput: path.join(external, "new-plan.json"),
    }));
    assert.doesNotThrow(() => validateCanonicalUntrackedClaimOnlyPathRoles({
      ...common,
      targetWorktree: path.join(root, "missing", "parent", "lane"),
      planOutput: path.join(external, "missing", "parent", "new-plan.json"),
    }));
    assert.doesNotThrow(() => validateCanonicalUntrackedClaimOnlyPathRoles({
      ...common, planFile, taskAuthorityFile,
      authorityOutput: path.join(external, "authority-output.json"),
    }));
    assert.throws(() => validateCanonicalUntrackedClaimOnlyPathRoles({
      ...common, planOutput: path.join(repository, "plan.json"),
    }), /external to repository/u);
    assert.throws(() => validateCanonicalUntrackedClaimOnlyPathRoles({
      ...common,
      targetWorktree: path.join(repository, "nested-lane"),
      planOutput: path.join(external, "new-plan.json"),
    }), /targetWorktree must be external to repository/u);
    assert.throws(() => validateCanonicalUntrackedClaimOnlyPathRoles({
      ...common,
      planOutput: path.join(common.targetWorktree, "private", "plan.json"),
    }), /hierarchy-disjoint/u);
    assert.throws(() => validateCanonicalUntrackedClaimOnlyPathRoles({
      ...common,
      statePath: path.join(common.targetWorktree, "private", "journal.json"),
      planOutput: path.join(external, "new-plan.json"),
    }), /hierarchy-disjoint/u);
    assert.throws(() => validateCanonicalUntrackedClaimOnlyPathRoles({
      ...common,
      statePath: path.join(targetParent, "prospective-root"),
      targetWorktree: path.join(targetParent, "prospective-root", "lane"),
      planOutput: path.join(external, "new-plan.json"),
    }), /hierarchy-disjoint/u);
    assert.throws(() => validateCanonicalUntrackedClaimOnlyPathRoles({
      ...common,
      planFile,
      taskAuthorityFile,
      authorityOutput: path.join(common.targetWorktree, "private", "authority.json"),
    }), /hierarchy-disjoint/u);
    assert.throws(() => validateCanonicalUntrackedClaimOnlyPathRoles({
      ...common, planFile, taskAuthorityFile: manifestFile,
      authorityOutput: path.join(external, "authority-output.json"),
    }), /Path roles must be distinct|external to recoveryDirectory/u);
    assert.throws(() => validateCanonicalUntrackedClaimOnlyPathRoles({
      ...common, planOutput: common.statePath,
    }), /Path roles must be distinct/u);

    const dangling = path.join(external, "dangling-journal.json");
    symlinkSync(path.join(external, "missing-journal.json"), dangling);
    const store = createCanonicalUntrackedClaimOnlyAdmissionRecoveryStore({ statePath: dangling });
    assert.throws(() => store.readIntent(), /private regular file/u);
    const output = path.join(external, "private-output.json");
    writeCanonicalUntrackedClaimOnlyPrivateJson(output, { value: 1 });
    assert.throws(() => writeCanonicalUntrackedClaimOnlyPrivateJson(output, { value: 2 }, { replace: true }),
      /already exists/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
