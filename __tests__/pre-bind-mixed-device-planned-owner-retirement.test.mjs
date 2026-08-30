import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import { applyCloudTransition, createEmptyLedger }
  from "../scripts/cloud-collaboration-contract.mjs";
import { createTaskAuthorityBinding, createTaskAuthorityCapability }
  from "../scripts/task-bound-lane-authority-contract.mjs";
import { parseWriterLeasePullRequestBody, projectWriterLeasePullRequestMarker,
  renderWriterLeasePullRequestBody }
  from "../scripts/writer-lease-lib.mjs";
import { createClaimOnlyPartialStartRetirementStore }
  from "../scripts/claim-only-partial-start-retirement-store.mjs";
import { buildPlan, normalizeJournal, normalizePlan, normalizeReceipt, operationKey }
  from "../scripts/pre-bind-mixed-device-planned-owner-retirement-contract.mjs";
import { createPreBindMixedDevicePlannedOwnerRetirementController }
  from "../scripts/pre-bind-mixed-device-planned-owner-retirement-controller.mjs";
import { createPreBindMixedDevicePlannedOwnerRetirementRepositoryAdapter }
  from "../scripts/pre-bind-mixed-device-planned-owner-retirement-repository-adapter.mjs";
import { main as cliMain }
  from "../scripts/pre-bind-mixed-device-planned-owner-retirement.mjs";

const hash = label => digestValue({ label });
const sha = label => hash(label).slice(0, 40);
const rawDevice = "Katrinas-MacBook-Pro.local";
const normalizedDevice = rawDevice.toLowerCase();
const session = "exact-retirement-session";
const rawWorkItem = "guideline-exact-canonical-policy";
const localScope = "exact-canonical-policy";

function evidence({ expired = false } = {}) {
  const base = sha("base"), head = sha("fence"), tree = sha("tree");
  const claimDevice = pseudonymousIdentifier("device", rawDevice);
  const claimSession = pseudonymousIdentifier("session", session);
  const bindingDigest = hash("binding"), claimId = hash("claim"), claimDigest = hash("claim-digest");
  const writeSetDigest = hash("write-set");
  const lease = { digest: hash("lease"), status: "active", epoch: 7, sessionId: session,
    device: normalizedDevice, scope: localScope, normalizedOwner: normalizedDevice,
    branch: "agent/katrinas-macbook-pro.local/mixed-owner", worktreePath: "/tmp/mixed-owner",
    baseSha: base, fenceSha: head, expiresAt: expired ? "2026-08-29T00:00:00.000Z" : "2026-08-31T00:00:00.000Z",
    admissionStatus: "planned", admissionWriteSetDigest: writeSetDigest,
    admissionManifestDigest: hash("manifest"), claimId, cloudDeviceId: claimDevice,
    cloudSessionId: claimSession, cloudClaimDigest: claimDigest, cloudWriteSetDigest: writeSetDigest,
    taskAuthorityBindingDigest: bindingDigest };
  const cloudSubject = { rawClaimOwnerDevice: rawDevice, rawClaimWorkItem: rawWorkItem,
    derivedClaimDeviceId: claimDevice,
    derivedNormalizedDeviceId: pseudonymousIdentifier("device", normalizedDevice),
    derivedExpectedSessionId: claimSession,
    derivedClaimWorkItemId: pseudonymousIdentifier("work-item", rawWorkItem),
    derivedLeaseWorkItemId: pseudonymousIdentifier("work-item", lease.scope),
    derivationDigest: digestValue({ deviceId: lease.device, normalizedOwner: lease.normalizedOwner,
      rawClaimOwnerDevice: rawDevice, sessionId: lease.sessionId,
      derivedClaimDeviceId: claimDevice,
      derivedNormalizedDeviceId: pseudonymousIdentifier("device", normalizedDevice),
      derivedExpectedSessionId: claimSession }),
    workItemDerivationDigest: digestValue({ rawClaimWorkItem: rawWorkItem,
      localLeaseScope: lease.scope,
      derivedClaimWorkItemId: pseudonymousIdentifier("work-item", rawWorkItem),
      derivedLeaseWorkItemId: pseudonymousIdentifier("work-item", lease.scope) }) };
  return { schema: "agentic-pre-bind-mixed-device-planned-owner-retirement-evidence/v1",
    observedAt: "2026-08-30T00:00:00.000Z",
    repository: { id: "github-repository:R_target", nameWithOwner: "owner/repository", commonDirectoryDigest: hash("common") },
    controller: { repository: "owner/controller", branch: "main", revision: sha("controller"),
      tree: sha("controller-tree"), runtimeDigest: hash("runtime"), policyDigest: hash("policy"),
      clean: true, protected: true }, lease,
    taskCapability: { authoritySubjectId: `urn:agentic-task:${hash("task")}`,
      proofAdapterId: "urn:agentic-proof:ed25519-file:v1", generation: 1,
      publicKeyDigest: hash("public-key"), bindingDigest }, cloudSubject,
    claim: { claimId, claimDigest, entryDigest: hash("entry"), actorId: "github-user:7",
      repositoryId: "github-repository:R_target",
      workItemId: pseudonymousIdentifier("work-item", rawWorkItem), deviceId: claimDevice, sessionId: claimSession,
      canonicalBaseRevision: base, laneRevision: base, declaredWriteScope: ["semantic:mixed-owner"],
      writeSetDigest, leaseEpoch: 1, transitionCounter: 1,
      state: expired ? "dormant-preserved" : "current", recordedState: "current",
      writeAuthority: !expired, scopeReserved: true, reviewRequestId: null,
      expiresAt: expired ? "2026-08-29T00:00:00.000Z" : "2026-08-31T00:00:00.000Z",
      temporalState: expired ? "expired" : "current" },
    git: { headSha: head, treeSha: tree, baseSha: base, baseTreeSha: tree,
      parentShas: [base], changedPaths: [], localRefSha: head, remoteRefSha: head,
      statusDigest: hash("clean-status"), indexDigest: hash("index"), clean: true, registered: true },
    pullRequest: { number: 176, nodeId: "PR_exact", url: "https://example.test/pull/176",
      state: "OPEN", isDraft: true, mergedAt: null, closedAt: null,
      autoMergeRequest: null,
      headRepository: "owner/repository", headBranch: lease.branch, headSha: head,
      baseRepository: "owner/repository", baseBranch: "main", baseSha: base,
      markerDigest: hash("marker") },
    ledger: { repository: "owner/controller", revision: sha("ledger"), digest: hash("ledger"),
      sequence: 17, validatedDigest: hash("validated-ledger") } };
}

