// Skill Registry Promotion Gate for the native skill creation harness.
//
// The single owner of the proposed -> active Agent Definition transition.
// Closed by default: promote requires a resolvable Operator_Instruction_
// Reference, and no configuration value, environment variable, or flag can
// open the boundary because the factory accepts no such parameter. This
// module imports nothing from skill-proposer.js, makes no model provider
// call (the capability is absent, not merely unused), and holds no write
// capability to the draft store beyond markConsumed on the promoted draft.

export class PromotionBlock extends Error {
  constructor(reasonCode, message, details = {}) {
    super(message);
    this.name = "PromotionBlock";
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

export const PROMOTION_ARTIFACT_TYPE = "agent-definition";
export const PROMOTION_BOUNDARY_NAME = "skill-registry-promotion";
export const PROMOTION_GATE_IDENTITY = "acos-skill-registry-gate";
export const PROMOTION_RECORD_SCHEMA = "acos-skill-promotion/v1";
export const PROMOTION_ROLLBACK_STATEMENT = "Re-register the affected definition at its prior revision with status proposed, remove the added tool allowlist entry, and assert the Active Registry Snapshot serialization equals the recorded pre-promotion value. Schema additions are additive, so no data migration is required.";

const GATE_OPTION_KEYS = [
  "draftStore",
  "agentDefinitionRegistry",
  "toolAllowlist",
  "resolveOperatorInstruction",
  "emitTrace",
  "now",
];

function assertExactKeys(value, allowedKeys, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object.`);
  }
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknown.length) throw new TypeError(`${field} contains unsupported fields: ${unknown.join(", ")}.`);
}

function assertIdentifier(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  return value.trim();
}

function blockedOutcome(draftId, reasonCode) {
  return Object.freeze({
    status: "blocked",
    draft_id: draftId ?? null,
    agent_definition_id: null,
    tool_allowlist_entry_id: null,
    promotion_record: null,
    reason_code: reasonCode,
  });
}

export function createSkillRegistryGate(options = {}) {
  // Strict option keys: an unknown option (a flag, an env name, a bypass) is
  // a construction-time rejection, so no configuration value can open the gate.
  assertExactKeys(options, GATE_OPTION_KEYS, "skill registry gate options");
  const {
    draftStore,
    agentDefinitionRegistry,
    toolAllowlist,
    resolveOperatorInstruction,
    emitTrace,
    now = () => Date.now(),
  } = options;

  let promotionCount = 0;
  let blockedCount = 0;
  const promotedDraftIds = new Set();

  function emitTraceSafe(entry) {
    if (typeof emitTrace !== "function") return;
    try {
      void emitTrace(entry);
    } catch {
      // An observer failure never changes a terminal outcome.
    }
  }

  function boundaryState(draftId) {
    return typeof draftId === "string" && promotedDraftIds.has(draftId) ? "open" : "closed";
  }

  async function promote(draftIdValue, operatorInstructionRefValue) {
    let draftId;
    try {
      draftId = assertIdentifier(draftIdValue, "draft_id");
    } catch {
      return blockedOutcome(null, "draft_not_found");
    }

    // The only key that opens the gate: a resolvable operator instruction.
    const reference = typeof operatorInstructionRefValue === "string" ? operatorInstructionRefValue.trim() : "";
    if (!reference || typeof resolveOperatorInstruction !== "function") {
      blockedCount += 1;
      emitTraceSafe({ schema: PROMOTION_RECORD_SCHEMA, draft_id: draftId, status: "blocked", reason_code: "operator_instruction_unresolved" });
      return blockedOutcome(draftId, "operator_instruction_unresolved");
    }
    let resolution;
    try {
      resolution = await resolveOperatorInstruction(reference);
    } catch {
      resolution = { resolved: false };
    }
    if (!resolution || resolution.resolved !== true) {
      blockedCount += 1;
      emitTraceSafe({ schema: PROMOTION_RECORD_SCHEMA, draft_id: draftId, status: "blocked", reason_code: "operator_instruction_unresolved" });
      return blockedOutcome(draftId, "operator_instruction_unresolved");
    }

    if (!draftStore || typeof draftStore.peek !== "function" || typeof draftStore.markConsumed !== "function") {
      blockedCount += 1;
      emitTraceSafe({ schema: PROMOTION_RECORD_SCHEMA, draft_id: draftId, status: "blocked", reason_code: "operator_instruction_unresolved" });
      return blockedOutcome(draftId, "operator_instruction_unresolved");
    }

    // Every part of the decision is derived from the stored draft and the
    // resolved reference, never from a proposer call frame.
    const draft = await draftStore.peek(draftId);
    if (!draft || draft.status !== "proposed" || !draft.agent_definition) {
      blockedCount += 1;
      emitTraceSafe({ schema: PROMOTION_RECORD_SCHEMA, draft_id: draftId, status: "blocked", reason_code: "draft_not_found" });
      return blockedOutcome(draftId, "draft_not_found");
    }
    if (draft.consumed === true) {
      blockedCount += 1;
      emitTraceSafe({ schema: PROMOTION_RECORD_SCHEMA, draft_id: draftId, status: "blocked", reason_code: "draft_already_consumed" });
      return blockedOutcome(draftId, "draft_already_consumed");
    }

    // Machine-checkable half of ADR-1's by-construction independence claim:
    // the promotion record names a proposing mechanism distinct from the gate.
    if (!draft.proposing_mechanism || draft.proposing_mechanism.identity === PROMOTION_GATE_IDENTITY) {
      throw new PromotionBlock(
        "proposer_identity_collision",
        "The promotion record's proposing mechanism identity must differ from the promotion gate identity.",
        { draft_id: draftId },
      );
    }

    if (!agentDefinitionRegistry || typeof agentDefinitionRegistry.register !== "function") {
      blockedCount += 1;
      emitTraceSafe({ schema: PROMOTION_RECORD_SCHEMA, draft_id: draftId, status: "blocked", reason_code: "operator_instruction_unresolved" });
      return blockedOutcome(draftId, "operator_instruction_unresolved");
    }

    const promotedRevision = `${draft.agent_definition.revision}.promoted-${now()}`;
    let registration;
    try {
      registration = agentDefinitionRegistry.register({
        ...draft.agent_definition,
        revision: promotedRevision,
        status: "active",
      });
    } catch (error) {
      blockedCount += 1;
      emitTraceSafe({
        schema: PROMOTION_RECORD_SCHEMA,
        draft_id: draftId,
        status: "blocked",
        reason_code: "registry_write_failed",
        message: error instanceof Error ? error.message : String(error),
      });
      return blockedOutcome(draftId, "registry_write_failed");
    }

    const consumed = await draftStore.markConsumed(draftId);
    if (!consumed) {
      // Fail closed: undo the registry write so no unconsumed draft is
      // simultaneously active.
      if (typeof agentDefinitionRegistry.remove === "function") {
        agentDefinitionRegistry.remove({ agentId: registration.id, revision: promotedRevision });
      }
      blockedCount += 1;
      emitTraceSafe({ schema: PROMOTION_RECORD_SCHEMA, draft_id: draftId, status: "blocked", reason_code: "draft_consume_failed" });
      return blockedOutcome(draftId, "draft_consume_failed");
    }

    const allowlistEntry = Object.freeze({
      entry_id: `allowlist:${registration.id}:${now()}`,
      agent_definition_id: registration.id,
      adapter_identity: draft.adapter_id,
      tool_names: Object.freeze([...(Array.isArray(draft.tool_names) && draft.tool_names.length ? draft.tool_names : draft.agent_definition.tools?.map((tool) => tool.name) ?? [])]),
      review_required: true,
    });
    // The production allowlist is an environment-variable-seeded gateway
    // today (see docs/NATIVE-SKILL-HARNESS.md), so the gate stages the entry
    // and applies it only when an in-Worker allowlist owner is injected.
    let allowlistApplied = false;
    if (toolAllowlist && typeof toolAllowlist.add === "function") {
      allowlistApplied = (await toolAllowlist.add(allowlistEntry)) === true;
    }

    promotionCount += 1;
    promotedDraftIds.add(draftId);
    const promotionRecord = Object.freeze({
      schema: PROMOTION_RECORD_SCHEMA,
      boundary: Object.freeze({
        name: PROMOTION_BOUNDARY_NAME,
        evidence_reference: null,
        operator_instruction_reference: reference,
        rollback_statement: PROMOTION_ROLLBACK_STATEMENT,
      }),
      proposing_mechanism: Object.freeze({ ...draft.proposing_mechanism }),
    });
    emitTraceSafe({
      schema: PROMOTION_RECORD_SCHEMA,
      draft_id: draftId,
      status: "promoted",
      agent_definition_id: registration.id,
      tool_allowlist_entry_id: allowlistEntry.entry_id,
      tool_allowlist_entry_staged: !allowlistApplied,
    });
    return Object.freeze({
      status: "promoted",
      draft_id: draftId,
      agent_definition_id: registration.id,
      tool_allowlist_entry_id: allowlistEntry.entry_id,
      tool_allowlist_entry_staged: !allowlistApplied,
      promotion_record: promotionRecord,
      reason_code: null,
    });
  }

  return Object.freeze({
    promote,
    boundaryState,
    stats: () => Object.freeze({
      draftStoreConfigured: Boolean(draftStore && typeof draftStore.peek === "function" && typeof draftStore.markConsumed === "function"),
      registryConfigured: Boolean(agentDefinitionRegistry && typeof agentDefinitionRegistry.register === "function"),
      toolAllowlistConfigured: Boolean(toolAllowlist && typeof toolAllowlist.add === "function"),
      operatorInstructionResolverConfigured: typeof resolveOperatorInstruction === "function",
      boundaryState: "closed",
      promotionOwner: PROMOTION_GATE_IDENTITY,
      artifactType: PROMOTION_ARTIFACT_TYPE,
      modelCallCapability: false,
      promotionCount,
      blockedCount,
    }),
  });
}
