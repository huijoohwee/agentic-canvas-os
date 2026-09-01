// Responsibility: bind the fixed batch to exact GitHub, Git, lease, and task evidence.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { assertV2ImmutableLease, classifyIntegratedRetirement,
  classifyV2ProtectedMessage, EVIDENCE_SCHEMA, FIXED_PULL_REQUESTS, FIXED_SUBJECTS,
  INSTALL_PATHS, normalizeBatchEvidence, sealBatchEvidence }
  from "./canonical-squash-batch-terminalizer-v2-contract.mjs";
import { buildCapabilityReport, classifyV2RetiredCloud, createPrivateBatchJournalStore,
  normalizeBatchJournal, normalizeCapabilityReport }
  from "./canonical-squash-batch-terminalizer-v2-controller.mjs";
import { canonicalJson, digestValue, validateLedger } from "./cloud-collaboration-primitives.mjs";
import { normalizeV2CapabilityManifest, normalizeV2EvidenceManifest,
  readV2GitCommit, readV2JoinedCommit, readV2Run, resolveV2PrivateCapabilityPath }
  from "./canonical-squash-batch-terminalizer-v2.mjs";
import { completeSession } from "./device-complete-lib.mjs";
import { assertReviewedLaneEntrypointFence, withReviewedLaneEntrypointFence }
  from "./reviewed-lane-revision-fence.mjs";
import { authorizeTaskBoundLeaseMutation, readTaskAuthorityCapability }
  from "./task-bound-lane-authority-store.mjs";
import { assertCapabilityMatchesBinding, assertTaskAuthorityBinding,
  projectTaskAuthorityCapability } from "./task-bound-lane-authority-contract.mjs";
import { withPrivateOperationLock } from "./private-operation-lock.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
import { createWorktreeCleanupOperationId } from "./worktree-lifecycle-lib.mjs";

export const EVIDENCE_MANIFEST_SCHEMA =
  "agentic-canonical-squash-batch-terminalizer-v2-evidence-manifest/v1";
export const CAPABILITY_MANIFEST_SCHEMA =
  "agentic-canonical-squash-batch-terminalizer-v2-capabilities/v1";
const OPERATION = "canonical-squash-batch-terminalizer-v2";
const SHA = /^(?!0{40}$)[0-9a-f]{40}$/u;
const DIGEST = /^(?!0{64}$)[0-9a-f]{64}$/u;
const BRIDGE = Object.freeze({ pullRequest: 839,
  nodeId: "PR_kwDOSr5-fM8AAAABBjCzbQ", localEpoch: 338, claimCommitEpoch: 333,
  device: "katrinas-macbook-pro.local", scope: OPERATION,
  sessionId: "canonical-squash-batch-terminalizer-v2-20260831",
  branch: "agent/katrinas-macbook-pro.local/canonical-squash-batch-terminalizer-v2",
  authoritySubjectId: "urn:agentic-task:64e5f7691fc2d623cd39361ae2138460e265fbe4e04ae65e21cc0e2334257cd3",
  publicKeyDigest: "f933c1c8d109270a8ae0081a27cf235e3e82ee2c2183b402064623bccc6315aa",
  priorBindingDigest: "c64cafb1bf6470da1697e92a10cfd51d541eeabf756902b1f9af09659f1771d0" });

