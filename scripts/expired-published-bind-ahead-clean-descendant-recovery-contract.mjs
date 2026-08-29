// Responsibility: Seal one exact-authorized bind-ahead recovery plan and replay journal.
import { canonicalJson, digestValue }
  from "./cloud-collaboration-primitives.mjs";
import { normalizeExpiredPublishedBindAheadCleanDescendantRecoveryEvidence }
  from "./expired-published-bind-ahead-clean-descendant-recovery-evidence.mjs";

export const EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_OPERATION =
  "expired-published-bind-ahead-clean-descendant-recovery";
export const EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_AUTHORIZATION_PREFIX =
  `authorize ${EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_OPERATION}`;
export const EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_PLAN_SCHEMA =
  "agentic-expired-published-bind-ahead-clean-descendant-recovery-plan/v1";
export const EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_AUTHORIZATION_SCHEMA =
  "agentic-expired-published-bind-ahead-clean-descendant-recovery-authorization/v1";
export const EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_INTENT_SCHEMA =
  "agentic-expired-published-bind-ahead-clean-descendant-recovery-intent/v1";
export const EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_PHASE_RECEIPT_SCHEMA =
  "agentic-expired-published-bind-ahead-clean-descendant-recovery-phase-receipt/v1";
export const EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_COMPLETION_SCHEMA =
  "agentic-expired-published-bind-ahead-clean-descendant-recovery-completion/v1";

export const EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_PHASES =
  Object.freeze([
    "authorized",
    "task-authority-verified",
    "branch-fence-attempted",
    "branch-fenced",
    "bind-adopted",
    "cloud-attempted",
    "cloud-reconciled",
    "local-attempted",
    "local-projected",
    "marker-attempted",
    "marker-projected",
    "verified",
    "complete",
  ]);

export const EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_MUTATION_POLICY =
  deepFreeze({
    allowed: [
      "same-claim-dormant-recovery",
      "same-claim-projection-horizon-renewal",
      "writer-registry-branch-controller-fence",
      "writer-registry-branch-controller-fence-release-after-complete",
      "local-writer-lease-continuation-cas",
      "pull-request-hidden-marker-projection",
      "private-replay-journal",
    ],
    bindAdoption: "observation-only",
    cloudMutation:
      "conditional-same-claim-renewal-or-dormant-recovery-only",
    bindReplay: false,
    reviewTransition: false,
    sourceMutation: false,
    gitMutation: false,
    indexMutation: false,
    localRefMutation: false,
    remoteRefMutation: false,
    pullRequestStateMutation: false,
    pullRequestVisibleBodyMutation: false,
    newClaimMutation: false,
    newPullRequestMutation: false,
    mergeMutation: false,
    integrationMutation: false,
    releaseMutation: false,
    deploymentMutation: false,
    cleanupMutation: false,
    authoringAuthorityGrantedAtTerminal: true,
    integrationAuthorityGranted: false,
    releaseAuthorityGranted: false,
    deploymentAuthorityGranted: false,
    cleanupAuthorityGranted: false,
  });

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;

export function buildExpiredPublishedBindAheadCleanDescendantRecoveryPlan({
  evidence,
  ttlSeconds = 1_800,
} = {}) {
  const normalizedEvidence = deepFreeze(structuredClone(
    normalizeExpiredPublishedBindAheadCleanDescendantRecoveryEvidence(evidence),
  ));
  const ttl = boundedInteger(ttlSeconds, 300, 3_600, "recovery TTL");
  const core = {
    schema: EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_PLAN_SCHEMA,
    operation: EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_OPERATION,
    evidence: normalizedEvidence,
    ttlSeconds: ttl,
    mutationPolicy:
      EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_MUTATION_POLICY,
    terminalStatus: "authoring-authority-restored",
  };
  const planDigest = digestValue(core);
  const recoveryEvidenceDigest = digestValue({
    schema:
      "agentic-expired-published-bind-ahead-clean-descendant-cloud-recovery-evidence/v1",
    planDigest,
    evidenceDigest: normalizedEvidence.evidenceDigest,
    snapshotDigest: normalizedEvidence.committed.snapshotDigest,
    bindProofDigest: normalizedEvidence.cloud.bindProofDigest,
    sourceFenceSha: normalizedEvidence.committed.sourceFenceSha,
    publishedHeadSha: normalizedEvidence.committed.publishedHeadSha,
    preservedHeadSha: normalizedEvidence.committed.localHeadSha,
  });
  return deepFreeze({
    ...core,
    planDigest,
    recoveryEvidenceDigest,
    exactAuthorization:
      `${EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_AUTHORIZATION_PREFIX} ${planDigest}`,
    taskAuthorityOperation:
      `${EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_OPERATION}:${planDigest}`,
  });
}

