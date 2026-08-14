import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { buildProvisionedStartAdmissionRecoveryPlan, projectProvisionedStartAdmissionRecovery,
  projectProvisionedStartAdmissionRecoveryStableTerminalEvidence,
} from "../scripts/provisioned-start-admission-recovery-contract.mjs";
import { createProvisionedStartAdmissionRecoveryRepositoryAdapter } from "../scripts/provisioned-start-admission-recovery-repository-adapter.mjs";
import { normalizeDeclaredWriteScopeManifest } from "../scripts/scoped-lane-admission-lib.mjs";
import { createTaskAuthorityBinding, createTaskAuthorityCapability } from "../scripts/task-bound-lane-authority-contract.mjs";
import { updateWriterLeasePullRequestBody } from "../scripts/writer-lease-lib.mjs";

const digest = value => digestValue({ value });

test("real Git adapter produces one plan across fresh cloud observations", t => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "provisioned-start-real-adapter-"));
  t.after(() => fs.rmSync(repository, { recursive: true, force: true }));
  const branch = "agent/device/stable-subject";
  git(repository, ["init", "-b", branch]);
  git(repository, ["config", "user.name", "Recovery Test"]);
  git(repository, ["config", "user.email", "recovery@example.test"]);
  fs.mkdirSync(path.join(repository, "docs"));
  fs.writeFileSync(path.join(repository, "docs", "a.md"), "fence\n");
  git(repository, ["add", "docs/a.md"]);
  git(repository, ["commit", "-m", "chore: coordination fence"]);
  const fenceSha = git(repository, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(repository, "docs", "a.md"), "authored\n");
  git(repository, ["commit", "-am", "fix: preserve authored descendant"]);

  const manifest = normalizeDeclaredWriteScopeManifest({ schema: "agentic-declared-write-scope/v1",
    semanticScope: "stable-subject", paths: ["docs/a.md"] }, { expectedScope: "stable-subject" });
  const authority = { schema: "agentic-lane-cloud-authority/v1", provider: "provider",
    ledgerRepository: "owner/ledger", targetRepository: "owner/target",
    claimId: digest("claim"), claimDigest: digest("fence"), ledgerRevision: "d".repeat(40),
    ledgerDigest: digest("ledger"), claimLedgerRevision: digest("transition"),
    entrySchema: "claim-entry/v1", claimIdentitySchema: "claim-identity/v1",
    operationReceiptDigest: digest("operation"), mutationAuthorityEligible: true,
    canonicalBaseSha: "a".repeat(40), laneRevision: fenceSha,
    cloudDeclaredWriteScope: manifest.declaredWriteSet, writeSetDigest: manifest.writeSetDigest,
    deviceId: "device", sessionId: "session", reviewRequestId: "provider-review:1",
    leaseEpoch: 1, transitionCounter: 2, state: "active",
    expiresAt: "2026-08-15T00:00:00.000Z", integrationReceiptDigest: null,
    integration: null, manifestDigest: manifest.manifestDigest };
  const admission = { schema: "agentic-lane-admission-lease/v1", status: "planned",
    semanticScope: manifest.semanticScope, declaredWriteSet: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest, manifestDigest: manifest.manifestDigest,
    planReceiptDigest: digest("plan"), admissionReceiptDigest: digest("admission"),
    existingLaneStateDigest: digest("lanes") };
  const leaseFrame = { schema: "agentic-writer-lease/v2", status: "active", sessionId: "session",
    device: "device", scope: "stable-subject", branch, worktreePath: repository, epoch: 2,
    baseSha: authority.canonicalBaseSha, fenceSha, pullRequestUrl: "https://example.test/pull/1",
    autoDelivery: false, runtimeRequired: false, heartbeatAt: "2026-08-14T00:00:00.000Z",
    expiresAt: "2026-08-15T00:00:00.000Z", admission, cloudAuthority: authority };
  const capability = createTaskAuthorityCapability({ generation: 2,
    issuedAt: "2026-08-14T00:00:00.000Z" });
  const lease = { ...leaseFrame, taskAuthority: createTaskAuthorityBinding({ capability,
    lease: leaseFrame, boundAt: "2026-08-14T00:00:00.000Z" }) };
  let currentLease = lease;
  const store = { assertTaskAuthority: () => currentLease, read: () => currentLease };
  let body = updateWriterLeasePullRequestBody("owner", lease);
  const gh = () => JSON.stringify({ id: "PR_1", number: 1, url: lease.pullRequestUrl,
    state: "OPEN", isDraft: true, autoMergeRequest: null, headRefName: branch,
    headRefOid: fenceSha, baseRefOid: authority.canonicalBaseSha, body });
  let observation = 0; let heartbeatCounter = 0; let forgedReceipt = false;
  const verifyCloud = () => {
    const current = observation++;
    const claim = { claimId: authority.claimId, actorId: "actor", repositoryId: "repository",
      workItemId: "work-item", canonicalBaseRevision: authority.canonicalBaseSha,
      laneRevision: fenceSha, declaredWriteScope: manifest.declaredWriteSet,
      writeSetDigest: manifest.writeSetDigest, leaseEpoch: 1, transitionCounter: 2,
      heartbeatCounter, reviewRequestId: authority.reviewRequestId, expiresAt: authority.expiresAt,
      fenceRevision: authority.claimDigest, transitionDigest: authority.claimLedgerRevision,
      state: "active", writeAuthority: true, scopeReserved: true };
    return { authority, verification: { schema: "agentic-lane-cloud-verification/v1", status: "ready",
      claimId: authority.claimId, claimDigest: authority.claimDigest,
      ledgerRevision: authority.ledgerRevision, ledgerDigest: authority.ledgerDigest,
      canonicalBaseSha: authority.canonicalBaseSha, laneRevision: fenceSha,
      writeSetDigest: manifest.writeSetDigest, reviewRequestId: authority.reviewRequestId,
      remoteClaimInventoryDigest: digest(`volatile inventory ${current}`), inventory: { claims: [claim] },
      receiptDigest: forgedReceipt ? "forged" : digest(`fresh receipt ${current}`),
      verifiedAt: `2026-08-14T00:00:0${current}.000Z` } };
  };
  const adapter = createProvisionedStartAdmissionRecoveryRepositoryAdapter({ repository,
    sessionId: "session", taskAuthorityFile: path.join(os.tmpdir(), "external-capability.json"),
    gh, verifyCloud, createLeaseStore: () => store });
  const first = buildProvisionedStartAdmissionRecoveryPlan(adapter.readEvidence());
  const second = buildProvisionedStartAdmissionRecoveryPlan(adapter.readEvidence());
  assert.equal(first.planDigest, second.planDigest);
  assert.equal(first.evidence.cloud.verifier.subjectDigest, second.evidence.cloud.verifier.subjectDigest);
  assert.doesNotThrow(() => adapter.assertFreshVerification(first, "real-adapter-recheck"));

  const mutationReceiptDigests = ["source-local-cas", "target-local-cas"].map(operation => digestValue({
    schema: "agentic-task-authority-mutation-proof/v1", operation,
    taskAuthorityDigest: first.evidence.lease.taskAuthorityDigest,
    leaseDigest: first.evidence.lease.leaseDigest,
  }));
  const projection = projectProvisionedStartAdmissionRecovery({ plan: first,
    projectedAt: "2026-08-14T00:00:00.000Z", mutationReceiptDigests });
  currentLease = { ...lease, integration: projection.integration, admission: projection.admission,
    provisionedStartAdmissionRecovery: projection.preservation };
  body = updateWriterLeasePullRequestBody(body, currentLease);
  const expectedBodyDigest = digestValue(body);
  const firstTerminal = adapter.verifyTerminal({ plan: first, expectedBodyDigest });
  const secondTerminal = adapter.verifyTerminal({ plan: first, expectedBodyDigest });
  assert.deepEqual(projectProvisionedStartAdmissionRecoveryStableTerminalEvidence({
    plan: first, terminalEvidence: firstTerminal }),
  projectProvisionedStartAdmissionRecoveryStableTerminalEvidence({
    plan: first, terminalEvidence: secondTerminal }));
  assert.notEqual(firstTerminal.cloudVerificationReceiptDigest,
    secondTerminal.cloudVerificationReceiptDigest);
  heartbeatCounter = 1;
  assert.throws(() => adapter.verifyTerminal({ plan: first, expectedBodyDigest }), /Cloud authority drifted/u);
  heartbeatCounter = 0; forgedReceipt = true;
  assert.throws(() => adapter.verifyTerminal({ plan: first, expectedBodyDigest }), /receipt is invalid/u);
});

function git(repository, argumentsList) {
  return execFileSync("git", ["-C", repository, ...argumentsList], { encoding: "utf8" }).trim();
}
