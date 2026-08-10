import path from "node:path";

import {
  digestValue,
  normalizeWriteSet,
} from "./cloud-collaboration-primitives.mjs";
import { parseDeviceBranch } from "./writer-lease-lib.mjs";

export const LEGACY_BOOTSTRAP_REQUEST_SCHEMA =
  "agentic-legacy-clean-committed-lane-bootstrap-request/v1";
export const LEGACY_BOOTSTRAP_CHECKPOINT_SCHEMA =
  "agentic-legacy-clean-committed-lane-bootstrap-checkpoint/v1";
export const LEGACY_BOOTSTRAP_RECEIPT_SCHEMA =
  "agentic-legacy-clean-committed-lane-bootstrap-receipt/v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const PHASES = Object.freeze([
  ["cloudClaim", "claimCloudAuthority"],
  ["localLease", "claimLocalLease"],
  ["remoteBranch", "publishExactBranch"],
  ["pullRequest", "createDraftOwnershipRequest"],
  ["boundAuthority", "bindCloudAuthority"],
  ["ownerProjection", "projectOwnerReceipt"],
]);

export class LegacyBootstrapBlockedError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LegacyBootstrapBlockedError";
    this.code = code;
  }
}

export async function bootstrapLegacyCleanCommittedLane(
  rawRequest,
  { adapter, now = () => new Date() } = {},
) {
  requireAdapter(adapter);
  const request = normalizeRequest(rawRequest);
  const observation = normalizeObservation(
    await adapter.inspectLane(request),
    request,
  );
  const identity = createIdentity(request, observation);
  let checkpoint = normalizeCheckpoint(
    await adapter.readCheckpoint(identity.identityDigest),
    identity,
  );
  assertProjectionAttribution(observation.projections, identity, checkpoint);

  if (!checkpoint) {
    checkpoint = {
      schema: LEGACY_BOOTSTRAP_CHECKPOINT_SCHEMA,
      status: "prepared",
      identity,
      outputs: {},
      preparedAt: instant(now(), "preparedAt"),
      completedAt: null,
      receipt: null,
    };
    await persist(adapter, checkpoint);
  }

  if (checkpoint.status === "completed") {
    assertCompletedProjection(observation.projections, checkpoint);
    return Object.freeze({ ...checkpoint.receipt, replayed: true });
  }

  for (const [outputName, methodName] of PHASES) {
    if (checkpoint.outputs[outputName]) {
      assertOutputProjection(observation.projections, outputName, checkpoint);
      continue;
    }
    const output = normalizePhaseOutput(
      await adapter[methodName](phaseContext(request, checkpoint)),
      outputName,
      identity.identityDigest,
    );
    const phaseObservation = normalizeObservation(
      await adapter.inspectLane(request),
      request,
    );
    if (digestValue(phaseObservation.projections[outputName]) !== digestValue(output)) {
      blocked("phase_projection_mismatch", `${outputName} was not projected exactly after its operation.`);
    }
    checkpoint = {
      ...checkpoint,
      status: outputName,
      outputs: { ...checkpoint.outputs, [outputName]: output },
    };
    await persist(adapter, checkpoint);
  }

  const finalObservation = normalizeObservation(
    await adapter.verifyFinal(phaseContext(request, checkpoint)),
    request,
  );
  assertFinalState(finalObservation, checkpoint);
  const completedAt = instant(now(), "completedAt");
  const receipt = createReceipt(checkpoint, completedAt);
  checkpoint = {
    ...checkpoint,
    status: "completed",
    completedAt,
    receipt,
  };
  await persist(adapter, checkpoint);
  return receipt;
}

export function normalizeLegacyBootstrapRequest(value) {
  return normalizeRequest(value);
}

function normalizeRequest(value) {
  requireObject(value, "Bootstrap request");
  if (value.schema !== LEGACY_BOOTSTRAP_REQUEST_SCHEMA) {
    blocked("invalid_request", `Bootstrap request schema must be ${LEGACY_BOOTSTRAP_REQUEST_SCHEMA}.`);
  }
  const branch = text(value.branch, "branch");
  const branchIdentity = parseDeviceBranch(branch);
  if (!branchIdentity) blocked("invalid_branch", "Branch must be agent/<device>/<semantic-scope>.");
  const deviceId = text(value.deviceId, "deviceId");
  const semanticScope = text(value.semanticScope, "semanticScope");
  if (branchIdentity.device !== deviceId || branchIdentity.scope !== semanticScope) {
    blocked("identity_mismatch", "Branch, device, and semantic scope must identify one lane.");
  }
  let declaredWriteScope;
  try {
    declaredWriteScope = normalizeWriteSet([
      `semantic:${semanticScope}`,
      ...(Array.isArray(value.declaredWriteScope) ? value.declaredWriteScope : []),
    ]);
  } catch (error) {
    blocked("invalid_write_scope", error.message);
  }
  const expectedChangedPaths = normalizePaths(value.expectedChangedPaths, "expectedChangedPaths");
  for (const changedPath of expectedChangedPaths) {
    if (!declaredWriteScope.some(scope => coversPath(scope, changedPath))) {
      blocked("write_scope_mismatch", `Changed path ${changedPath} is outside the declared write scope.`);
    }
  }
  return Object.freeze({
    schema: LEGACY_BOOTSTRAP_REQUEST_SCHEMA,
    targetRepository: text(value.targetRepository, "targetRepository"),
    ledgerRepository: text(value.ledgerRepository, "ledgerRepository"),
    sessionId: text(value.sessionId, "sessionId"),
    deviceId,
    semanticScope,
    branch,
    worktreePath: path.resolve(text(value.worktreePath, "worktreePath")),
    expectedBaseSha: sha(value.expectedBaseSha, "expectedBaseSha"),
    expectedHeadSha: sha(value.expectedHeadSha, "expectedHeadSha"),
    expectedTreeSha: sha(value.expectedTreeSha, "expectedTreeSha"),
    expectedChangedPaths,
    declaredWriteScope,
    writeSetDigest: digestValue(declaredWriteScope),
  });
}

