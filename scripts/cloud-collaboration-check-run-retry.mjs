const UNRELATED_HISTORY_FRAGMENT = "refusing to merge unrelated histories";

export function protectedRefreshUnshallowArguments(pullRequestNumber) {
  if (!Number.isInteger(pullRequestNumber) || pullRequestNumber <= 0) {
    throw new Error("Protected-refresh history recovery requires a positive pull-request number.");
  }
  return [
    "fetch",
    "--no-tags",
    "--unshallow",
    "origin",
    "+refs/heads/main:refs/remotes/origin/main",
    `+refs/pull/${pullRequestNumber}/head:refs/remotes/pull/${pullRequestNumber}/head`,
  ];
}

export function runVerificationWithShallowRecovery({
  verify,
  isShallowRepository,
  unshallowRepository,
}) {
  requireFunction(verify, "verify");
  requireFunction(isShallowRepository, "isShallowRepository");
  requireFunction(unshallowRepository, "unshallowRepository");

  const first = verify();
  if (!isUnrelatedHistoryFailure(first)) return first;
  if (!isShallowRepository()) return first;
  if (unshallowRepository() !== true) return first;
  return verify();
}

function isUnrelatedHistoryFailure(attempt) {
  if (attempt?.child?.status === 0 || attempt?.result?.ok === true) return false;
  const message = String(attempt?.result?.error?.message || "");
  return message.includes(UNRELATED_HISTORY_FRAGMENT);
}

function requireFunction(value, label) {
  if (typeof value !== "function") {
    throw new Error(`Shallow verification recovery requires ${label}.`);
  }
}
