// Responsibility: Select the exact live or dormant-reserved successor without mutating cloud state.
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";

export function inspectExactSuccessor({ authority, sourceClaimId, inspect = invokeRepositoryCloudAction }) {
  const result = inspect({ action: "status", ledgerRepository: authority.ledgerRepository, request: { targetRepository: authority.targetRepository } });
  if (result?.ok !== true || result?.status !== "ready" || !Array.isArray(result?.claims)) throw new Error("Cloud successor inventory is unavailable.");
  const matches = result.claims.filter(claim => claim.claimId === authority.claimId);
  if (matches.length !== 1) throw new Error("Cloud successor inventory requires exactly one target claim.");
  const claim = matches[0];
  const state = claim.status === "dormant-preserved" || claim.state === "dormant-preserved" ? "dormant-preserved" : "current";
  const exact = claim.predecessorClaimId === sourceClaimId && claim.canonicalBaseRevision === authority.canonicalBaseSha && claim.laneRevision === authority.laneRevision && claim.writeSetDigest === authority.writeSetDigest && claim.leaseEpoch === authority.leaseEpoch && claim.operationReceiptDigest === authority.operationReceiptDigest && claim.reviewRequestId === authority.reviewRequestId;
  if (!exact || (state === "dormant-preserved" && claim.scopeReserved !== true)) throw new Error("Cloud successor subject changed.");
  const competitors = result.claims.filter(candidate => candidate.claimId !== claim.claimId && candidate.scopeReserved === true && candidate.reviewRequestId === claim.reviewRequestId);
  if (competitors.length) throw new Error("Cloud successor review identity is ambiguous.");
  return Object.freeze({ state, claim, inventoryDigest: result.inventoryDigest, verificationReceiptDigest: result.verificationReceiptDigest || result.receiptDigest || authority.operationReceiptDigest });
}