function normalizeObservation(value, request) {
  requireObject(value, "Lane observation");
  if (value.clean !== true) blocked("dirty_lane", "Legacy lane must be clean before bootstrap.");
  if (value.registeredWorktree !== true) {
    blocked("unregistered_lane", "Legacy lane must already be a registered worktree.");
  }
  if (value.attachedBranch !== request.branch) {
    blocked("branch_mismatch", "Worktree is not attached to the requested branch.");
  }
  if (path.resolve(text(value.worktreePath, "observation.worktreePath")) !== request.worktreePath) {
    blocked("worktree_mismatch", "Observed worktree path does not match the request.");
  }
  const baseSha = sha(value.baseSha, "observation.baseSha");
  const headSha = sha(value.headSha, "observation.headSha");
  const treeSha = sha(value.treeSha, "observation.treeSha");
  if (
    baseSha !== request.expectedBaseSha ||
    headSha !== request.expectedHeadSha ||
    treeSha !== request.expectedTreeSha
  ) blocked("immutable_lane_drift", "Base, head, or tree no longer matches the authorized immutable lane.");
  if (value.baseIsAncestor !== true) {
    blocked("invalid_ancestry", "Requested base is not an ancestor of the committed lane head.");
  }
  const changedPaths = normalizePaths(value.changedPaths, "observation.changedPaths");
  if (digestValue(changedPaths) !== digestValue(request.expectedChangedPaths)) {
    blocked("committed_write_set_drift", "Committed changed paths no longer match the authorized set.");
  }
  if (array(value.competingScopeOwners).length) {
    blocked("scope_collision", "A peer lane or review request already owns this semantic scope.");
  }
  if (array(value.overlappingClaims).length) {
    blocked("write_overlap", "A live claim overlaps the requested write scope.");
  }
  requireObject(value.projections, "Lane projections");
  return Object.freeze({
    baseSha, headSha, treeSha, changedPaths,
    projections: value.projections,
  });
}

function createIdentity(request, observation) {
  const unsigned = {
    schema: "agentic-legacy-clean-committed-lane-identity/v1",
    targetRepository: request.targetRepository,
    ledgerRepository: request.ledgerRepository,
    sessionId: request.sessionId,
    deviceId: request.deviceId,
    semanticScope: request.semanticScope,
    branch: request.branch,
    worktreeRegistrationDigest: digestValue({
      schema: "agentic-local-worktree-registration/v1",
      targetRepository: request.targetRepository,
      branch: request.branch,
      worktreePath: request.worktreePath,
    }),
    baseSha: observation.baseSha,
    headSha: observation.headSha,
    treeSha: observation.treeSha,
    changedPaths: observation.changedPaths,
    declaredWriteScope: request.declaredWriteScope,
    writeSetDigest: request.writeSetDigest,
  };
  return Object.freeze({ ...unsigned, identityDigest: digestValue(unsigned) });
}

function normalizeCheckpoint(value, identity) {
  if (value === null || value === undefined) return null;
  requireObject(value, "Bootstrap checkpoint");
  if (value.schema !== LEGACY_BOOTSTRAP_CHECKPOINT_SCHEMA) {
    blocked("checkpoint_invalid", "Bootstrap checkpoint schema is unsupported.");
  }
  if (value.identity?.identityDigest !== identity.identityDigest || digestValue(value.identity) !== digestValue(identity)) {
    blocked("checkpoint_identity_drift", "Bootstrap checkpoint does not bind the current immutable lane.");
  }
  requireObject(value.outputs, "Bootstrap checkpoint outputs");
  return value;
}

