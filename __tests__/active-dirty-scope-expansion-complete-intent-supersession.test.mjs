// Responsibility: Prove the complete-intent tombstone and replacement fence are exact, atomic, and replay-safe.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildActiveDirtyScopeExpansionPlan, buildExpansionReceipt }
  from "../scripts/active-dirty-scope-expansion-contract.mjs";
import {
  OPERATION,
  COMPLETE_INTENT_SUPERSESSION_ARCHIVES_KEY,
  COMPLETE_INTENT_SUPERSESSION_RECEIPTS_KEY,
  PR844_COMPLETE_INTENT_SUBJECT,
  PR844_CURRENT_PATHS,
  PR844_SUCCESSOR_PATHS,
  authorizeCompleteIntentSupersession,
  buildCompleteIntentSupersessionEvidence,
  buildCompleteIntentSupersessionPlan,
  buildCompleteIntentSupersessionResult,
  buildScopeExpansionCompleteIntentArchive,
  buildSeededScopeExpansionIntent,
  buildSeededScopeExpansionIntentReceipt,
  classifyCompleteIntentSupersessionRegistryState,
  normalizeCompleteIntentSupersessionResult,
  normalizeScopeExpansionCompleteIntentArchive,
  normalizeSeededScopeExpansionIntent,
  normalizeSeededScopeExpansionIntentReceipt,
} from "../scripts/active-dirty-scope-expansion-complete-intent-supersession-contract.mjs";
import {
  applyCompleteIntentSupersession,
  assertCompleteIntentSupersessionExternalCapability,
  canonicalizeCompleteIntentSupersessionCurrentClaim,
  createCompleteIntentSupersessionRepositoryController,
} from "../scripts/active-dirty-scope-expansion-complete-intent-supersession-repository-adapter.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier }
  from "../scripts/github-cloud-collaboration-mapping.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "../scripts/scoped-lane-admission-lib.mjs";
import {
  WRITER_LEASE_REGISTRY_SCHEMA,
  projectWriterLeasePullRequestMarker,
} from "../scripts/writer-lease-lib.mjs";
import {
  beginScopeExpansionIntent,
  readScopeExpansionIntent,
  writerLeaseDigest,
} from "../scripts/writer-lease-registry-cas.mjs";

const FALLBACK_PATHS = Object.freeze([
  "__tests__/active-dirty-scope-expansion-complete-intent-supersession.test.mjs",
  "docs/ACTIVE-DIRTY-SCOPE-EXPANSION-COMPLETE-INTENT-SUPERSESSION.md",
  "scripts/active-dirty-scope-expansion-complete-intent-supersession-contract.mjs",
  "scripts/active-dirty-scope-expansion-complete-intent-supersession-repository-adapter.mjs",
  "scripts/active-dirty-scope-expansion-complete-intent-supersession.mjs",
]);

const PRESERVED_PR_845_PATHS = Object.freeze([
  "__tests__/active-dirty-scope-expansion-intent-supersession.test.mjs",
  "__tests__/github-cloud-collaboration-ledger-ref-barrier.test.mjs",
  "docs/ACTIVE-DIRTY-SCOPE-EXPANSION-INTENT-SUPERSESSION.md",
  "scripts/active-dirty-scope-expansion-intent-supersession-contract.mjs",
  "scripts/active-dirty-scope-expansion-intent-supersession-repository-adapter.mjs",
  "scripts/active-dirty-scope-expansion-intent-supersession.mjs",
  "scripts/github-cloud-collaboration-ledger-ref-barrier.mjs",
]);

const SHA = label => digestValue({ sha: label }).slice(0, 40);
const DIGEST = label => digestValue({ digest: label });
const BRANCH = PR844_COMPLETE_INTENT_SUBJECT.branch;
const SCOPE = PR844_COMPLETE_INTENT_SUBJECT.semanticScope;
const SESSION = PR844_COMPLETE_INTENT_SUBJECT.sessionId;
const REPOSITORY = "huijoohwee/agentic-canvas-os";
const CURRENT_PATHS = PR844_CURRENT_PATHS;
const TARGET_PATHS = PR844_SUCCESSOR_PATHS;

function manifest(paths) {
  return normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: SCOPE,
    paths,
  });
}

function dirtEvidence(paths, untrackedPaths = []) {
  const untracked = new Set(untrackedPaths);
  const entries = [...paths].sort().map(item => ({ path: item, staged: false,
    unstaged: !untracked.has(item), untracked: untracked.has(item),
    headMode: untracked.has(item) ? null : "100644", headBlob: untracked.has(item) ? null : SHA(`head:${item}`),
    indexMode: untracked.has(item) ? null : "100644", indexBlob: untracked.has(item) ? null : SHA(`head:${item}`),
    worktreeType: "file", worktreeMode: "100644", worktreeBlob: SHA(`worktree:${item}`) }));
  const core = { schema: "agentic-active-owned-dirt-evidence/v1",
    headSha: PR844_COMPLETE_INTENT_SUBJECT.fenceSha, entries, pathCount: entries.length,
    stagedPathCount: 0, unstagedPathCount: entries.length - untracked.size,
    untrackedPathCount: untracked.size };
  return { ...core, evidenceDigest: digestValue(core) };
}

function resealDirt(value) {
  const core = { ...value, entries: [...value.entries].sort((left, right) =>
    Buffer.compare(Buffer.from(left.path), Buffer.from(right.path))) };
  delete core.evidenceDigest;
  return { ...core, evidenceDigest: digestValue(core) };
}

