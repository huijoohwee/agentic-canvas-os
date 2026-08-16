// Provider- and transport-neutral settlement for independent fan-out branches.
//
// Branch failures are data, not aggregate exceptions: every scheduled branch
// gets a bounded settlement, successful values remain available, and the audit
// projection excludes raw errors, successful payloads, and caller labels.

export const FAIL_SOFT_FAN_OUT_SCHEMA = "fail-soft-fan-out/v1";
export const DEFAULT_FAN_OUT_TIMEOUT_MS = 60_000;
export const MAX_FAN_OUT_TIMEOUT_MS = 2_147_483_647;

const BRANCH_FAILURE = Symbol("fail-soft-branch-failure");
const BRANCH_REASON_CODES = new Set([
  "branch_canceled",
  "branch_failed",
  "branch_output_invalid",
  "branch_result_limit",
  "branch_timed_out",
  "branch_unavailable",
]);
const SETUP_REASON_CODES = new Set([
  "fanout_setup_failed",
  "fanout_unavailable",
  "recipient_enumeration_failed",
]);

function branchReasonCode(value) {
  return BRANCH_REASON_CODES.has(value) ? value : "branch_failed";
}

function setupReasonCode(value) {
  return SETUP_REASON_CODES.has(value) ? value : "fanout_unavailable";
}

/**
 * Create a private, fixed-taxonomy branch failure for a dispatch adapter.
 * Raw provider/transport messages are deliberately not accepted.
 */
export function failSoftBranchFailure(reasonCode = "branch_failed", { retryable = false } = {}) {
  return Object.freeze({
    [BRANCH_FAILURE]: true,
    reasonCode: branchReasonCode(reasonCode),
    retryable: retryable === true,
  });
}

function failureMetadata(error) {
  try {
    if (error?.[BRANCH_FAILURE] === true) {
      return Object.freeze({
        reasonCode: branchReasonCode(error.reasonCode),
        retryable: error.retryable === true,
      });
    }
  } catch {
    // A hostile thenable/proxy is still represented by the generic taxonomy.
  }
  return Object.freeze({ reasonCode: "branch_failed", retryable: false });
}

function aggregateStatus(attempted, succeeded, failed) {
  if (attempted === 0) return "empty";
  if (failed === 0) return "completed";
  if (succeeded === 0) return "failed";
  return "partial";
}

function normalizeSignal(signal) {
  if (signal === undefined) return undefined;
  if (
    !signal
    || typeof signal !== "object"
    || typeof signal.aborted !== "boolean"
    || typeof signal.addEventListener !== "function"
    || typeof signal.removeEventListener !== "function"
  ) {
    throw new TypeError("failSoftFanOut signal must be an AbortSignal when provided.");
  }
  return signal;
}

function boundedDispatch({ branch, index, dispatch, signal, timeoutMs }) {
  const branchController = new AbortController();
  return new Promise((resolve, reject) => {
    let timer;
    let settled = false;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      try {
        signal?.removeEventListener("abort", onAbort);
      } catch {
        // Observability/config adapters cannot reopen a settled branch.
      }
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const abort = (reason) => {
      try {
        branchController.abort();
      } catch {
        // The typed timeout/cancel result remains authoritative.
      }
      finish(reject, reason);
    };
    const onAbort = () => abort(failSoftBranchFailure("branch_canceled", { retryable: true }));

    if (signal?.aborted) {
      onAbort();
      return;
    }
    try {
      signal?.addEventListener("abort", onAbort, { once: true });
    } catch {
      finish(reject, failSoftBranchFailure("branch_failed"));
      return;
    }
    timer = setTimeout(() => {
      abort(failSoftBranchFailure("branch_timed_out", { retryable: true }));
    }, timeoutMs);
    Promise.resolve()
      .then(() => {
        if (settled) return undefined;
        return dispatch(branch, index, branchController.signal);
      })
      .then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error),
      );
  });
}

