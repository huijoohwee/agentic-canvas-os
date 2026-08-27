import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EFFECTS,
  PRESERVATION,
  TERMINAL_EVIDENCE_SCHEMA,
  authorizationForPlan,
  buildPlan,
} from "../scripts/integrated-source-duplicate-pr-reconciliation-contract.mjs";
import {
  createIntegratedSourceDuplicatePrReconciliationController,
} from "../scripts/integrated-source-duplicate-pr-reconciliation-controller.mjs";
import {
  createIntegratedSourceDuplicatePrReconciliationRepositoryAdapter,
} from "../scripts/integrated-source-duplicate-pr-reconciliation-repository-adapter.mjs";
import {
  main as runCommand,
  parseArguments,
} from "../scripts/integrated-source-duplicate-pr-reconciliation.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  createTaskAuthorityBinding,
  createTaskAuthorityCapability,
} from "../scripts/task-bound-lane-authority-contract.mjs";
import {
  projectWriterLeasePullRequestMarker,
} from "../scripts/writer-lease-lib.mjs";

const CLAIM_ID = "2523a888a28f3e01b318c512c80ef5b4207357abe823782c4ec5a520fd8cc2af";
const DIGEST = "a".repeat(64);
const SOURCE_SHA = "d6e0b51ee517d270ab1e5f08fc7dc4c905244b0f";
const SOURCE_TREE = "21d141c40bfa23bed22a98ce945b9eed688d46dd";
const SOURCE_BASE = "f9663ab045ee0331c2ec5548012e8959f67bd804";
const SQUASH_SHA = "f9cea12ecf8af5949a6ab54e8b96494d8850c441";
const CONTROLLER_SHA = "415e914da9e757387b992a5b03d89ac8855cb310";
const SOURCE_BRANCH = "agent/katrinas-macbook-pro.local/planned-dirty-admission-recovery";
const SOURCE_PR_NODE = "PR_kwDOSr5-fM8AAAABBBdusA";
const MERGED_PR_NODE = "PR_kwDOSr5-fM8AAAABBBYl7A";

function exactDigest(label) {
  return digestValue({ label });
}