// Exact normalized completed v1 intent captured from PR 844's repository-owned registry.
const PR844_COMPLETE_INTENT = JSON.parse(String.raw`{"schema":"agentic-active-dirty-scope-expansion-intent/v1","status":"complete","branch":"agent/huis-macbook-pro-3.local/provisioned-start-pre-bind-descendant-recovery","sourceLeaseDigest":"5124ec22a7be554497f323c576a5f3752c9a217870e1340886e42e4cab2c9cfd","sourceClaimId":"3a238d3f17b5ea6f51aa367c8959cbce88b05c530e0780d6e16828d309a3a190","sourceFenceSha":"ecb97f0c250f92a5c32e9e4306ce95f1626cf0c9","targetWriteSetDigest":"e067a6edc8babad62ce3238a9da5397956db0f0ffe4e9dbf8b945f6d5b54eaf5","targetManifestDigest":"f2ecd76a03e25d2cf88adc54c2d9a22c642b122ca05eca5b77fca502a7edd8be","planDigest":"be2a2e6a77c956920fcb2190004f285addae86a23f7123fd4b56192ebd5c9655","targetClaimId":"a19af0274866524387c444a6132f04ff70accd9921cb6c7856039af5fdb6120b","targetClaimDigest":"01bbf29cca438bfa3e84dc6a7892bcc7aae0cdc8d3965755686a7a581c8c78ca","targetLeaseEpoch":1,"targetCanonicalBaseSha":"2cfd12cab616a033e78b9354d79992fdc5612d97","targetReviewRequestId":"github-pull-request:PR_kwDOSr5-fM8AAAABBjuaEw","completedReceiptDigest":null,"waiting":{"claimId":"a19af0274866524387c444a6132f04ff70accd9921cb6c7856039af5fdb6120b","claimDigest":"6a53521c11f7121c23024beec90b09979a08572aa59022dde4b807823e3abb7c","ledgerRevision":"c48174337b4da41c5dbaa59f97be35801160b390","claimLedgerRevision":"3d37fc0da462e9a212f7d2130e10a51a316ed2cf41588d0bc8c6ac478a512c99","transitionCounter":1,"expiresAt":"2026-09-01T05:52:52.000Z"},"waitingReceiptDigest":"bc09623f51d1c304930e71e4356df8b785477bda66613caac15f7dafd54b3ed0","sourceRetirementReceiptDigest":"fab139618f4f823135a23ab09088b6099d853378f53f83de055dbebcb913862a","promoted":{"claimId":"a19af0274866524387c444a6132f04ff70accd9921cb6c7856039af5fdb6120b","claimDigest":"a96953077c47ba4f5adceecc6c55de6fcd8464b4fb3d4e90c536fb1dc7fb568c","ledgerRevision":"c913bba553cd01c577d0f24ba3c9a5c7a89b4220","claimLedgerRevision":"43b6d7389582b83e4a519248ec5e83e142a47798c42d8725d5b58f7a78088895","transitionCounter":2,"expiresAt":"2026-09-01T05:55:16.000Z"},"promotedReceiptDigest":"fe29cf72c30d409c6ac56a8d70e0eb177bbf0500b5bc0f6d1abc4eb5f9412f9f","boundAuthority":{"schema":"agentic-lane-cloud-authority/v1","provider":"github","ledgerRepository":"huijoohwee/agentic-canvas-os","targetRepository":"huijoohwee/agentic-canvas-os","claimId":"a19af0274866524387c444a6132f04ff70accd9921cb6c7856039af5fdb6120b","claimDigest":"01bbf29cca438bfa3e84dc6a7892bcc7aae0cdc8d3965755686a7a581c8c78ca","ledgerRevision":"0e3aee6dc5a1164e0561bd396118e104655dbb81","ledgerDigest":"c3f8ceabc8f3c9132281632254a7a7555bd1136bcd8c69522c78f0bc017c3050","claimLedgerRevision":"c3f8ceabc8f3c9132281632254a7a7555bd1136bcd8c69522c78f0bc017c3050","entrySchema":"agentic-cloud-collaboration-entry/v2","claimIdentitySchema":"agentic-cloud-collaboration-entry/v2","operationReceiptDigest":"495bc24d80654a1558d4e85fdbd7906c42547a06cde5e0923afc54683ac8ee43","mutationAuthorityEligible":true,"canonicalBaseSha":"2cfd12cab616a033e78b9354d79992fdc5612d97","laneRevision":"ecb97f0c250f92a5c32e9e4306ce95f1626cf0c9","cloudDeclaredWriteScope":["path:__tests__/provisioned-start-admission-recovery-cli.test.mjs","path:__tests__/provisioned-start-admission-recovery-contract.test.mjs","path:__tests__/provisioned-start-admission-recovery-controller.test.mjs","path:__tests__/provisioned-start-admission-recovery-real-adapter.test.mjs","path:__tests__/provisioned-start-admission-recovery-repository-adapter.test.mjs","path:__tests__/provisioned-start-admission-recovery-store.test.mjs","path:__tests__/provisioned-start-cloud-authority-subject.test.mjs","path:docs/PROVISIONED-START-ADMISSION-RECOVERY.md","path:scripts/provisioned-start-admission-recovery-contract.mjs","path:scripts/provisioned-start-admission-recovery-controller.mjs","path:scripts/provisioned-start-admission-recovery-repository-adapter.mjs","path:scripts/provisioned-start-admission-recovery-store.mjs","path:scripts/provisioned-start-cloud-authority-subject.mjs","semantic:provisioned-start-pre-bind-descendant-recovery"],"writeSetDigest":"e067a6edc8babad62ce3238a9da5397956db0f0ffe4e9dbf8b945f6d5b54eaf5","deviceId":"huis-macbook-pro-3.local","sessionId":"01a0554f-78d4-7221-b216-ed700a4bae72","reviewRequestId":"github-pull-request:PR_kwDOSr5-fM8AAAABBjuaEw","leaseEpoch":1,"transitionCounter":3,"state":"active","expiresAt":"2026-09-01T05:55:16.000Z","integrationReceiptDigest":null,"integration":null,"manifestDigest":"f2ecd76a03e25d2cf88adc54c2d9a22c642b122ca05eca5b77fca502a7edd8be"},"boundReceiptDigest":"957c851bc20da168685348da52d6581280e331551cbe36e1ee345230b974f693","localProjection":{"leaseDigest":"c38b4a3faeb52084a1aed291205be818d1399a459932725d0312a01752a0ec6f","claimId":"a19af0274866524387c444a6132f04ff70accd9921cb6c7856039af5fdb6120b","ownerIdentityDigest":"8051e57bb9c3d24a73a98a3de5072d8903ad02a2a7b2d1dc884afd20c0d7d59f","receiptDigest":"90e617766a4284a5f903c4d56f803efb7207fc972f3c8d73f7792e0ae8691ebb","sourceAdmissionDigest":"005e9761682362b6ee23070de898bdb78271fceba062e4cead3381604f2d87b8","sourceExistingLaneStateDigest":"f3698f6e007ec6f94d01c2e112bbf87041956f22dfa1d6ba20d350470afaa016","sourceTaskAuthorityBindingDigest":"3524b4d20400d2ab5e9ec38f7a2669d8494536cfa685c7151862db8e5bec6b1b","targetTaskAuthorityBindingDigest":"af4e9e3a839083055fa0e9bc7250badefb86ea23baa96741d0147d64692b78c4"},"localProjectionReceiptDigest":"90e617766a4284a5f903c4d56f803efb7207fc972f3c8d73f7792e0ae8691ebb","pullRequestProjection":{"markerDigest":"1c023957a2c4bc9e3291f9181b495496c8284430d5846d5bd1ecb8d1b9a3bf36"},"pullRequestProjectionReceiptDigest":"523cf48d66b87b9e6c5412bc6cce4364c4c0e25001c27b09a8e123a7e352d47c","finalReceiptDigest":"b4a9af618d05b9d110767dee9bcb3c2b14086263b829f90d4a3c0b89429b2852","planSnapshot":{"schema":"agentic-active-dirty-scope-expansion-plan/v1","sourceBranch":"agent/huis-macbook-pro-3.local/provisioned-start-pre-bind-descendant-recovery","sourceFenceSha":"ecb97f0c250f92a5c32e9e4306ce95f1626cf0c9","sourceLeaseDigest":"5124ec22a7be554497f323c576a5f3752c9a217870e1340886e42e4cab2c9cfd","sourceClaimId":"3a238d3f17b5ea6f51aa367c8959cbce88b05c530e0780d6e16828d309a3a190","sourceClaimDigest":"841c3b2e4cbe9b2fc47f59985806b3d9cdf8541e3bce50a3c750b8ca9cebe25b","sourceClaimTransitionCounter":3,"sourceReviewRequestId":"github-pull-request:PR_kwDOSr5-fM8AAAABBjuaEw","sourceWriteSetDigest":"fce232b873199d8b3a2b7faa5d745c18cdbcf6ff7089c0ed1da07ddb37771951","sourceManifestDigest":"bfdc144bf84c5a7a6b0fc783abad60e84623169325a36dcef45e39afd6853e09","sourceDirtyDigest":"260edb168c4b812fdc0c7b9da9d88c1291268646d0612659e9adb2e0b1ddfda8","sourceChangedPaths":["__tests__/provisioned-start-admission-recovery-cli.test.mjs","__tests__/provisioned-start-admission-recovery-contract.test.mjs","__tests__/provisioned-start-admission-recovery-controller.test.mjs","__tests__/provisioned-start-admission-recovery-real-adapter.test.mjs","__tests__/provisioned-start-admission-recovery-repository-adapter.test.mjs","__tests__/provisioned-start-cloud-authority-subject.test.mjs","docs/PROVISIONED-START-ADMISSION-RECOVERY.md","scripts/provisioned-start-admission-recovery-contract.mjs","scripts/provisioned-start-admission-recovery-controller.mjs","scripts/provisioned-start-admission-recovery-repository-adapter.mjs","scripts/provisioned-start-admission-recovery-store.mjs","scripts/provisioned-start-cloud-authority-subject.mjs"],"targetCanonicalBaseSha":"2cfd12cab616a033e78b9354d79992fdc5612d97","targetManifestDigest":"f2ecd76a03e25d2cf88adc54c2d9a22c642b122ca05eca5b77fca502a7edd8be","targetWriteSetDigest":"e067a6edc8babad62ce3238a9da5397956db0f0ffe4e9dbf8b945f6d5b54eaf5","targetDeclaredWriteSet":["path:__tests__/provisioned-start-admission-recovery-cli.test.mjs","path:__tests__/provisioned-start-admission-recovery-contract.test.mjs","path:__tests__/provisioned-start-admission-recovery-controller.test.mjs","path:__tests__/provisioned-start-admission-recovery-real-adapter.test.mjs","path:__tests__/provisioned-start-admission-recovery-repository-adapter.test.mjs","path:__tests__/provisioned-start-admission-recovery-store.test.mjs","path:__tests__/provisioned-start-cloud-authority-subject.test.mjs","path:docs/PROVISIONED-START-ADMISSION-RECOVERY.md","path:scripts/provisioned-start-admission-recovery-contract.mjs","path:scripts/provisioned-start-admission-recovery-controller.mjs","path:scripts/provisioned-start-admission-recovery-repository-adapter.mjs","path:scripts/provisioned-start-admission-recovery-store.mjs","path:scripts/provisioned-start-cloud-authority-subject.mjs","semantic:provisioned-start-pre-bind-descendant-recovery"],"targetCloudLeaseEpoch":1,"planDigest":"be2a2e6a77c956920fcb2190004f285addae86a23f7123fd4b56192ebd5c9655"}}`);