export function normalizeExpiredPublishedBindAheadCleanDescendantRecoveryPlan(value) {
  if (value?.schema
      !== EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_PLAN_SCHEMA) {
    invalid("plan schema");
  }
  const rebuilt = buildExpiredPublishedBindAheadCleanDescendantRecoveryPlan({
    evidence: value.evidence,
    ttlSeconds: value.ttlSeconds,
  });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("plan projection");
  return rebuilt;
}

export function authorizeExpiredPublishedBindAheadCleanDescendantRecovery(
  planValue,
  authorization,
) {
  const plan = normalizeExpiredPublishedBindAheadCleanDescendantRecoveryPlan(
    planValue,
  );
  if (authorization !== plan.exactAuthorization) {
    throw new Error(`Exact authorization required: ${plan.exactAuthorization}`);
  }
  const core = {
    schema:
      EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_AUTHORIZATION_SCHEMA,
    planDigest: plan.planDigest,
    evidenceDigest: plan.evidence.evidenceDigest,
    authorization,
  };
  return deepFreeze({ ...core, authorizationDigest: digestValue(core) });
}

export function createExpiredPublishedBindAheadCleanDescendantRecoveryIntent(
  planValue,
  authorizationValue,
) {
  const plan = normalizeExpiredPublishedBindAheadCleanDescendantRecoveryPlan(
    planValue,
  );
  const authorization = normalizeAuthorization(authorizationValue, plan);
  const authorized = buildPhaseReceipt({
    plan,
    authorizationDigest: authorization.authorizationDigest,
    phase: "authorized",
    previousReceiptDigest: null,
    values: { authorizationDigest: authorization.authorizationDigest },
  });
  return sealIntent({
    status: "authorized",
    plan,
    authorization,
    phases: { authorized },
    completion: null,
  });
}

export function advanceExpiredPublishedBindAheadCleanDescendantRecoveryIntent(
  value,
  { status, values = {} } = {},
) {
  const current = normalizeExpiredPublishedBindAheadCleanDescendantRecoveryIntent(
    value,
  );
  const sourceIndex =
    EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_PHASES
      .indexOf(current.status);
  const targetIndex =
    EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_PHASES
      .indexOf(status);
  if (targetIndex !== sourceIndex + 1) invalid("phase transition");
  const next = buildPhaseReceipt({
    plan: current.planSnapshot,
    authorizationDigest: current.authorizationDigest,
    phase: status,
    previousReceiptDigest: current.phases[current.status].receiptDigest,
    values,
  });
  const phases = { ...current.phases, [status]: next };
  const completion = status === "complete"
    ? buildCompletionReceipt({
      plan: current.planSnapshot,
      authorization: current.authorization,
      phases,
    })
    : null;
  return sealIntent({
    status,
    plan: current.planSnapshot,
    authorization: current.authorization,
    phases,
    completion,
  });
}

