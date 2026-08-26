// Responsibility: Seal one exact-authorized planned-dirty admission repair and its replay journal.
import { canonicalJson, digestValue }
  from "./cloud-collaboration-primitives.mjs";
import { normalizePlannedDirtyAdmissionRecoveryEvidence }
  from "./planned-dirty-admission-recovery-evidence.mjs";

export const OPERATION = "planned-dirty-admission-recovery";
export const PLAN_SCHEMA = "agentic-planned-dirty-admission-recovery-plan/v1";
export const INTENT_SCHEMA = "agentic-planned-dirty-admission-recovery-intent/v1";
export const COMPLETION_SCHEMA =
  "agentic-planned-dirty-admission-recovery-completion/v1";
export const PHASES = Object.freeze([
  "authorized",
  "registry-projected",
  "pr-marker-projected",
  "complete",
]);
export function buildPlannedDirtyAdmissionRecoveryPlan(input = {}) {
  const evidence = input && typeof input === "object" && Object.hasOwn(input, "evidence")
    ? input.evidence : input;
  const source = normalizePlannedDirtyAdmissionRecoveryEvidence(evidence);
  const core = {
    schema: PLAN_SCHEMA,
    operation: OPERATION,
    evidence: source,
    allowedMutations: source.mutationBoundary.allowedMutations,
    forbiddenEffects: source.mutationBoundary.forbiddenEffects,
    terminalStatus: "mutation-authority-restored",
    terminalAdmissionStatus: "admitted",
  };
  return deepFreeze({ ...core, planDigest: digestValue(core) });
}

export function normalizePlannedDirtyAdmissionRecoveryPlan(value) {
  if (value?.schema !== PLAN_SCHEMA || value.operation !== OPERATION) {
    invalid("plan schema or operation");
  }
  const rebuilt = buildPlannedDirtyAdmissionRecoveryPlan({ evidence: value.evidence });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("canonical plan projection");
  return rebuilt;
}

