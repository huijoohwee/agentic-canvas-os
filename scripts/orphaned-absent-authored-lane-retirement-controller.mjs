// Responsibility: Converge exact PR closure before exact cloud retirement with a durable journal.
import {
  advanceState, authorizePlan, buildCompletionReceipt, buildPlan, createState, normalizeState,
} from "./orphaned-absent-authored-lane-retirement-contract.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";

export function createController({ adapter }) {
  requireAdapter(adapter);
  return Object.freeze({
    async plan() {
      return adapter.withLock({ action: "plan" }, async () => {
        const existing = adapter.readState();
        if (existing) return normalizeState(existing).plan;
        const first = await adapter.observe();
        const second = await adapter.observe();
        if (first.stableEvidenceDigest !== second.stableEvidenceDigest) {
          throw new Error("Retirement evidence drifted across the read-only planning fence.");
        }
        const plan = buildPlan(second);
        return adapter.writeState({ expected: null, next: createState(plan) }).plan;
      });
    },
    async run({ planDigest, authorization }) {
      return adapter.withLock({ action: "run", planDigest }, async () =>
        execute({ adapter, planDigest, authorization }));
    },
  });
}

async function execute({ adapter, planDigest, authorization }) {
  let state = normalizeState(adapter.readState());
  if (state.plan.planDigest !== planDigest) {
    throw new Error("Run digest does not match the persisted retirement plan.");
  }
  authorizePlan(state.plan, authorization);
  if (state.phase === "complete") {
    await adapter.verifyTerminal(state.plan);
    return state.receipts.complete.receipt;
  }
  if (state.phase === "planned") {
    state = advance(adapter, state, "authorized", {
      authorizationDigest: digestValue({ planDigest, authorization }),
    });
  }
  if (state.phase === "authorized") {
    const values = await converge(adapter.classifyPullRequest, adapter.closePullRequest,
      state.plan, "pull-request closure");
    state = advance(adapter, state, "pull-request-closed", values);
  }
  if (state.phase === "pull-request-closed") {
    const values = await convergeClaim(adapter, state.plan);
    state = advance(adapter, state, "claim-retired", values);
  }
  if (state.phase === "claim-retired") {
    const terminal = await adapter.verifyTerminal(state.plan);
    state = advance(adapter, state, "verified", terminal);
  }
  if (state.phase === "verified") {
    const receipt = buildCompletionReceipt(state);
    state = advance(adapter, state, "complete", { receipt });
  }
  if (state.phase !== "complete") throw new Error(`Retirement stopped at ${state.phase}.`);
  return state.receipts.complete.receipt;
}

async function convergeClaim(adapter, plan) {
  const before = await adapter.classifyClaim(plan);
  if (before?.state === "complete") return before.values;
  if (before?.state !== "pending") throw new Error("cloud claim retirement classification is invalid.");
  await adapter.revalidateDormantClaim(plan);
  let failure;
  try { await adapter.retireClaim(plan); } catch (error) { failure = error; }
  const after = await adapter.classifyClaim(plan);
  if (after?.state !== "complete") {
    if (failure) throw failure;
    throw new Error("cloud claim retirement did not converge.");
  }
  return after.values;
}

async function converge(classify, effect, plan, label) {
  const before = await classify(plan);
  if (before?.state === "complete") return before.values;
  if (before?.state !== "pending") throw new Error(`${label} classification is invalid.`);
  let failure;
  try { await effect(plan); } catch (error) { failure = error; }
  const after = await classify(plan);
  if (after?.state !== "complete") {
    if (failure) throw failure;
    throw new Error(`${label} did not converge.`);
  }
  return after.values;
}

function advance(adapter, state, phase, values) {
  const next = advanceState(state, phase, values);
  return normalizeState(adapter.writeState({ expected: state, next }));
}

function requireAdapter(adapter) {
  for (const method of ["observe", "readState", "writeState", "withLock", "classifyPullRequest",
    "closePullRequest", "revalidateDormantClaim", "classifyClaim", "retireClaim", "verifyTerminal"]) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`Retirement adapter requires ${method}().`);
    }
  }
}