export function normalizeExpiredPublishedBindAheadCleanDescendantRecoveryIntent(
  value,
) {
  if (value?.schema
      !== EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_INTENT_SCHEMA
    || !EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_PHASES
      .includes(value.status)) {
    invalid("intent");
  }
  const plan = normalizeExpiredPublishedBindAheadCleanDescendantRecoveryPlan(
    value.planSnapshot,
  );
  const authorization = normalizeAuthorization(value.authorization, plan);
  const names =
    EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_PHASES.slice(
      0,
      EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_PHASES
        .indexOf(value.status) + 1,
    );
  if (canonicalJson(Object.keys(value.phases || {})) !== canonicalJson(names)) {
    invalid("intent phases");
  }
  const phases = {};
  let previousReceiptDigest = null;
  for (const phase of names) {
    const receipt = buildPhaseReceipt({
      plan,
      authorizationDigest: authorization.authorizationDigest,
      phase,
      previousReceiptDigest,
      values: value.phases?.[phase]?.values,
    });
    phases[phase] = receipt;
    previousReceiptDigest = receipt.receiptDigest;
  }
  const completion = value.status === "complete"
    ? buildCompletionReceipt({ plan, authorization, phases })
    : null;
  const rebuilt = sealIntent({
    status: value.status,
    plan,
    authorization,
    phases,
    completion,
  });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("intent projection");
  return rebuilt;
}

export function buildExpiredPublishedBindAheadCleanDescendantRecoveryCompletionReceipt(
  value,
) {
  const intent = normalizeExpiredPublishedBindAheadCleanDescendantRecoveryIntent(
    value,
  );
  if (intent.status !== "complete") invalid("completion phase");
  return intent.completion;
}

export function expiredPublishedBindAheadCleanDescendantRecoveryOperationKey(
  planValue,
  authorizationDigest,
  phase,
) {
  const plan = normalizeExpiredPublishedBindAheadCleanDescendantRecoveryPlan(
    planValue,
  );
  if (!EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_PHASES
    .includes(phase)) invalid("phase");
  return `${EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_OPERATION}:${phase}:${digestValue({
    planDigest: plan.planDigest,
    authorizationDigest: digest(authorizationDigest, "authorization digest"),
    phase,
  })}`;
}

export function buildExpiredPublishedBindAheadCleanDescendantRecoveryBindAdoption(
  planValue,
  revalidationDigest,
) {
  const plan = normalizeExpiredPublishedBindAheadCleanDescendantRecoveryPlan(
    planValue,
  );
  const proof = plan.evidence.cloud;
  const core = {
    bindProofDigest: proof.bindProofDigest,
    claimId: proof.targetEntry.claimId,
    sourceClaimDigest: proof.sourceEntry.claimDigest,
    sourceFenceSha: plan.evidence.committed.sourceFenceSha,
    sourceTransitionCounter: proof.sourceEntry.claimCore.transitionCounter,
    targetClaimDigest: proof.targetEntry.claimDigest,
    targetOperationReceiptDigest: proof.targetOperationReceipt.receiptDigest,
    targetTransitionCounter: proof.targetEntry.claimCore.transitionCounter,
    targetTransitionDigest: proof.targetEntry.digest,
    publishedHeadSha: plan.evidence.committed.publishedHeadSha,
    revalidationDigest: digest(revalidationDigest, "bind revalidation digest"),
    disposition: "adopted-existing-device-review-bind",
    cloudMutation: false,
    bindReplay: false,
    reviewTransition: false,
  };
  return deepFreeze({ ...core, adoptionDigest: digestValue(core) });
}

