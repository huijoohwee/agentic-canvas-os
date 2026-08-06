import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";

import {
  AUTHORIZATION_INTERACTION_RECEIPT_SCHEMA,
  CANDIDATE_MANIFEST_SCHEMA,
  DEPLOYMENT_RECEIPT_SCHEMA,
  HUMAN_AUTHORIZATION_RECEIPT_SCHEMA,
  INTEGRATION_RECEIPT_SCHEMA,
  LIVE_VERIFICATION_RECEIPT_V2_SCHEMA,
  OVERLAP_DISPOSITION_RECEIPT_SCHEMA,
  OVERLAP_PRESERVATION_RECEIPT_SCHEMA,
  PUBLICATION_RECEIPT_V2_SCHEMA,
  ROLLBACK_RECEIPT_SCHEMA,
  RUNTIME_REVIEW_RECEIPT_SCHEMA,
  STATE_RECONCILIATION_RECEIPT_SCHEMA,
  releaseKey,
  validateAuthorizationInteractionReceipt,
  validateCandidateManifest,
  validateConsumedDeploymentAuthorizationReceipt,
  validateDeploymentCandidateManifest,
  validateDeploymentReceipt,
  validateHumanAuthorizationReceipt,
  validateIntegrationReceipt,
  validateJoinedOverlapDisposition,
  validateLiveVerificationReceiptV2,
  validateOverlapDispositionReceipt,
  validateOverlapPreservationReceipt,
  validatePublicationReceiptV2,
  validateRollbackReceipt,
  validateRuntimeReviewReceipt,
  validateStateReconciliationReceipt,
} from "../collaborative-release-lifecycle-contract.mjs";

const schema = JSON.parse(readFileSync(
  new URL(
    "../../docs/schemas/agentic-sdlc-run.v1.schema.json",
    import.meta.url,
  ),
  "utf8",
));
const releaseLifecycleV1Schema = JSON.parse(readFileSync(
  new URL(
    "../../docs/schemas/collaborative-release-lifecycle.v1.schema.json",
    import.meta.url,
  ),
  "utf8",
));
const releaseLifecycleV2Schema = JSON.parse(readFileSync(
  new URL(
    "../../docs/schemas/collaborative-release-lifecycle.v2.schema.json",
    import.meta.url,
  ),
  "utf8",
));
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
ajv.addFormat("date-time", {
  type: "string",
  validate: (value) => {
    const parsed = Date.parse(value);
    return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
  },
});
ajv.addSchema(releaseLifecycleV1Schema);
ajv.addSchema(releaseLifecycleV2Schema);
const validate = ajv.compile(schema);