export function authorizePlannedDirtyAdmissionRecovery(planOrInput, authorizationValue) {
  const plan = planOrInput?.plan && authorizationValue === undefined
    ? planOrInput.plan : planOrInput;
  const authorization = planOrInput?.plan && authorizationValue === undefined
    ? planOrInput.authorization : authorizationValue;
  const sealed = normalizePlannedDirtyAdmissionRecoveryPlan(plan);
  const exactAuthorization = `authorize ${OPERATION} ${sealed.planDigest}`;
  if (authorization !== exactAuthorization) {
    throw new Error(`Exact authorization required: ${exactAuthorization}`);
  }
  const core = {
    schema: "agentic-planned-dirty-admission-recovery-authorization/v1",
    planDigest: sealed.planDigest,
    exactAuthorization,
  };
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createRecoveryIntent({ plan, authorization, taskAuthority } = {}) {
  const sealed = normalizePlannedDirtyAdmissionRecoveryPlan(plan);
  const authority = record(authorization, "authorization receipt");
  const task = record(taskAuthority, "task-authority receipt");
  const taskAuthorityReceiptDigest = task.receiptDigest
    || task.taskAuthorityReceiptDigest;
  const taskProofDigest = task.proofDigest || task.taskProofDigest;
  const taskAuthorityBindingDigest = task.bindingDigest
    || task.taskAuthorityBindingDigest;
  digest(authority.authorizationDigest, "authorization digest");
  digest(taskAuthorityReceiptDigest, "task-authority receipt digest");
  digest(taskProofDigest, "task-authority proof digest");
  if (taskAuthorityBindingDigest !== undefined) {
    digest(taskAuthorityBindingDigest, "task-authority binding digest");
    if (taskAuthorityBindingDigest !== sealed.evidence.taskAuthorityBindingDigest) {
      invalid("task-authority binding join");
    }
  }
  if (authority.planDigest !== sealed.planDigest) invalid("authorization plan join");
  const first = phaseReceipt(sealed, "authorized", null, {
    authorizationDigest: authority.authorizationDigest,
    taskAuthorityReceiptDigest,
    taskProofDigest,
    ...(taskAuthorityBindingDigest ? { taskAuthorityBindingDigest } : {}),
  });
  return sealIntent({
    plan: sealed,
    status: "authorized",
    phases: { authorized: first },
  });
}

export function advanceRecoveryIntent(value, { status, values } = {}) {
  const current = normalizeRecoveryIntent(value);
  const sourceIndex = PHASES.indexOf(current.status);
  if (PHASES.indexOf(status) !== sourceIndex + 1) invalid("phase transition");
  const receipt = phaseReceipt(
    current.planSnapshot,
    status,
    current.phases[current.status].receiptDigest,
    values,
  );
  return sealIntent({
    plan: current.planSnapshot,
    status,
    phases: { ...current.phases, [status]: receipt },
  });
}

export function normalizeRecoveryIntent(value) {
  if (value?.schema !== INTENT_SCHEMA || !PHASES.includes(value.status)) {
    invalid("intent schema or status");
  }
  const plan = normalizePlannedDirtyAdmissionRecoveryPlan(value.planSnapshot);
  const names = PHASES.slice(0, PHASES.indexOf(value.status) + 1);
  if (canonicalJson(Object.keys(value.phases || {})) !== canonicalJson(names)) {
    invalid("intent phase set");
  }
  const phases = {};
  let previousReceiptDigest = null;
  for (const name of names) {
    const receipt = phaseReceipt(
      plan,
      name,
      previousReceiptDigest,
      value.phases?.[name]?.values,
    );
    phases[name] = receipt;
    previousReceiptDigest = receipt.receiptDigest;
  }
  const rebuilt = sealIntent({ plan, status: value.status, phases });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("canonical intent projection");
  return rebuilt;
}

export function buildCompletionReceipt(value) {
  const intent = normalizeRecoveryIntent(value);
  if (intent.status !== "complete") invalid("completion phase");
  const plan = intent.planSnapshot;
  const registry = intent.phases["registry-projected"].values;
  const marker = intent.phases["pr-marker-projected"].values;
  const terminal = intent.phases.complete.values;
  const core = {
    schema: COMPLETION_SCHEMA,
    status: "mutation-authority-restored",
    admissionStatus: "admitted",
    planDigest: plan.planDigest,
    sourceLeaseDigest: digest(plan.evidence.sourceLeaseDigest, "source lease digest"),
    targetLeaseDigest: digest(registry.leaseDigest, "target lease digest"),
    sealedDirtDigest: digest(plan.evidence.dirtDigest, "sealed dirt digest"),
    markerDigest: digest(marker.markerDigest, "pull-request marker digest"),
    plannedMutationAuthorityReceiptDigest: digest(
      registry.plannedMutationAuthorityReceiptDigest,
      "planned mutation-authority receipt digest",
    ),
    mutationAuthorityReceiptDigest: digest(
      terminal.mutationAuthorityReceiptDigest,
      "mutation-authority receipt digest",
    ),
    terminalEvidenceDigest: digest(
      terminal.terminalEvidenceDigest,
      "terminal evidence digest",
    ),
    journalDigest: intent.intentDigest,
    privateJournalMutation: true,
    writerRegistryMutation: true,
    pullRequestMarkerMutation: true,
    sourceMutation: false,
    indexMutation: false,
    gitMutation: false,
    cloudMutation: false,
    refMutation: false,
    localRefMutation: false,
    remoteRefMutation: false,
    pullRequestStateMutation: false,
    mergeMutation: false,
    deploymentMutation: false,
    releaseMutation: false,
    cleanupMutation: false,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

export function stableTerminalEvidenceDigest(values) {
  return digest(record(values, "terminal evidence").terminalEvidenceDigest,
    "terminal evidence digest");
}

function phaseReceipt(plan, phase, previousReceiptDigest, values) {
  if (!PHASES.includes(phase)) invalid("phase");
  const normalizedValues = normalizePhaseValues(phase, values);
  const core = {
    schema: "agentic-planned-dirty-admission-recovery-phase/v1",
    phase,
    planDigest: plan.planDigest,
    previousReceiptDigest,
    operationKey: `${OPERATION}:${phase}:${digestValue({ planDigest: plan.planDigest, phase })}`,
    values: normalizedValues,
    valuesDigest: digestValue(normalizedValues),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizePhaseValues(phase, values) {
  const source = structuredClone(record(values, `${phase} values`));
  if (phase === "authorized") {
    digest(source.authorizationDigest, "authorization digest");
    digest(source.taskAuthorityReceiptDigest, "task-authority receipt digest");
    digest(source.taskProofDigest, "task-authority proof digest");
    optionalDigest(source.taskAuthorityBindingDigest, "task-authority binding digest");
  } else if (phase === "registry-projected") {
    digest(source.leaseDigest, "projected lease digest");
    optionalDigest(source.preservationReceiptDigest, "preservation receipt digest");
    const plannedMutationAuthorityReceiptDigest = source.plannedMutationAuthorityReceiptDigest
      || source.mutationAuthorityReceiptDigest;
    optionalDigest(plannedMutationAuthorityReceiptDigest,
      "planned mutation-authority receipt digest");
    if (source.plannedMutationAuthorityReceiptDigest && source.mutationAuthorityReceiptDigest
      && source.plannedMutationAuthorityReceiptDigest !== source.mutationAuthorityReceiptDigest) {
      invalid("planned mutation-authority receipt alias");
    }
    if (plannedMutationAuthorityReceiptDigest) {
      source.plannedMutationAuthorityReceiptDigest = plannedMutationAuthorityReceiptDigest;
      delete source.mutationAuthorityReceiptDigest;
    }
    if (source.adopted !== undefined && typeof source.adopted !== "boolean") {
      invalid("registry adoption disposition");
    }
    if (source.registryRevision !== undefined
      && (!Number.isSafeInteger(source.registryRevision) || source.registryRevision < 0)) {
      invalid("projected registry revision");
    }
  } else if (phase === "pr-marker-projected") {
    digest(source.markerDigest, "projected marker digest");
    optionalDigest(source.bodyDigest, "projected review body digest");
    optionalDigest(source.receiptDigest, "marker projection receipt digest");
    if (source.adopted !== undefined && typeof source.adopted !== "boolean") {
      invalid("marker adoption disposition");
    }
  } else if (phase === "complete") {
    digest(source.mutationAuthorityReceiptDigest, "terminal mutation-authority receipt digest");
    digest(source.terminalEvidenceDigest, "terminal evidence digest");
    optionalDigest(source.leaseDigest, "terminal lease digest");
    optionalDigest(source.markerDigest, "terminal marker digest");
    optionalDigest(source.bodyDigest, "terminal review body digest");
    optionalDigest(source.dirtDigest, "terminal dirt digest");
    optionalDigest(source.cloudAuthoritySubjectDigest, "terminal cloud subject digest");
    optionalDigest(source.cloudVerificationReceiptDigest,
      "terminal cloud verification receipt digest");
    for (const field of ["sourceBytesChanged", "indexChanged", "headChanged",
      "refsChanged", "cloudChanged", "pullRequestStateChanged"]) {
      if (source[field] !== undefined && source[field] !== false) {
        invalid(`terminal ${field} denial`);
      }
    }
  }
  return deepFreeze(source);
}

function sealIntent({ plan, status, phases }) {
  assertPhaseLineage(plan, phases);
  const core = {
    schema: INTENT_SCHEMA,
    status,
    planDigest: plan.planDigest,
    planSnapshot: plan,
    phases,
  };
  return deepFreeze({ ...core, intentDigest: digestValue(core) });
}

function assertPhaseLineage(plan, phases) {
  const registry = phases["registry-projected"]?.values;
  const marker = phases["pr-marker-projected"]?.values;
  const terminal = phases.complete?.values;
  if (!terminal) return;
  if ((terminal.leaseDigest !== undefined && terminal.leaseDigest !== registry.leaseDigest)
    || (terminal.markerDigest !== undefined && terminal.markerDigest !== marker.markerDigest)
    || (terminal.bodyDigest !== undefined && marker.bodyDigest !== undefined
      && terminal.bodyDigest !== marker.bodyDigest)
    || (terminal.dirtDigest !== undefined
      && terminal.dirtDigest !== plan.evidence.dirtDigest)
    || (terminal.cloudAuthoritySubjectDigest !== undefined
      && terminal.cloudAuthoritySubjectDigest !== plan.evidence.cloudAuthoritySubjectDigest)) {
    invalid("terminal phase lineage");
  }
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function digest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label);
  return value;
}
function optionalDigest(value, label) {
  if (value !== undefined) digest(value, label);
}
function invalid(label) {
  throw new Error(`Planned-dirty admission recovery has invalid ${label}.`);
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