export function normalizeExpiredPublishedBindAheadCleanDescendantRecoveryPhaseValues(
  planValue,
  phase,
  values,
) {
  const plan = normalizeExpiredPublishedBindAheadCleanDescendantRecoveryPlan(
    planValue,
  );
  const source = structuredClone(record(values, `${phase} values`));
  if (phase === "authorized") {
    exactKeys(source, ["authorizationDigest"], phase);
    digest(source.authorizationDigest, "authorization digest");
  } else if (phase === "task-authority-verified") {
    exactKeys(source, [
      "bindingDigest", "taskAuthorityReceiptDigest", "taskProofDigest",
    ], phase);
    for (const key of Object.keys(source)) digest(source[key], `${phase} ${key}`);
    if (source.bindingDigest
      !== plan.evidence.committed.taskAuthorityBindingDigest) {
      invalid("task-authority binding join");
    }
  } else if (phase === "branch-fence-attempted") {
    exactKeys(source, [
      "revalidationDigest", "sourceClaimId", "sourceLeaseDigest",
    ], phase);
    for (const key of Object.keys(source)) digest(source[key], `${phase} ${key}`);
    if (source.sourceClaimId !== plan.evidence.cloud.liveClaim.claimId
      || source.sourceLeaseDigest !== plan.evidence.committed.sourceLeaseDigest) {
      invalid("branch-fence attempt subject");
    }
  } else if (phase === "branch-fenced") {
    exactKeys(source, [
      "disposition", "fenceDigest", "registryRevision", "sourceClaimId",
      "sourceLeaseDigest", "writerRegistryMutation",
    ], phase);
    if (!["acquired", "adopted-response-loss"].includes(source.disposition)
      || source.writerRegistryMutation !== (source.disposition === "acquired")
      || source.sourceClaimId !== plan.evidence.cloud.liveClaim.claimId
      || source.sourceLeaseDigest !== plan.evidence.committed.sourceLeaseDigest) {
      invalid("branch-controller fence disposition");
    }
    digest(source.fenceDigest, "branch-controller fence digest");
    positiveInteger(source.registryRevision, "branch-controller fence registry revision");
  } else if (phase === "bind-adopted") {
    exactKeys(source, [
      "adoptionDigest", "bindProofDigest", "bindReplay", "claimId",
      "cloudMutation", "disposition", "publishedHeadSha",
      "revalidationDigest", "reviewTransition", "sourceClaimDigest",
      "sourceFenceSha", "sourceTransitionCounter", "targetClaimDigest",
      "targetOperationReceiptDigest", "targetTransitionCounter",
      "targetTransitionDigest",
    ], phase);
    const expected =
      buildExpiredPublishedBindAheadCleanDescendantRecoveryBindAdoption(
        plan,
        source.revalidationDigest,
      );
    if (canonicalJson(source) !== canonicalJson(expected)) {
      invalid("bind adoption projection");
    }
  } else if (phase === "cloud-attempted") {
    exactKeys(source, [
      "claimState", "recoveryEvidenceDigest", "revalidationDigest",
    ], phase);
    if (!["current-bind", "dormant-bind", "recovered", "dormant-recovered"]
      .includes(source.claimState)
      || digest(source.recoveryEvidenceDigest, "recovery evidence digest")
        !== plan.recoveryEvidenceDigest) invalid("cloud attempt state");
    digest(source.revalidationDigest, "cloud revalidation digest");
  } else if (phase === "cloud-reconciled") {
    exactKeys(source, [
      "authorityDigest", "claimDigest", "claimId", "cloudLedgerMutation",
      "disposition", "operationReceiptDigest", "recoveryEvidenceDigest",
      "recoveryTransitionRecorded", "responseLossAdopted", "transitionCounter",
      "sidecarHeadDigest", "transitionDigest", "verificationReceiptDigest", "verifiedAt",
    ], phase);
    normalizeCloudReconciliation(plan, source);
  } else if (phase === "local-attempted") {
    exactKeys(source, [
      "cloudAuthorityDigest", "preservedHeadSha", "publishedFenceSha",
      "revalidationDigest", "sourceLeaseDigest",
    ], phase);
    digest(source.cloudAuthorityDigest, "cloud authority digest");
    digest(source.revalidationDigest, "local revalidation digest");
    if (source.sourceLeaseDigest !== plan.evidence.committed.sourceLeaseDigest
      || source.publishedFenceSha !== plan.evidence.committed.publishedHeadSha
      || source.preservedHeadSha !== plan.evidence.committed.localHeadSha) {
      invalid("local attempt subject");
    }
  } else if (phase === "local-projected") {
    exactKeys(source, [
      "cloudAuthorityDigest", "disposition", "registryRevision",
      "sidecarHeadDigest", "sourceLeaseDigest", "targetLeaseDigest",
      "taskAuthorityBindingDigest",
      "writerRegistryMutation",
    ], phase);
    if (!["projected", "adopted-response-loss"].includes(source.disposition)
      || source.writerRegistryMutation !== true
      || source.sourceLeaseDigest !== plan.evidence.committed.sourceLeaseDigest
      || source.taskAuthorityBindingDigest
        !== plan.evidence.committed.taskAuthorityBindingDigest) {
      invalid("local projection disposition");
    }
    for (const key of [
      "cloudAuthorityDigest", "sourceLeaseDigest", "targetLeaseDigest",
      "sidecarHeadDigest", "taskAuthorityBindingDigest",
    ]) digest(source[key], `local ${key}`);
    positiveInteger(source.registryRevision, "registry revision");
  } else if (phase === "marker-attempted") {
    exactKeys(source, [
      "markerState", "revalidationDigest", "sourceBodyDigest",
      "sourceMarkerDigest", "targetLeaseDigest",
    ], phase);
    if (!["source", "stale-target", "target"].includes(source.markerState)
      || source.sourceBodyDigest !== plan.evidence.pullRequest.sourceBodyDigest
      || source.sourceMarkerDigest !== plan.evidence.pullRequest.sourceMarkerDigest) {
      invalid("marker attempt subject");
    }
    digest(source.revalidationDigest, "marker revalidation digest");
    digest(source.targetLeaseDigest, "marker target lease digest");
  } else if (phase === "marker-projected") {
    exactKeys(source, [
      "bodyDigest", "cloudAuthorityDigest", "cloudContinuationCount",
      "cloudDisposition", "cloudGenerationCount", "cloudLedgerMutation",
      "cloudRecoveryCount", "cloudRenewalCount", "cloudResponseLossAdopted",
      "disposition", "markerDigest", "providerMutation", "registryRevision",
      "sidecarHeadDigest", "targetLeaseDigest", "visibleBodyDigest",
    ], phase);
    if (!["projected", "adopted-response-loss"].includes(source.disposition)
      || source.providerMutation !== (source.disposition === "projected")
      || source.visibleBodyDigest
        !== plan.evidence.pullRequest.visibleBodyDigest) {
      invalid("marker projection disposition");
    }
    normalizeCloudSummary(source, "marker");
    for (const key of [
      "bodyDigest", "cloudAuthorityDigest", "markerDigest", "sidecarHeadDigest",
      "targetLeaseDigest",
    ]) {
      digest(source[key], `marker ${key}`);
    }
    positiveInteger(source.registryRevision, "marker registry revision");
  } else if (phase === "verified") {
    exactKeys(source, [
      "bodyDigest", "claimDigest", "claimId", "cloudAuthorityDigest",
      "cloudContinuationCount", "cloudDisposition", "cloudGenerationCount",
      "cloudLedgerMutation", "cloudRecoveryCount", "cloudRenewalCount",
      "cloudResponseLossAdopted", "cloudVerificationReceiptDigest", "markerDigest",
      "mutationAuthorityReceiptDigest", "operationReceiptDigest",
      "preservedHeadSha", "publishedFenceSha", "pullRequestHeadSha",
      "registryRevision", "remoteHeadSha", "sidecarHeadDigest", "sourceFenceSha",
      "targetLeaseDigest", "taskAuthorityBindingDigest", "transitionCounter",
      "transitionDigest", "verificationDigest", "visibleBodyDigest",
    ], phase);
    normalizeVerified(plan, source);
  } else if (phase === "complete") {
    exactKeys(source, ["verifiedReceiptDigest"], phase);
    digest(source.verifiedReceiptDigest, "verified receipt digest");
  } else {
    invalid("phase values");
  }
  return deepFreeze(source);
}

