import path from "node:path";

const ACTIVE_LEASE_STATUSES = new Set(["active", "review_ready", "delivery"]);
const WARNING_EXPIRY_WINDOW_MS = 15 * 60_000;

export function auditLaneLifecycleRisks({
  report,
  now = new Date(),
  expiryWarningWindowMs = WARNING_EXPIRY_WINDOW_MS,
} = {}) {
  if (report?.schema !== "agentic-worktree-lifecycle-report/v1" || !Array.isArray(report.worktrees)) {
    throw new Error("Lane lifecycle audit requires an agentic worktree lifecycle report.");
  }
  const findings = report.worktrees.flatMap(worktree => inspectWorktree({
    repository: report.repository,
    worktree,
    now,
    expiryWarningWindowMs,
  }));
  const hasFailure = findings.some(finding => finding.level === "FAIL");
  const hasWarning = findings.some(finding => finding.level === "WARN");
  return Object.freeze({
    ok: !hasFailure,
    level: hasFailure ? "FAIL" : hasWarning ? "WARN" : "PASS",
    detail: findings.length === 0 ? "no lane expiry or projection drift detected" : `${findings.length} finding${findings.length === 1 ? "" : "s"}`,
    findings,
  });
}

function inspectWorktree({ repository, worktree, now, expiryWarningWindowMs }) {
  const findings = [];
  const lease = worktree.lease;
  if (!lease) return findings;
  const activeLease = ACTIVE_LEASE_STATUSES.has(lease.status);
  const label = path.relative(repository, worktree.path) || ".";
  const branchRef = worktree.branch || null;
  const expectedBranchRef = lease.branch ? `refs/heads/${lease.branch}` : null;

  if (branchRef && expectedBranchRef && branchRef !== expectedBranchRef) {
    findings.push(createFinding({
      level: "FAIL",
      code: "branch-projection-mismatch",
      worktree,
      summary: `${label} is attached to ${branchRef}, not lease branch ${expectedBranchRef}`,
      action: "Realign the worktree with its lease before any more mutation.",
    }));
  }

  if (worktree.state === "review-required" && activeLease) {
    findings.push(createFinding({
      level: "WARN",
      code: "review-required-transition-drift",
      worktree,
      summary: `${label} fell to review-required while the latest lease still reports ${lease.status}`,
      action: "Run the repository-owned recovery or completion path before the lane drifts further.",
    }));
  }

  if (lease.pullRequestProjectionRepair?.status === "repairing") {
    findings.push(createFinding({
      level: "WARN",
      code: "pull-request-projection-repair-pending",
      worktree,
      summary: `${label} still carries an in-progress pull-request projection repair marker`,
      action: `Finish the repair with device:heartbeat --repair-pr-projection from ${worktree.path}.`,
    }));
  }

  const projectionHead = lease.cloudAuthority?.laneRevision || null;
  if (projectionHead && worktree.head && projectionHead !== worktree.head) {
    findings.push(createFinding({
      level: "WARN",
      code: "lane-revision-drift",
      worktree,
      summary: `${label} HEAD ${shortSha(worktree.head)} no longer matches cloud lane revision ${shortSha(projectionHead)}`,
      action: "Repair or rebind the lane before review or publish advances.",
    }));
  }

  const effectiveExpiry = computeEffectiveExpiry(lease);
  if (!effectiveExpiry || !activeLease) return findings;
  const remainingMs = effectiveExpiry.getTime() - now.getTime();
  if (remainingMs <= 0) {
    findings.push(createFinding({
      level: "FAIL",
      code: "lease-expired",
      worktree,
      summary: `${label} expired at ${effectiveExpiry.toISOString()}`,
      action: "Use the repository recovery path immediately; do not keep mutating this lane.",
    }));
  } else if (remainingMs <= expiryWarningWindowMs) {
    findings.push(createFinding({
      level: "WARN",
      code: "lease-expiring-soon",
      worktree,
      summary: `${label} expires in ${formatDuration(remainingMs)} at ${effectiveExpiry.toISOString()}`,
      action: "Heartbeat, review, park, or hand off this lane before the authority window closes.",
    }));
  }
  return findings;
}

function computeEffectiveExpiry(lease) {
  const localExpiry = parseInstant(lease?.expiresAt);
  const cloudExpiry = parseInstant(lease?.cloudAuthority?.expiresAt);
  if (localExpiry && cloudExpiry) {
    return new Date(Math.min(localExpiry.getTime(), cloudExpiry.getTime()));
  }
  return localExpiry || cloudExpiry || null;
}

function parseInstant(value) {
  const epoch = Date.parse(String(value || ""));
  if (!Number.isFinite(epoch)) return null;
  return new Date(epoch);
}

function createFinding({ level, code, worktree, summary, action }) {
  const lease = worktree.lease || {};
  const cloudAuthority = lease.cloudAuthority || {};
  return Object.freeze({
    level,
    code,
    path: worktree.path,
    branch: worktree.branch || null,
    leaseStatus: lease.status || null,
    sessionId: lease.sessionId || null,
    pullRequestUrl: lease.pullRequestUrl || null,
    leaseEpoch: Number.isInteger(lease.epoch) ? lease.epoch : null,
    claimId: cloudAuthority.claimId || null,
    workItemId: cloudAuthority.workItemId || null,
    transitionCounter: Number.isInteger(cloudAuthority.transitionCounter)
      ? cloudAuthority.transitionCounter
      : null,
    summary,
    action,
  });
}

function formatDuration(milliseconds) {
  const totalMinutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function shortSha(value) {
  return String(value || "").slice(0, 12);
}
