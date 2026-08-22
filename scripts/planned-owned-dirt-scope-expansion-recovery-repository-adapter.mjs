// Responsibility: Join source, cloud, task, review, and controller evidence to bounded successor mutations.
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  captureActiveOwnedDirtEvidence,
} from "./active-owned-dirt-recovery-evidence.mjs";
import { digestValue, normalizeWriteSet, writeSetsOverlap }
  from "./cloud-collaboration-primitives.mjs";
import { invokeRepositoryCloudVerifier }
  from "./cloud-collaboration-delivery-verifier.mjs";
import { readOwnershipPullRequest } from "./device-pull-request-state.mjs";
import { assertAdmissionMutationAuthority }
  from "./scoped-lane-admission-state.mjs";
import {
  bindAdmissionCloudAuthority,
  invokeRepositoryCloudAction,
  verifyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import { normalizeBoundAuthority } from "./scoped-lane-cloud-reconciliation.mjs";
import {
  authorizeTaskBoundLeaseMutation,
  continueTaskAuthorityCloudSuccessorBinding,
} from "./task-bound-lane-authority-store.mjs";
import {
  createWriterLeaseStore,
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import {
  mutateWriterLeaseRegistry,
  withHeartbeatProjectionFence,
  writerLeaseDigest,
} from "./writer-lease-registry-cas.mjs";
import {
  OPERATION,
  normalizePlannedOwnedDirtScopeExpansionRecoveryPlan,
} from "./planned-owned-dirt-scope-expansion-recovery-contract.mjs";
import {
  buildPlannedOwnedDirtScopeExpansionRecoveryEvidence,
  requireSamePlannedOwnedDirt,
} from "./planned-owned-dirt-scope-expansion-recovery-evidence.mjs";
import {
  createPlannedOwnedDirtScopeExpansionStore,
  resolvePlannedOwnedDirtScopeExpansionJournalPath,
} from "./planned-owned-dirt-scope-expansion-recovery-store.mjs";

const CONTROLLER_ROOT = fileURLToPath(new URL("..", import.meta.url));
const IMPLEMENTATION_FILES = Object.freeze([
  "scripts/planned-owned-dirt-scope-expansion-recovery-contract.mjs",
  "scripts/planned-owned-dirt-scope-expansion-recovery-controller.mjs",
  "scripts/planned-owned-dirt-scope-expansion-recovery-evidence.mjs",
  "scripts/planned-owned-dirt-scope-expansion-recovery-repository-adapter.mjs",
  "scripts/planned-owned-dirt-scope-expansion-recovery-store.mjs",
  "scripts/planned-owned-dirt-scope-expansion-recovery.mjs",
]);

export function createRepositoryPlannedOwnedDirtScopeExpansionRecoveryAdapter(
  options = {}, dependencies = {},
) {
  const repository = realpathSync(path.resolve(required(options.repository, "repository")));
  const sessionId = required(options.sessionId, "session ID");
  const taskAuthorityFile = options.taskAuthorityFile
    ? realpathSync(path.resolve(options.taskAuthorityFile)) : null;
  const ttlSeconds = integer(options.ttlSeconds ?? 28_800, "TTL seconds", 60, 86_400);
  const environment = options.environment || process.env;
  const execute = dependencies.execute || ((command, argumentsList, commandOptions = {}) =>
    execFileSync(command, argumentsList, { cwd: repository, encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
      ...commandOptions }));
  const git = dependencies.git || ((argumentsList, commandOptions = {}) =>
    String(execute("git", argumentsList, commandOptions)).trim());
  const gh = dependencies.gh || (argumentsList => String(execute("gh", argumentsList)).trim());
  const invoke = dependencies.invoke || invokeRepositoryCloudAction;
  const verify = dependencies.verify || invokeRepositoryCloudVerifier;
  const now = dependencies.now || (() => new Date());
  const controllerRoot = dependencies.controllerRoot || CONTROLLER_ROOT;
  const commonDirectory = realpathSync(path.resolve(
    repository, git(["rev-parse", "--git-common-dir"]),
  ));
  const branch = required(git(["branch", "--show-current"]), "attached source branch");
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory, taskAuthorityPolicy: "projected",
  });

  function sourceLease() {
    const lease = leaseStore.read(branch);
    if (lease?.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
      || lease.branch !== branch || lease.sessionId !== sessionId
      || path.resolve(lease.worktreePath || "") !== repository
      || lease.admission?.status !== "planned" || !lease.cloudAuthority
      || !lease.taskAuthority || lease.fenceSha !== git(["rev-parse", "HEAD"])) {
      invalid("exact planned task-bound source lease");
    }
    return lease;
  }

  function controllerWitness() {
    const run = argumentsList => String(execFileSync("git", argumentsList,
      { cwd: controllerRoot, encoding: "utf8" })).trim();
    const headSha = sha(run(["rev-parse", "HEAD"]), "controller HEAD");
    const originMainSha = sha(run(["rev-parse", "origin/main"]), "controller origin/main");
    const remoteMainSha = firstSha(run(["ls-remote", "--heads", "origin", "refs/heads/main"]));
    if (headSha !== originMainSha || headSha !== remoteMainSha
      || run(["status", "--porcelain=v1", "--untracked-files=all"]) !== "") {
      invalid("clean protected controller");
    }
    return Object.freeze({ headSha, implementationDigest: digestValue(
      IMPLEMENTATION_FILES.map(file => ({ file,
        digest: digestValue(readFileSync(path.join(controllerRoot, file))) })),
    ) });
  }

  function readPullRequest(lease) {
    const pullRequest = readOwnershipPullRequest({
      url: lease.pullRequestUrl, branch, ghText: gh,
    });
    if (pullRequest.isDraft !== true || pullRequest.headRefOid !== lease.fenceSha) {
      invalid("open draft source pull request");
    }
    const autoMerge = JSON.parse(gh(["pr", "view", lease.pullRequestUrl,
      "--json", "autoMergeRequest"])).autoMergeRequest;
    if (autoMerge !== null) invalid("source pull request auto-merge state");
    const marker = parseWriterLeasePullRequestBody(pullRequest.body);
    const projected = projectWriterLeasePullRequestMarker(lease);
    if (canonical(marker) !== canonical(projected)) {
      invalid("source pull-request writer marker");
    }
    return pullRequest;
  }

  function status(lease) {
    const result = invoke({ action: "status",
      ledgerRepository: lease.cloudAuthority.ledgerRepository,
      request: { targetRepository: lease.cloudAuthority.targetRepository }, environment });
    if (result?.schema !== "agentic-cloud-collaboration-result/v1" || result.ok !== true
      || result.action !== "status" || !Array.isArray(result.claims)) invalid("cloud status");
    return result;
  }

  function sourceCloud(lease, inventory, targetWriteSet = null) {
    const matches = inventory.claims.filter(item =>
      item.claimId === lease.cloudAuthority.claimId);
    if (matches.length !== 1) invalid("source cloud claim cardinality");
    const claim = matches[0];
    if (!["current", "dormant-preserved"].includes(claim.state)
      || claim.scopeReserved !== true || claim.canonicalBaseRevision !== lease.baseSha
      || claim.laneRevision !== lease.fenceSha
      || claim.writeSetDigest !== lease.admission.writeSetDigest
      || claim.reviewRequestId !== lease.cloudAuthority.reviewRequestId
      || canonical(normalizeWriteSet(claim.declaredWriteScope))
        !== canonical(lease.admission.declaredWriteSet)) invalid("source cloud claim");
    const future = targetWriteSet || lease.admission.declaredWriteSet;
    const overlaps = inventory.claims.filter(item => item.claimId !== claim.claimId
      && (item.writeAuthority === true || item.scopeReserved === true)
      && writeSetsOverlap(item.declaredWriteScope, future));
    if (overlaps.length > 0) invalid("competing expanded cloud claim");
    return claim;
  }

  function remoteHead() {
    return firstSha(git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]));
  }

  function capture(targetManifest, fixedObservedAt = null) {
    const lease = sourceLease();
    if (remoteHead() !== lease.fenceSha) invalid("source remote fence");
    const remoteMain = firstSha(git(["ls-remote", "--heads", "origin", "refs/heads/main"]));
    if (remoteMain !== lease.baseSha) invalid("source canonical base drift");
    readPullRequest(lease);
    const inventory = status(lease);
    const targetWriteSet = targetManifest?.declaredWriteSet || targetManifest?.paths
      ?.map(item => `path:${item}`).concat(`semantic:${targetManifest.semanticScope}`);
    const claim = sourceCloud(lease, inventory, targetWriteSet);
    const dirt = captureActiveOwnedDirtEvidence({ repository });
    if (dirt.headSha !== lease.fenceSha) invalid("source dirt fence");
    const controller = controllerWitness();
    const observedAt = fixedObservedAt || now().toISOString();
    return buildPlannedOwnedDirtScopeExpansionRecoveryEvidence({
      repositoryPathDigest: digestValue(repository),
      targetRepository: lease.cloudAuthority.targetRepository,
      ledgerRepository: lease.cloudAuthority.ledgerRepository,
      branch, sessionId, device: lease.device, scope: lease.scope,
      baseSha: lease.baseSha, fenceSha: lease.fenceSha,
      leaseDigest: writerLeaseDigest(lease), claimId: claim.claimId,
      claimDigest: claim.fenceRevision,
      claimTransitionCounter: claim.transitionCounter, claimState: claim.state,
      reviewRequestId: claim.reviewRequestId, pullRequestUrl: lease.pullRequestUrl,
      declaredWriteSet: lease.admission.declaredWriteSet,
      writeSetDigest: lease.admission.writeSetDigest,
      manifestDigest: lease.admission.manifestDigest,
      existingLaneStateDigest: lease.admission.existingLaneStateDigest,
      ownedDirt: dirt, taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
      cloudLedgerRevision: inventory.ledgerRevision,
      cloudLedgerDigest: inventory.ledgerDigest,
      controllerDigest: digestValue(controller), observedAt,
    });
  }

  function store(plan) {
    return createPlannedOwnedDirtScopeExpansionStore({
      statePath: resolvePlannedOwnedDirtScopeExpansionJournalPath({
        commonDirectory, claimId: plan.evidence.claimId, planDigest: plan.planDigest,
      }),
    });
  }

  function sourceLocalStable(plan) {
    const lease = sourceLease();
    if (writerLeaseDigest(lease) !== plan.evidence.leaseDigest
      || remoteHead() !== plan.evidence.fenceSha) invalid("sealed source lease");
    readPullRequest(lease);
    requireSamePlannedOwnedDirt(plan.evidence,
      captureActiveOwnedDirtEvidence({ repository }));
    return lease;
  }

  function manifest(plan) {
    return Object.freeze({ schema: "agentic-declared-write-scope/v1",
      semanticScope: plan.target.semanticScope,
      declaredWriteSet: plan.target.declaredWriteSet,
      writeSetDigest: plan.target.writeSetDigest,
      manifestDigest: plan.target.manifestDigest });
  }

  function phaseValues(intent, phase) {
    const values = intent.phases?.[phase]?.values;
    if (!values) invalid(`${phase} journal values`);
    return values;
  }

  function cloudClaimValues(result, expectedAction, expectedState, plan, predecessor = undefined) {
    const claim = result?.claim;
    if (result?.schema !== "agentic-cloud-collaboration-result/v1" || result.ok !== true
      || result.action !== expectedAction || claim?.state !== expectedState
      || claim.canonicalBaseRevision !== plan.evidence.baseSha
      || claim.laneRevision !== plan.evidence.fenceSha
      || claim.writeSetDigest !== plan.target.writeSetDigest
      || claim.leaseEpoch !== 1
      || canonical(normalizeWriteSet(claim.declaredWriteScope))
        !== canonical(plan.target.declaredWriteSet)
      || (predecessor !== undefined && claim.predecessorClaimId !== predecessor)) {
      invalid(`${expectedAction} successor result`);
    }
    return Object.freeze({ claimId: claim.claimId,
      claimDigest: result.claimDigest || claim.fenceRevision,
      transitionCounter: claim.transitionCounter,
      claimLedgerRevision: digest(claim.transitionDigest, "claim ledger revision"),
      ledgerRevision: sha(result.ledgerRevision, "successor ledger revision"),
      receiptDigest: digest(result.receipt?.receiptDigest, "successor receipt"),
      expiresAt: requiredInstant(claim.expiresAt, "successor expiry") });
  }

  function boundAuthority(intent) {
    return phaseValues(intent, "successor-bound").authority;
  }

  function targetLocal(plan, authority) {
    const lease = leaseStore.read(branch);
    if (!lease || lease.cloudAuthority?.claimId !== authority.claimId
      || lease.admission?.status !== "admitted"
      || lease.admission.writeSetDigest !== plan.target.writeSetDigest
      || lease.taskAuthority?.priorBindingDigest !== plan.evidence.taskAuthorityBindingDigest) {
      invalid("projected target lease");
    }
    requireSamePlannedOwnedDirt(plan.evidence,
      captureActiveOwnedDirtEvidence({ repository }));
    return lease;
  }

  return Object.freeze({
    async readEvidence(targetManifest) {
      const first = capture(targetManifest);
      const second = capture(targetManifest, first.observedAt);
      if (first.evidenceDigest !== second.evidenceDigest) invalid("double-read evidence drift");
      return second;
    },
    withOperationLock(plan, action) {
      if (typeof action !== "function") invalid("operation callback");
      return store(plan).withLock
        ? store(plan).withLock(() => action()) : action();
    },
    readIntent(plan) { return store(plan).read(); },
    writeIntent({ expected, next, plan }) { return store(plan).write({ expected, next }); },
    authorizeTask(plan) {
      if (!taskAuthorityFile) invalid("external task-authority capability");
      const lease = sourceLocalStable(plan);
      return authorizeTaskBoundLeaseMutation({ lease, capabilityPath: taskAuthorityFile,
        operation: `${OPERATION}:${plan.planDigest}`, now: now() });
    },
    claimWaitingSuccessor({ plan }) {
      const lease = sourceLocalStable(plan);
      const result = invoke({ action: "claim",
        ledgerRepository: plan.evidence.ledgerRepository,
        request: { targetRepository: plan.evidence.targetRepository,
          workItemId: plan.evidence.scope, canonicalBaseSha: plan.evidence.baseSha,
          headSha: plan.evidence.fenceSha, declaredWriteSet: plan.target.declaredWriteSet,
          predecessorClaimId: plan.evidence.claimId, leaseEpoch: 1, ttlSeconds,
          deviceId: lease.device, sessionId,
          idempotencyKey: `${OPERATION}:waiting:${plan.planDigest}` }, environment });
      return cloudClaimValues(result, "claim", "waiting-successor", plan,
        plan.evidence.claimId);
    },
    retireSource({ plan, intent }) {
      const lease = sourceLocalStable(plan);
      const waiting = phaseValues(intent, "waiting-successor");
      const result = invoke({ action: "retire", ledgerRepository: plan.evidence.ledgerRepository,
        request: { targetRepository: plan.evidence.targetRepository,
          claimId: plan.evidence.claimId,
          expectedFenceRevision: plan.evidence.claimDigest,
          expectedTransitionCounter: plan.evidence.claimTransitionCounter,
          reason: "superseded", finalRevision: plan.evidence.fenceSha,
          reviewRequestId: plan.evidence.reviewRequestId,
          bytesDigest: plan.evidence.dirtDigest,
          namedChecksDigest: digestValue({ planDigest: plan.planDigest, kind: "checks" }),
          handoffEvidenceDigest: digestValue({ planDigest: plan.planDigest,
            successorClaimId: waiting.claimId }), deviceId: lease.device, sessionId,
          idempotencyKey: `${OPERATION}:retire:${plan.planDigest}` }, environment });
      if (result?.ok !== true || result.action !== "retire"
        || result.claim?.claimId !== plan.evidence.claimId
        || !["retired", "released"].includes(result.claim?.state)) invalid("source retirement");
      return Object.freeze({ receiptDigest: digest(result.receipt?.receiptDigest,
        "source retirement receipt") });
    },
    promoteSuccessor({ plan, intent }) {
      sourceLocalStable(plan);
      const waiting = phaseValues(intent, "waiting-successor");
      const result = invoke({ action: "continue", ledgerRepository: plan.evidence.ledgerRepository,
        request: { targetRepository: plan.evidence.targetRepository,
          claimId: waiting.claimId, expectedFenceRevision: waiting.claimDigest,
          expectedTransitionCounter: waiting.transitionCounter, mode: "promote", ttlSeconds,
          deviceId: plan.evidence.device, sessionId,
          idempotencyKey: `${OPERATION}:promote:${plan.planDigest}` }, environment });
      const promoted = cloudClaimValues(result, "continue", "current", plan);
      if (promoted.claimId !== waiting.claimId
        || promoted.transitionCounter !== waiting.transitionCounter + 1) {
        invalid("successor promotion lineage");
      }
      return promoted;
    },
    bindSuccessor({ plan, intent }) {
      const lease = sourceLocalStable(plan);
      const promoted = phaseValues(intent, "successor-promoted");
      const inventory = status(lease);
      const matches = inventory.claims.filter(item => item.claimId === promoted.claimId);
      if (matches.length !== 1 || matches[0].state !== "current"
        || matches[0].fenceRevision !== promoted.claimDigest) invalid("promoted successor status");
      const seed = normalizeBoundAuthority({ result: {
        schema: "agentic-cloud-collaboration-result/v1", ok: true, action: "continue",
        ledgerRevision: inventory.ledgerRevision, ledgerDigest: inventory.ledgerDigest,
        claimDigest: matches[0].fenceRevision, claim: matches[0],
      }, authority: { ...lease.cloudAuthority,
        canonicalBaseSha: plan.evidence.baseSha, laneRevision: plan.evidence.fenceSha,
        cloudDeclaredWriteScope: plan.target.declaredWriteSet,
        writeSetDigest: plan.target.writeSetDigest, leaseEpoch: 1,
        reviewRequestId: null, state: "active",
        manifestDigest: plan.target.manifestDigest }, manifest: manifest(plan),
      deviceId: lease.device, sessionId });
      const bound = bindAdmissionCloudAuthority({ authority: seed, manifest: manifest(plan),
        branch, headSha: plan.evidence.fenceSha,
        reviewRequestId: plan.evidence.reviewRequestId,
        deviceId: lease.device, sessionId,
        idempotencyKey: `${OPERATION}:bind:${plan.planDigest}`,
        returnVerification: true, environment, invoke, inspect: invoke, verify });
      return Object.freeze({ authority: bound.authority,
        verificationReceiptDigest: bound.verification.receiptDigest });
    },
    projectLocal({ plan, intent }) {
      const authority = boundAuthority(intent);
      const observed = leaseStore.read(branch);
      if (observed?.cloudAuthority?.claimId === authority.claimId) {
        const target = targetLocal(plan, authority);
        const verified = verifyAdmissionCloudAuthority({ authority, manifest: manifest(plan),
          canonicalBaseSha: plan.evidence.baseSha, environment, inspect: invoke, invoke: verify });
        const mutation = assertAdmissionMutationAuthority({ lease: target,
          cloudAuthority: verified.authority,
          remoteAuthorityVerification: verified.verification });
        return Object.freeze({ leaseDigest: writerLeaseDigest(target), adopted: true,
          targetTaskAuthorityBindingDigest: target.taskAuthority.bindingDigest,
          mutationAuthorityReceiptDigest: mutation.receiptDigest,
          registryRevision: leaseStore.readRegistry().revision });
      }
      const source = sourceLocalStable(plan);
      const verified = verifyAdmissionCloudAuthority({ authority, manifest: manifest(plan),
        canonicalBaseSha: plan.evidence.baseSha, environment, inspect: invoke, invoke: verify });
      const admission = successorAdmission({ source: source.admission, plan,
        authority: verified.authority });
      const projectedAt = verified.verification.verifiedAt || now().toISOString();
      const nextCore = { ...source, admission, cloudAuthority: verified.authority,
        heartbeatAt: projectedAt, expiresAt: verified.authority.expiresAt };
      const nextLease = { ...nextCore,
        taskAuthority: continueTaskAuthorityCloudSuccessorBinding({ sourceLease: source,
          nextLease: nextCore, capabilityPath: taskAuthorityFile, boundAt: projectedAt }) };
      const mutation = assertAdmissionMutationAuthority({ lease: nextLease,
        cloudAuthority: verified.authority,
        remoteAuthorityVerification: verified.verification });
      const result = mutateWriterLeaseRegistry({ leaseStore, branch,
        expectedLeaseDigest: plan.evidence.leaseDigest,
        expectedClaimId: plan.evidence.claimId,
        action: ({ registry }) => ({ registry: { ...registry,
          leases: { ...registry.leases, [branch]: nextLease } },
        lease: nextLease, changed: true }) });
      targetLocal(plan, verified.authority);
      return Object.freeze({ leaseDigest: writerLeaseDigest(nextLease), adopted: false,
        targetTaskAuthorityBindingDigest: nextLease.taskAuthority.bindingDigest,
        mutationAuthorityReceiptDigest: mutation.receiptDigest,
        registryRevision: result.registryRevision });
    },
    projectPullRequestMarker({ plan, intent }) {
      const authority = boundAuthority(intent);
      const lease = targetLocal(plan, authority);
      const expectedLeaseDigest = writerLeaseDigest(lease);
      const before = readPullRequest(lease);
      const intendedBody = updateWriterLeasePullRequestBody(before.body, lease);
      const existingMarker = parseWriterLeasePullRequestBody(before.body);
      if (canonical(existingMarker) !== canonical(projectWriterLeasePullRequestMarker(lease))) {
        withHeartbeatProjectionFence({ leaseStore, branch, expectedLeaseDigest,
          expectedClaimId: authority.claimId,
          action: () => execute("gh", ["pr", "edit", lease.pullRequestUrl,
            "--body", intendedBody]) });
      }
      const after = readPullRequest(lease);
      const marker = parseWriterLeasePullRequestBody(after.body);
      if (canonical(marker) !== canonical(projectWriterLeasePullRequestMarker(lease))) {
        invalid("projected pull-request marker");
      }
      return Object.freeze({ markerDigest: digestValue(marker),
        receiptDigest: digestValue({ planDigest: plan.planDigest,
          pullRequestUrl: after.url, markerDigest: digestValue(marker) }) });
    },
    verifyTerminal({ plan, intent }) {
      const authority = boundAuthority(intent);
      const lease = targetLocal(plan, authority);
      const verified = verifyAdmissionCloudAuthority({ authority, manifest: manifest(plan),
        canonicalBaseSha: plan.evidence.baseSha, environment, inspect: invoke, invoke: verify });
      const mutation = assertAdmissionMutationAuthority({ lease,
        cloudAuthority: verified.authority,
        remoteAuthorityVerification: verified.verification });
      const pullRequest = readPullRequest(lease);
      const marker = parseWriterLeasePullRequestBody(pullRequest.body);
      if (canonical(marker) !== canonical(projectWriterLeasePullRequestMarker(lease))
        || git(["rev-parse", "HEAD"]) !== plan.evidence.fenceSha
        || remoteHead() !== plan.evidence.fenceSha) invalid("terminal source or marker");
      requireSamePlannedOwnedDirt(plan.evidence,
        captureActiveOwnedDirtEvidence({ repository }));
      return Object.freeze({ mutationAuthorityReceiptDigest: mutation.receiptDigest,
        terminalEvidenceDigest: digestValue({ planDigest: plan.planDigest,
          leaseDigest: writerLeaseDigest(lease), claimDigest: verified.authority.claimDigest,
          dirtDigest: plan.evidence.dirtDigest, markerDigest: digestValue(marker) }) });
    },
  });
}

