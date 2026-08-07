import { renderProtectedHeadRefreshCommitMessage } from "./protected-head-refresh-projection.mjs";
import {
  MAX_REFRESH_HOPS,
  PROTECTED_HEAD_REFRESH_BOT_EMAIL,
  PROTECTED_HEAD_REFRESH_BOT_NAME,
  PROTECTED_MAIN_REFRESH_CHAIN_SCHEMA,
  PROTECTED_MAIN_REFRESH_SCHEMA,
  RECEIPT_STEPS,
  commitHeaderLines,
  requireCommitTimestamp,
  requireDigest,
  requireExactText,
  requireNullableTextJson,
  requireSha,
  stripGitCommandLineFeed,
} from "./protected-head-refresh-shared.mjs";

export function createProtectedHeadRefreshCandidate({
  observedHeadSha,
  targetMainSha,
  operationId,
  gitText,
  commitTree,
}) {
  requireSha(observedHeadSha, "Protected-head refresh candidate first parent");
  requireSha(targetMainSha, "Protected-head refresh candidate second parent");
  requireDigest(operationId, "Protected-head refresh candidate operation ID");
  if (typeof gitText !== "function" || typeof commitTree !== "function") {
    throw new Error("Protected-head refresh candidate requires exact Git object adapters.");
  }
  const treeSha = requireSha(
    gitText([
      "merge-tree", "--write-tree", "--no-messages",
      observedHeadSha, targetMainSha,
    ]).trim().split(/\s+/u)[0],
    "Protected-head refresh candidate merge tree",
  );
  const commitDate = gitText([
    "show", "-s", "--format=%cI", observedHeadSha,
  ]).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/u.test(commitDate)) {
    throw new Error("Protected-head refresh parent timestamp is not exact ISO-8601.");
  }
  const message = renderProtectedHeadRefreshCommitMessage({
    operationId,
    observedHeadSha,
    targetMainSha,
  });
  const candidateSha = requireSha(commitTree(Object.freeze({
    treeSha,
    parents: Object.freeze([observedHeadSha, targetMainSha]),
    message,
    authorName: PROTECTED_HEAD_REFRESH_BOT_NAME,
    authorEmail: PROTECTED_HEAD_REFRESH_BOT_EMAIL,
    authorDate: commitDate,
    committerName: PROTECTED_HEAD_REFRESH_BOT_NAME,
    committerEmail: PROTECTED_HEAD_REFRESH_BOT_EMAIL,
    committerDate: commitDate,
  })), "Protected-head refresh deterministic candidate");
  return verifyProtectedHeadRefreshCandidate({
    candidateSha,
    observedHeadSha,
    targetMainSha,
    operationId,
    gitText,
  });
}

export function verifyProtectedHeadRefreshCandidate({
  candidateSha,
  observedHeadSha,
  targetMainSha,
  operationId,
  gitText,
}) {
  requireSha(candidateSha, "Protected-head refresh candidate");
  requireSha(observedHeadSha, "Protected-head refresh candidate first parent");
  requireSha(targetMainSha, "Protected-head refresh candidate second parent");
  requireDigest(operationId, "Protected-head refresh candidate operation ID");
  if (typeof gitText !== "function") {
    throw new Error("Protected-head refresh candidate requires a Git object reader.");
  }
  const expectedTreeSha = requireSha(
    gitText([
      "merge-tree",
      "--write-tree",
      "--no-messages",
      observedHeadSha,
      targetMainSha,
    ]).trim().split(/\s+/u)[0],
    "Protected-head refresh candidate merge tree",
  );
  const observedCommit = gitText(["cat-file", "commit", observedHeadSha]);
  const timestamp = requireCommitTimestamp(
    commitHeaderLines(observedCommit).find(line => line.startsWith("committer ")),
    "Protected-head refresh observed parent committer",
  );
  const rawCandidate = gitText(["cat-file", "commit", candidateSha]);
  const separator = rawCandidate.indexOf("\n\n");
  if (separator < 0) {
    throw new Error("Protected-head refresh candidate commit object is malformed.");
  }
  const headers = rawCandidate.slice(0, separator).split("\n");
  const body = rawCandidate.slice(separator + 2);
  const expectedIdentity =
    `${PROTECTED_HEAD_REFRESH_BOT_NAME} <${PROTECTED_HEAD_REFRESH_BOT_EMAIL}> ${timestamp}`;
  const expectedHeaders = [
    `tree ${expectedTreeSha}`,
    `parent ${observedHeadSha}`,
    `parent ${targetMainSha}`,
    `author ${expectedIdentity}`,
    `committer ${expectedIdentity}`,
  ];
  if (
    headers.length !== expectedHeaders.length
    || headers.some((header, index) => header !== expectedHeaders[index])
  ) {
    throw new Error(
      "Protected-head refresh candidate parents, tree, identity, or timestamp are not deterministic.",
    );
  }
  const message = renderProtectedHeadRefreshCommitMessage({
    operationId,
    observedHeadSha,
    targetMainSha,
  });
  if (body !== message) {
    throw new Error("Protected-head refresh candidate commit message is not exact.");
  }
  return Object.freeze({
    candidateSha,
    observedHeadSha,
    targetMainSha,
    operationId,
    treeSha: expectedTreeSha,
    timestamp,
  });
}