function clone(value) { return structuredClone(value); }
function setAt(value, pathString, replacement) { const result = clone(value), parts = pathString.split(".");
  let cursor = result; for (const part of parts.slice(0, -1)) cursor = cursor[part]; cursor[parts.at(-1)] = replacement; return result; }

test("accepts current and exact provider-expired dormant t1@base legacy subjects", () => {
  for (const expired of [false, true]) {
    const plan = buildPlan(evidence({ expired }));
    assert.equal(plan.evidence.claim.temporalState, expired ? "expired" : "current");
    assert.equal(plan.evidence.claim.transitionCounter, 1);
    assert.equal(plan.evidence.claim.laneRevision, plan.evidence.lease.baseSha);
    assert.notEqual(plan.evidence.cloudSubject.derivedNormalizedDeviceId, plan.evidence.claim.deviceId);
    assert.equal(plan.evidence.cloudSubject.derivedClaimWorkItemId, plan.evidence.claim.workItemId);
    assert.notEqual(plan.evidence.cloudSubject.derivedLeaseWorkItemId, plan.evidence.claim.workItemId);
    assert.equal(plan.evidence.claim.state, expired ? "dormant-preserved" : "current");
  }
});

test("rejects identity, capability, topology, fence, pull, and repository drift", async t => {
  const cases = [
    ["same-device subject", "claim.deviceId", pseudonymousIdentifier("device", normalizedDevice)],
    ["unrelated session", "claim.sessionId", pseudonymousIdentifier("session", "foreign")],
    ["missing derivation", "cloudSubject.derivationDigest", null],
    ["arbitrary embedded claim", "lease.claimId", hash("foreign-claim")],
    ["foreign embedded device", "lease.cloudDeviceId", pseudonymousIdentifier("device", "foreign")],
    ["capability", "taskCapability.bindingDigest", hash("foreign-binding")],
    ["work item", "claim.workItemId", "foreign-work"],
    ["recorded claim state", "claim.recordedState", "reviewed"],
    ["dormant authority", "claim.writeAuthority", false],
    ["t2", "claim.transitionCounter", 2],
    ["claim lane", "claim.laneRevision", sha("foreign-lane")],
    ["two parents", "git.parentShas", [sha("base"), sha("peer")]],
    ["changed path", "git.changedPaths", ["README.md"]],
    ["tree", "git.treeSha", sha("foreign-tree")],
    ["remote ref", "git.remoteRefSha", sha("foreign-ref")],
    ["fence", "lease.fenceSha", sha("foreign-fence")],
    ["PR head", "pullRequest.headSha", sha("foreign-head")],
    ["PR identity", "pullRequest.number", 177],
    ["controller", "controller.protected", false],
    ["repository", "pullRequest.headRepository", "owner/foreign"],
  ];
  for (const [name, pathString, replacement] of cases) await t.test(name, () => {
    assert.throws(() => normalizePlan(setAt(buildPlan(evidence()), `evidence.${pathString}`, replacement)), /invalid/u);
  });
});

