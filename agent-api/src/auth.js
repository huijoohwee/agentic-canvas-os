// Stateless session token for the agentic-canvas-os Agent-API.
//
// A minimal HS256 JWT (header.payload.signature) minted and verified with
// `node:crypto` HMAC-SHA256 — zero external dependencies, offline-testable. The
// signing secret is SERVER-SIDE ONLY (Secrets Manager / Lambda env); it is never
// logged, returned, or shipped to the client. This token gates *access* to the
// run/state endpoints; it is DISTINCT from a knowgrph Approval_Token and NEVER
// authorizes spend (auth ≠ approval — mirrors knowgrph R15.9).
//
// Interface is intentionally swappable: a future deploy can replace this with
// `jsonwebtoken`, OIDC, or Cloudflare Access without changing callers.

import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_EXPIRY_SECONDS = 3600; // 60 min (knowgrph R15.8 default)
const MIN_EXPIRY_SECONDS = 300; // 5 min
const MAX_EXPIRY_SECONDS = 86400; // 24 h

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

function sign(signingInput, secret) {
  return createHmac("sha256", secret).update(signingInput).digest("base64url");
}

/**
 * Mint a stateless session token.
 * @param {object} args
 * @param {string} args.secret server-side signing secret (required, non-empty)
 * @param {string} [args.subject] caller/session id (Caller_Identity)
 * @param {string[]} [args.entitledRunIds] runs this session may read
 * @param {number} [args.expiryWindowSeconds] [300, 86400], default 3600
 * @param {number} [args.now] injectable clock (ms epoch) for deterministic tests
 * @returns {string} `header.payload.signature`
 */
export function mintSessionToken({ secret, subject, entitledRunIds = [], expiryWindowSeconds, now } = {}) {
  if (typeof secret !== "string" || !secret) throw new Error("signing secret is required");
  const iatMs = Number.isFinite(now) ? now : Date.now();
  const iat = Math.floor(iatMs / 1000);
  const exp = iat + clampExpiry(expiryWindowSeconds);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: typeof subject === "string" && subject ? subject : `sess_${iat}_${Math.random().toString(36).slice(2, 10)}`,
    entitledRunIds: Array.isArray(entitledRunIds) ? entitledRunIds.slice(0, 100) : [],
    iat,
    exp,
  };
  const signingInput = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  return `${signingInput}.${sign(signingInput, secret)}`;
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
export function verifySessionToken(token, secret, opts = {}) {
  if (typeof secret !== "string" || !secret) return { valid: false, reason: "no_secret" };
  if (typeof token !== "string" || token.split(".").length !== 3) {
    return { valid: false, reason: "malformed" };
  }
  const [h, p, sig] = token.split(".");
  const expected = sign(`${h}.${p}`, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false, reason: "bad_signature" };

  let claims;
  try {
    claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "malformed" };
  }
  const nowSec = Math.floor((Number.isFinite(opts.now) ? opts.now : Date.now()) / 1000);
  if (typeof claims.exp === "number" && nowSec >= claims.exp) return { valid: false, reason: "expired" };

  return { valid: true, claims };
}

export const AUTH_EXPIRY = Object.freeze({
  DEFAULT_EXPIRY_SECONDS,
  MIN_EXPIRY_SECONDS,
  MAX_EXPIRY_SECONDS,
});
