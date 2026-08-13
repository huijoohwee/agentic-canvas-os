// Responsibility: Orchestrate plan-authorize-execute phases over injected repository ports.

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { buildProvisionedStartAdmissionRecoveryPlan,
  buildProvisionedStartAdmissionRecoveryResult,
  normalizeProvisionedStartAdmissionRecoveryPlan,
  requireProvisionedStartAdmissionAuthorization } from "./provisioned-start-admission-recovery-contract.mjs";

export function createProvisionedStartAdmissionRecoveryController({ adapter, intentStore, clock = () => new Date() }) {
  if (!adapter || !intentStore) throw new Error("Recovery controller requires repository and intent-store ports.");

  function plan() {
    return buildProvisionedStartAdmissionRecoveryPlan(adapter.readEvidence());
  }

  function execute({ sealedPlan, authorization }) {
    const recoveryPlan = normalizeProvisionedStartAdmissionRecoveryPlan(sealedPlan);
    const authority = requireProvisionedStartAdmissionAuthorization(recoveryPlan, authorization);
    const startedAt = clock().toISOString();
    const priorIntent = intentStore.read();
    if (!priorIntent) adapter.assertPlanPreimage(recoveryPlan, "recovery-intent");
    let intent = intentStore.begin({ plan: recoveryPlan, authorization: authority, startedAt });
    if (intent.planDigest !== recoveryPlan.planDigest || intent.evidenceDigest !== digestValue(recoveryPlan.evidence)) {
      throw new Error("Persisted recovery intent does not match the sealed plan.");
    }

    if (intent.phase === "intent") {
      const local = adapter.projectLocal({ plan: recoveryPlan, projectedAt: intent.startedAt });
      intent = intentStore.advance({ expectedPhase: "intent", phase: "local-projected",
        values: { leaseDigest: digestValue(local.lease), projectionDigest: digestValue(local.projection),
          adopted: local.adopted }, recordedAt: clock().toISOString() });
    }
    if (intent.phase === "local-projected") {
      const marker = adapter.projectMarker({ plan: recoveryPlan, projectedAt: intent.startedAt });
      intent = intentStore.advance({ expectedPhase: "local-projected", phase: "marker-projected",
        values: { bodyDigest: marker.bodyDigest, markerDigest: marker.markerDigest,
          adopted: marker.adopted }, recordedAt: clock().toISOString() });
    }
    if (intent.phase === "marker-projected") {
      const bodyDigest = intent.phases["marker-projected"].values.bodyDigest;
      const terminal = adapter.verifyTerminal({ plan: recoveryPlan, expectedBodyDigest: bodyDigest });
      intent = intentStore.advance({ expectedPhase: "marker-projected", phase: "complete",
        values: terminal, recordedAt: clock().toISOString() });
    }
    if (intent.phase !== "complete") throw new Error("Recovery did not reach its terminal phase.");
    const terminalAgain = adapter.verifyTerminal({ plan: recoveryPlan,
      expectedBodyDigest: intent.phases["marker-projected"].values.bodyDigest });
    if (digestValue(terminalAgain) !== digestValue(intent.phases.complete.values)) {
      throw new Error("Recovery terminal evidence drifted before result sealing.");
    }
    return buildProvisionedStartAdmissionRecoveryResult({ plan: recoveryPlan,
      terminalEvidence: terminalAgain, phases: intent.phases });
  }

  return Object.freeze({ execute, plan });
}
