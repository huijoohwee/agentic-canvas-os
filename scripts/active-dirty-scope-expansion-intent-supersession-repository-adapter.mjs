// Responsibility: Prove response absence and archive-clear one stale no-effect intent under registry CAS.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  captureActiveOwnedDirtEvidence,
  requireSameActiveOwnedDirtEvidence,
} from "./active-owned-dirt-recovery-evidence.mjs";
import { buildActiveDirtyScopeExpansionPlan }
  from "./active-dirty-scope-expansion-contract.mjs";
import {
  normalizeActiveOwnedDirtLeaseRecovery,
  validateCompletedActiveOwnedDirtRecoveryIntent,
}
  from "./active-owned-dirt-recovery-contract.mjs";
import { captureActiveDirtyScopeExpansionProtectedMain }
  from "./active-dirty-scope-expansion-protected-main.mjs";
import {
  digestValue,
  validateLedger,
} from "./cloud-collaboration-primitives.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "./scoped-lane-admission-lib.mjs";
import { authorizeTaskBoundLeaseMutation }
  from "./task-bound-lane-authority-store.mjs";
import { assertTaskAuthorityBinding }
  from "./task-bound-lane-authority-contract.mjs";
import {
  createWriterLeaseStore,
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
} from "./writer-lease-lib.mjs";
import {
  mutateWriterLeaseRegistry,
  writerLeaseDigest,
} from "./writer-lease-registry-cas.mjs";
import {
  OPERATION,
  RECOVERED_CONTINUATION_SCHEMA,
  RECEIPT_MAP,
  assertNoEffectScopeExpansionIntent,
  authorizeActiveDirtyScopeExpansionIntentSupersession,
  buildActiveDirtyScopeExpansionIntentSupersessionPlan,
  buildActiveDirtyScopeExpansionIntentSupersessionReceipt,
  projectActiveDirtyScopeExpansionIntentSupersessionResult,
  storedSupersessionReceipt,
} from "./active-dirty-scope-expansion-intent-supersession-contract.mjs";
import {
  buildGithubCloudCollaborationLedgerRefBarrierRequest,
  establishGithubCloudCollaborationLedgerRefBarrier,
} from "./github-cloud-collaboration-ledger-ref-barrier.mjs";

const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_FILES = Object.freeze([
  "scripts/active-dirty-scope-expansion-intent-supersession-contract.mjs",
  "scripts/active-dirty-scope-expansion-intent-supersession-repository-adapter.mjs",
  "scripts/active-dirty-scope-expansion-intent-supersession.mjs",
  "scripts/github-cloud-collaboration-ledger-ref-barrier.mjs",
]);
const LEDGER_REF = "agentic/collaboration-ledger";
const LEDGER_PATH = ".agentic/collaboration-ledger.json";
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

export function createActiveDirtyScopeExpansionIntentSupersessionRepositoryController(
  options = {},
  dependencies = {},
) {
  const runtime = dependencies.runtime || createRuntime(options, dependencies);
  return Object.freeze({
    async plan() {
      return buildActiveDirtyScopeExpansionIntentSupersessionPlan({
        evidence: await runtime.inspect(),
      });
    },
    async run({ planDigest, authorization } = {}) {
      const expectedPlanDigest = requiredDigest(planDigest, "expected plan digest");
      const replay = await runtime.readReplay(expectedPlanDigest);
      if (replay) {
        authorizeActiveDirtyScopeExpansionIntentSupersession({
          plan: replay.plan,
          authorization,
        });
        return replay.receipt;
      }
      const first = buildActiveDirtyScopeExpansionIntentSupersessionPlan({
        evidence: await runtime.inspect(),
      });
      if (expectedPlanDigest !== first.planDigest) {
        throw new Error("Intent supersession requires an exact fresh plan digest.");
      }
      const authorized = authorizeActiveDirtyScopeExpansionIntentSupersession({
        plan: first,
        authorization,
      });
      const second = buildActiveDirtyScopeExpansionIntentSupersessionPlan({
        evidence: await runtime.inspect(),
      });
      if (second.planDigest !== first.planDigest) {
        throw new Error("Intent supersession evidence changed before the final CAS read.");
      }
      const taskAuthorityReceipt = await runtime.authorizeTaskAuthority(second);
      const finalPlan = buildActiveDirtyScopeExpansionIntentSupersessionPlan({
        evidence: await runtime.inspect(),
      });
      if (finalPlan.planDigest !== second.planDigest) {
        throw new Error("Intent supersession evidence changed after task authorization.");
      }
      const beforeDirt = await runtime.captureDirt();
      if (beforeDirt.evidenceDigest !== finalPlan.evidence.dirt.evidenceDigest) {
        throw new Error("Intent supersession source bytes drifted before archive-clear CAS.");
      }
      const barrierReceipt = await runtime.establishBarrier(finalPlan);
      await runtime.revalidateSubject(finalPlan);
      const result = runtime.finalize({
        beforeDirt,
        plan: finalPlan,
        authorizationDigest: authorized.authorizationDigest,
        taskAuthorityReceipt,
        barrierReceipt,
      });
      const afterDirt = await runtime.captureDirt();
      requireSameActiveOwnedDirtEvidence(beforeDirt, afterDirt);
      if (afterDirt.evidenceDigest !== finalPlan.evidence.dirt.evidenceDigest) {
        throw new Error("Intent supersession source bytes drifted from the sealed plan.");
      }
      return result;
    },
  });
}

