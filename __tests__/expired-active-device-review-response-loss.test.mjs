import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
}
  from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  applyCloudTransition,
  createEmptyLedger,
  listCurrentClaims,
} from "../scripts/cloud-collaboration-contract.mjs";
import { projectPublicClaim }
  from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_MUTATION_POLICY,
  authorizeExpiredActiveDeviceReviewResponseLoss,
  buildExpiredActiveDeviceReviewResponseLossPlan,
  buildExpiredActiveDeviceReviewResponseLossReviewedTransitionAdoption,
  normalizeExpiredActiveDeviceReviewResponseLossIntent,
  normalizeExpiredActiveDeviceReviewResponseLossPlan,
} from "../scripts/expired-active-device-review-response-loss-contract.mjs";
import { createExpiredActiveDeviceReviewResponseLossController }
  from "../scripts/expired-active-device-review-response-loss-controller.mjs";
import { buildExpiredActiveDeviceReviewResponseLossEvidence }
  from "../scripts/expired-active-device-review-response-loss-evidence.mjs";
import { createRepositoryExpiredActiveDeviceReviewResponseLossAdapter }
  from "../scripts/expired-active-device-review-response-loss-repository-adapter.mjs";
import { normalizeBoundAuthority }
  from "../scripts/scoped-lane-cloud-reconciliation.mjs";
import {
  createTaskAuthorityBinding,
  createTaskAuthorityCapability,
} from "../scripts/task-bound-lane-authority-contract.mjs";
import {
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "../scripts/writer-lease-lib.mjs";

const D = value => digestValue({ value });
const SHA = value => value.repeat(40);
const BASE = SHA("1");
const HEAD = SHA("2");
const TREE = SHA("3");
const BRANCH = "agent/device.local/review-response-loss";
const CLOUD_DEVICE_ID = `device:${digestValue({ namespace: "device", value: "device.local" })}`;
const CLOUD_SESSION_ID = `session:${digestValue({
  namespace: "session",
  value: "session-review-loss",
})}`;
const OBSERVED_AT = "2026-08-27T12:00:00.000Z";
const EXPIRES_AT = "2026-08-27T11:00:00.000Z";
const BOUND_AT = "2026-08-27T10:00:00.000Z";
const PULL_ID = "PR_fixture_748";
const PULL_URL = "https://provider.test/example/repository/pull/748";
const WRITE_SET = Object.freeze([
  "path:docs/review-response-loss.md",
  "semantic:review-response-loss",
]);

function cloudLifecycleFixture() {
  const repository = {
    repositoryId: "provider-repository:fixture-repository",
    canonicalRevision: BASE,
  };
  const actor = {
    actorId: "provider-user:fixture-owner",
    deviceId: CLOUD_DEVICE_ID,
    sessionId: CLOUD_SESSION_ID,
  };
  let ledger = createEmptyLedger(repository);
  const transition = (action, evaluationTime, request) => {
    const result = applyCloudTransition({
      ledger,
      action,
      actor,
      repository,
      evaluationTime,
      request: { ...request, expectedLedgerDigest: ledger.headDigest },
    });
    ledger = result.ledger;
    return result;
  };
  const claimed = transition("claim", "2026-08-27T09:00:00.000Z", {
    workItemId: `work-item:${digestValue({ namespace: "work-item", value: BRANCH })}`,
    canonicalBaseRevision: BASE,
    laneRevision: HEAD,
    declaredWriteScope: WRITE_SET,
    leaseEpoch: 1,
    expiresAt: EXPIRES_AT,
    idempotencyKey: "review-response-loss-claim",
  });
  const projected = transition("continue", "2026-08-27T09:10:00.000Z", {
    claimId: claimed.claim.claimId,
    expectedFenceRevision: claimed.claim.fenceRevision,
    expectedTransitionCounter: claimed.claim.transitionCounter,
    mode: "projection",
    laneRevision: HEAD,
    idempotencyKey: "review-response-loss-projection",
  });
  const source = transition("continue", "2026-08-27T09:20:00.000Z", {
    claimId: projected.claim.claimId,
    expectedFenceRevision: projected.claim.fenceRevision,
    expectedTransitionCounter: projected.claim.transitionCounter,
    mode: "projection",
    laneRevision: HEAD,
    reviewRequestId: `github-pull-request:${PULL_ID}`,
    idempotencyKey: "review-response-loss-provider-binding",
  });
  const focusedEvidenceDigest = digestValue({
    schema: "agentic-focused-review-evidence/v1",
    command: "npm run check",
    branch: BRANCH,
    headSha: HEAD,
    pullRequestNumber: 748,
    admittedReportDigest: D("admitted-report"),
  });
  const reviewed = transition("continue", "2026-08-27T09:30:00.000Z", {
    claimId: source.claim.claimId,
    expectedFenceRevision: source.claim.fenceRevision,
    expectedTransitionCounter: source.claim.transitionCounter,
    mode: "review",
    laneRevision: HEAD,
    reviewRequestId: `github-pull-request:${PULL_ID}`,
    focusedEvidenceDigest,
    idempotencyKey: "review-response-loss-reviewed",
  });
  return {
    ledger: reviewed.ledger,
    preSourceLedger: projected.ledger,
    sourceLedger: source.ledger,
    sourceEntry: source.ledger.entries.at(-1),
    reviewedEntry: reviewed.ledger.entries.at(-1),
    sourceClaim: listCurrentClaims(source.ledger, "2026-08-27T10:00:00.000Z")[0],
    reviewedClaim: listCurrentClaims(reviewed.ledger, OBSERVED_AT)[0],
    focusedEvidenceDigest,
  };
}

function evidenceFixture({ cloudState = "reviewed", lifecycle = cloudLifecycleFixture() } = {}) {
  const claimId = lifecycle.reviewedClaim.claimId;
  const writeSetDigest = lifecycle.reviewedClaim.writeSetDigest;
  const migrationPlanDigest = D("migration-plan");
  const admission = {
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: "review-response-loss",
    declaredWriteSet: WRITE_SET,
    writeSetDigest,
    manifestDigest: D("manifest"),
    planReceiptDigest: D("plan-receipt"),
    admissionReceiptDigest: D("admission-receipt"),
    existingLaneStateDigest: D("lane-state"),
    admittedReportDigest: D("admitted-report"),
    preservationReceiptDigest: D("preservation"),
  };
  const sourceAuthority = {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "example/repository",
    targetRepository: "example/repository",
    claimId,
    claimDigest: lifecycle.sourceEntry.claimDigest,
    ledgerRevision: SHA("4"),
    ledgerDigest: lifecycle.sourceEntry.digest,
    claimLedgerRevision: lifecycle.sourceEntry.digest,
    entrySchema: lifecycle.sourceClaim.entrySchema,
    claimIdentitySchema: lifecycle.sourceClaim.claimIdentitySchema,
    operationReceiptDigest: lifecycle.sourceClaim.operationReceiptDigest,
    mutationAuthorityEligible: true,
    canonicalBaseSha: BASE,
    laneRevision: HEAD,
    cloudDeclaredWriteScope: lifecycle.sourceClaim.declaredWriteScope,
    writeSetDigest,
    deviceId: "device.local",
    sessionId: "session-review-loss",
    reviewRequestId: `github-pull-request:${PULL_ID}`,
    leaseEpoch: 1,
    transitionCounter: 3,
    heartbeatCounter: 0,
    state: "active",
    expiresAt: EXPIRES_AT,
    integrationReceiptDigest: null,
    integration: null,
    manifestDigest: D("manifest"),
  };
  const leaseWithoutTaskAuthority = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 9,
    sessionId: "session-review-loss",
    device: "device.local",
    scope: "review-response-loss",
    branch: BRANCH,
    worktreePath: "/tmp/review-response-loss",
    baseSha: BASE,
    fenceSha: HEAD,
    pullRequestUrl: PULL_URL,
    autoDelivery: false,
    runtimeRequired: false,
    acquiredAt: "2026-08-27T09:00:00.000Z",
    heartbeatAt: "2026-08-27T10:30:00.000Z",
    expiresAt: EXPIRES_AT,
    admission,
    cloudAuthority: sourceAuthority,
  };
  const capability = createTaskAuthorityCapability({
    authoritySubjectId: `urn:agentic-task:${D("task-subject")}`,
    issuedAt: "2026-08-27T09:30:00.000Z",
  });
  const taskAuthority = createTaskAuthorityBinding({
    capability,
    lease: leaseWithoutTaskAuthority,
    bindingMode: "migration",
    boundAt: BOUND_AT,
    transitionPlanDigest: migrationPlanDigest,
  });
  const sourceLease = { ...leaseWithoutTaskAuthority, taskAuthority };
  const sourceMarkerValue = projectWriterLeasePullRequestMarker(leaseWithoutTaskAuthority);
  const sourceBody = updateWriterLeasePullRequestBody(
    "# Review fixture\n\nAuthored context stays byte-exact.\n",
    leaseWithoutTaskAuthority,
  );
  const reviewedClaim = {
    ...projectPublicClaim(lifecycle.reviewedClaim),
    state: cloudState,
  };
  const status = {
    ledgerRevision: SHA("5"),
    ledgerDigest: lifecycle.ledger.headDigest,
    sequence: lifecycle.ledger.sequence,
  };
  const targetAuthority = {
    ...normalizeBoundAuthority({
      result: {
        claim: reviewedClaim,
        claimDigest: reviewedClaim.fenceRevision,
        ledgerRevision: status.ledgerRevision,
        ledgerDigest: status.ledgerDigest,
      },
      authority: sourceAuthority,
      manifest: admission,
      focusedEvidenceDigest: lifecycle.focusedEvidenceDigest,
    }),
    state: "review_ready",
    manifestDigest: sourceAuthority.manifestDigest,
  };
  const ledgerValidation = {
    schema: "agentic-expired-active-device-review-ledger-validation/v1",
    ledgerRevision: status.ledgerRevision,
    ledgerDigest: status.ledgerDigest,
    sequence: status.sequence,
    entryCount: lifecycle.ledger.entries.length,
    validated: true,
    failureCount: 0,
    targetLatestSequence: lifecycle.reviewedEntry.sequence,
    sourceLedgerRevision: sourceAuthority.ledgerRevision,
    sourceLedgerDigest: lifecycle.sourceLedger.headDigest,
    sourceSequence: lifecycle.sourceLedger.sequence,
    sourceEntryDigest: lifecycle.sourceEntry.digest,
    sourceEntryCount: lifecycle.sourceLedger.entries.length,
    sourceValidated: true,
  };
  const targetLease = {
    ...sourceLease,
    status: "review_ready",
    reviewHeadSha: HEAD,
    cloudAuthority: targetAuthority,
  };
  const targetMarker = projectWriterLeasePullRequestMarker(targetLease);
  const targetBody = updateWriterLeasePullRequestBody(sourceBody, targetLease);
  const targetProviderState = {
    id: PULL_ID,
    number: 748,
    url: PULL_URL,
    state: "OPEN",
    isDraft: false,
    autoMergeRequest: null,
    title: "fix: recover review response loss",
    headRepository: "example/repository",
    headBranch: BRANCH,
    headSha: HEAD,
    baseBranch: "main",
    baseSha: BASE,
  };
  return buildExpiredActiveDeviceReviewResponseLossEvidence({
    observedAt: OBSERVED_AT,
    repository: { path: "/tmp/review-response-loss", nameWithOwner: "example/repository" },
    worktree: {
      branch: BRANCH,
      headSha: HEAD,
      treeSha: TREE,
      localRefSha: HEAD,
      remoteRefSha: HEAD,
      registered: true,
      clean: true,
      statusDigest: D("clean-status"),
      indexDigest: D("source-index"),
    },
    sourceLease,
    sourceLeaseDigest: digestValue(sourceLease),
    migration: {
      planDigest: migrationPlanDigest,
      targetBindingDigest: taskAuthority.bindingDigest,
      taskAuthorityCapabilitySubject: capability.authoritySubjectId,
      bindingMode: "migration",
      boundAt: BOUND_AT,
    },
    sourceMarker: {
      marker: sourceMarkerValue,
      markerDigest: digestValue(sourceMarkerValue),
      projectedWithoutTaskAuthorityDigest: digestValue(sourceMarkerValue),
      taskAuthorityAbsent: true,
    },
    cloud: {
      status,
      claim: reviewedClaim,
      sourceEntry: lifecycle.sourceEntry,
      reviewedEntry: lifecycle.reviewedEntry,
      targetAuthority,
      targetAuthorityDigest: digestValue(targetAuthority),
      ledgerValidation,
      ledgerValidationDigest: digestValue(ledgerValidation),
      laterTargetTransitionCount: 0,
      noOverlappingCompetitor: true,
      competitorCount: 0,
    },
    pullRequest: {
      ...targetProviderState,
      isDraft: true,
      sourceBody,
      sourceBodyDigest: digestValue(sourceBody),
      sourceMarkerDigest: digestValue(sourceMarkerValue),
    },
    projections: {
      targetLease,
      targetLeaseDigest: digestValue(targetLease),
      targetRegistryRevision: 12,
      targetMarker,
      targetMarkerDigest: digestValue(targetMarker),
      targetBody,
      targetBodyDigest: digestValue(targetBody),
      targetProviderState,
      targetProviderStateDigest: digestValue(targetProviderState),
    },
  });
}

