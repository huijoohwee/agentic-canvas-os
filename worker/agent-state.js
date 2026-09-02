import {
  COMMERCE_ADMISSION_RECEIPT_SCHEMA,
  canonicalJson,
  commerceAdmissionRequestDigest,
  permitBoundaryRefusal,
  readAuthoringMutationPermitValue,
  readCommerceAdmissionIntent,
  sha256Hex,
} from "../agent-api/src/commerce-admission-contract.js";
import { readCommerceDeploymentIdentity } from "../agent-api/src/commerce-deployment-identity.js";

const JSON_HEADERS = Object.freeze({ "content-type": "application/json" });
const ACTIVE_KEY = "active";
const CLAIM_KEY = "claim";
const MAX_BODY_CHARS = 600_000;
const MAX_RECORD_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CLAIM_TTL_MS = 60 * 60 * 1000;
const COMMERCE_FENCE_KEY = "commerce-admission:fence";
const COMMERCE_INDEX_KEY = "commerce-admission:registration-index";
const COMMERCE_ALLOWLIST_INDEX_KEY = "commerce-admission:allowlist-index";
const COMMERCE_OUTCOME_INDEX_KEY = "commerce-admission:outcome-index";
const COMMERCE_OUTCOME_COMPACTION_KEY = "commerce-admission:outcome-compaction";
const COMMERCE_PROJECTION_REVISION_KEY = "commerce-admission:projection-revision";
const MAX_COMMERCE_REGISTRATIONS = 64;
const MAX_COMMERCE_RETAINED_OUTCOMES = 64;

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function exactKeys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function identifier(value) {
  return typeof value === "string" && value.trim() && value.length <= 512 ? value.trim() : "";
}

function finiteFuture(value, now, maxTtlMs) {
  return Number.isFinite(value) && value > now && value <= now + maxTtlMs;
}

function activeValue(entry, now) {
  return entry && finiteFuture(entry.expiresAt, now, MAX_RECORD_TTL_MS) ? entry : null;
}

function claimedValue(entry, now) {
  return entry
    && finiteFuture(entry.claimExpiresAt, now, MAX_CLAIM_TTL_MS)
    && activeValue(entry.record, now)
    ? entry
    : null;
}

function claimAlarmAt(claim) {
  return Math.min(claim.claimExpiresAt, claim.record.expiresAt);
}

function isStored(value) {
  return value !== undefined && value !== null;
}

function commerceOutcomeKey(mutationId) {
  return `commerce-admission:outcome:${mutationId}`;
}

function commerceRegistrationKey(agentId) {
  return `commerce-admission:registration:${agentId}`;
}

function commerceAllowlistOwnerKey(entryDigest) {
  return `commerce-admission:allowlist-owner:${entryDigest}`;
}

function validCommerceReceipt(record, intent) {
  const keys = [
    "schema", "adapter_identity", "agent_definition_id", "tool_allowlist_entry_id",
    "invocation_register_tokens", "resulting_status", "operator_instruction_reference", "registered_at_ms",
    "deployment_identity",
  ];
  if (!exactKeys(record, keys) || record.schema !== COMMERCE_ADMISSION_RECEIPT_SCHEMA
    || record.resulting_status !== "active" || !Number.isSafeInteger(record.registered_at_ms)
    || record.registered_at_ms < 0
    || !readCommerceDeploymentIdentity(record.deployment_identity)) return false;
  const inputs = intent.admissionInputs;
  const definition = inputs.agentDefinition;
  const allowlist = inputs.toolAllowlistEntry;
  const invocation = inputs.invocationRegisterEntry;
  if (!definition || typeof definition !== "object" || Array.isArray(definition)
    || !allowlist || typeof allowlist !== "object" || Array.isArray(allowlist)
    || !invocation || typeof invocation !== "object" || Array.isArray(invocation)
    || typeof allowlist.entry_id !== "string" || !allowlist.entry_id.trim()
    || typeof allowlist.adapter_identity !== "string" || !allowlist.adapter_identity.trim()) return false;
  const tokens = ["route", "tag", "binding", "tool_identity"].map((field) => invocation[field]);
  return typeof definition.id === "string"
    && record.agent_definition_id === definition.id
    && record.tool_allowlist_entry_id === allowlist.entry_id
    && record.adapter_identity === allowlist.adapter_identity
    && record.operator_instruction_reference === inputs.operatorInstructionRef
    && Array.isArray(record.invocation_register_tokens)
    && record.invocation_register_tokens.length === tokens.length
    && tokens.every((token, index) => typeof token === "string" && record.invocation_register_tokens[index] === token);
}

