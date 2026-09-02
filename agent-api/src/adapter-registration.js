// Adapter Registration Interface for the native skill creation harness.
//
// One stable surface any product repository uses to register an Agent
// Definition plus a tool allowlist entry without editing the shared Worker
// entrypoint. Every malformed registration surfaces as a typed finding, never
// an untyped error, and the module holds no request-scoped state between
// register calls beyond the monotonic counters stats() reports.

export const REGISTRATION_FINDING_TYPES = Object.freeze(["unfederated-tool", "uncatalogued-tool"]);
export const REGISTRATION_RECORD_SCHEMA = "acos-adapter-registration/v1";
export const REGISTRATION_FINDING_SCHEMA = "acos-adapter-registration-finding/v1";
export const ADAPTER_REGISTRATION_OWNER = "acos-adapter-registration";

const REGISTRATION_OPTION_KEYS = [
  "agentDefinitionRegistry",
  "toolAllowlist",
  "invocationRegister",
  "resolveOperatorInstruction",
  "emitTrace",
  "now",
];

const TOOL_ALLOWLIST_ENTRY_KEYS = ["entry_id", "agent_definition_id", "adapter_identity", "tool_names", "review_required"];
const INVOCATION_REGISTER_ENTRY_KEYS = ["route", "tag", "binding", "tool_identity"];
const INVOCATION_REGISTER_TOKEN_FIELDS = ["route", "tag", "binding", "tool_identity"];

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

