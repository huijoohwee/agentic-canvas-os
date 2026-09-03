import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadAgenticOsModule,
  readPr825RetainedAuthorityIssuance,
} from "./pr825-retained-authority-record.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const INTEGRATE_REQUEST_TIMING = Object.freeze({
  observedAt: "2026-09-03T05:02:33.000Z",
  expiresAt: "2026-09-03T05:17:33.000Z",
});

function fail(message) {
  throw new Error(message);
}

export async function readPr825IntegrateTransitionInput({
  repoRoot = REPO_ROOT,
  observedAt = INTEGRATE_REQUEST_TIMING.observedAt,
  expiresAt = INTEGRATE_REQUEST_TIMING.expiresAt,
} = {}) {
  const [
    governance,
    completion,
    cleanupRecords,
    transitionClient,
    retained,
  ] = await Promise.all([
    loadAgenticOsModule("governance.mjs", { repoRoot }),
    loadAgenticOsModule("completion.mjs", { repoRoot }),
    loadAgenticOsModule("cleanup-records.mjs", { repoRoot }),
    loadAgenticOsModule("github-transition-client.mjs", { repoRoot }),
    readPr825RetainedAuthorityIssuance({ repoRoot }),
  ]);

  const predecessorIssuance = retained.issuance;
  const request = predecessorIssuance.storedBundle.authorityBundle.request;
  const candidate = predecessorIssuance.storedBundle.authorityBundle.candidate;
  const review = predecessorIssuance.storedBundle.targetRepository.review;
  const retrospectiveProof = predecessorIssuance.storedBundle.targetRepository.retrospectiveProof;
  const requestedTransition = "integrate";

  const plan = completion.createEffectPlan({
    target: {
      repository: request.repository,
      resource: request.reviewLocator,
      immutableRevision: retrospectiveProof.mergeRevision,
    },
    authority: {
      requestedTransition,
      authoritySubject: request.authoritySubject,
      ownerSubject: request.ownerSubject,
      claimId: request.claimId,
      leaseEpoch: request.leaseEpoch,
      fenceRevision: predecessorIssuance.transitionReceipt.resultFenceRevision,
      writeSetDigest: request.writeSetDigest,
      reviewLocator: request.reviewLocator,
      predecessorDigest: predecessorIssuance.transitionReceipt.receiptDigest,
    },
    candidateDigest: candidate.candidateDigest,
    snapshotDigest: candidate.workingStateDigest,
    effectClass: "protected-integration-record",
    allowedEffects: [...cleanupRecords.INTEGRATION_RECORD_EFFECTS],
    forbiddenEffects: [...cleanupRecords.INTEGRATION_RECORD_RETAINED_EFFECTS],
    parametersDigest: retrospectiveProof.proofDigest ?? governance.governanceDigest({
      schema: "agentic-canvas-os/pr825-retrospective-proof-projection/v1",
      mergeRevision: retrospectiveProof.mergeRevision,
      mergeTreeRevision: retrospectiveProof.mergeTreeRevision,
      candidateTreeRevision: retrospectiveProof.candidateTreeRevision,
      mergedAt: retrospectiveProof.mergedAt,
      mergeEventId: retrospectiveProof.mergeEventId,
      baseRevision: retrospectiveProof.historicalBaseRevision,
      liveCanonicalRevision: retrospectiveProof.liveCanonicalRevision,
      reviewLocator: review.locator,
      headRevision: review.headRevision,
      baseRevisionReview: review.baseRevision,
    }),
  });
  const planBytes = Buffer.from(governance.canonicalJson(plan), "utf8");
  const planByteDigest = createHash("sha256").update(planBytes).digest("hex");
  const integrateRequest = governance.createCoordinationRequest({
    repository: request.repository,
    authoritySubject: request.authoritySubject,
    ownerSubject: request.ownerSubject,
    scope: request.scope,
    claimId: request.claimId,
    leaseEpoch: request.leaseEpoch,
    fenceRevision: predecessorIssuance.transitionReceipt.resultFenceRevision,
    immutableRevision: retrospectiveProof.mergeRevision,
    reviewLocator: request.reviewLocator,
    requestedTransition,
    dependentWork: [`effect-plan:sha256:${planByteDigest}`],
    observedAt,
    expiresAt,
  });
  const predecessorExpiresAt = predecessorIssuance.storedBundle.authorityBundle.challenge.expiresAt;
  const predecessorWindowOpen =
    Date.parse(observedAt) >= Date.parse(predecessorIssuance.publicationReceipt.committedAt)
    && Date.parse(observedAt) < Date.parse(predecessorExpiresAt)
    && Date.parse(expiresAt) <= Date.parse(predecessorExpiresAt);
  let operationInput = null;
  let operationInputDigest = null;
  let validationError = null;
  try {
    operationInput = transitionClient.createGitHubTransitionInput({
      request: integrateRequest,
      plan,
      planByteDigest,
      predecessorIssuance,
      integrationMode: transitionClient.GITHUB_RETROSPECTIVE_INTEGRATION_MODE,
    });
    operationInputDigest = transitionClient.deriveGitHubTransitionInputDigest(operationInput);
    if (operationInput.request.requestedTransition !== requestedTransition) {
      fail("PR825 integrate input did not remain an integrate operation.");
    }
  } catch (error) {
    validationError = error instanceof Error ? error.message : String(error);
  }
  return Object.freeze({
    schema: "agentic-canvas-os/pr825-integrate-input-record/v1",
    predecessorIssuance,
    request: integrateRequest,
    plan,
    planByteDigest,
    operationInput,
    operationInputDigest,
    predecessorExpiresAt,
    predecessorWindowOpen,
    validationError,
  });
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--json")) {
    fail("usage: node ./scripts/pr825-integrate-input.mjs [--json]");
  }
  const result = await readPr825IntegrateTransitionInput();
  const output = {
    schema: result.schema,
    operationInputDigest: result.operationInputDigest,
    predecessorExpiresAt: result.predecessorExpiresAt,
    predecessorWindowOpen: result.predecessorWindowOpen,
    validationError: result.validationError,
    request: result.request,
    plan: result.plan,
    planByteDigest: result.planByteDigest,
    operationInput: result.operationInput,
  };
  if (argv[0] === "--json") {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `PR 825 integrate input digest: ${result.operationInputDigest}`,
      `request window: ${result.request.observedAt} -> ${result.request.expiresAt}`,
      `predecessor expires: ${result.predecessorExpiresAt}`,
      `predecessor window open: ${result.predecessorWindowOpen ? "yes" : "no"}`,
      `validation error: ${result.validationError ?? "none"}`,
    ].join("\n"),
  );
  process.stdout.write("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