function readCommerceIndex(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_COMMERCE_REGISTRATIONS) {
    throw new TypeError("Durable commerce registration index is malformed.");
  }
  const index = value.map((agentId) => identifier(agentId));
  if (index.some((agentId, offset) => !agentId || agentId !== value[offset])
    || new Set(index).size !== index.length) {
    throw new TypeError("Durable commerce registration index contains an invalid or duplicate agent id.");
  }
  return index;
}

function readOutcomeIndex(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_COMMERCE_RETAINED_OUTCOMES) {
    throw new TypeError("Durable commerce retained outcome index is malformed.");
  }
  const mutationIds = new Set();
  for (const entry of value) {
    if (!exactKeys(entry, ["leaseExpiresAtMs", "mutationId", "outcomeDigest"])
      || !Number.isSafeInteger(entry.leaseExpiresAtMs)
      || !/^mutation:[A-Za-z0-9._:/-]{1,255}$/u.test(entry.mutationId ?? "")
      || !/^[0-9a-f]{64}$/u.test(entry.outcomeDigest ?? "")
      || mutationIds.has(entry.mutationId)) {
      throw new TypeError("Durable commerce retained outcome index is malformed.");
    }
    mutationIds.add(entry.mutationId);
  }
  return value.map((entry) => ({ ...entry }));
}

function readOutcomeCompaction(value) {
  if (value === undefined) return { schema: "commerce-admission-outcome-compaction/v1", count: 0, digest: "0".repeat(64) };
  if (!exactKeys(value, ["count", "digest", "schema"])
    || value.schema !== "commerce-admission-outcome-compaction/v1"
    || !Number.isSafeInteger(value.count) || value.count < 1
    || !/^[0-9a-f]{64}$/u.test(value.digest ?? "")) {
    throw new TypeError("Durable commerce outcome compaction evidence is malformed.");
  }
  return { ...value };
}

async function planOutcomeCompaction(storage, outcomeIndex, now) {
  const retained = [...outcomeIndex];
  const retiredKeys = [];
  let compaction = readOutcomeCompaction(await storage.get(COMMERCE_OUTCOME_COMPACTION_KEY));
  while (retained.length >= MAX_COMMERCE_RETAINED_OUTCOMES) {
    const retiring = retained[0];
    if (retiring.leaseExpiresAtMs > now) return null;
    const stored = await storage.get(commerceOutcomeKey(retiring.mutationId));
    if (!stored || await sha256Hex(canonicalJson(stored, "retired commerce outcome")) !== retiring.outcomeDigest) {
      throw new TypeError("Durable commerce retained outcome evidence disagrees with storage.");
    }
    compaction = {
      schema: "commerce-admission-outcome-compaction/v1",
      count: compaction.count + 1,
      digest: await sha256Hex(canonicalJson({ previousDigest: compaction.digest, retiring }, "outcome compaction")),
    };
    retiredKeys.push(commerceOutcomeKey(retiring.mutationId));
    retained.shift();
  }
  return { compaction, retained, retiredKeys };
}

