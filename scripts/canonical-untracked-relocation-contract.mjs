// Responsibility: Seal canonical-untracked relocation plans and completion receipts.
import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";

export const CANONICAL_UNTRACKED_RELOCATION_PLAN_SCHEMA =
  "agentic-canonical-untracked-relocation-plan/v1";
export const CANONICAL_UNTRACKED_RELOCATION_RECEIPT_SCHEMA =
  "agentic-canonical-untracked-relocation-receipt/v2";
export const CANONICAL_UNTRACKED_RELOCATION_OPERATION =
  "canonical-untracked-relocation";
const AUTHORITY_ATTEMPT_SCHEMA =
  "agentic-canonical-untracked-relocation-authority-attempt/v2";
const AUTHORITY_PHASES = new Set(["source-quarantine", "target-install"]);

const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;

export function createCanonicalUntrackedRelocationPlan(source) {
  const evidence = normalizeEvidence(source);
  const core = Object.freeze({
    schema: CANONICAL_UNTRACKED_RELOCATION_PLAN_SCHEMA,
    operation: CANONICAL_UNTRACKED_RELOCATION_OPERATION,
    evidence,
  });
  const planDigest = digestValue(core);
  return Object.freeze({
    ...core,
    planDigest,
    exactAuthorization: exactRelocationAuthorization(planDigest),
  });
}

export function assertCanonicalUntrackedRelocationPlan(value) {
  object(value, "relocation plan");
  const normalized = createCanonicalUntrackedRelocationPlan(value.evidence);
  if (
    value.schema !== normalized.schema
    || value.operation !== normalized.operation
    || value.planDigest !== normalized.planDigest
    || value.exactAuthorization !== normalized.exactAuthorization
  ) {
    throw new Error("Canonical-untracked relocation plan digest is invalid.");
  }
  return normalized;
}

export function assertCanonicalUntrackedRelocationAuthorization({ plan, authorization }) {
  const normalized = assertCanonicalUntrackedRelocationPlan(plan);
  if (String(authorization || "") !== normalized.exactAuthorization) {
    throw new Error(`Canonical-untracked relocation requires exact authorization: ${normalized.exactAuthorization}`);
  }
  return normalized;
}

export function exactRelocationAuthorization(planDigest) {
  return `authorize ${CANONICAL_UNTRACKED_RELOCATION_OPERATION} ${digest(planDigest, "plan digest")}`;
}

