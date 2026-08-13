// Responsibility: Orchestrate one monotonic, replay-safe completed source-correction fence recovery.
import { PHASES, advanceCompletedSourceCorrectionFenceRecoveryIntent, authorizeCompletedSourceCorrectionFenceRecovery, buildCompletedSourceCorrectionFenceRecoveryPlan, buildCompletionReceipt, createCompletedSourceCorrectionFenceRecoveryIntent, normalizeCompletedSourceCorrectionFenceRecoveryIntent, operationKey } from "./completed-source-correction-fence-recovery-contract.mjs";

const EFFECTS = { task_authority_verified: "verifyTaskAuthority", cloud_recovered: "recoverCloud", local_projected: "projectLocal", pr_marker_projected: "projectPullRequestMarker", verified: "verifyTerminal" };
const METHODS = ["withFence", "readEvidence", "readIntent", "writeIntent", "reconcilePhase", ...Object.values(EFFECTS)];

export function createCompletedSourceCorrectionFenceRecoveryController(adapter) {
  for (const name of METHODS) if (typeof adapter?.[name] !== "function") throw new Error(`Fence recovery adapter requires ${name}().`);
  return Object.freeze({
    async plan({ operatorSessionId } = {}) { return buildCompletedSourceCorrectionFenceRecoveryPlan({ evidence: await adapter.readEvidence(), operatorSessionId }); },
    async run({ operatorSessionId, authorization } = {}) {
      return adapter.withFence(async () => {
        let intent = await adapter.readIntent();
        if (intent) {
          intent = normalizeCompletedSourceCorrectionFenceRecoveryIntent(intent);
          authorizeCompletedSourceCorrectionFenceRecovery({ plan: intent.planSnapshot, authorization });
          if (intent.planSnapshot.operatorSessionId !== operatorSessionId) throw new Error("Stored fence recovery operator differs from current authority.");
        } else {
          const plan = buildCompletedSourceCorrectionFenceRecoveryPlan({ evidence: await adapter.readEvidence(), operatorSessionId });
          intent = createCompletedSourceCorrectionFenceRecoveryIntent(plan, authorization);
          await adapter.writeIntent({ expected: null, value: intent });
        }
        return execute(adapter, intent);
      });
    },
  });
}

async function execute(adapter, initial) {
  let intent = initial; if (intent.status === "complete") return intent.completion;
  for (const phase of PHASES.slice(PHASES.indexOf(intent.status) + 1)) {
    let values;
    if (phase === "complete") {
      const verified = intent.phases.verified?.values;
      values = { receipt: buildCompletionReceipt(intent.planSnapshot, verified) };
    } else {
      const input = { intent, plan: intent.planSnapshot, phase, operationKey: operationKey(intent.planSnapshot, phase) };
      values = await adapter.reconcilePhase(input);
      if (!values) { try { values = await adapter[EFFECTS[phase]](input); } catch (error) { values = await adapter.reconcilePhase(input); if (!values) throw error; } }
      if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error(`Fence recovery ${phase} did not complete.`);
    }
    const next = advanceCompletedSourceCorrectionFenceRecoveryIntent(intent, { status: phase, values });
    await adapter.writeIntent({ expected: intent, value: next }); intent = next;
  }
  return intent.completion;
}
