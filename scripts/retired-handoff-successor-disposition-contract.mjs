// Responsibility: seal one PR712 retired-handoff disposition without authorizing provider or cleanup effects.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";

export const RETIRED_HANDOFF_SUCCESSOR_DISPOSITION_EVIDENCE_SCHEMA = "agentic-retired-handoff-successor-disposition-evidence/v1";
export const RETIRED_HANDOFF_SUCCESSOR_PORT_DECISION_SCHEMA = "agentic-retired-handoff-successor-port-decision/v1";
export const RETIRED_HANDOFF_SUCCESSOR_PORT_DECISION_TEMPLATE_SCHEMA = "agentic-retired-handoff-successor-port-decision-template/v1";
export const RETIRED_HANDOFF_SUCCESSOR_DISPOSITION_PLAN_SCHEMA = "agentic-retired-handoff-successor-disposition-plan/v1";
export const RETIRED_HANDOFF_SUCCESSOR_DISPOSITION_AUTHORIZATION_SCHEMA = "agentic-retired-handoff-successor-disposition-authorization/v1";
export const RETIRED_HANDOFF_SUCCESSOR_DISPOSITION_INTENT_SCHEMA = "agentic-retired-handoff-successor-disposition-intent/v1";
export const RETIRED_HANDOFF_SUCCESSOR_DISPOSITION_RECEIPT_SCHEMA = "agentic-retired-handoff-successor-disposition-receipt/v1";

const SUBJECT_SCHEMA = "agentic-retired-handoff-successor-disposition-subject/v1";
const OPERATION_SCHEMA = "agentic-retired-handoff-successor-disposition-operation/v1";
const ADMISSION_EFFECT = "suppress-exact-provider-subject";
const PLAN_PHASES = Object.freeze(["verified", "complete"]);
const STATUSES = Object.freeze(["authorized", ...PLAN_PHASES]);
const DECISION_KINDS = new Set(["patch-identical", "evolved-in-successor", "obsolete-by-successor"]);
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const MAX_COMMITS = 256;

export function normalizeRetiredHandoffSuccessorDispositionEvidence(value) {
  exactObject(value, "Disposition evidence", [
    "schema", "provider", "repositoryId", "controller", "ledger", "claim", "source", "successor",
    "local", "functionalSourceCommits", "successorCommits", "evidenceDigest",
  ]);
  const core = {
    schema: requiredText(value.schema, "evidence schema"),
    provider: requiredText(value.provider, "evidence provider"),
    repositoryId: requiredText(value.repositoryId, "evidence repository ID"),
    controller: normalizeController(value.controller),
    ledger: normalizeLedger(value.ledger),
    claim: normalizeClaim(value.claim),
    source: normalizeSource(value.source),
    successor: normalizeSuccessor(value.successor),
    local: normalizeLocal(value.local),
    functionalSourceCommits: normalizeCommits(value.functionalSourceCommits, "functional source"),
    successorCommits: normalizeCommits(value.successorCommits, "successor"),
  };
  if (core.schema !== RETIRED_HANDOFF_SUCCESSOR_DISPOSITION_EVIDENCE_SCHEMA
    || core.provider !== "github"
    || core.claim.state !== "retired"
    || core.claim.retirementReason !== "handoff"
    || core.claim.entryDigest !== core.claim.transitionDigest
    || core.claim.reviewRequestId !== `github-pull-request:${core.source.pullRequestNodeId}`
    || core.controller.repository !== core.ledger.repository
    || core.source.repository === core.ledger.repository
    || core.source.pullRequestNumber !== 712
    || core.source.state !== "OPEN"
    || core.source.isDraft !== true
    || core.source.headSha !== core.source.remoteHeadSha
    || core.source.handoffMarkerFinalRevision !== core.claim.finalRevision
    || core.source.retiredRevisionReachable !== true
    || core.successor.pullRequestNumber !== 742
    || core.successor.state !== "MERGED"
    || core.successor.protectedMainContainsMerge !== true
    || core.local.leasePresent !== false
    || core.local.cleanupEligible !== false) {
    throw new Error("PR712 retired-handoff successor evidence semantics are invalid.");
  }
  const expectedDigest = digestValue(core);
  if (value.evidenceDigest !== expectedDigest) {
    throw new Error("Disposition evidence digest is invalid.");
  }
  return deepFreeze({ ...core, evidenceDigest: expectedDigest });
}

