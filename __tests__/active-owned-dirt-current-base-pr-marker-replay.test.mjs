import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
}
  from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  EVIDENCE_SCHEMA,
  PHASES,
  advanceActiveOwnedDirtCurrentBasePrMarkerReplayIntent,
  authorizeActiveOwnedDirtCurrentBasePrMarkerReplay,
  buildActiveOwnedDirtCurrentBasePrMarkerReplayPlan,
  createActiveOwnedDirtCurrentBasePrMarkerReplayIntent,
  normalizeActiveOwnedDirtCurrentBasePrMarkerReplayIntent,
  normalizeActiveOwnedDirtCurrentBasePrMarkerReplayPlan,
} from "../scripts/active-owned-dirt-current-base-pr-marker-replay-contract.mjs";
import {
  PHASES as REANCHOR_PHASES,
  advanceReanchorIntent,
  buildReanchorPlan,
  createReanchorIntent,
} from "../scripts/active-owned-dirt-current-base-reanchor-contract.mjs";
import { createRepositoryActiveOwnedDirtCurrentBasePrMarkerReplayAdapter }
  from "../scripts/active-owned-dirt-current-base-pr-marker-replay-repository-adapter.mjs";
import { runActiveOwnedDirtCurrentBasePrMarkerReplayCli }
  from "../scripts/active-owned-dirt-current-base-pr-marker-replay.mjs";
import { createActiveOwnedDirtCurrentBasePrMarkerReplayController }
  from "../scripts/active-owned-dirt-current-base-pr-marker-replay-controller.mjs";
import { digestValue, normalizeWriteSet }
  from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier }
  from "../scripts/github-cloud-collaboration-mapping.mjs";
import { writerLeaseBodyRemainder }
  from "../scripts/orphaned-task-authority-recovery-evidence.mjs";
