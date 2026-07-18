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

export class AgentState {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async transact(operation) {
    return this.ctx.storage.transaction(async (storage) => operation(storage));
  }

  async put(value, now) {
    if (!exactKeys(value, ["record"]) || !activeValue(value.record, now)) return json(400, { error: "invalid record" });
    const stored = await this.transact(async (storage) => {
      const current = activeValue(await storage.get(ACTIVE_KEY), now);
      const claim = claimedValue(await storage.get(CLAIM_KEY), now);
      if (current || claim) return false;
      await storage.delete(ACTIVE_KEY);
      await storage.delete(CLAIM_KEY);
      await storage.put(ACTIVE_KEY, value.record);
      return true;
    });
    return json(200, { stored });
  }

  async take(value, now) {
    if (!exactKeys(value, [])) return json(400, { error: "invalid take" });
    const record = await this.transact(async (storage) => {
      const current = activeValue(await storage.get(ACTIVE_KEY), now);
      await storage.delete(ACTIVE_KEY);
      return current;
    });
    return json(200, { record });
  }

  async get(value, now) {
    if (!exactKeys(value, [])) return json(400, { error: "invalid get" });
    const record = await this.transact(async (storage) => {
      const priorClaim = await storage.get(CLAIM_KEY);
      const liveClaim = claimedValue(priorClaim, now);
      if (liveClaim) return liveClaim.record;
      let current = activeValue(await storage.get(ACTIVE_KEY), now);
      if (!current && priorClaim?.record) current = activeValue(priorClaim.record, now);
      await storage.delete(CLAIM_KEY);
      if (!current) await storage.delete(ACTIVE_KEY);
      else await storage.put(ACTIVE_KEY, current);
      return current;
    });
    return json(200, { record });
  }

  async claim(value, now) {
    if (!exactKeys(value, ["claimId", "claimExpiresAt"])) return json(400, { error: "invalid claim" });
    const claimId = identifier(value.claimId);
    if (!claimId || !finiteFuture(value.claimExpiresAt, now)) return json(400, { error: "invalid claim" });
    const record = await this.transact(async (storage) => {
      const priorClaim = await storage.get(CLAIM_KEY);
      const liveClaim = claimedValue(priorClaim, now);
      if (liveClaim) return null;
      let current = activeValue(await storage.get(ACTIVE_KEY), now);
      if (!current && priorClaim?.record) current = activeValue(priorClaim.record, now);
      await storage.delete(ACTIVE_KEY);
      await storage.delete(CLAIM_KEY);
      if (!current) return null;
      await storage.put(CLAIM_KEY, { claimId, claimExpiresAt: value.claimExpiresAt, record: current });
      return current;
    });
    return json(200, { record });
  }

  async commit(value, now) {
    if (!exactKeys(value, ["claimId"])) return json(400, { error: "invalid commit" });
    const claimId = identifier(value.claimId);
    const committed = await this.transact(async (storage) => {
      const claim = claimedValue(await storage.get(CLAIM_KEY), now);
      if (!claim || claim.claimId !== claimId) return false;
      await storage.delete(CLAIM_KEY);
      return true;
    });
    return json(200, { committed });
  }

  async release(value, now) {
    if (!exactKeys(value, ["claimId"])) return json(400, { error: "invalid release" });
    const claimId = identifier(value.claimId);
    const released = await this.transact(async (storage) => {
      const claim = claimedValue(await storage.get(CLAIM_KEY), now);
      if (!claim || claim.claimId !== claimId) return false;
      await storage.delete(CLAIM_KEY);
      await storage.put(ACTIVE_KEY, claim.record);
      return true;
    });
    return json(200, { released });
  }

  async replace(value, now) {
    if (!exactKeys(value, ["claimId", "record"]) || !activeValue(value.record, now)) {
      return json(400, { error: "invalid replacement" });
    }
    const claimId = identifier(value.claimId);
    const replaced = await this.transact(async (storage) => {
      const claim = claimedValue(await storage.get(CLAIM_KEY), now);
      if (!claim || claim.claimId !== claimId) return false;
      await storage.delete(CLAIM_KEY);
      await storage.put(ACTIVE_KEY, value.record);
      return true;
    });
    return json(200, { replaced });
  }

  async delete(value) {
    if (!exactKeys(value, [])) return json(400, { error: "invalid delete" });
    await this.transact(async (storage) => {
      await storage.delete(ACTIVE_KEY);
      await storage.delete(CLAIM_KEY);
    });
    return json(200, { deleted: true });
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
