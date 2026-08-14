import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { digestValue, normalizeWriteSet, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
import { buildDeliveryAuthorizedBaseRecoveryReceipt } from "./delivery-authorized-base-recovery-contract.mjs";
import {
  complete,
  createDeliveryAuthorizedBaseRecoveryAdapter,
  pending,
} from "./delivery-authorized-base-recovery-controller.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import { collectDeliveryAuthorizedBaseRecoveryEvidence } from "./delivery-authorized-base-recovery-repository-evidence.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import {
  normalizeBoundAuthority,
  projectRootState,
} from "./scoped-lane-cloud-reconciliation.mjs";
import { continueTaskAuthorityBinding } from "./task-bound-lane-authority-store.mjs";
import {
  createWriterLeaseStore,
  parseDeviceBranch,
  parseWriterLeasePullRequestBody,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import { casWriterLeaseProjection, writerLeaseDigest } from "./writer-lease-registry-cas.mjs";

const DIGEST = /^[0-9a-f]{64}$/u;
const RECOVERABLE_SOURCE_STATUSES = new Set(["active", "delivery"]);
const EFFECTS = Object.freeze([
  "pull-request-draft-demotion",
  "same-owner-successor-claim",
  "predecessor-retirement",
  "writer-lease-base-cas",
  "pull-request-marker-projection",
]);

export function requireAuthorizedDeliveryCloudPreimage(plan, cloudStatus) {
  const matches = cloudStatus?.claims?.filter(item => item?.claimId === plan.evidence.claimId) || [];
  const source = matches.length === 1 ? matches[0] : null;
  if (!source || source.fenceRevision !== plan.evidence.claimDigest
    || source.transitionDigest !== plan.evidence.claimLedgerRevision
    || source.transitionCounter !== plan.evidence.claimTransitionCounter
    || source.leaseEpoch !== plan.evidence.claimLeaseEpoch
    || source.actorId !== plan.evidence.claimActorId
    || source.repositoryId !== plan.evidence.claimRepositoryId
    || source.workItemId !== plan.evidence.claimWorkItemId
    || source.canonicalBaseRevision !== plan.evidence.claimCanonicalBaseSha
    || source.laneRevision !== plan.evidence.claimLaneRevision
    || source.writeSetDigest !== plan.evidence.writeSetDigest
    || source.reviewRequestId !== plan.evidence.claimReviewRequestId
    || source.integrationReceiptDigest !== plan.evidence.integrationReceiptDigest
    || source.state !== "dormant-preserved" || source.scopeReserved !== true
    || source.writeAuthority !== false
    || cloudStatus.claims.some(item => item?.claimId !== source.claimId
      && item?.scopeReserved === true
      && writeSetsOverlap(item.declaredWriteScope, plan.evidence.declaredWriteSet))) {
    invalid("authorized cloud preimage drift");
  }
  return source;
}

export function createRepositoryDeliveryAuthorizedBaseRecoveryAdapter(
  options = {},
  dependencies = {},
) {
  const repository = realpathSync(path.resolve(requiredText(options.repository, "repository")));
  const sessionId = requiredText(options.sessionId, "session ID");
  const environment = options.environment || process.env;
  const execute = dependencies.execute || ((command, args, settings = {}) => execFileSync(
    command,
    args,
    { cwd: repository, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, ...settings },
  ));
  const git = dependencies.git || (args => execute("git", args).trim());
  const gh = dependencies.gh || (args => execute("gh", args).trim());
  const cloud = dependencies.cloud || invokeRepositoryCloudAction;
  const branch = requiredText(git(["branch", "--show-current"]), "branch");
  const identity = parseDeviceBranch(branch);
  if (!identity) invalid("agent/device/scope branch");
  const registered = assertRegisteredWorktree({
    cwd: repository,
    porcelain: git(["worktree", "list", "--porcelain", "-z"]),
  });
  if (registered.branch !== `refs/heads/${branch}`) invalid("registered branch");
  const commonDirectory = path.resolve(repository, git(["rev-parse", "--git-common-dir"]));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
  });
  const journalDirectory = path.join(
    commonDirectory,
    "agentic-canvas-os",
    "delivery-authorized-base-recovery",
  );
  const statePath = path.join(
    journalDirectory,
    `${createHash("sha256").update(branch).digest("hex")}.json`,
  );
  const lockPath = `${statePath}.lock`;
  const ttlSeconds = Number(options.ttlSeconds || 3_600);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 300 || ttlSeconds > 86_400) {
    invalid("TTL");
  }

  function readLease() {
    const lease = leaseStore.read(branch);
    if (!lease || lease.schema !== "agentic-writer-lease/v2"
      || !RECOVERABLE_SOURCE_STATUSES.has(lease.status)
      || lease.sessionId !== sessionId || lease.branch !== branch
      || realpathSync(lease.worktreePath) !== repository
      || lease.admission?.status !== "admitted") {
      invalid("exact recoverable owner lease");
    }
    return lease;
  }

  function manifest(lease = readLease()) {
    return Object.freeze({
      semanticScope: lease.scope,
      declaredWriteSet: normalizeWriteSet(lease.admission.declaredWriteSet),
      writeSetDigest: requiredDigest(lease.admission.writeSetDigest, "write-set digest"),
      manifestDigest: requiredDigest(lease.admission.manifestDigest, "manifest digest"),
    });
  }

  function status(authority = readLease().cloudAuthority) {
    const result = cloud({
      action: "status",
      ledgerRepository: authority.ledgerRepository,
      request: { targetRepository: authority.targetRepository },
      environment,
    });
    if (result?.schema !== "agentic-cloud-collaboration-result/v1"
      || result.ok !== true || result.action !== "status" || !Array.isArray(result.claims)) {
      invalid("cloud status");
    }
    return result;
  }

  function cloudAction(action, request, authority = readLease().cloudAuthority) {
    const result = cloud({
      action,
      ledgerRepository: authority.ledgerRepository,
      request: { targetRepository: authority.targetRepository, ...request },
      environment,
    });
    if (result?.schema !== "agentic-cloud-collaboration-result/v1"
      || result.ok !== true || result.action !== action) {
      invalid(`${action} result`);
    }
    return result;
  }

  function fetchExactRefs() {
    execute("git", [
      "fetch",
      "--no-tags",
      "origin",
      "+refs/heads/main:refs/remotes/origin/main",
      `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
    ]);
  }

  function providerSubject() {
    const identityRecord = JSON.parse(gh(["repo", "view", "--json", "id,nameWithOwner"]));
    const actor = JSON.parse(gh(["api", "user"]));
    const pull = JSON.parse(gh([
      "pr",
      "view",
      readLease().pullRequestUrl,
      "--json",
      "author,autoMergeRequest,baseRefName,baseRefOid,body,headRefName,headRefOid,id,isDraft,number,state,url",
    ]));
    return Object.freeze({ actor, repository: identityRecord, pull });
  }

  function sourceClaim(plan, cloudStatus = status()) {
    const matches = cloudStatus.claims.filter(item => item?.claimId === plan.evidence.claimId);
    if (matches.length > 1) invalid("predecessor cardinality");
    return matches[0] || null;
  }

  function protectedSource(plan, candidate = null) {
    fetchExactRefs();
    const current = git(["rev-parse", "refs/remotes/origin/main"]);
    const selected = candidate || current;
    execute("git", ["merge-base", "--is-ancestor", plan.evidence.protectedMainSha, selected]);
    execute("git", ["merge-base", "--is-ancestor", selected, current]);
    const changed = git(["diff", "--name-only", "-z", plan.evidence.protectedMainSha, selected])
      .split("\0").filter(Boolean).map(item => `path:${item}`);
    if (writeSetsOverlap(changed, plan.evidence.declaredWriteSet)) {
      invalid("protected source advance overlaps authorized write set");
    }
    return selected;
  }

  function successor(plan, acceptedStates, cloudStatus = status()) {
    const source = plan.evidence;
    const matches = cloudStatus.claims.filter(item => (
      item?.predecessorClaimId === source.claimId
      && item.actorId === source.claimActorId
      && item.repositoryId === source.claimRepositoryId
      && item.workItemId === source.claimWorkItemId
      && item.laneRevision === source.headSha
      && item.writeSetDigest === source.writeSetDigest
      && item.leaseEpoch === source.claimLeaseEpoch + 1
      && acceptedStates.has(projectRootState(item.state))
    ));
    if (matches.length > 1) invalid("successor cardinality");
    if (matches[0]) protectedSource(plan, matches[0].canonicalBaseRevision);
    return matches[0] || null;
  }

  function successorValues(cloudStatus, claim) {
    return {
      successorClaimId: claim.claimId,
      successorClaimDigest: claim.fenceRevision,
      successorLeaseEpoch: claim.leaseEpoch,
      successorTransitionCounter: claim.transitionCounter,
      successorState: projectRootState(claim.state),
      ledgerRevision: cloudStatus.ledgerRevision,
      ledgerDigest: cloudStatus.ledgerDigest,
    };
  }

  function activeAuthority(plan) {
    const lease = readLease();
    const cloudStatus = status(lease.cloudAuthority);
    const claim = successor(plan, new Set(["active"]), cloudStatus);
    if (!claim) invalid("active successor");
    return normalizeBoundAuthority({
      result: {
        claim,
        claimDigest: claim.fenceRevision,
        ledgerRevision: cloudStatus.ledgerRevision,
        ledgerDigest: cloudStatus.ledgerDigest,
      },
      authority: lease.cloudAuthority,
      manifest: manifest(lease),
      deviceId: lease.device,
      sessionId: lease.sessionId,
      focusedEvidenceDigest: null,
    });
  }

  async function readEvidence() {
    const lease = readLease();
    const provider = providerSubject();
    return collectDeliveryAuthorizedBaseRecoveryEvidence({
      branch,
      execute,
      fetchExactRefs,
      git,
      identity,
      lease,
      manifest: manifest(lease),
      provider,
      sessionId,
      cloudStatus: status(lease.cloudAuthority),
    });
  }

  async function demotePullRequest({ plan }) {
    const before = providerSubject().pull;
    if (!before.isDraft) execute("gh", ["pr", "ready", "--undo", before.url]);
    const after = providerSubject().pull;
    if (after.state !== "OPEN" || !after.isDraft
      || after.headRefOid !== plan.evidence.headSha
      || after.baseRefOid !== plan.evidence.deliveryBaseSha) {
      invalid("draft pull-request projection");
    }
    return complete({ pullRequestDigest: digestValue(after) });
  }

  async function createWaitingSuccessor({ plan, operationKey }) {
    const before = status();
    requireAuthorizedDeliveryCloudPreimage(plan, before);
    const canonicalBaseSha = protectedSource(plan);
    cloudAction("claim", {
      actorId: plan.evidence.actorId,
      actorLogin: plan.evidence.actorLogin,
      branch,
      workItemId: plan.evidence.claimWorkItemId,
      canonicalBaseSha,
      headSha: plan.evidence.headSha,
      declaredWriteSet: plan.evidence.declaredWriteSet,
      predecessorClaimId: plan.evidence.claimId,
      leaseEpoch: plan.evidence.claimLeaseEpoch + 1,
      ttlSeconds,
      expectedLedgerDigest: before.ledgerDigest,
      deviceId: plan.evidence.deviceId,
      sessionId,
      idempotencyKey: operationKey,
    });
    const after = status();
    const claim = successor(plan, new Set(["waiting-successor"]), after);
    if (!claim) invalid("waiting successor");
    return complete(successorValues(after, claim));
  }

  async function retirePredecessor({ plan, operationKey }) {
    const before = status();
    const source = sourceClaim(plan, before);
    const waiting = successor(plan, new Set(["waiting-successor"]), before);
    if (!source || source.fenceRevision !== plan.evidence.claimDigest || !waiting) {
      invalid("predecessor retirement subject");
    }
    cloudAction("retire", {
      claimId: source.claimId,
      expectedFenceRevision: source.fenceRevision,
      expectedTransitionCounter: source.transitionCounter,
      expectedLedgerDigest: before.ledgerDigest,
      reason: "integrated",
      finalRevision: source.laneRevision,
      reviewRequestId: source.reviewRequestId,
      bytesDigest: digestValue({
        headSha: plan.evidence.headSha,
        treeSha: plan.evidence.treeSha,
        originalBaseSha: plan.evidence.originalBaseSha,
        deliveryBaseSha: plan.evidence.deliveryBaseSha,
      }),
      namedChecksDigest: source.integration?.namedChecksDigest
        || plan.evidence.operationReceiptDigest,
      handoffEvidenceDigest: source.integration?.handoffEvidenceDigest
        || digestValue({ planDigest: plan.planDigest, successorClaimId: waiting.claimId }),
      integrationReceiptDigest: plan.evidence.integrationReceiptDigest,
      deviceId: plan.evidence.deviceId,
      sessionId,
      idempotencyKey: operationKey,
    });
    const after = status();
    if (sourceClaim(plan, after)) invalid("predecessor retirement");
    return complete({
      predecessorClaimId: plan.evidence.claimId,
      retirementDigest: digestValue({
        planDigest: plan.planDigest,
        predecessorClaimId: plan.evidence.claimId,
      }),
    });
  }

  async function promoteSuccessor({ plan, operationKey }) {
    const before = status();
    if (sourceClaim(plan, before)) invalid("successor promotion order");
    const waiting = successor(plan, new Set(["waiting-successor"]), before);
    if (!waiting) invalid("waiting successor promotion");
    cloudAction("continue", {
      branch,
      headSha: plan.evidence.headSha,
      claimId: waiting.claimId,
      expectedFenceRevision: waiting.fenceRevision,
      expectedTransitionCounter: waiting.transitionCounter,
      expectedLedgerDigest: before.ledgerDigest,
      mode: "promote",
      ttlSeconds,
      deviceId: plan.evidence.deviceId,
      sessionId,
      idempotencyKey: operationKey,
    });
    const after = status();
    const claim = successor(plan, new Set(["active"]), after);
    if (!claim || claim.reviewRequestId) invalid("promoted successor");
    return complete(successorValues(after, claim));
  }

  async function projectLease({ plan }) {
    const current = readLease();
    const authority = activeAuthority(plan);
    const recovery = Object.freeze({
      schema: "agentic-delivery-authorized-base-recovery-projection/v1",
      planDigest: plan.planDigest,
      originalBaseSha: plan.evidence.originalBaseSha,
      deliveryBaseSha: plan.evidence.deliveryBaseSha,
      protectedMainSha: authority.canonicalBaseSha,
      sourceLeaseDigest: plan.evidence.leaseDigest,
      sourceClaimId: plan.evidence.claimId,
      successorClaimId: authority.claimId,
      effects: EFFECTS,
    });
    const nextLease = {
      ...current,
      status: "active",
      baseSha: authority.canonicalBaseSha,
      fenceSha: plan.evidence.headSha,
      cloudAuthority: authority,
      reviewHeadSha: null,
      heartbeatAt: new Date().toISOString(),
      expiresAt: authority.expiresAt,
      deliveryBaseRecovery: recovery,
    };
    const projected = current.baseSha === authority.canonicalBaseSha
      && current.cloudAuthority?.claimId === authority.claimId
      && current.deliveryBaseRecovery?.planDigest === plan.planDigest
      ? current
      : casWriterLeaseProjection({
        leaseStore,
        branch,
        expectedLeaseDigest: writerLeaseDigest(current),
        expectedClaimId: current.cloudAuthority?.claimId,
        requireNoActiveIntent: true,
        values: {
          ...nextLease,
          taskAuthority: current.taskAuthority
            ? continueTaskAuthorityBinding({
              sourceLease: current,
              nextLease,
              capabilityPath: environment.AGENTIC_TASK_AUTHORITY_FILE,
              boundAt: nextLease.heartbeatAt,
            })
            : null,
        },
      }).lease;
    return complete({ leaseDigest: writerLeaseDigest(projected) });
  }

  async function projectMarker({ plan }) {
    const lease = readLease();
    const before = providerSubject().pull;
    const body = updateWriterLeasePullRequestBody(before.body, lease);
    if (body !== before.body) execute("gh", ["pr", "edit", before.url, "--body", body]);
    const after = providerSubject().pull;
    const marker = parseWriterLeasePullRequestBody(after.body);
    if (!after.isDraft || marker?.baseSha !== lease.cloudAuthority.canonicalBaseSha
      || marker.cloudAuthority?.claimId !== lease.cloudAuthority.claimId) {
      invalid("pull-request marker projection");
    }
    return complete({ markerDigest: digestValue(marker) });
  }

  async function verifyTerminal({ plan }) {
    fetchExactRefs();
    const lease = readLease();
    const pull = providerSubject().pull;
    const marker = parseWriterLeasePullRequestBody(pull.body);
    const cloudStatus = status(lease.cloudAuthority);
    const claim = successor(plan, new Set(["active"]), cloudStatus);
    if (!claim || sourceClaim(plan, cloudStatus)
      || lease.baseSha !== claim.canonicalBaseRevision
      || lease.fenceSha !== plan.evidence.headSha
      || lease.cloudAuthority?.claimId !== claim.claimId
      || lease.cloudAuthority?.state !== "active"
      || lease.cloudAuthority?.canonicalBaseSha !== claim.canonicalBaseRevision
      || lease.cloudAuthority?.laneRevision !== plan.evidence.headSha
      || lease.deliveryBaseRecovery?.planDigest !== plan.planDigest
      || pull.state !== "OPEN" || !pull.isDraft
      || pull.headRefOid !== plan.evidence.headSha
      || pull.baseRefOid !== plan.evidence.deliveryBaseSha
      || marker?.baseSha !== claim.canonicalBaseRevision
      || marker.cloudAuthority?.claimId !== claim.claimId
      || git(["rev-parse", "HEAD"]) !== plan.evidence.headSha
      || git(["rev-parse", `refs/remotes/origin/${branch}`]) !== plan.evidence.headSha
      || git(["status", "--porcelain=v1", "--untracked-files=all"]) !== "") {
      invalid("terminal verification");
    }
    const authority = activeAuthority(plan);
    const receipt = buildDeliveryAuthorizedBaseRecoveryReceipt({
      plan,
      outcome: "recovered",
      successorAuthority: authority,
      finalLeaseDigest: writerLeaseDigest(lease),
      finalMarkerDigest: digestValue(marker),
      effects: EFFECTS,
    });
    return complete({ receipt });
  }

  async function reconcilePhase({ intent, phase, plan }) {
    const stored = intent.phases?.[phase]?.values;
    if (phase === "pull_request_drafted") {
      const pull = providerSubject().pull;
      return pull.state === "OPEN" && pull.isDraft
        && pull.headRefOid === plan.evidence.headSha
        && pull.baseRefOid === plan.evidence.deliveryBaseSha
        ? complete(stored || { pullRequestDigest: digestValue(pull) }) : pending();
    }
    const cloudStatus = status();
    if (phase === "successor_waiting") {
      const claim = successor(plan, new Set(["waiting-successor", "active"]), cloudStatus);
      return claim ? complete(stored || successorValues(cloudStatus, claim)) : pending();
    }
    if (phase === "predecessor_retired") {
      return !sourceClaim(plan, cloudStatus)
        && successor(plan, new Set(["waiting-successor", "active"]), cloudStatus)
        ? complete(stored || {
          predecessorClaimId: plan.evidence.claimId,
          retirementDigest: digestValue({
            planDigest: plan.planDigest,
            predecessorClaimId: plan.evidence.claimId,
          }),
        }) : pending();
    }
    if (phase === "successor_active") {
      const claim = successor(plan, new Set(["active"]), cloudStatus);
      return claim ? complete(stored || successorValues(cloudStatus, claim)) : pending();
    }
    if (phase === "lease_projected") {
      const lease = readLease();
      return lease.baseSha === lease.cloudAuthority?.canonicalBaseSha
        && lease.deliveryBaseRecovery?.planDigest === plan.planDigest
        && successor(plan, new Set(["active"]), cloudStatus)?.claimId
          === lease.cloudAuthority?.claimId
        ? complete(stored || { leaseDigest: writerLeaseDigest(lease) }) : pending();
    }
    if (phase === "marker_projected") {
      const lease = readLease();
      const marker = parseWriterLeasePullRequestBody(providerSubject().pull.body);
      return marker?.baseSha === lease.cloudAuthority?.canonicalBaseSha
        && marker.cloudAuthority?.claimId === lease.cloudAuthority?.claimId
        ? complete(stored || { markerDigest: digestValue(marker) }) : pending();
    }
    if (phase === "verified") return verifyTerminal({ plan });
    invalid(`reconciliation phase ${phase}`);
  }

  async function withFence(action) {
    mkdirSync(journalDirectory, { recursive: true });
    const lock = acquireFence();
    try {
      return await action();
    } finally {
      releaseFence(lock);
    }
  }

  function acquireFence() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = randomUUID();
      try {
        const descriptor = openSync(lockPath, "wx", 0o600);
        writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, token })}\n`);
        closeSync(descriptor);
        return { pid: process.pid, token };
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const current = JSON.parse(readFileSync(lockPath, "utf8"));
        try {
          process.kill(current.pid, 0);
          invalid("concurrent fence");
        } catch (probe) {
          if (probe?.code !== "ESRCH") throw probe;
          unlinkSync(lockPath);
        }
      }
    }
    invalid("fence acquisition");
  }

  function releaseFence(expected) {
    if (!existsSync(lockPath)) return;
    const current = JSON.parse(readFileSync(lockPath, "utf8"));
    if (current.pid !== expected.pid || current.token !== expected.token) {
      invalid("fence ownership");
    }
    unlinkSync(lockPath);
  }

  function readIntent() {
    return existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null;
  }

  function writeIntent({ expected, value }) {
    if (JSON.stringify(readIntent()) !== JSON.stringify(expected)) invalid("journal CAS");
    const temporary = `${statePath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, statePath);
  }

  return createDeliveryAuthorizedBaseRecoveryAdapter({
    withFence,
    readEvidence,
    readIntent,
    writeIntent,
    reconcilePhase,
    demotePullRequest,
    createWaitingSuccessor,
    retirePredecessor,
    promoteSuccessor,
    projectLease,
    projectMarker,
    verifyTerminal,
  });
}

function requiredText(value, label) {
  const result = String(value ?? "").trim();
  if (!result || result.includes("\0")) throw new Error(`${label} is required.`);
  return result;
}
function requiredDigest(value, label) {
  const result = requiredText(value, label);
  if (!DIGEST.test(result)) throw new Error(`${label} must be a SHA-256 digest.`);
  return result;
}
function invalid(label) {
  throw new Error(`Delivery-authorized base recovery ${label} is invalid.`);
}
