import {
  AUTHORING_HEADERS,
  COMMERCE_ADMISSION_OPERATOR_INSTRUCTION_REF,
  COMMERCE_ADMISSION_PATH,
  COMMERCE_ADMISSION_PROVIDER_CONTRACT,
  COMMERCE_ADMISSION_RECEIPT_SCHEMA,
  authoringMutationHeaders,
  canonicalJson,
  commerceAdmissionRequestDigest,
  isCommerceAdmissionAuthSecret,
  sha256Hex,
  verifyCommerceAdmissionAuth,
  permitBoundaryRefusal,
  readAuthoringMutationPermit,
  readCommerceAdmissionBody,
} from "./commerce-admission-contract.js";
import {
  readCommerceDeploymentIdentity,
} from "./commerce-deployment-identity.js";

const JSON_CONTENT_TYPE = "application/json";
const MAX_BODY_BYTES = 65_536;
const FINDING_SCHEMA = "acos-adapter-registration-finding/v1";
const INVOCATION_TOKENS = Object.freeze([
  "/tool.route",
  "#mcp",
  "@mcp-gateway",
  "acos.adapter.register",
]);
const DURABLE_REJECTION_CODES = new Set([
  "agent_capacity",
  "agent_revision_conflict",
  "fence_stale",
  "lease_expired",
  "mutation_out_of_write_set",
  "mutation_request_mismatch",
  "outcome_capacity",
  "tool_allowlist_capacity",
  "tool_allowlist_entry_conflict",
]);

function response(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": JSON_CONTENT_TYPE, ...headers },
  });
}

function rejection(code, permit = null, details = {}, status = 409) {
  const body = {
    status: "rejected",
    record: null,
    finding: {
      schema: FINDING_SCHEMA,
      type: "unfederated-tool",
      adapter_identity: null,
      reason_code: code,
      message: `Commerce adapter registration was rejected: ${code}.`,
      details,
    },
  };
  return response(status, body, permit ? authoringMutationHeaders(permit) : {});
}

async function readBoundedBody(request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (!request.body) return Object.freeze({ bytes: new Uint8Array(), text: "" });
  const reader = request.body.getReader();
  let bytes = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return Object.freeze({ bytes: body, text: new TextDecoder("utf-8", { fatal: true }).decode(body) });
  } catch { return null; }
}

export function createCommerceInvocationRegister() {
  const declared = new Set(INVOCATION_TOKENS);
  return Object.freeze({ declares: (token) => declared.has(token) });
}

export function createCommerceOperatorInstructionResolver(value) {
  const configured = typeof value === "string"
    && value.trim() === COMMERCE_ADMISSION_OPERATOR_INSTRUCTION_REF;
  return Object.freeze({
    configured,
    async resolveOperatorInstruction(reference) {
      return Object.freeze({
        resolved: configured && reference === COMMERCE_ADMISSION_OPERATOR_INSTRUCTION_REF,
        reference,
      });
    },
  });
}

export function createCommerceToolAllowlistProjection({ fail } = {}) {
  const entries = new Map();
  function preflight(value) {
    const serialized = canonicalJson(value, "tool allowlist projection");
    const prior = entries.get(value.entry_id);
    if (prior && prior !== serialized) {
      throw Object.assign(
        new TypeError("Tool allowlist projection conflicts with its durable identity."),
        { reasonCode: "tool_allowlist_entry_conflict" },
      );
    }
    if (!prior && entries.size >= 64) {
      throw Object.assign(
        new RangeError("Tool allowlist projection is limited to 64 entries."),
        { reasonCode: "tool_allowlist_capacity" },
      );
    }
    return Object.freeze({ serialized, disposition: prior ? "already_projected" : "projectable" });
  }
  return Object.freeze({
    preflight,
    async add(value) {
      preflight(value);
      if (typeof fail === "function") await fail(value);
      const projection = preflight(value);
      entries.set(value.entry_id, projection.serialized);
      return true;
    },
    reset: () => entries.clear(),
    snapshot: () => Object.freeze([...entries.values()].sort()),
  });
}