function normalizeCloudReconciliation(plan, source) {
  const proof = plan.evidence.cloud;
  for (const key of [
    "authorityDigest", "claimDigest", "claimId", "operationReceiptDigest",
    "recoveryEvidenceDigest", "sidecarHeadDigest", "transitionDigest",
    "verificationReceiptDigest",
  ]) digest(source[key], `cloud ${key}`);
  instant(source.verifiedAt, "cloud verifiedAt");
  positiveInteger(source.transitionCounter, "cloud transition counter");
  if (source.recoveryEvidenceDigest !== plan.recoveryEvidenceDigest) {
    invalid("cloud recovery evidence join");
  }
  if (source.claimId !== proof.targetEntry.claimId) {
    invalid("same-claim cloud reconciliation");
  }
  const bind = source.disposition === "adopted-current-bind";
  const recovered = [
    "recovered-dormant", "adopted-recovery-response-loss",
  ].includes(source.disposition);
  const directRecovery = source.disposition === "recovered-dormant";
  if ((!bind && !recovered)
    || source.cloudLedgerMutation !== directRecovery
    || source.recoveryTransitionRecorded !== recovered
    || source.responseLossAdopted
      !== (source.disposition === "adopted-recovery-response-loss")) {
    invalid("cloud reconciliation disposition");
  }
  if (bind && (
    source.transitionCounter !== proof.targetEntry.claimCore.transitionCounter
    || source.claimDigest !== proof.targetEntry.claimDigest
    || source.transitionDigest !== proof.targetEntry.digest
    || source.operationReceiptDigest !== proof.targetOperationReceipt.receiptDigest
  )) invalid("adopted bind claim join");
  if (recovered
    && source.transitionCounter
      < proof.targetEntry.claimCore.transitionCounter + 1) {
    invalid("same-claim recovery transition");
  }
  if (recovered && (
    source.claimDigest === proof.targetEntry.claimDigest
    || source.transitionDigest === proof.targetEntry.digest
    || source.operationReceiptDigest === proof.targetOperationReceipt.receiptDigest
  )) invalid("recovery transition must advance the bind entry");
}

