// Responsibility: Bind terminal-handoff recovery to Git, GitHub, cloud, proof, and lease CAS.
import { execFileSync } from "node:child_process";
import {
  closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";

import { createActiveOwnedDirtSnapshot, captureActiveOwnedDirtEvidence,
  assertActiveOwnedDirtWithinWriteSet, requireSameActiveOwnedDirtEvidence }
  from "./active-owned-dirt-recovery-evidence.mjs";
import { ENTRY_SCHEMA, LEGACY_ENTRY_SCHEMA, RECEIPT_SCHEMA, listCurrentClaims, validateLedger }
  from "./cloud-collaboration-contract.mjs";
import { canonicalJson, digestValue, normalizeWriteSet }
  from "./cloud-collaboration-primitives.mjs";
import { DEFAULT_LEDGER_PATH, DEFAULT_LEDGER_REF }
  from "./github-cloud-collaboration-adapter.mjs";
import { readOwnershipPullRequest } from "./device-pull-request-state.mjs";
import { writerLeaseBodyRemainder }
  from "./orphaned-task-authority-recovery-evidence.mjs";
import { assertRegisteredWorktree, parseWorktreeRecords } from "./repository-guards.mjs";
import { invokeRepositoryCloudAction, bindAdmissionCloudAuthority,
  verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { normalizeBoundAuthority } from "./scoped-lane-cloud-reconciliation.mjs";
import { assertTaskAuthorityBinding, createTaskAuthorityBinding, createTaskAuthorityProof,
  normalizeTaskAuthorityCapability, projectTaskAuthorityCapability, verifyTaskAuthorityProof }
  from "./task-bound-lane-authority-contract.mjs";
import { createWriterLeaseStore, parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody }
  from "./writer-lease-lib.mjs";
import { mutateWriterLeaseRegistry, writerLeaseDigest }
  from "./writer-lease-registry-cas.mjs";
import { normalizeRecoveryIntent }
  from "./terminal-handoff-owned-dirt-successor-recovery-contract.mjs";
import { EVIDENCE_SCHEMA, assertNoLiveOverlap, sealTerminalHandoffEvidence,
  selectTerminalHandoffClaimProof }
  from "./terminal-handoff-owned-dirt-successor-recovery-evidence.mjs";

const JOURNAL_SCHEMA = "agentic-terminal-handoff-owned-dirt-successor-recovery-journal/v1";
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const REPOSITORY_IDENTITY = Symbol("terminal-handoff-repository-identity");

export function createTerminalHandoffOwnedDirtSuccessorRecoveryRepositoryAdapter(
  options = {}, dependencies = {},
) {
  const repository = realpathSync(path.resolve(text(options.repository, "repository")));
  const execute = (command, args, settings = {}) => execFileSync(command, args, {
    cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024, ...settings,
  });
  const git = dependencies.gitText || (args => execute("git", args).trim());
  const gh = dependencies.ghText || (args => execute("gh", args).trim());
  const ghJson = dependencies.ghJson || (args => JSON.parse(execute("gh", args)));
  const invoke = dependencies.invoke || invokeRepositoryCloudAction;
  const verify = dependencies.verify;
  const environment = options.environment || process.env;
  const branch = text(git(["branch", "--show-current"]), "branch");
  if (options.branch && options.branch !== branch) throw new Error("Requested branch differs from checkout.");
  const common = realpathSync(path.resolve(repository, git(["rev-parse", "--git-common-dir"])));
  const worktrees = parseWorktreeRecords(git(["worktree", "list", "--porcelain", "-z"]));
  const capabilityPath = secureExternalCapabilityPath({ repository, common, worktrees,
    value: options.taskAuthorityFile, label: "task capability" });
  const readSuccessorCapability = () => readSecureExternalCapability({
    repository,
    expectedCommon: common,
    expectedPath: capabilityPath,
    git,
  });
  const store = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir: common });
  const state = statePaths(common, branch);
  let activeFence = null;

  async function withRecoveryFence(action) {
    if (activeFence) throw new Error("Recovery fence is already active in this adapter.");
    let descriptor = null;
    const context = {
      acquire() {
        if (descriptor !== null) return;
        ensureStateDirectory(state.lock);
        try {
          descriptor = openSync(state.lock, "wx", 0o600);
          writeFileSync(descriptor, `${process.pid}\n`);
          fsyncSync(descriptor);
        } catch (error) {
          if (error?.code === "EEXIST") {
            throw new Error("Recovery is already fenced.");
          }
          throw error;
        }
      },
    };
    activeFence = context;
    try {
      return await action();
    } finally {
      activeFence = null;
      if (descriptor !== null) closeSync(descriptor);
      if (descriptor !== null && existsSync(state.lock)) unlinkSync(state.lock);
    }
  }

  function readLease() {
    const lease = store.read(branch);
    if (!lease || lease.branch !== branch) throw new Error("Recovery writer lease is missing.");
    return lease;
  }
  function originRepositoryIdentity(lease, plan = null) {
    const fetchUrls = remoteUrls(git([
      "remote", "get-url", "--all", "origin",
    ]), "origin fetch URL");
    const pushUrls = remoteUrls(git([
      "remote", "get-url", "--push", "--all", "origin",
    ]), "origin push URL");
    if (fetchUrls.length !== 1 || pushUrls.length !== 1) {
      throw new Error("Recovery requires one target origin fetch URL and one push URL.");
    }
    const identity = assertTerminalHandoffOriginRepositoryIdentity({
      targetRepository: lease?.cloudAuthority?.targetRepository,
      originFetchUrl: fetchUrls[0],
      originPushUrl: pushUrls[0],
    });
    if (plan) assertSealedTerminalHandoffRepositoryIdentity({ plan, identity });
    return identity;
  }
  function cloudInvoke(lease, plan, input, implementation = invoke) {
    originRepositoryIdentity(lease, plan);
    return implementation(input);
  }
  function providerJson(lease, plan, args) {
    originRepositoryIdentity(lease, plan);
    return ghJson(args);
  }
  function guardedCloudInvoke(lease, plan, implementation = invoke) {
    return input => cloudInvoke(lease, plan, input, implementation);
  }
  function status(lease = readLease(), plan = null) {
    const result = cloudInvoke(lease, plan, { action: "status",
      ledgerRepository: lease.cloudAuthority.ledgerRepository,
      request: { targetRepository: lease.cloudAuthority.targetRepository }, environment });
    const snapshot = rawLedger(lease, plan);
    return assertTerminalHandoffCloudStatusSnapshot({ result, snapshot,
      sourceClaimId: lease.cloudAuthority.claimId });
  }
  function rawLedger(lease, plan = null) {
    originRepositoryIdentity(lease, plan);
    const ledgerRepository = text(lease.cloudAuthority.ledgerRepository, "ledger repository");
    githubRepositoryName(ledgerRepository, "ledger repository");
    const reference = providerJson(lease, plan,
      ["api", `repos/${ledgerRepository}/git/ref/heads/${encodeURIComponent(DEFAULT_LEDGER_REF)}`]);
    const revision = sha(reference?.object?.sha, "ledger ref revision");
    const metadata = providerJson(lease, plan,
      ["api", `repos/${ledgerRepository}/contents/${DEFAULT_LEDGER_PATH}?ref=${revision}`]);
    const blob = providerJson(lease, plan,
      ["api", `repos/${ledgerRepository}/git/blobs/${sha(metadata?.sha, "ledger blob SHA")}`]);
    if (blob?.encoding !== "base64" || !blob.content) throw new Error("Raw ledger blob is incomplete.");
    const ledger = JSON.parse(Buffer.from(String(blob.content).replaceAll("\n", ""), "base64").toString("utf8"));
    const failures = validateLedger(ledger);
    if (failures.length) throw new Error(`Raw collaboration ledger is invalid: ${failures.join("; ")}`);
    return Object.freeze({ ledger, ledgerRevision: revision });
  }
  function readPull(lease, plan = null) {
    const before = originRepositoryIdentity(lease, plan);
    const url = text(lease.pullRequestUrl, "pull-request URL");
    if (plan && url !== plan?.evidence?.pullRequest?.url) {
      throw new Error("Pull-request URL changed from the authorized recovery plan.");
    }
    if (githubRepositoryFromPullRequestUrl(url) !== before.targetRepository) {
      throw new Error("Pull-request URL does not belong to the target origin repository.");
    }
    const pull = readOwnershipPullRequest({ url, branch,
      ghText: args => {
        originRepositoryIdentity(lease, plan);
        return gh(args);
      } });
    const after = originRepositoryIdentity(lease, plan);
    const identity = assertTerminalHandoffRepositoryIdentity({
      targetRepository: lease.cloudAuthority.targetRepository,
      originFetchUrl: after.originFetchUrl,
      originPushUrl: after.originPushUrl,
      pullRequest: pull,
      branch,
    });
    if (plan && identity.identityDigest !== plan?.evidence?.repositoryIdentity?.identityDigest) {
      throw new Error("Repository identity changed from the authorized recovery plan.");
    }
    const value = { ...pull };
    Object.defineProperty(value, REPOSITORY_IDENTITY, { value: identity });
    return Object.freeze(value);
  }
  function requireExactRecoveryPull(plan, lease = plan.evidence.lease) {
    const pull = readPull(lease, plan);
    return assertExactTerminalHandoffPullRequest({ pull, plan,
      authority: lease.cloudAuthority });
  }
  function captureEvidence() {
    const record = assertRegisteredWorktree({ cwd: repository,
      porcelain: git(["worktree", "list", "--porcelain", "-z"]) });
    if (realpathSync(record.path) !== repository || record.branch !== `refs/heads/${branch}`) {
      throw new Error("Recovery branch does not own the registered worktree.");
    }
    const lease = readLease();
    if (lease.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
      || lease.admission?.status !== "admitted" || lease.cloudAuthority?.state !== "active"
      || lease.worktreePath !== repository) {
      throw new Error("Recovery requires one admitted locally active source lease.");
    }
    const sourceTaskAuthority = assertTaskAuthorityBinding({
      binding: lease.taskAuthority,
      lease,
    });
    const headSha = sha(git(["rev-parse", "HEAD"]), "source HEAD");
    if (headSha !== lease.fenceSha) throw new Error("Source HEAD differs from its lease fence.");
    originRepositoryIdentity(lease);
    const pull = readPull(lease);
    const repositoryIdentity = pull[REPOSITORY_IDENTITY];
    const marker = parseWriterLeasePullRequestBody(pull.body);
    const expectedMarker = projectWriterLeasePullRequestMarker(lease);
    if (!marker || digestValue(marker) !== digestValue(expectedMarker)
      || pull.headRefOid !== headSha || pull.state !== "OPEN" || !pull.isDraft) {
      throw new Error("Source PR, marker, draft state, and HEAD do not join exactly.");
    }
    assertTerminalHandoffPullRequestIdentity({ pullRequest: pull,
      cloudAuthority: lease.cloudAuthority });
    const ledger = rawLedger(lease).ledger;
    const sourceClaim = selectTerminalHandoffClaimProof({ entries: ledger.entries, lease });
    assertTerminalHandoffPullRequestIdentity({ pullRequest: pull, sourceClaim,
      cloudAuthority: lease.cloudAuthority });
    assertNoHistoricalTerminalHandoffSuccessor({
      entries: ledger.entries,
      sourceClaimId: sourceClaim.claimId,
    });
    const dirty = assertActiveOwnedDirtWithinWriteSet({
      evidence: captureActiveOwnedDirtEvidence({ repository }),
      declaredWriteSet: lease.admission.declaredWriteSet,
    });
    const cloud = status(lease);
    const liveInventory = assertNoLiveOverlap({ claims: cloud.claims, sourceProof: sourceClaim });
    const capability = projectTaskAuthorityCapability(readSuccessorCapability());
    assertTerminalHandoffSuccessorCapability({
      targetCapability: capability,
      sourceTaskAuthority,
    });
    const core = {
      schema: EVIDENCE_SCHEMA, branch, headSha,
      treeSha: sha(git(["show", "-s", "--format=%T", headSha]), "source tree"),
      lease, leaseDigest: writerLeaseDigest(lease), sourceClaim,
      repositoryIdentity,
      dirt: dirty, dirtEvidenceDigest: dirty.evidenceDigest,
      pullRequest: { id: text(pull.id, "pull-request ID"), url: pull.url,
        number: Number(pull.url.split("/").at(-1)), headSha: pull.headRefOid,
        baseSha: pull.baseRefOid, bodyDigest: digestValue(pull.body || ""),
        bodyRemainderDigest: digestValue(writerLeaseBodyRemainder(pull.body)),
        reviewRequestId: terminalHandoffReviewRequestId(pull),
        repository: repositoryIdentity.pullRequestRepository,
        headRepository: repositoryIdentity.headRepository,
        baseRepository: repositoryIdentity.baseRepository,
        headBranch: repositoryIdentity.headRefName,
        baseBranch: repositoryIdentity.baseRefName,
        isDraft: pull.isDraft, state: pull.state },
      pullRequestMarkerDigest: digestValue(marker), liveInventory,
      targetCapability: capability, targetCapabilityDigest: digestValue(capability),
    };
    return sealTerminalHandoffEvidence({ ...core, evidenceDigest: digestValue(core) });
  }
  function currentTarget(plan, successorValues, authority) {
    const source = plan.evidence.lease;
    const capability = readSuccessorCapability();
    if (digestValue(projectTaskAuthorityCapability(capability)) !== plan.targetCapabilityDigest) {
      throw new Error("Successor task capability changed from the authorized plan.");
    }
    return createTerminalHandoffSuccessorLocalTarget({
      plan,
      sourceLease: source,
      successorValues,
      authority,
      capability,
    });
  }
  function requireBoundReadback(plan, claimed, authority, lease, operationKey) {
    assertTerminalHandoffBoundAuthority({ plan, authority, claimId: claimed.claimId });
    const inventory = status(lease, plan);
    const matches = inventory.claims.filter(claim => claim.claimId === claimed.claimId);
    if (matches.length !== 1) throw new Error("Bound successor has no unique live readback.");
    const claim = assertExactSuccessorClaim({ claim: matches[0], plan,
      reviewRequestId: terminalHandoffReviewRequestId(plan.evidence.pullRequest), claimed });
    if (authority.claimDigest !== claim.fenceRevision
      || authority.transitionCounter !== claim.transitionCounter
      || authority.claimLedgerRevision !== claim.transitionDigest
      || authority.operationReceiptDigest !== claim.operationReceiptDigest
      || authority.expiresAt !== claim.expiresAt) {
      throw new Error("Bound authority does not match its authenticated live claim.");
    }
    assertTerminalHandoffAuthenticatedOperation({
      action: "continue",
      snapshot: rawLedger(lease, plan),
      inventory,
      claim,
      operationKey,
    });
    return claim;
  }
  function requireExactLocalProjection(plan, intent, expected = null, observedLease = undefined) {
    const claimed = intent?.receipts?.["successor-claimed"]?.values;
    const authority = intent?.receipts?.["successor-bound"]?.values?.authority;
    const local = intent?.receipts?.["local-cas"]?.values;
    if (!claimed || !authority || !local) {
      throw new Error("Local projection requires sealed claim, bind, and CAS receipts.");
    }
    const target = expected || currentTarget(plan, claimed, authority);
    const targetLeaseDigest = writerLeaseDigest(target.lease);
    const cloudAuthorityDigest = digestValue(target.lease.cloudAuthority);
    if (local.targetLeaseDigest !== targetLeaseDigest
      || local.targetBindingDigest !== target.binding.bindingDigest
      || local.cloudAuthorityDigest !== cloudAuthorityDigest
      || !DIGEST_PATTERN.test(String(local.proofDigest || ""))) {
      throw new Error("Local-CAS receipt does not seal the exact reconstructed target lease.");
    }
    const lease = observedLease === undefined ? readLease() : observedLease;
    if (writerLeaseDigest(lease) !== targetLeaseDigest
      || lease.taskAuthority?.bindingDigest !== target.binding.bindingDigest
      || digestValue(lease.cloudAuthority) !== cloudAuthorityDigest
      || lease.cloudAuthority?.claimId !== claimed.claimId
      || lease.sessionId !== plan.operatorSessionId) {
      throw new Error("Current registry lease differs from the sealed local-CAS projection.");
    }
    return Object.freeze({ claimed, authority, local, target, lease });
  }
  const adapter = {
    captureEvidence,
    readIntent: () => {
      activeFence?.acquire();
      return readJournal(state.journal);
    },
    writeIntent: ({ expected, value }) => {
      if (!activeFence) throw new Error("Recovery journal write requires its execution fence.");
      activeFence.acquire();
      return writeJournal(state.journal, expected, value);
    },
    withFence: withRecoveryFence,
    snapshot({ plan }) {
      requireCurrent(plan);
      requireExactRecoveryPull(plan);
      const result = createActiveOwnedDirtSnapshot({ repository, evidence: plan.evidence.dirt,
        claimId: plan.sourceClaimId, planDigest: plan.planDigest,
        timestamp: plan.evidence.sourceClaim.retiredAt });
      return receipt("snapshot", { snapshotRef: result.snapshotRef,
        snapshotCommitSha: result.commitSha, snapshotReceiptDigest: result.snapshotReceiptDigest });
    },
    claimSuccessor({ plan, operationKey }) {
      requireCurrent(plan);
      const source = plan.evidence.sourceClaim;
      const lease = plan.evidence.lease;
      const idempotencyKey = text(operationKey, "successor claim operation key");
      requireExactRecoveryPull(plan, lease);
      const result = cloudInvoke(lease, plan,
        { action: "claim", ledgerRepository: lease.cloudAuthority.ledgerRepository,
        request: { targetRepository: lease.cloudAuthority.targetRepository,
          workItemId: source.workItemId, canonicalBaseSha: source.canonicalBaseRevision,
          headSha: source.laneRevision, declaredWriteSet: source.declaredWriteScope,
          predecessorClaimId: source.claimId, leaseEpoch: plan.targetLeaseEpoch,
          ttlSeconds: plan.ttlSeconds, deviceId: lease.device,
          sessionId: plan.operatorSessionId,
          idempotencyKey }, environment });
      const claim = assertTerminalHandoffSuccessorClaimResult({ result, plan, idempotencyKey });
      return receipt("claim", { claimId: claim.claimId,
        claimDigest: claim.fenceRevision,
        transitionCounter: claim.transitionCounter, ledgerRevision: result.ledgerRevision,
        claimLedgerRevision: claim.transitionDigest, expiresAt: claim.expiresAt,
        evaluationTime: result.operationReceipt?.evaluationTime,
        operationReceiptDigest: result.operationReceipt?.receiptDigest,
        providerReceiptDigest: result.receipt?.receiptDigest,
        receiptDigest: result.receipt?.receiptDigest });
    },
    bindSuccessor({ plan, intent, operationKey }) {
      const claimed = intent.receipts["successor-claimed"].values;
      const lease = plan.evidence.lease, manifest = lease.admission;
      const bindOperationKey = text(operationKey, "successor bind operation key");
      requireExactRecoveryPull(plan, lease);
      const inventory = status(lease, plan);
      const matches = inventory.claims.filter(item => item.claimId === claimed.claimId);
      if (matches.length !== 1) throw new Error("Epoch-2 successor is no longer unique.");
      const observed = matches[0];
      const reviewRequestId = terminalHandoffReviewRequestId(plan.evidence.pullRequest);
      if (![null, reviewRequestId].includes(observed.reviewRequestId)) {
        throw new Error("Epoch-2 successor is bound to a foreign review request.");
      }
      assertExactSuccessorClaim({ claim: observed, plan,
        reviewRequestId: observed.reviewRequestId, claimed });
      if (observed.reviewRequestId === null
        && (observed.fenceRevision !== claimed.claimDigest
          || observed.transitionCounter !== claimed.transitionCounter)) {
        throw new Error("Epoch-2 successor changed before active binding.");
      }
      if (observed.reviewRequestId === reviewRequestId
        && (observed.fenceRevision === claimed.claimDigest
          || observed.transitionCounter !== claimed.transitionCounter + 1)) {
        throw new Error("Epoch-2 successor has no exact bound transition.");
      }
      const seed = normalizeBoundAuthority({
        result: { schema: "agentic-cloud-collaboration-result/v1", ok: true, action: "claim",
          ledgerRevision: inventory.ledgerRevision, ledgerDigest: inventory.ledgerDigest,
          claimDigest: observed.fenceRevision, claim: observed },
        authority: { ...lease.cloudAuthority, deviceId: lease.device,
          sessionId: plan.operatorSessionId, leaseEpoch: plan.targetLeaseEpoch,
          reviewRequestId: null, state: "active" }, manifest,
        deviceId: lease.device, sessionId: plan.operatorSessionId,
      });
      if (observed.reviewRequestId === reviewRequestId) {
        const verification = verifyAdmissionCloudAuthority({ authority: seed, manifest,
          canonicalBaseSha: seed.canonicalBaseSha, environment,
          inspect: guardedCloudInvoke(lease, plan),
          invoke: guardedCloudInvoke(lease, plan, verify || invoke) });
        requireBoundReadback(plan, claimed, verification.authority, lease, bindOperationKey);
        return receipt("bind", { authority: verification.authority,
          verificationDigest: verification.receiptDigest,
          receiptDigest: verification.receiptDigest });
      }
      const bound = bindAdmissionCloudAuthority({ authority: seed, manifest, branch,
        headSha: plan.evidence.headSha,
        pullRequestNumber: plan.evidence.pullRequest.number,
        reviewRequestId,
        deviceId: lease.device, sessionId: plan.operatorSessionId,
        idempotencyKey: bindOperationKey,
        returnVerification: true, environment,
        invoke: guardedCloudInvoke(lease, plan),
        inspect: guardedCloudInvoke(lease, plan),
        ...(verify ? { verify: guardedCloudInvoke(lease, plan, verify) } : {}) });
      requireBoundReadback(plan, claimed, bound.authority, lease, bindOperationKey);
      return receipt("bind", { authority: bound.authority,
        verificationDigest: bound.verification.receiptDigest,
        receiptDigest: bound.verification.receiptDigest });
    },
    projectLocal({ plan, intent }) {
      requireExactRecoveryPull(plan);
      requireSameActiveOwnedDirtEvidence(plan.evidence.dirt,
        captureActiveOwnedDirtEvidence({ repository }));
      const target = currentTarget(plan, intent.receipts["successor-claimed"].values,
        intent.receipts["successor-bound"].values.authority);
      const result = mutateWriterLeaseRegistry({ leaseStore: store, branch,
        expectedLeaseDigest: plan.sourceLeaseDigest, expectedClaimId: plan.sourceClaimId,
        action: ({ registry, lease }) => {
          if (writerLeaseDigest(lease) !== plan.sourceLeaseDigest) throw new Error("Source lease changed before CAS.");
          return { registry: { ...registry, leases: { ...registry.leases, [branch]: target.lease } },
            lease: target.lease, changed: true };
        } });
      return receipt("local-cas", { targetLeaseDigest: writerLeaseDigest(result.lease),
        targetBindingDigest: target.binding.bindingDigest, proofDigest: target.proofDigest,
        cloudAuthorityDigest: digestValue(target.lease.cloudAuthority) });
    },
    projectPullRequest({ plan, intent }) {
      if (typeof store.withRegistryLock !== "function") {
        throw new Error("PR marker projection requires the writer registry lock.");
      }
      return store.withRegistryLock(registry => {
        const projection = requireExactLocalProjection(plan, intent, null,
          registry?.leases?.[branch] || null);
        const expectedLease = projection.target.lease;
        const pull = readPull(expectedLease, plan);
        assertExactTerminalHandoffPullRequest({ pull, plan,
          authority: expectedLease.cloudAuthority });
        requireExactLocalProjection(plan, intent, projection.target);
        const expected = projectWriterLeasePullRequestMarker(expectedLease);
        let marker = parseWriterLeasePullRequestBody(pull.body);
        if (digestValue(marker) !== digestValue(expected)) {
          const editingPull = readPull(expectedLease, plan);
          assertExactTerminalHandoffPullRequest({ pull: editingPull, plan,
            authority: expectedLease.cloudAuthority });
          requireExactLocalProjection(plan, intent, projection.target);
          marker = parseWriterLeasePullRequestBody(editingPull.body);
          if (digestValue(marker) !== digestValue(expected)) {
            originRepositoryIdentity(expectedLease, plan);
            gh(["pr", "edit", editingPull.url, "--body",
              updateWriterLeasePullRequestBody(editingPull.body, expectedLease)]);
            requireExactLocalProjection(plan, intent, projection.target);
            const projected = readPull(expectedLease, plan);
            assertExactTerminalHandoffPullRequest({ pull: projected, plan,
              authority: expectedLease.cloudAuthority });
            requireExactLocalProjection(plan, intent, projection.target);
            marker = parseWriterLeasePullRequestBody(projected.body);
          }
        }
        if (digestValue(marker) !== digestValue(expected)) {
          throw new Error("PR marker did not converge.");
        }
        requireExactLocalProjection(plan, intent, projection.target);
        return receipt("pr-marker", { markerDigest: digestValue(marker),
          leaseDigest: writerLeaseDigest(expectedLease) });
      });
    },
    verifyTerminal({ plan, intent }) {
      const projection = requireExactLocalProjection(plan, intent);
      const { claimed, target: expected } = projection;
      const lease = expected.lease;
      requireSameActiveOwnedDirtEvidence(plan.evidence.dirt,
        captureActiveOwnedDirtEvidence({ repository }));
      requireExactRecoveryPull(plan, lease);
      verifyAdmissionCloudAuthority({ authority: lease.cloudAuthority, manifest: lease.admission,
        canonicalBaseSha: lease.cloudAuthority.canonicalBaseSha, environment,
        inspect: guardedCloudInvoke(lease, plan),
        invoke: guardedCloudInvoke(lease, plan, verify || invoke) });
      requireBoundReadback(plan, claimed, lease.cloudAuthority, lease,
        intent.receipts?.["successor-bound"]?.operationKey);
      const pull = readPull(lease, plan), marker = parseWriterLeasePullRequestBody(pull.body);
      assertExactTerminalHandoffPullRequest({ pull, plan, authority: lease.cloudAuthority });
      if (digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(expected.lease))) {
        throw new Error("Terminal PR projection is invalid.");
      }
      requireExactLocalProjection(plan, intent, expected);
      const mutationCore = { schema: "agentic-terminal-handoff-mutation-authority/v1",
        status: "ready", planDigest: plan.planDigest, successorClaimId: lease.cloudAuthority.claimId,
        leaseDigest: writerLeaseDigest(lease), taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
        taskAuthorityProofDigest: expected.proofDigest,
        dirtEvidenceDigest: plan.evidence.dirtEvidenceDigest,
        sourceBytesChanged: false };
      return receipt("terminal", { leaseDigest: writerLeaseDigest(lease),
        cloudAuthorityDigest: digestValue(lease.cloudAuthority), markerDigest: digestValue(marker),
        dirtEvidenceDigest: plan.evidence.dirtEvidenceDigest,
        taskAuthorityProofDigest: expected.proofDigest,
        mutationAuthorityReceiptDigest: digestValue(mutationCore) });
    },
    reconcile({ plan, intent, phase: name, operationKey }) {
      try {
        if (name === "snapshotted") return null;
        originRepositoryIdentity(plan.evidence.lease, plan);
        if (name === "successor-claimed") {
          const lease = plan.evidence.lease;
          const inventory = status(lease, plan);
          const matches = inventory.claims.filter(
            item => item.predecessorClaimId === plan.sourceClaimId);
          if (matches.length !== 1) return null;
          const claim = matches[0];
          assertExactSuccessorClaim({ claim, plan, reviewRequestId: null });
          const snapshot = rawLedger(lease, plan);
          const claimEntry = assertTerminalHandoffAuthenticatedOperation({
            action: "claim", snapshot, inventory, claim, operationKey,
          });
          const operation = operationReceiptForEntry(claimEntry);
          const provenance = { schema: "agentic-terminal-handoff-claim-readback/v1",
            ledgerRevision: snapshot.ledgerRevision,
            ledgerDigest: snapshot.ledger.headDigest,
            ledgerSequence: snapshot.ledger.sequence,
            claimId: claim.claimId,
            claimDigest: claim.fenceRevision,
            transitionDigest: claim.transitionDigest,
            operationReceiptDigest: operation.receiptDigest };
          return receipt("claim", { claimId: claim.claimId, claimDigest: claim.fenceRevision,
            transitionCounter: claim.transitionCounter, ledgerRevision: inventory.ledgerRevision,
            claimLedgerRevision: claim.transitionDigest, expiresAt: claim.expiresAt,
            evaluationTime: claimEntry.evaluationTime,
            operationReceiptDigest: claim.operationReceiptDigest,
            authenticatedReadbackDigest: digestValue(provenance) });
        }
        if (name === "successor-bound") {
          const claimed = intent.receipts["successor-claimed"]?.values;
          if (!claimed) return null;
          const lease = plan.evidence.lease, manifest = lease.admission;
          const inventory = status(lease, plan);
          const matches = inventory.claims.filter(item => item.claimId === claimed.claimId);
          if (matches.length !== 1) return null;
          const claim = assertExactSuccessorClaim({ claim: matches[0], plan,
            reviewRequestId: terminalHandoffReviewRequestId(plan.evidence.pullRequest), claimed });
          assertTerminalHandoffAuthenticatedOperation({
            action: "continue",
            snapshot: rawLedger(lease, plan),
            inventory,
            claim,
            operationKey,
          });
          const seed = normalizeBoundAuthority({
            result: { schema: "agentic-cloud-collaboration-result/v1", ok: true,
              action: "claim", ledgerRevision: inventory.ledgerRevision,
              ledgerDigest: inventory.ledgerDigest,
              claimDigest: claim.fenceRevision, claim },
            authority: { ...lease.cloudAuthority, deviceId: lease.device,
              sessionId: plan.operatorSessionId, leaseEpoch: plan.targetLeaseEpoch,
              reviewRequestId: claim.reviewRequestId, state: "active" },
            manifest,
            deviceId: lease.device,
            sessionId: plan.operatorSessionId,
          });
          const verification = verifyAdmissionCloudAuthority({ authority: seed, manifest,
            canonicalBaseSha: seed.canonicalBaseSha, environment,
            inspect: guardedCloudInvoke(lease, plan),
            invoke: guardedCloudInvoke(lease, plan, verify || invoke) });
          requireBoundReadback(plan, claimed, verification.authority, lease, operationKey);
          return receipt("bind", { authority: verification.authority,
            verificationDigest: verification.receiptDigest,
            receiptDigest: verification.receiptDigest });
        }
        if (name === "local-cas") {
          const lease = readLease();
          const claimed = intent.receipts["successor-claimed"]?.values;
          const authority = intent.receipts["successor-bound"]?.values.authority;
          if (!claimed || !authority) return null;
          const expected = currentTarget(plan, claimed, authority);
          if (writerLeaseDigest(lease) !== writerLeaseDigest(expected.lease)
            || lease.cloudAuthority?.claimId !== claimed.claimId
            || lease.taskAuthority?.bindingDigest !== expected.binding.bindingDigest
            || lease.sessionId !== plan.operatorSessionId) return null;
          return receipt("local-cas", { targetLeaseDigest: writerLeaseDigest(lease),
            targetBindingDigest: lease.taskAuthority.bindingDigest,
            proofDigest: expected.proofDigest,
            cloudAuthorityDigest: digestValue(lease.cloudAuthority) });
        }
        if (name === "pr-marker") {
          const projection = requireExactLocalProjection(plan, intent);
          const expectedLease = projection.target.lease;
          const pull = readPull(expectedLease, plan);
          assertExactTerminalHandoffPullRequest({ pull, plan,
            authority: expectedLease.cloudAuthority });
          requireExactLocalProjection(plan, intent, projection.target);
          const marker = parseWriterLeasePullRequestBody(pull.body);
          if (digestValue(marker)
            !== digestValue(projectWriterLeasePullRequestMarker(expectedLease))) return null;
          return receipt("pr-marker", { markerDigest: digestValue(marker),
            leaseDigest: writerLeaseDigest(expectedLease) });
        }
        if (name === "verified") return adapter.verifyTerminal({ plan, intent });
      } catch { return null; }
      return null;
    },
  };
  return Object.freeze(adapter);

  function requireCurrent(plan) {
    const current = captureEvidence();
    if (current.evidenceDigest !== plan.evidenceDigest) throw new Error("Recovery source drifted from its plan.");
  }
}

