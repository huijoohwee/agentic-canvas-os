// Responsibility: Seal one prepared descendant whose bytes are already canonically superseded.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
export const PLAN_SCHEMA = "agentic-admitted-prepared-descendant-canonical-supersession-retirement-plan/v1";
export const STATE_SCHEMA = "agentic-admitted-prepared-descendant-canonical-supersession-retirement-state/v1";
export const RECEIPT_SCHEMA = "agentic-admitted-prepared-descendant-canonical-supersession-retirement-receipt/v1";
export const PHASES = Object.freeze([
  "planned", "authorized", "source-authority-verified", "claim-retired",
  "pull-request-closed", "owner-released", "complete",
]);
const NORMAL_EFFECTS = Object.freeze([
  "retire-cloud-claim", "close-pull-request", "release-local-lease",
]);
const PARTIAL_EFFECTS = Object.freeze(["release-local-lease"]);
const PRESERVATION = Object.freeze({ subjectWorktree: "preserved", subjectBranch: "preserved",
  subjectRef: "preserved", subjectTree: "preserved", remoteBranch: "preserved",
  preparedIntegration: "preserved", canonicalSuccessor: "preserved", deployment: "not-performed" });
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

export function buildRetirementEvidence({ subject, canonical, successor }) {
  const source = normalizeSubject(subject);
  const protectedSuccessor = normalizeCanonical(canonical);
  const next = normalizeSuccessor(successor);
  return freeze({
    bytesDigest: digestValue({
      integration: source.integration,
      subjectStateDigest: source.stateDigest,
      canonicalStateDigest: protectedSuccessor.stateDigest,
    }),
    namedChecksDigest: digestValue({
      canonicalStateDigest: protectedSuccessor.stateDigest,
      successorStateDigest: next.stateDigest,
      checks: [
        "prepared-integration-receipt",
        "canonical-byte-equivalence",
        "structured-field-supersession",
        "dependency-protected-ancestry",
      ],
    }),
    handoffEvidenceDigest: digestValue({
      sourceAuthority: source.sourceAuthority,
      successorCapabilityDigest: next.capabilityDigest,
      successorManifestDigest: next.manifestDigest,
      successorWriteSetDigest: next.writeSetDigest,
    }),
  });
}
export function buildPlan(input) {
  const observedAt = instant(input.observedAt, "observation instant");
  const mode = retirementMode(input.mode);
  const subject = normalizeSubject(input.subject);
  const recovery = input.recovery === null ? null : normalizeRecovery(input.recovery);
  const canonical = normalizeCanonical(input.canonical);
  const successor = normalizeSuccessor(input.successor);
  const controller = normalizeController(input.controller);
  const cloud = normalizeCloud(input.cloud);
  const retirementEvidence = buildRetirementEvidence({ subject, canonical, successor });
  if (subject.claim?.state === "dormant-preserved"
    && Date.parse(subject.claim.expiresAt) > Date.parse(observedAt)) {
    throw new Error("Dormant-preserved source claim is not expiry-derived.");
  }
  if (subject.pullRequest.closeEvent
    && (Date.parse(subject.pullRequest.closeEvent.createdAt) < Date.parse(subject.pullRequest.closedAt)
      || Date.parse(subject.pullRequest.closeEvent.createdAt) > Date.parse(observedAt))) {
    throw new Error("Preclosed pull-request event is not temporally joined to the observation.");
  }
  const normal = mode === "normal" && recovery === null && subject.claim
    && subject.pullRequest.state === "OPEN" && subject.pullRequest.closeEvent === null;
  const partial = mode === "partial-recovery" && subject.claim === null && recovery
    && subject.pullRequest.state === "CLOSED" && subject.pullRequest.closeEvent
    && recovery.claimId === subject.lease.claimId
    && recovery.writeSetDigest === subject.lease.writeSetDigest
    && canonicalJson(recovery.declaredWriteScope) === canonicalJson(subject.lease.declaredWriteSet)
    && recovery.canonicalBaseRevision === subject.lease.baseSha
    && recovery.laneRevision === subject.lease.fenceSha
    && recovery.finalRevision === subject.lease.fenceSha
    && recovery.reviewRequestId === `github-pull-request:${subject.pullRequest.nodeId}`
    && recovery.reason === "abandoned" && recovery.state === "retired"
    && recovery.integrationReceiptDigest === null
    && Date.parse(recovery.retiredAt) <= Date.parse(observedAt);
  if (!normal && !partial) throw new Error("Supersession retirement mode evidence is invalid.");
  if (canonical.protectedRevision !== successor.expectedCanonicalRevision
    || successor.sourceIntegrationRevision !== subject.headSha
    || successor.targetRevision !== controller.headSha
    || canonical.sourceBaseRevision !== subject.lease.baseSha
    || canonical.entries.length !== subject.changedPaths.length
    || canonicalJson(canonical.entries.map(item => item.path)) !== canonicalJson(subject.changedPaths)
    || canonicalJson(successor.paths) !== canonicalJson(subject.changedPaths)
    || successor.semanticScope === subject.lease.semanticScope
    || successor.capability.authoritySubjectId === subject.lease.taskAuthoritySubjectId) {
    throw new Error("Canonical successor does not exactly cover the prepared source.");
  }
  const issuedAge = Date.parse(observedAt) - Date.parse(successor.capability.issuedAt);
  if (!Number.isFinite(issuedAge) || issuedAge < 0 || issuedAge > 86_400_000) {
    throw new Error("Successor task capability is not fresh for this plan.");
  }
  for (const entry of canonical.entries) {
    if (entry.subjectBlobSha !== entry.witnessBlobSha
      || entry.subjectValue !== canonical.dependencySourceRevision
      || entry.canonicalValue !== canonical.dependencyCanonicalRevision
      || entry.targetValue !== canonical.targetDependencyRevision
      || entry.subjectValue === entry.canonicalValue
      || entry.canonicalValue === entry.targetValue
      || entry.targetValue !== successor.targetRevision) {
      throw new Error("Canonical byte-equivalence or field supersession evidence is invalid.");
    }
  }
  if (canonical.targetDependencyRevision !== successor.targetRevision) {
    throw new Error("Dependency ancestry proof does not terminate at the successor target.");
  }
  const core = { schema: PLAN_SCHEMA,
    action: "retire-admitted-prepared-descendant-canonical-supersession", mode, observedAt,
    subject, canonical, successor, controller, cloud, recovery, retirementEvidence,
    effects: mode === "normal" ? NORMAL_EFFECTS : PARTIAL_EFFECTS, preservation: PRESERVATION };
  const planDigest = digestValue(core);
  return freeze({ ...core, planDigest,
    exactAuthorization:
      `authorize admitted-prepared-descendant-canonical-supersession-retirement ${planDigest}` });
}
export function normalizePlan(value) {
  const rebuilt = buildPlan(value);
  if (value?.planDigest !== rebuilt.planDigest
    || value?.exactAuthorization !== rebuilt.exactAuthorization
    || canonicalJson(value) !== canonicalJson(rebuilt)) {
    throw new Error("Supersession retirement plan is invalid or drifted.");
  }
  return rebuilt;
}
export function authorizePlan(plan, authorization) {
  const normalized = normalizePlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error(`Exact authorization required: ${normalized.exactAuthorization}`);
  }
  return normalized;
}
export function createState(plan) {
  return sealState({ schema: STATE_SCHEMA, phase: "planned", plan: normalizePlan(plan), receipts: {} });
}
export function normalizeState(value) {
  object(value, "supersession retirement state");
  const phase = phaseName(value.phase);
  const plan = normalizePlan(value.plan);
  const receipts = {};
  const source = object(value.receipts, "phase receipts");
  for (let index = 1; index <= PHASES.indexOf(phase); index += 1) {
    const name = PHASES[index];
    receipts[name] = normalizePhaseReceipt(source[name], name, { plan, receipts });
  }
  if (Object.keys(source).some(key => !Object.hasOwn(receipts, key))) {
    throw new Error("Supersession retirement receipts are out of order.");
  }
  return assertSealed(value, { schema: STATE_SCHEMA, phase, plan, receipts: freeze(receipts) });
}
export function advanceState(state, phase, receipt) {
  const current = normalizeState(state);
  const nextPhase = phaseName(phase);
  if (PHASES.indexOf(nextPhase) !== PHASES.indexOf(current.phase) + 1) {
    throw new Error(`Supersession retirement cannot advance from ${current.phase} to ${nextPhase}.`);
  }
  return sealState({ schema: STATE_SCHEMA, phase: nextPhase, plan: current.plan,
    receipts: { ...current.receipts, [nextPhase]: normalizePhaseReceipt(receipt, nextPhase, {
      plan: current.plan, receipts: current.receipts,
    }) } });
}
export function phaseReceipt(phase, values) {
  const core = { phase: phaseName(phase), ...structuredClone(values) };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}
