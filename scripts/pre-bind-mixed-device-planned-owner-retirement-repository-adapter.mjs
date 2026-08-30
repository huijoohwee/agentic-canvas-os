// Responsibility: Join immutable Git, GitHub, cloud, capability, and lease evidence to three effects.
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, digestValue, validateLedger }
  from "./cloud-collaboration-primitives.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import { createClaimOnlyPartialStartRetirementStore }
  from "./claim-only-partial-start-retirement-store.mjs";
import { authorizeTaskBoundLeaseMutation }
  from "./task-bound-lane-authority-store.mjs";
import { normalizeTaskAuthorityCapability, projectTaskAuthorityCapability,
  assertTaskAuthorityBinding } from "./task-bound-lane-authority-contract.mjs";
import { createWriterLeaseStore, parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker } from "./writer-lease-lib.mjs";
import { operationKey } from "./pre-bind-mixed-device-planned-owner-retirement-contract.mjs";

const INSTALLED_ROOT = fileURLToPath(new URL("..", import.meta.url));
const RUNTIME_FILES = Object.freeze([
  "scripts/pre-bind-mixed-device-planned-owner-retirement-contract.mjs",
  "scripts/pre-bind-mixed-device-planned-owner-retirement-controller.mjs",
  "scripts/pre-bind-mixed-device-planned-owner-retirement-repository-adapter.mjs",
  "scripts/pre-bind-mixed-device-planned-owner-retirement.mjs",
]);

