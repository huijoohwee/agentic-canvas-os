// Responsibility: Seal the recovery plan, journal, and completion-ready receipt.
import {
  canonicalJson,
  digestValue,
} from "./cloud-collaboration-primitives.mjs";
import { normalizeActiveOwnedDirtLeaseRecovery }
  from "./active-owned-dirt-recovery-contract.mjs";
import { normalizeTaskAuthorityBinding }
  from "./task-bound-lane-authority-contract.mjs";

export const OPERATION = "canonical-squash-attribution-recovery-terminalization";
export const EVIDENCE_SCHEMA = `agentic-${OPERATION}-evidence/v1`;
export const PLAN_SCHEMA = `agentic-${OPERATION}-plan/v1`;
export const JOURNAL_SCHEMA = `agentic-${OPERATION}-state/v1`;
export const RECEIPT_SCHEMA = `agentic-${OPERATION}-receipt/v1`;
export const GENERIC_SELF_HOSTED_RECOVERY_EVIDENCE_PATH =
  "docs/CANONICAL-SQUASH-ATTRIBUTION-RECOVERY-TERMINALIZATION.md";
export const GENERIC_SELF_HOSTED_RECOVERY_PATHS = Object.freeze([
  "__tests__/canonical-squash-attribution-recovery-terminalization.test.mjs",
  GENERIC_SELF_HOSTED_RECOVERY_EVIDENCE_PATH,
  "scripts/canonical-squash-attribution-recovery-terminalization-contract.mjs",
  "scripts/canonical-squash-attribution-recovery-terminalization-repository-adapter.mjs",
]);
export const LEGACY_INTEGRATION_RUN_PROFILE = "integration";
export const SELF_HOSTED_CI_RUN_PROFILE = "self-hosted-ci";
export const PHASES = Object.freeze([
  "authorized",
  "evidence-verified",
  "cloud-retirement-intent",
  "cloud-retired",
  "completion-intent",
  "completion-projected",
  "verified",
  "complete",
]);

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const FORBIDDEN_EFFECTS = Object.freeze([
  "authored-branch-write", "authored-tree-write", "pull-request-write",
  "auto-merge-write", "new-cloud-claim", "runtime", "cleanup",
  "release", "deployment",
]);
const PRESERVATION = Object.freeze({
  authoredSourceBytes: "unchanged",
  authoredTree: "unchanged",
  authoredBranchRef: "unchanged",
  worktreeProjection: "detached-at-canonical-main",
  indexProjection: "canonical-main",
  remoteTrackingRefs: "unchanged",
  pullRequest: "unchanged",
  autoMerge: "unchanged",
  newClaims: "none",
  runtime: "not-performed",
  cleanup: "not-performed",
  release: "not-performed",
  deployment: "not-performed",
});

