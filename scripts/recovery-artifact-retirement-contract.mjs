// Responsibility: Seal one exact-authorized recovery artifact archival plan and its replay journal.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";

export const RECOVERY_ARTIFACT_RETIREMENT_EVIDENCE_SCHEMA =
  "agentic-recovery-artifact-retirement-evidence/v1";
export const RECOVERY_ARTIFACT_RETIREMENT_PLAN_SCHEMA =
  "agentic-recovery-artifact-retirement-plan/v1";
export const RECOVERY_ARTIFACT_RETIREMENT_INTENT_SCHEMA =
  "agentic-recovery-artifact-retirement-intent/v1";
export const RECOVERY_ARTIFACT_RETIREMENT_RECEIPT_SCHEMA =
  "agentic-recovery-artifact-retirement-receipt/v1";
export const RECOVERY_ARTIFACT_RETIREMENT_RESULT_SCHEMA =
  "agentic-recovery-artifact-retirement-result/v1";

const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const PHASES = Object.freeze(["prepared", "archived", "complete"]);
const EFFECTS = Object.freeze({
  source: "archive-by-same-filesystem-atomic-rename",
  archive: "immutable-superseding-recovery-evidence",
  purge: "forbid",
  bundle: "preserve-and-verify",
  sourceParent: "leave-for-bounded-empty-directory-cleanup",
});

export function normalizeRecoveryArtifactRetirementEvidence(value) {
  exact(value, [
    "schema", "owner", "subjectRepository", "source", "archiveRoot", "cleanup",
    "manifest", "bundle", "integration", "evidenceDigest",
  ], "retirement evidence");
  const core = {
    schema: text(value.schema, "evidence schema"),
    owner: repository(value.owner, "journal owner"),
    subjectRepository: repository(value.subjectRepository, "subject repository"),
    source: absolute(value.source, "source"),
    archiveRoot: absolute(value.archiveRoot, "archive root"),
    cleanup: cleanup(value.cleanup),
    manifest: manifest(value.manifest),
    bundle: bundle(value.bundle),
    integration: integration(value.integration),
  };
  if (core.schema !== RECOVERY_ARTIFACT_RETIREMENT_EVIDENCE_SCHEMA) invalid("schema");
  if (core.cleanup.sourceDirectory !== core.source) invalid("cleanup source binding");
  if (core.bundle.path !== `${core.source}/lane.bundle`) invalid("bundle source binding");
  if (core.bundle.sha256 !== core.cleanup.bundleSha256
    || core.bundle.headSha !== core.cleanup.headSha
    || core.bundle.treeSha !== core.cleanup.treeSha
    || core.bundle.headRef !== core.cleanup.headRef) invalid("bundle cleanup binding");
  if (core.integration.headSha !== core.bundle.headSha
    || core.integration.treeSha !== core.bundle.treeSha) invalid("integration bundle binding");
  if (value.evidenceDigest !== digestValue(core)) invalid("digest");
  return freeze({ ...core, evidenceDigest: value.evidenceDigest });
}

export function buildRecoveryArtifactRetirementPlan({ evidence, sessionId,
  operatorDecisionDigest, acknowledgedDriftDigest = null }) {
  const normalized = normalizeRecoveryArtifactRetirementEvidence(evidence);
  const acknowledgement = nullableDigest(acknowledgedDriftDigest, "drift acknowledgement");
  if (normalized.cleanup.requiredDriftAcknowledgement !== acknowledgement) {
    if (normalized.cleanup.requiredDriftAcknowledgement) {
      throw new Error(`Incomplete cleanup journal requires --acknowledge-drift=${normalized.cleanup.requiredDriftAcknowledgement}.`);
    }
    throw new Error("A drift acknowledgement is forbidden for a complete cleanup receipt.");
  }
  const subjectKey = digestValue({
    schema: "agentic-recovery-artifact-retirement-subject/v1",
    ownerIdentityDigest: normalized.owner.identityDigest,
    subjectIdentityDigest: normalized.subjectRepository.identityDigest,
    source: normalized.source,
    cleanupSubjectKey: normalized.cleanup.subjectKey,
  });
  const archivePath = `${normalized.archiveRoot}/${subjectKey}-${normalized.manifest.manifestDigest}`;
  assertPathIsolation(normalized, archivePath);
  const core = {
    schema: RECOVERY_ARTIFACT_RETIREMENT_PLAN_SCHEMA,
    subjectKey,
    evidence: normalized,
    evidenceDigest: normalized.evidenceDigest,
    sessionId: text(sessionId, "session"),
    operatorDecisionDigest: digest(operatorDecisionDigest, "operator decision"),
    acknowledgedDriftDigest: acknowledgement,
    archivePath,
    disposition: "archive-and-supersede",
    effects: EFFECTS,
    phases: PHASES,
  };
  const planDigest = digestValue(core);
  return freeze({ ...core,
    exactAuthorization: `authorize recovery-artifact-retirement ${planDigest}`,
    planDigest,
  });
}

