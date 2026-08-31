import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import {
  authorizeBatchPlan,
  buildBatchPlan,
  classifyV2ProtectedMessage,
  EVIDENCE_SCHEMA,
  FIXED_PULL_REQUESTS,
  FIXED_SUBJECTS,
  FIXED_TERMINAL_CLOUD,
  FORBIDDEN_EFFECTS,
  INSTALL_PATHS,
  ITEM_PHASES,
  normalizeBatchEvidence,
  sealBatchEvidence,
} from "../scripts/canonical-squash-batch-terminalizer-v2-contract.mjs";
import {
  authorizeBatchJournal,
  buildBatchReceipt,
  buildCapabilityReport,
  createBatchJournal,
  createCanonicalSquashBatchTerminalizerV2Controller,
  normalizeBatchJournal,
  normalizeBatchReceipt,
  normalizeCapabilityReport,
} from "../scripts/canonical-squash-batch-terminalizer-v2-controller.mjs";
import {
  CAPABILITY_MANIFEST_SCHEMA,
  classifyCompletedBridgeCloud,
  completedBridgeIntegration,
  EVIDENCE_MANIFEST_SCHEMA,
  parseV2CapabilityManifest,
  parseV2EvidenceManifest,
} from "../scripts/canonical-squash-batch-terminalizer-v2-repository-adapter.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";

const ZERO_SHA = "0".repeat(40), ZERO_DIGEST = "0".repeat(64);
// Positive fixtures must not weaken the production rejection of zero sentinels.
const FIXTURE_SHA = "1".repeat(40), FIXTURE_DIGEST = "1".repeat(64);
const digest = seed => Number(seed).toString(16).padStart(64, "0").slice(-64);
const BRIDGE_AUTHORED_SHA = "97df0afc58e5cfcdf1e0056031dc41f24d3b07b8";
const BRIDGE_REFRESHED_SHA = "db2a8b0a1e7313f904cfcd6acd37a522ad7893cc";
const BRIDGE_TREE_SHA = "82c2d5f31624f9db946b53291f01e8437b894542";
const BRIDGE_CLAIM_ID =
  "aa3d5a2352a7cdccadc17c71123858879993500b1b735da842bf44d183add745";
const BRIDGE_REVIEW_REQUEST_ID = "github-pull-request:PR_kwDOSr5-fM8AAAABBjCzbQ";
const BRIDGE_FOCUSED_EVIDENCE =
  "26961d4150439ebc9fd0d464c17315c3372213e413fd52f0530f7ca80bdbef6a";
const BRIDGE_RETIREMENT_RECEIPT =
  "b0b04af42606955a8ecca4ca7f6f70cd971ee06aaa08024e45868885affa4ec7";