import {
  createTaskAuthorityBinding,
  createTaskAuthorityCapability,
} from "../scripts/task-bound-lane-authority-contract.mjs";
import {
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "../scripts/writer-lease-lib.mjs";
import { writerLeaseDigest }
  from "../scripts/writer-lease-registry-cas.mjs";

const AT = "2026-08-31T00:00:00.000Z";
const EXPIRY = "2026-08-31T00:10:00.000Z";
const BRANCH = "agent/device/active-dirt-marker-replay-order";
const REPOSITORY = "huijoohwee/agentic-canvas-os";
const HEAD = oid("target-head");
const BASE = oid("target-base");

function hex(label) {
  return digestValue(label);
}

function oid(label) {
  return digestValue(label).slice(0, 40);
}

function mutationBoundary() {
  return {
    pullRequestWriterMarker: true,
    externalPrivateRecoveryJournal: true,
    cloud: false,
    writerRegistry: false,
    git: false,
    remoteRef: false,
    source: false,
    pullRequestSubject: false,
    pullRequestDraft: false,
    pullRequestAutoMerge: false,
    authoringAuthority: false,
    integrationAuthority: false,
    release: false,
    deployment: false,
    cleanup: false,
  };
}

function evidenceFixture(overrides = {}) {
  const core = {
    schema: EVIDENCE_SCHEMA,
    observedAt: AT,
    repositoryPathDigest: hex("repository-path"),
    reanchorPlanDigest: hex("reanchor-plan"),
    reanchorIntentDigest: hex("reanchor-intent"),
    reanchorPrProjectedReceiptDigest: hex("reanchor-pr-projected"),
    reanchorJournalPhase: "pr-projected",
    branch: BRANCH,
    sessionId: "active-dirt-marker-replay-order-20260831",
    device: "device",
    scope: "active-dirt-marker-replay-order",
    pullRequestId: "PR_kwDO_marker_replay",
    pullRequestUrl: `https://github.com/${REPOSITORY}/pull/818`,
    pullRequestNumber: 818,
    targetRepository: REPOSITORY,
    headSha: HEAD,
    baseSha: BASE,
    bodyRemainderDigest: hex("body-remainder"),
    sourceBodyDigest: hex("source-body"),
    sourceMarkerDigest: hex("source-marker"),
    sourceMarkerDisposition: "journaled",
    targetBodyDigest: hex("target-body"),
    targetMarkerDigest: hex("target-marker"),
    targetLeaseDigest: hex("target-lease"),
    targetClaimId: hex("target-claim"),
    targetClaimDigest: hex("target-claim-digest"),
    targetTransitionCounter: 4,
    targetLeaseEpoch: 325,
    targetLeaseExpiresAt: EXPIRY,
    targetTaskBindingDigest: hex("target-task-binding"),
    targetManifestDigest: hex("target-manifest"),
    targetWriteSetDigest: hex("target-write-set"),
    dirtEvidenceDigest: hex("dirt-evidence"),
    dirtyPathCount: 6,
    providerSemantics: "github-cooperative-body-projection/v1",
    mutationBoundary: mutationBoundary(),
    ...structuredClone(overrides),
  };
  return Object.freeze({ ...core, evidenceDigest: digestValue(core) });
}

function planFixture(overrides = {}) {
  return buildActiveOwnedDirtCurrentBasePrMarkerReplayPlan({
    evidence: evidenceFixture(overrides),
    ttlSeconds: 300,
  });
}

function controllerFixture({
  providerDisposition = "projected",
  failAt = null,
} = {}) {
  const state = {
    intent: null,
    calls: [],
    providerMutations: 0,
    cloudMutations: 0,
    registryMutations: 0,
    gitMutations: 0,
    remoteRefMutations: 0,
    sourceMutations: 0,
  };
  const fail = phase => {
    if (failAt === phase) throw new Error(`rejected ${phase}`);
  };
  const adapter = {
    async readPlanEvidence() {
      state.calls.push("read-plan");
      return evidenceFixture();
    },
    async withOperationLock(action) {
      state.calls.push("lock");
      return action();
    },
    async readIntent() {
      state.calls.push("read-intent");
      return state.intent;
    },
    async writeIntent({ expected, value }) {
      assert.equal(expected, state.intent);
      state.intent = value;
      state.calls.push(`write:${value.phase}`);
    },
    async authorizeTask(plan) {
      state.calls.push("authorize-task");
      fail("task-authority");
      return {
        taskAuthorityReceiptDigest: hex("task-authority-receipt"),
        bindingDigest: plan.targetTaskBindingDigest,
      };
    },
    async revalidate(_plan, phase) {
      state.calls.push(`revalidate:${phase}`);
      fail(phase);
      if (phase === "after-provider-error") {
        return {
          providerProjected: true,
          disposition: "adopted-response-loss",
          providerMutation: false,
          projectionDigest: hex("target-provider-projection"),
        };
      }
      return {
        revalidationDigest: hex("provider-revalidation"),
        providerState: providerDisposition === "already-current" ? "target" : "journaled",
      };
    },
    async projectProviderBody() {
      state.calls.push("project-provider");
      fail("provider");
      const providerMutation = providerDisposition === "projected";
      state.providerMutations += Number(providerMutation);
      return {
        disposition: providerDisposition,
        providerMutation,
        projectionDigest: hex("target-provider-projection"),
      };
    },
    async verifyTerminal() {
      state.calls.push("verify-terminal");
      fail("terminal");
      return { verificationDigest: hex("terminal-verification") };
    },
  };
  return { adapter, state };
}

function sealDirt(value) {
  const entries = value.entries.map(entry => ({ ...entry }))
    .sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  const core = {
    schema: "agentic-active-owned-dirt-evidence/v1",
    headSha: value.headSha,
    entries,
    pathCount: entries.length,
    stagedPathCount: entries.filter(entry => entry.staged).length,
    unstagedPathCount: entries.filter(entry => entry.unstaged).length,
    untrackedPathCount: entries.filter(entry => entry.untracked).length,
  };
  return { ...core, evidenceDigest: digestValue(core) };
}

function reanchorEvidenceFixture(repository) {
  const sourceBaseSha = oid("adapter-source-base");
  const sourceFenceSha = oid("adapter-source-fence");
  const protectedMainSha = oid("adapter-protected-main");
  const coordinationSha = oid("adapter-coordination");
  const sourceTreeSha = oid("adapter-source-tree");
  const targetTreeSha = oid("adapter-target-tree");
  const device = "device";
  const scope = "active-dirt-marker-replay-order";
  const branch = `agent/${device}/${scope}`;
  const sessionId = "active-dirt-marker-replay-order-20260831";
  const pullRequestId = "PR_kwDO_marker_replay";
  const pullRequestUrl = `https://github.com/${REPOSITORY}/pull/818`;
  const reviewRequestId = `github-pull-request:${pullRequestId}`;
  const declaredWriteSet = normalizeWriteSet([
    "path:owned",
    "semantic:active-dirt-marker-replay-order",
  ]);
  const writeSetDigest = digestValue(declaredWriteSet);
  const admission = {
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: scope,
    declaredWriteSet,
    writeSetDigest,
    manifestDigest: hex("adapter-manifest"),
    planReceiptDigest: hex("adapter-source-plan-receipt"),
    admissionReceiptDigest: hex("adapter-admission-receipt"),
    existingLaneStateDigest: hex("adapter-existing-lanes"),
    admittedReportDigest: hex("adapter-admitted-report"),
    preservationReceiptDigest: hex("adapter-preservation-receipt"),
  };
  const sourceClaimId = hex("adapter-source-claim");
  const sourceClaimDigest = hex("adapter-source-claim-digest");
  const activeOwnedDirtRecoveryPlanDigest =
    hex("adapter-active-owned-dirt-recovery-plan");
  const activeOwnedDirtRecovery = {
    schema: "agentic-active-owned-dirt-recovery-lease/v1",
    status: "recovered",
    sourceEpoch: 324,
    sourceSessionId: sessionId,
    sourceDevice: device,
    sourceBranch: branch,
    sourceFenceSha,
    sourceClaimId,
    planDigest: activeOwnedDirtRecoveryPlanDigest,
    evidenceDigest: hex("adapter-active-owned-dirt-recovery-evidence"),
    snapshotReceiptDigest: hex("adapter-active-owned-dirt-recovery-snapshot"),
    snapshotRef: `refs/agentic-canvas-os/recovery/active-owned-dirt/${sourceClaimId}/${activeOwnedDirtRecoveryPlanDigest}`,
    snapshotCommitSha: oid("adapter-active-owned-dirt-snapshot"),
    snapshotIndexCommitSha: oid("adapter-active-owned-dirt-index-snapshot"),
    recoveredClaimDigest: sourceClaimDigest,
    recoveredLedgerRevision: oid("adapter-active-owned-dirt-ledger"),
    recoveredClaimLedgerRevision: hex("adapter-active-owned-dirt-claim-ledger"),
    recoveredTransitionCounter: 3,
    recoveredAt: "2026-08-30T22:59:00.000Z",
  };
  const leaseCore = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 325,
    branch,
    sessionId,
    device,
    scope,
    worktreePath: repository,
    baseSha: sourceBaseSha,
    fenceSha: sourceFenceSha,
    expiresAt: EXPIRY,
    pullRequestUrl,
    admission,
    cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1",
      provider: "github",
      ledgerRepository: REPOSITORY,
      state: "active",
      targetRepository: REPOSITORY,
      claimId: sourceClaimId,
      claimDigest: sourceClaimDigest,
      ledgerRevision: oid("adapter-source-ledger-revision"),
      ledgerDigest: hex("adapter-source-ledger"),
      claimLedgerRevision: hex("adapter-source-claim-ledger"),
      entrySchema: "agentic-cloud-collaboration-entry/v2",
      claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
      operationReceiptDigest: hex("adapter-source-operation"),
      mutationAuthorityEligible: true,
      canonicalBaseSha: sourceBaseSha,
      laneRevision: sourceFenceSha,
      cloudDeclaredWriteScope: declaredWriteSet,
      writeSetDigest,
      deviceId: device,
      sessionId,
      reviewRequestId,
      leaseEpoch: 7,
      transitionCounter: 3,
      expiresAt: EXPIRY,
      integrationReceiptDigest: null,
      integration: null,
      manifestDigest: admission.manifestDigest,
    },
    activeOwnedDirtRecovery,
  };
  const sourceCapability = createTaskAuthorityCapability({
    authoritySubjectId: `urn:agentic-task:${hex("adapter-source-authority")}`,
    generation: 1,
    issuedAt: "2026-08-30T23:00:00.000Z",
  });
  const lease = {
    ...leaseCore,
    taskAuthority: createTaskAuthorityBinding({
      capability: sourceCapability,
      lease: leaseCore,
      boundAt: "2026-08-30T23:00:00.000Z",
    }),
  };
  const markerBody = updateWriterLeasePullRequestBody("Fixture body.", lease);
  const dirt = sealDirt({
    headSha: sourceFenceSha,
    entries: [{
      path: "owned/new.txt",
      staged: false,
      unstaged: false,
      untracked: true,
      headMode: null,
      headBlob: null,
      indexMode: null,
      indexBlob: null,
      worktreeType: "file",
      worktreeMode: "100644",
      worktreeBlob: oid("adapter-untracked-blob"),
    }],
  });
  const targetDirt = sealDirt({
    headSha: coordinationSha,
    entries: dirt.entries,
  });
  const matchingClaims = [{
    claimId: sourceClaimId,
    leaseEpoch: 7,
    transitionCounter: 3,
    transitionDigest: hex("adapter-source-transition"),
    state: "current",
  }];
  const epochCore = {
    schema: "agentic-active-owned-dirt-current-base-reanchor-target-epoch-proof/v1",
    ledgerRevision: oid("adapter-epoch-ledger-revision"),
    ledgerDigest: hex("adapter-epoch-ledger-digest"),
    ledgerSequence: 42,
    ledgerEntriesDigest: hex("adapter-epoch-ledger-entries"),
    repositoryId: REPOSITORY,
    workItemId: pseudonymousIdentifier("work-item", scope),
    writeSetDigest,
    matchingClaims,
    matchingClaimsDigest: digestValue(matchingClaims),
    maximumHistoricalLeaseEpoch: 7,
    targetCloudLeaseEpoch: 8,
  };
  const remoteUrl = `git@github.com:${REPOSITORY}.git`;
  const identityCore = {
    schema: "agentic-retired-abandoned-owned-dirt-repository-identity-witness/v1",
    targetRepository: REPOSITORY,
    originFetchUrl: remoteUrl,
    originFetchRepository: REPOSITORY,
    originPushUrl: remoteUrl,
    originPushRepository: REPOSITORY,
    pullRequestUrl,
    pullRequestRepository: REPOSITORY,
    headRepository: REPOSITORY,
    baseRepository: REPOSITORY,
    headRefName: branch,
    baseRefName: "main",
  };
  const protectedPaths = ["upstream.txt"];
  const core = {
    schema: "agentic-active-owned-dirt-current-base-reanchor-evidence/v1",
    operationAt: AT,
    lease,
    leaseDigest: digestValue(lease),
    sourceClaim: {
      claimId: sourceClaimId,
      fenceRevision: sourceClaimDigest,
      repositoryId: REPOSITORY,
      actorId: "github-user:123",
      workItemId: pseudonymousIdentifier("work-item", scope),
      canonicalBaseRevision: sourceBaseSha,
      laneRevision: sourceFenceSha,
      declaredWriteScope: declaredWriteSet,
      state: "active",
      writeAuthority: true,
      reviewRequestId,
      writeSetDigest,
      leaseEpoch: 7,
      transitionCounter: 3,
      transitionDigest: hex("adapter-source-transition"),
      operationReceiptDigest: hex("adapter-source-operation"),
      expiresAt: EXPIRY,
      predecessorClaimId: null,
      deviceId: pseudonymousIdentifier("device", device),
      sessionId: pseudonymousIdentifier("session", sessionId),
    },
    targetEpochProof: { ...epochCore, proofDigest: digestValue(epochCore) },
    sourceFence: {
      headSha: sourceFenceSha,
      parentSha: sourceBaseSha,
      treeSha: sourceTreeSha,
      baseTreeSha: sourceTreeSha,
    },
    targetProtectedMain: {
      sourceBaseSha,
      protectedMainSha,
      mergeBaseSha: sourceBaseSha,
      ancestryVerified: true,
      localMainSha: protectedMainSha,
      localOriginMainSha: protectedMainSha,
      remoteMainSha: protectedMainSha,
      treeSha: targetTreeSha,
      changedPaths: protectedPaths,
      changedPathsDigest: digestValue(protectedPaths),
      dirtyOverlapPaths: [],
      dirtyOverlapPathsDigest: digestValue([]),
    },
    pullRequest: {
      id: pullRequestId,
      url: pullRequestUrl,
      number: 818,
      state: "OPEN",
      isDraft: true,
      headSha: sourceFenceSha,
      baseSha: sourceBaseSha,
      autoMerge: null,
      bodyDigest: digestValue(markerBody),
      bodyRemainderDigest: digestValue(writerLeaseBodyRemainder(markerBody)),
      bodyByteLength: Buffer.byteLength(markerBody),
      targetMarkerGrowthReserveBytes: 16_384,
      targetBodyLimitBytes: 65_536,
      headRepository: REPOSITORY,
    },
    repositoryIdentity: { ...identityCore, identityDigest: digestValue(identityCore) },
    dirt,
    ignoredRetention: [],
    reanchor: {
      coordination: {
        commitSha: coordinationSha,
        treeSha: targetTreeSha,
        parents: [sourceFenceSha, protectedMainSha],
      },
      sourceIndexTreeSha: oid("adapter-source-index-tree"),
      sourceWorktreeTreeSha: oid("adapter-source-worktree-tree"),
      targetIndexTreeSha: oid("adapter-target-index-tree"),
      targetWorktreeTreeSha: oid("adapter-target-worktree-tree"),
      targetDirt,
      dispositions: [{
        path: "owned/new.txt",
        base: { mode: null, blob: null },
        protected: { mode: null, blob: null },
        sourceIndex: { mode: null, blob: null },
        sourceWorktree: {
          type: "file", mode: "100644", blob: oid("adapter-untracked-blob"),
        },
        targetIndex: { mode: null, blob: null },
        targetWorktree: {
          type: "file", mode: "100644", blob: oid("adapter-untracked-blob"),
        },
        indexDisposition: "protected",
        worktreeDisposition: "source",
      }],
      ignoredRetention: [],
    },
    overlapClaimIds: [],
    controllerRevision: oid("adapter-controller"),
  };
  return { evidence: { ...core, evidenceDigest: digestValue(core) }, sourceCapability };
}