test("rejects missing, equal, non-case-variant, and casefold-collision aliases", () => {
  for (const alias of [null, normalizedDevice, "foreign.local", "KATRİNAS-MACBOOK-PRO.LOCAL"]) {
    const value = evidence(); value.cloudSubject.rawClaimOwnerDevice = alias;
    assert.throws(() => buildPlan(value), /invalid/u);
  }
});

test("raw evidence semantic joins reject unrelated embedded identities", () => {
  const cases = [
    value => { value.claim.repositoryId = "github-repository:R_foreign"; },
    value => { value.claim.workItemId = pseudonymousIdentifier("work-item", "foreign"); },
    value => { value.lease.admissionWriteSetDigest = hash("foreign-write-set"); },
    value => { value.lease.cloudDeviceId = pseudonymousIdentifier("device", "foreign"); },
    value => { value.claim.sessionId = pseudonymousIdentifier("session", "foreign"); },
  ];
  for (const mutate of cases) { const value = evidence(); mutate(value);
    assert.throws(() => buildPlan(value), /invalid/u); }
});

test("rejects arbitrary raw work items and widened dormant projections", () => {
  const cases = [
    value => { value.cloudSubject.rawClaimWorkItem = value.lease.scope; },
    value => { value.cloudSubject.derivedClaimWorkItemId = pseudonymousIdentifier("work-item", "foreign"); },
    value => { value.cloudSubject.workItemDerivationDigest = hash("forged-work-item"); },
    value => { value.claim.state = "retired"; },
    value => { value.claim.state = "dormant-preserved"; value.claim.writeAuthority = true; value.claim.temporalState = "expired"; },
    value => { value.claim.state = "current"; value.claim.writeAuthority = false; },
    value => { value.claim.state = "current"; value.claim.writeAuthority = true;
      value.claim.temporalState = "current"; value.claim.expiresAt = value.observedAt; },
    value => { value.claim.state = "dormant-preserved"; value.claim.writeAuthority = false;
      value.claim.temporalState = "expired"; value.claim.expiresAt = "2026-08-31T00:00:00.000Z"; },
  ];
  for (const mutate of cases) { const value = evidence({ expired: true }); mutate(value);
    assert.throws(() => buildPlan(value), /invalid/u); }
});

test("recomputes every derived cloud subject from its sealed raw preimage", () => {
  const mutations = [
    value => { value.cloudSubject.derivedClaimDeviceId = pseudonymousIdentifier("device", "forged.local");
      value.claim.deviceId = value.cloudSubject.derivedClaimDeviceId;
      value.lease.cloudDeviceId = value.cloudSubject.derivedClaimDeviceId; },
    value => { value.cloudSubject.derivedNormalizedDeviceId = pseudonymousIdentifier("device", "forged.local"); },
    value => { value.cloudSubject.derivedExpectedSessionId = pseudonymousIdentifier("session", "forged");
      value.claim.sessionId = value.cloudSubject.derivedExpectedSessionId;
      value.lease.cloudSessionId = value.cloudSubject.derivedExpectedSessionId; },
    value => { value.cloudSubject.derivedClaimWorkItemId = pseudonymousIdentifier("work-item", "forged");
      value.claim.workItemId = value.cloudSubject.derivedClaimWorkItemId; },
    value => { value.cloudSubject.derivedLeaseWorkItemId = pseudonymousIdentifier("work-item", "forged"); },
  ];
  for (const mutate of mutations) {
    const value = evidence();
    mutate(value);
    value.cloudSubject.derivationDigest = digestValue({ deviceId: value.lease.device,
      normalizedOwner: value.lease.normalizedOwner,
      rawClaimOwnerDevice: value.cloudSubject.rawClaimOwnerDevice, sessionId: value.lease.sessionId,
      derivedClaimDeviceId: value.cloudSubject.derivedClaimDeviceId,
      derivedNormalizedDeviceId: value.cloudSubject.derivedNormalizedDeviceId,
      derivedExpectedSessionId: value.cloudSubject.derivedExpectedSessionId });
    value.cloudSubject.workItemDerivationDigest = digestValue({
      rawClaimWorkItem: value.cloudSubject.rawClaimWorkItem, localLeaseScope: value.lease.scope,
      derivedClaimWorkItemId: value.cloudSubject.derivedClaimWorkItemId,
      derivedLeaseWorkItemId: value.cloudSubject.derivedLeaseWorkItemId });
    assert.throws(() => buildPlan(value), /invalid/u);
  }
});

