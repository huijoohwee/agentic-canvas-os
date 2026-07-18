// Stateless session token for the agentic-canvas-os Agent-API.
//
// A minimal HS256 JWT (header.payload.signature) minted and verified with
// `node:crypto` HMAC-SHA256 — zero external dependencies, offline-testable. The
// signing secret is SERVER-SIDE ONLY (Cloudflare secret binding); it is never
// logged, returned, or shipped to the client. This token gates *access* to the
// run/state endpoints; it is DISTINCT from a knowgrph Approval_Token and NEVER
// authorizes spend (auth ≠ approval — mirrors knowgrph R15.9).
//
// Interface is intentionally swappable: a future deploy can replace this with
// `jsonwebtoken`, OIDC, or Cloudflare Access without changing callers.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const DEFAULT_EXPIRY_SECONDS = 3600; // 60 min (knowgrph R15.8 default)
const MIN_EXPIRY_SECONDS = 300; // 5 min
const MAX_EXPIRY_SECONDS = 86400; // 24 h
const DEFAULT_REVIEW_EXPIRY_SECONDS = 900;
const MIN_REVIEW_EXPIRY_SECONDS = 60;
const MAX_REVIEW_EXPIRY_SECONDS = 3600;

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function base64urlJson(obj) {
  return base64url(JSON.stringify(obj));
}

function clampExpiry(seconds) {
  const n = Math.floor(Number(seconds));
  if (!Number.isFinite(n)) return DEFAULT_EXPIRY_SECONDS;
  return Math.max(MIN_EXPIRY_SECONDS, Math.min(MAX_EXPIRY_SECONDS, n));
}

function clampReviewExpiry(seconds) {
  const value = Math.floor(Number(seconds));
  if (!Number.isFinite(value)) return DEFAULT_REVIEW_EXPIRY_SECONDS;
  return Math.max(MIN_REVIEW_EXPIRY_SECONDS, Math.min(MAX_REVIEW_EXPIRY_SECONDS, value));
}

function sign(signingInput, secret) {
  return createHmac("sha256", secret).update(signingInput).digest("base64url");
}

function mintSignedToken(secret, payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  return `${signingInput}.${sign(signingInput, secret)}`;
}

/**
 * Mint a stateless session token.
 * @param {object} args
 * @param {string} args.secret server-side signing secret (required, non-empty)
 * @param {string} [args.subject] caller/session id (Caller_Identity)
 * @param {string[]} [args.entitledRunIds] runs this session may read
 * @param {string[]} [args.roomIds] canvas collaboration rooms this session may join.
 *   Empty/omitted means "no room scoping" (any room) — same posture as
 *   `entitledRunIds` — so existing callers are unaffected (additive, non-breaking).
 * @param {number} [args.expiryWindowSeconds] [300, 86400], default 3600
 * @param {number} [args.now] injectable clock (ms epoch) for deterministic tests
 * @returns {string} `header.payload.signature`
 */
export function mintSessionToken({ secret, subject, entitledRunIds = [], roomIds = [], expiryWindowSeconds, now } = {}) {
  if (typeof secret !== "string" || !secret) throw new Error("signing secret is required");
  const iatMs = Number.isFinite(now) ? now : Date.now();
  const iat = Math.floor(iatMs / 1000);
  const exp = iat + clampExpiry(expiryWindowSeconds);
  const payload = {
    purpose: "session",
    sub: typeof subject === "string" && subject ? subject : `sess_${randomUUID()}`,
    entitledRunIds: Array.isArray(entitledRunIds) ? entitledRunIds.slice(0, 100) : [],
    roomIds: Array.isArray(roomIds) ? roomIds.filter((r) => typeof r === "string" && r).slice(0, 50) : [],
    iat,
    exp,
  };
  return mintSignedToken(secret, payload);
}

/**
 * Verify a session token's signature + expiry. Returns
 * `{ valid, claims, reason }`. NEVER discloses the secret or token internals on
 * failure; `reason` is a coarse code only.
 *
 * @param {string} token
 * @param {string} secret server-side signing secret
 * @param {{ now?: number }} [opts] injectable clock (ms epoch)
 */