function repositoryAdapterFixture(t, { rejectTaskAuthority = false } = {}) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "marker-replay-adapter-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository");
  const commonDirectory = path.join(root, "git-common");
  const siblingDirectory = path.join(root, "sibling-worktree");
  const privateRoot = path.join(root, "private");
  for (const directory of [
    repository,
    commonDirectory,
    siblingDirectory,
    privateRoot,
  ]) {
    mkdirSync(directory, { mode: 0o700 });
    chmodSync(directory, 0o700);
  }
  const source = reanchorEvidenceFixture(repository);
  const reanchorPlan = buildReanchorPlan({ evidence: source.evidence, ttlSeconds: 600 });
  const successorClaimId = hex("adapter-successor-claim");
  const successorTransitionCounter = 4;
  const taskContinuationReceiptDigest = hex("adapter-task-continuation");
  const targetAuthority = {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: reanchorPlan.evidence.lease.cloudAuthority.ledgerRepository,
    targetRepository: REPOSITORY,
    claimId: successorClaimId,
    claimDigest: hex("adapter-target-claim-digest"),
    ledgerRevision: oid("adapter-target-ledger-revision"),
    ledgerDigest: hex("adapter-target-ledger"),
    claimLedgerRevision: hex("adapter-target-claim-ledger"),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: hex("adapter-target-operation"),
    mutationAuthorityEligible: true,
    canonicalBaseSha: reanchorPlan.targetCanonicalBaseSha,
    laneRevision: reanchorPlan.targetLaneRevision,
    cloudDeclaredWriteScope: reanchorPlan.targetDeclaredWriteSet,
    writeSetDigest: reanchorPlan.targetWriteSetDigest,
    deviceId: reanchorPlan.device,
    sessionId: reanchorPlan.sessionId,
    reviewRequestId: reanchorPlan.evidence.sourceClaim.reviewRequestId,
    leaseEpoch: reanchorPlan.targetCloudLeaseEpoch,
    transitionCounter: successorTransitionCounter,
    state: "active",
    expiresAt: EXPIRY,
    integrationReceiptDigest: null,
    integration: null,
    manifestDigest: reanchorPlan.targetManifestDigest,
  };
  const targetLeaseCore = {
    ...structuredClone(reanchorPlan.evidence.lease),
    worktreePath: repository,
    baseSha: reanchorPlan.targetCanonicalBaseSha,
    fenceSha: reanchorPlan.targetLaneRevision,
    heartbeatAt: AT,
    expiresAt: EXPIRY,
    admission: {
      ...structuredClone(reanchorPlan.evidence.lease.admission),
      planReceiptDigest: reanchorPlan.planDigest,
    },
    cloudAuthority: targetAuthority,
    activeOwnedDirtCurrentBaseReanchor: {
      schema: "agentic-active-owned-dirt-current-base-reanchor-lease/v1",
      status: "reanchored",
      planDigest: reanchorPlan.planDigest,
      sourceClaimId: reanchorPlan.sourceClaimId,
      successorClaimId,
      sourceBaseSha: reanchorPlan.sourceBaseSha,
      sourceFenceSha: reanchorPlan.sourceFenceSha,
      targetCanonicalBaseSha: reanchorPlan.targetCanonicalBaseSha,
      targetLaneRevision: reanchorPlan.targetLaneRevision,
      targetDirtEvidenceDigest: reanchorPlan.targetDirtEvidenceDigest,
      taskContinuationReceiptDigest,
    },
  };
  const targetCapability = createTaskAuthorityCapability({
    authoritySubjectId: reanchorPlan.evidence.lease.taskAuthority.authoritySubjectId,
    generation: 2,
    issuedAt: "2026-08-30T23:30:00.000Z",
  });
  const targetBinding = createTaskAuthorityBinding({
    capability: targetCapability,
    lease: targetLeaseCore,
    bindingMode: "continuation",
    boundAt: "2026-08-30T23:30:00.000Z",
    priorBindingDigest: reanchorPlan.sourceTaskBindingDigest,
  });
  const state = {
    lease: { ...targetLeaseCore, taskAuthority: targetBinding },
    body: null,
    pullOverrides: {},
    providerEdits: 0,
    registryWrites: 0,
    cloudWrites: 0,
    gitWrites: 0,
    refWrites: 0,
    sourceWrites: 0,
  };
  const staleLease = structuredClone(state.lease);
  staleLease.heartbeatAt = "2026-08-30T23:59:00.000Z";
  staleLease.expiresAt = "2026-08-31T00:06:00.000Z";
  staleLease.cloudAuthority.expiresAt = staleLease.expiresAt;
  staleLease.cloudAuthority.transitionCounter = 3;
  staleLease.cloudAuthority.claimDigest = hex("adapter-stale-claim-digest");
  staleLease.cloudAuthority.operationReceiptDigest = hex("adapter-stale-operation");
  state.body = updateWriterLeasePullRequestBody("Fixture body.", staleLease);
  const staleMarkerDigest = digestValue(projectWriterLeasePullRequestMarker(staleLease));

  let reanchorIntent = createReanchorIntent(reanchorPlan, reanchorPlan.exactAuthorization);
  for (const phase of REANCHOR_PHASES.slice(1)) {
    if (phase === "verified" || phase === "complete") break;
    let values = { receiptDigest: hex(`adapter-${phase}`) };
    if (phase === "successor-bound") values = {
      ...values,
      authority: structuredClone(targetAuthority),
    };
    if (phase === "successor-current") values = {
      ...values, claimId: successorClaimId, transitionCounter: successorTransitionCounter,
    };
    if (phase === "local-cas") values = {
      ...values,
      taskBindingDigest: targetBinding.bindingDigest,
      taskContinuationReceiptDigest,
    };
    if (phase === "pr-projected") values = {
      kind: "pr-projected",
      pullRequestId: reanchorPlan.pullRequestId,
      headSha: reanchorPlan.targetLaneRevision,
      baseSha: reanchorPlan.targetCanonicalBaseSha,
      bodyRemainderDigest: reanchorPlan.pullRequestBodyRemainderDigest,
      markerDigest: staleMarkerDigest,
    };
    reanchorIntent = advanceReanchorIntent(reanchorIntent, { phase, values });
  }
  const successor = reanchorIntent.receipts["successor-current"].values;
  const localCas = reanchorIntent.receipts["local-cas"].values;
  const fixtureJoins = {
    schema: state.lease.schema === "agentic-writer-lease/v2",
    status: state.lease.status === "active",
    branch: state.lease.branch === reanchorPlan.branch,
    session: state.lease.sessionId === reanchorPlan.sessionId,
    device: state.lease.device === reanchorPlan.device,
    scope: state.lease.scope === reanchorPlan.scope,
    worktree: path.resolve(state.lease.worktreePath || "") === repository,
    base: state.lease.baseSha === reanchorPlan.targetCanonicalBaseSha,
    fence: state.lease.fenceSha === reanchorPlan.targetLaneRevision,
    pullRequest: state.lease.pullRequestUrl === reanchorPlan.pullRequestUrl,
    admitted: state.lease.admission.status === "admitted",
    manifest: state.lease.admission.manifestDigest === reanchorPlan.targetManifestDigest,
    writeSet: state.lease.admission.writeSetDigest === reanchorPlan.targetWriteSetDigest,
    declaredWriteSet: JSON.stringify(state.lease.admission.declaredWriteSet)
      === JSON.stringify(reanchorPlan.targetDeclaredWriteSet),
    admissionPlan: state.lease.admission.planReceiptDigest === reanchorPlan.planDigest,
    cloudSchema: state.lease.cloudAuthority.schema === "agentic-lane-cloud-authority/v1",
    cloudState: state.lease.cloudAuthority.state === "active",
    claim: state.lease.cloudAuthority.claimId === successor.claimId,
    cloudBase: state.lease.cloudAuthority.canonicalBaseSha
      === reanchorPlan.targetCanonicalBaseSha,
    cloudLane: state.lease.cloudAuthority.laneRevision === reanchorPlan.targetLaneRevision,
    cloudEpoch: state.lease.cloudAuthority.leaseEpoch === reanchorPlan.targetCloudLeaseEpoch,
    review: state.lease.cloudAuthority.reviewRequestId
      === reanchorPlan.evidence.sourceClaim.reviewRequestId,
    cloudWriteSet: state.lease.cloudAuthority.writeSetDigest
      === reanchorPlan.targetWriteSetDigest,
    cloudManifest: state.lease.cloudAuthority.manifestDigest
      === reanchorPlan.targetManifestDigest,
    cloudDevice: state.lease.cloudAuthority.deviceId === reanchorPlan.device,
    cloudSession: state.lease.cloudAuthority.sessionId === reanchorPlan.sessionId,
    cloudCounter: state.lease.cloudAuthority.transitionCounter >= successor.transitionCounter,
    expiry: state.lease.cloudAuthority.expiresAt === state.lease.expiresAt,
    binding: state.lease.taskAuthority.bindingDigest === localCas.taskBindingDigest,
    priorBinding: state.lease.taskAuthority.priorBindingDigest
      === reanchorPlan.sourceTaskBindingDigest,
    recoveryPlan: state.lease.activeOwnedDirtCurrentBaseReanchor.planDigest
      === reanchorPlan.planDigest,
    recoverySource: state.lease.activeOwnedDirtCurrentBaseReanchor.sourceClaimId
      === reanchorPlan.sourceClaimId,
    recoverySuccessor: state.lease.activeOwnedDirtCurrentBaseReanchor.successorClaimId
      === successor.claimId,
    recoveryBase: state.lease.activeOwnedDirtCurrentBaseReanchor.targetCanonicalBaseSha
      === reanchorPlan.targetCanonicalBaseSha,
    recoveryLane: state.lease.activeOwnedDirtCurrentBaseReanchor.targetLaneRevision
      === reanchorPlan.targetLaneRevision,
    recoveryDirt: state.lease.activeOwnedDirtCurrentBaseReanchor.targetDirtEvidenceDigest
      === reanchorPlan.targetDirtEvidenceDigest,
    recoveryTask: state.lease.activeOwnedDirtCurrentBaseReanchor
      .taskContinuationReceiptDigest === localCas.taskContinuationReceiptDigest,
  };
  assert.deepEqual(Object.entries(fixtureJoins).filter(([, value]) => !value), [],
    "repository-adapter fixture must satisfy every target-lease join");
  const reanchorPlanFile = path.join(privateRoot, "reanchor-plan.json");
  const reanchorJournalFile = path.join(privateRoot, "reanchor-journal.json");
  const taskAuthorityFile = path.join(privateRoot, "task-authority.json");
  const recoveryJournalFile = path.join(privateRoot, "marker-replay-journal.json");
  for (const [file, value] of [
    [reanchorPlanFile, reanchorPlan],
    [reanchorJournalFile, reanchorIntent],
    [taskAuthorityFile, targetCapability],
  ]) {
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
  }
  const pullSnapshot = () => ({
    id: reanchorPlan.pullRequestId,
    number: reanchorPlan.pullRequestNumber,
    url: reanchorPlan.pullRequestUrl,
    state: "OPEN",
    isDraft: true,
    headBranch: reanchorPlan.branch,
    headSha: reanchorPlan.targetLaneRevision,
    headRepository: REPOSITORY,
    baseBranch: "main",
    baseSha: reanchorPlan.targetCanonicalBaseSha,
    body: state.body,
    etag: `"agentic-snapshot-sha256:${hex(`etag:${state.body}`)}"`,
    ...state.pullOverrides,
  });
  const pullBodyPort = {
    readConditionalPull() { return pullSnapshot(); },
    patchConditionalPull({ expectedEtag, body }) {
      assert.equal(expectedEtag, pullSnapshot().etag);
      state.providerEdits += 1;
      state.body = body;
      return {
        bodyDigest: digestValue(body),
        providerAtomicCompareAndSwap: false,
        cooperativeWriterFenceRequired: true,
      };
    },
  };
  const git = args => {
    if (args[0] === "branch" && args[1] === "--show-current") return reanchorPlan.branch;
    if (args[0] === "rev-parse" && args[1] === "--git-common-dir") {
      return commonDirectory;
    }
    if (args[0] === "rev-parse" && (args[1] === "HEAD"
      || args[1] === `refs/heads/${reanchorPlan.branch}`)) {
      return reanchorPlan.targetLaneRevision;
    }
    if (args[0] === "ls-remote") {
      return `${reanchorPlan.targetLaneRevision}\trefs/heads/${reanchorPlan.branch}`;
    }
    throw new Error(`Unexpected adapter Git read: ${args.join(" ")}`);
  };
  const gitRaw = args => {
    if (args[0] === "worktree") {
      return [
        `worktree ${repository}\0HEAD ${reanchorPlan.targetLaneRevision}\0branch refs/heads/${reanchorPlan.branch}\0\0`,
        `worktree ${siblingDirectory}\0HEAD ${reanchorPlan.targetCanonicalBaseSha}\0branch refs/heads/agent/device/sibling\0\0`,
      ].join("");
    }
    return git(args);
  };
  const leaseStore = {
    read(branch) {
      assert.equal(branch, reanchorPlan.branch);
      return structuredClone(state.lease);
    },
  };
  const adapterOptions = {
    repository,
    reanchorPlanFile,
    reanchorJournalFile,
    taskAuthorityFile,
    recoveryJournalFile,
  };
  const adapterDependencies = {
    git,
    gitRaw,
    leaseStore,
    pullBodyPort,
    now: () => new Date(AT),
    captureDirt: () => structuredClone(reanchorPlan.evidence.reanchor.targetDirt),
    authorizeTaskMutation: () => {
      if (rejectTaskAuthority) throw new Error("task authority rejected");
      return { receiptDigest: hex("adapter-task-authority-receipt") };
    },
    withProjectionFence: ({ expectedLeaseDigest, expectedClaimId, action }) => {
      assert.equal(expectedLeaseDigest, writerLeaseDigest(state.lease));
      assert.equal(expectedClaimId, successorClaimId);
      return action();
    },
    withOperationLock: ({ action }) => action(),
  };
  const adapter = createRepositoryActiveOwnedDirtCurrentBasePrMarkerReplayAdapter(
    adapterOptions,
    adapterDependencies,
  );
  return {
    adapter,
    adapterOptions,
    adapterDependencies,
    state,
    reanchorPlan,
    repository,
    commonDirectory,
    siblingDirectory,
    privateRoot,
    targetBody() { return updateWriterLeasePullRequestBody(state.body, state.lease); },
  };
}