function fakeAdapter({ responseLoss = null, ambiguousAfter = null, crashWritePhase = null,
  blockEffect = null, blockMessage = "task capability missing" } = {}) {
  let journal = null, crashUsed = false;
  const effects = [], state = { claim: false, pull: false, owner: false };
  const complete = (plan, kind, attempted, mutationField, extras = {}) => ({ state: "complete", values: {
    operationKey: operationKey(plan, attempted), disposition: "adopted", [mutationField]: false,
    taskAuthorizationReceiptDigest: hash(`auth-${attempted}`),
    taskAuthorizationExpectationDigest: hash(`expect-${attempted}`),
    ...extras,
  } });
  const classify = (plan, kind, attempted, mutationField, extras) => {
    if (ambiguousAfter === kind && state[kind]) return { state: "ambiguous" };
    return state[kind] ? complete(plan, kind, attempted, mutationField, extras) : { state: "pending" };
  };
  const effect = kind => async () => { if (blockEffect === kind) throw new Error(blockMessage);
    effects.push(kind); state[kind] = true;
    if (responseLoss === kind) throw new Error(`${kind} response lost`); };
  return { effects, state,
    async withLock(_context, action) { return action(); }, readJournal: () => journal,
    writeJournal({ expected, next }) { if ((journal && digestValue(journal)) !== (expected && digestValue(expected))) throw new Error("journal CAS drift");
      journal = next;
      if (!crashUsed && crashWritePhase === next.state?.phase) { crashUsed = true; throw new Error("simulated crash"); }
      return next; },
    observe: ({ observedAt } = {}) => ({ ...evidence(), observedAt: observedAt || evidence().observedAt }),
    prepare: ({ plan }) => ({ relevantEvidenceDigest: digestValue({ planDigest: plan.planDigest }),
      workItemBindingDigest: plan.evidence.cloudSubject.workItemDerivationDigest,
      taskAuthorizationReceiptDigest: hash("auth-prepared") }),
    authorizeEffect: ({ phase }) => ({ taskAuthorizationReceiptDigest: hash(`auth-${phase}`),
      taskAuthorizationExpectationDigest: hash(`expect-${phase}`) }),
    classifyClaim: ({ plan }) => classify(plan, "claim", "claim-retirement-attempted", "cloudMutation",
      { claimId: plan.evidence.claim.claimId, terminalEntryDigest: hash("terminal-entry"),
        terminalClaimDigest: hash("terminal-claim"), operationReceiptDigest: hash("operation-receipt"),
        transportReceiptDigest: null }),
    retireClaim: effect("claim"),
    classifyPullRequest: ({ plan }) => state.claim
      ? classify(plan, "pull", "pull-request-close-attempted", "providerMutation",
        { pullRequestNumber: 176, pullRequestNodeId: "PR_exact", closedAt: "2026-08-30T01:00:00.000Z",
          remoteRefSha: plan.evidence.git.remoteRefSha }) : { state: "ambiguous" },
    closePullRequest: effect("pull"),
    classifyOwner: ({ plan }) => state.pull
      ? classify(plan, "owner", "owner-release-attempted", "localMutation",
        { releasedLeaseDigest: hash("released-lease"), releaseReceiptDigest: hash("release"),
          preservedGitDigest: digestValue(plan.evidence.git) }) : { state: "ambiguous" },
    releaseOwner: effect("owner"),
    verifyTerminal: ({ plan }) => { if (!state.claim || !state.pull || !state.owner) throw new Error("not terminal");
      return { terminalEvidenceDigest: digestValue({ planDigest: plan.planDigest, terminal: true }) }; },
    journal: () => journal, replaceJournal: value => { journal = value; },
  };
}

async function planAndRun(adapter) {
  const controller = createPreBindMixedDevicePlannedOwnerRetirementController({ adapter });
  const plan = await controller.plan();
  return { controller, plan, receipt: await controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization }) };
}

test("persists prepared, intent, and attempted journals before ordered effects", async () => {
  const adapter = fakeAdapter(); const { receipt } = await planAndRun(adapter);
  assert.deepEqual(adapter.effects, ["claim", "pull", "owner"]);
  assert.equal(receipt.status, "complete");
  const journal = normalizeJournal(adapter.journal());
  for (const phase of ["prepared", "claim-retirement-intent", "claim-retirement-attempted",
    "pull-request-close-intent", "pull-request-close-attempted", "owner-release-intent",
    "owner-release-attempted"]) assert.ok(journal.state.receipts[phase]);
  assert.equal(journal.state.receipts["claim-retired"].cloudMutation, false);
  assert.equal(journal.state.receipts["claim-retired"].disposition, "adopted");
});

test("terminal receipt is closed and every identity rejoins its plan and journal", async () => {
  const adapter = fakeAdapter(); const { receipt } = await planAndRun(adapter);
  for (const mutate of [
    value => { delete value.workItemId; },
    value => { delete value.claimWorkItem; },
    value => { value.extra = true; },
    value => { value.controllerRevision = "not-a-sha"; },
  ]) { const changed = clone(receipt); mutate(changed); const core = { ...changed }; delete core.receiptDigest;
    changed.receiptDigest = digestValue(core); assert.throws(() => normalizeReceipt(changed), /invalid/u); }
  const journal = clone(adapter.journal());
  const nested = journal.state.receipts.complete.receipt;
  nested.repository = "owner/foreign"; { const core = { ...nested }; delete core.receiptDigest;
    nested.receiptDigest = digestValue(core); }
  { const complete = journal.state.receipts.complete, core = { ...complete }; delete core.receiptDigest;
    complete.receiptDigest = digestValue(core); }
  { const core = { schema: journal.schema, plan: journal.plan, state: journal.state };
    journal.journalDigest = digestValue(core); }
  assert.throws(() => normalizeJournal(journal), /join|invalid/u);
});

