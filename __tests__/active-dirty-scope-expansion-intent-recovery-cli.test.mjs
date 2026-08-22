// Responsibility: verify neutral plan/run CLI parsing and exact authority forwarding.
import assert from "node:assert/strict";
import test from "node:test";

import {
  main,
  runCli,
} from "../scripts/active-dirty-scope-expansion-intent-recovery.mjs";

const digest = character => character.repeat(64);
const common = [
  "--source-repository=/preserved/source",
  "--session=source-session",
  "--ledger-repository=owner/ledger",
  "--target-repository=owner/product",
  "--pull-request=436",
];

test("plan constructs the repository adapter from explicit instance identity", async () => {
  let adapterOptions;
  let planInput;
  const result = await main(["plan", ...common, "--json"], {
    createAdapter: (options) => {
      adapterOptions = options;
      return { adapter: true };
    },
    createController: ({ adapter }) => {
      assert.deepEqual(adapter, { adapter: true });
      return {
        plan: (input) => {
          planInput = input;
          return {
            status: "planned",
            exactAuthorization:
              `authorize active-dirty-scope-expansion-intent-recovery ${digest("a")}`,
          };
        },
      };
    },
  });
  assert.deepEqual(adapterOptions, {
    sourceRepository: "/preserved/source",
    sessionId: "source-session",
    ledgerRepository: "owner/ledger",
    targetRepository: "owner/product",
    pullRequestNumber: 436,
  });
  assert.deepEqual(planInput, { planDigest: null });
  assert.equal(result.status, "planned");
});

test("run requires and forwards one exact plan digest and byte-exact authorization", async () => {
  const planDigest = digest("b");
  const authorization =
    `authorize active-dirty-scope-expansion-intent-recovery ${planDigest}`;
  let runInput;
  const result = await main([
    "run",
    ...common,
    `--plan-digest=${planDigest}`,
    `--authorize=${authorization}`,
  ], {
    createAdapter: () => ({ adapter: true }),
    createController: () => ({
      run: (input) => {
        runInput = input;
        return {
          status: "complete",
          planDigest,
          authoringAuthority: false,
          deployment: false,
        };
      },
    }),
  });
  assert.deepEqual(runInput, { authorization, planDigest });
  assert.deepEqual(result, {
    status: "complete",
    planDigest,
    authoringAuthority: false,
    deployment: false,
  });
});

test("run rejects missing or malformed authority before adapter construction", async () => {
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
    /--plan-digest/u,
  );
  await assert.rejects(
    () => main([
      "run",
      ...common,
      "--plan-digest=not-a-digest",
      "--authorize=anything",
    ], dependencies),
    /exact lowercase SHA-256 digest/u,
  );
  await assert.rejects(
    () => main(["run", ...common, `--plan-digest=${digest("c")}`], dependencies),
    /--authorize/u,
  );
  assert.equal(adapterCalls, 0);
});

test("CLI rejects implicit instance identity, duplicates, unknowns, and plan-time authority", async () => {
  const dependencies = {
    createAdapter: () => ({ adapter: true }),
    createController: () => ({ plan: () => null }),
  };
  await assert.rejects(
    () => main(["plan", ...common, "--authorize=no"], dependencies),
    /does not accept/u,
  );
  await assert.rejects(
    () => main(["plan", ...common, "--pull-request=437"], dependencies),
    /exactly once/u,
  );
  await assert.rejects(
    () => main(["plan", ...common, "--json", "--json"], dependencies),
    /exactly once/u,
  );
  await assert.rejects(
    () => main(["plan", ...common, "--force=true"], dependencies),
    /Unsupported option/u,
  );
  const missingTarget = common.filter(value => !value.startsWith("--target-repository="));
  await assert.rejects(
    () => main(["plan", ...missingTarget], dependencies),
    /--target-repository/u,
  );
  const missingLedger = common.filter(value => !value.startsWith("--ledger-repository="));
  await assert.rejects(
    () => main(["plan", ...missingLedger], dependencies),
    /--ledger-repository/u,
  );
  const missingPullRequest = common.filter(value => !value.startsWith("--pull-request="));
  await assert.rejects(
    () => main(["plan", ...missingPullRequest], dependencies),
    /--pull-request/u,
  );
});

test("runCli emits one always-JSON blocked result without exposing local paths", async () => {
  const writes = [];
  const original = console.log;
  console.log = value => writes.push(value);
  try {
    const exitCode = await runCli(["plan", "--source-repository=/Users/private/lane"], {
      createAdapter: () => {
        throw new Error("must not construct");
      },
    });
    assert.equal(exitCode, 1);
  } finally {
    console.log = original;
  }
  assert.equal(writes.length, 1);
  const result = JSON.parse(writes[0]);
  assert.equal(result.status, "blocked");
  assert.equal(result.schema,
    "agentic-active-dirty-scope-expansion-intent-recovery-result/v1");
  assert.doesNotMatch(result.error, /\/Users\/private/u);
});
