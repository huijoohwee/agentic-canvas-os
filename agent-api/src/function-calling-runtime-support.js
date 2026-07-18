const CACHE_STATUSES = new Set(["hit", "write", "miss", "unreported"]);

export class FunctionCallingBlock extends Error {
  constructor(reasonCode, message, { retryable = false, continuationState } = {}) {
    super(message);
    this.name = "FunctionCallingBlock";
    this.reasonCode = reasonCode;
    this.retryable = retryable;
    this.continuationState = continuationState;
  }
}

export function assertIdentifier(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  const normalized = value.trim();
  if (normalized.length > 512) throw new RangeError(`${field} exceeds 512 characters.`);
  return normalized;
}

export function normalizeCostLog(value, owner) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FunctionCallingBlock(`${owner}_cost_log_missing`, `${owner} execution must return a cost log.`);
  }
  const result = { model: assertIdentifier(value.model, `${owner}CostLog.model`) };
  for (const field of ["prompt_tokens", "completion_tokens", "cache_hits", "cached_tokens", "cache_write_tokens"]) {
    if (!Number.isInteger(value[field]) || value[field] < 0) {
      throw new FunctionCallingBlock(`${owner}_cost_log_invalid`, `${owner}CostLog.${field} must be non-negative.`);
    }
    result[field] = value[field];
  }
  if (!CACHE_STATUSES.has(value.provider_cache_status)) {
    throw new FunctionCallingBlock(`${owner}_cost_log_invalid`, `${owner}CostLog.provider_cache_status is invalid.`);
  }
  if (!Number.isFinite(value.estimated_cost_usd) || value.estimated_cost_usd < 0) {
    throw new FunctionCallingBlock(`${owner}_cost_log_invalid`, `${owner}CostLog.estimated_cost_usd must be non-negative.`);
  }
  result.provider_cache_status = value.provider_cache_status;
  result.estimated_cost_usd = value.estimated_cost_usd;
  return Object.freeze(result);
}

export function aggregateCostLogs(logs) {
  const models = [...new Set(logs.map((log) => log.model))];
  const statuses = [...new Set(logs.map((log) => log.provider_cache_status))];
  return Object.freeze({
    model: models.length === 1 ? models[0] : "multiple",
    prompt_tokens: logs.reduce((sum, log) => sum + log.prompt_tokens, 0),
    completion_tokens: logs.reduce((sum, log) => sum + log.completion_tokens, 0),
    cache_hits: logs.reduce((sum, log) => sum + log.cache_hits, 0),
    cached_tokens: logs.reduce((sum, log) => sum + log.cached_tokens, 0),
    cache_write_tokens: logs.reduce((sum, log) => sum + log.cache_write_tokens, 0),
    provider_cache_status: statuses.length === 1 ? statuses[0] : "unreported",
    estimated_cost_usd: logs.reduce((sum, log) => sum + log.estimated_cost_usd, 0),
    status: "reported",
  });
}

export function emptyCostLog(status) {
  return Object.freeze({
    model: status === "not-run" ? "not-run" : "unreported",
    prompt_tokens: status === "not-run" ? 0 : null,
    completion_tokens: status === "not-run" ? 0 : null,
    cache_hits: status === "not-run" ? 0 : null,
    cached_tokens: status === "not-run" ? 0 : null,
    cache_write_tokens: status === "not-run" ? 0 : null,
    provider_cache_status: "unreported",
    estimated_cost_usd: status === "not-run" ? 0 : null,
    status,
  });
}

export function blockedResult(runId, stage, reasonCode, message, costLog, gatewayCostLog, details = {}) {
  return Object.freeze({
    runId,
    status: "blocked",
    stage,
    reasonCode,
    message,
    costLog,
    gatewayCostLog,
    ...(details.retryable === true ? { retryable: true } : {}),
    ...(details.continuationState ? { continuationState: details.continuationState } : {}),
  });
}

export function callWithTimeout(callback, input, timeoutMs, externalSignal, runController, label) {
  return new Promise((resolve, reject) => {
    if (externalSignal?.aborted) {
      runController.abort();
      reject(new FunctionCallingBlock("aborted", "Function-calling run was aborted."));
      return;
    }
    const timer = setTimeout(() => {
      runController.abort();
      reject(new FunctionCallingBlock("timeout", `${label} exceeded ${timeoutMs} milliseconds.`));
    }, timeoutMs);
    const onAbort = () => {
      runController.abort();
      reject(new FunctionCallingBlock("aborted", "Function-calling run was aborted."));
    };
    externalSignal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve().then(() => callback(Object.freeze({ ...input, signal: runController.signal })))
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(timer);
        externalSignal?.removeEventListener("abort", onAbort);
      });
  });
}
