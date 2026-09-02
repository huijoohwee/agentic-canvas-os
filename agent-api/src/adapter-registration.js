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
      void emitTrace(entry);
    } catch {
      // An observer failure never changes a terminal outcome.
    }
  }

  // register(agent_definition, tool_allowlist_entry, invocation_register_entry,
  // operator_instruction_ref): the PRD's two-argument shape is a prefix of
  // this signature; all three parts are required so each missing part maps to
  // exactly one finding type.
  async function register(agentDefinition, toolAllowlistEntry, invocationRegisterEntry, operatorInstructionRef) {
    const adapterIdentity = typeof toolAllowlistEntry?.adapter_identity === "string"
      ? toolAllowlistEntry.adapter_identity
      : null;

    try {
      if (!toolAllowlistEntry || typeof toolAllowlistEntry !== "object" || Array.isArray(toolAllowlistEntry)) {
        rejectedCount += 1;
        return rejected(finding(
          "unfederated-tool",
          "tool_allowlist_entry_missing",
          "A registration requires a tool allowlist entry conforming to the Function Calling Gateway contract.",
          { adapter_identity: adapterIdentity },
        ));
      }
      try {
        assertExactKeys(toolAllowlistEntry, TOOL_ALLOWLIST_ENTRY_KEYS, "tool_allowlist_entry");
        assertIdentifier(toolAllowlistEntry.entry_id, "tool_allowlist_entry.entry_id");
        assertIdentifier(toolAllowlistEntry.agent_definition_id, "tool_allowlist_entry.agent_definition_id");
        assertIdentifier(toolAllowlistEntry.adapter_identity, "tool_allowlist_entry.adapter_identity");
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
      } catch (error) {
        rejectedCount += 1;
        return rejected(finding(
          "unfederated-tool",
          "tool_allowlist_entry_invalid",
          error instanceof Error ? error.message : String(error),
          { adapter_identity: adapterIdentity },
        ));
      }

      const declaredAdapterIdentity = toolAllowlistEntry.adapter_identity;
      if (!invocationRegister || typeof invocationRegister.declares !== "function") {
        rejectedCount += 1;
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
        rejectedCount += 1;
        return rejected(finding(
          "uncatalogued-tool",
          "invocation_register_entry_invalid",
          error instanceof Error ? error.message : String(error),
          { adapter_identity: declaredAdapterIdentity },
        ));
      }

      if (!agentDefinitionRegistry || typeof agentDefinitionRegistry.register !== "function") {
        rejectedCount += 1;
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
          rejectedCount += 1;
          return rejected(finding(
            "unfederated-tool",
            "operator_instruction_required",
            "A registration resulting in an active Agent Definition requires a resolvable operator instruction reference.",
            { adapter_identity: declaredAdapterIdentity },
          ));
        }
      }

      let registration;
      try {
        registration = agentDefinitionRegistry.register(
          agentDefinition?.status === undefined ? { ...agentDefinition } : agentDefinition,
        );
      } catch (error) {
        rejectedCount += 1;
        const reasonCode = error?.reasonCode === "agent_revision_conflict" ? "agent_revision_conflict" : "agent_definition_invalid";
        return rejected(finding(
          "unfederated-tool",
          reasonCode,
          error instanceof Error ? error.message : String(error),
          { adapter_identity: declaredAdapterIdentity },
        ));
      }

      if (requestedStatus === "active" && toolAllowlist && typeof toolAllowlist.add === "function") {
        await toolAllowlist.add({
          entry_id: toolAllowlistEntry.entry_id,
          agent_definition_id: registration.id,
          adapter_identity: toolAllowlistEntry.adapter_identity,
          tool_names: [...toolAllowlistEntry.tool_names],
          review_required: toolAllowlistEntry.review_required,
        });
      }

      // The record is constructed and frozen only after the registry write
      // returned, so no partially written record can exist.
      registeredCount += 1;
      const record = Object.freeze({
        schema: REGISTRATION_RECORD_SCHEMA,
        adapter_identity: toolAllowlistEntry.adapter_identity,
        agent_definition_id: registration.id,
        tool_allowlist_entry_id: toolAllowlistEntry.entry_id,
        invocation_register_tokens: Object.freeze(INVOCATION_REGISTER_TOKEN_FIELDS.map((field) => invocationRegisterEntry[field])),
        resulting_status: requestedStatus,
        operator_instruction_reference: requestedStatus === "active" ? reference : null,
        registered_at_ms: now(),
      });
      emitTraceSafe({ schema: REGISTRATION_RECORD_SCHEMA, status: "registered", agent_definition_id: registration.id });
      return Object.freeze({ status: "registered", record, finding: null });
    } catch (error) {
      // Totality: no path throws an untyped error to the adapter.
      rejectedCount += 1;
      return rejected(finding(
        "unfederated-tool",
        "registration_failed",
        error instanceof Error ? error.message : String(error),
        { adapter_identity: adapterIdentity },
      ));
    }
  }

  return Object.freeze({
    register,
    stats: () => Object.freeze({
      registryConfigured: Boolean(agentDefinitionRegistry && typeof agentDefinitionRegistry.register === "function"),
      toolAllowlistConfigured: Boolean(toolAllowlist && typeof toolAllowlist.add === "function"),
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