export function applyActiveDirtyScopeExpansionIntentSupersession({
  leaseStore,
  branch,
  plan,
  authorizationDigest,
  taskAuthorityReceipt,
  barrierReceipt,
  clock,
}) {
  if (typeof clock !== "function") {
    throw new Error("Intent-supersession CAS requires a lock-local clock.");
  }
  const expected = buildActiveDirtyScopeExpansionIntentSupersessionPlan({
    evidence: plan.evidence,
  });
  if (expected.planDigest !== plan.planDigest) {
    throw new Error("Intent supersession CAS received an unsealed plan.");
  }
  const sourceIntentDigest = expected.evidence.sourceIntentDigest;
  const expectedLeaseDigest = expected.evidence.lease.leaseDigest;
  const expectedClaimId = expected.evidence.lease.claimId;
  let stored;
  let revisionBefore;
  const result = mutateWriterLeaseRegistry({
    leaseStore,
    branch,
    expectedLeaseDigest,
    expectedClaimId,
    action: ({ registry, lease }) => {
      revisionBefore = registry.revision;
      const receipt = registry[RECEIPT_MAP]?.[branch]?.[sourceIntentDigest] ?? null;
      const liveIntent = registry.scopeExpansionIntents?.[branch] ?? null;
      if (receipt !== null) {
        stored = storedSupersessionReceipt(receipt);
        if (liveIntent !== null && liveIntent !== undefined) {
          throw new Error("Replayed intent-supersession receipt conflicts with a live intent.");
        }
        if (stored.planDigest !== expected.planDigest
          || stored.sourceLeaseDigest !== expectedLeaseDigest
          || stored.sourceClaimId !== expectedClaimId
          || stored.planSnapshot?.planDigest !== expected.planDigest
          || stored.sourceIntentSnapshot?.planDigest
            !== expected.evidence.sourceIntent.planDigest) {
          throw new Error("Stored intent-supersession receipt belongs to another plan.");
        }
        return { registry, lease, intent: { replayed: true }, changed: false };
      }
      const clockValue = clock();
      const instant = clockValue instanceof Date ? clockValue : new Date(clockValue);
      if (!Number.isFinite(instant.getTime())) {
        throw new Error("Intent-supersession CAS clock is invalid.");
      }
      const liveDisposition = [lease.expiresAt, lease.cloudAuthority?.expiresAt]
        .some(value => Date.parse(value) <= instant.getTime())
        ? "dormant-preserved" : "current";
      if (liveDisposition !== expected.disposition) {
        throw new Error("Source expiry disposition changed before archive-clear CAS.");
      }
      if (registry.revision !== expected.evidence.lease.registryRevision
        || digestValue(registry) !== expected.evidence.lease.registryDigest) {
        throw new Error("Writer registry changed after intent-supersession planning.");
      }
      const normalizedIntent = assertNoEffectScopeExpansionIntent(
        liveIntent,
        { branch },
      );
      if (digestValue(normalizedIntent) !== sourceIntentDigest
        || writerLeaseDigest(lease) !== expectedLeaseDigest
        || lease.cloudAuthority?.claimId !== expectedClaimId) {
        throw new Error("No-effect scope-expansion intent changed before archive-clear CAS.");
      }
      const candidate = buildActiveDirtyScopeExpansionIntentSupersessionReceipt({
        plan: expected,
        authorizationDigest,
        taskAuthorityReceiptDigest: taskAuthorityReceipt.receiptDigest,
        barrierReceipt,
        registryRevisionBefore: registry.revision,
        registryRevisionAfter: registry.revision + 1,
      });
      stored = storedSupersessionReceipt(candidate);
      const { [branch]: _cleared, ...remainingIntents } =
        registry.scopeExpansionIntents || {};
      return {
        registry: {
          ...registry,
          scopeExpansionIntents: remainingIntents,
          [RECEIPT_MAP]: {
            ...(registry[RECEIPT_MAP] || {}),
            [branch]: {
              ...(registry[RECEIPT_MAP]?.[branch] || {}),
              [sourceIntentDigest]: stored,
            },
          },
        },
        lease,
        intent: { replayed: false },
        changed: true,
      };
    },
  });
  if (result.intent.replayed) {
    return projectActiveDirtyScopeExpansionIntentSupersessionResult({
      receipt: stored,
      replayed: true,
    });
  }
  return projectActiveDirtyScopeExpansionIntentSupersessionResult({
    receipt: stored,
    replayed: false,
  });
}