export function assertTerminalHandoffCloudStatusSnapshot({
  result,
  snapshot,
  sourceClaimId,
} = {}) {
  if (result?.schema !== "agentic-cloud-collaboration-result/v1"
    || result.ok !== true || result.action !== "status" || result.status !== "ready"
    || !SHA_PATTERN.test(String(result.ledgerRevision || ""))
    || !DIGEST_PATTERN.test(String(result.ledgerDigest || ""))
    || !Number.isSafeInteger(result.sequence) || result.sequence < 1
    || !Array.isArray(result.claims) || result.claims.length > 128) {
    throw new Error("Cloud status did not return a complete claim inventory.");
  }
  const ledger = snapshot?.ledger;
  const failures = validateLedger(ledger);
  if (failures.length
    || !SHA_PATTERN.test(String(snapshot?.ledgerRevision || ""))
    || snapshot.ledgerRevision !== result.ledgerRevision
    || ledger.headDigest !== result.ledgerDigest
    || ledger.sequence !== result.sequence) {
    throw new Error("Cloud status does not match the authenticated ledger head.");
  }
  const source = digest(sourceClaimId, "source claim ID");
  const lineage = ledger.entries.filter(entry => entry.claimId === source);
  const repositoryId = lineage[0]?.repositoryId;
  if (!repositoryId) throw new Error("Cloud status source has no authenticated repository identity.");
  const expectedClaimIds = listCurrentClaims(ledger, new Date().toISOString(), { repositoryId })
    .map(claim => claim.claimId).sort();
  const observedClaimIds = result.claims.map(claim => authenticatedPublicClaim({
    claim, ledger, repositoryId,
  }).claimId).sort();
  if (new Set(observedClaimIds).size !== observedClaimIds.length
    || canonicalJson(observedClaimIds) !== canonicalJson(expectedClaimIds)) {
    throw new Error("Cloud status is not the complete authenticated repository inventory.");
  }
  return result;
}

