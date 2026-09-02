import assert from "node:assert/strict";
import test from "node:test";

import { unstable_dev } from "wrangler";

test("the checked-in compatibility date populates the CommerceAdmissionProbe ctx export", { timeout: 15_000 }, async () => {
  const token = "runtime-loopback-proof-token-000001";
  const worker = await unstable_dev("worker/index.js", {
    config: "wrangler.jsonc",
    local: true,
    logLevel: "error",
    persist: false,
    port: 0,
    inspectorPort: 0,
    vars: {
      ACOS_RELEASE_PROBE_TOKEN: token,
      ACOS_ADMISSION_AUTH_SECRET: "acos-admission-runtime-proof-secret-0001",
    },
    experimental: {
      disableDevRegistry: true,
      disableExperimentalWarning: true,
      watch: false,
    },
  });
  try {
    const response = await worker.fetch("/release-proof/commerce-admission", {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      code: "admission_service_unready",
    });
  } finally {
    await worker.stop();
  }
});