function validEvidence() {
  const changedPaths = ["scripts/planned-dirty-admission-recovery-contract.mjs"];
  const declaredWriteScope = [
    "path:scripts/planned-dirty-admission-recovery-contract.mjs",
  ];
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 285,
    sessionId: "goal-planned-dirty-admission-recovery-20260826",
    device: "katrinas-macbook-pro.local",
    scope: "planned-dirty-admission-recovery",
    branch: SOURCE_BRANCH,
    worktreePath: "/workspace/planned-dirty-admission-recovery",
    baseSha: SOURCE_BASE,
    fenceSha: SOURCE_SHA,
    pullRequestUrl: "https://github.com/huijoohwee/agentic-canvas-os/pull/736",
    autoDelivery: false,
    runtimeRequired: false,
    acquiredAt: "2026-08-26T03:08:00.465Z",
    heartbeatAt: "2026-08-26T03:08:00.465Z",
    expiresAt: "2026-08-26T03:38:00.465Z",
  };
  const capability = createTaskAuthorityCapability({
    authoritySubjectId: `urn:agentic-task:${exactDigest("task")}`,
    issuedAt: "2026-08-26T03:14:00.000Z",
  });
  lease.taskAuthority = createTaskAuthorityBinding({
    capability,
    lease,
    bindingMode: "migration",
    boundAt: "2026-08-26T03:14:06.977Z",
    transitionPlanDigest: "9c1737a22043e1ffe453a6be71e0acbc7f69a50c0e38b79ce7954d4cd6d9c325",
  });
  const beforeTaskAuthority = structuredClone(lease);
  delete beforeTaskAuthority.taskAuthority;
  return {
    observedAt: "2026-08-26T09:00:00.000Z",
    repository: {
      root: "/workspace/controller",
      nameWithOwner: "huijoohwee/agentic-canvas-os",
    },
    controller: {
      root: "/workspace/controller",
      headSha: CONTROLLER_SHA,
      originMainSha: CONTROLLER_SHA,
      treeSha: "790b4e24b665efe3c3cfd266dc81b225a5ea6ef5",
      runtimeDigest: exactDigest("runtime"),
      clean: true,
      protected: true,
    },
    source: {
      worktreePath: lease.worktreePath,
      branch: SOURCE_BRANCH,
      headSha: SOURCE_SHA,
      treeSha: SOURCE_TREE,
      baseSha: SOURCE_BASE,
      localBranchSha: SOURCE_SHA,
      remoteBranchSha: SOURCE_SHA,
      parentShas: [SOURCE_BASE],
      changedPaths,
      changedPathsDigest: digestValue(changedPaths),
      statusDigest: exactDigest("clean-status"),
      clean: true,
      registered: true,
    },
    sourcePullRequest: {
      number: 736,
      nodeId: SOURCE_PR_NODE,
      url: lease.pullRequestUrl,
      state: "OPEN",
      isDraft: true,
      mergedAt: null,
      closedAt: null,
      autoMergeRequest: null,
      headRepository: "huijoohwee/agentic-canvas-os",
      headBranch: SOURCE_BRANCH,
      headSha: SOURCE_SHA,
      baseRepository: "huijoohwee/agentic-canvas-os",
      baseBranch: "main",
      baseSha: SOURCE_BASE,
      bodyDigest: exactDigest("source-pr-body"),
      markerDigest: digestValue(projectWriterLeasePullRequestMarker(beforeTaskAuthority)),
      markerMode: "pre-task-authority-migration",
    },
    mergedPullRequest: {
      number: 735,
      nodeId: MERGED_PR_NODE,
      url: "https://github.com/huijoohwee/agentic-canvas-os/pull/735",
      state: "MERGED",
      isDraft: false,
      mergedAt: "2026-08-26T05:07:15.000Z",
      headRepository: "huijoohwee/agentic-canvas-os",
      headBranch: "hotfix/planned-dirty-admission-recovery",
      headSha: SOURCE_SHA,
      headTreeSha: SOURCE_TREE,
      baseRepository: "huijoohwee/agentic-canvas-os",
      baseBranch: "main",
      baseSha: SOURCE_BASE,
      mergeCommitSha: SQUASH_SHA,
      mergeCommitTreeSha: SOURCE_TREE,
      mergeCommitParentShas: [SOURCE_BASE],
      changedPaths,
      changedPathsDigest: digestValue(changedPaths),
      protectedMainSha: CONTROLLER_SHA,
      protectedMainContainsMerge: true,
    },
    claim: {
      claimId: CLAIM_ID,
      state: "retired",
      retirementReason: "integrated",
      canonicalBaseSha: SOURCE_BASE,
      laneRevision: SOURCE_SHA,
      candidateRevision: SOURCE_SHA,
      finalRevision: SOURCE_SHA,
      reviewRequestId: `github-pull-request:${MERGED_PR_NODE}`,
      integrationEntryDigest: exactDigest("claim-integration-entry"),
      retirementEntryDigest: exactDigest("claim-retirement-entry"),
      integrationReceiptDigest: exactDigest("claim-integration-receipt"),
      declaredWriteScope,
      writeSetDigest: digestValue(declaredWriteScope),
      lineageDigest: exactDigest("claim-lineage"),
      changedPathsCovered: true,
    },
    lease: {
      digest: digestValue(lease),
      snapshot: lease,
      status: lease.status,
      expired: true,
      branch: lease.branch,
      sessionId: lease.sessionId,
      epoch: lease.epoch,
      worktreePath: lease.worktreePath,
      baseSha: lease.baseSha,
      fenceSha: lease.fenceSha,
      pullRequestUrl: lease.pullRequestUrl,
      taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
      taskAuthorityTransitionPlanDigest: lease.taskAuthority.transitionPlanDigest,
      markerWithoutTaskAuthorityDigest:
        digestValue(projectWriterLeasePullRequestMarker(beforeTaskAuthority)),
      currentMarkerDigest: digestValue(projectWriterLeasePullRequestMarker(lease)),
    },
    checkpoint: {
      path: "/private/legacy-bootstrap.checkpoint.json",
      schema: "agentic-legacy-clean-committed-lane-bootstrap-checkpoint/v1",
      status: "pullRequest",
      rawDigest: exactDigest("checkpoint-raw"),
      identityDigest: "458c33936fac81eab0ade938d0c86db73dd08c56fd94ca2f1247203ff9a87cef",
      branch: SOURCE_BRANCH,
      headSha: SOURCE_SHA,
      treeSha: SOURCE_TREE,
      sourcePullRequestNumber: 736,
      claimId: CLAIM_ID,
    },
    preservation: PRESERVATION,
    effects: EFFECTS,
  };
}