for (const kind of ["claim", "pull", "owner"]) test(`${kind} mutate-then-throw is adopted without a second effect`, async () => {
  const adapter = fakeAdapter({ responseLoss: kind });
  const { controller, plan, receipt } = await planAndRun(adapter);
  assert.equal(adapter.effects.filter(item => item === kind).length, 1);
  const replay = await controller.run({ planDigest: plan.planDigest, authorization: plan.exactAuthorization });
  assert.deepEqual(replay, receipt);
  assert.equal(adapter.effects.filter(item => item === kind).length, 1);
});

test("crash after durable intent resumes without losing effect order", async () => {
  const adapter = fakeAdapter({ crashWritePhase: "claim-retirement-intent" });
  const controller = createPreBindMixedDevicePlannedOwnerRetirementController({ adapter });
  const plan = await controller.plan();
  await assert.rejects(controller.run({ planDigest: plan.planDigest, authorization: plan.exactAuthorization }), /simulated crash/u);
  assert.deepEqual(adapter.effects, []);
  const receipt = await controller.run({ planDigest: plan.planDigest, authorization: plan.exactAuthorization });
  assert.equal(receipt.status, "complete"); assert.deepEqual(adapter.effects, ["claim", "pull", "owner"]);
});

test("crash after effect before result journal adopts exact readback", async () => {
  const adapter = fakeAdapter({ crashWritePhase: "claim-retired" });
  const controller = createPreBindMixedDevicePlannedOwnerRetirementController({ adapter });
  const plan = await controller.plan();
  await assert.rejects(controller.run({ planDigest: plan.planDigest, authorization: plan.exactAuthorization }), /simulated crash/u);
  assert.equal(adapter.effects.filter(item => item === "claim").length, 1);
  await controller.run({ planDigest: plan.planDigest, authorization: plan.exactAuthorization });
  assert.equal(adapter.effects.filter(item => item === "claim").length, 1);
});

test("ambiguous post-attempt state blocks without issuing a second effect", async () => {
  const adapter = fakeAdapter({ responseLoss: "claim", ambiguousAfter: "claim" });
  const controller = createPreBindMixedDevicePlannedOwnerRetirementController({ adapter });
  const plan = await controller.plan();
  await assert.rejects(controller.run({ planDigest: plan.planDigest, authorization: plan.exactAuthorization }), /response lost/u);
  await assert.rejects(controller.run({ planDigest: plan.planDigest, authorization: plan.exactAuthorization }), /classification is invalid/u);
  assert.equal(adapter.effects.filter(item => item === "claim").length, 1);
});

for (const [name, message] of [["missing", "task capability missing"],
  ["wrong-generation", "task capability generation drift"]]) {
  test(`restart from attempted phase blocks when capability is ${name}`, async () => {
    const adapter = fakeAdapter({ blockEffect: "claim", blockMessage: message });
    const controller = createPreBindMixedDevicePlannedOwnerRetirementController({ adapter });
    const plan = await controller.plan();
    await assert.rejects(controller.run({ planDigest: plan.planDigest,
      authorization: plan.exactAuthorization }), new RegExp(message));
    assert.equal(adapter.journal().state.phase, "claim-retirement-attempted");
    await assert.rejects(controller.run({ planDigest: plan.planDigest,
      authorization: plan.exactAuthorization }), new RegExp(message));
    assert.deepEqual(adapter.effects, []);
  });
}

test("forged attempted authorization journal is rejected before an effect", async () => {
  const adapter = fakeAdapter({ blockEffect: "claim" });
  const controller = createPreBindMixedDevicePlannedOwnerRetirementController({ adapter });
  const plan = await controller.plan();
  await assert.rejects(controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization }));
  const forged = clone(adapter.journal());
  forged.state.receipts["claim-retirement-attempted"].taskAuthorizationExpectationDigest = hash("forged");
  adapter.replaceJournal(forged);
  await assert.rejects(controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization }), /journal|receipt|invalid/u);
  assert.deepEqual(adapter.effects, []);
});