function authenticatedPublicClaim({ claim, ledger, repositoryId }) {
  if (!claim || typeof claim !== "object" || Array.isArray(claim)
    || !DIGEST_PATTERN.test(String(claim.claimId || ""))
    || claim.repositoryId !== repositoryId
    || !Array.isArray(claim.declaredWriteScope)
    || canonicalJson(normalizeWriteSet(claim.declaredWriteScope))
      !== canonicalJson(claim.declaredWriteScope)) {
    throw new Error("Cloud status contains a malformed public claim.");
  }
  const history = ledger.entries.filter(entry => entry.claimId === claim.claimId);
  const latest = history.at(-1);
  const identity = history.find(entry => entry.action === "claim");
  const core = latest?.claimCore;
  const recordedState = projectedClaimState(core?.state);
  const admissibleStates = new Set([recordedState,
    ...(["current", "reviewed", "integrated-preserved"].includes(recordedState)
      ? ["dormant-preserved"] : [])]);
  const writeAuthority = claim.state === "current";
  const scopeReserved = ["current", "reviewed", "integrated-preserved",
    "dormant-preserved"].includes(claim.state);
  const integrationEntry = history.findLast(entry => entry.action === "integrate");
  const integrationReceiptDigest = integrationEntry
    ? operationReceiptForEntry(integrationEntry).receiptDigest : null;
  const fields = ["actorId", "deviceId", "sessionId", "repositoryId", "workItemId",
    "canonicalBaseRevision", "laneRevision", "writeSetDigest", "leaseEpoch",
    "transitionCounter", "heartbeatCounter", "reviewRequestId", "predecessorClaimId",
    "expiresAt"];
  if (!latest || !identity || !core || fields.some(field => claim[field] !== core[field])
    || claim.entrySchema !== latest.schema || claim.claimIdentitySchema !== identity.schema
    || !admissibleStates.has(claim.state)
    || claim.writeAuthority !== writeAuthority || claim.scopeReserved !== scopeReserved
    || claim.fenceRevision !== latest.claimDigest || claim.transitionDigest !== latest.digest
    || canonicalJson(claim.declaredWriteScope)
      !== canonicalJson(normalizeWriteSet(core.declaredWriteScope))
    || canonicalJson(claim.integration) !== canonicalJson(core.integration ?? null)
    || canonicalJson(claim.recovery) !== canonicalJson(core.recovery ?? null)
    || claim.integrationReceiptDigest !== integrationReceiptDigest
    || claim.operationReceiptDigest !== operationReceiptForEntry(latest).receiptDigest
    || !DIGEST_PATTERN.test(String(claim.fenceRevision || ""))
    || !DIGEST_PATTERN.test(String(claim.transitionDigest || ""))
    || !DIGEST_PATTERN.test(String(claim.operationReceiptDigest || ""))
    || !SHA_PATTERN.test(String(claim.canonicalBaseRevision || ""))
    || !SHA_PATTERN.test(String(claim.laneRevision || ""))
    || !Number.isSafeInteger(claim.leaseEpoch) || claim.leaseEpoch < 1
    || !Number.isSafeInteger(claim.transitionCounter) || claim.transitionCounter < 1
    || !Number.isFinite(Date.parse(claim.expiresAt))) {
    throw new Error("Cloud status claim does not match its authenticated ledger entry.");
  }
  return claim;
}

