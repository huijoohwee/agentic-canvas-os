import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestValue } from "./product-contract-primitives.mjs";
import {
  PR825_TERMINALIZER_OPERATION,
  readPr825TerminalizerSeed,
} from "./pr825-terminalizer-seed.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export const PR825_TERMINALIZER_PLAN_SCHEMA = "agentic-canvas-os/pr825-terminalizer-plan/v1";

const STEP_IDS = Object.freeze([
  "capture-append-only-recovery-evidence",
  "construct-replacement-transition-authority",
  "bind-cleanup-joinable-retirement-proof",
]);

function fail(message) {
  throw new Error(message);
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

export function createPr825TerminalizerPlan(seed) {
  if (!seed || seed.schema !== "agentic-canvas-os/pr825-terminalizer-seed/v1") {
    fail("PR825 terminalizer plan requires the sealed terminalizer seed.");
  }
  const steps = STEP_IDS.map((stepId, index) => freeze({
    stepId,
    ordinal: index + 1,
    output: seed.successorOutputs[index],
    required: true,
  }));
  const core = {
    schema: PR825_TERMINALIZER_PLAN_SCHEMA,
    operation: PR825_TERMINALIZER_OPERATION,
    seedDigest: seed.seedDigest,
    reviewLocator: seed.reviewLocator,
    sourceBranch: seed.sourceBranch,
    protectedMergeSha: seed.protectedMergeSha,
    blockedIntegrateValidationError: seed.blockedIntegrate.validationError,
    steps,
    successorConstraints: seed.successorConstraints,
    exactAuthorization: null,
    mutation: false,
  };
  const { exactAuthorization: _ignored, ...unsignedPlan } = core;
  const planDigest = digestValue(unsignedPlan);
  return freeze({
    ...core,
    exactAuthorization: `authorize ${PR825_TERMINALIZER_OPERATION.operationId} ${planDigest}`,
    planDigest,
  });
}

export function createPr825TerminalizerController({
  repoRoot = REPO_ROOT,
  loadSeed = () => readPr825TerminalizerSeed({ repoRoot }),
} = {}) {
  if (typeof loadSeed !== "function") fail("PR825 terminalizer controller requires loadSeed().");
  return Object.freeze({
    schema: "agentic-canvas-os/pr825-terminalizer-controller/v1",
    plan: async () => createPr825TerminalizerPlan(await loadSeed()),
  });
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--json")) {
    fail("usage: node ./scripts/pr825-terminalizer-controller.mjs [--json]");
  }
  const controller = createPr825TerminalizerController();
  const plan = await controller.plan();
  if (argv[0] === "--json") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `PR 825 terminalizer plan: ${plan.planDigest}`,
      `authorization: ${plan.exactAuthorization}`,
      `steps: ${plan.steps.map((step) => step.stepId).join(", ")}`,
    ].join("\n"),
  );
  process.stdout.write("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