test("dead-owner operation lock is atomically recovered", async t => {
  const root = mkdtempSync(path.join(tmpdir(), "mixed-retirement-lock-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700); const statePath = path.join(realpathSync(root), "journal.json"), context = { operation: "test" };
  const store = createClaimOnlyPartialStartRetirementStore({ statePath });
  const lock = { pid: 2_147_483_647, processIdentity: "dead-process", token: "dead-token",
    acquiredAt: "2026-08-30T00:00:00.000Z", context, contextDigest: digestValue(context) };
  writeFileSync(`${statePath}.lock`, `${JSON.stringify(lock)}\n`, { mode: 0o600 });
  assert.equal(await store.withOperationLock(context, async () => "recovered"), "recovered");
});

test("CLI requires and transports the exact raw claim-owner and work-item inputs", async t => {
  const root = mkdtempSync(path.join(tmpdir(), "mixed-retirement-cli-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700); const capability = path.join(root, "capability.json");
  writeFileSync(capability, "{}\n", { mode: 0o600 });
  let received;
  const result = await cliMain(["plan", "--repository=/tmp/repository", "--subject-worktree=/tmp/worktree",
    "--target-repository=owner/repository", "--branch=agent/device/scope", "--pull-request=176",
    `--claim-id=${hash("claim")}`, `--claim-owner-device=${rawDevice}`, `--claim-work-item=${rawWorkItem}`,
    `--task-authority=${capability}`,
    `--state-path=${path.join(root, "journal.json")}`], {
    createAdapter: options => { received = options; return {}; },
    createController: () => ({ plan: async () => ({ status: "planned" }) }),
    resolveGitCommonDirectory: () => "/tmp/repository/.git",
  });
  assert.equal(result.status, "planned"); assert.equal(received.claimOwnerDevice, rawDevice);
  assert.equal(received.claimWorkItem, rawWorkItem);
  await assert.rejects(cliMain(["plan", "--repository=/tmp/repository",
    "--subject-worktree=/tmp/worktree", "--target-repository=owner/repository",
    "--branch=agent/device/scope", "--pull-request=176", `--claim-id=${hash("claim")}`,
    `--claim-owner-device=${rawDevice}`, `--task-authority=${capability}`,
    `--state-path=${path.join(root, "missing-work-item.json")}`], {
    resolveGitCommonDirectory: () => "/tmp/repository/.git",
  }), /claim-work-item/u);
});

test("CLI rejects private state destinations in every repository root and through symlinks", async t => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "mixed-retirement-state-")));
  t.after(() => rmSync(root, { recursive: true, force: true })); chmodSync(root, 0o700);
  const repository = path.join(root, "repository"), subject = path.join(root, "subject"),
    controller = path.join(root, "controller"), common = path.join(root, "common"), outside = path.join(root, "outside");
  for (const directory of [repository, subject, controller, common, outside]) mkdirSync(directory, { mode: 0o700 });
  const capability = path.join(outside, "capability.json"); writeFileSync(capability, "{}\n", { mode: 0o600 });
  const alias = path.join(outside, "repository-alias"); symlinkSync(repository, alias);
  const base = statePath => ["plan", `--repository=${repository}`, `--subject-worktree=${subject}`,
    "--target-repository=owner/repository", "--branch=agent/device/scope", "--pull-request=176",
    `--claim-id=${hash("claim")}`, `--claim-owner-device=${rawDevice}`, `--claim-work-item=${rawWorkItem}`,
    `--task-authority=${capability}`,
    `--state-path=${statePath}`, `--controller-root=${controller}`];
  const dependencies = { resolveGitCommonDirectory: () => common,
    createAdapter: () => { throw new Error("adapter must not be constructed"); } };
  for (const statePath of [path.join(repository, "state.json"), path.join(subject, "state.json"),
    path.join(controller, "state.json"), path.join(common, "state.json"), path.join(alias, "state.json")]) {
    await assert.rejects(cliMain(base(statePath), dependencies), /outside repository/u);
  }
});

