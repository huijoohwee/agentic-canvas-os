import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestValue } from "./product-contract-primitives.mjs";
import { createPr825CleanupJoinableRetirementProof } from "./pr825-cleanup-joinable-retirement-proof.mjs";
import { createPr825TerminalizerPlan } from "./pr825-terminalizer-controller.mjs";
import { readPr825IntegrateTransitionInput } from "./pr825-integrate-input.mjs";
import { createPr825AppendOnlyRecoveryEvidence } from "./pr825-recovery-evidence.mjs";
import { createPr825ReplacementTransitionAuthority } from "./pr825-replacement-transition-authority.mjs";
import { createPr825SuccessorExecutorRequest } from "./pr825-successor-executor-request.mjs";
import { createPr825SuccessorTransitionGapProof } from "./pr825-successor-transition-gap-proof.mjs";
import { readPr825TerminalizerSeed } from "./pr825-terminalizer-seed.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export const PR825_SUCCESSOR_TRANSITION_INPUT_SCHEMA =
  "agentic-canvas-os/pr825-successor-transition-input-record/v1";

const REQUIRED_OPERATION_FIELDS = Object.freeze([
  "schema",
  "request",
  "plan",
  "planByteDigest",
  "predecessorIssuance",
]);

function fail(message) {
  throw new Error(message);
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

export async function createPr825SuccessorTransitionInputRecord({
  repoRoot = REPO_ROOT,
  authorization,
} = {}) {
  const seed = await readPr825TerminalizerSeed({ repoRoot });
  const plan = createPr825TerminalizerPlan(seed);
  if (authorization !== plan.exactAuthorization) {
    fail(`Exact authorization required: ${plan.exactAuthorization}`);
  }
  const [
    recoveryEvidence,
    replacementAuthority,
    cleanupProof,
    executorRequest,
    blockedIntegrate,
    gapProof,
  ] =
    await Promise.all([
      createPr825AppendOnlyRecoveryEvidence({ repoRoot, authorization }),
      createPr825ReplacementTransitionAuthority({ repoRoot, authorization }),
      createPr825CleanupJoinableRetirementProof({ repoRoot, authorization }),
      createPr825SuccessorExecutorRequest({ repoRoot, authorization }),
      readPr825IntegrateTransitionInput({ repoRoot }),
      createPr825SuccessorTransitionGapProof({ repoRoot, authorization }),
    ]);
  const core = {
    schema: PR825_SUCCESSOR_TRANSITION_INPUT_SCHEMA,
    operation: plan.operation,
    seedDigest: seed.seedDigest,
    planDigest: plan.planDigest,
    authorizationDigest: recoveryEvidence.authorizationDigest,
    evidenceDigest: recoveryEvidence.evidenceDigest,
    replacementAuthorityDigest: replacementAuthority.replacementAuthorityDigest,
    cleanupProofDigest: cleanupProof.proofDigest,
    executorRequestDigest: executorRequest.requestDigest,
    successorIntegrateTarget: freeze({
      requestedTransition: "integrate",
      repository: cleanupProof.cleanupJoin.repository,
      reviewLocator: cleanupProof.cleanupJoin.integratedResource,
      immutableRevision: cleanupProof.cleanupJoin.integratedImmutableRevision,
      candidateDigest: cleanupProof.cleanupJoin.candidateDigest,
      snapshotDigest: cleanupProof.cleanupJoin.snapshotDigest,
      integrationProofDigest: cleanupProof.cleanupJoin.integrationProofDigest,
    }),
    transitionWorkflow: freeze({
      workflowPath: executorRequest.dispatch.workflowPath,
      ref: executorRequest.dispatch.ref,
      event: executorRequest.dispatch.event,
      requiredInputs: executorRequest.dispatch.requiredInputs,
      payloadReady: false,
      inputs: freeze({
        operation_payload: null,
        operation_input_digest: null,
      }),
    }),
    currentSchemaConstraint: freeze({
      requiredOperationFields: [...REQUIRED_OPERATION_FIELDS],
      blockedBy: "current-transition-schema-requires-predecessor-issuance",
      validationError: blockedIntegrate.validationError,
      incompatibleSuccessorAuthorityDigest: replacementAuthority.replacementAuthorityDigest,
      pendingDynamicBindingsDigest: cleanupProof.pendingFieldsDigest,
      schemaGapProofDigest: gapProof.proofDigest,
      blockedSurfaceIds: gapProof.blockedSurfaces.map((surface) => surface.id),
      requiredAdapterKind: gapProof.requiredSurfaceExtension.adapterKind,
    }),
  };
  return freeze({
    ...core,
    recordDigest: digestValue(core),
  });
}

async function main(argv = process.argv.slice(2)) {
  const authArg = argv.find((value) => value.startsWith("--authorization="));
  const json = argv.includes("--json");
  if (!authArg || argv.some((value) => value !== authArg && value !== "--json")) {
    fail("usage: node ./scripts/pr825-successor-transition-input.mjs --authorization=<exact-line> [--json]");
  }
  const record = await createPr825SuccessorTransitionInputRecord({
    authorization: authArg.slice("--authorization=".length),
  });
  if (json) {
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `PR 825 successor transition-input record: ${record.recordDigest}`,
      `payload ready: ${record.transitionWorkflow.payloadReady ? "yes" : "no"}`,
      `blocked by: ${record.currentSchemaConstraint.blockedBy}`,
      `validation error: ${record.currentSchemaConstraint.validationError}`,
    ].join("\n"),
  );
  process.stdout.write("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