function artifactIsolationFixture(t) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "marker-replay-paths-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository");
  const commonDirectory = path.join(root, "git-common");
  const sibling = path.join(root, "sibling-worktree");
  const external = path.join(root, "external");
  for (const directory of [repository, commonDirectory, sibling, external]) {
    mkdirSync(directory, { mode: 0o700 });
    chmodSync(directory, 0o700);
  }
  const branch = BRANCH;
  const files = {};
  for (const [name, directory] of [
    ["reanchorPlan", external],
    ["reanchorJournal", external],
    ["taskAuthority", external],
    ["runPlan", external],
    ["commonPlan", commonDirectory],
    ["commonRecovery", commonDirectory],
    ["commonRunPlan", commonDirectory],
    ["siblingJournal", sibling],
    ["siblingCapability", sibling],
  ]) {
    const file = path.join(directory, `${name}.json`);
    writeFileSync(file, "{}\n", { mode: 0o600 });
    chmodSync(file, 0o600);
    files[name] = file;
  }
  const linkedParent = path.join(root, "linked-common");
  symlinkSync(commonDirectory, linkedParent, "dir");
  const dependencies = {
    git: args => {
      if (args[0] === "branch" && args[1] === "--show-current") return branch;
      if (args[0] === "rev-parse" && args[1] === "--git-common-dir") {
        return commonDirectory;
      }
      throw new Error(`Unexpected path-fixture Git read: ${args.join(" ")}`);
    },
    gitRaw: args => {
      if (args[0] === "worktree") {
        return [
          `worktree ${repository}\0HEAD ${HEAD}\0branch refs/heads/${branch}\0\0`,
          `worktree ${sibling}\0HEAD ${BASE}\0branch refs/heads/agent/device/sibling\0\0`,
        ].join("");
      }
      throw new Error(`Unexpected path-fixture raw Git read: ${args.join(" ")}`);
    },
    leaseStore: { read: () => null },
    pullBodyPort: {
      readConditionalPull() { throw new Error("path rejection must precede provider read"); },
      patchConditionalPull() { throw new Error("path rejection must precede provider write"); },
    },
  };
  const options = {
    repository,
    reanchorPlanFile: files.reanchorPlan,
    reanchorJournalFile: files.reanchorJournal,
    taskAuthorityFile: files.taskAuthority,
    recoveryJournalFile: path.join(external, "recovery.json"),
  };
  return {
    repository,
    commonDirectory,
    sibling,
    external,
    linkedParent,
    files,
    dependencies,
    options,
  };
}