export function analyzeNoEffectScopeExpansionCloudAbsence({
  ledger,
  sourceClaimId,
  sourceClaimDigest,
  sourceTransitionDigest,
  sourceTransitionCounter,
  sourceLeaseExpiresAt,
  sourceCloudExpiresAt,
  sourcePlanDigest,
  targetCanonicalBaseSha,
  targetWriteSetDigest,
  targetDeclaredWriteSet,
  sourceContinuation = null,
  now,
}) {
  const failures = validateLedger(ledger);
  if (failures.length > 0) {
    throw new Error(`Raw collaboration ledger is invalid: ${failures.join("; ")}`);
  }
  const sourceEntries = ledger.entries.filter(entry => entry.claimId === sourceClaimId);
  if (sourceEntries.length === 0) {
    throw new Error("Raw collaboration ledger has no exact source claim.");
  }
  const latest = sourceEntries.at(-1);
  const core = latest.claimCore;
  if (sourceContinuation === null) {
    if (latest.claimDigest !== sourceClaimDigest
      || latest.digest !== sourceTransitionDigest
      || core?.transitionCounter !== sourceTransitionCounter
      || core?.state !== "current"
      || core?.expiresAt !== sourceCloudExpiresAt
      || core?.retirement != null) {
      throw new Error("Source claim is no longer the exact recorded-current no-retirement claim.");
    }
  } else {
    const recovery = validateCompletedActiveOwnedDirtRecoveryIntent(
      sourceContinuation.recoveryIntent,
    );
    const recoveryPlan = recovery.planSnapshot;
    const expectedRecoveryExpiry = new Date(
      Date.parse(recovery.cloud.recoveredAt) + recoveryPlan.ttlSeconds * 1_000,
    ).toISOString();
    const expectedRecoveryRequestDigest = digestValue({
      action: "continue",
      intent: {
        repositoryId: recoveryPlan.sourceRepositoryId,
        actorId: recoveryPlan.sourceActorId,
        deviceId: recoveryPlan.sourceCloudDeviceId,
        sessionId: recoveryPlan.sourceCloudSessionId,
        claimId: recoveryPlan.sourceClaimId,
        expectedFenceRevision: recoveryPlan.sourceClaimDigest,
        expectedTransitionCounter: recoveryPlan.sourceCloudTransitionCounter,
        mode: "recovery",
        laneRevision: null,
        reviewRequestId: null,
        expiresAt: expectedRecoveryExpiry,
        focusedEvidenceDigest: null,
        handoffEvidenceDigest: null,
        recoveryEvidenceDigest: recovery.snapshot.snapshotReceiptDigest,
      },
    });
    const historicalIndex = sourceEntries.findIndex(entry =>
      entry.digest === recoveryPlan.sourceClaimLedgerRevision);
    const historical = sourceEntries[historicalIndex];
    const immutable = ["actorId", "deviceId", "sessionId", "repositoryId", "workItemId",
      "predecessorClaimId",
      "canonicalBaseRevision", "laneRevision", "writeSetDigest", "declaredWriteScope",
      "reviewRequestId", "leaseEpoch"];
    if (!historical || historicalIndex !== sourceEntries.length - 2
      || historical.claimDigest !== recoveryPlan.sourceClaimDigest
      || historical.claimCore?.transitionCounter
        !== recoveryPlan.sourceCloudTransitionCounter
      || historical.claimCore?.deviceId !== recoveryPlan.sourceCloudDeviceId
      || historical.claimCore?.sessionId !== recoveryPlan.sourceCloudSessionId
      || latest.claimCore?.deviceId !== recoveryPlan.sourceCloudDeviceId
      || latest.claimCore?.sessionId !== recoveryPlan.sourceCloudSessionId
      || recoveryPlan.sourceOperationReceiptDigest
        !== operationReceiptDigest(historical, "current")
      || latest.action !== "continue"
      || latest.parentDigest !== recoveryPlan.sourceLedgerDigest
      || latest.idempotencyKey
        !== digestValue(`active-owned-dirt-recovery:${recoveryPlan.planDigest}`)
      || latest.requestDigest !== expectedRecoveryRequestDigest
      || latest.claimDigest !== sourceClaimDigest
      || latest.digest !== sourceTransitionDigest
      || latest.claimCore?.transitionCounter !== sourceTransitionCounter
      || latest.claimCore?.transitionCounter
        !== historical.claimCore.transitionCounter + 1
      || latest.claimCore?.state !== "current"
      || latest.claimCore?.expiresAt !== sourceCloudExpiresAt
      || latest.claimCore?.expiresAt !== expectedRecoveryExpiry
      || recovery.cloud.expiresAt !== expectedRecoveryExpiry
      || latest.claimCore?.retirement != null
      || latest.claimCore?.recovery?.evidenceDigest
        !== recovery.snapshot.snapshotReceiptDigest
      || latest.claimCore?.recovery?.recoveredAt !== recovery.cloud.recoveredAt
      || latest.evaluationTime !== recovery.cloud.recoveredAt
      || recovery.cloud.operationReceiptDigest
        !== operationReceiptDigest(latest, "current")
      || recovery.cloud.claimLedgerRevision !== latest.digest
      || recovery.cloud.ledgerDigest !== latest.digest
      || immutable.some(field =>
        JSON.stringify(latest.claimCore?.[field])
          !== JSON.stringify(historical.claimCore?.[field]))) {
      throw new Error(
        "Recovered source claim is not the exact same-claim monotonic recovery continuation.",
      );
    }
  }
  const rawOperationKey = `active-dirty-scope-expansion:waiting:${sourcePlanDigest}`;
  const operationKeyDigest = digestValue(rawOperationKey);
  const prohibited = ledger.entries.filter(entry => {
    if (entry.idempotencyKey === operationKeyDigest) return true;
    const claim = entry.claimCore;
    if (!claim || claim.claimId === sourceClaimId
      || claim.predecessorClaimId !== sourceClaimId) return false;
    return true;
  });
  if (prohibited.length > 0) {
    throw new Error("Old scope-expansion request or a foreign-key derivative already exists.");
  }
  const instant = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(instant.getTime())) throw new Error("Supersession clock is invalid.");
  const effectiveState = [sourceLeaseExpiresAt, sourceCloudExpiresAt]
    .some(value => Date.parse(value) <= instant.getTime())
    ? "dormant-preserved" : "current";
  const absenceCore = {
    sourceClaimId,
    sourceClaimDigest,
    sourceTransitionDigest,
    operationKeyDigest,
    targetCanonicalBaseSha,
    targetWriteSetDigest,
    effectiveState,
    prohibitedEntryCount: prohibited.length,
    ...(sourceContinuation ? {
      sourceContinuationDigest: sourceContinuation.continuationDigest,
    } : {}),
  };
  return Object.freeze({
    sourceClaimId,
    recordedState: "current",
    effectiveState,
    operationKeyDigest,
    exactOperationAbsent: true,
    foreignDerivativeAbsent: true,
    prohibitedEntryCount: 0,
    absenceDigest: digestValue(absenceCore),
  });
}

export async function readStableRawCollaborationLedger({ readSnapshot }) {
  if (typeof readSnapshot !== "function") throw new Error("Raw ledger reader is required.");
  const first = await readSnapshot();
  const second = await readSnapshot();
  const stableFields = ["revision", "treeSha", "blobSha", "rawDigest", "ledgerDigest", "sequence"];
  if (stableFields.some(field => first[field] !== second[field])) {
    throw new Error("Raw collaboration ledger ref/blob changed across the double read.");
  }
  return Object.freeze({ first, second });
}

