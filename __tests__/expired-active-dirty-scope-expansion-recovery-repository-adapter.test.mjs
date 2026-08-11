// Responsibility: Prove the recovery repository adapter's exact IO, journal, cloud, and PR CAS boundaries.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue, normalizeWriteSet } from "../scripts/cloud-collaboration-primitives.mjs";
import { createExpiredActiveDirtyScopeExpansionRecoveryController } from "../scripts/expired-active-dirty-scope-expansion-recovery-controller.mjs";
import { projectPublicClaim, pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  assertExpiredActiveDirtyScopeExpansionRecoveryPullRequestSnapshot,
  assertExpiredActiveDirtyScopeExpansionRecoveryPullRequestUpdate,
  createExpiredActiveDirtyScopeExpansionRecoveryAdapter,
  createExpiredActiveDirtyScopeExpansionRecoveryIntentStore,
  createExpiredActiveDirtyScopeExpansionRecoveryStableInventoryReader,
  createRepositoryExpiredActiveDirtyScopeExpansionRecoveryAdapter,
  invokeExpiredActiveDirtyScopeExpansionRecoveryCloudJson,
  projectExpiredActiveDirtyScopeExpansionRecoveryCloud,
  replaceExpiredActiveDirtyScopeExpansionRecoveryPullRequestMarker,
  resolveExpiredActiveDirtyScopeExpansionRecoveryJournalPath,
  requireExpiredActiveDirtyScopeExpansionRecoveryCloudResult,
  requireExpiredActiveDirtyScopeExpansionRecoveryExactClaim,
} from "../scripts/expired-active-dirty-scope-expansion-recovery-repository-adapter.mjs";
import { projectWriterLeasePullRequestMarker } from "../scripts/writer-lease-lib.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";

const digest = label => digestValue({ label });
const sha = label => digest(label).slice(0, 40);

test("repository composition pins controller and claim journal away from source bytes", () => {
  const claimId = digest("claim"), attemptDigest = digest("attempt");
  const root = mkdtempSync(path.join(os.tmpdir(), "expired-dirty-journal-"));
  const foreignController = mkdtempSync(path.join(os.tmpdir(), "foreign-controller-"));
  try {
    assert.throws(() => createRepositoryExpiredActiveDirtyScopeExpansionRecoveryAdapter({
      sourceRepository: "/not-read", targetRepository: "owner/repository",
      pullRequestNumber: 358, claimId, controllerRoot: foreignController,
    }), /exact protected controller root/);
    assert.throws(() => resolveExpiredActiveDirtyScopeExpansionRecoveryJournalPath({
      commonDirectory: root, claimId, attemptDigest, statePath: path.join(root, "tracked-source.json"),
    }), /Custom .* journal paths are forbidden/);
    const external = path.join(root, "external");
    mkdirSync(external);
    symlinkSync(external, path.join(root, "agentic-canvas-os"), "dir");
    assert.throws(() => resolveExpiredActiveDirtyScopeExpansionRecoveryJournalPath({
      commonDirectory: root, claimId, attemptDigest,
    }), /dedicated regular-file target/);
    rmSync(path.join(root, "agentic-canvas-os"));
    const journalDirectory = path.join(root, "agentic-canvas-os",
      "expired-active-dirty-scope-expansion-recovery");
    mkdirSync(journalDirectory, { recursive: true });
    const journalPath = path.join(journalDirectory, `${claimId}.${attemptDigest}.json`);
    const sourceBytes = "tracked source bytes\n";
    writeFileSync(journalPath, sourceBytes);
    assert.throws(() => resolveExpiredActiveDirtyScopeExpansionRecoveryJournalPath({
      commonDirectory: root, claimId, attemptDigest,
    }), /not a valid journal/);
    assert.equal(readFileSync(journalPath, "utf8"), sourceBytes);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(foreignController, { recursive: true, force: true });
  }
});

