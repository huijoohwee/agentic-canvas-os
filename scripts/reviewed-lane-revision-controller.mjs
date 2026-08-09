import {
  advanceReviewedLaneRevisionIntent,
  authorizeReviewedLaneRevision,
  buildReviewedLaneRevisionPlan,
  buildReviewedLaneRevisionReceipt,
  createReviewedLaneRevisionIntent,
  normalizeReviewedLaneRevisionIntent,
  normalizeReviewedLaneRevisionPlan,
  reviewedLaneRevisionOperationKey,
} from "./reviewed-lane-revision-contract.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";

const PUBLIC_CLAIM_FIELDS = Object.freeze([
  "claimId",
  "entrySchema",
  "claimIdentitySchema",
  "state",
  "writeAuthority",
  "scopeReserved",
  "actorId",
  "repositoryId",
  "workItemId",
  "canonicalBaseRevision",
  "laneRevision",
  "declaredWriteScope",
  "writeSetDigest",
  "leaseEpoch",
  "transitionCounter",
  "heartbeatCounter",
  "reviewRequestId",
  "predecessorClaimId",
  "expiresAt",
  "fenceRevision",
  "operationReceiptDigest",
  "integrationReceiptDigest",
  "integration",
]);

export const REVIEWED_LANE_REVISION_PHASES = Object.freeze([
  "prepared",
  "successor_waiting",
  "commit_created",
  "local_ref_updated",
  "remote_ref_updated",
  "source_retired",
  "successor_current",
  "successor_bound",
  "successor_review_ready",
  "lease_updated",
  "pr_projected",
  "verified",
  "complete",
]);

const TRANSITIONS = Object.freeze([
  ["successor_waiting", "createWaitingSuccessor"],
  ["commit_created", "createCommit"],
  ["local_ref_updated", "compareAndSwapLocalRef"],
  ["remote_ref_updated", "forceWithLeaseRemote"],
  ["source_retired", "retireSourceClaim"],
  ["successor_current", "promoteSuccessor"],
  ["successor_bound", "bindSuccessor"],
  ["successor_review_ready", "markSuccessorReviewReady"],
  ["lease_updated", "updateLease"],
  ["pr_projected", "projectPullRequest"],
  ["verified", "verifyTerminal"],
]);

const REQUIRED_METHODS = Object.freeze([
  "withEntrypointFence",
  "readSubject",
  "readIntent",
  "writeIntent",
  "reconcilePhase",
  ...TRANSITIONS.map(([, method]) => method),
]);

export function createReviewedLaneRevisionControllerAdapter(methods = {}) {
  const adapter = Object.freeze(Object.fromEntries(
    REQUIRED_METHODS.map(name => [name, methods[name]]),
  ));
  for (const name of REQUIRED_METHODS) {
    if (typeof adapter[name] !== "function") {
      throw new Error(`Reviewed lane revision adapter requires ${name}().`);
    }
  }
  return adapter;
}

export async function planReviewedLaneRevision(
  { replacementSubject } = {},
  { adapter } = {},
) {
  requireAdapter(adapter);
  const stored = await adapter.readIntent();
  if (stored) {
    const intent = normalizeReviewedLaneRevisionIntent(stored);
    const plan = normalizeReviewedLaneRevisionPlan(intent.planSnapshot);
    requireReplacementSubject(plan, replacementSubject);
    return plan;
  }
  const subject = await adapter.readSubject({ replacementSubject });
  return normalizeReviewedLaneRevisionPlan(buildReviewedLaneRevisionPlan({
    candidate: subject.candidate,
    replacementSubject,
    source: subject.source,
  }));
}

export async function runReviewedLaneRevision(
  { replacementSubject, authorization } = {},
  { adapter } = {},
) {
  requireAdapter(adapter);
  return adapter.withEntrypointFence({ replacementSubject }, async fence => executeRevision({
    adapter,
    authorization,
    fence,
    replacementSubject,
  }));
}