test("plan seals the exact pr-projected marker-only topology and literal authorization", () => {
  const plan = planFixture();
  assert.equal(plan.reanchorPrProjectedReceiptDigest, hex("reanchor-pr-projected"));
  assert.equal(plan.sourceMarkerDisposition, "journaled");
  assert.deepEqual(plan.allowedMutations, [
    "pull-request-writer-marker",
    "external-private-recovery-journal",
  ]);
  assert.deepEqual(plan.forbiddenEffects, [
    "cloud-transition",
    "writer-registry-mutation",
    "git-mutation",
    "remote-ref-mutation",
    "source-mutation",
    "pull-request-subject-mutation",
    "pull-request-draft-mutation",
    "pull-request-auto-merge-mutation",
    "authoring-authority",
    "integration-authority",
    "release",
    "deployment",
    "cleanup",
  ]);
  assert.deepEqual(normalizeActiveOwnedDirtCurrentBasePrMarkerReplayPlan(plan), plan);
  assert.equal(authorizeActiveOwnedDirtCurrentBasePrMarkerReplay({
    plan,
    authorization: plan.exactAuthorization,
  }).status, "authorized");
  assert.throws(() => authorizeActiveOwnedDirtCurrentBasePrMarkerReplay({
    plan,
    authorization: `authorize active-owned-dirt-current-base-pr-marker-replay ${hex("other")}`,
  }), /requires exact authorization/u);
  assert.throws(() => normalizeActiveOwnedDirtCurrentBasePrMarkerReplayPlan({
    ...plan,
    targetLeaseDigest: hex("foreign-lease"),
  }), /plan projection/u);
});

test("intent receipts are ordered, digest-bound, and expose no lifecycle authority", () => {
  const plan = planFixture();
  let intent = createActiveOwnedDirtCurrentBasePrMarkerReplayIntent(
    plan,
    plan.exactAuthorization,
  );
  const values = {
    "authority-verified": {
      taskAuthorityReceiptDigest: hex("task-authority-receipt"),
      bindingDigest: plan.targetTaskBindingDigest,
    },
    "provider-attempted": {
      revalidationDigest: hex("revalidation"),
      providerState: "journaled",
    },
    "provider-projected": {
      disposition: "projected",
      providerMutation: true,
      projectionDigest: hex("projection"),
    },
    complete: { verificationDigest: hex("verification") },
  };
  for (const phase of PHASES.slice(1)) {
    intent = advanceActiveOwnedDirtCurrentBasePrMarkerReplayIntent(intent, {
      phase,
      values: values[phase],
    });
  }
  assert.deepEqual(normalizeActiveOwnedDirtCurrentBasePrMarkerReplayIntent(intent), intent);
  assert.equal(intent.completion.status, "projection-restored");
  assert.equal(intent.completion.cloudMutation, false);
  assert.equal(intent.completion.writerRegistryMutation, false);
  assert.equal(intent.completion.gitMutation, false);
  assert.equal(intent.completion.remoteRefMutation, false);
  assert.equal(intent.completion.sourceMutation, false);
  assert.equal(intent.completion.authoringAuthorityGranted, false);
  assert.equal(intent.completion.integrationAuthorityGranted, false);
  assert.equal(intent.completion.released, false);
  assert.equal(intent.completion.deployed, false);
  assert.equal(intent.completion.cleaned, false);
  assert.throws(() => advanceActiveOwnedDirtCurrentBasePrMarkerReplayIntent(
    createActiveOwnedDirtCurrentBasePrMarkerReplayIntent(plan, plan.exactAuthorization),
    { phase: "provider-attempted", values: values["provider-attempted"] },
  ), /phase transition/u);
});

test("controller projects one stale target marker, then replays the sealed completion", async () => {
  const fixture = controllerFixture();
  const controller = createActiveOwnedDirtCurrentBasePrMarkerReplayController(
    fixture.adapter,
  );
  const plan = await controller.plan({ ttlSeconds: 300 });
  const first = await controller.run({ plan, authorization: plan.exactAuthorization });
  assert.equal(first.status, "projection-restored");
  assert.equal(first.pullRequestWriterMarkerAtTarget, true);
  assert.equal(first.providerBodyProjected, true);
  assert.equal(first.cloudMutation, false);
  assert.equal(first.writerRegistryMutation, false);
  assert.equal(first.gitMutation, false);
  assert.equal(first.remoteRefMutation, false);
  assert.equal(first.sourceMutation, false);
  assert.equal(fixture.state.providerMutations, 1);
  assert.deepEqual(fixture.state.calls, [
    "read-plan",
    "lock",
    "read-intent",
    "write:prepared",
    "revalidate:before-authority",
    "authorize-task",
    "write:authority-verified",
    "revalidate:before-provider",
    "write:provider-attempted",
    "project-provider",
    "write:provider-projected",
    "verify-terminal",
    "write:complete",
  ]);

  fixture.state.calls.length = 0;
  const replay = await controller.run({ plan, authorization: plan.exactAuthorization });
  assert.equal(replay.receiptDigest, first.receiptDigest);
  assert.equal(fixture.state.providerMutations, 1);
  assert.deepEqual(fixture.state.calls, [
    "lock",
    "read-intent",
    "verify-terminal",
  ]);
});

