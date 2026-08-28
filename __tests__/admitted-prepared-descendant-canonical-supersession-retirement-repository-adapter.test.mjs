import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { compareStructuredSupersessionDocuments, createController, normalizeSupersessionManifest }
  from "../scripts/admitted-prepared-descendant-canonical-supersession-retirement-controller.mjs";
import { applyCloudTransition, createEmptyLedger } from "../scripts/cloud-collaboration-contract.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { normalizeDeclaredWriteScopeManifest } from "../scripts/scoped-lane-admission-lib.mjs";
import { createTaskAuthorityBinding, createTaskAuthorityCapability }
  from "../scripts/task-bound-lane-authority-contract.mjs";
import { createRepositoryAdapter }
  from "../scripts/admitted-prepared-descendant-canonical-supersession-retirement-repository-adapter.mjs";

const SHA = value => value.repeat(40);
const DIGEST = value => value.repeat(64);

test("structured supersession permits only one exact nested revision change", () => {
  const source = Buffer.from("---\ntitle: x\ndocs_dependency:\n  ref: \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"\n  mode: exact\n---\nbody\n");
  const canonical = Buffer.from("---\ntitle: x\ndocs_dependency:\n  ref: \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"\n  mode: exact\n---\nbody\n");
  const result = compareStructuredSupersessionDocuments(source, canonical,
    { fieldParent: "docs_dependency", fieldKey: "ref" });
  assert.equal(result.subjectValue, SHA("a"));
  assert.equal(result.canonicalValue, SHA("b"));
  assert.match(result.normalizedDocumentDigest, /^[0-9a-f]{64}$/u);
  assert.throws(() => compareStructuredSupersessionDocuments(source,
    Buffer.from(canonical.toString().replace("mode: exact", "mode: loose")),
    { fieldParent: "docs_dependency", fieldKey: "ref" }), /differs outside/u);
  assert.throws(() => compareStructuredSupersessionDocuments(
    Buffer.from(source.toString().replace("  mode: exact", `  ref: "${SHA("c")}"`)), canonical,
    { fieldParent: "docs_dependency", fieldKey: "ref" }), /direct child/u);
  const nested = Buffer.from(`---\ndocs_dependency:\n  nested:\n    ref: "${SHA("a")}"\n---\n`);
  assert.throws(() => compareStructuredSupersessionDocuments(nested, nested,
    { fieldParent: "docs_dependency", fieldKey: "ref" }), /direct child/u);
  const blockScalar = Buffer.from(`---\ndocs_dependency:\n  note: |\n    ref: "${SHA("a")}"\n  ref: "${SHA("a")}"\n---\n`);
  assert.throws(() => compareStructuredSupersessionDocuments(blockScalar, blockScalar,
    { fieldParent: "docs_dependency", fieldKey: "ref" }), /ambiguous YAML/u);
});

test("supersession manifest has closed fields and UTF-8 byte path order", () => {
  const normalized = normalizeSupersessionManifest({
    schema: "agentic-prepared-descendant-canonical-supersession-manifest/v1",
    semanticScope: "successor", targetRevision: SHA("a"), expectedCanonicalRevision: SHA("b"),
    sourceIntegrationRevision: SHA("c"), entries: [
      { path: "z.md", integrationWitnessRevision: SHA("d"), fieldParent: "dependency", fieldKey: "ref" },
      { path: "a.md", integrationWitnessRevision: SHA("d"), fieldParent: "dependency", fieldKey: "ref" },
    ],
  });
  assert.deepEqual(normalized.entries.map(item => item.path), ["a.md", "z.md"]);
  assert.throws(() => normalizeSupersessionManifest({ ...normalized, extra: true }), /keys are invalid/u);
});

test("repository adapter rejects repository-relative authority transport", () => {
  assert.throws(() => createRepositoryAdapter({ repository: "/repo", subjectWorktree: "/subject",
    targetRepository: "owner/repo", pullRequestNumber: 1, claimId: DIGEST("a"),
    statePath: "relative.json", sourceTaskAuthorityFile: "relative.json",
    successorTaskAuthorityFile: "relative.json", successorWriteScopeManifestFile: "relative.json",
    successorManifestFile: "relative.json" }, { git: () => "/git-common" }), /absolute JSON/u);
});

async function exerciseAdapter(t, { partial = false } = {}) {
  const temporary = realpathSync(mkdtempSync(path.join(tmpdir(), "prepared-supersession-adapter-")));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const repository = "/repo", subjectPath = "/subject", targetRepository = "owner/repo";
  const ledgerRepository = "owner/ledger", branch = "agent/device/prepared-source", pathName = "docs/runtime.md";
  const B = SHA("1"), F = SHA("2"), I = SHA("3"), integrationTree = SHA("4");
  const W = SHA("5"), P = SHA("6"), protectedTree = SHA("7"), T = SHA("8");
  const Q = SHA("9"), targetBlob = SHA("e");
  const controllerTree = SHA("9"), sourceDependency = SHA("a"), canonicalDependency = SHA("b");
  const sourceBlob = SHA("c"), canonicalBlob = SHA("d"), nodeId = "PR_source";
  const reviewRequestId = `github-pull-request:${nodeId}`;
  const actor = { actorId: "actor:owner", deviceId: "device", sessionId: "session" };
  const cloudRepository = { repositoryId: "repository:target", canonicalRevision: B };
  const scope = normalizeDeclaredWriteScopeManifest({ schema: "agentic-declared-write-scope/v1",
    semanticScope: "prepared-source", paths: [pathName] });
  let transition = applyCloudTransition({ ledger: createEmptyLedger(ledgerRepository), action: "claim",
    actor, repository: cloudRepository, evaluationTime: "2026-08-28T15:00:00.000Z",
    request: { workItemId: "work:prepared-source", canonicalBaseRevision: B,
      declaredWriteScope: scope.declaredWriteSet, laneRevision: B, leaseEpoch: 1,
      expiresAt: "2026-08-28T17:00:00.000Z", expectedLedgerDigest: null,
      idempotencyKey: "claim:prepared-source" } });
  transition = applyCloudTransition({ ledger: transition.ledger, action: "continue", actor,
    repository: cloudRepository, evaluationTime: "2026-08-28T15:05:00.000Z",
    request: { claimId: transition.claim.claimId, expectedFenceRevision: transition.claim.fenceRevision,
      expectedTransitionCounter: transition.claim.transitionCounter,
      expectedLedgerDigest: transition.ledger.headDigest, mode: "projection", laneRevision: F,
      reviewRequestId, idempotencyKey: "project:prepared-source" } });
  const sourceTransition = transition, sourceClaim = transition.claim, claimId = sourceClaim.claimId;
  if (partial) transition = applyCloudTransition({ ledger: transition.ledger, action: "retire", actor,
    repository: cloudRepository, evaluationTime: "2026-08-28T15:50:00.000Z",
    request: { claimId, expectedFenceRevision: sourceClaim.fenceRevision,
      expectedTransitionCounter: sourceClaim.transitionCounter, expectedLedgerDigest: transition.ledger.headDigest,
      reason: "abandoned", finalRevision: F, reviewRequestId, bytesDigest: DIGEST("a"),
      namedChecksDigest: DIGEST("b"), handoffEvidenceDigest: DIGEST("c"),
      idempotencyKey: "abandon:prepared-source" } });
  const sourceCapability = createTaskAuthorityCapability({
    authoritySubjectId: `urn:agentic-task:${DIGEST("e")}`, issuedAt: "2026-08-28T14:00:00.000Z" });
  const successorCapability = createTaskAuthorityCapability({
    authoritySubjectId: `urn:agentic-task:${DIGEST("f")}`, issuedAt: "2026-08-28T15:30:00.000Z" });
  const admissionManifestDigest = DIGEST("1"), integrationManifestDigest = DIGEST("2");
  const diffBytes = "prepared integration diff\n";
  let ledger = transition.ledger, retired = partial, pullClosed = partial, retireCalls = 0, liveClaims = [];
  let closeCalls = 0, releaseCalls = 0, canonicalHead = P, controllerHead = T, pullHead = I;
  let raceOnConditionalRead = !partial, corruptCapabilityAfterClose = !partial;
  let closeActor = "owner", loseReleaseResponse = partial, pullReadCount = 0, timelineReadCount = 0;
  let lease = { schema: "agentic-writer-lease/v2", status: "active", epoch: 1,
    sessionId: actor.sessionId, device: actor.deviceId, scope: "prepared-source", branch,
    worktreePath: subjectPath, baseSha: B, fenceSha: F,
    pullRequestUrl: "https://example.test/pull/7", autoDelivery: true, runtimeRequired: true,
    admission: { schema: "agentic-lane-admission-lease/v1", status: "admitted",
      semanticScope: "prepared-source", declaredWriteSet: scope.declaredWriteSet,
      writeSetDigest: scope.writeSetDigest, manifestDigest: admissionManifestDigest,
      planReceiptDigest: DIGEST("3"), admissionReceiptDigest: DIGEST("4"),
      existingLaneStateDigest: DIGEST("5"), admittedReportDigest: DIGEST("6"),
      preservationReceiptDigest: DIGEST("7") },
    cloudAuthority: { schema: "agentic-lane-cloud-authority/v1", provider: "github",
      ledgerRepository, targetRepository, claimId, claimDigest: sourceClaim.fenceRevision,
      ledgerRevision: P, ledgerDigest: ledger.headDigest,
      claimLedgerRevision: sourceClaim.ledgerRevision,
      entrySchema: "agentic-cloud-collaboration-entry/v2",
      claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
      operationReceiptDigest: sourceClaim.operationReceiptDigest,
      mutationAuthorityEligible: true, canonicalBaseSha: B, laneRevision: F,
      cloudDeclaredWriteScope: scope.declaredWriteSet, writeSetDigest: scope.writeSetDigest,
      deviceId: actor.deviceId, sessionId: actor.sessionId, reviewRequestId,
      leaseEpoch: 1, transitionCounter: sourceClaim.transitionCounter, state: "active",
      expiresAt: "2026-08-28T17:00:00.000Z", integrationReceiptDigest: null,
      integration: null, manifestDigest: admissionManifestDigest },
    acquiredAt: "2026-08-28T15:00:00.000Z", heartbeatAt: "2026-08-28T15:00:00.000Z",
    expiresAt: "2026-08-28T15:45:00.000Z",
    integration: { schema: "agentic-integration-commit/v1", commitSha: I, treeSha: integrationTree,
      commitMessage: "chore(prepared-source): pin protected dependency",
      manifestDigest: integrationManifestDigest,
      stagedDiffDigest: createHash("sha256").update(diffBytes).digest("hex"),
      paths: [pathName], recordedAt: "2026-08-28T15:10:00.000Z" } };
  lease = { ...lease, taskAuthority: createTaskAuthorityBinding({ capability: sourceCapability,
    lease, boundAt: "2026-08-28T15:00:00.000Z" }) };
  const sourceDocument = Buffer.from(`---\ntitle: runtime\ndocs_dependency:\n  ref: "${sourceDependency}"\n---\nbody\n`);
  const canonicalDocument = Buffer.from(`---\ntitle: runtime\ndocs_dependency:\n  ref: "${canonicalDependency}"\n---\nbody\n`);
  let targetDocument = Buffer.from(`---\ntitle: runtime\ndocs_dependency:\n  ref: "${T}"\n---\nbody\n`);
  const files = {
    sourceCapability: writePrivate(temporary, "source-capability.json", sourceCapability),
    successorCapability: writePrivate(temporary, "successor-capability.json", successorCapability),
    successorScope: writePrivate(temporary, "successor-scope.json", {
      schema: "agentic-declared-write-scope/v1", semanticScope: "final-convergence", paths: [pathName] }),
    successorManifest: writePrivate(temporary, "successor-manifest.json", {
      schema: "agentic-prepared-descendant-canonical-supersession-manifest/v1",
      semanticScope: "final-convergence", targetRevision: T, expectedCanonicalRevision: P,
      sourceIntegrationRevision: I, entries: [{ path: pathName, integrationWitnessRevision: W,
        fieldParent: "docs_dependency", fieldKey: "ref" }] }),
  };
  const git = (cwd, args) => {
    const command = args.join(" ");
    if (command === "rev-parse --path-format=absolute --git-common-dir") return "/git-common";
    if (cwd === subjectPath && command === "branch --show-current") return branch;
    if (cwd === subjectPath && command === "rev-parse HEAD") return I;
    if (cwd === subjectPath && command === "rev-parse HEAD^{tree}") return integrationTree;
    if (cwd === subjectPath && command === `rev-parse refs/heads/${branch}`) return I;
    if (cwd === repository && command === "branch --show-current") return "main";
    if (cwd === repository && (command === "rev-parse HEAD" || command === "rev-parse origin/main")) {
      return canonicalHead;
    }
    if (cwd === repository && command === "rev-parse HEAD^{tree}") return protectedTree;
    if (cwd === repository && command === `rev-parse ${I}:${pathName}`) return sourceBlob;
    if (cwd === repository && command === `rev-parse ${W}:${pathName}`) return sourceBlob;
    if (cwd === repository && command === `rev-parse ${P}:${pathName}`) return canonicalBlob;
    if (cwd === repository && command === `rev-parse ${Q}:${pathName}`) return targetBlob;
    if (cwd === repository && command === `ls-remote --heads origin refs/heads/${branch}`) {
      return `${I}\trefs/heads/${branch}`;
    }
    if (cwd === repository && command === "ls-remote --heads origin refs/heads/main") {
      return `${canonicalHead}\trefs/heads/main`;
    }
    if (cwd !== repository && cwd !== subjectPath && command === "branch --show-current") return "main";
    if (cwd !== repository && cwd !== subjectPath
      && (command === "rev-parse HEAD" || command === "rev-parse origin/main")) return controllerHead;
    if (cwd !== repository && cwd !== subjectPath && command === "rev-parse HEAD^{tree}") return controllerTree;
    if (cwd !== repository && cwd !== subjectPath && command === "ls-remote --heads origin refs/heads/main") {
      return `${controllerHead}\trefs/heads/main`;
    }
    if (command.startsWith("merge-base --is-ancestor ")) return "";
    if (cwd === subjectPath && command === `rev-parse ${I}^{tree}`) return integrationTree;
    if (cwd === subjectPath && command === `log -1 --pretty=%s ${I}`) return lease.integration.commitMessage;
    if (cwd === subjectPath && command === `rev-list --parents -n 1 ${I}`) return `${I} ${F}`;
    throw new Error(`unexpected git ${cwd} ${command}`);
  };
  const gitRaw = (cwd, args) => {
    const command = args.join(" ");
    if (cwd === repository && command === "worktree list --porcelain -z") {
      return `worktree ${repository}\0HEAD ${P}\0branch refs/heads/main\0worktree ${subjectPath}\0HEAD ${I}\0branch refs/heads/${branch}\0`;
    }
    if (command === "status --porcelain=v1 --untracked-files=all"
      || command === "status --porcelain --untracked-files=all") return "";
    if (cwd === subjectPath && command === `diff --name-only -z ${F} ${I} --`) return `${pathName}\0`;
    if (cwd === subjectPath && command === `diff --binary ${F} ${I} --`) return diffBytes;
    return git(cwd, args);
  };
  const readCloud = () => ({ schema: "agentic-cloud-collaboration-result/v1", ok: true,
    action: "status", claims: retired ? liveClaims : [{ ...sourceClaim, claimDigest: sourceClaim.fenceRevision }],
    sequence: ledger.sequence, ledgerRevision: P, ledgerDigest: ledger.headDigest });
  const dependencies = { git, gitRaw,
    gitBuffer: (_cwd, args) => { const object = args[1];
      if (object === `${I}:${pathName}` || object === `${W}:${pathName}`) return sourceDocument;
      if (object === `${P}:${pathName}`) return canonicalDocument;
      if (object === `${Q}:${pathName}`) return targetDocument;
      throw new Error(`unexpected git buffer ${args.join(" ")}`); },
    leaseStore: { read: () => lease,
      withRegistryLock: action => action({ leases: { [branch]: lease } }),
      release: ({ expectedLease, status, timestamp, values }) => {
      assert.deepEqual(lease, expectedLease); releaseCalls += 1;
      lease = { ...lease, ...values, status, heartbeatAt: timestamp, expiresAt: timestamp };
      if (loseReleaseResponse) { loseReleaseResponse = false; throw new Error("local release response lost"); }
      return lease;
    } }, readCloud, readLedger: () => ledger,
    now: () => new Date("2026-08-28T16:00:00.000Z"),
    gh: () => JSON.stringify({ number: 7, id: nodeId, url: lease.pullRequestUrl,
      state: pullClosed ? "CLOSED" : "OPEN", isDraft: true, mergedAt: null,
      closedAt: pullClosed ? (pullReadCount++ % 2 ? "2026-08-28T16:00:00.000Z" : "2026-08-28T16:00:00Z") : null,
      headRefName: branch, headRefOid: pullHead, headRepository: { nameWithOwner: targetRepository },
      baseRefName: "main", baseRefOid: B }),
    readPullTimeline: () => pullClosed ? [{ event: "closed", id: 77, node_id: "CE_source",
      actor: { login: closeActor, id: 17, type: "User" }, created_at: timelineReadCount++ % 2 ? "2026-08-28T16:00:00.000Z" : "2026-08-28T16:00:00Z",
      performed_via_github_app: null }] : [],
    readConditionalPull: () => { const snapshot = { etag: "\"source-etag\"", number: 7, nodeId,
      url: lease.pullRequestUrl, state: "OPEN", isDraft: true, mergedAt: null,
      headBranch: branch, headSha: I, headRepository: targetRepository,
      baseBranch: "main", baseSha: B };
      if (raceOnConditionalRead) pullHead = SHA("0");
      return snapshot; },
    closePull: input => { assert.equal(input.expectedHeadSha, I);
      assert.equal(input.expectedEtag, "\"source-etag\""); closeCalls += 1; pullClosed = true;
      if (corruptCapabilityAfterClose) rewritePrivate(files.sourceCapability,
        createTaskAuthorityCapability({ authoritySubjectId: `urn:agentic-task:${DIGEST("0")}`,
          issuedAt: "2026-08-28T15:30:00.000Z" })); },
    invokeCloud: ({ action, request }) => { assert.equal(action, "retire"); retireCalls += 1;
      assert.equal(request.reason, "superseded"); assert.equal(request.finalRevision, F);
      assert.equal(request.integrationReceiptDigest, null);
      transition = applyCloudTransition({ ledger, action: "retire", actor,
        repository: cloudRepository, evaluationTime: "2026-08-28T16:00:00.000Z",
        request: { ...request, expectedLedgerDigest: ledger.headDigest } });
      ledger = transition.ledger; retired = true; canonicalHead = Q;
      throw new Error("cloud response lost after exact retirement"); },
  };
  const adapter = createRepositoryAdapter({ repository, subjectWorktree: subjectPath, targetRepository,
    ledgerRepository, pullRequestNumber: 7, claimId, statePath: path.join(temporary, "state.json"),
    sourceTaskAuthorityFile: files.sourceCapability,
    successorTaskAuthorityFile: files.successorCapability,
    successorWriteScopeManifestFile: files.successorScope,
    successorManifestFile: files.successorManifest }, dependencies);
  const controller = createController({ adapter }), plan = await controller.plan();
  assert.equal(plan.subject.integration.manifestDigest, integrationManifestDigest);
  assert.equal(plan.subject.lease.manifestDigest, admissionManifestDigest);
  assert.equal(plan.canonical.entries[0].subjectValue, plan.canonical.dependencySourceRevision);
  assert.equal(plan.canonical.entries[0].canonicalValue, plan.canonical.dependencyCanonicalRevision);
  assert.equal(plan.canonical.entries[0].targetValue, plan.canonical.targetDependencyRevision);
  if (partial) {
    assert.equal(plan.mode, "partial-recovery"); assert.equal(plan.recovery.reason, "abandoned");
    assert.equal(plan.subject.pullRequest.closedAt, "2026-08-28T16:00:00.000Z");
    assert.equal(plan.subject.pullRequest.closeEvent.createdAt, "2026-08-28T16:00:00.000Z");
    assert.deepEqual(plan.effects, ["release-local-lease"]);
    const exactLedger = structuredClone(ledger), exactLease = structuredClone(lease);
    for (const mutate of [
      entry => { entry.claimCore.retirement.bytesDigest = DIGEST("d"); },
      entry => { entry.claimCore.laneRevision = SHA("0"); entry.claimCore.retirement.finalRevision = SHA("0"); },
      entry => { entry.claimCore.reviewRequestId = "github-pull-request:FOREIGN";
        entry.claimCore.retirement.reviewRequestId = "github-pull-request:FOREIGN"; },
    ]) {
      ledger = mutateTerminalLedger(exactLedger, mutate);
      await assert.rejects(controller.run({ planDigest: plan.planDigest,
        authorization: plan.exactAuthorization }), /abandoned retirement|ledger/u);
    }
    ledger = exactLedger; closeActor = "intruder";
    await assert.rejects(controller.run({ planDigest: plan.planDigest,
      authorization: plan.exactAuthorization }), /event identity/u);
    closeActor = "owner"; lease = { ...lease, fenceSha: SHA("0") };
    await assert.rejects(controller.run({ planDigest: plan.planDigest,
      authorization: plan.exactAuthorization }), /drifted|binding/u);
    lease = exactLease;
    const unrelatedScope = normalizeDeclaredWriteScopeManifest({ schema: "agentic-declared-write-scope/v1",
      semanticScope: "unrelated", paths: ["docs/unrelated.md"] });
    const unrelated = applyCloudTransition({ ledger, action: "claim", actor,
      repository: cloudRepository, evaluationTime: "2026-08-28T15:55:00.000Z",
      request: { workItemId: "work:unrelated", canonicalBaseRevision: B,
        declaredWriteScope: unrelatedScope.declaredWriteSet, laneRevision: B, leaseEpoch: 1,
        expiresAt: "2026-08-28T17:00:00.000Z", expectedLedgerDigest: ledger.headDigest,
        idempotencyKey: "claim:unrelated" } });
    ledger = unrelated.ledger; liveClaims = [unrelated.claim];
    const receipt = await controller.run({ planDigest: plan.planDigest, authorization: plan.exactAuthorization });
    assert.equal(retireCalls, 0); assert.equal(closeCalls, 0); assert.equal(releaseCalls, 1);
    assert.equal(lease.status, "released"); assert.equal(lease.admission, null); assert.equal(lease.cloudAuthority, null);
    canonicalHead = Q; controllerHead = SHA("f");
    targetDocument = Buffer.from(`---\ntitle: runtime\ndocs_dependency:\n  ref: "${controllerHead}"\n---\nbody\n`);
    const replay = await controller.run({ planDigest: plan.planDigest, authorization: plan.exactAuthorization });
    assert.equal(replay.receiptDigest, receipt.receiptDigest); assert.equal(releaseCalls, 1);
    return;
  }
  await assert.rejects(controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization }), /Pull request identity drifted/u);
  assert.equal(retireCalls, 1); assert.equal(closeCalls, 0);

  raceOnConditionalRead = false; pullHead = I;
  const foreignCapability = createTaskAuthorityCapability({
    authoritySubjectId: `urn:agentic-task:${DIGEST("0")}`, issuedAt: "2026-08-28T15:30:00.000Z" });
  rewritePrivate(files.sourceCapability, foreignCapability);
  await assert.rejects(controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization }), /capability|binding/u);
  assert.equal(closeCalls, 0);

  rewritePrivate(files.sourceCapability, sourceCapability);
  await assert.rejects(controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization }), /capability|binding/u);
  assert.equal(closeCalls, 1); assert.equal(releaseCalls, 0);

  rewritePrivate(files.sourceCapability, sourceCapability); corruptCapabilityAfterClose = false;
  const receipt = await controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization });
  const validReleasedLease = structuredClone(lease);
  lease = { ...lease, sessionId: "foreign-session" };
  await assert.rejects(controller.run({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization }), /terminal|drifted/u);
  lease = validReleasedLease;
  const replay = await controller.run({ planDigest: plan.planDigest, authorization: plan.exactAuthorization });
  assert.equal(replay.receiptDigest, receipt.receiptDigest);
  assert.equal(retireCalls, 1); assert.equal(closeCalls, 1); assert.equal(releaseCalls, 1);
  assert.equal(lease.status, "released"); assert.equal(lease.admission, null);
  assert.equal(lease.cloudAuthority, null); assert.equal(lease.integration.commitSha, I);
}

test("adapter retires only the exact prepared source and replays without Git mutation",
  t => exerciseAdapter(t));
test("adapter recovers an exact abandoned preclosed source with only one replay-safe local release",
  t => exerciseAdapter(t, { partial: true }));

function writePrivate(directory, name, value) {
  const file = path.join(directory, name);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600); return file;
}
function rewritePrivate(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}
function mutateTerminalLedger(value, mutate) {
  const ledger = structuredClone(value), entry = ledger.entries.at(-1); mutate(entry);
  entry.claimDigest = digestValue(entry.claimCore); const draft = { ...entry }; delete draft.digest;
  entry.digest = digestValue(draft); ledger.headDigest = entry.digest; return ledger;
}