export function buildRetiredHandoffSuccessorPortDecisionTemplate(evidenceValue) {
  const evidence = normalizeRetiredHandoffSuccessorDispositionEvidence(evidenceValue);
  const entries = evidence.functionalSourceCommits.map(source => {
    const matches = evidence.successorCommits.filter(commit => commit.patchId === source.patchId);
    return {
      sourceCommitSha: source.sha,
      kind: matches.length === 1 ? "patch-identical" : null,
      successorCommitShas: matches.map(commit => commit.sha),
      rationale: null,
    };
  });
  const core = {
    schema: RETIRED_HANDOFF_SUCCESSOR_PORT_DECISION_TEMPLATE_SCHEMA,
    status: "operator-input-required",
    evidenceDigest: evidence.evidenceDigest,
    entries,
    requiredOperatorSourceCommitShas: entries
      .filter(entry => entry.kind === null).map(entry => entry.sourceCommitSha),
  };
  return deepFreeze({ ...core, templateDigest: digestValue(core) });
}

export function normalizeRetiredHandoffSuccessorPortDecision(value, evidenceValue) {
  const evidence = normalizeRetiredHandoffSuccessorDispositionEvidence(evidenceValue);
  exactObject(value, "Port decision", ["schema", "evidenceDigest", "entries", "decisionDigest"]);
  if (!Array.isArray(value.entries) || value.entries.length !== evidence.functionalSourceCommits.length) {
    throw new Error("Port decision must cover every functional source commit exactly once.");
  }
  const successorBySha = new Map(evidence.successorCommits.map(commit => [commit.sha, commit]));
  const identicalSuccessors = new Set();
  const entries = value.entries.map((entry, index) => {
    exactObject(entry, `Port decision entry ${index}`, [
      "sourceCommitSha", "kind", "successorCommitShas", "rationale",
    ]);
    const normalized = {
      sourceCommitSha: requiredSha(entry.sourceCommitSha, `port entry ${index} source commit`),
      kind: requiredText(entry.kind, `port entry ${index} kind`),
      successorCommitShas: normalizeShaList(entry.successorCommitShas, `port entry ${index}`),
      rationale: entry.rationale === null ? null : requiredText(entry.rationale, `port entry ${index} rationale`),
    };
    const source = evidence.functionalSourceCommits[index];
    if (!DECISION_KINDS.has(normalized.kind) || normalized.sourceCommitSha !== source.sha) {
      throw new Error("Port decision entries must follow the exact functional source commit order.");
    }
    const successors = normalized.successorCommitShas.map(sha => {
      const commit = successorBySha.get(sha);
      if (!commit) throw new Error(`Port entry ${index} names an unreachable successor commit.`);
      return commit;
    });
    const stableMatches = evidence.successorCommits.filter(commit => commit.patchId === source.patchId);
    if (normalized.kind === "patch-identical") {
      const ambiguousRationaleInvalid = stableMatches.length > 1 && normalized.rationale === null;
      const uniqueRationaleInvalid = stableMatches.length === 1 && normalized.rationale !== null;
      if (successors.length !== 1 || !stableMatches.some(match => match.sha === successors[0].sha)
        || ambiguousRationaleInvalid || uniqueRationaleInvalid
        || identicalSuccessors.has(successors[0].sha)) {
        throw new Error(`Port entry ${index} patch-identical mapping is invalid.`);
      }
      identicalSuccessors.add(successors[0].sha);
    } else if (stableMatches.length !== 0) {
      throw new Error(`Port entry ${index} must use a stable patch identity.`);
    } else if (normalized.kind === "evolved-in-successor"
      ? successors.length === 0 || normalized.rationale === null
      : successors.length !== 0 || normalized.rationale === null) {
      throw new Error(`Port entry ${index} successor mapping or rationale is invalid.`);
    }
    return normalized;
  });
  const core = {
    schema: requiredText(value.schema, "port-decision schema"),
    evidenceDigest: requiredDigest(value.evidenceDigest, "port-decision evidence digest"),
    entries,
  };
  if (core.schema !== RETIRED_HANDOFF_SUCCESSOR_PORT_DECISION_SCHEMA
    || core.evidenceDigest !== evidence.evidenceDigest
    || value.decisionDigest !== digestValue(core)) {
    throw new Error("Port decision schema, evidence binding, or digest is invalid.");
  }
  return deepFreeze({ ...core, decisionDigest: value.decisionDigest });
}

