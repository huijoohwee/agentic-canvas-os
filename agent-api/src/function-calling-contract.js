import { normalizeJson, serializedJsonLength } from "./json-contract.js";
import { assertIdentifier } from "./function-calling-runtime-support.js";

const TOOL_CHOICE_MODES = new Set(["auto", "required", "none", "forced", "allowed"]);
const ALLOWED_REQUIREMENTS = new Set(["auto", "required"]);

export function normalizeCapabilities(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("capabilities must be an object.");
  }
  const fields = ["functionCalling", "strictSchemas", "parallelFunctionCalls",
    "previousResponseContinuation", "reasoningItemReplay"];
  for (const field of fields) {
    if (typeof value[field] !== "boolean") throw new TypeError(`capabilities.${field} must be boolean.`);
  }
  return Object.freeze(Object.fromEntries(fields.map((field) => [field, value[field]])));
}

function schemaIncludesType(schema, type) {
  return schema.type === type || (Array.isArray(schema.type) && schema.type.includes(type));
}

function assertStrictSchemaNode(schema, field) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new TypeError(`${field} must be a schema object.`);
  }
  if (schemaIncludesType(schema, "object") || schema.properties !== undefined) {
    if (schema.additionalProperties !== false) {
      throw new TypeError(`${field}.additionalProperties must be false in strict mode.`);
    }
    const properties = schema.properties || {};
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
      throw new TypeError(`${field}.properties must be an object.`);
    }
    if (!Array.isArray(schema.required)) throw new TypeError(`${field}.required must list every property.`);
    const propertyNames = Object.keys(properties).sort();
    const requiredNames = [...new Set(schema.required)].sort();
    if (requiredNames.length !== schema.required.length || propertyNames.join("\0") !== requiredNames.join("\0")) {
      throw new TypeError(`${field}.required must contain every property exactly once.`);
    }
    for (const [name, child] of Object.entries(properties)) {
      assertStrictSchemaNode(child, `${field}.properties.${name}`);
    }
  }
  if (schemaIncludesType(schema, "array") && schema.items !== undefined) {
    assertStrictSchemaNode(schema.items, `${field}.items`);
  }
  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    if (schema[keyword] === undefined) continue;
    if (!Array.isArray(schema[keyword])) throw new TypeError(`${field}.${keyword} must be an array.`);
    schema[keyword].forEach((child, index) => assertStrictSchemaNode(child, `${field}.${keyword}[${index}]`));
  }
  for (const keyword of ["$defs", "definitions"]) {
    if (schema[keyword] === undefined) continue;
    if (!schema[keyword] || typeof schema[keyword] !== "object" || Array.isArray(schema[keyword])) {
      throw new TypeError(`${field}.${keyword} must be an object.`);
    }
    for (const [name, child] of Object.entries(schema[keyword])) {
      assertStrictSchemaNode(child, `${field}.${keyword}.${name}`);
    }
  }
}

function normalizeStrictObjectSchema(value, field) {
  const schema = normalizeJson(value, field);
  if (!schemaIncludesType(schema, "object")) throw new TypeError(`${field} must be an object schema.`);
  assertStrictSchemaNode(schema, field);
  return schema;
}

function normalizeAllowedCallers(value, field) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${field} must be a non-empty array.`);
  const callers = [...new Set(value)];
  if (callers.some((caller) => caller !== "direct" && caller !== "programmatic")) {
    throw new TypeError(`${field} contains an unsupported caller.`);
  }
  return Object.freeze(callers);
}

export function normalizeTools(value, { maxTools, maxSchemaChars }) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("tools must be a non-empty array.");
  if (value.length > maxTools) throw new RangeError(`tools must contain at most ${maxTools} entries.`);
  const names = new Set();
  let schemaChars = 0;
  const tools = value.map((tool, index) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      throw new TypeError(`tools[${index}] must be an object.`);
    }
    if (tool.type !== "function") throw new TypeError(`tools[${index}].type must be function.`);
    const name = assertIdentifier(tool.name, `tools[${index}].name`);
    if (names.has(name)) throw new TypeError(`Duplicate tool name: ${name}.`);
    names.add(name);
    if (tool.strict !== true) throw new TypeError(`tools[${index}].strict must be true.`);
    const parameters = normalizeStrictObjectSchema(tool.parameters, `tools[${index}].parameters`);
    const outputSchema = normalizeStrictObjectSchema(tool.outputSchema, `tools[${index}].outputSchema`);
    schemaChars += serializedJsonLength(parameters) + serializedJsonLength(outputSchema);
    if (schemaChars > maxSchemaChars) throw new RangeError(`Tool schemas exceed ${maxSchemaChars} characters.`);
    if (typeof tool.idempotent !== "boolean") throw new TypeError(`tools[${index}].idempotent must be boolean.`);
    if (typeof tool.approvalRequired !== "boolean") {
      throw new TypeError(`tools[${index}].approvalRequired must be boolean.`);
    }
    if (typeof tool.validateArguments !== "function" || typeof tool.validateOutput !== "function") {
      throw new TypeError(`tools[${index}] must provide argument and output validators.`);
    }
    return Object.freeze({
      type: "function", name,
      revision: assertIdentifier(tool.revision, `tools[${index}].revision`),
      description: assertIdentifier(tool.description, `tools[${index}].description`),
      parameters, strict: true, outputSchema,
      allowedCallers: normalizeAllowedCallers(tool.allowedCallers, `tools[${index}].allowedCallers`),
      riskClass: assertIdentifier(tool.riskClass, `tools[${index}].riskClass`),
      idempotent: tool.idempotent, approvalRequired: tool.approvalRequired,
      validateArguments: tool.validateArguments, validateOutput: tool.validateOutput,
    });
  });
  return Object.freeze(tools);
}

export function publicToolDeclarations(tools) {
  return Object.freeze(tools.map(({ type, name, description, parameters, strict }) => Object.freeze({
    type, name, description, parameters, strict,
  })));
}

export function normalizeToolChoice(value, toolNames) {
  const choice = value === undefined ? { mode: "auto" } : value;
  if (!choice || typeof choice !== "object" || Array.isArray(choice) || !TOOL_CHOICE_MODES.has(choice.mode)) {
    throw new TypeError("toolChoice.mode must be auto, required, none, forced, or allowed.");
  }
  if (choice.mode === "forced") {
    const name = assertIdentifier(choice.name, "toolChoice.name");
    if (!toolNames.has(name)) throw new TypeError(`toolChoice names an unknown tool: ${name}.`);
    return Object.freeze({ mode: "forced", name });
  }
  if (choice.mode === "allowed") {
    if (!Array.isArray(choice.names) || choice.names.length === 0) {
      throw new TypeError("toolChoice.names must be a non-empty array.");
    }
    const names = choice.names.map((name, index) => assertIdentifier(name, `toolChoice.names[${index}]`));
    if (new Set(names).size !== names.length) throw new TypeError("toolChoice.names must be unique.");
    for (const name of names) if (!toolNames.has(name)) throw new TypeError(`toolChoice names an unknown tool: ${name}.`);
    const requirement = choice.requirement === undefined ? "auto" : choice.requirement;
    if (!ALLOWED_REQUIREMENTS.has(requirement)) throw new TypeError("toolChoice.requirement must be auto or required.");
    return Object.freeze({ mode: "allowed", names: Object.freeze(names), requirement });
  }
  return Object.freeze({ mode: choice.mode });
}
