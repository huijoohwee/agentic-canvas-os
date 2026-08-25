// Responsibility: Orchestrate one receipt-bound active-owned-dirt recovery through injected effect adapters.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { authorizeActiveOwnedDirtRecovery,
  buildActiveOwnedDirtRecoveryReceipt, createActiveOwnedDirtCloudRecoveryRequest,
  createActiveOwnedDirtLeaseRecovery, normalizeActiveOwnedDirtRecoveryPlan,
  selectActiveOwnedDirtRecoveryPlan, verifyActiveOwnedDirtCloudRecovery,
} from "./active-owned-dirt-recovery-contract.mjs";
import {
  captureActiveOwnedDirtEvidence, createActiveOwnedDirtSnapshot,
  requireSameActiveOwnedDirtEvidence, verifyActiveOwnedDirtSnapshot,
} from "./active-owned-dirt-recovery-evidence.mjs";
import {
  advanceActiveOwnedDirtRecoveryIntent, beginActiveOwnedDirtRecoveryIntent,
  assertActiveDraftMutationAuthority, assertActiveOwnedDirtPlanSource,
  buildActiveOwnedDirtRecoveryFinalizeMutationAuthority,
  normalizeActiveOwnedDirtRecoveryIntent, projectActiveOwnedDirtRecoveredLease,
  readActiveOwnedDirtRecoveryIntent, verifiedHeartbeatAuthority,
} from "./active-owned-dirt-recovery-registry.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { captureProtectedMainAdvance, readActiveOwnedDirtRecoveryPullRequest,
  requireProtectedMainEquivalent }
  from "./device-branch-ownership-lib.mjs";
export { captureProtectedMainAdvance, requireProtectedMainEquivalent }
  from "./device-branch-ownership-lib.mjs";
import { invokeRepositoryCloudVerifier } from "./cloud-collaboration-delivery-verifier.mjs";
import { invokeRepositoryCloudAction, verifyAdmissionCloudAuthority }
  from "./scoped-lane-cloud-authority.mjs";
import { normalizeBoundAuthority } from "./scoped-lane-cloud-reconciliation.mjs";
import { createWriterLeaseStore, parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody }
  from "./writer-lease-lib.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