export function verifyProtectedHeadRefreshMergedCommit({
  mergeCommitSha,
  candidateSha,
  targetMainSha,
  commitTitle,
  commitMessageJson,
  gitText,
  mainRef = "refs/remotes/origin/main",
}) {
  requireSha(mergeCommitSha, "Protected-head refresh merged commit");
  requireSha(candidateSha, "Protected-head refresh merged candidate");
  requireSha(targetMainSha, "Protected-head refresh merged parent");
  const title = requireExactText(commitTitle, "Protected-head refresh merged subject");
  const messageJson = requireNullableTextJson(
    commitMessageJson,
    "Protected-head refresh merged message",
  );
  if (typeof gitText !== "function") {
    throw new Error("Protected-head refresh merged commit requires a Git object reader.");
  }
  const parents = gitText(["rev-list", "--parents", "-n", "1", mergeCommitSha])
    .trim().split(/\s+/u);
  if (parents.length !== 2 || parents[0] !== mergeCommitSha || parents[1] !== targetMainSha) {
    throw new Error("Protected-head refresh merge is not an exact one-parent target-main squash.");
  }
  const mergedTree = requireSha(
    gitText(["rev-parse", `${mergeCommitSha}^{tree}`]).trim(),
    "Protected-head refresh merged tree",
  );
  const candidateTree = requireSha(
    gitText(["rev-parse", `${candidateSha}^{tree}`]).trim(),
    "Protected-head refresh candidate tree",
  );
  if (mergedTree !== candidateTree) {
    throw new Error("Protected-head refresh merged tree differs from the candidate tree.");
  }
  if (stripGitCommandLineFeed(
    gitText(["show", "-s", "--format=%s", mergeCommitSha]),
  ) !== title) {
    throw new Error("Protected-head refresh merged subject differs from the bound title.");
  }
  const boundMessage = JSON.parse(messageJson);
  if (
    boundMessage !== null
    && stripGitCommandLineFeed(
      gitText(["show", "-s", "--format=%b", mergeCommitSha]),
    ) !== boundMessage
  ) {
    throw new Error("Protected-head refresh merged body differs from the bound message.");
  }
  gitText(["merge-base", "--is-ancestor", mergeCommitSha, mainRef]);
  return Object.freeze({
    mergeCommitSha,
    candidateSha,
    targetMainSha,
    treeSha: mergedTree,
    commitTitle: title,
    commitMessageJson: messageJson,
  });
}

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
    left.refreshedHeadSha !== right.deliveredHeadSha
    || leftSteps.at(-1)?.refreshedHeadSha !== rightSteps[0]?.previousHeadSha
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
    receipt.schema !== PROTECTED_MAIN_REFRESH_CHAIN_SCHEMA
    || !Array.isArray(receipt.refreshes)
    || receipt.refreshes.length < 2
  ) {
    throw new Error("Protected-main refresh receipt is malformed.");
  }
  return receipt.refreshes;
}
