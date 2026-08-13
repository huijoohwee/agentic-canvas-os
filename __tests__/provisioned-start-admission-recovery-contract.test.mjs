import assert from "node:assert/strict";
import test from "node:test";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { buildProvisionedStartAdmissionRecoveryPlan, projectProvisionedStartAdmissionRecovery,
  requireProvisionedStartAdmissionAuthorization } from "../scripts/provisioned-start-admission-recovery-contract.mjs";

const d = value => digestValue({ value });
const sha = character => character.repeat(40);

function evidence() {
  const admission = { schema: "agentic-lane-admission-lease/v1", status: "planned",
    semanticScope: "recover-start", declaredWriteSet: ["path:docs/recovery.md", "semantic:recover-start"],
    writeSetDigest: d("write"), manifestDigest: d("manifest"), planReceiptDigest: d("plan"),
    admissionReceiptDigest: d("admission"), existingLaneStateDigest: d("lanes") };
  const cloudAuthority = { claimId: d("claim") };
  const lease = { schema: "agentic-writer-lease/v2", status: "active", sessionId: "session", device: "device",
    scope: "recover-start", branch: "agent/device/recover-start", worktreePath: "/tmp/recover-start",
    epoch: 2, fenceSha: sha("a"), pullRequestUrl: "https://example.test/pull/1", admission,
    taskAuthority: { binding: d("binding") }, cloudAuthority };
  return { lease, descendant: { fenceSha: sha("a"), headSha: sha("b"), treeSha: sha("c"), clean: true,
    linear: true, paths: ["docs/recovery.md"], rangeDiffDigest: d("diff"), commits: [{ sha: sha("b"),
      treeSha: sha("c"), parentSha: sha("a"), message: "fix: preserve authored descendant" }] },
  pullRequest: { id: "PR_1", number: 1, url: lease.pullRequestUrl, state: "OPEN", isDraft: true,
    autoMergeRequest: null, branch: lease.branch, headSha: sha("a"), baseSha: sha("0"), bodyDigest: d("body") },
  cloud: { status: "ready", state: "active", writeAuthority: true, scopeReserved: true,
    claimId: cloudAuthority.claimId, claimDigest: d("claim digest"), laneRevision: sha("a"),
    transitionCounter: 2, heartbeatCounter: 0, ledgerRevision: sha("d"), ledgerDigest: d("ledger"),
    verificationReceiptDigest: d("verification") } };
}

test("plan binds the exact descendant and requires its digest token", () => {
  const plan = buildProvisionedStartAdmissionRecoveryPlan(evidence());
  const token = `authorize provisioned-start-admission-recovery ${plan.planDigest}`;
  assert.equal(requireProvisionedStartAdmissionAuthorization(plan, token).planDigest, plan.planDigest);
  assert.throws(() => requireProvisionedStartAdmissionAuthorization(plan, `${token}x`), /Exact authorization required/u);
  const projection = projectProvisionedStartAdmissionRecovery({ plan,
    projectedAt: "2026-08-14T00:00:00.000Z", mutationReceiptDigests: [d("source"), d("target")] });
  assert.equal(projection.integration.commitSha, sha("b"));
  assert.equal(projection.admission.status, "admitted");
});

test("plan rejects out-of-scope and non-linear authored bytes", () => {
  const outside = evidence(); outside.descendant.paths = ["docs/outside.md"];
  assert.throws(() => buildProvisionedStartAdmissionRecoveryPlan(outside), /exceed the declared/u);
  const merge = evidence(); merge.descendant.commits[0].parentSha = sha("9");
  assert.throws(() => buildProvisionedStartAdmissionRecoveryPlan(merge), /commit inventory/u);
});
