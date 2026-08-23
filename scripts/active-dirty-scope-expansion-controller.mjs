import { execFileSync } from "node:child_process";
import path from "node:path";

import {
  authorizeActiveDirtyScopeExpansion,
  buildActiveDirtyScopeExpansionPlan,
  buildExpansionReceipt,
  normalizeActiveDirtyScopeExpansionPlan,
  verifyBoundSuccessor,
  verifyPromotedSuccessor,
  verifyWaitingSuccessor,
} from "./active-dirty-scope-expansion-contract.mjs";
import { captureActiveDirtyScopeExpansionProtectedMain }
  from "./active-dirty-scope-expansion-protected-main.mjs";
import {
  assertActiveDirtyScopeExpansionTaskSuccessorPreflight,
  projectActiveDirtyScopeExpansionSuccessor,
}
  from "./active-dirty-scope-expansion-successor-projection.mjs";
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
import {
  createWriterLeaseStore,
  parseWriterLeasePullRequestBody,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import {
  advanceScopeExpansionIntent,
  assertExpansionIntentCurrent,
  beginScopeExpansionIntent,
  readScopeExpansionIntent,
  withHeartbeatProjectionFence,
  writerLeaseDigest,
} from "./writer-lease-registry-cas.mjs";

const PHASES = Object.freeze([
  "intent",
  "waiting-successor",
  "source-retired",
  "promoted",
  "successor-bound",
  "local-cas",
  "pr-marker",
  "complete",
]);

export function createActiveDirtyScopeExpansionControllerAdapter(methods = {}) {
  const adapter = Object.freeze({
    readState: methods.readState,
    beginIntent: methods.beginIntent,
    markIntent: methods.markIntent,
    claimWaitingSuccessor: methods.claimWaitingSuccessor,
    retireSource: methods.retireSource,
    promoteSuccessor: methods.promoteSuccessor,
    bindSuccessor: methods.bindSuccessor,
    projectLocal: methods.projectLocal,
    projectPullRequest: methods.projectPullRequest,
    finalize: methods.finalize,
  });
  for (const key of Object.keys(adapter)) {
    if (typeof adapter[key] !== "function") {
      throw new Error(`Scope-expansion controller adapter requires ${key}().`);
    }
  }
  return adapter;
}

export async function runActiveDirtyScopeExpansion({
  targetManifest,
  authorization = null,
}, { adapter } = {}) {
  if (!adapter) throw new Error("Scope-expansion controller adapter is required.");
  const first = await adapter.readState();
  const plan = resolvePlan({ state: first, targetManifest });
  assertActiveDirtyScopeExpansionTaskSuccessorPreflight({
    lease: first?.source?.lease,
    plan,
    requireTaskAuthority: first?.requireTaskAuthoritySuccessor === true,
  });
  const existingIntent = first.intent || null;
  const receipts = [
    buildExpansionReceipt({
      phase: "preflight",
      plan,
      values: {
        sourceStateDigest: requiredDigest(first.sourceStateDigest, "source state digest"),
        targetObservationDigest: requiredDigest(first.targetObservationDigest, "target observation digest"),
      },
    }),
  ];

  if (!existingIntent) authorizeActiveDirtyScopeExpansion({ plan, authorization });
  let intent = existingIntent || await adapter.beginIntent({ plan });
  intent = normalizeIntentProjection(intent);
  requirePlanIntent(intent, plan);
  receipts.push(buildExpansionReceipt({
    phase: "intent",
    plan,
    values: { intentDigest: requiredDigest(intent.intentDigest, "intent digest") },
  }));

  let waiting = intent.waiting || null;
  if (!atLeast(intent.status, "waiting-successor")) {
    const result = await adapter.claimWaitingSuccessor({ plan, intent });
    waiting = verifyWaitingSuccessor({ plan, result });
    const waitingReceiptDigest = requiredDigest(
      result?.receipt?.receiptDigest,
      "waiting successor cloud receipt digest",
    );
    intent = await adapter.markIntent({
      plan,
      intent,
      status: "waiting-successor",
      waiting,
      waitingReceiptDigest,
      targetClaimId: waiting.claimId,
      targetClaimDigest: waiting.claimDigest,
    });
    intent = normalizeIntentProjection(intent);
  } else {
    waiting = requireWaiting(intent.waiting);
  }
  receipts.push(buildExpansionReceipt({
    phase: "waiting-successor",
    plan,
    values: {
      successorClaimId: waiting.claimId,
      successorClaimDigest: waiting.claimDigest,
      successorClaimReceiptDigest: requiredDigest(intent.waitingReceiptDigest, "waiting receipt digest"),
    },
  }));

  if (!atLeast(intent.status, "source-retired")) {
    const retired = await adapter.retireSource({ plan, intent, waiting });
    intent = await adapter.markIntent({
      plan,
      intent,
      status: "source-retired",
      sourceRetirementReceiptDigest: requiredDigest(retired.receiptDigest, "source retirement receipt digest"),
    });
    intent = normalizeIntentProjection(intent);
  }
  receipts.push(buildExpansionReceipt({
    phase: "source-retired",
    plan,
    values: { sourceRetirementReceiptDigest: requiredDigest(intent.sourceRetirementReceiptDigest, "source retirement receipt digest") },
  }));

  let promoted = intent.promoted || null;
  if (!atLeast(intent.status, "promoted")) {
    const result = await adapter.promoteSuccessor({ plan, intent, waiting });
    promoted = verifyPromotedSuccessor({ plan, result, waiting });
    const promotedReceiptDigest = requiredDigest(
      result?.receipt?.receiptDigest,
      "promoted successor cloud receipt digest",
    );
    intent = await adapter.markIntent({
      plan,
      intent,
      status: "promoted",
      promoted,
      promotedReceiptDigest,
      targetClaimId: promoted.claimId,
      targetClaimDigest: promoted.claimDigest,
    });
    intent = normalizeIntentProjection(intent);
  } else {
    promoted = requirePromoted(intent.promoted);
  }
  receipts.push(buildExpansionReceipt({
    phase: "promoted",
    plan,
    values: {
      successorClaimId: promoted.claimId,
      successorClaimDigest: promoted.claimDigest,
      successorPromotionReceiptDigest: requiredDigest(intent.promotedReceiptDigest, "promotion receipt digest"),
    },
  }));

  let bound = intent.boundAuthority || null;
  if (!atLeast(intent.status, "successor-bound")) {
    const boundResult = await adapter.bindSuccessor({ plan, intent, promoted });
    bound = verifyBoundSuccessor({
      plan,
      authority: boundResult?.authority || boundResult,
      reviewRequestId: requiredText(first.reviewRequestId, "source review request ID"),
    });
    const boundReceiptDigest = requiredDigest(
      boundResult?.receiptDigest || boundResult?.verification?.receiptDigest,
      "bound successor receipt digest",
    );
    intent = await adapter.markIntent({
      plan,
      intent,
      status: "successor-bound",
      boundAuthority: bound,
      boundReceiptDigest,
      targetClaimId: bound.claimId,
      targetClaimDigest: bound.claimDigest,
      targetReviewRequestId: bound.reviewRequestId,
    });
    intent = normalizeIntentProjection(intent);
  } else {
    bound = intent.boundAuthority;
    verifyBoundSuccessor({
      plan,
      authority: bound,
      reviewRequestId: requiredText(first.reviewRequestId, "source review request ID"),
    });
  }
  receipts.push(buildExpansionReceipt({
    phase: "successor-bound",
    plan,
    values: {
      successorClaimId: bound.claimId,
      successorClaimDigest: bound.claimDigest,
      successorBindReceiptDigest: requiredDigest(intent.boundReceiptDigest, "bind receipt digest"),
    },
  }));

  let localProjection = intent.localProjection || null;
  if (!atLeast(intent.status, "local-cas")) {
    const localResult = await adapter.projectLocal({ plan, intent, authority: bound });
    intent = normalizeIntentProjection(localResult?.intent);
    requirePlanIntent(intent, plan);
    if (intent.status !== "local-cas") {
      throw new Error("Local successor projection did not atomically persist its intent.");
    }
    localProjection = intent.localProjection;
    requiredDigest(localResult?.receiptDigest, "local projection receipt digest");
    if (localResult.receiptDigest !== intent.localProjectionReceiptDigest) {
      throw new Error("Local successor projection receipt drifted from its durable intent.");
    }
  }
  receipts.push(buildExpansionReceipt({
    phase: "local-cas",
    plan,
    values: { localProjectionReceiptDigest: requiredDigest(intent.localProjectionReceiptDigest, "local projection receipt digest") },
  }));

  if (!atLeast(intent.status, "pr-marker")) {
    const prResult = await adapter.projectPullRequest({
      plan,
      intent,
      authority: bound,
      localProjection,
    });
    const prProjection = prResult?.projection || prResult;
    const pullRequestProjectionReceiptDigest = requiredDigest(
      prResult?.receiptDigest,
      "pull-request projection receipt digest",
    );
    intent = await adapter.markIntent({
      plan,
      intent,
      status: "pr-marker",
      pullRequestProjection: prProjection,
      pullRequestProjectionReceiptDigest,
    });
    intent = normalizeIntentProjection(intent);
  }
  receipts.push(buildExpansionReceipt({
    phase: "pr-marker",
    plan,
    values: { pullRequestProjectionReceiptDigest: requiredDigest(intent.pullRequestProjectionReceiptDigest, "pull-request projection receipt digest") },
  }));

  if (!atLeast(intent.status, "complete")) {
    const finalState = await adapter.finalize({ plan, intent, authority: bound });
    intent = await adapter.markIntent({
      plan,
      intent,
      status: "complete",
      finalReceiptDigest: requiredDigest(finalState.receiptDigest, "final receipt digest"),
    });
    intent = normalizeIntentProjection(intent);
  }
  receipts.push(buildExpansionReceipt({
    phase: "complete",
    plan,
    values: { finalReceiptDigest: requiredDigest(intent.finalReceiptDigest, "final receipt digest") },
  }));

  return Object.freeze({
    schema: "agentic-active-dirty-scope-expansion-result/v1",
    status: "complete",
    plan,
    intent,
    receipts: Object.freeze(receipts),
    receiptDigest: requiredDigest(intent.finalReceiptDigest, "final receipt digest"),
  });
}

/**
 * Creates the repository-owned adapter for an active, dirty lane.  The caller
 * is deliberately separate from the source lane: it may mutate the source
 * projection only through the registry CAS helpers after the successor cloud
 * claim has been bound to the existing draft pull request.
 */
export function createRepositoryActiveDirtyScopeExpansionAdapter({
  sourceRepository,
  sessionId,
  targetManifest = null,
  environment = process.env,
  ttlSeconds = 28_800,
  gitText = (args, options = {}) => execFileSync("git", args, {
    cwd: sourceRepository,
    encoding: "utf8",
    ...options,
  }).trim(),
  ghText = args => execFileSync("gh", args, {
    cwd: sourceRepository,
    encoding: "utf8",
  }).trim(),
  run = (command, args) => execFileSync(command, args, {
    cwd: sourceRepository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
  leaseStore = null,
  taskAuthorityFile = environment.AGENTIC_TASK_AUTHORITY_FILE || null,
  invoke = invokeRepositoryCloudAction,
  verify = invokeRepositoryCloudVerifier,
} = {}) {
  const repository = path.resolve(requiredText(sourceRepository, "source repository"));
  const normalizedSession = requiredText(sessionId, "session ID");
  const normalizedTtl = positiveInteger(ttlSeconds, "TTL seconds");
  const store = leaseStore || createWriterLeaseStore({
    gitCommonDir: path.resolve(repository, gitText(["rev-parse", "--git-common-dir"])),
    taskAuthorityFile,
  });

  const sourceSnapshot = () => {
    const branch = requiredText(gitText(["branch", "--show-current"]), "source branch");
    const lease = store.verify({ sessionId: normalizedSession, branch });
    const authority = lease.cloudAuthority;
    if (
      lease.status !== "active"
      || !lease.admission
      || lease.admission.status !== "admitted"
      || !authority
      || authority.state !== "active"
      || !authority.reviewRequestId
      || authority.sessionId !== normalizedSession
      || authority.claimId !== lease.cloudAuthority?.claimId
    ) {
      throw new Error("Scope expansion requires this session's active admitted source lease.");
    }
    const remoteFence = firstSha(gitText([
      "ls-remote", "--heads", "origin", `refs/heads/${branch}`,
    ]));
    if (remoteFence !== lease.fenceSha) {
      throw new Error("Source remote fence drifted before scope expansion.");
    }
    const unstaged = splitPaths(gitText(["diff", "--name-only"]));
    const staged = splitPaths(gitText(["diff", "--cached", "--name-only"]));
    const untracked = splitPaths(gitText(["ls-files", "--others", "--exclude-standard"]));
    const changedPaths = [...new Set([...unstaged, ...staged])].sort();
    const dirtyDigest = digestValue({
      stagedPatch: gitText(["diff", "--cached", "--binary"]),
      unstagedPatch: gitText(["diff", "--binary"]),
      changedPaths,
      untracked,
    });
    const intent = readScopeExpansionIntent({ leaseStore: store, branch });
    const protectedMainSha = firstSha(gitText([
      "ls-remote", "--heads", "origin", "refs/heads/main",
    ]));
    const pullRequest = readOwnershipPullRequest({
      url: lease.pullRequestUrl,
      branch,
      ghText,
    });
    const protectedMain = captureActiveDirtyScopeExpansionProtectedMain({
      sourceBaseSha: lease.baseSha,
      pullRequestBaseSha: pullRequest.baseRefOid,
      protectedMainSha,
      targetDeclaredWriteSet: intent?.planSnapshot?.targetDeclaredWriteSet
        || targetManifest?.declaredWriteSet
        || lease.admission.declaredWriteSet,
      gitText,
    });
    const targetCanonicalBaseSha = lease.baseSha;
    const source = {
      lease,
      branch,
      fenceSha: lease.fenceSha,
      claimId: authority.claimId,
      claimDigest: authority.claimDigest,
      changedPaths,
      untrackedPaths: untracked,
      dirtyDigest,
    };
    return Object.freeze({
      branch,
      lease,
      authority,
      intent,
      source,
      requireTaskAuthoritySuccessor: true,
      reviewRequestId: authority.reviewRequestId,
      targetCanonicalBaseSha,
      canonicalDescendantProof: protectedMain.canonicalDescendantProof,
      sourceStateDigest: digestValue({ source, leaseDigest: writerLeaseDigest(lease) }),
      targetObservationDigest: digestValue({ targetCanonicalBaseSha, protectedMain }),
    });
  };

  return createActiveDirtyScopeExpansionControllerAdapter({
    readState: sourceSnapshot,

    beginIntent({ plan }) {
      const current = sourceSnapshot();
      const result = beginScopeExpansionIntent({
        leaseStore: store,
        branch: current.branch,
        expectedLeaseDigest: plan.sourceLeaseDigest,
        expectedClaimId: plan.sourceClaimId,
        plan,
      });
      return decorateIntent(result.intent);
    },

    markIntent({ plan, intent, status, ...values }) {
      const current = sourceSnapshot();
      const expected = expectedProjectionForIntent({ plan, intent, values, current });
      const result = advanceScopeExpansionIntent({
        leaseStore: store,
        branch: current.branch,
        expectedLeaseDigest: expected.leaseDigest,
        expectedClaimId: expected.claimId,
        expectedPlanDigest: plan.planDigest,
        values: { status, ...values },
      });
      return decorateIntent(result.intent);
    },

    claimWaitingSuccessor({ plan }) {
      const current = sourceSnapshot();
      assertSourceLeaseMatchesPlan({ current, plan });
      return invoke({
        action: "claim",
        ledgerRepository: current.authority.ledgerRepository,
        request: {
          targetRepository: current.authority.targetRepository,
          workItemId: current.lease.scope,
          canonicalBaseSha: plan.targetCanonicalBaseSha,
          headSha: plan.sourceFenceSha,
          declaredWriteSet: plan.targetDeclaredWriteSet,
          ...(plan.canonicalDescendantProof
            ? { canonicalDescendantProof: plan.canonicalDescendantProof }
            : {}),
          predecessorClaimId: plan.sourceClaimId,
          leaseEpoch: 1,
          ttlSeconds: normalizedTtl,
          deviceId: current.lease.device,
          sessionId: normalizedSession,
          idempotencyKey: `active-dirty-scope-expansion:waiting:${plan.planDigest}`,
        },
        environment,
      });
    },

    retireSource({ plan, intent, waiting }) {
      const current = sourceSnapshot();
      assertSourceLeaseMatchesPlan({ current, plan });
      assertExpansionIntentCurrent({
        leaseStore: store,
        branch: current.branch,
        planDigest: plan.planDigest,
        sourceLeaseDigest: plan.sourceLeaseDigest,
        sourceClaimId: plan.sourceClaimId,
      });
      const evidence = expansionEvidence({ phase: "source-retired", plan, waiting });
      const result = invoke({
        action: "retire",
        ledgerRepository: current.authority.ledgerRepository,
        request: {
          targetRepository: current.authority.targetRepository,
          claimId: plan.sourceClaimId,
          expectedFenceRevision: plan.sourceClaimDigest,
          expectedTransitionCounter: plan.sourceClaimTransitionCounter,
          reason: "superseded",
          finalRevision: plan.sourceFenceSha,
          reviewRequestId: plan.sourceReviewRequestId,
          bytesDigest: digestValue({ ...evidence, kind: "bytes" }),
          namedChecksDigest: digestValue({ ...evidence, kind: "checks" }),
          handoffEvidenceDigest: digestValue({ ...evidence, kind: "handoff" }),
          deviceId: current.lease.device,
          sessionId: normalizedSession,
          idempotencyKey: `active-dirty-scope-expansion:retire:${plan.planDigest}:${waiting.claimId}`,
        },
        environment,
      });
      if (
        result?.schema !== "agentic-cloud-collaboration-result/v1"
        || result.ok !== true
        || result.action !== "retire"
        || result.claim?.claimId !== plan.sourceClaimId
        || !["retired", "released"].includes(String(result.claim?.state))
      ) {
        throw new Error("Source claim retirement did not prove the exact superseded C1 transition.");
      }
      return Object.freeze({ receiptDigest: requiredDigest(result.receipt?.receiptDigest, "source retirement receipt digest") });
    },

    promoteSuccessor({ plan, waiting }) {
      const current = sourceSnapshot();
      const result = invoke({
        action: "continue",
        ledgerRepository: current.authority.ledgerRepository,
        request: {
          targetRepository: current.authority.targetRepository,
          claimId: waiting.claimId,
          expectedFenceRevision: waiting.claimDigest,
          expectedTransitionCounter: waiting.transitionCounter,
          mode: "promote",
          ttlSeconds: normalizedTtl,
          deviceId: current.lease.device,
          sessionId: normalizedSession,
          idempotencyKey: `active-dirty-scope-expansion:promote:${plan.planDigest}:${waiting.claimId}`,
        },
        environment,
      });
      return result;
    },

    bindSuccessor({ plan, promoted }) {
      const current = sourceSnapshot();
      const manifest = manifestFromPlan(plan);
      const status = invoke({
        action: "status",
        ledgerRepository: current.authority.ledgerRepository,
        request: { targetRepository: current.authority.targetRepository },
        environment,
      });
      const claim = (status.claims || []).filter(candidate => candidate?.claimId === promoted.claimId);
      if (claim.length !== 1 || claim[0].fenceRevision !== promoted.claimDigest
        || claim[0].transitionCounter !== promoted.transitionCounter
        || claim[0].state !== "current") {
        throw new Error("Promoted C2 claim is no longer the exact current successor.");
      }
      const seedAuthority = normalizeBoundAuthority({
        result: {
          schema: "agentic-cloud-collaboration-result/v1",
          ok: true,
          action: "continue",
          ledgerRevision: status.ledgerRevision,
          ledgerDigest: status.ledgerDigest,
          claimDigest: claim[0].fenceRevision,
          claim: claim[0],
        },
        authority: {
          ...current.authority,
          canonicalBaseSha: plan.targetCanonicalBaseSha,
          laneRevision: plan.sourceFenceSha,
          cloudDeclaredWriteScope: plan.targetDeclaredWriteSet,
          writeSetDigest: plan.targetWriteSetDigest,
          leaseEpoch: 1,
          reviewRequestId: null,
          state: "active",
          manifestDigest: plan.targetManifestDigest,
        },
        manifest,
        deviceId: current.lease.device,
        sessionId: normalizedSession,
      });
      const pullRequest = readOwnershipPullRequest({
        url: current.lease.pullRequestUrl,
        branch: current.branch,
        ghText,
      });
      const bound = bindAdmissionCloudAuthority({
        authority: seedAuthority,
        manifest,
        branch: current.branch,
        headSha: plan.sourceFenceSha,
        reviewRequestId: plan.sourceReviewRequestId,
        deviceId: current.lease.device,
        sessionId: normalizedSession,
        idempotencyKey: `active-dirty-scope-expansion:bind:${plan.planDigest}:${promoted.claimId}`,
        returnVerification: true,
        environment,
        invoke,
        inspect: invoke,
        verify,
      });
      if (pullRequest.headRefOid !== plan.sourceFenceSha) {
        throw new Error("Source pull request head drifted before successor binding.");
      }
      return Object.freeze({
        authority: bound.authority,
        verification: bound.verification,
        receiptDigest: requiredDigest(bound.verification?.receiptDigest, "successor bind receipt digest"),
      });
    },

    projectLocal({ plan, authority }) {
      const current = sourceSnapshot();
      const manifest = manifestFromPlan(plan);
      const verification = verifyAdmissionCloudAuthority({
        authority,
        manifest,
        canonicalBaseSha: plan.targetCanonicalBaseSha,
        environment,
        inspect: invoke,
        invoke: verify,
      });
      return projectActiveDirtyScopeExpansionSuccessor({
        leaseStore: store,
        branch: current.branch,
        expectedLeaseDigest: plan.sourceLeaseDigest,
        expectedClaimId: plan.sourceClaimId,
        plan,
        authority: verification.authority,
        taskAuthorityFile,
        validateLease: updated => assertAdmissionMutationAuthority({
          lease: updated,
          cloudAuthority: verification.authority,
          remoteAuthorityVerification: verification.verification,
        }),
      });
    },

    projectPullRequest({ plan, authority, localProjection }) {
      const current = sourceSnapshot();
      assertExpandedLease({ lease: current.lease, plan, authority });
      if (current.authority.claimId !== authority.claimId
        || writerLeaseDigest(current.lease) !== localProjection.leaseDigest) {
        throw new Error("Local C2 lease changed before its pull-request projection.");
      }
      const pullRequest = readOwnershipPullRequest({
        url: current.lease.pullRequestUrl,
        branch: current.branch,
        ghText,
      });
      withHeartbeatProjectionFence({
        leaseStore: store,
        branch: current.branch,
        expectedLeaseDigest: localProjection.leaseDigest,
        expectedClaimId: authority.claimId,
        action: () => run("gh", [
          "pr", "edit", current.lease.pullRequestUrl,
          "--body", updateWriterLeasePullRequestBody(pullRequest.body, current.lease),
        ]),
      });
      const verified = readOwnershipPullRequest({
        url: current.lease.pullRequestUrl,
        branch: current.branch,
        ghText,
      });
      const marker = parseWriterLeasePullRequestBody(verified.body);
      assertExpandedLease({ lease: marker, plan, authority });
      const receiptDigest = digestValue({
        schema: "agentic-active-dirty-scope-expansion-pr-projection/v1",
        planDigest: plan.planDigest,
        pullRequestUrl: verified.url,
        markerDigest: digestValue(marker),
      });
      return Object.freeze({ projection: { markerDigest: digestValue(marker) }, receiptDigest });
    },

    finalize({ plan, authority }) {
      const current = sourceSnapshot();
      assertExpandedLease({ lease: current.lease, plan, authority });
      const verified = verifyAdmissionCloudAuthority({
        authority,
        manifest: manifestFromPlan(plan),
        canonicalBaseSha: plan.targetCanonicalBaseSha,
        environment,
        inspect: invoke,
        invoke: verify,
      });
      const mutation = assertAdmissionMutationAuthority({
        lease: current.lease,
        cloudAuthority: verified.authority,
        remoteAuthorityVerification: verified.verification,
      });
      const pullRequest = readOwnershipPullRequest({
        url: current.lease.pullRequestUrl,
        branch: current.branch,
        ghText,
      });
      assertExpandedLease({
        lease: parseWriterLeasePullRequestBody(pullRequest.body),
        plan,
        authority: verified.authority,
      });
      return Object.freeze({
        receiptDigest: digestValue({
          schema: "agentic-active-dirty-scope-expansion-complete/v1",
          planDigest: plan.planDigest,
          mutationAuthorityReceiptDigest: mutation.receiptDigest,
          pullRequestMarkerDigest: digestValue(parseWriterLeasePullRequestBody(pullRequest.body)),
        }),
      });
    },
  });
}

function resolvePlan({ state, targetManifest }) {
  if (state?.intent?.planSnapshot) {
    const plan = normalizeActiveDirtyScopeExpansionPlan(state.intent.planSnapshot);
    if (
      targetManifest?.manifestDigest !== plan.targetManifestDigest
      || targetManifest?.writeSetDigest !== plan.targetWriteSetDigest
    ) {
      throw new Error("Scope-expansion replay target manifest drifted from its intent.");
    }
    return plan;
  }
  return buildActiveDirtyScopeExpansionPlan({
    source: state?.source,
    targetManifest,
    targetCanonicalBaseSha: state?.targetCanonicalBaseSha,
    canonicalDescendantProof: state?.canonicalDescendantProof,
  });
}

function atLeast(current, expected) {
  return phaseIndex(current) >= phaseIndex(expected);
}

function phaseIndex(value) {
  const index = PHASES.indexOf(value);
  if (index < 0) throw new Error("Scope-expansion intent phase is invalid.");
  return index;
}

function requirePlanIntent(intent, plan) {
  if (
    !intent
    || intent.planDigest !== plan.planDigest
    || intent.sourceClaimId !== plan.sourceClaimId
    || intent.sourceLeaseDigest !== plan.sourceLeaseDigest
    || intent.targetWriteSetDigest !== plan.targetWriteSetDigest
    || intent.targetManifestDigest !== plan.targetManifestDigest
    || intent.targetCanonicalBaseSha !== plan.targetCanonicalBaseSha
    || intent.targetLeaseEpoch !== 1
    || !DIGEST_PATTERN.test(String(intent.intentDigest || ""))
  ) {
    throw new Error("Scope-expansion intent drifted from the exact preflight plan.");
  }
}

function decorateIntent(intent) {
  if (!intent || typeof intent !== "object") {
    throw new Error("Scope-expansion intent was not persisted by the registry CAS.");
  }
  return Object.freeze({ ...intent, intentDigest: digestValue(intent) });
}

function expectedProjectionForIntent({ plan, intent, values, current }) {
  const source = {
    leaseDigest: plan.sourceLeaseDigest,
    claimId: plan.sourceClaimId,
  };
  const local = values.localProjection || intent.localProjection || null;
  if (!local) return source;
  if (!DIGEST_PATTERN.test(String(local.leaseDigest || ""))
    || !DIGEST_PATTERN.test(String(local.claimId || ""))) {
    throw new Error("Scope-expansion local projection lacks its exact lease and claim fence.");
  }
  if (writerLeaseDigest(current.lease) !== local.leaseDigest
    || current.authority.claimId !== local.claimId) {
    throw new Error("Scope-expansion local projection drifted before its durable intent update.");
  }
  return local;
}

function manifestFromPlan(plan) {
  const normalized = normalizeActiveDirtyScopeExpansionPlan(plan);
  return Object.freeze({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: normalized.targetDeclaredWriteSet.find(value => value.startsWith("semantic:"))?.slice("semantic:".length),
    declaredWriteSet: normalized.targetDeclaredWriteSet,
    writeSetDigest: normalized.targetWriteSetDigest,
    manifestDigest: normalized.targetManifestDigest,
  });
}

function assertSourceLeaseMatchesPlan({ current, plan }) {
  if (
    writerLeaseDigest(current.lease) !== plan.sourceLeaseDigest
    || current.authority.claimId !== plan.sourceClaimId
    || current.authority.claimDigest !== plan.sourceClaimDigest
    || current.authority.transitionCounter !== plan.sourceClaimTransitionCounter
    || current.lease.fenceSha !== plan.sourceFenceSha
  ) {
    throw new Error("Source C1 local projection changed before the fenced scope-expansion transition.");
  }
}

function assertExpandedLease({ lease, plan, authority }) {
  const normalized = normalizeActiveDirtyScopeExpansionPlan(plan);
  if (
    !lease
    || lease.schema !== "agentic-writer-lease/v2"
    || lease.status !== "active"
    || lease.baseSha !== normalized.targetCanonicalBaseSha
    || lease.fenceSha !== normalized.sourceFenceSha
    || lease.admission?.status !== "admitted"
    || lease.admission?.writeSetDigest !== normalized.targetWriteSetDigest
    || lease.admission?.manifestDigest !== normalized.targetManifestDigest
    || JSON.stringify(lease.admission?.declaredWriteSet) !== JSON.stringify(normalized.targetDeclaredWriteSet)
    || lease.cloudAuthority?.claimId !== authority.claimId
    || lease.cloudAuthority?.claimDigest !== authority.claimDigest
    || lease.cloudAuthority?.canonicalBaseSha !== normalized.targetCanonicalBaseSha
    || lease.cloudAuthority?.laneRevision !== normalized.sourceFenceSha
    || lease.cloudAuthority?.writeSetDigest !== normalized.targetWriteSetDigest
    || lease.cloudAuthority?.reviewRequestId !== normalized.sourceReviewRequestId
  ) {
    throw new Error("Local or pull-request C2 projection does not exactly bind the expansion authority.");
  }
}

function expansionEvidence({ phase, plan, waiting }) {
  return Object.freeze({
    schema: "agentic-active-dirty-scope-expansion-cloud-evidence/v1",
    phase,
    planDigest: plan.planDigest,
    sourceClaimId: plan.sourceClaimId,
    successorClaimId: waiting?.claimId || null,
    sourceFenceSha: plan.sourceFenceSha,
    targetWriteSetDigest: plan.targetWriteSetDigest,
  });
}

function firstSha(value) {
  const sha = String(value || "").trim().split(/\s+/u)[0] || "";
  return requiredSha(sha, "remote SHA");
}

function splitPaths(value) {
  return [...new Set(String(value || "").split(/\r?\n/u)
    .map(path => path.trim()).filter(Boolean))].sort();
}

function normalizeIntentProjection(value) {
  if (!value || typeof value !== "object") return value;
  if (DIGEST_PATTERN.test(String(value.intentDigest || ""))) return value;
  return Object.freeze({ ...value, intentDigest: digestValue(value) });
}

function requireWaiting(value) {
  if (!value || !DIGEST_PATTERN.test(String(value.claimId || ""))
    || !DIGEST_PATTERN.test(String(value.claimDigest || ""))) {
    throw new Error("Scope-expansion waiting successor receipt is missing.");
  }
  return value;
}

function requirePromoted(value) {
  if (!value || !DIGEST_PATTERN.test(String(value.claimId || ""))
    || !DIGEST_PATTERN.test(String(value.claimDigest || ""))) {
    throw new Error("Scope-expansion promoted successor receipt is missing.");
  }
  return value;
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

function requiredDigest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) throw new Error(`${label} must be a SHA-256 digest.`);
  return String(value);
}

function requiredSha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) {
    throw new Error(`${label} must be a SHA.`);
  }
  return String(value);
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}