export function createCommerceAdmissionProvider({
  store,
  registrationInterface,
  deploymentIdentity = null,
  authSecret,
  now = () => Date.now(),
} = {}) {
  const exactDeploymentIdentity = readCommerceDeploymentIdentity(deploymentIdentity);
  const registrationStats = typeof registrationInterface?.stats === "function"
    ? registrationInterface.stats()
    : {};
  const configured = Boolean(
    store && typeof store.register === "function" && typeof store.snapshot === "function"
    && registrationInterface && typeof registrationInterface.preflight === "function"
    && typeof registrationInterface.createRecord === "function"
    && typeof registrationInterface.project === "function"
    && typeof registrationInterface.resetToolAllowlistProjection === "function"
    && registrationStats.registryConfigured === true
    && registrationStats.toolAllowlistConfigured === true
    && registrationStats.toolAllowlistPreflightConfigured === true
    && registrationStats.invocationRegisterConfigured === true
    && registrationStats.operatorInstructionResolverConfigured === true
    && exactDeploymentIdentity !== null
    && isCommerceAdmissionAuthSecret(authSecret),
  );
  let rehydrated = false;
  let projectedRevision = null;
  let projectionTail = Promise.resolve();

  async function projectIntent(intent, record) {
    const inputs = intent.admissionInputs;
    const validated = await registrationInterface.preflight(
      inputs.agentDefinition,
      inputs.toolAllowlistEntry,
      inputs.invocationRegisterEntry,
      inputs.operatorInstructionRef,
    );
    if (validated.status !== "validated") throw new TypeError(validated.finding.reason_code);
    const expected = {
      ...registrationInterface.createRecord(validated.registration, record.registered_at_ms),
      schema: COMMERCE_ADMISSION_RECEIPT_SCHEMA,
      deployment_identity: exactDeploymentIdentity,
    };
    if (canonicalJson(expected) !== canonicalJson(record)) throw new TypeError("Durable registration receipt does not match its projection source.");
    await registrationInterface.project(validated.registration, record);
  }

  async function runRehydration(snapshot) {
    if (!configured) return false;
    registrationInterface.resetToolAllowlistProjection();
    for (const entry of snapshot.registrations) {
      if (!entry || typeof entry !== "object") throw new TypeError("Durable registration is malformed.");
      await projectIntent(entry.intent, entry.record);
    }
    rehydrated = true;
    projectedRevision = snapshot.revision;
    return true;
  }

  function rehydrate() {
    const pending = projectionTail.catch(() => {}).then(async () => {
      const snapshot = await store.snapshot(projectedRevision);
      if (snapshot.registrations === null) {
        if (rehydrated && projectedRevision === snapshot.revision) return true;
        throw new TypeError("Durable projection omitted a required changed snapshot.");
      }
      rehydrated = false;
      return runRehydration(snapshot);
    });
    projectionTail = pending;
    return pending;
  }

  async function register(request) {
    const bounded = await readBoundedBody(request);
    if (!bounded) return response(413, { error: "request body too large or invalid" });
    const auth = await verifyCommerceAdmissionAuth({
      request,
      bodyDigest: await sha256Hex(bounded.bytes),
      secret: authSecret,
    });
    if (auth.code === "auth_unconfigured") return rejection("runtime_unconfigured", null, {}, 503);
    if (!auth.ok) return response(401, { error: "unauthorized" });
    const permit = readAuthoringMutationPermit(request.headers);
    let rawBody;
    try { rawBody = bounded.text ? JSON.parse(bounded.text) : null; } catch { rawBody = null; }
    const body = readCommerceAdmissionBody(rawBody);
    if (!permit) return rejection("claim_malformed");
    if (!body) return rejection("registration_input_invalid", permit);
    const requestDigest = await commerceAdmissionRequestDigest(body.authoringMutationIntent);
    if (requestDigest !== permit.requestDigest) return rejection("mutation_request_mismatch", permit);
    const boundary = permitBoundaryRefusal(permit, now());
    if (boundary === "mutation_out_of_write_set") return rejection(boundary, permit);
    if (!configured) return rejection("runtime_unconfigured", null, {}, 503);
    try {
      await rehydrate();
    } catch {
      return rejection("projection_unavailable", null, {}, 503);
    }

    const validated = await registrationInterface.preflight(
      body.agentDefinition,
      body.toolAllowlistEntry,
      body.invocationRegisterEntry,
      body.operatorInstructionRef,
    );
    if (validated.status !== "validated") {
      return response(409, validated, authoringMutationHeaders(permit));
    }
    if (validated.registration.requestedStatus !== "active") {
      return rejection("registration_status_not_active", permit);
    }

    const record = Object.freeze({
      ...registrationInterface.createRecord(validated.registration, now()),
      schema: COMMERCE_ADMISSION_RECEIPT_SCHEMA,
      deployment_identity: exactDeploymentIdentity,
    });
    let terminal;
    try {
      terminal = await store.register({
        permit,
        authoringMutationIntent: body.authoringMutationIntent,
        record,
      });
    } catch {
      return rejection("durable_admission_unavailable", null, {}, 503);
    }
    if (terminal.status !== "registered") {
      if (terminal.status !== "rejected" || !DURABLE_REJECTION_CODES.has(terminal.code)) {
        return rejection("durable_admission_invalid", null, {}, 503);
      }
      return rejection(terminal.code || "durable_admission_rejected", permit, {
        holdingClaimId: terminal.holdingClaimId ?? null,
        holdingLeaseEpoch: terminal.holdingLeaseEpoch ?? null,
        holdingFenceRevision: terminal.holdingFenceRevision ?? null,
      });
    }
    try {
      // Always serialize from the durable current view. A request whose DO
      // commit response is delayed must never project an older revision after
      // a later request has already committed the replacement.
      await rehydrate();
    } catch {
      rehydrated = false;
      return rejection("projection_unavailable", null, {}, 503);
    }
    return response(200, {
      status: "registered",
      record: terminal.record,
      finding: null,
    }, authoringMutationHeaders(permit));
  }

  async function handle(request) {
    const url = new URL(request.url);
    if (url.hostname !== "acos-admission.internal") return response(404, { error: "not found" });
    if (url.pathname === `${COMMERCE_ADMISSION_PATH}/readyz`) {
      if (request.method !== "GET") return response(405, { error: "method not allowed" });
      const auth = await verifyCommerceAdmissionAuth({
        request,
        bodyDigest: await sha256Hex(new Uint8Array()),
        secret: authSecret,
      });
      if (auth.code === "auth_unconfigured") return response(503, { ok: false, code: auth.code });
      if (!auth.ok) return response(401, { error: "unauthorized" });
      try {
        if (!await rehydrate()) return response(503, { ok: false, code: "runtime_unconfigured" });
      } catch {
        return response(503, { ok: false, code: "projection_unavailable" });
      }
      return response(200, {
        ok: true,
        contract: COMMERCE_ADMISSION_PROVIDER_CONTRACT,
        receiptSchema: COMMERCE_ADMISSION_RECEIPT_SCHEMA,
        operations: ["register-fenced"],
        productionReady: true,
        deploymentIdentity: exactDeploymentIdentity,
      });
    }
    if (url.pathname !== COMMERCE_ADMISSION_PATH) return response(404, { error: "not found" });
    if (request.method !== "POST") return response(405, { error: "method not allowed" });
    return register(request);
  }

  return Object.freeze({
    handle,
    rehydrate,
    stats: () => Object.freeze({ configured, rehydrated, projectedRevision }),
  });
}

export const COMMERCE_ADMISSION_DEFAULTS = Object.freeze({
  maxBodyBytes: MAX_BODY_BYTES,
  invocationTokens: INVOCATION_TOKENS,
  authoringHeaders: Object.freeze(Object.values(AUTHORING_HEADERS)),
});
