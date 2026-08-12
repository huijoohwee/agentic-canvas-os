// Responsibility: orchestrate authority-less capture and journaled authority-bound import.
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";
import { appendOperationPhase, createImportPlan, createImportReceipt, createOperation,
  nextState, normalizeBundle, normalizeOperation } from "./split-window-preparation-contract.mjs";
import { normalizeImportReceipt } from "./split-window-preparation-contract.mjs";

export function createPreparationController({ source, store }) {
  requireMethods(source, ["capture"]); requireMethods(store, ["publishBundle", "readBundle"]);
  return Object.freeze({
    prepare(input) {
      const first = source.capture(input); const second = source.capture(input);
      if (canonicalJson(first) !== canonicalJson(second)) throw new Error("Source changed during split-window capture.");
      if (first.authority || first.mutationAuthorityReceipt) throw new Error("Window A cannot serialize mutation authority.");
      const published = store.publishBundle(first.bundle, first.payloads);
      const bundle = normalizeBundle(store.readBundle(published.bundleDigest));
      return Object.freeze({ status: "sealed", mutationAuthority: false, bundle });
    },
  });
}

export function createImportController({ target, store }) {
  requireMethods(target, ["inspect", "preflight", "withJoinedMutationFence", "apply", "reconcile", "verify"]);
  requireMethods(store, ["readBundle", "readOperation", "compareAndSwapOperation", "writeReceipt", "readReceipt"]);
  return Object.freeze({ plan: input => plan(input, target, store), run: input => run(input, target, store), observe: input => observe(input, target, store) });
}

function plan(input, target, store) {
  const bundle = normalizeBundle(store.readBundle(input.bundleDigest));
  const observation = target.inspect(bundle, input);
  const preflight = target.preflight(bundle, observation, input);
  const importPlan = createImportPlan({ bundleDigest: bundle.bundleDigest,
    importRequestDigest: digestValue(input.importRequest), targetIdentityDigest: observation.targetIdentityDigest,
    targetPreStateDigest: observation.stateDigest, expectedPostStateDigest: preflight.expectedPostStateDigest,
    verifierProfileDigests: preflight.verifierProfileDigests, authorityObservation: observation.authorityObservation });
  let operation = createOperation({ bundleDigest: bundle.bundleDigest, operationId: input.operationId });
  operation = appendOperationPhase(operation, "sealed", { bundleDigest: bundle.bundleDigest });
  operation = appendOperationPhase(operation, "planned", { planDigest: importPlan.planDigest,
    importRequestDigest: importPlan.importRequestDigest, targetIdentityDigest: importPlan.targetIdentityDigest,
    preflightReceiptDigest: preflight.receiptDigest, targetPreStateDigest: observation.stateDigest,
    expectedPostStateDigest: preflight.expectedPostStateDigest,
    verifierProfileDigests: importPlan.verifierProfileDigests });
  store.compareAndSwapOperation(null, operation);
  return Object.freeze({ status: "planned", mutationAuthority: false, bundle, importPlan, operation });
}