function completedBridgeCloudFixture() {
  const declaredWriteScope = [...INSTALL_PATHS.map(value => `path:${value}`),
    "semantic:canonical-squash-batch-terminalizer-v2"];
  const common = {
    claimId: BRIDGE_CLAIM_ID,
    actorId: "github-user:8945812",
    deviceId: "device:f7c5c694f024ed25783c3c8ee600297a8b2e1e09f7c74010fd5609d74693e665",
    sessionId: "session:033c3f76d1e731bcf65e4d74563037f967375933db89b7656a621a21a000aa8e",
    repositoryId: "github-repository:R_kgDOSr5-fA",
    workItemId: "work-item:b50247865c93c0c74b63f53290a4b174f5aa042b92b3a3fec3f6c30080acbef1",
    canonicalBaseRevision: "bf7a41340a2c1844151ac032287d4c2432622de3",
    declaredWriteScope,
    writeSetDigest: "473f0bf3f1a2d171bbb91d1ee0c0fabae2202c36b2f51cf6b720ce0db7948d9c",
    laneRevision: BRIDGE_AUTHORED_SHA,
    leaseEpoch: 1,
    heartbeatCounter: 0,
    expiresAt: "2026-09-01T10:35:31.000Z",
    evidenceDigest: BRIDGE_FOCUSED_EVIDENCE,
    reviewRequestId: BRIDGE_REVIEW_REQUEST_ID,
    predecessorClaimId: null,
    eligibleSince: null,
    handoff: null,
    release: null,
    recovery: {
      evidenceDigest: "af9d0f89201eaf28cf59cf29b72085990bd998f175810dbd407098ab98426ade",
      recoveredAt: "2026-08-31T10:35:31.000Z",
    },
  };
  const publication = {
    candidateRevision: BRIDGE_AUTHORED_SHA,
    reviewRequestId: BRIDGE_REVIEW_REQUEST_ID,
    focusedEvidenceDigest: BRIDGE_FOCUSED_EVIDENCE,
    dependencyClosureDigest:
      "14059a5ae5162c4c02d14e83b90d6040ff4c132c0cc7c914ea7864e5e36b14a9",
    namedChecksDigest: "40075fb15502af45a39c727bfb26a1c2623f6b8b050917d725a48c913f4349fa",
    handoffEvidenceDigest:
      "21b4c829eed3965a878234fea8db9854598ed79ff136c2a78b37d8b9a8a51a91",
    operatorDecisionDigest:
      "b4bc7a94be716bfa8127f60e8aabfca9aa03785ab8efbc54683a3d9155fc271a",
    integrationIntentDigest:
      "d69f1b9084b241ff2ad404a44edb160313424263b0be449836e25b84ba280c6c",
    integratedAt: "2026-08-31T10:43:39.000Z",
  };
  const entry = (sequence, parentDigest, action, claimCore, claimDigest, entryDigest) => ({
    schema: "agentic-cloud-collaboration-entry/v2", sequence, parentDigest, action,
    repositoryId: common.repositoryId, claimId: BRIDGE_CLAIM_ID,
    idempotencyKey: digest(sequence + 10_000), requestDigest: digest(sequence + 20_000),
    evaluationTime: `2026-08-31T10:${sequence === 6680 ? "42:01" : sequence === 6681
      ? "43:39" : "55:49"}.000Z`, claimCore, claimDigest, digest: entryDigest,
  });
  const reviewed = entry(6680,
    "c102c0a61544a7f5b12342fb12c7cf7fe6c93df6a59c663506451ee5185953dc",
    "continue", { ...common, transitionCounter: 7, state: "reviewed" },
    "a182d375d1960f0055983e58330da46c4fd34ff848555b101b086bdc43fb2c19",
    "2409ed2acaea36bbd8bdc5a6612a10e29cbd596af10a3c0486904dba9fca816d");
  const integrated = entry(6681, reviewed.digest, "integrate",
    { ...common, transitionCounter: 8, state: "integrated-preserved",
      integration: publication },
    "6919ef6653c42685df2c0650ec911a9a00ec77d5aaaaf9167a45aa740d67fa94",
    "f4eb4aae20c4635dbb55a7232138cd45ffcc745672e94d8ca316679cec03ced9");
  const terminal = entry(6682, integrated.digest, "retire",
    { ...common, transitionCounter: 9, state: "retired", integration: publication,
      retirement: { reason: "integrated", finalRevision: BRIDGE_AUTHORED_SHA,
        reviewRequestId: BRIDGE_REVIEW_REQUEST_ID,
        bytesDigest: "2feac4b46b8511384b6628395919387cd20881697862633d1e46f192426a017e",
        namedChecksDigest: publication.namedChecksDigest,
        handoffEvidenceDigest: publication.handoffEvidenceDigest,
        integrationReceiptDigest: BRIDGE_RETIREMENT_RECEIPT,
        retiredAt: "2026-08-31T10:55:49.000Z" } },
    "801f409b75088de32ed8e2141c88d3c95f3c2a7c23fa92e6d1b04a572e544c44",
    "0bd9ec2f0941c45ba205649710cf87b97555866619d765776146d1d8aea28de1");
  const lease = {
    status: "completed", reviewHeadSha: BRIDGE_AUTHORED_SHA,
    baseSha: common.canonicalBaseRevision,
    admission: { schema: "agentic-lane-admission-lease/v1", status: "admitted",
      semanticScope: "canonical-squash-batch-terminalizer-v2",
      writeSetDigest: common.writeSetDigest,
      manifestDigest: "405e16b78aa4ef68a32707cdb0c42b20946e65753717c9d62ea6401bce619c84",
      declaredWriteSet: declaredWriteScope },
    cloudAuthority: {
      claimId: BRIDGE_CLAIM_ID, claimDigest: reviewed.claimDigest,
      ledgerDigest: reviewed.digest, claimLedgerRevision: reviewed.digest,
      canonicalBaseSha: common.canonicalBaseRevision, laneRevision: BRIDGE_AUTHORED_SHA,
      cloudDeclaredWriteScope: declaredWriteScope,
      writeSetDigest: common.writeSetDigest, reviewRequestId: BRIDGE_REVIEW_REQUEST_ID,
      leaseEpoch: 1, transitionCounter: 7, state: "review_ready",
      expiresAt: common.expiresAt, integrationReceiptDigest: null, integration: null,
      focusedEvidenceDigest: BRIDGE_FOCUSED_EVIDENCE,
      manifestDigest: "405e16b78aa4ef68a32707cdb0c42b20946e65753717c9d62ea6401bce619c84",
    },
  };
  return { lease, publication, reviewed, integrated, terminal,
    snapshot: { value: { entries: [reviewed, integrated, terminal] } },
    pull: { number: 839, nodeId: "PR_kwDOSr5-fM8AAAABBjCzbQ",
      headSha: BRIDGE_REFRESHED_SHA },
    source: { sha: BRIDGE_AUTHORED_SHA, treeSha: BRIDGE_TREE_SHA,
      message: "feat(canonical-squash-batch-terminalizer-v2): terminalize retained lanes\n\nBody" } };
}
const MESSAGE_META = [
  ["feat(canonical-squash-recovery-terminalizer): terminalize recovery", 2,
    "chore(coordination): claim canonical-squash-recovery-terminalizer lease 317",
    [["katrinateh-dotcom", "katrinateh@live.com"], ["Agentic Canvas OS", "agentic-canvas-os@localhost"]]],
  ["test(expired-heartbeat-fixture-clock): freeze live clock", 1, "chore(coordination): claim expired-heartbeat-fixture-clock lease 319", [["katrinateh-dotcom", "katrinateh@live.com"]]],
  ["fix(active-owned-dirt-reanchor-legacy-work-item): keep identity", 1, "chore(coordination): claim active-owned-dirt-reanchor-legacy-work-item lease 322", [["katrinateh-dotcom", "katrinateh@live.com"]]],
  ["fix(github-strong-conditional-pull-body): bind strong tag", 1, "chore(coordination): claim github-strong-conditional-pull-body lease 323", [["katrinateh-dotcom", "katrinateh@live.com"]]],
  ["fix(github-cooperative-pull-body-projection): project body safely", 1, "chore(coordination): claim github-cooperative-pull-body-projection lease 324", [["katrinateh-dotcom", "katrinateh@live.com"]]],
  ["fix(active-dirt-marker-replay-order): restore marker replay", 1, "chore(coordination): claim active-dirt-marker-replay-order lease 325", [["katrinateh-dotcom", "katrinateh@live.com"]]],
  ["docs(canonical-squash-pr818-attribution-recovery): record evidence", 1, "chore(coordination): claim canonical-squash-pr818-attribution-recovery lease 326", [["katrinateh-dotcom", "katrinateh@live.com"]]],
  ["fix(claim-only-waiting-bridge-live-topology): reconcile peers", 1, "chore(coordination): claim claim-only-waiting-bridge-live-topology lease 328", [["katrinateh-dotcom", "katrinateh@live.com"]]],
];
const AUTHORITY_VECTORS = [
  ["48b7d45024b878bafae1fd0a538cc928f26838d01bd6acffc32baf6ea0ea4f5b", "0a22755fff2bbae2e6e3cc28f2d08e65bc41f1551876aa3854713c3686e49a1c", "b3d935640873b277a6ac5b759c271289bbe3e4d8e93a2de4fc97e3222f9c6b19"],
  ["94ee9cc7a1313a32d3ec2976dfcd5f238d2a1c30f3e08f1a31404bcc83aa70aa", "320680a6b1e86d36276b2b160c8bf3912408606bc0e4646d38fe0fbe3737877d", "9dc74de9b1ae70697d8a7efd1acad9fc22dfb284bed0684ebf81533528e236f5"],
  ["27a8ec91e81e9f792c71a9bfa8206452dd3415384d103f80cd898004cc03c83a", "3a26645eb16a510ed64f5882b92909a65567e1b4485343fb7dc6980dc42975bd", "995f87a3737ad190014d6af82ae5f0c09b2b1b77709fd5f5a8a16455e7b7e901"],
  ["d23908e05d12495f7bcf23b3deb220269fc72b6dda4c8b11b3b37a0ef508b7ca", "63e30e56877fbc9c283fb9f93b860c46565040598f59b90997556708d7812de9", "ec3337707e4fbe283d66db3e7bab9f518d6e11406d223ecb0bb443a9cf1e7745"],
  ["43b4c15f87225900807fa84604b49e57f7722fb4f1a40c48c494812879682499", "9c7ce5db7ff76c2de6c313972537013f68d70b0cff51edf3cce64da6c33e4229", "666b1d6fe8eb09964c319125e770e0650e21bb6a4e33452da286ba26b0e13c44"],
  ["6696622734d0fccb3d324108b2cc8176a699c95a172ac1569f959bc97a730e1b", "2b83f6bd111da5faf1daf5446f7de23b770bb9676f51b9a277bd189b2d87bffd", "348294505983135c0d167f47166bab49206ef4db9855ad37fedf5dff0673b4c2"],
  ["d6a00c7320472f27e807c4ef85a1d3540ee945c79f38b765b8c38381212d31f3", "06dc0be41114c47972cf508cf90da8a9be83febfc651e17dbfa08d79f1d04b17", "780437999969ed0dce36bbabe53ce00921b081f701b3d6e6e4ccf521c3c8738a"],
  ["7d0f969b635a16ccf142e62fb3a843ea81c02bf4d8179ed60a6904aa02dd9143", "c0bae12884a331c39bb7bdce56bd7598b2dfbdaec78d17490c306dc53d08d4e9", "fc1ab1f8df3460ecca2ec4bd95d5d0f447d09085d1db6338b501acf1ca57e393"],
];
// Offline immutable API vectors: [subject][reviewed/post-main][job fields].
const JOB_VECTORS = JSON.parse(gunzipSync(Buffer.from("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", "base64")));

