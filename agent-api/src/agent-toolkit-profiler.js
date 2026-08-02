const SCHEMA = "agent-toolkit-profile/v1";

function percentile(values, fraction) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.ceil(fraction * ordered.length) - 1);
  return ordered[Math.max(0, index)];
}

function distribution(values) {
  const finite = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (!finite.length) return Object.freeze({ count: 0, p50: null, p95: null, p99: null, max: null });
  return Object.freeze({
    count: finite.length,
    p50: percentile(finite, 0.5),
    p95: percentile(finite, 0.95),
    p99: percentile(finite, 0.99),
    max: Math.max(...finite),
  });
}

export function profileToolkitRun(record) {
  const finishedSpans = record.spans.filter((span) => Number.isFinite(span.durationMs));
  const bottlenecks = [...finishedSpans]
    .sort((left, right) => right.durationMs - left.durationMs || left.spanId.localeCompare(right.spanId))
    .slice(0, 5)
    .map((span) => Object.freeze({
      spanId: span.spanId,
      ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
      kind: span.kind,
      operation: span.operation,
      component: span.component,
      status: span.status,
      durationMs: span.durationMs,
    }));
  const cost = record.completion?.cost;
  return Object.freeze({
    schema: SCHEMA,
    runId: record.runId,
    status: record.status,
    telemetryTrust: record.telemetryTrust,
    runDurationMs: record.completion?.durationMs ?? null,
    spanLatencyMs: distribution(finishedSpans.map((span) => span.durationMs)),
    spanStatusCounts: Object.freeze(record.spans.reduce((counts, span) => {
      counts[span.status] = (counts[span.status] || 0) + 1;
      return counts;
    }, {})),
    bottlenecks: Object.freeze(bottlenecks),
    tokenUsage: Object.freeze({
      status: cost?.status === "reported" ? "reported" : "unreported",
      promptTokens: cost?.prompt_tokens ?? null,
      completionTokens: cost?.completion_tokens ?? null,
      cacheHits: cost?.cache_hits ?? null,
    }),
    estimatedCostUsd: cost?.estimated_cost_usd ?? null,
    traceTruncated: record.traceTruncated,
  });
}
