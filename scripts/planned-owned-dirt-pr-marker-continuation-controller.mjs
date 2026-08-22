// Responsibility: Advance only the missing PR-marker and terminal phases of one sealed journal.
import { advanceRecoveryIntent, buildCompletionReceipt }
  from "./planned-owned-dirt-scope-expansion-recovery-contract.mjs";
import { authorize, normalizePlan }
  from "./planned-owned-dirt-pr-marker-continuation-contract.mjs";

const METHODS = ["capture", "withLock", "readIntent", "authorizeTask",
  "projectMarker", "verifyTerminal", "writeIntent"];

export function createController(adapter) {
  for (const method of METHODS) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`PR-marker continuation adapter requires ${method}().`);
    }
  }
  return Object.freeze({
    async plan() { return adapter.capture(); },
    async run({ plan, authorization }) {
      const sealed = normalizePlan(plan);
      authorize(sealed, authorization);
      return adapter.withLock(sealed, () => runLocked(adapter, sealed));
    },
  });
}

async function runLocked(adapter, plan) {
  let intent = await adapter.readIntent(plan);
  if (intent.status === "complete") {
    await adapter.verifyTerminal({ plan: intent.planSnapshot, intent, replay: true });
    return buildCompletionReceipt(intent);
  }
  if (intent.status === "local-projected") {
    await adapter.authorizeTask({ plan, intent });
    const values = await adapter.projectMarker({ plan, intent });
    const next = advanceRecoveryIntent(intent, { status: "pr-marker-projected", values });
    await adapter.writeIntent({ expected: intent, next, plan });
    intent = next;
  }
  if (intent.status !== "pr-marker-projected") {
    throw new Error(`Continuation requires local-projected or replayable marker state; found ${intent.status}.`);
  }
  const terminal = await adapter.verifyTerminal({ plan: intent.planSnapshot, intent, replay: false });
  const complete = advanceRecoveryIntent(intent, { status: "complete", values: terminal });
  await adapter.writeIntent({ expected: intent, next: complete, plan });
  return buildCompletionReceipt(complete);
}