export function normalizeRecoveryArtifactRetirementPlan(value) {
  exact(value, [
    "schema", "subjectKey", "evidence", "evidenceDigest", "sessionId",
    "operatorDecisionDigest", "acknowledgedDriftDigest", "archivePath",
    "disposition", "effects", "phases", "exactAuthorization", "planDigest",
  ], "retirement plan");
  const rebuilt = buildRecoveryArtifactRetirementPlan({
    evidence: value.evidence, sessionId: value.sessionId,
    operatorDecisionDigest: value.operatorDecisionDigest,
    acknowledgedDriftDigest: value.acknowledgedDriftDigest,
  });
  if (canonicalJson(rebuilt) !== canonicalJson(value)) invalid("plan");
  return rebuilt;
}

export function authorizeRecoveryArtifactRetirement(planValue, authorization) {
  const plan = normalizeRecoveryArtifactRetirementPlan(planValue);
  if (authorization !== plan.exactAuthorization) {
    throw new Error(`Recovery artifact retirement requires exact authorization: ${plan.exactAuthorization}`);
  }
  return freeze({
    planDigest: plan.planDigest,
    authorizationDigest: digestValue({
      schema: "agentic-recovery-artifact-retirement-authorization/v1",
      planDigest: plan.planDigest,
      authorization,
    }),
  });
}

export function createRecoveryArtifactRetirementIntent({ plan: planValue, authorization }) {
  const plan = normalizeRecoveryArtifactRetirementPlan(planValue);
  const authorized = authorizeRecoveryArtifactRetirement(plan, authorization);
  return sealIntent({
    schema: RECOVERY_ARTIFACT_RETIREMENT_INTENT_SCHEMA,
    status: "prepared", plan, planDigest: plan.planDigest,
    subjectKey: plan.subjectKey, authorizationDigest: authorized.authorizationDigest,
    phases: { prepared: { operationKey: operationKey(plan, "prepared") } },
  });
}

export function advanceRecoveryArtifactRetirementIntent(intentValue, { status, evidence }) {
  const intent = normalizeRecoveryArtifactRetirementIntent(intentValue);
  if (PHASES[PHASES.indexOf(intent.status) + 1] !== status) {
    throw new Error(`Retirement intent cannot advance from ${intent.status} to ${status}.`);
  }
  const phase = status === "archived"
    ? archiveObservation(evidence, intent.plan)
    : completeEvidence(evidence);
  return sealIntent({
    schema: RECOVERY_ARTIFACT_RETIREMENT_INTENT_SCHEMA,
    status, plan: intent.plan, planDigest: intent.planDigest,
    subjectKey: intent.subjectKey, authorizationDigest: intent.authorizationDigest,
    phases: { ...intent.phases, [status]: {
      operationKey: operationKey(intent.plan, status), ...phase,
    } },
  });
}

