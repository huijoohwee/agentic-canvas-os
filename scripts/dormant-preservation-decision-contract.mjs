// Responsibility: Bind dormant-preservation admission plans, exact authorization, monotonic intent, and receipts.
import path from "node:path";

import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  assertDormantPreservationAdmissionSourceEvidence,
  normalizeDormantPreservationAdmissionExecutionEvidence,
  normalizeDormantPreservationAdmissionSourceEvidence,
} from "./dormant-preservation-decision-evidence.mjs";

export const DORMANT_PRESERVATION_ADMISSION_PLAN_SCHEMA =
  "agentic-dormant-preservation-admission-plan/v2";
export const DORMANT_PRESERVATION_ADMISSION_AUTHORIZATION_SCHEMA =
  "agentic-dormant-preservation-admission-authorization/v1";
export const DORMANT_PRESERVATION_ADMISSION_INTENT_SCHEMA =
  "agentic-dormant-preservation-admission-intent/v1";
export const DORMANT_PRESERVATION_ADMISSION_RECEIPT_SCHEMA =
  "agentic-dormant-preservation-admission-receipt/v1";
export const DORMANT_PRESERVATION_ADMISSION_PHASES = Object.freeze([
  "admitted", "complete",
]);

const DEVICE_START_INVOCATION_SCHEMA =
  "agentic-dormant-preservation-device-start-invocation/v1";
const OPERATION_KEY_SCHEMA =
  "agentic-dormant-preservation-admission-operation-key/v1";
const STATUSES = Object.freeze(["authorized", ...DORMANT_PRESERVATION_ADMISSION_PHASES]);
const PLAN_DIGEST_PLACEHOLDER = "--operator-decision-digest={planDigest}";
const AUTHORIZATION_PLACEHOLDER =
  "--dormant-preservation-authorization={authorization}";
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

export function buildDormantPreservationAdmissionPlan({
  sourceEvidence, nestedDeviceStart,
}) {
  const source = normalizeDormantPreservationAdmissionSourceEvidence(sourceEvidence);
  const nested = assertNestedDeviceStartSubject(
    source, normalizeNestedDeviceStart(nestedDeviceStart),
  );
  const core = {
    schema: DORMANT_PRESERVATION_ADMISSION_PLAN_SCHEMA,
    operation: "dormant-preservation-admission",
    sourceEvidence: source,
    sourceEvidenceDigest: source.sourceEvidenceDigest,
    nestedDeviceStart: nested,
  };
  return sealPlan(core);
}

export function normalizeDormantPreservationAdmissionPlan(value) {
  requireObject(value, "Dormant-preservation admission plan");
  exactKeys(value, [
    "deviceStartArgv", "deviceStartArgvDigest", "exactAuthorization",
    "nestedDeviceStart", "operation", "planDigest", "schema",
    "sourceEvidence", "sourceEvidenceDigest",
  ], "Dormant-preservation admission plan");
  const source = normalizeDormantPreservationAdmissionSourceEvidence(value.sourceEvidence);
  const nested = assertNestedDeviceStartSubject(
    source, normalizeNestedDeviceStart(value.nestedDeviceStart),
  );
  const core = {
    schema: text(value.schema, "Plan schema"),
    operation: text(value.operation, "Plan operation"),
    sourceEvidence: source,
    sourceEvidenceDigest: digest(value.sourceEvidenceDigest, "Plan source evidence digest"),
    nestedDeviceStart: nested,
  };
  if (core.schema !== DORMANT_PRESERVATION_ADMISSION_PLAN_SCHEMA
    || core.operation !== "dormant-preservation-admission"
    || core.sourceEvidenceDigest !== source.sourceEvidenceDigest) {
    throw new Error("Dormant-preservation admission plan semantics are invalid.");
  }
  const expected = sealPlan(core);
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Error("Dormant-preservation admission plan digest or derived invocation drifted.");
  }
  return expected;
}

export function materializeDormantPreservationDeviceStartArgv(plan) {
  return normalizeDormantPreservationAdmissionPlan(plan).deviceStartArgv;
}

