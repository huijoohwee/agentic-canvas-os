import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestValue } from "./product-contract-primitives.mjs";
import { createPr825CleanupJoinableRetirementProof } from "./pr825-cleanup-joinable-retirement-proof.mjs";
import { createPr825LiveSuccessorTransitionInput } from "./pr825-live-successor-transition-input.mjs";
import { createPr825TerminalizerPlan } from "./pr825-terminalizer-controller.mjs";
import { createPr825AppendOnlyRecoveryEvidence } from "./pr825-recovery-evidence.mjs";
import { createPr825ReplacementTransitionAuthority } from "./pr825-replacement-transition-authority.mjs";
import { readPr825TerminalizerSeed } from "./pr825-terminalizer-seed.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export const PR825_LIVE_SUCCESSOR_EXECUTOR_REQUEST_SCHEMA =
  "agentic-canvas-os/pr825-live-successor-executor-request/v1";

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

export async function createPr825LiveSuccessorExecutorRequest({
  repoRoot = REPO_ROOT,
  authorization,
  observedAt,
  expiresAt,
  authorityIssuedAt,
  authorityExpiresAt,
} = {}) {
  const seed = await readPr825TerminalizerSeed({ repoRoot });
  const plan = createPr825TerminalizerPlan(seed);
  if (authorization !== plan.exactAuthorization) {
    fail(`Exact authorization required: ${plan.exactAuthorization}`);
  }
  const [recoveryEvidence, replacementAuthority, cleanupProof, liveTransitionInput] =
    await Promise.all([
      createPr825AppendOnlyRecoveryEvidence({ repoRoot, authorization }),
      createPr825ReplacementTransitionAuthority({ repoRoot, authorization }),
      createPr825CleanupJoinableRetirementProof({ repoRoot, authorization }),
      createPr825LiveSuccessorTransitionInput({
        repoRoot,
        authorization,
        observedAt,
        expiresAt,
        authorityIssuedAt,
        authorityExpiresAt,
      }),
    ]);
  const core = {
    schema: PR825_LIVE_SUCCESSOR_EXECUTOR_REQUEST_SCHEMA,
    operation: plan.operation,
    seedDigest: seed.seedDigest,
    planDigest: plan.planDigest,
    authorizationDigest: recoveryEvidence.authorizationDigest,
    evidenceDigest: recoveryEvidence.evidenceDigest,
    replacementAuthorityDigest: replacementAuthority.replacementAuthorityDigest,
    cleanupProofDigest: cleanupProof.proofDigest,
    liveTransitionInputDigest: liveTransitionInput.recordDigest,
    dispatch: freeze({
      ...TRANSITION_WORKFLOW,
      payloadReady: true,
      inputs: freeze({
        operation_payload: liveTransitionInput.operationPayload,
        operation_input_digest: liveTransitionInput.operationInputDigest,
      }),
    }),
    successorPurpose: "mint-live-successor-integration-and-retirement-receipts",
    pendingFieldsDigest: cleanupProof.pendingFieldsDigest,
    pendingDynamicBindings: cleanupProof.pendingDynamicBindings,
    executorBlockedBy: null,
  };
  return freeze({
    ...core,
    requestDigest: digestValue(core),
  });
}

async function main(argv = process.argv.slice(2)) {
  const authArg = argv.find((value) => value.startsWith("--authorization="));
  const observedAtArg = argv.find((value) => value.startsWith("--observed-at="));
  const expiresAtArg = argv.find((value) => value.startsWith("--expires-at="));
  const authorityIssuedAtArg = argv.find((value) => value.startsWith("--authority-issued-at="));
  const authorityExpiresAtArg = argv.find((value) => value.startsWith("--authority-expires-at="));
  const json = argv.includes("--json");
  const allowed = new Set([
    authArg,
    observedAtArg,
    expiresAtArg,
    authorityIssuedAtArg,
    authorityExpiresAtArg,
    json ? "--json" : null,
  ]);
  if (!authArg || argv.some((value) => !allowed.has(value))) {
    fail(
      "usage: node ./scripts/pr825-live-successor-executor-request.mjs --authorization=<exact-line> [--observed-at=<iso>] [--expires-at=<iso>] [--authority-issued-at=<iso>] [--authority-expires-at=<iso>] [--json]",
    );
  }
  const request = await createPr825LiveSuccessorExecutorRequest({
    authorization: authArg.slice("--authorization=".length),
    ...(observedAtArg === undefined ? {} : { observedAt: observedAtArg.slice("--observed-at=".length) }),
    ...(expiresAtArg === undefined ? {} : { expiresAt: expiresAtArg.slice("--expires-at=".length) }),
    ...(authorityIssuedAtArg === undefined
      ? {}
      : { authorityIssuedAt: authorityIssuedAtArg.slice("--authority-issued-at=".length) }),
    ...(authorityExpiresAtArg === undefined
      ? {}
      : { authorityExpiresAt: authorityExpiresAtArg.slice("--authority-expires-at=".length) }),
  });
  if (json) {
    process.stdout.write(`${JSON.stringify(request, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `PR 825 live successor executor request: ${request.requestDigest}`,
      `payload ready: ${request.dispatch.payloadReady ? "yes" : "no"}`,
      `operation input digest: ${request.dispatch.inputs.operation_input_digest}`,
      `workflow: ${request.dispatch.workflowPath}`,
    ].join("\n"),
  );
  process.stdout.write("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