function createRuntime(options, dependencies) {
  const sourceRepository = realpathSync(path.resolve(
    requiredText(options.sourceRepository, "source repository"),
  ));
  const controllerRoot = realpathSync(path.resolve(
    requiredText(options.controllerRoot || RUNTIME_ROOT, "controller root"),
  ));
  if (controllerRoot !== RUNTIME_ROOT) {
    throw new Error("Intent supersession must execute from its exact protected controller root.");
  }
  const sessionId = requiredText(options.sessionId, "session ID");
  const pullRequestNumber = positiveInteger(
    options.pullRequestNumber,
    "pull request number",
  );
  const targetRepository = requiredRepository(options.targetRepository, "target repository");
  const ledgerRepository = requiredRepository(
    options.ledgerRepository || targetRepository,
    "ledger repository",
  );
  const targetManifest = normalizeDeclaredWriteScopeManifest(JSON.parse(readFileSync(
    path.resolve(requiredText(options.targetManifestPath, "target manifest")),
    "utf8",
  )));
  const taskAuthorityFile = options.taskAuthorityFile
    ? realpathSync(path.resolve(options.taskAuthorityFile)) : null;
  const now = dependencies.now || (() => new Date());
  const execute = dependencies.execute || ((command, args, execution = {}) => execFileSync(
    command,
    args,
    { cwd: execution.cwd || sourceRepository, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
      input: execution.input },
  ));
  const gitAt = dependencies.gitAt || ((cwd, args) => String(execute("git", args, { cwd })).trim());
  const ghJson = dependencies.ghJson || ((args, input = null) => JSON.parse(String(execute(
    "gh",
    args,
    input === null ? {} : { input: `${JSON.stringify(input)}\n` },
  ))));
  const commonDirectory = path.resolve(
    sourceRepository,
    gitAt(sourceRepository, ["rev-parse", "--git-common-dir"]),
  );
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    taskAuthorityFile,
    taskAuthorityPolicy: "projected",
  });
  const readLedgerSnapshot = dependencies.readLedgerSnapshot
    || (() => readRawLedgerSnapshot({ ghJson, ledgerRepository }));

  async function inspect() {
    const controller = readController({ controllerRoot, gitAt, targetRepository });
    if (realpathSync(gitAt(sourceRepository, ["rev-parse", "--show-toplevel"]))
      !== sourceRepository) {
      throw new Error("Intent supersession requires the exact source worktree root.");
    }
    const branch = requiredText(
      gitAt(sourceRepository, ["branch", "--show-current"]),
      "source branch",
    );
    const registry = leaseStore.readRegistry();
    const lease = registry.leases?.[branch];
    if (lease?.status !== "active"
      || lease.sessionId !== sessionId
      || realpathSync(lease.worktreePath) !== sourceRepository
      || lease.admission?.status !== "admitted"
      || lease.cloudAuthority?.state !== "active"
      || !lease.taskAuthority?.bindingDigest) {
      throw new Error("Intent supersession requires the exact admitted source lease and task binding.");
    }
    assertIntentSupersessionRepositoryAuthority({
      sourceRemote: gitAt(sourceRepository, ["remote", "get-url", "origin"]),
      targetRepository,
      ledgerRepository,
      cloudAuthority: lease.cloudAuthority,
    });
    const worktrees = gitAt(sourceRepository, ["worktree", "list", "--porcelain", "-z"]);
    if (!worktrees.includes(`worktree ${sourceRepository}\0`)
      || !worktrees.includes(`branch refs/heads/${branch}\0`)) {
      throw new Error("Source worktree registration or attached branch drifted.");
    }
    const headSha = requiredSha(gitAt(sourceRepository, ["rev-parse", "HEAD"]), "source HEAD");
    const remoteHeadSha = remoteSha(gitAt, sourceRepository, branch);
    if (headSha !== lease.fenceSha || remoteHeadSha !== headSha) {
      throw new Error("Source HEAD, lease fence, and remote branch are not exact.");
    }
    const intent = assertNoEffectScopeExpansionIntent(
      registry.scopeExpansionIntents?.[branch] ?? null,
      { branch },
    );
    const dirt = captureActiveOwnedDirtEvidence({ repository: sourceRepository });
    if (dirt.untrackedPathCount !== 0) {
      throw new Error("Intent supersession rejects untracked source bytes.");
    }
    const pull = readPullRequest({ ghJson, pullRequestNumber, targetRepository });
    const marker = parseWriterLeasePullRequestBody(pull.body);
    if (!marker || digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))
      || pull.headRefName !== branch || pull.headRefOid !== headSha) {
      throw new Error("Source pull-request writer projection drifted.");
    }
    const sourceContinuation = buildRecoveredSourceContinuation({
      intent,
      recoveryIntent: registry.activeOwnedDirtRecoveryIntents?.[branch] ?? null,
      lease,
      dirt,
      marker,
    });
    const sourceOriginMain = requiredSha(
      gitAt(sourceRepository, ["rev-parse", "origin/main"]),
      "source origin/main",
    );
    if (sourceOriginMain !== controller.remoteMainSha) {
      throw new Error("Source repository lacks the exact protected-main object; refresh outside recovery.");
    }
    const protectedMain = captureActiveDirtyScopeExpansionProtectedMain({
      sourceBaseSha: lease.baseSha,
      pullRequestBaseSha: pull.baseRefOid,
      protectedMainSha: controller.remoteMainSha,
      targetDeclaredWriteSet: targetManifest.declaredWriteSet,
      gitText: args => gitAt(sourceRepository, args),
    });
    const oldProtectedMainSha = intent.planSnapshot.canonicalDescendantProof?.targetBaseSha;
    if (!oldProtectedMainSha || oldProtectedMainSha === controller.remoteMainSha
      || gitExit(sourceRepository, ["merge-base", "--is-ancestor", oldProtectedMainSha,
        controller.remoteMainSha]) !== 0) {
      throw new Error("Old scope-expansion proof is not a stale ancestor of current protected main.");
    }
    const source = {
      lease,
      authority: lease.cloudAuthority,
      branch,
      fenceSha: headSha,
      claimId: lease.cloudAuthority.claimId,
      claimDigest: lease.cloudAuthority.claimDigest,
      changedPaths: dirt.entries.map(entry => entry.path),
      untrackedPaths: [],
      dirtyDigest: dirt.evidenceDigest,
    };
    const freshExpansionPlan = buildActiveDirtyScopeExpansionPlan({
      source,
      targetManifest,
      targetCanonicalBaseSha: lease.baseSha,
      canonicalDescendantProof: protectedMain.canonicalDescendantProof,
    });
    const stableLedger = await readStableRawCollaborationLedger({
      readSnapshot: readLedgerSnapshot,
    });
    const cloudAbsence = analyzeNoEffectScopeExpansionCloudAbsence({
      ledger: stableLedger.second.ledger,
      sourceClaimId: lease.cloudAuthority.claimId,
      sourceClaimDigest: lease.cloudAuthority.claimDigest,
      sourceTransitionDigest: lease.cloudAuthority.claimLedgerRevision,
      sourceTransitionCounter: lease.cloudAuthority.transitionCounter,
      sourceLeaseExpiresAt: lease.expiresAt,
      sourceCloudExpiresAt: lease.cloudAuthority.expiresAt,
      sourcePlanDigest: intent.planDigest,
      targetCanonicalBaseSha: intent.targetCanonicalBaseSha,
      targetWriteSetDigest: intent.targetWriteSetDigest,
      targetDeclaredWriteSet: intent.planSnapshot.targetDeclaredWriteSet,
      sourceContinuation,
      now: now(),
    });
    const disposition = cloudAbsence.effectiveState;
    const evidenceCore = {
      repository: targetRepository,
      controller,
      scope: lease.scope,
      branch,
      sessionId,
      pullRequestNumber,
      lane: {
        worktreePath: sourceRepository,
        headSha,
        remoteHeadSha,
        treeSha: requiredSha(gitAt(sourceRepository, ["rev-parse", "HEAD^{tree}"]),
          "source tree"),
      },
      lease: {
        leaseDigest: writerLeaseDigest(lease),
        claimId: lease.cloudAuthority.claimId,
        reviewRequestId: lease.cloudAuthority.reviewRequestId,
        taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
        registryRevision: registry.revision,
        registryDigest: digestValue(registry),
        expiresAt: lease.expiresAt,
        disposition,
      },
      pullRequest: {
        number: pull.number,
        nodeId: pull.id,
        url: pull.url,
        state: pull.state,
        isDraft: pull.isDraft,
        autoMergeRequest: pull.autoMergeRequest,
        headRepository: pull.headRepository?.nameWithOwner,
        headRefName: pull.headRefName,
        headRefOid: pull.headRefOid,
        baseRefName: pull.baseRefName,
        baseRefOid: pull.baseRefOid,
        reviewRequestId: `github-pull-request:${pull.id}`,
        markerDigest: digestValue(marker),
        bodyDigest: digestValue(pull.body),
      },
      sourceIntent: intent,
      sourceIntentDigest: digestValue(intent),
      ...(sourceContinuation ? { sourceContinuation } : {}),
      targetManifest,
      dirt,
      protectedMainAdvance: protectedMain.protectedMainAdvance,
      freshExpansionPlan,
      cloud: {
        ledgerRepository,
        revision: stableLedger.first.revision,
        treeSha: stableLedger.first.treeSha,
        blobSha: stableLedger.first.blobSha,
        rawDigest: stableLedger.first.rawDigest,
        ledgerDigest: stableLedger.first.ledgerDigest,
        sequence: stableLedger.first.sequence,
        rereadRevision: stableLedger.second.revision,
        rereadBlobSha: stableLedger.second.blobSha,
        rereadRawDigest: stableLedger.second.rawDigest,
        sourceClaimDigest: lease.cloudAuthority.claimDigest,
        sourceTransitionDigest: lease.cloudAuthority.claimLedgerRevision,
        sourceTransitionCounter: lease.cloudAuthority.transitionCounter,
        sourceExpiresAt: lease.cloudAuthority.expiresAt,
        ...cloudAbsence,
      },
      zeroEffectPreconditions: {
        intentPhaseOnly: true,
        noCloudReceipt: true,
        noSuccessorClaim: true,
        noRetirement: true,
        noLocalProjection: true,
        noPullRequestProjection: true,
      },
    };
    return Object.freeze({
      ...evidenceCore,
      evidenceDigest: digestValue(evidenceCore),
    });
  }

  function revalidateSubject(plan) {
    const expected = plan.evidence;
    const controller = readController({ controllerRoot, gitAt, targetRepository });
    const branch = requiredText(
      gitAt(sourceRepository, ["branch", "--show-current"]),
      "source branch",
    );
    const registry = leaseStore.readRegistry();
    const lease = registry.leases?.[branch];
    if (branch !== expected.branch || lease?.status !== "active"
      || lease.sessionId !== expected.sessionId
      || realpathSync(lease.worktreePath) !== sourceRepository
      || lease.admission?.status !== "admitted"
      || lease.cloudAuthority?.state !== "active"
      || !lease.taskAuthority?.bindingDigest) {
      throw new Error("Intent supersession non-ledger lease subject drifted after the barrier.");
    }
    assertIntentSupersessionRepositoryAuthority({
      sourceRemote: gitAt(sourceRepository, ["remote", "get-url", "origin"]),
      targetRepository,
      ledgerRepository,
      cloudAuthority: lease.cloudAuthority,
    });
    const worktrees = gitAt(sourceRepository, ["worktree", "list", "--porcelain", "-z"]);
    const headSha = requiredSha(gitAt(sourceRepository, ["rev-parse", "HEAD"]), "source HEAD");
    const treeSha = requiredSha(
      gitAt(sourceRepository, ["rev-parse", "HEAD^{tree}"]),
      "source tree",
    );
    const remoteHeadSha = remoteSha(gitAt, sourceRepository, branch);
    const intent = assertNoEffectScopeExpansionIntent(
      registry.scopeExpansionIntents?.[branch] ?? null,
      { branch },
    );
    const pull = readPullRequest({ ghJson, pullRequestNumber, targetRepository });
    const marker = parseWriterLeasePullRequestBody(pull.body);
    const dirt = captureActiveOwnedDirtEvidence({ repository: sourceRepository });
    const sourceContinuation = buildRecoveredSourceContinuation({
      intent,
      recoveryIntent: registry.activeOwnedDirtRecoveryIntents?.[branch] ?? null,
      lease,
      dirt,
      marker,
    });
    const instant = now();
    const observedAt = instant instanceof Date ? instant : new Date(instant);
    if (!Number.isFinite(observedAt.getTime())) {
      throw new Error("Intent supersession post-barrier clock is invalid.");
    }
    const disposition = [lease.expiresAt, lease.cloudAuthority?.expiresAt]
      .some(value => Date.parse(value) <= observedAt.getTime())
      ? "dormant-preserved" : "current";
    const observed = {
      controller,
      lane: {
        worktreePath: sourceRepository,
        headSha,
        remoteHeadSha,
        treeSha,
      },
      lease: {
        leaseDigest: writerLeaseDigest(lease),
        claimId: lease.cloudAuthority.claimId,
        reviewRequestId: lease.cloudAuthority.reviewRequestId,
        taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
        registryRevision: registry.revision,
        registryDigest: digestValue(registry),
        expiresAt: lease.expiresAt,
        disposition,
      },
      pullRequest: {
        number: pull.number,
        nodeId: pull.id,
        url: pull.url,
        state: pull.state,
        isDraft: pull.isDraft,
        autoMergeRequest: pull.autoMergeRequest,
        headRepository: pull.headRepository?.nameWithOwner,
        headRefName: pull.headRefName,
        headRefOid: pull.headRefOid,
        baseRefName: pull.baseRefName,
        baseRefOid: pull.baseRefOid,
        reviewRequestId: `github-pull-request:${pull.id}`,
        markerDigest: marker ? digestValue(marker) : null,
        bodyDigest: digestValue(pull.body),
      },
      sourceIntentDigest: digestValue(intent),
      sourceContinuationDigest: sourceContinuation?.continuationDigest ?? null,
      dirtEvidenceDigest: dirt.evidenceDigest,
      sourceOriginMainSha: requiredSha(
        gitAt(sourceRepository, ["rev-parse", "origin/main"]),
        "source origin/main",
      ),
      registered: worktrees.includes(`worktree ${sourceRepository}\0`)
        && worktrees.includes(`branch refs/heads/${branch}\0`),
    };
    const sealed = {
      controller: expected.controller,
      lane: expected.lane,
      lease: expected.lease,
      pullRequest: expected.pullRequest,
      sourceIntentDigest: expected.sourceIntentDigest,
      sourceContinuationDigest: expected.sourceContinuation?.continuationDigest ?? null,
      dirtEvidenceDigest: expected.dirt.evidenceDigest,
      sourceOriginMainSha: expected.controller.remoteMainSha,
      registered: true,
    };
    if (digestValue(observed) !== digestValue(sealed)
      || !marker
      || digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))) {
      throw new Error(
        "Intent supersession PR/head/remote/marker subject drifted after the ledger barrier.",
      );
    }
    return Object.freeze({ subjectDigest: digestValue(observed) });
  }

  return Object.freeze({
    inspect,
    readReplay: expectedPlanDigest => {
      const branch = requiredText(gitAt(sourceRepository, ["branch", "--show-current"]),
        "source branch");
      const registry = leaseStore.readRegistry();
      if (registry.scopeExpansionIntents?.[branch] != null) return null;
      const receipts = Object.values(registry[RECEIPT_MAP]?.[branch] || {})
        .map(storedSupersessionReceipt)
        .filter(receipt => receipt.planDigest === expectedPlanDigest);
      if (receipts.length === 0) return null;
      if (receipts.length !== 1) throw new Error("Intent-supersession replay receipt is ambiguous.");
      const stored = receipts[0];
      const lease = registry.leases?.[branch];
      if (writerLeaseDigest(lease) !== stored.sourceLeaseDigest
        || lease.cloudAuthority?.claimId !== stored.sourceClaimId) {
        throw new Error("Intent-supersession replay source lease or claim drifted.");
      }
      if (stored.sourceContinuationDigest) {
        const recovery = validateCompletedActiveOwnedDirtRecoveryIntent(
          registry.activeOwnedDirtRecoveryIntents?.[branch] ?? null,
        );
        if (digestValue(recovery) !== stored.completedRecoveryIntentDigest
          || digestValue(lease.activeOwnedDirtRecovery)
            !== digestValue(stored.sourceContinuationSnapshot.recoveredLease)
          || digestValue(lease.taskAuthority)
            !== digestValue(stored.sourceContinuationSnapshot.taskAuthorityContinuation)) {
          throw new Error("Intent-supersession recovered replay subject drifted.");
        }
      }
      const plan = buildActiveDirtyScopeExpansionIntentSupersessionPlan({
        evidence: stored.planSnapshot.evidence,
      });
      if (plan.planDigest !== expectedPlanDigest) {
        throw new Error("Intent-supersession replay plan snapshot drifted.");
      }
      return Object.freeze({
        plan,
        receipt: projectActiveDirtyScopeExpansionIntentSupersessionResult({
          receipt: stored,
          replayed: true,
        }),
      });
    },
    captureDirt: () => captureActiveOwnedDirtEvidence({ repository: sourceRepository }),
    revalidateSubject,
    establishBarrier: async plan => {
      const cloud = plan.evidence.cloud;
      const request = buildGithubCloudCollaborationLedgerRefBarrierRequest({
        operation: OPERATION,
        operationDigest: plan.planDigest,
        repository: cloud.ledgerRepository,
        ref: `refs/heads/${LEDGER_REF}`,
        sourceRevision: cloud.revision,
        sourceTreeSha: cloud.treeSha,
        ledgerBlobSha: cloud.blobSha,
        rawDigest: cloud.rawDigest,
        ledgerDigest: cloud.ledgerDigest,
        sequence: cloud.sequence,
      });
      const barrier = await establishGithubCloudCollaborationLedgerRefBarrier({
        request,
        provider: {
          readReference: () => {
            const value = ghJson(["api", "--method", "GET",
              `repos/${ledgerRepository}/git/ref/heads/${encodeURIComponent(LEDGER_REF)}`]);
            return value.object?.sha;
          },
          readCommit: revision => readLedgerCommit({ ghJson, ledgerRepository, revision }),
          createCommit: async ({ message, treeSha, parentSha }) => {
            const value = ghJson(["api", "--method", "POST",
              `repos/${ledgerRepository}/git/commits`, "--input", "-"], {
              message,
              tree: treeSha,
              parents: [parentSha],
            });
            return normalizeIntentSupersessionLedgerCommitResponse(value);
          },
          updateReference: async ({ sha, force }) => ghJson([
            "api", "--method", "PATCH",
            `repos/${ledgerRepository}/git/refs/heads/${encodeURIComponent(LEDGER_REF)}`,
            "--input", "-",
          ], { sha, force }),
          readLedgerSnapshot: revision => readRawLedgerSnapshot({
            ghJson,
            ledgerRepository,
            revision,
          }),
        },
      });
      const currentAbsence = analyzeNoEffectScopeExpansionCloudAbsence({
        ledger: barrier.ledger,
        sourceClaimId: plan.evidence.lease.claimId,
        sourceClaimDigest: plan.evidence.cloud.sourceClaimDigest,
        sourceTransitionDigest: plan.evidence.cloud.sourceTransitionDigest,
        sourceTransitionCounter: plan.evidence.cloud.sourceTransitionCounter,
        sourceLeaseExpiresAt: plan.evidence.lease.expiresAt,
        sourceCloudExpiresAt: plan.evidence.cloud.sourceExpiresAt,
        sourcePlanDigest: plan.evidence.sourceIntent.planDigest,
        targetCanonicalBaseSha: plan.evidence.sourceIntent.targetCanonicalBaseSha,
        targetWriteSetDigest: plan.evidence.sourceIntent.targetWriteSetDigest,
        targetDeclaredWriteSet: plan.evidence.sourceIntent.planSnapshot.targetDeclaredWriteSet,
        sourceContinuation: plan.evidence.sourceContinuation ?? null,
        now: now(),
      });
      if (currentAbsence.absenceDigest !== plan.evidence.cloud.absenceDigest
        || currentAbsence.effectiveState !== plan.disposition) {
        throw new Error("Cloud-ledger ref barrier no longer proves the sealed no-effect subject.");
      }
      return barrier.receipt;
    },
    authorizeTaskAuthority: plan => {
      if (!taskAuthorityFile) throw new Error("Intent supersession requires the source task capability.");
      const branch = requiredText(gitAt(sourceRepository, ["branch", "--show-current"]),
        "source branch");
      return authorizeTaskBoundLeaseMutation({
        lease: leaseStore.read(branch),
        capabilityPath: taskAuthorityFile,
        operation: `${OPERATION}:${plan.planDigest}`,
        now: now(),
      });
    },
    finalize: ({ beforeDirt, ...input }) => {
      const finalDirt = captureActiveOwnedDirtEvidence({ repository: sourceRepository });
      requireSameActiveOwnedDirtEvidence(beforeDirt, finalDirt);
      if (finalDirt.evidenceDigest !== input.plan.evidence.dirt.evidenceDigest) {
        throw new Error("Intent supersession source bytes drifted at the final CAS boundary.");
      }
      return applyActiveDirtyScopeExpansionIntentSupersession({
        leaseStore,
        branch: input.plan.evidence.branch,
        clock: now,
        ...input,
      });
    },
  });
}

