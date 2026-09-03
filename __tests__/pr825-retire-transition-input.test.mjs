import assert from "node:assert/strict";
import test from "node:test";

import { createPr825LiveRetireTransitionInput } from "../scripts/pr825-live-retire-transition-input.mjs";
import {
  PR825_RETIRE_TRANSITION_INPUT_SCHEMA,
  createPr825RetireTransitionInput,
} from "../scripts/pr825-retire-transition-input.mjs";
import { createPr825TerminalizerPlan } from "../scripts/pr825-terminalizer-controller.mjs";
import { readPr825TerminalizerSeed } from "../scripts/pr825-terminalizer-seed.mjs";

test("builds a historically dispatchable PR825 retire transition input from the successor integration receipt", async () => {
  const record = await createPr825RetireTransitionInput({
    observedAt: "2026-09-03T08:27:11.000Z",
    expiresAt: "2026-09-03T08:41:35.861Z",
  });

  assert.equal(record.schema, PR825_RETIRE_TRANSITION_INPUT_SCHEMA);
  assert.equal(record.integratedSourcePublishedAt, "2026-09-03T08:27:10.000Z");
  assert.equal(record.integratedSourceExpiresAt, "2026-09-03T08:41:35.861Z");
  assert.equal(record.sourcePublishedAt, "2026-09-03T08:27:10.000Z");
  assert.equal(record.sourceExpiresAt, "2026-09-03T08:41:35.861Z");
  assert.equal(record.sourceWindowOpen, true);
  assert.equal(record.dispatchReady, true);
  assert.equal(record.operationInput.predecessorIssuance, null);
  assert.equal(record.operationInput.request.requestedTransition, "retire");
  assert.equal(record.operationInput.plan.effectClass, "claim-retirement-with-cleanup");
  assert.equal(
    record.operationInput.plan.authority.predecessorDigest,
    "dfcfc9813f5be7b893b7e892b7e835438409c8f6ea1af9f2a4fe96b9c939cdbc",
  );
  assert.equal(record.dispatch.ref, "main");
  assert.equal(record.dispatch.event, "workflow_dispatch");
  assert.equal(record.dispatch.githubApiVersion, "2026-03-10");
  assert.equal(record.dispatch.inputs.operation_payload, record.operationPayload);
  assert.equal(record.dispatch.inputs.operation_input_digest, record.operationInputDigest);
  assert.equal(
    record.cleanupBindingsDigest,
    "0c42e76af326056f6e0ccfcc2efbacf803377f208c2dd6d7144ef60f03f49eba",
  );
  assert.equal(
    record.cleanupPlanDigest,
    "a67366eedcae7dbd9531055057a4933839efed0fc82d436eb01553a270d20503",
  );
  assert.equal(
    record.cleanupPlanByteDigest,
    "1ce138eb3e04f19f8def488075e6db8cf249a999098c729e7524597f5e2a5f6c",
  );
  assert.equal(
    record.requestDigest,
    "4c324bffcdce5adc9695d5bca753166d82d747e35385e17e774c323a96165adb",
  );
  assert.equal(
    record.planByteDigest,
    "2064f44b49781a8916a43e5e0dd5ef6ca762c33282e8b1e3e0da6a895a9f1f89",
  );
  assert.equal(
    record.operationInputDigest,
    "994c76f25d5bef70da2a667f3545551d9039e32fe4b554977ad6aac50464ccf3",
  );
  assert.equal(
    record.recordDigest,
    "2a9857fe05fb323cc1fee4fd603d0444d572ad3ac8d7da2c18b31eb214f2310f",
  );
});

test("marks PR825 retire dispatch blocked once the integrated source window has expired", async () => {
  const record = await createPr825RetireTransitionInput({
    observedAt: "2026-09-03T08:41:35.862Z",
    expiresAt: "2026-09-03T08:56:35.862Z",
  });

  assert.equal(record.sourceWindowOpen, false);
  assert.equal(record.dispatchReady, false);
  assert.deepEqual(record.dispatchBlockedBy, {
    reason: "expired-integrated-source-window",
    sourcePublishedAt: "2026-09-03T08:27:10.000Z",
    sourceExpiresAt: "2026-09-03T08:41:35.861Z",
  });
});

test("builds a successor-bound PR825 retire transition input inside a fresh authority window", async () => {
  const seed = await readPr825TerminalizerSeed();
  const plan = createPr825TerminalizerPlan(seed);
  const live = await createPr825LiveRetireTransitionInput({
    authorization: plan.exactAuthorization,
    observedAt: "2026-09-03T17:00:00.000Z",
    expiresAt: "2026-09-03T17:15:00.000Z",
    authorityIssuedAt: "2026-09-03T17:00:00.000Z",
    authorityExpiresAt: "2026-09-03T17:15:00.000Z",
  });

  assert.equal(live.payloadReady, true);
  assert.equal(live.dispatch.ref, "main");
  assert.equal(live.dispatch.event, "workflow_dispatch");
  assert.equal(live.operationInput.request.requestedTransition, "retire");
  assert.equal(live.operationInput.plan.effectClass, "claim-retirement-with-cleanup");
  assert.equal(
    live.operationInput.plan.authority.predecessorDigest,
    live.predecessorAuthority.predecessorTransitionReceiptDigest,
  );
  assert.equal(live.predecessorAuthority.issuedAt, "2026-09-03T17:00:00.000Z");
  assert.equal(live.predecessorAuthority.expiresAt, "2026-09-03T17:15:00.000Z");
  assert.match(live.operationPayload, /"predecessorAuthority"/u);
  assert.match(live.operationInputDigest, /^[0-9a-f]{64}$/u);
  assert.match(live.recordDigest, /^[0-9a-f]{64}$/u);
});