function completeIntentFixture({ changedPaths = CURRENT_PATHS, untrackedPaths = [] } = {}) {
  const currentManifest = manifest(CURRENT_PATHS);
  const targetManifest = manifest(TARGET_PATHS);
  const sourceIntent = structuredClone(PR844_COMPLETE_INTENT);
  const currentLease = leaseFixture(currentManifest);
  const dirt = dirtEvidence(changedPaths, untrackedPaths);
  const successorPlan = buildActiveDirtyScopeExpansionPlan({
    source: { lease: currentLease, branch: BRANCH, fenceSha: currentLease.fenceSha,
      claimId: currentLease.cloudAuthority.claimId,
      claimDigest: currentLease.cloudAuthority.claimDigest,
      changedPaths: dirt.entries.map(entry => entry.path), untrackedPaths,
      dirtyDigest: dirt.evidenceDigest },
    targetManifest, targetCanonicalBaseSha: currentLease.baseSha,
  });
  const marker = projectWriterLeasePullRequestMarker(currentLease);
  const pullRequest = {
    targetRepository: REPOSITORY, repositoryId: "github-repository:R_test",
    number: 844, nodeId: "PR_kwDOSr5-fM8AAAABBjuaEw",
    url: `https://github.com/${REPOSITORY}/pull/844`, state: "OPEN", isDraft: true,
    autoMergeRequest: null, headRepository: REPOSITORY, headRepositoryId: "R_test",
    headRefName: BRANCH, headRefOid: currentLease.fenceSha, baseRefName: "main",
    baseRefOid: currentLease.baseSha, bodyDigest: DIGEST("pull body"),
    writerMarker: marker, writerMarkerDigest: digestValue(marker),
    bodyRemainderDigest: DIGEST("pull body remainder"),
  };
  const authority = currentLease.cloudAuthority;
  const currentClaim = {
    claimId: authority.claimId, entrySchema: authority.entrySchema,
    claimIdentitySchema: authority.claimIdentitySchema, state: "current",
    writeAuthority: true, scopeReserved: true, mutationAuthorityEligible: true,
    actorId: "github-user:owner",
    deviceId: pseudonymousIdentifier("device", currentLease.device),
    sessionId: pseudonymousIdentifier("session", currentLease.sessionId),
    repositoryId: pullRequest.repositoryId,
    workItemId: pseudonymousIdentifier("work-item", currentLease.scope),
    canonicalBaseRevision: currentLease.baseSha, laneRevision: currentLease.fenceSha,
    declaredWriteScope: currentManifest.declaredWriteSet,
    writeSetDigest: currentManifest.writeSetDigest, leaseEpoch: 1,
    transitionCounter: authority.transitionCounter, heartbeatCounter: 2,
    reviewRequestId: authority.reviewRequestId,
    predecessorClaimId: PR844_COMPLETE_INTENT_SUBJECT.predecessorClaimId,
    expiresAt: authority.expiresAt, fenceRevision: authority.claimDigest,
    transitionDigest: authority.claimLedgerRevision,
    operationReceiptDigest: authority.operationReceiptDigest,
  };
  return { targetRepository: REPOSITORY, lease: currentLease,
    leaseDigest: writerLeaseDigest(currentLease), currentClaim, pullRequest, dirt,
    sourceIntent, sourceIntentDigest: digestValue(sourceIntent),
    sourceCompletionReceipt: buildExpansionReceipt({ phase: "complete",
      plan: sourceIntent.planSnapshot,
      values: { finalReceiptDigest: sourceIntent.finalReceiptDigest } }),
    priorArchiveDigest: null, targetManifest, successorPlan };
}

