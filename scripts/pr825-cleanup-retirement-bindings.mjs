import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestValue } from "./product-contract-primitives.mjs";
import { PR825_RETAINED_AUTHORITY, loadAgenticOsModule } from "./pr825-retained-authority-record.mjs";
import { readPr825SuccessorIntegrationReceipt } from "./pr825-successor-integration-receipt.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PR825_WORKTREE_PATH =
  "/Users/katrina/Documents/GitHub/.worktrees/agentic-canvas-os/active-dirt-marker-replay-order";
const WINDOW_MINUTES = 15;
const CLEANUP_LIMITS = Object.freeze({
  projectionByteCeiling: 4 * 1024 ** 4,
  projectionEntryCeiling: 1_000_000,
  registrationByteCeiling: 64 * 1024 ** 2,
  registrationEntryCeiling: 100_000,
  sharedStateByteCeiling: 4 * 1024 ** 4,
  sharedStateEntryCeiling: 1_000_000,
});

export const PR825_CLEANUP_RETIREMENT_BINDINGS_SCHEMA =
  "agentic-canvas-os/pr825-cleanup-retirement-bindings/v1";

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

function deriveArchiveDigest(governance, {
  repository,
  targetPath,
  candidateDigest,
  snapshotDigest,
  integrationReceiptDigest,
  recoveryInventoryDigest,
  recoveryInventoryContentEntries,
  ownerStateDigest,
}) {
  // Cleanup docs treat preservation and no-value receipts as local structural observations.
  // We therefore bind both receipts to one deterministic archive observation anchored to the
  // exact recovery inventory and authenticated integration result instead of inventing
  // an opaque external archive credential that does not exist for this worktree.
  return governance.governanceDigest({
    schema: "agentic-canvas-os/pr825-cleanup-archive-observation/v1",
    repository,
    targetPath,
    candidateDigest,
    snapshotDigest,
    integrationReceiptDigest,
    recoveryInventoryDigest,
    recoveryInventoryContentEntries,
    ownerStateDigest,
  });
}

