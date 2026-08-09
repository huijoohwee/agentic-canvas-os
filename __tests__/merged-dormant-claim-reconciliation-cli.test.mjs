// Responsibility: verify read-only planning and exact receipt-bound run argument forwarding.
import assert from "node:assert/strict";
import test from "node:test";

import { main } from "../scripts/merged-dormant-claim-reconciliation.mjs";

const digest = character => character.repeat(64);
const common = [
  "--source-repository=/preserved/source",
  "--target-repository=org/product",
  "--pull-request=738",
  `--claim-id=${digest("a")}`,
];

test("plan builds a checkout-independent adapter and returns controller authorization verbatim", async () => {
  let adapterOptions = null;
  let planInput = null;
  const result = await main(["plan", ...common, "--ttl-seconds=900"], {
    createAdapter: options => {
      adapterOptions = options;
      return { adapter: true };
    },
    createController: ({ adapter }) => {
      assert.deepEqual(adapter, { adapter: true });
      return {
        plan: input => {
          planInput = input;
          return { status: "planned", exactAuthorization: `authorize reconciliation ${digest("b")}` };
        },
      };
    },
  });

  assert.equal(adapterOptions.sourceRepository, "/preserved/source");
  assert.equal(adapterOptions.targetRepository, "org/product");
  assert.equal(adapterOptions.pullRequestNumber, 738);
  assert.equal(adapterOptions.ttlSeconds, 900);
  assert.deepEqual(planInput, { planDigest: null });
  assert.equal(result.status, "planned");
});

test("run requires and forwards the exact plan digest and authorization", async () => {
  const planDigest = digest("c");
  const authorization = `authorize merged-dormant-claim-reconciliation ${planDigest}`;
  let runInput = null;
  const result = await main([
    "run",
    ...common,
    `--plan-digest=${planDigest}`,
    `--authorize=${authorization}`,
  ], {
    createAdapter: () => ({ adapter: true }),
    createController: () => ({
      run: input => {
        runInput = input;
        return { status: "complete", planDigest };
      },
    }),
  });

  assert.deepEqual(runInput, { authorization, planDigest });
  assert.deepEqual(result, { status: "complete", planDigest });
});

test("CLI rejects ambiguous modes and authorization at the read-only plan boundary", async () => {
  const dependencies = {
    createAdapter: () => ({ adapter: true }),
    createController: () => ({ plan: () => null }),
  };
  await assert.rejects(() => main(["execute", ...common], dependencies), /Usage:/);
  await assert.rejects(
    () => main(["plan", ...common, `--authorize=${digest("d")}`], dependencies),
    /plan does not accept --authorize/,
  );
});

test("run fails closed before controller execution without a receipt-bound plan digest", async () => {
  let executed = false;
  await assert.rejects(() => main(["run", ...common, "--authorize=anything"], {
    createAdapter: () => ({ adapter: true }),
    createController: () => ({ run: () => { executed = true; } }),
  }), /requires --plan-digest/);
  assert.equal(executed, false);
});