export function normalizeRecoveryArtifactRetirementIntent(value) {
  exact(value, ["schema", "status", "plan", "planDigest", "subjectKey",
    "authorizationDigest", "phases", "intentDigest"], "retirement intent");
  const plan = normalizeRecoveryArtifactRetirementPlan(value.plan);
  const status = oneOf(value.status, PHASES, "intent status");
  const expected = PHASES.slice(0, PHASES.indexOf(status) + 1);
  const phases = object(value.phases, "intent phases");
  if (canonicalJson(Object.keys(phases).sort()) !== canonicalJson([...expected].sort())) invalid("phase set");
  const normalizedPhases = {};
  for (const phase of expected) {
    const entry = object(phases[phase], `${phase} phase`);
    if (entry.operationKey !== operationKey(plan, phase)) invalid(`${phase} operation key`);
    normalizedPhases[phase] = phase === "prepared"
      ? exactReturn(entry, ["operationKey"], `${phase} phase`)
      : { operationKey: entry.operationKey, ...(phase === "archived"
        ? archiveObservation(entry, plan) : completeEvidence(entry)) };
  }
  const core = {
    schema: text(value.schema, "intent schema"), status, plan,
    planDigest: digest(value.planDigest, "intent plan"),
    subjectKey: digest(value.subjectKey, "intent subject"),
    authorizationDigest: digest(value.authorizationDigest, "intent authorization"),
    phases: normalizedPhases,
  };
  if (core.schema !== RECOVERY_ARTIFACT_RETIREMENT_INTENT_SCHEMA
    || core.planDigest !== plan.planDigest || core.subjectKey !== plan.subjectKey
    || value.intentDigest !== digestValue(core)) invalid("intent binding");
  if (status === "complete") {
    const archivedCore = { schema: core.schema, status: "archived", plan: core.plan,
      planDigest: core.planDigest, subjectKey: core.subjectKey,
      authorizationDigest: core.authorizationDigest,
      phases: { prepared: core.phases.prepared, archived: core.phases.archived } };
    if (core.phases.complete.archivedIntentDigest !== digestValue(archivedCore)) {
      invalid("complete archived-intent binding");
    }
  }
  return freeze({ ...core, intentDigest: value.intentDigest });
}