function refreshSourceLeaseDerivedEvidence(value) {
  const { taskAuthority: _taskAuthority, ...sourceWithoutTaskAuthority } = value.sourceLease;
  const sourceMarker = projectWriterLeasePullRequestMarker(sourceWithoutTaskAuthority);
  const sourceBody = updateWriterLeasePullRequestBody(
    value.pullRequest.sourceBody,
    sourceWithoutTaskAuthority,
  );
  const targetLease = {
    ...value.sourceLease,
    status: "review_ready",
    reviewHeadSha: value.sourceLease.fenceSha,
    cloudAuthority: value.cloud.targetAuthority,
  };
  const targetMarker = projectWriterLeasePullRequestMarker(targetLease);
  const targetBody = updateWriterLeasePullRequestBody(sourceBody, targetLease);
  value.sourceLeaseDigest = digestValue(value.sourceLease);
  value.sourceMarker = {
    marker: sourceMarker,
    markerDigest: digestValue(sourceMarker),
    projectedWithoutTaskAuthorityDigest: digestValue(sourceMarker),
    taskAuthorityAbsent: true,
  };
  value.pullRequest.sourceBody = sourceBody;
  value.pullRequest.sourceBodyDigest = digestValue(sourceBody);
  value.pullRequest.sourceMarkerDigest = value.sourceMarker.markerDigest;
  value.projections.targetLease = targetLease;
  value.projections.targetLeaseDigest = digestValue(targetLease);
  value.projections.targetMarker = targetMarker;
  value.projections.targetMarkerDigest = digestValue(targetMarker);
  value.projections.targetBody = targetBody;
  value.projections.targetBodyDigest = digestValue(targetBody);
}

