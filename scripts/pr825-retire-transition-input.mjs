import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestValue } from "./product-contract-primitives.mjs";
import { createPr825CleanupRetirementBindings } from "./pr825-cleanup-retirement-bindings.mjs";
import { loadAgenticOsModule } from "./pr825-retained-authority-record.mjs";
import { readPr825SuccessorIntegrationReceipt } from "./pr825-successor-integration-receipt.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const WINDOW_MINUTES = 15;

export const PR825_RETIRE_TRANSITION_INPUT_SCHEMA =
  "agentic-canvas-os/pr825-retire-transition-input/v1";

function fail(message) {
  throw new Error(message);
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function plusMinutes(isoInstant, minutes) {
  return new Date(Date.parse(isoInstant) + minutes * 60_000).toISOString();
}

export async function createPr825RetireTransitionInput({
  repoRoot = REPO_ROOT,
  observedAt = new Date().toISOString(),
  expiresAt = plusMinutes(observedAt, WINDOW_MINUTES),
  predecessorAuthority,
} = {}) {
  const [governance, completion, cleanupRecords, transitionClient, cleanupBindings, integrationRecord] =
    await Promise.all([
      loadAgenticOsModule("governance.mjs", { repoRoot }),
      loadAgenticOsModule("completion.mjs", { repoRoot }),
      loadAgenticOsModule("cleanup-records.mjs", { repoRoot }),
      loadAgenticOsModule("github-transition-client.mjs", { repoRoot }),
      createPr825CleanupRetirementBindings({ repoRoot, observedAt, expiresAt }),
      readPr825SuccessorIntegrationReceipt({ repoRoot }),
    ]);

  const integration = integrationRecord.receipt;
  const integrationRequest = integrationRecord.storedTransition.operationInput.request;
  const cleanupPlan = cleanupBindings.cleanupPlan;
  const plan = completion.createEffectPlan({
    target: {
      repository: cleanupPlan.repository,
      resource: cleanupPlan.targetPath,
      immutableRevision: cleanupPlan.integratedImmutableRevision,
    },
    authority: {
      requestedTransition: "retire",
      authoritySubject: integration.transitionReceipt.authoritySubject,
      ownerSubject: integrationRequest.ownerSubject,
      claimId: integration.transitionReceipt.resultClaimId,
      leaseEpoch: integration.transitionReceipt.resultLeaseEpoch,
      fenceRevision: integration.transitionReceipt.resultFenceRevision,
      writeSetDigest: integrationRequest.writeSetDigest,
      reviewLocator: integration.transitionReceipt.reviewLocator,
      predecessorDigest: integration.receiptDigest,
    },
    candidateDigest: cleanupPlan.candidateDigest,
    snapshotDigest: cleanupPlan.snapshotDigest,
    effectClass: "claim-retirement-with-cleanup",
    allowedEffects: [...cleanupRecords.CLEANUP_EFFECTS, "retire-claim"].sort(),
    forbiddenEffects: [...cleanupRecords.RETAINED_EFFECTS],
    parametersDigest: cleanupBindings.cleanupPlanByteDigest,
  });
  const planBytes = completion.encodeEffectPlan(plan);
  const planByteDigest = completion.effectPlanByteDigest(planBytes);
  const request = governance.retire({
    repository: cleanupPlan.repository,
    authoritySubject: integration.transitionReceipt.authoritySubject,
    ownerSubject: integrationRequest.ownerSubject,
    scope: integrationRequest.scope,
    claimId: integration.transitionReceipt.resultClaimId,
    leaseEpoch: integration.transitionReceipt.resultLeaseEpoch,
    fenceRevision: integration.transitionReceipt.resultFenceRevision,
    immutableRevision: cleanupPlan.integratedImmutableRevision,
    reviewLocator: integration.transitionReceipt.reviewLocator,
    writeSetDigest: integrationRequest.writeSetDigest,
    dependentWork: [`effect-plan:sha256:${planByteDigest}`],
    observedAt,
    expiresAt,
  });
  const operationInput = transitionClient.createGitHubTransitionInput({
    request,
    plan,
    planByteDigest,
    predecessorIssuance: null,
    ...(predecessorAuthority === undefined ? {} : { predecessorAuthority }),
  });
  const operationPayload = transitionClient.encodeGitHubTransitionInput(operationInput).toString("utf8");
  const operationInputDigest = transitionClient.deriveGitHubTransitionInputDigest(operationPayload);
  const integratedSourcePublishedAt = integration.authorityOperation.transitionedAt;
  const integratedSourceExpiresAt = integration.authorityOperation.expiresAt;
  const sourcePublishedAt = predecessorAuthority?.issuedAt ?? integratedSourcePublishedAt;
  const sourceExpiresAt = predecessorAuthority?.expiresAt ?? integratedSourceExpiresAt;
  const sourceWindowOpen =
    Date.parse(observedAt) >= Date.parse(sourcePublishedAt)
    && Date.parse(observedAt) < Date.parse(sourceExpiresAt)
    && Date.parse(expiresAt) <= Date.parse(sourceExpiresAt);
  const dispatch = freeze({
    workflowPath: ".github/workflows/adlc-transition.yml",
    ref: "main",
    event: "workflow_dispatch",
    githubApiVersion: "2026-03-10",
    returnRunDetails: true,
    retainProviderRun: true,
    inputs: freeze({
      operation_payload: operationPayload,
      operation_input_digest: operationInputDigest,
    }),
  });
  const core = {
    schema: PR825_RETIRE_TRANSITION_INPUT_SCHEMA,
    observedAt,
    expiresAt,
    integratedSourcePublishedAt,
    integratedSourceExpiresAt,
    sourcePublishedAt,
    sourceExpiresAt,
    sourceWindowOpen,
    cleanupBindingsDigest: cleanupBindings.recordDigest,
    cleanupPlanDigest: cleanupPlan.planDigest,
    cleanupPlanByteDigest: cleanupBindings.cleanupPlanByteDigest,
    integrationReceiptDigest: integration.receiptDigest,
    requestDigest: request.requestDigest,
    planByteDigest,
    operationInput,
    operationPayload,
    operationInputDigest,
    dispatch,
    dispatchReady: sourceWindowOpen,
    dispatchBlockedBy: sourceWindowOpen
      ? null
      : freeze({
          reason: predecessorAuthority === undefined
            ? "expired-integrated-source-window"
            : "expired-successor-predecessor-window",
          sourcePublishedAt,
          sourceExpiresAt,
        }),
  };
  return freeze({
    ...core,
    recordDigest: digestValue(core),
  });
}

async function main(argv = process.argv.slice(2)) {
  const observedAtArg = argv.find((value) => value.startsWith("--observed-at="));
  const expiresAtArg = argv.find((value) => value.startsWith("--expires-at="));
  const predecessorAuthorityArg = argv.find((value) => value.startsWith("--predecessor-authority="));
  const json = argv.includes("--json");
  const allowed = new Set([observedAtArg, expiresAtArg, predecessorAuthorityArg, json ? "--json" : null]);
  if (argv.some((value) => !allowed.has(value))) {
    fail(
      "usage: node ./scripts/pr825-retire-transition-input.mjs [--observed-at=<iso>] [--expires-at=<iso>] [--predecessor-authority=<json>] [--json]",
    );
  }
  const record = await createPr825RetireTransitionInput({
    ...(observedAtArg === undefined ? {} : { observedAt: observedAtArg.slice("--observed-at=".length) }),
    ...(expiresAtArg === undefined ? {} : { expiresAt: expiresAtArg.slice("--expires-at=".length) }),
    ...(predecessorAuthorityArg === undefined
      ? {}
      : { predecessorAuthority: JSON.parse(predecessorAuthorityArg.slice("--predecessor-authority=".length)) }),
  });
  if (json) {
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `PR 825 retire transition input: ${record.recordDigest}`,
      `request: ${record.requestDigest}`,
      `operation input digest: ${record.operationInputDigest}`,
      `dispatch ready: ${record.dispatchReady ? "yes" : "no"}`,
    ].join("\n"),
  );
  process.stdout.write("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
