import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestValue } from "./product-contract-primitives.mjs";
import { createPr825TerminalizerPlan } from "./pr825-terminalizer-controller.mjs";
import { createPr825AppendOnlyRecoveryEvidence } from "./pr825-recovery-evidence.mjs";
import { readPr825TerminalizerSeed } from "./pr825-terminalizer-seed.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export const PR825_REPLACEMENT_TRANSITION_AUTHORITY_SCHEMA =
  "agentic-canvas-os/pr825-replacement-transition-authority/v1";

export const PR825_FIXED_TERMINAL_CLOUD = Object.freeze({
  claimId: "390c05e2d09450494765b39a00d3338b9548a5914807ad91a2fa315babc93f28",
  integratedClaimDigest: "057d1caf3d2823f8632d8cf76b5620500180b70e667e04f26cdbd704cb08ad86",
  lineageDigest: "60aec854b0d68ada18e04c0af2c43d8f23ba964651524a751df942a173495965",
  integrateEntryDigest: "f4a1bc7744114bc6a056b85781f5163818aee03126f24b1b2133ca9631bb36d1",
  lineageLength: 6,
  integrationCounter: 5,
  terminalCounter: 6,
  retireIdempotencyKey: "4b0284039cf51c8c7e89a2790e7bc692f63237962cbdc102f03949d51d735df8",
  retireSequence: 6444,
  retireRequestDigest: "6b48bcbad3bfc819b1c028c6e1717aec1f181023a0d0fd7082367341f1ee0306",
  terminalEntryDigest: "e8e3ce74ca9aa0e4f7bcb7c756e3b5d7ab3525a6f78db1c4c68e662eac400e11",
  terminalClaimDigest: "b745128c4763767c55511e6378c996d13c550f55688eb4a2391debbcdb2ef1d3",
  integrationReceiptDigest: "c5c126eb152d240575a5339b11562da52519e7dcb3f101b5c291da9c84ead179",
  cloudEpoch: 1,
  reviewRequestId: "github-pull-request:PR_kwDOSr5-fM8AAAABBhjICg",
  finalRevision: "ed7461e5b272da1cba4cd31c079e12259965eaf1",
  retirementReason: "integrated",
  disposition: "response-loss-adopted",
});

function fail(message) {
  throw new Error(message);
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

export async function createPr825ReplacementTransitionAuthority({
  repoRoot = REPO_ROOT,
  authorization,
} = {}) {
  const seed = await readPr825TerminalizerSeed({ repoRoot });
  const plan = createPr825TerminalizerPlan(seed);
  if (authorization !== plan.exactAuthorization) {
    fail(`Exact authorization required: ${plan.exactAuthorization}`);
  }
  const evidence = await createPr825AppendOnlyRecoveryEvidence({ repoRoot, authorization });
  const step = plan.steps[1];
  const fixedCloud = PR825_FIXED_TERMINAL_CLOUD;
  if (evidence.protectedSubject.protectedSquash !== fixedCloud.finalRevision) {
    fail("PR825 replacement authority requires the fixed protected squash revision.");
  }
  const core = {
    schema: PR825_REPLACEMENT_TRANSITION_AUTHORITY_SCHEMA,
    operation: plan.operation,
    seedDigest: seed.seedDigest,
    planDigest: plan.planDigest,
    evidenceDigest: evidence.evidenceDigest,
    stepId: step.stepId,
    stepOutput: step.output,
    authorizationDigest: evidence.authorizationDigest,
    predecessorAuthority: freeze({
      issuanceDigest: evidence.retainedAuthority.issuanceDigest,
      claimId: evidence.retainedAuthority.claimId,
      leaseEpoch: evidence.retainedAuthority.leaseEpoch,
      publicationReceiptDigest: evidence.retainedAuthority.publicationReceiptDigest,
      transitionReceiptDigest: evidence.retainedAuthority.transitionReceiptDigest,
      terminallyBlockedBy: evidence.blockedIntegrate.validationError,
    }),
    adoptedTerminalCloud: freeze({
      ...fixedCloud,
      cloudMutation: false,
    }),
    replacementAuthority: freeze({
      authorityKind: "append-only-replacement-transition-authority",
      reviewLocator: evidence.protectedSubject.reviewLocator,
      immutableRevision: evidence.protectedSubject.protectedSquash,
      reviewedSourceHead: evidence.protectedSubject.reviewedSourceHead,
      reviewedSourceTree: evidence.protectedSubject.reviewedSourceTree,
      protectedBase: evidence.protectedSubject.protectedBase,
      predecessorIssuanceDigest: evidence.retainedAuthority.issuanceDigest,
      adoptedTerminalClaimId: fixedCloud.claimId,
      adoptedLineageDigest: fixedCloud.lineageDigest,
      integrationReceiptDigest: fixedCloud.integrationReceiptDigest,
      reviewRequestId: fixedCloud.reviewRequestId,
      retirementReason: fixedCloud.retirementReason,
      adoptionDisposition: fixedCloud.disposition,
      cloudMutation: false,
      exactJoin: freeze({
        reviewLocator: evidence.protectedSubject.reviewLocator,
        protectedSquash: evidence.protectedSubject.protectedSquash,
        sourceBranch: evidence.protectedSubject.sourceBranch,
        retainedAuthorityRef: evidence.retainedAuthority.authorityRef,
        terminalCloudClaimId: fixedCloud.claimId,
      }),
    }),
  };
  return freeze({
    ...core,
    replacementAuthorityDigest: digestValue(core),
  });
}

async function main(argv = process.argv.slice(2)) {
  const authArg = argv.find((value) => value.startsWith("--authorization="));
  const json = argv.includes("--json");
  if (!authArg || argv.some((value) => value !== authArg && value !== "--json")) {
    fail("usage: node ./scripts/pr825-replacement-transition-authority.mjs --authorization=<exact-line> [--json]");
  }
  const authority = await createPr825ReplacementTransitionAuthority({
    authorization: authArg.slice("--authorization=".length),
  });
  if (json) {
    process.stdout.write(`${JSON.stringify(authority, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `PR 825 replacement authority: ${authority.replacementAuthorityDigest}`,
      `step: ${authority.stepId}`,
      `review: ${authority.replacementAuthority.reviewLocator}`,
      `adoption: ${authority.replacementAuthority.adoptionDisposition}`,
    ].join("\n"),
  );
  process.stdout.write("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