function normalizeVerified(plan, source) {
  for (const key of [
    "bodyDigest", "claimDigest", "claimId", "cloudAuthorityDigest",
    "cloudVerificationReceiptDigest", "markerDigest",
    "mutationAuthorityReceiptDigest", "operationReceiptDigest",
    "sidecarHeadDigest", "targetLeaseDigest", "taskAuthorityBindingDigest",
    "transitionDigest",
    "verificationDigest", "visibleBodyDigest",
  ]) digest(source[key], `verified ${key}`);
  for (const key of [
    "preservedHeadSha", "publishedFenceSha", "pullRequestHeadSha",
    "remoteHeadSha", "sourceFenceSha",
  ]) sha(source[key], `verified ${key}`);
  positiveInteger(source.registryRevision, "verified registry revision");
  positiveInteger(source.transitionCounter, "verified transition counter");
  normalizeCloudSummary(source, "verified");
  const committed = plan.evidence.committed;
  if (source.sourceFenceSha !== committed.sourceFenceSha
    || source.publishedFenceSha !== committed.publishedHeadSha
    || source.remoteHeadSha !== committed.publishedHeadSha
    || source.pullRequestHeadSha !== committed.publishedHeadSha
    || source.preservedHeadSha !== committed.localHeadSha
    || source.visibleBodyDigest !== plan.evidence.pullRequest.visibleBodyDigest
    || source.claimId !== plan.evidence.cloud.targetEntry.claimId
    || source.cloudContinuationCount !== source.transitionCounter
      - plan.evidence.cloud.targetEntry.claimCore.transitionCounter
    || source.taskAuthorityBindingDigest !== committed.taskAuthorityBindingDigest) {
    invalid("terminal F < R <= H projection");
  }
}

function normalizeCloudSummary(source, label) {
  if (!new Set([
    "adopted-current-bind",
    "recovered-dormant",
    "adopted-recovery-response-loss",
    "projection-recovered-dormant",
    "projection-renewed-current",
    "projection-adopted-recovery-response-loss",
    "projection-adopted-renewal-response-loss",
  ]).has(source.cloudDisposition)
    || typeof source.cloudLedgerMutation !== "boolean"
    || typeof source.cloudResponseLossAdopted !== "boolean") {
    invalid(`${label} cloud summary`);
  }
  positiveInteger(source.cloudGenerationCount, `${label} cloud generation count`);
  for (const key of [
    "cloudContinuationCount", "cloudRecoveryCount", "cloudRenewalCount",
  ]) {
    nonnegativeInteger(source[key], `${label} ${key}`);
  }
  if (source.cloudContinuationCount
      !== source.cloudRecoveryCount + source.cloudRenewalCount
    || source.cloudLedgerMutation !== (source.cloudContinuationCount > 0)) {
    invalid(`${label} cloud continuation summary`);
  }
}