async function readCommerceRegistrations(storage, index) {
  const entries = [];
  for (const agentId of index) {
    const entry = await storage.get(commerceRegistrationKey(agentId));
    if (!exactKeys(entry, ["agentRevisionOwner", "intent", "record"])) {
      throw new TypeError("Durable commerce registration record is missing or malformed.");
    }
    const intent = readCommerceAdmissionIntent(entry.intent);
    const definition = intent?.admissionInputs.agentDefinition;
    if (!intent || !validCommerceReceipt(entry.record, intent)
      || entry.record.agent_definition_id !== agentId
      || !exactKeys(entry.agentRevisionOwner, ["agentDefinitionJson", "revision"])
      || entry.agentRevisionOwner.revision !== definition.revision
      || entry.agentRevisionOwner.agentDefinitionJson !== canonicalJson(definition, "stored commerce agent definition")) {
      throw new TypeError("Durable commerce registration record failed validation.");
    }
    entries.push({ agentRevisionOwner: entry.agentRevisionOwner, intent, record: entry.record });
  }
  return entries;
}

function fenceRefusal(code, holding = null) {
  return {
    status: "rejected",
    code,
    holdingClaimId: holding?.claimId ?? null,
    holdingLeaseEpoch: holding?.leaseEpoch ?? null,
    holdingFenceRevision: holding?.fenceRevision ?? null,
  };
}

function stalePermit(permit, prior) {
  return permit.leaseEpoch < prior.leaseEpoch
    || (permit.leaseEpoch === prior.leaseEpoch && (
      permit.claimId !== prior.claimId
      || permit.fenceRevision !== prior.fenceRevision
      || permit.leaseExpiresAtMs !== prior.leaseExpiresAtMs
      || permit.mutationSequence <= prior.mutationSequence
    ));
}

async function reconcileState(storage, now) {
  const priorClaim = await storage.get(CLAIM_KEY);
  const claim = claimedValue(priorClaim, now);
  if (claim) {
    const priorActive = await storage.get(ACTIVE_KEY);
    if (isStored(priorActive)) await storage.delete(ACTIVE_KEY);
    return { active: null, claim, alarmAt: claimAlarmAt(claim) };
  }

  const priorActive = await storage.get(ACTIVE_KEY);
  let active = activeValue(priorActive, now);
  if (!active && priorClaim?.record) active = activeValue(priorClaim.record, now);
  if (isStored(priorClaim)) await storage.delete(CLAIM_KEY);
  if (active && active !== priorActive) await storage.put(ACTIVE_KEY, active);
  else if (!active && isStored(priorActive)) await storage.delete(ACTIVE_KEY);
  return { active, claim: null, alarmAt: active?.expiresAt ?? null };
}

export class AgentState {
  constructor(ctx) {
    this.ctx = ctx;
    this.scheduledAlarmAt = undefined;
  }

  async transact(operation) {
    return this.ctx.storage.transaction(async (storage) => operation(storage));
  }

  async scheduleExpiry(alarmAt) {
    let scheduled = this.scheduledAlarmAt;
    if (scheduled === undefined) {
      scheduled = await this.ctx.storage.getAlarm();
      this.scheduledAlarmAt = scheduled;
    }
    if (Number.isFinite(alarmAt)) {
      if (scheduled !== alarmAt) {
        await this.ctx.storage.setAlarm(alarmAt);
        this.scheduledAlarmAt = alarmAt;
      }
      return;
    }
    if (scheduled !== null) {
      await this.ctx.storage.deleteAlarm();
      this.scheduledAlarmAt = null;
    }
  }

  async put(value, now) {
    if (!exactKeys(value, ["record"]) || !activeValue(value.record, now)) return json(400, { error: "invalid record" });
    const outcome = await this.transact(async (storage) => {
      const state = await reconcileState(storage, now);
      if (state.active || state.claim) return { stored: false, alarmAt: state.alarmAt };
      await storage.put(ACTIVE_KEY, value.record);
      return { stored: true, alarmAt: value.record.expiresAt };
    });
    await this.scheduleExpiry(outcome.alarmAt);
    return json(200, { stored: outcome.stored });
  }