export function createCanonicalSquashBatchTerminalizerV2RepositoryAdapter({
  repository, controllerRoot, targetRepository = "huijoohwee/agentic-canvas-os",
  ledgerRepository = "huijoohwee/agentic-canvas-os", statePath, evidenceManifest,
  capabilityManifest = null, now = () => new Date(),
} = {}, dependencies = {}) {
  const root = physicalDirectory(repository, "canonical repository");
  const controller = physicalDirectory(controllerRoot, "controller root");
  if (controller !== root) {
    throw new Error("Controller bytes must execute from the exact canonical repository root.");
  }
  const target = repositoryName(targetRepository);
  if (target !== "huijoohwee/agentic-canvas-os" || repositoryName(ledgerRepository) !== target) {
    throw new Error("Batch terminalizer v2 is fixed to huijoohwee/agentic-canvas-os.");
  }
  const manifest = parseV2EvidenceManifest(evidenceManifest);
  const capabilities = parseV2CapabilityManifest(capabilityManifest, { optional: true });
  const journalStore = createPrivateBatchJournalStore(
    path.resolve(required(statePath, "state path")));
  const command = dependencies.execFileSync || execFileSync;
  const gitCommonDir = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const capabilityExclusions = [root, controller, gitCommonDir];
  const observerStore = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir });
  const ghText = args => String(command("gh", args, { cwd: root, encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GH_HOST: "github.com" } }));
  const complete = dependencies.completeSession || completeSession;
  const authorizeTask = dependencies.authorizeTaskBoundLeaseMutation
    || authorizeTaskBoundLeaseMutation;
  const withFence = dependencies.withReviewedLaneEntrypointFence
    || withReviewedLaneEntrypointFence;
  const assertFence = dependencies.assertReviewedLaneEntrypointFence
    || assertReviewedLaneEntrypointFence;
  const operationLock = dependencies.withPrivateOperationLock || withPrivateOperationLock;
  const currentMain = () => requireCanonicalMain(root, target);
  const readLedgerNow = () => readLedger({ ghText, repository: target });
  let active = null;

  function observe() {
    const mainSha = currentMain();
    const snapshot = readLedgerNow();
    const bridge = readBridge({ root, target, mainSha, manifest: manifest.bridge,
      snapshot, observerStore, ghText });
    return sealBatchEvidence({ schema: EVIDENCE_SCHEMA, observedMainSha: mainSha,
      ledger: { repository: target, revision: snapshot.revision,
        ledgerDigest: digestValue(snapshot.value) },
      controller: readController({ root: controller, target, bridge, mainSha }), bridge,
      items: FIXED_SUBJECTS.map((fixed, index) => readSubject({ root, target, fixed,
        subject: manifest.subjects[index], snapshot, observerStore, ghText })) });
  }

  function assertStableEvidence({ sealedEvidence, freshEvidence, phase }) {
    const sealed = normalizeBatchEvidence(sealedEvidence);
    const fresh = normalizeBatchEvidence(freshEvidence);
    if (sealed.stableDigest !== fresh.stableDigest
      || !isAncestor(root, sealed.observedMainSha, fresh.observedMainSha)
      || (phase === "plan" && canonicalJson(sealed.ledger) !== canonicalJson(fresh.ledger))) {
      throw new Error("Batch evidence drifted outside an unrelated protected-main/ledger advance.");
    }
    return Object.freeze({ stableDigest: sealed.stableDigest });
  }

  function preflightCapabilities({ journal }) {
    const state = normalizeBatchJournal(journal);
    const used = new Set();
    const entries = state.plan.evidence.items.map((item, index) => {
      const stored = observerStore.read(item.branch);
      const phaseIndex = state.items[index].phase;
      const terminalPhase = ["completion-projected", "terminal-verified", "complete"]
        .includes(phaseIndex);
      const prior = index < state.cursor;
      let responseLoss = false;
      if (!prior && !terminalPhase && ["completing", "completed"].includes(stored?.status)) {
        try { requireCompletionProjection({ root, lease: stored, evidence: item,
          state, pullRequest: item.pullRequest.number }); responseLoss = true; } catch {}
      }
      const requirement = prior ? "none-complete" : terminalPhase ? "none-terminal"
        : responseLoss ? "none-response-loss" : "mutation";
      const base = { pullRequest: item.pullRequest.number, requirement,
        bindingDigest: item.taskAuthority.bindingDigest, capabilityProjectionDigest: null };
      if (requirement !== "mutation") return { ...base, status: "not-required" };
      const row = capabilities?.items[index];
      if (!row || row.pullRequest !== item.pullRequest.number || !existsSync(row.capabilityPath)) {
        return { ...base, status: "missing" };
      }
      try {
        const capabilityPath = capabilityPathFor(item.pullRequest.number, capabilities,
          capabilityExclusions);
        if (used.has(capabilityPath)) return { ...base, status: "invalid" };
        used.add(capabilityPath);
        const binding = assertV2ImmutableLease(stored, item);
        const capability = readTaskAuthorityCapability(capabilityPath);
        assertCapabilityMatchesBinding(capability, binding);
        return { ...base, status: "available",
          capabilityProjectionDigest: digestValue(projectTaskAuthorityCapability(capability)) };
      } catch { return { ...base, status: "invalid" }; }
    });
    return buildCapabilityReport({ journal: state, entries });
  }

  function withItemFence({ plan, journal, evidence, pullRequest, capabilityReport }, action) {
    const report = normalizeCapabilityReport(capabilityReport, journal);
    const entry = report.items[FIXED_PULL_REQUESTS.indexOf(pullRequest)];
    const capabilityPath = entry.requirement === "mutation"
      ? capabilityPathFor(pullRequest, capabilities, capabilityExclusions) : null;
    const leaseStore = capabilityPath ? createWriterLeaseStore({ gitCommonDir,
      taskAuthorityFile: capabilityPath, taskAuthorityPolicy: "required" }) : observerStore;
    const lease = leaseStore.read(evidence.branch);
    const binding = assertV2ImmutableLease(lease, evidence);
    if (entry.requirement === "mutation") {
      const capability = readTaskAuthorityCapability(capabilityPath);
      assertCapabilityMatchesBinding(capability, binding);
      if (digestValue(projectTaskAuthorityCapability(capability))
        !== entry.capabilityProjectionDigest) throw new Error("Capability report drifted under fence.");
    }
    const sourceLeaseDigest = writerLeaseDigest(lease);
    return withFence({ leaseStore, branch: evidence.branch,
      entrypoint: OPERATION, operationDigest: digestValue({ planDigest: plan.planDigest,
        pullRequest, reportDigest: report.reportDigest }), expectedLeaseDigest: sourceLeaseDigest,
      expectedClaimId: evidence.cloud.claimId }, fence => {
      if (active) throw new Error("Batch terminalizer already owns an item fence.");
      active = { fence, leaseStore, pullRequest, capabilityPath, sourceLeaseDigest,
        transitioned: false };
      const finish = () => { active = null; };
      try { const result = action(Object.freeze({ fenceLeaseDigest: sourceLeaseDigest }));
        if (result && typeof result.then === "function") return result.finally(finish);
        finish(); return result; } catch (error) { finish(); throw error; }
    });
  }

  function verifyItemEvidence({ plan, journal, evidence, pullRequest, capabilityReport }) {
    requireActive(pullRequest);
    normalizeCapabilityReport(capabilityReport, normalizeBatchJournal(journal));
    const snapshot = readLedgerNow();
    requireControllerAndBridge({ plan, root, controller, target, manifest, observerStore,
      ghText, snapshot, mainSha: currentMain() });
    const index = FIXED_PULL_REQUESTS.indexOf(pullRequest);
    const fresh = readSubject({ root, target, fixed: FIXED_SUBJECTS[index],
      subject: manifest.subjects[index], snapshot, observerStore: active.leaseStore, ghText });
    if (digestValue(fresh) !== digestValue(evidence)
      || !isAncestor(root, plan.evidence.observedMainSha, currentMain())) {
      throw new Error(`PR ${pullRequest} evidence drifted from its sealed batch item.`);
    }
    return Object.freeze({ fenceLeaseDigest: active.sourceLeaseDigest,
      evidenceVerificationDigest: digestValue({ planDigest: plan.planDigest, pullRequest,
        fenceLeaseDigest: active.sourceLeaseDigest, evidence: fresh }) });
  }

  function classifyRetirementAdoption({ plan, evidence, pullRequest }) {
    requireActive(pullRequest);
    const cloud = classifyV2RetiredCloud(readLedgerNow(),
      active.leaseStore.read(evidence.branch), evidence.pullRequest, FIXED_SUBJECTS[
        FIXED_PULL_REQUESTS.indexOf(pullRequest)]);
    if (canonicalJson(cloud) !== canonicalJson(evidence.cloud)) {
      throw new Error(`PR ${pullRequest} terminal cloud lineage drifted.`);
    }
    const core = { schema: `agentic-${OPERATION}-retirement-adoption/v1`,
      planDigest: plan.planDigest, pullRequest, terminalCloudDigest: cloud.terminalCloudDigest,
      terminalEntryDigest: cloud.terminalEntryDigest,
      terminalClaimDigest: cloud.terminalClaimDigest, cloudMutation: false };
    return Object.freeze({ status: "retired", ...cloud,
      retirementReceiptDigest: digestValue(core) });
  }

  function classifyCompletionProjection({ evidence, pullRequest, journal }) {
    requireActive(pullRequest);
    const lease = active.leaseStore.read(evidence.branch);
    assertV2ImmutableLease(lease, evidence);
    if (lease.status === "delivery") return Object.freeze({ status: "pending" });
    try { return Object.freeze({ status: "completion-ready",
      ...requireCompletionProjection({ root, lease, evidence, state: journal, pullRequest }) }); }
    catch (error) { if (lease.status === "completing") {
      return Object.freeze({ status: "pending" });
    } throw error; }
  }

  function projectCompletion({ plan, journal, evidence, pullRequest, operationKey }) {
    requireActive(pullRequest);
    if (!active.capabilityPath) throw new Error(`PR ${pullRequest} capability is unavailable.`);
    const lease = active.leaseStore.read(evidence.branch);
    assertV2ImmutableLease(lease, evidence);
    if (!["delivery", "completing"].includes(lease.status)) {
      throw new Error(`PR ${pullRequest} is not completion-pending.`);
    }
    authorizeTask({ lease, capabilityPath: active.capabilityPath,
      operation: `${OPERATION}:completion:${plan.planDigest}:${operationKey}`, now: now() });
    assertFence({ fence: active.fence, leaseStore: active.leaseStore });
    const subjectPath = evidence.worktreePath;
    const gitText = args => String(command("git", ["-C", subjectPath, ...args], {
      encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }));
    const run = (binary, args, options = {}) => command(binary, args,
      { cwd: subjectPath, stdio: "inherit", ...options });
    const summary = complete({ invocationPath: subjectPath, repo: subjectPath, gitText,
      ghText, leaseStore: active.leaseStore, run, log: () => {}, json: true,
      finalize: false });
    active.transitioned = true;
    if (summary?.status !== "runtime_pending"
      || summary.mergeCommitSha !== evidence.pullRequest.mergeSha) {
      throw new Error(`PR ${pullRequest} completion projection did not remain runtime-pending.`);
    }
    const projection = requireCompletionProjection({ root,
      lease: active.leaseStore.read(evidence.branch), evidence, state: journal, pullRequest });
    return projection;
  }

  function verifyItemTerminal({ plan, journal, evidence, pullRequest, transitioned = false }) {
    requireActive(pullRequest, { allowTransition: transitioned });
    requireControllerAndBridge({ plan, root, controller, target, manifest, observerStore,
      ghText, snapshot: readLedgerNow(), mainSha: currentMain() });
    return terminalLive({ root, target, evidence, state: journal, pullRequest,
      snapshot: readLedgerNow(), leaseStore: active.leaseStore, ghText });
  }

  function verifyBatchTerminal({ plan, journal, pendingPullRequest = null }) {
    const state = normalizeBatchJournal(journal);
    const snapshot = readLedgerNow();
    requireControllerAndBridge({ plan, root, controller, target, manifest, observerStore,
      ghText, snapshot, mainSha: currentMain() });
    const count = state.cursor + (pendingPullRequest ? 1 : 0);
    const terminalDigests = []; const terminalStatuses = [];
    for (let index = 0; index < count; index += 1) {
      const evidence = plan.evidence.items[index];
      const pullRequest = FIXED_PULL_REQUESTS[index];
      const verify = leaseStore => terminalLive({ root, target, evidence, state,
        pullRequest, snapshot, leaseStore, ghText });
      let terminal;
      if (active?.pullRequest === pullRequest) terminal = verify(active.leaseStore);
      else {
        const lease = observerStore.read(evidence.branch);
        assertV2ImmutableLease(lease, evidence);
        terminal = withFence({ leaseStore: observerStore, branch: evidence.branch,
          entrypoint: `${OPERATION}-terminal-replay`, operationDigest: digestValue({
            planDigest: plan.planDigest, pullRequest, mode: "read-only" }),
          expectedLeaseDigest: writerLeaseDigest(lease), expectedClaimId: evidence.cloud.claimId },
        () => verify(observerStore));
      }
      const expected = state.items[index].receipts["terminal-verified"]?.values
        .terminalEvidenceDigest;
      const storedStatus = state.items[index].receipts["terminal-verified"]?.values
        .terminalStatus;
      const completeStatus = state.items[index].receipts.complete?.values.terminalStatus;
      if (terminal.terminalEvidenceDigest !== expected
        || ([storedStatus, completeStatus].includes("completed")
          && terminal.terminalStatus !== "completed")) {
        throw new Error(`PR ${pullRequest} terminal evidence drifted.`);
      }
      terminalDigests.push(expected); terminalStatuses.push(terminal.terminalStatus);
    }
    return Object.freeze({ terminalBatchDigest: digestValue({ operation: OPERATION,
      planDigest: plan.planDigest, terminalDigests }), terminalStatuses });
  }

  function requireActive(pullRequest, { allowTransition = false } = {}) {
    if (!active || active.pullRequest !== pullRequest) {
      throw new Error(`PR ${pullRequest} operation lacks its item-scoped fence.`);
    }
    if (!active.transitioned) assertFence({ fence: active.fence, leaseStore: active.leaseStore });
    else if (!allowTransition) throw new Error(`PR ${pullRequest} fence lease already transitioned.`);
  }

  return Object.freeze({
    withOperationLock: (context, action) => operationLock({ file: `${journalStore.path}.lock`,
      context, action, now }), readJournal: journalStore.read, writeJournal: journalStore.write,
    observe, assertStableEvidence, preflightCapabilities, withItemFence,
    verifyItemEvidence, classifyRetirementAdoption, classifyCompletionProjection,
    projectCompletion, verifyItemTerminal, verifyBatchTerminal,
  });
}