test("plan is fixed to the authorized integrated duplicate and literal token", () => {
  const plan = buildPlan(validEvidence());
  assert.equal(
    authorizationForPlan(plan),
    `authorize integrated-source-duplicate-pr-reconciliation ${plan.planDigest}`,
  );
  assert.deepEqual(plan.effects, {
    providerPullRequest: "close-source-unmerged",
    localWriterLease: "release-preserved",
    pullRequestBodyEdit: false,
    cloudMutation: false,
    gitMutation: false,
    sourceMutation: false,
    integration: false,
    productionRelease: false,
    deployment: false,
    cleanup: false,
  });
  assert.equal(plan.evidence.mergedPullRequest.headBranch,
    "hotfix/planned-dirty-admission-recovery");
});

test("plan rejects any drift from the fixed PR, object, claim, or migration-only marker", () => {
  const mutations = [
    value => { value.sourcePullRequest.number = 737; },
    value => { value.mergedPullRequest.number = 734; },
    value => { value.source.headSha = "0".repeat(40); },
    value => { value.source.treeSha = "1".repeat(40); },
    value => { value.mergedPullRequest.mergeCommitSha = "2".repeat(40); },
    value => { value.claim.claimId = "3".repeat(64); },
    value => { value.sourcePullRequest.markerDigest = value.lease.currentMarkerDigest; },
    value => { value.effects.cloudMutation = true; },
  ];
  for (const mutate of mutations) {
    const evidence = structuredClone(validEvidence());
    mutate(evidence);
    assert.throws(() => buildPlan(evidence), /invalid/u);
  }
});

function terminalEvidence(plan, closed, released) {
  const { source, sourcePullRequest: pull, mergedPullRequest: merged,
    claim, checkpoint } = plan.evidence;
  const core = {
    schema: TERMINAL_EVIDENCE_SCHEMA,
    planDigest: plan.planDigest,
    source: {
      worktreePath: source.worktreePath, branch: source.branch,
      headSha: source.headSha, treeSha: source.treeSha,
      localBranchSha: source.localBranchSha, remoteBranchSha: source.remoteBranchSha,
      statusDigest: source.statusDigest, clean: true, registered: true,
    },
    sourcePullRequest: {
      number: pull.number, nodeId: pull.nodeId, state: "CLOSED", isDraft: true,
      mergedAt: null, closedAt: closed.closedAt, headBranch: pull.headBranch,
      headSha: pull.headSha, bodyDigest: pull.bodyDigest, markerDigest: pull.markerDigest,
    },
    mergedPullRequest: {
      number: merged.number, nodeId: merged.nodeId, state: "MERGED",
      mergedAt: merged.mergedAt, headSha: merged.headSha,
      headTreeSha: merged.headTreeSha, mergeCommitSha: merged.mergeCommitSha,
      mergeCommitTreeSha: merged.mergeCommitTreeSha,
    },
    claim: {
      claimId: claim.claimId, state: claim.state,
      retirementReason: claim.retirementReason,
      integrationEntryDigest: claim.integrationEntryDigest,
      retirementEntryDigest: claim.retirementEntryDigest,
      integrationReceiptDigest: claim.integrationReceiptDigest,
    },
    lease: released,
    checkpoint: {
      path: checkpoint.path, status: checkpoint.status,
      rawDigest: checkpoint.rawDigest, identityDigest: checkpoint.identityDigest,
    },
    preservation: PRESERVATION,
    effects: EFFECTS,
  };
  return { ...core, terminalEvidenceDigest: digestValue(core) };
}

