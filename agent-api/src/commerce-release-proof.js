import {
  COMMERCE_ADMISSION_PATH,
  commerceAdmissionAuthHeaders,
  isCommerceAdmissionAuthSecret,
  readCommerceAdmissionReadyEnvelope,
  sha256Hex,
} from "./commerce-admission-contract.js";

export const COMMERCE_RELEASE_PROOF_PATH = "/release-proof/commerce-admission";
const MAX_EVIDENCE_BYTES = 65_536;

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
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_EVIDENCE_BYTES) { await reader.cancel(); return null; }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try { return JSON.parse(text); } catch { return null; }
}

export function createCommerceReleaseProofHandler({ token, admissionAuthSecret, serviceFetch } = {}) {
  const configured = typeof token === "string"
    && token.length >= 32
    && token.length <= 256
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
        const readyUrl = `https://acos-admission.internal${COMMERCE_ADMISSION_PATH}/readyz`;
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
      const evidence = readCommerceAdmissionReadyEnvelope(await readBoundedJson(upstream));
      return evidence
        ? response(200, evidence)
        : response(503, { ok: false, code: "admission_evidence_invalid" });
    },
    stats: () => Object.freeze({ configured, maxEvidenceBytes: MAX_EVIDENCE_BYTES }),
  });
}
