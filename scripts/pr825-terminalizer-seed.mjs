import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestValue } from "./product-contract-primitives.mjs";
import { readPr825IntegrateTransitionInput } from "./pr825-integrate-input.mjs";
import { readPr825RetainedAuthorityRecord } from "./pr825-retained-authority-record.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export const PR825_TERMINALIZER_OPERATION = Object.freeze({
  operationId: "pr825-expired-retrospective-terminalizer",
  lane: "agent/katrinas-macbook-pro.local/pr825-canonical-squash-terminalizer",
  predecessorKind: "github-retrospective-authority-issuance",
  targetKind: "claim-retirement-with-cleanup-successor",
});

function fail(message) {
  throw new Error(message);
}

export async function readPr825TerminalizerSeed({
  repoRoot = REPO_ROOT,
} = {}) {
  const [retainedAuthority, blockedIntegrate] = await Promise.all([
    readPr825RetainedAuthorityRecord({ repoRoot }),
    readPr825IntegrateTransitionInput({ repoRoot }),
  ]);
  if (blockedIntegrate.validationError
    !== "integrate does not bind the exact predecessor GitHub authority issuance") {
    fail(`Unexpected PR825 integrate validation result: ${blockedIntegrate.validationError ?? "none"}`);
  }
  if (blockedIntegrate.predecessorWindowOpen !== false) {
    fail("PR825 terminalizer seed requires a closed predecessor window.");
  }

  const successorConstraints = Object.freeze({
    requireMergedReviewBinding: true,
    requireAppendOnlyEvidence: true,
    requireJoinableCleanupReceipts: true,
    forbidFreshClaimCoordinateReuse: true,
    forbidExpiredPredecessorReuse: true,
  });
  const blockedProof = Object.freeze({
    requestDigest: blockedIntegrate.request.requestDigest,
    planDigest: blockedIntegrate.plan.planDigest,
    planByteDigest: blockedIntegrate.planByteDigest,
    predecessorExpiresAt: blockedIntegrate.predecessorExpiresAt,
    validationError: blockedIntegrate.validationError,
  });
  const core = {
    schema: "agentic-canvas-os/pr825-terminalizer-seed/v1",
    operation: PR825_TERMINALIZER_OPERATION,
    reviewLocator: retainedAuthority.reviewLocator,
    sourceBranch: retainedAuthority.sourceBranch,
    protectedMergeSha: retainedAuthority.protectedMergeSha,
    retainedAuthority: {
      claimId: retainedAuthority.claimId,
      leaseEpoch: retainedAuthority.leaseEpoch,
      storedDigest: retainedAuthority.storedDigest,
      publicationReceiptDigest: retainedAuthority.publicationReceiptDigest,
      transitionReceiptDigest: retainedAuthority.transitionReceiptDigest,
      issuanceDigest: retainedAuthority.issuanceDigest,
    },
    blockedIntegrate: blockedProof,
    successorConstraints,
    successorOutputs: Object.freeze([
      "append-only-recovery-evidence",
      "replacement-transition-authority",
      "cleanup-joinable-retirement-proof",
    ]),
  };
  return Object.freeze({
    ...core,
    seedDigest: digestValue(core),
  });
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--json")) {
    fail("usage: node ./scripts/pr825-terminalizer-seed.mjs [--json]");
  }
  const seed = await readPr825TerminalizerSeed();
  if (argv[0] === "--json") {
    process.stdout.write(`${JSON.stringify(seed, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `PR 825 terminalizer seed: ${seed.seedDigest}`,
      `operation: ${seed.operation.operationId}`,
      `review: ${seed.reviewLocator}`,
      `blocked integrate: ${seed.blockedIntegrate.validationError}`,
    ].join("\n"),
  );
  process.stdout.write("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