function buildRecoveredSourceContinuation({ intent, recoveryIntent, lease, dirt, marker }) {
  const currentLeaseDigest = writerLeaseDigest(lease);
  if (intent.sourceLeaseDigest === currentLeaseDigest) return null;
  const recovery = validateCompletedActiveOwnedDirtRecoveryIntent(recoveryIntent);
  const plan = recovery.planSnapshot;
  const binding = assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
  const expectedLeaseRecovery = normalizeActiveOwnedDirtLeaseRecovery({
    schema: "agentic-active-owned-dirt-recovery-lease/v1",
    status: "recovered",
    sourceEpoch: plan.sourceEpoch,
    sourceSessionId: plan.sourceSessionId,
    sourceDevice: plan.sourceDevice,
    sourceBranch: plan.sourceBranch,
    sourceFenceSha: plan.sourceFenceSha,
    sourceClaimId: plan.sourceClaimId,
    planDigest: plan.planDigest,
    evidenceDigest: plan.evidenceDigest,
    snapshotReceiptDigest: recovery.snapshot.snapshotReceiptDigest,
    snapshotRef: recovery.snapshot.snapshotRef,
    snapshotCommitSha: recovery.snapshot.commitSha,
    snapshotIndexCommitSha: recovery.snapshot.indexCommitSha,
    recoveredClaimDigest: recovery.cloud.claimDigest,
    recoveredLedgerRevision: recovery.cloud.ledgerRevision,
    recoveredClaimLedgerRevision: recovery.cloud.claimLedgerRevision,
    recoveredTransitionCounter: recovery.cloud.transitionCounter,
    recoveredAt: recovery.cloud.recoveredAt,
  });
  const oldPlan = intent.planSnapshot;
  const currentPaths = dirt.entries.map(entry => entry.path);
  if (recovery.sourceLeaseDigest !== intent.sourceLeaseDigest
    || recovery.sourceClaimId !== intent.sourceClaimId
    || recovery.localProjection.leaseDigest !== currentLeaseDigest
    || recovery.localProjection.epoch !== lease.epoch
    || recovery.pullRequestProjection.markerDigest !== digestValue(marker)
    || plan.sourceSessionId !== lease.sessionId
    || plan.sourceDevice !== lease.device
    || plan.sourceScope !== lease.scope
    || plan.sourceBranch !== lease.branch
    || plan.sourceBaseSha !== lease.baseSha
    || plan.sourceFenceSha !== lease.fenceSha
    || plan.sourceClaimId !== lease.cloudAuthority?.claimId
    || plan.sourceReviewRequestId !== lease.cloudAuthority?.reviewRequestId
    || plan.sourceCloudLeaseEpoch !== lease.cloudAuthority?.leaseEpoch
    || plan.sourceManifestDigest !== lease.admission?.manifestDigest
    || plan.sourceWriteSetDigest !== lease.admission?.writeSetDigest
    || JSON.stringify(plan.sourceDeclaredWriteSet)
      !== JSON.stringify(lease.admission?.declaredWriteSet)
    || recovery.cloud.claimDigest !== lease.cloudAuthority?.claimDigest
    || recovery.cloud.claimLedgerRevision !== lease.cloudAuthority?.claimLedgerRevision
    || recovery.cloud.transitionCounter !== lease.cloudAuthority?.transitionCounter
    || recovery.cloud.operationReceiptDigest !== lease.cloudAuthority?.operationReceiptDigest
    || recovery.cloud.expiresAt !== lease.cloudAuthority?.expiresAt
    || digestValue(recovery.cloud.authority) !== digestValue(lease.cloudAuthority)
    || digestValue(expectedLeaseRecovery) !== digestValue(lease.activeOwnedDirtRecovery)
    || plan.evidenceDigest !== dirt.evidenceDigest
    || plan.dirtyPathCount !== dirt.pathCount
    || JSON.stringify(currentPaths) !== JSON.stringify(oldPlan.sourceChangedPaths)
    || binding.bindingMode !== "continuation"
    || binding.transitionPlanDigest !== null
    || binding.boundAt !== recovery.cloud.recoveredAt
    || binding.priorBindingDigest === null) {
    throw new Error("Completed active-owned-dirt continuation does not own the live source.");
  }
  const core = {
    schema: RECOVERED_CONTINUATION_SCHEMA,
    variant: "completed-active-owned-dirt-recovery-successor",
    recoveryIntent: recovery,
    recoveryIntentDigest: digestValue(recovery),
    recoveredLease: expectedLeaseRecovery,
    taskAuthorityContinuation: binding,
    historicalLeaseDigest: intent.sourceLeaseDigest,
    currentLeaseDigest,
    priorTaskAuthorityBindingDigest: binding.priorBindingDigest,
    currentTaskAuthorityBindingDigest: binding.bindingDigest,
  };
  return Object.freeze({ ...core, continuationDigest: digestValue(core) });
}