export function parseV2EvidenceManifest(value) {
  return normalizeV2EvidenceManifest(value, FIXED_SUBJECTS);
}

export function parseV2CapabilityManifest(value, { optional = false } = {}) {
  return normalizeV2CapabilityManifest(value, FIXED_PULL_REQUESTS, { optional });
}

function readSubject({ root, target, fixed, subject, snapshot, observerStore, ghText }) {
  const pull = readPull(ghText, target, fixed.pullRequest);
  const lease = observerStore.read(fixed.branch);
  const binding = assertV2ImmutableLease(lease, fixed);
  const source = readV2JoinedCommit({ root, target, sha: fixed.headSha, ghText,
    verified: false, reason: "unsigned", verificationDigest: fixed.sourceVerificationDigest });
  const protectedCommit = readV2JoinedCommit({ root, target, sha: fixed.mergeSha, ghText,
    verified: true, reason: "valid", verificationDigest: fixed.protectedVerificationDigest });
  const historyShas = fixed.pullRequest === 818
    ? ["002608121bffde3c9185647d1bbb7d4447dc1ef4", fixed.integrationCommit]
    : [fixed.fenceSha, fixed.headSha];
  const authorShas = fixed.pullRequest === 818
    ? [historyShas[0], fixed.protectedRefreshTopology.authoredParentSha, historyShas[1]]
    : historyShas;
  const message = classifyV2ProtectedMessage({ sourceMessage: source.message,
    protectedMessage: protectedCommit.message,
    sourceHistorySubjects: historyShas.map(sha => git(root, ["show", "-s", "--format=%s", sha])),
    sourceAuthors: authorShas.map(sha => readAuthor(root, sha)),
    autoMergeRequest: pull.autoMergeRequest, mergedBy: pull.mergedBy });
  const refresh = verifyProtectedRefresh(root, fixed);
  const integration = lease.integration;
  return Object.freeze({ pullRequest: { number: pull.number, nodeId: pull.nodeId, url: pull.url,
    baseSha: pull.baseSha, headSha: pull.headSha, mergeSha: pull.mergeSha,
    autoMergeDigest: pull.autoMergeDigest }, branch: pull.headBranch,
    worktreePath: lease.worktreePath, sourceCommit: source, protectedCommit,
    message: { sourceKind: message.sourceKind, protectedKind: message.protectedKind,
      sourceMessageDigest: source.messageDigest,
      protectedMessageDigest: protectedCommit.messageDigest,
      sourceRawMessageSha256: source.rawMessageSha256,
      protectedRawMessageSha256: protectedCommit.rawMessageSha256,
      renderedMessageDigest: message.renderedMessageDigest,
      providerCauseDigest: message.providerCauseDigest,
      sourceHistoryDigest: message.sourceHistoryDigest,
      authorAttributionDigest: message.authorAttributionDigest },
    checks: { reviewedRun: readV2Run(ghText, target, subject.reviewedRunId,
      { headSha: pull.headSha, branch: pull.headBranch, event: "pull_request" }),
    postMainRun: readV2Run(ghText, target, subject.postMainRunId,
      { headSha: pull.mergeSha, branch: "main", event: "push" }) },
    lease: { epoch: lease.epoch, sessionId: lease.sessionId, scope: lease.scope,
      branch: lease.branch, worktreePath: lease.worktreePath, baseSha: lease.baseSha,
      fenceSha: lease.fenceSha, pullRequestUrl: lease.pullRequestUrl,
      deliveryHeadSha: lease.deliveryHeadSha,
      cloudAuthorityDigest: digestValue(lease.cloudAuthority),
      taskAuthorityBindingDigest: binding.bindingDigest,
      integrationDigest: digestValue(integration), leaseIdentityDigest: fixed.leaseIdentityDigest },
    taskAuthority: { authoritySubjectId: binding.authoritySubjectId,
      proofAdapterId: binding.proofAdapterId, generation: binding.generation,
      publicKeyDigest: binding.publicKeyDigest, laneBindingDigest: binding.laneBindingDigest,
      bindingMode: binding.bindingMode, priorBindingDigest: binding.priorBindingDigest,
      bindingDigest: binding.bindingDigest },
    cloud: classifyV2RetiredCloud(snapshot, lease, pull, fixed),
    integration: { commitSha: integration.commitSha, treeSha: integration.treeSha,
      commitMessageDigest: digestValue(integration.commitMessage),
      pathsDigest: digestValue(integration.paths), manifestDigest: integration.manifestDigest,
      stagedDiffDigest: integration.stagedDiffDigest, protectedRefresh: refresh } });
}

