// Responsibility: Execute the only ordered mutation sequence for an abandoned planned owner.
import { authorizePlan, buildReceipt } from "./planned-admission-owner-release-contract.mjs";

export async function planPlannedAdmissionOwnerRelease({ adapter }) {
  return adapter.buildPlan();
}

export async function runPlannedAdmissionOwnerRelease({ adapter, plan, authorization }) {
  const authorized = authorizePlan(plan, authorization);
  await adapter.verifyPlan(authorized);
  const cloud = await adapter.retireClaim(authorized);
  const provider = await adapter.closePullRequest(authorized, cloud);
  const local = await adapter.releaseLocalOwner(authorized, cloud, provider);
  await adapter.verifyFinal(authorized, cloud, provider, local);
  return buildReceipt({ plan: authorized, cloud, provider,
    releasedLease: local.releasedLease, completedAt: local.completedAt });
}