async function executeRevision({ adapter, authorization, fence, replacementSubject }) {
  let stored = await adapter.readIntent({ fence });
  let intent = stored ? normalizeReviewedLaneRevisionIntent(stored) : null;
  let plan;
  if (intent) {
    plan = normalizeReviewedLaneRevisionPlan(intent.planSnapshot);
    requireReplacementSubject(plan, replacementSubject);
  } else {
    const subject = await adapter.readSubject({ fence, replacementSubject });
    plan = normalizeReviewedLaneRevisionPlan(buildReviewedLaneRevisionPlan({
      candidate: subject.candidate,
      replacementSubject,
      source: subject.source,
    }));
  }
  const authorizationReceipt = authorizeReviewedLaneRevision({ plan, authorization });
  if (intent) assertAuthorizationReplay(intent, authorizationReceipt);

  if (!intent) {
    const candidate = normalizeReviewedLaneRevisionIntent(
      createReviewedLaneRevisionIntent(plan, authorizationReceipt),
    );
    intent = normalizeReviewedLaneRevisionIntent(await adapter.writeIntent({
      expectedIntent: null,
      fence,
      nextIntent: candidate,
      plan,
    }));
  }
  requirePhase(intent.status);
  await requireReconciled(adapter, { fence, intent, phase: "prepared", plan });

  for (const [phase, method] of TRANSITIONS) {
    if (atLeast(intent.status, phase)) {
      await requireReconciled(adapter, { fence, intent, phase, plan });
      continue;
    }
    assertNextPhase(intent.status, phase);
    const operationKey = reviewedLaneRevisionOperationKey(plan, phase);
    const values = await executeTransition({
      adapter,
      fence,
      intent,
      method,
      operationKey,
      phase,
      plan,
    });
    const candidate = normalizeReviewedLaneRevisionIntent(
      advanceReviewedLaneRevisionIntent(intent, { status: phase, values }),
    );
    intent = normalizeReviewedLaneRevisionIntent(await adapter.writeIntent({
      expectedIntent: intent,
      fence,
      nextIntent: candidate,
      plan,
    }));
    await requireReconciled(adapter, { fence, intent, phase, plan });
  }

  if (!atLeast(intent.status, "complete")) {
    assertNextPhase(intent.status, "complete");
    const receipt = buildReviewedLaneRevisionReceipt({
      intent,
      phase: "complete",
      plan,
      values: {
        verifiedReceiptDigest: intent.phases.verified.receiptDigest,
        verifiedValuesDigest: intent.phases.verified.valuesDigest,
      },
    });
    const candidate = normalizeReviewedLaneRevisionIntent(
      advanceReviewedLaneRevisionIntent(intent, {
        status: "complete",
        values: { receipt },
      }),
    );
    intent = normalizeReviewedLaneRevisionIntent(await adapter.writeIntent({
      expectedIntent: intent,
      fence,
      nextIntent: candidate,
      plan,
    }));
  }
  await requireReconciled(adapter, { fence, intent, phase: "complete", plan });
  return Object.freeze({
    schema: "agentic-reviewed-lane-revision-result/v1",
    status: "complete",
    planDigest: plan.planDigest,
    receipt: intent.receipt || intent.values?.receipt || null,
  });
}

async function executeTransition({
  adapter,
  fence,
  intent,
  method,
  operationKey,
  phase,
  plan,
}) {
  const context = { fence, intent, operationKey, phase, plan };
  let resolution = normalizeResolution(
    await adapter.reconcilePhase(context),
    operationKey,
    phase,
  );
  if (resolution.kind === "complete") return resolution.values;
  try {
    return requireOperationResult(await adapter[method](context), operationKey, phase);
  } catch (error) {
    resolution = normalizeResolution(
      await adapter.reconcilePhase(context),
      operationKey,
      phase,
    );
    if (resolution.kind === "pending") throw error;
    return resolution.values;
  }
}

async function requireReconciled(adapter, { fence, intent, phase, plan }) {
  const operationKey = reviewedLaneRevisionOperationKey(plan, phase);
  const resolution = normalizeResolution(
    await adapter.reconcilePhase({ fence, intent, operationKey, phase, plan }),
    operationKey,
    phase,
  );
  if (resolution.kind !== "complete") {
    throw new Error(`Reviewed lane revision phase ${phase} is not live-complete.`);
  }
  return resolution.values;
}