function readBridge({ root, target, mainSha, manifest, snapshot, observerStore, ghText }) {
  const pull = readPull(ghText, target, manifest.pullRequest);
  const lease = observerStore.read(pull.headBranch);
  const binding = assertTaskAuthorityBinding({ binding: lease?.taskAuthority, lease });
  const expectedWorktree = path.join(path.dirname(root), ".worktrees", path.basename(root),
    BRIDGE.scope);
  if (pull.number !== BRIDGE.pullRequest || pull.nodeId !== BRIDGE.nodeId
    || pull.headBranch !== BRIDGE.branch || lease?.status !== "completed"
    || lease.epoch !== BRIDGE.localEpoch || lease.device !== BRIDGE.device
    || lease.sessionId !== BRIDGE.sessionId || lease.scope !== BRIDGE.scope
    || lease.branch !== BRIDGE.branch || lease.autoDelivery !== false
    || lease.runtimeRequired !== false
    || lease.worktreePath !== expectedWorktree || lease.pullRequestUrl !== pull.url
    || binding.authoritySubjectId !== BRIDGE.authoritySubjectId
    || binding.publicKeyDigest !== BRIDGE.publicKeyDigest || binding.generation !== 1
    || binding.proofAdapterId !== "urn:agentic-proof:ed25519-file:v1"
    || binding.bindingMode !== "continuation"
    || binding.priorBindingDigest !== BRIDGE.priorBindingDigest
    || lease.completion?.mergeCommitSha !== pull.mergeSha
    || !isAncestor(root, pull.mergeSha, lease.completion.mainSha)
    || !isAncestor(root, lease.completion.mainSha, mainSha)) {
    throw new Error("Controller bridge is not one exact completed lease.");
  }
  const source = readV2JoinedCommit({ root, target, sha: pull.headSha, ghText,
    verified: false, reason: "unsigned" });
  const protectedCommit = readV2JoinedCommit({ root, target, sha: pull.mergeSha, ghText,
    verified: true, reason: "valid" });
  const integration = completedBridgeIntegration({ lease, pull, source });
  const authored = readV2GitCommit(root, integration?.commitSha);
  const claimSha = authored.parentShas.length === 1 ? authored.parentShas[0] : null;
  const claim = readV2GitCommit(root, claimSha);
  const sourceParents = integration?.commitSha === pull.headSha ? [claimSha]
    : [integration?.commitSha, pull.baseSha];
  if (lease.baseSha !== pull.baseSha || lease.deliveryHeadSha !== pull.headSha
    || claimSha !== lease.fenceSha
    || canonicalJson(claim.parentShas) !== canonicalJson([lease.baseSha])
    || claim.treeSha !== git(root, ["rev-parse", `${lease.baseSha}^{tree}`])
    || claim.message.split("\n", 1)[0]
      !== `chore(coordination): claim ${BRIDGE.scope} lease ${BRIDGE.claimCommitEpoch}`
    || source.treeSha !== protectedCommit.treeSha
    || canonicalJson(source.parentShas) !== canonicalJson(sourceParents)
    || canonicalJson(protectedCommit.parentShas) !== canonicalJson([pull.baseSha])
    || authored.message !== source.message || integration.treeSha !== authored.treeSha
    || integration.commitMessage !== source.message.split("\n", 1)[0]
    || !source.message.includes(`\nAgentic-Task: ${BRIDGE.scope}\nAgentic-Scope: ${BRIDGE.scope}\n`)
    || canonicalJson(integration.paths) !== canonicalJson(INSTALL_PATHS)) {
    throw new Error("Controller bridge source/protected/integration topology is not exact.");
  }
  const sourceDelta = INSTALL_PATHS.map(repositoryPath =>
    ["A", repositoryPath, gitBlobSha(root, pull.headSha, repositoryPath)]);
  verifyExactAddedDelta(root, pull.baseSha, pull.headSha, sourceDelta);
  verifyExactAddedDelta(root, claimSha, integration.commitSha, sourceDelta);
  const message = classifyV2ProtectedMessage({ sourceMessage: source.message,
    protectedMessage: protectedCommit.message,
    sourceHistorySubjects: [claimSha, integration.commitSha].map(sha =>
      git(root, ["show", "-s", "--format=%s", sha])),
    sourceAuthors: [claimSha, integration.commitSha].map(sha => readAuthor(root, sha)),
    autoMergeRequest: pull.autoMergeRequest, mergedBy: pull.mergedBy });
  const records = worktreeRecords(root);
  if (existsSync(lease.worktreePath) || records.some(record => record.path === lease.worktreePath
    || record.branch === `refs/heads/${pull.headBranch}`)) {
    throw new Error("Controller bridge worktree cleanup is incomplete.");
  }
  if (git(root, ["rev-parse", `refs/heads/${pull.headBranch}`]) !== pull.headSha) {
    throw new Error("Controller bridge branch is not preserved.");
  }
  const managedRoot = path.dirname(lease.worktreePath);
  const cleanup = createWorktreeCleanupOperationId({ repository: root,
    gitCommonDir: git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    targetPath: lease.worktreePath, completionMainSha: lease.completion.mainSha,
    preservedBranch: pull.headBranch, managedContainer: { root: managedRoot },
    sharedContainer: { root: path.dirname(managedRoot) } });
  if (cleanup !== manifest.cleanupOperationId) throw new Error("Bridge cleanup id does not recompute.");
  const bridgeLineage = snapshot.value.entries.filter(entry =>
    entry.claimId === lease.cloudAuthority.claimId);
  const terminal = classifyIntegratedRetirement(snapshot, {
    claimId: lease.cloudAuthority.claimId, finalRevision: pull.headSha,
    reviewRequestId: `github-pull-request:${pull.nodeId}`,
    integratedClaimDigest: bridgeLineage.at(-2)?.claimDigest,
    integrationReceiptDigest: lease.cloudAuthority.integrationReceiptDigest,
  });
  return Object.freeze({ pullRequest: pull.number, nodeId: pull.nodeId, url: pull.url,
    branch: pull.headBranch, scope: lease.scope, sessionId: lease.sessionId, epoch: lease.epoch,
    baseSha: pull.baseSha, autoMergeDigest: pull.autoMergeDigest,
    sourceHeadSha: pull.headSha, sourceTreeSha: source.treeSha,
    mergeSha: pull.mergeSha, mergeTreeSha: protectedCommit.treeSha,
    sourceCommitDigest: digestValue(source), protectedCommitDigest: digestValue(protectedCommit),
    messageClassificationDigest: digestValue(message), installDeltaDigest: digestValue(sourceDelta),
    leaseIntegrationDigest: digestValue(integration), worktreePath: lease.worktreePath,
    completedLeaseDigest: writerLeaseDigest(lease), authoritySubjectId: binding.authoritySubjectId,
    publicKeyDigest: binding.publicKeyDigest, taskAuthorityBindingDigest: binding.bindingDigest,
    claimId: lease.cloudAuthority.claimId,
    terminalCloudDigest: terminal.terminalCloudDigest,
    completionMainSha: lease.completion.mainSha, cleanupOperationId: cleanup,
    worktree: "absent", registration: "absent", branchRef: "preserved",
    controllerContained: isAncestor(root, pull.mergeSha, mainSha) });
}