function messages(fixed, index) {
  const [headline, epoch, claim, authors] = MESSAGE_META[index];
  const body = [
    "Integrate the declared " + fixed.scope
      + " change through its protected managed task lane so downstream policy can"
      + " attribute the change to its writer lease.",
    "",
    "Agentic-Task: " + fixed.scope,
    "Agentic-Scope: " + fixed.scope,
    "Agentic-Lease-Epoch: " + epoch,
    "Agentic-Mechanism: Agentic Canvas OS protected integration",
  ].join("\n");
  const source = headline + "\n\n" + body;
  const trailers = authors.map(author =>
    "Co-authored-by: " + author[0] + " <" + author[1] + ">").join("\n");
  return { source, protectedMessage: headline + "\n\n* " + claim + "\n\n* "
    + headline + "\n\n" + body + "\n\n---------\n\n" + trailers };
}

function runEvidence(fixed, index, postMain) {
  const vectors = JOB_VECTORS[index][postMain ? 1 : 0];
  const ids = postMain ? fixed.postMainJobIds : fixed.reviewedJobIds;
  const headSha = postMain ? fixed.mergeSha : fixed.headSha;
  const jobs = vectors.map((vector, jobIndex) => ({
    id: ids[jobIndex], name: vector[0], headSha, status: "completed",
    conclusion: "success", startedAt: vector[1], completedAt: vector[2],
    runnerName: vector[3], runnerGroupName: vector[4], stepsDigest: vector[5],
  })).sort((left, right) => left.id - right.id);
  return {
    id: postMain ? fixed.postMainRunId : fixed.reviewedRunId,
    nodeId: postMain ? fixed.postMainRunNodeId : fixed.reviewedRunNodeId,
    checkSuiteId: postMain ? fixed.postMainCheckSuiteId : fixed.reviewedCheckSuiteId,
    workflowId: 312871167,
    runNumber: postMain ? fixed.postMainRunNumber : fixed.reviewedRunNumber,
    attempt: 1, headSha, headBranch: postMain ? "main" : fixed.branch,
    event: postMain ? "push" : "pull_request", status: "completed",
    conclusion: "success", workflowPath: ".github/workflows/ci.yml",
    jobsDigest: digestValue(jobs), jobs,
  };
}