function normalizeResolution(value, operationKey, phase) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Reviewed lane revision phase ${phase} returned no reconciliation.`);
  }
  if (value.kind === "pending") return Object.freeze({ kind: "pending" });
  if (value.kind !== "complete") {
    throw new Error(`Reviewed lane revision phase ${phase} returned an invalid reconciliation kind.`);
  }
  return Object.freeze({
    kind: "complete",
    values: requireOperationResult(value.values, operationKey, phase),
  });
}

function requireOperationResult(value, operationKey, phase) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.operationKey !== operationKey) {
    throw new Error(`Reviewed lane revision phase ${phase} is not bound to its exact operation key.`);
  }
  return Object.freeze({ ...value });
}

function assertAuthorizationReplay(intent, receipt) {
  const storedDigest = intent.authorizationDigest
    || intent.authorization?.authorizationDigest;
  const nextDigest = receipt.authorizationDigest || receipt.receiptDigest;
  if (!storedDigest || !nextDigest || storedDigest !== nextDigest) {
    throw new Error("Stored reviewed lane revision authorization drifted.");
  }
}

function requireReplacementSubject(plan, replacementSubject) {
  if (plan.replacementSubject !== replacementSubject) {
    throw new Error("Replacement subject differs from the durable reviewed lane revision plan.");
  }
}

function assertNextPhase(current, expected) {
  const next = REVIEWED_LANE_REVISION_PHASES.indexOf(current) + 1;
  if (REVIEWED_LANE_REVISION_PHASES[next] !== expected) {
    throw new Error(`Reviewed lane revision cannot advance from ${current} to ${expected}.`);
  }
}

function atLeast(current, expected) {
  return requirePhase(current) >= requirePhase(expected);
}

function requirePhase(value) {
  const index = REVIEWED_LANE_REVISION_PHASES.indexOf(value);
  if (index < 0) throw new Error(`Unsupported reviewed lane revision phase: ${value}.`);
  return index;
}

function requireAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") {
    throw new Error("Reviewed lane revision requires a controller adapter.");
  }
}

export function reviewedLaneOperationIdentity(branch, replacementSubject) {
  return Object.freeze({ branch, entrypoint: "reviewed-lane-revision",
    operationDigest: digestValue({ schema: "agentic-reviewed-lane-revision-operation/v1",
      branch, replacementSubject }) });
}

export function reviewedLaneOperationResult(operationKey, values) {
  return Object.freeze({ operationKey, ...values });
}

export function reviewedLaneCompleteResolution(values) {
  return Object.freeze({ kind: "complete", values });
}

export function reviewedLaneRefResolution({ current, operationKey, replacement, source }) {
  const expectedSource = requireReviewedLaneSha(source, "planned source head SHA");
  const expectedReplacement = requireReviewedLaneSha(replacement, "planned replacement head SHA");
  if (current === expectedReplacement) return reviewedLaneCompleteResolution(
    reviewedLaneOperationResult(operationKey, { headSha: current }));
  if (current === expectedSource) return Object.freeze({ kind: "pending" });
  throw new Error("Reviewed lane revision ref escaped both authorized CAS endpoints.");
}

export function reviewedLaneGitObjectExists(gitText, commitSha) {
  try { return gitText(["cat-file", "-t", commitSha]) === "commit"; } catch { return false; }
}

export function assertReviewedLaneSameTreeAndParents({ gitText, local, commitSha }) {
  const treeSha = gitText(["show", "-s", "--format=%T", commitSha]);
  const parentShas = gitText(["show", "-s", "--format=%P", commitSha])
    .split(/\s+/u).filter(Boolean);
  if (treeSha !== local.treeSha || JSON.stringify(parentShas) !== JSON.stringify(local.parentShas)) {
    throw new Error("Replacement commit changed the reviewed tree or parent topology.");
  }
}

export function requireReviewedLaneFunction(value, name) {
  if (typeof value !== "function") throw new Error(`Reviewed lane revision requires ${name}().`);
}

export function requireReviewedLaneText(value, label) {
  const normalized = String(value || "");
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

export function requireReviewedLaneSha(value, label) {
  const normalized = String(value || "").trim();
  if (!/^[0-9a-f]{40}$/u.test(normalized)) throw new Error(`${label} must be an exact commit SHA.`);
  return normalized;
}

export function requireReviewedLaneDigest(value, label) {
  const normalized = String(value || "");
  if (!/^[0-9a-f]{64}$/u.test(normalized)) throw new Error(`${label} must be a SHA-256 digest.`);
  return normalized;
}

export function assertReviewedLaneSourceHeadProjection({ lease, local }) {
  if (local?.headSha !== local?.remoteHeadSha || lease?.reviewHeadSha !== local?.headSha) {
    throw new Error("Reviewed source local head, remote ref, and review head are not equal.");
  }
  return true;
}

export function joinReviewedLanePublicPrivateClaim({ publicClaim, privateClaim, lease } = {}) {
  if (!publicClaim || !privateClaim) {
    throw new Error("Reviewed lane revision requires public and private claim projections.");
  }
  for (const field of PUBLIC_CLAIM_FIELDS) {
    const publicValue = publicClaim[field] ?? null;
    const privateValue = privateClaim[field] ?? null;
    if (digestValue(publicValue) !== digestValue(privateValue)) {
      throw new Error(`Reviewed claim public/private ${field} drifted.`);
    }
  }
  if (publicClaim.transitionDigest !== privateClaim.ledgerRevision) {
    throw new Error("Reviewed claim public/private transition digest drifted.");
  }
  const expectedDevice = pseudonymousIdentifier(
    "device",
    requireReviewedLaneText(lease?.device, "lease device"),
  );
  const expectedSession = pseudonymousIdentifier(
    "session",
    requireReviewedLaneText(lease?.sessionId, "lease session"),
  );
  if (privateClaim.deviceId !== expectedDevice || privateClaim.sessionId !== expectedSession) {
    throw new Error("Reviewed claim private owner does not match the exact lease owner.");
  }
  return Object.freeze({
    ...publicClaim,
    deviceId: privateClaim.deviceId,
    sessionId: privateClaim.sessionId,
  });
}