export function completedBridgeIntegration({ lease, pull, source }) {
  if (lease?.integration) return lease.integration;
  const declaredPaths = (lease?.admission?.declaredWriteSet || [])
    .filter(value => value.startsWith("path:"))
    .map(value => value.slice(5));
  const commitMessage = source?.message?.split("\n", 1)[0];
  if (lease?.status !== "completed" || lease.reviewHeadSha !== pull?.headSha
    || lease.deliveryHeadSha !== pull?.headSha || source?.sha !== pull?.headSha
    || lease.admission?.status !== "admitted"
    || canonicalJson(declaredPaths) !== canonicalJson(INSTALL_PATHS)
    || !DIGEST.test(lease.admission.manifestDigest)
    || typeof commitMessage !== "string" || commitMessage.length === 0) {
    throw new Error("Completed controller bridge lacks an exact review publication proof.");
  }
  return Object.freeze({ schema: "agentic-completed-review-publication/v1",
    commitSha: pull.headSha, treeSha: source.treeSha, commitMessage,
    paths: Object.freeze([...INSTALL_PATHS]),
    manifestDigest: lease.admission.manifestDigest });
}

function readController({ root, target, bridge, mainSha }) {
  if (!isAncestor(root, bridge.mergeSha, mainSha)) throw new Error("Main lacks controller bridge.");
  const installBlobs = INSTALL_PATHS.map(repositoryPath => ({ path: repositoryPath,
    blobSha: gitBlobSha(root, bridge.mergeSha, repositoryPath) }));
  for (const entry of installBlobs) if (gitBlobSha(root, mainSha, entry.path) !== entry.blobSha) {
    throw new Error(`Installed controller blob drifted: ${entry.path}`);
  }
  return Object.freeze({ repository: target, revision: bridge.mergeSha,
    treeSha: git(root, ["rev-parse", `${bridge.mergeSha}^{tree}`]),
    installBlobs: Object.freeze(installBlobs) });
}

