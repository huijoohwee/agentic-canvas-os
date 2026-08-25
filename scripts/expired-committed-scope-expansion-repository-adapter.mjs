import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  advanceExpiredCommittedScopeExpansionIntent,
  authorizeExpiredCommittedScopeExpansion,
  beginExpiredCommittedScopeExpansionIntent,
  buildExpiredCommittedScopeExpansionPlan,
  disposeSupersededScopeExpansionIntent,
  INTENT_SCHEMA,
  manifestFromExpiredCommittedPlan,
  normalizeExpiredCommittedScopeExpansionPlan,
  readExpiredCommittedScopeExpansionIntent,
  RESULT_SCHEMA,
} from "./expired-committed-scope-expansion-contract.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { invokeRepositoryCloudVerifier } from "./cloud-collaboration-delivery-verifier.mjs";
import { readOwnershipPullRequest } from "./device-pull-request-state.mjs";
import { assertAdmissionMutationAuthority } from "./scoped-lane-admission-state.mjs";
import {
  bindAdmissionCloudAuthority,
  invokeRepositoryCloudAction,
  verifyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import { normalizeBoundAuthority } from "./scoped-lane-cloud-reconciliation.mjs";
import { assertTaskAuthorityBinding } from "./task-bound-lane-authority-contract.mjs";
import { continueTaskAuthorityCloudSuccessorBinding }
  from "./task-bound-lane-authority-store.mjs";
import {
  createWriterLeaseStore,
  parseWriterLeasePullRequestBody,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import {
  mutateWriterLeaseRegistry,
  writerLeaseDigest,
} from "./writer-lease-registry-cas.mjs";
const PHASES = ["intent", "waiting-successor", "source-retired", "promoted", "successor-bound", "local-cas", "pr-marker", "complete"];

export function resolveExpiredCommittedSuccessorCanonicalBase(plan) {
  return normalizeExpiredCommittedScopeExpansionPlan(plan)
    .protectedMainIncorporationProof.protectedMainSha;
}

export function resolveExpiredCommittedSourceRetirementIdentity({ plan, sourceAuthority }) {
  const normalized = normalizeExpiredCommittedScopeExpansionPlan(plan);
  if (sourceAuthority?.claimId !== normalized.sourceClaimId
    || sourceAuthority?.laneRevision !== normalized.sourceFenceSha) {
    throw new Error("Source retirement requires the exact predecessor cloud identity.");
  }
  return Object.freeze({
    finalRevision: normalized.sourceFenceSha,
    reviewRequestId: sourceAuthority.reviewRequestId ?? null,
  });
}

export function readExpiredCommittedScopeExpansionIntentForLocalProjection(registry, plan) {
  return requireIntent(
    registry?.expiredCommittedScopeExpansionIntents?.[plan.sourceBranch],
    plan,
  );
}

export function createExpiredCommittedScopeExpansionRepositoryAdapter({
  sourceRepository,
  sessionId,
  targetManifest,
  taskAuthorityFile,
  environment = process.env,
  ttlSeconds = 28_800,
  gitText = args => execFileSync("git", args, { cwd: sourceRepository, encoding: "utf8" }).trim(),
  ghText = args => execFileSync("gh", args, { cwd: sourceRepository, encoding: "utf8" }).trim(),
  run = (command, args) => execFileSync(command, args, {
    cwd: sourceRepository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
  invoke = invokeRepositoryCloudAction,
  verify = invokeRepositoryCloudVerifier,
  leaseStore = null,
  now = () => new Date(),
} = {}) {
  const repository = path.resolve(requiredText(sourceRepository, "source repository"));
  const expectedSession = requiredText(sessionId, "session ID");
  const capabilityPath = path.resolve(requiredText(taskAuthorityFile, "external task-authority capability"));
  const store = leaseStore || createWriterLeaseStore({
    gitCommonDir: path.resolve(repository, gitText(["rev-parse", "--git-common-dir"])),
    taskAuthorityFile: capabilityPath,
  });
  function capturePlan() {
    const branch = requiredText(gitText(["branch", "--show-current"]), "source branch");
    const lease = store.read(branch);
    if (!lease || lease.sessionId !== expectedSession) {
      throw new Error("Recovery requires the exact worktree-bound source session.");
    }
    const intent = readExpiredCommittedScopeExpansionIntent({ store, branch });
    if (intent?.planSnapshot) {
      const plan = normalizeExpiredCommittedScopeExpansionPlan(intent.planSnapshot);
      assertTargetUnchanged(plan, targetManifest);
      assertRepositorySubject({ plan, lease, gitText, ghText });
      return Object.freeze({ plan, lease, intent });
    }
    assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
    if (gitText(["status", "--porcelain=v1"])) {
      throw new Error("Recovery requires a clean committed-descendant worktree.");
    }
    const headSha = requiredSha(gitText(["rev-parse", "HEAD"]), "local head");
    const parentSha = requiredSha(gitText(["rev-parse", "HEAD^"]), "local parent");
    const localHeadTreeSha = requiredSha(gitText(["rev-parse", "HEAD^{tree}"]), "local head tree");
    const remoteHeadSha = remoteBranchHead({ branch, gitText });
    const authoredPaths = splitLines(gitText(["diff", "--name-only", `${lease.fenceSha}..${headSha}`]));
    const pullRequest = readOwnershipPullRequest({ url: lease.pullRequestUrl, branch, ghText });
    const status = cloudStatus({ lease, invoke, environment });
    const sourceClaim = exactClaim(status, lease.cloudAuthority.claimId);
    const protectedMainSha = remoteMainHead(gitText);
    const protectedMainIncorporationProof = captureProtectedMainIncorporation({
      lease,
      protectedMainSha,
      gitText,
    });
    const plan = buildExpiredCommittedScopeExpansionPlan({
      lease,
      sourceClaim,
      headSha,
      localHeadTreeSha,
      parentSha,
      remoteHeadSha,
      pullRequest,
      authoredPaths,
      targetManifest,
      protectedMainIncorporationProof,
      evaluatedAt: now().toISOString(),
    });
    return Object.freeze({ plan, lease, intent: null });
  }
  async function execute({ authorization }) {
    const captured = capturePlan();
    const plan = captured.plan;
    let intent = initializeExpiredCommittedScopeExpansionIntent({
      intent: captured.intent,
      plan,
      authorization,
      store,
    });
    requireIntent(intent, plan);
    const successorCanonicalBaseSha = resolveExpiredCommittedSuccessorCanonicalBase(plan);
    const sourceRetirementIdentity = resolveExpiredCommittedSourceRetirementIdentity({
      plan,
      sourceAuthority: captured.lease.cloudAuthority,
    });

    if (!atLeast(intent.status, "waiting-successor")) {
      const result = invoke({
        action: "claim",
        ledgerRepository: captured.lease.cloudAuthority.ledgerRepository,
        request: {
          targetRepository: captured.lease.cloudAuthority.targetRepository,
          workItemId: plan.sourceScope,
          canonicalBaseSha: successorCanonicalBaseSha,
          headSha: plan.sourceFenceSha,
          declaredWriteSet: plan.targetDeclaredWriteSet,
          predecessorClaimId: plan.sourceClaimId,
          leaseEpoch: 1,
          ttlSeconds,
          deviceId: plan.sourceDevice,
          sessionId: plan.sourceSessionId,
          idempotencyKey: `expired-committed-scope-expansion:waiting:${plan.planDigest}`,
        },
        environment,
      });
      const waiting = requireWaiting(result, plan);
      intent = markSource({ plan, intent, status: "waiting-successor", values: {
        waiting,
        waitingReceiptDigest: requiredDigest(result.receipt?.receiptDigest, "waiting receipt"),
        targetClaimId: waiting.claimId,
        targetClaimDigest: waiting.claimDigest,
      } });
    }

    if (!atLeast(intent.status, "source-retired")) {
      const result = invoke({
        action: "retire",
        ledgerRepository: captured.lease.cloudAuthority.ledgerRepository,
        request: {
          targetRepository: captured.lease.cloudAuthority.targetRepository,
          claimId: plan.sourceClaimId,
          expectedFenceRevision: plan.sourceClaimDigest,
          expectedTransitionCounter: plan.sourceClaimTransitionCounter,
          reason: "superseded",
          finalRevision: sourceRetirementIdentity.finalRevision,
          reviewRequestId: sourceRetirementIdentity.reviewRequestId,
          bytesDigest: digestValue({ planDigest: plan.planDigest, kind: "committed-bytes" }),
          namedChecksDigest: digestValue({ planDigest: plan.planDigest, kind: "scope-proof" }),
          handoffEvidenceDigest: digestValue({ planDigest: plan.planDigest, kind: "successor" }),
          deviceId: plan.sourceDevice,
          sessionId: plan.sourceSessionId,
          idempotencyKey: `expired-committed-scope-expansion:retire:${plan.planDigest}`,
        },
        environment,
      });
      if (result?.ok !== true || result.action !== "retire"
        || result.claim?.claimId !== plan.sourceClaimId
        || !["retired", "released"].includes(result.claim?.state)) {
        throw new Error("Dormant source retirement did not prove the exact predecessor transition.");
      }
      intent = markSource({ plan, intent, status: "source-retired", values: {
        sourceRetirementReceiptDigest: requiredDigest(result.receipt?.receiptDigest, "retirement receipt"),
      } });
    }

    if (!atLeast(intent.status, "promoted")) {
      const waiting = requireClaimSnapshot(intent.waiting, "waiting successor");
      const result = waiting.state === "current" ? null : invoke({
        action: "continue", ledgerRepository: captured.lease.cloudAuthority.ledgerRepository,
        request: { targetRepository: captured.lease.cloudAuthority.targetRepository,
          claimId: waiting.claimId, expectedFenceRevision: waiting.claimDigest,
          expectedTransitionCounter: waiting.transitionCounter, mode: "promote", ttlSeconds,
          deviceId: plan.sourceDevice, sessionId: plan.sourceSessionId,
          idempotencyKey: `expired-committed-scope-expansion:promote:${plan.planDigest}` },
        environment,
      });
      const promoted = result ? requirePromoted(result, waiting, plan) : waiting;
      intent = markSource({ plan, intent, status: "promoted", values: {
        promoted,
        promotedReceiptDigest: result
          ? requiredDigest(result.receipt?.receiptDigest, "promotion receipt")
          : intent.waitingReceiptDigest,
        targetClaimDigest: promoted.claimDigest,
      } });
    }

    let authority = intent.boundAuthority;
    if (!atLeast(intent.status, "successor-bound")) {
      authority = bindSuccessor({ plan, lease: captured.lease, promoted: intent.promoted });
      intent = markSource({ plan, intent, status: "successor-bound", values: {
        boundAuthority: authority,
        boundReceiptDigest: requiredDigest(authority.__verificationReceiptDigest, "binding receipt"),
        targetClaimDigest: authority.claimDigest,
        targetReviewRequestId: authority.reviewRequestId,
      } });
      authority = withoutPrivateReceipt(authority);
    } else {
      authority = withoutPrivateReceipt(intent.boundAuthority);
    }

    let localProjection = intent.localProjection;
    if (!atLeast(intent.status, "local-cas")) {
      const result = projectLocalSuccessor({ plan, authority, intent });
      intent = result.intent;
      localProjection = result.localProjection;
    }

    if (!atLeast(intent.status, "pr-marker")) {
      const lease = store.read(plan.sourceBranch);
      const pullRequest = readOwnershipPullRequest({ url: plan.pullRequestUrl, branch: plan.sourceBranch, ghText });
      mutateWriterLeaseRegistry({
        leaseStore: store,
        branch: plan.sourceBranch,
        expectedLeaseDigest: localProjection.leaseDigest,
        expectedClaimId: authority.claimId,
        action: ({ registry, lease: currentLease }) => {
          run("gh", ["pr", "edit", plan.pullRequestUrl, "--body", updateWriterLeasePullRequestBody(pullRequest.body, currentLease)]);
          return { registry, lease: currentLease, changed: false };
        },
      });
      const verified = readOwnershipPullRequest({ url: plan.pullRequestUrl, branch: plan.sourceBranch, ghText });
      assertExpandedLease(parseWriterLeasePullRequestBody(verified.body), plan, authority);
      intent = markCurrent({ plan, status: "pr-marker", values: {
        pullRequestProjection: { markerDigest: digestValue(parseWriterLeasePullRequestBody(verified.body)) },
        pullRequestProjectionReceiptDigest: digestValue({ planDigest: plan.planDigest, pullRequestBody: verified.body }),
      } });
    }

    if (!atLeast(intent.status, "complete")) {
      const lease = store.read(plan.sourceBranch);
      assertExpandedLease(lease, plan, authority);
      const verification = verifyAdmissionCloudAuthority({
        authority,
        manifest: manifestFromExpiredCommittedPlan(plan),
        canonicalBaseSha: successorCanonicalBaseSha,
        environment,
        inspect: invoke,
        invoke: verify,
      });
      const mutation = assertAdmissionMutationAuthority({
        lease,
        cloudAuthority: verification.authority,
        remoteAuthorityVerification: verification.verification,
      });
      const finalReceiptDigest = digestValue({
        schema: "agentic-expired-committed-scope-expansion-complete/v1",
        planDigest: plan.planDigest,
        leaseDigest: writerLeaseDigest(lease),
        mutationAuthorityReceiptDigest: mutation.receiptDigest,
        prProjectionReceiptDigest: intent.pullRequestProjectionReceiptDigest,
      });
      intent = markCurrent({ plan, status: "complete", values: { finalReceiptDigest } });
    }
    return Object.freeze({ schema: RESULT_SCHEMA, status: "complete", plan, intent, receiptDigest: intent.finalReceiptDigest });
  }

  function bindSuccessor({ plan, lease, promoted }) {
    const status = cloudStatus({ lease, invoke, environment });
    const claim = exactClaim(status, promoted.claimId);
    if (claim.state !== "current" || claim.fenceRevision !== promoted.claimDigest) {
      throw new Error("Promoted successor changed before pull-request binding.");
    }
    const manifest = manifestFromExpiredCommittedPlan(plan);
    const seed = normalizeBoundAuthority({
      result: { ...status, action: "continue", claim, claimDigest: claim.fenceRevision },
      authority: { ...lease.cloudAuthority, manifestDigest: plan.targetManifestDigest },
      manifest,
      deviceId: plan.sourceDevice,
      sessionId: plan.sourceSessionId,
    });
    const bound = bindAdmissionCloudAuthority({
      authority: seed,
      manifest,
      branch: plan.sourceBranch,
      headSha: plan.sourceFenceSha,
      reviewRequestId: plan.reviewRequestId,
      deviceId: plan.sourceDevice,
      sessionId: plan.sourceSessionId,
      idempotencyKey: `expired-committed-scope-expansion:bind:${plan.planDigest}`,
      returnVerification: true,
      environment,
      invoke,
      inspect: invoke,
      verify,
    });
    return Object.freeze({ ...bound.authority, __verificationReceiptDigest: bound.verification.receiptDigest });
  }

  function projectLocalSuccessor({ plan, authority, intent }) {
    const sourceLease = store.read(plan.sourceBranch);
    const manifest = manifestFromExpiredCommittedPlan(plan);
    const verification = verifyAdmissionCloudAuthority({
      authority,
      manifest,
      canonicalBaseSha: resolveExpiredCommittedSuccessorCanonicalBase(plan),
      environment,
      inspect: invoke,
      invoke: verify,
    });
    let projectedIntent;
    let localProjection;
    mutateWriterLeaseRegistry({
      leaseStore: store,
      branch: plan.sourceBranch,
      expectedLeaseDigest: plan.sourceLeaseDigest,
      expectedClaimId: plan.sourceClaimId,
      action: ({ registry, lease }) => {
        readExpiredCommittedScopeExpansionIntentForLocalProjection(registry, plan);
        assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
        const admission = successorAdmission({ sourceAdmission: lease.admission, plan, authority });
        const nextCore = {
          ...lease,
          admission,
          cloudAuthority: verification.authority,
          heartbeatAt: verification.authority.expiresAt,
          expiresAt: verification.authority.expiresAt,
        };
        const nextLease = {
          ...nextCore,
          taskAuthority: continueTaskAuthorityCloudSuccessorBinding({
            sourceLease: lease,
            nextLease: nextCore,
            capabilityPath,
            boundAt: now().toISOString(),
          }),
        };
        const mutation = assertAdmissionMutationAuthority({
          lease: nextLease,
          cloudAuthority: verification.authority,
          remoteAuthorityVerification: verification.verification,
        });
        localProjection = Object.freeze({
          leaseDigest: writerLeaseDigest(nextLease),
          claimId: authority.claimId,
          receiptDigest: mutation.receiptDigest,
        });
        projectedIntent = Object.freeze({
          ...intent,
          schema: INTENT_SCHEMA,
          status: "local-cas",
          localProjection,
          localProjectionReceiptDigest: mutation.receiptDigest,
          boundAuthority: authority,
        });
        return {
          registry: {
            ...registry,
            leases: { ...registry.leases, [plan.sourceBranch]: nextLease },
            scopeExpansionIntents: disposeSupersededScopeExpansionIntent({ registry, lease, plan }),
            expiredCommittedScopeExpansionIntents: {
              ...(registry.expiredCommittedScopeExpansionIntents || {}),
              [plan.sourceBranch]: projectedIntent,
            },
          },
          lease: nextLease,
          intent: projectedIntent,
          changed: true,
        };
      },
    });
    return Object.freeze({ intent: projectedIntent, localProjection });
  }

  function markSource({ plan, status, values }) {
    return advanceExpiredCommittedScopeExpansionIntent({
      store,
      branch: plan.sourceBranch,
      expectedLeaseDigest: plan.sourceLeaseDigest,
      expectedClaimId: plan.sourceClaimId,
      expectedPlanDigest: plan.planDigest,
      values: { status, ...values },
    }).intent;
  }

  function markCurrent({ plan, status, values }) {
    const lease = store.read(plan.sourceBranch);
    return advanceExpiredCommittedScopeExpansionIntent({
      store,
      branch: plan.sourceBranch,
      expectedLeaseDigest: writerLeaseDigest(lease),
      expectedClaimId: lease.cloudAuthority.claimId,
      expectedPlanDigest: plan.planDigest,
      values: { status, ...values },
    }).intent;
  }

  return Object.freeze({ capturePlan, execute });
}

export function initializeExpiredCommittedScopeExpansionIntent({
  intent,
  plan,
  authorization,
  store,
  begin = beginExpiredCommittedScopeExpansionIntent,
}) {
  if (intent) return intent;
  authorizeExpiredCommittedScopeExpansion(plan, authorization);
  return begin({
    store,
    branch: plan.sourceBranch,
    expectedLeaseDigest: plan.sourceLeaseDigest,
    expectedClaimId: plan.sourceClaimId,
    plan,
  });
}

function successorAdmission({ sourceAdmission, plan, authority }) {
  return Object.freeze({
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: plan.sourceScope,
    declaredWriteSet: plan.targetDeclaredWriteSet,
    writeSetDigest: plan.targetWriteSetDigest,
    manifestDigest: plan.targetManifestDigest,
    planReceiptDigest: plan.planDigest,
    admissionReceiptDigest: authority.operationReceiptDigest,
    existingLaneStateDigest: sourceAdmission.existingLaneStateDigest,
    admittedReportDigest: digestValue({ planDigest: plan.planDigest, claimId: authority.claimId }),
    preservationReceiptDigest: digestValue({ planDigest: plan.planDigest, sourceAdmission: digestValue(sourceAdmission) }),
  });
}

function captureProtectedMainIncorporation({ lease, protectedMainSha, gitText }) {
  if (!isAncestor(lease.baseSha, protectedMainSha, gitText)
    || !isAncestor(protectedMainSha, lease.fenceSha, gitText)) {
    throw new Error("Protected main is not incorporated into the exact source fence.");
  }
  const protectedMainChangedPaths = String(gitText([
    "diff", "--name-only", "--no-renames", "-z", lease.baseSha, protectedMainSha, "--",
  ]) || "").split("\0").filter(Boolean).sort();
  const core = {
    schema: "agentic-protected-main-incorporated-fence/v1",
    sourceBaseSha: lease.baseSha,
    protectedMainSha,
    protectedMainTreeSha: requiredSha(gitText(["rev-parse", `${protectedMainSha}^{tree}`]), "protected main tree"),
    fenceSha: lease.fenceSha,
    fenceTreeSha: requiredSha(gitText(["rev-parse", `${lease.fenceSha}^{tree}`]), "source fence tree"),
    sourceBaseAncestorOfProtectedMain: true,
    protectedMainAncestorOfFence: true,
    protectedMainChangedPaths,
    protectedMainChangedPathsDigest: digestValue(protectedMainChangedPaths),
  };
  return Object.freeze({ ...core, evidenceDigest: digestValue(core) });
}

function isAncestor(ancestor, descendant, gitText) {
  try {
    gitText(["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

function cloudStatus({ lease, invoke, environment }) {
  const result = invoke({
    action: "status",
    ledgerRepository: lease.cloudAuthority.ledgerRepository,
    request: { targetRepository: lease.cloudAuthority.targetRepository },
    environment,
  });
  if (result?.ok !== true || result.action !== "status" || !Array.isArray(result.claims)) {
    throw new Error("Cloud status did not return an authoritative claim inventory.");
  }
  return result;
}

function exactClaim(status, claimId) {
  const claims = status.claims.filter(claim => claim?.claimId === claimId);
  if (claims.length !== 1) throw new Error("Cloud inventory did not contain one exact claim.");
  return claims[0];
}

function requireWaiting(result, plan) {
  const claim = result?.claim;
  if (result?.ok !== true || result.action !== "claim"
    || !["waiting-successor", "current"].includes(claim?.state)
    || claim.predecessorClaimId !== plan.sourceClaimId || claim.laneRevision !== plan.sourceFenceSha
    || claim.writeSetDigest !== plan.targetWriteSetDigest) {
    throw new Error("Cloud did not create the exact waiting scope successor.");
  }
  return claimSnapshot(result);
}

function requirePromoted(result, waiting, plan) {
  const claim = result?.claim;
  if (result?.ok !== true || result.action !== "continue" || claim?.state !== "current"
    || claim.claimId !== waiting.claimId || claim.laneRevision !== plan.sourceFenceSha
    || claim.writeSetDigest !== plan.targetWriteSetDigest) {
    throw new Error("Cloud did not promote the exact waiting scope successor.");
  }
  return claimSnapshot(result);
}

function claimSnapshot(result) {
  return Object.freeze({
    claimId: requiredDigest(result.claim.claimId, "claim ID"),
    claimDigest: requiredDigest(result.claimDigest || result.claim.fenceRevision, "claim digest"),
    ledgerRevision: requiredSha(result.ledgerRevision, "ledger revision"),
    claimLedgerRevision: requiredDigest(result.claim.transitionDigest, "claim ledger revision"),
    transitionCounter: positiveInteger(result.claim.transitionCounter, "claim transition counter"),
    expiresAt: requiredText(result.claim.expiresAt, "claim expiry"),
    state: requiredText(result.claim.state, "claim state"),
  });
}

function assertRepositorySubject({ plan, lease, gitText, ghText }) {
  if (gitText(["status", "--porcelain=v1"]) || gitText(["rev-parse", "HEAD"]) !== plan.localHeadSha
    || remoteBranchHead({ branch: plan.sourceBranch, gitText }) !== plan.sourceFenceSha) {
    throw new Error("Recovery repository subject drifted from its durable plan.");
  }
  const pullRequest = readOwnershipPullRequest({ url: plan.pullRequestUrl, branch: plan.sourceBranch, ghText });
  if (pullRequest.id !== plan.reviewRequestId || pullRequest.headRefOid !== plan.sourceFenceSha) {
    throw new Error("Recovery pull-request subject drifted from its durable plan.");
  }
  if (![plan.sourceClaimId, lease.cloudAuthority?.claimId].includes(lease.cloudAuthority?.claimId)) {
    throw new Error("Recovery lease is neither the source nor its projected successor.");
  }
}

function assertExpandedLease(lease, plan, authority) {
  if (lease?.admission?.writeSetDigest !== plan.targetWriteSetDigest
    || lease.admission.manifestDigest !== plan.targetManifestDigest
    || lease.cloudAuthority?.claimId !== authority.claimId
    || lease.cloudAuthority?.claimDigest !== authority.claimDigest
    || lease.cloudAuthority?.reviewRequestId !== plan.reviewRequestId
    || lease.fenceSha !== plan.sourceFenceSha) {
    throw new Error("Expanded local or pull-request lease does not bind the exact successor.");
  }
}

function requireIntent(intent, plan) {
  if (intent?.planDigest !== plan.planDigest || intent.sourceLeaseDigest !== plan.sourceLeaseDigest
    || intent.sourceClaimId !== plan.sourceClaimId) {
    throw new Error("Scope-expansion intent changed from the exact recovery plan.");
  }
  return intent;
}

function assertTargetUnchanged(plan, target) {
  if (target?.manifestDigest !== plan.targetManifestDigest || target.writeSetDigest !== plan.targetWriteSetDigest) {
    throw new Error("Target scope manifest drifted from the durable recovery plan.");
  }
}

function withoutPrivateReceipt(authority) {
  if (!authority) return authority;
  const { __verificationReceiptDigest: ignored, ...clean } = authority;
  void ignored;
  return Object.freeze(clean);
}

function atLeast(current, expected) {
  return PHASES.indexOf(current) >= PHASES.indexOf(expected);
}

function remoteBranchHead({ branch, gitText }) {
  const first = gitText(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).split(/\s+/u)[0];
  return requiredSha(first, "remote branch head");
}

function remoteMainHead(gitText) {
  const first = gitText(["ls-remote", "--heads", "origin", "refs/heads/main"]).split(/\s+/u)[0];
  return requiredSha(first, "protected main head");
}

function splitLines(value) {
  return [...new Set(String(value || "").split(/\r?\n/u).map(item => item.trim()).filter(Boolean))].sort();
}

function requireClaimSnapshot(value, label) {
  if (!value?.claimId || !value?.claimDigest) throw new Error(`${label} is missing.`);
  return value;
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function requiredSha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) throw new Error(`${label} must be a SHA.`);
  return String(value);
}

function requiredDigest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) throw new Error(`${label} must be a digest.`);
  return String(value);
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}
