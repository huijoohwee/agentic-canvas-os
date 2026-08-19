// Responsibility: Purely transform validated orchestration receipts into deterministic Storyboard projection values.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { PROJECTION_SCHEMA_ID, RECEIPT_INPUTS, LANE_CLAIM_STATES, observationTimestampFor } from "./orchestration-projection-contract.mjs";
import { projectionDigestSubject, renderProjectionDocument } from "./orchestration-projection-document.mjs";

const CARD_TYPE = "OrchestrationStage";
const EMPTY_SCOPE = "empty-scope";
const EVIDENCE_ORDER = Object.freeze(RECEIPT_INPUTS.map((input) => input.schemaId).sort());

export function buildProjection({ receipts, stageAxis, stalenessBoundSeconds, authoredDate = "2026-07-27" } = {}) {
  const receiptMap = new Map((Array.isArray(receipts) ? receipts : []).map((record) => [record.schema, record]));
  const observations = [...receiptMap].map(([schema, value]) => ({ schema, observedAt: observationTimestampFor(schema, value) }));
  const observedAt = observations.map((item) => item.observedAt).filter(Boolean).sort().at(-1) || null;
  if (observedAt) {
    const newest = Date.parse(observedAt);
    for (const item of observations) {
      if (!item.observedAt) continue;
      if ((newest - Date.parse(item.observedAt)) / 1000 > stalenessBoundSeconds) {
        return { ok: false, reason: "stale-observation", detail: { schema: item.schema, observedAt: item.observedAt } };
      }
    }
  }
  const lanes = deriveLaneAxis({
    worktreeLifecycle: receiptMap.get("agentic-worktree-lifecycle-report/v1"),
    workspaceParallelism: receiptMap.get("agentic-workspace-parallelism-report/v1"),
    writerLeaseRegistry: receiptMap.get("agentic-writer-lease-registry/v2"),
  });
  const nodes = buildCardNodes({ lanes, receiptMap, stageAxis });
  const value = {
    schema: PROJECTION_SCHEMA_ID,
    title: "Orchestration Projection",
    graphId: "md:orchestration-projection",
    doc_type: "Orchestration Projection",
    lang: "en-US",
    date: observedAt ? observedAt.slice(0, 10) : authoredDate,
    frontmatter_contract: "required",
    status: "runtime-ready",
    publish_policy: "Dev-only; no Prod mirror or Cloudflare authority",
    canvas2dRenderer: "storyboard",
    kgCanvas2dRenderer: "storyboard",
    observedAt,
    stalenessBoundSeconds,
    stageAxis: [...stageAxis],
    inputs: observations.sort(compareBySchema),
    lanes: lanes.map(({ lane, claimState, attained }) => ({ lane, claimState, attained })),
    nodes,
  };
  const textWithoutDigest = renderProjectionDocument(value, "");
  const digest = digestValue(projectionDigestSubject(textWithoutDigest));
  const text = renderProjectionDocument(value, digest);
  const lineCount = text.trimEnd().split("\n").length;
  if (lineCount > 600) return { ok: false, reason: "budget-exceeded", detail: { lineCount } };
  return { ok: true, value, digest, lineCount };
}

export function deriveLaneAxis({ worktreeLifecycle, workspaceParallelism, writerLeaseRegistry } = {}) {
  const records = [];
  for (const worktree of Array.isArray(worktreeLifecycle?.worktrees) ? worktreeLifecycle.worktrees : []) {
    records.push({ repository: repositoryName(worktree.repository || worktreeLifecycle.repository), scope: worktree.scope, branch: worktree.branch, worktree: worktree.path || worktree.worktree });
  }
  for (const lane of Array.isArray(workspaceParallelism?.lanes) ? workspaceParallelism.lanes : []) records.push(lane);
  for (const repository of Array.isArray(workspaceParallelism?.repositories) ? workspaceParallelism.repositories : []) {
    for (const lane of Array.isArray(repository.lanes) ? repository.lanes : []) records.push({ ...lane, repository: lane.repository || repository.repository || repository.name });
  }
  const claimByLane = new Map();
  for (const lease of Array.isArray(writerLeaseRegistry?.leases) ? writerLeaseRegistry.leases : []) {
    const identity = laneIdentity(lease);
    if (identity) claimByLane.set(identity, LANE_CLAIM_STATES.includes(lease.state) ? lease.state : "retired");
  }
  const byLane = new Map();
  for (const record of records) {
    const lane = laneIdentity(record);
    if (!lane || byLane.has(lane)) continue;
    byLane.set(lane, { lane, claimState: claimByLane.get(lane) || "retired", attained: 0 });
  }
  return [...byLane.values()].sort((left, right) => left.lane.localeCompare(right.lane));
}

export function buildCardNodes({ lanes, receiptMap, stageAxis }) {
  return lanes.flatMap((laneRecord) => {
    const attained = Math.min(stageAxis.length, EVIDENCE_ORDER.filter((schema) => receiptMap.has(schema)).length);
    laneRecord.attained = attained;
    return stageAxis.slice(0, attained).map((step, order) => ({
      id: laneRecord.lane + "::" + order,
      label: step,
      type: CARD_TYPE,
      properties: { lane: laneRecord.lane, claimState: laneRecord.claimState, order, step },
    }));
  }).sort((left, right) => left.properties.lane.localeCompare(right.properties.lane) || left.properties.order - right.properties.order);
}

function laneIdentity(record) {
  const repository = repositoryName(record?.repository || record?.repositoryId || "workspace");
  const scope = String(record?.scope || record?.semanticScope || scopeFromBranch(record?.branch) || EMPTY_SCOPE).trim();
  return repository + "::" + (scope || EMPTY_SCOPE);
}
function scopeFromBranch(branch) { return String(branch || "").split("/").filter(Boolean).at(-1) || null; }
function repositoryName(value) { return String(value || "workspace").replace(/\\/gu, "/").split("/").filter(Boolean).at(-1) || "workspace"; }
function compareBySchema(left, right) { return left.schema.localeCompare(right.schema); }