function assertProjectionAttribution(projections, identity, checkpoint) {
  for (const [name] of PHASES) {
    const projection = projections[name];
    if (!projection) continue;
    if (projection.bootstrapIdentityDigest !== identity.identityDigest) {
      blocked("unattributed_projection", `Existing ${name} is not attributable to this bootstrap identity.`);
    }
    if (!checkpoint) continue;
    const recorded = checkpoint.outputs[name];
    if (recorded && digestValue(recorded) !== digestValue(projection)) {
      blocked("projection_drift", `Existing ${name} differs from its checkpointed value.`);
    }
  }
}

function assertOutputProjection(projections, name, checkpoint) {
  const projection = projections[name];
  if (!projection || digestValue(projection) !== digestValue(checkpoint.outputs[name])) {
    blocked("partial_projection_missing", `Checkpointed ${name} is missing or changed; recovery cannot continue.`);
  }
}

function assertCompletedProjection(projections, checkpoint) {
  for (const [name] of PHASES) assertOutputProjection(projections, name, checkpoint);
}

function assertFinalState(observation, checkpoint) {
  assertCompletedProjection(observation.projections, checkpoint);
  if (observation.headSha !== checkpoint.identity.headSha || observation.treeSha !== checkpoint.identity.treeSha) {
    blocked("final_lane_drift", "Bootstrap changed the legacy commit or tree.");
  }
}

function normalizePhaseOutput(value, name, identityDigest) {
  requireObject(value, `${name} output`);
  if (value.bootstrapIdentityDigest !== identityDigest) {
    blocked("phase_attribution_missing", `${name} did not return the exact bootstrap identity.`);
  }
  const receiptDigest = text(value.receiptDigest, `${name}.receiptDigest`);
  if (!receiptDigest.match(/^[0-9a-f]{64}$/u)) {
    blocked("phase_receipt_invalid", `${name} must return a SHA-256 receipt digest.`);
  }
  const unsigned = { ...value };
  delete unsigned.receiptDigest;
  if (receiptDigest !== digestValue(unsigned)) {
    blocked("phase_receipt_invalid", `${name} receipt does not bind its complete projection.`);
  }
  return Object.freeze(value);
}

function createReceipt(checkpoint, completedAt) {
  const unsigned = {
    schema: LEGACY_BOOTSTRAP_RECEIPT_SCHEMA,
    status: "ready",
    recovery: "idempotent-fail-closed",
    identity: checkpoint.identity,
    outputs: checkpoint.outputs,
    preparedAt: checkpoint.preparedAt,
    completedAt,
    preservedHeadSha: checkpoint.identity.headSha,
    preservedTreeSha: checkpoint.identity.treeSha,
  };
  return Object.freeze({ ...unsigned, receiptDigest: digestValue(unsigned), replayed: false });
}

function phaseContext(request, checkpoint) {
  return Object.freeze({
    request,
    checkpoint,
    identity: checkpoint.identity,
    idempotencyKey: digestValue({
      schema: "agentic-legacy-bootstrap-operation-key/v1",
      identityDigest: checkpoint.identity.identityDigest,
      nextStatus: checkpoint.status,
    }),
  });
}

async function persist(adapter, checkpoint) {
  await adapter.writeCheckpoint(Object.freeze(checkpoint));
}

function requireAdapter(adapter) {
  requireObject(adapter, "Bootstrap adapter");
  for (const method of [
    "inspectLane", "readCheckpoint", "writeCheckpoint", "verifyFinal",
    ...PHASES.map(([, method]) => method),
  ]) {
    if (typeof adapter[method] !== "function") {
      blocked("adapter_incomplete", `Bootstrap adapter must implement ${method}().`);
    }
  }
}

function normalizePaths(values, field) {
  if (!Array.isArray(values) || !values.length) blocked("invalid_request", `${field} must be non-empty.`);
  const normalized = values.map((value, index) => {
    const candidate = text(value, `${field}[${index}]`).replaceAll("\\", "/");
    if (candidate.startsWith("/") || candidate.split("/").includes("..")) {
      blocked("invalid_path", `${field}[${index}] must be repository-relative.`);
    }
    return candidate.replace(/^\.\//u, "");
  });
  return Object.freeze([...new Set(normalized)].sort());
}

function coversPath(scope, changedPath) {
  if (scope === "path:.") return true;
  if (!scope.startsWith("path:")) return false;
  const declaredPath = scope.slice("path:".length);
  return changedPath === declaredPath || changedPath.startsWith(`${declaredPath}/`);
}

function text(value, field) {
  if (typeof value !== "string" || !value.trim()) blocked("invalid_request", `${field} is required.`);
  return value.normalize("NFC").trim();
}

function sha(value, field) {
  const normalized = text(value, field);
  if (!SHA_PATTERN.test(normalized)) blocked("invalid_request", `${field} must be a lowercase Git SHA.`);
  return normalized;
}

function instant(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) blocked("invalid_time", `${field} must be an instant.`);
  return date.toISOString();
}

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    blocked("invalid_request", `${field} must be an object.`);
  }
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function blocked(code, message) {
  throw new LegacyBootstrapBlockedError(code, message);
}
