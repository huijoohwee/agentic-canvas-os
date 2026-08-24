// Responsibility: Define the reusable Agentic Canvas OS lane-convergence boundary.
import path from "node:path";

export const CONFIG_SCHEMA = "agentic-canvas-os-lane-convergence-adapter-config/v1";
export const ADAPTER_ID = "agentic-canvas-os-protected-lane-convergence";
export const ADAPTER_VERSION = "1";
export const TARGET_STATE = "integrated-cleaned";

const NO_EFFECTS = Object.freeze({ cloudMutation: false, providerMutation: false,
  localProjectionMutation: false, gitRefMutation: false, sourceMutation: false,
  integrationMutation: false, deploymentMutation: false, cleanupMutation: false });

export const ACTIONS = Object.freeze({
  projectStartAuthority: "project-start-authority",
  recoverPlannedClean: "recover-planned-clean",
  admitStart: "admit-start",
  integrateSource: "integrate-source",
  cleanupWorktree: "cleanup-worktree",
});

export const ACTION_EFFECTS = Object.freeze({
  [ACTIONS.projectStartAuthority]: effects({ localProjectionMutation: true }),
  [ACTIONS.recoverPlannedClean]: effects({ cloudMutation: true,
    providerMutation: true, localProjectionMutation: true }),
  [ACTIONS.admitStart]: effects({ localProjectionMutation: true, providerMutation: true }),
  [ACTIONS.integrateSource]: effects({ cloudMutation: true, providerMutation: true,
    localProjectionMutation: true, gitRefMutation: true, sourceMutation: true,
    integrationMutation: true }),
  [ACTIONS.cleanupWorktree]: effects({ cleanupMutation: true }),
});

export function describeAgenticCanvasOsLaneConvergenceAdapter() {
  return Object.freeze({ id: ADAPTER_ID, version: ADAPTER_VERSION,
    actions: Object.freeze(Object.entries(ACTION_EFFECTS).map(([action, actionEffects]) =>
      Object.freeze({ action, effects: actionEffects }))) });
}

export function normalizeAgenticCanvasOsAdapterConfiguration(value, plan) {
  exactKeys(value, ["schema", "controllerRoot", "canonicalRepository", "repository",
    "artifactDirectory", "subjects"], "configuration");
  if (value.schema !== CONFIG_SCHEMA || value.repository !== "huijoohwee/agentic-canvas-os") {
    invalid("configuration identity");
  }
  const subjects = array(value.subjects, "subjects").map(normalizeSubject);
  if (!subjects.length || new Set(subjects.map(({ subjectId }) => subjectId)).size !== subjects.length) {
    invalid("configured subjects");
  }
  if (!Array.isArray(plan?.subjects) || plan.subjects.length !== subjects.length) invalid("plan subjects");
  for (const planned of plan.subjects) {
    const configured = subjects.find(({ subjectId }) => subjectId === planned.subjectId);
    const expectedActions = configured?.recoveryMode === "planned-start-response-ahead"
      ? [ACTIONS.projectStartAuthority, ACTIONS.recoverPlannedClean,
        ACTIONS.admitStart, ACTIONS.integrateSource,
        ACTIONS.cleanupWorktree]
      : [ACTIONS.integrateSource, ACTIONS.cleanupWorktree];
    if (!configured || planned.repository !== value.repository || planned.lane !== configured.branch
      || planned.targetState !== TARGET_STATE
      || JSON.stringify([...planned.allowedActions].sort()) !== JSON.stringify(expectedActions.sort())) {
      invalid(`plan subject ${planned.subjectId}`);
    }
  }
  return Object.freeze({ schema: CONFIG_SCHEMA,
    controllerRoot: absolute(value.controllerRoot, "controller root"),
    canonicalRepository: absolute(value.canonicalRepository, "canonical repository"),
    repository: value.repository,
    artifactDirectory: absolute(value.artifactDirectory, "artifact directory"),
    subjects: Object.freeze(subjects) });
}

function normalizeSubject(value) {
  exactKeys(value, ["subjectId", "branch", "worktreePath", "lifecycleRepository", "sessionId",
    "taskAuthorityPath", "pullRequestUrl", "recoveryMode"], "subject");
  if (!["none", "planned-start-response-ahead"].includes(value.recoveryMode)) invalid("recovery mode");
  const pullRequestUrl = text(value.pullRequestUrl, "pull request URL");
  const parsed = new URL(pullRequestUrl);
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com"
    || !/^\/huijoohwee\/agentic-canvas-os\/pull\/[1-9]\d*$/u.test(parsed.pathname)) {
    invalid("pull request URL");
  }
  return Object.freeze({ subjectId: text(value.subjectId, "subject id"),
    branch: text(value.branch, "branch"), worktreePath: absolute(value.worktreePath, "worktree"),
    lifecycleRepository: absolute(value.lifecycleRepository, "lifecycle repository"),
    sessionId: text(value.sessionId, "session id"),
    taskAuthorityPath: absolute(value.taskAuthorityPath, "task authority"),
    pullRequestUrl, recoveryMode: value.recoveryMode });
}

function effects(overrides) { return Object.freeze({ ...NO_EFFECTS, ...overrides }); }
function array(value, label) { if (!Array.isArray(value)) invalid(label); return value; }
function absolute(value, label) { const result = text(value, label);
  if (!path.isAbsolute(result) || path.normalize(result) !== result) invalid(label); return result; }
function text(value, label) { if (typeof value !== "string" || !value.trim()
  || value !== value.trim()) invalid(label); return value; }
function exactKeys(value, keys, label) { if (!value || typeof value !== "object" || Array.isArray(value)
  || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) invalid(label); }
function invalid(label) { throw new Error(`Agentic Canvas OS lane-convergence adapter has invalid ${label}.`); }