function buildPhaseReceipt({
  plan, authorizationDigest, phase, previousReceiptDigest, values,
}) {
  const normalizedValues =
    normalizeExpiredPublishedBindAheadCleanDescendantRecoveryPhaseValues(
      plan,
      phase,
      values,
    );
  if (phase === "authorized"
    && normalizedValues.authorizationDigest !== authorizationDigest) {
    invalid("authorized phase join");
  }
  const core = {
    schema:
      EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_PHASE_RECEIPT_SCHEMA,
    phase,
    planDigest: plan.planDigest,
    authorizationDigest,
    operationKey: expiredPublishedBindAheadCleanDescendantRecoveryOperationKey(
      plan,
      authorizationDigest,
      phase,
    ),
    previousReceiptDigest,
    values: normalizedValues,
    valuesDigest: digestValue(normalizedValues),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function buildCompletionReceipt({ plan, authorization, phases }) {
  const required =
    EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_PHASES
      .filter(phase => phase !== "authorized");
  if (required.some(phase => !phases[phase])) invalid("completion phases");
  const task = phases["task-authority-verified"].values;
  const fence = phases["branch-fenced"].values;
  const bind = phases["bind-adopted"].values;
  const cloud = phases["cloud-reconciled"].values;
  const local = phases["local-projected"].values;
  const marker = phases["marker-projected"].values;
  const verified = phases.verified.values;
  const cloudSummaryKeys = [
    "cloudContinuationCount", "cloudDisposition", "cloudGenerationCount",
    "cloudLedgerMutation", "cloudRecoveryCount", "cloudRenewalCount",
    "cloudResponseLossAdopted",
  ];
  if (phases.complete.values.verifiedReceiptDigest
      !== phases.verified.receiptDigest
    || verified.claimId !== cloud.claimId
    || verified.cloudAuthorityDigest !== marker.cloudAuthorityDigest
    || verified.targetLeaseDigest !== marker.targetLeaseDigest
    || local.registryRevision < fence.registryRevision
    || marker.registryRevision < local.registryRevision
    || verified.registryRevision !== marker.registryRevision
    || verified.bodyDigest !== marker.bodyDigest
    || verified.markerDigest !== marker.markerDigest
    || verified.sidecarHeadDigest !== marker.sidecarHeadDigest
    || cloudSummaryKeys.some(key => verified[key] !== marker[key])
    || local.taskAuthorityBindingDigest !== task.bindingDigest) {
    invalid("terminal phase joins");
  }
  const committed = plan.evidence.committed;
  const core = {
    schema:
      EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_COMPLETION_SCHEMA,
    status: "authoring-authority-restored",
    planDigest: plan.planDigest,
    evidenceDigest: plan.evidence.evidenceDigest,
    authorizationDigest: authorization.authorizationDigest,
    taskAuthorityOperation: plan.taskAuthorityOperation,
    taskAuthorityBindingDigest: task.bindingDigest,
    taskAuthorityReceiptDigest: task.taskAuthorityReceiptDigest,
    taskProofDigest: task.taskProofDigest,
    branchControllerFenceDigest: fence.fenceDigest,
    branchControllerFenceRegistryRevision: fence.registryRevision,
    branchControllerFenceDisposition: fence.disposition,
    claimId: cloud.claimId,
    bindProofDigest: bind.bindProofDigest,
    bindAdoptionDigest: bind.adoptionDigest,
    sourceFenceSha: committed.sourceFenceSha,
    publishedFenceSha: committed.publishedHeadSha,
    preservedHeadSha: committed.localHeadSha,
    initialCloudDisposition: cloud.disposition,
    cloudDisposition: verified.cloudDisposition,
    cloudGenerationCount: verified.cloudGenerationCount,
    cloudContinuationCount: verified.cloudContinuationCount,
    cloudRenewalCount: verified.cloudRenewalCount,
    cloudRecoveryCount: verified.cloudRecoveryCount,
    cloudResponseLossAdopted: verified.cloudResponseLossAdopted,
    cloudClaimDigest: verified.claimDigest,
    cloudTransitionDigest: verified.transitionDigest,
    cloudTransitionCounter: verified.transitionCounter,
    cloudOperationReceiptDigest: verified.operationReceiptDigest,
    recoveryEvidenceDigest: plan.recoveryEvidenceDigest,
    cloudAuthorityDigest: verified.cloudAuthorityDigest,
    cloudVerificationReceiptDigest: verified.cloudVerificationReceiptDigest,
    cloudSidecarHeadDigest: verified.sidecarHeadDigest,
    sourceLeaseDigest: local.sourceLeaseDigest,
    targetLeaseDigest: verified.targetLeaseDigest,
    registryRevision: verified.registryRevision,
    localDisposition: local.disposition,
    markerDisposition: marker.disposition,
    targetBodyDigest: verified.bodyDigest,
    targetMarkerDigest: verified.markerDigest,
    mutationAuthorityReceiptDigest: verified.mutationAuthorityReceiptDigest,
    terminalVerificationDigest: verified.verificationDigest,
    mutationPolicy:
      EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_MUTATION_POLICY,
    privateJournalMutation: true,
    cloudLedgerMutation: verified.cloudLedgerMutation,
    writerRegistryMutation: true,
    pullRequestMarkerMutation: true,
    bindReplay: false,
    reviewTransition: false,
    sourceMutation: false,
    gitMutation: false,
    indexMutation: false,
    localRefMutation: false,
    remoteRefMutation: false,
    pullRequestStateMutation: false,
    pullRequestVisibleBodyMutation: false,
    newClaimMutation: false,
    newPullRequestMutation: false,
    mergeMutation: false,
    integrationMutation: false,
    releaseMutation: false,
    deploymentMutation: false,
    cleanupMutation: false,
    authoringAuthorityGranted: true,
    phaseReceiptDigests: deepFreeze(Object.fromEntries(
      EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_PHASES
        .map(phase => [phase, phases[phase].receiptDigest]),
    )),
  };
  return deepFreeze({ ...core, receiptDigest: digestValue(core) });
}

function sealIntent({ status, plan, authorization, phases, completion }) {
  const core = {
    schema:
      EXPIRED_PUBLISHED_BIND_AHEAD_CLEAN_DESCENDANT_RECOVERY_INTENT_SCHEMA,
    status,
    planDigest: plan.planDigest,
    planSnapshot: plan,
    authorization,
    authorizationDigest: authorization.authorizationDigest,
    phases,
    completion,
  };
  return deepFreeze({ ...core, intentDigest: digestValue(core) });
}

function normalizeAuthorization(value, plan) {
  const source = record(value, "authorization receipt");
  const expected = authorizeExpiredPublishedBindAheadCleanDescendantRecovery(
    plan,
    source.authorization,
  );
  if (canonicalJson(source) !== canonicalJson(expected)) {
    invalid("authorization receipt");
  }
  return expected;
}

function exactKeys(value, keys, label) {
  if (canonicalJson(Object.keys(value).sort())
      !== canonicalJson([...keys].sort())) invalid(`${label} fields`);
}
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function digest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) invalid(label);
  return value;
}
function sha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) invalid(label);
  return value;
}
function instant(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))
    || new Date(Date.parse(value)).toISOString() !== value) invalid(label);
  return value;
}
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}
function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(label);
  return value;
}
function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    invalid(label);
  }
  return value;
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
function invalid(label) {
  throw new Error(
    `Expired published bind-ahead clean-descendant contract has invalid ${label}.`,
  );
}