function leaseFixture(admission) {
  const subject = PR844_COMPLETE_INTENT_SUBJECT;
  const cloudAuthority = {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: REPOSITORY,
    targetRepository: REPOSITORY,
    claimId: subject.currentClaimId,
    claimDigest: DIGEST("current claim fence"),
    ledgerRevision: SHA("current ledger"),
    ledgerDigest: DIGEST("current ledger"),
    claimLedgerRevision: DIGEST("current claim transition"),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: DIGEST("current claim operation"),
    mutationAuthorityEligible: true,
    canonicalBaseSha: subject.baseSha,
    laneRevision: subject.fenceSha,
    cloudDeclaredWriteScope: admission.declaredWriteSet,
    writeSetDigest: admission.writeSetDigest,
    deviceId: "huis-macbook-pro-3.local",
    sessionId: SESSION,
    reviewRequestId: subject.reviewRequestId,
    leaseEpoch: 1,
    transitionCounter: 3,
    state: "active",
    expiresAt: "2099-09-01T05:55:16.000Z",
    integrationReceiptDigest: null,
    integration: null,
    manifestDigest: admission.manifestDigest,
  };
  return {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 3,
    sessionId: SESSION,
    device: "huis-macbook-pro-3.local",
    scope: SCOPE,
    branch: BRANCH,
    worktreePath: "/subject",
    baseSha: subject.baseSha,
    fenceSha: subject.fenceSha,
    pullRequestUrl: `https://github.com/${REPOSITORY}/pull/844`,
    autoDelivery: true,
    runtimeRequired: true,
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
      semanticScope: SCOPE,
      declaredWriteSet: admission.declaredWriteSet,
      writeSetDigest: admission.writeSetDigest,
      manifestDigest: admission.manifestDigest,
      planReceiptDigest: DIGEST("admission plan"),
      admissionReceiptDigest: DIGEST("admission receipt"),
      existingLaneStateDigest: DIGEST("existing state"),
      admittedReportDigest: DIGEST("admitted report"),
      preservationReceiptDigest: DIGEST("preservation"),
    },
    cloudAuthority,
    acquiredAt: "2026-08-31T05:38:32.171Z",
    heartbeatAt: "2026-08-31T05:55:16.000Z",
    expiresAt: "2099-09-01T05:55:16.000Z",
    taskAuthority: {
      schema: "agentic-task-authority-binding/v1",
      authoritySubjectId: "urn:agentic-task:b2290c782375e1a209d4750ebd790523e05b29504073f2c21a62b0077ae6600f",
      proofAdapterId: "urn:agentic-proof:ed25519-file:v1",
      generation: 1,
      publicKey: "MCowBQYDK2VwAyEAbgr1MJZZwCtIBc1UNXR9u+4weQB/PjtPn6mDiizHU4A=",
      publicKeyDigest: "9261939f2b48f8c06451453515537ed0547b0646d8e568527015daa4cdff4366",
      laneBindingDigest: "498013838c5bebe98a0a61f333237be5f6b3d2df4b32665bd04dc40ba80695a8",
      bindingMode: "continuation",
      boundAt: "2026-08-31T05:57:18.465Z",
      transitionPlanDigest: null,
      priorBindingDigest: "3524b4d20400d2ab5e9ec38f7a2669d8494536cfa685c7151862db8e5bec6b1b",
      bindingDigest: "af4e9e3a839083055fa0e9bc7250badefb86ea23baa96741d0147d64692b78c4",
    },
  };
}