function operationReceiptDigest(entry, status) {
  const schemas = {
    claim: "agentic-collaboration-claim-receipt/v1",
    continue: "agentic-collaboration-continuation-receipt/v1",
    integrate: "agentic-collaboration-integration-receipt/v1",
    retire: "agentic-collaboration-retirement-receipt/v1",
  };
  const core = {
    schema: schemas[entry.action],
    operation: entry.action,
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
  };
  return digestValue(core);
}

export function assertIntentSupersessionRepositoryAuthority({
  sourceRemote,
  targetRepository,
  ledgerRepository,
  cloudAuthority,
}) {
  const target = requiredRepository(targetRepository, "target repository");
  const ledger = requiredRepository(ledgerRepository, "ledger repository");
  if (!cloudAuthority || typeof cloudAuthority !== "object" || Array.isArray(cloudAuthority)
    || repositoryFromRemote(sourceRemote) !== target
    || cloudAuthority.targetRepository !== target
    || cloudAuthority.ledgerRepository !== ledger) {
    throw new Error("Intent supersession source and cloud repositories are not exact.");
  }
  return Object.freeze({ targetRepository: target, ledgerRepository: ledger });
}

function readRawLedgerSnapshot({ ghJson, ledgerRepository, revision = null }) {
  const resolvedRevision = revision === null
    ? requiredSha(ghJson(["api",
      `repos/${ledgerRepository}/git/ref/heads/${encodeURIComponent(LEDGER_REF)}`])
      .object?.sha, "ledger revision")
    : requiredSha(revision, "ledger revision");
  const metadata = ghJson(["api",
    `repos/${ledgerRepository}/contents/${LEDGER_PATH}?ref=${resolvedRevision}`]);
  const blobSha = requiredSha(metadata.sha, "ledger blob SHA");
  const blob = ghJson(["api", `repos/${ledgerRepository}/git/blobs/${blobSha}`]);
  if (blob.encoding !== "base64" || !blob.content) {
    throw new Error("Raw collaboration ledger blob is incomplete.");
  }
  const raw = Buffer.from(String(blob.content).replaceAll("\n", ""), "base64").toString("utf8");
  const ledger = JSON.parse(raw);
  const failures = validateLedger(ledger);
  if (failures.length > 0) throw new Error(`Raw collaboration ledger is invalid: ${failures.join("; ")}`);
  return Object.freeze({
    revision: resolvedRevision,
    treeSha: readLedgerCommit({ ghJson, ledgerRepository, revision: resolvedRevision }).treeSha,
    blobSha,
    rawDigest: createHash("sha256").update(raw).digest("hex"),
    ledgerDigest: requiredDigest(ledger.headDigest, "ledger head digest"),
    sequence: positiveInteger(ledger.sequence, "ledger sequence"),
    ledger,
  });
}

