// Responsibility: prove repository seams, private intent CAS/fencing, and exact cloud requests.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  buildProviderOnlyMergedClaimPairReconciliationPlan,
  providerOnlyMergedClaimPairReconciliationOperationKey,
} from "../scripts/provider-only-merged-claim-pair-reconciliation-contract.mjs";
import {
  buildProviderOnlyMergedClaimPairReconciliationEvidence,
} from "../scripts/provider-only-merged-claim-pair-reconciliation-evidence.mjs";
import {
  createProviderOnlyMergedClaimPairReconciliationAdapter,
  createProviderOnlyMergedClaimPairReconciliationCloudActions,
  providerOnlyMergedClaimPairPhaseEntry,
  readCompareChangedPaths,
  readHistoricalDeliveryController,
  readProviderOnlyMergedClaimPairEnrollment,
  readProviderOnlyMergedClaimPairLocalAbsence,
} from "../scripts/provider-only-merged-claim-pair-reconciliation-repository-adapter.mjs";
import {
  providerOnlyEvidenceFixture,
} from "./provider-only-merged-claim-pair-reconciliation-evidence.test.mjs";
const methodNames = [
  "withEntrypointFence", "readSourceEvidence", "readPlan", "writePlan", "readIntent", "writeIntent", "observePhase",
  "verifyFreshSource", "retireWaiter", "recoverSource", "integrateSource", "retireSource", "verifyTerminal",
];
test("compare changed paths are complete across every compared commit", async () => {
  const first = "1".repeat(40);
  const second = "2".repeat(40);
  const calls = [];
  const github = async endpoint => {
    calls.push(endpoint);
    if (endpoint.includes(`/commits/${first}?`)) return {
      files: [{ filename: "scripts/z.mjs" }, { filename: "scripts/a.mjs" }],
    };
    if (endpoint.includes(`/commits/${second}?`)) return {
      files: [{ filename: "scripts/a.mjs" }, { filename: "docs/b.md" }],
    };
    throw new Error(`Unexpected endpoint ${endpoint}`);
  };
  assert.deepEqual(await readCompareChangedPaths(github, "owner/repo", {
    total_commits: 2,
    commits: [{ sha: first }, { sha: second }],
  }, "protected advance"), ["docs/b.md", "scripts/a.mjs", "scripts/z.mjs"]);
  assert.equal(calls.length, 2);
  await assert.rejects(readCompareChangedPaths(github, "owner/repo", {
    total_commits: 2,
    commits: [{ sha: first }],
  }, "protected advance"), /protected advance is truncated/iu);
});
test("repository adapter requires and freezes every closed-sequence seam", () => {
  for (let count = 0; count < methodNames.length; count += 1) {
    const methods = Object.fromEntries(methodNames.slice(0, count).map(name => [name, () => {}]));
    assert.throws(
      () => createProviderOnlyMergedClaimPairReconciliationAdapter(methods),
      new RegExp(`requires ${methodNames[count]}\\(\\)`, "u"),
    );
  }
  const methods = Object.fromEntries(methodNames.map(name => [name, () => name]));
  const adapter = createProviderOnlyMergedClaimPairReconciliationAdapter({
    ...methods,
    ignoredEscapeHatch: () => "ignored",
  });
  assert.deepEqual(Object.keys(adapter), methodNames);
  assert.equal(Object.isFrozen(adapter), true);
  assert.equal("ignoredEscapeHatch" in adapter, false);
});
test("recovery TTL accepts only the sealed 60 through 86400 second range", () => {
  for (const ttlSeconds of [60, 86_400]) {
    assert.doesNotThrow(() => createProviderOnlyMergedClaimPairReconciliationCloudActions({
      ledgerRepository: "huijoohwee/agentic-canvas-os",
      targetRepository: "owner/target",
      ttlSeconds,
    }));
  }
  for (const ttlSeconds of [59, 86_401]) {
    assert.throws(() => createProviderOnlyMergedClaimPairReconciliationCloudActions({
      ledgerRepository: "huijoohwee/agentic-canvas-os",
      targetRepository: "owner/target",
      ttlSeconds,
    }), /TTL.*60.*86400|between 60 and 86400/iu);
  }
});
test("enrollment accepts exact self-checkout and keeps cross-repository pins exact", () => {
  const protectedMainSha = "1".repeat(40);
  const self = readProviderOnlyMergedClaimPairEnrollment(enrollmentFixture({
    checkout: "ref: ${{ github.sha }}",
  }), {
    controllerRepository: "huijoohwee/agentic-canvas-os",
    liveRequiredChecks: [
      { context: "Integration Gate", appId: 15368, source: "classic", strict: true },
    ],
    protectedMainSha,
    targetRepository: "huijoohwee/agentic-canvas-os",
  });
  assert.equal(self.controllerRevision, protectedMainSha);
  assert.equal(self.workflowPath, ".github/workflows/auto-delivery.yml");
  assert.deepEqual(self.requiredCiContexts, ["Integration Gate"]);
  const pinnedRevision = "2".repeat(40);
  const crossRepository = readProviderOnlyMergedClaimPairEnrollment(enrollmentFixture({
    checkout: `repository: huijoohwee/agentic-canvas-os\n          ref: ${pinnedRevision}`,
  }), {
    controllerRepository: "huijoohwee/agentic-canvas-os",
    protectedMainSha,
    targetRepository: "owner/target",
  });
  assert.equal(crossRepository.controllerRevision, pinnedRevision);
  assert.throws(() => readProviderOnlyMergedClaimPairEnrollment(enrollmentFixture({
    checkout: "repository: huijoohwee/agentic-canvas-os\n          ref: main",
  }), {
    controllerRepository: "huijoohwee/agentic-canvas-os",
    protectedMainSha,
    targetRepository: "owner/target",
  }), /enrolled controller revision.*SHA|required|exact pinned controller checkout/iu);
});
test("workflow enrollment rejects lexical run decoys and conditional checkouts", () => {
  const protectedMainSha = "1".repeat(40);
  const base = enrollmentFixture({ checkout: "ref: ${{ github.sha }}" });
  const options = {
    controllerRepository: "huijoohwee/agentic-canvas-os",
    liveRequiredChecks: [],
    protectedMainSha,
    targetRepository: "huijoohwee/agentic-canvas-os",
  };
  assert.throws(() => readProviderOnlyMergedClaimPairEnrollment(
    base.replace(
      "run: node scripts/sync-open-pr.mjs --protected-head-refresh",
      "run: echo node scripts/sync-open-pr.mjs --protected-head-refresh",
    ),
    options,
  ), /does not execute the exact pinned controller path/iu);
  assert.throws(() => readProviderOnlyMergedClaimPairEnrollment(
    base.replace(
      `- uses: actions/checkout@${"3".repeat(40)}`,
      `- uses: actions/checkout@${"3".repeat(40)}\n        if: false`,
    ),
    options,
  ), /checkout cannot be conditional/iu);
});
test("workflow enrollment parses the protected repository workflow itself", () => {
  const protectedMainSha = "1".repeat(40);
  const content = readFileSync(new URL("../.github/workflows/auto-delivery.yml", import.meta.url), "utf8");
  const proof = readProviderOnlyMergedClaimPairEnrollment(content, {
    controllerRepository: "huijoohwee/agentic-canvas-os",
    liveRequiredChecks: [],
    protectedMainSha,
    targetRepository: "huijoohwee/agentic-canvas-os",
  });
  assert.equal(proof.controllerRevision, protectedMainSha);
  assert.equal(proof.runCommand, "node scripts/sync-open-pr.mjs --protected-head-refresh");
  assert.equal(proof.workflowJob, "protected-head-refresh");
});
test("historical af3 enrollment is semantic ancestry evidence, not current 4f equality", async () => {
  const historical = "af3bff6f15ea2e6e7a01e461c077a6c99ac22a28";
  const current = "4f497143c445aaa125da06cddf59469c5c6d85a5";
  const github = async endpoint => {
    if (endpoint.includes("/git/commits/")) return { sha: historical, tree: { sha: "1".repeat(40) }, parents: [] };
    if (endpoint.includes("/compare/")) return { status: "ahead", total_commits: 1, commits: [{}] };
    if (endpoint.includes("/contents/scripts/sync-open-pr.mjs")) return { sha: "2".repeat(40),
      content: Buffer.from([
        'import { runProtectedHeadRefresh } from "./protected-head-refresh-github-adapter.mjs";',
        'if (process.argv.includes("--protected-head-refresh")) {',
        '  runProtectedHeadRefresh({ repository: process.env.GITHUB_REPOSITORY });',
        '  process.exit(0);',
        '}',
        '',
      ].join("\n")).toString("base64") };
    if (endpoint.includes("/contents/scripts/protected-head-refresh-github-adapter.mjs")) return {
      sha: "3".repeat(40),
      content: Buffer.from("export function runProtectedHeadRefresh() {}\n").toString("base64"),
    };
    throw new Error(`Unexpected endpoint ${endpoint}`);
  };
  const proof = await readHistoricalDeliveryController({ github,
    controllerRepository: "huijoohwee/agentic-canvas-os", enrollment: { controllerRevision: historical },
    currentControllerRevision: current });
  assert.equal(proof.revision, historical);
  assert.equal(proof.currentControllerRevision, current);
  assert.equal(proof.isAncestorOfCurrentController, true);
  const divergent = async endpoint => endpoint.includes("/compare/")
    ? { status: "diverged", total_commits: 1, commits: [{}] } : github(endpoint);
  await assert.rejects(readHistoricalDeliveryController({ github: divergent,
    controllerRepository: "huijoohwee/agentic-canvas-os", enrollment: { controllerRevision: historical },
    currentControllerRevision: current }), /not an ancestor/iu);
});
test("historical controller comments cannot impersonate executable dispatch", async () => {
  const historical = "a".repeat(40);
  const current = "b".repeat(40);
  const github = async endpoint => {
    if (endpoint.includes("/git/commits/")) return {
      sha: historical, tree: { sha: "1".repeat(40) }, parents: [],
    };
    if (endpoint.includes("/compare/")) return {
      status: "ahead", total_commits: 1, commits: [{}],
    };
    if (endpoint.includes("/contents/scripts/sync-open-pr.mjs")) return {
      sha: "2".repeat(40),
      content: Buffer.from([
        '// import { runProtectedHeadRefresh } from "./protected-head-refresh-github-adapter.mjs";',
        "// --protected-head-refresh",
        "",
      ].join("\n")).toString("base64"),
    };
    if (endpoint.includes("/contents/scripts/protected-head-refresh-github-adapter.mjs")) return {
      sha: "3".repeat(40),
      content: Buffer.from("export function runProtectedHeadRefresh() {}\n").toString("base64"),
    };
    throw new Error(`Unexpected endpoint ${endpoint}`);
  };
  await assert.rejects(readHistoricalDeliveryController({
    github,
    controllerRepository: "huijoohwee/agentic-canvas-os",
    enrollment: { controllerRevision: historical },
    currentControllerRevision: current,
  }), /no executable dispatch witness/iu);
});
test("provider pull identity captures the real GitHub base SHA", () => {
  const source = readFileSync(new URL(
    "../scripts/provider-only-merged-claim-pair-reconciliation-repository-adapter.mjs",
    import.meta.url), "utf8");
  assert.match(source, /baseSha:\s*sha\(pull\.base\?\.sha,\s*"pull base"\)/u);
  assert.doesNotMatch(source, /baseSha:\s*merge\.parents\[0\]/u);
});
test("local absence rejects malformed leases but treats inert Git probes as observations", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "provider-only-local-"));
  const commonDirectory = path.join(root, ".git-common");
  const source = { claimId: "a".repeat(64), laneRevision: "1".repeat(40) };
  const waiter = { claimId: "b".repeat(64) };
  const input = {
    sourceRoot: root,
    source,
    waiter,
    headBranch: "agent/device/provider-only",
    commonDirectory,
    targetRepository: "owner/target",
  };
  try {
    const local = readProviderOnlyMergedClaimPairLocalAbsence({
      ...input,
      git: localAbsenceGit(),
    });
    assert.equal(local.originRepository, "owner/target");
    assert.equal(local.sourceBranchRefPresent, false);
    assert.equal(local.matchingLeaseCount, 0);
    const leaseDirectory = path.join(commonDirectory, "agentic-canvas-os");
    mkdirSync(leaseDirectory, { recursive: true });
    writeFileSync(path.join(leaseDirectory, "writer-leases.json"), JSON.stringify({
      schema: "agentic-writer-lease-registry/v2",
      revision: 1,
      leases: [],
    }));
    assert.throws(() => readProviderOnlyMergedClaimPairLocalAbsence({
      ...input,
      git: localAbsenceGit(),
    }), /writer-lease metadata.*malformed/iu);
    writeFileSync(path.join(leaseDirectory, "writer-leases.json"), JSON.stringify({
      schema: "agentic-writer-lease-registry/v2", revision: 99,
      leases: { "agent/other": { branch: "agent/other", fenceSha: "f".repeat(40) } },
    }));
    assert.equal(readProviderOnlyMergedClaimPairLocalAbsence({
      ...input, git: localAbsenceGit(),
    }).matchingLeaseCount, 0);
    rmSync(leaseDirectory, { recursive: true, force: true });
    assert.doesNotThrow(() => readProviderOnlyMergedClaimPairLocalAbsence({
      ...input,
      git: localAbsenceGit({ fatalProbe: true }),
    }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("phase entries require every operation-bound semantic field", () => {
  const plan = planFixture();
  const authorizationDigest = digestValue({ authorization: "exact" });
  const entries = phaseEntries(plan, authorizationDigest);
  for (const phase of [
    "waiter-retired", "source-recovered", "source-integrated", "source-retired",
  ]) {
    const operationKey = providerOnlyMergedClaimPairReconciliationOperationKey(plan, phase);
    const context = { phase, plan, operationKey, intent: { authorizationDigest } };
    const snapshot = {
      sourceLineage: entries.sourceLineage,
      waiterLineage: entries.waiterLineage,
    };
    assert.ok(providerOnlyMergedClaimPairPhaseEntry(context, snapshot), phase);
  }
  const cases = [
    ["waiter-retired", values => { values.waiterLineage[0].claimCore.retirement.bytesDigest = "f".repeat(64); }],
    ["source-recovered", values => {
      values.sourceLineage.find(entry => entry.action === "continue").claimCore.expiresAt =
        "2026-08-29T08:30:01.000Z";
    }],
    ["source-integrated", values => {
      values.sourceLineage.find(entry => entry.action === "integrate")
        .claimCore.integration.operatorDecisionDigest = "f".repeat(64);
    }],
    ["source-retired", values => {
      values.sourceLineage.find(entry => entry.action === "retire")
        .claimCore.retirement.finalRevision = "f".repeat(40);
    }],
  ];
  for (const [phase, corrupt] of cases) {
    const changed = structuredClone(entries);
    corrupt(changed);
    const context = {
      phase,
      plan,
      operationKey: providerOnlyMergedClaimPairReconciliationOperationKey(plan, phase),
      intent: { authorizationDigest },
    };
    assert.equal(providerOnlyMergedClaimPairPhaseEntry(context, changed), null, phase);
  }
});
test("cloud actions emit only the exact waiter-first operation-bound requests", async () => {
  const plan = planFixture(900);
  const calls = [];
  let snapshotReads = 0;
  const integrationEntry = integrationLedgerEntry(plan);
  const sourceBaseline = structuredClone(plan.evidence.cloud.source);
  const waiterBaseline = structuredClone(plan.evidence.cloud.waiter);
  const sourceReviewed = {
    ...sourceBaseline,
    claimDigest: "c".repeat(64),
    state: "reviewed",
    recordedState: "reviewed",
    transitionCounter: plan.sourceTransitionCounter + 1,
    writeAuthority: true,
  };
  const sourceIntegrated = {
    ...sourceReviewed,
    claimDigest: "d".repeat(64),
    state: "integrated-preserved",
    recordedState: "integrated-preserved",
    transitionCounter: plan.sourceTransitionCounter + 2,
    writeAuthority: false,
  };
  const snapshot = {
    ledger: { entries: [] },
    ledgerDigest: plan.expectedLedgerDigest,
    source: sourceBaseline,
    waiter: waiterBaseline,
    sourceLineage: [integrationEntry],
  };
  const snapshots = [
    { ...snapshot, currentClaims: [sourceBaseline, waiterBaseline] },
    { ...snapshot, currentClaims: [sourceBaseline] },
    { ...snapshot, source: sourceReviewed, currentClaims: [sourceReviewed] },
    { ...snapshot, source: sourceIntegrated, currentClaims: [sourceIntegrated] },
  ];
  const actions = createProviderOnlyMergedClaimPairReconciliationCloudActions({
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/target",
    ttlSeconds: 900,
    environment: {
      SAFE_VALUE: "preserved",
      AGENTIC_CLOUD_AUTHORIZATION: "must-not-leak",
      AGENTIC_DEVICE_ID: "wrong-device",
      AGENTIC_SESSION_ID: "wrong-session",
      AGENTIC_TARGET_REPOSITORY: "wrong/repository",
    },
    invokeCloudAction: async input => { calls.push(input); },
  });
  const intent = { authorizationDigest: digestValue({ authorization: "exact" }) };
  const snapshotReader = async () => snapshots[snapshotReads++];
  const results = [];
  for (const [phase, method] of [
    ["waiter-retired", "retireWaiter"],
    ["source-recovered", "recoverSource"],
    ["source-integrated", "integrateSource"],
    ["source-retired", "retireSource"],
  ]) {
    const operationKey = providerOnlyMergedClaimPairReconciliationOperationKey(plan, phase);
    results.push(await actions[method]({ plan, intent, operationKey, snapshot: snapshotReader }));
  }
  assert.deepEqual(results.map(result => result.operationKey), [
    "waiter-retired", "source-recovered", "source-integrated", "source-retired",
  ].map(phase => providerOnlyMergedClaimPairReconciliationOperationKey(plan, phase)));
  assert.equal(snapshotReads, 4);
  assert.deepEqual(calls.map(call => call.action), ["retire", "continue", "integrate", "retire"]);
  assert.deepEqual(calls.map(call => call.request.claimId), [
    plan.waiterClaimId, plan.sourceClaimId, plan.sourceClaimId, plan.sourceClaimId,
  ]);
  assert.deepEqual(calls.map(call => call.request.expectedTransitionCounter), [
    plan.waiterTransitionCounter,
    plan.sourceTransitionCounter,
    plan.sourceTransitionCounter + 1,
    plan.sourceTransitionCounter + 2,
  ]);
  assert.equal(calls[0].request.reason, "superseded");
  assert.equal(calls[1].request.mode, "recovery");
  assert.equal(calls[1].request.ttlSeconds, 900);
  assert.equal(calls[2].request.operatorDecisionDigest, intent.authorizationDigest);
  assert.equal(calls[2].request.candidateRevision, plan.sourceLaneRevision);
  assert.equal(calls[3].request.reason, "integrated");
  assert.match(calls[3].request.integrationReceiptDigest, /^[0-9a-f]{64}$/u);
  for (const [index, call] of calls.entries()) {
    assert.equal(call.ledgerRepository, "owner/ledger");
    assert.equal(call.request.targetRepository, "owner/target");
    assert.equal(call.request.expectedLedgerDigest, plan.expectedLedgerDigest);
    assert.equal(
      call.request.idempotencyKey,
      `provider-only-merged-claim-pair-reconciliation:${results[index].operationKey}`,
    );
    assert.equal(call.environment.SAFE_VALUE, "preserved");
    assert.equal(call.environment.AGENTIC_DEVICE_ID, plan.effectDeviceId);
    assert.equal(call.environment.AGENTIC_SESSION_ID, plan.effectSessionId);
    assert.equal("AGENTIC_CLOUD_AUTHORIZATION" in call.environment, false);
    assert.equal("AGENTIC_TARGET_REPOSITORY" in call.environment, false);
  }
  const foreign = {
    ...sourceBaseline,
    claimId: "e".repeat(64),
    claimDigest: "f".repeat(64),
    workItemId: sourceBaseline.workItemId,
  };
  for (const [index, [phase, method]] of [
    ["waiter-retired", "retireWaiter"],
    ["source-recovered", "recoverSource"],
    ["source-integrated", "integrateSource"],
    ["source-retired", "retireSource"],
  ].entries()) {
    let invoked = false;
    const blocked = createProviderOnlyMergedClaimPairReconciliationCloudActions({
      ledgerRepository: "owner/ledger",
      targetRepository: "owner/target",
      ttlSeconds: 900,
      invokeCloudAction: async () => { invoked = true; },
    });
    await assert.rejects(blocked[method]({
      plan,
      intent,
      operationKey: providerOnlyMergedClaimPairReconciliationOperationKey(plan, phase),
      snapshot: async () => ({
        ...snapshots[index],
        currentClaims: [...snapshots[index].currentClaims, foreign],
      }),
    }), /foreign same-work-item|conflict set/iu);
    assert.equal(invoked, false, phase);
  }
});
function planFixture(recoveryTtlSeconds = 1_800) {
  const raw = providerOnlyEvidenceFixture();
  raw.recoveryTtlSeconds = recoveryTtlSeconds;
  return buildProviderOnlyMergedClaimPairReconciliationPlan(
    buildProviderOnlyMergedClaimPairReconciliationEvidence(raw),
  );
}
function integrationLedgerEntry(plan) {
  const operationKey = providerOnlyMergedClaimPairReconciliationOperationKey(
    plan,
    "source-integrated",
  );
  return {
    action: "integrate",
    repositoryId: plan.repositoryId,
    claimId: plan.sourceClaimId,
    claimDigest: digestValue({ phase: "source-integrated", kind: "claim" }),
    digest: digestValue({ phase: "source-integrated", kind: "entry" }),
    sequence: plan.expectedLedgerSequence + 3,
    idempotencyKey: digestValue(
      `provider-only-merged-claim-pair-reconciliation:${operationKey}`,
    ),
    requestDigest: digestValue({ phase: "source-integrated", kind: "request" }),
    evaluationTime: "2026-08-29T08:00:00.000Z",
    claimCore: { transitionCounter: plan.sourceTransitionCounter + 2 },
  };
}
function enrollmentFixture({ checkout }) {
  const crossRepository = checkout.includes("repository:");
  const controllerPath = crossRepository ? ".agentic-canvas-os/" : "";
  const checkoutSteps = crossRepository ? `
      - uses: actions/checkout@${"3".repeat(40)}
        with:
          ref: \${{ github.sha }}
          persist-credentials: false
      - uses: actions/checkout@${"3".repeat(40)}
        with:
          ${checkout}
          path: .agentic-canvas-os
          persist-credentials: false` : `
      - uses: actions/checkout@${"3".repeat(40)}
        with:
          ${checkout}
          persist-credentials: false`;
  return `
jobs:
  protected-head-refresh:
    if: github.ref == 'refs/heads/main' && inputs.operation == 'protected-head-refresh'
    steps:${checkoutSteps}
      - name: Execute controller
        env:
          PROTECTED_HEAD_REFRESH_CLASSIC_REQUIRED_CHECKS_JSON: '["Integration Gate"]'
          PROTECTED_HEAD_REFRESH_RULESET_REQUIRED_CHECKS_JSON: '[]'
          PROTECTED_HEAD_REFRESH_REQUIRED_CI_CONTEXTS_JSON: '["Integration Gate"]'
        run: node ${controllerPath}scripts/sync-open-pr.mjs --protected-head-refresh
`;
}
function localAbsenceGit({ fatalProbe = false } = {}) {
  const mainSha = "2".repeat(40);
  return args => {
    const [command, ...rest] = args;
    if (command === "worktree") {
      return `worktree /clean-main\nHEAD ${mainSha}\nbranch refs/heads/main`;
    }
    if (command === "config") return "git@github.com:owner/target.git";
    if (command === "branch") return "main";
    if (command === "status") return "";
    if (command === "rev-parse") return mainSha;
    if (["show-ref", "cat-file"].includes(command)) {
      const error = new Error(fatalProbe && command === "cat-file" ? "disk failure" : "not found");
      error.status = fatalProbe && command === "cat-file" ? 128 : 1;
      throw error;
    }
    throw new Error(`Unexpected Git call: ${[command, ...rest].join(" ")}`);
  };
}
function phaseEntries(plan, authorizationDigest) {
  const operation = phase => providerOnlyMergedClaimPairReconciliationOperationKey(plan, phase);
  const entry = ({ action, claimId, counter, phase, claimCore }) => ({
    action,
    repositoryId: plan.repositoryId,
    claimId,
    claimDigest: digestValue({ phase, kind: "claim" }),
    digest: digestValue({ phase, kind: "entry" }),
    sequence: plan.expectedLedgerSequence + counter,
    idempotencyKey: digestValue(
      `provider-only-merged-claim-pair-reconciliation:${operation(phase)}`,
    ),
    requestDigest: digestValue({ phase, kind: "request" }),
    evaluationTime: "2026-08-29T08:00:00.000Z",
    claimCore: { ...claimCore, transitionCounter: counter },
  });
  const waiter = entry({
    action: "retire", claimId: plan.waiterClaimId,
    counter: plan.waiterTransitionCounter + 1, phase: "waiter-retired",
    claimCore: { retirement: retirementValues(plan, { reason: plan.waiterRetirementReason }) },
  });
  const recoveredAt = "2026-08-29T08:00:00.000Z";
  const recovered = entry({
    action: "continue", claimId: plan.sourceClaimId,
    counter: plan.sourceTransitionCounter + 1, phase: "source-recovered",
    claimCore: {
      state: "reviewed", laneRevision: plan.sourceLaneRevision,
      reviewRequestId: plan.sourceReviewRequestId,
      deviceId: plan.effectDeviceId, sessionId: plan.effectSessionId,
      recovery: { evidenceDigest: operation("source-recovered"), recoveredAt },
      expiresAt: new Date(Date.parse(recoveredAt) + plan.recoveryTtlSeconds * 1_000).toISOString(),
    },
  });
  const integrated = entry({
    action: "integrate", claimId: plan.sourceClaimId,
    counter: plan.sourceTransitionCounter + 2, phase: "source-integrated",
    claimCore: {
      state: "integrated-preserved",
      integration: {
        candidateRevision: plan.sourceLaneRevision,
        reviewRequestId: plan.sourceReviewRequestId,
        focusedEvidenceDigest: plan.sourceFocusedEvidenceDigest,
        dependencyClosureDigest: plan.dependencyClosureDigest,
        namedChecksDigest: plan.namedChecksDigest,
        handoffEvidenceDigest: plan.handoffEvidenceDigest,
        operatorDecisionDigest: authorizationDigest,
        integrationIntentDigest: operation("source-integrated"),
        integratedAt: "2026-08-29T08:00:00.000Z",
      },
    },
  });
  const integrationReceiptDigest = ledgerOperationReceipt(integrated, "integrated-preserved");
  const retired = entry({
    action: "retire", claimId: plan.sourceClaimId,
    counter: plan.sourceTransitionCounter + 3, phase: "source-retired",
    claimCore: {
      retirement: retirementValues(plan, {
        reason: plan.sourceRetirementReason,
        reviewRequestId: plan.sourceReviewRequestId,
        integrationReceiptDigest,
      }),
    },
  });
  return { sourceLineage: [recovered, integrated, retired], waiterLineage: [waiter] };
}
function retirementValues(plan, {
  reason, reviewRequestId = null, integrationReceiptDigest = null,
}) {
  return {
    reason,
    finalRevision: plan.sourceLaneRevision,
    reviewRequestId,
    bytesDigest: plan.bytesDigest,
    namedChecksDigest: plan.namedChecksDigest,
    handoffEvidenceDigest: plan.handoffEvidenceDigest,
    integrationReceiptDigest,
    retiredAt: "2026-08-29T08:00:00.000Z",
  };
}
function ledgerOperationReceipt(entry, status) {
  return digestValue({
    schema: "agentic-collaboration-integration-receipt/v1",
    operation: "integrate",
    status,
    repositoryId: entry.repositoryId,
    claimId: entry.claimId,
    claimDigest: entry.claimDigest,
    fenceRevision: entry.claimDigest,
    ledgerRevision: entry.digest,
    ledgerSequence: entry.sequence,
    idempotencyKey: entry.idempotencyKey,
    requestDigest: entry.requestDigest,
    evaluationTime: entry.evaluationTime,
  });
}