test("already-current adoption has the same final-state receipt as one projection", async () => {
  const projected = controllerFixture();
  const adopted = controllerFixture({ providerDisposition: "already-current" });
  const projectedController = createActiveOwnedDirtCurrentBasePrMarkerReplayController(
    projected.adapter,
  );
  const adoptedController = createActiveOwnedDirtCurrentBasePrMarkerReplayController(
    adopted.adapter,
  );
  const projectedPlan = await projectedController.plan({ ttlSeconds: 300 });
  const adoptedPlan = await adoptedController.plan({ ttlSeconds: 300 });
  const projectedResult = await projectedController.run({
    plan: projectedPlan,
    authorization: projectedPlan.exactAuthorization,
  });
  const adoptedResult = await adoptedController.run({
    plan: adoptedPlan,
    authorization: adoptedPlan.exactAuthorization,
  });
  assert.equal(projectedResult.receiptDigest, adoptedResult.receiptDigest);
  assert.equal(projected.state.providerMutations, 1);
  assert.equal(adopted.state.providerMutations, 0);
});

test("provider response loss adopts only an exact target and stays replay-stable", async () => {
  const fixture = controllerFixture({ failAt: "provider" });
  const controller = createActiveOwnedDirtCurrentBasePrMarkerReplayController(
    fixture.adapter,
  );
  const plan = await controller.plan({ ttlSeconds: 300 });
  const result = await controller.run({ plan, authorization: plan.exactAuthorization });
  assert.equal(result.status, "projection-restored");
  assert.equal(fixture.state.providerMutations, 0);
  assert.equal(fixture.state.intent.receipts["provider-projected"].values.disposition,
    "adopted-response-loss");
  const replay = await controller.run({ plan, authorization: plan.exactAuthorization });
  assert.equal(replay.receiptDigest, result.receiptDigest);
});

test("pre-provider drift and task-authority failures have zero external effect", async () => {
  for (const failure of [
    "before-authority",
    "task-authority",
    "before-provider",
  ]) {
    const fixture = controllerFixture({ failAt: failure });
    const controller = createActiveOwnedDirtCurrentBasePrMarkerReplayController(
      fixture.adapter,
    );
    const plan = await controller.plan({ ttlSeconds: 300 });
    await assert.rejects(controller.run({
      plan,
      authorization: plan.exactAuthorization,
    }), new RegExp(`rejected ${failure}`, "u"));
    assert.equal(fixture.state.calls.includes("project-provider"), false, failure);
    assert.equal(fixture.state.providerMutations, 0, failure);
    assert.equal(fixture.state.cloudMutations, 0, failure);
    assert.equal(fixture.state.registryMutations, 0, failure);
    assert.equal(fixture.state.gitMutations, 0, failure);
    assert.equal(fixture.state.remoteRefMutations, 0, failure);
    assert.equal(fixture.state.sourceMutations, 0, failure);
  }
});

test("resumed pre-provider intents re-prove live task authority before projection", async t => {
  const receiptValues = {
    "authority-verified": {
      taskAuthorityReceiptDigest: hex("resumed-task-authority-receipt"),
      bindingDigest: hex("target-task-binding"),
    },
    "provider-attempted": {
      revalidationDigest: hex("resumed-provider-revalidation"),
      providerState: "journaled",
    },
  };
  for (const phase of ["authority-verified", "provider-attempted"]) {
    await t.test(phase, async () => {
      const fixture = controllerFixture({ failAt: "task-authority" });
      const controller = createActiveOwnedDirtCurrentBasePrMarkerReplayController(
        fixture.adapter,
      );
      const plan = await controller.plan({ ttlSeconds: 300 });
      let intent = createActiveOwnedDirtCurrentBasePrMarkerReplayIntent(
        plan,
        plan.exactAuthorization,
      );
      for (const current of ["authority-verified", "provider-attempted"]) {
        intent = advanceActiveOwnedDirtCurrentBasePrMarkerReplayIntent(intent, {
          phase: current,
          values: receiptValues[current],
        });
        if (current === phase) break;
      }
      fixture.state.intent = intent;
      fixture.state.calls.length = 0;
      await assert.rejects(controller.run({
        plan,
        authorization: plan.exactAuthorization,
      }), /rejected task-authority/u);
      assert.equal(fixture.state.calls.includes("authorize-task"), true);
      assert.equal(fixture.state.calls.includes("project-provider"), false);
      assert.equal(fixture.state.providerMutations, 0);
      assert.equal(fixture.state.cloudMutations, 0);
      assert.equal(fixture.state.registryMutations, 0);
      assert.equal(fixture.state.gitMutations, 0);
      assert.equal(fixture.state.remoteRefMutations, 0);
      assert.equal(fixture.state.sourceMutations, 0);
    });
  }
});

test("repository adapter recognizes the exact pr-projected marker and projects it once",
  async t => {
    const fixture = repositoryAdapterFixture(t);
    const controller = createActiveOwnedDirtCurrentBasePrMarkerReplayController(
      fixture.adapter,
    );
    const plan = await controller.plan({ ttlSeconds: 300 });
    assert.equal(plan.reanchorPlanDigest, fixture.reanchorPlan.planDigest);
    assert.equal(plan.sourceMarkerDisposition, "journaled");
    const result = await controller.run({
      plan,
      authorization: plan.exactAuthorization,
    });
    assert.equal(result.status, "projection-restored");
    assert.equal(fixture.state.providerEdits, 1);
    assert.equal(digestValue(fixture.state.body), plan.targetBodyDigest);
    assert.equal(result.targetMarkerDigest, plan.targetMarkerDigest);
    assert.equal(result.cloudMutation, false);
    assert.equal(result.writerRegistryMutation, false);
    assert.equal(result.gitMutation, false);
    assert.equal(result.remoteRefMutation, false);
    assert.equal(result.sourceMutation, false);
    assert.equal(fixture.state.cloudWrites, 0);
    assert.equal(fixture.state.registryWrites, 0);
    assert.equal(fixture.state.gitWrites, 0);
    assert.equal(fixture.state.refWrites, 0);
    assert.equal(fixture.state.sourceWrites, 0);

    const replay = await controller.run({
      plan,
      authorization: plan.exactAuthorization,
    });
    assert.equal(replay.receiptDigest, result.receiptDigest);
    assert.equal(fixture.state.providerEdits, 1);
  });

test("repository adapter adopts a target marker installed between plan and run",
  async t => {
    const fixture = repositoryAdapterFixture(t);
    const controller = createActiveOwnedDirtCurrentBasePrMarkerReplayController(
      fixture.adapter,
    );
    const plan = await controller.plan({ ttlSeconds: 300 });
    fixture.state.body = fixture.targetBody();
    const result = await controller.run({
      plan,
      authorization: plan.exactAuthorization,
    });
    assert.equal(result.status, "projection-restored");
    assert.equal(fixture.state.providerEdits, 0);
    assert.equal(result.receiptDigest, (await controller.run({
      plan,
      authorization: plan.exactAuthorization,
    })).receiptDigest);
  });

test("repository adapter rejects identity, remainder, lease, and capability drift zero-effect",
  async t => {
    const cases = [
      {
        name: "foreign pull-request identity",
        mutate: fixture => { fixture.state.pullOverrides.id = "PR_foreign"; },
        error: /exact open draft target pull request/u,
      },
      {
        name: "foreign body remainder",
        mutate: fixture => { fixture.state.body += "\nforeign remainder"; },
        error: /preserved pull-request body remainder/u,
      },
      {
        name: "changed target lease",
        mutate: fixture => {
          fixture.state.lease.heartbeatAt = "2026-08-31T00:00:01.000Z";
        },
        error: /plan-bound (?:targetBodyDigest|targetLeaseDigest)/u,
      },
      {
        name: "invalid task capability",
        rejectTaskAuthority: true,
        mutate: () => {},
        error: /task authority rejected/u,
      },
    ];
    for (const scenario of cases) {
      await t.test(scenario.name, async child => {
        const fixture = repositoryAdapterFixture(child, {
          rejectTaskAuthority: scenario.rejectTaskAuthority,
        });
        const controller = createActiveOwnedDirtCurrentBasePrMarkerReplayController(
          fixture.adapter,
        );
        const plan = await controller.plan({ ttlSeconds: 300 });
        scenario.mutate(fixture);
        await assert.rejects(controller.run({
          plan,
          authorization: plan.exactAuthorization,
        }), scenario.error);
        assert.equal(fixture.state.providerEdits, 0);
        assert.equal(fixture.state.cloudWrites, 0);
        assert.equal(fixture.state.registryWrites, 0);
        assert.equal(fixture.state.gitWrites, 0);
        assert.equal(fixture.state.refWrites, 0);
        assert.equal(fixture.state.sourceWrites, 0);
      });
    }
  });