export async function createPr825CleanupRetirementBindings({
  repoRoot = REPO_ROOT,
  observedAt = new Date().toISOString(),
  expiresAt = plusMinutes(observedAt, WINDOW_MINUTES),
} = {}) {
  const [
    governance,
    cleanupRecords,
    gitRepository,
    recoveryInventoryModule,
    integrationRecord,
  ] = await Promise.all([
    loadAgenticOsModule("governance.mjs", { repoRoot }),
    loadAgenticOsModule("cleanup-records.mjs", { repoRoot }),
    loadAgenticOsModule("git-repository.mjs", { repoRoot }),
    loadAgenticOsModule("recovery-inventory.mjs", { repoRoot }),
    readPr825SuccessorIntegrationReceipt({ repoRoot }),
  ]);

  const profileObservation = gitRepository.observeRepositoryProfileAtRef({
    repository: PR825_WORKTREE_PATH,
    ref: "refs/heads/main",
  });
  const recoveryInventory = recoveryInventoryModule.collectRecoveryInventory({
    cwd: PR825_WORKTREE_PATH,
    canonicalRef: "refs/heads/main",
  });
  const integration = integrationRecord.receipt;
  const integrationPlan = integrationRecord.storedTransition.operationInput.plan;
  if (integration.requestedTransition !== "integrate") {
    fail("PR825 cleanup retirement bindings require the exact successor integration receipt.");
  }
  const ownerStateDigest = cleanupRecords.deriveCleanupOwnerStateDigest({
    claimId: integration.transitionReceipt.resultClaimId,
    leaseEpoch: integration.transitionReceipt.resultLeaseEpoch,
    fenceRevision: integration.transitionReceipt.resultFenceRevision,
    state: integration.transitionReceipt.resultState,
  });
  const recoveryInventoryDigest = governance.governanceDigest(recoveryInventory);
  const archiveDigest = deriveArchiveDigest(governance, {
    repository: integrationPlan.target.repository,
    targetPath: PR825_WORKTREE_PATH,
    candidateDigest: integrationPlan.candidateDigest,
    snapshotDigest: integrationPlan.snapshotDigest,
    integrationReceiptDigest: integration.receiptDigest,
    recoveryInventoryDigest,
    recoveryInventoryContentEntries: recoveryInventory.inventoryEntries.content,
    ownerStateDigest,
  });
  const preservationReceipt = cleanupRecords.createCleanupEvidenceReceipt({
    kind: "preservation",
    repository: integrationPlan.target.repository,
    targetPath: PR825_WORKTREE_PATH,
    candidateDigest: integrationPlan.candidateDigest,
    snapshotDigest: integrationPlan.snapshotDigest,
    integrationReceiptDigest: integration.receiptDigest,
    recoveryInventoryDigest,
    recoveryInventoryContentEntries: recoveryInventory.inventoryEntries.content,
    ownerStateDigest,
    archiveDigest,
    preservationComplete: true,
    reachableFromRetainedRefs: null,
    unpreservedValueCount: null,
  });
  const noRemainingValueReceipt = cleanupRecords.createCleanupEvidenceReceipt({
    kind: "no-remaining-value",
    repository: integrationPlan.target.repository,
    targetPath: PR825_WORKTREE_PATH,
    candidateDigest: integrationPlan.candidateDigest,
    snapshotDigest: integrationPlan.snapshotDigest,
    integrationReceiptDigest: integration.receiptDigest,
    recoveryInventoryDigest,
    recoveryInventoryContentEntries: recoveryInventory.inventoryEntries.content,
    ownerStateDigest,
    archiveDigest,
    preservationComplete: null,
    reachableFromRetainedRefs: true,
    unpreservedValueCount: 0,
  });
  const cleanupPlan = cleanupRecords.createWorktreeCleanupPlan({
    repository: integrationPlan.target.repository,
    targetPath: PR825_WORKTREE_PATH,
    expectedBranch: recoveryInventory.branch,
    expectedHeadRevision: recoveryInventory.headRevision,
    expectedCanonicalRef: "refs/heads/main",
    expectedCanonicalRevision: profileObservation.revision,
    integratedResource: PR825_RETAINED_AUTHORITY.reviewLocator,
    integratedImmutableRevision: integration.transitionReceipt.immutableRevision,
    candidateDigest: integrationPlan.candidateDigest,
    snapshotDigest: integrationPlan.snapshotDigest,
    integrationProofDigest: integrationPlan.parametersDigest,
    profileDigest: profileObservation.profile.profileDigest,
    recoveryInventoryDigest,
    recoveryInventoryContentEntries: recoveryInventory.inventoryEntries.content,
    ownerStateDigest,
    integrationReceiptDigest: integration.receiptDigest,
    integrationPlanByteDigest: integration.planByteDigest,
    integrationPredecessorDigest: integrationPlan.authority.predecessorDigest,
    preservationReceiptDigest: preservationReceipt.receiptDigest,
    noRemainingValueReceiptDigest: noRemainingValueReceipt.receiptDigest,
    ...CLEANUP_LIMITS,
    authorizedEffects: [...cleanupRecords.CLEANUP_EFFECTS],
    retainedEffects: [...cleanupRecords.RETAINED_EFFECTS],
    expiresAt,
  });
  const core = {
    schema: PR825_CLEANUP_RETIREMENT_BINDINGS_SCHEMA,
    repository: cleanupPlan.repository,
    targetPath: cleanupPlan.targetPath,
    observedAt,
    expiresAt,
    integrationReceiptDigest: integration.receiptDigest,
    integrationPlanByteDigest: integration.planByteDigest,
    integrationProofDigest: integrationPlan.parametersDigest,
    ownerStateDigest,
    profileDigest: profileObservation.profile.profileDigest,
    canonicalRevision: profileObservation.revision,
    recoveryInventoryDigest,
    recoveryInventoryContentEntries: recoveryInventory.inventoryEntries.content,
    archiveDigest,
    cleanupPlan: freeze(cleanupPlan),
    cleanupPlanByteDigest: cleanupRecords.worktreeCleanupPlanByteDigest(cleanupPlan),
    preservationReceipt: freeze(preservationReceipt),
    noRemainingValueReceipt: freeze(noRemainingValueReceipt),
    cleanupReady: true,
  };
  return freeze({
    ...core,
    recordDigest: digestValue(core),
  });
}

async function main(argv = process.argv.slice(2)) {
  const observedAtArg = argv.find((value) => value.startsWith("--observed-at="));
  const expiresAtArg = argv.find((value) => value.startsWith("--expires-at="));
  const json = argv.includes("--json");
  const allowed = new Set([observedAtArg, expiresAtArg, json ? "--json" : null]);
  if (argv.some((value) => !allowed.has(value))) {
    fail(
      "usage: node ./scripts/pr825-cleanup-retirement-bindings.mjs [--observed-at=<iso>] [--expires-at=<iso>] [--json]",
    );
  }
  const record = await createPr825CleanupRetirementBindings({
    ...(observedAtArg === undefined ? {} : { observedAt: observedAtArg.slice("--observed-at=".length) }),
    ...(expiresAtArg === undefined ? {} : { expiresAt: expiresAtArg.slice("--expires-at=".length) }),
  });
  if (json) {
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `PR 825 cleanup retirement bindings: ${record.recordDigest}`,
      `cleanup plan: ${record.cleanupPlan.planDigest}`,
      `cleanup plan byte digest: ${record.cleanupPlanByteDigest}`,
      `cleanup ready: ${record.cleanupReady ? "yes" : "no"}`,
    ].join("\n"),
  );
  process.stdout.write("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
