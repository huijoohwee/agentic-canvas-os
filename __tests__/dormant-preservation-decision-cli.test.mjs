// Responsibility: Verify strict CLI parsing and exact plan/run forwarding without repository effects.
import assert from "node:assert/strict";
import test from "node:test";

import { main } from "../scripts/dormant-preservation-decision.mjs";

const digest = character => character.repeat(64);
const common = [
  "--repository=/workspace/repository", "--target-repository=owner/repository",
  "--worktree=/workspace/worktrees/candidate", "--scope=new-scope",
  "--session=session-1", "--manifest=/workspace/manifest.json",
  "--cloud-authority=/workspace/authority.json", "--selection=/workspace/selection.json",
];

test("plan creates one repository adapter and forwards a read-only request", async () => {
  let adapterOptions;
  let planInput;
  const result = await main(["plan", ...common, "--ttl-seconds=900"], {
    createAdapter(options) { adapterOptions = options; return { adapter: true }; },
    createController({ adapter }) {
      assert.deepEqual(adapter, { adapter: true });
      return { plan(input) { planInput = input; return { status: "planned" }; } };
    },
  });

  assert.equal(result.status, "planned");
  assert.equal(adapterOptions.ttlSeconds, 900);
  assert.deepEqual(planInput, { planDigest: null });
});

test("run requires and forwards the exact digest and authorization bytes", async () => {
  const planDigest = digest("a");
  const authorization = `authorize dormant-preservation-admission ${planDigest}`;
  let runInput;
  const result = await main([
    "run", ...common, `--plan-digest=${planDigest}`, `--authorize=${authorization}`,
  ], {
    createAdapter: () => ({ adapter: true }),
    createController: () => ({ run(input) { runInput = input; return { status: "complete" }; } }),
  });

  assert.equal(result.status, "complete");
  assert.deepEqual(runInput, { planDigest, authorization });
});

test("ambiguous, unknown, or authority-bearing plan options fail closed", async () => {
  const dependencies = {
    createAdapter: () => ({ adapter: true }),
    createController: () => ({ plan: () => ({}) }),
  };
  await assert.rejects(
    main(["plan", ...common, "--scope=duplicate"], dependencies),
    /provided exactly once/u,
  );
  await assert.rejects(
    main(["plan", ...common, "--unexpected=value"], dependencies),
    /Unsupported option/u,
  );
  await assert.rejects(
    main(["plan", ...common, "--root-source-bootstrap={}"], dependencies),
    /Unsupported option/u,
  );
  await assert.rejects(
    main(["plan", ...common, "--authorize=forbidden"], dependencies),
    /plan does not accept/u,
  );
});

test("run cannot reach the controller without both authority fields", async () => {
  let executed = false;
  const dependencies = {
    createAdapter: () => ({ adapter: true }),
    createController: () => ({ run() { executed = true; } }),
  };
  await assert.rejects(
    main(["run", ...common, "--authorize=anything"], dependencies),
    /requires --plan-digest/u,
  );
  await assert.rejects(
    main(["run", ...common, `--plan-digest=${digest("b")}`], dependencies),
    /--authorize/u,
  );
  assert.equal(executed, false);
});