export function retiredHandoffSuccessorDispositionSubjectKey(value) {
  const evidence = normalizeRetiredHandoffSuccessorDispositionEvidence(value?.evidence || value);
  return digestValue({
    schema: SUBJECT_SCHEMA,
    repositoryId: evidence.repositoryId,
    repository: evidence.source.repository,
    pullRequestNumber: evidence.source.pullRequestNumber,
    pullRequestNodeId: evidence.source.pullRequestNodeId,
    pullRequestHeadSha: evidence.source.headSha,
    pullRequestBodyDigest: evidence.source.bodyDigest,
    claimId: evidence.claim.claimId,
    claimDigest: evidence.claim.claimDigest,
    claimFinalRevision: evidence.claim.finalRevision,
    successorPullRequestNumber: evidence.successor.pullRequestNumber, successorPullRequestNodeId: evidence.successor.pullRequestNodeId,
    successorHeadSha: evidence.successor.headSha, successorMergeCommitSha: evidence.successor.mergeCommitSha,
  });
}

export function retiredHandoffSuccessorDispositionOperationKey({
  planDigest, subjectKey, phase,
}) {
  const normalizedPhase = requiredText(phase, "operation phase");
  if (!STATUSES.includes(normalizedPhase)) throw new Error(`Unsupported disposition phase: ${phase}.`);
  return digestValue({
    schema: OPERATION_SCHEMA,
    planDigest: requiredDigest(planDigest, "operation plan digest"),
    subjectKey: requiredDigest(subjectKey, "operation subject key"),
    phase: normalizedPhase,
  });
}

export function buildRetiredHandoffSuccessorDispositionPlan({ evidence, portDecision }) {
  const normalizedEvidence = normalizeRetiredHandoffSuccessorDispositionEvidence(evidence);
  const decision = normalizeRetiredHandoffSuccessorPortDecision(portDecision, normalizedEvidence);
  return sealPlan(normalizedEvidence, decision);
}

export function normalizeRetiredHandoffSuccessorDispositionPlan(value) {
  exactObject(value, "Disposition plan", [
    "schema", "provider", "repositoryId", "targetRepository", "ledgerRepository",
    "sourcePullRequestNumber", "successorPullRequestNumber", "subjectKey", "evidence",
    "evidenceDigest", "controllerDigest", "portDecision", "portDecisionDigest", "admissionEffect",
    "cleanupEligible", "phases", "exactAuthorization", "planDigest",
  ]);
  const evidence = normalizeRetiredHandoffSuccessorDispositionEvidence(value.evidence);
  const decision = normalizeRetiredHandoffSuccessorPortDecision(value.portDecision, evidence);
  const sealed = sealPlan(evidence, decision);
  if (canonicalJson(value) !== canonicalJson(sealed)) {
    throw new Error("Disposition plan is malformed, incomplete, or drifted.");
  }
  return sealed;
}