  async take(value, now) {
    if (!exactKeys(value, [])) return json(400, { error: "invalid take" });
    const outcome = await this.transact(async (storage) => {
      const state = await reconcileState(storage, now);
      if (state.claim) return { record: null, alarmAt: state.alarmAt };
      if (state.active) await storage.delete(ACTIVE_KEY);
      return { record: state.active, alarmAt: null };
    });
    await this.scheduleExpiry(outcome.alarmAt);
    return json(200, { record: outcome.record });
  }

  async get(value, now) {
    if (!exactKeys(value, [])) return json(400, { error: "invalid get" });
    const outcome = await this.transact(async (storage) => {
      const state = await reconcileState(storage, now);
      return { record: state.claim?.record ?? state.active, alarmAt: state.alarmAt };
    });
    await this.scheduleExpiry(outcome.alarmAt);
    return json(200, { record: outcome.record });
  }

  async claim(value, now) {
    if (!exactKeys(value, ["claimId", "claimExpiresAt"])) return json(400, { error: "invalid claim" });
    const claimId = identifier(value.claimId);
    if (!claimId || !finiteFuture(value.claimExpiresAt, now, MAX_CLAIM_TTL_MS)) {
      return json(400, { error: "invalid claim" });
    }
    const outcome = await this.transact(async (storage) => {
      const state = await reconcileState(storage, now);
      if (state.claim || !state.active) {
        return { record: null, alarmAt: state.alarmAt };
      }
      await storage.delete(ACTIVE_KEY);
      const claim = { claimId, claimExpiresAt: value.claimExpiresAt, record: state.active };
      await storage.put(CLAIM_KEY, claim);
      return { record: state.active, alarmAt: claimAlarmAt(claim) };
    });
    await this.scheduleExpiry(outcome.alarmAt);
    return json(200, { record: outcome.record });
  }

  async commit(value, now) {
    if (!exactKeys(value, ["claimId"])) return json(400, { error: "invalid commit" });
    const claimId = identifier(value.claimId);
    const outcome = await this.transact(async (storage) => {
      const state = await reconcileState(storage, now);
      if (!state.claim || state.claim.claimId !== claimId) {
        return { committed: false, alarmAt: state.alarmAt };
      }
      await storage.delete(CLAIM_KEY);
      return { committed: true, alarmAt: null };
    });
    await this.scheduleExpiry(outcome.alarmAt);
    return json(200, { committed: outcome.committed });
  }

  async release(value, now) {
    if (!exactKeys(value, ["claimId"])) return json(400, { error: "invalid release" });
    const claimId = identifier(value.claimId);
    const outcome = await this.transact(async (storage) => {
      const state = await reconcileState(storage, now);
      if (!state.claim || state.claim.claimId !== claimId) {
        return { released: false, alarmAt: state.alarmAt };
      }
      await storage.delete(CLAIM_KEY);
      await storage.put(ACTIVE_KEY, state.claim.record);
      return { released: true, alarmAt: state.claim.record.expiresAt };
    });
    await this.scheduleExpiry(outcome.alarmAt);
    return json(200, { released: outcome.released });
  }

  async replace(value, now) {
    if (!exactKeys(value, ["claimId", "record"]) || !activeValue(value.record, now)) {
      return json(400, { error: "invalid replacement" });
    }
    const claimId = identifier(value.claimId);
    const outcome = await this.transact(async (storage) => {
      const state = await reconcileState(storage, now);
      if (!state.claim || state.claim.claimId !== claimId) {
        return { replaced: false, alarmAt: state.alarmAt };
      }
      await storage.delete(CLAIM_KEY);
      await storage.put(ACTIVE_KEY, value.record);
      return { replaced: true, alarmAt: value.record.expiresAt };
    });
    await this.scheduleExpiry(outcome.alarmAt);
    return json(200, { replaced: outcome.replaced });
  }

