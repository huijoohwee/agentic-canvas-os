// Responsibility: Seal one cloud-free proof for adopting an already-recorded bridge retirement.
import {
  canonicalJson, digestValue, normalizeWriteSet, writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import {
  BRIDGE_RETIREMENT_OPERATION, bridgeRetirementRequestDigest,
  normalizeWaitingBridgeJournal, waitingBridgeOperationKey,
} from "./claim-only-waiting-bridge-reconciliation-contract.mjs";
import { claimOnlyOperationReceiptForEntry }
  from "./claim-only-partial-start-retirement-store.mjs";

export const WAITING_BRIDGE_PROTECTED_ADVANCE_OPERATION =
  "claim-only-waiting-bridge-protected-advance";
export const WAITING_BRIDGE_PROTECTED_ADVANCE_FRAME_SCHEMA =
  "agentic-claim-only-waiting-bridge-protected-advance-frame/v1";
export const WAITING_BRIDGE_PROTECTED_ADVANCE_PROOF_SCHEMA =
  "agentic-claim-only-waiting-bridge-protected-advance-proof/v1";
export const WAITING_BRIDGE_PROTECTED_ADVANCE_PLAN_SCHEMA =
  "agentic-claim-only-waiting-bridge-protected-advance-plan/v1";
export const WAITING_BRIDGE_PROTECTED_ADVANCE_AUTHORIZATION_SCHEMA =
  "agentic-claim-only-waiting-bridge-protected-advance-authorization/v1";
export const WAITING_BRIDGE_PROTECTED_ADVANCE_RECEIPT_SCHEMA =
  "agentic-claim-only-waiting-bridge-protected-advance-receipt/v1";

const DIGEST = /^[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const FRAME_KEYS = Object.freeze([
  "schema", "repository", "controller", "canonical", "anchor", "bridge", "successor",
  "anchorEntry", "bridgeEntry", "successorEntry", "anchorLineageCount",
  "bridgeLineageCount", "successorLineageCount", "associations", "preservation",
  "directSuccessorTopology", "topology", "bridgeTerminalEntry",
]);
const ALLOWED_EFFECTS = Object.freeze([
  "private-external-plan", "private-external-authorization", "private-external-receipt",
  "adopt-existing-bridge-retirement-terminal",
]);
const FORBIDDEN_EFFECTS = Object.freeze([
  "cloud-mutation", "provider-mutation", "source-byte", "git-object", "git-ref", "branch",
  "worktree", "writer-lease", "pull-request", "pull-request-marker", "claim", "continue",
  "integrate", "retire", "deployment", "cleanup", "rollback",
]);

export function normalizeWaitingBridgeProtectedAdvanceCurrentFrame(
  value, { retirementPlan } = {},
) {
  const plan = requireRetirementPlan(retirementPlan);
  const frame = clone(object(value, "current frame"));
  frame.schema ??= WAITING_BRIDGE_PROTECTED_ADVANCE_FRAME_SCHEMA;
  exactObject(frame, "current frame", FRAME_KEYS);
  if (frame.schema !== WAITING_BRIDGE_PROTECTED_ADVANCE_FRAME_SCHEMA) {
    invalid("current frame schema");
  }
  const prior = plan.evidence;
  for (const key of ["repository", "anchor", "bridge", "successor", "anchorEntry",
    "bridgeEntry", "successorEntry", "associations", "directSuccessorTopology", "topology"]) {
    if (canonicalJson(frame[key]) !== canonicalJson(prior[key])) {
      invalid(`current frame preserved ${key}`);
    }
  }
  requireRepository(frame.repository);
  requireController(frame.controller, frame.repository);
  requireCanonical(frame.canonical, frame.repository, frame.controller);
  requirePreservation(frame.preservation, frame.associations);
  if (frame.anchorLineageCount !== prior.anchorLineageCount
    || frame.bridgeLineageCount !== prior.bridgeLineageCount + 1
    || frame.successorLineageCount !== prior.successorLineageCount) {
    invalid("current frame lineage cardinality");
  }
  requireTerminal(frame.bridgeTerminalEntry, plan);
  return deepFreeze(frame);
}

export function waitingBridgeProtectedAdvanceCurrentFrameDigest(
  value, { retirementPlan } = {},
) {
  return digestValue(normalizeWaitingBridgeProtectedAdvanceCurrentFrame(
    value, { retirementPlan },
  ));
}

export function captureWaitingBridgeProtectedAdvance({
  journal, currentFrame, gitText,
} = {}) {
  const source = requireRetirementIntentJournal(journal);
  const frame = normalizeWaitingBridgeProtectedAdvanceCurrentFrame(currentFrame, {
    retirementPlan: source.plan,
  });
  if (typeof gitText !== "function") invalid("protected Git reader");
  const priorMainSha = source.plan.evidence.controller.remoteMainSha;
  const currentMainSha = frame.controller.remoteMainSha;
  if (priorMainSha === currentMainSha) invalid("strict protected descendant");
  try {
    gitText(["merge-base", "--is-ancestor", priorMainSha, currentMainSha]);
  } catch {
    invalid("strict protected descendant");
  }
  const mergeBaseSha = String(gitText(["merge-base", priorMainSha, currentMainSha])).trim();
  if (mergeBaseSha !== priorMainSha) invalid("protected merge base");
  const priorTreeSha = requireSha(
    String(gitText(["rev-parse", `${priorMainSha}^{tree}`])).trim(), "prior protected tree",
  );
  const currentTreeSha = requireSha(
    String(gitText(["rev-parse", `${currentMainSha}^{tree}`])).trim(), "current protected tree",
  );
  const changedPaths = normalizeChangedPaths(String(gitText([
    "diff", "--name-only", "-z", priorMainSha, currentMainSha, "--",
  ])));
  if (changedPaths.length === 0) invalid("nonempty protected advance paths");
  const changedWriteSet = normalizeWriteSet(changedPaths.map(path => `path:${path}`));
  const protectedWriteScope = normalizeWriteSet([
    ...source.plan.evidence.anchor.declaredWriteScope,
    ...source.plan.evidence.bridge.declaredWriteScope,
    ...source.plan.evidence.successor.declaredWriteScope,
  ]);
  if (writeSetsOverlap(changedWriteSet, protectedWriteScope)) {
    invalid("protected advance write-scope overlap");
  }
  return sealProtectedAdvance({
    schema: WAITING_BRIDGE_PROTECTED_ADVANCE_PROOF_SCHEMA,
    repository: frame.repository.targetRepository,
    priorMainSha,
    priorTreeSha,
    currentMainSha,
    currentTreeSha,
    mergeBaseSha,
    ancestry: "strict-protected-main-descendant",
    changedPaths,
    changedPathsDigest: digestValue(changedPaths),
    protectedWriteScope,
    protectedWriteSetDigest: digestValue(protectedWriteScope),
    overlap: "none",
    priorControllerDigest: digestValue(source.plan.evidence.controller),
    currentControllerDigest: digestValue(frame.controller),
    currentFrameDigest: digestValue(frame),
  });
}

export function normalizeWaitingBridgeProtectedAdvance(
  value, { journal, currentFrame } = {},
) {
  const source = requireRetirementIntentJournal(journal);
  const frame = normalizeWaitingBridgeProtectedAdvanceCurrentFrame(currentFrame, {
    retirementPlan: source.plan,
  });
  const proof = clone(object(value, "protected advance"));
  exactObject(proof, "protected advance", [
    "schema", "repository", "priorMainSha", "priorTreeSha", "currentMainSha",
    "currentTreeSha", "mergeBaseSha", "ancestry", "changedPaths", "changedPathsDigest",
    "protectedWriteScope", "protectedWriteSetDigest", "overlap", "priorControllerDigest",
    "currentControllerDigest", "currentFrameDigest", "protectedAdvanceDigest",
  ]);
  const normalizedPaths = normalizeChangedPaths(proof.changedPaths);
  const protectedWriteScope = normalizeWriteSet(proof.protectedWriteScope);
  const expectedScope = normalizeWriteSet([
    ...source.plan.evidence.anchor.declaredWriteScope,
    ...source.plan.evidence.bridge.declaredWriteScope,
    ...source.plan.evidence.successor.declaredWriteScope,
  ]);
  const changedWriteSet = normalizeWriteSet(normalizedPaths.map(path => `path:${path}`));
  const core = {
    schema: proof.schema,
    repository: proof.repository,
    priorMainSha: proof.priorMainSha,
    priorTreeSha: proof.priorTreeSha,
    currentMainSha: proof.currentMainSha,
    currentTreeSha: proof.currentTreeSha,
    mergeBaseSha: proof.mergeBaseSha,
    ancestry: proof.ancestry,
    changedPaths: normalizedPaths,
    changedPathsDigest: proof.changedPathsDigest,
    protectedWriteScope,
    protectedWriteSetDigest: proof.protectedWriteSetDigest,
    overlap: proof.overlap,
    priorControllerDigest: proof.priorControllerDigest,
    currentControllerDigest: proof.currentControllerDigest,
    currentFrameDigest: proof.currentFrameDigest,
  };
  const priorMainSha = source.plan.evidence.controller.remoteMainSha;
  const currentMainSha = frame.controller.remoteMainSha;
  if (core.schema !== WAITING_BRIDGE_PROTECTED_ADVANCE_PROOF_SCHEMA
    || core.repository !== frame.repository.targetRepository
    || requireSha(core.priorMainSha, "protected advance prior main") !== priorMainSha
    || requireSha(core.currentMainSha, "protected advance current main") !== currentMainSha
    || core.priorMainSha === core.currentMainSha
    || requireSha(core.mergeBaseSha, "protected advance merge base") !== core.priorMainSha
    || core.ancestry !== "strict-protected-main-descendant"
    || core.overlap !== "none"
    || canonicalJson(protectedWriteScope) !== canonicalJson(expectedScope)
    || writeSetsOverlap(changedWriteSet, protectedWriteScope)
    || core.changedPathsDigest !== digestValue(normalizedPaths)
    || core.protectedWriteSetDigest !== digestValue(protectedWriteScope)
    || core.priorControllerDigest !== digestValue(source.plan.evidence.controller)
    || core.currentControllerDigest !== digestValue(frame.controller)
    || core.currentFrameDigest !== digestValue(frame)) {
    invalid("protected advance binding");
  }
  requireSha(core.priorTreeSha, "protected advance prior tree");
  requireSha(core.currentTreeSha, "protected advance current tree");
  if (proof.protectedAdvanceDigest !== digestValue(core)) invalid("protected advance seal");
  return deepFreeze({ ...core, protectedAdvanceDigest: proof.protectedAdvanceDigest });
}

export function buildWaitingBridgeProtectedAdvancePlan({
  journal, currentFrame, protectedAdvance,
} = {}) {
  const source = requireRetirementIntentJournal(journal);
  const frame = normalizeWaitingBridgeProtectedAdvanceCurrentFrame(currentFrame, {
    retirementPlan: source.plan,
  });
  const advance = normalizeWaitingBridgeProtectedAdvance(protectedAdvance, {
    journal: source, currentFrame: frame,
  });
  return sealPlan({
    source,
    frame,
    advance,
  });
}

export function normalizeWaitingBridgeProtectedAdvancePlan(value) {
  const received = clone(object(value, "protected advance plan"));
  const source = requireRetirementIntentJournal(received.retirementJournalSnapshot);
  const frame = normalizeWaitingBridgeProtectedAdvanceCurrentFrame(
    received.currentFrameSnapshot, { retirementPlan: source.plan },
  );
  const advance = normalizeWaitingBridgeProtectedAdvance(received.protectedAdvanceSnapshot, {
    journal: source, currentFrame: frame,
  });
  const rebuilt = sealPlan({ source, frame, advance });
  if (canonicalJson(received) !== canonicalJson(rebuilt)) invalid("protected advance plan seal");
  return rebuilt;
}

export function authorizeWaitingBridgeProtectedAdvance({ plan, authorization } = {}) {
  const sealed = normalizeWaitingBridgeProtectedAdvancePlan(plan);
  if (authorization !== sealed.exactAuthorization) {
    throw new Error(`Waiting-bridge protected advance requires exact authorization: ${sealed.exactAuthorization}`);
  }
  const core = {
    schema: WAITING_BRIDGE_PROTECTED_ADVANCE_AUTHORIZATION_SCHEMA,
    operation: WAITING_BRIDGE_PROTECTED_ADVANCE_OPERATION,
    planDigest: sealed.planDigest,
    statement: authorization,
  };
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export function normalizeWaitingBridgeProtectedAdvanceAuthorization(value, { plan } = {}) {
  const sealed = normalizeWaitingBridgeProtectedAdvancePlan(plan);
  const received = clone(object(value, "protected advance authorization"));
  exactObject(received, "protected advance authorization", [
    "schema", "operation", "planDigest", "statement", "authorizationDigest",
  ]);
  const rebuilt = authorizeWaitingBridgeProtectedAdvance({
    plan: sealed, authorization: sealed.exactAuthorization,
  });
  if (canonicalJson(received) !== canonicalJson(rebuilt)) invalid("protected advance authorization seal");
  return rebuilt;
}

export function buildWaitingBridgeProtectedAdvanceReceipt({
  plan, authorization, currentFrame, currentPreservation,
} = {}) {
  const sealed = normalizeWaitingBridgeProtectedAdvancePlan(plan);
  if (!currentFrame) invalid("fresh current frame");
  const authorized = typeof authorization === "string"
    ? authorizeWaitingBridgeProtectedAdvance({ plan: sealed, authorization })
    : normalizeWaitingBridgeProtectedAdvanceAuthorization(authorization, { plan: sealed });
  requireCurrentJoin(sealed, currentFrame, currentPreservation);
  return sealReceipt(sealed, authorized);
}

export function normalizeWaitingBridgeProtectedAdvanceReceipt(value, {
  plan, currentFrame, currentPreservation,
} = {}) {
  const received = clone(object(value, "protected advance receipt"));
  const embedded = normalizeWaitingBridgeProtectedAdvancePlan(received.planSnapshot);
  if (plan && canonicalJson(normalizeWaitingBridgeProtectedAdvancePlan(plan))
    !== canonicalJson(embedded)) invalid("protected advance receipt plan join");
  const authorization = normalizeWaitingBridgeProtectedAdvanceAuthorization(
    received.authorizationSnapshot, { plan: embedded },
  );
  requireCurrentJoin(embedded, currentFrame, currentPreservation);
  const rebuilt = sealReceipt(embedded, authorization);
  if (canonicalJson(received) !== canonicalJson(rebuilt)) invalid("protected advance receipt seal");
  return rebuilt;
}

export function requireWaitingBridgeProtectedAdvanceReceiptJoin(input = {}) {
  return normalizeWaitingBridgeProtectedAdvanceReceipt(input.receipt, input);
}

function sealPlan({ source, frame, advance }) {
  const prior = source.plan.evidence;
  const priorFrame = priorProtectedFrame(prior);
  const core = {
    schema: WAITING_BRIDGE_PROTECTED_ADVANCE_PLAN_SCHEMA,
    operation: WAITING_BRIDGE_PROTECTED_ADVANCE_OPERATION,
    kind: "retirement-intent-response-loss-terminal-adoption",
    retirementPlanDigest: source.plan.planDigest,
    retirementJournalDigest: source.journalDigest,
    retirementJournalSnapshot: source,
    retirementIntentReceiptDigest: source.state.receipts["retirement-intent"].receiptDigest,
    priorEvidenceDigest: digestValue(prior),
    priorProtectedFrameDigest: digestValue(priorFrame),
    priorPreservationDigest: digestValue(prior.preservation),
    currentFrameSnapshot: frame,
    currentFrameDigest: digestValue(frame),
    currentPreservationDigest: digestValue(frame.preservation),
    protectedAdvanceSnapshot: advance,
    protectedAdvanceDigest: advance.protectedAdvanceDigest,
    terminalEntryDigest: frame.bridgeTerminalEntry.digest,
    allowedEffects: ALLOWED_EFFECTS,
    forbiddenEffects: FORBIDDEN_EFFECTS,
    cloudEffect: false,
    providerMutation: false,
  };
  const planDigest = digestValue(core);
  return deepFreeze({
    ...core,
    planDigest,
    exactAuthorization: `authorize ${WAITING_BRIDGE_PROTECTED_ADVANCE_OPERATION} ${planDigest}`,
  });
}

function sealReceipt(plan, authorization) {
  const core = {
    schema: WAITING_BRIDGE_PROTECTED_ADVANCE_RECEIPT_SCHEMA,
    operation: WAITING_BRIDGE_PROTECTED_ADVANCE_OPERATION,
    status: "complete",
    disposition: "authorized-terminal-adoption",
    planDigest: plan.planDigest,
    planSnapshot: plan,
    authorizationDigest: authorization.authorizationDigest,
    authorizationSnapshot: authorization,
    retirementPlanDigest: plan.retirementPlanDigest,
    retirementJournalDigest: plan.retirementJournalDigest,
    retirementIntentReceiptDigest: plan.retirementIntentReceiptDigest,
    priorPreservationDigest: plan.priorPreservationDigest,
    currentPreservationDigest: plan.currentPreservationDigest,
    currentFrameDigest: plan.currentFrameDigest,
    protectedAdvanceDigest: plan.protectedAdvanceDigest,
    terminalEntryDigest: plan.terminalEntryDigest,
    cloudEffect: false,
    providerMutation: false,
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function requireCurrentJoin(plan, currentFrame, currentPreservation) {
  const sourcePlan = plan.retirementJournalSnapshot.plan;
  const frame = normalizeWaitingBridgeProtectedAdvanceCurrentFrame(
    currentFrame || plan.currentFrameSnapshot, { retirementPlan: sourcePlan },
  );
  if (canonicalJson(frame) !== canonicalJson(plan.currentFrameSnapshot)
    || digestValue(frame) !== plan.currentFrameDigest) invalid("protected advance current frame join");
  const preservation = currentPreservation || frame.preservation;
  requirePreservation(preservation, frame.associations);
  if (canonicalJson(preservation) !== canonicalJson(frame.preservation)
    || digestValue(preservation) !== plan.currentPreservationDigest) {
    invalid("protected advance current preservation join");
  }
}

function requireRetirementIntentJournal(value) {
  const journal = normalizeWaitingBridgeJournal(value);
  if (journal.operation !== BRIDGE_RETIREMENT_OPERATION
    || journal.state?.phase !== "retirement-intent") {
    invalid("exact retirement-intent checkpoint");
  }
  return journal;
}

function requireRetirementPlan(value) {
  if (!value || value.operation !== BRIDGE_RETIREMENT_OPERATION) {
    invalid("bridge retirement plan");
  }
  const candidate = {
    schema: "agentic-claim-only-waiting-bridge-reconciliation-journal/v1",
    operation: value.operation,
    plan: value,
    state: null,
  };
  candidate.journalDigest = digestValue(candidate);
  return normalizeWaitingBridgeJournal(candidate).plan;
}

function priorProtectedFrame(evidence) {
  return deepFreeze(Object.fromEntries([
    "repository", "controller", "canonical", "anchor", "bridge", "successor", "anchorEntry",
    "bridgeEntry", "successorEntry", "anchorLineageCount", "bridgeLineageCount",
    "successorLineageCount", "associations", "preservation", "directSuccessorTopology",
    "topology", "peerFrame",
  ].map(key => [key, evidence[key]])));
}

function requireTerminal(value, plan) {
  const entry = object(value, "bridge terminal entry");
  const bridge = plan.evidence.bridge;
  const operationKey = waitingBridgeOperationKey(plan, "bridge-retired");
  for (const name of ["claimId", "claimDigest", "digest", "idempotencyKey", "requestDigest"]) {
    requireDigest(entry[name], `bridge terminal ${name}`);
  }
  const immutable = ["actorId", "deviceId", "sessionId", "workItemId", "repositoryId",
    "canonicalBaseRevision", "laneRevision", "writeSetDigest", "leaseEpoch", "eligibleSince"];
  if (entry.schema !== "agentic-cloud-collaboration-entry/v2" || entry.action !== "retire"
    || entry.claimId !== bridge.claimId || entry.repositoryId !== bridge.repositoryId
    || entry.idempotencyKey !== digestValue(operationKey)
    || entry.requestDigest !== bridgeRetirementRequestDigest(plan)
    || entry.state !== "retired" || entry.transitionCounter !== bridge.transitionCounter + 1
    || entry.heartbeatCounter !== bridge.heartbeatCounter
    || entry.recordedExpiresAt !== bridge.expiresAt || entry.predecessorClaimId !== bridge.predecessorClaimId
    || entry.reviewRequestId !== null
    || immutable.some(name => canonicalJson(entry[name]) !== canonicalJson(bridge[name]))
    || canonicalJson(normalizeWriteSet(entry.declaredWriteScope))
      !== canonicalJson(bridge.declaredWriteScope)
    || entry.retirement?.reason !== "superseded"
    || entry.retirement?.finalRevision !== bridge.laneRevision
    || entry.retirement?.reviewRequestId !== null
    || entry.retirement?.integrationReceiptDigest !== null
    || entry.retirement?.retiredAt !== entry.evaluationTime) {
    invalid("bridge terminal semantics");
  }
  claimOnlyOperationReceiptForEntry(entry, "retired");
}

function requireRepository(value) {
  exactObject(value, "current repository", [
    "targetRepository", "providerRepositoryId", "nameWithOwner", "topLevelDigest",
    "gitCommonDirectoryDigest", "originUrlDigest",
  ]);
  for (const name of ["targetRepository", "providerRepositoryId", "nameWithOwner"]) {
    requireText(value[name], `current repository ${name}`);
  }
  for (const name of ["topLevelDigest", "gitCommonDirectoryDigest", "originUrlDigest"]) {
    requireDigest(value[name], `current repository ${name}`);
  }
  if (value.targetRepository !== value.nameWithOwner) invalid("current repository identity");
}

function requireController(value, repository) {
  exactObject(value, "current controller", [
    "repository", "providerRepositoryId", "nameWithOwner", "branch", "headSha",
    "originMainSha", "remoteMainSha", "runtimeDigest", "clean", "protected", "protectionDigest",
  ]);
  if (value.repository !== repository.targetRepository
    || value.nameWithOwner !== repository.nameWithOwner
    || value.providerRepositoryId !== repository.providerRepositoryId
    || value.branch !== "main" || value.clean !== true || value.protected !== true
    || requireSha(value.headSha, "current controller head")
      !== requireSha(value.originMainSha, "current controller origin/main")
    || value.headSha !== requireSha(value.remoteMainSha, "current controller remote main")) {
    invalid("clean current protected controller");
  }
  requireDigest(value.runtimeDigest, "current controller runtime");
  requireDigest(value.protectionDigest, "current controller protection");
}

function requireCanonical(value, repository, controller) {
  exactObject(value, "current canonical", [
    "targetRepository", "mainSha", "anchorBaseContained", "bridgeBaseContained",
    "successorBaseContained",
  ]);
  if (value.targetRepository !== repository.targetRepository
    || value.mainSha !== controller.remoteMainSha || value.anchorBaseContained !== true
    || value.bridgeBaseContained !== true || value.successorBaseContained !== true) {
    invalid("current canonical ancestry");
  }
}

function requirePreservation(value, associations) {
  exactObject(value, "current preservation", [
    "gitRefsDigest", "gitWorktreesDigest", "registryDigest", "providerDigest",
    "associationDigest",
  ]);
  for (const name of Object.keys(value)) requireDigest(value[name], `current preservation ${name}`);
  if (value.associationDigest !== digestValue(associations)) {
    invalid("current preservation association join");
  }
}

function sealProtectedAdvance(core) {
  return deepFreeze({ ...core, protectedAdvanceDigest: digestValue(core) });
}

function normalizeChangedPaths(value) {
  let paths;
  if (typeof value === "string") {
    paths = value.split("\0");
    if (paths.at(-1) === "") paths.pop();
  } else if (Array.isArray(value)) {
    paths = value;
  } else {
    invalid("protected advance changed paths");
  }
  if (paths.length === 0) invalid("protected advance changed paths");
  return normalizeWriteSet(paths.map(path => `path:${requireText(path,
    "protected advance changed path")}`)).map(scope => scope.slice("path:".length));
}

function exactObject(value, label, keys) {
  object(value, label);
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) invalid(label);
}
function clone(value) { return JSON.parse(canonicalJson(value)); }
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label);
  return value;
}
function requireDigest(value, label) {
  if (!DIGEST.test(String(value || ""))) invalid(label);
  return value;
}
function requireSha(value, label) {
  if (!SHA.test(String(value || ""))) invalid(label);
  return value;
}
function invalid(label) {
  throw new Error(`Waiting-bridge protected advance has invalid ${label}.`);
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