const PHASES = Object.freeze(["intent", "snapshot", "cloud", "local-cas", "pr-marker", "complete"]);
const GITHUB_BODY_LIMIT = 65_536, PREFLIGHT_MARGIN = 4_096;
export function createActiveOwnedDirtRecoveryControllerAdapter(methods = {}) {
  const names = [
    "readState", "beginIntent", "markIntent", "createSnapshot",
    "recoverCloud", "projectLocal", "projectPullRequest", "finalize",
  ];
  const adapter = Object.freeze(Object.fromEntries(names.map(name => [name, methods[name]])));
  for (const name of names) {
    if (typeof adapter[name] !== "function") {
      throw new Error(`Active-owned-dirt recovery adapter requires ${name}().`);
    }
  }
  return adapter;
}
export function invokeActiveOwnedDirtRecoveryContinue({ invoke, invocation }) {
  if (typeof invoke !== "function" || !invocation || typeof invocation !== "object") {
    throw new Error("Active-owned-dirt cloud continuation requires an exact invocation.");
  }
  try {
    return invoke(invocation);
  } catch {
    return invoke(invocation);
  }
}
export async function runActiveOwnedDirtRecovery({ authorization = null } = {}, { adapter } = {}) {
  if (!adapter) throw new Error("Active-owned-dirt recovery adapter is required.");
  const state = await adapter.readState();
  const selected = selectActiveOwnedDirtRecoveryPlan({
    state, ttlSeconds: state.ttlSeconds,
  });
  const plan = selected.plan;
  const existing = selected.resumeIntent
    ? normalizeActiveOwnedDirtRecoveryIntent(state.intent) : null;
  const receipts = [buildActiveOwnedDirtRecoveryReceipt({
    phase: "preflight", plan, values: { evidenceDigest: plan.evidenceDigest },
  })];
  if (!existing) authorizeActiveOwnedDirtRecovery({ plan, authorization });
  const begun = existing ? null : await adapter.beginIntent({ plan });
  let intent = existing || normalizeActiveOwnedDirtRecoveryIntent(begun?.intent || begun);
  requireIntentPlan(intent, plan);
  let snapshot = intent.snapshot;
  if (!atLeast(intent.status, "snapshot")) {
    snapshot = await adapter.createSnapshot({ plan, intent });
    intent = normalizeActiveOwnedDirtRecoveryIntent(await adapter.markIntent({
      plan, intent, status: "snapshot", values: { snapshot },
    }));
  }
  receipts.push(buildActiveOwnedDirtRecoveryReceipt({
    phase: "snapshot", plan, values: {
      snapshotReceiptDigest: requiredDigest(snapshot?.snapshotReceiptDigest, "snapshot receipt digest"),
      snapshotCommitSha: requiredObjectId(snapshot?.commitSha, "snapshot commit"),
    },
  }));
  let cloud = intent.cloud;
  if (!atLeast(intent.status, "cloud")) {
    cloud = await adapter.recoverCloud({ plan, intent, snapshot });
    intent = normalizeActiveOwnedDirtRecoveryIntent(await adapter.markIntent({
      plan, intent, status: "cloud", values: { cloud },
    }));
  }
  receipts.push(buildActiveOwnedDirtRecoveryReceipt({
    phase: "cloud", plan, values: {
      cloudReceiptDigest: requiredDigest(cloud?.cloudReceiptDigest, "cloud receipt digest"),
      recoveredClaimDigest: requiredDigest(cloud?.claimDigest, "recovered claim digest"),
    },
  }));
  let localProjection = intent.localProjection;
  if (!atLeast(intent.status, "local-cas")) {
    const result = await adapter.projectLocal({ plan, intent, snapshot, cloud });
    intent = normalizeActiveOwnedDirtRecoveryIntent(result.intent);
    localProjection = intent.localProjection;
  }
  receipts.push(buildActiveOwnedDirtRecoveryReceipt({
    phase: "local-cas", plan, values: {
      leaseDigest: requiredDigest(localProjection?.leaseDigest, "recovered lease digest"),
      mutationAuthorityReceiptDigest: requiredDigest(
        localProjection?.mutationAuthorityReceiptDigest,
        "mutation-authority receipt digest",
      ),
    },
  }));
  let pullRequestProjection = intent.pullRequestProjection;
  if (!atLeast(intent.status, "pr-marker")) {
    pullRequestProjection = await adapter.projectPullRequest({
      plan, intent, snapshot, cloud, localProjection,
    });
    intent = normalizeActiveOwnedDirtRecoveryIntent(await adapter.markIntent({
      plan, intent, status: "pr-marker", values: { pullRequestProjection },
    }));
  }
  receipts.push(buildActiveOwnedDirtRecoveryReceipt({
    phase: "pr-marker", plan, values: {
      markerDigest: requiredDigest(pullRequestProjection?.markerDigest, "marker digest"),
    },
  }));
  let finalReceiptDigest = intent.finalReceiptDigest;
  const final = await adapter.finalize({ plan, intent, snapshot, cloud });
  const observedFinalDigest = requiredDigest(final.receiptDigest, "final receipt digest");
  if (atLeast(intent.status, "complete")) {
    if (observedFinalDigest !== finalReceiptDigest) {
      throw new Error("Completed recovery live verification drifted from its final receipt.");
    }
  } else {
    finalReceiptDigest = observedFinalDigest;
    intent = normalizeActiveOwnedDirtRecoveryIntent(await adapter.markIntent({
      plan, intent, status: "complete", values: { finalReceiptDigest },
    }));
  }
  return Object.freeze({
    schema: "agentic-active-owned-dirt-recovery-result/v1",
    status: "recovered",
    planDigest: plan.planDigest,
    snapshotRef: snapshot.snapshotRef,
    snapshotCommitSha: snapshot.commitSha,
    snapshotIndexCommitSha: snapshot.indexCommitSha,
    finalReceiptDigest,
    mutationAuthorityReceiptDigest: localProjection.mutationAuthorityReceiptDigest,
    receipts,
  });
}
export function createRepositoryActiveOwnedDirtRecoveryAdapter({
  repository,
  sessionId,
  taskAuthorityFile = null,
  ttlSeconds = 1_800,
  environment = process.env,
  now = () => new Date(),
  gitText = null,
  ghText = null,
  run = null,
  captureEvidence = null,
  leaseStore = null,
  invoke = invokeRepositoryCloudAction,
  verify = invokeRepositoryCloudVerifier,
} = {}) {
  const root = realpathSync(path.resolve(requiredText(repository, "repository")));
  gitText ||= defaultGitText(root); ghText ||= defaultGhText(root); run ||= defaultRun(root);
  captureEvidence ||= () => captureActiveOwnedDirtEvidence({ repository: root });
  const repositoryRoot = realpathSync(path.resolve(root, gitText(["rev-parse", "--show-toplevel"])));
  if (repositoryRoot !== root) throw new Error("Recovery requires the exact repository worktree root.");
  const pinnedBranch = requiredText(gitText(["branch", "--show-current"]), "branch");
  assertRegisteredWorktree({ root, branch: pinnedBranch, gitText });
  const sourceSession = requiredText(sessionId, "session ID");
  const ttl = boundedTtl(ttlSeconds);
  const commonDir = realpathSync(path.resolve(root, gitText(["rev-parse", "--git-common-dir"])));
  const store = leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDir,
    taskAuthorityFile,
  });
  const readState = () => {
    const branch = requiredText(gitText(["branch", "--show-current"]), "branch");
    if (branch !== pinnedBranch) throw new Error("Recovery branch changed after repository pinning.");
    const lease = store.read(branch);
    if (!lease || lease.sessionId !== sourceSession
      || realpathSync(lease.worktreePath) !== root) {
      throw new Error("Recovery belongs only to the exact source session and worktree.");
    }
    assertRegisteredWorktree({ root, branch, gitText });
    const headSha = requiredSha(gitText(["rev-parse", "HEAD"]), "HEAD");
    const remoteHeadSha = firstSha(gitText([
      "ls-remote", "--heads", "origin", `refs/heads/${branch}`,
    ]));
    const remoteMainSha = firstSha(gitText([
      "ls-remote", "--heads", "origin", "refs/heads/main",
    ]));
    const pullRequest = readActiveOwnedDirtRecoveryPullRequest({
      url: lease.pullRequestUrl, branch,
      targetRepository: lease.cloudAuthority?.targetRepository, ghText,
    });
    const marker = parseWriterLeasePullRequestBody(pullRequest.body);
    const status = invoke({
      action: "status",
      ledgerRepository: lease.cloudAuthority?.ledgerRepository,
      request: { targetRepository: lease.cloudAuthority?.targetRepository },
      environment,
    });
    const claims = Array.isArray(status?.claims) ? status.claims : [];
    const matches = claims.filter(candidate => candidate?.claimId === lease.cloudAuthority?.claimId);
    if (matches.length !== 1) throw new Error("Recovery requires exactly one live source claim.");
    const claim = matches[0];
    const overlappingClaims = claims.filter(candidate => (
      candidate?.claimId !== claim.claimId
      && candidate?.scopeReserved !== false
      && !["retired", "released", "revoked"].includes(candidate?.state)
    ));
    const evidence = captureEvidence();
    const expectedMarker = projectWriterLeasePullRequestMarker(lease);
    const protectedMainAdvance = captureProtectedMainAdvance({
      baseSha: lease.baseSha, pullRequestBaseSha: pullRequest.baseRefOid,
      protectedMainSha: remoteMainSha,
      declaredWriteSet: lease.admission?.declaredWriteSet, gitText,
    });
    const confirmedRemoteHeadSha = firstSha(gitText([
      "ls-remote", "--heads", "origin", `refs/heads/${branch}`,
    ]));
    const confirmedRemoteMainSha = firstSha(gitText([
      "ls-remote", "--heads", "origin", "refs/heads/main",
    ]));
    if (confirmedRemoteHeadSha !== remoteHeadSha
      || confirmedRemoteMainSha !== remoteMainSha) {
      throw new Error("Remote branch or protected main changed during evidence capture.");
    }
    const source = {
      sessionId: sourceSession,
      branch,
      lease,
      leaseDigest: writerLeaseDigest(lease),
      headSha,
      remoteHeadSha,
      remoteMainSha,
      pullRequest,
      pullRequestBodyDigest: digestValue(pullRequest.body),
      markerDigest: digestValue(marker),
      expectedMarker,
      worktreeIdentityDigest: digestValue({ branch, commonDir, root }),
      claim,
      overlappingClaims,
      ledgerRevision: status.ledgerRevision,
      ledgerDigest: status.ledgerDigest,
      evidence,
      protectedMainAdvance,
      evaluatedAt: now().toISOString(),
    };
    return Object.freeze({
      source,
      intent: readActiveOwnedDirtRecoveryIntent({ leaseStore: store, branch }),
      ttlSeconds: ttl,
    });
  };
  const requirePreLocalState = (plan, { allowRecoveredClaim = false } = {}) => {
    const current = readState();
    const normalized = normalizeActiveOwnedDirtRecoveryPlan(plan);
    assertActiveOwnedDirtPlanSource({ plan: normalized, current, allowRecoveredClaim });
    requireLaneFence(current, normalized, gitText);
    requireProtectedMainEquivalent({
      planned: normalized.sourceProtectedMainAdvance,
      observed: current.source.protectedMainAdvance,
      gitText,
    });
    requireEvidence(plan, current.source.evidence);
    return current;
  };
  const currentLeaseDigest = intent => intent.localProjection?.leaseDigest
    || intent.sourceLeaseDigest;
  return createActiveOwnedDirtRecoveryControllerAdapter({
    readState,
    beginIntent({ plan }) {
      const current = requirePreLocalState(plan);
      return beginActiveOwnedDirtRecoveryIntent({
        leaseStore: store,
        branch: current.source.branch,
        expectedLeaseDigest: plan.sourceLeaseDigest,
        expectedClaimId: plan.sourceClaimId,
        plan,
      });
    },
    markIntent({ plan, intent, status, values }) {
      const current = readState();
      return advanceActiveOwnedDirtRecoveryIntent({
        leaseStore: store,
        branch: current.source.branch,
        expectedLeaseDigest: currentLeaseDigest(intent),
        expectedClaimId: plan.sourceClaimId,
        planDigest: plan.planDigest,
        status,
        values,
      }).intent;
    },
    createSnapshot({ plan }) {
      const before = requirePreLocalState(plan);
      const snapshot = createActiveOwnedDirtSnapshot({
        repository: root,
        evidence: before.source.evidence,
        claimId: plan.sourceClaimId,
        planDigest: plan.planDigest,
        timestamp: plan.snapshotTimestamp,
      });
      const after = requirePreLocalState(plan);
      requireSameActiveOwnedDirtEvidence(before.source.evidence, after.source.evidence);
      return snapshot;
    },
    recoverCloud({ plan, snapshot }) {
      verifyActiveOwnedDirtSnapshot({ repository: root, snapshot });
      const current = requirePreLocalState(plan, { allowRecoveredClaim: true });
      preflightPullRequestBody({ lease: current.source.lease, pullRequest: current.source.pullRequest });
      const recoveryRequest = createActiveOwnedDirtCloudRecoveryRequest({
        plan, recoveryEvidenceDigest: snapshot.snapshotReceiptDigest,
      });
      const invocation = {
        action: "continue",
        ledgerRepository: current.source.lease.cloudAuthority.ledgerRepository,
        request: {
          targetRepository: current.source.lease.cloudAuthority.targetRepository,
          ...recoveryRequest,
        },
        environment,
      };
      const result = invokeActiveOwnedDirtRecoveryContinue({ invoke, invocation });
      const cloud = verifyActiveOwnedDirtCloudRecovery({
        plan,
        result,
        recoveryEvidenceDigest: snapshot.snapshotReceiptDigest,
      });
      const authority = normalizeBoundAuthority({
        result: { ...result, ledgerDigest: cloud.ledgerDigest },
        authority: current.source.lease.cloudAuthority,
        manifest: current.source.lease.admission,
        deviceId: plan.sourceDevice,
        sessionId: plan.sourceSessionId,
      });
      const verified = verifyAdmissionCloudAuthority({
        authority,
        manifest: current.source.lease.admission,
        canonicalBaseSha: plan.sourceBaseSha,
        environment,
        inspect: invoke,
        invoke: verify,
      });
      return Object.freeze({
        ...cloud,
        authority: verifiedHeartbeatAuthority(verified),
        cloudVerificationReceiptDigest: requiredDigest(
          verified.verification.receiptDigest,
          "cloud verification receipt digest",
        ),
      });
    },
    projectLocal({ plan, snapshot, cloud }) {
      const current = readState();
      if (writerLeaseDigest(current.source.lease) !== plan.sourceLeaseDigest) {
        throw new Error("Source lease drifted before local recovery CAS.");
      }
      requireLaneFence(current, plan, gitText);
      if (current.source.pullRequestBodyDigest !== plan.sourcePullRequestBodyDigest
        || current.source.markerDigest !== plan.sourceMarkerDigest) {
        throw new Error("Pull-request body drifted before local recovery CAS.");
      }
      requireEvidence(plan, current.source.evidence);
      verifyActiveOwnedDirtSnapshot({ repository: root, snapshot });
      const verification = verifyAdmissionCloudAuthority({
        authority: cloud.authority,
        manifest: current.source.lease.admission,
        canonicalBaseSha: plan.sourceBaseSha,
        environment,
        inspect: invoke,
        invoke: verify,
      });
      const recovery = createActiveOwnedDirtLeaseRecovery({
        plan, snapshot, cloud, recoveredAt: cloud.recoveredAt,
      });
      const projected = projectActiveOwnedDirtRecoveredLease({
        leaseStore: store,
        branch: plan.sourceBranch,
        expectedLeaseDigest: plan.sourceLeaseDigest,
        expectedClaimId: plan.sourceClaimId,
        planDigest: plan.planDigest,
        cloudAuthority: verification.authority,
        recovery,
        taskAuthorityFile,
        validateLease: candidate => {
          assertBodyLimit(updateWriterLeasePullRequestBody(
            current.source.pullRequest.body,
            candidate,
          ));
          return assertActiveDraftMutationAuthority({
            lease: candidate,
            cloudAuthority: verification.authority,
            remoteAuthorityVerification: verification.verification,
            pullRequest: current.source.pullRequest,
          });
        },
      });
      requireEvidence(plan, captureEvidence());
      return projected;
    },
    projectPullRequest({ plan, snapshot, cloud, localProjection }) {
      const current = readState();
      requireLaneFence(current, plan, gitText);
      assertRecoveredLease({ lease: current.source.lease, plan, snapshot, cloud, localProjection });
      requireEvidence(plan, current.source.evidence);
      const expectedMarker = projectWriterLeasePullRequestMarker(current.source.lease);
      const currentMarker = parseWriterLeasePullRequestBody(current.source.pullRequest.body);
      if (digestValue(currentMarker) === digestValue(expectedMarker)) {
        return Object.freeze({
          markerDigest: digestValue(expectedMarker),
          bodyDigest: digestValue(current.source.pullRequest.body),
        });
      }
      if (current.source.pullRequestBodyDigest !== plan.sourcePullRequestBodyDigest
        || current.source.markerDigest !== plan.sourceMarkerDigest) {
        throw new Error("Pull-request body drifted before recovered marker projection.");
      }
      const body = updateWriterLeasePullRequestBody(
        current.source.pullRequest.body,
        current.source.lease,
      );
      assertBodyLimit(body);
      run("gh", ["pr", "edit", plan.sourcePullRequestUrl, "--body", body]);
      const verified = readState();
      if (verified.source.pullRequest.isDraft !== true
        || verified.source.pullRequest.headRefOid !== plan.sourceFenceSha
        || digestValue(parseWriterLeasePullRequestBody(verified.source.pullRequest.body))
          !== digestValue(expectedMarker)) {
        throw new Error("Recovered pull-request marker did not retain exact draft ownership.");
      }
      return Object.freeze({
        markerDigest: digestValue(expectedMarker),
        bodyDigest: digestValue(verified.source.pullRequest.body),
      });
    },
    finalize({ plan, snapshot, cloud }) {
      const current = readState();
      requireLaneFence(current, plan, gitText);
      verifyActiveOwnedDirtSnapshot({ repository: root, snapshot });
      requireEvidence(plan, current.source.evidence);
      assertRecoveredLease({
        lease: current.source.lease,
        plan,
        snapshot,
        cloud,
        localProjection: current.intent.localProjection,
      });
      const marker = parseWriterLeasePullRequestBody(current.source.pullRequest.body);
      if (digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(current.source.lease))) {
        throw new Error("Final recovered pull-request marker drifted.");
      }
      const verified = verifyAdmissionCloudAuthority({
        authority: current.source.lease.cloudAuthority,
        manifest: current.source.lease.admission,
        canonicalBaseSha: plan.sourceBaseSha,
        environment, inspect: invoke, invoke: verify,
      });
      buildActiveOwnedDirtRecoveryFinalizeMutationAuthority({
        lease: current.source.lease, currentAuthority: current.source.lease.cloudAuthority,
        verifiedAuthority: verified.authority,
        remoteAuthorityVerification: verified.verification,
        currentClaim: current.source.claim, pullRequest: current.source.pullRequest,
      });
      return buildActiveOwnedDirtRecoveryReceipt({
        phase: "complete",
        plan,
        values: {
          snapshotReceiptDigest: snapshot.snapshotReceiptDigest,
          recoveredLeaseDigest: writerLeaseDigest(current.source.lease),
          markerDigest: digestValue(marker),
          mutationAuthorityReceiptDigest:
            current.intent.localProjection.mutationAuthorityReceiptDigest,
        },
      });
    },
  });
}
function requireEvidence(plan, observed) {
  if (observed?.evidenceDigest !== plan.evidenceDigest
    || observed?.pathCount !== plan.dirtyPathCount
    || observed?.headSha !== plan.sourceFenceSha) {
    throw new Error("Active-owned-dirt evidence drifted from the authorized plan.");
  }
}
function assertRecoveredLease({ lease, plan, snapshot, cloud, localProjection }) {
  if (writerLeaseDigest(lease) !== localProjection?.leaseDigest
    || lease.status !== "active" || lease.sessionId !== plan.sourceSessionId
    || lease.device !== plan.sourceDevice || lease.branch !== plan.sourceBranch
    || lease.fenceSha !== plan.sourceFenceSha || lease.baseSha !== plan.sourceBaseSha
    || lease.cloudAuthority?.claimId !== plan.sourceClaimId
    || lease.cloudAuthority?.claimDigest !== cloud.claimDigest
    || lease.cloudAuthority?.transitionCounter !== plan.sourceCloudTransitionCounter + 1
    || lease.admission?.writeSetDigest !== plan.sourceWriteSetDigest
    || lease.activeOwnedDirtRecovery?.planDigest !== plan.planDigest
    || lease.activeOwnedDirtRecovery?.snapshotReceiptDigest !== snapshot.snapshotReceiptDigest
    || lease.activeOwnedDirtRecovery?.snapshotIndexCommitSha !== snapshot.indexCommitSha) {
    throw new Error("Recovered local lease changed ownership or admitted identity.");
  }
}
export function requireLaneFence(current, plan, gitText) {
  const source = current.source;
  if (source.headSha !== plan.sourceFenceSha || source.remoteHeadSha !== plan.sourceFenceSha
    || source.pullRequest.isDraft !== true
    || source.pullRequest.headRefOid !== plan.sourceFenceSha
    || source.pullRequest.baseRefOid !== plan.sourceProtectedMainAdvance.pullRequestBaseSha) {
    throw new Error("Branch, remote, protected base, or draft pull request drifted.");
  }
  requireProtectedMainEquivalent({
    planned: plan.sourceProtectedMainAdvance,
    observed: source.protectedMainAdvance,
    gitText,
  });
}
function assertRegisteredWorktree({ root, branch, gitText }) {
  const listing = gitText(["worktree", "list", "--porcelain", "-z"]);
  const matches = listing.split("\0\0").filter(record =>
    record.split("\0").includes(`branch refs/heads/${branch}`));
  const worktree = matches.length === 1
    ? matches[0].split("\0").find(field => field.startsWith("worktree "))?.slice(9) : null;
  if (!worktree || realpathSync(worktree) !== root) {
    throw new Error("Recovery requires the exact registered attached worktree.");
  }
}
function preflightPullRequestBody({ lease, pullRequest }) {
  const body = updateWriterLeasePullRequestBody(pullRequest.body, {
    ...lease,
    activeOwnedDirtRecovery: {
      schema: "agentic-active-owned-dirt-recovery-lease/v1", status: "recovered",
      sourceEpoch: lease.epoch, sourceSessionId: lease.sessionId,
      sourceDevice: lease.device, sourceBranch: lease.branch,
      sourceFenceSha: lease.fenceSha, sourceClaimId: "f".repeat(64),
      planDigest: "f".repeat(64), evidenceDigest: "f".repeat(64),
      snapshotReceiptDigest: "f".repeat(64),
      snapshotRef: `refs/agentic-canvas-os/recovery/active-owned-dirt/${"f".repeat(64)}/${"f".repeat(64)}`,
      snapshotCommitSha: "f".repeat(40), snapshotIndexCommitSha: "f".repeat(40),
      recoveredClaimDigest: "f".repeat(64),
      recoveredLedgerRevision: "f".repeat(40), recoveredClaimLedgerRevision: "f".repeat(64),
      recoveredTransitionCounter: lease.cloudAuthority.transitionCounter + 1,
      recoveredAt: lease.heartbeatAt,
    },
  });
  if (Buffer.byteLength(body) > GITHUB_BODY_LIMIT - PREFLIGHT_MARGIN) {
    throw new Error("Recovered pull-request marker cannot safely fit GitHub's body limit.");
  }
}
function assertBodyLimit(value) {
  if (Buffer.byteLength(value) > GITHUB_BODY_LIMIT) throw new Error(
    "Recovered pull-request marker exceeds GitHub's body limit.");
}
function requireIntentPlan(intent, plan) {
  if (intent.planDigest !== plan.planDigest
    || intent.sourceLeaseDigest !== plan.sourceLeaseDigest
    || intent.sourceClaimId !== plan.sourceClaimId) throw new Error(
      "Recovery intent drifted from the exact plan.");
}
function atLeast(current, expected) { return phaseIndex(current) >= phaseIndex(expected); }
function phaseIndex(value) {
  const index = PHASES.indexOf(value);
  if (index < 0) throw new Error("Recovery phase is invalid.");
  return index; }
function defaultGitText(repository) {
  return args => execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim(); }
function defaultGhText(repository) {
  return args => execFileSync("gh", args, { cwd: repository, encoding: "utf8" }).trim(); }
function defaultRun(repository) {
  return (command, args) => execFileSync(command, args, {
    cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], }); }
function firstSha(value) { return requiredSha(
  String(value || "").trim().split(/\s+/u)[0], "remote SHA"); }
function boundedTtl(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 60 || parsed > 86_400) throw new Error(
    "Recovery TTL must be an integer from 60 through 86400 seconds.");
  return parsed; }
function requiredObjectId(value, label) {
  const candidate = String(value || "");
  if (!/^[0-9a-f]{40,64}$/u.test(candidate)) throw new Error(`${label} must be a Git object ID.`);
  return candidate; }
function requiredSha(value, label) {
  const candidate = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/u.test(candidate)) throw new Error(`${label} must be a SHA.`);
  return candidate; }
function requiredDigest(value, label) {
  const candidate = String(value || "");
  if (!/^[0-9a-f]{64}$/u.test(candidate)) throw new Error(`${label} must be a SHA-256 digest.`);
  return candidate; }
function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim(); }