test("real adapter retires the exact PR176 legacy work-item dormant subject and adopts response loss", async t => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "mixed-retirement-adapter-")));
  t.after(() => rmSync(root, { recursive: true, force: true })); chmodSync(root, 0o700);
  const repository = path.join(root, "repository"), subjectPath = path.join(root, "subject"),
    common = path.join(root, "common");
  for (const directory of [repository, subjectPath, common]) mkdirSync(directory, { mode: 0o700 });
  const base = sha("adapter-base"), head = sha("adapter-fence"), tree = sha("adapter-tree");
  const controllerSha = sha("adapter-controller"), controllerTree = sha("adapter-controller-tree");
  const branch = "agent/katrinas-macbook-pro.local/exact-canonical-policy", scope = localScope;
  const claimDevice = pseudonymousIdentifier("device", rawDevice), claimSession = pseudonymousIdentifier("session", session);
  const actor = { actorId: "github-user:7", deviceId: claimDevice, sessionId: claimSession };
  const cloudRepository = { repositoryId: "github-repository:R_target", canonicalRevision: base };
  const declaredWriteScope = ["path:docs/mixed-owner.md", `semantic:${scope}`];
  let cloud = applyCloudTransition({ ledger: createEmptyLedger("owner/controller"), action: "claim",
    actor, repository: cloudRepository, evaluationTime: "2026-08-28T00:00:00.000Z",
    request: { workItemId: pseudonymousIdentifier("work-item", rawWorkItem), canonicalBaseRevision: base,
      declaredWriteScope, laneRevision: base, leaseEpoch: 1,
      expiresAt: "2026-08-29T00:00:00.000Z", expectedLedgerDigest: null,
      idempotencyKey: "adapter-claim" } });
  const sourceEntry = cloud.ledger.entries.at(-1), claimId = cloud.claim.claimId;
  const capability = createTaskAuthorityCapability({ issuedAt: "2026-08-30T00:00:00.000Z" });
  const capabilityFile = path.join(root, "capability.json");
  writeFileSync(capabilityFile, `${JSON.stringify(capability)}\n`, { mode: 0o600 });
  let lease = { schema: "agentic-writer-lease/v2", status: "active", epoch: 7,
    sessionId: session, device: normalizedDevice, scope, branch, worktreePath: subjectPath,
    baseSha: base, fenceSha: head, pullRequestUrl: "https://example.test/owner/repository/pull/176",
    autoDelivery: false, runtimeRequired: false,
    admission: { schema: "agentic-lane-admission-lease/v1", status: "planned", semanticScope: scope,
      declaredWriteSet: declaredWriteScope, writeSetDigest: cloud.claim.writeSetDigest,
      manifestDigest: hash("adapter-manifest"), planReceiptDigest: hash("adapter-plan"),
      admissionReceiptDigest: hash("adapter-admission"), existingLaneStateDigest: hash("adapter-existing") },
    cloudAuthority: { schema: "agentic-lane-cloud-authority/v1", provider: "github",
      ledgerRepository: "owner/controller", targetRepository: "owner/repository", claimId,
      claimDigest: sourceEntry.claimDigest, ledgerRevision: sha("source-ledger"),
      claimLedgerRevision: sourceEntry.digest, canonicalBaseSha: base, laneRevision: base,
      cloudDeclaredWriteScope: declaredWriteScope, writeSetDigest: cloud.claim.writeSetDigest,
      deviceId: claimDevice, sessionId: claimSession, leaseEpoch: 1, transitionCounter: 1,
      reviewRequestId: null, state: "active", expiresAt: cloud.claim.expiresAt },
    acquiredAt: "2026-08-30T00:00:00.000Z", heartbeatAt: "2026-08-30T00:00:00.000Z",
    expiresAt: "2026-08-29T00:00:00.000Z" };
  lease.taskAuthority = createTaskAuthorityBinding({ capability, lease, boundAt: "2026-08-30T00:00:00.000Z" });
  const originalLease = clone(lease); let pull = { number: 176, id: "PR_exact", url: lease.pullRequestUrl,
    state: "OPEN", isDraft: true, mergedAt: null, closedAt: null,
    autoMergeRequest: null,
    headRefName: branch, headRefOid: head, headRepository: { nameWithOwner: "owner/repository" },
    baseRefName: "main", baseRefOid: base, body: renderWriterLeasePullRequestBody(lease) };
  let closeCalls = 0, releaseCalls = 0, retireCalls = 0;
  assert.deepEqual(parseWriterLeasePullRequestBody(pull.body), projectWriterLeasePullRequestMarker(lease));
  const leaseStore = { read: name => name === branch ? lease : null,
    release({ expectedLease, status, timestamp, values }) { assert.deepEqual(lease, expectedLease); releaseCalls += 1;
      lease = { ...lease, status, heartbeatAt: timestamp, expiresAt: timestamp, ...values }; return lease; } };
  const currentClaims = () => cloud.claim?.state === "retired" ? [] : [{
    ...cloud.claim, state: "dormant-preserved", recordedState: "current",
    writeAuthority: false, scopeReserved: true,
    entrySchema: sourceEntry.schema, claimIdentitySchema: sourceEntry.schema,
    fenceRevision: sourceEntry.claimDigest, claimDigest: sourceEntry.claimDigest,
    transitionDigest: sourceEntry.digest,
  }];
  const readStatus = () => ({ schema: "agentic-cloud-collaboration-result/v1", ok: true,
    action: "status", status: "ready", ledgerRevision: sha("adapter-ledger"),
    ledgerDigest: cloud.ledger.headDigest, sequence: cloud.ledger.sequence, claims: currentClaims() });
  const git = (cwd, args) => { const command = args.join(" "), target = cwd === repository, subject = cwd === subjectPath;
    if (target && command === "rev-parse --path-format=absolute --git-common-dir") return common;
    if (target && command === "remote get-url origin") return "https://github.com/owner/repository.git";
    if (target && command === `rev-parse refs/heads/${branch}`) return head;
    if (target && command === `ls-remote --heads origin ${branch}`) return `${head}\trefs/heads/${branch}`;
    if (subject && command === "branch --show-current") return branch;
    if (subject && command === "rev-parse HEAD") return head;
    if (subject && command === "rev-parse HEAD^{tree}") return tree;
    if (subject && command === "show -s --format=%P HEAD") return base;
    if (subject && command === `rev-parse ${base}^{tree}`) return tree;
    if (subject && command === "diff-tree --no-commit-id --name-only -r HEAD") return "";
    if (subject && command === "write-tree") return tree;
    if (!target && !subject && command === "rev-parse HEAD") return controllerSha;
    if (!target && !subject && command === "rev-parse refs/remotes/origin/main") return controllerSha;
    if (!target && !subject && command === "branch --show-current") return "main";
    if (!target && !subject && command === "remote get-url origin") return "https://github.com/owner/controller.git";
    if (!target && !subject && command === "rev-parse HEAD^{tree}") return controllerTree;
    throw new Error(`unexpected git: ${cwd} :: ${command}`); };
  const gitRaw = (cwd, args) => { const command = args.join(" ");
    if (cwd === repository && command === "worktree list --porcelain -z") return `worktree ${repository}\0HEAD ${base}\0branch refs/heads/main\0worktree ${subjectPath}\0HEAD ${head}\0branch refs/heads/${branch}\0`;
    if ((cwd === subjectPath || (!cwd.startsWith(root))) && command === "status --porcelain=v1 --untracked-files=all") return "";
    throw new Error(`unexpected gitRaw: ${cwd} :: ${command}`); };
  const adapter = createPreBindMixedDevicePlannedOwnerRetirementRepositoryAdapter({ repository,
    subjectWorktree: subjectPath, targetRepository: "owner/repository", ledgerRepository: "owner/controller",
    branch, claimId, pullRequestNumber: 176, taskAuthorityFile: capabilityFile,
    claimOwnerDevice: rawDevice, claimWorkItem: rawWorkItem,
    statePath: path.join(root, "journal.json") }, {
    git, gitRaw, leaseStore, readRepository: () => ({ id: "R_target", nameWithOwner: "owner/repository" }),
    readControllerProtection: () => ({ protected: true, commit: { sha: controllerSha }, protection: { enabled: true } }),
    readCloud: readStatus, readLedger: () => cloud.ledger, readPull: () => clone(pull),
    closePull() { closeCalls += 1; pull = { ...pull, state: "CLOSED", closedAt: "2026-08-30T01:00:00.000Z" }; },
    invokeCloud({ request }) { retireCalls += 1; assert.equal(request.deviceId, rawDevice);
      cloud = applyCloudTransition({ ledger: cloud.ledger, action: "retire", actor,
        repository: cloudRepository, evaluationTime: "2026-08-30T00:30:00.000Z", request });
      throw new Error("simulated cloud response loss"); },
    now: () => new Date("2026-08-30T01:00:00.000Z"),
  });
  const controller = createPreBindMixedDevicePlannedOwnerRetirementController({ adapter });
  const plan = await controller.plan();
  assert.equal(plan.evidence.cloudSubject.derivedClaimDeviceId, claimDevice);
  assert.notEqual(plan.evidence.cloudSubject.derivedNormalizedDeviceId, claimDevice);
  assert.equal(plan.evidence.cloudSubject.rawClaimWorkItem, rawWorkItem);
  assert.equal(plan.evidence.claim.state, "dormant-preserved");
  assert.equal(plan.evidence.claim.recordedState, "current");
  assert.equal(plan.evidence.claim.writeAuthority, false);
  const receipt = await controller.run({ planDigest: plan.planDigest, authorization: plan.exactAuthorization });
  assert.equal(receipt.status, "complete"); assert.equal(retireCalls, 1); assert.equal(closeCalls, 1); assert.equal(releaseCalls, 1);
  assert.equal(lease.status, "released"); assert.deepEqual(lease.preBindMixedDevicePlannedOwnerRetirement.originalLease, originalLease);
  assert.equal(pull.state, "CLOSED"); assert.equal(plan.evidence.git.remoteRefSha, head);
  const savedRelease = clone(lease.preBindMixedDevicePlannedOwnerRetirement);
  lease.preBindMixedDevicePlannedOwnerRetirement.receiptDigest = hash("forged-release");
  await assert.rejects(controller.run({ planDigest: plan.planDigest, authorization: plan.exactAuthorization }),
    /terminal|released|convergence/u);
  lease.preBindMixedDevicePlannedOwnerRetirement = savedRelease;
  const replay = await controller.run({ planDigest: plan.planDigest, authorization: plan.exactAuthorization });
  assert.deepEqual(replay, receipt); assert.equal(retireCalls, 1); assert.equal(closeCalls, 1); assert.equal(releaseCalls, 1);
});
