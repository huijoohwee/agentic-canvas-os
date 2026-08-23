// Responsibility: Define the exact Knowgrph two-lane convergence adapter boundary.
import path from "node:path";

export const CONFIG_SCHEMA = "agentic-knowgrph-lane-convergence-adapter-config/v1";
export const ADAPTER_ID = "knowgrph-two-lane-convergence";
export const ADAPTER_VERSION = "1";
export const TARGET_STATE = "integrated-cleaned";

const NO_EFFECTS = Object.freeze({
  cloudMutation: false,
  providerMutation: false,
  localProjectionMutation: false,
  gitRefMutation: false,
  sourceMutation: false,
  integrationMutation: false,
  deploymentMutation: false,
  cleanupMutation: false,
});

export const ACTIONS = Object.freeze({
  reconcileAuthority: "reconcile-authority",
  integrateSource: "integrate-source",
  cleanupWorktree: "cleanup-worktree",
});

export const ACTION_EFFECTS = Object.freeze({
  [ACTIONS.reconcileAuthority]: effects({
    cloudMutation: true,
    localProjectionMutation: true,
  }),
  [ACTIONS.integrateSource]: effects({
    cloudMutation: true,
    providerMutation: true,
    localProjectionMutation: true,
    gitRefMutation: true,
    sourceMutation: true,
    integrationMutation: true,
  }),
  [ACTIONS.cleanupWorktree]: effects({ cleanupMutation: true }),
});

const SUBJECT_POLICIES = Object.freeze({
  "gemini-api-mainpanel-integration": Object.freeze({
    authorityRecovery: "none",
    commitRequired: false,
  }),
  "knowgrph-native-marketplace-layer": Object.freeze({
    authorityRecovery: "active-owned-dirt-reclaim",
    commitRequired: true,
  }),
});

export function describeKnowgrphLaneConvergenceAdapter() {
  return Object.freeze({
    id: ADAPTER_ID,
    version: ADAPTER_VERSION,
    actions: Object.freeze(Object.entries(ACTION_EFFECTS).map(([action, actionEffects]) =>
      Object.freeze({ action, effects: actionEffects }))),
  });
}

export function normalizeKnowgrphAdapterConfiguration(value, plan) {
  exactKeys(value, ["schema", "controllerRoot", "canonicalRepository", "repository", "subjects"], "configuration");
  if (value.schema !== CONFIG_SCHEMA || value.repository !== "huijoohwee/knowgrph") {
    invalid("configuration identity");
  }
  const controllerRoot = absolute(value.controllerRoot, "controller root");
  const canonicalRepository = absolute(value.canonicalRepository, "canonical repository");
  if (!Array.isArray(value.subjects) || value.subjects.length !== 2) invalid("configuration subjects");
  const subjects = value.subjects.map(normalizeSubjectConfiguration);
  if (new Set(subjects.map((subject) => subject.subjectId)).size !== subjects.length) {
    invalid("duplicate configured subject");
  }
  const planSubjects = Array.isArray(plan?.subjects) ? plan.subjects : [];
  if (planSubjects.length !== subjects.length) invalid("plan subject count");
  for (const subject of planSubjects) {
    const configured = subjects.find((candidate) => candidate.subjectId === subject.subjectId);
    if (!configured || subject.repository !== value.repository
      || subject.lane !== configured.branch || subject.targetState !== TARGET_STATE) {
      invalid(`plan subject ${subject.subjectId}`);
    }
    const expectedActions = configured.authorityRecovery === "none"
      ? [ACTIONS.integrateSource, ACTIONS.cleanupWorktree]
      : [ACTIONS.reconcileAuthority, ACTIONS.integrateSource, ACTIONS.cleanupWorktree];
    if (JSON.stringify([...subject.allowedActions].sort()) !== JSON.stringify(expectedActions.sort())) {
      invalid(`plan actions ${subject.subjectId}`);
    }
  }
  return Object.freeze({
    schema: CONFIG_SCHEMA,
    controllerRoot,
    canonicalRepository,
    repository: value.repository,
    subjects: Object.freeze(subjects),
  });
}

function normalizeSubjectConfiguration(value) {
  exactKeys(value, ["subjectId", "branch", "worktreePath", "sessionId", "taskAuthorityPath",
    "pullRequestUrl", "authorityRecovery", "commitMessage", "changeManifestPath"], "subject configuration");
  const subjectId = text(value.subjectId, "subject id");
  const policy = SUBJECT_POLICIES[subjectId];
  if (!policy || value.authorityRecovery !== policy.authorityRecovery) invalid(`subject policy ${subjectId}`);
  const expectedBranch = `agent/huis-macbook-pro-3/${subjectId}`;
  if (value.branch !== expectedBranch) invalid(`subject branch ${subjectId}`);
  const commitMessage = nullableText(value.commitMessage, "commit message");
  const changeManifestPath = nullableAbsolute(value.changeManifestPath, "change manifest path");
  if (policy.commitRequired !== Boolean(commitMessage && changeManifestPath)) {
    invalid(`subject commit inputs ${subjectId}`);
  }
  const pullRequestUrl = text(value.pullRequestUrl, "pull request URL");
  const parsed = new URL(pullRequestUrl);
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com"
    || !/^\/huijoohwee\/knowgrph\/pull\/[1-9]\d*$/u.test(parsed.pathname)) {
    invalid(`pull request URL ${subjectId}`);
  }
  return Object.freeze({
    subjectId,
    branch: value.branch,
    worktreePath: absolute(value.worktreePath, "worktree path"),
    sessionId: text(value.sessionId, "session id"),
    taskAuthorityPath: absolute(value.taskAuthorityPath, "task authority path"),
    pullRequestUrl,
    authorityRecovery: value.authorityRecovery,
    commitMessage,
    changeManifestPath,
  });
}

function effects(overrides) { return Object.freeze({ ...NO_EFFECTS, ...overrides }); }
function absolute(value, label) { const result = text(value, label);
  if (!path.isAbsolute(result) || path.normalize(result) !== result) invalid(label); return result; }
function nullableAbsolute(value, label) { return value === null ? null : absolute(value, label); }
function nullableText(value, label) { return value === null ? null : text(value, label); }
function text(value, label) { if (typeof value !== "string" || !value.trim() || value !== value.trim()) invalid(label); return value; }
function exactKeys(value, keys, label) { if (!value || typeof value !== "object" || Array.isArray(value)
  || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) invalid(label); }
function invalid(label) { throw new Error(`Knowgrph lane-convergence adapter has invalid ${label}.`); }
