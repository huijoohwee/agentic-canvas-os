import assert from "node:assert/strict";
import test from "node:test";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { normalizeDeclaredWriteScopeManifest } from "../scripts/scoped-lane-admission-lib.mjs";
import { attestProvisionedStartCloudAuthoritySubject,
  projectProvisionedStartCloudAuthoritySubject,
  requireProvisionedStartCloudAuthorityAttestation,
} from "../scripts/provisioned-start-cloud-authority-subject.mjs";

const digest = value => digestValue({ value });
const sha = character => character.repeat(40);

function fixture({ heartbeatCounter = 0, receipt = "one", verifiedAt = "2026-08-14T00:00:00.000Z" } = {}) {
  const manifest = normalizeDeclaredWriteScopeManifest({ schema: "agentic-declared-write-scope/v1",
    semanticScope: "scope", paths: ["docs/a.md", "scripts/b.mjs"] }, { expectedScope: "scope" });
  const authority = { provider: "provider", ledgerRepository: "owner/ledger", targetRepository: "owner/target",
    claimId: digest("claim"), claimDigest: digest("fence"), claimLedgerRevision: digest("transition"),
    entrySchema: "claim-entry/v1", claimIdentitySchema: "claim-identity/v1",
    operationReceiptDigest: digest("operation"), state: "active", transitionCounter: 2, leaseEpoch: 1,
    mutationAuthorityEligible: true, deviceId: "device", sessionId: "session",
    canonicalBaseSha: sha("a"), laneRevision: sha("b"), reviewRequestId: "provider-review:1",
    writeSetDigest: manifest.writeSetDigest,
    expiresAt: "2026-08-15T00:00:00.000Z" };
  const claim = { claimId: authority.claimId, actorId: "actor", repositoryId: "repository",
    workItemId: "work-item", canonicalBaseRevision: authority.canonicalBaseSha,
    laneRevision: authority.laneRevision, declaredWriteScope: [...manifest.declaredWriteSet].reverse(),
    writeSetDigest: manifest.writeSetDigest, leaseEpoch: 1, transitionCounter: 2, heartbeatCounter,
    reviewRequestId: authority.reviewRequestId, expiresAt: authority.expiresAt,
    fenceRevision: authority.claimDigest, transitionDigest: authority.claimLedgerRevision,
    state: "active", writeAuthority: true, scopeReserved: true };
  return { lease: { branch: "agent/device/scope", fenceSha: authority.laneRevision }, manifest,
    verified: { authority, verification: { schema: "agentic-lane-cloud-verification/v1", status: "ready",
      receiptDigest: digest(receipt), verifiedAt, inventory: { claims: [claim] } } } };
}

test("stable subject excludes fresh verifier metadata and canonicalizes write scope", () => {
  const first = fixture();
  const second = fixture({ receipt: "two", verifiedAt: "2026-08-14T00:00:01.000Z" });
  const firstSubject = projectProvisionedStartCloudAuthoritySubject(first);
  const secondSubject = projectProvisionedStartCloudAuthoritySubject(second);
  assert.deepEqual(firstSubject, secondSubject);
  assert.deepEqual(firstSubject.scope.declaredWriteSet, [...firstSubject.scope.declaredWriteSet].sort());
  const firstAttestation = attestProvisionedStartCloudAuthoritySubject({ verified: first.verified, subject: firstSubject });
  const secondAttestation = attestProvisionedStartCloudAuthoritySubject({ verified: second.verified, subject: secondSubject });
  assert.notEqual(firstAttestation.receiptDigest, secondAttestation.receiptDigest);
  assert.doesNotThrow(() => requireProvisionedStartCloudAuthorityAttestation(
    secondAttestation, digestValue(firstSubject)));
});

test("manifest owns its digest when transport omits it and rejects transport drift", () => {
  const current = fixture();
  const subject = projectProvisionedStartCloudAuthoritySubject(current);
  assert.equal(subject.scope.manifestDigest, current.manifest.manifestDigest);
  assert.throws(() => projectProvisionedStartCloudAuthoritySubject({
    ...current,
    verified: {
      ...current.verified,
      authority: { ...current.verified.authority, manifestDigest: digest("different-manifest") },
    },
  }), /manifest digest drifted/u);
});

test("authority drift changes the subject and forged attestations fail closed", () => {
  const current = fixture();
  const advanced = fixture({ heartbeatCounter: 1 });
  const currentSubject = projectProvisionedStartCloudAuthoritySubject(current);
  const advancedSubject = projectProvisionedStartCloudAuthoritySubject(advanced);
  assert.notEqual(digestValue(currentSubject), digestValue(advancedSubject));
  const attestation = attestProvisionedStartCloudAuthoritySubject({ verified: current.verified, subject: currentSubject });
  assert.throws(() => requireProvisionedStartCloudAuthorityAttestation(
    { ...attestation, subjectDigest: digestValue(advancedSubject) }, digestValue(currentSubject)), /did not attest/u);
  assert.throws(() => requireProvisionedStartCloudAuthorityAttestation(
    { ...attestation, receiptDigest: digest("forged") }, digestValue(currentSubject)), /did not attest/u);
});