function controllerFixture({ loseCloseResponse = false, loseReleaseResponse = false } = {}) {
  const evidence = validEvidence();
  const plan = buildPlan(evidence);
  const calls = [];
  let state = null;
  let pullClosed = false;
  let leaseReleased = false;
  let closeResponsesLost = loseCloseResponse ? 1 : 0;
  let releaseResponsesLost = loseReleaseResponse ? 1 : 0;
  const closed = {
    pullRequestNumber: 736, nodeId: SOURCE_PR_NODE, state: "CLOSED",
    headSha: SOURCE_SHA, bodyDigest: evidence.sourcePullRequest.bodyDigest,
    markerDigest: evidence.sourcePullRequest.markerDigest,
    closedAt: "2026-08-26T09:15:00.000Z",
    providerReceiptDigest: exactDigest("provider-close"),
  };
  const releaseCore = {
    schema: "agentic-integrated-source-duplicate-pr-reconciliation-local-lease-release-plan/v1",
    status: "prepared", planDigest: plan.planDigest, branch: SOURCE_BRANCH,
    sourceLeaseDigest: evidence.lease.digest, sourceLeaseEpoch: evidence.lease.epoch,
    headSha: SOURCE_SHA, treeSha: SOURCE_TREE,
  };
  const releaseProjection = {
    ...releaseCore,
    releasePlanDigest: digestValue(releaseCore),
  };
  const released = {
    branch: SOURCE_BRANCH, status: "released",
    sourceLeaseDigest: evidence.lease.digest,
    releasedLeaseDigest: exactDigest("released-lease"),
    releasePlanDigest: releaseProjection.releasePlanDigest,
    releaseReceiptDigest: exactDigest("release-receipt"),
    sourcePreserved: true,
  };
  const authorityReceipt = {
    bindingDigest: evidence.lease.taskAuthorityBindingDigest,
    receiptDigest: exactDigest("task-authority-receipt"),
  };
  const adapter = {
    async captureEvidence() { return evidence; },
    async readState() { return state; },
    async writeState({ expected, next }) {
      assert.deepEqual(expected, state); state = next; return state;
    },
    async withLock(_subject, callback) { return callback(); },
    async verifyTaskAuthority() { calls.push("task-authority"); return authorityReceipt; },
    async reverify(_plan, stage) { calls.push(stage); },
    async classifyPullRequest() {
      return pullClosed ? { state: "complete", values: closed } : { state: "pending" };
    },
    async closePullRequest() {
      calls.push("close"); pullClosed = true;
      if (closeResponsesLost-- > 0) throw new Error("close response lost");
    },
    async prepareLeaseRelease() { return releaseProjection; },
    async classifyLeaseRelease() {
      return leaseReleased ? { state: "complete", values: released } : { state: "pending" };
    },
    async releaseLease() {
      calls.push("release"); leaseReleased = true;
      if (releaseResponsesLost-- > 0) throw new Error("release response lost");
    },
    async readTerminalEvidence() { return terminalEvidence(plan, closed, released); },
  };
  return { adapter, calls, plan, get state() { return state; } };
}