export function buildPlan(evidence) {
  const normalized = normalizeEvidence(evidence);
  const core = {
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    evidence: normalized,
    effects: [
      "retire-integrated-cloud-claim",
      "project-local-completion-ready",
      "detach-subject-worktree-to-canonical-main",
    ],
    completionPolicy:
      "sealed-main-or-protected-descendant-after-exact-cloud-retirement",
    forbiddenEffects: [...FORBIDDEN_EFFECTS],
  };
  const planDigest = digestValue(core);
  return freeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize canonical-squash-attribution-recovery ${planDigest}`,
  });
}

export function normalizePlan(value) {
  object(value, "recovery plan");
  const rebuilt = buildPlan(value.evidence);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("plan drift");
  return rebuilt;
}

export function authorizePlan(plan, authorization) {
  const normalized = normalizePlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error(`Exact authorization required: ${normalized.exactAuthorization}`);
  }
  return digestValue({
    operation: OPERATION,
    planDigest: normalized.planDigest,
    authorization,
  });
}

export function createJournal(plan) {
  return sealJournal({
    schema: JOURNAL_SCHEMA,
    operation: OPERATION,
    plan: normalizePlan(plan),
    state: null,
  });
}

export function startJournal(journal, authorization) {
  const current = normalizeJournal(journal);
  if (current.state !== null) throw new Error("Recovery journal is already authorized.");
  return sealJournal({
    schema: JOURNAL_SCHEMA,
    operation: OPERATION,
    plan: current.plan,
    state: {
      phase: "authorized",
      receipts: {
        authorized: phaseReceipt("authorized", {
          authorizationDigest: authorizePlan(current.plan, authorization),
        }),
      },
    },
  });
}

export function advanceJournal(journal, phase, values) {
  const current = normalizeJournal(journal);
  if (!current.state) throw new Error("Recovery journal is not authorized.");
  const prior = PHASES.indexOf(current.state.phase);
  const next = PHASES.indexOf(phase);
  if (next !== prior + 1) {
    throw new Error(`Recovery cannot advance from ${current.state.phase} to ${phase}.`);
  }
  return sealJournal({
    schema: JOURNAL_SCHEMA,
    operation: OPERATION,
    plan: current.plan,
    state: {
      phase,
      receipts: {
        ...current.state.receipts,
        [phase]: phaseReceipt(phase, values),
      },
    },
  });
}

export function normalizeJournal(value) {
  object(value, "recovery journal");
  if (value.schema !== JOURNAL_SCHEMA || value.operation !== OPERATION) {
    invalid("journal identity");
  }
  const plan = normalizePlan(value.plan);
  const state = value.state === null ? null : normalizeState(value.state, plan);
  const core = { schema: JOURNAL_SCHEMA, operation: OPERATION, plan, state };
  if (value.journalDigest !== digestValue(core)
    || canonicalJson(value) !== canonicalJson({ ...core, journalDigest: value.journalDigest })) {
    invalid("journal seal");
  }
  return freeze({ ...core, journalDigest: value.journalDigest });
}

export function operationKey(plan, phase) {
  const normalized = normalizePlan(plan);
  if (!PHASES.includes(phase)) invalid("operation phase");
  return digestValue({ operation: OPERATION, planDigest: normalized.planDigest, phase });
}

export function buildReceipt(journal) {
  const current = normalizeJournal(journal);
  if (!["verified", "complete"].includes(current.state?.phase)) {
    throw new Error("Completion-ready receipt requires terminal verification.");
  }
  const receipts = current.state.receipts;
  const core = {
    schema: RECEIPT_SCHEMA,
    status: "completion-ready",
    operation: OPERATION,
    planDigest: current.plan.planDigest,
    authorizationDigest: receipts.authorized.authorizationDigest,
    evidenceDigest: current.plan.evidence.evidenceDigest,
    evidenceVerificationDigest: receipts["evidence-verified"].evidenceVerificationDigest,
    cloud: {
      status: "integrated-retired",
      terminalStateDigest: receipts["cloud-retired"].terminalCloudDigest,
      taskBindingDigest:
        receipts["cloud-retirement-intent"].taskAuthorityBindingDigest,
      taskOperation: receipts["cloud-retirement-intent"].taskAuthorizationOperation,
    },
    completion: {
      status: "completion-ready",
      mainSha: receipts["completion-projected"].mainSha,
      completionBaseSha: receipts["completion-projected"].completionBaseSha,
      completionTopologyDigest:
        receipts["completion-projected"].completionTopologyDigest,
      completingLeaseDigest: receipts["completion-projected"].completingLeaseDigest,
      taskBindingDigest: receipts["completion-intent"].taskAuthorityBindingDigest,
      taskOperation: receipts["completion-intent"].taskAuthorizationOperation,
    },
    terminalEvidenceDigest: receipts.verified.terminalEvidenceDigest,
    continuation: {
      schema: "agentic-canonical-squash-attribution-recovery-continuation/v1",
      command: "device:integrate",
      repository: current.plan.evidence.subject.worktreePath,
      sessionId: current.plan.evidence.subject.sessionId,
      runtime: "canonical",
    },
    preservation: current.plan.evidence.preservation,
    forbiddenEffects: current.plan.forbiddenEffects,
  };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeReceipt(value) {
  object(value, "recovery receipt");
  const expectedKeys = [
    "schema", "status", "operation", "planDigest", "authorizationDigest",
    "evidenceDigest", "evidenceVerificationDigest", "cloud", "completion",
    "terminalEvidenceDigest", "continuation", "preservation", "forbiddenEffects",
    "receiptDigest",
  ];
  if (canonicalJson(Object.keys(value)) !== canonicalJson(expectedKeys)) {
    invalid("receipt shape");
  }
  const { receiptDigest, ...core } = value;
  if (core.schema !== RECEIPT_SCHEMA || core.status !== "completion-ready"
    || core.operation !== OPERATION || receiptDigest !== digestValue(core)) {
    invalid("receipt seal");
  }
  for (const name of [
    "planDigest", "authorizationDigest", "evidenceDigest",
    "evidenceVerificationDigest", "terminalEvidenceDigest",
  ]) digest(core[name], `receipt ${name}`);
  const cloud = object(core.cloud, "receipt cloud");
  if (canonicalJson(Object.keys(cloud)) !== canonicalJson([
    "status", "terminalStateDigest", "taskBindingDigest", "taskOperation",
  ]) || cloud.status !== "integrated-retired") invalid("receipt cloud shape");
  digest(cloud.terminalStateDigest, "receipt cloud terminal state");
  digest(cloud.taskBindingDigest, "receipt cloud task binding");
  required(cloud.taskOperation, "receipt cloud task operation");
  const completion = object(core.completion, "receipt completion");
  if (canonicalJson(Object.keys(completion)) !== canonicalJson([
    "status", "mainSha", "completionBaseSha", "completionTopologyDigest",
    "completingLeaseDigest", "taskBindingDigest", "taskOperation",
  ]) || completion.status !== "completion-ready") invalid("receipt completion shape");
  sha(completion.mainSha, "receipt completion main SHA");
  sha(completion.completionBaseSha, "receipt completion base SHA");
  digest(completion.completionTopologyDigest, "receipt completion topology");
  digest(completion.completingLeaseDigest, "receipt completing lease");
  digest(completion.taskBindingDigest, "receipt completion task binding");
  required(completion.taskOperation, "receipt completion task operation");
  const continuation = object(core.continuation, "receipt continuation");
  if (canonicalJson(Object.keys(continuation)) !== canonicalJson([
    "schema", "command", "repository", "sessionId", "runtime",
  ])
    || continuation.schema
      !== "agentic-canonical-squash-attribution-recovery-continuation/v1"
    || continuation.command !== "device:integrate" || continuation.runtime !== "canonical") {
    invalid("receipt continuation");
  }
  required(continuation.repository, "receipt continuation repository");
  required(continuation.sessionId, "receipt continuation session");
  if (canonicalJson(core.preservation) !== canonicalJson(PRESERVATION)
    || canonicalJson(core.forbiddenEffects) !== canonicalJson(FORBIDDEN_EFFECTS)) {
    invalid("receipt effect contract");
  }
  return freeze({ ...core, receiptDigest });
}

export function phaseReceipt(phase, values) {
  if (!PHASES.includes(phase)) invalid("phase receipt identity");
  object(values, `${phase} receipt values`);
  const core = { phase, ...structuredClone(values) };
  validatePhase(core);
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizeEvidence(value) {
  object(value, "recovery evidence");
  if (value.schema !== EVIDENCE_SCHEMA) invalid("evidence schema");
  instant(value.observedAt, "evidence observation");
  object(value.controller, "controller evidence");
  repository(value.controller.repository, "controller repository");
  repository(value.controller.targetRepository, "controller target repository");
  sha(value.controller.revision, "controller revision");
  sha(value.controller.tree, "controller tree");
  object(value.subject, "subject evidence");
  repository(value.subject.repository, "subject repository");
  const genericRepositorySubject = value.subject.repository === value.controller.repository
    && value.controller.targetRepository === value.subject.repository;
  if (genericRepositorySubject !== (value.subject.pinTransition === null)) {
    invalid("subject repository classification");
  }
  required(value.subject.worktreePath, "subject worktree");
  required(value.subject.branch, "subject branch");
  required(value.subject.sessionId, "subject session");
  required(value.subject.scope, "subject scope");
  digest(value.subject.leaseDigest, "subject lease digest");
  const leaseIdentity = object(value.subject.leaseIdentity, "subject lease identity");
  digest(value.subject.leaseIdentityDigest, "subject lease identity digest");
  const leaseIdentityKeys = [
    "schema", "epoch", "sessionId", "device", "scope", "branch",
    "worktreePath", "baseSha", "fenceSha", "pullRequestUrl", "autoDelivery",
    "runtimeRequired", "ownedDirtRecovery", "pullRequestProjectionRepair",
    "reviewHeadSha", "deliveryHeadSha", "parkHeadSha", "parkBranchHeadSha",
    "parkSourceEpoch", "parkSourceFenceSha", "parkStashRef", "parkStashSha",
    "parkStashMessage", "parkStashStatus", "acquiredAt", "admission",
    "cloudAuthority", "integration", "taskAuthority",
  ];
  if (genericRepositorySubject) leaseIdentityKeys.push("successorLineage");
  if (canonicalJson(Object.keys(leaseIdentity)) !== canonicalJson(leaseIdentityKeys)
    || digestValue(leaseIdentity) !== value.subject.leaseIdentityDigest
    || leaseIdentity.schema !== "agentic-writer-lease/v2"
    || !Number.isSafeInteger(leaseIdentity.epoch) || leaseIdentity.epoch < 1
    || leaseIdentity.sessionId !== value.subject.sessionId
    || leaseIdentity.scope !== value.subject.scope
    || leaseIdentity.branch !== value.subject.branch
    || leaseIdentity.worktreePath !== value.subject.worktreePath
    || leaseIdentity.autoDelivery !== true || leaseIdentity.runtimeRequired !== true
    || leaseIdentity.ownedDirtRecovery !== null
    || leaseIdentity.pullRequestProjectionRepair !== null
    || leaseIdentity.reviewHeadSha !== null
    || ["parkHeadSha", "parkBranchHeadSha", "parkSourceEpoch", "parkSourceFenceSha",
      "parkStashRef", "parkStashSha", "parkStashMessage", "parkStashStatus"]
      .some(name => leaseIdentity[name] !== null)) {
    invalid("subject immutable lease identity");
  }
  required(leaseIdentity.device, "subject lease device");
  sha(leaseIdentity.baseSha, "subject lease base");
  sha(leaseIdentity.fenceSha, "subject lease fence");
  sha(leaseIdentity.deliveryHeadSha, "subject lease delivery head");
  instant(leaseIdentity.acquiredAt, "subject lease acquisition");
  object(leaseIdentity.admission, "subject lease admission");
  object(leaseIdentity.cloudAuthority, "subject lease cloud authority");
  object(leaseIdentity.integration, "subject lease integration");
  object(leaseIdentity.taskAuthority, "subject lease task authority");
  if (genericRepositorySubject) {
    normalizeGenericSuccessorLineage(leaseIdentity.successorLineage, leaseIdentity);
  }
  digest(value.subject.taskAuthorityBindingDigest, "subject task binding digest");
  const subjectTaskAuthority = object(
    value.subject.taskAuthority,
    "subject task authority",
  );
  let normalizedSubjectTaskAuthority;
  try {
    normalizedSubjectTaskAuthority = normalizeTaskAuthorityBinding(subjectTaskAuthority);
  } catch {
    invalid("subject task authority binding");
  }
  if (canonicalJson(normalizedSubjectTaskAuthority)
    !== canonicalJson(subjectTaskAuthority)) invalid("subject task authority normalization");
  if (canonicalJson(leaseIdentity.taskAuthority)
    !== canonicalJson(subjectTaskAuthority)) invalid("subject lease task authority join");
  required(subjectTaskAuthority.authoritySubjectId, "subject task authority subject");
  required(subjectTaskAuthority.proofAdapterId, "subject task proof adapter");
  if (!Number.isSafeInteger(subjectTaskAuthority.generation)
    || subjectTaskAuthority.generation < 1
    || subjectTaskAuthority.bindingDigest
      !== value.subject.taskAuthorityBindingDigest
    || subjectTaskAuthority.laneBindingDigest !== digestValue({
      branch: leaseIdentity.branch,
      scope: leaseIdentity.scope,
      device: leaseIdentity.device,
      epoch: leaseIdentity.epoch,
      baseSha: leaseIdentity.baseSha,
      cloudClaimId: leaseIdentity.cloudAuthority.claimId,
    })) {
    invalid("subject task authority join");
  }
  for (const name of ["bindingDigest", "laneBindingDigest", "publicKeyDigest"]) {
    digest(subjectTaskAuthority[name], `subject task authority ${name}`);
  }
  digest(value.subject.claimId, "subject claim ID");
  digest(value.subject.claimDigest, "subject claim digest");
  digest(value.subject.integrationReceiptDigest, "subject integration receipt");
  digest(value.subject.checksDigest, "subject checks digest");
  sha(value.subject.reviewedHeadSha, "subject reviewed head");
  sha(value.subject.reviewedTreeSha, "subject reviewed tree");
  required(value.subject.remoteBranch, "subject remote branch");
  if (value.subject.remoteBranch !== "absent"
    && value.subject.remoteBranch !== value.subject.reviewedHeadSha) {
    invalid("subject remote branch");
  }
  normalizeMessageEvidence(value.subject.reviewedCommit, "subject reviewed commit", true);
  if (value.subject.reviewedCommit.sha !== value.subject.reviewedHeadSha
    || value.subject.reviewedCommit.treeSha !== value.subject.reviewedTreeSha) {
    invalid("subject reviewed commit join");
  }
  normalizePull(value.subject.pullRequest, "subject pull request");
  const genericRefreshValid = genericRepositorySubject
    ? normalizeGenericProtectedRefresh(value.subject.protectedRefresh, {
      subject: value.subject,
      leaseIdentity,
    })
    : false;
  if (leaseIdentity.baseSha !== value.subject.pullRequest.baseSha
    || leaseIdentity.pullRequestUrl !== value.subject.pullRequest.url
    || leaseIdentity.deliveryHeadSha !== value.subject.reviewedHeadSha
    || (genericRepositorySubject ? !genericRefreshValid
      : leaseIdentity.integration.commitSha !== value.subject.reviewedHeadSha
        || leaseIdentity.integration.treeSha !== value.subject.reviewedTreeSha)
    || digestValue(leaseIdentity.integration.paths) !== digestValue(value.subject.changedPaths)
    || canonicalJson(leaseIdentity.cloudAuthority)
      !== canonicalJson(value.subject.cloudAuthority)) {
    invalid("subject immutable lease evidence join");
  }
  required(value.subject.expectedSquashHeadline, "subject expected squash headline");
  const subjectAutoMerge = object(
    value.subject.pullRequest.autoMergeRequest,
    "subject auto-merge request",
  );
  if (subjectAutoMerge.mergeMethod !== "SQUASH"
    || subjectAutoMerge.commitHeadline !== value.subject.expectedSquashHeadline
    || subjectAutoMerge.commitBody !== null
    || subjectAutoMerge.enabledBy.login !== value.subject.pullRequest.mergedBy
    || subjectAutoMerge.enabledBy.isBot !== false) {
    invalid("subject provider auto-merge cause");
  }
  object(value.subject.malformedCommit, "malformed commit");
  sha(value.subject.malformedCommit.sha, "malformed commit SHA");
  sha(value.subject.malformedCommit.parentSha, "malformed commit parent");
  sha(value.subject.malformedCommit.treeSha, "malformed commit tree");
  digest(value.subject.malformedCommit.messageDigest, "malformed message digest");
  normalizeMessageFraming(value.subject.malformedCommit, "malformed commit", false);
  if (value.subject.malformedCommit.treeSha !== value.subject.reviewedTreeSha
    || value.subject.malformedCommit.sha !== value.subject.pullRequest.mergeSha
    || value.subject.malformedCommit.parentSha !== value.subject.pullRequest.baseSha
    || value.subject.pullRequest.headSha !== value.subject.reviewedHeadSha) {
    invalid("malformed commit join");
  }
  if (value.subject.malformedCommit.classification
    !== "provider-rewritten-nonterminal-attribution") invalid("malformed classification");
  normalizeChangedEntries(value.subject.changedEntries, "subject changed entries");
  const genericSelfHosted = value.subject.pinTransition === null;
  if (genericRepositorySubject !== genericSelfHosted) {
    invalid("subject repository classification");
  }
  if (genericSelfHosted) {
    normalizeGenericSubjectChangeSet(value, leaseIdentity);
  } else {
    if (!Array.isArray(value.subject.changedPaths)
      || value.subject.changedPaths.length !== 1
      || value.subject.changedEntries.length !== 1
      || value.subject.changedEntries[0].path !== value.subject.changedPaths[0]
      || value.subject.changedEntries[0].status !== "M"
      || value.subject.changedEntries[0].oldMode !== "100644"
      || value.subject.changedEntries[0].newMode !== "100644"
      || value.subject.changedEntries[0].oldBlob === value.subject.changedEntries[0].newBlob) {
      invalid("subject exact changed path");
    }
    const pin = object(value.subject.pinTransition, "subject pin transition");
    if (pin.path !== "docs/runtime-readiness-contract.md"
      || pin.path !== value.subject.changedPaths[0]
      || pin.oldBlob !== value.subject.changedEntries[0].oldBlob
      || pin.newBlob !== value.subject.changedEntries[0].newBlob
      || pin.oldRevision === pin.newRevision) invalid("subject pin transition join");
    for (const name of ["oldRevision", "newRevision"]) {
      sha(pin[name], `subject pin ${name}`);
    }
    for (const name of ["oldContentDigest", "newContentDigest"]) {
      digest(pin[name], `subject pin ${name}`);
    }
  }
  if (!Array.isArray(value.subject.sourceCommitSubjects)
    || value.subject.sourceCommitSubjects.length < 1
    || value.subject.sourceCommitSubjects.some(subject => !required(subject, "source subject"))) {
    invalid("subject source commits");
  }
  normalizeRunPair(value.subject.checks, {
    label: "subject checks",
    sourceSha: value.subject.reviewedHeadSha,
    sourceBranch: value.subject.pullRequest.headBranch,
    mergeSha: value.subject.malformedCommit.sha,
    profile: genericSelfHosted
      ? SELF_HOSTED_CI_RUN_PROFILE
      : LEGACY_INTEGRATION_RUN_PROFILE,
  });
  if (digestValue(value.subject.checks) !== value.subject.checksDigest) {
    invalid("subject checks join");
  }
  normalizeCloudAuthority(value.subject);
  object(value.recovery, "recovery evidence");
  normalizePull(value.recovery.pullRequest, "recovery pull request");
  sha(value.recovery.sourceHeadSha, "recovery source head");
  sha(value.recovery.sourceTreeSha, "recovery source tree");
  sha(value.recovery.mergeSha, "recovery merge");
  sha(value.recovery.parentSha, "recovery parent");
  sha(value.recovery.treeSha, "recovery tree");
  sha(value.recovery.controllerRevision, "recovery controller revision");
  if (value.recovery.pullRequest.headSha !== value.recovery.sourceHeadSha
    || value.recovery.pullRequest.mergeSha !== value.recovery.mergeSha
    || value.recovery.pullRequest.baseSha !== value.recovery.parentSha) {
    invalid("recovery pull request commit join");
  }
  if (genericSelfHosted) {
    const expectedControllerRevision = value.recovery.genericRecoveryVariant
      === "evidence-document"
      ? value.subject.malformedCommit.sha
      : value.recovery.mergeSha;
    if (!["evidence-document", "self-hosted-controller-update"]
      .includes(value.recovery.genericRecoveryVariant)
      || value.recovery.controllerRevision !== expectedControllerRevision
      || (value.recovery.genericRecoveryVariant === "self-hosted-controller-update"
        && (value.controller.revision !== value.recovery.mergeSha
          || value.controller.tree !== value.recovery.treeSha))
      || value.recovery.subjectAncestorOfRecoveryParent !== true) {
      invalid("generic recovery controller topology");
    }
  } else if (value.recovery.controllerRevision !== value.subject.pinTransition.newRevision) {
    invalid("recovery controller pin join");
  }
  digest(value.recovery.sourceCommitMessageDigest, "recovery source message digest");
  normalizeMessageFraming({
    objectMessageByteLength: value.recovery.sourceObjectMessageByteLength,
    objectMessageSha256: value.recovery.sourceObjectMessageSha256,
    objectMessageTerminalLf: value.recovery.sourceObjectMessageTerminalLf,
  }, "recovery source commit", true);
  digest(value.recovery.commitMessageDigest, "recovery message digest");
  normalizeMessageFraming({
    objectMessageByteLength: value.recovery.commitObjectMessageByteLength,
    objectMessageSha256: value.recovery.commitObjectMessageSha256,
    objectMessageTerminalLf: value.recovery.commitObjectMessageTerminalLf,
  }, "recovery protected commit", false);
  sha(value.recovery.evidenceBlobSha, "recovery evidence blob OID");
  digest(value.recovery.evidenceBlobDigest, "recovery evidence blob digest");
  digest(value.recovery.evidenceContentDigest, "recovery evidence content digest");
  digest(value.recovery.frontmatterDigest, "recovery frontmatter digest");
  digest(value.recovery.checksDigest, "recovery checks digest");
  digest(value.recovery.cleanupReceiptDigest, "recovery cleanup receipt digest");
  normalizeChangedEntries(value.recovery.changedEntries, "recovery changed entries");
  if (genericSelfHosted) {
    normalizeGenericRecoveryChangeSet(value.recovery, value.subject);
  } else if (value.recovery.changedEntries.length !== 1
    || value.recovery.changedEntries[0].status !== "A"
    || value.recovery.changedEntries[0].oldMode !== "000000"
    || value.recovery.changedEntries[0].newMode !== "100644"
    || value.recovery.changedEntries[0].newBlob !== value.recovery.evidenceBlobSha
    || value.recovery.changedEntries[0].path !== value.recovery.evidencePath
    || value.recovery.sourceTreeSha !== value.recovery.treeSha
    || value.recovery.parentSha !== value.subject.malformedCommit.sha) {
    invalid("recovery Git relation");
  }
  normalizeRunPair(value.recovery.checks, {
    label: "recovery checks",
    sourceSha: value.recovery.sourceHeadSha,
    sourceBranch: value.recovery.pullRequest.headBranch,
    mergeSha: value.recovery.mergeSha,
    profile: genericSelfHosted
      ? SELF_HOSTED_CI_RUN_PROFILE
      : LEGACY_INTEGRATION_RUN_PROFILE,
  });
  if (digestValue(value.recovery.checks) !== value.recovery.checksDigest) {
    invalid("recovery checks join");
  }
  normalizeRecoveryTerminal(value.recovery.terminal, value.recovery);
  if (!Array.isArray(value.recovery.changedPaths)
    || (!genericSelfHosted && (value.recovery.changedPaths.length !== 1
      || value.recovery.changedPaths[0] !== value.recovery.evidencePath))) {
    invalid("recovery changed paths");
  }
  required(value.recovery.evidencePath, "recovery evidence path");
  if (value.recovery.deploymentAuthority !== "forbidden") {
    invalid("recovery deployment authority");
  }
  object(value.canonical, "canonical evidence");
  sha(value.canonical.protectedMainSha, "canonical main");
  if (value.canonical.recoveryContained !== true
    || value.canonical.controllerContained !== true) invalid("canonical ancestry");
  object(value.preservation, "preservation evidence");
  if (canonicalJson(value.preservation) !== canonicalJson(PRESERVATION)) {
    invalid("preservation evidence");
  }
  const { evidenceDigest, ...core } = value;
  if (evidenceDigest !== digestValue(core)) invalid("evidence seal");
  return freeze(structuredClone(value));
}

function normalizeMessageEvidence(value, label, terminalLf) {
  object(value, label);
  sha(value.sha, `${label} SHA`);
  sha(value.treeSha, `${label} tree`);
  digest(value.messageDigest, `${label} message digest`);
  normalizeMessageFraming(value, label, terminalLf);
}
function normalizeMessageFraming(value, label, terminalLf) {
  object(value, label);
  if (!Number.isSafeInteger(value.objectMessageByteLength)
    || value.objectMessageByteLength < 1
    || value.objectMessageTerminalLf !== terminalLf) invalid(`${label} framing`);
  digest(value.objectMessageSha256, `${label} raw message SHA-256`);
}
function normalizeChangedEntries(value, label) {
  if (!Array.isArray(value)) invalid(label);
  for (const entry of value) {
    object(entry, `${label} entry`);
    if (!/^[0-7]{6}$/u.test(String(entry.oldMode || ""))
      || !/^[0-7]{6}$/u.test(String(entry.newMode || ""))
      || !SHA.test(String(entry.oldBlob || "")) || !SHA.test(String(entry.newBlob || ""))
      || !/^[A-Z]$/u.test(String(entry.status || ""))) invalid(`${label} entry`);
    required(entry.path, `${label} path`);
  }
}
function normalizeGenericSubjectChangeSet(value, leaseIdentity) {
  const subject = value.subject;
  if (subject.repository !== value.controller.repository
    || value.controller.targetRepository !== subject.repository) {
    invalid("generic subject repository boundary");
  }
  normalizeExactModifiedPaths({
    paths: subject.changedPaths,
    entries: subject.changedEntries,
    allowAdditions: true,
    label: "generic subject changed paths",
  });
  const admission = object(leaseIdentity.admission, "generic subject admission");
  const authority = object(leaseIdentity.cloudAuthority, "generic subject cloud authority");
  const integration = object(leaseIdentity.integration, "generic subject integration");
  const expectedScopes = subject.changedPaths.map(repositoryPath => `path:${repositoryPath}`);
  if (canonicalJson(integration.paths) !== canonicalJson(subject.changedPaths)
    || canonicalJson(admission.declaredWriteSet)
      !== canonicalJson(authority.cloudDeclaredWriteScope)
    || canonicalJson(pathScopes(admission.declaredWriteSet, "generic admission write set"))
      !== canonicalJson(expectedScopes)
    || canonicalJson(pathScopes(authority.cloudDeclaredWriteScope, "generic cloud write set"))
      !== canonicalJson(expectedScopes)
    || admission.semanticScope !== subject.scope
    || authority.canonicalBaseSha !== leaseIdentity.baseSha
    || authority.targetRepository !== subject.repository
    || admission.writeSetDigest !== authority.writeSetDigest
    || admission.manifestDigest !== authority.manifestDigest) {
    invalid("generic subject scope authority join");
  }
  normalizeSourceCommitAuthors(subject.sourceCommitAuthors);
  normalizeGenericPredecessorAuthority(subject.predecessorAuthority, {
    subject,
    leaseIdentity,
  });
  if (!Number.isSafeInteger(subject.historicalLeaseEpoch)
    || subject.historicalLeaseEpoch < 1
    || subject.historicalLeaseEpoch > leaseIdentity.cloudAuthority.leaseEpoch
    || (leaseIdentity.successorLineage === null
      && subject.historicalLeaseEpoch !== leaseIdentity.cloudAuthority.leaseEpoch)
    || (leaseIdentity.successorLineage !== null
      && subject.historicalLeaseEpoch !== leaseIdentity.cloudAuthority.leaseEpoch - 1)) {
    invalid("generic historical attribution epoch");
  }
  if (subject.sourceCommitSubjects.at(-1) !== subject.expectedSquashHeadline) {
    invalid("generic source commit subject terminal");
  }
}
function normalizeGenericPredecessorAuthority(value, { subject, leaseIdentity }) {
  const lineage = leaseIdentity.successorLineage;
  if (lineage === null) {
    if (value !== null) invalid("generic predecessor authority absence");
    return;
  }
  object(value, "generic predecessor authority");
  if (!exactObjectKeys(value, [
    "currentClaimId", "predecessorClaimId", "canonicalBaseSha", "laneRevision",
    "leaseEpoch",
  ])) invalid("generic predecessor authority keys");
  const successor = lineage.activePublishTaskAuthoritySuccessor;
  if (value.currentClaimId !== leaseIdentity.cloudAuthority.claimId
    || value.predecessorClaimId !== successor.sourceClaimId
    || value.canonicalBaseSha !== successor.sourceBaseSha
    || value.laneRevision !== successor.sourceFenceSha
    || value.leaseEpoch !== subject.historicalLeaseEpoch) {
    invalid("generic predecessor authority join");
  }
  digest(value.currentClaimId, "generic current claim");
  digest(value.predecessorClaimId, "generic predecessor claim");
  sha(value.canonicalBaseSha, "generic predecessor base");
  sha(value.laneRevision, "generic predecessor lane");
  if (!Number.isSafeInteger(value.leaseEpoch) || value.leaseEpoch < 1) {
    invalid("generic predecessor epoch");
  }
}
function normalizeGenericProtectedRefresh(value, { subject, leaseIdentity }) {
  const integration = leaseIdentity.integration;
  if (value === null) {
    return leaseIdentity.successorLineage === null
      && integration.commitSha === subject.reviewedHeadSha
      && integration.treeSha === subject.reviewedTreeSha;
  }
  if (leaseIdentity.successorLineage === null) {
    invalid("generic protected refresh successor lineage");
  }
  object(value, "generic protected refresh");
  if (canonicalJson(Object.keys(value)) !== canonicalJson([
    "authoredCommit", "authoredParentSha", "reviewedParentShas", "changedEntries",
  ])) invalid("generic protected refresh keys");
  normalizeMessageEvidence(value.authoredCommit, "generic authored commit", true);
  sha(value.authoredParentSha, "generic authored parent");
  if (value.authoredCommit.sha !== integration.commitSha
    || value.authoredCommit.treeSha !== integration.treeSha
    || value.authoredCommit.messageDigest !== subject.reviewedCommit.messageDigest
    || value.authoredCommit.objectMessageByteLength
      !== subject.reviewedCommit.objectMessageByteLength
    || value.authoredCommit.objectMessageSha256 !== subject.reviewedCommit.objectMessageSha256
    || canonicalJson(value.reviewedParentShas)
      !== canonicalJson([integration.commitSha, leaseIdentity.baseSha])) {
    invalid("generic protected refresh topology");
  }
  if (value.authoredParentSha !== leaseIdentity.successorLineage
    .activePublishTaskAuthoritySuccessor.sourceFenceSha) {
    invalid("generic protected refresh successor join");
  }
  normalizeChangedEntries(value.changedEntries, "generic authored changed entries");
  if (canonicalJson(value.changedEntries) !== canonicalJson(subject.changedEntries)) {
    invalid("generic protected refresh patch");
  }
  return true;
}
function normalizeGenericSuccessorLineage(value, leaseIdentity) {
  if (value === null) return;
  object(value, "generic successor lineage");
  if (canonicalJson(Object.keys(value)) !== canonicalJson([
    "activeOwnedDirtRecovery", "activeOwnedDirtCurrentBaseReanchor",
    "activePublishTaskAuthoritySuccessor", "activePublishSuccessorIntent",
  ]) || value.activePublishSuccessorIntent !== null) invalid("generic successor lineage keys");
  const recovery = object(value.activeOwnedDirtRecovery, "generic owned-dirt recovery");
  const reanchor = object(value.activeOwnedDirtCurrentBaseReanchor,
    "generic current-base reanchor");
  const successor = object(value.activePublishTaskAuthoritySuccessor,
    "generic task-authority successor");
  let normalizedRecovery;
  try {
    normalizedRecovery = normalizeActiveOwnedDirtLeaseRecovery(recovery);
  } catch {
    invalid("generic owned-dirt recovery normalization");
  }
  if (canonicalJson(normalizedRecovery) !== canonicalJson(recovery)) {
    invalid("generic owned-dirt recovery normalization");
  }
  if (!exactObjectKeys(recovery, [
    "evidenceDigest", "planDigest", "recoveredAt", "recoveredClaimDigest",
    "recoveredClaimLedgerRevision", "recoveredLedgerRevision",
    "recoveredTransitionCounter", "schema", "snapshotCommitSha",
    "snapshotIndexCommitSha", "snapshotReceiptDigest", "snapshotRef",
    "sourceBranch", "sourceClaimId", "sourceDevice", "sourceEpoch",
    "sourceFenceSha", "sourceSessionId", "status",
  ]) || !exactObjectKeys(reanchor, [
    "planDigest", "schema", "sourceBaseSha", "sourceClaimId", "sourceFenceSha",
    "status", "successorClaimId", "targetCanonicalBaseSha",
    "targetDirtEvidenceDigest", "targetLaneRevision", "taskContinuationReceiptDigest",
  ]) || !exactObjectKeys(successor, [
    "boundAt", "branch", "cloudOperationReceiptDigest",
    "cloudVerificationReceiptDigest", "epoch", "receiptDigest", "schema",
    "sourceBaseSha", "sourceBindingDigest", "sourceClaimId", "sourceFenceSha",
    "targetBaseSha", "targetBindingDigest", "targetClaimId", "targetFenceSha",
  ]) || recovery.schema !== "agentic-active-owned-dirt-recovery-lease/v1"
    || recovery.status !== "recovered"
    || recovery.sourceSessionId !== leaseIdentity.sessionId
    || recovery.sourceDevice !== leaseIdentity.device
    || recovery.sourceBranch !== leaseIdentity.branch
    || !Number.isSafeInteger(recovery.sourceEpoch) || recovery.sourceEpoch < 1
    || recovery.sourceEpoch >= leaseIdentity.epoch
    || reanchor.schema !== "agentic-active-owned-dirt-current-base-reanchor-lease/v1"
    || reanchor.status !== "reanchored"
    || successor.schema !== "agentic-active-publish-task-authority-successor-receipt/v1"
    || successor.branch !== leaseIdentity.branch || successor.epoch !== leaseIdentity.epoch
    || recovery.sourceClaimId !== reanchor.sourceClaimId
    || recovery.sourceFenceSha !== reanchor.sourceFenceSha
    || reanchor.successorClaimId !== successor.sourceClaimId
    || reanchor.targetCanonicalBaseSha !== successor.sourceBaseSha
    || reanchor.targetLaneRevision !== successor.sourceFenceSha
    || successor.targetBaseSha !== leaseIdentity.baseSha
    || successor.targetFenceSha !== leaseIdentity.fenceSha
    || successor.targetFenceSha !== leaseIdentity.deliveryHeadSha
    || successor.targetClaimId !== leaseIdentity.cloudAuthority.claimId
    || successor.sourceBindingDigest !== leaseIdentity.taskAuthority.priorBindingDigest
    || successor.targetBindingDigest !== leaseIdentity.taskAuthority.bindingDigest) {
    invalid("generic successor lineage join");
  }
  instant(recovery.recoveredAt, "generic recovery time");
  instant(successor.boundAt, "generic successor time");
  if (!Number.isSafeInteger(recovery.recoveredTransitionCounter)
    || recovery.recoveredTransitionCounter < 1) invalid("generic recovery transition");
  for (const name of ["sourceClaimId", "planDigest", "evidenceDigest",
    "snapshotReceiptDigest", "recoveredClaimDigest", "recoveredClaimLedgerRevision"]) {
    digest(recovery[name], `generic recovery ${name}`);
  }
  for (const name of ["planDigest", "sourceClaimId", "successorClaimId",
    "targetDirtEvidenceDigest", "taskContinuationReceiptDigest"]) {
    digest(reanchor[name], `generic reanchor ${name}`);
  }
  for (const name of ["sourceClaimId", "targetClaimId", "sourceBindingDigest",
    "targetBindingDigest", "cloudOperationReceiptDigest",
    "cloudVerificationReceiptDigest", "receiptDigest"]) {
    digest(successor[name], `generic successor ${name}`);
  }
  for (const name of ["sourceFenceSha", "snapshotCommitSha", "snapshotIndexCommitSha",
    "recoveredLedgerRevision"]) sha(recovery[name], `generic recovery ${name}`);
  for (const name of ["sourceBaseSha", "sourceFenceSha", "targetBaseSha",
    "targetFenceSha"]) sha(successor[name], `generic successor ${name}`);
  for (const name of ["sourceBaseSha", "sourceFenceSha", "targetCanonicalBaseSha",
    "targetLaneRevision"]) sha(reanchor[name], `generic reanchor ${name}`);
  required(recovery.snapshotRef, "generic recovery snapshot ref");
  if (successor.receiptDigest !== digestValue(Object.fromEntries(
    Object.entries(successor).filter(([name]) => name !== "receiptDigest"),
  ))) invalid("generic successor receipt seal");
}
function exactObjectKeys(value, expected) {
  return canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort());
}
function normalizeGenericRecoveryChangeSet(recovery, subject) {
  if (recovery.genericRecoveryVariant === "evidence-document") {
    const expectedPath = `docs/CANONICAL-SQUASH-PR${subject.pullRequest.number}-ATTRIBUTION-RECOVERY.md`;
    if (canonicalJson(recovery.changedPaths) !== canonicalJson([expectedPath])
      || recovery.changedEntries.length !== 1
      || recovery.changedEntries[0].path !== expectedPath
      || recovery.changedEntries[0].status !== "A"
      || recovery.changedEntries[0].oldMode !== "000000"
      || recovery.changedEntries[0].newMode !== "100644"
      || recovery.changedEntries[0].oldBlob !== "0".repeat(40)
      || recovery.changedEntries[0].newBlob !== recovery.evidenceBlobSha
      || recovery.evidencePath !== expectedPath) {
      invalid("generic evidence-document recovery paths");
    }
  } else {
    normalizeExactModifiedPaths({
      paths: recovery.changedPaths,
      entries: recovery.changedEntries,
      expectedPaths: GENERIC_SELF_HOSTED_RECOVERY_PATHS,
      label: "generic recovery changed paths",
    });
    const evidenceIndex = recovery.changedPaths.indexOf(
      GENERIC_SELF_HOSTED_RECOVERY_EVIDENCE_PATH,
    );
    if (recovery.evidencePath !== GENERIC_SELF_HOSTED_RECOVERY_EVIDENCE_PATH
      || evidenceIndex < 0
      || recovery.changedEntries[evidenceIndex].newBlob !== recovery.evidenceBlobSha) {
      invalid("generic self-hosted recovery evidence relation");
    }
  }
  if (recovery.sourceTreeSha !== recovery.treeSha) {
    invalid("generic recovery evidence relation");
  }
}
function normalizeExactModifiedPaths({
  paths, entries, expectedPaths = null, allowAdditions = false, label,
}) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 128
    || entries.length !== paths.length
    || new Set(paths).size !== paths.length
    || (expectedPaths && canonicalJson(paths) !== canonicalJson(expectedPaths))) {
    invalid(label);
  }
  for (const [index, repositoryPath] of paths.entries()) {
    canonicalRepositoryPath(repositoryPath, label);
    const entry = entries[index];
    const regularAddition = allowAdditions && entry.status === "A"
      && entry.oldMode === "000000" && entry.newMode === "100644"
      && entry.oldBlob === "0".repeat(40) && entry.newBlob !== "0".repeat(40);
    const regularModification = entry.status === "M" && entry.oldMode === "100644"
      && entry.newMode === "100644" && entry.oldBlob !== entry.newBlob;
    if (entry.path !== repositoryPath || (!regularAddition && !regularModification)) {
      invalid(label);
    }
  }
}
function normalizeSourceCommitAuthors(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) {
    invalid("generic source commit authors");
  }
  const identities = [];
  for (const author of value) {
    object(author, "generic source commit author");
    if (canonicalJson(Object.keys(author)) !== canonicalJson(["name", "email"])) {
      invalid("generic source commit author keys");
    }
    const name = required(author.name, "generic source commit author name");
    const email = required(author.email, "generic source commit author email");
    if (/[<>\r\n]/u.test(name) || /[<>\r\n]/u.test(email)) {
      invalid("generic source commit author identity");
    }
    identities.push(`${name}\0${email}`);
  }
  if (new Set(identities).size !== identities.length) {
    invalid("generic source commit author uniqueness");
  }
}
function pathScopes(value, label) {
  if (!Array.isArray(value)) invalid(label);
  return value.filter(scope => String(scope).startsWith("path:"));
}
function canonicalRepositoryPath(value, label) {
  required(value, label);
  if (value.startsWith("/") || value.startsWith("../") || value.includes("/../")
    || value.includes("\\") || value.includes("//") || /[\0\r\n]/u.test(value)) {
    invalid(label);
  }
}
function normalizeRunPair(value, {
  label, sourceSha, sourceBranch, mergeSha, profile,
}) {
  if (!Array.isArray(value) || value.length !== 2) invalid(label);
  normalizeRun(value[0], `${label} reviewed`, "pull_request", sourceBranch, sourceSha,
    profile);
  normalizeRun(value[1], `${label} protected`, "push", "main", mergeSha, profile);
}
function normalizeRun(value, label, event, branch, revision, profile) {
  object(value, label);
  const exactWorkflow = profile === LEGACY_INTEGRATION_RUN_PROFILE
    ? value.workflowName === "Integration" && !Object.hasOwn(value, "workflowPath")
    : profile === SELF_HOSTED_CI_RUN_PROFILE
      ? value.workflowName === "CI"
        && value.workflowPath === ".github/workflows/ci.yml"
      : false;
  if (!Number.isSafeInteger(value.databaseId) || value.databaseId < 1
    || !Number.isSafeInteger(value.jobDatabaseId) || value.jobDatabaseId < 1
    || value.event !== event || value.headBranch !== branch || value.headSha !== revision
    || !exactWorkflow || value.conclusion !== "success") invalid(label);
}
function normalizeCloudAuthority(subject) {
  const authority = object(subject.cloudAuthority, "subject cloud authority");
  const delivery = object(subject.deliveryEvidence, "subject delivery evidence");
  if (authority.state !== "delivery_authorized"
    || authority.claimId !== subject.claimId || authority.claimDigest !== subject.claimDigest
    || authority.laneRevision !== subject.reviewedHeadSha
    || authority.sessionId !== subject.sessionId
    || authority.deviceId !== subject.leaseIdentity.device
    || authority.reviewRequestId !== `github-pull-request:${subject.pullRequest.nodeId}`
    || authority.integrationReceiptDigest !== subject.integrationReceiptDigest
    || authority.integration?.candidateRevision !== subject.reviewedHeadSha) {
    invalid("subject cloud authority join");
  }
  for (const name of ["dependencyClosureDigest", "namedChecksDigest",
    "handoffEvidenceDigest", "operatorDecisionDigest", "integrationIntentDigest"]) {
    digest(delivery[name], `delivery ${name}`);
    if (delivery[name] !== authority.integration[name]) invalid(`delivery ${name} join`);
  }
}
function normalizeRecoveryTerminal(value, recovery) {
  object(value, "recovery terminal projection");
  if (value.status !== "completed-and-cleaned" || value.branch !== recovery.pullRequest.headBranch
    || value.completion?.mergeCommitSha !== recovery.mergeSha
    || !SHA.test(String(value.completion?.mainSha || ""))
    || value.cleanupReceiptDigest !== recovery.cleanupReceiptDigest
    || value.worktree !== "absent" || value.branchRef !== "preserved") {
    invalid("recovery terminal projection join");
  }
  if (value.remoteBranch !== "absent-or-preserved-exact") {
    invalid("recovery terminal remote branch");
  }
  for (const name of ["completedLeaseDigest", "taskAuthorityBindingDigest", "claimId",
    "claimDigest", "cleanupReceiptDigest"]) digest(value[name], `recovery terminal ${name}`);
  const cloud = object(value.terminalCloud, "recovery terminal cloud");
  if (cloud.claimId !== value.claimId
    || cloud.reviewRequestId !== `github-pull-request:${recovery.pullRequest.nodeId}`
    || cloud.laneRevision !== recovery.sourceHeadSha
    || cloud.canonicalBaseRevision !== recovery.parentSha
    || !Number.isSafeInteger(cloud.leaseEpoch) || cloud.leaseEpoch < 1
    || !Number.isSafeInteger(cloud.transitionCounter)
    || cloud.transitionCounter < 1 || !Number.isSafeInteger(cloud.sequence)
    || cloud.sequence < 1) invalid("recovery terminal cloud join");
  for (const name of ["integrationEntryDigest", "retirementEntryDigest",
    "terminalClaimDigest", "integrationReceiptDigest", "writeSetDigest",
    "declaredWriteScopeDigest", "focusedEvidenceDigest", "immutableSubjectDigest",
    "integrationEvidenceDigest", "retirementEvidenceDigest", "historicalAuthorityDigest"]) {
    digest(cloud[name], `recovery terminal cloud ${name}`);
  }
  for (const name of ["repositoryId", "deviceId", "sessionId", "workItemId"]) {
    required(cloud[name], `recovery terminal cloud ${name}`);
  }
  const task = object(value.taskCompletion, "recovery task completion");
  if (task.status !== "completed-lease-bound"
    || task.bindingDigest !== value.taskAuthorityBindingDigest
    || task.completedLeaseDigest !== value.completedLeaseDigest
    || !Number.isSafeInteger(task.generation) || task.generation < 1) {
    invalid("recovery task completion join");
  }
  required(task.authoritySubjectId, "recovery task authority subject");
  required(task.proofAdapterId, "recovery task proof adapter");
  for (const name of ["bindingDigest", "laneBindingDigest", "publicKeyDigest",
    "completedLeaseDigest", "evidenceDigest"]) {
    digest(task[name], `recovery task completion ${name}`);
  }
  const { evidenceDigest, ...taskCore } = task;
  if (evidenceDigest !== digestValue(taskCore)) invalid("recovery task completion seal");
  required(value.sessionId, "recovery terminal session");
  required(value.scope, "recovery terminal scope");
}

function normalizePull(value, label) {
  object(value, label);
  if (!Number.isSafeInteger(value.number) || value.number < 1) invalid(`${label} number`);
  required(value.nodeId, `${label} node ID`);
  required(value.url, `${label} URL`);
  required(value.headBranch, `${label} head branch`);
  sha(value.headSha, `${label} head SHA`);
  required(value.baseBranch, `${label} base branch`);
  sha(value.baseSha, `${label} base SHA`);
  sha(value.mergeSha, `${label} merge SHA`);
  required(value.mergedAt, `${label} merged time`);
  required(value.mergedBy, `${label} merged actor`);
  digest(value.autoMergeDigest, `${label} auto-merge digest`);
  if (value.autoMergeRequest === null) {
    if (value.autoMergeDigest !== digestValue(null)) invalid(`${label} auto-merge join`);
  } else {
    const request = object(value.autoMergeRequest, `${label} auto-merge request`);
    required(request.mergeMethod, `${label} auto-merge method`);
    required(request.commitHeadline, `${label} auto-merge headline`);
    if (request.commitBody !== null) required(request.commitBody, `${label} auto-merge body`);
    instant(request.enabledAt, `${label} auto-merge time`);
    object(request.enabledBy, `${label} auto-merge actor`);
    required(request.enabledBy.id, `${label} auto-merge actor ID`);
    required(request.enabledBy.login, `${label} auto-merge actor login`);
    if (typeof request.enabledBy.isBot !== "boolean") invalid(`${label} auto-merge actor type`);
    if (value.autoMergeDigest !== digestValue(value.autoMergeRequest)) {
      invalid(`${label} auto-merge join`);
    }
  }
}

function normalizeState(value, plan) {
  object(value, "journal state");
  if (!PHASES.includes(value.phase)) invalid("journal phase");
  object(value.receipts, "journal receipts");
  const index = PHASES.indexOf(value.phase);
  const keys = Object.keys(value.receipts);
  const expected = PHASES.slice(0, index + 1);
  if (canonicalJson(keys) !== canonicalJson(expected)) invalid("journal receipt order");
  const receipts = {};
  for (const phase of expected) {
    const receipt = value.receipts[phase];
    const { receiptDigest, ...core } = receipt || {};
    if (core.phase !== phase || receiptDigest !== digestValue(core)) invalid(`${phase} receipt seal`);
    validatePhase(core);
    if (phase !== "authorized" && core.operationKey !== operationKey(plan, phase)) {
      invalid(`${phase} operation key`);
    }
    if (phase === "cloud-retirement-intent" && core.priorJournalDigest
      !== journalDigestForPrefix(plan, receipts, "evidence-verified")) {
      invalid("cloud retirement prior journal");
    }
    if (phase === "completion-intent" && core.priorJournalDigest
      !== journalDigestForPrefix(plan, receipts, "cloud-retired")) {
      invalid("completion prior journal");
    }
    validatePhaseAgainstPlan(core, plan, receipts);
    receipts[phase] = freeze(structuredClone(receipt));
  }
  if (value.phase === "complete") {
    const prefix = journalForPrefix(plan, receipts, "verified");
    const expectedReceipt = buildReceipt(prefix);
    if (normalizeReceipt(receipts.complete.receipt).receiptDigest
      !== expectedReceipt.receiptDigest) invalid("complete receipt join");
  }
  return freeze({ phase: value.phase, receipts: freeze(receipts) });
}

function validatePhase(value) {
  if (value.phase === "authorized") digest(value.authorizationDigest, "authorization digest");
  if (value.phase === "evidence-verified") {
    digest(value.operationKey, "evidence operation key");
    digest(value.evidenceVerificationDigest, "evidence verification digest");
  }
  if (["cloud-retirement-intent", "completion-intent"].includes(value.phase)) {
    digest(value.operationKey, `${value.phase} operation key`);
    digest(value.priorJournalDigest, `${value.phase} prior journal`);
    digest(value.taskAuthorityBindingDigest, `${value.phase} task binding`);
    required(value.taskAuthorizationOperation, `${value.phase} task operation`);
  }
  if (value.phase === "cloud-retired") {
    if (value.disposition !== "retired-or-adopted") invalid("cloud disposition");
    digest(value.operationKey, "cloud operation key");
    digest(value.cloudRetirementReceiptDigest, "cloud retirement receipt");
    digest(value.taskAuthorizationReceiptDigest, "cloud task authorization");
    normalizeTaskAuthorizationReceipt(
      value.taskAuthorizationReceipt,
      value.taskAuthorizationReceiptDigest,
      "cloud task authorization",
    );
    object(value.cloudRetirementReceipt, "cloud retirement receipt");
    if (digestValue(value.cloudRetirementReceipt)
      !== value.cloudRetirementReceiptDigest) invalid("cloud retirement receipt join");
    object(value.terminalCloud, "cloud terminal state");
    digest(value.terminalCloudDigest, "cloud terminal state digest");
    if (digestValue(value.terminalCloud) !== value.terminalCloudDigest) {
      invalid("cloud terminal state join");
    }
  }
  if (value.phase === "completion-projected") {
    if (!["projected", "adopted"].includes(value.disposition)) {
      invalid("completion disposition");
    }
    digest(value.operationKey, "completion operation key");
    sha(value.mainSha, "completion main SHA");
    sha(value.completionBaseSha, "completion base SHA");
    digest(value.completionTopologyDigest, "completion topology digest");
    digest(value.completingLeaseDigest, "completing lease digest");
    digest(value.taskAuthorizationReceiptDigest, "completion task authorization");
    normalizeTaskAuthorizationReceipt(
      value.taskAuthorizationReceipt,
      value.taskAuthorizationReceiptDigest,
      "completion task authorization",
    );
    object(value.completionSummary, "completion summary");
    if (value.completionSummary.status !== "runtime_pending"
      || value.completionSummary.mainSha !== value.mainSha) invalid("completion summary join");
  }
  if (value.phase === "verified") {
    digest(value.operationKey, "verification operation key");
    digest(value.terminalEvidenceDigest, "terminal evidence digest");
    object(value.terminalEvidence, "terminal evidence");
    if (digestValue(value.terminalEvidence) !== value.terminalEvidenceDigest) {
      invalid("terminal evidence join");
    }
  }
  if (value.phase === "complete") {
    digest(value.operationKey, "completion operation key");
    normalizeReceipt(value.receipt);
  }
}

function sealJournal(core) {
  return normalizeJournalSeed({ ...core, journalDigest: digestValue(core) });
}
function normalizeJournalSeed(value) {
  const plan = normalizePlan(value.plan);
  const state = value.state === null ? null : normalizeState(value.state, plan);
  const core = { schema: JOURNAL_SCHEMA, operation: OPERATION, plan, state };
  if (value.journalDigest !== digestValue(core)) invalid("journal seal");
  return freeze({ ...core, journalDigest: value.journalDigest });
}
function normalizeTaskAuthorizationReceipt(value, expectedDigest, label) {
  object(value, label);
  if (value.schema !== "agentic-task-authority-verification-receipt/v1"
    || value.status !== "verified" || value.receiptDigest !== expectedDigest
    || !Number.isSafeInteger(value.generation) || value.generation < 1) invalid(label);
  required(value.authoritySubjectId, `${label} authority subject`);
  required(value.proofAdapterId, `${label} proof adapter`);
  required(value.operation, `${label} operation`);
  for (const name of ["bindingDigest", "proofDigest", "receiptDigest"]) {
    digest(value[name], `${label} ${name}`);
  }
  const expected = digestValue({
    authoritySubjectId: value.authoritySubjectId,
    bindingDigest: value.bindingDigest,
    proofDigest: value.proofDigest,
    operation: value.operation,
    verifiedAt: value.verifiedAt,
  });
  if (value.receiptDigest !== expected) invalid(`${label} seal`);
  instant(value.verifiedAt, `${label} verification time`);
  return value;
}
function validatePhaseAgainstPlan(value, plan, priorReceipts) {
  const subject = plan.evidence.subject;
  const cloudOperation = `canonical-squash-attribution-recovery:cloud:${plan.planDigest}:${operationKey(plan, "cloud-retired")}`;
  const completionOperation = `canonical-squash-attribution-recovery:completion:${plan.planDigest}:${operationKey(plan, "completion-projected")}`;
  if (value.phase === "cloud-retirement-intent") {
    if (value.taskAuthorityBindingDigest !== subject.taskAuthorityBindingDigest
      || value.taskAuthorizationOperation !== cloudOperation) invalid("cloud intent task join");
  }
  if (value.phase === "cloud-retired") {
    const intent = priorReceipts["cloud-retirement-intent"];
    if (value.taskAuthorizationReceipt.bindingDigest !== subject.taskAuthorityBindingDigest
      || value.taskAuthorizationReceipt.authoritySubjectId
        !== subject.taskAuthority.authoritySubjectId
      || value.taskAuthorizationReceipt.proofAdapterId
        !== subject.taskAuthority.proofAdapterId
      || value.taskAuthorizationReceipt.generation
        !== subject.taskAuthority.generation
      || value.taskAuthorizationReceipt.operation !== cloudOperation
      || intent?.taskAuthorizationOperation !== cloudOperation
      || intent?.taskAuthorityBindingDigest !== subject.taskAuthorityBindingDigest) {
      invalid("cloud task authorization plan join");
    }
    const receipt = value.cloudRetirementReceipt;
    if (receipt.schema !== "agentic-post-merge-cloud-authority-verification/v1"
      || receipt.status !== "integrated-retired" || receipt.claimId !== subject.claimId
      || receipt.pullRequestNumber !== subject.pullRequest.number
      || receipt.pullRequestNodeId !== subject.pullRequest.nodeId
      || receipt.headSha !== subject.reviewedHeadSha
      || receipt.mergeCommitSha !== subject.malformedCommit.sha
      || receipt.integrationReceiptDigest !== subject.integrationReceiptDigest) {
      invalid("cloud retirement receipt plan join");
    }
    normalizeTerminalCloud(value.terminalCloud, subject, "subject terminal cloud");
  }
  if (value.phase === "completion-intent") {
    if (value.taskAuthorityBindingDigest !== subject.taskAuthorityBindingDigest
      || value.taskAuthorizationOperation !== completionOperation) {
      invalid("completion intent task join");
    }
  }
  if (value.phase === "completion-projected") {
    const intent = priorReceipts["completion-intent"];
    if (value.taskAuthorizationReceipt.bindingDigest !== subject.taskAuthorityBindingDigest
      || value.taskAuthorizationReceipt.authoritySubjectId
        !== subject.taskAuthority.authoritySubjectId
      || value.taskAuthorizationReceipt.proofAdapterId
        !== subject.taskAuthority.proofAdapterId
      || value.taskAuthorizationReceipt.generation
        !== subject.taskAuthority.generation
      || value.taskAuthorizationReceipt.operation !== completionOperation
      || intent?.taskAuthorizationOperation !== completionOperation
      || intent?.taskAuthorityBindingDigest !== subject.taskAuthorityBindingDigest) {
      invalid("completion task authorization plan join");
    }
    const expectedSummary = {
      completedBranch: subject.branch,
      pullRequestUrl: subject.pullRequest.url,
      mergeCommitSha: subject.malformedCommit.sha,
      mainSha: value.mainSha,
      status: "runtime_pending",
    };
    if (canonicalJson(value.completionSummary) !== canonicalJson(expectedSummary)
      || value.mainSha !== expectedSummary.mainSha
      || value.completionBaseSha !== plan.evidence.canonical.protectedMainSha
      || value.completionTopologyDigest !== digestValue({
        baseSha: value.completionBaseSha,
        targetSha: value.mainSha,
        relation: "protected-descendant",
      })) invalid("completion summary plan join");
  }
  if (value.phase === "verified") {
    normalizeTerminalEvidence(value.terminalEvidence, plan, priorReceipts);
  }
}
function normalizeTerminalCloud(value, subject, label) {
  object(value, label);
  const expectedKeys = [
    "claimId", "integrationEntryDigest", "retirementEntryDigest",
    "terminalClaimDigest", "integrationReceiptDigest", "repositoryId",
    "canonicalBaseRevision", "declaredWriteScopeDigest", "deviceId", "sessionId",
    "workItemId", "focusedEvidenceDigest", "historicalAuthorityDigest",
    "reviewRequestId", "laneRevision", "writeSetDigest", "leaseEpoch",
    "immutableSubjectDigest", "integrationEvidenceDigest", "retirementEvidenceDigest",
    "transitionCounter", "sequence",
  ];
  if (canonicalJson(Object.keys(value)) !== canonicalJson(expectedKeys)
    || value.claimId !== subject.claimId
    || value.integrationReceiptDigest !== subject.integrationReceiptDigest
    || value.reviewRequestId !== `github-pull-request:${subject.pullRequest.nodeId}`
    || value.laneRevision !== subject.reviewedHeadSha
    || value.writeSetDigest !== subject.cloudAuthority.writeSetDigest
    || value.leaseEpoch !== subject.cloudAuthority.leaseEpoch
    || value.canonicalBaseRevision !== subject.cloudAuthority.canonicalBaseSha) {
    invalid(label);
  }
  for (const name of ["integrationEntryDigest", "retirementEntryDigest",
    "terminalClaimDigest", "integrationReceiptDigest", "declaredWriteScopeDigest",
    "focusedEvidenceDigest", "historicalAuthorityDigest", "immutableSubjectDigest",
    "integrationEvidenceDigest", "retirementEvidenceDigest"]) {
    digest(value[name], `${label} ${name}`);
  }
  for (const name of ["repositoryId", "deviceId", "sessionId", "workItemId"]) {
    required(value[name], `${label} ${name}`);
  }
  if (!Number.isSafeInteger(value.transitionCounter) || value.transitionCounter < 1
    || !Number.isSafeInteger(value.sequence) || value.sequence < 1) invalid(label);
}
function normalizeTerminalEvidence(value, plan, priorReceipts) {
  object(value, "terminal evidence");
  const subject = plan.evidence.subject;
  const projected = priorReceipts["completion-projected"];
  const cloud = priorReceipts["cloud-retired"];
  if (value.schema !== "agentic-canonical-squash-attribution-recovery-terminal-evidence/v1"
    || value.status !== "completion-ready" || value.planDigest !== plan.planDigest
    || value.evidenceDigest !== plan.evidence.evidenceDigest
    || value.subject?.branch !== subject.branch
    || value.subject?.reviewedHeadSha !== subject.reviewedHeadSha
    || value.subject?.reviewedTreeSha !== subject.reviewedTreeSha
    || value.subject?.authoredBranchSha !== subject.reviewedHeadSha
    || value.subject?.authoredTreeSha !== subject.reviewedTreeSha
    || value.subject?.mergeSha !== subject.malformedCommit.sha
    || value.cloud?.status !== "retired" || value.cloud?.claimId !== subject.claimId
    || value.cloud?.terminalStateDigest !== cloud?.terminalCloudDigest
    || value.completion?.status !== "completion-ready-or-completed"
    || value.completion?.mainSha !== projected?.mainSha
    || value.completion?.completingLeaseDigest !== projected?.completingLeaseDigest
    || value.recovery?.status !== "completed-and-cleaned"
    || value.recovery?.mergeSha !== plan.evidence.recovery.mergeSha
    || value.recovery?.terminalStateDigest
      !== digestValue(plan.evidence.recovery.terminal)
    || value.continuation !== "device:integrate") invalid("terminal evidence plan join");
  digest(value.subject.pullRequestIdentityDigest, "terminal subject pull identity");
  if (value.subject.pullRequestIdentityDigest !== digestValue({
    number: subject.pullRequest.number,
    nodeId: subject.pullRequest.nodeId,
    url: subject.pullRequest.url,
    headBranch: subject.pullRequest.headBranch,
    headSha: subject.pullRequest.headSha,
    baseBranch: subject.pullRequest.baseBranch,
    baseSha: subject.pullRequest.baseSha,
    mergeSha: subject.pullRequest.mergeSha,
    mergedAt: subject.pullRequest.mergedAt,
    mergedBy: subject.pullRequest.mergedBy,
    autoMergeDigest: subject.pullRequest.autoMergeDigest,
  })) invalid("terminal subject pull identity join");
  const expectedEffects = {
    cloudClaim: "retired",
    localLease: "completion-ready",
    worktreeProjection: "detached-canonical-or-terminally-cleaned",
    authoredSourceBytes: "unchanged",
    authoredTree: "unchanged",
    authoredBranchRef: "unchanged",
    pullRequest: "unchanged",
    autoMerge: "unchanged",
    newClaims: "none",
    runtime: "not-performed",
    cleanup: "not-performed-by-this-controller",
    release: "not-performed",
    deployment: "not-performed",
  };
  if (canonicalJson(value.effects) !== canonicalJson(expectedEffects)) {
    invalid("terminal effect evidence");
  }
}
function journalDigestForPrefix(plan, receipts, phase) {
  return journalForPrefix(plan, receipts, phase).journalDigest;
}
function journalForPrefix(plan, receipts, phase) {
  const index = PHASES.indexOf(phase);
  const prefix = {};
  for (const name of PHASES.slice(0, index + 1)) prefix[name] = receipts[name];
  const core = {
    schema: JOURNAL_SCHEMA,
    operation: OPERATION,
    plan,
    state: { phase, receipts: prefix },
  };
  return freeze({ ...core, journalDigest: digestValue(core) });
}
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); return value; }
function required(value, label) { if (typeof value !== "string" || !value.trim()) invalid(label); return value; }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) invalid(label); return value; }
function sha(value, label) { if (!SHA.test(String(value || ""))) invalid(label); return value; }
function repository(value, label) { if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(String(value || ""))) invalid(label); return value; }
function instant(value, label) { if (!Number.isFinite(Date.parse(String(value || "")))) invalid(label); return value; }
function invalid(label) { throw new Error(`Canonical squash attribution recovery ${label} is invalid.`); }
function freeze(value) { return Object.freeze(value); }
