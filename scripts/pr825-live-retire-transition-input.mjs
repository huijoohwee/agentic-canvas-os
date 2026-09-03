import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestValue } from "./product-contract-primitives.mjs";
import { createPr825RetireTransitionInput } from "./pr825-retire-transition-input.mjs";
import { createPr825TerminalizerPlan } from "./pr825-terminalizer-controller.mjs";
import { loadAgenticOsModule } from "./pr825-retained-authority-record.mjs";
import { readPr825SuccessorIntegrationReceipt } from "./pr825-successor-integration-receipt.mjs";
import { readPr825TerminalizerSeed } from "./pr825-terminalizer-seed.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const WINDOW_MINUTES = 15;

export const PR825_LIVE_RETIRE_TRANSITION_INPUT_SCHEMA =
  "agentic-canvas-os/pr825-live-retire-transition-input/v1";

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

export async function createPr825RetireSuccessorPredecessorAuthority({
  repoRoot = REPO_ROOT,
  authorization,
  authorityIssuedAt,
  authorityExpiresAt,
} = {}) {
  const seed = await readPr825TerminalizerSeed({ repoRoot });
  const plan = createPr825TerminalizerPlan(seed);
  if (authorization !== plan.exactAuthorization) {
    fail(`Exact authorization required: ${plan.exactAuthorization}`);
  }
  const [integrationRecord, transitionClient] = await Promise.all([
    readPr825SuccessorIntegrationReceipt({ repoRoot }),
    loadAgenticOsModule("github-transition-client.mjs", { repoRoot }),
  ]);
  const priorAuthority = integrationRecord.storedTransition.operationInput.predecessorAuthority;
  if (priorAuthority === undefined) {
    fail("PR825 live retire transition input requires the exact successor predecessor authority.");
  }
  return freeze({
    schema: transitionClient.GITHUB_SUCCESSOR_PREDECESSOR_SCHEMA,
    authorityKind: "append-only-retirement-successor-predecessor",
    authorityRef: priorAuthority.authorityRef,
    reviewLocator: priorAuthority.reviewLocator,
    sourceBranch: priorAuthority.sourceBranch,
    immutableRevision: integrationRecord.receipt.transitionReceipt.immutableRevision,
    reviewedSourceHead: priorAuthority.reviewedSourceHead,
    reviewedSourceTree: priorAuthority.reviewedSourceTree,
    protectedBase: priorAuthority.protectedBase,
    predecessorIssuanceDigest: priorAuthority.predecessorIssuanceDigest,
    predecessorTransitionReceiptDigest: integrationRecord.receipt.receiptDigest,
    adoptedTerminalClaimId: priorAuthority.adoptedTerminalClaimId,
    adoptedLineageDigest: priorAuthority.adoptedLineageDigest,
    integrationReceiptDigest: integrationRecord.receipt.receiptDigest,
    reviewRequestId: priorAuthority.reviewRequestId,
    retirementReason: "integrated-successor-retire-continuation",
    adoptionDisposition: priorAuthority.adoptionDisposition,
    cloudMutation: false,
    issuedAt: authorityIssuedAt,
    expiresAt: authorityExpiresAt,
  });
}

export async function createPr825LiveRetireTransitionInput({
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
  const predecessorAuthority = await createPr825RetireSuccessorPredecessorAuthority({
    repoRoot,
    authorization,
    authorityIssuedAt,
    authorityExpiresAt,
  });
  const retireInput = await createPr825RetireTransitionInput({
    repoRoot,
    observedAt,
    expiresAt,
    predecessorAuthority,
  });
  if (!retireInput.dispatchReady) {
    fail(`PR825 live retire transition input is not dispatchable: ${retireInput.dispatchBlockedBy?.reason ?? "unknown"}`);
  }
  const core = {
    schema: PR825_LIVE_RETIRE_TRANSITION_INPUT_SCHEMA,
    operation: plan.operation,
    seedDigest: seed.seedDigest,
    planDigest: plan.planDigest,
    predecessorAuthority,
    retireTransitionInputDigest: retireInput.recordDigest,
    requestDigest: retireInput.requestDigest,
    planByteDigest: retireInput.planByteDigest,
    operationInput: retireInput.operationInput,
    operationPayload: retireInput.operationPayload,
    operationInputDigest: retireInput.operationInputDigest,
    dispatch: freeze(retireInput.dispatch),
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
      "usage: node ./scripts/pr825-live-retire-transition-input.mjs --authorization=<exact-line> [--observed-at=<iso>] [--expires-at=<iso>] [--authority-issued-at=<iso>] [--authority-expires-at=<iso>] [--json]",
    );
  }
  const record = await createPr825LiveRetireTransitionInput({
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
      `PR 825 live retire transition input: ${record.recordDigest}`,
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
