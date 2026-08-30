// Responsibility: Seal one exact pre-bind mixed-device planned-owner retirement.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";

export const OPERATION = "pre-bind-mixed-device-planned-owner-retirement";
export const PLAN_SCHEMA = "agentic-pre-bind-mixed-device-planned-owner-retirement-plan/v1";
export const JOURNAL_SCHEMA = "agentic-pre-bind-mixed-device-planned-owner-retirement-journal/v1";
export const RECEIPT_SCHEMA = "agentic-pre-bind-mixed-device-planned-owner-retirement-receipt/v1";
export const PHASES = Object.freeze([
  "authorized", "prepared",
  "claim-retirement-intent", "claim-retirement-attempted", "claim-retired",
  "pull-request-close-intent", "pull-request-close-attempted", "pull-request-closed",
  "owner-release-intent", "owner-release-attempted", "owner-released", "verified", "complete",
]);
export const EFFECTS = Object.freeze([
  "retire-exact-cloud-claim", "close-exact-draft-pull-request", "release-exact-local-lease",
]);
export const PRESERVATION = Object.freeze({
  sourceBytes: "unchanged", index: "unchanged", commit: "unchanged",
  localRef: "unchanged", remoteRef: "unchanged", branch: "preserved",
  worktree: "preserved", tree: "unchanged", merge: "not-performed",
  deployment: "not-performed",
});

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

export function buildPlan(input) {
  const evidence = normalizeEvidence(input);
  const core = { schema: PLAN_SCHEMA, operation: OPERATION, evidence,
    orderedEffects: EFFECTS, preservation: PRESERVATION };
  const planDigest = digestValue(core);
  return freeze({ ...core, planDigest, exactAuthorization: `authorize ${OPERATION} ${planDigest}` });
}

export function normalizePlan(value) {
  const rebuilt = buildPlan(value?.evidence || value);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("plan seal");
  return rebuilt;
}

export function authorizePlan(plan, authorization) {
  const normalized = normalizePlan(plan);
  if (authorization !== normalized.exactAuthorization) {
    throw new Error(`Exact authorization required: ${normalized.exactAuthorization}`);
  }
  return digestValue({ schema: "agentic-pre-bind-mixed-device-planned-owner-retirement-authorization/v1",
    planDigest: normalized.planDigest, authorization });
}

export function createJournal(plan) {
  return sealJournal({ schema: JOURNAL_SCHEMA, plan: normalizePlan(plan), state: null });
}

export function startJournal(journal, authorization) {
  const current = normalizeJournal(journal);
  if (current.state !== null) throw new Error("Retirement journal is already authorized.");
  return sealJournal({ schema: JOURNAL_SCHEMA, plan: current.plan, state: {
    phase: "authorized", receipts: { authorized: phaseReceipt("authorized", {
      authorizationDigest: authorizePlan(current.plan, authorization),
    }) },
  } });
}

export function advanceJournal(journal, phase, values) {
  const current = normalizeJournal(journal);
  if (!current.state) throw new Error("Retirement journal is not authorized.");
  if (PHASES.indexOf(phase) !== PHASES.indexOf(current.state.phase) + 1) {
    throw new Error(`Retirement cannot advance from ${current.state.phase} to ${phase}.`);
  }
  return sealJournal({ schema: JOURNAL_SCHEMA, plan: current.plan, state: { phase,
    receipts: { ...current.state.receipts, [phase]: phaseReceipt(phase, values) } } });
}

export function normalizeJournal(value) {
  object(value, "journal");
  const plan = normalizePlan(value.plan);
  let state = null;
  if (value.state !== null) {
    object(value.state, "journal state");
    const last = PHASES.indexOf(value.state.phase);
    if (last < 0) invalid("journal phase");
    const receipts = {};
    for (let index = 0; index <= last; index += 1) {
      const phase = PHASES[index];
      receipts[phase] = normalizePhaseReceipt(value.state.receipts?.[phase], phase);
    }
    if (Object.keys(receipts).length !== Object.keys(value.state.receipts || {}).length) {
      invalid("journal receipt order");
    }
    state = freeze({ phase: value.state.phase, receipts });
    assertReceiptJoins(plan, state);
  }
  const core = { schema: JOURNAL_SCHEMA, plan, state };
  if (value.schema !== JOURNAL_SCHEMA || value.journalDigest !== digestValue(core)
    || canonicalJson(value) !== canonicalJson({ ...core, journalDigest: value.journalDigest })) {
    invalid("journal seal");
  }
  return freeze({ ...core, journalDigest: value.journalDigest });
}

