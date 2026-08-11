import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { projectRepeatedProtectedRefreshBase } from
  "../scripts/repeated-protected-refresh-base-projection.mjs";

const deliveredHeadSha = "1".repeat(40);
const firstRefreshSha = "2".repeat(40);
const firstMainParentSha = "3".repeat(40);
const secondRefreshSha = "4".repeat(40);
const secondMainParentSha = "5".repeat(40);

test("projects a one-hop refresh main parent as the next live PR base", () => {
  assert.deepEqual(projectRepeatedProtectedRefreshBase({
    acceptedHeadSha: deliveredHeadSha,
    refreshReceipt: {
      deliveredHeadSha,
      refreshedHeadSha: firstRefreshSha,
      mainParentSha: firstMainParentSha,
    },
  }), {
    acceptedHeadSha: firstRefreshSha,
    canonicalBaseSha: firstMainParentSha,
  });
});

test("projects the final main parent from an exact repeated-refresh chain", () => {
  assert.deepEqual(projectRepeatedProtectedRefreshBase({
    acceptedHeadSha: deliveredHeadSha,
    refreshReceipt: {
      deliveredHeadSha,
      refreshedHeadSha: secondRefreshSha,
      refreshes: [
        {
          previousHeadSha: deliveredHeadSha,
          refreshedHeadSha: firstRefreshSha,
          mainParentSha: firstMainParentSha,
        },
        {
          previousHeadSha: firstRefreshSha,
          refreshedHeadSha: secondRefreshSha,
          mainParentSha: secondMainParentSha,
        },
      ],
    },
  }), {
    acceptedHeadSha: secondRefreshSha,
    canonicalBaseSha: secondMainParentSha,
  });
});

test("rejects a receipt that does not continue the accepted head", () => {
  assert.throws(() => projectRepeatedProtectedRefreshBase({
    acceptedHeadSha: deliveredHeadSha,
    refreshReceipt: {
      deliveredHeadSha: "9".repeat(40),
      refreshedHeadSha: firstRefreshSha,
      mainParentSha: firstMainParentSha,
    },
  }), /does not continue the accepted head/u);
});

test("device integration keeps cloud verification pinned and dispatches the projected base", () => {
  const source = readFileSync(
    new URL("../scripts/device-integrate-lib.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /acceptedProtectedRefreshBaseSha = projectRepeatedProtectedRefreshBase/u);
  assert.match(source, /canonicalBaseSha: acceptedProtectedRefreshBaseSha,/u);
  assert.match(
    source,
    /verifyCloudAuthority:\s*\(\) => verifyCloudAuthority\([\s\S]*canonicalBaseSha: deliveryCloudAuthority\?\.canonicalBaseSha \|\| deliveryVerifiedBaseSha,/u,
  );
});