export function buildReceipt(state, terminalEvidenceDigest) {
  const current = normalizeState(state);
  if (current.phase !== "owner-released") {
    throw new Error("Terminal receipt requires released local ownership.");
  }
  const core = { schema: RECEIPT_SCHEMA, status: "complete", planDigest: current.plan.planDigest,
    mode: current.plan.mode, retirementReason: current.plan.mode === "normal" ? "superseded" : "abandoned",
    retirementEntryDigest: current.plan.recovery?.retirementEntryDigest ?? null,
    authorizationDigest: digest(current.receipts.authorized.authorizationDigest, "authorization digest"),
    sourceAuthorityReceiptDigest: current.receipts["source-authority-verified"].receiptDigest,
    claimRetirementReceiptDigest: current.receipts["claim-retired"].receiptDigest,
    pullRequestCloseReceiptDigest: current.receipts["pull-request-closed"].receiptDigest,
    ownerReleaseReceiptDigest: current.receipts["owner-released"].receiptDigest,
    terminalEvidenceDigest: digest(terminalEvidenceDigest, "terminal evidence digest"),
    preservation: PRESERVATION };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}
function normalizeSubject(value) {
  const source = object(value, "prepared subject");
  const leaseSource = object(source.lease, "subject lease");
  const integrationSource = object(source.integration, "prepared integration");
  const claimSource = source.claim === null ? null : object(source.claim, "cloud claim");
  const pullSource = object(source.pullRequest, "pull request");
  const authoritySource = object(source.sourceAuthority, "source task authority");
  const changedPaths = paths(source.changedPaths, "changed paths");
  const lease = freeze({
    status: text(leaseSource.status, "lease status"),
    epoch: positive(leaseSource.epoch, "lease epoch"),
    sessionId: text(leaseSource.sessionId, "lease session"),
    device: text(leaseSource.device, "lease device"),
    scope: text(leaseSource.scope, "lease scope"),
    branch: text(leaseSource.branch, "lease branch"),
    worktreePath: text(leaseSource.worktreePath, "lease worktree"),
    baseSha: sha(leaseSource.baseSha, "lease base"),
    fenceSha: sha(leaseSource.fenceSha, "lease fence"),
    pullRequestUrl: text(leaseSource.pullRequestUrl, "lease pull request URL"),
    autoDelivery: leaseSource.autoDelivery === true,
    runtimeRequired: leaseSource.runtimeRequired === true,
    acquiredAt: instant(leaseSource.acquiredAt, "lease acquisition instant"),
    admissionStatus: text(leaseSource.admissionStatus, "admission status"),
    semanticScope: text(leaseSource.semanticScope, "semantic scope"),
    claimId: digest(leaseSource.claimId, "lease claim ID"),
    declaredWriteSet: sortedStrings(leaseSource.declaredWriteSet, "declared write set"),
    writeSetDigest: digest(leaseSource.writeSetDigest, "write-set digest"),
    manifestDigest: digest(leaseSource.manifestDigest, "manifest digest"),
    taskAuthoritySubjectId: taskSubject(leaseSource.taskAuthoritySubjectId),
    taskAuthorityBindingDigest: digest(leaseSource.taskAuthorityBindingDigest, "task binding digest"),
    leaseDigest: digest(leaseSource.leaseDigest, "lease digest"),
  });
  const integration = freeze({
    schema: text(integrationSource.schema, "integration schema"),
    commitSha: sha(integrationSource.commitSha, "integration commit"),
    treeSha: sha(integrationSource.treeSha, "integration tree"),
    parentSha: sha(integrationSource.parentSha, "integration parent"),
    commitMessage: oneLine(integrationSource.commitMessage, "integration message"),
    manifestDigest: digest(integrationSource.manifestDigest, "integration manifest digest"),
    stagedDiffDigest: digest(integrationSource.stagedDiffDigest, "integration diff digest"),
    paths: paths(integrationSource.paths, "integration paths"),
    recordedAt: instant(integrationSource.recordedAt, "integration instant"),
  });
  const claim = claimSource === null ? null : freeze({
    claimId: digest(claimSource.claimId, "claim ID"),
    claimDigest: digest(claimSource.claimDigest, "claim digest"),
    state: text(claimSource.state, "claim state"),
    writeAuthority: claimSource.writeAuthority === true,
    scopeReserved: claimSource.scopeReserved === true,
    laneRevision: sha(claimSource.laneRevision, "claim lane revision"),
    canonicalBaseRevision: sha(claimSource.canonicalBaseRevision, "claim base"),
    transitionCounter: positive(claimSource.transitionCounter, "claim transition counter"),
    reviewRequestId: text(claimSource.reviewRequestId, "claim review request"),
    expiresAt: instant(claimSource.expiresAt, "claim expiry"),
  });
  const pullRequest = freeze({
    number: positive(pullSource.number, "pull request number"),
    nodeId: text(pullSource.nodeId, "pull request node ID"),
    url: text(pullSource.url, "pull request URL"),
    state: text(pullSource.state, "pull request state"),
    isDraft: pullSource.isDraft === true,
    mergedAt: pullSource.mergedAt ?? null,
    closedAt: pullSource.closedAt === null ? null : instant(pullSource.closedAt, "pull request closure instant"),
    closeEvent: pullSource.closeEvent === null ? null : normalizeCloseEvent(pullSource.closeEvent),
    headBranch: text(pullSource.headBranch, "pull request head branch"),
    headSha: sha(pullSource.headSha, "pull request head"),
    baseBranch: text(pullSource.baseBranch, "pull request base branch"),
    baseSha: sha(pullSource.baseSha, "pull request base"),
  });
  const sourceAuthority = freeze({
    bindingDigest: digest(authoritySource.bindingDigest, "source binding digest"),
    proofDigest: digest(authoritySource.proofDigest, "source proof digest"),
    operation: text(authoritySource.operation, "source proof operation"),
    verifiedAt: instant(authoritySource.verifiedAt, "source proof instant"),
  });
  const result = freeze({
    repository: repository(source.repository, "subject repository"),
    path: text(source.path, "subject path"),
    branch: text(source.branch, "subject branch"),
    headSha: sha(source.headSha, "subject head"),
    treeSha: sha(source.treeSha, "subject tree"),
    parentSha: sha(source.parentSha, "subject parent"),
    remoteHeadSha: sha(source.remoteHeadSha, "remote head"),
    changedPaths,
    clean: source.clean === true,
    registered: source.registered === true,
    stateDigest: digest(source.stateDigest, "subject state digest"),
    lease, integration, claim, pullRequest, sourceAuthority,
  });
  const declaredPaths = lease.declaredWriteSet.filter(item => item.startsWith("path:"))
    .map(item => item.slice(5));
  if (!result.clean || !result.registered || lease.status !== "active"
    || lease.admissionStatus !== "admitted" || lease.branch !== result.branch
    || lease.worktreePath !== result.path || lease.fenceSha !== result.parentSha
    || integration.schema !== "agentic-integration-commit/v1"
    || integration.commitSha !== result.headSha || integration.treeSha !== result.treeSha
    || integration.parentSha !== result.parentSha
    || canonicalJson(integration.paths) !== canonicalJson(changedPaths)
    || canonicalJson(declaredPaths) !== canonicalJson(changedPaths)
    || !lease.declaredWriteSet.includes(`semantic:${lease.semanticScope}`)
    || result.headSha !== result.remoteHeadSha
    || !pullRequest.isDraft || pullRequest.mergedAt !== null || pullRequest.headBranch !== result.branch
    || pullRequest.headSha !== result.headSha || pullRequest.baseBranch !== "main"
    || pullRequest.baseSha !== lease.baseSha
    || (claim && (!claim.scopeReserved || claim.laneRevision !== lease.fenceSha
      || claim.claimId !== lease.claimId || claim.canonicalBaseRevision !== lease.baseSha
      || claim.reviewRequestId !== `github-pull-request:${pullRequest.nodeId}`
      || !((claim.state === "current" && claim.writeAuthority)
        || (claim.state === "dormant-preserved" && !claim.writeAuthority))))
    || sourceAuthority.bindingDigest !== lease.taskAuthorityBindingDigest
    || lease.scope !== lease.semanticScope || lease.pullRequestUrl !== pullRequest.url
    || !((pullRequest.state === "OPEN" && pullRequest.closedAt === null && pullRequest.closeEvent === null)
      || (pullRequest.state === "CLOSED" && pullRequest.closedAt !== null
        && pullRequest.closeEvent?.actorLogin === result.repository.split("/")[0]
        && pullRequest.closeEvent.actorType === "User"
        && pullRequest.closeEvent.performedViaGitHubApp === null))
    ) {
    throw new Error("Subject is not one exact active admitted prepared descendant.");
  }
  return result;
}
function normalizeCloseEvent(value) {
  const source = object(value, "pull request close event");
  exactKeys(source, ["actorId", "actorLogin", "actorType", "createdAt", "eventId", "nodeId",
    "performedViaGitHubApp"], "pull request close event");
  return freeze({
    eventId: positive(source.eventId, "close event ID"),
    nodeId: text(source.nodeId, "close event node ID"),
    actorLogin: text(source.actorLogin, "close event actor login"),
    actorId: positive(source.actorId, "close event actor ID"),
    actorType: text(source.actorType, "close event actor type"),
    createdAt: instant(source.createdAt, "close event instant"),
    performedViaGitHubApp: source.performedViaGitHubApp ?? null,
  });
}
function normalizeRecovery(value) {
  const source = object(value, "partial recovery");
  exactKeys(source, ["bytesDigest", "canonicalBaseRevision", "claimDigest", "claimId",
    "declaredWriteScope", "deviceId", "finalRevision", "handoffEvidenceDigest", "idempotencyKey",
    "integrationReceiptDigest", "laneRevision", "namedChecksDigest", "reason", "retiredAt",
    "retirementEntryDigest", "reviewRequestId", "sessionId", "state", "transitionCounter",
    "writeSetDigest"], "partial recovery");
  const result = freeze({
    retirementEntryDigest: digest(source.retirementEntryDigest, "retirement entry digest"),
    claimId: digest(source.claimId, "recovery claim ID"),
    claimDigest: digest(source.claimDigest, "retired claim digest"),
    state: text(source.state, "retired claim state"),
    canonicalBaseRevision: sha(source.canonicalBaseRevision, "retired claim base"),
    laneRevision: sha(source.laneRevision, "retired claim lane"),
    writeSetDigest: digest(source.writeSetDigest, "retired write-set digest"),
    declaredWriteScope: sortedStrings(source.declaredWriteScope, "retired write scope"),
    deviceId: text(source.deviceId, "retired device ID"),
    sessionId: text(source.sessionId, "retired session ID"),
    transitionCounter: positive(source.transitionCounter, "retired transition counter"),
    reviewRequestId: text(source.reviewRequestId, "retired review request"),
    reason: text(source.reason, "retirement reason"),
    finalRevision: sha(source.finalRevision, "retirement final revision"),
    integrationReceiptDigest: source.integrationReceiptDigest ?? null,
    bytesDigest: digest(source.bytesDigest, "retired bytes digest"),
    namedChecksDigest: digest(source.namedChecksDigest, "retired checks digest"),
    handoffEvidenceDigest: digest(source.handoffEvidenceDigest, "retired handoff digest"),
    idempotencyKey: digest(source.idempotencyKey, "retirement idempotency key"),
    retiredAt: instant(source.retiredAt, "retirement instant"),
  });
  if (result.integrationReceiptDigest !== null) throw new Error("Partial recovery is not an abandoned retirement.");
  return result;
}
function normalizeCanonical(value) {
  const source = object(value, "canonical supersession evidence");
  const entries = array(source.entries, "canonical entries").map((entry, index) => {
    const item = object(entry, `canonical entry ${index}`);
    return freeze({
      path: relativePath(item.path, `canonical entry ${index} path`),
      subjectBlobSha: sha(item.subjectBlobSha, "subject blob"),
      witnessBlobSha: sha(item.witnessBlobSha, "witness blob"),
      canonicalBlobSha: sha(item.canonicalBlobSha, "canonical blob"),
      fieldParent: text(item.fieldParent, "field parent"),
      fieldKey: text(item.fieldKey, "field key"),
      subjectValue: sha(item.subjectValue, "subject field value"),
      canonicalValue: sha(item.canonicalValue, "canonical field value"),
      targetValue: sha(item.targetValue, "target field value"),
      normalizedDocumentDigest: digest(item.normalizedDocumentDigest, "normalized document digest"),
    });
  }).sort((left, right) => compareUtf8(left.path, right.path));
  unique(entries.map(item => item.path), "canonical entry path");
  const result = freeze({
    protectedRevision: sha(source.protectedRevision, "protected revision"),
    protectedTreeSha: sha(source.protectedTreeSha, "protected tree"),
    sourceBaseRevision: sha(source.sourceBaseRevision, "source base revision"),
    integrationWitnessRevision: sha(source.integrationWitnessRevision, "integration witness"),
    sourceBaseAncestor: source.sourceBaseAncestor === true,
    witnessAncestor: source.witnessAncestor === true,
    dependencySourceRevision: sha(source.dependencySourceRevision, "dependency source revision"),
    dependencyCanonicalRevision: sha(source.dependencyCanonicalRevision, "dependency canonical revision"),
    targetDependencyRevision: sha(source.targetDependencyRevision, "target dependency revision"),
    dependencySourceAncestor: source.dependencySourceAncestor === true,
    dependencyCanonicalAncestor: source.dependencyCanonicalAncestor === true,
    entries,
    stateDigest: digest(source.stateDigest, "canonical state digest"),
  });
  if (!result.sourceBaseAncestor || !result.witnessAncestor
    || !result.dependencySourceAncestor || !result.dependencyCanonicalAncestor) {
    throw new Error("Canonical supersession ancestry is incomplete.");
  }
  return result;
}
function normalizeSuccessor(value) {
  const source = object(value, "successor coverage");
  const capabilitySource = object(source.capability, "successor capability");
  const capability = freeze({
    authoritySubjectId: taskSubject(capabilitySource.authoritySubjectId),
    proofAdapterId: text(capabilitySource.proofAdapterId, "successor proof adapter"),
    generation: positive(capabilitySource.generation, "successor generation"),
    publicKeyDigest: digest(capabilitySource.publicKeyDigest, "successor public key digest"),
    issuedAt: instant(capabilitySource.issuedAt, "successor capability instant"),
  });
  const result = freeze({
    semanticScope: text(source.semanticScope, "successor semantic scope"),
    targetRevision: sha(source.targetRevision, "successor target revision"),
    expectedCanonicalRevision: sha(source.expectedCanonicalRevision, "expected canonical revision"),
    sourceIntegrationRevision: sha(source.sourceIntegrationRevision, "source integration revision"),
    paths: paths(source.paths, "successor paths"),
    manifestDigest: digest(source.manifestDigest, "successor manifest digest"),
    writeSetDigest: digest(source.writeSetDigest, "successor write-set digest"),
    capability,
    capabilityDigest: digest(source.capabilityDigest, "successor capability digest"),
    stateDigest: digest(source.stateDigest, "successor state digest"),
  });
  if (capability.generation !== 1 || capability.proofAdapterId !== "urn:agentic-proof:ed25519-file:v1"
    || result.capabilityDigest !== digestValue(capability)) {
    throw new Error("Successor task capability projection is invalid.");
  }
  return result;
}
function normalizeController(value) {
  const source = object(value, "protected controller");
  const result = freeze({
    headSha: sha(source.headSha, "controller HEAD"),
    originMainSha: sha(source.originMainSha, "controller origin/main"),
    treeSha: sha(source.treeSha, "controller tree"),
    runtimeDigest: digest(source.runtimeDigest, "controller runtime digest"),
    clean: source.clean === true,
    protected: source.protected === true,
  });
  if (!result.clean || !result.protected || result.headSha !== result.originMainSha) {
    throw new Error("Controller must be clean exact protected main.");
  }
  return result;
}
function normalizeCloud(value) {
  const source = object(value, "cloud evidence");
  return freeze({
    ledgerRepository: repository(source.ledgerRepository, "ledger repository"),
    ledgerRevision: sha(source.ledgerRevision, "ledger revision"),
    ledgerDigest: digest(source.ledgerDigest, "ledger digest"),
    sequence: positive(source.sequence, "ledger sequence"),
  });
}
function normalizePhaseReceipt(value, phase, { plan, receipts }) {
  const source = object(value, `${phase} receipt`);
  const core = { ...source };
  delete core.receiptDigest;
  if (source.phase !== phase || source.receiptDigest !== digestValue(core)) {
    throw new Error(`${phase} receipt is invalid.`);
  }
  validatePhaseCore(core, phase, plan, receipts);
  return freeze({ ...core, receiptDigest: source.receiptDigest });
}
function validatePhaseCore(core, phase, plan, receipts) {
  if (phase === "authorized") {
    exactKeys(core, ["phase", "authorizationDigest"], phase);
    if (core.authorizationDigest !== digestValue({
      planDigest: plan.planDigest,
      authorization: plan.exactAuthorization,
    })) invalidReceipt(phase);
    return;
  }
  if (phase === "source-authority-verified") {
    exactKeys(core, ["phase", "schema", "bindingDigest", "proofDigest", "operation",
      "verifiedAt", "subjectStateDigest"], phase);
    if (core.schema !== "agentic-prepared-supersession-source-authority-receipt/v1"
      || core.bindingDigest !== plan.subject.sourceAuthority.bindingDigest
      || core.operation !== `prepared-supersession-retirement:${plan.planDigest}:${
        plan.mode === "normal" ? "retire" : "partial-release"}`
      || core.subjectStateDigest !== plan.subject.stateDigest) invalidReceipt(phase);
    digest(core.proofDigest, "source proof digest");
    instant(core.verifiedAt, "source proof verification instant");
    if (Date.parse(core.verifiedAt) < Date.parse(plan.observedAt)) invalidReceipt(phase);
    return;
  }
  if (phase === "claim-retired") {
    exactKeys(core, ["phase", "schema", "claimId", "retirementEntryDigest", "finalRevision",
      "retirementReason", "bytesDigest", "namedChecksDigest", "handoffEvidenceDigest",
      "providerMutation"], phase);
    const expected = plan.mode === "normal" ? {
      claimId: plan.subject.lease.claimId, finalRevision: plan.subject.lease.fenceSha,
      retirementReason: "superseded", ...plan.retirementEvidence, providerMutation: true,
    } : {
      claimId: plan.recovery.claimId, retirementEntryDigest: plan.recovery.retirementEntryDigest,
      finalRevision: plan.recovery.finalRevision, retirementReason: "abandoned",
      bytesDigest: plan.recovery.bytesDigest, namedChecksDigest: plan.recovery.namedChecksDigest,
      handoffEvidenceDigest: plan.recovery.handoffEvidenceDigest, providerMutation: false,
    };
    if (core.schema !== "agentic-prepared-supersession-claim-retirement-receipt/v1"
      || Object.entries(expected).some(([key, value]) => core[key] !== value)) invalidReceipt(phase);
    digest(core.retirementEntryDigest, "retirement entry digest");
    return;
  }
  if (phase === "pull-request-closed") {
    exactKeys(core, ["phase", "schema", "pullRequestNumber", "pullRequestNodeId", "closedAt",
      "closeEventDigest", "providerMutation", "remoteHeadSha", "subjectStateDigest"], phase);
    if (core.schema !== "agentic-prepared-supersession-pull-request-close-receipt/v1"
      || core.pullRequestNumber !== plan.subject.pullRequest.number
      || core.pullRequestNodeId !== plan.subject.pullRequest.nodeId
      || core.providerMutation !== (plan.subject.pullRequest.state === "OPEN")
      || (plan.subject.pullRequest.closeEvent
        && (core.closeEventDigest !== digestValue(plan.subject.pullRequest.closeEvent)
          || core.closedAt !== plan.subject.pullRequest.closedAt))
      || core.remoteHeadSha !== plan.subject.remoteHeadSha
      || core.subjectStateDigest !== plan.subject.stateDigest) invalidReceipt(phase);
    digest(core.closeEventDigest, "close event digest");
    instant(core.closedAt, "pull request closure instant");
    return;
  }
  if (phase === "owner-released") {
    exactKeys(core, ["phase", "schema", "leaseDigest", "releasedLeaseDigest", "releasedAt",
      "localMutation", "mode", "retirementEntryDigest", "retirementReason",
      "subjectStateDigest"], phase);
    if (core.schema !== "agentic-prepared-supersession-owner-release-receipt/v1"
      || core.leaseDigest !== plan.subject.lease.leaseDigest || core.localMutation !== true
      || core.mode !== plan.mode
      || core.retirementEntryDigest !== (plan.recovery?.retirementEntryDigest ?? null)
      || core.retirementReason !== (plan.mode === "normal" ? "superseded" : "abandoned")
      || core.subjectStateDigest !== plan.subject.stateDigest) invalidReceipt(phase);
    digest(core.releasedLeaseDigest, "released lease digest");
    instant(core.releasedAt, "owner release instant");
    return;
  }
  if (phase === "complete") {
    exactKeys(core, ["phase", "receipt"], phase);
    normalizeTerminalReceipt(core.receipt, plan, receipts);
    return;
  }
  invalidReceipt(phase);
}

