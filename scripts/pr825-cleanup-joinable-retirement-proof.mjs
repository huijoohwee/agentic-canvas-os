import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { digestValue } from "./product-contract-primitives.mjs";
import { createPr825TerminalizerPlan } from "./pr825-terminalizer-controller.mjs";
import { readPr825IntegrateTransitionInput } from "./pr825-integrate-input.mjs";
import { createPr825AppendOnlyRecoveryEvidence } from "./pr825-recovery-evidence.mjs";
import { createPr825ReplacementTransitionAuthority } from "./pr825-replacement-transition-authority.mjs";
import {
  loadAgenticOsModule,
  readPr825RetainedAuthorityIssuance,
} from "./pr825-retained-authority-record.mjs";
import { readPr825TerminalizerSeed } from "./pr825-terminalizer-seed.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PR825_WORKTREE_PATH =
  "/Users/katrina/Documents/GitHub/.worktrees/agentic-canvas-os/active-dirt-marker-replay-order";
const CANONICAL_REF = "refs/heads/main";

export const PR825_CLEANUP_JOINABLE_RETIREMENT_PROOF_SCHEMA =
  "agentic-canvas-os/pr825-cleanup-joinable-retirement-proof/v1";

const PENDING_CLEANUP_FIELDS = Object.freeze([
  "integrationReceiptDigest",
  "integrationPlanByteDigest",
  "retirementReceiptDigest",
  "retirementPlanByteDigest",
  "preservationReceiptDigest",
  "noRemainingValueReceiptDigest",
  "ownerStateDigest",
  "profileDigest",
  "recoveryInventoryDigest",
  "recoveryInventoryContentEntries",
]);

function fail(message) {
  throw new Error(message);
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
  }).trim();
}

function tryGit(cwd, args) {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

function readCanonicalRevision(repoRoot) {
  const refs = [CANONICAL_REF, "refs/remotes/origin/main"];
  for (const ref of refs) {
    const revision = tryGit(repoRoot, ["rev-parse", ref]);
    if (revision !== null) return revision;
  }
  git(repoRoot, [
    "fetch",
    "--no-tags",
    "origin",
    `${CANONICAL_REF}:refs/remotes/origin/main`,
  ]);
  const revision = tryGit(repoRoot, ["rev-parse", "refs/remotes/origin/main"]);
  if (revision === null) fail("PR825 cleanup join could not resolve the canonical main revision.");
  return revision;
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

export async function createPr825CleanupJoinableRetirementProof({
  repoRoot = REPO_ROOT,
  authorization,
  canonicalRevision = null,
} = {}) {
  const [seed, retained, integrateInput, cleanupRecords] = await Promise.all([
    readPr825TerminalizerSeed({ repoRoot }),
    readPr825RetainedAuthorityIssuance({ repoRoot }),
    readPr825IntegrateTransitionInput({ repoRoot }),
    loadAgenticOsModule("cleanup-records.mjs", { repoRoot }),
  ]);
  const plan = createPr825TerminalizerPlan(seed);
  if (authorization !== plan.exactAuthorization) {
    fail(`Exact authorization required: ${plan.exactAuthorization}`);
  }
  const [recoveryEvidence, replacementAuthority, governance] = await Promise.all([
    createPr825AppendOnlyRecoveryEvidence({ repoRoot, authorization }),
    createPr825ReplacementTransitionAuthority({ repoRoot, authorization }),
    loadAgenticOsModule("governance.mjs", { repoRoot }),
  ]);
  const request = retained.storedBundle.authorityBundle.request;
  const candidate = retained.storedBundle.authorityBundle.candidate;
  const step = plan.steps[2];
  const expectedCanonicalRevision =
    canonicalRevision ?? readCanonicalRevision(repoRoot);
  if (integrateInput.plan.candidateDigest !== candidate.candidateDigest
    || integrateInput.plan.snapshotDigest !== candidate.workingStateDigest) {
    fail("PR825 cleanup join requires the exact reviewed candidate digests.");
  }

  const staticJoin = freeze({
    repository: request.repository,
    targetPath: PR825_WORKTREE_PATH,
    expectedBranch: candidate.branch,
    expectedHeadRevision: candidate.headRevision,
    expectedCanonicalRef: CANONICAL_REF,
    expectedCanonicalRevision,
    integratedResource: request.reviewLocator,
    integratedImmutableRevision: replacementAuthority.replacementAuthority.immutableRevision,
    candidateDigest: integrateInput.plan.candidateDigest,
    snapshotDigest: integrateInput.plan.snapshotDigest,
    integrationProofDigest: replacementAuthority.replacementAuthorityDigest,
    integrationPredecessorDigest: replacementAuthority.predecessorAuthority.transitionReceiptDigest,
    authorizedEffects: [...cleanupRecords.CLEANUP_EFFECTS],
    retainedEffects: [...cleanupRecords.RETAINED_EFFECTS],
  });
  const pendingDynamicBindings = freeze(
    Object.fromEntries(PENDING_CLEANUP_FIELDS.map((field) => [field, null])),
  );
  const core = {
    schema: PR825_CLEANUP_JOINABLE_RETIREMENT_PROOF_SCHEMA,
    operation: plan.operation,
    seedDigest: seed.seedDigest,
    planDigest: plan.planDigest,
    evidenceDigest: recoveryEvidence.evidenceDigest,
    replacementAuthorityDigest: replacementAuthority.replacementAuthorityDigest,
    stepId: step.stepId,
    stepOutput: step.output,
    authorizationDigest: recoveryEvidence.authorizationDigest,
    cleanupJoin: staticJoin,
    pendingDynamicBindings,
    retirementJoin: freeze({
      requestedTransition: "retire",
      effectClass: "claim-retirement-with-cleanup",
      targetRepository: request.repository,
      targetResource: PR825_WORKTREE_PATH,
      targetImmutableRevision: replacementAuthority.replacementAuthority.immutableRevision,
      predecessorReceiptDigest: "pending-successor-integration-receipt",
      terminalCloudClaimId: replacementAuthority.adoptedTerminalCloud.claimId,
      adoptionDisposition: replacementAuthority.replacementAuthority.adoptionDisposition,
      cloudMutation: false,
    }),
    cleanupReady: false,
    cleanupBlockedBy: freeze({
      reason: "pending-live-successor-receipts",
      validationError: integrateInput.validationError,
      missingFields: [...PENDING_CLEANUP_FIELDS],
    }),
  };
  const proofDigest = digestValue(core);
  const pendingFieldsDigest = governance.governanceDigest({
    schema: "agentic-canvas-os/pr825-cleanup-pending-fields/v1",
    missingFields: [...PENDING_CLEANUP_FIELDS],
  });
  return freeze({
    ...core,
    pendingFieldsDigest,
    proofDigest,
  });
}

async function main(argv = process.argv.slice(2)) {
  const authArg = argv.find((value) => value.startsWith("--authorization="));
  const json = argv.includes("--json");
  if (!authArg || argv.some((value) => value !== authArg && value !== "--json")) {
    fail("usage: node ./scripts/pr825-cleanup-joinable-retirement-proof.mjs --authorization=<exact-line> [--json]");
  }
  const proof = await createPr825CleanupJoinableRetirementProof({
    authorization: authArg.slice("--authorization=".length),
  });
  if (json) {
    process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `PR 825 cleanup-joinable retirement proof: ${proof.proofDigest}`,
      `step: ${proof.stepId}`,
      `cleanup ready: ${proof.cleanupReady ? "yes" : "no"}`,
      `blocked by: ${proof.cleanupBlockedBy.reason}`,
    ].join("\n"),
  );
  process.stdout.write("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