export function authorizeRetiredHandoffSuccessorDisposition({ plan, authorization }) {
  const normalizedPlan = normalizeRetiredHandoffSuccessorDispositionPlan(plan);
  if (authorization !== normalizedPlan.exactAuthorization) {
    throw new Error(`Disposition requires exact authorization: ${normalizedPlan.exactAuthorization}`);
  }
  const core = authorizationCore(normalizedPlan);
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createRetiredHandoffSuccessorDispositionIntent({ plan, authorizationReceipt }) {
  const normalizedPlan = normalizeRetiredHandoffSuccessorDispositionPlan(plan);
  const authorization = normalizeAuthorization(authorizationReceipt, normalizedPlan);
  return sealIntent({
    schema: RETIRED_HANDOFF_SUCCESSOR_DISPOSITION_INTENT_SCHEMA,
    planDigest: normalizedPlan.planDigest,
    subjectKey: normalizedPlan.subjectKey,
    planSnapshot: normalizedPlan,
    authorizationDigest: authorization.authorizationDigest,
    status: "authorized",
    phases: {},
  });
}

export function normalizeRetiredHandoffSuccessorDispositionIntent(value) {
  exactObject(value, "Disposition intent", [
    "schema", "planDigest", "subjectKey", "planSnapshot", "authorizationDigest",
    "status", "phases", "intentDigest",
  ]);
  const plan = normalizeRetiredHandoffSuccessorDispositionPlan(value.planSnapshot);
  const status = requiredStatus(value.status);
  const phases = normalizeIntentPhases(value.phases, plan, status);
  const core = {
    schema: requiredText(value.schema, "intent schema"),
    planDigest: requiredDigest(value.planDigest, "intent plan digest"),
    subjectKey: requiredDigest(value.subjectKey, "intent subject key"),
    planSnapshot: plan,
    authorizationDigest: requiredDigest(value.authorizationDigest, "intent authorization digest"),
    status,
    phases,
  };
  if (core.schema !== RETIRED_HANDOFF_SUCCESSOR_DISPOSITION_INTENT_SCHEMA
    || core.planDigest !== plan.planDigest || core.subjectKey !== plan.subjectKey
    || core.authorizationDigest !== digestValue(authorizationCore(plan))
    || value.intentDigest !== digestValue(core)) {
    throw new Error("Disposition intent is malformed or drifted.");
  }
  return deepFreeze({ ...core, intentDigest: value.intentDigest });
}

export function advanceRetiredHandoffSuccessorDispositionIntent(intent, { status, values }) {
  const current = normalizeRetiredHandoffSuccessorDispositionIntent(intent);
  const nextStatus = requiredStatus(status);
  const currentIndex = STATUSES.indexOf(current.status);
  const nextIndex = STATUSES.indexOf(nextStatus);
  const normalizedValues = normalizePhaseValues(values, nextStatus, current.planSnapshot);
  if (nextIndex === currentIndex) {
    if (canonicalJson(current.phases[nextStatus]?.values) !== canonicalJson(normalizedValues)) {
      throw new Error(`Disposition ${nextStatus} replay drifted.`);
    }
    return current;
  }
  if (nextStatus === "authorized" || nextIndex !== currentIndex + 1) {
    throw new Error(`Disposition cannot advance from ${current.status} to ${nextStatus}.`);
  }
  return sealIntent({
    ...withoutKey(current, "intentDigest"),
    status: nextStatus,
    phases: { ...current.phases, [nextStatus]: { values: normalizedValues } },
  });
}

export function buildRetiredHandoffSuccessorDispositionReceipt({ plan, intent, evidence }) {
  const normalizedPlan = normalizeRetiredHandoffSuccessorDispositionPlan(plan);
  const normalizedIntent = normalizeRetiredHandoffSuccessorDispositionIntent(intent);
  const normalizedEvidence = normalizeRetiredHandoffSuccessorDispositionEvidence(evidence);
  if (normalizedIntent.status !== "verified"
    || normalizedIntent.planDigest !== normalizedPlan.planDigest
    || normalizedIntent.subjectKey !== normalizedPlan.subjectKey
    || normalizedEvidence.evidenceDigest !== normalizedPlan.evidenceDigest) {
    throw new Error("Disposition receipt inputs do not prove the exact verified plan.");
  }
  const core = {
    schema: RETIRED_HANDOFF_SUCCESSOR_DISPOSITION_RECEIPT_SCHEMA,
    status: "complete",
    planDigest: normalizedPlan.planDigest,
    subjectKey: normalizedPlan.subjectKey,
    evidenceDigest: normalizedPlan.evidenceDigest,
    portDecisionDigest: normalizedPlan.portDecisionDigest,
    authorizationDigest: normalizedIntent.authorizationDigest,
    admissionEffect: ADMISSION_EFFECT,
    cleanupEligible: false,
    verifiedOperationKey: normalizedIntent.phases.verified.values.operationKey,
    completeOperationKey: retiredHandoffSuccessorDispositionOperationKey({
      planDigest: normalizedPlan.planDigest,
      subjectKey: normalizedPlan.subjectKey,
      phase: "complete",
    }),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeRetiredHandoffSuccessorDispositionReceipt(value) {
  exactObject(value, "Disposition receipt", [
    "schema", "status", "planDigest", "subjectKey", "evidenceDigest", "portDecisionDigest",
    "authorizationDigest", "admissionEffect", "cleanupEligible", "verifiedOperationKey",
    "completeOperationKey", "receiptDigest",
  ]);
  const core = {
    schema: requiredText(value.schema, "receipt schema"),
    status: requiredText(value.status, "receipt status"),
    planDigest: requiredDigest(value.planDigest, "receipt plan digest"),
    subjectKey: requiredDigest(value.subjectKey, "receipt subject key"),
    evidenceDigest: requiredDigest(value.evidenceDigest, "receipt evidence digest"),
    portDecisionDigest: requiredDigest(value.portDecisionDigest, "receipt port-decision digest"),
    authorizationDigest: requiredDigest(value.authorizationDigest, "receipt authorization digest"),
    admissionEffect: requiredText(value.admissionEffect, "receipt admission effect"),
    cleanupEligible: requiredBoolean(value.cleanupEligible, "receipt cleanup eligibility"),
    verifiedOperationKey: requiredDigest(value.verifiedOperationKey, "verified operation key"),
    completeOperationKey: requiredDigest(value.completeOperationKey, "complete operation key"),
  };
  if (core.schema !== RETIRED_HANDOFF_SUCCESSOR_DISPOSITION_RECEIPT_SCHEMA
    || core.status !== "complete" || core.admissionEffect !== ADMISSION_EFFECT
    || core.cleanupEligible !== false
    || core.verifiedOperationKey !== retiredHandoffSuccessorDispositionOperationKey({
      planDigest: core.planDigest, subjectKey: core.subjectKey, phase: "verified",
    })
    || core.completeOperationKey !== retiredHandoffSuccessorDispositionOperationKey({
      planDigest: core.planDigest, subjectKey: core.subjectKey, phase: "complete",
    })
    || value.receiptDigest !== digestValue(core)) {
    throw new Error("Disposition receipt is malformed or drifted.");
  }
  return deepFreeze({ ...core, receiptDigest: value.receiptDigest });
}

function sealPlan(evidence, portDecision) {
  const core = {
    schema: RETIRED_HANDOFF_SUCCESSOR_DISPOSITION_PLAN_SCHEMA,
    provider: evidence.provider,
    repositoryId: evidence.repositoryId,
    targetRepository: evidence.source.repository,
    ledgerRepository: evidence.ledger.repository,
    sourcePullRequestNumber: evidence.source.pullRequestNumber,
    successorPullRequestNumber: evidence.successor.pullRequestNumber,
    subjectKey: retiredHandoffSuccessorDispositionSubjectKey(evidence),
    evidence,
    evidenceDigest: evidence.evidenceDigest,
    controllerDigest: digestValue(evidence.controller),
    portDecision,
    portDecisionDigest: portDecision.decisionDigest,
    admissionEffect: ADMISSION_EFFECT,
    cleanupEligible: false,
    phases: PLAN_PHASES,
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    exactAuthorization: `authorize retired-handoff-successor-disposition ${planDigest}`,
    planDigest,
  });
}

function normalizeController(value) {
  exactObject(value, "Controller evidence", [
    "repository", "rootRealpath", "runtimeModuleRootRealpath", "headSha", "headTreeSha",
    "mainSha", "originMainSha", "remoteMainSha", "remoteMainTreeSha", "originUrlDigest",
    "statusDigest", "clean", "runtimeFileSetDigest",
  ]);
  const controller = {
    repository: requiredRepository(value.repository, "controller repository"),
    rootRealpath: requiredText(value.rootRealpath, "controller root realpath"),
    runtimeModuleRootRealpath: requiredText(value.runtimeModuleRootRealpath, "runtime module root realpath"),
    headSha: requiredSha(value.headSha, "controller HEAD"), headTreeSha: requiredSha(value.headTreeSha, "controller HEAD tree"),
    mainSha: requiredSha(value.mainSha, "controller main SHA"), originMainSha: requiredSha(value.originMainSha, "controller origin/main SHA"),
    remoteMainSha: requiredSha(value.remoteMainSha, "controller ls-remote main SHA"),
    remoteMainTreeSha: requiredSha(value.remoteMainTreeSha, "controller remote main tree"),
    originUrlDigest: requiredDigest(value.originUrlDigest, "controller origin URL digest"),
    statusDigest: requiredDigest(value.statusDigest, "controller status digest"), clean: requiredBoolean(value.clean, "controller clean state"),
    runtimeFileSetDigest: requiredDigest(value.runtimeFileSetDigest, "controller runtime file-set digest"),
  };
  if (controller.rootRealpath !== controller.runtimeModuleRootRealpath || controller.clean !== true
    || controller.headSha !== controller.mainSha || controller.headSha !== controller.originMainSha
    || controller.headSha !== controller.remoteMainSha
    || controller.headTreeSha !== controller.remoteMainTreeSha) {
    throw new Error("Controller evidence is not exact clean protected main runtime evidence.");
  }
  return controller;
}

function normalizeLedger(value) {
  exactObject(value, "Ledger evidence", [
    "repository", "revision", "blobSha", "rawDigest", "rereadRevision", "rereadBlobSha",
    "rereadRawDigest", "digest", "sequence",
  ]);
  const ledger = {
    repository: requiredRepository(value.repository, "ledger repository"),
    revision: requiredSha(value.revision, "ledger revision"),
    blobSha: requiredSha(value.blobSha, "ledger blob SHA"),
    rawDigest: requiredDigest(value.rawDigest, "ledger raw digest"),
    rereadRevision: requiredSha(value.rereadRevision, "ledger reread revision"),
    rereadBlobSha: requiredSha(value.rereadBlobSha, "ledger reread blob SHA"),
    rereadRawDigest: requiredDigest(value.rereadRawDigest, "ledger reread raw digest"),
    digest: requiredDigest(value.digest, "ledger digest"),
    sequence: positiveInteger(value.sequence, "ledger sequence"),
  };
  if (ledger.revision !== ledger.rereadRevision || ledger.blobSha !== ledger.rereadBlobSha
    || ledger.rawDigest !== ledger.rereadRawDigest) {
    throw new Error("Ledger evidence changed between its A/B raw reads.");
  }
  return ledger;
}

function normalizeClaim(value) {
  exactObject(value, "Claim evidence", [
    "claimId", "claimDigest", "transitionDigest", "transitionCounter", "state",
    "retirementReason", "finalRevision", "reviewRequestId", "handoffEvidenceDigest", "entryDigest",
  ]);
  return {
    claimId: requiredDigest(value.claimId, "claim ID"), claimDigest: requiredDigest(value.claimDigest, "claim digest"),
    transitionDigest: requiredDigest(value.transitionDigest, "claim transition digest"),
    transitionCounter: positiveInteger(value.transitionCounter, "claim transition counter"),
    state: requiredText(value.state, "claim state"), retirementReason: requiredText(value.retirementReason, "claim retirement reason"),
    finalRevision: requiredSha(value.finalRevision, "claim final revision"), reviewRequestId: requiredText(value.reviewRequestId, "claim review request ID"),
    handoffEvidenceDigest: requiredDigest(value.handoffEvidenceDigest, "claim handoff evidence digest"), entryDigest: requiredDigest(value.entryDigest, "claim entry digest"),
  };
}

function normalizeSource(value) {
  exactObject(value, "Source provider evidence", [
    "repository", "pullRequestNumber", "pullRequestNodeId", "state", "isDraft", "branch",
    "headSha", "baseSha", "bodyDigest", "providerVersion", "remoteHeadSha",
    "handoffMarkerFinalRevision", "retiredRevisionReachable",
  ]);
  return {
    repository: requiredRepository(value.repository, "source repository"), pullRequestNumber: positiveInteger(value.pullRequestNumber, "source pull request number"),
    pullRequestNodeId: requiredText(value.pullRequestNodeId, "source pull request node ID"), state: requiredText(value.state, "source pull request state"),
    isDraft: requiredBoolean(value.isDraft, "source draft state"), branch: requiredText(value.branch, "source branch"),
    headSha: requiredSha(value.headSha, "source head SHA"), baseSha: requiredSha(value.baseSha, "source base SHA"),
    bodyDigest: requiredDigest(value.bodyDigest, "source body digest"), providerVersion: requiredText(value.providerVersion, "source provider version"),
    remoteHeadSha: requiredSha(value.remoteHeadSha, "source remote head SHA"),
    handoffMarkerFinalRevision: requiredSha(value.handoffMarkerFinalRevision, "handoff marker final revision"),
    retiredRevisionReachable: requiredBoolean(value.retiredRevisionReachable, "retired revision reachability"),
  };
}

function normalizeSuccessor(value) {
  exactObject(value, "Successor provider evidence", [
    "pullRequestNumber", "pullRequestNodeId", "state", "branch", "headSha", "mergeCommitSha",
    "protectedMainSha", "protectedMainContainsMerge", "requiredChecksDigest",
  ]);
  return {
    pullRequestNumber: positiveInteger(value.pullRequestNumber, "successor pull request number"),
    pullRequestNodeId: requiredText(value.pullRequestNodeId, "successor pull request node ID"), state: requiredText(value.state, "successor pull request state"),
    branch: requiredText(value.branch, "successor branch"), headSha: requiredSha(value.headSha, "successor head SHA"),
    mergeCommitSha: requiredSha(value.mergeCommitSha, "successor merge commit SHA"), protectedMainSha: requiredSha(value.protectedMainSha, "protected main SHA"),
    protectedMainContainsMerge: requiredBoolean(value.protectedMainContainsMerge, "protected main merge containment"),
    requiredChecksDigest: requiredDigest(value.requiredChecksDigest, "successor required checks digest"),
  };
}

function normalizeLocal(value) {
  exactObject(value, "Local projection evidence", [
    "projectionDigest", "worktreeCount", "branchPresent", "leasePresent", "cleanupEligible",
  ]);
  return {
    projectionDigest: requiredDigest(value.projectionDigest, "local projection digest"),
    worktreeCount: nonnegativeInteger(value.worktreeCount, "local worktree count"), branchPresent: requiredBoolean(value.branchPresent, "local branch presence"),
    leasePresent: requiredBoolean(value.leasePresent, "local lease presence"), cleanupEligible: requiredBoolean(value.cleanupEligible, "local cleanup eligibility"),
  };
}

function normalizeCommits(values, label) {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_COMMITS) {
    throw new Error(`${label} commits must contain 1-${MAX_COMMITS} entries.`);
  }
  const seen = new Set();
  return values.map((value, index) => {
    exactObject(value, `${label} commit ${index}`, ["sha", "patchId", "changedPathsDigest"]);
    const commit = {
      sha: requiredSha(value.sha, `${label} commit ${index} SHA`),
      patchId: requiredSha(value.patchId, `${label} commit ${index} patch ID`),
      changedPathsDigest: requiredDigest(value.changedPathsDigest, `${label} commit ${index} paths digest`),
    };
    if (seen.has(commit.sha)) throw new Error(`${label} commit SHAs must be unique.`);
    seen.add(commit.sha);
    return commit;
  });
}

function normalizeIntentPhases(value, plan, status) {
  const expected = status === "authorized" ? [] : status === "verified" ? ["verified"] : PLAN_PHASES;
  exactObject(value, "Intent phases", expected);
  return Object.fromEntries(expected.map(phase => {
    const record = value[phase];
    exactObject(record, `${phase} phase`, ["values"]);
    return [phase, { values: normalizePhaseValues(record.values, phase, plan) }];
  }));
}

function normalizePhaseValues(value, phase, plan) {
  const keys = phase === "complete"
    ? ["operationKey", "evidenceDigest", "receiptDigest"]
    : ["operationKey", "evidenceDigest"];
  exactObject(value, `${phase} values`, keys);
  const normalized = {
    operationKey: requiredDigest(value.operationKey, `${phase} operation key`),
    evidenceDigest: requiredDigest(value.evidenceDigest, `${phase} evidence digest`),
    ...(phase === "complete" ? { receiptDigest: requiredDigest(value.receiptDigest, "receipt digest") } : {}),
  };
  if (phase === "authorized" || normalized.evidenceDigest !== plan.evidenceDigest
    || normalized.operationKey !== retiredHandoffSuccessorDispositionOperationKey({
      planDigest: plan.planDigest, subjectKey: plan.subjectKey, phase,
    })) {
    throw new Error(`Disposition ${phase} values are not operation-bound.`);
  }
  return normalized;
}

function normalizeAuthorization(value, plan) {
  exactObject(value, "Authorization receipt", [
    "schema", "planDigest", "subjectKey", "authorization", "authorizationDigest",
  ]);
  const core = {
    schema: requiredText(value.schema, "authorization schema"),
    planDigest: requiredDigest(value.planDigest, "authorization plan digest"),
    subjectKey: requiredDigest(value.subjectKey, "authorization subject key"),
    authorization: requiredText(value.authorization, "authorization text"),
  };
  if (core.schema !== RETIRED_HANDOFF_SUCCESSOR_DISPOSITION_AUTHORIZATION_SCHEMA
    || core.planDigest !== plan.planDigest || core.subjectKey !== plan.subjectKey
    || core.authorization !== plan.exactAuthorization
    || value.authorizationDigest !== digestValue(authorizationCore(plan))) {
    throw new Error("Disposition authorization receipt is malformed or drifted.");
  }
  return deepFreeze({ ...core, authorizationDigest: value.authorizationDigest });
}

function authorizationCore(plan) {
  return { schema: RETIRED_HANDOFF_SUCCESSOR_DISPOSITION_AUTHORIZATION_SCHEMA,
    planDigest: plan.planDigest, subjectKey: plan.subjectKey, authorization: plan.exactAuthorization };
}
function sealIntent(core) {
  return deepFreeze({ ...core, intentDigest: digestValue(core) });
}

function requiredStatus(value) {
  const status = requiredText(value, "intent status");
  if (!STATUSES.includes(status)) throw new Error(`Unsupported disposition status: ${status}.`); return status;
}
function normalizeShaList(value, label) {
  if (!Array.isArray(value) || value.length > MAX_COMMITS) throw new Error(`${label} successor SHAs are invalid.`);
  const shas = value.map((sha, index) => requiredSha(sha, `${label} successor SHA ${index}`));
  if (new Set(shas).size !== shas.length) throw new Error(`${label} successor SHAs must be unique.`); return shas;
}
function exactObject(value, label, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(`${label} must contain exact keys.`);
}
function requiredText(value, label) {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > 512) throw new Error(`${label} must contain 1-512 characters.`); return normalized;
}
function requiredRepository(value, label) {
  const repository = requiredText(value, label);
  if (!REPOSITORY_PATTERN.test(repository)) throw new Error(`${label} must be owner/name.`); return repository;
}
function requiredSha(value, label) {
  const sha = String(value || "");
  if (!SHA_PATTERN.test(sha)) throw new Error(`${label} must be a lowercase 40-hex SHA.`); return sha;
}
function requiredDigest(value, label) {
  const digest = String(value || "");
  if (!DIGEST_PATTERN.test(digest)) throw new Error(`${label} must be a lowercase SHA-256 digest.`); return digest;
}
function requiredBoolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`); return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`); return value;
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a nonnegative integer.`); return value;
}

function withoutKey(value, key) {
  const { [key]: omitted, ...rest } = value; void omitted; return rest;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value;
}