function verifySignedToken(token, secret, opts = {}) {
  if (typeof secret !== "string" || !secret) return { valid: false, reason: "no_secret" };
  if (typeof token !== "string" || token.split(".").length !== 3) {
    return { valid: false, reason: "malformed" };
  }
  const [h, p, sig] = token.split(".");
  const expected = sign(`${h}.${p}`, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false, reason: "bad_signature" };

  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (header?.alg !== "HS256" || header?.typ !== "JWT") return { valid: false, reason: "unsupported" };
  const nowSec = Math.floor((Number.isFinite(opts.now) ? opts.now : Date.now()) / 1000);
  if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.exp <= claims.iat) {
    return { valid: false, reason: "malformed" };
  }
  if (nowSec >= claims.exp) return { valid: false, reason: "expired" };

  return { valid: true, claims };
}

export function verifySessionToken(token, secret, opts = {}) {
  const verdict = verifySignedToken(token, secret, opts);
  if (!verdict.valid) return verdict;
  if (verdict.claims.purpose !== "session" || typeof verdict.claims.sub !== "string" || !verdict.claims.sub) {
    return { valid: false, reason: "wrong_purpose" };
  }
  return verdict;
}

export function mintReviewerToken({
  secret,
  subject,
  reviewId,
  runId,
  conversationId,
  actionDigest,
  expiryWindowSeconds,
  now,
} = {}) {
  if (typeof secret !== "string" || !secret) throw new Error("review signing secret is required");
  const required = { subject, reviewId, runId, conversationId, actionDigest };
  for (const [field, value] of Object.entries(required)) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  }
  const iatMs = Number.isFinite(now) ? now : Date.now();
  const iat = Math.floor(iatMs / 1000);
  return mintSignedToken(secret, {
    purpose: "human-review",
    sub: subject.trim(),
    reviewId: reviewId.trim(),
    runId: runId.trim(),
    conversationId: conversationId.trim(),
    actionDigest: actionDigest.trim(),
    jti: `review_${randomUUID()}`,
    iat,
    exp: iat + clampReviewExpiry(expiryWindowSeconds),
  });
}

export function verifyReviewerToken(token, secret, expected = {}, opts = {}) {
  const verdict = verifySignedToken(token, secret, opts);
  if (!verdict.valid) return verdict;
  const claims = verdict.claims;
  const required = ["sub", "reviewId", "runId", "conversationId", "actionDigest", "jti"];
  if (claims.purpose !== "human-review" || required.some((field) => typeof claims[field] !== "string" || !claims[field])) {
    return { valid: false, reason: "wrong_purpose" };
  }
  for (const field of ["reviewId", "runId", "conversationId", "actionDigest"]) {
    if (typeof expected[field] !== "string" || claims[field] !== expected[field]) {
      return { valid: false, reason: "scope_mismatch" };
    }
  }
  return verdict;
}

export const AUTH_EXPIRY = Object.freeze({
  DEFAULT_EXPIRY_SECONDS,
  MIN_EXPIRY_SECONDS,
  MAX_EXPIRY_SECONDS,
});

export const REVIEW_AUTH_EXPIRY = Object.freeze({
  DEFAULT_REVIEW_EXPIRY_SECONDS,
  MIN_REVIEW_EXPIRY_SECONDS,
  MAX_REVIEW_EXPIRY_SECONDS,
});

/**
 * True iff `claims` (from `verifySessionToken`) may join collaboration room
 * `roomId`. Empty/absent room scope is fail-closed: a generic anonymous
 * session may use non-room API routes but cannot join any collaboration room.
 *
 * @param {{ roomIds?: unknown }} claims
 * @param {string} roomId
 */
export function sessionCanJoinRoom(claims, roomId) {
  const room = typeof roomId === "string" ? roomId.trim() : "";
  if (!room) return false;
  const scoped = claims && Array.isArray(claims.roomIds) ? claims.roomIds : [];
  return scoped.length > 0 && scoped.includes(room);
}

/**
 * Room ids are bearer capabilities shared in the room URL. Require at least
 * 128 bits encoded as hexadecimal so a caller cannot mint a token for a
 * guessable human label such as "victim-room".
 */
export function isSecureRoomCapability(roomId) {
  return typeof roomId === "string" && /^[a-f0-9]{32,128}$/i.test(roomId);
}