test("repository adapter permits only current receipt and lease-time advancement",
  async t => {
    const fixture = repositoryAdapterFixture(t);
    fixture.state.lease.heartbeatAt = "2026-08-31T00:01:00.000Z";
    fixture.state.lease.expiresAt = "2026-08-31T00:12:00.000Z";
    Object.assign(fixture.state.lease.cloudAuthority, {
      claimDigest: hex("adapter-current-claim-digest"),
      ledgerRevision: oid("adapter-current-ledger-revision"),
      ledgerDigest: hex("adapter-current-ledger"),
      claimLedgerRevision: hex("adapter-current-claim-ledger"),
      operationReceiptDigest: hex("adapter-current-operation"),
      transitionCounter: 5,
      expiresAt: fixture.state.lease.expiresAt,
    });
    const controller = createActiveOwnedDirtCurrentBasePrMarkerReplayController(
      fixture.adapter,
    );
    const plan = await controller.plan({ ttlSeconds: 300 });
    assert.equal(plan.evidence.targetClaimDigest,
      fixture.state.lease.cloudAuthority.claimDigest);
    assert.equal(plan.evidence.targetTransitionCounter, 5);
    assert.equal(plan.evidence.targetLeaseExpiresAt, fixture.state.lease.expiresAt);
    const result = await controller.run({
      plan,
      authorization: plan.exactAuthorization,
    });
    assert.equal(result.status, "projection-restored");
    assert.equal(fixture.state.providerEdits, 1);
    assert.equal(fixture.state.cloudWrites, 0);
    assert.equal(fixture.state.registryWrites, 0);
    assert.equal(fixture.state.gitWrites, 0);
    assert.equal(fixture.state.refWrites, 0);
    assert.equal(fixture.state.sourceWrites, 0);
  });

test("repository adapter rejects authority and preserved-lineage widening zero-effect",
  async t => {
    const cases = [
      ["admission schema", lease => { lease.admission.schema = "foreign/v1"; }],
      ["cloud provider", lease => { lease.cloudAuthority.provider = "foreign"; }],
      ["ledger repository", lease => {
        lease.cloudAuthority.ledgerRepository = "foreign/ledger";
      }],
      ["target repository", lease => {
        lease.cloudAuthority.targetRepository = "foreign/repository";
      }],
      ["cloud declared write scope", lease => {
        lease.cloudAuthority.cloudDeclaredWriteScope = [
          ...lease.cloudAuthority.cloudDeclaredWriteScope,
          "path:foreign",
        ];
      }],
      ["mutation authority eligibility", lease => {
        lease.cloudAuthority.mutationAuthorityEligible = false;
      }],
      ["integration receipt", lease => {
        lease.cloudAuthority.integrationReceiptDigest = hex("foreign-integration");
      }],
      ["integration evidence", lease => {
        lease.cloudAuthority.integration = { receiptDigest: hex("foreign-integration") };
      }],
      ["review head", lease => { lease.reviewHeadSha = HEAD; }],
      ["delivery head", lease => { lease.deliveryHeadSha = HEAD; }],
      ["completion", lease => { lease.completion = { mainSha: HEAD }; }],
      ["pre-claim integration continuation", lease => {
        lease.preClaimIntegrationContinuation = { receiptDigest: hex("foreign-continuation") };
      }],
      ["top-level integration", lease => {
        lease.integration = { receiptDigest: hex("foreign-top-level-integration") };
      }],
      ["park head", lease => { lease.parkHeadSha = HEAD; }],
      ["park branch head", lease => { lease.parkBranchHeadSha = HEAD; }],
      ["park source epoch", lease => { lease.parkSourceEpoch = lease.epoch; }],
      ["park source fence", lease => { lease.parkSourceFenceSha = lease.fenceSha; }],
      ["park stash ref", lease => {
        lease.parkStashRef = "refs/agentic-canvas-os/parked/foreign";
      }],
      ["park stash SHA", lease => { lease.parkStashSha = HEAD; }],
      ["park stash message", lease => { lease.parkStashMessage = "foreign"; }],
      ["park stash status", lease => { lease.parkStashStatus = "parked"; }],
      ["preserved recovery receipt", lease => {
        lease.activeOwnedDirtRecovery.recoveredClaimDigest =
          hex("foreign-recovered-claim");
      }],
      ["preserved recovery payload widening", lease => {
        lease.activeOwnedDirtRecovery.foreignReceiptDigest =
          hex("foreign-recovery-receipt");
      }],
      ["reanchor annotation schema", lease => {
        lease.activeOwnedDirtCurrentBaseReanchor.schema = "foreign/v1";
      }],
      ["reanchor annotation status", lease => {
        lease.activeOwnedDirtCurrentBaseReanchor.status = "foreign";
      }],
      ["reanchor source base", lease => {
        lease.activeOwnedDirtCurrentBaseReanchor.sourceBaseSha = HEAD;
      }],
      ["reanchor source fence", lease => {
        lease.activeOwnedDirtCurrentBaseReanchor.sourceFenceSha = HEAD;
      }],
      ["reanchor annotation widening", lease => {
        lease.activeOwnedDirtCurrentBaseReanchor.foreignReceiptDigest =
          hex("foreign-reanchor-receipt");
      }],
    ];
    for (const [name, mutate] of cases) {
      await t.test(name, async child => {
        const fixture = repositoryAdapterFixture(child);
        const controller = createActiveOwnedDirtCurrentBasePrMarkerReplayController(
          fixture.adapter,
        );
        const plan = await controller.plan({ ttlSeconds: 300 });
        const sourceBody = fixture.state.body;
        mutate(fixture.state.lease);
        await assert.rejects(controller.run({
          plan,
          authorization: plan.exactAuthorization,
        }), /current target reanchor lease/u);
        assert.equal(fixture.state.body, sourceBody);
        assert.equal(fixture.state.providerEdits, 0);
        assert.equal(fixture.state.cloudWrites, 0);
        assert.equal(fixture.state.registryWrites, 0);
        assert.equal(fixture.state.gitWrites, 0);
        assert.equal(fixture.state.refWrites, 0);
        assert.equal(fixture.state.sourceWrites, 0);
      });
    }
  });

test("adapter rejects every private artifact inside Git-owned topology", async t => {
  const fixture = artifactIsolationFixture(t);
  const cases = [
    ["reanchor plan in Git common directory", {
      reanchorPlanFile: fixture.files.commonPlan,
    }],
    ["reanchor journal in sibling worktree", {
      reanchorJournalFile: fixture.files.siblingJournal,
    }],
    ["task capability in sibling worktree", {
      taskAuthorityFile: fixture.files.siblingCapability,
    }],
    ["recovery journal in Git common directory", {
      recoveryJournalFile: fixture.files.commonRecovery,
    }],
  ];
  for (const [name, override] of cases) {
    await t.test(name, () => {
      assert.throws(() =>
        createRepositoryActiveOwnedDirtCurrentBasePrMarkerReplayAdapter({
          ...fixture.options,
          ...override,
        }, fixture.dependencies),
      /artifact|external|Git common|registered worktree|path boundary/iu);
    });
  }
});

