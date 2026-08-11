// Responsibility: Verify strict CLI parsing and exact controller request forwarding.
import assert from "node:assert/strict";
import test from "node:test";

import { main } from "../scripts/retired-handoff-successor-disposition.mjs";

const digest = character => character.repeat(64);
const common = [
  "--repository=/workspace/knowgrph",
  "--controller-root=/workspace/agentic-canvas-os",
  "--target-repository=owner/knowgrph",
  "--ledger-repository=owner/agentic-canvas-os",
  "--source-pr=712",
  `--source-claim-id=${digest("a")}`,
  "--successor-pr=742",
];

test("plan creates one repository adapter and forwards a read-only exact subject", async () => {
  let adapterOptions;
  let planInput;
  const result = await main(["plan", ...common], {
    createAdapter(options) {
      adapterOptions = options;
      return { adapter: true };
    },
    createController({ adapter }) {
      assert.deepEqual(adapter, { adapter: true });
      return {
        plan(input) {
          planInput = input;
          return { status: "planned" };
        },
      };
    },
  });

  assert.equal(result.status, "planned");
  assert.equal(adapterOptions.sourcePr, 712);
  assert.equal(adapterOptions.sourceClaimId, digest("a"));
  assert.equal(adapterOptions.successorPr, 742);
  assert.equal(adapterOptions.portDecision, null);
  assert.equal(planInput.planDigest, null);
  assert.equal(planInput.targetRepository, "owner/knowgrph");
});

test("run requires and forwards the exact plan digest and authorization bytes", async () => {
  const planDigest = digest("b");
  const authorization = `authorize retired-handoff-successor-disposition ${planDigest}`;
  let runInput;
  const result = await main([
    "run", ...common, `--plan-digest=${planDigest}`, `--authorize=${authorization}`,
  ], {
    createAdapter: () => ({ adapter: true }),
    createController: () => ({
      run(input) {
        runInput = input;
        return { status: "complete" };
      },
    }),
  });

  assert.equal(result.status, "complete");
  assert.equal(runInput.planDigest, planDigest);
  assert.equal(runInput.authorization, authorization);
  assert.equal(runInput.sourcePr, 712);
});

test("observe and plan reject authority-bearing options", async () => {
  const dependencies = {
    createAdapter: () => ({ adapter: true }),
    createController: () => ({ observe: () => ({}), plan: () => ({}) }),
  };
  await assert.rejects(
    main(["observe", ...common, `--authorize=${digest("c")}`], dependencies),
    /observe does not accept/u,
  );
  await assert.rejects(
    main(["plan", ...common, `--authorize=${digest("c")}`], dependencies),
    /plan does not accept/u,
  );
});

test("ambiguous, unknown, or incomplete run input fails before controller effects", async () => {
  let executed = false;
  const dependencies = {
    createAdapter: () => ({ adapter: true }),
    createController: () => ({ run() { executed = true; } }),
  };
  await assert.rejects(
    main(["run", ...common, "--source-pr=713"], dependencies),
    /provided exactly once/u,
  );
  await assert.rejects(
    main(["run", ...common, "--unexpected=value"], dependencies),
    /Unsupported option/u,
  );
  await assert.rejects(
    main(["run", ...common, "--authorize=anything"], dependencies),
    /requires --plan-digest/u,
  );
  assert.equal(executed, false);
});
