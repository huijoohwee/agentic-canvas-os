import path from "node:path";

export const WORKSPACE_LANE_SCHEMA = "agentic-workspace-lane/v1";
export const WORKSPACE_PARALLELISM_REPORT_SCHEMA = "agentic-workspace-parallelism-report/v1";

/**
 * Operation classes that can destroy work another session is holding.
 * Every class is denied by default; a session may only proceed on a lane it owns
 * that is already clean and already has a recovery reference.
 */
export const DESTRUCTIVE_OPERATION_CLASSES = Object.freeze({
  workingTreeReset: "discards tracked working-tree and index state",
  untrackedRemoval: "removes untracked and ignored files that were never committed",
  forcedCheckout: "overwrites working-tree files without merging",
  historyRewrite: "rewrites or discards commits other sessions may depend on",
  laneRemoval: "removes a branch or worktree lane and its claim",
  objectPruning: "prunes unreachable objects that are the last copy of lost work",
  blindIntegration: "moves a lane to a remote tip while uncommitted work is present",
});

const DESTRUCTIVE_MATCHERS = Object.freeze([
  { class: "workingTreeReset", match: (a) => a[0] === "reset" && a.some((t) => ["--hard", "--merge", "--keep"].includes(t)) },
  { class: "untrackedRemoval", match: (a) => a[0] === "clean" && a.some((t) => /^-[a-z]*[fdx]/.test(t)) },
  { class: "forcedCheckout", match: (a) => ["checkout", "switch", "restore"].includes(a[0]) && a.some((t) => ["-f", "--force", "--worktree", "--discard-changes"].includes(t)) },
  { class: "historyRewrite", match: (a) => (a[0] === "push" && a.some((t) => ["-f", "--force", "--force-with-lease", "--mirror"].includes(t))) || (a[0] === "rebase" && !a.includes("--abort")) || a[0] === "filter-branch" },
  { class: "laneRemoval", match: (a) => (a[0] === "branch" && a.includes("-D")) || (a[0] === "worktree" && a[1] === "remove" && a.some((t) => ["-f", "--force"].includes(t))) },
  { class: "objectPruning", match: (a) => (a[0] === "gc" && a.some((t) => t.startsWith("--prune"))) || (a[0] === "reflog" && a[1] === "expire") || (a[0] === "prune" && !a.includes("--dry-run")) },
  { class: "blindIntegration", match: (a) => ["pull", "merge"].includes(a[0]) && !a.includes("--no-ff") },
]);

/**
 * Classify one git invocation without executing it.
 * Unknown operations are non-destructive; the catalog is explicit, not heuristic.
 */
export function classifyGitOperation(argv) {
  const tokens = (Array.isArray(argv) ? argv : String(argv || "").split(/\s+/))
    .map((token) => String(token).trim())
    .filter(Boolean);
  const args = tokens[0] === "git" ? tokens.slice(1) : tokens;
  if (args.length === 0) throw new Error("Operation classification requires a git invocation.");
  for (const matcher of DESTRUCTIVE_MATCHERS) {
    if (matcher.match(args)) {
      return Object.freeze({
        operation: args.join(" "),
        destructive: true,
        class: matcher.class,
        reason: DESTRUCTIVE_OPERATION_CLASSES[matcher.class],
      });
    }
  }
  return Object.freeze({ operation: args.join(" "), destructive: false, class: null, reason: null });
}

function normalizeLane(lane, index) {
  const repository = String(lane?.repository || "").trim();
  const worktree = String(lane?.worktree || "").trim();
  const branch = String(lane?.branch || "").trim();
  const session = String(lane?.session || "").trim();
  const scope = String(lane?.scope || "").trim();
  if (!repository) throw new Error(`Lane ${index} is missing a repository.`);
  if (!worktree) throw new Error(`Lane ${index} in ${repository} is missing a worktree path.`);
  if (!session) throw new Error(`Lane ${index} in ${repository} is missing a session owner.`);
  return Object.freeze({
    schema: WORKSPACE_LANE_SCHEMA,
    repository,
    worktree: path.normalize(worktree),
    branch: branch || null,
    session,
    scope: scope || null,
    dirtyTrackedPaths: Number(lane?.dirtyTrackedPaths ?? 0),
    untrackedPaths: Number(lane?.untrackedPaths ?? 0),
    recoveryRef: String(lane?.recoveryRef || "").trim() || null,
  });
}

export function laneKey(lane) {
  return `${lane.repository}::${lane.worktree}`;
}

export function laneIsDirty(lane) {
  return lane.dirtyTrackedPaths > 0 || lane.untrackedPaths > 0;
}

/**
 * Parallel work is permitted, and this is what makes it safe: one lane belongs to
 * exactly one session, one branch is checked out in exactly one worktree, and two
 * sessions never claim the same semantic scope inside one repository.
 */
