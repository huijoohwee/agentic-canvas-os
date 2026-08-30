// Responsibility: Seal the immutable pre-effect frame for one promoted-successor continuation.
import {
  canonicalJson,
  digestValue,
  normalizeCanonicalDescendantProof,
  normalizeWriteSet,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import {
  normalizeSuccessorRolloverJournal,
  normalizeSuccessorRolloverReplacementPlan,
  successorRolloverOperationKey,
} from "./active-dirty-scope-expansion-successor-rollover-contract.mjs";
import {
  captureProtectedMainAdvance,
  requireProtectedMainEquivalent,
} from "./device-branch-ownership-lib.mjs";

export const CONTINUATION_FRAME_SCHEMA =
  "agentic-active-dirty-scope-expansion-successor-rollover-continuation-frame/v2";
export const HISTORICAL_BIND_PROOF_SCHEMA =
  "agentic-legacy-review-current-base-disjoint-proof/v1";
export const PROTECTED_CONTROLLER_ADVANCE_SCHEMA =
  "agentic-active-dirty-scope-expansion-successor-rollover-controller-advance/v1";

const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;

export function buildSuccessorRolloverHistoricalBindProof({
  replacementPlan,
  reviewRequestBaseSha,
} = {}) {
  const plan = normalizeSuccessorRolloverReplacementPlan(replacementPlan);
  const sourceBaseSha = sha(reviewRequestBaseSha, "review-request base SHA");
  const sealed = plan.protectedMainDisjointProof;
  if (sourceBaseSha !== sealed.sourceBaseSha
    || sealed.targetBaseSha !== plan.targetCanonicalBaseSha
    || sealed.protectedMainSha !== plan.targetCanonicalBaseSha) {
    invalid("historical bind ancestry join");
  }
  const preservedChangedPaths = normalizeWriteSet(plan.target.declaredWriteSet)
    .filter(value => value.startsWith("path:"))
    .map(value => value.slice("path:".length));
  if (preservedChangedPaths.length === 0) invalid("historical bind preserved paths");
  const canonicalChangedPaths = [...sealed.canonicalChangedPaths];
  const core = {
    schema: HISTORICAL_BIND_PROOF_SCHEMA,
    sourceBaseSha,
    targetBaseSha: plan.targetCanonicalBaseSha,
    protectedMainSha: plan.targetCanonicalBaseSha,
    canonicalChangedPaths,
    canonicalChangedPathsDigest: digestValue(canonicalChangedPaths),
    preservedChangedPaths,
    preservedChangedPathsDigest: digestValue(preservedChangedPaths),
    ancestry: "source-base-to-current-protected-main",
    overlap: "none",
  };
  return normalizeCanonicalDescendantProof({
    value: { ...core, evidenceDigest: digestValue(core) },
    sourceBaseSha,
    protectedRevision: plan.targetCanonicalBaseSha,
  });
}

export function captureSuccessorRolloverProtectedControllerAdvance({
  replacementPlan,
  controllerHeadSha,
  controllerOriginMainSha,
  protectedMainSha,
  controllerStatus,
  gitText,
} = {}) {
  const plan = normalizeSuccessorRolloverReplacementPlan(replacementPlan);
  const headSha = sha(controllerHeadSha, "controller HEAD");
  const originMainSha = sha(controllerOriginMainSha, "controller origin/main");
  const remoteMainSha = sha(protectedMainSha, "protected main");
  if (String(controllerStatus ?? "") !== "" || headSha !== originMainSha
    || headSha !== remoteMainSha || remoteMainSha === plan.targetCanonicalBaseSha) {
    invalid("clean protected-controller descendant");
  }
  if (typeof gitText !== "function") invalid("protected-controller Git reader");
  const advance = captureProtectedMainAdvance({
    baseSha: plan.targetCanonicalBaseSha,
    pullRequestBaseSha: plan.targetCanonicalBaseSha,
    protectedMainSha: remoteMainSha,
    declaredWriteSet: plan.target.declaredWriteSet,
    gitText,
  });
  const changedPaths = normalizeGitPaths(String(gitText([
    "diff", "--name-only", "--no-renames", "-z",
    plan.targetCanonicalBaseSha, remoteMainSha, "--",
  ]) || ""));
  if (advance.declaredWriteSetDigest !== plan.target.writeSetDigest) {
    invalid("protected-controller target write set");
  }
  if (advance.changedPathCount !== changedPaths.length
    || advance.changedPathsDigest !== digestValue(changedPaths)
    || changedPaths.some(candidate => writeSetsOverlap(
      [`path:${candidate}`], plan.target.declaredWriteSet,
    ))) invalid("protected-controller changed paths");
  const core = {
    schema: PROTECTED_CONTROLLER_ADVANCE_SCHEMA,
    sourceCanonicalBaseSha: plan.targetCanonicalBaseSha,
    controllerHeadSha: headSha,
    controllerOriginMainSha: originMainSha,
    protectedMainSha: remoteMainSha,
    clean: true,
    changedPaths,
    advance,
  };
  return deepFreeze({ ...core, evidenceDigest: digestValue(core) });
}

export function buildSuccessorRolloverContinuationFrame({
  replacementPlan,
  journal,
  owner,
  replacementClaim,
  boundReplacement = null,
  reviewRequest,
  protectedControllerAdvance,
  repairedControllerDigest,
} = {}) {
  const plan = normalizeSuccessorRolloverReplacementPlan(replacementPlan);
  const sourceJournal = normalizeSuccessorRolloverJournal(journal);
  requirePromotedJournal(sourceJournal, plan);
  const normalizedOwner = normalizeOwner(owner, plan);
  const normalizedReview = normalizeReviewRequest(reviewRequest, plan);
  const historicalBindProof = buildSuccessorRolloverHistoricalBindProof({
    replacementPlan: plan,
    reviewRequestBaseSha: normalizedReview.baseSha,
  });
  const claim = normalizeReplacementClaim(replacementClaim, sourceJournal, plan);
  const bound = normalizeBoundReplacement(boundReplacement, claim, plan);
  const continuationDisposition = bound === null
    ? "promoted-unbound" : "bound-response-ahead";
  const controllerAdvance = normalizeProtectedControllerAdvance(
    protectedControllerAdvance,
    plan,
  );
  const controllerDigest = digest(repairedControllerDigest, "repaired controller digest");
  if (controllerDigest === plan.observation.controllerDigest) {
    invalid("repaired controller identity");
  }
  const promoted = sourceJournal.replacement.phases["replacement-promoted"];
  const core = {
    schema: CONTINUATION_FRAME_SCHEMA,
    replacementPlanDigest: plan.planDigest,
    sourceJournalDigest: sourceJournal.journalDigest,
    sourceReplacementIntentDigest: sourceJournal.replacement.intentDigest,
    promotedPhaseReceiptDigest: promoted.receiptDigest,
    promotedPrefixDigest: promotedPrefixDigest(sourceJournal),
    continuationDisposition,
    owner: normalizedOwner,
    replacementClaim: claim,
    boundReplacement: bound,
    reviewRequest: normalizedReview,
    historicalBindProof,
    protectedControllerAdvance: controllerAdvance,
    repairedControllerDigest: controllerDigest,
  };
  return deepFreeze({ ...core, frameDigest: digestValue(core) });
}

export function normalizeSuccessorRolloverContinuationFrame(
  value,
  { replacementPlan, journal } = {},
) {
  exactObject(value, "continuation frame", [
    "schema", "replacementPlanDigest", "sourceJournalDigest",
    "sourceReplacementIntentDigest", "promotedPhaseReceiptDigest", "promotedPrefixDigest",
    "continuationDisposition", "owner", "replacementClaim", "boundReplacement",
    "reviewRequest", "historicalBindProof",
    "protectedControllerAdvance", "repairedControllerDigest", "frameDigest",
  ]);
  if (value.schema !== CONTINUATION_FRAME_SCHEMA) invalid("continuation frame schema");
  const plan = normalizeSuccessorRolloverReplacementPlan(replacementPlan);
  const sourceJournal = normalizeSuccessorRolloverJournal(journal);
  const rebuilt = buildSuccessorRolloverContinuationFrame({
    replacementPlan: plan,
    journal: sourceJournal,
    owner: value.owner,
    replacementClaim: value.replacementClaim,
    boundReplacement: value.boundReplacement,
    reviewRequest: value.reviewRequest,
    protectedControllerAdvance: value.protectedControllerAdvance,
    repairedControllerDigest: value.repairedControllerDigest,
  });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("continuation frame projection");
  return rebuilt;
}

export function requireSuccessorRolloverContinuationFrame({
  planned,
  observed,
  replacementPlan,
  journal,
  gitText,
} = {}) {
  const expected = normalizeSuccessorRolloverContinuationFrame(planned, {
    replacementPlan,
    journal,
  });
  const current = normalizeSuccessorRolloverContinuationFrame(observed, {
    replacementPlan,
    journal,
  });
  for (const key of ["replacementPlanDigest", "sourceJournalDigest",
    "sourceReplacementIntentDigest", "promotedPhaseReceiptDigest", "promotedPrefixDigest",
    "continuationDisposition", "owner", "replacementClaim", "boundReplacement",
    "reviewRequest", "historicalBindProof",
    "repairedControllerDigest"]) {
    if (canonicalJson(expected[key]) !== canonicalJson(current[key])) {
      invalid(`continuation frame ${key} drift`);
    }
  }
  requireProtectedMainEquivalent({
    planned: expected.protectedControllerAdvance.advance,
    observed: current.protectedControllerAdvance.advance,
    gitText,
  });
  if (current.protectedControllerAdvance.controllerHeadSha
      !== current.protectedControllerAdvance.protectedMainSha
    || current.protectedControllerAdvance.controllerOriginMainSha
      !== current.protectedControllerAdvance.protectedMainSha
    || current.protectedControllerAdvance.clean !== true) {
    invalid("current clean protected-controller projection");
  }
  return current;
}

export function promotedPrefixDigest(journalValue) {
  const journal = normalizeSuccessorRolloverJournal(journalValue);
  const plan = journal.replacement?.planSnapshot;
  requirePromotedOrDescendantJournal(journal, plan);
  const replacement = journal.replacement;
  const core = {
    retirement: journal.retirement,
    replacement: {
      schema: replacement.schema,
      kind: replacement.kind,
      planDigest: replacement.planDigest,
      planSnapshot: replacement.planSnapshot,
      authorization: replacement.authorization,
      authorizationDigest: replacement.authorizationDigest,
      phases: {
        authorized: replacement.phases.authorized,
        "replacement-claimed": replacement.phases["replacement-claimed"],
        "replacement-promoted": replacement.phases["replacement-promoted"],
      },
    },
  };
  return digestValue(core);
}

function normalizeOwner(value, plan) {
  exactObject(value, "owner frame", ["schema", "repositoryPathDigest", "branch",
    "sourceSessionId", "headSha", "remoteHeadSha", "leaseDigest", "dirtDigest",
    "intentDigest", "intentStatus", "changedPaths", "changedPathsDigest"]);
  const changedPaths = paths(value.changedPaths, "owner changed paths");
  const owner = {
    schema: text(value.schema, "owner schema"),
    repositoryPathDigest: digest(value.repositoryPathDigest, "owner repository path"),
    branch: text(value.branch, "owner branch"),
    sourceSessionId: text(value.sourceSessionId, "owner source session"),
    headSha: sha(value.headSha, "owner HEAD"),
    remoteHeadSha: sha(value.remoteHeadSha, "owner remote HEAD"),
    leaseDigest: digest(value.leaseDigest, "owner lease"),
    dirtDigest: digest(value.dirtDigest, "owner dirt"),
    intentDigest: digest(value.intentDigest, "owner intent"),
    intentStatus: text(value.intentStatus, "owner intent status"),
    changedPaths,
    changedPathsDigest: digest(value.changedPathsDigest, "owner changed paths digest"),
  };
  const source = plan.retirementPlanSnapshot.observation;
  if (owner.schema !== "agentic-active-dirty-scope-expansion-successor-rollover-owner-frame/v1"
    || owner.branch !== plan.branch || owner.sourceSessionId !== source.sourceSessionId
    || owner.headSha !== plan.sourceFenceSha || owner.remoteHeadSha !== plan.sourceFenceSha
    || owner.leaseDigest !== plan.observation.sourceLeaseDigest
    || owner.dirtDigest !== plan.observation.sourceDirtDigest
    || owner.intentDigest !== plan.observation.sourceIntentDigest
    || owner.intentStatus !== "source-retired"
    || canonicalJson(owner.changedPaths) !== canonicalJson(source.sourceChangedPaths)
    || owner.changedPathsDigest !== digestValue(changedPaths)) invalid("unchanged owner frame");
  return deepFreeze(owner);
}

function normalizeReviewRequest(value, plan) {
  exactObject(value, "review request frame", ["schema", "reviewRequestId",
    "pullRequestNumber", "nodeId", "state", "isDraft", "branch", "headSha",
    "baseBranch", "baseSha", "markerDigest", "bodyDigest"]);
  const review = {
    schema: text(value.schema, "review request schema"),
    reviewRequestId: text(value.reviewRequestId, "review request ID"),
    pullRequestNumber: positive(value.pullRequestNumber, "pull request number"),
    nodeId: text(value.nodeId, "pull request node ID"),
    state: text(value.state, "review request state"),
    isDraft: value.isDraft,
    branch: text(value.branch, "review request branch"),
    headSha: sha(value.headSha, "review request head"),
    baseBranch: text(value.baseBranch, "review request base branch"),
    baseSha: sha(value.baseSha, "review request base SHA"),
    markerDigest: digest(value.markerDigest, "review request marker"),
    bodyDigest: digest(value.bodyDigest, "review request body"),
  };
  const source = plan.retirementPlanSnapshot.observation;
  if (review.schema !== "agentic-active-dirty-scope-expansion-successor-rollover-review-frame/v1"
    || review.reviewRequestId !== plan.sourceReviewRequestId
    || review.pullRequestNumber !== source.pullRequestNumber
    || review.nodeId !== source.pullRequestNodeId || review.state !== "OPEN"
    || review.isDraft !== true || review.branch !== plan.branch
    || review.headSha !== plan.sourceFenceSha || review.baseBranch !== "main"
    || review.baseSha !== plan.protectedMainDisjointProof.sourceBaseSha
    || review.markerDigest !== plan.observation.pullRequestMarkerDigest
    || review.bodyDigest !== plan.observation.pullRequestBodyDigest) {
    invalid("unchanged review request frame");
  }
  return deepFreeze(review);
}

function normalizeReplacementClaim(value, journal, plan) {
  exactObject(value, "replacement claim frame", ["schema", "claimId", "claimDigest",
    "claimLedgerRevision", "transitionCounter", "state", "predecessorClaimId",
    "canonicalBaseSha", "laneRevision", "writeSetDigest", "leaseEpoch",
    "reviewRequestId", "expiresAt", "operationReceiptDigest"]);
  const claim = {
    schema: text(value.schema, "replacement claim schema"),
    claimId: digest(value.claimId, "replacement claim"),
    claimDigest: digest(value.claimDigest, "replacement claim digest"),
    claimLedgerRevision: digest(value.claimLedgerRevision, "replacement transition"),
    transitionCounter: positive(value.transitionCounter, "replacement transition counter"),
    state: text(value.state, "replacement claim state"),
    predecessorClaimId: value.predecessorClaimId === null
      ? null : digest(value.predecessorClaimId, "replacement predecessor"),
    canonicalBaseSha: sha(value.canonicalBaseSha, "replacement canonical base"),
    laneRevision: sha(value.laneRevision, "replacement lane revision"),
    writeSetDigest: digest(value.writeSetDigest, "replacement write set"),
    leaseEpoch: positive(value.leaseEpoch, "replacement lease epoch"),
    reviewRequestId: value.reviewRequestId === null
      ? null : text(value.reviewRequestId, "replacement review request"),
    expiresAt: instant(value.expiresAt, "replacement expiry"),
    operationReceiptDigest: digest(value.operationReceiptDigest, "replacement operation receipt"),
  };
  const promoted = journal.replacement.phases["replacement-promoted"].values;
  const sealed = promoted.claim;
  const stable = ["claimId", "claimDigest", "claimLedgerRevision", "transitionCounter",
    "state", "predecessorClaimId", "canonicalBaseSha", "laneRevision",
    "writeSetDigest", "leaseEpoch", "expiresAt"];
  if (claim.schema !== "agentic-active-dirty-scope-expansion-successor-rollover-claim-frame/v1"
    || stable.some(key => canonicalJson(claim[key]) !== canonicalJson(sealed[key]))
    || claim.state !== "current" || claim.reviewRequestId !== null
    || claim.operationReceiptDigest !== promoted.receiptDigest) {
    invalid("exact promoted replacement claim");
  }
  return deepFreeze(claim);
}

function normalizeBoundReplacement(value, promoted, plan) {
  if (value === null) return null;
  exactObject(value, "bound replacement frame", ["schema", "claim", "receipt"]);
  exactObject(value.claim, "bound replacement claim", ["schema", "claimId", "claimDigest",
    "claimLedgerRevision", "transitionCounter", "state", "predecessorClaimId",
    "canonicalBaseSha", "laneRevision", "writeSetDigest", "leaseEpoch",
    "reviewRequestId", "expiresAt", "operationReceiptDigest"]);
  const claim = {
    schema: text(value.claim.schema, "bound replacement claim schema"),
    claimId: digest(value.claim.claimId, "bound replacement claim"),
    claimDigest: digest(value.claim.claimDigest, "bound replacement claim digest"),
    claimLedgerRevision: digest(value.claim.claimLedgerRevision, "bound replacement transition"),
    transitionCounter: positive(value.claim.transitionCounter, "bound replacement transition counter"),
    state: text(value.claim.state, "bound replacement claim state"),
    predecessorClaimId: value.claim.predecessorClaimId === null
      ? null : digest(value.claim.predecessorClaimId, "bound replacement predecessor"),
    canonicalBaseSha: sha(value.claim.canonicalBaseSha, "bound replacement canonical base"),
    laneRevision: sha(value.claim.laneRevision, "bound replacement lane revision"),
    writeSetDigest: digest(value.claim.writeSetDigest, "bound replacement write set"),
    leaseEpoch: positive(value.claim.leaseEpoch, "bound replacement lease epoch"),
    reviewRequestId: text(value.claim.reviewRequestId, "bound replacement review request"),
    expiresAt: instant(value.claim.expiresAt, "bound replacement expiry"),
    operationReceiptDigest: digest(value.claim.operationReceiptDigest,
      "bound replacement operation receipt"),
  };
  const stable = ["claimId", "state", "predecessorClaimId", "canonicalBaseSha",
    "laneRevision", "writeSetDigest", "leaseEpoch", "expiresAt"];
  if (value.schema !== "agentic-active-dirty-scope-expansion-successor-rollover-bound-frame/v1"
    || claim.schema !== promoted.schema || stable.some(key =>
      canonicalJson(claim[key]) !== canonicalJson(promoted[key]))
    || claim.claimDigest === promoted.claimDigest
    || claim.transitionCounter !== promoted.transitionCounter + 1
    || claim.reviewRequestId !== plan.sourceReviewRequestId) {
    invalid("exact bound replacement claim");
  }
  const identity = plan.sourceClaimIdentity;
  const intent = {
    repositoryId: identity.repositoryId, actorId: identity.actorId,
    deviceId: identity.deviceId, sessionId: identity.sessionId,
    claimId: promoted.claimId, expectedFenceRevision: promoted.claimDigest,
    expectedTransitionCounter: promoted.transitionCounter, mode: "projection",
    laneRevision: plan.sourceFenceSha, reviewRequestId: plan.sourceReviewRequestId,
    expiresAt: null, focusedEvidenceDigest: null, handoffEvidenceDigest: null,
    recoveryEvidenceDigest: null,
  };
  exactObject(value.receipt, "bound replacement receipt", ["schema", "operation", "status",
    "repositoryId", "claimId", "claimDigest", "fenceRevision", "ledgerRevision",
    "ledgerSequence", "idempotencyKey", "requestDigest", "evaluationTime", "receiptDigest"]);
  const receiptCore = {
    schema: text(value.receipt.schema, "bound replacement receipt schema"),
    operation: text(value.receipt.operation, "bound replacement receipt operation"),
    status: text(value.receipt.status, "bound replacement receipt status"),
    repositoryId: text(value.receipt.repositoryId, "bound replacement receipt repository"),
    claimId: digest(value.receipt.claimId, "bound replacement receipt claim"),
    claimDigest: digest(value.receipt.claimDigest, "bound replacement receipt claim digest"),
    fenceRevision: digest(value.receipt.fenceRevision, "bound replacement receipt fence"),
    ledgerRevision: digest(value.receipt.ledgerRevision, "bound replacement receipt ledger"),
    ledgerSequence: positive(value.receipt.ledgerSequence, "bound replacement receipt sequence"),
    idempotencyKey: digest(value.receipt.idempotencyKey, "bound replacement receipt operation key"),
    requestDigest: digest(value.receipt.requestDigest, "bound replacement receipt request"),
    evaluationTime: instant(value.receipt.evaluationTime, "bound replacement receipt time"),
  };
  const expectedKey = digestValue(successorRolloverOperationKey(plan, "replacement-bound"));
  if (receiptCore.schema !== "agentic-collaboration-continuation-receipt/v1"
    || receiptCore.operation !== "continue" || receiptCore.status !== "current"
    || receiptCore.repositoryId !== identity.repositoryId || receiptCore.claimId !== claim.claimId
    || receiptCore.claimDigest !== claim.claimDigest
    || receiptCore.fenceRevision !== claim.claimDigest
    || receiptCore.ledgerRevision !== claim.claimLedgerRevision
    || receiptCore.idempotencyKey !== expectedKey
    || receiptCore.requestDigest !== digestValue({ action: "continue", intent })
    || value.receipt.receiptDigest !== digestValue(receiptCore)
    || claim.operationReceiptDigest !== value.receipt.receiptDigest) {
    invalid("exact bound replacement receipt");
  }
  return deepFreeze({ schema: value.schema, claim,
    receipt: { ...receiptCore, receiptDigest: value.receipt.receiptDigest } });
}

function normalizeProtectedControllerAdvance(value, plan) {
  exactObject(value, "protected-controller advance", ["schema", "sourceCanonicalBaseSha",
    "controllerHeadSha", "controllerOriginMainSha", "protectedMainSha", "clean",
    "changedPaths", "advance", "evidenceDigest"]);
  const advance = normalizeAdvance(value.advance, plan);
  const changedPaths = paths(value.changedPaths, "protected-controller changed paths");
  const core = {
    schema: text(value.schema, "protected-controller advance schema"),
    sourceCanonicalBaseSha: sha(value.sourceCanonicalBaseSha, "protected-controller source"),
    controllerHeadSha: sha(value.controllerHeadSha, "protected-controller HEAD"),
    controllerOriginMainSha: sha(value.controllerOriginMainSha, "protected-controller origin/main"),
    protectedMainSha: sha(value.protectedMainSha, "protected main"),
    clean: value.clean,
    changedPaths,
    advance,
  };
  if (core.schema !== PROTECTED_CONTROLLER_ADVANCE_SCHEMA
    || core.sourceCanonicalBaseSha !== plan.targetCanonicalBaseSha
    || core.protectedMainSha === plan.targetCanonicalBaseSha || core.clean !== true
    || core.controllerHeadSha !== core.protectedMainSha
    || core.controllerOriginMainSha !== core.protectedMainSha
    || advance.protectedMainSha !== core.protectedMainSha
    || advance.changedPathCount !== changedPaths.length
    || advance.changedPathsDigest !== digestValue(changedPaths)
    || changedPaths.some(candidate => writeSetsOverlap(
      [`path:${candidate}`], plan.target.declaredWriteSet,
    ))
    || value.evidenceDigest !== digestValue(core)) invalid("protected-controller advance semantics");
  return deepFreeze({ ...core, evidenceDigest: value.evidenceDigest });
}

function normalizeAdvance(value, plan) {
  exactObject(value, "protected-main advance proof", ["schema", "baseSha",
    "pullRequestBaseSha", "protectedMainSha", "protectedMainTreeSha",
    "declaredWriteSetDigest", "changedPathCount", "changedPathsDigest"]);
  const advance = {
    schema: text(value.schema, "protected-main advance schema"),
    baseSha: sha(value.baseSha, "protected-main advance base"),
    pullRequestBaseSha: sha(value.pullRequestBaseSha, "protected-main pull-request base"),
    protectedMainSha: sha(value.protectedMainSha, "protected-main advance target"),
    protectedMainTreeSha: gitObject(value.protectedMainTreeSha, "protected-main tree"),
    declaredWriteSetDigest: digest(value.declaredWriteSetDigest, "protected-main write set"),
    changedPathCount: nonnegative(value.changedPathCount, "protected-main changed path count"),
    changedPathsDigest: digest(value.changedPathsDigest, "protected-main changed paths"),
  };
  if (advance.schema !== "agentic-active-owned-dirt-protected-main-advance/v1"
    || advance.baseSha !== plan.targetCanonicalBaseSha
    || advance.pullRequestBaseSha !== plan.targetCanonicalBaseSha
    || advance.protectedMainSha === plan.targetCanonicalBaseSha
    || advance.declaredWriteSetDigest !== plan.target.writeSetDigest) {
    invalid("protected-main advance proof semantics");
  }
  return deepFreeze(advance);
}

function requirePromotedJournal(journal, plan) {
  const normalizedPlan = normalizeSuccessorRolloverReplacementPlan(plan);
  if (journal.replacement?.status !== "replacement-promoted"
    || journal.replacement.planDigest !== normalizedPlan.planDigest
    || journal.retirement.intentDigest !== normalizedPlan.retirementIntentDigest) {
    invalid("replacement-promoted source journal");
  }
}

function requirePromotedOrDescendantJournal(journal, plan) {
  const normalizedPlan = normalizeSuccessorRolloverReplacementPlan(plan);
  const statuses = ["authorized", "replacement-claimed", "replacement-promoted",
    "replacement-bound", "local-cas", "pr-marker", "verified", "complete"];
  if (!journal.replacement
    || statuses.indexOf(journal.replacement.status) < statuses.indexOf("replacement-promoted")
    || journal.replacement.planDigest !== normalizedPlan.planDigest
    || journal.retirement.intentDigest !== normalizedPlan.retirementIntentDigest) {
    invalid("replacement-promoted journal prefix");
  }
}

function normalizeGitPaths(value) {
  const candidates = value.split("\0").filter(Boolean).map(candidate => {
    const normalized = candidate.replaceAll("\\", "/");
    if (!normalized || normalized.startsWith("/")
      || normalized.split("/").some(part => !part || part === "." || part === "..")) {
      invalid("protected-controller repository-relative path");
    }
    return normalized;
  });
  const normalized = [...new Set(candidates)].sort();
  if (normalized.length !== candidates.length) invalid("protected-controller unique changed paths");
  return Object.freeze(normalized);
}

function exactObject(value, label, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) invalid(label);
}
function paths(value, label) {
  if (!Array.isArray(value) || value.length === 0) invalid(label);
  const result = [...new Set(value.map(item => text(item, label)))].sort();
  if (result.length !== value.length) invalid(label);
  return Object.freeze(result);
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) invalid(label);
  return value;
}
function digest(value, label) { if (!DIGEST.test(String(value || ""))) invalid(label); return value; }
function sha(value, label) { if (!SHA.test(String(value || ""))) invalid(label); return value; }
function gitObject(value, label) {
  if (!/^[0-9a-f]{40,64}$/u.test(String(value || ""))) invalid(label);
  return value;
}
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function nonnegative(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(label);
  return value;
}
function instant(value, label) {
  if (!Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) {
    invalid(label);
  }
  return value;
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
function invalid(label) {
  throw new Error(`Successor-rollover continuation frame has invalid ${label}.`);
}