function requireControllerAndBridge({ plan, root, controller, target, manifest,
  observerStore, ghText, snapshot, mainSha }) {
  const bridge = readBridge({ root, target, mainSha, manifest: manifest.bridge,
    snapshot, observerStore, ghText });
  const current = readController({ root: controller, target, bridge, mainSha });
  if (digestValue(bridge) !== digestValue(plan.evidence.bridge)
    || digestValue(current) !== digestValue(plan.evidence.controller)) {
    throw new Error("Controller or completed-and-cleaned bridge drifted from the plan.");
  }
}

function readPull(ghText, repository, number) {
  const raw = JSON.parse(ghText(["pr", "view", String(number), "--repo", repository,
    "--json", "number,id,url,state,isDraft,mergedAt,headRefName,headRefOid,baseRefName,baseRefOid,mergeCommit,mergedBy,isCrossRepository,autoMergeRequest"]));
  if (raw.number !== number || raw.state !== "MERGED" || raw.isDraft !== false
    || raw.isCrossRepository !== false || raw.baseRefName !== "main"
    || !raw.mergeCommit?.oid || !raw.mergedAt) throw new Error(`PR ${number} is not exact merged.`);
  const request = raw.autoMergeRequest;
  const autoMergeRequest = request === null ? null : { mergeMethod: request.mergeMethod,
    commitHeadline: request.commitHeadline, commitBody: request.commitBody,
    enabledAt: request.enabledAt, enabledBy: { id: request.enabledBy?.id,
      login: request.enabledBy?.login, isBot: request.enabledBy?.is_bot
        ?? request.enabledBy?.isBot } };
  const stable = { number: raw.number, nodeId: raw.id, url: raw.url,
    baseSha: raw.baseRefOid, headSha: raw.headRefOid, mergeSha: raw.mergeCommit.oid,
    autoMergeDigest: digestValue(autoMergeRequest) };
  return Object.freeze({ ...stable, headBranch: raw.headRefName,
    mergedBy: raw.mergedBy?.login, autoMergeRequest, identityDigest: digestValue(stable) });
}