export function assertTerminalHandoffSuccessorClaimResult({ result, plan, idempotencyKey }) {
  if (result?.schema !== "agentic-cloud-collaboration-result/v1"
    || result.ok !== true || result.action !== "claim" || result.status !== "current"
    || ![true, false].includes(result.replayed)
    || !SHA_PATTERN.test(String(result.ledgerRevision || ""))) {
    throw new Error("Cloud did not return an exact current successor result.");
  }
  const claim = assertExactSuccessorClaim({ claim: result.claim, plan, reviewRequestId: null });
  const operation = result.operationReceipt;
  const operationCore = operation && { ...operation };
  const operationDigest = operationCore?.receiptDigest;
  if (operationCore) delete operationCore.receiptDigest;
  const provider = result.receipt;
  const providerCore = provider && { ...provider };
  const providerDigest = providerCore?.receiptDigest;
  if (providerCore) delete providerCore.receiptDigest;
  if (result.claimDigest !== claim.fenceRevision
    || operation?.schema !== "agentic-collaboration-claim-receipt/v1"
    || operation.operation !== "claim" || operation.status !== "current"
    || operation.repositoryId !== claim.repositoryId
    || operation.claimId !== claim.claimId || operation.claimDigest !== claim.fenceRevision
    || operation.fenceRevision !== claim.fenceRevision
    || operation.ledgerRevision !== claim.transitionDigest
    || operation.idempotencyKey !== digestValue(idempotencyKey)
    || !DIGEST_PATTERN.test(String(operation.requestDigest || ""))
    || !Number.isSafeInteger(operation.ledgerSequence) || operation.ledgerSequence < 1
    || !Number.isFinite(Date.parse(operation.evaluationTime))
    || operationDigest !== digestValue(operationCore)
    || claim.operationReceiptDigest !== operationDigest
    || provider?.schema !== "agentic-cloud-collaboration-github-receipt/v1"
    || provider.action !== "claim" || provider.ledgerRevision !== result.ledgerRevision
    || !DIGEST_PATTERN.test(String(provider.ledgerDigest || ""))
    || provider.claimId !== claim.claimId || provider.claimDigest !== claim.fenceRevision
    || provider.contractReceiptDigest !== operationDigest
    || !Number.isSafeInteger(provider.sequence)
    || provider.sequence < operation.ledgerSequence
    || provider.evaluationTime !== operation.evaluationTime
    || providerDigest !== digestValue(providerCore)) {
    throw new Error("Cloud successor receipts do not prove the sealed claim mutation.");
  }
  if (Date.parse(claim.expiresAt)
    !== Date.parse(operation.evaluationTime) + plan.ttlSeconds * 1_000) {
    throw new Error("Cloud successor expiry changed from the authorized TTL.");
  }
  return claim;
}