test("adapter surface and durable journal reject missing methods, stale CAS, and tampering", async () => {
  assert.throws(() => createExpiredActiveDirtyScopeExpansionRecoveryAdapter({}), /requires withEntrypointFence/);
  const root = mkdtempSync(path.join(os.tmpdir(), "expired-dirty-recovery-"));
  const statePath = path.join(root, "state", "intent.json");
  try {
    const store = createExpiredActiveDirtyScopeExpansionRecoveryIntentStore({ statePath });
    assert.equal(store.readIntent(), null);
    const authorized = { schema: "intent/v1", status: "authorized", planDigest: digest("plan") };
    const advanced = { ...authorized, status: "cloud-recovered" };
    assert.deepEqual(store.writeIntent({ expectedIntent: null, nextIntent: authorized }), authorized);
    assert.throws(() => store.writeIntent({ expectedIntent: null, nextIntent: advanced }), /changed before CAS/);
    assert.deepEqual(store.writeIntent({ expectedIntent: authorized, nextIntent: advanced }), advanced);
    let release;
    const held = store.withEntrypointFence({ planDigest: authorized.planDigest }, async () => (
      new Promise(resolve => { release = resolve; })
    ));
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(
      () => store.withEntrypointFence({ planDigest: digest("other") }, async () => null),
      /already fenced/,
    );
    release();
    await held;
    const journal = JSON.parse(readFileSync(statePath, "utf8"));
    journal.intent.status = "forged";
    writeFileSync(statePath, `${JSON.stringify(journal)}\n`);
    assert.throws(() => store.readIntent(), /digest-invalid/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cloud subprocess uses execFile semantics, sealed argv, and strict JSON parsing", () => {
  const calls = [];
  const result = invokeExpiredActiveDirtyScopeExpansionRecoveryCloudJson({
    action: "continue",
    request: { claimId: digest("claim"), mode: "recovery" },
    ledgerRepository: "owner/ledger",
    environment: { PATH: "/bin", NODE_OPTIONS: "--inspect", NODE_PATH: "/unsafe" },
    cwd: "/protected/controller",
    execute(program, argumentsList, options) {
      calls.push({ program, argumentsList, options });
      return `${JSON.stringify({ schema: "agentic-cloud-collaboration-result/v1", ok: true })}\n`;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0].program, process.execPath);
  assert.equal(calls[0].argumentsList.at(-1), "--json");
  assert.match(calls[0].argumentsList.join(" "), /--ledger-repository=owner\/ledger/);
  assert.equal(calls[0].options.cwd, "/protected/controller");
  assert.equal(calls[0].options.env.NODE_OPTIONS, undefined);
  assert.equal(calls[0].options.env.NODE_PATH, undefined);
  assert.equal(Object.hasOwn(calls[0].options, "shell"), false);
  assert.throws(() => invokeExpiredActiveDirtyScopeExpansionRecoveryCloudJson({
    action: "continue", request: {}, ledgerRepository: "owner/ledger",
    execute: () => "not-json", cwd: "/protected/controller",
  }), /no valid JSON/);

  const sourceClaim = hydratedClaim();
  const claim = { ...projectPublicClaim(sourceClaim), state: "current",
    writeAuthority: true, transitionCounter: sourceClaim.transitionCounter + 1,
    fenceRevision: digest("recovered-fence") };
  const operationReceipt = { receiptDigest: digest("contract-receipt") };
  const receiptCore = {
    schema: "agentic-cloud-collaboration-github-receipt/v1", action: "continue",
    ledgerRevision: sha("recovered-ledger"), ledgerDigest: digest("recovered-ledger"),
    claimId: claim.claimId, claimDigest: claim.fenceRevision,
    contractReceiptDigest: operationReceipt.receiptDigest, sequence: 92,
    evaluationTime: "2026-08-10T01:00:00.000Z",
  };
  const recovered = {
    schema: "agentic-cloud-collaboration-result/v1", ok: true, action: "continue",
    status: "current", ledgerRevision: receiptCore.ledgerRevision,
    claim, claimDigest: claim.fenceRevision, operationReceipt,
    receipt: { ...receiptCore, receiptDigest: digestValue(receiptCore) },
  };
  assert.equal(requireExpiredActiveDirtyScopeExpansionRecoveryCloudResult(recovered, {
    source: { cloud: { claim: sourceClaim } },
  }), recovered);
  assert.throws(() => requireExpiredActiveDirtyScopeExpansionRecoveryCloudResult(
    { ...recovered, receipt: null }, { source: { cloud: { claim: sourceClaim } } },
  ), /drifted result/);
});

test("stable inventory joins complete public projections around one hydrated ledger read", async () => {
  const claim = hydratedClaim();
  const status = statusResult([projectPublicClaim(claim)]);
  let executeCalls = 0;
  const reader = createExpiredActiveDirtyScopeExpansionRecoveryStableInventoryReader({
    execute: async () => { executeCalls += 1; return structuredClone(status); },
    listClaims: async () => [structuredClone(claim)],
  }, "owner/repository");
  const inventory = await reader();
  assert.equal(executeCalls, 2);
  assert.equal(inventory.claims[0].recordedState, "current");
  assert.equal(inventory.claims[0].deviceId, "device:pseudonymous");
  assert.equal(inventory.claims[0].sessionId, "session:pseudonymous");
  assert.equal(inventory.claims[0].recovery, null);

  for (const mutate of [
    value => { value.claims[0].state = "reviewed"; },
    value => { value.ledgerRevision = sha("new-ledger"); },
    value => { value.ledgerDigest = digest("new-ledger"); },
    value => { value.sequence += 1; },
  ]) {
    let calls = 0;
    const driftReader = createExpiredActiveDirtyScopeExpansionRecoveryStableInventoryReader({
      execute: async () => {
        calls += 1;
        const value = structuredClone(status);
        if (calls === 2) mutate(value);
        return value;
      },
      listClaims: async () => [structuredClone(claim)],
    }, "owner/repository");
    await assert.rejects(() => driftReader(), /changed across/);
  }

  const transitionDrift = structuredClone(claim);
  transitionDrift.ledgerRevision = digest("other-transition");
  await assert.rejects(() => createExpiredActiveDirtyScopeExpansionRecoveryStableInventoryReader({
    execute: async () => structuredClone(status),
    listClaims: async () => [transitionDrift],
  }, "owner/repository")(), /changed across/);
});

test("cloud projection preserves exact recorded state and seals every hydrated peer field", () => {
  const target = hydratedClaim();
  const peer = hydratedClaim({ claimId: digest("peer"), fenceRevision: digest("peer-fence"),
    ledgerRevision: digest("peer-transition"), recordedState: "reviewed", state: "dormant-preserved" });
  const cloud = projectExpiredActiveDirtyScopeExpansionRecoveryCloud({
    claim: target, ledgerRepository: "owner/ledger",
    inventory: { ...statusResult([]), claims: [target, peer] },
  });
  assert.equal(cloud.claim.recordedState, "current");
  assert.equal(cloud.claim.transitionDigest, target.ledgerRevision);
  assert.equal(cloud.peers[0].recordedState, "reviewed");
  assert.equal(cloud.peers[0].transitionDigest, peer.ledgerRevision);
  const { recordDigest, ...record } = cloud.peers[0];
  assert.equal(recordDigest, digestValue(record));
  for (const field of ["recovery", "integration", "handoffEvidenceDigest", "promotedAt",
    "deliveryAuthorization", "retirement"]) assert.equal(Object.hasOwn(record, field), true);
  const missing = { ...target };
  delete missing.recordedState;
  assert.equal(projectExpiredActiveDirtyScopeExpansionRecoveryCloud({
    claim: missing, ledgerRepository: "owner/ledger",
    inventory: { ...statusResult([]), claims: [missing] },
  }).claim.recordedState, undefined);
  assert.throws(() => requireExpiredActiveDirtyScopeExpansionRecoveryExactClaim(
    [target, target], target.claimId), /one exact recovery claim/);
});

test("real repository adapter composition plans and completes all three exact effects", async () => {
  const harness = repositoryHarness();
  try {
    const planned = await harness.controller.plan({});
    const completed = await harness.controller.run({
      planDigest: planned.planDigest, authorization: planned.exactAuthorization,
    });
    assert.equal(completed.status, "complete");
    assert.equal(harness.state.cloudClaim.state, "current");
    assert.notEqual(writerLeaseDigest(harness.state.lease()), harness.sourceLeaseDigest);
    assert.equal(harness.state.pullRequestEdits, 1);
    assert.equal(harness.state.cloudRecoveries, 1);
    assert.equal(harness.state.sawNoActiveIntentCas, true);
    assert.equal(harness.state.sawSupportedPullRequestFields, true);
  } finally { harness.dispose(); }
});

test("a later expiry of the same claim creates a new attempt and preserves the complete journal", async () => {
  const harness = repositoryHarness();
  try {
    const firstPlan = await harness.controller.plan({});
    await harness.controller.run({ planDigest: firstPlan.planDigest, authorization: firstPlan.exactAuthorization });
    harness.state.expireAgain();
    const secondPlan = await harness.controller.plan({});
    assert.notEqual(secondPlan.planDigest, firstPlan.planDigest);
    await harness.controller.run({ planDigest: secondPlan.planDigest, authorization: secondPlan.exactAuthorization });
    assert.equal(harness.state.cloudRecoveries, 2);
    assert.equal(harness.state.journalFiles().length, 2);
  } finally { harness.dispose(); }
});

test("real composition blocks ledger mismatch, late scope intent, and in-lock PR drift", async t => {
  await t.test("configured ledger mismatch", async () => {
    const harness = repositoryHarness({ configuredLedger: "owner/other-ledger" });
    try { await assert.rejects(() => harness.controller.plan({}), /identities do not join/); }
    finally { harness.dispose(); }
  });
  await t.test("scope intent appears before local CAS", async () => {
    const harness = repositoryHarness({ injectScopeIntent: true });
    try {
      const planned = await harness.controller.plan({});
      await assert.rejects(() => harness.controller.run({
        planDigest: planned.planDigest, authorization: planned.exactAuthorization,
      }), /scope-expansion intent/i);
      assert.equal(writerLeaseDigest(harness.state.lease()), harness.sourceLeaseDigest);
      assert.equal(harness.state.pullRequestEdits, 0);
    } finally { harness.dispose(); }
  });
  await t.test("pull request drifts inside registry fence", async () => {
    const harness = repositoryHarness({ driftPullRequestInsideLock: true });
    try {
      const planned = await harness.controller.plan({});
      await assert.rejects(() => harness.controller.run({
        planDigest: planned.planDigest, authorization: planned.exactAuthorization,
      }), /changed before marker CAS|changed source bytes/);
      assert.equal(harness.state.pullRequestDrifted, true);
      assert.equal(harness.state.pullRequestEdits, 0);
    } finally { harness.dispose(); }
  });
});

test("PR marker replacement preserves every non-marker byte and fails before a drifted edit", () => {
  const sourceLease = leaseFixture();
  const reboundLease = { ...sourceLease, heartbeatAt: "2026-08-10T01:00:00.000Z",
    expiresAt: "2026-08-10T01:30:00.000Z" };
  const sourceMarker = `<!-- agentic-writer-lease/v2 ${JSON.stringify(projectWriterLeasePullRequestMarker(sourceLease))} -->`;
  const prefix = "User prose\n\n";
  const suffix = "\n\nFooter bytes stay exact.  \n\t";
  const originalBody = `${prefix}${sourceMarker}${suffix}`;
  const intendedBody = replaceExpiredActiveDirtyScopeExpansionRecoveryPullRequestMarker(
    originalBody, reboundLease,
  );
  assert.equal(intendedBody.startsWith(prefix), true);
  assert.equal(intendedBody.endsWith(suffix), true);
  assert.notEqual(intendedBody, intendedBody.trimEnd());
  const before = pullRequestFixture(originalBody);
  const verified = pullRequestFixture(intendedBody);
  before.bodyFrameDigest = digestValue(originalBody.replace(sourceMarker,
    "<!-- agentic-writer-lease/v2 [marker] -->"));
  assert.doesNotThrow(() => assertExpiredActiveDirtyScopeExpansionRecoveryPullRequestUpdate({
    before, verified, intendedBody, lease: reboundLease,
    expectedDigest: writerLeaseDigest(reboundLease),
  }));
  for (const drift of [{ isDraft: false }, { headRefOid: sha("other") },
    { baseRepository: "other/repository" }]) {
    assert.throws(() => assertExpiredActiveDirtyScopeExpansionRecoveryPullRequestUpdate({
      before, verified: { ...verified, ...drift }, intendedBody, lease: reboundLease,
      expectedDigest: writerLeaseDigest(reboundLease),
    }), /did not preserve/);
  }
  let editCalls = 0;
  assert.throws(() => {
    assertExpiredActiveDirtyScopeExpansionRecoveryPullRequestSnapshot(
      before, { ...before, body: `${before.body}concurrent` },
    );
    editCalls += 1;
  }, /changed before marker CAS/);
  assert.equal(editCalls, 0);
  assert.throws(() => replaceExpiredActiveDirtyScopeExpansionRecoveryPullRequestMarker(
    `${originalBody}${sourceMarker}`, reboundLease,
  ), /one exact writer lease marker/);
});

function leaseFixture() {
  return {
    schema: "agentic-writer-lease/v2", status: "active", epoch: 7,
    sessionId: "session", device: "device", scope: "scope",
    branch: "agent/device/scope", baseSha: sha("base"), fenceSha: sha("fence"),
    autoDelivery: false, runtimeRequired: false,
    heartbeatAt: "2026-08-10T00:00:00.000Z", expiresAt: "2026-08-10T00:30:00.000Z",
  };
}

function pullRequestFixture(body) {
  return {
    number: 358, nodeId: "PR_358", url: "https://github.com/owner/repository/pull/358",
    state: "OPEN", isDraft: true, headRepository: "owner/repository",
    headRefName: "agent/device/scope", headRefOid: sha("fence"),
    baseRepository: "owner/repository", baseRefName: "main", baseRefOid: sha("base"), body,
  };
}

function hydratedClaim(overrides = {}) {
  return {
    claimId: digest("claim"), entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    state: "dormant-preserved", recordedState: "current", writeAuthority: false,
    scopeReserved: true, actorId: "github-user:1", deviceId: "device:pseudonymous",
    sessionId: "session:pseudonymous", repositoryId: "github-repository:1",
    workItemId: digest("work-item"), canonicalBaseRevision: sha("base"),
    laneRevision: sha("fence"), declaredWriteScope: ["path:scripts/recovery"],
    writeSetDigest: digestValue(["path:scripts/recovery"]), leaseEpoch: 1,
    transitionCounter: 3, heartbeatCounter: 2, evidenceDigest: null,
    reviewRequestId: "github-pull-request:358", predecessorClaimId: null,
    eligibleSince: null, handoff: null, release: null,
    expiresAt: "2026-08-09T20:36:19.000Z", fenceRevision: digest("fence"),
    ledgerRevision: digest("transition"), ledgerSequence: 90,
    operationReceiptDigest: digest("receipt"), integrationReceiptDigest: null,
    recovery: null, integration: null, ...overrides,
  };
}

function statusResult(claims) {
  return {
    schema: "agentic-cloud-collaboration-result/v1", ok: true, action: "status",
    status: "ready", ledgerRevision: sha("ledger"), ledgerDigest: digest("ledger"),
    sequence: 91, claims,
  };
}

function repositoryHarness({ configuredLedger = "owner/ledger", injectScopeIntent = false,
  driftPullRequestInsideLock = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "expired-dirty-composition-"));
  const sourcePath = path.join(root, "source"), commonDirectory = path.join(root, "common");
  mkdirSync(sourcePath); mkdirSync(commonDirectory); const sourceRoot = realpathSync(sourcePath);
  const target = "owner/repository", ledger = "owner/ledger", branch = "agent/device/scope";
  const baseSha = sha("base"), fenceSha = sha("fence"), treeSha = sha("tree");
  const claimId = digest("claim"), writeSet = normalizeWriteSet(["path:scripts/recovery", "semantic:scope"]);
  const writeSetDigest = digestValue(writeSet), sourceExpiry = "2026-08-09T20:36:19.000Z";
  const sourceAuthority = {
    schema: "agentic-lane-cloud-authority/v1", provider: "github", ledgerRepository: ledger,
    targetRepository: target, claimId, claimDigest: digest("source-fence"),
    ledgerRevision: sha("source-ledger"), ledgerDigest: digest("source-ledger"),
    claimLedgerRevision: digest("source-transition"),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: digest("source-receipt"), mutationAuthorityEligible: true,
    canonicalBaseSha: baseSha, laneRevision: fenceSha, cloudDeclaredWriteScope: writeSet,
    writeSetDigest, deviceId: "device", sessionId: "session",
    reviewRequestId: "github-pull-request:PR_358", leaseEpoch: 1,
    transitionCounter: 3, state: "active", expiresAt: sourceExpiry,
    integrationReceiptDigest: null, integration: null, manifestDigest: digest("manifest"),
  };
  const sourceLease = {
    schema: "agentic-writer-lease/v2", status: "active", epoch: 7,
    sessionId: "session", device: "device", scope: "scope", branch,
    worktreePath: sourceRoot, baseSha, fenceSha,
    pullRequestUrl: `https://github.com/${target}/pull/358`, autoDelivery: false,
    runtimeRequired: false, admission: {
      schema: "agentic-lane-admission-lease/v1", status: "admitted", semanticScope: "scope",
      declaredWriteSet: writeSet, writeSetDigest, manifestDigest: digest("manifest"),
      planReceiptDigest: digest("plan-receipt"), admissionReceiptDigest: digest("admission"),
      existingLaneStateDigest: digest("lanes"), admittedReportDigest: digest("report"),
      preservationReceiptDigest: digest("preservation"),
    }, cloudAuthority: sourceAuthority, acquiredAt: "2026-08-09T19:00:00.000Z",
    heartbeatAt: "2026-08-09T20:00:00.000Z", expiresAt: sourceExpiry,
  };
  const sourceLeaseDigest = writerLeaseDigest(sourceLease);
  const registryPath = path.join(commonDirectory, "writer-leases.json");
  const readRegistry = () => JSON.parse(readFileSync(registryPath, "utf8"));
  const writeRegistry = registry => writeFileSync(registryPath, `${JSON.stringify(registry)}\n`);
  writeRegistry({ schema: "agentic-writer-lease-registry/v2", revision: 1,
    leases: { [branch]: sourceLease }, scopeExpansionIntents: {} });
  let insideRegistryLock = false;
  const leaseStore = {
    statePath: registryPath, read: name => readRegistry().leases[name] || null,
    readRegistry, withRegistryLock(action) {
      const before = writerLeaseDigest(readRegistry().leases[branch]);
      insideRegistryLock = true;
      try { const result = action(readRegistry());
        if (writerLeaseDigest(readRegistry().leases[branch]) !== before) state.sawNoActiveIntentCas = true;
        return result; } finally { insideRegistryLock = false; }
    },
  };
  const marker = `<!-- agentic-writer-lease/v2 ${JSON.stringify(projectWriterLeasePullRequestMarker(sourceLease))} -->`;
  const pullRequest = { url: `https://github.com/${target}/pull/358`, number: 358, id: "PR_358",
    state: "OPEN", isDraft: true, isCrossRepository: false, headRefName: branch,
    headRefOid: fenceSha, headRepository: { nameWithOwner: target }, baseRefName: "main",
    baseRefOid: baseSha, body: `User body\n\n${marker}\n\nTail  \n` };
  let outerLedgerRevision = sourceAuthority.ledgerRevision,
    outerLedgerDigest = sourceAuthority.ledgerDigest, sequence = 10;
  let cloudClaim = hydratedClaim({ claimId, fenceRevision: sourceAuthority.claimDigest,
    ledgerRevision: sourceAuthority.claimLedgerRevision, actorId: "github-user:1",
    deviceId: pseudonymousIdentifier("device", sourceLease.device),
    sessionId: pseudonymousIdentifier("session", sourceLease.sessionId),
    canonicalBaseRevision: baseSha, laneRevision: fenceSha, declaredWriteScope: writeSet,
    writeSetDigest, reviewRequestId: sourceAuthority.reviewRequestId,
    expiresAt: sourceExpiry, operationReceiptDigest: sourceAuthority.operationReceiptDigest });
  const state = { cloudClaim, cloudRecoveries: 0, pullRequestEdits: 0,
    sawNoActiveIntentCas: false, sawSupportedPullRequestFields: false,
    lease: () => readRegistry().leases[branch] };
  const gitOutput = (argumentsList, cwd) => {
    const controller = path.resolve(cwd) === path.resolve(process.cwd());
    if (argumentsList[0] === "config") return `git@github.com:${target}.git\n`;
    if (argumentsList[0] === "branch") return `${branch}\n`;
    if (argumentsList[0] === "rev-parse") {
      const value = argumentsList[1];
      if (value === "--git-common-dir") return `${commonDirectory}\n`;
      if (value === "HEAD") return `${controller ? baseSha : fenceSha}\n`;
      if (value === "origin/main" || value === "HEAD^") return `${baseSha}\n`;
      if (value === "HEAD^{tree}") return `${controller ? sha("controller-tree") : treeSha}\n`;
      if (value === "HEAD^^{tree}") return `${treeSha}\n`;
    }
    if (argumentsList[0] === "status") return controller ? "" : " M scripts/recovery\0";
    if (argumentsList[0] === "ls-remote") return `${argumentsList.at(-1).endsWith("/main") ? baseSha : fenceSha}\t${argumentsList.at(-1)}\n`;
    if (argumentsList[0] === "rev-list") return `${fenceSha} ${baseSha}\n`;
    if (argumentsList[0] === "worktree") return `worktree ${sourceRoot}\0branch refs/heads/${branch}\0`;
    if (argumentsList[0] === "ls-files") return argumentsList.includes("--others") ? "" : "100644 abc 0\tscripts/recovery\0";
    if (argumentsList[0] === "hash-object") return `${sha("dirty-object")}\n`;
    if (argumentsList[0] === "diff") {
      if (argumentsList.includes("--name-only")) return argumentsList.includes("--cached") ? "" : "scripts/recovery\0";
      return argumentsList.includes("--cached") ? "" : "diff --git a/scripts/recovery b/scripts/recovery\n+dirty\n";
    }
    throw new Error(`Unexpected git invocation: ${argumentsList.join(" ")}`);
  };
  const execute = (program, argumentsList, options) => {
    if (program === "git") return gitOutput(argumentsList, options.cwd);
    if (program !== "gh") throw new Error(`Unexpected program: ${program}`);
    if (argumentsList[0] === "api") return JSON.stringify({ id: 1, login: "owner" });
    if (argumentsList[1] === "view") {
      const fields = argumentsList.at(-1);
      state.sawSupportedPullRequestFields = fields.includes("isCrossRepository") && !fields.includes("baseRepository");
      if (insideRegistryLock && driftPullRequestInsideLock && !state.pullRequestDrifted) {
        pullRequest.body += "concurrent"; state.pullRequestDrifted = true;
      }
      return JSON.stringify(pullRequest);
    }
    if (argumentsList[1] === "edit") {
      pullRequest.body = argumentsList[argumentsList.indexOf("--body") + 1];
      state.pullRequestEdits += 1; return "";
    }
    throw new Error(`Unexpected gh invocation: ${argumentsList.join(" ")}`);
  };
  const cloudInventory = async () => ({ schema: "agentic-cloud-collaboration-result/v1",
    ok: true, action: "status", status: "ready", ledgerRevision: outerLedgerRevision,
    ledgerDigest: outerLedgerDigest, sequence, claims: [cloudClaim] });
  const cloudJson = async (action, request) => {
    assert.equal(action, "continue"); assert.equal(request.mode, "recovery");
    assert.equal(request.expectedLedgerDigest, outerLedgerDigest);
    const nextTransition = cloudClaim.transitionCounter + 1;
    outerLedgerRevision = sha(`recovered-ledger-${nextTransition}`); outerLedgerDigest = digest(`recovered-ledger-${nextTransition}`); sequence += 1;
    cloudClaim = { ...cloudClaim, state: "current", recordedState: "current",
      writeAuthority: true, fenceRevision: digest(`recovered-fence-${nextTransition}`),
      ledgerRevision: digest(`recovered-transition-${nextTransition}`), transitionCounter: nextTransition,
      expiresAt: `${2095 + nextTransition}-08-10T01:30:00.000Z`, operationReceiptDigest: digest(`recovered-receipt-${nextTransition}`),
      recovery: { evidenceDigest: request.recoveryEvidenceDigest, recoveredAt: "2026-08-10T01:00:00.000Z" } };
    state.cloudClaim = cloudClaim; state.cloudRecoveries += 1;
    const operationReceipt = { receiptDigest: cloudClaim.operationReceiptDigest };
    const receipt = { schema: "agentic-cloud-collaboration-github-receipt/v1", action: "continue",
      ledgerRevision: outerLedgerRevision, ledgerDigest: outerLedgerDigest, claimId,
      claimDigest: cloudClaim.fenceRevision, contractReceiptDigest: operationReceipt.receiptDigest,
      sequence, evaluationTime: "2026-08-10T01:00:00.000Z" };
    return { schema: "agentic-cloud-collaboration-result/v1", ok: true, action: "continue",
      status: "current", ledgerRevision: outerLedgerRevision, claim: projectPublicClaim(cloudClaim),
      claimDigest: cloudClaim.fenceRevision, operationReceipt,
      receipt: { ...receipt, receiptDigest: digestValue(receipt) } };
  };
  const verifyCloudAuthority = async ({ authority }) => {
    if (injectScopeIntent && !state.scopeIntentInjected) {
      const planCore = { targetWriteSetDigest: digest("target-write"),
        targetManifestDigest: digest("target-manifest"), targetCanonicalBaseSha: baseSha };
      const planSnapshot = { ...planCore, planDigest: digestValue(planCore) };
      const registry = readRegistry();
      registry.scopeExpansionIntents[branch] = { schema: "agentic-active-dirty-scope-expansion-intent/v1",
        status: "intent", branch, sourceLeaseDigest, sourceClaimId: claimId,
        sourceFenceSha: fenceSha, ...planCore, planDigest: planSnapshot.planDigest,
        targetClaimId: null, targetClaimDigest: null, targetLeaseEpoch: 1,
        targetReviewRequestId: null, completedReceiptDigest: null, planSnapshot };
      writeRegistry(registry); state.scopeIntentInjected = true;
    }
    const hour = String(authority.transitionCounter - 3).padStart(2, "0");
    return { authority, verification: { verifiedAt: `2026-08-10T${hour}:00:00.000Z` } };
  };
  const assertMutationAuthority = ({ lease, cloudAuthority }) => ({
    schema: "agentic-admission-mutation-authority/v1", status: "ready",
    claimId: cloudAuthority.claimId, claimDigest: cloudAuthority.claimDigest,
    ledgerRevision: cloudAuthority.ledgerRevision, localLeaseEpoch: lease.epoch,
    localFenceSha: lease.fenceSha, remoteLeaseEpoch: cloudAuthority.leaseEpoch,
    expiresAt: cloudAuthority.expiresAt,
  });
  const adapter = createRepositoryExpiredActiveDirtyScopeExpansionRecoveryAdapter({
    sourceRepository: sourceRoot, targetRepository: target, pullRequestNumber: 358,
    claimId, ledgerRepository: configuredLedger, ttlSeconds: 1_800, execute,
    leaseStore, cloudInventory, cloudJson, verifyCloudAuthority, assertMutationAuthority,
  });
  state.expireAgain = () => { cloudClaim = { ...cloudClaim, state: "dormant-preserved", writeAuthority: false }; state.cloudClaim = cloudClaim; };
  state.journalFiles = () => readdirSync(path.join(commonDirectory, "agentic-canvas-os", "expired-active-dirty-scope-expansion-recovery")).filter(name => name.endsWith(".json"));
  return { controller: createExpiredActiveDirtyScopeExpansionRecoveryController({ adapter }),
    sourceLeaseDigest, state, dispose: () => rmSync(root, { recursive: true, force: true }) };
}