export function buildRecoveryArtifactRetirementReceipt(intentValue) {
  const intent = normalizeRecoveryArtifactRetirementIntent(intentValue);
  if (intent.status !== "archived") throw new Error("Retirement receipt requires archived intent.");
  const core = {
    schema: RECOVERY_ARTIFACT_RETIREMENT_RECEIPT_SCHEMA,
    status: "complete", planDigest: intent.planDigest, subjectKey: intent.subjectKey,
    authorizationDigest: intent.authorizationDigest,
    archivedIntentDigest: intent.intentDigest,
    archive: archiveObservation(intent.phases.archived, intent.plan),
    cleanup: intent.plan.evidence.cleanup,
    effects: EFFECTS,
  };
  return freeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeRecoveryArtifactRetirementReceipt(value) {
  exact(value, ["schema", "status", "planDigest", "subjectKey", "authorizationDigest",
    "archivedIntentDigest", "archive", "cleanup", "effects", "receiptDigest"], "retirement receipt");
  const core = {
    schema: text(value.schema, "receipt schema"), status: text(value.status, "receipt status"),
    planDigest: digest(value.planDigest, "receipt plan"),
    subjectKey: digest(value.subjectKey, "receipt subject"),
    authorizationDigest: digest(value.authorizationDigest, "receipt authorization"),
    archivedIntentDigest: digest(value.archivedIntentDigest, "archived intent"),
    archive: archiveObservation(value.archive), cleanup: cleanup(value.cleanup), effects: value.effects,
  };
  if (core.schema !== RECOVERY_ARTIFACT_RETIREMENT_RECEIPT_SCHEMA || core.status !== "complete"
    || canonicalJson(core.effects) !== canonicalJson(EFFECTS)
    || value.receiptDigest !== digestValue(core)) invalid("receipt");
  return freeze({ ...core, receiptDigest: value.receiptDigest });
}

function cleanup(value) {
  exact(value, ["kind", "sourceDirectory", "intentStatus", "intentRawSha256",
    "receiptRawSha256", "cleanupPlanDigest", "subjectKey", "bundleSha256", "headSha",
    "treeSha", "headRef", "requiredDriftAcknowledgement"], "cleanup evidence");
  const result = {
    kind: oneOf(value.kind, ["complete-receipt", "reservation-released-journal"], "cleanup kind"),
    sourceDirectory: absolute(value.sourceDirectory, "cleanup source"),
    intentStatus: oneOf(value.intentStatus, ["complete", "reservation_released"], "cleanup intent status"),
    intentRawSha256: digest(value.intentRawSha256, "cleanup intent bytes"),
    receiptRawSha256: nullableDigest(value.receiptRawSha256, "cleanup receipt bytes"),
    cleanupPlanDigest: digest(value.cleanupPlanDigest, "cleanup plan"),
    subjectKey: digest(value.subjectKey, "cleanup subject"),
    bundleSha256: digest(value.bundleSha256, "cleanup bundle"),
    headSha: sha(value.headSha, "cleanup head"), treeSha: sha(value.treeSha, "cleanup tree"),
    headRef: ref(value.headRef, "cleanup head ref"),
    requiredDriftAcknowledgement: nullableDigest(value.requiredDriftAcknowledgement, "required drift acknowledgement"),
  };
  if ((result.kind === "complete-receipt") !== (result.intentStatus === "complete")
    || (result.kind === "complete-receipt") !== (result.receiptRawSha256 !== null)
    || (result.kind === "reservation-released-journal")
      !== (result.requiredDriftAcknowledgement !== null)) invalid("cleanup disposition");
  return result;
}
function manifest(value) {
  exact(value, ["schema", "entryCount", "fileCount", "totalBytes", "entries", "manifestDigest"], "manifest");
  const entries = array(value.entries, "manifest entries").map(entry => {
    exact(entry, ["path", "type", "mode", "sizeBytes", "sha256"], "manifest entry");
    return { path: relative(entry.path, "manifest path"), type: oneOf(entry.type, ["directory", "file"], "entry type"),
      mode: integer(entry.mode, "entry mode"), sizeBytes: integer(entry.sizeBytes, "entry size"),
      sha256: entry.sha256 === null ? null : digest(entry.sha256, "entry bytes") };
  });
  if (canonicalJson(entries.map(item => item.path))
    !== canonicalJson([...entries].map(item => item.path).sort(compareUtf8))
    || new Set(entries.map(item => item.path)).size !== entries.length) invalid("manifest ordering");
  const core = { schema: text(value.schema, "manifest schema"), entryCount: integer(value.entryCount, "entry count"),
    fileCount: integer(value.fileCount, "file count"), totalBytes: integer(value.totalBytes, "total bytes"), entries };
  if (core.schema !== "agentic-recovery-artifact-manifest/v1" || core.entryCount !== entries.length
    || core.fileCount !== entries.filter(item => item.type === "file").length
    || core.totalBytes !== entries.reduce((sum, item) => sum + item.sizeBytes, 0)
    || entries.some(item => (item.type === "file") !== (item.sha256 !== null))
    || value.manifestDigest !== digestValue(core)) invalid("manifest");
  return { ...core, manifestDigest: value.manifestDigest };
}
function bundle(value) {
  exact(value, ["path", "sha256", "sizeBytes", "headSha", "treeSha", "headRef", "verified"], "bundle");
  return { path: absolute(value.path, "bundle path"), sha256: digest(value.sha256, "bundle bytes"),
    sizeBytes: integer(value.sizeBytes, "bundle size"), headSha: sha(value.headSha, "bundle head"),
    treeSha: sha(value.treeSha, "bundle tree"), headRef: ref(value.headRef, "bundle ref"),
    verified: value.verified === true ? true : invalid("bundle verification") };
}
function integration(value) {
  exact(value, ["canonicalRef", "canonicalSha", "canonicalTreeSha", "remoteMainSha", "headSha",
    "treeSha", "disposition", "parentSha"], "integration");
  const result = { canonicalRef: value.canonicalRef, canonicalSha: sha(value.canonicalSha, "canonical SHA"),
    canonicalTreeSha: sha(value.canonicalTreeSha, "canonical tree"), remoteMainSha: sha(value.remoteMainSha, "remote main"),
    headSha: sha(value.headSha, "integration head"), treeSha: sha(value.treeSha, "integration tree"),
    disposition: oneOf(value.disposition, ["ancestor", "empty-coordination"], "integration disposition"),
    parentSha: value.parentSha === null ? null : sha(value.parentSha, "integration parent") };
  if (result.canonicalRef !== "refs/remotes/origin/main" || result.canonicalSha !== result.remoteMainSha
    || (result.disposition === "ancestor") !== (result.parentSha === null)) invalid("integration proof");
  return result;
}
function repository(value, label) {
  exact(value, ["root", "gitCommonDir", "identityDigest"], label);
  return { root: absolute(value.root, `${label} root`), gitCommonDir: absolute(value.gitCommonDir, `${label} Git common directory`),
    identityDigest: digest(value.identityDigest, `${label} identity`) };
}
function archiveObservation(value, plan = null) {
  exact(value, ["operationKey", "sourceAbsent", "archivePath", "archivePresent", "manifestDigest"].filter(k => k !== "operationKey" || Object.hasOwn(value, k)), "archive observation");
  const result = { sourceAbsent: value.sourceAbsent === true ? true : invalid("source absence"),
    archivePath: absolute(value.archivePath, "archive path"), archivePresent: value.archivePresent === true ? true : invalid("archive presence"),
    manifestDigest: digest(value.manifestDigest, "archive manifest") };
  if (plan && (result.archivePath !== plan.archivePath || result.manifestDigest !== plan.evidence.manifest.manifestDigest)) invalid("archive binding");
  return result;
}
function completeEvidence(value) {
  exact(value, ["operationKey", "receiptDigest", "archivedIntentDigest"].filter(k => k !== "operationKey" || Object.hasOwn(value, k)), "complete evidence");
  return { receiptDigest: digest(value.receiptDigest, "retirement receipt"),
    archivedIntentDigest: digest(value.archivedIntentDigest, "archived intent") };
}
function sealIntent(core) { return freeze({ ...core, intentDigest: digestValue(core) }); }
function operationKey(plan, phase) { return digestValue({ schema: "agentic-recovery-artifact-retirement-operation/v1", planDigest: plan.planDigest, phase }); }
function exact(value, keys, label) { if (!value || typeof value !== "object" || Array.isArray(value)
  || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) invalid(label); }
function exactReturn(value, keys, label) { exact(value, keys, label); return { ...value }; }
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); return value; }
function array(value, label) { if (!Array.isArray(value)) invalid(label); return value; }
function text(value, label) { if (typeof value !== "string" || !value || value !== value.trim()) invalid(label); return value; }
function digest(value, label) { if (!DIGEST.test(String(value))) invalid(label); return value; }
function nullableDigest(value, label) { return value === null ? null : digest(value, label); }
function sha(value, label) { if (!SHA.test(String(value))) invalid(label); return value; }
function ref(value, label) { if (typeof value !== "string" || !value.startsWith("refs/heads/") || /[\s~^:?*[\\]/u.test(value)) invalid(label); return value; }
function absolute(value, label) { if (typeof value !== "string" || !value.startsWith("/") || value === "/" || value.includes("/../") || value.endsWith("/..") || value.includes("//") || value.endsWith("/")) invalid(label); return value; }
function relative(value, label) { if (typeof value !== "string" || !value || value.startsWith("/") || value.split("/").includes("..") || value.includes("//")) invalid(label); return value; }
function integer(value, label) { if (!Number.isSafeInteger(value) || value < 0) invalid(label); return value; }
function compareUtf8(left, right) { return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")); }
function oneOf(value, values, label) { if (!values.includes(value)) invalid(label); return value; }
function invalid(label) { throw new Error(`Recovery artifact retirement ${label} is invalid.`); }
function freeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) freeze(item); } return value; }
function contains(parent, child) { return child === parent || child.startsWith(`${parent}/`); }
function assertPathIsolation(evidence, archivePath) {
  const journal = `${evidence.owner.gitCommonDir}/agentic-canvas-os/recovery-artifact-retirement`;
  if (contains(evidence.source, evidence.archiveRoot) || contains(evidence.archiveRoot, evidence.source)
    || contains(evidence.source, archivePath) || contains(archivePath, evidence.source)
    || contains(evidence.source, journal) || contains(journal, evidence.source)
    || contains(evidence.archiveRoot, journal) || contains(journal, evidence.archiveRoot)) {
    throw new Error("Recovery artifact source, archive, and durable journal must be disjoint.");
  }
}