function assertExactSuccessorClaim({ claim, plan, reviewRequestId, claimed = null }) {
  const source = plan?.evidence?.sourceClaim;
  const lease = plan?.evidence?.lease;
  const expectedReview = reviewRequestId === null
    ? null : terminalHandoffReviewRequestId(plan?.evidence?.pullRequest);
  if (reviewRequestId !== expectedReview
    || !claim || claim.state !== "current" || claim.writeAuthority !== true
    || claim.scopeReserved !== true || claim.claimId === source?.claimId
    || !DIGEST_PATTERN.test(String(claim.claimId || ""))
    || claim.entrySchema !== ENTRY_SCHEMA || claim.claimIdentitySchema !== ENTRY_SCHEMA
    || claim.actorId !== source?.actorId || claim.repositoryId !== source?.repositoryId
    || claim.workItemId !== source?.workItemId
    || claim.canonicalBaseRevision !== source?.canonicalBaseRevision
    || claim.laneRevision !== source?.laneRevision
    || canonicalJson(normalizeWriteSet(claim.declaredWriteScope || []))
      !== canonicalJson(source?.declaredWriteScope)
    || claim.writeSetDigest !== source?.writeSetDigest
    || claim.predecessorClaimId !== source?.claimId
    || claim.leaseEpoch !== plan?.targetLeaseEpoch
    || claim.deviceId !== lease?.device || claim.sessionId !== plan?.operatorSessionId
    || claim.reviewRequestId !== expectedReview
    || claim.transitionCounter !== (expectedReview === null ? 1 : 2)
    || claim.heartbeatCounter !== 0
    || claim.integration !== null || claim.integrationReceiptDigest !== null
    || claim.recovery !== null
    || !DIGEST_PATTERN.test(String(claim.fenceRevision || ""))
    || !DIGEST_PATTERN.test(String(claim.transitionDigest || ""))
    || !DIGEST_PATTERN.test(String(claim.operationReceiptDigest || ""))
    || !Number.isFinite(Date.parse(claim.expiresAt))) {
    throw new Error("Cloud successor changed a sealed identity or authority field.");
  }
  if (claimed && (claim.claimId !== claimed.claimId || claim.expiresAt !== claimed.expiresAt)) {
    throw new Error("Bound cloud successor differs from its claimed identity.");
  }
  return claim;
}