function readLedger({ ghText, repository }) {
  const ref = ghJson(ghText, `repos/${repository}/git/ref/heads/${encodeURIComponent("agentic/collaboration-ledger")}`);
  const revision = requiredSha(ref?.object?.sha, "ledger revision");
  const commit = ghJson(ghText, `repos/${repository}/git/commits/${revision}`);
  let treeSha = requiredSha(commit?.tree?.sha, "ledger tree");
  for (const [index, segment] of [".agentic", "collaboration-ledger.json"].entries()) {
    const tree = ghJson(ghText, `repos/${repository}/git/trees/${treeSha}`);
    const entry = tree.tree?.find(item => item.path === segment);
    if (entry?.type !== (index === 0 ? "tree" : "blob")) throw new Error("Ledger path is missing.");
    treeSha = requiredSha(entry.sha, "ledger object");
  }
  const blob = ghJson(ghText, `repos/${repository}/git/blobs/${treeSha}`);
  if (blob.encoding !== "base64") throw new Error("Ledger blob encoding is invalid.");
  const value = JSON.parse(Buffer.from(String(blob.content).replace(/\s/gu, ""), "base64"));
  const failures = validateLedger(value);
  if (failures.length) throw new Error(`Collaboration ledger is invalid: ${failures[0]}`);
  return Object.freeze({ revision, value });
}

function requireCompletionProjection({ root, lease, evidence, state, pullRequest }) {
  assertV2ImmutableLease(lease, evidence);
  if (!["completing", "completed"].includes(lease.status)
    || lease.completion?.mergeCommitSha !== evidence.pullRequest.mergeSha
    || !isAncestor(root, evidence.pullRequest.mergeSha, lease.completion.mainSha)
    || !isAncestor(root, lease.completion.mainSha,
      requireCanonicalMain(root, "huijoohwee/agentic-canvas-os"))) {
    throw new Error(`PR ${pullRequest} completion topology is invalid.`);
  }
  if (git(root, ["rev-parse", `refs/heads/${evidence.branch}`]) !== evidence.pullRequest.headSha) {
    throw new Error(`PR ${pullRequest} preserved branch changed.`);
  }
  const records = worktreeRecords(root); const registered = records.find(item =>
    item.path === evidence.worktreePath); const present = existsSync(evidence.worktreePath);
  if (lease.status === "completing" && (!present || !registered || registered.branch !== null
    || git(evidence.worktreePath, ["branch", "--show-current"]) !== ""
    || git(evidence.worktreePath, ["rev-parse", "HEAD"]) !== lease.completion.mainSha
    || git(evidence.worktreePath, ["status", "--porcelain"]) !== "")) {
    throw new Error(`PR ${pullRequest} completing worktree is not detached clean main.`);
  }
  if (lease.status === "completed" && (present || registered)) {
    throw new Error(`PR ${pullRequest} completed worktree cleanup is not exact.`);
  }
  return Object.freeze({ relation: "protected-descendant" });
}

function terminalLive({ root, target, evidence, state, pullRequest, snapshot, leaseStore, ghText }) {
  const lease = leaseStore.read(evidence.branch);
  assertV2ImmutableLease(lease, evidence);
  const pull = readPull(ghText, target, pullRequest);
  if (digestValue({ number: pull.number, nodeId: pull.nodeId, url: pull.url,
    baseSha: pull.baseSha, headSha: pull.headSha, mergeSha: pull.mergeSha,
    autoMergeDigest: pull.autoMergeDigest }) !== digestValue(evidence.pullRequest)) {
    throw new Error(`PR ${pullRequest} provider identity drifted.`);
  }
  const fixed = FIXED_SUBJECTS[FIXED_PULL_REQUESTS.indexOf(pullRequest)];
  const cloud = classifyV2RetiredCloud(snapshot, lease, pull, fixed);
  if (cloud.terminalCloudDigest !== evidence.cloud.terminalCloudDigest) {
    throw new Error(`PR ${pullRequest} terminal cloud drifted.`);
  }
  const projection = requireCompletionProjection({ root, lease, evidence, state, pullRequest });
  const core = { schema: `agentic-${OPERATION}-item-terminal/v1`,
    planDigest: state.plan.planDigest, pullRequest, branch: evidence.branch,
    headSha: evidence.pullRequest.headSha, mergeSha: evidence.pullRequest.mergeSha,
    terminalCloudDigest: cloud.terminalCloudDigest, completionRelation: projection.relation,
    localState: "completion-ready-or-completed", branchRef: "preserved" };
  return Object.freeze({ terminalStatus: lease.status === "completing"
    ? "completion-ready" : "completed", terminalEvidenceDigest: digestValue(core) });
}