function normalizeTerminalReceipt(value, plan, receipts) {
  const receipt = object(value, "terminal receipt"), core = { ...receipt };
  delete core.receiptDigest;
  exactKeys(core, ["schema", "status", "planDigest", "authorizationDigest",
    "mode", "retirementEntryDigest", "retirementReason",
    "sourceAuthorityReceiptDigest", "claimRetirementReceiptDigest",
    "pullRequestCloseReceiptDigest", "ownerReleaseReceiptDigest", "terminalEvidenceDigest",
    "preservation"], "terminal");
  if (receipt.schema !== RECEIPT_SCHEMA || receipt.status !== "complete"
    || receipt.planDigest !== plan.planDigest
    || receipt.mode !== plan.mode || receipt.retirementEntryDigest !== (plan.recovery?.retirementEntryDigest ?? null)
    || receipt.retirementReason !== (plan.mode === "normal" ? "superseded" : "abandoned")
    || receipt.authorizationDigest !== receipts.authorized.authorizationDigest
    || receipt.sourceAuthorityReceiptDigest !== receipts["source-authority-verified"].receiptDigest
    || receipt.claimRetirementReceiptDigest !== receipts["claim-retired"].receiptDigest
    || receipt.pullRequestCloseReceiptDigest !== receipts["pull-request-closed"].receiptDigest
    || receipt.ownerReleaseReceiptDigest !== receipts["owner-released"].receiptDigest
    || canonicalJson(receipt.preservation) !== canonicalJson(PRESERVATION)
    || receipt.receiptDigest !== digestValue(core)) invalidReceipt("terminal");
  digest(receipt.terminalEvidenceDigest, "terminal evidence digest");
  return receipt;
}

