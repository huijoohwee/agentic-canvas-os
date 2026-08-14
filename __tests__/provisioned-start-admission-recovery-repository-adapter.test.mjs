import assert from "node:assert/strict";
import test from "node:test";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { buildProvisionedStartAdmissionRecoveryPlan } from "../scripts/provisioned-start-admission-recovery-contract.mjs";
import { createProvisionedStartAdmissionRecoveryRepositoryAdapter } from "../scripts/provisioned-start-admission-recovery-repository-adapter.mjs";

const d = value => digestValue({ value });
const sha = character => character.repeat(40);

test("adapter reads a content-bound planned descendant and fails closed on provider drift", () => {
  const fence = sha("a"); const head = sha("b"); const tree = sha("c");
  const admission = { schema: "agentic-lane-admission-lease/v1", status: "planned", semanticScope: "scope",
    declaredWriteSet: ["path:docs/a.md", "semantic:scope"], writeSetDigest: d(1), manifestDigest: d(2),
    planReceiptDigest: d(3), admissionReceiptDigest: d(4), existingLaneStateDigest: d(5) };
  const authority = { schema: "agentic-lane-cloud-authority/v1", state: "active", claimId: d(6), claimDigest: d(7),
    ledgerRevision: sha("d"), laneRevision: fence, transitionCounter: 2 };
  const lease = { schema: "agentic-writer-lease/v2", status: "active", sessionId: "session", device: "device",
    scope: "scope", branch: "agent/device/scope", worktreePath: "/tmp/repo", epoch: 2, baseSha: sha("0"),
    fenceSha: fence, pullRequestUrl: "https://example.test/pull/1", admission, cloudAuthority: authority,
    taskAuthority: { binding: d(8) } };
  let body = "owner\n<!-- marker -->";
  const store = { assertTaskAuthority: () => lease, read: () => lease };
  const git = (_repo, args) => {
    const command = args.join(" ");
    if (command === "rev-parse --git-common-dir") return "/tmp";
    if (command === "branch --show-current") return lease.branch;
    if (command === "status --porcelain") return "";
    if (command === "rev-parse HEAD") return head;
    if (command === `merge-base ${fence} ${head}`) return fence;
    if (command === `rev-list --reverse --first-parent ${fence}..${head}` || command === `rev-list --reverse ${fence}..${head}`) return head;
    if (command === `show -s --format=%T ${head}` || command === `rev-parse ${head}^{tree}`) return tree;
    if (command === `show -s --format=%P ${head}`) return fence;
    if (command === `show -s --format=%B ${head}`) return "fix: preserve";
    if (command === `diff --name-only ${fence} ${head}`) return "docs/a.md";
    if (command === `diff --binary --full-index ${fence} ${head}`) return "patch bytes";
    throw new Error(`unexpected git ${command}`);
  };
  const gh = args => {
    assert.equal(args[0], "pr");
    return JSON.stringify({ id: "PR_1", number: 1, url: lease.pullRequestUrl, state: "OPEN", isDraft: true,
      autoMergeRequest: null, headRefName: lease.branch, headRefOid: fence, baseRefOid: sha("0"), body });
  };
  let receipt = 0; let subjectDrift = false; let forgedReceipt = false;
  const verifyCloud = () => ({ authority, verification: { schema: "agentic-lane-cloud-verification/v1",
    status: "ready", claimId: authority.claimId, claimDigest: authority.claimDigest,
    ledgerRevision: authority.ledgerRevision, ledgerDigest: d(9), canonicalBaseSha: lease.baseSha,
    laneRevision: authority.laneRevision, writeSetDigest: admission.writeSetDigest, reviewRequestId: null,
    remoteClaimInventoryDigest: subjectDrift ? d("drift") : d("inventory"),
    receiptDigest: forgedReceipt ? "forged" : d(`receipt ${receipt++}`),
    inventory: { claims: [{ claimId: authority.claimId, writeAuthority: true,
      scopeReserved: true, heartbeatCounter: 0 }] } } });
  const adapter = createProvisionedStartAdmissionRecoveryRepositoryAdapter({ repository: "/tmp/repo",
    sessionId: "session", taskAuthorityFile: "/tmp/capability", git, gh, verifyCloud,
    createLeaseStore: () => store });
  const plan = buildProvisionedStartAdmissionRecoveryPlan(adapter.readEvidence());
  assert.equal(plan.evidence.descendant.rangeDiffDigest, digestValue({ patch: "patch bytes" }));
  assert.deepEqual({
    state: plan.evidence.cloud.state,
    writeAuthority: plan.evidence.cloud.writeAuthority,
    scopeReserved: plan.evidence.cloud.scopeReserved,
  }, { state: "active", writeAuthority: true, scopeReserved: true });
  assert.doesNotThrow(() => adapter.assertPlanPreimage(plan, "fresh-receipt"));
  subjectDrift = true;
  assert.throws(() => adapter.assertPlanPreimage(plan, "subject-drift"), /preimage drifted/u);
  subjectDrift = false;
  forgedReceipt = true;
  assert.throws(() => adapter.assertFreshVerification(plan, "forged-receipt"), /invalid fresh receipt/u);
  forgedReceipt = false;
  body = "concurrent body drift";
  assert.throws(() => adapter.assertPlanPreimage(plan, "before-intent"), /preimage drifted/u);
});
