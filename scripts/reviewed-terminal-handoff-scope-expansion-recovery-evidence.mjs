// Responsibility: Join the immutable source journal, live successor, PR bytes, and strict-superset manifest.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { digestValue, normalizeWriteSet } from "./cloud-collaboration-primitives.mjs";
import { normalizeDeclaredWriteScopeManifest } from "./scoped-lane-admission-lib.mjs";
import { normalizeRecoveryIntent }
  from "./reviewed-terminal-handoff-successor-recovery-contract.mjs";

export const EVIDENCE_SCHEMA =
  "agentic-reviewed-terminal-handoff-scope-expansion-recovery-evidence/v1";

export function readReviewedTerminalHandoffSourceJournal({ commonDirectory, branch } = {}) {
  const root = path.join(requiredText(commonDirectory, "Git common directory"),
    "agentic-canvas-os", "reviewed-terminal-handoff-successor-recovery");
  const journalPath = path.join(root, `${digestValue({ branch: requiredText(branch, "branch") })}.json`);
  if (!existsSync(journalPath)) throw new Error("Reviewed handoff source journal is missing.");
  const bytes = readFileSync(journalPath, "utf8");
  const envelope = JSON.parse(bytes);
  const intent = normalizeRecoveryIntent(envelope.intent);
  if (envelope.schema !== "agentic-reviewed-terminal-handoff-successor-recovery-journal/v1"
    || envelope.intentDigest !== digestValue(intent)
    || intent.phase !== "successor-bound") {
    throw new Error("Reviewed handoff source journal is not the exact bound recovery intent.");
  }
  const claimed = intent.receipts["successor-claimed"].values;
  const bound = intent.receipts["successor-bound"].values;
  if (bound.authority.claimId !== claimed.claimId
    || bound.authority.transitionCounter !== claimed.transitionCounter + 1
    || bound.authority.state !== "active") {
    throw new Error("Reviewed handoff source journal does not join its bound successor.");
  }
  return Object.freeze({ path: journalPath, bytesDigest: digestValue(bytes), envelopeDigest: digestValue(envelope),
    intentDigest: intent.intentDigest, phase: intent.phase, planDigest: intent.planDigest,
    operatorSessionId: intent.planSnapshot.operatorSessionId,
    successor: Object.freeze({ claimId: bound.authority.claimId,
      claimDigest: bound.authority.claimDigest,
      transitionCounter: bound.authority.transitionCounter,
      operationReceiptDigest: bound.authority.operationReceiptDigest }),
    boundAuthority: bound.authority });
}

export function normalizeScopeExpansionTargetManifest(source, expectedScope) {
  return normalizeDeclaredWriteScopeManifest(source, { expectedScope });
}

export function buildScopeExpansionTargetAdmission({ sourceAdmission, targetManifest, planDigest,
  operationReceiptDigest, claimId } = {}) {
  const source = sourceAdmission;
  const target = targetManifest;
  if (source?.schema !== "agentic-lane-admission-lease/v1" || source.status !== "admitted"
    || target?.schema !== "agentic-declared-write-scope/v1"
    || target.semanticScope !== source.semanticScope
    || !strictSubset(source.declaredWriteSet, target.declaredWriteSet)) {
    throw new Error("Scope repair target admission is not a strict superset of the source admission.");
  }
  const admittedReportDigest = digestValue({ schema: "agentic-reviewed-handoff-scope-repair-admitted-report/v1",
    planDigest: requiredDigest(planDigest, "plan digest"), claimId: requiredDigest(claimId, "claim ID") });
  return Object.freeze({ schema: "agentic-lane-admission-lease/v1", status: "admitted",
    semanticScope: target.semanticScope, declaredWriteSet: target.declaredWriteSet,
    writeSetDigest: target.writeSetDigest, manifestDigest: target.manifestDigest,
    planReceiptDigest: planDigest, admissionReceiptDigest: requiredDigest(operationReceiptDigest, "operation receipt"),
    existingLaneStateDigest: requiredDigest(source.existingLaneStateDigest, "existing lane-state digest"),
    admittedReportDigest,
    preservationReceiptDigest: digestValue({ schema: "agentic-reviewed-handoff-scope-repair-preservation/v1",
      planDigest, sourceAdmissionDigest: digestValue(source), successorClaimId: claimId }) });
}

export function sealScopeExpansionRecoveryEvidence(value) {
  const core = { ...structuredClone(value), schema: EVIDENCE_SCHEMA };
  delete core.evidenceDigest;
  const result = Object.freeze({ ...core, evidenceDigest: digestValue(core) });
  return result;
}

export function scopeCoversPath(writeSet, changedPath) {
  return normalizeWriteSet(writeSet).some(item => item.startsWith("path:")
    && (item.slice(5) === "." || changedPath === item.slice(5)
      || changedPath.startsWith(`${item.slice(5)}/`)));
}

function strictSubset(left, right) { const source = normalizeWriteSet(left), target = normalizeWriteSet(right);
  return source.length < target.length && source.every(item => target.includes(item)); }
function requiredText(value, label) { const result = String(value ?? "").trim();
  if (!result) throw new Error(`${label} is required.`); return result; }
function requiredDigest(value, label) { const result = requiredText(value, label);
  if (!/^[0-9a-f]{64}$/u.test(result)) throw new Error(`${label} is invalid.`); return result; }
