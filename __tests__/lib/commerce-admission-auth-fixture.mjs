import { createHash, createHmac } from "node:crypto";

import {
  canonicalJson,
  createCommerceAdmissionAuthInput,
} from "../../agent-api/src/commerce-admission-contract.js";

export const ACOS_ADMISSION_TEST_SECRET = "acos-admission-test-secret-0000000001";

export function createAdmissionAuthFixture(url, secret = ACOS_ADMISSION_TEST_SECRET) {
  function authenticatedPost(bodyText, inputHeaders) {
    const headers = new Headers(inputHeaders);
    const input = createCommerceAdmissionAuthInput({
      method: "POST",
      url,
      bodyDigest: createHash("sha256").update(bodyText).digest("hex"),
      headers,
    });
    headers.set("x-acos-admission-auth-schema", "commerce-acos-admission-auth/v1");
    headers.set("x-acos-admission-auth-signature", createHmac("sha256", secret)
      .update(canonicalJson(input)).digest("hex"));
    return new Request(url, { method: "POST", headers, body: bodyText });
  }

  function readyRequest() {
    const readyUrl = `${url}/readyz`;
    const headers = new Headers();
    const input = createCommerceAdmissionAuthInput({
      method: "GET",
      url: readyUrl,
      bodyDigest: createHash("sha256").update("").digest("hex"),
      headers,
    });
    headers.set("x-acos-admission-auth-schema", "commerce-acos-admission-auth/v1");
    headers.set("x-acos-admission-auth-signature", createHmac("sha256", secret)
      .update(canonicalJson(input)).digest("hex"));
    return new Request(readyUrl, { headers });
  }

  return Object.freeze({ authenticatedPost, readyRequest });
}
