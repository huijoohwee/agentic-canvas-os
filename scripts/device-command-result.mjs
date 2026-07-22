export const DEVICE_COMMAND_RESULT_SCHEMA = "agentic-device-command-result/v1";

const LEASE_FIELDS = [
  "schema",
  "status",
  "epoch",
  "sessionId",
  "device",
  "scope",
  "branch",
  "worktreePath",
  "baseSha",
  "fenceSha",
  "pullRequestUrl",
  "reviewHeadSha",
  "deliveryHeadSha",
  "parkHeadSha",
  "parkStashRef",
  "acquiredAt",
  "heartbeatAt",
  "expiresAt",
];

export function createDeviceCommandResult({ action, repoRoot, worktreePath, branch, lease, result, provisioned = false, pullRequestIsDraft = null }) {
  const normalizedLease = projectLease(lease);
  const resolvedBranch = branch || normalizedLease?.branch || result?.branch || "";
  const response = {
    schema: DEVICE_COMMAND_RESULT_SCHEMA,
    ok: true,
    action,
    status: resolveStatus({ action, branch: resolvedBranch, lease: normalizedLease }),
    repoRoot,
    branch: resolvedBranch,
    worktreePath,
    provisioned,
    pullRequest: projectPullRequest(normalizedLease?.pullRequestUrl, pullRequestIsDraft),
    lease: normalizedLease,
  };
  if (action === "park") {
    response.headSha = result?.headSha || null;
    response.stashRef = result?.stashRef || null;
  }
  return response;
}

export function createDeviceCommandError({ action, repoRoot = null, worktreePath = null, error }) {
  return {
    schema: DEVICE_COMMAND_RESULT_SCHEMA,
    ok: false,
    action: action || null,
    status: "error",
    repoRoot,
    worktreePath,
    error: {
      code: "device_command_failed",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function projectLease(lease) {
  if (!lease) return null;
  return Object.fromEntries(LEASE_FIELDS.map(field => [field, lease[field] ?? null]));
}

function projectPullRequest(url, isDraft) {
  if (!url) return null;
  const match = String(url).match(/\/pull\/(\d+)(?:[/?#]|$)/);
  return { url, number: match ? Number(match[1]) : null, isDraft: typeof isDraft === "boolean" ? isDraft : null };
}

function resolveStatus({ action, branch, lease }) {
  if (lease?.status) return lease.status;
  if (action === "park") return branch === "main" ? "main" : "detached";
  return "ok";
}
