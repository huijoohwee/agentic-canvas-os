// Responsibility: Persist and replay one exact abandoned fence-only owner retirement.
import { advanceResumeState, advanceState, authorizePlan, authorizeResumePlan,
  buildPlan, buildReceipt, buildResumePlan, buildResumeReceipt, createResumeState, createState,
  normalizeResumeState, normalizeState, phaseReceipt }
  from "./admitted-empty-abandoned-owner-retirement-contract.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";

export function createController({ adapter }) {
  requireAdapter(adapter);
  return Object.freeze({
    async plan() {
      return adapter.withLock({ action: "plan" }, async () => {
        const current = await adapter.readState();
        if (current) return normalizeState(current).plan;
        const candidate = buildPlan(await adapter.observe());
        return (await adapter.writeState({ expected: null, next: createState(candidate) })).plan;
      });
    },
    async run({ planDigest, authorization }) {
      return adapter.withLock({ planDigest }, async () => execute({ adapter, planDigest, authorization }));
    },
    async resumePlan() {
      requireResumeAdapter(adapter);
      return adapter.withLock({ action: "resume-plan" }, async () => {
        const current = await adapter.readState();
        if (current) return normalizeResumeState(current).plan;
        const candidate = buildResumePlan(await adapter.observeResume());
        return (await adapter.writeState({ expected: null, next: createResumeState(candidate) })).plan;
      });
    },
    async resumeRun({ planDigest, authorization }) {
      requireResumeAdapter(adapter);
      return adapter.withLock({ action: "resume-run", planDigest }, async () =>
        executeResume({ adapter, planDigest, authorization }));
    },
  });
}

async function execute({ adapter, planDigest, authorization }) {
  let state = normalizeState(await adapter.readState());
  if (state.plan.planDigest !== planDigest) throw new Error("Run digest does not match the persisted retirement plan.");
  authorizePlan(state.plan, authorization);
  if (state.phase === "complete") { await adapter.verifyTerminal(state.plan); return state.receipts.complete.receipt; }
  if (state.phase === "planned") state = await advance(adapter, state, "authorized", phaseReceipt("authorized", {
    authorizationDigest: digestValue({ planDigest: state.plan.planDigest, authorization }),
  }));
  if (state.phase === "authorized") {
    const result = await converge(adapter.classifyClaim, adapter.retireClaim, state.plan, "cloud claim retirement");
    state = await advance(adapter, state, "claim-retired", phaseReceipt("claim-retired", result));
  }
  if (state.phase === "claim-retired") {
    const result = await converge(adapter.classifyPullRequest, adapter.closePullRequest,
      state.plan, "pull-request closure");
    state = await advance(adapter, state, "pull-request-closed", phaseReceipt("pull-request-closed", result));
  }
  if (state.phase === "pull-request-closed") {
    const result = await converge(adapter.classifyOwnerReleased, adapter.releaseOwner,
      state.plan, "local owner release");
    state = await advance(adapter, state, "owner-released", phaseReceipt("owner-released", result));
  }
  if (state.phase === "owner-released") {
    const terminal = await adapter.verifyTerminal(state.plan);
    const receipt = buildReceipt(state, terminal.terminalEvidenceDigest);
    state = await advance(adapter, state, "complete", phaseReceipt("complete", { receipt }));
  }
  if (state.phase !== "complete") throw new Error(`Retirement stopped at ${state.phase}.`);
  return state.receipts.complete.receipt;
}

async function executeResume({ adapter, planDigest, authorization }) {
  let state = normalizeResumeState(await adapter.readState());
  if (state.plan.planDigest !== planDigest) {
    throw new Error("Resume digest does not match the persisted retirement plan.");
  }
  authorizeResumePlan(state.plan, authorization);
  if (state.phase === "complete") {
    const terminal = await adapter.verifyResumedTerminal(state.plan);
    if (terminal.terminalEvidenceDigest
      !== state.receipts.complete.receipt.terminalEvidenceDigest) {
      throw new Error("Retirement resume terminal evidence drifted after completion.");
    }
    return state.receipts.complete.receipt;
  }
  if (state.phase === "planned") {
    state = await advanceResume(adapter, state, "authorized", phaseReceipt("authorized", {
      authorizationDigest: digestValue({ planDigest: state.plan.planDigest, authorization }),
    }));
  }
  if (state.phase === "authorized") {
    const result = await converge(adapter.classifyResumedOwnerReleased,
      adapter.releaseResumedOwner, state.plan, "resumed local owner release");
    state = await advanceResume(adapter, state, "owner-released", phaseReceipt("owner-released", result));
  }
  if (state.phase === "owner-released") {
    const terminal = await adapter.verifyResumedTerminal(state.plan);
    const receipt = buildResumeReceipt(state, terminal.terminalEvidenceDigest);
    state = await advanceResume(adapter, state, "complete", phaseReceipt("complete", { receipt }));
  }
  if (state.phase !== "complete") throw new Error(`Retirement resume stopped at ${state.phase}.`);
  return state.receipts.complete.receipt;
}

async function converge(classify, effect, plan, label) {
  const before = await classify(plan);
  if (before?.state === "complete") return before.values;
  if (before?.state !== "pending") throw new Error(`${label} classification is invalid.`);
  let failure;
  try { await effect(plan); } catch (error) { failure = error; }
  const after = await classify(plan);
  if (after?.state !== "complete") { if (failure) throw failure; throw new Error(`${label} did not converge.`); }
  return after.values;
}

async function advance(adapter, state, phase, receipt) {
  const next = advanceState(state, phase, receipt);
  return normalizeState(await adapter.writeState({ expected: state, next }));
}
async function advanceResume(adapter, state, phase, receipt) {
  const next = advanceResumeState(state, phase, receipt);
  return normalizeResumeState(await adapter.writeState({ expected: state, next }));
}
function requireAdapter(adapter) { for (const method of ["observe", "readState", "writeState", "withLock",
  "classifyClaim", "retireClaim", "classifyPullRequest", "closePullRequest",
  "classifyOwnerReleased", "releaseOwner", "verifyTerminal"]) if (typeof adapter?.[method] !== "function") throw new Error(`Retirement adapter requires ${method}().`); }
function requireResumeAdapter(adapter) { for (const method of ["observeResume", "classifyResumedOwnerReleased",
  "releaseResumedOwner", "verifyResumedTerminal"]) if (typeof adapter?.[method] !== "function") {
  throw new Error(`Retirement resume adapter requires ${method}().`); } }
