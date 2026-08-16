import assert from "node:assert/strict";
import test from "node:test";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { createRecoveryArtifactRetirementController } from "../scripts/recovery-artifact-retirement-controller.mjs";
import { RECOVERY_ARTIFACT_RETIREMENT_EVIDENCE_SCHEMA } from "../scripts/recovery-artifact-retirement-contract.mjs";

test("plan is stable and exact-authorized run replays after rename response loss", () => {
  const evidence = fixture(); let intent = null; let receipt = null; let archived = false; let failOnce = true;
  const adapter = {
    captureEvidence: () => evidence, withSubjectFence: (_plan, callback) => callback(),
    readIntent: () => intent, writeIntent: (previous, next) => { assert.deepEqual(previous, intent); intent = next; return next; },
    readReceipt: () => receipt, writeReceipt: (previous, next) => { assert.deepEqual(previous, receipt); receipt = next; return next; },
    archive(plan) { archived = true; if (failOnce) { failOnce = false; throw new Error("lost response"); } return observation(plan); },
    observeArchive: plan => observation(plan),
  };
  const controller = createRecoveryArtifactRetirementController({ adapter });
  const input = { sessionId: "session", operatorDecisionDigest: "a".repeat(64), acknowledgedDriftDigest: null };
  const planned = controller.plan(input);
  const run = { ...input, planDigest: planned.planDigest, authorization: planned.exactAuthorization };
  assert.throws(() => controller.run(run), /lost response/u);
  assert.equal(intent.status, "prepared"); assert.equal(archived, true);
  const result = controller.run(run);
  assert.equal(result.status, "complete"); assert.equal(result.receipt.planDigest, planned.planDigest);
  assert.equal(controller.observe({ planDigest: planned.planDigest }).status, "complete");
});

test("run rejects non-exact authorization before intent or archive", () => {
  const evidence = fixture(); let writes = 0; let effects = 0;
  const controller = createRecoveryArtifactRetirementController({ adapter: {
    captureEvidence: () => evidence, withSubjectFence: (_p, callback) => callback(), readIntent: () => null,
    writeIntent: () => { writes++; }, readReceipt: () => null, writeReceipt: () => {},
    archive: () => { effects++; }, observeArchive: () => {},
  } });
  const input = { sessionId: "session", operatorDecisionDigest: "a".repeat(64), acknowledgedDriftDigest: null };
  const plan = controller.plan(input);
  assert.throws(() => controller.run({ ...input, planDigest: plan.planDigest, authorization: "wrong" }), /exact authorization/u);
  assert.equal(writes, 0); assert.equal(effects, 0);
});

test("completed intent rejects a self-asserted archived predecessor digest", () => {
  const evidence = fixture(); let intent = null; let receipt = null;
  const adapter = { captureEvidence: () => evidence, withSubjectFence: (_p, callback) => callback(),
    readIntent: () => intent, writeIntent: (_previous, next) => { intent = next; return next; },
    readReceipt: () => receipt, writeReceipt: (_previous, next) => { receipt = next; return next; },
    archive: plan => observation(plan), observeArchive: plan => observation(plan) };
  const controller = createRecoveryArtifactRetirementController({ adapter });
  const input = { sessionId: "session", operatorDecisionDigest: "a".repeat(64), acknowledgedDriftDigest: null };
  const plan = controller.plan(input);
  controller.run({ ...input, planDigest: plan.planDigest, authorization: plan.exactAuthorization });
  intent = { ...intent, phases: { ...intent.phases,
    complete: { ...intent.phases.complete, archivedIntentDigest: "f".repeat(64) } } };
  const core = { schema: intent.schema, status: intent.status, plan: intent.plan,
    planDigest: intent.planDigest, subjectKey: intent.subjectKey,
    authorizationDigest: intent.authorizationDigest, phases: intent.phases };
  intent = { ...core, intentDigest: digestValue(core) };
  assert.throws(() => controller.observe({ planDigest: plan.planDigest }), /archived-intent binding/u);
});

function observation(plan) { return { sourceAbsent: true, archivePath: plan.archivePath, archivePresent: true, manifestDigest: plan.evidence.manifest.manifestDigest }; }
function fixture() {
  const entries = [{ path: "cleanup-intent.json", type: "file", mode: 384, sizeBytes: 1, sha256: "1".repeat(64) },
    { path: "cleanup-receipt.json", type: "file", mode: 384, sizeBytes: 1, sha256: "2".repeat(64) },
    { path: "lane.bundle", type: "file", mode: 384, sizeBytes: 1, sha256: "3".repeat(64) }];
  const manifestCore = { schema: "agentic-recovery-artifact-manifest/v1", entryCount: 3, fileCount: 3, totalBytes: 3, entries };
  const core = { schema: RECOVERY_ARTIFACT_RETIREMENT_EVIDENCE_SCHEMA,
    owner: { root: "/owner", gitCommonDir: "/owner/.git", identityDigest: "4".repeat(64) },
    subjectRepository: { root: "/subject", gitCommonDir: "/subject/.git", identityDigest: "5".repeat(64) },
    source: "/workspace/.recovery/subject", archiveRoot: "/workspace/.archive",
    cleanup: { kind: "complete-receipt", sourceDirectory: "/workspace/.recovery/subject", intentStatus: "complete",
      intentRawSha256: "6".repeat(64), receiptRawSha256: "7".repeat(64), cleanupPlanDigest: "8".repeat(64),
      subjectKey: "9".repeat(64), bundleSha256: "3".repeat(64), headSha: "a".repeat(40), treeSha: "b".repeat(40),
      headRef: "refs/heads/agent/test", requiredDriftAcknowledgement: null },
    manifest: { ...manifestCore, manifestDigest: digestValue(manifestCore) },
    bundle: { path: "/workspace/.recovery/subject/lane.bundle", sha256: "3".repeat(64), sizeBytes: 1,
      headSha: "a".repeat(40), treeSha: "b".repeat(40), headRef: "refs/heads/agent/test", verified: true },
    integration: { canonicalRef: "refs/remotes/origin/main", canonicalSha: "c".repeat(40), canonicalTreeSha: "d".repeat(40),
      remoteMainSha: "c".repeat(40), headSha: "a".repeat(40), treeSha: "b".repeat(40), disposition: "ancestor", parentSha: null } };
  return { ...core, evidenceDigest: digestValue(core) };
}
