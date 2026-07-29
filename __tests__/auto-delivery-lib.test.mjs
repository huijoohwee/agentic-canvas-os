import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_DELIVERY_LABEL,
  isAuthorizedAutoDeliveryPullRequest,
} from "../scripts/auto-delivery-lib.mjs";
import { renderWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";

const repository = "example/agentic-canvas-os";
const headSha = "c".repeat(40);
const lease = {
  schema: "agentic-writer-lease/v2",
  status: "review_ready",
  epoch: 4,
  sessionId: "session-a",
  device: "device",
  scope: "auto-delivery",
  branch: "agent/device/auto-delivery",
  baseSha: "a".repeat(40),
  fenceSha: "b".repeat(40),
  reviewHeadSha: headSha,
  autoDelivery: true,
  runtimeRequired: true,
  heartbeatAt: "2026-07-26T00:00:00.000Z",
  expiresAt: "2026-07-26T00:00:00.000Z",
};

function pull(overrides = {}) {
  return {
    draft: false,
    base: { ref: "main" },
    head: { repo: { full_name: repository }, ref: lease.branch, sha: headSha },
    labels: [{ name: AUTO_DELIVERY_LABEL }],
    body: renderWriterLeasePullRequestBody(lease),
    ...overrides,
  };
}

test("auto-delivery requires an exact review-ready lease, reviewed head, and runtime requirement", () => {
  assert.equal(isAuthorizedAutoDeliveryPullRequest(pull(), repository), true);
  assert.equal(isAuthorizedAutoDeliveryPullRequest(pull({
    head: { repo: { full_name: repository }, ref: lease.branch, sha: "d".repeat(40) },
  }), repository), false);
  assert.equal(isAuthorizedAutoDeliveryPullRequest(pull({ labels: [] }), repository), false);
  assert.equal(isAuthorizedAutoDeliveryPullRequest(pull({
    body: renderWriterLeasePullRequestBody({ ...lease, runtimeRequired: false }),
  }), repository), false);
  assert.equal(isAuthorizedAutoDeliveryPullRequest(pull({
    head: { repo: { full_name: "fork/agentic-canvas-os" }, ref: lease.branch, sha: headSha },
  }), repository), false);
});