  async commerceAdmissionRegister(value, now) {
    if (!exactKeys(value, ["authoringMutationIntent", "permit", "record"])) {
      return json(400, { error: "invalid commerce admission" });
    }
    const permit = readAuthoringMutationPermitValue(value.permit);
    const intent = readCommerceAdmissionIntent(value.authoringMutationIntent);
    if (!permit || !intent || !validCommerceReceipt(value.record, intent)) {
      return json(400, { error: "invalid commerce admission" });
    }
    const requestDigest = await commerceAdmissionRequestDigest(intent);
    if (requestDigest !== permit.requestDigest) {
      return json(200, fenceRefusal("mutation_request_mismatch", permit));
    }
    const boundary = permitBoundaryRefusal(permit, now);
    if (boundary === "mutation_out_of_write_set") {
      return json(200, fenceRefusal(boundary, permit));
    }

    const permitJson = canonicalJson(permit, "commerce permit");
    const intentJson = canonicalJson(intent, "commerce intent");
    const allowlistEntry = intent.admissionInputs.toolAllowlistEntry;
    const allowlistJson = canonicalJson(allowlistEntry, "commerce tool allowlist entry");
    const allowlistEntryDigest = await sha256Hex(canonicalJson(allowlistEntry.entry_id, "tool allowlist entry id"));
    const agentDefinition = intent.admissionInputs.agentDefinition;
    const agentId = value.record.agent_definition_id;
    const agentRevision = identifier(agentDefinition.revision);
    if (!agentRevision || agentRevision !== agentDefinition.revision) {
      return json(400, { error: "invalid commerce agent revision" });
    }
    const agentDefinitionJson = canonicalJson(agentDefinition, "commerce agent definition");
    const outcome = await this.transact(async (storage) => {
      const priorFence = await storage.get(COMMERCE_FENCE_KEY);
      const priorOutcome = await storage.get(commerceOutcomeKey(permit.mutationId));
      if (priorOutcome) {
        if (priorOutcome.permitJson !== permitJson
          || priorOutcome.intentJson !== intentJson
          || priorOutcome.requestDigest !== requestDigest) {
          return fenceRefusal("mutation_request_mismatch", permit);
        }
        return { ...priorOutcome.response, replayed: true };
      }
      if (boundary === "lease_expired") return fenceRefusal(boundary, permit);
      if (priorFence && stalePermit(permit, priorFence)) return fenceRefusal("fence_stale", priorFence);

      const outcomeIndex = readOutcomeIndex(await storage.get(COMMERCE_OUTCOME_INDEX_KEY));
      const outcomeRetention = await planOutcomeCompaction(storage, outcomeIndex, now);
      if (!outcomeRetention) {
        return fenceRefusal("outcome_capacity", priorFence);
      }

      const index = readCommerceIndex(await storage.get(COMMERCE_INDEX_KEY));
      const registrations = await readCommerceRegistrations(storage, index);
      const current = registrations.find((entry) => entry.record.agent_definition_id === agentId);
      if (current?.agentRevisionOwner.revision === agentRevision
        && current.agentRevisionOwner.agentDefinitionJson !== agentDefinitionJson) {
        return fenceRefusal("agent_revision_conflict", priorFence);
      }

      const allowlistOwnerKey = commerceAllowlistOwnerKey(allowlistEntryDigest);
      const priorAllowlistOwner = await storage.get(allowlistOwnerKey);
      if (priorAllowlistOwner !== undefined && (
        !exactKeys(priorAllowlistOwner, ["allowlistJson", "entryId"])
        || typeof priorAllowlistOwner.entryId !== "string"
        || typeof priorAllowlistOwner.allowlistJson !== "string"
      )) {
        throw new TypeError("Durable commerce allowlist owner is malformed.");
      }
      if (priorAllowlistOwner !== undefined && (
        priorAllowlistOwner.entryId !== allowlistEntry.entry_id
        || priorAllowlistOwner.allowlistJson !== allowlistJson
      )) {
        return fenceRefusal("tool_allowlist_entry_conflict", priorFence);
      }
      const storedAllowlistIndex = await storage.get(COMMERCE_ALLOWLIST_INDEX_KEY);
      if (storedAllowlistIndex !== undefined && !Array.isArray(storedAllowlistIndex)) {
        throw new TypeError("Durable commerce allowlist index is malformed.");
      }
      const allowlistIndex = storedAllowlistIndex ? [...storedAllowlistIndex] : [];
      if (allowlistIndex.some((digest) => typeof digest !== "string" || !/^[0-9a-f]{64}$/u.test(digest))
        || new Set(allowlistIndex).size !== allowlistIndex.length) {
        throw new TypeError("Durable commerce allowlist index contains an invalid digest.");
      }
      let retiredAllowlistOwnerKey = null;
      const priorAllowlistEntry = current?.intent.admissionInputs.toolAllowlistEntry;
      if (priorAllowlistEntry && priorAllowlistEntry.entry_id !== allowlistEntry.entry_id
        && !registrations.some((entry) => entry !== current
          && entry.intent.admissionInputs.toolAllowlistEntry.entry_id === priorAllowlistEntry.entry_id)) {
        const retiredDigest = await sha256Hex(canonicalJson(priorAllowlistEntry.entry_id, "retired allowlist id"));
        retiredAllowlistOwnerKey = commerceAllowlistOwnerKey(retiredDigest);
        const offset = allowlistIndex.indexOf(retiredDigest);
        if (offset < 0 || await storage.get(retiredAllowlistOwnerKey) === undefined) {
          throw new TypeError("Durable retired allowlist owner and index disagree.");
        }
        allowlistIndex.splice(offset, 1);
      }
      const indexed = allowlistIndex.includes(allowlistEntryDigest);
      if ((priorAllowlistOwner !== undefined) !== indexed) {
        throw new TypeError("Durable commerce allowlist owner and index disagree.");
      }
      if (!indexed) allowlistIndex.push(allowlistEntryDigest);
      if (allowlistIndex.length > MAX_COMMERCE_REGISTRATIONS) {
        return fenceRefusal("tool_allowlist_capacity", priorFence);
      }

      if (!index.includes(agentId)) index.push(agentId);
      if (index.length > MAX_COMMERCE_REGISTRATIONS) {
        return fenceRefusal("agent_capacity", priorFence);
      }
      const response = {
        status: "registered",
        record: value.record,
        finding: null,
      };
      const fence = {
        claimId: permit.claimId,
        leaseEpoch: permit.leaseEpoch,
        fenceRevision: permit.fenceRevision,
        mutationId: permit.mutationId,
        mutationSequence: permit.mutationSequence,
        requestDigest,
        leaseExpiresAtMs: permit.leaseExpiresAtMs,
      };
      const nextRegistration = {
        agentRevisionOwner: { revision: agentRevision, agentDefinitionJson },
        intent,
        record: value.record,
      };
      const nextRegistrations = current
        ? registrations.map((entry) => entry === current ? nextRegistration : entry)
        : [...registrations, nextRegistration];
      const projectionRevision = await sha256Hex(canonicalJson(nextRegistrations, "commerce registration snapshot"));
      await storage.put(commerceRegistrationKey(agentId), nextRegistration);
      await storage.put(COMMERCE_INDEX_KEY, index);
      await storage.put(COMMERCE_PROJECTION_REVISION_KEY, projectionRevision);
      if (retiredAllowlistOwnerKey) await storage.delete(retiredAllowlistOwnerKey);
      if (priorAllowlistOwner === undefined) {
        await storage.put(allowlistOwnerKey, { entryId: allowlistEntry.entry_id, allowlistJson });
      }
      if (priorAllowlistOwner === undefined || retiredAllowlistOwnerKey) {
        await storage.put(COMMERCE_ALLOWLIST_INDEX_KEY, allowlistIndex);
      }
      await storage.put(COMMERCE_FENCE_KEY, fence);
      const storedOutcome = {
        permitJson,
        intentJson,
        requestDigest,
        response,
      };
      for (const key of outcomeRetention.retiredKeys) await storage.delete(key);
      if (outcomeRetention.retiredKeys.length > 0) {
        await storage.put(COMMERCE_OUTCOME_COMPACTION_KEY, outcomeRetention.compaction);
      }
      await storage.put(commerceOutcomeKey(permit.mutationId), storedOutcome);
      outcomeRetention.retained.push({
        mutationId: permit.mutationId,
        leaseExpiresAtMs: permit.leaseExpiresAtMs,
        outcomeDigest: await sha256Hex(canonicalJson(storedOutcome, "commerce outcome")),
      });
      await storage.put(COMMERCE_OUTCOME_INDEX_KEY, outcomeRetention.retained);
      return { ...response, replayed: false };
    });
    return json(200, outcome);
  }

