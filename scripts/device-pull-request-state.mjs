export function readOwnershipPullRequest({ url, branch, ghText, requireOpen = true }) {
  if (!url || !branch) throw new Error("Ownership pull request state requires an exact URL and branch.");
  const pullRequest = JSON.parse(ghText([
    "pr", "view", url, "--json", "url,state,isDraft,headRefName,baseRefName,body",
  ]));
  if (pullRequest?.url !== url || pullRequest.headRefName !== branch || pullRequest.baseRefName !== "main") {
    throw new Error(`Ownership pull request ${url} does not match ${branch} -> main.`);
  }
  if (requireOpen && pullRequest.state !== "OPEN") throw new Error(`Ownership pull request ${url} is not open.`);
  if (typeof pullRequest.isDraft !== "boolean") throw new Error(`Ownership pull request ${url} has no exact draft state.`);
  return pullRequest;
}

export function requireOwnershipPullRequestDraft({ expectedDraft, ...input }) {
  const pullRequest = readOwnershipPullRequest(input);
  if (pullRequest.isDraft !== expectedDraft) {
    throw new Error(`Ownership pull request ${pullRequest.url} must be ${expectedDraft ? "draft" : "ready for review"}.`);
  }
  return pullRequest;
}