function sealState(core) {
  const frozen = freeze(core);
  return freeze({ ...frozen, stateDigest: digestValue(frozen) });
}
function assertSealed(value, core) {
  if (value.schema !== STATE_SCHEMA || value.stateDigest !== digestValue(core)
    || canonicalJson(value) !== canonicalJson({ ...core, stateDigest: value.stateDigest })) {
    throw new Error("Supersession retirement state is invalid or drifted.");
  }
  return freeze({ ...core, stateDigest: value.stateDigest });
}
function phaseName(value) {
  if (!PHASES.includes(value)) throw new Error("Supersession retirement phase is invalid.");
  return value;
}
function retirementMode(value) {
  if (!new Set(["normal", "partial-recovery"]).has(value)) {
    throw new Error("Supersession retirement mode is invalid.");
  }
  return value;
}
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  return value;
}
function array(value, label) { if (!Array.isArray(value)) throw new Error(`${label} is invalid.`); return value; }
function text(value, label) { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is invalid.`); return value; }
function oneLine(value, label) { const result = text(value, label); if (result.includes("\n")) throw new Error(`${label} is invalid.`); return result; }
function repository(value, label) { const result = text(value, label); if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) throw new Error(`${label} is invalid.`); return result; }
function sha(value, label) { if (!SHA.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
function taskSubject(value) { if (!/^urn:agentic-task:[0-9a-f]{64}$/u.test(String(value || ""))) throw new Error("Task authority subject is invalid."); return value; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid.`); return value; }
function instant(value, label) { if (typeof value !== "string" || new Date(value).toISOString() !== value) throw new Error(`${label} is invalid.`); return value; }
function relativePath(value, label) { const result = text(value, label); if (result.startsWith("/") || result.split("/").includes("..")) throw new Error(`${label} is invalid.`); return result; }
function stringArray(value, label) { return array(value, label).map(item => text(item, label)); }
function sortedStrings(value, label) { const result = stringArray(value, label).sort(compareUtf8); unique(result, label); return freeze(result); }
function paths(value, label) { const result = stringArray(value, label).map(item => relativePath(item, label)).sort(compareUtf8); unique(result, label); return freeze(result); }
function unique(values, label) { if (new Set(values).size !== values.length) throw new Error(`${label} is duplicated.`); }
function compareUtf8(left, right) { return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")); }
function exactKeys(value, keys, label) {
  if (canonicalJson(Object.keys(value).sort(compareUtf8))
    !== canonicalJson([...keys].sort(compareUtf8))) invalidReceipt(label);
}
function invalidReceipt(label) { throw new Error(`${label} receipt is invalid.`); }
function freeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; }
