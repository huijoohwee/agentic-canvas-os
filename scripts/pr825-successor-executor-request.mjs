import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestValue } from "./product-contract-primitives.mjs";
import { createPr825TerminalizerPlan } from "./pr825-terminalizer-controller.mjs";
import { createPr825CleanupJoinableRetirementProof } from "./pr825-cleanup-joinable-retirement-proof.mjs";
import { createPr825AppendOnlyRecoveryEvidence } from "./pr825-recovery-evidence.mjs";
import { createPr825ReplacementTransitionAuthority } from "./pr825-replacement-transition-authority.mjs";
import { readPr825TerminalizerSeed } from "./pr825-terminalizer-seed.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export const PR825_SUCCESSOR_EXECUTOR_REQUEST_SCHEMA =
  "agentic-canvas-os/pr825-successor-executor-request/v1";

const TRANSITION_WORKFLOW = Object.freeze({
  workflowPath: ".github/workflows/adlc-transition.yml",
  ref: "main",
  event: "workflow_dispatch",
  githubApiVersion: "2026-03-10",
  returnRunDetails: true,
  retainProviderRun: true,
  runDiscoveryForbidden: true,
  requiredInputs: Object.freeze(["operation_payload", "operation_input_digest"]),
  runNameTemplate: "ADLC transition <operation_input_digest> @ <workflow_sha>",
});

function fail(message) {
  throw new Error(message);
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

export async function createPr825SuccessorExecutorRequest({
  repoRoot = REPO_ROOT,
  authorization,
} = {}) {
  const seed = await readPr825TerminalizerSeed({ repoRoot });
  const plan = createPr825TerminalizerPlan(seed);
  if (authorization !== plan.exactAuthorization) {
    fail(`Exact authorization required: ${plan.exactAuthorization}`);
  }
  const [recoveryEvidence, replacementAuthority, cleanupProof] = await Promise.all([
    createPr825AppendOnlyRecoveryEvidence({ repoRoot, authorization }),
    createPr825ReplacementTransitionAuthority({ repoRoot, authorization }),
    createPr825CleanupJoinableRetirementProof({ repoRoot, authorization }),
  ]);
  const core = {
    schema: PR825_SUCCESSOR_EXECUTOR_REQUEST_SCHEMA,
    operation: plan.operation,
    seedDigest: seed.seedDigest,
    planDigest: plan.planDigest,
    authorizationDigest: recoveryEvidence.authorizationDigest,
    evidenceDigest: recoveryEvidence.evidenceDigest,
    replacementAuthorityDigest: replacementAuthority.replacementAuthorityDigest,
    cleanupProofDigest: cleanupProof.proofDigest,
    dispatch: freeze({
      ...TRANSITION_WORKFLOW,
      payloadReady: false,
      inputs: freeze({
        operation_payload: null,
        operation_input_digest: null,
      }),
    }),
    successorPurpose: "mint-live-successor-integration-and-retirement-receipts",
    pendingFieldsDigest: cleanupProof.pendingFieldsDigest,
    pendingDynamicBindings: cleanupProof.pendingDynamicBindings,
    executorBlockedBy: freeze({
      reason: "pending-successor-transition-input",
      missingFields: cleanupProof.cleanupBlockedBy.missingFields,
      blockedCleanupReason: cleanupProof.cleanupBlockedBy.reason,
    }),
  };
  return freeze({
    ...core,
    requestDigest: digestValue(core),
  });
}

async function main(argv = process.argv.slice(2)) {
  const authArg = argv.find((value) => value.startsWith("--authorization="));
  const json = argv.includes("--json");
  if (!authArg || argv.some((value) => value !== authArg && value !== "--json")) {
    fail("usage: node ./scripts/pr825-successor-executor-request.mjs --authorization=<exact-line> [--json]");
  }
  const request = await createPr825SuccessorExecutorRequest({
    authorization: authArg.slice("--authorization=".length),
  });
  if (json) {
    process.stdout.write(`${JSON.stringify(request, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `PR 825 successor executor request: ${request.requestDigest}`,
      `workflow: ${request.dispatch.workflowPath}`,
      `payload ready: ${request.dispatch.payloadReady ? "yes" : "no"}`,
      `blocked by: ${request.executorBlockedBy.reason}`,
    ].join("\n"),
  );
  process.stdout.write("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
