// Responsibility: verify strict plan/run CLI parsing and exact authority forwarding.
import assert from "node:assert/strict";
import test from "node:test";

import { main } from "../scripts/expired-active-dirty-scope-expansion-recovery.mjs";

const digest = character => character.repeat(64);
const common = [
  "--source-repository=/preserved/source",
  "--target-repository=owner/product",
  "--pull-request=358",
  `--claim-id=${digest("a")}`,
];

test("plan builds the checkout-independent repository adapter and forwards plan constraints", async () => {
  let adapterOptions;
  let planInput;
  const result = await main(["plan", ...common, "--ttl-seconds=900", "--ledger-repository=owner/ledger"], {
    createAdapter: options => {
      adapterOptions = options;
      return { adapter: true };
    },
    createController: ({ adapter }) => {
      assert.deepEqual(adapter, { adapter: true });
      return {
        plan: input => {
          planInput = input;
          return { status: "planned", exactAuthorization: `authorize recovery ${digest("b")}` };
        },
      };
    },
  });
  assert.equal(adapterOptions.sourceRepository, "/preserved/source");
  assert.equal(adapterOptions.targetRepository, "owner/product");
  assert.equal(adapterOptions.pullRequestNumber, 358);
  assert.equal(adapterOptions.ledgerRepository, "owner/ledger");
  assert.equal(adapterOptions.ttlSeconds, 900);
  assert.deepEqual(planInput, { planDigest: null });
  assert.equal(result.status, "planned");
});

test("run requires and forwards one exact plan digest and authorization", async () => {
  const planDigest = digest("c");
  const authorization = `authorize expired-active-dirty-scope-expansion-recovery ${planDigest}`;
  let runInput;
  const result = await main([
    "run", ...common, `--plan-digest=${planDigest}`, `--authorize=${authorization}`,
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

test("run rejects missing or malformed authority before constructing an adapter", async () => {
  let adapterCalls = 0;
  const dependencies = {
    createAdapter: () => {
      adapterCalls += 1;
      return {};
    },
    createController: () => ({ run: () => null }),
  };
  await assert.rejects(
    () => main(["run", ...common, "--authorize=anything"], dependencies),
    /requires --plan-digest/,
  );
  await assert.rejects(
    () => main(["run", ...common, "--plan-digest=not-a-digest", "--authorize=anything"], dependencies),
    /exact lowercase digest/,
  );
  await assert.rejects(
    () => main(["run", ...common, `--plan-digest=${digest("d")}`], dependencies),
    /--authorize/,
  );
  assert.equal(adapterCalls, 0);
});

test("CLI rejects duplicate, unknown, and plan-time authorization options", async () => {
  const dependencies = {
    createAdapter: () => ({ adapter: true }),
    createController: () => ({ plan: () => null }),
  };
  await assert.rejects(
    () => main(["plan", ...common, "--authorize=no"], dependencies),
    /does not accept/,
  );
  await assert.rejects(
    () => main(["plan", ...common, "--pull-request=359"], dependencies),
    /exactly once/,
  );
  await assert.rejects(
    () => main(["plan", ...common, "--force=true"], dependencies),
    /Unsupported option/,
  );
  for (const option of ["--state-path=/tracked/source", "--controller-root=/foreign/runtime"]) {
    await assert.rejects(() => main(["plan", ...common, option], dependencies), /Unsupported option/);
  }
});