export function assertWorkspaceLaneIsolation(lanes) {
  const normalized = (Array.isArray(lanes) ? lanes : []).map(normalizeLane);
  if (normalized.length === 0) throw new Error("Workspace parallelism requires at least one declared lane.");

  const sessionByLane = new Map();
  const laneByBranch = new Map();
  const laneByScope = new Map();

  for (const lane of normalized) {
    const key = laneKey(lane);
    const existingSession = sessionByLane.get(key);
    if (existingSession && existingSession !== lane.session) {
      throw new Error(`Worktree ${lane.worktree} is claimed by sessions ${existingSession} and ${lane.session}; one lane owns one session.`);
    }
    sessionByLane.set(key, lane.session);

    if (lane.branch) {
      const branchKey = `${lane.repository}::${lane.branch}`;
      const branchOwner = laneByBranch.get(branchKey);
      if (branchOwner && branchOwner !== lane.worktree) {
        throw new Error(`Branch ${lane.branch} in ${lane.repository} is active in ${branchOwner} and ${lane.worktree}; parallel lanes require distinct branches.`);
      }
      laneByBranch.set(branchKey, lane.worktree);
    }

    if (lane.scope) {
      const scopeKey = `${lane.repository}::${lane.scope}`;
      const scopeOwner = laneByScope.get(scopeKey);
      if (scopeOwner && scopeOwner !== lane.session) {
        throw new Error(`Scope ${lane.scope} in ${lane.repository} is claimed by sessions ${scopeOwner} and ${lane.session}; parallel work requires distinct semantic scopes.`);
      }
      laneByScope.set(scopeKey, lane.session);
    }
  }

  return Object.freeze(normalized);
}

/**
 * Fail closed before a destructive operation runs.
 * Denial order is deliberate: foreign ownership first, then unrecoverable work,
 * then a missing recovery reference. The caller never learns "it is fine" by default.
 */
export function assertNonDestructiveOperation({ operation, lane, session, lanes = [] }) {
  const classification = classifyGitOperation(operation);
  const target = normalizeLane(lane, 0);
  const actor = String(session || "").trim();
  if (!actor) throw new Error("Destructive-operation review requires the acting session id.");

  const siblings = (Array.isArray(lanes) ? lanes : []).map(normalizeLane);
  const foreignDirtyLanes = siblings.filter((candidate) => (
    candidate.session !== actor && laneIsDirty(candidate) && candidate.repository === target.repository
  ));

  if (!classification.destructive) {
    return Object.freeze({ ...classification, decision: "allow", lane: laneKey(target), session: actor });
  }

  if (target.session !== actor) {
    throw new Error(`Session ${actor} cannot run "${classification.operation}" on ${laneKey(target)}; lane is owned by ${target.session}.`);
  }

  if (foreignDirtyLanes.length > 0) {
    const names = foreignDirtyLanes.map((candidate) => `${laneKey(candidate)} (${candidate.session})`).join(", ");
    throw new Error(`"${classification.operation}" is refused: ${classification.reason}; uncommitted work is live in ${names}.`);
  }

  if (target.untrackedPaths > 0) {
    throw new Error(`"${classification.operation}" is refused: ${classification.reason}; ${target.untrackedPaths} untracked path(s) in ${laneKey(target)} have never been committed and would be unrecoverable.`);
  }

  if (target.dirtyTrackedPaths > 0 && !target.recoveryRef) {
    throw new Error(`"${classification.operation}" is refused: ${classification.reason}; ${laneKey(target)} has ${target.dirtyTrackedPaths} modified path(s) and no recovery reference.`);
  }

  return Object.freeze({
    ...classification,
    decision: "allow-with-recovery",
    lane: laneKey(target),
    session: actor,
    recoveryRef: target.recoveryRef,
  });
}

/**
 * Recovery reference contract: work leaves a session only through a durable ref.
 * A stash is explicitly not sufficient, because it is anonymous and lives outside
 * any lane claim.
 */
export function assertRecoveryReference({ lane, refs = [] }) {
  const target = normalizeLane(lane, 0);
  if (!laneIsDirty(target)) {
    return Object.freeze({ lane: laneKey(target), required: false, recoveryRef: null });
  }
  const available = new Set((Array.isArray(refs) ? refs : []).map((ref) => String(ref).trim()).filter(Boolean));
  if (!target.recoveryRef) {
    throw new Error(`${laneKey(target)} holds uncommitted work and declares no recovery reference.`);
  }
  if (target.recoveryRef.startsWith("refs/stash")) {
    throw new Error(`${laneKey(target)} declares a stash as its recovery reference; stashes are anonymous and are not a durable recovery point.`);
  }
  if (!available.has(target.recoveryRef)) {
    throw new Error(`${laneKey(target)} declares recovery reference ${target.recoveryRef}, which does not exist.`);
  }
  return Object.freeze({ lane: laneKey(target), required: true, recoveryRef: target.recoveryRef });
}

export function buildWorkspaceParallelismReport({ workspaceRoot, lanes, now = () => new Date() }) {
  const root = String(workspaceRoot || "").trim();
  if (!root) throw new Error("Workspace parallelism report requires a workspace root.");
  const isolated = assertWorkspaceLaneIsolation(lanes);
  const repositories = [...new Set(isolated.map((lane) => lane.repository))].sort();
  const sessions = [...new Set(isolated.map((lane) => lane.session))].sort();
  const atRisk = isolated
    .filter((lane) => lane.untrackedPaths > 0 || (lane.dirtyTrackedPaths > 0 && !lane.recoveryRef))
    .map((lane) => Object.freeze({
      lane: laneKey(lane),
      session: lane.session,
      dirtyTrackedPaths: lane.dirtyTrackedPaths,
      untrackedPaths: lane.untrackedPaths,
      recoveryRef: lane.recoveryRef,
    }));

  return Object.freeze({
    schema: WORKSPACE_PARALLELISM_REPORT_SCHEMA,
    workspaceRoot: path.normalize(root),
    generatedAt: now().toISOString(),
    repositories: Object.freeze(repositories),
    sessions: Object.freeze(sessions),
    lanes: isolated,
    parallelLanes: isolated.length,
    unrecoverableLanes: Object.freeze(atRisk),
    forbiddenOperationClasses: Object.freeze(Object.keys(DESTRUCTIVE_OPERATION_CLASSES)),
    ready: atRisk.length === 0,
  });
}