export class RegistrationBlock extends Error {
  constructor(reasonCode, message, details = {}) {
    super(message);
    this.name = "RegistrationBlock";
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

function finding(type, reasonCode, message, details = {}) {
  return Object.freeze({
    schema: REGISTRATION_FINDING_SCHEMA,
    type,
    adapter_identity: typeof details.adapter_identity === "string" ? details.adapter_identity : null,
    reason_code: reasonCode,
    message,
    details: Object.freeze({ ...details }),
  });
}

function rejected(findingValue) {
  return Object.freeze({ status: "rejected", record: null, finding: findingValue });
}

export function createAdapterRegistrationInterface(options = {}) {
  assertExactKeys(options, REGISTRATION_OPTION_KEYS, "adapter registration options");
  const {
    agentDefinitionRegistry,
    toolAllowlist,
    invocationRegister,
    resolveOperatorInstruction,
    emitTrace,
    now = () => Date.now(),
  } = options;

  let registeredCount = 0;
  let rejectedCount = 0;

  function emitTraceSafe(entry) {
    if (typeof emitTrace !== "function") return;
    try {
      const pending = emitTrace(entry);
      if (pending && typeof pending.catch === "function") void pending.catch(() => {});
    } catch {
      // An observer failure never changes a terminal outcome.
    }
  }

  async function preflight(agentDefinition, toolAllowlistEntry, invocationRegisterEntry, operatorInstructionRef) {
    const adapterIdentity = typeof toolAllowlistEntry?.adapter_identity === "string"
      ? toolAllowlistEntry.adapter_identity
      : null;

    try {
      if (!toolAllowlistEntry || typeof toolAllowlistEntry !== "object" || Array.isArray(toolAllowlistEntry)) {
        return rejected(finding(
          "unfederated-tool",
          "tool_allowlist_entry_missing",
          "A registration requires a tool allowlist entry conforming to the Function Calling Gateway contract.",
          { adapter_identity: adapterIdentity },
        ));
      }
      let normalizedToolAllowlistEntry;
      try {
        assertExactKeys(toolAllowlistEntry, TOOL_ALLOWLIST_ENTRY_KEYS, "tool_allowlist_entry");
        const entryId = assertIdentifier(toolAllowlistEntry.entry_id, "tool_allowlist_entry.entry_id");
        const agentDefinitionId = assertIdentifier(toolAllowlistEntry.agent_definition_id, "tool_allowlist_entry.agent_definition_id");
        const normalizedAdapterIdentity = assertIdentifier(toolAllowlistEntry.adapter_identity, "tool_allowlist_entry.adapter_identity");
        if (typeof toolAllowlistEntry.review_required !== "boolean") {
          throw new TypeError("tool_allowlist_entry.review_required must be boolean.");
        }
        if (!Array.isArray(toolAllowlistEntry.tool_names) || toolAllowlistEntry.tool_names.length === 0) {
          throw new TypeError("tool_allowlist_entry.tool_names must be a non-empty array.");
        }
        const names = toolAllowlistEntry.tool_names.map((name, index) => assertIdentifier(name, `tool_allowlist_entry.tool_names[${index}]`));
        if (new Set(names).size !== names.length) {
          throw new TypeError("tool_allowlist_entry.tool_names contains a duplicate entry.");
        }
        normalizedToolAllowlistEntry = Object.freeze({
          entry_id: entryId,
          agent_definition_id: agentDefinitionId,
          adapter_identity: normalizedAdapterIdentity,
          tool_names: Object.freeze(names),
          review_required: toolAllowlistEntry.review_required,
        });
      } catch (error) {
        return rejected(finding(
          "unfederated-tool",
          "tool_allowlist_entry_invalid",
          error instanceof Error ? error.message : String(error),
          { adapter_identity: adapterIdentity },
        ));
      }

      const declaredAdapterIdentity = normalizedToolAllowlistEntry.adapter_identity;
      if (!invocationRegister || typeof invocationRegister.declares !== "function") {
        return rejected(finding(
          "uncatalogued-tool",
          "invocation_register_unconfigured",
          "A registration requires an Invocation Register reader that declares the adapter's route, tag, binding, and tool identity.",
          { adapter_identity: declaredAdapterIdentity },
        ));
      }
      try {
        assertExactKeys(invocationRegisterEntry ?? {}, INVOCATION_REGISTER_ENTRY_KEYS, "invocation_register_entry");
        for (const field of INVOCATION_REGISTER_TOKEN_FIELDS) {
          const token = assertIdentifier(invocationRegisterEntry[field], `invocation_register_entry.${field}`);
          if (!invocationRegister.declares(token)) {
            throw new TypeError(`invocation_register_entry.${field} is not declared: ${token}.`);
          }
        }
      } catch (error) {
        return rejected(finding(
          "uncatalogued-tool",
          "invocation_register_entry_invalid",
          error instanceof Error ? error.message : String(error),
          { adapter_identity: declaredAdapterIdentity },
        ));
      }

      if (
        !agentDefinitionRegistry
        || typeof agentDefinitionRegistry.preflight !== "function"
        || typeof agentDefinitionRegistry.register !== "function"
      ) {
        return rejected(finding(
          "unfederated-tool",
          "registry_unconfigured",
          "A registration requires the shared Agent Definition registry.",
          { adapter_identity: declaredAdapterIdentity },
        ));
      }

      const requestedStatus = agentDefinition?.status === undefined ? "active" : agentDefinition.status;
      const reference = typeof operatorInstructionRef === "string" ? operatorInstructionRef.trim() : "";
      if (requestedStatus === "active") {
        // Consistent with the approval-gated trust boundary declared for
        // acos.adapter.register: no active outcome without a resolved
        // operator instruction reference.
        let resolution = null;
        if (reference && typeof resolveOperatorInstruction === "function") {
          try {
            resolution = await resolveOperatorInstruction(reference);
          } catch {
            resolution = null;
          }
        }
        if (!resolution || resolution.resolved !== true) {
          return rejected(finding(
            "unfederated-tool",
            "operator_instruction_required",
            "A registration resulting in an active Agent Definition requires a resolvable operator instruction reference.",
            { adapter_identity: declaredAdapterIdentity },
          ));
        }
      }

      let definitionPreflight;
      try {
        definitionPreflight = agentDefinitionRegistry.preflight(
          agentDefinition?.status === undefined ? { ...agentDefinition } : agentDefinition,
        );
        if (normalizedToolAllowlistEntry.agent_definition_id !== definitionPreflight.definition.id) {
          throw new TypeError("tool_allowlist_entry.agent_definition_id must equal definition.id.");
        }
      } catch (error) {
        const reasonCode = error?.reasonCode === "agent_revision_conflict" ? "agent_revision_conflict" : "agent_definition_invalid";
        return rejected(finding(
          "unfederated-tool",
          reasonCode,
          error instanceof Error ? error.message : String(error),
          { adapter_identity: declaredAdapterIdentity },
        ));
      }

      if (requestedStatus === "active" && typeof toolAllowlist?.preflight === "function") {
        try {
          await toolAllowlist.preflight(normalizedToolAllowlistEntry);
        } catch (error) {
          return rejected(finding(
            "unfederated-tool",
            typeof error?.reasonCode === "string" ? error.reasonCode : "tool_allowlist_entry_conflict",
            error instanceof Error ? error.message : String(error),
            { adapter_identity: declaredAdapterIdentity },
          ));
        }
      }

      const registration = Object.freeze({
        agentDefinition: definitionPreflight.definition,
        toolAllowlistEntry: normalizedToolAllowlistEntry,
        invocationRegisterEntry: Object.freeze(Object.fromEntries(
          INVOCATION_REGISTER_TOKEN_FIELDS.map((field) => [field, invocationRegisterEntry[field]]),
        )),
        requestedStatus,
        operatorInstructionReference: requestedStatus === "active" ? reference : null,
      });
      return Object.freeze({ status: "validated", registration, finding: null });
    } catch (error) {
      return rejected(finding(
        "unfederated-tool",
        "registration_failed",
        error instanceof Error ? error.message : String(error),
        { adapter_identity: adapterIdentity },
      ));
    }
  }

  function createRecord(registration, registeredAtMs = now()) {
    return Object.freeze({
      schema: REGISTRATION_RECORD_SCHEMA,
      adapter_identity: registration.toolAllowlistEntry.adapter_identity,
      agent_definition_id: registration.agentDefinition.id,
      tool_allowlist_entry_id: registration.toolAllowlistEntry.entry_id,
      invocation_register_tokens: Object.freeze(INVOCATION_REGISTER_TOKEN_FIELDS.map(
        (field) => registration.invocationRegisterEntry[field],
      )),
      resulting_status: registration.requestedStatus,
      operator_instruction_reference: registration.operatorInstructionReference,
      registered_at_ms: registeredAtMs,
    });
  }

  async function project(registration, record = createRecord(registration), { allowToolAllowlistStaging = false } = {}) {
    const result = agentDefinitionRegistry.register(registration.agentDefinition);
    if (result.id !== record.agent_definition_id) {
      throw new RegistrationBlock("agent_projection_mismatch", "Projected Agent Definition does not match the durable receipt.");
    }
    if (registration.requestedStatus === "active") {
      if (!toolAllowlist || typeof toolAllowlist.add !== "function") {
        if (!allowToolAllowlistStaging) {
          throw new RegistrationBlock("tool_allowlist_unconfigured", "Active registration projection requires a tool allowlist owner.");
        }
      } else {
        const applied = await toolAllowlist.add({
          entry_id: registration.toolAllowlistEntry.entry_id,
          agent_definition_id: result.id,
          adapter_identity: registration.toolAllowlistEntry.adapter_identity,
          tool_names: [...registration.toolAllowlistEntry.tool_names],
          review_required: registration.toolAllowlistEntry.review_required,
        });
        if (applied !== true) {
          throw new RegistrationBlock("tool_allowlist_projection_failed", "Tool allowlist projection did not commit.");
        }
      }
    }
    registeredCount += 1;
    emitTraceSafe({ schema: REGISTRATION_RECORD_SCHEMA, status: "registered", agent_definition_id: result.id });
    return record;
  }

  // register(agent_definition, tool_allowlist_entry, invocation_register_entry,
  // operator_instruction_ref) preserves the native interface while delegating
  // durable callers to the separate preflight and projection phases.
  async function register(agentDefinition, toolAllowlistEntry, invocationRegisterEntry, operatorInstructionRef) {
    const validated = await preflight(
      agentDefinition,
      toolAllowlistEntry,
      invocationRegisterEntry,
      operatorInstructionRef,
    );
    if (validated.status !== "validated") {
      rejectedCount += 1;
      return validated;
    }
    try {
      const record = createRecord(validated.registration);
      await project(validated.registration, record, { allowToolAllowlistStaging: true });
      return Object.freeze({ status: "registered", record, finding: null });
    } catch (error) {
      rejectedCount += 1;
      return rejected(finding(
        "unfederated-tool",
        "registration_failed",
        error instanceof Error ? error.message : String(error),
        { adapter_identity: validated.registration.toolAllowlistEntry.adapter_identity },
      ));
    }
  }

  function resetToolAllowlistProjection() {
    if (!toolAllowlist || typeof toolAllowlist.reset !== "function") {
      throw new RegistrationBlock("tool_allowlist_reset_unconfigured", "Durable rehydration requires a resettable tool allowlist projection.");
    }
    toolAllowlist.reset();
  }

  return Object.freeze({
    preflight,
    createRecord,
    project,
    register,
    resetToolAllowlistProjection,
    stats: () => Object.freeze({
      registryConfigured: Boolean(agentDefinitionRegistry && typeof agentDefinitionRegistry.register === "function"),
      toolAllowlistConfigured: Boolean(toolAllowlist && typeof toolAllowlist.add === "function"),
      toolAllowlistPreflightConfigured: Boolean(toolAllowlist && typeof toolAllowlist.preflight === "function"),
      invocationRegisterConfigured: Boolean(invocationRegister && typeof invocationRegister.declares === "function"),
      operatorInstructionResolverConfigured: typeof resolveOperatorInstruction === "function",
      registrationOwner: ADAPTER_REGISTRATION_OWNER,
      sharedEntrypointAdapterNames: 0,
      requestScopedState: false,
      registeredCount,
      rejectedCount,
    }),
  });
}
