// Responsibility: Orchestrate exact provider-first terminal reconciliation through injected ports.
import { authorizePlan, buildReceipt, normalizePlan } from "./planned-recovery-pr-marker-reconciliation-contract.mjs";

export async function planReconciliation({ adapter, sessionId, operatorDecisionDigest }) {
  return normalizePlan(await adapter.buildPlan({ sessionId, operatorDecisionDigest }));
}

export async function runReconciliation({ adapter, plan, authorization }) {
  const authorized = authorizePlan(plan, authorization);
  await adapter.verifyPlan({ plan: authorized });
  const provider = await adapter.closePullRequest({ plan: authorized });
  const local = await adapter.releaseLocalOwner({ plan: authorized, provider });
  const projection = await adapter.projectPullRequest({ plan: authorized, local, provider });
  const receipt = buildReceipt({ plan: authorized, provider,
    releasedLeaseDigest: local.releasedLeaseDigest,
    targetMarkerDigest: projection.targetMarkerDigest,
    completedAt: projection.completedAt });
  await adapter.verifyFinal({ plan: authorized, receipt, local, provider, projection });
  return Object.freeze({ schema: "agentic-planned-recovery-pr-marker-reconciliation-result/v1",
    ok: true, status: "completed", planDigest: authorized.planDigest,
    receiptDigest: receipt.receiptDigest, deployment: false });
}
