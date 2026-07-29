import { parseWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";

export const AUTO_DELIVERY_LABEL = "agentic/auto-delivery";
export const AUTO_DELIVERY_CONFLICT_LABEL = "automerge/conflict";

/**
 * Accept only the exact, reviewed head that an immutable task lease explicitly
 * authorized for protected auto-delivery. A label is merely the workflow wake
 * signal; it never authorizes a PR on its own.
 */
export function isAuthorizedAutoDeliveryPullRequest(pull, repository) {
  if (!pull || pull.draft || pull.base?.ref !== "main") return false;
  if (pull.head?.repo?.full_name !== repository) return false;
  if (!hasLabel(pull, AUTO_DELIVERY_LABEL) || hasLabel(pull, AUTO_DELIVERY_CONFLICT_LABEL)) return false;

  let lease;
  try {
    lease = parseWriterLeasePullRequestBody(pull.body);
  } catch {
    return false;
  }
  return Boolean(
    lease &&
    lease.status === "review_ready" &&
    lease.autoDelivery === true &&
    lease.runtimeRequired === true &&
    lease.branch === pull.head?.ref &&
    lease.reviewHeadSha === pull.head?.sha,
  );
}

function hasLabel(pull, expected) {
  return Array.isArray(pull.labels) && pull.labels.some(label => label?.name === expected);
}