test("controller closes PR736 before releasing its lease and replays without effects", async () => {
  for (const loss of [{ loseCloseResponse: true }, { loseReleaseResponse: true }]) {
    const fixture = controllerFixture(loss);
    const controller = createIntegratedSourceDuplicatePrReconciliationController({
      adapter: fixture.adapter,
    });
    const authorization = authorizationForPlan(fixture.plan);
    const receipt = await controller.run({ plan: fixture.plan, authorization });
    assert.equal(receipt.effects.cloudMutation, false);
    assert.ok(fixture.calls.indexOf("close") < fixture.calls.indexOf("release"));
    const effectCount = fixture.calls.filter(value => ["close", "release"].includes(value)).length;
    assert.deepEqual(await controller.run({ plan: fixture.plan, authorization }), receipt);
    assert.equal(fixture.calls.filter(value => ["close", "release"].includes(value)).length,
      effectCount);
  }
});

test("task capability failure blocks both terminal effects", async () => {
  const fixture = controllerFixture();
  fixture.adapter.verifyTaskAuthority = async () => { throw new Error("capability denied"); };
  const controller = createIntegratedSourceDuplicatePrReconciliationController({
    adapter: fixture.adapter,
  });
  await assert.rejects(controller.run({
    plan: fixture.plan,
    authorization: authorizationForPlan(fixture.plan),
  }), /capability denied/u);
  assert.equal(fixture.calls.includes("close"), false);
  assert.equal(fixture.calls.includes("release"), false);
});

test("repository adapter planning is read-only and fixed to PR736/PR735", () => {
  const fixture = commandFixture();
  try {
    const evidence = validEvidence();
    evidence.repository.root = fixture.repository;
    evidence.controller.root = fixture.repository;
    evidence.source.worktreePath = fixture.sourceWorktree;
    evidence.lease.snapshot.worktreePath = fixture.sourceWorktree;
    evidence.lease.worktreePath = fixture.sourceWorktree;
    evidence.lease.digest = digestValue(evidence.lease.snapshot);
    evidence.checkpoint.path = fixture.checkpointPath;
    let effects = 0;
    const options = {
      repository: fixture.repository, sourceWorktree: fixture.sourceWorktree,
      sourcePullRequestNumber: 736, integratedPullRequestNumber: 735,
      claimId: CLAIM_ID, checkpointPath: fixture.checkpointPath,
      taskAuthorityFile: null,
    };
    const dependencies = {
      realpath: value => path.resolve(value),
      gitCommonDir: fixture.root,
      repositoryNameWithOwner: "huijoohwee/agentic-canvas-os",
      captureEvidence: () => evidence,
      leaseStore: { read() { effects += 1; } },
      readPullRequest() { effects += 1; },
      readLedger() { effects += 1; },
      providerClose() { effects += 1; },
    };
    const adapter = createIntegratedSourceDuplicatePrReconciliationRepositoryAdapter(
      options, dependencies,
    );
    assert.equal(adapter.captureEvidence().sourcePullRequest.number, 736);
    assert.equal(effects, 0);
    assert.throws(() => createIntegratedSourceDuplicatePrReconciliationRepositoryAdapter(
      { ...options, sourcePullRequestNumber: 737 }, dependencies,
    ), /PR736|subject/u);
  } finally {
    fixture.cleanup();
  }
});