  async commerceAdmissionList(value) {
    if (!exactKeys(value, ["knownRevision"]) || !(value.knownRevision === null
      || /^[0-9a-f]{64}$/u.test(value.knownRevision ?? ""))) {
      return json(400, { error: "invalid commerce admission list" });
    }
    const snapshot = await this.transact(async (storage) => {
      const storedRevision = await storage.get(COMMERCE_PROJECTION_REVISION_KEY);
      if (storedRevision !== undefined && !/^[0-9a-f]{64}$/u.test(storedRevision)) {
        throw new TypeError("Durable commerce projection revision is malformed.");
      }
      if (storedRevision !== undefined && storedRevision === value.knownRevision) {
        return { registrations: null, revision: storedRevision };
      }
      const index = readCommerceIndex(await storage.get(COMMERCE_INDEX_KEY));
      const registrations = await readCommerceRegistrations(storage, index);
      const revision = await sha256Hex(canonicalJson(registrations, "commerce registration snapshot"));
      if (storedRevision !== undefined && storedRevision !== revision) {
        throw new TypeError("Durable commerce projection revision disagrees with registrations.");
      }
      return { registrations, revision };
    });
    return json(200, snapshot);
  }

  async delete(value) {
    if (!exactKeys(value, [])) return json(400, { error: "invalid delete" });
    await this.transact(async (storage) => {
      const active = await storage.get(ACTIVE_KEY);
      const claim = await storage.get(CLAIM_KEY);
      if (isStored(active)) await storage.delete(ACTIVE_KEY);
      if (isStored(claim)) await storage.delete(CLAIM_KEY);
    });
    await this.scheduleExpiry(null);
    return json(200, { deleted: true });
  }