function refreshProviderProjection(value) {
  const target = value.projections.targetProviderState;
  for (const field of [
    "id", "number", "url", "state", "autoMergeRequest", "title",
    "headRepository", "headBranch", "headSha", "baseBranch", "baseSha",
  ]) target[field] = value.pullRequest[field];
  target.isDraft = false;
  value.projections.targetProviderStateDigest = digestValue(target);
}

function refreshTargetAuthorityDerivedEvidence(value) {
  const authority = value.cloud.targetAuthority;
  const targetLease = {
    ...value.sourceLease,
    status: "review_ready",
    reviewHeadSha: value.sourceLease.fenceSha,
    cloudAuthority: authority,
  };
  const targetMarker = projectWriterLeasePullRequestMarker(targetLease);
  const targetBody = updateWriterLeasePullRequestBody(value.pullRequest.sourceBody, targetLease);
  value.cloud.targetAuthorityDigest = digestValue(authority);
  value.projections.targetLease = targetLease;
  value.projections.targetLeaseDigest = digestValue(targetLease);
  value.projections.targetMarker = targetMarker;
  value.projections.targetMarkerDigest = digestValue(targetMarker);
  value.projections.targetBody = targetBody;
  value.projections.targetBodyDigest = digestValue(targetBody);
}

function phaseValues(plan, phase, state = {}) {
  const projections = plan.evidence.projections;
  switch (phase) {
    case "task-authority-verified":
      return {
        bindingDigest: plan.evidence.migration.targetBindingDigest,
        taskAuthorityReceiptDigest: D("task-authority-receipt"),
      };
    case "reviewed-transition-adopted":
      return buildExpiredActiveDeviceReviewResponseLossReviewedTransitionAdoption(plan);
    case "local-attempted":
      return { localState: state.local, revalidationDigest: D("before-local") };
    case "local-projected":
      return {
        ...(state.adopted ? { localProjected: true } : {}),
        disposition: state.adopted ? "adopted-response-loss" : "projected",
        leaseDigest: projections.targetLeaseDigest,
        localMutation: !state.adopted,
        registryRevision: 12,
      };
    case "marker-attempted":
      return { markerState: state.marker, revalidationDigest: D("before-marker") };
    case "marker-projected":
      return {
        bodyDigest: projections.targetBodyDigest,
        disposition: state.adopted ? "adopted-response-loss" : "projected",
        markerDigest: projections.targetMarkerDigest,
        providerMutation: !state.adopted,
        ...(state.adopted ? { markerProjected: true } : {}),
      };
    case "ready-attempted":
      return { readyState: state.ready, revalidationDigest: D("before-ready") };
    case "provider-ready":
      return {
        disposition: state.adopted ? "adopted-response-loss" : "projected",
        providerMutation: !state.adopted,
        providerStateDigest: projections.targetProviderStateDigest,
        ...(state.adopted ? { providerReady: true } : {}),
      };
    case "verified":
      return {
        bodyDigest: projections.targetBodyDigest,
        leaseDigest: projections.targetLeaseDigest,
        markerDigest: projections.targetMarkerDigest,
        providerStateDigest: projections.targetProviderStateDigest,
        registryRevision: 12,
        verificationDigest: D("terminal-verification"),
      };
    default:
      throw new Error(`Unknown test phase: ${phase}`);
  }
}

function fakeAdapter({
  evidence = evidenceFixture(),
  initial = {},
  responseLoss = null,
  persistence = null,
  terminalDriftOnReplay = false,
} = {}) {
  let intent = null;
  const state = {
    local: initial.local || "source",
    marker: initial.marker || "source",
    ready: initial.ready || "draft",
  };
  const effects = {
    local: 0,
    marker: 0,
    ready: 0,
    cloud: 0,
    git: 0,
    source: 0,
    ref: 0,
    terminal: 0,
  };
  const calls = [];
  let persistenceTriggered = false;
  const plan = buildExpiredActiveDeviceReviewResponseLossPlan({ evidence });
  const adapter = {
    async readPlanEvidence() { calls.push("read-plan"); return evidence; },
    async withOperationLock(action) { calls.push("lock"); return action(); },
    async assertRuntimeSubject(received) {
      calls.push("runtime-subject");
      assert.equal(received.planDigest, plan.planDigest);
    },
    async readIntent() { calls.push("read-intent"); return intent; },
    async writeIntent({ expected, value }) {
      calls.push(`write:${value.status}`);
      if (intent !== expected) throw new Error("fixture CAS contention");
      if (persistence?.status === value.status && !persistenceTriggered) {
        persistenceTriggered = true;
        if (persistence.mode === "lands-then-throws") {
          intent = value;
          throw new Error("journal response lost");
        }
        if (persistence.mode === "competing") {
          intent = structuredClone(value);
          intent.intentDigest = D("competing-intent");
          return;
        }
        if (persistence.mode === "void-without-write") return;
      }
      intent = value;
    },
    async authorizeTask(received) {
      calls.push("task-proof");
      assert.equal(received.taskAuthorityOperation, plan.taskAuthorityOperation);
      return phaseValues(plan, "task-authority-verified");
    },
    async revalidate(_received, phase) {
      calls.push(`revalidate:${phase}`);
      if (phase === "before-authority") return { exact: true };
      if (phase === "adopt-reviewed-transition") {
        return phaseValues(plan, "reviewed-transition-adopted");
      }
      if (phase === "before-local") {
        return phaseValues(plan, "local-attempted", state);
      }
      if (phase === "adopt-local") {
        return state.local === "target"
          ? phaseValues(plan, "local-projected", { adopted: true })
          : { localProjected: false };
      }
      if (phase === "before-marker") {
        return phaseValues(plan, "marker-attempted", state);
      }
      if (phase === "adopt-marker") {
        return state.marker === "target"
          ? phaseValues(plan, "marker-projected", { adopted: true })
          : { markerProjected: false };
      }
      if (phase === "before-ready") {
        return phaseValues(plan, "ready-attempted", state);
      }
      if (phase === "adopt-ready") {
        return state.ready === "ready"
          ? phaseValues(plan, "provider-ready", { adopted: true })
          : { providerReady: false };
      }
      throw new Error(`Unexpected revalidation phase: ${phase}`);
    },
    async projectLocalReviewReady() {
      calls.push("effect:local");
      effects.local += 1;
      state.local = "target";
      if (responseLoss === "local") throw new Error("local CAS response lost");
      return phaseValues(plan, "local-projected", { adopted: false });
    },
    async projectProviderMarker() {
      calls.push("effect:marker");
      effects.marker += 1;
      state.marker = "target";
      if (responseLoss === "marker") throw new Error("marker response lost");
      return phaseValues(plan, "marker-projected", { adopted: false });
    },
    async markProviderReady() {
      calls.push("effect:ready");
      effects.ready += 1;
      state.ready = "ready";
      if (responseLoss === "ready") throw new Error("ready response lost");
      return phaseValues(plan, "provider-ready", { adopted: false });
    },
    async verifyTerminal(_received, { replay }) {
      calls.push(`verify:${replay}`);
      effects.terminal += 1;
      assert.deepEqual(state, { local: "target", marker: "target", ready: "ready" });
      const values = phaseValues(plan, "verified");
      return replay && terminalDriftOnReplay
        ? { ...values, verificationDigest: D("drifted-terminal-verification") }
        : values;
    },
  };
  return {
    adapter,
    calls,
    effects,
    plan,
    intent: () => intent,
    setIntent: value => { intent = value; },
  };
}

