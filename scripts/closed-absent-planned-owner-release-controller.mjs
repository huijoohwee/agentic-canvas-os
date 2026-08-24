// Responsibility: Execute one replay-safe local CAS after exact closed-owner authorization.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  authorizePlan,
  buildEvidence,
  buildPlan,
  buildReceipt,
  normalizePlan,
} from "./closed-absent-planned-owner-release-contract.mjs";

const METHODS = Object.freeze([
  "observe", "classifyOwner", "releaseOwner", "verifyTerminal",
]);

export function createController({ adapter }) {
  for (const method of METHODS) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`Closed-absent owner-release adapter requires ${method}().`);
    }
  }
  return Object.freeze({
    async plan() {
      const first = buildEvidence(await adapter.observe());
      const second = buildEvidence(await adapter.observe({ observedAt: first.observedAt }));
      if (first.evidenceDigest !== second.evidenceDigest
        || digestValue(first) !== digestValue(second)) {
        throw new Error("Closed-absent owner-release evidence drifted during read-only planning.");
      }
      return buildPlan({ evidence: second });
    },
    async run({ plan, authorization }) {
      const normalized = normalizePlan(plan);
      const authorizationReceipt = authorizePlan({ plan: normalized, authorization });
      let classification = await adapter.classifyOwner(normalized, authorizationReceipt);
      if (classification?.state === "pending") {
        let failure;
        try { await adapter.releaseOwner(normalized, authorizationReceipt); }
        catch (error) { failure = error; }
        classification = await adapter.classifyOwner(normalized, authorizationReceipt);
        if (classification?.state !== "complete") {
          if (failure) throw failure;
          throw new Error("Local owner release did not converge after its writer-registry CAS.");
        }
      } else if (classification?.state !== "complete") {
        throw new Error("Local owner-release classification is invalid.");
      }
      const terminal = await adapter.verifyTerminal(normalized, authorizationReceipt);
      return buildReceipt({ plan: normalized, authorizationReceipt,
        releasedLease: terminal?.releasedLease });
    },
  });
}