test("fallback runtime remains path-disjoint from preserved PR 845", () => {
  assert.deepEqual(
    FALLBACK_PATHS.filter(path => PRESERVED_PR_845_PATHS.includes(path)),
    [],
  );
  for (const file of FALLBACK_PATHS) assert.ok(readFileSync(
    path.resolve(import.meta.dirname, "..", file), "utf8").trimEnd().split("\n").length < 600);
});

test("exact PR844 evidence seals the full completed intent and a normal strict-successor fence", () => {
  const fixture = completeIntentFixture();
  const evidence = buildCompleteIntentSupersessionEvidence(fixture);
  assert.equal(evidence.sourceIntentDigest, PR844_COMPLETE_INTENT_SUBJECT.completedIntentDigest);
  assert.equal(evidence.sourceCompletionReceipt.phase, "complete");
  assert.equal(evidence.sourceCompletionReceipt.finalReceiptDigest,
    PR844_COMPLETE_INTENT_SUBJECT.completedFinalReceiptDigest);
  assert.deepEqual(evidence.successorPlan.sourceChangedPaths, CURRENT_PATHS);
  assert.deepEqual(evidence.successorIntent,
    buildSeededScopeExpansionIntent({ plan: buildCompleteIntentSupersessionPlan({ evidence }) }));
  assert.equal(evidence.pullRequest.baseRefOid, PR844_COMPLETE_INTENT_SUBJECT.baseSha);

  const plan = buildCompleteIntentSupersessionPlan({ evidence });
  assert.equal(plan.exactAuthorization, `authorize ${OPERATION} ${plan.planDigest}`);
  assert.throws(() => authorizeCompleteIntentSupersession({
    plan, authorization: `authorize ${OPERATION} ${DIGEST("other plan")}`,
  }), /requires exact authorization/u);
  assert.equal(authorizeCompleteIntentSupersession({
    plan, authorization: plan.exactAuthorization,
  }).planDigest, plan.planDigest);
});

test("closed PR844 profile requires the exact 13 current paths, not its historical source dirt", () => {
  assert.notDeepEqual(CURRENT_PATHS, PR844_COMPLETE_INTENT.planSnapshot.sourceChangedPaths);
  const fixture = completeIntentFixture({ changedPaths: [CURRENT_PATHS.at(-1)] });
  assert.throws(() => buildCompleteIntentSupersessionEvidence(fixture),
    /source, provider, dirt, or strict-successor join/u);

  const outside = completeIntentFixture();
  outside.dirt.entries[0].path = "scripts/foreign.mjs";
  outside.dirt = resealDirt(outside.dirt);
  assert.throws(() => buildCompleteIntentSupersessionEvidence(outside),
    /source, provider, dirt, or strict-successor join/u);
});