function repositoryAdapterFixture({ responseLoss = null, isProcessAlive = undefined } = {}) {
  const lifecycle = cloudLifecycleFixture();
  const seed = evidenceFixture({ cloudState: "dormant-preserved", lifecycle });
  const sandbox = realpathSync(mkdtempSync(path.join(os.tmpdir(), "review-response-loss-")));
  const repository = path.join(sandbox, "repository");
  const gitDirectory = path.join(repository, ".git");
  mkdirSync(gitDirectory, { recursive: true });
  const indexPath = path.join(gitDirectory, "index");
  writeFileSync(indexPath, "sealed-index-bytes\n");
  const taskAuthorityFile = path.join(sandbox, "task-authority.json");
  writeFileSync(taskAuthorityFile, "{}\n", { mode: 0o600 });
  const statePath = path.join(sandbox, "writer-leases.json");
  const sourceLease = { ...seed.sourceLease, worktreePath: repository };
  const { taskAuthority: _taskAuthority, ...sourceWithoutTaskAuthority } = sourceLease;
  let body = updateWriterLeasePullRequestBody(
    "# Repository adapter fixture\n\nPreserve these authored bytes.\n",
    sourceWithoutTaskAuthority,
  );
  let isDraft = true;
  let title = seed.pullRequest.title;
  let headSha = HEAD;
  let treeSha = TREE;
  let localRefSha = HEAD;
  let remoteRefSha = HEAD;
  let worktreeStatus = "";
  let claim = structuredClone(seed.cloud.claim);
  const ledger = structuredClone(lifecycle.ledger);
  const preSourceLedger = structuredClone(lifecycle.preSourceLedger);
  const sourceLedger = structuredClone(lifecycle.sourceLedger);
  let historicalLedgerMode = "exact";
  let registry = {
    schema: "agentic-writer-lease-registry/v2",
    revision: 11,
    leases: { [BRANCH]: sourceLease },
  };
  let competingIntentOnNextRegistryLock = null;
  writeRegistry(registry);
  const calls = [];
  const mutations = { marker: 0, ready: 0, cloud: 0, git: 0, source: 0, ref: 0 };

  function writeRegistry(value) {
    registry = value;
    writeFileSync(statePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  }

  function readRegistry() {
    registry = JSON.parse(readFileSync(statePath, "utf8"));
    return registry;
  }

  function reviewValue() {
    return {
      id: PULL_ID,
      number: 748,
      url: PULL_URL,
      state: "OPEN",
      isDraft,
      title,
      body,
      headRefName: BRANCH,
      headRefOid: headSha,
      headRepository: { nameWithOwner: "example/repository" },
      baseRefName: "main",
      baseRefOid: BASE,
      autoMergeRequest: null,
    };
  }

  const leaseStore = {
    statePath,
    readRegistry,
    withRegistryLock(action) {
      if (competingIntentOnNextRegistryLock) {
        const mapName = competingIntentOnNextRegistryLock;
        competingIntentOnNextRegistryLock = null;
        const changed = structuredClone(readRegistry());
        changed.revision += 1;
        changed[mapName] = {
          ...(changed[mapName] || {}),
          [BRANCH]: { schema: "fixture-competing-branch-controller-intent/v1" },
        };
        writeRegistry(changed);
      }
      return action(readRegistry());
    },
  };
  const dependencies = {
    leaseStore,
    journalPath: path.join(
      gitDirectory,
      "agentic-canvas-os",
      "expired-active-device-review-response-loss",
      "intent.json",
    ),
    randomUUID: () => "fixture-uuid",
    now: () => new Date(OBSERVED_AT),
    git(argumentsList) {
      const command = argumentsList.join(" ");
      calls.push(`git:${command}`);
      if (command === "branch --show-current") return BRANCH;
      if (command === "rev-parse --git-common-dir") return ".git";
      if (command === "rev-parse HEAD") return headSha;
      if (command === "rev-parse HEAD^{tree}") return treeSha;
      if (command === `rev-parse refs/heads/${BRANCH}`) return localRefSha;
      if (command === "status --porcelain=v1 -z --untracked-files=all") {
        return worktreeStatus;
      }
      if (command === "worktree list --porcelain -z") {
        return `worktree ${repository}\0HEAD ${headSha}\0branch refs/heads/${BRANCH}\0`;
      }
      if (command === "rev-parse --git-path index") return ".git/index";
      throw new Error(`Unexpected repository fixture Git call: ${command}`);
    },
    gh(argumentsList) {
      calls.push(`gh:${argumentsList.join(" ")}`);
      if (argumentsList[0] === "pr" && argumentsList[1] === "view") {
        return JSON.stringify(reviewValue());
      }
      if (argumentsList[0] === "api") return remoteRefSha;
      if (argumentsList[0] === "pr" && argumentsList[1] === "edit") {
        mutations.marker += 1;
        body = argumentsList[argumentsList.indexOf("--body") + 1];
        if (responseLoss === "marker") throw new Error("provider marker response lost");
        return "";
      }
      if (argumentsList[0] === "pr" && argumentsList[1] === "ready") {
        mutations.ready += 1;
        isDraft = false;
        if (responseLoss === "ready") throw new Error("provider ready response lost");
        return "";
      }
      throw new Error(`Unexpected repository fixture provider call: ${argumentsList.join(" ")}`);
    },
    cloudAction(values) {
      calls.push(`cloud:${values.action}`);
      assert.equal(values.action, "status");
      return {
        schema: "agentic-cloud-collaboration-result/v1",
        ok: true,
        action: "status",
        status: "ready",
        claims: [structuredClone(claim)],
        ledgerRevision: SHA("5"),
        ledgerDigest: ledger.headDigest,
        sequence: ledger.sequence,
      };
    },
    readLedgerSnapshot({ revision }) {
      if (revision === sourceLease.cloudAuthority.ledgerRevision) {
        if (historicalLedgerMode === "current-as-source") return structuredClone(ledger);
        if (historicalLedgerMode === "pre-source") return structuredClone(preSourceLedger);
        if (historicalLedgerMode === "wrong-head") {
          const changed = structuredClone(sourceLedger);
          changed.headDigest = D("wrong-historical-head");
          return changed;
        }
        return structuredClone(sourceLedger);
      }
      if (revision === SHA("5")) return structuredClone(ledger);
      throw new Error(`Unexpected repository fixture ledger revision: ${revision}`);
    },
    authorizeTaskMutation(values) {
      calls.push("task-proof");
      assert.equal(values.lease.taskAuthority.bindingDigest,
        sourceLease.taskAuthority.bindingDigest);
      assert.equal(values.capabilityPath, taskAuthorityFile);
      assert.match(values.operation,
        /^expired-active-device-review-response-loss:[0-9a-f]{64}$/u);
      return {
        receiptDigest: D("repository-task-proof"),
        bindingDigest: sourceLease.taskAuthority.bindingDigest,
      };
    },
  };
  if (isProcessAlive) dependencies.isProcessAlive = isProcessAlive;
  const adapter = createRepositoryExpiredActiveDeviceReviewResponseLossAdapter({
    repository,
    pullRequestNumber: 748,
    taskAuthorityFile,
  }, dependencies);

  return {
    adapter,
    calls,
    mutations,
    body: () => body,
    isDraft: () => isDraft,
    registry: readRegistry,
    armCompetingBranchIntent(mapName = "scopeExpansionIntents") {
      competingIntentOnNextRegistryLock = mapName;
    },
    setHistoricalLedgerMode(mode) { historicalLedgerMode = mode; },
    setDrift(kind) {
      if (kind === "ledger") {
        claim.operationReceiptDigest = D("drifted-cloud-operation");
      } else if (kind === "registry") {
        const current = readRegistry();
        const changed = structuredClone(current);
        changed.leases[BRANCH].heartbeatAt = "2026-08-27T10:31:00.000Z";
        writeRegistry(changed);
      } else if (kind === "pr") {
        title = "drifted provider title";
      } else if (kind === "refs") {
        remoteRefSha = SHA("8");
      } else if (kind === "index") {
        writeFileSync(indexPath, "drifted-index-bytes\n");
      } else if (kind === "source") {
        treeSha = SHA("7");
      } else {
        throw new Error(`Unknown repository fixture drift: ${kind}`);
      }
    },
    cleanup() { rmSync(sandbox, { recursive: true, force: true }); },
  };
}

test("evidence and plan accept the same exact reviewed transition while live or dormant", () => {
  for (const cloudState of ["reviewed", "dormant-preserved"]) {
    const evidence = evidenceFixture({ cloudState });
    const plan = buildExpiredActiveDeviceReviewResponseLossPlan({ evidence });
    assert.deepEqual(normalizeExpiredActiveDeviceReviewResponseLossPlan(plan), plan);
    assert.equal(plan.evidence.cloud.claim.state, cloudState);
    assert.equal(plan.evidence.cloud.claim.transitionCounter, 4);
    assert.match(plan.exactAuthorization,
      /^authorize expired-active-device-review-response-loss [0-9a-f]{64}$/u);
    assert.deepEqual(plan.mutationPolicy,
      EXPIRED_ACTIVE_DEVICE_REVIEW_RESPONSE_LOSS_MUTATION_POLICY);
  }
});

test("plan drift matrix rejects every changed lease, task, cloud, provider, or source identity", () => {
  const mutations = [
    value => { value.worktree.clean = false; },
    value => { value.worktree.remoteRefSha = SHA("9"); },
    value => { value.sourceLease.expiresAt = "2026-08-27T13:00:00.000Z"; },
    value => { value.migration.targetBindingDigest = D("other-binding"); },
    value => { value.cloud.claim.transitionCounter = 5; },
    value => { value.cloud.competitorCount = 1; value.cloud.noOverlappingCompetitor = false; },
    value => { value.pullRequest.headSha = SHA("8"); },
    value => { value.pullRequest.sourceBody += "drift"; value.pullRequest.sourceBodyDigest = digestValue(value.pullRequest.sourceBody); },
    value => { value.projections.targetLease.reviewHeadSha = SHA("7"); value.projections.targetLeaseDigest = digestValue(value.projections.targetLease); },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(evidenceFixture());
    delete changed.evidenceDigest;
    mutate(changed);
    assert.throws(
      () => buildExpiredActiveDeviceReviewResponseLossPlan({ evidence: changed }),
      /invalid|binding/u,
    );
  }
});

test("cross-domain evidence cannot splice pull request B onto repository, lease, or worktree A", () => {
  const cases = [
    ["repository path", value => { value.repository.path = "/tmp/other-repository"; }],
    ["repository owner", value => { value.repository.nameWithOwner = "other/repository"; }],
    ["pull-request repository", value => {
      value.pullRequest.headRepository = "other/repository";
      refreshProviderProjection(value);
    }],
    ["pull-request branch", value => {
      value.pullRequest.headBranch = "agent/device.local/other-branch";
      refreshProviderProjection(value);
    }],
    ["pull-request head", value => {
      value.pullRequest.headSha = SHA("8");
      refreshProviderProjection(value);
    }],
    ["pull-request base", value => {
      value.pullRequest.baseSha = SHA("8");
      refreshProviderProjection(value);
    }],
    ["pull-request URL", value => {
      value.pullRequest.url = "https://provider.test/other/repository/pull/748";
      refreshProviderProjection(value);
    }],
    ["lease worktree", value => {
      value.sourceLease.worktreePath = "/tmp/other-repository";
      refreshSourceLeaseDerivedEvidence(value);
    }],
    ["lease pull-request URL", value => {
      value.sourceLease.pullRequestUrl = "https://provider.test/other/repository/pull/748";
      refreshSourceLeaseDerivedEvidence(value);
    }],
    ["source review head", value => {
      value.sourceLease.reviewHeadSha = HEAD;
      refreshSourceLeaseDerivedEvidence(value);
    }],
  ];
  for (const [label, mutate] of cases) {
    const changed = structuredClone(evidenceFixture());
    delete changed.evidenceDigest;
    mutate(changed);
    assert.throws(
      () => buildExpiredActiveDeviceReviewResponseLossPlan({ evidence: changed }),
      /cross-domain/u,
      label,
    );
  }
});

test("t3 source authority, provenance, and receipt mismatches fail closed", () => {
  const cases = [
    ["claim digest", authority => { authority.claimDigest = D("foreign-t3-claim"); }],
    ["ledger digest", authority => { authority.ledgerDigest = D("foreign-t3-ledger"); }],
    ["claim ledger revision", authority => {
      authority.claimLedgerRevision = D("foreign-t3-revision");
    }],
    ["entry schema", authority => {
      authority.entrySchema = "agentic-cloud-collaboration-entry/v1";
    }],
    ["claim identity schema", authority => {
      authority.claimIdentitySchema = "agentic-cloud-collaboration-entry/v1";
    }],
    ["operation receipt", authority => {
      authority.operationReceiptDigest = D("foreign-t3-operation-receipt");
    }],
    ["device provenance", authority => { authority.deviceId = "other.device"; }],
    ["session provenance", authority => { authority.sessionId = "other-session"; }],
    ["mutation authority", authority => { authority.mutationAuthorityEligible = false; }],
  ];
  for (const [label, mutate] of cases) {
    const changed = structuredClone(evidenceFixture());
    delete changed.evidenceDigest;
    mutate(changed.sourceLease.cloudAuthority);
    refreshSourceLeaseDerivedEvidence(changed);
    assert.throws(
      () => buildExpiredActiveDeviceReviewResponseLossPlan({ evidence: changed }),
      /source authority/u,
      label,
    );
  }
});

test("source local device and session cannot be substituted with matching cloud pseudonyms", () => {
  for (const [label, mutate] of [
    ["device", authority => { authority.deviceId = CLOUD_DEVICE_ID; }],
    ["session", authority => { authority.sessionId = CLOUD_SESSION_ID; }],
  ]) {
    const changed = structuredClone(evidenceFixture());
    delete changed.evidenceDigest;
    mutate(changed.sourceLease.cloudAuthority);
    refreshSourceLeaseDerivedEvidence(changed);
    assert.throws(
      () => buildExpiredActiveDeviceReviewResponseLossPlan({ evidence: changed }),
      /source authority/u,
      label,
    );
  }
});

test("target authority rejects every drift family after consistent lease and marker redigestion", () => {
  const cases = [
    ["provider", authority => { authority.provider = "gitlab"; }],
    ["ledger repository", authority => { authority.ledgerRepository = "other/ledger"; }],
    ["target repository", authority => { authority.targetRepository = "other/repository"; }],
    ["status ledger revision", authority => { authority.ledgerRevision = SHA("8"); }],
    ["status ledger digest", authority => { authority.ledgerDigest = D("other-status"); }],
    ["entry schema", authority => {
      authority.entrySchema = "agentic-cloud-collaboration-entry/v1";
    }],
    ["claim identity schema", authority => {
      authority.claimIdentitySchema = "agentic-cloud-collaboration-entry/v1";
    }],
    ["operation receipt", authority => {
      authority.operationReceiptDigest = D("other-reviewed-operation");
    }],
    ["mutation provenance", authority => { authority.mutationAuthorityEligible = false; }],
    ["canonical base", authority => { authority.canonicalBaseSha = SHA("8"); }],
    ["lane revision", authority => { authority.laneRevision = SHA("8"); }],
    ["cloud scope", authority => {
      authority.cloudDeclaredWriteScope = ["path:docs/other.md", "semantic:other"];
    }],
    ["write-set digest", authority => { authority.writeSetDigest = D("other-scope"); }],
    ["local device", authority => { authority.deviceId = CLOUD_DEVICE_ID; }],
    ["local session", authority => { authority.sessionId = CLOUD_SESSION_ID; }],
    ["review request", authority => {
      authority.reviewRequestId = "github-pull-request:PR_other";
    }],
    ["lease epoch", authority => { authority.leaseEpoch += 1; }],
    ["transition counter", authority => { authority.transitionCounter += 1; }],
    ["state", authority => { authority.state = "active"; }],
    ["expiry", authority => { authority.expiresAt = "2026-08-27T11:01:00.000Z"; }],
    ["integration", authority => {
      authority.integrationReceiptDigest = D("unexpected-integration");
    }],
    ["focused evidence", authority => {
      authority.focusedEvidenceDigest = D("other-focused-evidence");
    }],
    ["manifest", authority => { authority.manifestDigest = D("other-manifest"); }],
  ];
  for (const [label, mutate] of cases) {
    const changed = structuredClone(evidenceFixture());
    delete changed.evidenceDigest;
    mutate(changed.cloud.targetAuthority);
    refreshTargetAuthorityDerivedEvidence(changed);
    assert.throws(
      () => buildExpiredActiveDeviceReviewResponseLossPlan({ evidence: changed }),
      /target authority/u,
      label,
    );
  }
});

test("oversized target body fails preflight even with an exact recomputed digest", () => {
  const changed = structuredClone(evidenceFixture());
  delete changed.evidenceDigest;
  const { taskAuthority: _taskAuthority, ...sourceWithoutTaskAuthority } = changed.sourceLease;
  const sourceBase = updateWriterLeasePullRequestBody("", sourceWithoutTaskAuthority);
  const targetBase = updateWriterLeasePullRequestBody(
    sourceBase,
    changed.projections.targetLease,
  );
  const markerGrowth = Buffer.byteLength(targetBase) - Buffer.byteLength(sourceBase);
  assert.ok(markerGrowth > 1);
  const paddingLength = 65_536 - Buffer.byteLength(sourceBase) - Math.ceil(markerGrowth / 2);
  const sourceBody = updateWriterLeasePullRequestBody(
    "x".repeat(paddingLength),
    sourceWithoutTaskAuthority,
  );
  const targetBody = updateWriterLeasePullRequestBody(
    sourceBody,
    changed.projections.targetLease,
  );
  assert.ok(Buffer.byteLength(sourceBody) <= 65_536);
  assert.ok(Buffer.byteLength(targetBody) > 65_536);
  changed.pullRequest.sourceBody = sourceBody;
  changed.pullRequest.sourceBodyDigest = digestValue(sourceBody);
  changed.projections.targetBody = targetBody;
  changed.projections.targetBodyDigest = digestValue(targetBody);
  assert.throws(
    () => buildExpiredActiveDeviceReviewResponseLossPlan({ evidence: changed }),
    /target pull-request body provider bound/u,
  );
});

test("public reviewed claim must be the exact validated t4 projection except for time state", () => {
  const cases = [
    ["actor", claim => { claim.actorId = "provider-user:other"; }],
    ["device", claim => { claim.deviceId = "other.device"; }],
    ["session", claim => { claim.sessionId = "other-session"; }],
    ["repository", claim => { claim.repositoryId = "provider-repository:other"; }],
    ["work item", claim => { claim.workItemId = `work-item:${D("other-work-item")}`; }],
    ["expiry", claim => { claim.expiresAt = "2026-08-27T11:01:00.000Z"; }],
    ["operation receipt", claim => {
      claim.operationReceiptDigest = D("foreign-reviewed-operation-receipt");
    }],
    ["transition digest", claim => { claim.transitionDigest = D("foreign-t4-entry"); }],
    ["entry schema", claim => {
      claim.entrySchema = "agentic-cloud-collaboration-entry/v1";
    }],
    ["write authority", claim => { claim.writeAuthority = true; }],
    ["scope reservation", claim => { claim.scopeReserved = false; }],
  ];
  for (const [label, mutate] of cases) {
    const changed = structuredClone(evidenceFixture());
    delete changed.evidenceDigest;
    mutate(changed.cloud.claim);
    assert.throws(
      () => buildExpiredActiveDeviceReviewResponseLossPlan({ evidence: changed }),
      /public reviewed claim/u,
      label,
    );
  }
});

test("exact authorization and task capability precede the three bounded effects", async () => {
  const fixture = fakeAdapter();
  const controller = createExpiredActiveDeviceReviewResponseLossController(fixture.adapter);
  await assert.rejects(
    () => controller.run({ plan: fixture.plan, authorization: "authorize anything" }),
    /Exact authorization required/u,
  );
  assert.deepEqual(fixture.effects, {
    local: 0, marker: 0, ready: 0, cloud: 0, git: 0, source: 0, ref: 0, terminal: 0,
  });
  const receipt = await controller.run({
    plan: fixture.plan,
    authorization: fixture.plan.exactAuthorization,
  });
  assert.equal(receipt.status, "review-ready-projection-restored");
  assert.equal(receipt.reviewedTransitionCounter, 4);
  assert.deepEqual(fixture.effects, {
    local: 1, marker: 1, ready: 1, cloud: 0, git: 0, source: 0, ref: 0, terminal: 2,
  });
  assert.ok(fixture.calls.indexOf("task-proof") < fixture.calls.indexOf("effect:local"));
  assert.ok(fixture.calls.indexOf("effect:local") < fixture.calls.indexOf("effect:marker"));
  assert.ok(fixture.calls.indexOf("effect:marker") < fixture.calls.indexOf("effect:ready"));
  const persisted = fixture.intent();
  assert.deepEqual(Object.keys(persisted.phases).slice(-2), ["verified", "complete"]);
  assert.equal(persisted.phases.complete.values.verifiedReceiptDigest,
    persisted.phases.verified.receiptDigest);
  for (const field of ["cloudMutation", "claimMutation", "heartbeatMutation",
    "sourceMutation", "gitMutation", "remoteRefMutation", "mergeMutation",
    "integrationMutation", "releaseMutation", "deploymentMutation", "cleanupMutation"]) {
    assert.equal(receipt[field], false, field);
  }
});

test("a task proof for any other binding fails before local or provider mutation", async () => {
  const fixture = fakeAdapter();
  fixture.adapter.authorizeTask = async () => ({
    bindingDigest: D("foreign-binding"),
    taskAuthorityReceiptDigest: D("foreign-task-receipt"),
  });
  await assert.rejects(
    () => createExpiredActiveDeviceReviewResponseLossController(fixture.adapter)
      .run({ plan: fixture.plan, authorization: fixture.plan.exactAuthorization }),
    /task-authority evidence join/u,
  );
  assert.deepEqual(fixture.effects, {
    local: 0, marker: 0, ready: 0, cloud: 0, git: 0, source: 0, ref: 0, terminal: 0,
  });
});

test("local CAS, marker, and ready response loss adopt exact targets without repetition", async () => {
  for (const lostAt of ["local", "marker", "ready"]) {
    const fixture = fakeAdapter({ responseLoss: lostAt });
    const controller = createExpiredActiveDeviceReviewResponseLossController(fixture.adapter);
    const receipt = await controller.run({
      plan: fixture.plan,
      authorization: fixture.plan.exactAuthorization,
    });
    assert.equal(receipt[`${lostAt === "ready" ? "ready" : lostAt}Disposition`],
      "adopted-response-loss");
    assert.deepEqual(
      { local: fixture.effects.local, marker: fixture.effects.marker, ready: fixture.effects.ready },
      { local: 1, marker: 1, ready: 1 },
    );
    const replay = await controller.run({
      plan: fixture.plan,
      authorization: fixture.plan.exactAuthorization,
    });
    assert.equal(replay.receiptDigest, receipt.receiptDigest);
    assert.deepEqual(
      { local: fixture.effects.local, marker: fixture.effects.marker, ready: fixture.effects.ready },
      { local: 1, marker: 1, ready: 1 },
    );
    assert.equal(fixture.effects.cloud, 0);
  }
});

test("pre-existing exact local, marker, and ready targets are adopted with zero external mutation", async () => {
  const fixture = fakeAdapter({ initial: { local: "target", marker: "target", ready: "ready" } });
  const receipt = await createExpiredActiveDeviceReviewResponseLossController(fixture.adapter)
    .run({ plan: fixture.plan, authorization: fixture.plan.exactAuthorization });
  assert.deepEqual(
    [receipt.localDisposition, receipt.markerDisposition, receipt.readyDisposition],
    Array(3).fill("adopted-response-loss"),
  );
  assert.deepEqual(fixture.effects, {
    local: 0, marker: 0, ready: 0, cloud: 0, git: 0, source: 0, ref: 0, terminal: 2,
  });
});

test("terminal drift after durable verification blocks pure completion", async () => {
  const fixture = fakeAdapter({ terminalDriftOnReplay: true });
  await assert.rejects(
    () => createExpiredActiveDeviceReviewResponseLossController(fixture.adapter)
      .run({ plan: fixture.plan, authorization: fixture.plan.exactAuthorization }),
    /changed before completion/u,
  );
  assert.equal(fixture.intent().status, "verified");
  assert.equal(Object.hasOwn(fixture.intent().phases, "complete"), false);
  assert.deepEqual(
    { local: fixture.effects.local, marker: fixture.effects.marker, ready: fixture.effects.ready,
      cloud: fixture.effects.cloud },
    { local: 1, marker: 1, ready: 1, cloud: 0 },
  );
});

test("intent persistence adopts a landed response loss and requires exact readback", async () => {
  const landed = fakeAdapter({
    persistence: { status: "local-projected", mode: "lands-then-throws" },
  });
  const landedReceipt = await createExpiredActiveDeviceReviewResponseLossController(landed.adapter)
    .run({ plan: landed.plan, authorization: landed.plan.exactAuthorization });
  assert.equal(landedReceipt.status, "review-ready-projection-restored");
  assert.equal(landed.effects.local, 1);

  for (const mode of ["competing", "void-without-write"]) {
    const failed = fakeAdapter({ persistence: { status: "local-projected", mode } });
    await assert.rejects(
      () => createExpiredActiveDeviceReviewResponseLossController(failed.adapter)
        .run({ plan: failed.plan, authorization: failed.plan.exactAuthorization }),
      /intent|CAS|readback|invalid/u,
    );
    assert.equal(failed.effects.local, 1);
    assert.equal(failed.effects.marker, 0);
    assert.equal(failed.effects.ready, 0);
  }
});

test("a stored intent cannot be replayed under a different exact plan or authorization", async () => {
  const first = fakeAdapter();
  await createExpiredActiveDeviceReviewResponseLossController(first.adapter)
    .run({ plan: first.plan, authorization: first.plan.exactAuthorization });
  assert.deepEqual(normalizeExpiredActiveDeviceReviewResponseLossIntent(first.intent()),
    first.intent());
  const otherPlan = buildExpiredActiveDeviceReviewResponseLossPlan({
    evidence: evidenceFixture({ cloudState: "dormant-preserved" }),
  });
  const second = fakeAdapter({ evidence: otherPlan.evidence });
  second.setIntent(first.intent());
  await assert.rejects(
    () => createExpiredActiveDeviceReviewResponseLossController(second.adapter)
      .run({ plan: otherPlan, authorization: otherPlan.exactAuthorization }),
    /different exact authority/u,
  );
});

test("repository adapter executes exact local CAS, marker, and ready projections with zero cloud or Git writes", () => {
  const fixture = repositoryAdapterFixture();
  try {
    const plan = buildExpiredActiveDeviceReviewResponseLossPlan({
      evidence: fixture.adapter.readPlanEvidence(),
    });
    assert.equal(plan.evidence.projections.targetRegistryRevision, 12);
    assert.equal(fixture.adapter.authorizeTask(plan).bindingDigest,
      plan.evidence.migration.targetBindingDigest);
    const adopted = fixture.adapter.revalidate(plan, "adopt-reviewed-transition");
    assert.equal(adopted.cloudMutation, false);
    const local = fixture.adapter.projectLocalReviewReady(plan);
    assert.deepEqual([local.disposition, local.localMutation, local.registryRevision],
      ["projected", true, 12]);
    assert.equal(fixture.registry().leases[BRANCH].status, "review_ready");
    const marker = fixture.adapter.projectProviderMarker(plan);
    assert.deepEqual([marker.disposition, marker.providerMutation], ["projected", true]);
    assert.equal(fixture.body(), plan.evidence.projections.targetBody);
    const ready = fixture.adapter.markProviderReady(plan);
    assert.deepEqual([ready.disposition, ready.providerMutation], ["projected", true]);
    assert.equal(fixture.isDraft(), false);
    assert.deepEqual(fixture.adapter.verifyTerminal(plan), fixture.adapter.verifyTerminal(plan));
    assert.deepEqual(fixture.mutations,
      { marker: 1, ready: 1, cloud: 0, git: 0, source: 0, ref: 0 });
    assert.ok(fixture.calls.findIndex(value => value.startsWith("gh:pr edit"))
      < fixture.calls.findIndex(value => value.startsWith("gh:pr ready")));
    assert.equal(fixture.calls.filter(value => value.startsWith("cloud:"))
      .every(value => value === "cloud:status"), true);
  } finally {
    fixture.cleanup();
  }
});

test("adapter runtime subject rejects a valid plan sealed for another closure before any effect", async () => {
  const source = repositoryAdapterFixture();
  const other = repositoryAdapterFixture();
  try {
    const foreignPlan = buildExpiredActiveDeviceReviewResponseLossPlan({
      evidence: source.adapter.readPlanEvidence(),
    });
    const callsBefore = other.calls.length;
    for (const [method, argumentsList] of [
      ["assertRuntimeSubject", [foreignPlan]],
      ["authorizeTask", [foreignPlan]],
      ["revalidate", [foreignPlan, "before-authority"]],
      ["projectLocalReviewReady", [foreignPlan]],
      ["projectProviderMarker", [foreignPlan]],
      ["markProviderReady", [foreignPlan]],
      ["verifyTerminal", [foreignPlan]],
    ]) {
      assert.throws(
        () => other.adapter[method](...argumentsList),
        /adapter runtime subject/u,
        method,
      );
    }
    assert.equal(other.calls.length, callsBefore);
    assert.equal(existsSync(other.adapter.journalPath), false);
    await assert.rejects(
      () => createExpiredActiveDeviceReviewResponseLossController(other.adapter).run({
        plan: foreignPlan,
        authorization: foreignPlan.exactAuthorization,
      }),
      /adapter runtime subject/u,
    );
    assert.equal(existsSync(other.adapter.journalPath), false);
    assert.equal(other.calls.includes("task-proof"), false);
    assert.equal(other.registry().revision, 11);
    assert.deepEqual(other.mutations,
      { marker: 0, ready: 0, cloud: 0, git: 0, source: 0, ref: 0 });
  } finally {
    source.cleanup();
    other.cleanup();
  }
});

test("repository adapter adopts provider marker and ready response loss without a second call", () => {
  for (const lostAt of ["marker", "ready"]) {
    const fixture = repositoryAdapterFixture({ responseLoss: lostAt });
    try {
      const plan = buildExpiredActiveDeviceReviewResponseLossPlan({
        evidence: fixture.adapter.readPlanEvidence(),
      });
      fixture.adapter.projectLocalReviewReady(plan);
      if (lostAt === "marker") {
        assert.throws(() => fixture.adapter.projectProviderMarker(plan), /response lost/u);
        const adopted = fixture.adapter.revalidate(plan, "adopt-marker");
        assert.deepEqual([adopted.disposition, adopted.providerMutation, adopted.markerProjected],
          ["adopted-response-loss", false, true]);
        fixture.adapter.markProviderReady(plan);
      } else {
        fixture.adapter.projectProviderMarker(plan);
        assert.throws(() => fixture.adapter.markProviderReady(plan), /response lost/u);
        const adopted = fixture.adapter.revalidate(plan, "adopt-ready");
        assert.deepEqual([adopted.disposition, adopted.providerMutation, adopted.providerReady],
          ["adopted-response-loss", false, true]);
      }
      assert.doesNotThrow(() => fixture.adapter.verifyTerminal(plan));
      assert.equal(fixture.mutations[lostAt], 1);
      assert.deepEqual(
        { cloud: fixture.mutations.cloud, git: fixture.mutations.git,
          source: fixture.mutations.source, ref: fixture.mutations.ref },
        { cloud: 0, git: 0, source: 0, ref: 0 },
      );
    } finally {
      fixture.cleanup();
    }
  }
});

test("historical t3 ledger proof rejects a wrong revision, head, or latest source entry", () => {
  const wrongRevision = structuredClone(evidenceFixture());
  delete wrongRevision.evidenceDigest;
  wrongRevision.cloud.ledgerValidation.sourceLedgerRevision = SHA("8");
  wrongRevision.cloud.ledgerValidationDigest = digestValue(
    wrongRevision.cloud.ledgerValidation,
  );
  assert.throws(
    () => buildExpiredActiveDeviceReviewResponseLossPlan({ evidence: wrongRevision }),
    /source authority/u,
  );

  for (const mode of ["wrong-head", "pre-source", "current-as-source"]) {
    const fixture = repositoryAdapterFixture();
    try {
      fixture.setHistoricalLedgerMode(mode);
      assert.throws(
        () => fixture.adapter.readPlanEvidence(),
        /historical cloud ledger validation|source authority historical ledger provenance/u,
        mode,
      );
      assert.deepEqual(fixture.mutations,
        { marker: 0, ready: 0, cloud: 0, git: 0, source: 0, ref: 0 }, mode);
      assert.equal(fixture.registry().revision, 11, mode);
    } finally {
      fixture.cleanup();
    }
  }
});

test("an atomically appearing branch-controller intent fences local CAS before projection", () => {
  for (const mapName of [
    "scopeExpansionIntents",
    "activeOwnedDirtRecoveryIntents",
    "expiredCommittedScopeExpansionIntents",
    "reviewedLaneRevisionIntents",
    "reviewedLaneEntrypointFences",
  ]) {
    const fixture = repositoryAdapterFixture();
    try {
      const plan = buildExpiredActiveDeviceReviewResponseLossPlan({
        evidence: fixture.adapter.readPlanEvidence(),
      });
      fixture.armCompetingBranchIntent(mapName);
      assert.throws(
        () => fixture.adapter.projectLocalReviewReady(plan),
        /competing branch controller intent or fence/u,
        mapName,
      );
      const current = fixture.registry();
      assert.equal(current.revision, 12, mapName);
      assert.deepEqual(current.leases[BRANCH], plan.evidence.sourceLease, mapName);
      assert.deepEqual(fixture.mutations,
        { marker: 0, ready: 0, cloud: 0, git: 0, source: 0, ref: 0 }, mapName);
    } finally {
      fixture.cleanup();
    }
  }
});

test("repository journal and lock enforce live ownership, dead-owner recovery, and private modes", async () => {
  const live = repositoryAdapterFixture({ isProcessAlive: () => true });
  try {
    await assert.rejects(
      () => live.adapter.withOperationLock(
        () => live.adapter.withOperationLock(() => "unreachable"),
      ),
      /already in progress/u,
    );
    assert.equal(existsSync(`${live.adapter.journalPath}.lock`), false);
  } finally {
    live.cleanup();
  }

  const dead = repositoryAdapterFixture({ isProcessAlive: () => false });
  try {
    const journalDirectory = path.dirname(dead.adapter.journalPath);
    mkdirSync(journalDirectory, { recursive: true, mode: 0o700 });
    chmodSync(journalDirectory, 0o700);
    const repository = path.dirname(dead.adapter.gitCommonDir);
    const operationId = digestValue({ repository, branch: BRANCH, pullRequestNumber: 748 });
    const lockPath = `${dead.adapter.journalPath}.lock`;
    writeFileSync(lockPath, `${JSON.stringify({
      schema: "agentic-expired-active-device-review-response-loss-lock/v1",
      operationId,
      pid: 999_999,
      token: "dead-fixture-owner",
    })}\n`, { mode: 0o600 });
    chmodSync(lockPath, 0o600);
    assert.equal(await dead.adapter.withOperationLock(() => "recovered"), "recovered");
    assert.equal(existsSync(lockPath), false);
  } finally {
    dead.cleanup();
  }

  const privateMode = repositoryAdapterFixture();
  try {
    const journalDirectory = path.dirname(privateMode.adapter.journalPath);
    mkdirSync(journalDirectory, { recursive: true, mode: 0o755 });
    chmodSync(journalDirectory, 0o755);
    await assert.rejects(
      () => privateMode.adapter.withOperationLock(() => "unreachable"),
      /journal (?:leaf )?directory/u,
    );
    chmodSync(journalDirectory, 0o700);
    writeFileSync(privateMode.adapter.journalPath, "{}\n", { mode: 0o644 });
    chmodSync(privateMode.adapter.journalPath, 0o644);
    assert.throws(
      () => privateMode.adapter.readIntent(),
      /bounded 0600 regular file/u,
    );
  } finally {
    privateMode.cleanup();
  }
});

test("repository terminal verification rereads and rejects ledger, registry, PR, ref, index, or source drift", () => {
  for (const kind of ["ledger", "registry", "pr", "refs", "index", "source"]) {
    const fixture = repositoryAdapterFixture();
    try {
      const plan = buildExpiredActiveDeviceReviewResponseLossPlan({
        evidence: fixture.adapter.readPlanEvidence(),
      });
      fixture.adapter.projectLocalReviewReady(plan);
      fixture.adapter.projectProviderMarker(plan);
      fixture.adapter.markProviderReady(plan);
      fixture.setDrift(kind);
      assert.throws(
        () => fixture.adapter.verifyTerminal(plan),
        /invalid|changed|drift|neither|exact/u,
        kind,
      );
      assert.deepEqual(fixture.mutations,
        { marker: 1, ready: 1, cloud: 0, git: 0, source: 0, ref: 0 });
    } finally {
      fixture.cleanup();
    }
  }
});

test("authorization receipt is plan-digest bound", () => {
  const plan = buildExpiredActiveDeviceReviewResponseLossPlan({ evidence: evidenceFixture() });
  const receipt = authorizeExpiredActiveDeviceReviewResponseLoss(plan, plan.exactAuthorization);
  assert.equal(receipt.planDigest, plan.planDigest);
  assert.equal(receipt.evidenceDigest, plan.evidence.evidenceDigest);
  assert.throws(
    () => authorizeExpiredActiveDeviceReviewResponseLoss(plan,
      `${plan.exactAuthorization}-changed`),
    /Exact authorization required/u,
  );
});