test("CLI rejects replay plan and output paths in Git-owned topology", async t => {
  const fixture = artifactIsolationFixture(t);
  const common = [
    `--repository=${fixture.repository}`,
    `--reanchor-plan=${fixture.files.reanchorPlan}`,
    `--reanchor-journal=${fixture.files.reanchorJournal}`,
    `--recovery-journal=${path.join(fixture.external, "cli-recovery.json")}`,
  ];
  const cases = [
    ["run plan in Git common directory", [
      "run",
      ...common,
      `--plan-file=${fixture.files.commonRunPlan}`,
      `--task-authority=${fixture.files.taskAuthority}`,
      "--authorize=authorize active-owned-dirt-current-base-pr-marker-replay dummy",
    ]],
    ["plan output in sibling worktree", [
      "plan",
      ...common,
      `--output=${path.join(fixture.sibling, "output.json")}`,
    ]],
    ["plan output through parent symlink into Git common directory", [
      "plan",
      ...common,
      `--output=${path.join(fixture.linkedParent, "linked-output.json")}`,
    ]],
  ];
  for (const [name, argumentsList] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        runActiveOwnedDirtCurrentBasePrMarkerReplayCli(argumentsList, {
          adapterDependencies: fixture.dependencies,
        }),
        /artifact|external|Git common|registered worktree|path boundary/iu,
      );
    });
  }
});

test("CLI delegates normal plan persistence to the canonical secure adapter writer",
  async t => {
    const fixture = repositoryAdapterFixture(t);
    const output = path.join(fixture.privateRoot, "cli-marker-replay-plan.json");
    const result = await runActiveOwnedDirtCurrentBasePrMarkerReplayCli([
      "plan",
      `--repository=${fixture.repository}`,
      `--reanchor-plan=${fixture.adapterOptions.reanchorPlanFile}`,
      `--reanchor-journal=${fixture.adapterOptions.reanchorJournalFile}`,
      `--recovery-journal=${fixture.adapterOptions.recoveryJournalFile}`,
      `--output=${output}`,
      "--ttl-seconds=300",
      "--json",
    ], {
      adapterDependencies: fixture.adapterDependencies,
    });
    assert.equal(result.status, "planned");
    assert.equal(result.planFile, realpathSync(output));
    assert.equal(statSync(output).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), result.plan);
    assert.equal(result.exactAuthorization, result.plan.exactAuthorization);
  });

test("adapter-owned plan writer rejects an output-parent symlink swap", async t => {
  const fixture = repositoryAdapterFixture(t);
  const outputParent = path.join(fixture.privateRoot, "late-swap-parent");
  const movedParent = path.join(fixture.privateRoot, "late-swap-original");
  mkdirSync(outputParent, { mode: 0o700 });
  chmodSync(outputParent, 0o700);
  const outputName = "late-swap-plan.json";
  const output = path.join(outputParent, outputName);
  await assert.rejects(runActiveOwnedDirtCurrentBasePrMarkerReplayCli([
    "plan",
    `--repository=${fixture.repository}`,
    `--reanchor-plan=${fixture.adapterOptions.reanchorPlanFile}`,
    `--reanchor-journal=${fixture.adapterOptions.reanchorJournalFile}`,
    `--recovery-journal=${fixture.adapterOptions.recoveryJournalFile}`,
    `--output=${output}`,
    "--ttl-seconds=300",
  ], {
    adapterDependencies: fixture.adapterDependencies,
    createController(adapter) {
      const controller = createActiveOwnedDirtCurrentBasePrMarkerReplayController(adapter);
      return {
        async plan(options) {
          const plan = await controller.plan(options);
          renameSync(outputParent, movedParent);
          symlinkSync(fixture.commonDirectory, outputParent, "dir");
          return plan;
        },
      };
    },
  }), /canonical marker-replay plan-output parent|fresh canonical marker-replay plan output/u);
  assert.throws(() => statSync(path.join(fixture.commonDirectory, outputName)), /ENOENT/u);
  assert.throws(() => statSync(path.join(movedParent, outputName)), /ENOENT/u);
});

test("adapter-owned plan writer refreshes registered worktrees before creation", async t => {
  const fixture = repositoryAdapterFixture(t);
  const outputParent = path.join(fixture.privateRoot, "late-registered-worktree");
  mkdirSync(outputParent, { mode: 0o700 });
  chmodSync(outputParent, 0o700);
  const output = path.join(outputParent, "late-registered-plan.json");
  let registered = false;
  const originalGitRaw = fixture.adapterDependencies.gitRaw;
  await assert.rejects(runActiveOwnedDirtCurrentBasePrMarkerReplayCli([
    "plan",
    `--repository=${fixture.repository}`,
    `--reanchor-plan=${fixture.adapterOptions.reanchorPlanFile}`,
    `--reanchor-journal=${fixture.adapterOptions.reanchorJournalFile}`,
    `--recovery-journal=${fixture.adapterOptions.recoveryJournalFile}`,
    `--output=${output}`,
    "--ttl-seconds=300",
  ], {
    adapterDependencies: {
      ...fixture.adapterDependencies,
      gitRaw(argumentsList) {
        const inventory = originalGitRaw(argumentsList);
        if (!registered || argumentsList[0] !== "worktree") return inventory;
        return `${inventory}worktree ${outputParent}\0HEAD ${BASE}\0branch refs/heads/agent/device/late-registered\0\0`;
      },
    },
    createController(adapter) {
      const controller = createActiveOwnedDirtCurrentBasePrMarkerReplayController(adapter);
      return {
        async plan(options) {
          const plan = await controller.plan(options);
          registered = true;
          return plan;
        },
      };
    },
  }), /external marker-replay plan output|registered worktree|path boundary/iu);
  assert.throws(() => statSync(output), /ENOENT/u);
});

test("recovery-journal operations reject a late Git-owned parent substitution",
  async t => {
    for (const [name, target] of [
      ["Git common directory", fixture => fixture.commonDirectory],
      ["registered sibling worktree", fixture => fixture.siblingDirectory],
    ]) {
      await t.test(name, async child => {
        const fixture = repositoryAdapterFixture(child);
        const recoveryParent = path.join(
          fixture.privateRoot,
          `late-recovery-parent-${name.replaceAll(" ", "-")}`,
        );
        const preservedParent = `${recoveryParent}-original`;
        mkdirSync(recoveryParent, { mode: 0o700 });
        chmodSync(recoveryParent, 0o700);
        const recoveryJournalFile = path.join(recoveryParent, "recovery.json");
        const adapter =
          createRepositoryActiveOwnedDirtCurrentBasePrMarkerReplayAdapter({
            ...fixture.adapterOptions,
            recoveryJournalFile,
          }, fixture.adapterDependencies);
        const controller = createActiveOwnedDirtCurrentBasePrMarkerReplayController(adapter);
        const plan = await controller.plan({ ttlSeconds: 300 });
        const intent = createActiveOwnedDirtCurrentBasePrMarkerReplayIntent(
          plan,
          plan.exactAuthorization,
        );
        renameSync(recoveryParent, preservedParent);
        const substitutedTarget = target(fixture);
        symlinkSync(substitutedTarget, recoveryParent, "dir");

        let lockActionEntered = false;
        assert.throws(() => adapter.withOperationLock(() => {
          lockActionEntered = true;
        }), /canonical recovery-journal parent|external recovery journal|artifact|path boundary/iu);
        assert.equal(lockActionEntered, false);
        assert.throws(() => adapter.readIntent(),
          /canonical recovery-journal parent|external recovery journal|artifact|path boundary/iu);
        assert.throws(() => adapter.writeIntent({ expected: null, value: intent }),
          /canonical recovery-journal parent|external recovery journal|artifact|path boundary/iu);

        for (const file of ["recovery.json", "recovery.json.lock"]) {
          assert.throws(() => statSync(path.join(substitutedTarget, file)), /ENOENT/u);
          assert.throws(() => statSync(path.join(preservedParent, file)), /ENOENT/u);
        }
        assert.equal(fixture.state.providerEdits, 0);
        assert.equal(fixture.state.cloudWrites, 0);
        assert.equal(fixture.state.registryWrites, 0);
        assert.equal(fixture.state.gitWrites, 0);
        assert.equal(fixture.state.refWrites, 0);
        assert.equal(fixture.state.sourceWrites, 0);
      });
    }
  });
