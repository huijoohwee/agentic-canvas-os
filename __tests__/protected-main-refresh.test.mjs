import test from "node:test";
import assert from "node:assert/strict";

import {
  appendProtectedMainRefresh,
  PROTECTED_MAIN_REFRESH_CHAIN_SCHEMA,
  PROTECTED_MAIN_REFRESH_SCHEMA,
  protectedMainRefreshHeads,
  verifyProtectedMainRefreshChain,
} from "../scripts/protected-main-refresh-lib.mjs";

const delivered = "a".repeat(40);
const refreshOne = "b".repeat(40);
const refreshTwo = "c".repeat(40);
const mainOne = "d".repeat(40);
const mainTwo = "e".repeat(40);
const treeOne = "f".repeat(40);
const treeTwo = "1".repeat(40);

test("verifies a nonadjacent tree-equivalent protected-main refresh chain", () => {
  const receipt = verifyProtectedMainRefreshChain({
    expectedHeadSha: delivered,
    observedHeadSha: refreshTwo,
    gitText: createGitText(),
  });

  assert.equal(receipt.schema, PROTECTED_MAIN_REFRESH_CHAIN_SCHEMA);
  assert.equal(receipt.refreshCount, 2);
  assert.equal(receipt.deliveredHeadSha, delivered);
  assert.equal(receipt.refreshedHeadSha, refreshTwo);
  assert.deepEqual(protectedMainRefreshHeads(receipt), [
    delivered,
    refreshOne,
    refreshTwo,
  ]);
  assert.deepEqual(receipt.refreshes, [
    {
      previousHeadSha: delivered,
      refreshedHeadSha: refreshOne,
      mainParentSha: mainOne,
      treeSha: treeOne,
    },
    {
      previousHeadSha: refreshOne,
      refreshedHeadSha: refreshTwo,
      mainParentSha: mainTwo,
      treeSha: treeTwo,
    },
  ]);
});

test("preserves the compatible one-refresh receipt and appends exact suffixes", () => {
  const gitText = createGitText();
  const first = verifyProtectedMainRefreshChain({
    expectedHeadSha: delivered,
    observedHeadSha: refreshOne,
    gitText,
  });
  const second = verifyProtectedMainRefreshChain({
    expectedHeadSha: refreshOne,
    observedHeadSha: refreshTwo,
    gitText,
  });

  assert.deepEqual(first, {
    schema: PROTECTED_MAIN_REFRESH_SCHEMA,
    deliveredHeadSha: delivered,
    refreshedHeadSha: refreshOne,
    mainParentSha: mainOne,
  });
  const combined = appendProtectedMainRefresh(first, second);
  assert.equal(combined.schema, PROTECTED_MAIN_REFRESH_CHAIN_SCHEMA);
  assert.equal(combined.refreshCount, 2);
  assert.deepEqual(protectedMainRefreshHeads(combined), [
    delivered,
    refreshOne,
    refreshTwo,
  ]);
});

test("rejects authored, octopus, discontinuous, foreign-main, and altered-tree hops", async t => {
  for (const [name, mutate, error] of [
    [
      "authored single-parent hop",
      values => ({ ...values, [`rev-list --parents -n 1 ${refreshTwo}`]:
        `${refreshTwo} ${refreshOne}` }),
      /advanced beyond an exact protected-main refresh chain/,
    ],
    [
      "octopus hop",
      values => ({ ...values, [`rev-list --parents -n 1 ${refreshTwo}`]:
        `${refreshTwo} ${refreshOne} ${mainTwo} ${"2".repeat(40)}` }),
      /advanced beyond an exact protected-main refresh chain/,
    ],
    [
      "discontinuous first-parent chain",
      values => {
        const foreign = "3".repeat(40);
        return {
          ...values,
          [`rev-list --parents -n 1 ${refreshTwo}`]:
            `${refreshTwo} ${foreign} ${mainTwo}`,
          [`merge-base --is-ancestor ${mainTwo} origin/main`]: "",
          [`merge-tree --write-tree --no-messages ${foreign} ${mainTwo}`]:
            treeTwo,
          [`rev-list --parents -n 1 ${foreign}`]: `${foreign} ${delivered}`,
        };
      },
      /advanced beyond an exact protected-main refresh chain/,
    ],
    [
      "foreign main parent",
      values => ({ ...values, [`merge-base --is-ancestor ${mainTwo} origin/main`]:
        new Error("not an ancestor") }),
      /not an ancestor/,
    ],
    [
      "altered merge tree",
      values => ({ ...values, [`rev-parse ${refreshTwo}^{tree}`]:
        "4".repeat(40) }),
      /not equivalent to its exact parent merge/,
    ],
  ]) {
    await t.test(name, () => {
      const values = mutate(createValues());
      assert.throws(() => verifyProtectedMainRefreshChain({
        expectedHeadSha: delivered,
        observedHeadSha: refreshTwo,
        gitText: createGitText(values),
      }), error);
    });
  }
});

function createValues() {
  return {
    [`rev-list --parents -n 1 ${refreshTwo}`]:
      `${refreshTwo} ${refreshOne} ${mainTwo}`,
    [`merge-base --is-ancestor ${mainTwo} origin/main`]: "",
    [`merge-tree --write-tree --no-messages ${refreshOne} ${mainTwo}`]:
      treeTwo,
    [`rev-parse ${refreshTwo}^{tree}`]: treeTwo,
    [`rev-list --parents -n 1 ${refreshOne}`]:
      `${refreshOne} ${delivered} ${mainOne}`,
    [`merge-base --is-ancestor ${mainOne} origin/main`]: "",
    [`merge-tree --write-tree --no-messages ${delivered} ${mainOne}`]:
      treeOne,
    [`rev-parse ${refreshOne}^{tree}`]: treeOne,
  };
}

function createGitText(overrides = createValues()) {
  return args => {
    const key = args.join(" ");
    if (!(key in overrides)) throw new Error(`unexpected git command: ${key}`);
    const value = overrides[key];
    if (value instanceof Error) throw value;
    return value;
  };
}