export function assertCanonicalRunSchema(artifact) {
  if (!validate(artifact)) {
    const details = [...(validate.errors ?? [])]
      .map((error) =>
        `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
      .sort((left, right) => left.localeCompare(right, "en"))
      .join("; ");
    throw schemaError(details);
  }
  try {
    assertReleaseLifecycleSemantics(artifact.releaseLifecycle);
  } catch (error) {
    throw schemaError(error instanceof Error ? error.message : String(error));
  }
  return artifact;
}

function assertReleaseLifecycleSemantics(lifecycle) {
  if (lifecycle?.schema !== "agentic-collaborative-release-lifecycle/v2") return;
  const receipts = lifecycle.receipts;
  const preservation = findReceipt(receipts, OVERLAP_PRESERVATION_RECEIPT_SCHEMA);
  const disposition = findReceipt(receipts, OVERLAP_DISPOSITION_RECEIPT_SCHEMA);
  const integration = findReceipt(receipts, INTEGRATION_RECEIPT_SCHEMA);
  const review = findReceipt(receipts, RUNTIME_REVIEW_RECEIPT_SCHEMA);
  const candidate = findReceipt(receipts, CANDIDATE_MANIFEST_SCHEMA);
  const interaction = findReceipt(receipts, AUTHORIZATION_INTERACTION_RECEIPT_SCHEMA);
  const authorization = findReceipt(
    receipts,
    HUMAN_AUTHORIZATION_RECEIPT_SCHEMA,
    "authorized",
  );
  const consumed = findReceipt(
    receipts,
    HUMAN_AUTHORIZATION_RECEIPT_SCHEMA,
    "consumed",
  );
  const deployment = findReceipt(receipts, DEPLOYMENT_RECEIPT_SCHEMA);
  const state = findReceipt(receipts, STATE_RECONCILIATION_RECEIPT_SCHEMA);
  const live = findReceipt(receipts, LIVE_VERIFICATION_RECEIPT_V2_SCHEMA);
  const publication = findReceipt(receipts, PUBLICATION_RECEIPT_V2_SCHEMA);
  const rollback = findReceipt(receipts, ROLLBACK_RECEIPT_SCHEMA);

  if (preservation) validateOverlapPreservationReceipt(preservation);
  if (disposition) validateOverlapDispositionReceipt(disposition);
  if (integration) validateIntegrationReceipt(integration);
  if (review) validateRuntimeReviewReceipt(review);
  if (candidate) {
    validateCandidateManifest(candidate);
    validateDeploymentCandidateManifest(candidate);
  }
  if (interaction) validateAuthorizationInteractionReceipt(interaction);
  if (authorization) validateHumanAuthorizationReceipt(authorization);
  if (consumed) validateConsumedDeploymentAuthorizationReceipt(consumed);
  if (deployment) validateDeploymentReceipt(deployment);
  if (state) validateStateReconciliationReceipt(state);
  if (live) validateLiveVerificationReceiptV2(live);
  if (publication) validatePublicationReceiptV2(publication);
  if (rollback) validateRollbackReceipt(rollback);

  if (disposition) {
    requirePredecessors(preservation, "Overlap disposition", "preservation");
    validateJoinedOverlapDisposition(preservation, disposition);
    assertNotBefore(disposition.observedAt, preservation.capturedAt, "Overlap disposition");
  }
  if (integration) {
    requirePredecessors(
      preservation && disposition,
      "Integration",
      "preservation and overlap disposition",
    );
    assertFieldsEqual(integration, {
      preservationReceiptDigest: preservation.receiptDigest,
      overlapDispositionReceiptDigest: disposition.receiptDigest,
    }, "Integration");
    assertNotBefore(integration.integratedAt, disposition.observedAt, "Integration");
  }
  if (review) {
    requirePredecessors(integration, "Runtime review", "integration");
    assertFieldsEqual(review, {
      integrationReceiptDigest: integration.receiptDigest,
      sourceDigest: integration.sourceDigest,
      dependencyClosureDigest: integration.dependencyClosureDigest,
    }, "Runtime review");
    assertNotBefore(review.issuedAt, integration.integratedAt, "Runtime review");
    assertWindow(review.issuedAt, review.expiresAt, "Runtime review");
  }
  if (candidate) {
    requirePredecessors(review, "Candidate", "runtime review");
    assertFieldsEqual(candidate, {
      runtimeReviewReceiptDigest: review.receiptDigest,
      sourceDigest: review.sourceDigest,
      dependencyClosureDigest: review.dependencyClosureDigest,
      policyDigest: review.policyDigest,
    }, "Candidate");
    assertWithinWindow(candidate.builtAt, review.issuedAt, review.expiresAt, "Candidate");
  }
  if (interaction) {
    requirePredecessors(candidate, "Authorization interaction", "candidate");
    assertFieldsEqual(interaction, {
      candidateDigest: candidate.receiptDigest,
      targetDigest: candidate.targetDigest,
    }, "Authorization interaction");
    assertWithinWindow(
      interaction.recordedAt,
      candidate.builtAt,
      review.expiresAt,
      "Authorization interaction",
    );
  }
  if (authorization) {
    requirePredecessors(
      candidate && interaction,
      "Human authorization",
      "candidate and interaction",
    );
    assertFieldsEqual(authorization, {
      candidateDigest: candidate.receiptDigest,
      targetDigest: candidate.targetDigest,
      releaseKey: releaseKey(candidate.targetDigest, candidate.receiptDigest),
      humanActorId: interaction.humanActorId,
      interactionReceiptDigest: interaction.receiptDigest,
    }, "Human authorization");
    assertWithinWindow(
      authorization.issuedAt,
      interaction.recordedAt,
      review.expiresAt,
      "Human authorization",
    );
    assertWindow(authorization.issuedAt, authorization.expiresAt, "Human authorization");
  }
  if (consumed) {
    requirePredecessors(
      candidate && authorization,
      "Consumed authorization",
      "candidate and issued authorization",
    );
    assertFieldsEqual(consumed, {
      candidateDigest: candidate.receiptDigest,
      targetDigest: candidate.targetDigest,
      authorizationReceiptDigest: authorization.receiptDigest,
    }, "Consumed authorization");
  }
  if (deployment) {
    requirePredecessors(candidate && consumed, "Deployment", "candidate and consumed authorization");
    assertFieldsEqual(deployment, {
      consumedAuthorizationReceiptDigest: consumed.receiptDigest,
      candidateDigest: candidate.receiptDigest,
      targetDigest: candidate.targetDigest,
      releaseKey: consumed.releaseKey,
      controllerId: consumed.controllerId,
      deployedArtifactDigest: candidate.artifactDigest,
      rollbackTargetDigest: candidate.rollbackTargetDigest,
    }, "Deployment");
    assertFieldsEqual(consumed, {
      candidateDigest: candidate.receiptDigest,
      targetDigest: candidate.targetDigest,
    }, "Consumed authorization");
    assertNotBefore(deployment.deployedAt, consumed.consumedAt, "Deployment");
  }
  if (state) {
    requirePredecessors(deployment, "State reconciliation", "deployment");
    assertFieldsEqual(state, {
      deploymentReceiptDigest: deployment.receiptDigest,
      candidateDigest: deployment.candidateDigest,
      targetDigest: deployment.targetDigest,
      controllerId: deployment.controllerId,
    }, "State reconciliation");
    assertNotBefore(state.reconciledAt, deployment.deployedAt, "State reconciliation");
  }
  if (live) {
    requirePredecessors(deployment && state, "Live verification", "deployment and state reconciliation");
    assertFieldsEqual(live, {
      deploymentReceiptDigest: deployment.receiptDigest,
      stateReconciliationReceiptDigest: state.receiptDigest,
      candidateDigest: deployment.candidateDigest,
      targetDigest: deployment.targetDigest,
      controllerId: deployment.controllerId,
      deployedArtifactDigest: deployment.deployedArtifactDigest,
      rollbackTargetDigest: deployment.rollbackTargetDigest,
    }, "Live verification");
    assertNotBefore(live.verifiedAt, state.reconciledAt, "Live verification");
  }
  if (publication) {
    requirePredecessors(live, "Publication", "live verification v2");
    assertFieldsEqual(publication, {
      liveVerificationReceiptDigest: live.receiptDigest,
      candidateDigest: live.candidateDigest,
      targetDigest: live.targetDigest,
    }, "Publication");
    assertNotBefore(publication.publishedAt, live.verifiedAt, "Publication");
  }
  if (rollback) {
    requirePredecessors(deployment, "Rollback", "deployment");
    assertFieldsEqual(rollback, {
      deploymentReceiptDigest: deployment.receiptDigest,
      candidateDigest: deployment.candidateDigest,
      targetDigest: deployment.targetDigest,
      controllerId: deployment.controllerId,
      deployedArtifactDigest: deployment.deployedArtifactDigest,
      rollbackTargetDigest: deployment.rollbackTargetDigest,
    }, "Rollback");
    assertRollbackStage(rollback, state, live);
    assertNotBefore(
      rollback.rolledBackAt,
      live?.verifiedAt ?? state?.reconciledAt ?? deployment.deployedAt,
      "Rollback",
    );
  }
  if (lifecycle.completion === "production-complete" && (!publication || rollback)) {
    throw new Error("Production completion requires publication v2 and forbids rollback.");
  }
  if (lifecycle.completion === "rolled-back" && (!rollback || publication)) {
    throw new Error("Rollback completion requires rollback and forbids publication v2.");
  }
  if (lifecycle.completion === "in-progress" && (publication || rollback)) {
    throw new Error("In-progress completion cannot contain a terminal receipt.");
  }
}

function findReceipt(receipts, receiptSchema, status) {
  return receipts.find((receipt) =>
    receipt.schema === receiptSchema && (!status || receipt.status === status));
}

function requirePredecessors(value, label, predecessors) {
  if (!value) throw new Error(`${label} requires its ${predecessors} predecessor receipts.`);
}

function assertFieldsEqual(receipt, expected, label) {
  for (const [field, value] of Object.entries(expected)) {
    if (receipt[field] !== value) {
      throw new Error(`${label} is unjoined at ${field}.`);
    }
  }
}

function assertNotBefore(observedAt, predecessorAt, label) {
  if (Date.parse(observedAt) < Date.parse(predecessorAt)) {
    throw new Error(`${label} predates its joined predecessor.`);
  }
}

function assertWindow(issuedAt, expiresAt, label) {
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    throw new Error(`${label} expiry must follow issue time.`);
  }
}

function assertWithinWindow(observedAt, issuedAt, expiresAt, label) {
  if (
    Date.parse(observedAt) < Date.parse(issuedAt)
    || Date.parse(observedAt) > Date.parse(expiresAt)
  ) throw new Error(`${label} is outside its predecessor validity window.`);
}

function assertRollbackStage(rollback, state, live) {
  const needsState = [
    "live-verification",
    "publication",
    "receipt-persistence",
  ].includes(rollback.failedStage);
  const needsLive = ["publication", "receipt-persistence"]
    .includes(rollback.failedStage);
  if (Boolean(state) !== needsState || Boolean(live) !== needsLive) {
    throw new Error("Rollback evidence contradicts its failedStage.");
  }
}

function schemaError(details) {
  return new TypeError(
    `agentic-sdlc-run/v1 schema validation failed: ${details || "unknown error"}`,
  );
}

export {
  schema as AGENTIC_SDLC_RUN_JSON_SCHEMA,
  releaseLifecycleV1Schema as COLLABORATIVE_RELEASE_LIFECYCLE_JSON_SCHEMA,
  releaseLifecycleV1Schema as COLLABORATIVE_RELEASE_LIFECYCLE_V1_JSON_SCHEMA,
  releaseLifecycleV2Schema as COLLABORATIVE_RELEASE_LIFECYCLE_V2_JSON_SCHEMA,
};
