export function readOwnershipPullRequest({ url, branch, ghText, requireOpen = true }) {
  if (!url || !branch) throw new Error("Ownership pull request state requires an exact URL and branch.");
  const pullRequest = JSON.parse(ghText([
    "pr", "view", url, "--json",
    "id,url,state,isDraft,headRefName,headRefOid,headRepository,baseRefName,baseRefOid,body",
  ]));
  if (pullRequest?.url !== url || pullRequest.headRefName !== branch || pullRequest.baseRefName !== "main") {
    throw new Error(`Ownership pull request ${url} does not match ${branch} -> main.`);
  }
  if (requireOpen && pullRequest.state !== "OPEN") throw new Error(`Ownership pull request ${url} is not open.`);
  if (typeof pullRequest.isDraft !== "boolean") throw new Error(`Ownership pull request ${url} has no exact draft state.`);
  return pullRequest;
}

export function waitForOwnershipPullRequestHead({
  url,
  branch,
  expectedHeadSha,
  ghText,
  requireOpen = true,
  attempts = 30,
  intervalMs = 500,
  wait = waitSynchronously,
}) {
  if (!/^[0-9a-f]{40}$/u.test(String(expectedHeadSha || ""))) {
    throw new Error("Ownership pull request synchronization requires an exact head SHA.");
  }
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("Ownership pull request synchronization attempts must be a positive integer.");
  }

  let pullRequest = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    pullRequest = readOwnershipPullRequest({ url, branch, ghText, requireOpen });
    if (pullRequest.headRefOid === expectedHeadSha) return pullRequest;
    if (attempt < attempts) wait(intervalMs);
  }
  throw new Error(
    `Ownership pull request ${url} did not synchronize to ${expectedHeadSha}; received ${pullRequest?.headRefOid || "missing"}.`,
  );
}

export function requireOwnershipPullRequestDraft({ expectedDraft, ...input }) {
  const pullRequest = readOwnershipPullRequest(input);
  if (pullRequest.isDraft !== expectedDraft) {
    throw new Error(`Ownership pull request ${pullRequest.url} must be ${expectedDraft ? "draft" : "ready for review"}.`);
  }
  return pullRequest;
}

function waitSynchronously(milliseconds) {
  const signal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  Atomics.wait(signal, 0, 0, milliseconds);
}
