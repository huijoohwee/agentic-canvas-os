import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestValue } from "./product-contract-primitives.mjs";
import { createPr825TerminalizerPlan } from "./pr825-terminalizer-controller.mjs";
import {
  PR825_RETAINED_AUTHORITY,
  readPr825RetainedAuthorityIssuance,
} from "./pr825-retained-authority-record.mjs";
import { readPr825TerminalizerSeed } from "./pr825-terminalizer-seed.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export const PR825_RECOVERY_EVIDENCE_SCHEMA =
  "agentic-canvas-os/pr825-append-only-recovery-evidence/v1";

export const PR825_RECOVERY_EVIDENCE_FIXED = Object.freeze({
  pullRequest: 825,
  reviewedRunId: "33333212149",
  postMergeRunId: "33333368242",
  authority: "append-only evidence for protected PR825 terminalization",
  runtimeScope: "recovery evidence only",
  forbiddenEffects: Object.freeze([
    "source-rewrite",
    "direct-main-push",
    "force",
    "check-bypass",
    "release",
    "deployment",
    "broad-cleanup",
  ]),
});

function fail(message) {
  throw new Error(message);
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

export async function createPr825AppendOnlyRecoveryEvidence({
  repoRoot = REPO_ROOT,
  authorization,
} = {}) {
  const [seed, retained] = await Promise.all([
    readPr825TerminalizerSeed({ repoRoot }),
    readPr825RetainedAuthorityIssuance({ repoRoot }),
  ]);
  const plan = createPr825TerminalizerPlan(seed);
  if (authorization !== plan.exactAuthorization) {
    fail(`Exact authorization required: ${plan.exactAuthorization}`);
  }

  const request = retained.storedBundle.authorityBundle.request;
  const candidate = retained.storedBundle.authorityBundle.candidate;
  const review = retained.storedBundle.targetRepository.review;
  const retrospectiveProof = retained.storedBundle.targetRepository.retrospectiveProof;
  const step = plan.steps[0];

  const core = {
    schema: PR825_RECOVERY_EVIDENCE_SCHEMA,
    operation: plan.operation,
    seedDigest: seed.seedDigest,
    planDigest: plan.planDigest,
    stepId: step.stepId,
    stepOutput: step.output,
    authorizationDigest: digestValue({
      planDigest: plan.planDigest,
      authorization,
    }),
    pullRequest: PR825_RECOVERY_EVIDENCE_FIXED.pullRequest,
    authority: PR825_RECOVERY_EVIDENCE_FIXED.authority,
    runtimeScope: PR825_RECOVERY_EVIDENCE_FIXED.runtimeScope,
    protectedSubject: freeze({
      reviewLocator: request.reviewLocator,
      sourceBranch: candidate.branch,
      protectedBase: retrospectiveProof.historicalBaseRevision,
      reviewedSourceHead: candidate.headRevision,
      reviewedSourceTree: retrospectiveProof.candidateTreeRevision,
      protectedSquash: retrospectiveProof.mergeRevision,
      protectedSquashTree: retrospectiveProof.mergeTreeRevision,
      reviewedRunId: PR825_RECOVERY_EVIDENCE_FIXED.reviewedRunId,
      postMergeRunId: PR825_RECOVERY_EVIDENCE_FIXED.postMergeRunId,
    }),
    retainedAuthority: freeze({
      authorityRef: PR825_RETAINED_AUTHORITY.authorityRef,
      claimId: seed.retainedAuthority.claimId,
      leaseEpoch: seed.retainedAuthority.leaseEpoch,
      storedDigest: seed.retainedAuthority.storedDigest,
      publicationReceiptDigest: seed.retainedAuthority.publicationReceiptDigest,
      transitionReceiptDigest: seed.retainedAuthority.transitionReceiptDigest,
      issuanceDigest: seed.retainedAuthority.issuanceDigest,
    }),
    blockedIntegrate: freeze({
      requestDigest: seed.blockedIntegrate.requestDigest,
      planDigest: seed.blockedIntegrate.planDigest,
      planByteDigest: seed.blockedIntegrate.planByteDigest,
      predecessorExpiresAt: seed.blockedIntegrate.predecessorExpiresAt,
      validationError: seed.blockedIntegrate.validationError,
    }),
    successorBoundary: freeze({
      requireMergedReviewBinding: plan.successorConstraints.requireMergedReviewBinding,
      requireAppendOnlyEvidence: plan.successorConstraints.requireAppendOnlyEvidence,
      requireJoinableCleanupReceipts: plan.successorConstraints.requireJoinableCleanupReceipts,
      forbidFreshClaimCoordinateReuse: plan.successorConstraints.forbidFreshClaimCoordinateReuse,
      forbidExpiredPredecessorReuse: plan.successorConstraints.forbidExpiredPredecessorReuse,
      forbiddenEffects: PR825_RECOVERY_EVIDENCE_FIXED.forbiddenEffects,
    }),
    mutation: false,
  };
  return freeze({
    ...core,
    evidenceDigest: digestValue(core),
  });
}

async function main(argv = process.argv.slice(2)) {
  const authArg = argv.find((value) => value.startsWith("--authorization="));
  const json = argv.includes("--json");
  if (!authArg || argv.some((value) => value !== authArg && value !== "--json")) {
    fail("usage: node ./scripts/pr825-recovery-evidence.mjs --authorization=<exact-line> [--json]");
  }
  const evidence = await createPr825AppendOnlyRecoveryEvidence({
    authorization: authArg.slice("--authorization=".length),
  });
  if (json) {
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `PR 825 recovery evidence: ${evidence.evidenceDigest}`,
      `step: ${evidence.stepId}`,
      `review: ${evidence.protectedSubject.reviewLocator}`,
      `blocked integrate: ${evidence.blockedIntegrate.validationError}`,
    ].join("\n"),
  );
  process.stdout.write("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