function subjectEvidence(fixed, index) {
  const terminal = FIXED_TERMINAL_CLOUD[index];
  const authority = AUTHORITY_VECTORS[index];
  const worktreePath = "/private/tmp/" + fixed.worktreeBasename;
  const rendered = messages(fixed, index);
  const cloudCore = {
    claimId: fixed.claimId, integratedClaimDigest: fixed.claimDigest,
    lineageDigest: terminal.lineageDigest, lineageLength: terminal.lineageLength,
    terminalState: "retired", retirementReason: "integrated",
    leaseEpoch: fixed.cloudEpoch, integrationCounter: terminal.integrationCounter,
    terminalCounter: terminal.terminalCounter,
    reviewRequestId: "github-pull-request:" + fixed.nodeId,
    finalRevision: fixed.headSha, integrateEntryDigest: terminal.integrateEntryDigest,
    retireSequence: terminal.retireSequence,
    retireIdempotencyKey: terminal.retireIdempotencyKey,
    retireRequestDigest: terminal.retireRequestDigest,
    terminalEntryDigest: terminal.terminalEntryDigest,
    terminalClaimDigest: terminal.terminalClaimDigest,
    integrationReceiptDigest: fixed.integrationReceiptDigest,
  };
  const commit = (isProtected, message) => ({
    sha: isProtected ? fixed.mergeSha : fixed.headSha, treeSha: fixed.treeSha,
    parentShas: isProtected ? [fixed.baseSha] : [...fixed.sourceParentShas],
    message, messageDigest: isProtected
      ? fixed.protectedMessageDigest : fixed.sourceMessageDigest,
    rawMessageByteLength: isProtected ? fixed.protectedRawBytes : fixed.sourceRawBytes,
    rawMessageSha256: isProtected ? fixed.protectedRawSha256 : fixed.sourceRawSha256,
    rawMessageTerminalLf: !isProtected,
    providerVerificationDigest: isProtected
      ? fixed.protectedVerificationDigest : fixed.sourceVerificationDigest,
  });
  return {
    pullRequest: { number: fixed.pullRequest, nodeId: fixed.nodeId,
      url: "https://github.com/huijoohwee/agentic-canvas-os/pull/" + fixed.pullRequest,
      baseSha: fixed.baseSha, headSha: fixed.headSha, mergeSha: fixed.mergeSha,
      autoMergeDigest: fixed.autoMergeDigest },
    branch: fixed.branch, worktreePath,
    sourceCommit: commit(false, rendered.source),
    protectedCommit: commit(true, rendered.protectedMessage),
    message: { sourceKind: "managed-exact",
      protectedKind: "provider-attribution-rewrite",
      sourceMessageDigest: fixed.sourceMessageDigest,
      protectedMessageDigest: fixed.protectedMessageDigest,
      sourceRawMessageSha256: fixed.sourceRawSha256,
      protectedRawMessageSha256: fixed.protectedRawSha256,
      renderedMessageDigest: fixed.protectedMessageDigest,
      providerCauseDigest: fixed.providerCauseDigest,
      sourceHistoryDigest: fixed.sourceHistoryDigest,
      authorAttributionDigest: fixed.authorAttributionDigest },
    checks: { reviewedRun: runEvidence(fixed, index, false),
      postMainRun: runEvidence(fixed, index, true) },
    lease: { epoch: fixed.localEpoch, sessionId: fixed.sessionId, scope: fixed.scope,
      branch: fixed.branch, worktreePath, baseSha: fixed.baseSha,
      fenceSha: fixed.fenceSha,
      pullRequestUrl: "https://github.com/huijoohwee/agentic-canvas-os/pull/"
        + fixed.pullRequest,
      deliveryHeadSha: fixed.headSha, cloudAuthorityDigest: authority[0],
      taskAuthorityBindingDigest: fixed.bindingDigest,
      integrationDigest: authority[1], leaseIdentityDigest: fixed.leaseIdentityDigest },
    taskAuthority: { authoritySubjectId: fixed.taskSubject,
      proofAdapterId: "urn:agentic-proof:ed25519-file:v1", generation: 1,
      publicKeyDigest: fixed.publicKeyDigest, laneBindingDigest: fixed.laneBindingDigest,
      bindingMode: fixed.bindingMode, priorBindingDigest: fixed.priorBindingDigest,
      bindingDigest: fixed.bindingDigest },
    cloud: { ...cloudCore, deliveryEvidenceDigest: authority[2],
      authorityDigest: authority[0], terminalCloudDigest: digestValue(cloudCore) },
    integration: { commitSha: fixed.integrationCommit, treeSha: fixed.integrationTree,
      commitMessageDigest: fixed.integrationMessageDigest, pathsDigest: fixed.pathsDigest,
      manifestDigest: fixed.manifestDigest, stagedDiffDigest: fixed.stagedDiffDigest,
      protectedRefresh: structuredClone(fixed.protectedRefreshTopology) },
  };
}

function fixtureEvidence() {
  return sealBatchEvidence({
    schema: EVIDENCE_SCHEMA, observedMainSha: FIXTURE_SHA,
    ledger: { repository: "huijoohwee/agentic-canvas-os",
      revision: FIXTURE_SHA, ledgerDigest: FIXTURE_DIGEST },
    controller: { repository: "huijoohwee/agentic-canvas-os",
      revision: FIXTURE_SHA, treeSha: FIXTURE_SHA,
      installBlobs: INSTALL_PATHS.map(repositoryPath =>
        ({ path: repositoryPath, blobSha: FIXTURE_SHA })) },
    bridge: { pullRequest: 839, nodeId: "PR_kwDOSr5-fM8AAAABBjCzbQ",
      url: "https://github.com/huijoohwee/agentic-canvas-os/pull/839",
      branch: "agent/katrinas-macbook-pro.local/canonical-squash-batch-terminalizer-v2",
      scope: "canonical-squash-batch-terminalizer-v2",
      sessionId: "canonical-squash-batch-terminalizer-v2-20260831", epoch: 338,
      baseSha: FIXTURE_SHA, autoMergeDigest: FIXTURE_DIGEST,
      sourceHeadSha: FIXTURE_SHA, sourceTreeSha: FIXTURE_SHA, mergeSha: FIXTURE_SHA,
      mergeTreeSha: FIXTURE_SHA, sourceCommitDigest: FIXTURE_DIGEST,
      protectedCommitDigest: FIXTURE_DIGEST, messageClassificationDigest: FIXTURE_DIGEST,
      installDeltaDigest: FIXTURE_DIGEST, leaseIntegrationDigest: FIXTURE_DIGEST,
      worktreePath: "/private/tmp/canonical-squash-batch-terminalizer-v2",
      completedLeaseDigest: FIXTURE_DIGEST,
      authoritySubjectId: "urn:agentic-task:fixture-bridge",
      publicKeyDigest: FIXTURE_DIGEST, taskAuthorityBindingDigest: FIXTURE_DIGEST,
      claimId: FIXTURE_DIGEST, terminalCloudDigest: FIXTURE_DIGEST,
      completionMainSha: FIXTURE_SHA, cleanupOperationId: FIXTURE_DIGEST,
      worktree: "absent", registration: "absent", branchRef: "preserved",
      controllerContained: true },
    items: FIXED_SUBJECTS.map(subjectEvidence),
  });
}

function mutateEvidence(evidence, mutate) {
  const value = structuredClone(evidence);
  delete value.stableDigest;
  delete value.evidenceDigest;
  mutate(value);
  return () => sealBatchEvidence(value);
}