function readController({ controllerRoot, gitAt, targetRepository }) {
  const origin = repositoryFromRemote(gitAt(controllerRoot, ["remote", "get-url", "origin"]));
  if (origin !== targetRepository) throw new Error("Protected controller origin drifted.");
  const branch = gitAt(controllerRoot, ["branch", "--show-current"]);
  const headSha = requiredSha(gitAt(controllerRoot, ["rev-parse", "HEAD"]), "controller HEAD");
  const localMainSha = requiredSha(gitAt(controllerRoot, ["rev-parse", "main"]), "controller main");
  const originMainSha = requiredSha(gitAt(controllerRoot, ["rev-parse", "origin/main"]),
    "controller origin/main");
  const remoteMainSha = remoteSha(gitAt, controllerRoot, "main");
  const clean = gitAt(controllerRoot,
    ["status", "--porcelain=v1", "--untracked-files=all"]) === "";
  if (branch !== "main" || !clean || headSha !== localMainSha
    || headSha !== originMainSha || headSha !== remoteMainSha) {
    throw new Error("Intent supersession requires one clean exact protected controller main.");
  }
  return Object.freeze({
    path: controllerRoot,
    headSha,
    treeSha: requiredSha(gitAt(controllerRoot, ["rev-parse", "HEAD^{tree}"]),
      "controller tree"),
    originMainSha,
    remoteMainSha,
    clean,
    implementationDigest: digestValue(RUNTIME_FILES.map(file => ({
      file,
      digest: digestValue(readFileSync(path.join(controllerRoot, file))),
    }))),
  });
}