test("evidence rejects every foreign, forked, stale-marker, claim, scope, and dirt join", () => {
  const cases = [
    value => { value.targetRepository = "other/repository"; },
    value => { value.lease.sessionId = "foreign-session"; },
    value => { value.lease.cloudAuthority.mutationAuthorityEligible = false; },
    value => { value.lease.taskAuthority.bindingDigest = DIGEST("foreign task"); },
    value => { value.currentClaim.predecessorClaimId = DIGEST("foreign predecessor"); },
    value => { value.currentClaim.transitionDigest = DIGEST("claim-local drift"); },
    value => { value.currentClaim.writeAuthority = false; },
    value => { value.pullRequest.headRepository = "fork/repository"; },
    value => { value.pullRequest.nodeId = "PR_foreign"; },
    value => { value.pullRequest.autoMergeRequest = {}; },
    value => { value.pullRequest.writerMarker.branch = "agent/foreign/scope"; },
    value => { const entry = value.dirt.entries[0]; Object.assign(entry, { unstaged: false,
      untracked: true, headMode: null, headBlob: null, indexMode: null, indexBlob: null });
      value.dirt.unstagedPathCount -= 1; value.dirt.untrackedPathCount += 1;
      value.dirt = resealDirt(value.dirt); },
    value => { value.sourceIntent.finalReceiptDigest = DIGEST("forged completion"); },
    value => { value.targetManifest = manifest(CURRENT_PATHS); },
    value => { value.targetManifest = normalizeDeclaredWriteScopeManifest({
      schema: "agentic-declared-write-scope/v1", semanticScope: "foreign-scope",
      paths: TARGET_PATHS,
    }); },
    value => { value.successorPlan = {
      ...value.successorPlan, sourceDirtyDigest: DIGEST("stale dirt"),
    }; },
  ];
  for (const mutate of cases) {
    const value = completeIntentFixture();
    mutate(value);
    assert.throws(() => buildCompleteIntentSupersessionEvidence(value),
      /Complete-intent supersession|Scope-expansion|write-scope manifest/u);
  }
});

test("unrelated ledger advance is accepted while claim-local transition drift is rejected", () => {
  const baseline = buildCompleteIntentSupersessionEvidence(completeIntentFixture());
  const advanced = completeIntentFixture();
  advanced.currentClaim.inventoryLedgerRevision = SHA("unrelated ledger advance");
  advanced.currentClaim.inventoryLedgerDigest = DIGEST("unrelated ledger advance");
  assert.equal(buildCompleteIntentSupersessionEvidence(advanced).evidenceDigest,
    baseline.evidenceDigest);

  advanced.currentClaim.transitionDigest = DIGEST("claim-local drift");
  assert.throws(() => buildCompleteIntentSupersessionEvidence(advanced), /source, provider/u);
});

test("live provider active/current claim states canonicalize only as the exact verified pair", () => {
  const claim = completeIntentFixture().currentClaim;
  const authority = { claimId: claim.claimId, state: "active" };
  const verified = { ...claim, state: "active" };
  assert.equal(canonicalizeCompleteIntentSupersessionCurrentClaim({
    authority, verifiedClaims: [verified], rawClaims: [claim],
  }).state, "current");
  for (const [verifiedState, rawState] of [["current", "current"], ["active", "active"]]) {
    assert.throws(() => canonicalizeCompleteIntentSupersessionCurrentClaim({
      authority,
      verifiedClaims: [{ ...verified, state: verifiedState }],
      rawClaims: [{ ...claim, state: rawState }],
    }), /verified active\/raw current claim equivalence/u);
  }
  assert.throws(() => canonicalizeCompleteIntentSupersessionCurrentClaim({
    authority, verifiedClaims: [verified],
    rawClaims: [{ ...claim, operationReceiptDigest: DIGEST("raw drift") }],
  }), /verified active\/raw current claim equivalence/u);
});

test("repository-contained task authority is rejected before runtime access", () => {
  const repository = path.resolve(import.meta.dirname, "..");
  assert.throws(() => createCompleteIntentSupersessionRepositoryController({
    sourceRepository: repository, sessionId: SESSION, pullRequestNumber: 844,
    targetManifest: manifest(TARGET_PATHS), taskAuthorityFile: "package.json",
  }), /capability path must be absolute/u);
  assert.throws(() => createCompleteIntentSupersessionRepositoryController({
    sourceRepository: repository, sessionId: SESSION, pullRequestNumber: 844,
    targetManifest: manifest(TARGET_PATHS), taskAuthorityFile: path.join(repository, "package.json"),
  }), /must remain outside every repository/u);
  for (const root of [path.join(repository, ".git"), path.join(repository, "..", "sibling")]) {
    assert.throws(() => assertCompleteIntentSupersessionExternalCapability({
      capabilityPath: path.join(root, "capability.json"), repositoryRoots: [repository, root],
    }), /must remain outside every repository/u);
  }
});