function capabilityEntries(journal, problem = null) {
  return journal.items.map((item, index) => {
    const requirement = index < journal.cursor ? "none-complete"
      : ITEM_PHASES.indexOf(item.phase) >= ITEM_PHASES.indexOf("completion-projected")
        ? "none-terminal" : "mutation";
    const affected = requirement === "mutation" && index === journal.cursor && problem;
    const status = requirement === "mutation" ? (affected || "available") : "not-required";
    return { pullRequest: item.pullRequest, requirement, status,
      bindingDigest: journal.plan.evidence.items[index].taskAuthority.bindingDigest,
      capabilityProjectionDigest: status === "available" ? digest(50_000 + index) : null };
  });
}

function createMemoryAdapter(options = {}) {
  const evidence = options.evidence || fixtureEvidence();
  let journal = null;
  let failEvidenceAt = options.failEvidenceAt || null;
  let failRetirementOnce = options.failRetirementOnce || null;
  let loseCompletionOnce = options.loseCompletionOnce || null;
  let capabilityProblem = options.capabilityProblem || null;
  let throwPreflight = false;
  const completed = new Set();
  const events = [];
  const effectCount = new Map();
  const projection = () => ({ relation: "protected-descendant" });
  const terminalBatchDigest = state => digestValue({
    operation: "canonical-squash-batch-terminalizer-v2",
    planDigest: state.plan.planDigest,
    terminalDigests: state.items.filter(item =>
      ["terminal-verified", "complete"].includes(item.phase)).map(item =>
      item.receipts["terminal-verified"].values.terminalEvidenceDigest),
  });
  const adapter = {
    events,
    get journal() { return journal; },
    set failEvidenceAt(value) { failEvidenceAt = value; },
    set throwPreflight(value) { throwPreflight = value; },
    effectCount: pullRequest => effectCount.get(pullRequest) || 0,
    withOperationLock: async (_context, action) => action(),
    readJournal: async () => journal,
    writeJournal: async ({ expected, next }) => {
      assert.equal(journal?.journalDigest || null, expected?.journalDigest || null);
      journal = normalizeBatchJournal(next);
      return journal;
    },
    observe: async () => { events.push("observe:plan"); return evidence; },
    assertStableEvidence: async ({ sealedEvidence, freshEvidence }) => {
      assert.equal(sealedEvidence.stableDigest, freshEvidence.stableDigest);
    },
    preflightCapabilities: async ({ journal: state }) => {
      events.push("preflight:" + state.cursor + ":" + state.items[state.cursor]?.phase);
      if (throwPreflight) throw new Error("preflight must not run");
      return buildCapabilityReport({ journal: state,
        entries: capabilityEntries(state, capabilityProblem) });
    },
    withItemFence: async ({ pullRequest, journal: state }, action) => {
      events.push("fence:start:" + pullRequest + ":" + state.items[state.cursor].phase);
      try { return await action({ leaseDigest: digest(pullRequest) }); }
      finally { events.push("fence:end:" + pullRequest); }
    },
    verifyItemEvidence: async ({ pullRequest }) => {
      events.push("observe:item:" + pullRequest);
      if (failEvidenceAt === pullRequest) throw new Error("injected evidence drift");
      return { evidenceVerificationDigest: digest(pullRequest + 100),
        fenceLeaseDigest: digest(pullRequest + 200) };
    },
    classifyRetirementAdoption: async ({ plan, evidence: item, pullRequest }) => {
      events.push("retirement:classify:" + pullRequest);
      if (failRetirementOnce === pullRequest) {
        failRetirementOnce = null;
        throw new Error("retirement read response loss");
      }
      const core = {
        schema: "agentic-canonical-squash-batch-terminalizer-v2-retirement-adoption/v1",
        planDigest: plan.planDigest, pullRequest,
        terminalCloudDigest: item.cloud.terminalCloudDigest,
        terminalEntryDigest: item.cloud.terminalEntryDigest,
        terminalClaimDigest: item.cloud.terminalClaimDigest, cloudMutation: false,
      };
      return { status: "retired", terminalCloudDigest: item.cloud.terminalCloudDigest,
        lineageDigest: item.cloud.lineageDigest, lineageLength: item.cloud.lineageLength,
        integrateEntryDigest: item.cloud.integrateEntryDigest,
        terminalEntryDigest: item.cloud.terminalEntryDigest,
        terminalClaimDigest: item.cloud.terminalClaimDigest,
        retirementReceiptDigest: digestValue(core) };
    },
    classifyCompletionProjection: async ({ evidence: item, pullRequest }) => {
      events.push("completion:classify:" + pullRequest);
      return completed.has(pullRequest)
        ? { status: "completion-ready", ...projection(item, pullRequest) }
        : { status: "pending" };
    },
    projectCompletion: async ({ evidence: item, pullRequest }) => {
      events.push("completion:project:" + pullRequest);
      effectCount.set(pullRequest, (effectCount.get(pullRequest) || 0) + 1);
      completed.add(pullRequest);
      if (loseCompletionOnce === pullRequest) {
        loseCompletionOnce = null;
        throw new Error("completion response loss");
      }
      return projection(item, pullRequest);
    },
    verifyItemTerminal: async ({ pullRequest, transitioned }) => {
      events.push("terminal:verify:" + pullRequest);
      events.push("terminal:transitioned:" + pullRequest + ":" + transitioned);
      assert.ok(completed.has(pullRequest));
      return { terminalEvidenceDigest: digest(pullRequest + 30_000),
        terminalStatus: "completion-ready" };
    },
    verifyBatchTerminal: async ({ journal: state, completedReplay = false }) => {
      events.push(completedReplay ? "terminal:replay" : "terminal:prefix");
      return { terminalBatchDigest: terminalBatchDigest(state) };
    },
  };
  return adapter;
}

async function planned(adapter) {
  const controller = createCanonicalSquashBatchTerminalizerV2Controller({ adapter });
  const plan = await controller.plan();
  return { controller, plan };
}