function assertTerminalHandoffBoundAuthority({ plan, authority, claimId }) {
  const sourceAuthority = plan?.evidence?.lease?.cloudAuthority;
  assertTerminalHandoffPullRequestIdentity({ pullRequest: plan?.evidence?.pullRequest,
    sourceClaim: plan?.evidence?.sourceClaim, cloudAuthority: authority });
  if (authority?.state !== "active" || authority.claimId !== claimId
    || authority.ledgerRepository !== sourceAuthority?.ledgerRepository
    || authority.targetRepository !== sourceAuthority?.targetRepository
    || authority.canonicalBaseSha !== plan?.evidence?.sourceClaim?.canonicalBaseRevision
    || authority.laneRevision !== plan?.evidence?.headSha
    || authority.writeSetDigest !== plan?.evidence?.sourceClaim?.writeSetDigest
    || canonicalJson(normalizeWriteSet(authority.cloudDeclaredWriteScope || []))
      !== canonicalJson(plan?.evidence?.sourceClaim?.declaredWriteScope)
    || authority.deviceId !== plan?.evidence?.lease?.device
    || authority.sessionId !== plan?.operatorSessionId
    || authority.leaseEpoch !== plan?.targetLeaseEpoch
    || !DIGEST_PATTERN.test(String(authority.claimDigest || ""))
    || !DIGEST_PATTERN.test(String(authority.claimLedgerRevision || ""))
    || !DIGEST_PATTERN.test(String(authority.operationReceiptDigest || ""))
    || !Number.isSafeInteger(authority.transitionCounter)
    || authority.transitionCounter !== 2
    || !Number.isFinite(Date.parse(authority.expiresAt))) {
    throw new Error("Bound cloud authority does not join the exact successor plan.");
  }
  return authority;
}

