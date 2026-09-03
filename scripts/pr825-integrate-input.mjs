import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadAgenticOsModule,
  readPr825RetainedAuthorityIssuance,
} from "./pr825-retained-authority-record.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const TRANSITION_POLICY_PATH = ".agentic-os/github-transition-policy.json";
const MAIN_REFS = Object.freeze(["refs/remotes/origin/main", "refs/heads/main"]);
const INTEGRATE_REQUEST_TIMING = Object.freeze({
  observedAt: "2026-09-03T05:02:33.000Z",
  expiresAt: "2026-09-03T05:17:33.000Z",
});

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

function readGitHubToken(repoRoot) {
  const direct = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;
  if (typeof direct === "string" && direct.length > 0) return direct;
  try {
    return execFileSync("gh", ["auth", "token"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch (error) {
    fail(`PR825 integrate input could not resolve a GitHub token for live provider proof: ${error.message}`);
  }
}

function readTransitionWorkflowRevision(repoRoot) {
  for (const ref of MAIN_REFS) {
    const revision = tryGit(repoRoot, ["rev-parse", ref]);
    if (revision !== null) return revision;
  }
  git(repoRoot, [
    "fetch",
    "--no-tags",
    "origin",
    "refs/heads/main:refs/remotes/origin/main",
  ]);
  const revision = tryGit(repoRoot, ["rev-parse", "refs/remotes/origin/main"]);
  if (revision === null) fail("PR825 integrate input could not resolve the transition workflow revision.");
  return revision;
}

export async function readPr825IntegrateTransitionInput({
  repoRoot = REPO_ROOT,
  observedAt = INTEGRATE_REQUEST_TIMING.observedAt,
  expiresAt = INTEGRATE_REQUEST_TIMING.expiresAt,
  predecessorAuthority,
} = {}) {
  const [
    governance,
    completion,
    cleanupRecords,
    transitionAuthority,
    transitionClient,
    retained,
    transitionPolicyBytes,
  ] = await Promise.all([
    loadAgenticOsModule("governance.mjs", { repoRoot }),
    loadAgenticOsModule("completion.mjs", { repoRoot }),
    loadAgenticOsModule("cleanup-records.mjs", { repoRoot }),
    loadAgenticOsModule("github-transition-authority.mjs", { repoRoot }),
    loadAgenticOsModule("github-transition-client.mjs", { repoRoot }),
    readPr825RetainedAuthorityIssuance({ repoRoot }),
    readFile(path.join(repoRoot, TRANSITION_POLICY_PATH), "utf8"),
  ]);

  const predecessorIssuance = retained.issuance;
  const request = predecessorIssuance.storedBundle.authorityBundle.request;
  const candidate = predecessorIssuance.storedBundle.authorityBundle.candidate;
  const review = predecessorIssuance.storedBundle.targetRepository.review;
  const retrospectiveProof = predecessorIssuance.storedBundle.targetRepository.retrospectiveProof;
  const requestedTransition = "integrate";
  const transitionWorkflowRevision = readTransitionWorkflowRevision(repoRoot);
  const transitionPolicy = JSON.parse(transitionPolicyBytes);
  const boundPredecessorIssuance = predecessorAuthority === undefined ? predecessorIssuance : null;
  const bindLiveProviderProof = predecessorAuthority !== undefined;

  const planSource = {
    target: {
      repository: request.repository,
      resource: request.reviewLocator,
      immutableRevision: retrospectiveProof.mergeRevision,
    },
    authority: {
      requestedTransition,
      authoritySubject: request.authoritySubject,
      ownerSubject: request.ownerSubject,
      claimId: request.claimId,
      leaseEpoch: request.leaseEpoch,
      fenceRevision: predecessorIssuance.transitionReceipt.resultFenceRevision,
      writeSetDigest: request.writeSetDigest,
      reviewLocator: request.reviewLocator,
      predecessorDigest: predecessorAuthority?.predecessorTransitionReceiptDigest
        ?? predecessorIssuance.transitionReceipt.receiptDigest,
    },
    candidateDigest: candidate.candidateDigest,
    snapshotDigest: candidate.workingStateDigest,
    effectClass: "protected-integration-record",
    allowedEffects: [...cleanupRecords.INTEGRATION_RECORD_EFFECTS],
    forbiddenEffects: [...cleanupRecords.INTEGRATION_RECORD_RETAINED_EFFECTS],
  };

  let providerProof = null;
  let providerProofDigest = retrospectiveProof.proofDigest ?? governance.governanceDigest({
    schema: "agentic-canvas-os/pr825-retrospective-proof-projection/v1",
    mergeRevision: retrospectiveProof.mergeRevision,
    mergeTreeRevision: retrospectiveProof.mergeTreeRevision,
    candidateTreeRevision: retrospectiveProof.candidateTreeRevision,
    mergedAt: retrospectiveProof.mergedAt,
    mergeEventId: retrospectiveProof.mergeEventId,
    baseRevision: retrospectiveProof.historicalBaseRevision,
    liveCanonicalRevision: retrospectiveProof.liveCanonicalRevision,
    reviewLocator: review.locator,
    headRevision: review.headRevision,
    baseRevisionReview: review.baseRevision,
  });
  if (bindLiveProviderProof) {
    const githubToken = readGitHubToken(repoRoot);
    const provisionalPlan = completion.createEffectPlan({
      ...planSource,
      parametersDigest: governance.governanceDigest({
        schema: "agentic-canvas-os/pr825-provisional-integrate-provider-proof/v1",
        predecessorTransitionReceiptDigest: predecessorAuthority.predecessorTransitionReceiptDigest,
        authorityIssuedAt: predecessorAuthority.issuedAt,
        authorityExpiresAt: predecessorAuthority.expiresAt,
      }),
    });
    const provisionalPlanBytes = Buffer.from(governance.canonicalJson(provisionalPlan), "utf8");
    const provisionalPlanByteDigest = createHash("sha256")
      .update(provisionalPlanBytes)
      .digest("hex");
    const provisionalRequest = governance.createCoordinationRequest({
      repository: request.repository,
      authoritySubject: request.authoritySubject,
      ownerSubject: request.ownerSubject,
      scope: request.scope,
      claimId: request.claimId,
      leaseEpoch: request.leaseEpoch,
      fenceRevision: predecessorIssuance.transitionReceipt.resultFenceRevision,
      immutableRevision: retrospectiveProof.mergeRevision,
      reviewLocator: request.reviewLocator,
      requestedTransition,
      dependentWork: [`effect-plan:sha256:${provisionalPlanByteDigest}`],
      observedAt,
      expiresAt,
    });
    const provisionalOperationInput = transitionClient.createGitHubTransitionInput({
      request: provisionalRequest,
      plan: provisionalPlan,
      planByteDigest: provisionalPlanByteDigest,
      predecessorIssuance: null,
      predecessorAuthority,
      integrationMode: transitionClient.GITHUB_RETROSPECTIVE_INTEGRATION_MODE,
    });
    providerProof = await transitionAuthority.prepareGitHubIntegrationProviderProof({
      repository: request.repository,
      targetRepository: request.repository,
      token: githubToken,
      policy: transitionPolicy,
      workflowRevision: transitionWorkflowRevision,
      operationInput: provisionalOperationInput,
    });
    providerProofDigest = providerProof.proofDigest;
  }

  const plan = completion.createEffectPlan({
    ...planSource,
    parametersDigest: providerProofDigest,
  });
  const planBytes = Buffer.from(governance.canonicalJson(plan), "utf8");
  const planByteDigest = createHash("sha256").update(planBytes).digest("hex");
  const integrateRequest = governance.createCoordinationRequest({
    repository: request.repository,
    authoritySubject: request.authoritySubject,
    ownerSubject: request.ownerSubject,
    scope: request.scope,
    claimId: request.claimId,
    leaseEpoch: request.leaseEpoch,
    fenceRevision: predecessorIssuance.transitionReceipt.resultFenceRevision,
    immutableRevision: retrospectiveProof.mergeRevision,
    reviewLocator: request.reviewLocator,
    requestedTransition,
    dependentWork: [`effect-plan:sha256:${planByteDigest}`],
    observedAt,
    expiresAt,
  });
  const predecessorExpiresAt = predecessorIssuance.storedBundle.authorityBundle.challenge.expiresAt;
  const predecessorWindowOpen =
    Date.parse(observedAt) >= Date.parse(predecessorIssuance.publicationReceipt.committedAt)
    && Date.parse(observedAt) < Date.parse(predecessorExpiresAt)
    && Date.parse(expiresAt) <= Date.parse(predecessorExpiresAt);
  let operationInput = null;
  let operationInputDigest = null;
  let validationError = null;
  try {
    operationInput = transitionClient.createGitHubTransitionInput({
      request: integrateRequest,
      plan,
      planByteDigest,
      predecessorIssuance: boundPredecessorIssuance,
      ...(predecessorAuthority === undefined ? {} : { predecessorAuthority }),
      integrationMode: transitionClient.GITHUB_RETROSPECTIVE_INTEGRATION_MODE,
    });
    operationInputDigest = transitionClient.deriveGitHubTransitionInputDigest(operationInput);
    if (operationInput.request.requestedTransition !== requestedTransition) {
      fail("PR825 integrate input did not remain an integrate operation.");
    }
  } catch (error) {
    validationError = error instanceof Error ? error.message : String(error);
  }
  return Object.freeze({
    schema: "agentic-canvas-os/pr825-integrate-input-record/v1",
    predecessorIssuance,
    request: integrateRequest,
    plan,
    planByteDigest,
    providerProof,
    providerProofDigest,
    transitionPolicy,
    transitionWorkflowRevision,
    operationInput,
    operationInputDigest,
    predecessorExpiresAt,
    predecessorWindowOpen,
    validationError,
  });
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--json")) {
    fail("usage: node ./scripts/pr825-integrate-input.mjs [--json]");
  }
  const result = await readPr825IntegrateTransitionInput();
  const output = {
    schema: result.schema,
    operationInputDigest: result.operationInputDigest,
    predecessorExpiresAt: result.predecessorExpiresAt,
    predecessorWindowOpen: result.predecessorWindowOpen,
    validationError: result.validationError,
    request: result.request,
    plan: result.plan,
    planByteDigest: result.planByteDigest,
    operationInput: result.operationInput,
  };
  if (argv[0] === "--json") {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `PR 825 integrate input digest: ${result.operationInputDigest}`,
      `request window: ${result.request.observedAt} -> ${result.request.expiresAt}`,
      `predecessor expires: ${result.predecessorExpiresAt}`,
      `predecessor window open: ${result.predecessorWindowOpen ? "yes" : "no"}`,
      `validation error: ${result.validationError ?? "none"}`,
    ].join("\n"),
  );
  process.stdout.write("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