test("fixed evidence seals the exact ordered eight-item batch", () => {
  const evidence = fixtureEvidence();
  assert.deepEqual(FIXED_PULL_REQUESTS, [818, 820, 822, 823, 824, 825, 826, 828]);
  assert.deepEqual(normalizeBatchEvidence(evidence), evidence);
  assert.equal(new Set(evidence.items.map(item => item.cloud.claimId)).size, 8);
  assert.equal(INSTALL_PATHS.length, 6);
  assert.ok(FORBIDDEN_EFFECTS.includes("runtime"));
  assert.ok(FORBIDDEN_EFFECTS.includes("worktree-cleanup"));
});

test("allowlist, order, identities, trees, parents, and primitive types are exact", () => {
  const evidence = fixtureEvidence();
  const mutations = [
    value => value.items.reverse(),
    value => { value.items[0].pullRequest.number = 820; },
    value => { value.items[0].branch = value.items[1].branch; },
    value => { value.items[0].sourceCommit.treeSha = ZERO_SHA; },
    value => { value.items[0].protectedCommit.treeSha = ZERO_SHA; },
    value => { value.items[0].protectedCommit.parentShas.push(ZERO_SHA); },
    value => { value.items[0].pullRequest.number = "818"; },
    value => { value.items[0].cloud.lineageLength = "6"; },
  ];
  for (const mutate of mutations) assert.throws(mutateEvidence(evidence, mutate), /invalid/);
  for (const item of evidence.items) {
    assert.equal(item.sourceCommit.treeSha, item.protectedCommit.treeSha);
    assert.deepEqual(item.protectedCommit.parentShas, [item.pullRequest.baseSha]);
  }
});

test("source is exact unsigned, protected is exact valid, and PR818 is sealed refresh", () => {
  const evidence = fixtureEvidence();
  const unsigned = { verified: false, reason: "unsigned", signature: null,
    payload: null, verified_at: null };
  for (const [index, fixed] of FIXED_SUBJECTS.entries()) {
    assert.equal(fixed.sourceVerificationDigest, digestValue(unsigned));
    assert.equal(evidence.items[index].protectedCommit.providerVerificationDigest,
      fixed.protectedVerificationDigest);
  }
  const refresh = FIXED_SUBJECTS[0].protectedRefreshTopology;
  assert.deepEqual(FIXED_SUBJECTS[0].sourceParentShas,
    [refresh.authoredSha, FIXED_SUBJECTS[0].baseSha]);
  assert.equal(refresh.delta.length, 6);
  assert.equal(refresh.authoredParentSha, "8d75cdd83d3c188c9fa1ddc360ec7e8d560284a9");
  const source = readFileSync(new URL("../scripts/canonical-squash-batch-terminalizer-v2-repository-adapter.mjs",
    import.meta.url), "utf8");
  assert.match(source, /verified:\s*false,\s*reason:\s*"unsigned"/u);
  assert.match(source, /verified:\s*true,\s*reason:\s*"valid"/u);
});

test("provider rewrite requires claim plus authored subject, never naive base..head", () => {
  const source = ["fix(example): exact", "",
    "Integrate the declared example change through its protected managed task lane so"
      + " downstream policy can attribute the change to its writer lease.",
    "", "Agentic-Task: example", "Agentic-Scope: example",
    "Agentic-Lease-Epoch: 1",
    "Agentic-Mechanism: Agentic Canvas OS protected integration"].join("\n");
  const history = ["chore(coordination): claim example lease 1", "fix(example): exact"];
  const authors = [{ name: "Writer", email: "writer@example.test" }];
  const protectedMessage = history[1] + "\n\n* " + history[0] + "\n\n* "
    + history[1] + "\n\n" + source.split("\n").slice(2).join("\n")
    + "\n\n---------\n\nCo-authored-by: Writer <writer@example.test>";
  const cause = { mergeMethod: "SQUASH", commitHeadline: history[1],
    commitBody: null, enabledAt: "2026-08-31T00:00:00Z",
    enabledBy: { id: "U_1", login: "writer", isBot: false } };
  assert.equal(classifyV2ProtectedMessage({ sourceMessage: source, protectedMessage,
    sourceHistorySubjects: history, sourceAuthors: authors,
    autoMergeRequest: cause, mergedBy: "writer" }).protectedKind,
  "provider-attribution-rewrite");
  assert.throws(() => classifyV2ProtectedMessage({ sourceMessage: source,
    protectedMessage, sourceHistorySubjects: [history[1]], sourceAuthors: authors,
    autoMergeRequest: cause, mergedBy: "writer" }), /history/);
});

test("completed protected-refresh bridge derives publication from immutable cloud history", () => {
  const fixture = completedBridgeCloudFixture();
  assert.equal("deliveryHeadSha" in fixture.lease, false);
  assert.equal("integration" in fixture.lease, false);
  assert.notEqual(fixture.pull.headSha, fixture.lease.reviewHeadSha);
  const cloud = classifyCompletedBridgeCloud(fixture.snapshot,
    { lease: fixture.lease, pull: fixture.pull });
  assert.deepEqual(cloud.publication, fixture.publication);
  assert.equal(cloud.publication.candidateRevision, BRIDGE_AUTHORED_SHA);
  const proof = completedBridgeIntegration({ lease: fixture.lease,
    publication: cloud.publication, source: fixture.source });
  assert.equal(proof.schema, "agentic-completed-review-publication/v1");
  assert.equal(proof.commitSha, BRIDGE_AUTHORED_SHA);
  assert.equal(proof.treeSha, BRIDGE_TREE_SHA);
  assert.deepEqual(proof.paths, INSTALL_PATHS);
  assert.throws(() => completedBridgeIntegration({ lease: fixture.lease,
    publication: { ...cloud.publication, candidateRevision: BRIDGE_REFRESHED_SHA },
    source: fixture.source }), /publication proof/);
  assert.throws(() => completedBridgeIntegration({ lease: fixture.lease,
    publication: cloud.publication,
    source: { ...fixture.source, sha: BRIDGE_REFRESHED_SHA } }), /publication proof/);
});

