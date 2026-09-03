import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestValue } from "./product-contract-primitives.mjs";
import { createPr825TerminalizerPlan } from "./pr825-terminalizer-controller.mjs";
import { readPr825IntegrateTransitionInput } from "./pr825-integrate-input.mjs";
import { loadAgenticOsModule } from "./pr825-retained-authority-record.mjs";
import { createPr825ReplacementTransitionAuthority } from "./pr825-replacement-transition-authority.mjs";
import { createPr825SuccessorExecutorRequest } from "./pr825-successor-executor-request.mjs";
import { readPr825TerminalizerSeed } from "./pr825-terminalizer-seed.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const WINDOW_MINUTES = 15;

export const PR825_LIVE_SUCCESSOR_TRANSITION_INPUT_SCHEMA =
  "agentic-canvas-os/pr825-live-successor-transition-input/v1";

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

export async function createPr825LiveSuccessorTransitionInput({
  repoRoot = REPO_ROOT,
  authorization,
  observedAt = new Date().toISOString(),
  expiresAt = plusMinutes(observedAt, WINDOW_MINUTES),
  authorityIssuedAt = observedAt,
  authorityExpiresAt = expiresAt,
} = {}) {
  const seed = await readPr825TerminalizerSeed({ repoRoot });
  const plan = createPr825TerminalizerPlan(seed);
  if (authorization !== plan.exactAuthorization) {
    fail(`Exact authorization required: ${plan.exactAuthorization}`);
  }
  const [replacementAuthority, executorRequest, transitionClient] =
    await Promise.all([
      createPr825ReplacementTransitionAuthority({ repoRoot, authorization }),
      createPr825SuccessorExecutorRequest({ repoRoot, authorization }),
      loadAgenticOsModule("github-transition-client.mjs", { repoRoot }),
    ]);

  const predecessorAuthority = freeze({
    schema: transitionClient.GITHUB_SUCCESSOR_PREDECESSOR_SCHEMA,
    authorityKind: replacementAuthority.replacementAuthority.authorityKind,
    authorityRef: `refs/heads/${executorRequest.dispatch.ref}`,
    reviewLocator: replacementAuthority.replacementAuthority.reviewLocator,
    sourceBranch: replacementAuthority.replacementAuthority.exactJoin.sourceBranch,
    immutableRevision: replacementAuthority.replacementAuthority.immutableRevision,
    reviewedSourceHead: replacementAuthority.replacementAuthority.reviewedSourceHead,
    reviewedSourceTree: replacementAuthority.replacementAuthority.reviewedSourceTree,
    protectedBase: replacementAuthority.replacementAuthority.protectedBase,
    predecessorIssuanceDigest: replacementAuthority.replacementAuthority.predecessorIssuanceDigest,
    predecessorTransitionReceiptDigest:
      replacementAuthority.predecessorAuthority.transitionReceiptDigest,
    adoptedTerminalClaimId: replacementAuthority.replacementAuthority.adoptedTerminalClaimId,
    adoptedLineageDigest: replacementAuthority.replacementAuthority.adoptedLineageDigest,
    integrationReceiptDigest: replacementAuthority.replacementAuthority.integrationReceiptDigest,
    reviewRequestId: replacementAuthority.replacementAuthority.reviewRequestId,
    retirementReason: replacementAuthority.replacementAuthority.retirementReason,
    adoptionDisposition: replacementAuthority.replacementAuthority.adoptionDisposition,
    cloudMutation: replacementAuthority.replacementAuthority.cloudMutation,
    issuedAt: authorityIssuedAt,
    expiresAt: authorityExpiresAt,
  });
  const liveIntegrate = await readPr825IntegrateTransitionInput({
    repoRoot,
    observedAt,
    expiresAt,
    predecessorAuthority,
  });

  if (liveIntegrate.validationError !== null) {
    fail(`PR825 live successor transition input is not dispatchable: ${liveIntegrate.validationError}`);
  }

  const operationInput = liveIntegrate.operationInput;
  const operationPayload = transitionClient.encodeGitHubTransitionInput(operationInput)
    .toString("utf8");
  const operationInputDigest = transitionClient.deriveGitHubTransitionInputDigest(operationPayload);
  const core = {
    schema: PR825_LIVE_SUCCESSOR_TRANSITION_INPUT_SCHEMA,
    operation: plan.operation,
    seedDigest: seed.seedDigest,
    planDigest: plan.planDigest,
    replacementAuthorityDigest: replacementAuthority.replacementAuthorityDigest,
    requestDigest: liveIntegrate.request.requestDigest,
    planByteDigest: liveIntegrate.planByteDigest,
    providerProofDigest: liveIntegrate.providerProofDigest,
    predecessorAuthority,
    operationInput,
    operationPayload,
    operationInputDigest,
    dispatch: freeze({
      workflowPath: executorRequest.dispatch.workflowPath,
      ref: executorRequest.dispatch.ref,
      event: executorRequest.dispatch.event,
      githubApiVersion: executorRequest.dispatch.githubApiVersion,
      returnRunDetails: executorRequest.dispatch.returnRunDetails,
      retainProviderRun: executorRequest.dispatch.retainProviderRun,
      inputs: freeze({
        operation_payload: operationPayload,
        operation_input_digest: operationInputDigest,
      }),
    }),
    payloadReady: true,
  };
  return freeze({
    ...core,
    recordDigest: digestValue(core),
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
      "usage: node ./scripts/pr825-live-successor-transition-input.mjs --authorization=<exact-line> [--observed-at=<iso>] [--expires-at=<iso>] [--authority-issued-at=<iso>] [--authority-expires-at=<iso>] [--json]",
    );
  }
  const record = await createPr825LiveSuccessorTransitionInput({
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
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `PR 825 live successor transition input: ${record.recordDigest}`,
      `payload ready: ${record.payloadReady ? "yes" : "no"}`,
      `operation input digest: ${record.operationInputDigest}`,
      `workflow: ${record.dispatch.workflowPath}`,
    ].join("\n"),
  );
  process.stdout.write("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