function operationReceiptForEntry(entry) {
  const legacy = entry.schema === LEGACY_ENTRY_SCHEMA;
  const status = projectedClaimState(entry.claimCore?.state);
  const core = legacy ? {
    schema: RECEIPT_SCHEMA,
    action: entry.action,
    repositoryId: entry.repositoryId,
    claimId: entry.claimId,
    claimDigest: entry.claimDigest,
    fenceRevision: entry.claimDigest,
    ledgerRevision: entry.digest,
    ledgerSequence: entry.sequence,
    idempotencyKey: entry.idempotencyKey,
    requestDigest: entry.requestDigest,
    evaluationTime: entry.evaluationTime,
  } : {
    schema: ({ claim: "agentic-collaboration-claim-receipt/v1",
      continue: "agentic-collaboration-continuation-receipt/v1",
      integrate: "agentic-collaboration-integration-receipt/v1",
      retire: "agentic-collaboration-retirement-receipt/v1" })[entry.action],
    operation: entry.action,
    status,
    repositoryId: entry.repositoryId,
    claimId: entry.claimId,
    claimDigest: entry.claimDigest,
    fenceRevision: entry.claimDigest,
    ledgerRevision: entry.digest,
    ledgerSequence: entry.sequence,
    idempotencyKey: entry.idempotencyKey,
    requestDigest: entry.requestDigest,
    evaluationTime: entry.evaluationTime,
  };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

function projectedClaimState(value) {
  if (value === "active") return "current";
  if (["review-ready", "delivery-authorized"].includes(value)) return "reviewed";
  if (["parked", "expired"].includes(value)) return "dormant-preserved";
  if (value === "released") return "retired";
  return value;
}

export function assertNoHistoricalTerminalHandoffSuccessor({ entries, sourceClaimId } = {}) {
  const source = digest(sourceClaimId, "source claim ID");
  if (!Array.isArray(entries)) throw new Error("Validated collaboration ledger entries are required.");
  const successors = entries.filter(entry => entry?.action === "claim"
    && entry.claimCore?.predecessorClaimId === source);
  if (successors.length) {
    throw new Error("Terminal source already has a historical successor claim.");
  }
  return Object.freeze({ sourceClaimId: source, historicalSuccessorClaimIds: [] });
}

export function assertTerminalHandoffPullRequestIdentity({
  pullRequest,
  sourceClaim = null,
  cloudAuthority = null,
} = {}) {
  const reviewRequestId = terminalHandoffReviewRequestId(pullRequest);
  if ((sourceClaim && sourceClaim.reviewRequestId !== reviewRequestId)
    || (cloudAuthority && cloudAuthority.reviewRequestId !== reviewRequestId)) {
    throw new Error("Terminal handoff cloud authority does not match the GitHub PR node identity.");
  }
  return reviewRequestId;
}

export function assertTerminalHandoffRepositoryIdentity({
  targetRepository,
  originFetchUrl,
  originPushUrl = originFetchUrl,
  pullRequest,
  branch,
} = {}) {
  const origin = assertTerminalHandoffOriginRepositoryIdentity({
    targetRepository,
    originFetchUrl,
    originPushUrl,
  });
  if (!pullRequest || typeof pullRequest !== "object" || Array.isArray(pullRequest)) {
    throw new Error("Pull-request repository identity is required.");
  }
  const pullRequestUrl = exactText(pullRequest.url, "pull-request URL");
  const pullRequestRepository = githubRepositoryFromPullRequestUrl(pullRequestUrl);
  const headRepository = githubRepositoryValue(
    pullRequest.headRepository,
    "pull-request head repository",
  );
  const baseRepository = pullRequest.baseRepository == null
    ? pullRequestRepository
    : githubRepositoryValue(pullRequest.baseRepository, "pull-request base repository");
  const headRefName = exactText(pullRequest.headRefName, "pull-request head branch");
  const baseRefName = exactText(pullRequest.baseRefName, "pull-request base branch");
  const expectedBranch = exactText(branch, "source branch");
  if (pullRequestRepository !== origin.targetRepository
    || headRepository !== origin.targetRepository
    || baseRepository !== origin.targetRepository
    || headRefName !== expectedBranch
    || baseRefName !== "main") {
    throw new Error("Target origin and pull-request repository identity do not join exactly.");
  }
  const core = {
    schema: "agentic-terminal-handoff-repository-identity-witness/v1",
    targetRepository: origin.targetRepository,
    originFetchUrl: origin.originFetchUrl,
    originFetchRepository: origin.originFetchRepository,
    originPushUrl: origin.originPushUrl,
    originPushRepository: origin.originPushRepository,
    pullRequestUrl,
    pullRequestRepository,
    headRepository,
    baseRepository,
    headRefName,
    baseRefName,
  };
  return Object.freeze({ ...core, identityDigest: digestValue(core) });
}

export function assertTerminalHandoffAuthenticatedOperation({
  action,
  snapshot,
  inventory,
  claim,
  operationKey,
} = {}) {
  if (!["claim", "continue"].includes(action)) {
    throw new Error("Authenticated recovery operation must be claim or continue.");
  }
  const ledger = snapshot?.ledger;
  const failures = validateLedger(ledger);
  if (failures.length
    || snapshot?.ledgerRevision !== inventory?.ledgerRevision
    || ledger.headDigest !== inventory?.ledgerDigest
    || ledger.sequence !== inventory?.sequence) {
    throw new Error("Recovery operation is not joined to the authenticated ledger head.");
  }
  const claimId = digest(claim?.claimId, "successor claim ID");
  const history = ledger.entries.filter(entry => entry.claimId === claimId);
  const latest = history.at(-1);
  const operationEntries = history.filter(entry => entry.action === action);
  if (!latest || latest !== operationEntries.at(-1)
    || (action === "claim" && operationEntries.length !== 1)
    || latest.digest !== claim.transitionDigest
    || latest.claimDigest !== claim.fenceRevision
    || latest.claimCore?.transitionCounter !== claim.transitionCounter
    || latest.claimCore?.reviewRequestId !== claim.reviewRequestId
    || latest.idempotencyKey !== digestValue(exactText(operationKey, `${action} operation key`))
    || operationReceiptForEntry(latest).receiptDigest !== claim.operationReceiptDigest) {
    throw new Error(`Successor ${action} is not the exact authenticated recovery operation.`);
  }
  return latest;
}

function assertTerminalHandoffOriginRepositoryIdentity({
  targetRepository,
  originFetchUrl,
  originPushUrl,
}) {
  const target = githubRepositoryName(targetRepository, "target repository");
  const fetchUrl = exactText(originFetchUrl, "origin fetch URL");
  const pushUrl = exactText(originPushUrl, "origin push URL");
  const fetchRepository = githubRepositoryFromRemote(fetchUrl);
  const pushRepository = githubRepositoryFromRemote(pushUrl);
  if (fetchRepository !== target || pushRepository !== target) {
    throw new Error("Target repository does not match the origin fetch and push URLs.");
  }
  return Object.freeze({
    targetRepository: target,
    originFetchUrl: fetchUrl,
    originFetchRepository: fetchRepository,
    originPushUrl: pushUrl,
    originPushRepository: pushRepository,
  });
}

function assertSealedTerminalHandoffRepositoryIdentity({ plan, identity }) {
  const sealed = plan?.evidence?.repositoryIdentity;
  const pull = plan?.evidence?.pullRequest;
  const core = sealed && { ...sealed };
  const sealedDigest = core?.identityDigest;
  if (core) delete core.identityDigest;
  if (sealed?.schema !== "agentic-terminal-handoff-repository-identity-witness/v1"
    || sealedDigest !== digestValue(core)
    || githubRepositoryName(plan?.evidence?.lease?.cloudAuthority?.targetRepository,
      "sealed target repository") !== identity.targetRepository
    || pull?.repository !== sealed.pullRequestRepository
    || pull?.headRepository !== sealed.headRepository
    || pull?.baseRepository !== sealed.baseRepository
    || pull?.headBranch !== sealed.headRefName
    || pull?.baseBranch !== sealed.baseRefName) {
    throw new Error("Recovery plan has no exact sealed repository identity.");
  }
  const current = assertTerminalHandoffRepositoryIdentity({
    targetRepository: identity.targetRepository,
    originFetchUrl: identity.originFetchUrl,
    originPushUrl: identity.originPushUrl,
    pullRequest: {
      url: pull.url,
      headRepository: pull.headRepository,
      baseRepository: pull.baseRepository,
      headRefName: pull.headBranch,
      baseRefName: pull.baseBranch,
    },
    branch: plan.evidence.branch,
  });
  if (current.identityDigest !== sealed.identityDigest) {
    throw new Error("Repository identity changed from the authorized recovery plan.");
  }
  return current;
}

function terminalHandoffReviewRequestId(pullRequest) {
  return `github-pull-request:${text(pullRequest?.id, "pull-request node ID")}`;
}

function assertExactTerminalHandoffPullRequest({ pull, plan, authority }) {
  assertTerminalHandoffPullRequestIdentity({ pullRequest: pull,
    sourceClaim: plan?.evidence?.sourceClaim, cloudAuthority: authority });
  const identity = pull?.[REPOSITORY_IDENTITY];
  if (identity?.identityDigest !== plan?.evidence?.repositoryIdentity?.identityDigest
    || pull.id !== plan?.evidence?.pullRequest?.id
    || pull.url !== plan.evidence.pullRequest.url
    || pull.state !== "OPEN" || pull.isDraft !== true
    || pull.headRefName !== plan.evidence.pullRequest.headBranch
    || pull.baseRefName !== plan.evidence.pullRequest.baseBranch
    || identity.pullRequestRepository !== plan.evidence.pullRequest.repository
    || identity.headRepository !== plan.evidence.pullRequest.headRepository
    || identity.baseRepository !== plan.evidence.pullRequest.baseRepository
    || pull.headRefOid !== plan.evidence.headSha
    || pull.baseRefOid !== plan.evidence.pullRequest.baseSha
    || digestValue(writerLeaseBodyRemainder(pull.body))
      !== plan.evidence.pullRequest.bodyRemainderDigest) {
    throw new Error("Pull request changed from the exact authorized recovery subject.");
  }
  return pull;
}

function receipt(kind, values) { const core = { schema: "agentic-terminal-handoff-recovery-effect/v1", kind, ...values };
  return Object.freeze({ ...core, receiptDigest: values.receiptDigest || digestValue(core) }); }
function statePaths(common, branch) { const root = path.join(common, "agentic-canvas-os",
  "terminal-handoff-owned-dirt-successor-recovery");
  const key = digestValue({ branch }); return { journal: path.join(root, `${key}.json`), lock: path.join(root, `${key}.lock`) }; }
function readJournal(file) { if (!existsSync(file)) return null; const envelope = JSON.parse(readFileSync(file, "utf8"));
  if (envelope.schema !== JOURNAL_SCHEMA || envelope.intentDigest !== digestValue(envelope.intent)) throw new Error("Recovery journal is invalid.");
  return normalizeRecoveryIntent(envelope.intent); }
function writeJournal(file, expected, value) { ensureStateDirectory(file); const current = readJournal(file);
  if (digestValue(current) !== digestValue(expected)) throw new Error("Recovery journal changed before CAS.");
  const envelope = { schema: JOURNAL_SCHEMA, intent: value, intentDigest: digestValue(value) };
  const temporary = `${file}.${process.pid}.${process.hrtime.bigint()}.tmp`;
  let descriptor, directoryDescriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(envelope, null, 2)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, file);
    directoryDescriptor = openSync(path.dirname(file), constants.O_RDONLY);
    fsyncSync(directoryDescriptor);
    closeSync(directoryDescriptor);
    directoryDescriptor = null;
  } finally {
    if (descriptor !== undefined && descriptor !== null) closeSync(descriptor);
    if (directoryDescriptor !== undefined && directoryDescriptor !== null) {
      closeSync(directoryDescriptor);
    }
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return value;
}
function ensureStateDirectory(file) {
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()
    || (metadata.mode & 0o077) !== 0
    || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
    throw new Error("Recovery state directory must be owner-only and non-symlink.");
  }
}
function secureExternalCapabilityPath({ repository, common, worktrees, value, label }) {
  const requested = path.resolve(text(value, label));
  const metadata = lstatSync(requested);
  requireSecureCapabilityMetadata(metadata, label);
  const target = realpathSync(requested);
  const roots = [repository, common, ...worktrees.map(record => realpathSync(record.path))];
  if (roots.some(root => pathContains(root, target))) {
    throw new Error(`${label} must be outside every linked worktree and the Git common directory.`);
  }
  return target;
}
function readSecureExternalCapability({ repository, expectedCommon, expectedPath, git }) {
  const validateBoundary = () => {
    const common = realpathSync(path.resolve(repository,
      git(["rev-parse", "--git-common-dir"])));
    if (common !== expectedCommon) throw new Error("Task capability Git common directory changed.");
    const worktrees = parseWorktreeRecords(git(["worktree", "list", "--porcelain", "-z"]));
    const resolved = secureExternalCapabilityPath({ repository, common, worktrees,
      value: expectedPath, label: "task capability" });
    if (resolved !== expectedPath) throw new Error("Task capability canonical path changed.");
    return resolved;
  };
  validateBoundary();
  const descriptor = openSync(expectedPath,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const openedBefore = fstatSync(descriptor);
    const pathBefore = lstatSync(expectedPath);
    requireSecureCapabilityMetadata(openedBefore, "task capability");
    requireSecureCapabilityMetadata(pathBefore, "task capability");
    if (!sameFileIdentity(openedBefore, pathBefore)) {
      throw new Error("Task capability path changed before its stable read.");
    }
    const bytes = readFileSync(descriptor, "utf8");
    const openedAfter = fstatSync(descriptor);
    const pathAfter = lstatSync(expectedPath);
    requireSecureCapabilityMetadata(openedAfter, "task capability");
    requireSecureCapabilityMetadata(pathAfter, "task capability");
    if (!sameFileIdentity(openedBefore, openedAfter)
      || !sameFileIdentity(openedAfter, pathAfter)
      || openedBefore.size !== openedAfter.size
      || openedBefore.mtimeMs !== openedAfter.mtimeMs
      || openedBefore.ctimeMs !== openedAfter.ctimeMs) {
      throw new Error("Task capability changed during its stable read.");
    }
    validateBoundary();
    let source;
    try { source = JSON.parse(bytes); }
    catch (error) { throw new Error(`Could not read task authority capability: ${error.message}`); }
    return Object.freeze(normalizeTaskAuthorityCapability(source));
  } finally {
    closeSync(descriptor);
  }
}
function requireSecureCapabilityMetadata(metadata, label) {
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || (metadata.mode & 0o777) !== 0o600
    || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
    throw new Error(`${label} must be an owner-only single-link regular 0600 file.`);
  }
  return metadata;
}
function sameFileIdentity(left, right) { return left.dev === right.dev && left.ino === right.ino; }
function pathContains(root, target) { const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".."); }
function remoteUrls(value, label) {
  const entries = String(value || "").split(/\r?\n/u).filter(entry => entry.length > 0);
  if (!entries.length || entries.some(entry => entry.trim() !== entry)) {
    throw new Error(`${label} is invalid.`);
  }
  return entries;
}
function githubRepositoryName(value, label) {
  const result = exactText(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) {
    throw new Error(`${label} is invalid.`);
  }
  return result.toLowerCase();
}
function githubRepositoryValue(value, label) {
  return githubRepositoryName(typeof value === "string" ? value : value?.nameWithOwner, label);
}
function githubRepositoryFromRemote(value) {
  const source = exactText(value, "GitHub remote URL");
  const scp = /^git@github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u.exec(source);
  if (scp) return githubRepositoryName(scp[1], "GitHub remote repository");
  let parsed;
  try { parsed = new URL(source); }
  catch { throw new Error("GitHub remote URL is invalid."); }
  if (!new Set(["https:", "ssh:", "git:"]).has(parsed.protocol)
    || parsed.hostname.toLowerCase() !== "github.com"
    || parsed.port || parsed.search || parsed.hash
    || (parsed.protocol === "https:" && (parsed.username || parsed.password))
    || (parsed.protocol === "ssh:" && parsed.username !== "git")
    || (parsed.protocol === "git:" && (parsed.username || parsed.password))) {
    throw new Error("GitHub remote URL is invalid.");
  }
  const match = /^\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u.exec(parsed.pathname);
  if (!match) throw new Error("GitHub remote URL is invalid.");
  return githubRepositoryName(match[1], "GitHub remote repository");
}
function githubRepositoryFromPullRequestUrl(value) {
  const source = exactText(value, "pull-request URL");
  let parsed;
  try { parsed = new URL(source); }
  catch { throw new Error("GitHub pull-request URL is invalid."); }
  const match = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/[1-9][0-9]*$/u.exec(parsed.pathname);
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com"
    || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash
    || !match) {
    throw new Error("GitHub pull-request URL is invalid.");
  }
  return githubRepositoryName(`${match[1]}/${match[2]}`, "GitHub pull-request repository");
}
function exactText(value, label) {
  const source = String(value ?? "");
  if (!source || source.trim() !== source) throw new Error(`${label} is required and exact.`);
  return source;
}
function text(value, label) { const result = String(value || "").trim(); if (!result) throw new Error(`${label} is required.`); return result; }
function sha(value, label) { const result = text(value, label); if (!/^[0-9a-f]{40}$/u.test(result)) throw new Error(`${label} is invalid.`); return result; }
function digest(value, label) { const result = text(value, label); if (!DIGEST_PATTERN.test(result)) throw new Error(`${label} is invalid.`); return result; }

