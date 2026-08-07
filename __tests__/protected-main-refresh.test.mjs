import assert from "node:assert/strict";
import test from "node:test";

import {
  appendProtectedMainRefresh,
  PROTECTED_MAIN_REFRESH_CHAIN_SCHEMA,
  PROTECTED_MAIN_REFRESH_SCHEMA,
  protectedMainRefreshHeads,
  verifyProtectedMainRefreshChain,
} from "../scripts/protected-main-refresh-lib.mjs";
import {
  candidate,
  createChainGitText,
  createChainValues,
  delivered,
  mainOne,
  refreshTwo,
  targetMain,
  treeOne,
  treeTwo,
} from "./protected-head-refresh-fixtures.mjs";

test("verifies a nonadjacent tree-equivalent protected-main refresh chain", () => {
  const receipt = verifyProtectedMainRefreshChain({
    expectedHeadSha: delivered,
    observedHeadSha: refreshTwo,
    gitText: createChainGitText(),
  });

  assert.equal(receipt.schema, PROTECTED_MAIN_REFRESH_CHAIN_SCHEMA);
  assert.equal(receipt.refreshCount, 2);
  assert.deepEqual(protectedMainRefreshHeads(receipt), [delivered, candidate, refreshTwo]);
  assert.deepEqual(receipt.refreshes, [
    {
      previousHeadSha: delivered,
      refreshedHeadSha: candidate,
      mainParentSha: mainOne,
      treeSha: treeOne,
    },
    {
      previousHeadSha: candidate,
      refreshedHeadSha: refreshTwo,
      mainParentSha: targetMain,
      treeSha: treeTwo,
    },
  ]);
});

test("preserves one-hop receipts and appends only an exact suffix", () => {
  const gitText = createChainGitText();
  const first = verifyProtectedMainRefreshChain({
    expectedHeadSha: delivered,
    observedHeadSha: candidate,
    gitText,
  });
  const second = verifyProtectedMainRefreshChain({
    expectedHeadSha: candidate,
    observedHeadSha: refreshTwo,
    gitText,
  });
  assert.deepEqual(first, {
    schema: PROTECTED_MAIN_REFRESH_SCHEMA,
    deliveredHeadSha: delivered,
    refreshedHeadSha: candidate,
    mainParentSha: mainOne,
  });
  assert.deepEqual(protectedMainRefreshHeads(appendProtectedMainRefresh(first, second)), [
    delivered,
    candidate,
    refreshTwo,
  ]);
  assert.throws(
    () => appendProtectedMainRefresh(second, first),
    /do not form one exact chain/u,
  );
});

test("rejects authored, octopus, foreign-main, and altered-tree refreshes", async t => {
  for (const [name, mutate, error] of [
    [
      "authored",
      values => ({
        ...values,
        [`rev-list --parents -n 1 ${refreshTwo}`]: `${refreshTwo} ${candidate}`,
      }),
      /advanced beyond/u,
    ],
    [
      "octopus",
      values => ({
        ...values,
        [`rev-list --parents -n 1 ${refreshTwo}`]:
          `${refreshTwo} ${candidate} ${targetMain} ${mainOne}`,
      }),
      /advanced beyond/u,
    ],
    [
      "foreign main",
      values => ({
        ...values,
        [`merge-base --is-ancestor ${targetMain} origin/main`]: new Error("not ancestor"),
      }),
      /not ancestor/u,
    ],
    [
      "altered tree",
      values => ({
        ...values,
        [`rev-parse ${refreshTwo}^{tree}`]: "6".repeat(40),
      }),
      /not equivalent/u,
    ],
  ]) {
    await t.test(name, () => assert.throws(() => verifyProtectedMainRefreshChain({
      expectedHeadSha: delivered,
      observedHeadSha: refreshTwo,
      gitText: createChainGitText(mutate(createChainValues())),
    }), error));
  }
});
