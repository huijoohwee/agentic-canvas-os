// Responsibility: prove strict CLI parsing and the read-only-plan/exact-authorized-run boundary.
import assert from "node:assert/strict";
import test from "node:test";

import {
  main,
  runCli,
} from "../scripts/provider-only-merged-claim-pair-reconciliation.mjs";

const sourceClaimId = "a".repeat(64);
const waiterClaimId = "b".repeat(64);
const required = [
  "--source-repository=/site",
  "--target-repository=owner/site",
  "--pull-request=784",
  `--source-claim-id=${sourceClaimId}`,
  `--waiter-claim-id=${waiterClaimId}`,
];

test("plan forwards normalized defaults and never calls the run surface", async () => {
  const calls = [];
  const result = await main(["plan", ...required], {
    createAdapter: options => ({ options }),
    createController: ({ adapter }) => ({
      plan: input => {
        calls.push({ method: "plan", adapter, input });
        return { status: "planned", planDigest: "c".repeat(64) };
      },
      run: () => { throw new Error("run must not be called by plan"); },
    }),
  });

  assert.equal(result.status, "planned");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "plan");
  assert.deepEqual(calls[0].input, { planDigest: null });
  assert.deepEqual(calls[0].adapter.options, {
    sourceRepository: "/site",
    targetRepository: "owner/site",
    pullRequestNumber: 784,
    sourceClaimId,
    waiterClaimId,
    ledgerRepository: "huijoohwee/agentic-canvas-os",
    planPath: null,
    statePath: null,
    ttlSeconds: 1_800,
  });
});

test("run forwards only an explicit digest and exact authorization with overrides", async () => {
  const planDigest = "c".repeat(64);
  const authorization = `authorize provider-only-merged-claim-pair-reconciliation ${planDigest}`;
  const calls = [];
  const result = await main([
    "run", ...required,
    "--ledger-repository=owner/ledger",
    "--plan-path=/private/reconciliation.plan.json",
    "--state-path=/private/reconciliation.json",
    "--ttl-seconds=900",
    `--plan-digest=${planDigest}`,
    `--authorize=${authorization}`,
    "--json",
  ], {
    createAdapter: options => ({ options }),
    createController: ({ adapter }) => ({
      plan: () => { throw new Error("plan must not be called by run"); },
      run: input => {
        calls.push({ adapter, input });
        return { status: "complete" };
      },
    }),
  });

  assert.deepEqual(result, { status: "complete" });
  assert.deepEqual(calls[0].input, { planDigest, authorization });
  assert.equal(calls[0].adapter.options.ledgerRepository, "owner/ledger");
  assert.equal(calls[0].adapter.options.planPath, "/private/reconciliation.plan.json");
  assert.equal(calls[0].adapter.options.statePath, "/private/reconciliation.json");
  assert.equal(calls[0].adapter.options.ttlSeconds, 900);
});

test("rejects mutation authority on plan and missing authority on run", async () => {
  const dependencies = {
    createAdapter: options => ({ options }),
    createController: () => ({ plan: () => ({}), run: () => ({}) }),
  };
  await assert.rejects(
    main(["plan", ...required, "--authorize=anything"], dependencies),
    /plan does not accept --authorize/iu,
  );
  await assert.rejects(
    main(["run", ...required, "--authorize=anything"], dependencies),
    /run requires --plan-digest/iu,
  );
  await assert.rejects(
    main(["run", ...required, `--plan-digest=${"c".repeat(64)}`], dependencies),
    /--authorize=.* is required/iu,
  );
});

test("fails closed on unknown, duplicate, malformed, and nonpositive options", async () => {
  const cases = [
    [["inspect", ...required], /Usage:/u],
    [["plan", ...required, "--unknown=value"], /Unsupported option/iu],
    [["plan", ...required, "--pull-request=785"], /must be provided once/iu],
    [["plan", ...required.map(value => value.startsWith("--pull-request=")
      ? "--pull-request=0" : value)], /must be positive/iu],
    [["plan", ...required, "--json", "--json"], /must be provided once/iu],
  ];
  for (const [argumentsList, pattern] of cases) {
    await assert.rejects(main(argumentsList, {
      createAdapter: () => ({}),
      createController: () => ({ plan: () => ({}) }),
    }), pattern);
  }
});

test("rejects incomplete controller surfaces before dispatch", async () => {
  await assert.rejects(main(["plan", ...required], {
    createAdapter: () => ({}),
    createController: () => ({}),
  }), /controller surface is unavailable/iu);
  await assert.rejects(main([
    "run", ...required, `--plan-digest=${"c".repeat(64)}`, "--authorize=exact",
  ], {
    createAdapter: () => ({}),
    createController: () => ({ plan: () => ({}) }),
  }), /controller surface is unavailable/iu);
});

test("runCli emits one typed blocked result and a nonzero status", async () => {
  let stderr = "";
  const original = process.stderr.write;
  process.stderr.write = chunk => { stderr += String(chunk); return true; };
  try {
    assert.equal(await runCli(["unsupported"]), 1);
  } finally {
    process.stderr.write = original;
  }
  const result = JSON.parse(stderr);
  assert.equal(
    result.schema,
    "agentic-provider-only-merged-claim-pair-reconciliation-result/v1",
  );
  assert.equal(result.status, "blocked");
  assert.match(result.error, /Usage:/u);
});
