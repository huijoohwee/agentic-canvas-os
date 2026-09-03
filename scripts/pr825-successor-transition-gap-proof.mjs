import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestValue } from "./product-contract-primitives.mjs";
import { createPr825CleanupJoinableRetirementProof } from "./pr825-cleanup-joinable-retirement-proof.mjs";
import { createPr825TerminalizerPlan } from "./pr825-terminalizer-controller.mjs";
import { readPr825IntegrateTransitionInput } from "./pr825-integrate-input.mjs";
import { createPr825AppendOnlyRecoveryEvidence } from "./pr825-recovery-evidence.mjs";
import { createPr825ReplacementTransitionAuthority } from "./pr825-replacement-transition-authority.mjs";
import { readPr825TerminalizerSeed } from "./pr825-terminalizer-seed.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export const PR825_SUCCESSOR_TRANSITION_GAP_PROOF_SCHEMA =
  "agentic-canvas-os/pr825-successor-transition-gap-proof/v1";

const BLOCKED_SURFACES = Object.freeze([
  Object.freeze({
    id: "transition-input-predecessor-shape",
    module: "agentic-os/src/github-transition-client.mjs",
    functionName: "predecessor",
    reason:
      "Integrate accepts only a canonical predecessorIssuance validated through validateGitHubAuthorityIssuance().",
  }),
  Object.freeze({
    id: "authority-issuance-publication-replay",
    module: "agentic-os/src/github-authority-issuer.mjs",
    functionName: "createGitHubAuthorityIssuance",
    reason:
      "A predecessor authority must replay one exact storedBundle plus one exact in-window publicationReceipt.",
  }),
  Object.freeze({
    id: "authority-read-provider-live-proof",
    module: "agentic-os/src/github-authority-client.mjs",
    functionName: "createGitHubAuthorityReadProvider",
    reason:
      "Integration proof preparation and observation re-read the predecessor bundle and publication from GitHub evidence storage.",
  }),
  Object.freeze({
    id: "transition-authority-source-window",
    module: "agentic-os/src/github-transition-authority.mjs",
    functionName: "sourceWindow",
    reason:
      "Successor integrate timing is capped by predecessorIssuance.challenge.expiresAt and publicationReceipt.committedAt.",
  }),
  Object.freeze({
    id: "transition-authority-policy-anchor",
    module: "agentic-os/src/github-transition-authority.mjs",
    functionName: "configured",
    reason:
      "Transition policy authorityRef must stay anchored to predecessorIssuance.storedBundle.authorityBundle.policy.canonicalRef.",
  }),
]);

const REQUIRED_SUCCESSOR_BINDINGS = Object.freeze([
  "reviewLocator",
  "immutableRevision",
  "reviewedSourceHead",
  "reviewedSourceTree",
  "protectedBase",
  "predecessorIssuanceDigest",
  "adoptedTerminalClaimId",
  "adoptedLineageDigest",
  "integrationReceiptDigest",
  "reviewRequestId",
  "retirementReason",
  "adoptionDisposition",
  "cloudMutation",
]);

function fail(message) {
  throw new Error(message);
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

export async function createPr825SuccessorTransitionGapProof({
  repoRoot = REPO_ROOT,
  authorization,
} = {}) {
  const seed = await readPr825TerminalizerSeed({ repoRoot });
  const plan = createPr825TerminalizerPlan(seed);
  if (authorization !== plan.exactAuthorization) {
    fail(`Exact authorization required: ${plan.exactAuthorization}`);
  }
  const [blockedIntegrate, recoveryEvidence, replacementAuthority, cleanupProof] =
    await Promise.all([
      readPr825IntegrateTransitionInput({ repoRoot }),
      createPr825AppendOnlyRecoveryEvidence({ repoRoot, authorization }),
      createPr825ReplacementTransitionAuthority({ repoRoot, authorization }),
      createPr825CleanupJoinableRetirementProof({ repoRoot, authorization }),
    ]);
  const core = {
    schema: PR825_SUCCESSOR_TRANSITION_GAP_PROOF_SCHEMA,
    operation: plan.operation,
    seedDigest: seed.seedDigest,
    planDigest: plan.planDigest,
    authorizationDigest: recoveryEvidence.authorizationDigest,
    evidenceDigest: recoveryEvidence.evidenceDigest,
    replacementAuthorityDigest: replacementAuthority.replacementAuthorityDigest,
    cleanupProofDigest: cleanupProof.proofDigest,
    blockedAttempt: freeze({
      requestedTransition: "integrate",
      validationError: blockedIntegrate.validationError,
      predecessorExpiresAt: blockedIntegrate.predecessorExpiresAt,
      predecessorWindowOpen: blockedIntegrate.predecessorWindowOpen,
      currentRequiredOperationFields: [
        "schema",
        "request",
        "plan",
        "planByteDigest",
        "predecessorIssuance",
      ],
    }),
    replacementAuthoritySubject: freeze({
      authorityKind: replacementAuthority.replacementAuthority.authorityKind,
      reviewLocator: replacementAuthority.replacementAuthority.reviewLocator,
      immutableRevision: replacementAuthority.replacementAuthority.immutableRevision,
      predecessorIssuanceDigest:
        replacementAuthority.replacementAuthority.predecessorIssuanceDigest,
      adoptedTerminalClaimId: replacementAuthority.replacementAuthority.adoptedTerminalClaimId,
      integrationReceiptDigest: replacementAuthority.replacementAuthority.integrationReceiptDigest,
      adoptionDisposition: replacementAuthority.replacementAuthority.adoptionDisposition,
      cloudMutation: replacementAuthority.replacementAuthority.cloudMutation,
    }),
    blockedSurfaces: BLOCKED_SURFACES,
    requiredSurfaceExtension: freeze({
      adapterKind: "replacement-transition-authority-predecessor",
      requiredBindings: [...REQUIRED_SUCCESSOR_BINDINGS],
      exactSourceWindowInputs: freeze({
        sourceStart: "successor-authority-issued-at",
        sourceExpiresAt: "successor-authority-expires-at",
        predecessorPublicationReplay: "not-applicable-for-append-only-replacement-authority",
      }),
      liveProofExpectation: freeze({
        predecessorReadMode: "replacement-authority-proof",
        policyAnchorMode: "explicit-authority-ref",
        publicationReplayRequired: false,
      }),
    }),
    payloadReady: false,
    blockedBy: "current-transition-schema-requires-published-predecessor-issuance",
  };
  return freeze({
    ...core,
    proofDigest: digestValue(core),
  });
}

async function main(argv = process.argv.slice(2)) {
  const authArg = argv.find((value) => value.startsWith("--authorization="));
  const json = argv.includes("--json");
  if (!authArg || argv.some((value) => value !== authArg && value !== "--json")) {
    fail(
      "usage: node ./scripts/pr825-successor-transition-gap-proof.mjs --authorization=<exact-line> [--json]",
    );
  }
  const proof = await createPr825SuccessorTransitionGapProof({
    authorization: authArg.slice("--authorization=".length),
  });
  if (json) {
    process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `PR 825 successor transition gap proof: ${proof.proofDigest}`,
      `payload ready: ${proof.payloadReady ? "yes" : "no"}`,
      `blocked by: ${proof.blockedBy}`,
      `validation error: ${proof.blockedAttempt.validationError}`,
    ].join("\n"),
  );
  process.stdout.write("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