function successorAdmission({ source, plan, authority }) {
  const admittedReportDigest = digestValue({ schema:
    "agentic-planned-owned-dirt-scope-expansion-admitted-report/v1",
  planDigest: plan.planDigest, claimId: authority.claimId });
  return Object.freeze({ schema: "agentic-lane-admission-lease/v1", status: "admitted",
    semanticScope: plan.target.semanticScope, declaredWriteSet: plan.target.declaredWriteSet,
    writeSetDigest: plan.target.writeSetDigest, manifestDigest: plan.target.manifestDigest,
    planReceiptDigest: plan.planDigest,
    admissionReceiptDigest: authority.operationReceiptDigest,
    existingLaneStateDigest: source.existingLaneStateDigest,
    admittedReportDigest,
    preservationReceiptDigest: digestValue({ schema:
      "agentic-planned-owned-dirt-scope-expansion-preservation/v1",
    planDigest: plan.planDigest, sourceAdmissionDigest: digestValue(source),
    successorClaimId: authority.claimId }) });
}
function canonical(value) { return JSON.stringify(value); }
function firstSha(value) { return sha(String(value).trim().split(/\s+/u)[0], "remote SHA"); }
function required(value, label) { if (typeof value !== "string" || !value.trim()) invalid(label); return value; }
function sha(value, label) { if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label); return value; }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label); return value; }
function requiredInstant(value, label) { if (!Number.isFinite(Date.parse(value))) invalid(label); return value; }
function integer(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) invalid(label); return value;
}
function invalid(label) { throw new Error(`Planned-owned-dirt scope expansion has invalid ${label}.`); }
