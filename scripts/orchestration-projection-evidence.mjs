// Responsibility: Build redacted orchestration projection run receipts for CLI success and failure paths.
export const PROJECTION_RUN_RECEIPT_SCHEMA = "agentic-orchestration-projection-receipt/v1";

export function buildRunReceipt(result) {
  if (result?.ok) return {
    schema: PROJECTION_RUN_RECEIPT_SCHEMA,
    status: "emitted",
    reason: null,
    detail: null,
    projectionSchema: result.value.schema,
    projectionDigest: result.digest,
    observedAt: result.value.observedAt,
    laneCount: result.value.lanes.length,
    cardCount: result.value.nodes.length,
    lineCount: result.lineCount,
  };
  return {
    schema: PROJECTION_RUN_RECEIPT_SCHEMA,
    status: "failed",
    reason: result?.reason || "input-absent",
    detail: redactDetail(result?.detail || null),
    projectionSchema: null,
    projectionDigest: null,
    observedAt: null,
    laneCount: 0,
    cardCount: 0,
    lineCount: 0,
  };
}

function redactDetail(value) {
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactScalar(item)]));
}
function redactScalar(value) {
  if (typeof value !== "string") return value;
  return value.replace(/(?:[A-Za-z]:)?[\\/][^\s"]+/gu, "<Workspace_Root>").replace(/[0-9]{4,5}/gu, "<port>");
}