test("completed bridge cloud classifier rejects suffix and retained-publication drift", () => {
  const classify = fixture => classifyCompletedBridgeCloud(fixture.snapshot,
    { lease: fixture.lease, pull: fixture.pull });
  const mutations = [
    fixture => {
      fixture.snapshot.value.entries[1].claimCore.integration.candidateRevision
        = BRIDGE_REFRESHED_SHA;
    },
    fixture => {
      fixture.snapshot.value.entries[2].claimCore.retirement.finalRevision
        = BRIDGE_REFRESHED_SHA;
    },
    fixture => {
      fixture.snapshot.value.entries[2].claimCore.retirement.integrationReceiptDigest
        = ZERO_DIGEST;
    },
    fixture => {
      fixture.snapshot.value.entries[1].parentDigest = digest(90_001);
    },
    fixture => {
      fixture.snapshot.value.entries[0].digest = digest(90_002);
    },
    fixture => {
      fixture.snapshot.value.entries[2].claimCore.integration.namedChecksDigest
        = digest(90_003);
    },
    fixture => {
      fixture.lease.admission.writeSetDigest = digest(90_004);
    },
    fixture => {
      fixture.lease.admission.manifestDigest = digest(90_005);
    },
    fixture => {
      const substitutedClaimId = digest(90_008);
      fixture.lease.cloudAuthority.claimId = substitutedClaimId;
      for (const entry of fixture.snapshot.value.entries) {
        entry.claimId = substitutedClaimId;
        entry.claimCore.claimId = substitutedClaimId;
      }
    },
    fixture => {
      const terminal = fixture.snapshot.value.entries[2];
      fixture.snapshot.value.entries.push({ ...structuredClone(terminal), sequence: 6683,
        parentDigest: terminal.digest, digest: digest(90_006),
        claimDigest: digest(90_007), claimCore: { ...structuredClone(terminal.claimCore),
          transitionCounter: 10 } });
    },
  ];
  assert.equal(classify(completedBridgeCloudFixture()).publication.candidateRevision,
    BRIDGE_AUTHORED_SHA);
  for (const mutate of mutations) {
    const fixture = completedBridgeCloudFixture();
    mutate(fixture);
    assert.throws(() => classify(fixture));
  }
});

test("CI joins exact event, branch, workflow, run, job IDs, and digests", () => {
  const evidence = fixtureEvidence();
  const mutations = [
    value => { value.items[0].checks.reviewedRun.event = "push"; },
    value => { value.items[0].checks.reviewedRun.headBranch = "main"; },
    value => { value.items[0].checks.reviewedRun.workflowId = 1; },
    value => { value.items[0].checks.reviewedRun.id += 1; },
    value => { value.items[0].checks.reviewedRun.jobs[0].id += 1; },
    value => { value.items[0].checks.reviewedRun.jobsDigest = ZERO_DIGEST; },
    value => { value.items[0].checks.postMainRun.headSha = ZERO_SHA; },
  ];
  for (const mutate of mutations) assert.throws(mutateEvidence(evidence, mutate), /invalid/);
  const permuted = mutateEvidence(evidence, value => {
    value.items[0].checks.reviewedRun.jobs.reverse();
  })();
  assert.equal(permuted.evidenceDigest, evidence.evidenceDigest);
  assert.throws(mutateEvidence(evidence, value => {
    const jobs = value.items[0].checks.reviewedRun.jobs;
    [jobs[0].name, jobs[1].name] = [jobs[1].name, jobs[0].name];
    value.items[0].checks.reviewedRun.jobsDigest = digestValue(jobs);
  }), /invalid/);
});

test("manifests retain exact run order and distinct capability locators", () => {
  const manifest = { schema: EVIDENCE_MANIFEST_SCHEMA,
    bridge: { pullRequest: 839, cleanupOperationId: digest(1) },
    subjects: FIXED_SUBJECTS.map(fixed => ({ pullRequest: fixed.pullRequest,
      reviewedRunId: fixed.reviewedRunId, postMainRunId: fixed.postMainRunId })) };
  assert.equal(parseV2EvidenceManifest(manifest).subjects.length, 8);
  const capabilities = { schema: CAPABILITY_MANIFEST_SCHEMA,
    items: FIXED_PULL_REQUESTS.map(pullRequest =>
      ({ pullRequest, capabilityPath: "/private/tmp/pr-" + pullRequest })) };
  assert.equal(parseV2CapabilityManifest(capabilities).items.length, 8);
  capabilities.items[1].capabilityPath = capabilities.items[0].capabilityPath;
  assert.throws(() => parseV2CapabilityManifest(capabilities), /reused/);
});

test("authorization and capability reports bind exact non-null order and digest", () => {
  const plan = buildBatchPlan(fixtureEvidence());
  assert.throws(() => authorizeBatchPlan(plan, plan.exactAuthorization + " "), /Exact/);
  const journal = authorizeBatchJournal(createBatchJournal(plan), plan.exactAuthorization);
  const entries = capabilityEntries(journal);
  const report = buildCapabilityReport({ journal, entries });
  assert.equal(report.status, "ready");
  assert.deepEqual(report.items.map(item => item.pullRequest), FIXED_PULL_REQUESTS);
  assert.ok(report.items.every(item => item.bindingDigest !== null));
  assert.deepEqual(normalizeCapabilityReport(report, journal), report);
  assert.throws(() => normalizeCapabilityReport({ ...structuredClone(report), reportDigest: ZERO_DIGEST }, journal), /invalid/);
  for (const problem of ["missing", "invalid"]) {
    assert.equal(buildCapabilityReport({ journal,
      entries: capabilityEntries(journal, problem) }).status, "blocked");
  }
  const nullBinding = structuredClone(entries);
  nullBinding[0].bindingDigest = null;
  assert.throws(() => buildCapabilityReport({ journal, entries: nullBinding }), /invalid/);
  assert.throws(() => buildCapabilityReport({ journal,
    entries: entries.toReversed() }), /invalid/);
});