test("archive, seed receipt, and result seal full lineage and all zero-effect boundaries", () => {
  const plan = buildCompleteIntentSupersessionPlan({ evidence: completeIntentFixture() });
  const taskAuthorityReceipt = taskReceipt(plan);
  const archive = buildScopeExpansionCompleteIntentArchive({
    plan, authorizationReceipt: authorizationReceipt(plan), taskAuthorityReceipt,
  });
  const seedReceipt = buildSeededScopeExpansionIntentReceipt({
    plan, archive, taskAuthorityReceipt, registryRevision: 42,
  });
  const result = buildCompleteIntentSupersessionResult({ plan, archive, seedReceipt });
  assert.deepEqual(archive.sourceIntent, plan.evidence.sourceIntent);
  assert.deepEqual(archive.sourceCompletionReceipt, plan.evidence.sourceCompletionReceipt);
  assert.deepEqual(seedReceipt.seededIntent, plan.evidence.successorIntent);
  assert.equal(result.sourceBytesChanged, false);
  assert.equal(result.indexChanged, false);
  assert.equal(result.gitObjectsChanged, false);
  assert.equal(result.gitRefsChanged, false);
  assert.equal(result.pullRequestMutated, false);
  assert.equal(result.cloudMutated, false);
  assert.equal(result.merged, false);
  assert.equal(result.cleanedUp, false);
  assert.equal(result.deployed, false);
  normalizeScopeExpansionCompleteIntentArchive(archive, { plan });
  normalizeSeededScopeExpansionIntentReceipt(seedReceipt, { plan, archive });
  normalizeCompleteIntentSupersessionResult(result, { plan });
  normalizeSeededScopeExpansionIntent({ plan, intent: seedReceipt.seededIntent });
});

test("registry classifier rejects tombstone tamper, collision, and source CAS drift", () => {
  const plan = buildCompleteIntentSupersessionPlan({ evidence: completeIntentFixture() });
  const archive = buildScopeExpansionCompleteIntentArchive({
    plan, authorizationReceipt: authorizationReceipt(plan),
    taskAuthorityReceipt: taskReceipt(plan),
  });
  const seedReceipt = buildSeededScopeExpansionIntentReceipt({
    plan, archive, taskAuthorityReceipt: taskReceipt(plan), registryRevision: 42,
  });
  const seeded = buildSeededScopeExpansionIntent({ plan });
  assert.equal(classifyCompleteIntentSupersessionRegistryState({
    plan, currentIntent: plan.evidence.sourceIntent, archives: [],
  }).state, "ready");
  assert.equal(classifyCompleteIntentSupersessionRegistryState({
    plan, currentIntent: seeded, archives: [archive], receipts: [seedReceipt],
  }).state, "replay");
  assert.throws(() => classifyCompleteIntentSupersessionRegistryState({
    plan, currentIntent: plan.evidence.sourceIntent, archives: [archive],
  }), /collision/u);
  const tampered = structuredClone(archive);
  tampered.sourceCompletionReceipt.finalReceiptDigest = DIGEST("tampered tombstone");
  assert.throws(() => classifyCompleteIntentSupersessionRegistryState({
    plan, currentIntent: seeded, archives: [tampered],
  }), /archive|receipt|drift|lineage|history/u);
  const drifted = structuredClone(plan.evidence.sourceIntent);
  drifted.finalReceiptDigest = DIGEST("source CAS drift");
  assert.throws(() => classifyCompleteIntentSupersessionRegistryState({
    plan, currentIntent: drifted, archives: [],
  }), /source intent CAS drift/u);
});

test("one registry CAS atomically archives the terminal intent and seeds ordinary expansion", () => {
  const plan = buildCompleteIntentSupersessionPlan({ evidence: completeIntentFixture() });
  const harness = registryHarness(plan);
  try {
    const beforeLease = structuredClone(plan.evidence.lease);
    assert.throws(() => applyCompleteIntentSupersession({ leaseStore: harness.store,
      branch: "agent/foreign/scope", plan }), /registry branch plan join/u);
    const result = applyCompleteIntentSupersession({ leaseStore: harness.store, branch: BRANCH,
      plan, authorizationReceipt: authorizationReceipt(plan), taskAuthorityReceipt: taskReceipt(plan) });
    const registry = harness.read();
    assert.equal(registry.revision, 10);
    assert.deepEqual(registry.leases[BRANCH], beforeLease);
    assert.deepEqual(registry.unrelated, { preserved: true });
    assert.deepEqual(registry.scopeExpansionIntents[BRANCH], plan.evidence.successorIntent);
    assert.deepEqual(registry[COMPLETE_INTENT_SUPERSESSION_ARCHIVES_KEY][BRANCH][0].sourceIntent,
      plan.evidence.sourceIntent);
    assert.deepEqual(registry[COMPLETE_INTENT_SUPERSESSION_RECEIPTS_KEY][BRANCH][0].seededIntent,
      plan.evidence.successorIntent);
    assert.equal(result.replayed, false);

    const ordinary = readScopeExpansionIntent({ leaseStore: harness.store, branch: BRANCH });
    assert.deepEqual(ordinary, plan.evidence.successorIntent);
    assert.deepEqual(beginScopeExpansionIntent({ leaseStore: harness.store, branch: BRANCH,
      expectedLeaseDigest: plan.evidence.leaseDigest,
      expectedClaimId: plan.evidence.currentClaim.claimId,
      plan: plan.evidence.successorPlan }).intent, ordinary);
    const exactBytes = readFileSync(harness.statePath, "utf8");
    const replay = applyCompleteIntentSupersession({
      leaseStore: harness.store, branch: BRANCH, plan,
    });
    assert.equal(replay.replayed, true);
    assert.equal(readFileSync(harness.statePath, "utf8"), exactBytes);
  } finally { harness.dispose(); }
});

