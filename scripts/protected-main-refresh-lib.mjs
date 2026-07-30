export const PROTECTED_MAIN_REFRESH_SCHEMA =
  "agentic-protected-main-refresh/v1";
export const PROTECTED_MAIN_REFRESH_CHAIN_SCHEMA =
  "agentic-protected-main-refresh-chain/v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const MAX_REFRESH_HOPS = 256;
const RECEIPT_STEPS = Symbol("protected-main-refresh-steps");

export function verifyProtectedMainRefreshChain({
  expectedHeadSha,
  observedHeadSha,
  gitText,
  mainRef = "origin/main",
}) {
  requireSha(expectedHeadSha, "Protected-main refresh expected head");
  requireSha(observedHeadSha, "Protected-main refresh observed head");
  if (expectedHeadSha === observedHeadSha) return null;

  const reverseSteps = [];
  const visited = new Set();
  let currentHeadSha = observedHeadSha;
  while (currentHeadSha !== expectedHeadSha) {
    if (visited.has(currentHeadSha) || reverseSteps.length >= MAX_REFRESH_HOPS) {
      throw new Error("Protected pull-request head exceeded the bounded exact refresh chain.");
    }
    visited.add(currentHeadSha);
    const parents = gitText([
      "rev-list",
      "--parents",
      "-n",
      "1",
      currentHeadSha,
    ]).trim().split(/\s+/);
    if (parents.length !== 3 || parents[0] !== currentHeadSha) {
      throw new Error(
        "Protected pull-request head advanced beyond an exact protected-main refresh chain.",
      );
    }
    const previousHeadSha = parents[1];
    const mainParentSha = parents[2];
    requireSha(previousHeadSha, "Protected-main refresh first parent");
    requireSha(mainParentSha, "Protected-main refresh main parent");
    gitText(["merge-base", "--is-ancestor", mainParentSha, mainRef]);

    const expectedTreeSha = gitText([
      "merge-tree",
      "--write-tree",
      "--no-messages",
      previousHeadSha,
      mainParentSha,
    ]).trim().split(/\s+/)[0];
    requireSha(expectedTreeSha, "Protected-main refresh equivalent tree");
    const observedTreeSha = gitText([
      "rev-parse",
      `${currentHeadSha}^{tree}`,
    ]).trim();
    if (observedTreeSha !== expectedTreeSha) {
      throw new Error(
        "Protected-main refresh tree is not equivalent to its exact parent merge.",
      );
    }
    reverseSteps.push({
      previousHeadSha,
      refreshedHeadSha: currentHeadSha,
      mainParentSha,
      treeSha: observedTreeSha,
    });
    currentHeadSha = previousHeadSha;
  }

  return renderRefreshReceipt({
    deliveredHeadSha: expectedHeadSha,
    refreshes: reverseSteps.reverse(),
  });
}

export function appendProtectedMainRefresh(left, right) {
  if (!left) return right;
  if (!right) return left;
  const leftSteps = receiptSteps(left);
  const rightSteps = receiptSteps(right);
  if (
    left.refreshedHeadSha !== right.deliveredHeadSha ||
    leftSteps.at(-1)?.refreshedHeadSha !== rightSteps[0]?.previousHeadSha
  ) {
    throw new Error("Protected-main refresh receipts do not form one exact chain.");
  }
  return renderRefreshReceipt({
    deliveredHeadSha: left.deliveredHeadSha,
    refreshes: [...leftSteps, ...rightSteps],
  });
}

export function protectedMainRefreshHeads(receipt) {
  if (!receipt) return [];
  return [
    receipt.deliveredHeadSha,
    ...receiptSteps(receipt).map(step => step.refreshedHeadSha),
  ];
}

function renderRefreshReceipt({ deliveredHeadSha, refreshes }) {
  if (refreshes.length === 1) {
    const receipt = {
      schema: PROTECTED_MAIN_REFRESH_SCHEMA,
      deliveredHeadSha,
      refreshedHeadSha: refreshes[0].refreshedHeadSha,
      mainParentSha: refreshes[0].mainParentSha,
    };
    Object.defineProperty(receipt, RECEIPT_STEPS, {
      value: refreshes,
      enumerable: false,
    });
    return receipt;
  }
  return {
    schema: PROTECTED_MAIN_REFRESH_CHAIN_SCHEMA,
    deliveredHeadSha,
    refreshedHeadSha: refreshes.at(-1).refreshedHeadSha,
    refreshCount: refreshes.length,
    refreshes,
  };
}

function receiptSteps(receipt) {
  if (Array.isArray(receipt[RECEIPT_STEPS])) {
    return receipt[RECEIPT_STEPS];
  }
  if (receipt.schema === PROTECTED_MAIN_REFRESH_SCHEMA) {
    return [{
      previousHeadSha: receipt.deliveredHeadSha,
      refreshedHeadSha: receipt.refreshedHeadSha,
      mainParentSha: receipt.mainParentSha,
    }];
  }
  if (
    receipt.schema !== PROTECTED_MAIN_REFRESH_CHAIN_SCHEMA ||
    !Array.isArray(receipt.refreshes) ||
    receipt.refreshes.length < 2
  ) {
    throw new Error("Protected-main refresh receipt is malformed.");
  }
  return receipt.refreshes;
}

function requireSha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} must be an exact lowercase 40-character Git SHA.`);
  }
}