test("controller adopts exact retired state and performs only local completion", async () => {
  const adapter = createMemoryAdapter();
  const { controller, plan } = await planned(adapter);
  const receipt = await controller.execute({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization });
  assert.equal(receipt.status, "completion-ready");
  assert.deepEqual(receipt.items.map(item => item.pullRequest), FIXED_PULL_REQUESTS);
  assert.ok(receipt.items.every(item =>
    item.retirementDisposition === "response-loss-adopted"));
  assert.deepEqual(FIXED_PULL_REQUESTS.map(adapter.effectCount), FIXED_PULL_REQUESTS.map(() => 1));
  const source = readFileSync(new URL(
    "../scripts/canonical-squash-batch-terminalizer-v2-repository-adapter.mjs",
    import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bretireCloud\b|\bcreateCloudClaim\b|\bupdateCloudClaim\b/u);
  const events = adapter.events.filter(event => event.endsWith(":818"));
  assert.ok(events.indexOf("completion:classify:818")
    < events.indexOf("completion:project:818"));
  assert.ok(events.indexOf("completion:project:818") < events.indexOf("terminal:verify:818"));
  assert.equal(events.filter(event => event === "completion:classify:818").length, 1);
  assert.ok(adapter.events.includes("terminal:transitioned:818:true"));
  const predecessor = structuredClone(adapter.journal);
  const phaseReceipt = predecessor.items[0].receipts["evidence-verified"];
  phaseReceipt.priorJournalDigest = digest(900_000);
  phaseReceipt.receiptDigest = digestValue(Object.fromEntries(Object.entries(phaseReceipt)
    .filter(([name]) => name !== "receiptDigest")));
  predecessor.journalDigest = digestValue(Object.fromEntries(Object.entries(predecessor)
    .filter(([name]) => name !== "journalDigest")));
  assert.throws(() => normalizeBatchJournal(predecessor), /predecessor/);
  const extra = structuredClone(adapter.journal);
  extra.items[0].receipts["evidence-verified"].values.extra = true;
  extra.journalDigest = digestValue(Object.fromEntries(Object.entries(extra)
    .filter(([name]) => name !== "journalDigest")));
  assert.throws(() => normalizeBatchJournal(extra), /keys/);
  assert.deepEqual(normalizeBatchReceipt(receipt, adapter.journal), receipt);
  assert.throws(() => normalizeBatchReceipt({ ...structuredClone(
    buildBatchReceipt(adapter.journal)), extra: true }, adapter.journal), /rebuild/);
  const preflights = adapter.events.filter(event => event.startsWith("preflight:")).length;
  assert.equal(parseV2CapabilityManifest(null, { optional: true }), null);
  adapter.throwPreflight = true;
  const replay = await controller.execute({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization });
  assert.equal(replay.receiptDigest, receipt.receiptDigest);
  assert.equal(adapter.events.filter(event => event.startsWith("preflight:")).length,
    preflights);
  assert.equal(adapter.events.at(-1), "terminal:replay");
});

test("new and resumed phases fence before item observation", async () => {
  const adapter = createMemoryAdapter({ loseCompletionOnce: 818, failEvidenceAt: 820 });
  const { controller, plan } = await planned(adapter);
  await assert.rejects(controller.execute({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization }), /response loss/);
  assert.equal(adapter.journal.items[0].phase, "completion-intent");
  assert.equal(adapter.effectCount(818), 1);
  await assert.rejects(controller.execute({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization }), /evidence drift/);
  assert.equal(adapter.effectCount(818), 1);
  assert.equal(adapter.journal.items[0].phase, "complete");
  assert.equal(adapter.journal.items[0].receipts["completion-projected"].values.relation,
    "protected-descendant");
  const starts = adapter.events.filter(event => event.startsWith("fence:start:818"));
  assert.deepEqual(starts, ["fence:start:818:pending",
    "fence:start:818:completion-intent"]);
  for (const start of starts) {
    const at = adapter.events.indexOf(start);
    assert.equal(adapter.events[at + 1], "observe:item:818");
  }
});

test("retirement read response loss resumes by fenced adoption, without cloud effect", async () => {
  const adapter = createMemoryAdapter({ failRetirementOnce: 818, failEvidenceAt: 820 });
  const { controller, plan } = await planned(adapter);
  await assert.rejects(controller.execute({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization }), /retirement read response loss/);
  assert.equal(adapter.journal.items[0].phase, "retirement-adoption-intent");
  await assert.rejects(controller.execute({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization }), /evidence drift/);
  assert.equal(adapter.journal.items[0].receipts["retirement-adopted"]
    .values.disposition, "response-loss-adopted");
  assert.equal(adapter.effectCount(818), 1);
});

test("partial failure is monotonic and resume never rolls back its prefix", async () => {
  const adapter = createMemoryAdapter({ failEvidenceAt: 820 });
  const { controller, plan } = await planned(adapter);
  await assert.rejects(controller.execute({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization }), /evidence drift/);
  assert.equal(adapter.journal.cursor, 1);
  assert.equal(adapter.journal.items[0].phase, "complete");
  assert.equal(adapter.journal.items[1].phase, "pending");
  const prefix = adapter.journal.items[0].receipts.complete.values.terminalPrefixDigest;
  const report = buildCapabilityReport({ journal: adapter.journal,
    entries: capabilityEntries(adapter.journal) });
  assert.equal(report.items[0].requirement, "none-complete");
  assert.notEqual(report.items[0].bindingDigest, null);
  assert.equal(report.items[1].requirement, "mutation");
  await assert.rejects(controller.execute({ planDigest: plan.planDigest,
    authorization: plan.exactAuthorization }), /evidence drift/);
  assert.equal(adapter.journal.items[0].receipts.complete.values.terminalPrefixDigest, prefix);
  assert.equal(adapter.journal.cursor, 1);
});

for (const problem of ["missing", "invalid"]) {
  test("current " + problem + " capability blocks before completion effect", async () => {
    const adapter = createMemoryAdapter({ capabilityProblem: problem });
    const { controller, plan } = await planned(adapter);
    await assert.rejects(controller.execute({ planDigest: plan.planDigest,
      authorization: plan.exactAuthorization }),
    error => error.capabilityReport?.status === "blocked");
    assert.equal(adapter.journal.cursor, 0);
    assert.equal(adapter.effectCount(818), 0);
  });
}