test("registry CAS rejects claim drift, tombstone tamper, and archive collision with zero writes", () => {
  const plan = buildCompleteIntentSupersessionPlan({ evidence: completeIntentFixture() });
  const claimDrift = registryHarness(plan);
  try {
    const registry = claimDrift.read();
    registry.leases[BRANCH].cloudAuthority.claimId = DIGEST("foreign claim");
    claimDrift.write(registry);
    const before = readFileSync(claimDrift.statePath, "utf8");
    assert.throws(() => applyCompleteIntentSupersession({
      leaseStore: claimDrift.store, branch: BRANCH, plan,
      authorizationReceipt: authorizationReceipt(plan), taskAuthorityReceipt: taskReceipt(plan),
    }), /claim changed|lease changed/u);
    assert.equal(readFileSync(claimDrift.statePath, "utf8"), before);
  } finally { claimDrift.dispose(); }

  const collision = registryHarness(plan);
  try {
    applyCompleteIntentSupersession({ leaseStore: collision.store, branch: BRANCH, plan,
      authorizationReceipt: authorizationReceipt(plan), taskAuthorityReceipt: taskReceipt(plan) });
    const registry = collision.read();
    registry.scopeExpansionIntents[BRANCH] = structuredClone(plan.evidence.sourceIntent);
    collision.write(registry);
    const before = readFileSync(collision.statePath, "utf8");
    assert.throws(() => applyCompleteIntentSupersession({
      leaseStore: collision.store, branch: BRANCH, plan,
    }), /collision/u);
    assert.equal(readFileSync(collision.statePath, "utf8"), before);
    registry[COMPLETE_INTENT_SUPERSESSION_ARCHIVES_KEY][BRANCH][0].archiveDigest = DIGEST("tamper");
    collision.write(registry);
    assert.throws(() => applyCompleteIntentSupersession({
      leaseStore: collision.store, branch: BRANCH, plan,
    }), /history|archive/u);
  } finally { collision.dispose(); }
});

test("controller replays a response-lost CAS without a second proof or supersession", async () => {
  const plan = buildCompleteIntentSupersessionPlan({ evidence: completeIntentFixture() });
  let durable = null;
  let inspectCalls = 0;
  let supersedeCalls = 0;
  const controller = createCompleteIntentSupersessionRepositoryController({}, { runtime: {
    readReplay: () => durable,
    inspect: () => { inspectCalls += 1; return plan.evidence; },
    assertReady: () => {},
    supersede: ({ plan: appliedPlan, authorizationReceipt: authorized }) => {
      supersedeCalls += 1;
      const authority = taskReceipt(appliedPlan);
      const archive = buildScopeExpansionCompleteIntentArchive({
        plan: appliedPlan, authorizationReceipt: authorized, taskAuthorityReceipt: authority,
      });
      const seedReceipt = buildSeededScopeExpansionIntentReceipt({
        plan: appliedPlan, archive, taskAuthorityReceipt: authority, registryRevision: 10,
      });
      durable = { plan: appliedPlan, result: buildCompleteIntentSupersessionResult({
        plan: appliedPlan, archive, seedReceipt, replayed: true,
      }) };
      throw new Error("response lost after durable CAS");
    },
  } });
  await assert.rejects(() => controller.run({ authorization: plan.exactAuthorization }),
    /response lost/u);
  const replay = await controller.run({ authorization: plan.exactAuthorization });
  assert.equal(replay.replayed, true);
  assert.equal(inspectCalls, 1);
  assert.equal(supersedeCalls, 1);
});

test("controller rejects non-exact authorization before its mutation boundary", async () => {
  const plan = buildCompleteIntentSupersessionPlan({ evidence: completeIntentFixture() });
  let mutations = 0;
  const controller = createCompleteIntentSupersessionRepositoryController({}, { runtime: {
    readReplay: () => null,
    inspect: () => plan.evidence,
    assertReady: () => {},
    supersede: () => { mutations += 1; },
  } });
  await assert.rejects(() => controller.run({ authorization: "authorize something else" }),
    /requires exact authorization/u);
  assert.equal(mutations, 0);
});

function registryHarness(plan) {
  const root = mkdtempSync(path.join(os.tmpdir(), "complete-intent-supersession-"));
  const statePath = path.join(root, "writer-leases.json");
  const initial = { schema: WRITER_LEASE_REGISTRY_SCHEMA, revision: 9,
    leases: { [BRANCH]: structuredClone(plan.evidence.lease) },
    scopeExpansionIntents: { [BRANCH]: structuredClone(plan.evidence.sourceIntent) },
    unrelated: { preserved: true } };
  const write = value => writeFileSync(statePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  const read = () => JSON.parse(readFileSync(statePath, "utf8"));
  write(initial);
  const store = { statePath, readRegistry: read, withRegistryLock: action => action(read()) };
  return { statePath, store, read, write,
    dispose: () => rmSync(root, { recursive: true, force: true }) };
}

function taskReceipt(plan) {
  const binding = plan.evidence.lease.taskAuthority;
  const core = {
    authoritySubjectId: binding.authoritySubjectId,
    bindingDigest: binding.bindingDigest,
    proofDigest: DIGEST("task proof"),
    operation: OPERATION,
    verifiedAt: "2026-08-31T12:00:00.000Z",
  };
  return {
    schema: "agentic-task-authority-verification-receipt/v1",
    status: "verified",
    authoritySubjectId: binding.authoritySubjectId,
    proofAdapterId: binding.proofAdapterId,
    generation: binding.generation,
    ...core,
    receiptDigest: digestValue(core),
  };
}

function authorizationReceipt(plan) {
  return authorizeCompleteIntentSupersession({
    plan, authorization: plan.exactAuthorization,
  });
}