  async alarm() {
    // Cloudflare has consumed the alarm that invoked this method.
    this.scheduledAlarmAt = null;
    const state = await this.transact(async (storage) => reconcileState(storage, Date.now()));
    await this.scheduleExpiry(state.alarmAt);
  }

  async fetch(request) {
    if (request.method !== "POST") return json(405, { error: "method not allowed" });
    const text = await request.text();
    if (!text || text.length > MAX_BODY_CHARS) return json(400, { error: "invalid request" });
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json(400, { error: "invalid request" });
    }
    if (!exactKeys(body, ["operation", "value"]) || !identifier(body.operation)) {
      return json(400, { error: "invalid request" });
    }
    const now = Date.now();
    if (body.operation === "put") return this.put(body.value, now);
    if (body.operation === "take") return this.take(body.value, now);
    if (body.operation === "get") return this.get(body.value, now);
    if (body.operation === "claim") return this.claim(body.value, now);
    if (body.operation === "commit") return this.commit(body.value, now);
    if (body.operation === "release") return this.release(body.value, now);
    if (body.operation === "replace") return this.replace(body.value, now);
    if (body.operation === "delete") return this.delete(body.value);
    if (body.operation === "commerce-admission-register") return this.commerceAdmissionRegister(body.value, now);
    if (body.operation === "commerce-admission-list") return this.commerceAdmissionList(body.value);
    return json(400, { error: "unsupported operation" });
  }
}