export function authorizeDormantPreservationAdmission(plan, authorization) {
  const normalized = normalizeDormantPreservationAdmissionPlan(plan);
  if (typeof authorization !== "string" || authorization !== normalized.exactAuthorization) {
    throw new Error(
      `Dormant-preservation admission requires exact authorization: ${normalized.exactAuthorization}`,
    );
  }
  const core = {
    schema: DORMANT_PRESERVATION_ADMISSION_AUTHORIZATION_SCHEMA,
    planDigest: normalized.planDigest,
    sourceEvidenceDigest: normalized.sourceEvidenceDigest,
    operatorDecisionDigest: normalized.planDigest,
    authorization,
    deviceStartArgvDigest: normalized.deviceStartArgvDigest,
  };
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createDormantPreservationAdmissionIntent(plan, authorizationReceipt) {
  const normalizedPlan = normalizeDormantPreservationAdmissionPlan(plan);
  const authorization = normalizeAuthorization(authorizationReceipt, normalizedPlan);
  return sealIntent({
    schema: DORMANT_PRESERVATION_ADMISSION_INTENT_SCHEMA,
    planDigest: normalizedPlan.planDigest,
    planSnapshot: normalizedPlan,
    authorizationDigest: authorization.authorizationDigest,
    status: "authorized",
    phases: {},
  });
}

export function normalizeDormantPreservationAdmissionIntent(value) {
  requireObject(value, "Dormant-preservation admission intent");
  exactKeys(value, [
    "authorizationDigest", "intentDigest", "phases", "planDigest",
    "planSnapshot", "schema", "status",
  ], "Dormant-preservation admission intent");
  const plan = normalizeDormantPreservationAdmissionPlan(value.planSnapshot);
  const status = requiredStatus(value.status);
  const authorizationDigest = digest(value.authorizationDigest, "Intent authorization digest");
  const phases = normalizeIntentPhases(value.phases, plan, status, authorizationDigest);
  const core = {
    schema: text(value.schema, "Intent schema"),
    planDigest: digest(value.planDigest, "Intent plan digest"),
    planSnapshot: plan,
    authorizationDigest,
    status,
    phases,
  };
  if (core.schema !== DORMANT_PRESERVATION_ADMISSION_INTENT_SCHEMA
    || core.planDigest !== plan.planDigest || value.intentDigest !== digestValue(core)) {
    throw new Error("Dormant-preservation admission intent is malformed or drifted.");
  }
  return deepFreeze({ ...core, intentDigest: value.intentDigest });
}

export function advanceDormantPreservationAdmissionIntent(intent, phase, evidence) {
  const normalized = normalizeDormantPreservationAdmissionIntent(intent);
  const nextStatus = requiredPhase(phase);
  const currentIndex = STATUSES.indexOf(normalized.status);
  const nextIndex = STATUSES.indexOf(nextStatus);
  const values = normalizePhaseValues(normalized, nextStatus, evidence);
  if (nextIndex === currentIndex) {
    if (canonicalJson(normalized.phases[nextStatus]?.values) !== canonicalJson(values)) {
      throw new Error(`Dormant-preservation ${nextStatus} replay drifted.`);
    }
    return normalized;
  }
  if (nextIndex !== currentIndex + 1) {
    throw new Error(
      `Dormant-preservation admission cannot advance from ${normalized.status} to ${nextStatus}.`,
    );
  }
  return sealIntent({
    schema: normalized.schema,
    planDigest: normalized.planDigest,
    planSnapshot: normalized.planSnapshot,
    authorizationDigest: normalized.authorizationDigest,
    status: nextStatus,
    phases: { ...normalized.phases, [nextStatus]: { values } },
  });
}

export function dormantPreservationAdmissionOperationKey(planDigest, phase) {
  return digestValue({
    schema: OPERATION_KEY_SCHEMA,
    planDigest: digest(planDigest, "Operation-key plan digest"),
    phase: requiredPhase(phase),
  });
}

export function buildDormantPreservationAdmissionReceipt(intent) {
  const admitted = normalizeDormantPreservationAdmissionIntent(intent);
  if (admitted.status !== "admitted") {
    throw new Error("Admission receipt requires the exact admitted intent.");
  }
  const execution = admitted.phases.admitted.values.executionEvidence;
  const core = receiptCore(admitted, execution);
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

export function normalizeDormantPreservationAdmissionReceipt(value, expectedIntent = null) {
  requireObject(value, "Dormant-preservation admission receipt");
  exactKeys(value, [
    "schema", "status", "planDigest", "authorizationDigest", "admittedIntentDigest",
    "operationKey", "sourceEvidenceDigest", "deviceStartArgvDigest",
    "dormantPreservationReceiptDigest", "admissionReportDigest", "admissionReceiptDigest",
    "preservationReceiptDigest", "mutationAuthorityReceiptDigest", "candidateStateDigest",
    "candidateLeaseDigest", "finalLaneSetDigest", "pullRequestNumber", "pullRequestHeadSha",
    "finalClaimId", "finalClaimRecordDigest", "finalInventoryStateDigest",
    "executionEvidenceDigest", "receiptDigest",
  ], "Dormant-preservation admission receipt");
  const core = {
    schema: text(value.schema, "Receipt schema"), status: text(value.status, "Receipt status"),
    planDigest: digest(value.planDigest, "Receipt plan digest"), authorizationDigest: digest(value.authorizationDigest, "Receipt authorization digest"),
    admittedIntentDigest: digest(value.admittedIntentDigest, "Receipt admitted intent digest"), operationKey: digest(value.operationKey, "Receipt operation key"),
    sourceEvidenceDigest: digest(value.sourceEvidenceDigest, "Receipt source evidence digest"), deviceStartArgvDigest: digest(value.deviceStartArgvDigest, "Receipt argv digest"),
    dormantPreservationReceiptDigest: digest(value.dormantPreservationReceiptDigest, "Receipt dormant-preservation digest"), admissionReportDigest: digest(value.admissionReportDigest, "Receipt admission-report digest"),
    admissionReceiptDigest: digest(value.admissionReceiptDigest, "Receipt admission digest"), preservationReceiptDigest: digest(value.preservationReceiptDigest, "Receipt preservation digest"),
    mutationAuthorityReceiptDigest: digest(value.mutationAuthorityReceiptDigest, "Receipt mutation-authority digest"), candidateStateDigest: digest(value.candidateStateDigest, "Receipt candidate-state digest"),
    candidateLeaseDigest: digest(value.candidateLeaseDigest, "Receipt candidate-lease digest"), finalLaneSetDigest: digest(value.finalLaneSetDigest, "Receipt final lane-set digest"), pullRequestNumber: positiveInteger(value.pullRequestNumber, "Receipt pull request number"),
    pullRequestHeadSha: sha(value.pullRequestHeadSha, "Receipt pull request head"), finalClaimId: digest(value.finalClaimId, "Receipt final claim ID"),
    finalClaimRecordDigest: digest(value.finalClaimRecordDigest, "Receipt final claim record digest"), finalInventoryStateDigest: digest(value.finalInventoryStateDigest, "Receipt final inventory-state digest"),
    executionEvidenceDigest: digest(value.executionEvidenceDigest, "Receipt execution-evidence digest"),
  };
  if (core.schema !== DORMANT_PRESERVATION_ADMISSION_RECEIPT_SCHEMA
    || core.status !== "admitted" || value.receiptDigest !== digestValue(core)) {
    throw new Error("Dormant-preservation admission receipt is invalid or drifted.");
  }
  if (expectedIntent) {
    const admitted = normalizeDormantPreservationAdmissionIntent(expectedIntent);
    if (admitted.status !== "admitted") {
      throw new Error("Receipt comparison requires an admitted intent.");
    }
    const expectedCore = receiptCore(admitted, admitted.phases.admitted.values.executionEvidence);
    const expected = deepFreeze({ ...expectedCore, receiptDigest: digestValue(expectedCore) });
    if (canonicalJson(expected) !== canonicalJson(value)) {
      throw new Error("Dormant-preservation admission receipt changed its admitted intent.");
    }
  }
  return deepFreeze({ ...core, receiptDigest: value.receiptDigest });
}

export function assertDormantPreservationAdmissionPreProvision(
  plan, observedSourceEvidence, actualArgv,
) {
  const normalized = normalizeDormantPreservationAdmissionPlan(plan);
  const observed = assertDormantPreservationAdmissionSourceEvidence(
    normalized.sourceEvidence, observedSourceEvidence,
  );
  const argv = normalizeArgv(actualArgv, "Actual device:start argv");
  if (canonicalJson(argv) !== canonicalJson(normalized.deviceStartArgv)
    || digestValue(argv) !== normalized.deviceStartArgvDigest) {
    throw new Error("Nested device:start argv drifted before provisioning.");
  }
  return deepFreeze({ plan: normalized, sourceEvidence: observed, deviceStartArgv: argv });
}

function sealPlan(core) {
  const planDigest = digestValue(core);
  const exactAuthorization = `authorize dormant-preservation-admission ${planDigest}`;
  const provisional = { ...core, planDigest, exactAuthorization };
  const deviceStartArgv = materializeArgv(provisional);
  return deepFreeze({
    ...provisional, deviceStartArgv, deviceStartArgvDigest: digestValue(deviceStartArgv),
  });
}

function normalizeNestedDeviceStart(value) {
  requireObject(value, "Nested device:start invocation");
  exactKeys(value, ["argvTemplate", "cwd", "derivedBindings", "executable", "schema"], "Nested device:start invocation");
  const argvTemplate = normalizeArgv(value.argvTemplate, "Nested device:start argv template");
  const derivedBindings = canonicalObject(value.derivedBindings, "Nested derived bindings");
  exactKeys(derivedBindings, ["authorization", "operatorDecisionDigest"], "Nested derived bindings");
  const result = {
    schema: text(value.schema, "Nested invocation schema"),
    executable: absolutePath(value.executable, "Nested executable"),
    cwd: absolutePath(value.cwd, "Nested invocation cwd"),
    argvTemplate,
    derivedBindings,
  };
  const planPlaceholders = argvTemplate.filter(item => item === PLAN_DIGEST_PLACEHOLDER);
  const authorizationPlaceholders = argvTemplate.filter(item => item === AUTHORIZATION_PLACEHOLDER);
  if (result.schema !== DEVICE_START_INVOCATION_SCHEMA
    || derivedBindings.operatorDecisionDigest !== "planDigest"
    || derivedBindings.authorization !== "exactAuthorization"
    || planPlaceholders.length !== 1 || authorizationPlaceholders.length !== 1
    || argvTemplate[1] !== "start" || !argvTemplate[0].endsWith("/scripts/device-branch.mjs")
    || !argvTemplate.includes("--provision")
    || argvTemplate.some(item => item.startsWith("--operator-decision-digest=")
      && item !== PLAN_DIGEST_PLACEHOLDER)
    || argvTemplate.some(item => item.startsWith("--dormant-preservation-authorization=")
      && item !== AUTHORIZATION_PLACEHOLDER)) {
    throw new Error("Nested invocation must be one exact provisioned device:start command template.");
  }
  return deepFreeze(result);
}

function assertNestedDeviceStartSubject(source, nested) {
  const expectedScript = path.join(source.controller.path, "scripts", "device-branch.mjs");
  if (nested.executable !== process.execPath || nested.cwd !== source.canonical.canonicalPath
    || nested.argvTemplate[0] !== expectedScript) {
    throw new Error("Nested device:start executable, cwd, or controller script subject drifted.");
  }
  return nested;
}

function materializeArgv(plan) {
  return deepFreeze(plan.nestedDeviceStart.argvTemplate.map((item) => {
    if (item === PLAN_DIGEST_PLACEHOLDER) return `--operator-decision-digest=${plan.planDigest}`;
    if (item === AUTHORIZATION_PLACEHOLDER) return `--dormant-preservation-authorization=${plan.exactAuthorization}`;
    return item;
  }));
}

function normalizeAuthorization(value, plan) {
  requireObject(value, "Dormant-preservation authorization receipt");
  exactKeys(value, ["authorization", "authorizationDigest", "deviceStartArgvDigest",
    "operatorDecisionDigest", "planDigest", "schema", "sourceEvidenceDigest"],
  "Dormant-preservation authorization receipt");
  const core = {
    schema: text(value.schema, "Authorization schema"), planDigest: digest(value.planDigest, "Authorization plan digest"),
    sourceEvidenceDigest: digest(value.sourceEvidenceDigest, "Authorization source evidence digest"), operatorDecisionDigest: digest(value.operatorDecisionDigest, "Authorization operator-decision digest"),
    authorization: exactText(value.authorization, "Authorization text"), deviceStartArgvDigest: digest(value.deviceStartArgvDigest, "Authorization argv digest"),
  };
  if (core.schema !== DORMANT_PRESERVATION_ADMISSION_AUTHORIZATION_SCHEMA
    || core.planDigest !== plan.planDigest || core.sourceEvidenceDigest !== plan.sourceEvidenceDigest
    || core.operatorDecisionDigest !== plan.planDigest || core.authorization !== plan.exactAuthorization
    || core.deviceStartArgvDigest !== plan.deviceStartArgvDigest
    || value.authorizationDigest !== digestValue(core)) {
    throw new Error("Dormant-preservation authorization receipt is invalid.");
  }
  return deepFreeze({ ...core, authorizationDigest: value.authorizationDigest });
}

function normalizeIntentPhases(value, plan, status, authorizationDigest) {
  requireObject(value, "Intent phases");
  const result = {};
  const statusIndex = STATUSES.indexOf(status);
  if (statusIndex >= 1) {
    requireObject(value.admitted, "admitted intent phase");
    exactKeys(value.admitted, ["values"], "admitted intent phase");
    result.admitted = deepFreeze({ values: normalizePhaseValues(
      { planSnapshot: plan, authorizationDigest, intentDigest: null, status: "authorized", phases: {} },
      "admitted", value.admitted.values.executionEvidence, value.admitted.values.operationKey,
    ) });
  }
  if (statusIndex >= 2) {
    requireObject(value.complete, "complete intent phase");
    exactKeys(value.complete, ["values"], "complete intent phase");
    const admittedCore = {
      schema: DORMANT_PRESERVATION_ADMISSION_INTENT_SCHEMA,
      planDigest: plan.planDigest, planSnapshot: plan, authorizationDigest,
      status: "admitted", phases: { admitted: result.admitted },
    };
    result.complete = deepFreeze({ values: normalizePhaseValues(
      { ...admittedCore, intentDigest: digestValue(admittedCore) },
      "complete", value.complete.values.receipt, value.complete.values.operationKey,
    ) });
  }
  if (Object.keys(value).some(key => !Object.hasOwn(result, key))) {
    throw new Error("Intent contains an out-of-order dormant-preservation phase.");
  }
  return deepFreeze(result);
}

function normalizePhaseValues(intent, phase, evidence, providedOperationKey = null) {
  const expectedKey = dormantPreservationAdmissionOperationKey(intent.planSnapshot.planDigest, phase);
  if (phase === "admitted") {
    const executionEvidence = normalizeDormantPreservationAdmissionExecutionEvidence(evidence);
    if (executionEvidence.planDigest !== intent.planSnapshot.planDigest
      || executionEvidence.operationKey !== expectedKey
      || (providedOperationKey && providedOperationKey !== expectedKey)) {
      throw new Error("Admitted execution evidence is not bound to this operation.");
    }
    return deepFreeze({ operationKey: expectedKey, executionEvidence });
  }
  const admittedIntent = intent.status === "complete"
    ? (() => {
      const core = {
      schema: DORMANT_PRESERVATION_ADMISSION_INTENT_SCHEMA,
      planDigest: intent.planSnapshot.planDigest,
      planSnapshot: intent.planSnapshot,
      authorizationDigest: intent.authorizationDigest,
      status: "admitted",
      phases: { admitted: intent.phases.admitted },
      };
      return deepFreeze({ ...core, intentDigest: digestValue(core) });
    })()
    : intent;
  const receipt = normalizeDormantPreservationAdmissionReceipt(evidence, admittedIntent);
  if (receipt.planDigest !== intent.planSnapshot.planDigest
    || receipt.admittedIntentDigest !== admittedIntent.intentDigest
    || (providedOperationKey && providedOperationKey !== expectedKey)) {
    throw new Error("Completion receipt is not bound to the admitted intent.");
  }
  return deepFreeze({ operationKey: expectedKey, receipt });
}

function receiptCore(intent, execution) {
  return {
    schema: DORMANT_PRESERVATION_ADMISSION_RECEIPT_SCHEMA,
    status: "admitted", planDigest: intent.planDigest, authorizationDigest: intent.authorizationDigest,
    admittedIntentDigest: intent.intentDigest, operationKey: execution.operationKey,
    sourceEvidenceDigest: execution.sourceEvidenceDigest, deviceStartArgvDigest: execution.deviceStartArgvDigest,
    dormantPreservationReceiptDigest: execution.dormantPreservationReceiptDigest,
    admissionReportDigest: execution.admissionReportDigest, admissionReceiptDigest: execution.admissionReceiptDigest,
    preservationReceiptDigest: execution.preservationReceiptDigest, mutationAuthorityReceiptDigest: execution.mutationAuthorityReceiptDigest,
    candidateStateDigest: execution.candidate.stateDigest, candidateLeaseDigest: execution.candidate.leaseDigest,
    finalLaneSetDigest: execution.postLaneSetDigest,
    pullRequestNumber: execution.candidate.pullRequestNumber, pullRequestHeadSha: execution.candidate.pullRequestHeadSha,
    finalClaimId: execution.finalCloud.claimId, finalClaimRecordDigest: execution.finalCloud.claimRecordDigest,
    finalInventoryStateDigest: execution.finalCloud.inventoryStateDigest,
    executionEvidenceDigest: execution.evidenceDigest,
  };
}

function sealIntent(core) {
  const frozen = deepFreeze(core);
  return deepFreeze({ ...frozen, intentDigest: digestValue(frozen) });
}
function normalizeArgv(value, label) {
  if (!Array.isArray(value) || value.length < 3 || value.length > 128) throw new Error(`${label} must contain 3 to 128 arguments.`);
  return deepFreeze(value.map((item, index) => exactText(item, `${label}[${index}]`)));
}
function canonicalObject(value, label) {
  requireObject(value, label);
  return JSON.parse(canonicalJson(value));
}
function exactKeys(value, keys, label) {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) throw new Error(`${label} has unexpected or missing fields.`);
}
function requiredPhase(value) {
  const phase = text(value, "Admission phase");
  if (!DORMANT_PRESERVATION_ADMISSION_PHASES.includes(phase)) throw new Error(`Unsupported admission phase: ${phase}.`);
  return phase;
}
function requiredStatus(value) {
  const status = text(value, "Admission status");
  if (!STATUSES.includes(status)) throw new Error(`Unsupported admission status: ${status}.`);
  return status;
}
function absolutePath(value, label) {
  const normalized = exactText(value, label);
  if (!path.isAbsolute(normalized) || path.normalize(normalized) !== normalized) throw new Error(`${label} must be an absolute normalized path.`);
  return normalized;
}
function sha(value, label) {
  const normalized = text(value, label);
  if (!/^[0-9a-f]{40}$/u.test(normalized)) throw new Error(`${label} must be a lowercase SHA.`);
  return normalized;
}
function digest(value, label) {
  const normalized = text(value, label);
  if (!DIGEST_PATTERN.test(normalized)) throw new Error(`${label} must be a SHA-256 digest.`);
  return normalized;
}
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}
function exactText(value, label) {
  if (typeof value !== "string" || !value || value !== value.normalize("NFC")) throw new Error(`${label} must be canonical non-empty text.`);
  return value;
}
function text(value, label) {
  const normalized = exactText(value, label);
  if (normalized !== normalized.trim()) throw new Error(`${label} must not have boundary whitespace.`);
  return normalized;
}
function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
