import { readGraphAuthorityProjection } from "./commerce-admission-authority.js";
import {
  COMMERCE_ADMISSION_PATH,
  COMMERCE_ADMISSION_PROVIDER_CONTRACT,
  COMMERCE_ADMISSION_RECEIPT_SCHEMA,
  commerceAdmissionAuthHeaders,
  isCommerceAdmissionAuthSecret,
  sha256Hex,
} from "./commerce-admission-contract.js";
import { readCommerceDeploymentIdentity } from "./commerce-deployment-identity.js";

export const COMMERCE_RELEASE_PROOF_PATH = "/release-proof/commerce-admission";
const MAX_EVIDENCE_BYTES = 65_536;
const ENVELOPE_KEYS = Object.freeze([
  "authority",
  "contract",
  "deploymentIdentity",
  "ok",
  "operations",
  "productionReady",
  "receiptSchema",
]);

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export function isCommerceReleaseProbeToken(value) {
  return typeof value === "string"
    && /^[\x21-\x7e]{32,256}$/u.test(value)
    && !/(?:replace|placeholder|required|example|changeme|todo)/iu.test(value);
}

async function constantTimeTokenMatch(expected, presented) {
  const [left, right] = await Promise.all([digest(expected), digest(presented)]);
  let mismatch = expected.length === presented.length ? 0 : 1;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

async function readBoundedJson(upstream) {
  const declared = Number(upstream.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_EVIDENCE_BYTES) return null;
  const reader = upstream.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let size = 0;
  let value = "";
  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    size += chunk.byteLength;
    if (size > MAX_EVIDENCE_BYTES) {
      await reader.cancel();
      return null;
    }
    value += decoder.decode(chunk, { stream: true });
  }
  value += decoder.decode();
  try { return JSON.parse(value); } catch { return null; }
}

export function readCommerceReleaseProofEnvelope(value) {
  if (!exactKeys(value, ENVELOPE_KEYS)
    || value.ok !== true
    || value.contract !== COMMERCE_ADMISSION_PROVIDER_CONTRACT
    || value.receiptSchema !== COMMERCE_ADMISSION_RECEIPT_SCHEMA
    || value.productionReady !== true
    || !Array.isArray(value.operations)
    || value.operations.length !== 1
    || value.operations[0] !== "register-fenced") return null;
  const deploymentIdentity = readCommerceDeploymentIdentity(value.deploymentIdentity);
  const authority = readGraphAuthorityProjection(value.authority);
  if (!deploymentIdentity || !authority) return null;
  return Object.freeze({
    ok: true,
    contract: value.contract,
    receiptSchema: value.receiptSchema,
    operations: Object.freeze(["register-fenced"]),
    productionReady: true,
    deploymentIdentity,
    authority,
  });
}

export function createCommerceReleaseProofHandler({ token, admissionAuthSecret, serviceFetch } = {}) {
  const configured = isCommerceReleaseProbeToken(token)
    && isCommerceAdmissionAuthSecret(admissionAuthSecret)
    && typeof serviceFetch === "function";
  return Object.freeze({
    async handle(request) {
      const url = new URL(request.url);
      if (url.pathname !== COMMERCE_RELEASE_PROOF_PATH) return response(404, { error: "not found" });
      if (request.method !== "GET") return response(405, { error: "method not allowed" });
      if (!configured) return response(503, { ok: false, code: "release_probe_unconfigured" });
      const authorization = request.headers.get("authorization") ?? "";
      const presented = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
      if (presented.length > 256 || !await constantTimeTokenMatch(token, presented)) {
        return response(401, { error: "unauthorized" });
      }
      let upstream;
      try {
        const readyUrl = `https://agentic-os-admission.internal${COMMERCE_ADMISSION_PATH}/readyz`;
        const authHeaders = await commerceAdmissionAuthHeaders({
          method: "GET",
          url: readyUrl,
          bodyDigest: await sha256Hex(new Uint8Array()),
          headers: new Headers(),
          secret: admissionAuthSecret,
        });
        upstream = await serviceFetch(new Request(readyUrl, { headers: authHeaders }));
      } catch {
        return response(503, { ok: false, code: "admission_service_unavailable" });
      }
      if (!(upstream instanceof Response) || upstream.status !== 200) {
        if (upstream instanceof Response && upstream.body) await upstream.body.cancel();
        return response(503, { ok: false, code: "admission_service_unready" });
      }
      const evidence = readCommerceReleaseProofEnvelope(await readBoundedJson(upstream));
      return evidence
        ? response(200, evidence)
        : response(503, { ok: false, code: "admission_evidence_invalid" });
    },
    stats: () => Object.freeze({ configured, maxEvidenceBytes: MAX_EVIDENCE_BYTES }),
  });
}