export function assertTerminalHandoffSuccessorCapability({
  targetCapability,
  sourceTaskAuthority,
} = {}) {
  if (!sourceTaskAuthority || typeof sourceTaskAuthority !== "object") {
    throw new Error("Terminal handoff requires current task authority.");
  }
  if (targetCapability?.proofAdapterId !== sourceTaskAuthority.proofAdapterId) {
    throw new Error("Successor task capability must use the source proof adapter.");
  }
  if (targetCapability?.generation !== sourceTaskAuthority.generation + 1) {
    throw new Error("Successor task capability generation must advance exactly once.");
  }
  if (targetCapability?.authoritySubjectId === sourceTaskAuthority.authoritySubjectId) {
    throw new Error("Successor task capability must use a distinct authority subject.");
  }
  return targetCapability;
}

export function createTerminalHandoffSuccessorLocalTarget({
  plan,
  sourceLease,
  successorValues,
  authority,
  capability,
} = {}) {
  const sourceTaskAuthority = assertTaskAuthorityBinding({
    binding: sourceLease?.taskAuthority,
    lease: sourceLease,
  });
  assertTerminalHandoffPullRequestIdentity({
    pullRequest: plan?.evidence?.pullRequest,
    sourceClaim: plan?.evidence?.sourceClaim,
    cloudAuthority: authority,
  });
  const projected = projectTaskAuthorityCapability(capability);
  assertTerminalHandoffSuccessorCapability({
    targetCapability: projected,
    sourceTaskAuthority,
  });
  if (digestValue(projected) !== plan?.targetCapabilityDigest) {
    throw new Error("Successor task capability changed from the authorized plan.");
  }
  const target = { ...sourceLease, sessionId: plan.operatorSessionId,
    expiresAt: authority.expiresAt, cloudAuthority: authority };
  const binding = createTaskAuthorityBinding({ capability, lease: target,
    bindingMode: "handoff", boundAt: successorValues.evaluationTime,
    transitionPlanDigest: plan.planDigest,
    priorBindingDigest: sourceTaskAuthority.bindingDigest });
  const lease = { ...target, taskAuthority: binding };
  const operation = `terminal-handoff-owned-dirt-successor-recovery:${plan.planDigest}:local-cas`;
  const proof = createTaskAuthorityProof({ capability, binding, lease, operation });
  const verified = verifyTaskAuthorityProof({ proof, binding, lease, operation });
  return { lease, binding, proof, proofDigest: verified.proofDigest };
}