function readPullRequest({ ghJson, pullRequestNumber, targetRepository }) {
  const value = ghJson(["pr", "view", String(pullRequestNumber), "--repo", targetRepository,
    "--json", "number,id,url,state,isDraft,autoMergeRequest,headRepository,headRefName,headRefOid,baseRefName,baseRefOid,body"]);
  if (value.number !== pullRequestNumber || value.state !== "OPEN" || value.isDraft !== true
    || value.baseRefName !== "main" || value.autoMergeRequest !== null
    || value.headRepository?.nameWithOwner !== targetRepository
    || !value.id || value.url !== `https://github.com/${targetRepository}/pull/${pullRequestNumber}`) {
    throw new Error("Intent supersession requires the exact open draft source pull request.");
  }
  return Object.freeze({ ...value, body: String(value.body || "") });
}

function readLedgerCommit({ ghJson, ledgerRepository, revision }) {
  return normalizeIntentSupersessionLedgerCommitResponse(ghJson(["api", "--method", "GET",
    `repos/${ledgerRepository}/git/commits/${requiredSha(revision, "ledger commit")}`]));
}

export function normalizeIntentSupersessionLedgerCommitResponse(value) {
  return Object.freeze({
    sha: requiredSha(value?.sha, "ledger commit SHA"),
    treeSha: requiredSha(value?.tree?.sha, "ledger commit tree"),
    parentShas: (value?.parents || []).map(parent => requiredSha(parent.sha, "ledger parent")),
    message: requiredRawText(value?.message, "ledger commit message"),
  });
}

function remoteSha(gitAt, cwd, branch) {
  const lines = gitAt(cwd, ["ls-remote", "--heads", "origin", `refs/heads/${branch}`])
    .split("\n").filter(Boolean);
  if (lines.length !== 1) throw new Error(`Remote ${branch} ref is missing or ambiguous.`);
  return requiredSha(lines[0].split(/\s+/u)[0], `remote ${branch}`);
}

function gitExit(cwd, args) {
  try {
    execFileSync("git", args, { cwd, stdio: "ignore" });
    return 0;
  } catch (error) {
    return Number.isInteger(error?.status) ? error.status : 1;
  }
}

function repositoryFromRemote(value) {
  const match = /(?:github\.com[/:])([^/\s]+)\/([^/\s]+?)(?:\.git)?$/u.exec(String(value).trim());
  if (!match) throw new Error("Git remote is not an exact GitHub repository URL.");
  return `${match[1]}/${match[2]}`;
}
function requiredText(value, label) { if (typeof value !== "string" || !value.trim()) throw new Error(`Intent supersession requires ${label}.`); return value.trim(); }
function requiredRawText(value, label) { if (typeof value !== "string" || !value.trim()) throw new Error(`Intent supersession requires ${label}.`); return value; }
function requiredRepository(value, label) { const result = requiredText(value, label); if (!/^[^/\s]+\/[^/\s]+$/u.test(result)) throw new Error(`Intent supersession has invalid ${label}.`); return result; }
function requiredSha(value, label) { if (!SHA.test(String(value || ""))) throw new Error(`Intent supersession has invalid ${label}.`); return String(value); }
function requiredDigest(value, label) { if (!DIGEST.test(String(value || ""))) throw new Error(`Intent supersession has invalid ${label}.`); return String(value); }
function positiveInteger(value, label) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) throw new Error(`Intent supersession has invalid ${label}.`); return number; }