export function createCanonicalUntrackedRelocationReceipt({
  plan,
  taskAuthorityReceiptDigest,
  mutationAuthorityReceiptDigest,
  targetInstallAttempt,
  sourceQuarantineAttempt,
  targetInstalledDigest,
  sourceQuarantineDigest,
  completedAt,
}) {
  const normalized = assertCanonicalUntrackedRelocationPlan(plan);
  const subjectDigest = canonicalUntrackedRelocationSubject(normalized).subjectDigest;
  const fallback = phase => createCanonicalUntrackedRelocationAuthorityAttempt({
    plan: normalized,
    phase,
    taskAuthorityReceiptDigest,
    mutationAuthorityReceiptDigest,
    authorizedAt: completedAt,
  });
  const targetAuthority = targetInstallAttempt
    ? assertCanonicalUntrackedRelocationAuthorityAttempt(targetInstallAttempt) : fallback("target-install");
  const quarantineAuthority = sourceQuarantineAttempt
    ? assertCanonicalUntrackedRelocationAuthorityAttempt(sourceQuarantineAttempt) : fallback("source-quarantine");
  if (targetAuthority.phase !== "target-install"
    || quarantineAuthority.phase !== "source-quarantine"
    || targetAuthority.subjectDigest !== subjectDigest
    || quarantineAuthority.subjectDigest !== subjectDigest
    || quarantineAuthority.planDigest !== normalized.planDigest) {
    throw new Error("Canonical-untracked relocation authority lineage is not bound to its effects and plan.");
  }
  const core = Object.freeze({
    schema: CANONICAL_UNTRACKED_RELOCATION_RECEIPT_SCHEMA,
    status: "complete",
    operation: CANONICAL_UNTRACKED_RELOCATION_OPERATION,
    planDigest: normalized.planDigest,
    recoveryPackageDigest: normalized.evidence.recovery.packageDigest,
    sourceStateDigest: normalized.evidence.source.stateDigest,
    targetLeaseDigest: normalized.evidence.target.leaseDigest,
    cloudClaimId: normalized.evidence.target.cloudClaimId,
    taskAuthorityReceiptDigest: quarantineAuthority.taskAuthorityReceiptDigest,
    mutationAuthorityReceiptDigest: quarantineAuthority.mutationAuthorityReceiptDigest,
    authorityLineage: Object.freeze({
      targetInstall: targetAuthority,
      sourceQuarantine: quarantineAuthority,
    }),
    targetInstalledDigest: digest(targetInstalledDigest, "target installed digest"),
    sourceQuarantineDigest: digest(sourceQuarantineDigest, "source quarantine digest"),
    sourceSubtree: normalized.evidence.source.subtree,
    sourceWorktree: normalized.evidence.source.worktree,
    targetWorktree: normalized.evidence.target.worktree,
    quarantinePath: normalized.evidence.transaction.quarantinePath,
    relocatedPaths: normalized.evidence.recovery.paths,
    effects: Object.freeze({
      sourceRefMutation: false,
      targetRefMutation: false,
      remoteMutation: false,
      pullRequestMutation: false,
      cloudMutation: false,
      sourceSubtreeMovedToQuarantine: true,
      targetSubtreeInstalled: true,
      recoveryPackagePreserved: true,
    }),
    completedAt: instant(completedAt, "completion time"),
  });
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

export function assertCanonicalUntrackedRelocationReceipt(value, plan) {
  object(value, "relocation receipt");
  const normalized = createCanonicalUntrackedRelocationReceipt({
    plan,
    taskAuthorityReceiptDigest: value.taskAuthorityReceiptDigest,
    mutationAuthorityReceiptDigest: value.mutationAuthorityReceiptDigest,
    targetInstallAttempt: value.authorityLineage?.targetInstall,
    sourceQuarantineAttempt: value.authorityLineage?.sourceQuarantine,
    targetInstalledDigest: value.targetInstalledDigest,
    sourceQuarantineDigest: value.sourceQuarantineDigest,
    completedAt: value.completedAt,
  });
  if (digestValue(value) !== digestValue(normalized)) {
    throw new Error("Canonical-untracked relocation receipt is invalid or belongs to another plan.");
  }
  return normalized;
}

export function createCanonicalUntrackedRelocationAuthorityAttempt({
  plan,
  phase,
  taskAuthorityReceiptDigest,
  mutationAuthorityReceiptDigest,
  authorizedAt,
}) {
  const normalizedPlan = assertCanonicalUntrackedRelocationPlan(plan);
  const core = Object.freeze({
    schema: AUTHORITY_ATTEMPT_SCHEMA,
    phase: authorityPhase(phase),
    subjectDigest: canonicalUntrackedRelocationSubject(normalizedPlan).subjectDigest,
    planSnapshot: normalizedPlan,
    planDigest: normalizedPlan.planDigest,
    taskAuthorityReceiptDigest: digest(taskAuthorityReceiptDigest, "attempt task-authority receipt digest"),
    mutationAuthorityReceiptDigest: digest(
      mutationAuthorityReceiptDigest,
      "attempt mutation-authority receipt digest",
    ),
    authorizedAt: instant(authorizedAt, "attempt authorization time"),
  });
  return Object.freeze({ ...core, attemptDigest: digestValue(core) });
}

export function assertCanonicalUntrackedRelocationAuthorityAttempt(value) {
  object(value, "relocation authority attempt");
  const normalized = createCanonicalUntrackedRelocationAuthorityAttempt({
    plan: value.planSnapshot,
    phase: value.phase,
    taskAuthorityReceiptDigest: value.taskAuthorityReceiptDigest,
    mutationAuthorityReceiptDigest: value.mutationAuthorityReceiptDigest,
    authorizedAt: value.authorizedAt,
  });
  if (digestValue(value) !== digestValue(normalized)) {
    throw new Error("Canonical-untracked relocation authority attempt is invalid.");
  }
  return normalized;
}

export function canonicalUntrackedRelocationOperationLayout(plan) {
  const normalized = assertCanonicalUntrackedRelocationPlan(plan);
  const { source, recovery, target } = normalized.evidence;
  const transaction = deriveCanonicalUntrackedRelocationLayout({ source, recovery, target,
    receiptPath: normalized.evidence.transaction.receiptPath });
  const sourceOperationId = digestValue({
    commonDirectory: source.commonDirectory,
    sourceWorktree: source.worktree,
  });
  const operationRoot = path.join(source.commonDirectory, "agentic-canvas-os",
    "canonical-untracked-relocation", sourceOperationId);
  return Object.freeze({
    ...transaction,
    sourceOperationId,
    operationRoot,
    lockPath: `${operationRoot}.lock`,
    sourceIntentPath: path.join(operationRoot, "source-intent.json"),
  });
}

export function canonicalUntrackedRelocationSubject(plan) {
  const normalized = assertCanonicalUntrackedRelocationPlan(plan);
  const layout = canonicalUntrackedRelocationOperationLayout(normalized);
  const { recovery, target } = normalized.evidence;
  const core = Object.freeze({
    schema: "agentic-canonical-untracked-relocation-subject/v1",
    sourceOperationId: layout.sourceOperationId,
    recoveryDirectory: recovery.directory, recoveryPackageDigest: recovery.packageDigest,
    recoveryPathsDigest: recovery.pathsDigest, targetWorktree: target.worktree,
    targetBranch: target.branch, targetHeadSha: target.headSha, targetTreeSha: target.treeSha,
    targetBaseSha: target.baseSha, targetFenceSha: target.fenceSha,
    targetLeaseEpoch: target.leaseEpoch, targetSessionId: target.sessionId,
    targetDevice: target.device, targetScope: target.scope,
    targetManifestDigest: target.manifestDigest, targetWriteSetDigest: target.writeSetDigest,
    targetCloudClaimId: target.cloudClaimId,
    targetTaskAuthoritySubjectId: target.taskAuthoritySubjectId,
    targetTaskAuthorityGeneration: target.taskAuthorityGeneration,
    targetTaskAuthorityBindingDigest: target.taskAuthorityBindingDigest,
    transactionLayoutDigest: digestValue(layout),
  });
  return Object.freeze({ ...core, subjectDigest: digestValue(core) });
}

export function deriveCanonicalUntrackedRelocationLayout({
  source,
  recovery,
  target,
  receiptPath,
}) {
  const transactionId = digestValue({
    sourceCommonDirectory: source.commonDirectory,
    sourceWorktree: source.worktree,
    sourceHeadSha: source.headSha,
    sourceTreeSha: source.treeSha,
    sourceStateDigest: source.stateDigest,
    sourceWriteSetDigest: source.writeSetDigest,
    recoveryPackageDigest: recovery.packageDigest,
    recoveryPathsDigest: recovery.pathsDigest || digestValue(recovery.paths),
    targetWorktree: target.worktree,
    targetBranch: target.branch,
    targetHeadSha: target.headSha,
    targetTreeSha: target.treeSha,
    targetBaseSha: target.baseSha,
    targetFenceSha: target.fenceSha,
    targetLeaseEpoch: target.leaseEpoch,
    targetSessionId: target.sessionId,
    targetDevice: target.device,
    targetScope: target.scope,
    targetManifestDigest: target.manifestDigest,
    targetWriteSetDigest: target.writeSetDigest,
    targetCloudClaimId: target.cloudClaimId,
    targetTaskAuthoritySubjectId: target.taskAuthoritySubjectId,
    targetTaskAuthorityGeneration: target.taskAuthorityGeneration,
    targetTaskAuthorityBindingDigest: target.taskAuthorityBindingDigest,
    subtree: source.subtree,
  });
  const transactionRoot = path.join(
    recovery.directory,
    ".canonical-untracked-relocation",
    transactionId,
  );
  const resolvedReceipt = path.join(transactionRoot, "receipt.json");
  if (receiptPath !== undefined && receiptPath !== null
    && absolute(receiptPath, "transaction receipt path") !== resolvedReceipt) {
    throw new Error("Transaction receipt path must be the derived authoritative receipt.");
  }
  return Object.freeze({
    transactionId,
    transactionRoot,
    stagePath: path.join(transactionRoot, "target-stage"),
    quarantinePath: path.join(transactionRoot, "source-quarantine"),
    intentPath: path.join(transactionRoot, "intent.json"),
    effectIntentPath: path.join(transactionRoot, "effect-intent.json"),
    receiptPath: resolvedReceipt,
  });
}

function normalizeEvidence(source) {
  object(source, "relocation evidence");
  const paths = stringList(source.recovery?.paths, "recovery paths");
  const normalizedSource = Object.freeze({
      worktree: absolute(source.source?.worktree, "source worktree"),
      commonDirectory: absolute(source.source?.commonDirectory, "source common directory"),
      headSha: sha(source.source?.headSha, "source HEAD"),
      treeSha: sha(source.source?.treeSha, "source tree"),
      branch: exact(source.source?.branch, "main", "source branch"),
      subtree: repositoryPath(source.source?.subtree, "source subtree"),
      stateDigest: digest(source.source?.stateDigest, "source state digest"),
      writeSetDigest: digest(source.source?.writeSetDigest, "source write-set digest"),
    });
  const normalizedRecovery = Object.freeze({
      directory: absolute(source.recovery?.directory, "recovery directory"),
      packageDigest: digest(source.recovery?.packageDigest, "recovery package digest"),
      captureProfile: exact(
        source.recovery?.captureProfile,
        "canonical-untracked-retention",
        "capture profile",
      ),
      paths,
      pathsDigest: digestValue(paths),
    });
  const normalizedTarget = Object.freeze({
      worktree: absolute(source.target?.worktree, "target worktree"),
      branch: text(source.target?.branch, "target branch"),
      headSha: sha(source.target?.headSha, "target HEAD"),
      treeSha: sha(source.target?.treeSha, "target tree"),
      baseSha: sha(source.target?.baseSha, "target base"),
      fenceSha: sha(source.target?.fenceSha, "target fence"),
      leaseDigest: digest(source.target?.leaseDigest, "target lease digest"),
      leaseEpoch: positive(source.target?.leaseEpoch, "target lease epoch"),
      sessionId: text(source.target?.sessionId, "target session"),
      device: text(source.target?.device, "target device"),
      scope: text(source.target?.scope, "target scope"),
      manifestDigest: digest(source.target?.manifestDigest, "target manifest digest"),
      writeSetDigest: digest(source.target?.writeSetDigest, "target write-set digest"),
      cloudClaimId: digest(source.target?.cloudClaimId, "target cloud claim"),
      cloudClaimDigest: digest(source.target?.cloudClaimDigest, "target cloud claim digest"),
      taskAuthoritySubjectId: text(source.target?.taskAuthoritySubjectId, "task authority subject"),
      taskAuthorityGeneration: positive(
        source.target?.taskAuthorityGeneration,
        "task authority generation",
      ),
      taskAuthorityBindingDigest: digest(
        source.target?.taskAuthorityBindingDigest,
        "task authority binding digest",
      ),
    });
  if (normalizedTarget.baseSha !== normalizedSource.headSha
    || normalizedTarget.fenceSha !== normalizedTarget.headSha) {
    throw new Error("Relocation target base or fence differs from its source and HEAD.");
  }
  const layout = deriveCanonicalUntrackedRelocationLayout({
    source: normalizedSource,
    recovery: normalizedRecovery,
    target: normalizedTarget,
    receiptPath: source.transaction?.receiptPath,
  });
  if (absolute(source.transaction?.stagePath, "transaction stage path") !== layout.stagePath
    || absolute(source.transaction?.quarantinePath, "transaction quarantine path")
      !== layout.quarantinePath
    || source.transaction?.sameFilesystem !== true) {
    throw new Error("Canonical-untracked relocation transaction layout is not derived from its evidence.");
  }
  return Object.freeze({
    source: normalizedSource,
    recovery: normalizedRecovery,
    target: normalizedTarget,
    transaction: Object.freeze({
      stagePath: layout.stagePath,
      quarantinePath: layout.quarantinePath,
      receiptPath: layout.receiptPath,
      sameFilesystem: true,
    }),
  });
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function text(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function exact(value, expected, label) {
  const normalized = text(value, label);
  if (normalized !== expected) throw new Error(`${label} must be ${expected}.`);
  return normalized;
}

function absolute(value, label) {
  const normalized = text(value, label);
  if (!path.isAbsolute(normalized)) throw new Error(`${label} must be absolute.`);
  return path.resolve(normalized);
}

function repositoryPath(value, label) {
  const normalized = text(value, label).replaceAll("\\", "/");
  if (path.posix.isAbsolute(normalized) || normalized.includes("..") || normalized === ".") {
    throw new Error(`${label} must be repository-relative.`);
  }
  return normalized;
}

function digest(value, label) {
  const normalized = text(value, label);
  if (!DIGEST.test(normalized)) throw new Error(`${label} must be a SHA-256 digest.`);
  return normalized;
}

function sha(value, label) {
  const normalized = text(value, label);
  if (!SHA.test(normalized)) throw new Error(`${label} must be a Git SHA.`);
  return normalized;
}

function positive(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be positive.`);
  return value;
}

function authorityPhase(value) {
  if (!AUTHORITY_PHASES.has(value)) throw new Error("Relocation authority phase is invalid.");
  return value;
}

function instant(value, label) {
  const normalized = text(value, label);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`${label} must be an instant.`);
  return new Date(normalized).toISOString();
}

function stringList(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) {
    throw new Error(`${label} must contain 1 to 256 items.`);
  }
  const normalized = value.map(item => repositoryPath(item, label)).sort();
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must be unique.`);
  return Object.freeze(normalized);
}
