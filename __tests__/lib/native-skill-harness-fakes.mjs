// Shared in-memory fakes and snapshot-diff helpers for the native skill
// creation harness tests. No network access and no Durable Object access.

import assert from "node:assert/strict";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// In-memory draft store: records invoked method names, honors expiresAt, and
// fails a put when a record with the same draft_id already exists, mirroring
// the single-record-per-identity Durable Object shape.
export function createInMemoryDraftStore({ now = () => 0 } = {}) {
  const records = new Map();
  const calls = [];
  const track = (method, argument) => {
    calls.push({ method, argument });
    return records;
  };
  return {
    calls,
    async put(draft) {
      track("put", draft.draft_id);
      if (records.has(draft.draft_id)) throw new TypeError("draft already stored");
      records.set(draft.draft_id, { ...draft });
      return true;
    },
    async peek(draftId) {
      track("peek", draftId);
      const record = records.get(draftId);
      if (!record) return null;
      return record.expires_at_ms <= now() ? null : { ...record };
    },
    async markConsumed(draftId) {
      track("markConsumed", draftId);
      const record = records.get(draftId);
      if (!record || record.consumed || record.expires_at_ms <= now()) return false;
      record.consumed = true;
      return true;
    },
    async indexAppend(adapterId, draftId) {
      track("indexAppend", `${adapterId}:${draftId}`);
      const index = records.get(`index:${adapterId}`) || { draftIds: [] };
      if (index.draftIds.length >= 64) throw new RangeError("draft index is full");
      if (!index.draftIds.includes(draftId)) index.draftIds.push(draftId);
      records.set(`index:${adapterId}`, index);
      return true;
    },
    async indexList(adapterId) {
      track("indexList", adapterId);
      return [...((records.get(`index:${adapterId}`) || { draftIds: [] }).draftIds)];
    },
  };
}

// Scripted candidate adapter driven by an outcome marker sequence over
// { valid, malformed, throws }. Each consume() advances the script.
export function createScriptedCandidateAdapter(markers, { validCandidate, model = "scripted-model" } = {}) {
  let cursor = 0;
  const calls = [];
  const candidate = validCandidate || {
    agent_definition: {
      id: "draft-gap-agent",
      revision: "draft-gap-v1",
      name: "Gap Draft Agent",
      source: { uri: "workspace:/agents/gap-draft.json", digest: "b".repeat(64) },
      model: { providerId: "scripted-provider", modelId: "scripted-model" },
      instructions: [{ name: "purpose", content: "Cover the observed capability gap." }],
    },
    rationale: "Derived from the observed tool-search denial.",
    confidence: 0.72,
  };
  return {
    calls,
    async proposeCandidate(promptContext) {
      const marker = markers[Math.min(cursor, markers.length - 1)] ?? "valid";
      cursor += 1;
      calls.push({ marker, promptContext });
      if (marker === "throws") throw new Error("provider unreachable");
      if (marker === "malformed") return { agent_definition: null, rationale: "", confidence: 2 };
      return { ...candidate, usage: { model, prompt_tokens: 120, completion_tokens: 80, cache_hits: 32, estimated_cost_usd: 0.002 } };
    },
  };
}

export function createRecordingObserver({ throws = false } = {}) {
  const entries = [];
  return {
    entries,
    async emit(entry) {
      if (throws) throw new Error("observer unavailable");
      entries.push(entry);
    },
  };
}

export function createInMemoryToolAllowlist() {
  const entries = new Map();
  return {
    async add(entry) {
      entries.set(entry.entry_id, { ...entry });
      return true;
    },
    has(entryId) {
      return entries.has(entryId);
    },
    snapshot() {
      return JSON.stringify([...entries.values()].map((entry) => ({
        entry_id: entry.entry_id,
        agent_definition_id: entry.agent_definition_id,
        adapter_identity: entry.adapter_identity,
        tool_names: [...entry.tool_names],
        review_required: entry.review_required,
      })).sort());
    },
  };
}

export function createOperatorInstructionResolver({ resolvable = [] } = {}) {
  const calls = [];
  return {
    calls,
    async resolveOperatorInstruction(reference) {
      calls.push(reference);
      if (typeof reference !== "string" || !reference.trim()) return { resolved: false };
      return resolvable.includes(reference) ? { resolved: true, reference } : { resolved: false };
    },
  };
}

export function createInvocationRegisterFake({ declared = [] } = {}) {
  return {
    declares(token) {
      return declared.includes(token);
    },
  };
}

export function createValidGapSignal(overrides = {}) {
  return {
    schema: "acos-gap-signal/v1",
    signal_id: "gap-001",
    adapter_id: "agentic-graph",
    capability: "update agent run notes",
    missing_tool_names: ["update_agent_run_note"],
    denial_reason_code: "tool_not_granted",
    observed_at_ms: 1786950000000,
    evidence_reference: null,
    ...overrides,
  };
}

export function createValidAgentDefinition(overrides = {}) {
  return {
    id: "agentic-graph-note-agent",
    revision: "note-v1",
    name: "agentic-graph Note Agent",
    source: { uri: "workspace:/agents/agentic-graph-note-agent.json", digest: "c".repeat(64) },
    model: { providerId: "workspace-provider", modelId: "workspace-model" },
    instructions: [{ name: "purpose", content: "Draft agent run notes through the MCP gateway." }],
    ...overrides,
  };
}

export function createValidToolAllowlistEntry(overrides = {}) {
  return {
    entry_id: "allowlist-agentic-graph-note-agent-1",
    agent_definition_id: "agentic-graph-note-agent",
    adapter_identity: "agentic-graph",
    tool_names: ["update_agent_run_note"],
    review_required: true,
    ...overrides,
  };
}

export const DRAFT_TTL_MS = THIRTY_DAYS_MS;

export function captureSnapshot(registry) {
  return registry.snapshot().serialization;
}

export function assertSnapshotUnchanged(before, after) {
  if (before === after) return;
  let offset = 0;
  while (offset < Math.max(before.length, after.length) && before[offset] === after[offset]) offset += 1;
  assert.fail(
    `Active Registry Snapshot changed at byte offset ${offset}: `
    + `before ...${before.slice(Math.max(0, offset - 24), offset + 24)}... `
    + `after ...${after.slice(Math.max(0, offset - 24), offset + 24)}...`,
  );
}