function run(input, target, store) {
  const bundle = normalizeBundle(store.readBundle(input.bundleDigest));
  let operation = normalizeOperation(store.readOperation(input.operationId));
  if (operation.bundleDigest !== bundle.bundleDigest) throw new Error("Split-window operation belongs to another bundle.");
  return target.withJoinedMutationFence(bundle, input, authority => {
    if (!authority || authority.status !== "ready" || authority.singleUse !== true || typeof authority.consume !== "function") {
      throw new Error("Fresh in-process single-use mutation authority is required.");
    }
    const before = target.inspect(bundle, input, authority);
    const planned = operation.phases.find(phase => phase.state === "planned")?.values;
    if (!planned) throw new Error("Import operation has no planned phase.");
    if (planned.importRequestDigest !== digestValue(input.importRequest)
      || planned.targetIdentityDigest !== before.targetIdentityDigest) {
      throw new Error("Split-window import request or target identity drifted from its plan.");
    }
    if (nextState(operation) === null) {
      const receipt = normalizeImportReceipt(store.readReceipt(input.operationId));
      if (!receipt || receipt.receiptDigest !== operation.phases.at(-1).values.receiptDigest
        || before.stateDigest !== planned.expectedPostStateDigest) {
        throw new Error("Completed split-window import no longer matches its sealed receipt or post-state.");
      }
      return Object.freeze({ status: "complete", mutationAuthority: false, receipt, replayed: true });
    }
    if (nextState(operation) === "armed") operation = casPhase(store, operation, "armed", {
      planDigest: planned.planDigest, authorityReceiptDigest: authority.receiptDigest,
      beforeStateDigest: planned.targetPreStateDigest, expectedPostStateDigest: planned.expectedPostStateDigest });
    if (nextState(operation) === "applied") {
      const armed = operation.phases.at(-1).values;
      if (![armed.beforeStateDigest, armed.expectedPostStateDigest].includes(before.stateDigest)) {
        throw new Error("Split-window import observed neither its exact pre-state nor expected post-state.");
      }
      const effect = before.stateDigest === armed.expectedPostStateDigest
        ? target.reconcile(bundle, before, input)
        : authority.consume(() => target.apply(bundle, before, input));
      if (effect.beforeStateDigest !== armed.beforeStateDigest
        || effect.postStateDigest !== armed.expectedPostStateDigest
        || effect.expectedPostStateDigest !== armed.expectedPostStateDigest) {
        throw new Error("Split-window effect receipt drifted from its planned state transition.");
      }
      operation = casPhase(store, operation, "applied", { beforeStateDigest: armed.beforeStateDigest,
        postStateDigest: effect.postStateDigest, effectReceiptDigest: effect.receiptDigest,
        expectedPostStateDigest: effect.expectedPostStateDigest, replayed: effect.replayed === true });
    }
    if (nextState(operation) === "verified") {
      const applied = operation.phases.at(-1).values;
      const verification = target.verify(bundle, applied, input, authority);
      if (verification.postStateDigest !== applied.expectedPostStateDigest) {
        throw new Error("Split-window verification did not observe the expected post-state.");
      }
      operation = casPhase(store, operation, "verified", { postStateDigest: verification.postStateDigest,
        verifierReceiptDigests: verification.receiptDigests });
    }
    if (nextState(operation) === "complete") {
      const armed = operation.phases.find(phase => phase.state === "armed").values;
      const applied = operation.phases.find(phase => phase.state === "applied").values;
      const verified = operation.phases.find(phase => phase.state === "verified").values;
      const finalReceipt = createImportReceipt({ operationId: operation.operationId,
        bundleDigest: bundle.bundleDigest, planDigest: planned.planDigest,
        preStateDigest: armed.beforeStateDigest, postStateDigest: verified.postStateDigest,
        authorityReceiptDigests: [armed.authorityReceiptDigest], effectReceiptDigest: applied.effectReceiptDigest,
        verifierReceiptDigests: verified.verifierReceiptDigests });
      store.writeReceipt(operation.operationId, finalReceipt);
      operation = casPhase(store, operation, "complete", { receiptDigest: finalReceipt.receiptDigest });
      return Object.freeze({ status: "complete", mutationAuthority: false, receipt: finalReceipt, replayed: false });
    }
    throw new Error("Import operation stopped in an unsupported state.");
  });
}

function observe(input, target, store) {
  const bundle = normalizeBundle(store.readBundle(input.bundleDigest));
  const operation = normalizeOperation(store.readOperation(input.operationId));
  const storedReceipt = store.readReceipt(input.operationId);
  return Object.freeze({ status: operation.phases.at(-1)?.state || "absent", mutationAuthority: false,
    bundle, operation, receipt: storedReceipt ? normalizeImportReceipt(storedReceipt) : null,
    live: target.inspect(bundle, input) });
}
function casPhase(store, operation, state, values) { const next = appendOperationPhase(operation, state, values); store.compareAndSwapOperation(operation.operationDigest, next); return next; }
function requireMethods(value, methods) { for (const method of methods) if (typeof value?.[method] !== "function") throw new Error(`Split-window port is missing ${method}.`); }
