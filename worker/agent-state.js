const JSON_HEADERS = Object.freeze({ "content-type": "application/json" });
const ACTIVE_KEY = "active";
const CLAIM_KEY = "claim";
const MAX_BODY_CHARS = 600_000;

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function exactKeys(value, allowed) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((key) => allowed.includes(key));
}

function identifier(value) {
  return typeof value === "string" && value.trim() && value.length <= 512 ? value.trim() : "";
}

function finiteFuture(value, now) {
  return Number.isFinite(value) && value > now;
}

function activeValue(entry, now) {
  return entry && finiteFuture(entry.expiresAt, now) ? entry : null;
}

function claimedValue(entry, now) {
  return entry && finiteFuture(entry.claimExpiresAt, now) && activeValue(entry.record, now) ? entry : null;
}

function claimAlarmAt(claim) {
  return Math.min(claim.claimExpiresAt, claim.record.expiresAt);
}

async function reconcileState(storage, now) {
  const priorClaim = await storage.get(CLAIM_KEY);
  const claim = claimedValue(priorClaim, now);
  if (claim) {
    await storage.delete(ACTIVE_KEY);
    return { active: null, claim, alarmAt: claimAlarmAt(claim) };
  }

  let active = activeValue(await storage.get(ACTIVE_KEY), now);
  if (!active && priorClaim?.record) active = activeValue(priorClaim.record, now);
  await storage.delete(CLAIM_KEY);
  if (active) await storage.put(ACTIVE_KEY, active);
  else await storage.delete(ACTIVE_KEY);
  return { active, claim: null, alarmAt: active?.expiresAt ?? null };
}

export class AgentState {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async transact(operation) {
    return this.ctx.storage.transaction(async (storage) => operation(storage));
  }

  async scheduleExpiry(alarmAt) {
    const scheduled = await this.ctx.storage.getAlarm();
    if (Number.isFinite(alarmAt)) {
      if (scheduled !== alarmAt) await this.ctx.storage.setAlarm(alarmAt);
      return;
    }
    if (scheduled !== null) await this.ctx.storage.deleteAlarm();
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
      await storage.delete(ACTIVE_KEY);
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
    if (!claimId || !finiteFuture(value.claimExpiresAt, now)) return json(400, { error: "invalid claim" });
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

  async delete(value) {
    if (!exactKeys(value, [])) return json(400, { error: "invalid delete" });
    await this.transact(async (storage) => {
      await storage.delete(ACTIVE_KEY);
      await storage.delete(CLAIM_KEY);
    });
    await this.scheduleExpiry(null);
    return json(200, { deleted: true });
  }

  async alarm() {
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
    return json(400, { error: "unsupported operation" });
  }
}