function privateFile(directory, name, value = "{}\n") {
  const target = path.join(directory, name);
  fs.writeFileSync(target, value, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(target, 0o600);
  return target;
}

function commandFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "duplicate-pr-cli-"));
  const repository = path.join(root, "controller");
  const sourceWorktree = path.join(root, "source");
  const checkpointPath = privateFile(root, "legacy.checkpoint.json");
  const common = [
    `--repository=${repository}`,
    `--source-worktree=${sourceWorktree}`,
    "--source-pr=736",
    "--integrated-pr=735",
    `--claim-id=${CLAIM_ID}`,
    `--checkpoint=${checkpointPath}`,
  ];
  return {
    root,
    repository,
    sourceWorktree,
    checkpointPath,
    common,
    cleanup() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

test("planning discards and never opens a task capability locator", async () => {
  const fixture = commandFixture();
  try {
    let adapterOptions;
    const result = await runCommand([
      "plan",
      ...fixture.common,
      `--task-authority=${path.join(fixture.root, "must-not-be-opened.json")}`,
    ], {
      createAdapter(options) {
        adapterOptions = options;
        return Object.freeze({});
      },
      createController() {
        return {
          async plan() { return { planDigest: DIGEST }; },
          async run() { throw new Error("planning must not run effects"); },
        };
      },
    });
    assert.equal(result.planDigest, DIGEST);
    assert.equal(adapterOptions.taskAuthorityFile, null);
  } finally {
    fixture.cleanup();
  }
});

test("run accepts only the fixed pull requests and literal plan authorization", async () => {
  const fixture = commandFixture();
  try {
    const taskAuthorityFile = privateFile(fixture.root, "task-authority.json");
    const planFile = privateFile(
      fixture.root,
      "plan.json",
      `${JSON.stringify({ planDigest: DIGEST })}\n`,
    );
    const args = [
      "run",
      ...fixture.common,
      `--task-authority=${taskAuthorityFile}`,
      `--plan-file=${planFile}`,
      `--plan-digest=${DIGEST}`,
      `--authorize=authorize integrated-source-duplicate-pr-reconciliation ${DIGEST}`,
    ];
    let adapterOptions;
    let invocation;
    const result = await runCommand(args, {
      createAdapter(options) {
        adapterOptions = options;
        return Object.freeze({});
      },
      createController() {
        return {
          async plan() { throw new Error("run must use the stored plan"); },
          async run(input) {
            invocation = input;
            return { ok: true, receiptDigest: DIGEST };
          },
        };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(adapterOptions.sourcePullRequestNumber, 736);
    assert.equal(adapterOptions.integratedPullRequestNumber, 735);
    assert.equal(adapterOptions.taskAuthorityFile, taskAuthorityFile);
    assert.deepEqual(invocation, {
      plan: { planDigest: DIGEST },
      authorization: `authorize integrated-source-duplicate-pr-reconciliation ${DIGEST}`,
    });

    assert.throws(
      () => parseArguments(args.map(value => value === "--source-pr=736"
        ? "--source-pr=737" : value)),
      /source-pr must equal 736/u,
    );
    await assert.rejects(
      runCommand(args.map(value => value.startsWith("--authorize=")
        ? "--authorize=authorize integrated-source-duplicate-pr-reconciliation deadbeef"
        : value), {
        createAdapter() { return {}; },
        createController() {
          return { async plan() {}, async run() { throw new Error("unexpected effect"); } };
        },
      }),
      /exact authorization/u,
    );
  } finally {
    fixture.cleanup();
  }
});

test("run rejects in-worktree, shared, and aliased private inputs", () => {
  const fixture = commandFixture();
  try {
    fs.mkdirSync(fixture.repository, { recursive: true });
    const inRepository = privateFile(fixture.repository, "plan.json", "{}\n");
    const shared = privateFile(fixture.root, "shared.json", "{}\n");
    fs.chmodSync(shared, 0o644);
    const alias = path.join(fixture.root, "alias.json");
    fs.symlinkSync(fixture.checkpointPath, alias);
    const baseline = [
      "run",
      ...fixture.common,
      `--task-authority=${fixture.checkpointPath}.authority`,
      `--plan-file=${inRepository}`,
      `--authorize=authorize integrated-source-duplicate-pr-reconciliation ${DIGEST}`,
    ];
    privateFile(fixture.root, "legacy.checkpoint.json.authority");
    assert.throws(() => parseArguments(baseline), /plan-file must remain outside/u);
    assert.throws(
      () => parseArguments([
        ...baseline.filter(value => !value.startsWith("--plan-file=")),
        `--plan-file=${shared}`,
      ]),
      /owner-only regular file/u,
    );
    assert.throws(
      () => parseArguments([
        ...baseline.filter(value => !value.startsWith("--plan-file=")),
        `--plan-file=${alias}`,
      ]),
      /owner-only regular file/u,
    );
  } finally {
    fixture.cleanup();
  }
});