export function createPreBindMixedDevicePlannedOwnerRetirementRepositoryAdapter(
  options = {}, dependencies = {},
) {
  const repository = realpathSync(path.resolve(required(options.repository, "repository")));
  const subjectPath = realpathSync(path.resolve(required(options.subjectWorktree, "subject worktree")));
  const controllerRoot = realpathSync(path.resolve(options.controllerRoot || INSTALLED_ROOT));
  const targetRepository = repositoryName(options.targetRepository);
  const ledgerRepository = repositoryName(options.ledgerRepository || "huijoohwee/agentic-canvas-os");
  const branch = required(options.branch, "branch");
  const claimId = digest(options.claimId, "claim ID");
  const pullRequestNumber = positive(options.pullRequestNumber, "pull request number");
  const taskAuthorityFile = path.resolve(required(options.taskAuthorityFile, "task authority file"));
  const claimOwnerDevice = required(options.claimOwnerDevice, "raw claim-owner device");
  const environment = dependencies.environment || process.env;
  const now = dependencies.now || (() => new Date());
  const execute = dependencies.execute || ((command, args, cwd = repository) => execFileSync(command, args,
    { cwd, encoding: "utf8", env: environment, maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }));
  const git = dependencies.git || ((cwd, args) => String(execute("git", ["-C", cwd, ...args], cwd)).trim());
  const gitRaw = dependencies.gitRaw || ((cwd, args) => String(execute("git", ["-C", cwd, ...args], cwd)));
  const ghJson = dependencies.ghJson || (args => JSON.parse(String(execute("gh", args, repository))));
  const invokeCloud = dependencies.invokeCloud || invokeRepositoryCloudAction;
  const commonDirectory = realpathSync(path.resolve(repository,
    git(repository, ["rev-parse", "--path-format=absolute", "--git-common-dir"])));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory, taskAuthorityFile, taskAuthorityPolicy: "required", now,
  });
  const store = dependencies.store || createClaimOnlyPartialStartRetirementStore({
    statePath: required(options.statePath, "state path"), now,
  });
  const confirmed = { claim: null, pull: false, owner: false };

  function readCloud() {
    const value = dependencies.readCloud ? dependencies.readCloud()
      : invokeCloud({ action: "status", ledgerRepository, request: { targetRepository }, environment });
    if (value?.schema !== "agentic-cloud-collaboration-result/v1" || value.ok !== true
      || value.action !== "status" || !Array.isArray(value.claims)
      || !Number.isSafeInteger(value.sequence)) fail("cloud status");
    return value;
  }
  function readLedger(status) {
    const value = dependencies.readLedger ? dependencies.readLedger(status) : ghJson([
      "api", "--method", "GET", "-H", "Accept: application/vnd.github.raw+json",
      `repos/${ledgerRepository}/contents/.agentic/collaboration-ledger.json`,
      "-f", `ref=${status.ledgerRevision}`,
    ]);
    const failures = validateLedger(value);
    if (failures.length || value.headDigest !== status.ledgerDigest || value.sequence !== status.sequence) {
      throw new Error(`Collaboration ledger is invalid: ${failures.join("; ")}`);
    }
    return value;
  }
  function originalLease() {
    const value = leaseStore.read(branch);
    if (!value || value.branch !== branch || value.cloudAuthority?.claimId !== claimId) {
      fail("lease-embedded cloud claim");
    }
    if (path.resolve(value.worktreePath) !== subjectPath) fail("configured subject worktree path");
    return value;
  }
  function repositoryProjection() {
    const remote = git(repository, ["remote", "get-url", "origin"]);
    if (repositoryFromOrigin(remote) !== targetRepository) fail("target origin");
    const provider = dependencies.readRepository ? dependencies.readRepository(targetRepository)
      : ghJson(["repo", "view", targetRepository, "--json", "id,nameWithOwner"]);
    if (provider.nameWithOwner !== targetRepository) fail("provider repository");
    return { id: `github-repository:${required(provider.id, "repository ID")}`, nameWithOwner: targetRepository,
      commonDirectoryDigest: digestValue(commonDirectory) };
  }
  function controllerProjection() {
    const revision = git(controllerRoot, ["rev-parse", "HEAD"]);
    const originMain = git(controllerRoot, ["rev-parse", "refs/remotes/origin/main"]);
    const branchName = git(controllerRoot, ["branch", "--show-current"]);
    const clean = gitRaw(controllerRoot, ["status", "--porcelain=v1", "--untracked-files=all"]) === "";
    const origin = repositoryFromOrigin(git(controllerRoot, ["remote", "get-url", "origin"]));
    const provider = dependencies.readControllerProtection
      ? dependencies.readControllerProtection(ledgerRepository)
      : ghJson(["api", "--method", "GET", `repos/${ledgerRepository}/branches/main`]);
    const providerSha = provider.commit?.sha;
    const protectedBranch = provider.protected === true;
    if (origin !== ledgerRepository || branchName !== "main" || revision !== originMain
      || revision !== providerSha || !clean || !protectedBranch) fail("clean live protected-main controller");
    const tree = git(controllerRoot, ["rev-parse", "HEAD^{tree}"]);
    const runtimeDigest = digestValue(RUNTIME_FILES.map(file => ({ file,
      digest: digestValue(readFileSync(path.join(controllerRoot, file))) })));
    return { repository: ledgerRepository, branch: "main", revision, tree, runtimeDigest,
      policyDigest: digestValue(provider.protection || { protected: provider.protected }),
      clean: true, protected: true };
  }
  function gitProjection() {
    const records = worktrees(gitRaw(repository, ["worktree", "list", "--porcelain", "-z"]));
    const registration = records.filter(item => path.resolve(item.path) === subjectPath
      && item.branch === `refs/heads/${branch}`);
    if (registration.length !== 1) fail("single registered subject worktree");
    if (git(subjectPath, ["branch", "--show-current"]) !== branch) fail("subject branch");
    const headSha = git(subjectPath, ["rev-parse", "HEAD"]);
    const treeSha = git(subjectPath, ["rev-parse", "HEAD^{tree}"]);
    const parentShas = git(subjectPath, ["show", "-s", "--format=%P", "HEAD"])
      .split(/\s+/u).filter(Boolean);
    const baseSha = parentShas.length === 1 ? parentShas[0] : "";
    const baseTreeSha = baseSha ? git(subjectPath, ["rev-parse", `${baseSha}^{tree}`]) : "";
    const status = gitRaw(subjectPath, ["status", "--porcelain=v1", "--untracked-files=all"]);
    const changedPaths = git(subjectPath, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])
      .split("\n").filter(Boolean).sort();
    const localRefSha = git(repository, ["rev-parse", `refs/heads/${branch}`]);
    const remoteRefSha = remoteHead(branch);
    return { headSha, treeSha, baseSha, baseTreeSha, parentShas, changedPaths,
      localRefSha, remoteRefSha, statusDigest: digestValue(status),
      indexDigest: digestValue(git(subjectPath, ["write-tree"])), clean: status === "", registered: true };
  }
  function remoteHead(name) {
    const lines = git(repository, ["ls-remote", "--heads", "origin", name])
      .split("\n").filter(Boolean);
    if (lines.length !== 1) fail("single remote branch ref");
    const [value, ref] = lines[0].split(/\s+/u);
    if (ref !== `refs/heads/${name}`) fail("remote branch identity");
    return value;
  }
  function pullProjection(lease) {
    const value = dependencies.readPull ? dependencies.readPull(pullRequestNumber) : ghJson([
      "pr", "view", String(pullRequestNumber), "--repo", targetRepository, "--json",
      "number,id,url,state,isDraft,mergedAt,closedAt,autoMergeRequest,headRefName,headRefOid,headRepository,baseRefName,baseRefOid,body",
    ]);
    const marker = parseWriterLeasePullRequestBody(value.body);
    const expected = projectWriterLeasePullRequestMarker(lease);
    if (value.number !== pullRequestNumber) fail("configured pull-request number");
    if (!marker || canonicalJson(marker) !== canonicalJson(expected)) fail("exact pull-request writer marker");
    return { number: value.number, nodeId: required(value.id, "pull request node"), url: value.url,
      state: value.state, isDraft: value.isDraft, mergedAt: value.mergedAt,
      closedAt: value.closedAt ? new Date(value.closedAt).toISOString() : null,
      autoMergeRequest: value.autoMergeRequest ?? null,
      headRepository: required(value.headRepository?.nameWithOwner, "pull head repository"),
      headBranch: value.headRefName, headSha: value.headRefOid,
      baseRepository: targetRepository, baseBranch: value.baseRefName, baseSha: value.baseRefOid,
      markerDigest: digestValue(marker) };
  }
  function capabilityProjection(lease) {
    const capability = normalizeTaskAuthorityCapability(JSON.parse(readFileSync(taskAuthorityFile, "utf8")));
    const binding = assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
    const projected = projectTaskAuthorityCapability(capability);
    if (projected.authoritySubjectId !== binding.authoritySubjectId
      || projected.publicKeyDigest !== binding.publicKeyDigest
      || projected.generation !== binding.generation
      || projected.proofAdapterId !== binding.proofAdapterId) fail("task capability binding");
    return { authoritySubjectId: projected.authoritySubjectId,
      proofAdapterId: projected.proofAdapterId, generation: projected.generation,
      publicKeyDigest: projected.publicKeyDigest, bindingDigest: binding.bindingDigest };
  }
  function cloudFrame(status = readCloud(), expected = null) {
    const ledger = readLedger(status);
    const current = status.claims.filter(item => item.claimId === claimId);
    if (current.length > 1) fail("cloud claim cardinality");
    const entries = ledger.entries.filter(item => item.claimId === claimId);
    const source = entries.find(item => item.claimDigest === (expected?.claimDigest
      || originalLease().cloudAuthority.claimDigest));
    if (!source) fail("exact source claim ledger entry");
    return { status, ledger, current: current[0] || null, entries, source, terminal: entries.at(-1) };
  }
  function claimProjection(frame, lease, observedAt) {
    const claim = frame.current;
    if (!claim) fail("current pre-bind claim");
    const entry = frame.source;
    const core = entry.claimCore;
    if (entry.action !== "claim" || entry.claimId !== claimId || entry.claimDigest !== claim.fenceRevision
      || entry.claimDigest !== lease.cloudAuthority.claimDigest || digestValue(core) !== entry.claimDigest) {
      fail("t1 source claim lineage");
    }
    validateEntrySeal(entry);
    return { claimId, claimDigest: entry.claimDigest, entryDigest: entry.digest,
      actorId: core.actorId,
      repositoryId: core.repositoryId, workItemId: core.workItemId,
      deviceId: core.deviceId, sessionId: core.sessionId,
      canonicalBaseRevision: core.canonicalBaseRevision, laneRevision: core.laneRevision,
      declaredWriteScope: core.declaredWriteScope, writeSetDigest: core.writeSetDigest,
      leaseEpoch: core.leaseEpoch, transitionCounter: core.transitionCounter,
      state: claim.state, writeAuthority: claim.writeAuthority, scopeReserved: claim.scopeReserved,
      reviewRequestId: core.reviewRequestId ?? null, expiresAt: new Date(core.expiresAt).toISOString(),
      temporalState: Date.parse(core.expiresAt) > Date.parse(observedAt) ? "current" : "expired" };
  }
  function leaseProjection(lease) {
    const authority = lease.cloudAuthority;
    return { digest: digestValue(lease), status: lease.status, epoch: lease.epoch,
      sessionId: lease.sessionId, device: lease.device, scope: lease.scope,
      normalizedOwner: lease.device.toLowerCase(),
      branch: lease.branch, worktreePath: path.resolve(lease.worktreePath), baseSha: lease.baseSha,
      fenceSha: lease.fenceSha, expiresAt: new Date(lease.expiresAt).toISOString(),
      admissionStatus: lease.admission?.status,
      admissionWriteSetDigest: lease.admission?.writeSetDigest,
      admissionManifestDigest: lease.admission?.manifestDigest, claimId: authority.claimId,
      cloudDeviceId: authority.deviceId, cloudSessionId: authority.sessionId,
      cloudClaimDigest: authority.claimDigest, cloudWriteSetDigest: authority.writeSetDigest,
      taskAuthorityBindingDigest: lease.taskAuthority?.bindingDigest };
  }
  function capture(observedAt = now().toISOString()) {
    const lease = originalLease();
    const frame = cloudFrame();
    const ledger = frame.ledger;
    return { schema: "agentic-pre-bind-mixed-device-planned-owner-retirement-evidence/v1",
      observedAt, repository: repositoryProjection(), controller: controllerProjection(),
      lease: leaseProjection(lease), taskCapability: capabilityProjection(lease),
      cloudSubject: { rawClaimOwnerDevice: claimOwnerDevice,
        derivedClaimDeviceId: pseudonymousIdentifier("device", claimOwnerDevice),
        derivedNormalizedDeviceId: pseudonymousIdentifier("device", lease.device),
        derivedExpectedSessionId: pseudonymousIdentifier("session", lease.sessionId),
        derivationDigest: digestValue({ deviceId: lease.device,
          normalizedOwner: lease.device.toLowerCase(), rawClaimOwnerDevice: claimOwnerDevice,
          sessionId: lease.sessionId,
          derivedClaimDeviceId: pseudonymousIdentifier("device", claimOwnerDevice),
          derivedNormalizedDeviceId: pseudonymousIdentifier("device", lease.device),
          derivedExpectedSessionId: pseudonymousIdentifier("session", lease.sessionId) }) },
      claim: claimProjection(frame, lease, observedAt), git: gitProjection(),
      pullRequest: pullProjection(lease), ledger: { repository: ledgerRepository,
        revision: frame.status.ledgerRevision, digest: frame.status.ledgerDigest,
        sequence: frame.status.sequence, validatedDigest: digestValue(ledger) } };
  }
  function authorize(plan, phase, lease = originalLease()) {
    const receipt = authorizeTaskBoundLeaseMutation({ lease, capabilityPath: taskAuthorityFile,
      operation: `${plan.operation}:${plan.planDigest}:${phase}`, now: now() });
    if (receipt.bindingDigest !== plan.evidence.lease.taskAuthorityBindingDigest) fail("effect task capability");
    return receipt;
  }
  function authorizationExpectation(receipt) {
    return digestValue({ authoritySubjectId: receipt.authoritySubjectId,
      proofAdapterId: receipt.proofAdapterId, generation: receipt.generation,
      bindingDigest: receipt.bindingDigest, operation: receipt.operation });
  }
  function assertPreserved(plan, { allowClosed = false, allowReleased = false } = {}) {
    const gitState = gitProjection();
    if (canonicalJson(gitState) !== canonicalJson(plan.evidence.git)) fail("preserved Git/ref/worktree state");
    const current = leaseStore.read(branch);
    if (!allowReleased && digestValue(current) !== plan.evidence.lease.digest) fail("source lease continuity");
    const pull = pullProjectionFromPlanMarker(plan, current, allowReleased);
    const plannedPull = plan.evidence.pullRequest;
    if (pull.number !== plannedPull.number || pull.nodeId !== plannedPull.nodeId
      || pull.url !== plannedPull.url || pull.isDraft !== plannedPull.isDraft
      || pull.mergedAt !== plannedPull.mergedAt || pull.autoMergeRequest !== null
      || pull.headRepository !== plannedPull.headRepository
      || pull.headBranch !== plannedPull.headBranch || pull.headSha !== plannedPull.headSha
      || pull.baseRepository !== plannedPull.baseRepository || pull.baseBranch !== plannedPull.baseBranch
      || pull.baseSha !== plannedPull.baseSha || pull.markerDigest !== plannedPull.markerDigest
      || (!allowClosed && pull.state !== "OPEN")) fail("pull-request identity continuity");
    const controller = controllerProjection();
    if (canonicalJson(controller) !== canonicalJson(plan.evidence.controller)) fail("controller revision continuity");
    return { current, pull, gitState };
  }
  function pullProjectionFromPlanMarker(plan, current, released) {
    const markerLease = released ? planLeaseMarker(plan) : current;
    return pullProjection(markerLease);
  }
  function planLeaseMarker(plan) {
    const marker = dependencies.sourceLeaseForPlan?.(plan);
    if (marker) return marker;
    const current = leaseStore.read(branch);
    return current?.preBindMixedDevicePlannedOwnerRetirement?.originalLease || current;
  }
  function terminalEntry(plan, frame) {
    const entry = frame.terminal, retirement = entry?.claimCore?.retirement;
    const source = frame.source; validateEntrySeal(source); validateEntrySeal(entry);
    const effects = cloudEffectEvidence(plan);
    const expectedRetirement = { reason: "abandoned", finalRevision: plan.evidence.claim.laneRevision,
      reviewRequestId: null, ...effects, integrationReceiptDigest: null, retiredAt: entry.evaluationTime };
    const expectedCore = { ...source.claimCore,
      transitionCounter: source.claimCore.transitionCounter + 1, state: "retired",
      retirement: expectedRetirement };
    const semanticIntent = { repositoryId: source.claimCore.repositoryId,
      actorId: source.claimCore.actorId, deviceId: source.claimCore.deviceId,
      sessionId: source.claimCore.sessionId, claimId,
      expectedFenceRevision: source.claimDigest,
      expectedTransitionCounter: source.claimCore.transitionCounter,
      reason: "abandoned", finalRevision: plan.evidence.claim.laneRevision,
      reviewRequestId: null, ...effects, integrationReceiptDigest: null };
    const expectedRequestDigest = digestValue({ action: "retire", intent: semanticIntent });
    const expectedOperationKey = digestValue(operationKey(plan, "claim-retirement-attempted"));
    const receiptCore = { schema: "agentic-collaboration-retirement-receipt/v1",
      operation: "retire", status: "retired", repositoryId: entry.repositoryId,
      claimId, claimDigest: entry.claimDigest, fenceRevision: entry.claimDigest,
      ledgerRevision: entry.digest, ledgerSequence: entry.sequence,
      idempotencyKey: entry.idempotencyKey, requestDigest: entry.requestDigest,
      evaluationTime: entry.evaluationTime };
    const operationReceipt = { ...receiptCore, receiptDigest: digestValue(receiptCore) };
    if (!entry || entry.action !== "retire" || entry.claimId !== claimId
      || canonicalJson(entry.claimCore) !== canonicalJson(expectedCore)
      || entry.requestDigest !== expectedRequestDigest || entry.idempotencyKey !== expectedOperationKey
      || entry.repositoryId !== plan.evidence.repository.id
      || retirement?.bytesDigest !== effects.bytesDigest
      || retirement?.namedChecksDigest !== effects.namedChecksDigest
      || retirement?.handoffEvidenceDigest !== effects.handoffEvidenceDigest) {
      fail("exact terminal claim retirement");
    }
    return { entry, operationReceipt };
  }
  function cloudEffectEvidence(plan) {
    return { bytesDigest: digestValue({ planDigest: plan.planDigest, preservation: "bytes" }),
      namedChecksDigest: digestValue({ planDigest: plan.planDigest, preservation: "checks" }),
      handoffEvidenceDigest: digestValue({ planDigest: plan.planDigest, preservation: "handoff" }) };
  }
  function validateEntrySeal(entry) {
    if (!entry || entry.schema !== "agentic-cloud-collaboration-entry/v2"
      || entry.claimDigest !== digestValue(entry.claimCore)) fail("sealed cloud entry claim");
    const core = { ...entry }; delete core.digest;
    if (entry.digest !== digestValue(core)) fail("sealed cloud entry");
  }
  function releasedLease(plan, lease, taskAuthorizationReceiptDigest) {
    const record = lease?.preBindMixedDevicePlannedOwnerRetirement;
    if (!(lease?.status === "released" && lease.admission === null && lease.cloudAuthority === null
      && record?.schema === "agentic-pre-bind-mixed-device-planned-owner-local-release/v1"
      && record.status === "retired-preserved"
      && record.planDigest === plan.planDigest && record.originalLeaseDigest === plan.evidence.lease.digest
      && record.claimId === claimId && record.preservationDigest === digestValue(plan.preservation)
      && record.operationKey === operationKey(plan, "owner-release-attempted")
      && record.taskAuthorizationReceiptDigest === taskAuthorizationReceiptDigest
      && Number.isFinite(Date.parse(record.completedAt))
      && digestValue(record.originalLease) === plan.evidence.lease.digest)) return false;
    const recordCore = { ...record }; delete recordCore.receiptDigest;
    if (record.receiptDigest !== digestValue(recordCore)) return false;
    const reconstructed = { ...lease }; delete reconstructed.preBindMixedDevicePlannedOwnerRetirement;
    Object.assign(reconstructed, { status: record.originalLease.status,
      admission: record.originalLease.admission, cloudAuthority: record.originalLease.cloudAuthority,
      heartbeatAt: record.originalLease.heartbeatAt, expiresAt: record.originalLease.expiresAt });
    return canonicalJson(reconstructed) === canonicalJson(record.originalLease);
  }

  function attemptedAuthorization(journal, phase) {
    const receiptDigest = journal?.state?.receipts?.[phase]?.taskAuthorizationReceiptDigest;
    const expectationDigest = journal?.state?.receipts?.[phase]?.taskAuthorizationExpectationDigest;
    if (!/^[0-9a-f]{64}$/u.test(String(receiptDigest || ""))
      || !/^[0-9a-f]{64}$/u.test(String(expectationDigest || ""))) {
      fail(`${phase} durable task authorization`);
    }
    return { receiptDigest, expectationDigest };
  }
  function reauthorizeAttempt(plan, phase, journal, lease) {
    const sealed = attemptedAuthorization(journal, phase);
    const fresh = authorize(plan, phase, lease);
    if (authorizationExpectation(fresh) !== sealed.expectationDigest) {
      fail(`${phase} fresh task authorization expectation`);
    }
    return sealed;
  }

  return Object.freeze({
    withLock: store.withOperationLock, readJournal: store.readJournal,
    writeJournal: store.writeJournal,
    observe({ observedAt } = {}) { return capture(observedAt); },
    prepare({ plan }) {
      const state = assertPreserved(plan);
      const frame = cloudFrame(readCloud(), plan.evidence.claim);
      if (!frame.current || frame.current.fenceRevision !== plan.evidence.claim.claimDigest) {
        fail("prepared source claim");
      }
      const authority = authorize(plan, "prepared", state.current);
      return { relevantEvidenceDigest: digestValue({ planDigest: plan.planDigest,
        sourceLeaseDigest: digestValue(state.current), claimDigest: frame.current.fenceRevision,
        pullRequestNodeId: state.pull.nodeId, git: state.gitState,
        controllerRevision: plan.evidence.controller.revision }),
        taskAuthorizationReceiptDigest: authority.receiptDigest };
    },
    authorizeEffect({ plan, phase }) {
      const state = assertPreserved(plan, { allowClosed: phase !== "claim-retirement-attempted" });
      const authority = authorize(plan, phase, state.current);
      return { taskAuthorizationReceiptDigest: authority.receiptDigest,
        taskAuthorizationExpectationDigest: authorizationExpectation(authority) };
    },
    classifyClaim({ plan, journal }) {
      const taskAuthorization = attemptedAuthorization(journal, "claim-retirement-attempted");
      const frame = cloudFrame(readCloud(), plan.evidence.claim);
      if (frame.current) {
        if (frame.current.fenceRevision !== plan.evidence.claim.claimDigest) fail("cloud claim drift");
        assertPreserved(plan); return { state: "pending" };
      }
      const terminal = terminalEntry(plan, frame), entry = terminal.entry;
      assertPreserved(plan, { allowClosed: true });
      return { state: "complete", values: { operationKey: operationKey(plan, "claim-retirement-attempted"),
        claimId, terminalEntryDigest: entry.digest, terminalClaimDigest: entry.claimDigest,
        operationReceiptDigest: terminal.operationReceipt.receiptDigest,
        transportReceiptDigest: confirmed.claim?.receipt?.receiptDigest || null,
        taskAuthorizationReceiptDigest: taskAuthorization.receiptDigest,
        taskAuthorizationExpectationDigest: taskAuthorization.expectationDigest,
        disposition: confirmed.claim ? "projected" : "adopted",
        cloudMutation: Boolean(confirmed.claim) } };
    },
    retireClaim({ plan, journal, operationKey: key, taskAuthorizationReceiptDigest,
      taskAuthorizationExpectationDigest }) {
      const sealed = attemptedAuthorization(journal, "claim-retirement-attempted");
      if (sealed.receiptDigest !== taskAuthorizationReceiptDigest
        || sealed.expectationDigest !== taskAuthorizationExpectationDigest) {
        fail("claim effect task authorization");
      }
      const state = assertPreserved(plan), frame = cloudFrame();
      reauthorizeAttempt(plan, "claim-retirement-attempted", journal, state.current);
      const claim = claimProjection(frame, state.current, plan.evidence.observedAt);
      const effects = cloudEffectEvidence(plan);
      const result = invokeCloud({ action: "retire", ledgerRepository, environment, request: {
        targetRepository, claimId, expectedFenceRevision: claim.claimDigest,
        expectedTransitionCounter: claim.transitionCounter, expectedLedgerDigest: frame.status.ledgerDigest,
        deviceId: plan.evidence.cloudSubject.rawClaimOwnerDevice,
        sessionId: state.current.sessionId, reason: "abandoned",
        finalRevision: claim.laneRevision, reviewRequestId: null,
        ...effects,
        integrationReceiptDigest: null, idempotencyKey: key,
      } });
      if (result?.ok !== true || result.action !== "retire") throw new Error("Exact cloud retirement failed.");
      confirmed.claim = result;
    },
    classifyPullRequest({ plan, journal }) {
      const taskAuthorization = attemptedAuthorization(journal, "pull-request-close-attempted");
      const frame = cloudFrame(readCloud(), plan.evidence.claim); terminalEntry(plan, frame);
      const state = assertPreserved(plan, { allowClosed: true });
      if (state.pull.state === "OPEN") return { state: "pending" };
      if (state.pull.state !== "CLOSED" || state.pull.mergedAt !== null || !state.pull.closedAt) fail("closed unmerged draft");
      return { state: "complete", values: { operationKey: operationKey(plan, "pull-request-close-attempted"),
        pullRequestNumber, pullRequestNodeId: state.pull.nodeId, closedAt: state.pull.closedAt,
        taskAuthorizationReceiptDigest: taskAuthorization.receiptDigest,
        taskAuthorizationExpectationDigest: taskAuthorization.expectationDigest,
        disposition: confirmed.pull ? "projected" : "adopted",
        providerMutation: confirmed.pull,
        remoteRefSha: state.gitState.remoteRefSha } };
    },
    closePullRequest({ plan, journal, taskAuthorizationReceiptDigest,
      taskAuthorizationExpectationDigest }) {
      const sealed = attemptedAuthorization(journal, "pull-request-close-attempted");
      if (sealed.receiptDigest !== taskAuthorizationReceiptDigest
        || sealed.expectationDigest !== taskAuthorizationExpectationDigest) {
        fail("pull effect task authorization");
      }
      const state = assertPreserved(plan, { allowClosed: true });
      reauthorizeAttempt(plan, "pull-request-close-attempted", journal, state.current);
      if (state.pull.state === "OPEN") {
        if (dependencies.closePull) dependencies.closePull(state.pull);
        else execute("gh", ["pr", "close", "--repo", targetRepository, state.pull.url], repository);
        confirmed.pull = true;
      }
    },
    classifyOwner({ plan, journal }) {
      const taskAuthorization = attemptedAuthorization(journal, "owner-release-attempted");
      const frame = cloudFrame(readCloud(), plan.evidence.claim); terminalEntry(plan, frame);
      const current = leaseStore.read(branch);
      if (releasedLease(plan, current, taskAuthorization.receiptDigest)) {
        const state = assertPreserved(plan, { allowClosed: true, allowReleased: true });
        return { state: "complete", values: { operationKey: operationKey(plan, "owner-release-attempted"),
          releasedLeaseDigest: digestValue(current), releaseReceiptDigest: current.preBindMixedDevicePlannedOwnerRetirement.receiptDigest,
          taskAuthorizationReceiptDigest: taskAuthorization.receiptDigest,
          taskAuthorizationExpectationDigest: taskAuthorization.expectationDigest,
          disposition: confirmed.owner ? "projected" : "adopted",
          localMutation: confirmed.owner,
          preservedGitDigest: digestValue(state.gitState) } };
      }
      const state = assertPreserved(plan, { allowClosed: true });
      if (state.pull.state !== "CLOSED") fail("closed pull request before local release");
      return { state: "pending" };
    },
    releaseOwner({ plan, journal, operationKey: key, taskAuthorizationReceiptDigest,
      taskAuthorizationExpectationDigest }) {
      const sealed = attemptedAuthorization(journal, "owner-release-attempted");
      if (sealed.receiptDigest !== taskAuthorizationReceiptDigest
        || sealed.expectationDigest !== taskAuthorizationExpectationDigest
        || key !== operationKey(plan, "owner-release-attempted")) fail("owner effect task authorization");
      const state = assertPreserved(plan, { allowClosed: true });
      reauthorizeAttempt(plan, "owner-release-attempted", journal, state.current);
      if (state.pull.state !== "CLOSED") fail("effect order before local release");
      const completedAt = now().toISOString();
      const release = { schema: "agentic-pre-bind-mixed-device-planned-owner-local-release/v1",
        status: "retired-preserved", planDigest: plan.planDigest, claimId,
        originalLeaseDigest: plan.evidence.lease.digest, operationKey: key,
        taskAuthorizationReceiptDigest,
        preservationDigest: digestValue(plan.preservation), completedAt,
        originalLease: structuredClone(state.current) };
      release.receiptDigest = digestValue(release);
      leaseStore.release({ sessionId: state.current.sessionId, branch, expectedLease: state.current,
        status: "released", timestamp: completedAt, values: { admission: null, cloudAuthority: null,
          preBindMixedDevicePlannedOwnerRetirement: release } });
      confirmed.owner = true;
    },
    verifyTerminal({ plan, journal }) {
      const claimAuthority = attemptedAuthorization(journal, "claim-retirement-attempted");
      const pullAuthority = attemptedAuthorization(journal, "pull-request-close-attempted");
      const ownerAuthority = attemptedAuthorization(journal, "owner-release-attempted");
      const frame = cloudFrame(readCloud(), plan.evidence.claim);
      const entry = terminalEntry(plan, frame).entry;
      const state = assertPreserved(plan, { allowClosed: true, allowReleased: true });
      if (!releasedLease(plan, state.current, ownerAuthority.receiptDigest)
        || state.pull.state !== "CLOSED" || state.pull.mergedAt !== null) {
        fail("terminal convergence");
      }
      return { terminalEvidenceDigest: digestValue({ planDigest: plan.planDigest,
        claimTerminalEntryDigest: entry.digest, pullRequestNumber, pullClosedAt: state.pull.closedAt,
        releasedLeaseDigest: digestValue(state.current), git: state.gitState,
        taskAuthorizationReceiptDigests: { prepared: journal.state.receipts.prepared.taskAuthorizationReceiptDigest,
          claim: claimAuthority, pullRequest: pullAuthority, owner: ownerAuthority },
        controllerRevision: plan.evidence.controller.revision }) };
    },
  });
}

function worktrees(raw) { const records = [], current = {}; for (const field of String(raw).split("\0")) {
  if (!field) continue; const [key, ...tail] = field.split(" ");
  if (key === "worktree" && current.path) { records.push({ ...current }); for (const name of Object.keys(current)) delete current[name]; }
  if (key === "worktree") current.path = tail.join(" "); else if (key === "branch") current.branch = tail.join(" ");
  else if (key === "HEAD") current.head = tail[0]; } if (current.path) records.push(current); return records; }
function required(value, label) { if (typeof value !== "string" || !value || value.trim() !== value) throw new Error(`${label} is invalid.`); return value; }
function positive(value, label) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} is invalid.`); return result; }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
function repositoryName(value) { const result = required(value, "repository"); if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) throw new Error("Repository identity is invalid."); return result; }
function repositoryFromOrigin(value) { return /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u.exec(String(value || ""))?.[1] || null; }
function fail(label) { throw new Error(`Pre-bind mixed-device retirement requires exact ${label}.`); }
