// Responsibility: Orchestrate one exact, replay-adoptable local heartbeat projection.
import {
  authorizePlannedDirtyHeartbeatProjectionRecovery,
  buildPlannedDirtyHeartbeatProjectionRecoveryCompletion,
  buildPlannedDirtyHeartbeatProjectionRecoveryPlan,
  normalizePlannedDirtyHeartbeatProjectionRecoveryPlan,
} from "./planned-dirty-heartbeat-projection-recovery-contract.mjs";

const REQUIRED = Object.freeze([
  "inspectPlan", "inspectExecution", "authorizeTask", "projectRegistry",
  "projectMarker", "verifyTerminal",
]);

export function createPlannedDirtyHeartbeatProjectionRecoveryController(adapter) {
  for (const name of REQUIRED) {
    if (typeof adapter?.[name] !== "function") {
      throw new Error(`Planned-dirty heartbeat projection adapter requires ${name}().`);
    }
  }
  return Object.freeze({
    async plan() {
      return buildPlannedDirtyHeartbeatProjectionRecoveryPlan(await adapter.inspectPlan());
    },
    async execute({ plan, authorization, taskAuthorityFile } = {}) {
      const sealed = normalizePlannedDirtyHeartbeatProjectionRecoveryPlan(plan);
      authorizePlannedDirtyHeartbeatProjectionRecovery(sealed, authorization);
      if (typeof taskAuthorityFile !== "string" || !taskAuthorityFile.trim()) {
        throw new Error("Exact external task-authority capability file is required.");
      }
      let current = await adapter.inspectExecution({ plan: sealed });
      await adapter.authorizeTask({ plan: sealed, taskAuthorityFile, current });
      let adoptedRegistryProjection = current.registryProjected === true;
      let adoptedMarkerProjection = current.markerProjected === true;

      if (!current.registryProjected) {
        try {
          await adapter.projectRegistry({ plan: sealed, current });
        } catch (error) {
          current = await adapter.inspectExecution({ plan: sealed });
          if (!current.registryProjected) throw error;
          adoptedRegistryProjection = true;
        }
      }

      current = await adapter.inspectExecution({ plan: sealed });
      if (!current.markerProjected) {
        try {
          await adapter.projectMarker({ plan: sealed, current });
        } catch (error) {
          current = await adapter.inspectExecution({ plan: sealed });
          if (!current.markerProjected) throw error;
          adoptedMarkerProjection = true;
        }
      }

      const terminal = await adapter.verifyTerminal({ plan: sealed });
      return buildPlannedDirtyHeartbeatProjectionRecoveryCompletion({ plan: sealed,
        terminal: { ...terminal, adoptedRegistryProjection,
          adoptedMarkerProjection } });
    },
  });
}