/** A settled adapter/setup failure with no fabricated recipient attempt. */
export function fanOutUnavailableResult(reasonCode = "fanout_unavailable", { retryable = false } = {}) {
  const failure = Object.freeze({
    branchId: "fanout-setup",
    status: "failed",
    reasonCode: setupReasonCode(reasonCode),
    retryable: retryable === true,
  });
  return Object.freeze({
    schema: FAIL_SOFT_FAN_OUT_SCHEMA,
    failurePolicy: "fail-soft",
    settlement: "setup-settled",
    status: "failed",
    attempted: 0,
    dispatched: 0,
    canceledBeforeDispatch: 0,
    succeeded: 0,
    failed: 0,
    timedOut: 0,
    canceled: 0,
    setupFailures: 1,
    outcomes: Object.freeze([]),
    auditTrail: Object.freeze([failure]),
  });
}

/**
 * Run every independent branch and return stable, input-ordered settlement.
 *
 * Invalid fan-out configuration still throws before execution. Once execution
 * starts, no branch exception or timeout rejects the aggregate. Branch ids are
 * unique ordinals rather than caller/provider labels, and dispatch receives an
 * optional third argument containing its branch-local AbortSignal.
 */
export async function failSoftFanOut(branches, dispatch, options = {}) {
  if (branches === null || branches === undefined || typeof branches[Symbol.iterator] !== "function") {
    throw new TypeError("failSoftFanOut branches must be iterable.");
  }
  if (typeof dispatch !== "function") throw new TypeError("failSoftFanOut dispatch must be a function.");
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("failSoftFanOut options must be an object.");
  }
  const { signal: rawSignal, timeoutMs = DEFAULT_FAN_OUT_TIMEOUT_MS } = options;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_FAN_OUT_TIMEOUT_MS) {
    throw new TypeError(
      `failSoftFanOut timeoutMs must be a safe positive integer no greater than ${MAX_FAN_OUT_TIMEOUT_MS}.`,
    );
  }
  const signal = normalizeSignal(rawSignal);
  const branchList = [...branches];
  let dispatched = 0;
  let canceledBeforeDispatch = 0;
  const outcomes = await Promise.all(branchList.map(async (branch, index) => {
    const branchId = `branch-${index + 1}`;
    let branchDispatched = false;
    try {
      const value = await boundedDispatch({
        branch,
        index,
        dispatch: (...args) => {
          branchDispatched = true;
          dispatched += 1;
          return dispatch(...args);
        },
        signal,
        timeoutMs,
      });
      return Object.freeze({ branchId, status: "succeeded", value });
    } catch (error) {
      const metadata = failureMetadata(error);
      if (metadata.reasonCode === "branch_canceled" && !branchDispatched) {
        canceledBeforeDispatch += 1;
      }
      return Object.freeze({ branchId, status: "failed", ...metadata });
    }
  }));
  const auditTrail = outcomes.map((outcome) => Object.freeze(
    outcome.status === "succeeded"
      ? { branchId: outcome.branchId, status: outcome.status }
      : {
          branchId: outcome.branchId,
          status: outcome.status,
          reasonCode: outcome.reasonCode,
          retryable: outcome.retryable,
        },
  ));
  const succeeded = outcomes.filter((outcome) => outcome.status === "succeeded").length;
  const failed = outcomes.length - succeeded;
  const timedOut = outcomes.filter((outcome) => outcome.reasonCode === "branch_timed_out").length;
  const canceled = outcomes.filter((outcome) => outcome.reasonCode === "branch_canceled").length;

  return Object.freeze({
    schema: FAIL_SOFT_FAN_OUT_SCHEMA,
    failurePolicy: "fail-soft",
    settlement: "bounded-all-branches-settled",
    status: aggregateStatus(outcomes.length, succeeded, failed),
    attempted: outcomes.length,
    dispatched,
    canceledBeforeDispatch,
    succeeded,
    failed,
    timedOut,
    canceled,
    setupFailures: 0,
    outcomes: Object.freeze(outcomes),
    auditTrail: Object.freeze(auditTrail),
  });
}