function verifyProtectedRefresh(root, fixed) {
  const value = fixed.protectedRefreshTopology;
  if (!value) return null;
  const authored = readV2GitCommit(root, value.authoredSha);
  if (authored.treeSha !== value.authoredTreeSha
    || canonicalJson(authored.parentShas) !== canonicalJson([value.authoredParentSha])
    || authored.messageDigest !== fixed.sourceMessageDigest) {
    throw new Error("PR 818 authored protected-refresh topology drifted.");
  }
  for (const [from, to] of [[value.authoredParentSha, value.authoredSha],
    [fixed.baseSha, fixed.headSha]]) verifyExactAddedDelta(root, from, to, value.delta);
  return structuredClone(value);
}

function verifyExactAddedDelta(root, from, to, expected) {
  const lines = git(root, ["diff", "--name-status", "--no-renames", from, to])
    .split("\n").filter(Boolean);
  if (canonicalJson(lines) !== canonicalJson(expected.map(item => `${item[0]}\t${item[1]}`))) {
    throw new Error("PR 818 protected-refresh changed-path delta drifted.");
  }
  for (const [, repositoryPath, blob] of expected) {
    if (git(root, ["ls-tree", from, "--", repositoryPath]) !== ""
      || git(root, ["ls-tree", to, "--", repositoryPath])
        !== `100644 blob ${blob}\t${repositoryPath}`) {
      throw new Error("PR 818 protected-refresh blob delta drifted.");
    }
  }
}

function requireCanonicalMain(root, target) {
  const head = git(root, ["rev-parse", "HEAD"]); const origin = git(root, ["rev-parse", "origin/main"]);
  const remote = String(execFileSync("git", ["ls-remote", "origin", "refs/heads/main"],
    { cwd: root, encoding: "utf8" })).trim().split(/\s/u)[0];
  if (git(root, ["branch", "--show-current"]) !== "main"
    || git(root, ["status", "--porcelain"]) !== "" || head !== origin || head !== remote
    || remoteRepository(root) !== target) throw new Error("Canonical repository is not clean exact main.");
  return head;
}

function physicalDirectory(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error(`${label} must be absolute.`);
  const target = realpathSync(path.resolve(value));
  if (!lstatSync(target).isDirectory()) throw new Error(`${label} must be a directory.`);
  return target;
}
function repositoryName(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value)) {
    throw new Error("Repository identity is invalid.");
  }
  return value;
}
function capabilityPathFor(pullRequest, manifest, excluded) {
  const value = manifest?.items.find(item => item.pullRequest === pullRequest)?.capabilityPath;
  if (!value) throw new Error(`PR ${pullRequest} capability is missing; no effect was attempted.`);
  return resolveV2PrivateCapabilityPath(value, excluded);
}
function readAuthor(root, sha) {
  const [name, email] = git(root, ["show", "-s", "--format=%an%x00%ae", sha]).split("\0");
  return { name, email };
}
function ghJson(ghText, endpoint) { return JSON.parse(ghText(["api", endpoint])); }
function git(root, args) { return String(execFileSync("git", ["-C", root, ...args],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } })).trim(); }
function gitBlobSha(root, revision, repositoryPath) {
  const match = /^[0-7]{6} blob ((?!0{40}\t)[0-9a-f]{40})\t(.+)$/u.exec(git(root,
    ["ls-tree", revision, "--", repositoryPath]));
  if (!match || match[2] !== repositoryPath) throw new Error(`Missing blob ${repositoryPath}.`);
  return match[1];
}
function worktreeRecords(root) { return git(root, ["worktree", "list", "--porcelain"])
  .split("\n\n").filter(Boolean).map(block => { const lines = block.split("\n");
    return { path: lines[0].slice(9),
      branch: lines.find(line => line.startsWith("branch "))?.slice(7) || null }; }); }
function isAncestor(root, ancestor, descendant) { try {
  execFileSync("git", ["-C", root, "merge-base", "--is-ancestor", ancestor, descendant]);
  return true; } catch { return false; } }
function remoteRepository(root) { const value = git(root, ["remote", "get-url", "origin"]);
  const match = /github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/u.exec(value);
  if (!match) throw new Error("Origin is not one GitHub repository.");
  return `${match[1]}/${match[2]}`; }
function required(value, label) { if (typeof value !== "string" || !value.trim()) {
  throw new Error(`${label} is required.`); } return value; }
function requiredSha(value, label) { if (typeof value !== "string" || !SHA.test(value)) {
  throw new Error(`${label} is invalid.`); } return value; }
function requiredDigest(value, label) { if (typeof value !== "string" || !DIGEST.test(value)) {
  throw new Error(`${label} is invalid.`); } return value; }