export function operationKey(plan, phase) {
  const normalized = normalizePlan(plan);
  if (!PHASES.includes(phase) || phase === "authorized") invalid("operation phase");
  return digestValue({ schema: "agentic-pre-bind-mixed-device-owner-retirement-operation-key/v1",
    operation: OPERATION, planDigest: normalized.planDigest, phase });
}

export function buildReceipt(journal) {
  const current = normalizeJournal(journal);
  if (!current.state || !["verified", "complete"].includes(current.state.phase)) {
    throw new Error("Terminal receipt requires exact verified effects.");
  }
  const receipts = current.state.receipts;
  const core = { schema: RECEIPT_SCHEMA, status: "complete", operation: OPERATION,
    planDigest: current.plan.planDigest,
    authorizationDigest: receipts.authorized.authorizationDigest,
    repository: current.plan.evidence.repository.nameWithOwner,
    claimId: current.plan.evidence.claim.claimId,
    claimWorkItem: current.plan.evidence.cloudSubject.rawClaimWorkItem,
    workItemId: current.plan.evidence.claim.workItemId,
    localWorkItemId: current.plan.evidence.cloudSubject.derivedLeaseWorkItemId,
    workItemBindingDigest: current.plan.evidence.cloudSubject.workItemDerivationDigest,
    branch: current.plan.evidence.lease.branch,
    pullRequestNumber: current.plan.evidence.pullRequest.number,
    controllerRevision: current.plan.evidence.controller.revision,
    claimRetirementReceiptDigest: receipts["claim-retired"].receiptDigest,
    pullRequestCloseReceiptDigest: receipts["pull-request-closed"].receiptDigest,
    ownerReleaseReceiptDigest: receipts["owner-released"].receiptDigest,
    terminalEvidenceDigest: receipts.verified.terminalEvidenceDigest,
    orderedEffects: EFFECTS, preservation: PRESERVATION };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeReceipt(value) {
  object(value, "receipt");
  const core = { ...value }; delete core.receiptDigest;
  const fields = ["schema", "status", "operation", "planDigest", "authorizationDigest",
    "repository", "claimId", "claimWorkItem", "workItemId", "localWorkItemId",
    "workItemBindingDigest", "branch", "pullRequestNumber", "controllerRevision",
    "claimRetirementReceiptDigest", "pullRequestCloseReceiptDigest", "ownerReleaseReceiptDigest",
    "terminalEvidenceDigest", "orderedEffects", "preservation"];
  if (value.schema !== RECEIPT_SCHEMA || value.status !== "complete"
    || value.operation !== OPERATION || value.receiptDigest !== digestValue(core)
    || canonicalJson(Object.keys(core).sort()) !== canonicalJson(fields.sort())
    || canonicalJson(value.orderedEffects) !== canonicalJson(EFFECTS)
    || canonicalJson(value.preservation) !== canonicalJson(PRESERVATION)) invalid("receipt");
  digest(value.planDigest, "receipt plan"); digest(value.authorizationDigest, "receipt authorization");
  repo(value.repository, "receipt repository"); digest(value.claimId, "receipt claim");
  text(value.claimWorkItem, "receipt raw claim work item");
  text(value.workItemId, "receipt work item"); text(value.localWorkItemId, "receipt local work item");
  digest(value.workItemBindingDigest, "receipt work-item binding"); text(value.branch, "receipt branch");
  positive(value.pullRequestNumber, "receipt pull request"); sha(value.controllerRevision, "receipt controller");
  for (const field of ["claimRetirementReceiptDigest", "pullRequestCloseReceiptDigest",
    "ownerReleaseReceiptDigest", "terminalEvidenceDigest"]) digest(value[field], `receipt ${field}`);
  return freeze({ ...core, receiptDigest: value.receiptDigest });
}

function normalizeEvidence(value) {
  const source = object(value, "evidence");
  const repository = exactObject(source.repository, ["id", "nameWithOwner", "commonDirectoryDigest"]);
  repository.id = text(repository.id, "repository ID");
  repository.nameWithOwner = repo(repository.nameWithOwner, "repository");
  repository.commonDirectoryDigest = digest(repository.commonDirectoryDigest, "common directory");
  const controller = exactObject(source.controller,
    ["repository", "branch", "revision", "tree", "runtimeDigest", "policyDigest", "clean", "protected"]);
  controller.repository = repo(controller.repository, "controller repository");
  controller.branch = text(controller.branch, "controller branch");
  controller.revision = sha(controller.revision, "controller revision");
  controller.tree = sha(controller.tree, "controller tree");
  controller.runtimeDigest = digest(controller.runtimeDigest, "controller runtime");
  controller.policyDigest = digest(controller.policyDigest, "controller policy");
  if (controller.branch !== "main" || controller.clean !== true || controller.protected !== true) {
    invalid("protected controller");
  }
  const lease = exactObject(source.lease, ["digest", "status", "epoch", "sessionId", "device", "scope",
    "normalizedOwner", "branch", "worktreePath", "baseSha", "fenceSha", "expiresAt",
    "admissionStatus", "admissionWriteSetDigest", "admissionManifestDigest",
    "claimId", "cloudDeviceId", "cloudSessionId",
    "cloudClaimDigest", "cloudWriteSetDigest", "taskAuthorityBindingDigest"]);
  lease.digest = digest(lease.digest, "lease digest"); lease.status = exact(lease.status, "active", "lease status");
  lease.epoch = positive(lease.epoch, "lease epoch"); lease.sessionId = text(lease.sessionId, "lease session");
  lease.device = text(lease.device, "lease device"); lease.scope = text(lease.scope, "lease scope");
  lease.normalizedOwner = text(lease.normalizedOwner, "normalized owner");
  lease.branch = text(lease.branch, "lease branch"); lease.worktreePath = text(lease.worktreePath, "lease worktree");
  lease.baseSha = sha(lease.baseSha, "lease base"); lease.fenceSha = sha(lease.fenceSha, "lease fence");
  lease.expiresAt = instant(lease.expiresAt, "lease expiry");
  lease.admissionStatus = exact(lease.admissionStatus, "planned", "lease admission");
  lease.admissionWriteSetDigest = digest(lease.admissionWriteSetDigest, "admission write set");
  lease.admissionManifestDigest = digest(lease.admissionManifestDigest, "admission manifest");
  lease.claimId = digest(lease.claimId, "embedded claim ID");
  lease.cloudDeviceId = text(lease.cloudDeviceId, "embedded cloud device");
  lease.cloudSessionId = text(lease.cloudSessionId, "embedded cloud session");
  lease.cloudClaimDigest = digest(lease.cloudClaimDigest, "embedded cloud claim digest");
  lease.cloudWriteSetDigest = digest(lease.cloudWriteSetDigest, "embedded cloud write set");
  lease.taskAuthorityBindingDigest = digest(lease.taskAuthorityBindingDigest, "task binding");
  const capability = exactObject(source.taskCapability,
    ["authoritySubjectId", "proofAdapterId", "generation", "publicKeyDigest", "bindingDigest"]);
  capability.authoritySubjectId = subject(capability.authoritySubjectId);
  capability.proofAdapterId = exact(capability.proofAdapterId, "urn:agentic-proof:ed25519-file:v1", "proof adapter");
  capability.generation = positive(capability.generation, "capability generation");
  capability.publicKeyDigest = digest(capability.publicKeyDigest, "capability public key");
  capability.bindingDigest = digest(capability.bindingDigest, "capability binding");
  const cloudSubject = exactObject(source.cloudSubject,
    ["rawClaimOwnerDevice", "rawClaimWorkItem", "derivedClaimDeviceId", "derivedNormalizedDeviceId",
      "derivedExpectedSessionId", "derivedClaimWorkItemId", "derivedLeaseWorkItemId",
      "derivationDigest", "workItemDerivationDigest"]);
  cloudSubject.rawClaimOwnerDevice = text(cloudSubject.rawClaimOwnerDevice, "raw claim-owner device");
  cloudSubject.rawClaimWorkItem = text(cloudSubject.rawClaimWorkItem, "raw claim work item");
  cloudSubject.derivedClaimDeviceId = digestIdentity(cloudSubject.derivedClaimDeviceId, "derived claim device");
  cloudSubject.derivedNormalizedDeviceId = digestIdentity(cloudSubject.derivedNormalizedDeviceId, "derived normalized device");
  cloudSubject.derivedExpectedSessionId = digestIdentity(cloudSubject.derivedExpectedSessionId, "derived session");
  cloudSubject.derivedClaimWorkItemId = workItemIdentity(cloudSubject.derivedClaimWorkItemId, "derived claim work item");
  cloudSubject.derivedLeaseWorkItemId = workItemIdentity(cloudSubject.derivedLeaseWorkItemId, "derived lease work item");
  cloudSubject.derivationDigest = digest(cloudSubject.derivationDigest, "cloud subject derivation");
  cloudSubject.workItemDerivationDigest = digest(cloudSubject.workItemDerivationDigest, "work-item derivation");
  const claim = exactObject(source.claim, ["claimId", "claimDigest", "entryDigest", "actorId", "repositoryId",
    "workItemId", "deviceId", "sessionId", "canonicalBaseRevision", "laneRevision",
    "declaredWriteScope", "writeSetDigest", "leaseEpoch", "transitionCounter", "state", "recordedState",
    "writeAuthority", "scopeReserved", "reviewRequestId", "expiresAt", "temporalState"]);
  claim.claimId = digest(claim.claimId, "claim ID"); claim.claimDigest = digest(claim.claimDigest, "claim digest");
  claim.entryDigest = digest(claim.entryDigest, "claim entry"); claim.actorId = text(claim.actorId, "claim actor");
  claim.repositoryId = text(claim.repositoryId, "claim repository");
  claim.workItemId = text(claim.workItemId, "claim work item"); claim.deviceId = text(claim.deviceId, "claim device");
  claim.sessionId = text(claim.sessionId, "claim session"); claim.canonicalBaseRevision = sha(claim.canonicalBaseRevision, "claim base");
  claim.laneRevision = sha(claim.laneRevision, "claim lane"); claim.declaredWriteScope = strings(claim.declaredWriteScope, "claim write scope");
  claim.writeSetDigest = digest(claim.writeSetDigest, "claim write set"); claim.leaseEpoch = exact(claim.leaseEpoch, 1, "claim t1 epoch");
  claim.transitionCounter = exact(claim.transitionCounter, 1, "claim t1 transition");
  claim.state = enumeration(claim.state, ["current", "dormant-preserved"], "claim state");
  claim.recordedState = exact(claim.recordedState, "current", "claim recorded state");
  const observedMillis = Date.parse(source.observedAt);
  const expiresMillis = Date.parse(claim.expiresAt);
  const currentProjection = claim.state === "current" && claim.writeAuthority === true
    && expiresMillis > observedMillis && claim.temporalState === "current";
  const expiredProjection = claim.state === "dormant-preserved" && claim.writeAuthority === false
    && expiresMillis <= observedMillis && claim.temporalState === "expired";
  if ((!currentProjection && !expiredProjection) || claim.scopeReserved !== true
    || claim.reviewRequestId !== null) invalid("pre-bind claim state");
  claim.expiresAt = instant(claim.expiresAt, "claim expiry");
  claim.temporalState = enumeration(claim.temporalState, ["current", "expired"], "claim temporal state");
  const git = exactObject(source.git, ["headSha", "treeSha", "baseSha", "baseTreeSha", "parentShas",
    "changedPaths", "localRefSha", "remoteRefSha", "statusDigest", "indexDigest", "clean", "registered"]);
  for (const field of ["headSha", "treeSha", "baseSha", "baseTreeSha", "localRefSha", "remoteRefSha"]) git[field] = sha(git[field], `git ${field}`);
  git.parentShas = strings(git.parentShas, "git parents").map(item => sha(item, "git parent"));
  git.changedPaths = strings(git.changedPaths, "changed paths"); git.statusDigest = digest(git.statusDigest, "status digest");
  git.indexDigest = digest(git.indexDigest, "index digest");
  const pull = exactObject(source.pullRequest, ["number", "nodeId", "url", "state", "isDraft", "mergedAt",
    "closedAt", "autoMergeRequest", "headRepository", "headBranch", "headSha", "baseRepository", "baseBranch", "baseSha", "markerDigest"]);
  pull.number = positive(pull.number, "pull request number"); pull.nodeId = text(pull.nodeId, "pull request node");
  pull.url = text(pull.url, "pull request URL"); pull.state = exact(pull.state, "OPEN", "pull request state");
  if (pull.isDraft !== true || pull.mergedAt !== null || pull.closedAt !== null
    || pull.autoMergeRequest !== null) invalid("open draft pull request");
  pull.headRepository = repo(pull.headRepository, "pull head repository"); pull.headBranch = text(pull.headBranch, "pull head branch");
  pull.headSha = sha(pull.headSha, "pull head"); pull.baseRepository = repo(pull.baseRepository, "pull base repository");
  pull.baseBranch = exact(pull.baseBranch, "main", "pull base branch"); pull.baseSha = sha(pull.baseSha, "pull base");
  pull.markerDigest = digest(pull.markerDigest, "pull marker");
  const ledger = exactObject(source.ledger, ["repository", "revision", "digest", "sequence", "validatedDigest"]);
  ledger.repository = repo(ledger.repository, "ledger repository"); ledger.revision = sha(ledger.revision, "ledger revision");
  ledger.digest = digest(ledger.digest, "ledger digest"); ledger.sequence = positive(ledger.sequence, "ledger sequence");
  ledger.validatedDigest = digest(ledger.validatedDigest, "validated ledger");
  const observedAt = instant(source.observedAt, "observation instant");
  if (lease.claimId !== claim.claimId || lease.cloudClaimDigest !== claim.claimDigest
    || lease.cloudDeviceId !== claim.deviceId || lease.cloudSessionId !== claim.sessionId
    || lease.cloudWriteSetDigest !== claim.writeSetDigest
    || lease.admissionWriteSetDigest !== claim.writeSetDigest
    || cloudSubject.rawClaimWorkItem === lease.scope
    || cloudSubject.derivedClaimWorkItemId
      !== pseudonymousIdentifier("work-item", cloudSubject.rawClaimWorkItem)
    || cloudSubject.derivedLeaseWorkItemId !== pseudonymousIdentifier("work-item", lease.scope)
    || cloudSubject.derivedClaimWorkItemId !== claim.workItemId
    || cloudSubject.derivedLeaseWorkItemId === claim.workItemId
    || cloudSubject.rawClaimOwnerDevice === lease.normalizedOwner
    || cloudSubject.rawClaimOwnerDevice.toLowerCase() !== lease.normalizedOwner
    || cloudSubject.derivedClaimDeviceId
      !== pseudonymousIdentifier("device", cloudSubject.rawClaimOwnerDevice)
    || cloudSubject.derivedNormalizedDeviceId !== pseudonymousIdentifier("device", lease.normalizedOwner)
    || cloudSubject.derivedExpectedSessionId !== pseudonymousIdentifier("session", lease.sessionId)
    || cloudSubject.derivedClaimDeviceId !== claim.deviceId
    || cloudSubject.derivedExpectedSessionId !== claim.sessionId
    || cloudSubject.derivedNormalizedDeviceId === claim.deviceId
    || cloudSubject.derivationDigest !== digestValue({ deviceId: lease.device,
      normalizedOwner: lease.normalizedOwner, rawClaimOwnerDevice: cloudSubject.rawClaimOwnerDevice,
      sessionId: lease.sessionId, derivedClaimDeviceId: cloudSubject.derivedClaimDeviceId,
      derivedNormalizedDeviceId: cloudSubject.derivedNormalizedDeviceId,
      derivedExpectedSessionId: cloudSubject.derivedExpectedSessionId })
    || cloudSubject.workItemDerivationDigest !== digestValue({
      rawClaimWorkItem: cloudSubject.rawClaimWorkItem, localLeaseScope: lease.scope,
      derivedClaimWorkItemId: cloudSubject.derivedClaimWorkItemId,
      derivedLeaseWorkItemId: cloudSubject.derivedLeaseWorkItemId })
    || lease.taskAuthorityBindingDigest !== capability.bindingDigest
    || lease.device !== lease.normalizedOwner
    || claim.canonicalBaseRevision !== lease.baseSha || claim.laneRevision !== lease.baseSha
    || git.headSha !== lease.fenceSha || git.baseSha !== lease.baseSha || git.parentShas.length !== 1
    || git.parentShas[0] !== git.baseSha || git.treeSha !== git.baseTreeSha || git.changedPaths.length !== 0
    || git.localRefSha !== git.headSha || git.remoteRefSha !== git.headSha || git.clean !== true || git.registered !== true
    || pull.headRepository !== repository.nameWithOwner || pull.baseRepository !== repository.nameWithOwner
    || pull.headBranch !== lease.branch || pull.headSha !== git.headSha || pull.baseSha !== git.baseSha) {
    invalid("exact pre-bind mixed-device subject joins");
  }
  if (claim.repositoryId !== repository.id) invalid("claim repository identity");
  const core = { schema: "agentic-pre-bind-mixed-device-planned-owner-retirement-evidence/v1",
    observedAt, repository: freeze(repository), controller: freeze(controller), lease: freeze(lease),
    taskCapability: freeze(capability), cloudSubject: freeze(cloudSubject), claim: freeze(claim), git: freeze(git),
    pullRequest: freeze(pull), ledger: freeze(ledger) };
  if (source.schema !== core.schema) invalid("evidence schema");
  return freeze({ ...core, evidenceDigest: digestValue(core) });
}

export function stableEvidenceDigest(value) {
  const evidence = normalizeEvidence(value.evidenceDigest ? (() => { const x = { ...value }; delete x.evidenceDigest; return x; })() : value);
  return evidence.evidenceDigest;
}

function sealJournal(core) { return normalizeJournal({ ...core, journalDigest: digestValue(core) }); }
function phaseReceipt(phase, values) { object(values, `${phase} values`); const core = { phase, ...values }; return freeze({ ...core, receiptDigest: digestValue(core) }); }
function normalizePhaseReceipt(value, phase) { object(value, `${phase} receipt`); const core = { ...value }; delete core.receiptDigest;
  const expected = expectedPhaseKeys(phase);
  if (canonicalJson(Object.keys(core).sort()) !== canonicalJson(expected.sort())) invalid(`${phase} fields`);
  if (value.phase !== phase || value.receiptDigest !== digestValue(core)) invalid(`${phase} receipt`);
  const mutationField = phase === "claim-retired" ? "cloudMutation"
    : phase === "pull-request-closed" ? "providerMutation"
      : phase === "owner-released" ? "localMutation" : null;
  if (mutationField && (!new Set(["projected", "adopted"]).has(value.disposition)
    || value[mutationField] !== (value.disposition === "projected"))) invalid(`${phase} disposition`);
  return freeze({ ...core, receiptDigest: value.receiptDigest }); }
function expectedPhaseKeys(phase) {
  if (phase === "authorized") return ["phase", "authorizationDigest"];
  if (phase === "prepared") return ["phase", "operationKey", "relevantEvidenceDigest",
    "workItemBindingDigest", "taskAuthorizationReceiptDigest"];
  if (phase.endsWith("-intent")) return ["phase", "operationKey", "effectOperationKey", "priorJournalDigest",
    "taskAuthorizationReceiptDigest", "taskAuthorizationExpectationDigest"];
  if (phase.endsWith("-attempted")) return ["phase", "operationKey", "intentReceiptDigest",
    "taskAuthorizationReceiptDigest", "taskAuthorizationExpectationDigest"];
  if (phase === "claim-retired") return ["phase", "operationKey", "claimId", "terminalEntryDigest",
    "terminalClaimDigest", "operationReceiptDigest", "transportReceiptDigest", "taskAuthorizationReceiptDigest",
    "taskAuthorizationExpectationDigest", "disposition", "cloudMutation"];
  if (phase === "pull-request-closed") return ["phase", "operationKey", "pullRequestNumber",
    "pullRequestNodeId", "closedAt", "taskAuthorizationReceiptDigest", "taskAuthorizationExpectationDigest",
    "disposition", "providerMutation", "remoteRefSha"];
  if (phase === "owner-released") return ["phase", "operationKey", "releasedLeaseDigest",
    "releaseReceiptDigest", "taskAuthorizationReceiptDigest", "taskAuthorizationExpectationDigest",
    "disposition", "localMutation", "preservedGitDigest"];
  if (phase === "verified") return ["phase", "operationKey", "terminalEvidenceDigest"];
  if (phase === "complete") return ["phase", "operationKey", "receipt"];
  invalid("phase fields");
}
function assertReceiptJoins(plan, state) {
  const receipts = state.receipts;
  const effectCompleted = new Set(["claim-retired", "pull-request-closed", "owner-released"]);
  for (const phase of Object.keys(receipts).filter(name => name !== "authorized" && !effectCompleted.has(name))) {
    if (receipts[phase].operationKey !== operationKey(plan, phase)) invalid(`${phase} operation join`);
  }
  const groups = [
    ["claim-retirement-intent", "claim-retirement-attempted", "claim-retired"],
    ["pull-request-close-intent", "pull-request-close-attempted", "pull-request-closed"],
    ["owner-release-intent", "owner-release-attempted", "owner-released"],
  ];
  for (const [intent, attempted, complete] of groups) {
    if (!receipts[intent]) continue;
    if (receipts[intent].effectOperationKey !== operationKey(plan, attempted)) invalid(`${intent} effect join`);
    if (!receipts[attempted]) continue;
    if (receipts[attempted].intentReceiptDigest !== receipts[intent].receiptDigest
      || receipts[attempted].taskAuthorizationReceiptDigest !== receipts[intent].taskAuthorizationReceiptDigest
      || receipts[attempted].taskAuthorizationExpectationDigest !== receipts[intent].taskAuthorizationExpectationDigest) {
      invalid(`${attempted} authorization join`);
    }
    if (!receipts[complete]) continue;
    if (receipts[complete].operationKey !== receipts[attempted].operationKey
      || receipts[complete].taskAuthorizationReceiptDigest !== receipts[attempted].taskAuthorizationReceiptDigest
      || receipts[complete].taskAuthorizationExpectationDigest !== receipts[attempted].taskAuthorizationExpectationDigest) {
      invalid(`${complete} effect join`);
    }
  }
  if (receipts.complete) {
    const receipt = normalizeReceipt(receipts.complete.receipt);
    const expected = { planDigest: plan.planDigest,
      authorizationDigest: receipts.authorized.authorizationDigest,
      repository: plan.evidence.repository.nameWithOwner,
      claimId: plan.evidence.claim.claimId,
      claimWorkItem: plan.evidence.cloudSubject.rawClaimWorkItem,
      workItemId: plan.evidence.claim.workItemId,
      localWorkItemId: plan.evidence.cloudSubject.derivedLeaseWorkItemId,
      workItemBindingDigest: plan.evidence.cloudSubject.workItemDerivationDigest,
      branch: plan.evidence.lease.branch, pullRequestNumber: plan.evidence.pullRequest.number,
      controllerRevision: plan.evidence.controller.revision,
      claimRetirementReceiptDigest: receipts["claim-retired"].receiptDigest,
      pullRequestCloseReceiptDigest: receipts["pull-request-closed"].receiptDigest,
      ownerReleaseReceiptDigest: receipts["owner-released"].receiptDigest,
      terminalEvidenceDigest: receipts.verified.terminalEvidenceDigest };
    for (const [field, expectedValue] of Object.entries(expected)) {
      if (receipt[field] !== expectedValue) invalid(`complete receipt ${field} join`);
    }
  }
}
function exactObject(value, keys) { const result = { ...object(value, "object") };
  if (canonicalJson(Object.keys(result).sort()) !== canonicalJson([...keys].sort())) invalid("object fields"); return result; }
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); return value; }
function text(value, label) { if (typeof value !== "string" || !value || value.trim() !== value) invalid(label); return value; }
function sha(value, label) { if (!SHA.test(String(value || ""))) invalid(label); return value; }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) invalid(label); return value; }
function repo(value, label) { const result = text(value, label); if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) invalid(label); return result; }
function subject(value) { const result = text(value, "task subject"); if (!/^urn:agentic-task:[0-9a-f]{64}$/u.test(result)) invalid("task subject"); return result; }
function digestIdentity(value, label) { const result = text(value, label); if (!/^(device|session):[0-9a-f]{64}$/u.test(result)) invalid(label); return result; }
function workItemIdentity(value, label) { const result = text(value, label); if (!/^work-item:[0-9a-f]{64}$/u.test(result)) invalid(label); return result; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function instant(value, label) { const result = new Date(value); if (!value || Number.isNaN(result.getTime())) invalid(label); return result.toISOString(); }
function strings(value, label) { if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item)) invalid(label); return [...value]; }
function exact(value, expected, label) { if (value !== expected) invalid(label); return value; }
function enumeration(value, allowed, label) { if (!allowed.includes(value)) invalid(label); return value; }
function invalid(label) { throw new Error(`Pre-bind mixed-device planned-owner retirement ${label} is invalid.`); }
function freeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.freeze(value); for (const member of Object.values(value)) freeze(member); return value; }
