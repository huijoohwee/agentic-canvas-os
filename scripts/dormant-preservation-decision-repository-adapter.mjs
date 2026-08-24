// Responsibility: Bind dormant-preservation decisions to live repository effects.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as Contract from "./dormant-preservation-decision-contract.mjs";
import { assertDormantPreservationCandidatePullRequest, createDormantPreservationAdmissionIntentStore, invokeDormantPreservationDevice, materializeDormantPreservationDeviceStartOptions, parseDormantPreservationDeviceResult } from "./dormant-preservation-decision-controller.mjs";
import * as Evidence from "./dormant-preservation-decision-evidence.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { sanitizeDevice } from "./device-branch-lib.mjs";
import { normalizeCloudAuthority, normalizeDeclaredWriteScopeManifest } from "./scoped-lane-admission-lib.mjs";
import { assertPlannedContinuationIdentity, continuePlannedScopedLaneAdmission, observeProtectedDescendant } from "./scoped-lane-admission-continuation.mjs";
import { verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { assertAdmissionMutationAuthority, collectScopedLaneState } from "./scoped-lane-admission-state.mjs";
import { verifyDormantPreservation } from "./scoped-lane-authority-state.mjs";
import { inspectTaskWorktreeTarget } from "./task-worktree-provision.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";
export { createDormantPreservationAdmissionIntentStore, parseDormantPreservationDeviceResult };
const DEVICE_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "device-branch.mjs");
const ADAPTER_METHODS = Object.freeze([
  "withEntrypointFence", "readSourceEvidence", "readIntent", "writeIntent",
  "classifyLiveStart", "invokeProvisionedStart", "invokePlannedContinuation",
]);
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
export function createDormantPreservationAdmissionAdapter(methods = {}) {
  const adapter = Object.freeze(Object.fromEntries(ADAPTER_METHODS.map(name => [name, methods[name]])));
  for (const name of ADAPTER_METHODS) {
    if (typeof adapter[name] !== "function")
      throw new Error(`Dormant preservation admission adapter requires ${name}().`);
  }
  return adapter;
}
export function createDeviceDormantPreservationAdmissionGate({
  argumentsList = [], controllerRoot, repository, targetRepository, targetPath,
  manifest, authority, sessionId, worktreePaths = [], pullRequestReferences = [],
  gitText, collectLaneState = collectScopedLaneState,
  inspectTarget = inspectTaskWorktreeTarget,
  verifyCloud = verifyAdmissionCloudAuthority,
  verifyDormant = verifyDormantPreservation,
} = {}) {
  const context = normalizeGateContext({
    argumentsList, controllerRoot, repository, targetRepository, targetPath,
    manifest, authority, sessionId, worktreePaths, pullRequestReferences, gitText,
  });
  let initialDecision = null;
  function observe({ laneState, targetPlan } = {}) {
    const snapshot = laneState || collectLaneState({ repository: context.repository });
    const target = targetPlan || inspectTarget({ invocationPath: context.repository,
      repoRoot: context.repository, targetPath: context.targetPath, gitText: context.gitText });
    const verified = verifyCloud({ authority: context.authority,
      manifest: context.manifest, canonicalBaseSha: snapshot.canonicalBaseSha });
    if (!context.hasDormantSelection) {
      return Object.freeze({ verified, dormantPreservationReceipt: null, decision: null });
    }
    const planDigest = requiredOption(context.argumentsList, "operator-decision-digest");
    const dormantPreservationReceipt = verifyDormant({ repository: context.repository,
      targetRepository: context.targetRepository, lanes: snapshot.lanes,
      worktreePaths: context.worktreePaths, pullRequestReferences: context.pullRequestReferences,
      operatorDecisionDigest: planDigest, sessionId: context.sessionId,
      remoteAuthorityVerification: verified.verification, verifiedAt: verified.verification.verifiedAt });
    const sourceEvidence = buildGateSourceEvidence({
      context, snapshot, target, verified, dormantPreservationReceipt,
    });
    const plan = Contract.buildDormantPreservationAdmissionPlan({
      sourceEvidence,
      nestedDeviceStart: buildNestedDeviceStart(context),
    });
    const actualArgv = deviceStartArguments(context);
    Contract.assertDormantPreservationAdmissionPreProvision(plan, sourceEvidence, actualArgv);
    const suppliedEvidenceDigest = requiredDigest(
      requiredOption(context.argumentsList, "dormant-preservation-evidence-digest"),
      "dormant preservation evidence digest",
    );
    if (sourceEvidence.sourceEvidenceDigest !== suppliedEvidenceDigest) {
      throw new Error("Dormant preservation source evidence drifted before provisioning.");
    }
    const exactAuthorization = requiredOption(context.argumentsList, "dormant-preservation-authorization");
    if (plan.planDigest !== planDigest
      || exactAuthorization !== `authorize dormant-preservation-admission ${plan.planDigest}`) {
      throw new Error("Dormant preservation admission decision is not exact-current.");
    }
    Contract.authorizeDormantPreservationAdmission(plan, exactAuthorization);
    const decision = Object.freeze({
      schema: "agentic-dormant-preservation-admission-device-decision/v1",
      sourceEvidenceDigest: sourceEvidence.sourceEvidenceDigest,
      selectionDigest: sourceEvidence.preservation.selectionDigest,
      planDigest: plan.planDigest,
      exactAuthorization,
    });
    return Object.freeze({ verified, dormantPreservationReceipt, sourceEvidence, plan, decision });
  }
  return Object.freeze({
    verify(input = {}) {
      const result = observe(input);
      initialDecision = result.decision;
      return result;
    },
    revalidate({ expectedDecision = initialDecision } = {}) {
      if (!context.hasDormantSelection) return null;
      if (!expectedDecision) throw new Error("Dormant preservation revalidation requires its initial decision.");
      const observed = observe();
      if (canonicalJson(observed.decision) !== canonicalJson(expectedDecision)) {
        throw new Error("Dormant preservation decision drifted at the provisioning boundary.");
      }
      return observed;
    },
  });
}
export function createDeviceDormantPreservationPlannedContinuationGate({
  argumentsList = [], repository, branch, sessionId, leaseStore, manifestSource,
  worktreePaths = [], pullRequestReferences = [],
  collectLaneState = collectScopedLaneState, verifyCloud = verifyAdmissionCloudAuthority,
  verifyDormant = verifyDormantPreservation,
} = {}) {
  const statePath = path.resolve(requiredOption(argumentsList, "dormant-preservation-state"));
  const intent = Contract.normalizeDormantPreservationAdmissionIntent(
    createDormantPreservationAdmissionIntentStore({ statePath }).readIntent(),
  );
  if (intent.status !== "authorized") {
    throw new Error("Planned continuation requires the durable authorized decision intent.");
  }
  const plan = intent.planSnapshot, source = plan.sourceEvidence;
  const selectionPath = path.resolve(requiredOption(argumentsList, "dormant-preservation-selection"));
  const selection = Evidence.normalizeDormantPreservationAdmissionSelection(
    readJson(selectionPath, "dormant preservation selection"),
  );
  const manifest = normalizeDeclaredWriteScopeManifest(manifestSource, {
    expectedScope: source.candidate.semanticScope,
  });
  assertSelectionMatchesArguments(selection, {
    worktreePaths: unique(worktreePaths.map(value => path.resolve(value))),
    pullRequestReferences: unique(pullRequestReferences.map(String)),
  });
  if (path.resolve(repository) !== source.candidate.targetPath
    || requiredText(branch, "candidate branch") !== source.candidate.branch
    || requiredText(sessionId, "session ID") !== source.candidate.sessionId
    || selectionPath !== source.candidate.selectionPath
    || path.resolve(requiredOption(argumentsList, "write-scope-manifest")) !== source.candidate.manifestPath
    || path.resolve(requiredOption(argumentsList, "workspace-guard-controller")) !== source.controller.path
    || requiredOption(argumentsList, "operator-decision-digest") !== plan.planDigest
    || requiredOption(argumentsList, "dormant-preservation-evidence-digest") !== plan.sourceEvidenceDigest
    || requiredOption(argumentsList, "dormant-preservation-authorization") !== plan.exactAuthorization
    || plan.deviceStartArgv.filter(item => item === `--dormant-preservation-state=${statePath}`).length !== 1
    || realpathSync(path.join(source.controller.path, "scripts/device-branch.mjs")) !== realpathSync(DEVICE_SCRIPT)) {
    throw new Error("Planned continuation invocation does not join its durable exact decision.");
  }
  Contract.authorizeDormantPreservationAdmission(plan, plan.exactAuthorization);
  let latestDormantInput = null;
  function assertCurrent(remoteInventory, receipt, postLaneState = collectLaneState({ repository: source.canonical.canonicalPath })) {
    const files = { selectionFileDigest: fileDigest(selectionPath), manifestFileDigest: fileDigest(source.candidate.manifestPath), cloudAuthorityFileDigest: fileDigest(source.candidate.cloudAuthorityPath) };
    const candidateLease = leaseStore.verify({ sessionId, branch });
    const candidateLineage = readCandidateLineage(source.candidate.targetPath);
    const input = { controller: repositoryProjection(source.controller.path, null, true),
      canonical: buildCurrentCanonical({ plan, repository: source.canonical.canonicalPath, targetPath: source.candidate.targetPath }, postLaneState),
      candidateLease, candidateLineage, postLaneState, dormantPreservationReceipt: receipt,
      postCloudInventory: remoteInventory, manifest, files };
    try { Evidence.assertDormantPreservationAdmissionPlannedContinuation(plan, input); }
    catch (error) {
      if (postLaneState.canonicalBaseSha === source.canonical.headSha) throw error;
      assertPlannedContinuationIdentity({ plan, controller: input.controller, candidateLease, candidateLineage, manifest, files });
      const protectedDeltaPaths = observeProtectedDescendant({ baseRevision: source.canonical.headSha, protectedRevision: postLaneState.canonicalBaseSha, manifest,
        gitText: args => runGit(source.canonical.canonicalPath, args) });
      continuePlannedScopedLaneAdmission({ lease: candidateLease, cloudAuthority: candidateLease.cloudAuthority, remoteAuthorityVerification: remoteInventory,
        manifest, lanes: postLaneState.lanes, protectedRevision: postLaneState.canonicalBaseSha,
        protectedDeltaPaths, dormantPreservationReceipt: receipt, operatorDecisionDigest: plan.planDigest });
    }
    return receipt;
  }
  return Object.freeze({ planDigest: plan.planDigest, sourceEvidenceDigest: plan.sourceEvidenceDigest,
    verifyDormant(input) {
      if (input.operatorDecisionDigest !== plan.planDigest
        || input.sessionId !== source.candidate.sessionId) {
        throw new Error("Planned continuation verifier changed the authorized decision.");
      }
      latestDormantInput = { ...input, repository: source.canonical.canonicalPath };
      return assertCurrent(input.remoteAuthorityVerification, verifyDormant(latestDormantInput));
    },
    verifyCloudAuthority(input) {
      const verified = verifyCloud(input);
      if (latestDormantInput) {
        const postLaneState = collectLaneState({ repository: source.canonical.canonicalPath });
        const receipt = verifyDormant({ ...latestDormantInput, lanes: postLaneState.lanes,
          remoteAuthorityVerification: verified.verification,
          verifiedAt: verified.verification.verifiedAt });
        assertCurrent(verified.verification, receipt, postLaneState);
      }
      return verified;
    },
  });
}
export function createRepositoryDormantPreservationAdmissionAdapter({
  repository, targetRepository, targetPath, scope, sessionId, manifestPath,
  cloudAuthorityPath, selectionPath, ledgerRepository = "huijoohwee/agentic-canvas-os",
  controllerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  statePath = null, ttlSeconds = 1_800,
  spawn = spawnSync, now = () => new Date(), gitText, ghText,
} = {}) {
  const root = realpathSync(path.resolve(requiredText(repository, "repository")));
  const git = gitText || (args => runGit(root, args));
  const manifestSource = readJson(manifestPath, "write-scope manifest");
  const manifest = normalizeDeclaredWriteScopeManifest(manifestSource, {
    expectedScope: requiredText(scope, "scope"),
  });
  const authoritySource = readJson(cloudAuthorityPath, "cloud authority");
  const selection = Evidence.normalizeDormantPreservationAdmissionSelection(
    readJson(selectionPath, "dormant preservation selection"),
  );
  const commonDirectory = path.resolve(root, git(["rev-parse", "--git-common-dir"]).trim());
  const claimId = claimIdFromAuthority(authoritySource);
  const leaseStore = createWriterLeaseStore({ gitCommonDir: commonDirectory, now });
  const store = createDormantPreservationAdmissionIntentStore({
    statePath: statePath || path.join(
      commonDirectory, "agentic-canvas-os", "dormant-preservation-admission", `${claimId}.json`,
    ),
    now,
  });
  const options = Object.freeze({
    repository: root, targetRepository: requiredRepository(targetRepository),
    targetPath: path.resolve(requiredText(targetPath, "target path")),
    scope: manifest.semanticScope, sessionId: requiredText(sessionId, "session ID"),
    manifestPath: path.resolve(manifestPath), cloudAuthorityPath: path.resolve(cloudAuthorityPath),
    selectionPath: path.resolve(selectionPath), ledgerRepository, controllerRoot: path.resolve(controllerRoot),
    statePath: store.statePath, ttlSeconds: positiveInteger(ttlSeconds),
  });
  return createDormantPreservationAdmissionAdapter({
    withEntrypointFence: store.withEntrypointFence,
    readIntent: store.readIntent,
    writeIntent: store.writeIntent,
    readSourceEvidence: () => observeRepositoryPlan({
      ...options, manifest, authoritySource, selection, git, now, leaseStore,
    }),
    classifyLiveStart: context => classifyRepositoryStart({
      ...options, ...context, git, ghText, leaseStore, manifest, selection,
    }),
    invokeProvisionedStart: context => invokeDormantPreservationDevice({
      ...options, ...context, spawn, action: "start", manifest, selection,
    }),
    invokePlannedContinuation: context => invokeDormantPreservationDevice({
      ...options, ...context, spawn, action: "heartbeat", manifest, selection,
    }),
  });
}
function normalizeGateContext(input) {
  if (typeof input.gitText !== "function") throw new Error("Dormant preservation gate requires gitText().");
  const worktreePaths = unique(input.worktreePaths.map(value => path.resolve(value)));
  const pullRequestReferences = unique(input.pullRequestReferences.map(String));
  const controllerDeviceScript = path.join(path.resolve(input.controllerRoot), "scripts/device-branch.mjs");
  const hasDormantSelection = worktreePaths.length + pullRequestReferences.length > 0;
  if (hasDormantSelection && realpathSync(controllerDeviceScript) !== realpathSync(DEVICE_SCRIPT)) {
    throw new Error("Dormant preservation controller does not own the running device script.");
  }
  return Object.freeze({
    ...input,
    controllerRoot: path.resolve(input.controllerRoot),
    repository: path.resolve(input.repository),
    targetPath: path.resolve(input.targetPath),
    sessionId: requiredText(input.sessionId, "session ID"),
    targetRepository: requiredRepository(input.targetRepository),
    argumentsList: Object.freeze([...input.argumentsList]),
    worktreePaths, pullRequestReferences, controllerDeviceScript,
    hasDormantSelection,
  });
}
function buildGateSourceEvidence({ context, snapshot, target, verified, dormantPreservationReceipt }) {
  const selectionPath = path.resolve(requiredOption(
    context.argumentsList, "dormant-preservation-selection",
  ));
  const selection = Evidence.normalizeDormantPreservationAdmissionSelection(
    readJson(selectionPath, "dormant preservation selection"),
  );
  assertSelectionMatchesArguments(selection, context);
  const controller = repositoryProjection(context.controllerRoot, context.gitText, true);
  const canonicalProjection = repositoryProjection(context.repository, context.gitText, false);
  const existingLanes = laneStates(snapshot.lanes);
  const candidateClaim = verified.verification.inventory.claims.find(
    claim => claim.claimId === verified.authority.claimId,
  );
  if (!candidateClaim) throw new Error("Dormant preservation candidate claim is absent from inventory.");
  const manifestPath = path.resolve(requiredOption(context.argumentsList, "write-scope-manifest"));
  const cloudAuthorityPath = path.resolve(requiredOption(context.argumentsList, "cloud-authority"));
  const deviceId = sanitizeDevice(
    optionalGit(context.gitText, ["config", "--get", "agentic.device"]) || os.hostname(),
  );
  return Evidence.buildDormantPreservationAdmissionSourceEvidence({
    controller,
    canonical: {
      repositoryPath: context.repository,
      canonicalPath: context.repository,
      origin: canonicalProjection.origin,
      targetRepository: context.targetRepository,
      headSha: canonicalProjection.headSha,
      originMainSha: canonicalProjection.originMainSha,
      remoteMainSha: canonicalProjection.remoteMainSha,
      treeSha: canonicalProjection.treeSha, clean: canonicalProjection.clean,
      canonicalSourceDisposition: target.canonicalSourceDisposition,
      canonicalLaneStateDigest: snapshot.lanes.find(
        lane => path.resolve(lane.path) === context.repository,
      )?.stateDigest,
      registryDigest: snapshot.registryDigest,
      laneSetDigest: digestValue(existingLanes), existingLanes,
    },
    candidate: {
      semanticScope: context.manifest.semanticScope,
      deviceId,
      branch: `agent/${deviceId}/${context.manifest.semanticScope}`,
      sessionId: context.sessionId,
      targetPath: context.targetPath,
      targetObservationDigest: target.targetObservationDigest,
      ttlSeconds: positiveInteger(option(context.argumentsList, "ttl-seconds") || 1_800),
      selectionPath,
      selectionFileDigest: fileDigest(selectionPath),
      manifestPath,
      manifestFileDigest: fileDigest(manifestPath),
      manifest: context.manifest,
      cloudAuthorityPath,
      cloudAuthorityFileDigest: fileDigest(cloudAuthorityPath),
      cloudAuthority: verified.authority,
      candidateClaim,
      candidateClaimRecordDigest: requiredDigest(candidateClaim.recordDigest, "candidate claim record digest"),
    },
    remoteInventory: verified.verification,
    dormantReceipt: dormantPreservationReceipt,
    selection,
  });
}
function repositoryProjection(repository, _gitText, controller) {
  const git = args => runGit(repository, args);
  const headSha = git(["rev-parse", "HEAD"]).trim();
  const originMainSha = git(["rev-parse", "origin/main"]).trim();
  const projection = {
    path: repository,
    origin: git(["config", "--get-all", "remote.origin.url"]).trim(),
    headSha,
    originMainSha,
    remoteMainSha: readRemoteMain(git),
    treeSha: git(["rev-parse", "HEAD^{tree}"]).trim(),
    clean: git(["status", "--porcelain=v1", "--untracked-files=all"]) === "",
  };
  if (controller) projection.deviceBranchScriptDigest = fileDigest(path.join(repository, "scripts/device-branch.mjs"));
  return projection;
}
function buildNestedDeviceStart(context) {
  const argvTemplate = [...deviceStartArguments(context)]
    .filter(argument => !argument.startsWith("--dormant-preservation-authorization=")
      && !argument.startsWith("--operator-decision-digest="));
  argvTemplate.push(
    "--operator-decision-digest={planDigest}",
    "--dormant-preservation-authorization={authorization}",
  );
  return Object.freeze({
    schema: "agentic-dormant-preservation-device-start-invocation/v1",
    executable: process.execPath,
    cwd: context.repository,
    argvTemplate: Object.freeze(argvTemplate),
    derivedBindings: Object.freeze({
      operatorDecisionDigest: "planDigest",
      authorization: "exactAuthorization",
    }),
  });
}
function deviceStartArguments(context) {
  const args = context.argumentsList[0] === context.manifest.semanticScope
    ? context.argumentsList.slice(1) : context.argumentsList;
  return Object.freeze([context.controllerDeviceScript, "start", context.manifest.semanticScope, ...args]);
}
function assertSelectionMatchesArguments(selection, context) {
  const selectedPaths = selection.lanes.map(item => path.resolve(item.worktreePath)).sort();
  const selectedPullRequests = selection.lanes
    .map(item => item.pullRequest).filter(value => value !== null).map(String).sort();
  if (canonicalJson(selectedPaths) !== canonicalJson([...context.worktreePaths].sort())
    || canonicalJson(selectedPullRequests) !== canonicalJson([...context.pullRequestReferences].sort())) {
    throw new Error("Dormant preservation selection does not match repeated device arguments.");
  }
}
function observeRepositoryPlan(input) {
  const laneState = collectScopedLaneState({ repository: input.repository });
  const candidateLane = laneState.lanes.find(lane => path.resolve(lane.path) === path.resolve(input.targetPath));
  const device = sanitizeDevice(optionalGit(input.git, ["config", "--get", "agentic.device"]) || os.hostname());
  const candidateBranch = `agent/${device}/${input.scope}`;
  const candidateLease = candidateLane ? input.leaseStore.read(candidateBranch) : null;
  const targetPlan = candidateLane ? projectExistingPlannedTarget({ candidateLane, canonicalSourceDisposition: laneState.canonicalSourceDisposition,
    lease: candidateLease, sessionId: input.sessionId, targetPath: input.targetPath }) : inspectTaskWorktreeTarget({ invocationPath: input.repository,
    repoRoot: input.repository, targetPath: input.targetPath, gitText: input.git });
  const authority = candidateLease?.cloudAuthority || normalizeCloudAuthority(input.authoritySource, { ledgerRepository: input.ledgerRepository,
    targetRepository: input.targetRepository, manifest: input.manifest, canonicalBaseSha: laneState.canonicalBaseSha, now: input.now() });
  const verified = verifyAdmissionCloudAuthority({
    authority, manifest: input.manifest, canonicalBaseSha: laneState.canonicalBaseSha,
  });
  const worktreePaths = input.selection.lanes.map(item => item.worktreePath);
  const pullRequestReferences = input.selection.lanes
    .map(item => item.pullRequest).filter(value => value !== null).map(String);
  const probeDigest = digestValue({
    schema: "agentic-dormant-preservation-admission-evidence-probe/v1",
    claimId: verified.authority.claimId, selection: input.selection,
    targetObservationDigest: targetPlan.targetObservationDigest,
  });
  const dormantPreservationReceipt = verifyDormantPreservation({
    repository: input.repository, targetRepository: input.targetRepository,
    lanes: laneState.lanes, worktreePaths, pullRequestReferences,
    operatorDecisionDigest: probeDigest, sessionId: input.sessionId,
    remoteAuthorityVerification: verified.verification,
    verifiedAt: verified.verification.verifiedAt,
  });
  const argumentsList = materializeDormantPreservationDeviceStartOptions(input);
  const planningLaneState = candidateLane ? { ...laneState, lanes: laneState.lanes.filter(lane => lane !== candidateLane) } : laneState;
  const context = normalizeGateContext({
    argumentsList, controllerRoot: input.controllerRoot, repository: input.repository,
    targetRepository: input.targetRepository, targetPath: input.targetPath,
    manifest: input.manifest, authority: verified.authority, sessionId: input.sessionId,
    worktreePaths, pullRequestReferences, gitText: input.git,
  });
  const sourceEvidence = buildGateSourceEvidence({
    context, snapshot: planningLaneState, target: targetPlan, verified, dormantPreservationReceipt,
  });
  const finalContext = Object.freeze({
    ...context,
    argumentsList: Object.freeze([
      ...argumentsList,
      `--dormant-preservation-evidence-digest=${sourceEvidence.sourceEvidenceDigest}`,
    ]),
  });
  return Object.freeze({
    sourceEvidence, nestedDeviceStart: buildNestedDeviceStart(finalContext),
  });
}
export function projectExistingPlannedTarget({ candidateLane, canonicalSourceDisposition, lease, sessionId, targetPath } = {}) {
  const target = path.resolve(requiredText(targetPath, "target path"));
  if (canonicalSourceDisposition !== "exact" || path.resolve(candidateLane?.path || "") !== target
    || candidateLane.dirty || candidateLane.invalid || candidateLane.leaseAmbiguous
    || candidateLane.branch !== `refs/heads/${lease?.branch}` || lease?.status !== "active"
    || lease.sessionId !== sessionId || path.resolve(lease.worktreePath || "") !== target
    || lease.admission?.status !== "planned")
    throw new Error("Existing target is not the exact clean active planned candidate.");
  const observation = { schema: "agentic-existing-planned-target-observation/v1", targetPath: target, branch: lease.branch,
    sessionId: lease.sessionId, leaseEpoch: lease.epoch, baseSha: lease.baseSha, fenceSha: lease.fenceSha, headSha: candidateLane.head,
    treeSha: candidateLane.treeSha, candidateStateDigest: candidateLane.stateDigest, admissionPlanReceiptDigest: lease.admission.planReceiptDigest,
    preparedIntegrationReceiptDigest: candidateLane.preparedIntegrationReceiptDigest || null };
  return Object.freeze({ targetObservationDigest: digestValue(observation), canonicalSourceDisposition });
}
function classifyRepositoryStart(input) {
  const source = input.plan.sourceEvidence;
  if (!existsSync(input.targetPath)) return Object.freeze({ state: "absent", evidence: null });
  const lease = input.leaseStore.read(source.candidate.branch);
  if (!lease || path.resolve(lease.worktreePath || "") !== input.targetPath
    || lease.sessionId !== input.sessionId || lease.scope !== input.scope
    || lease.cloudAuthority?.claimId !== source.candidate.candidateClaim.claimId) {
    throw new Error("Existing candidate does not join the planned dormant admission.");
  }
  if (!new Set(["planned", "admitted"]).has(lease.admission?.status)) {
    throw new Error("Existing candidate has no exact planned or admitted lease.");
  }
  const verified = verifyAdmissionCloudAuthority({
    authority: lease.cloudAuthority, manifest: input.manifest,
    canonicalBaseSha: source.canonical.headSha,
  });
  const postLaneState = collectScopedLaneState({ repository: input.repository });
  const lanes = postLaneState.lanes;
  const lane = lanes
    .find(item => path.resolve(item.path) === input.targetPath);
  if (!lane || lane.dirty || lane.invalid || lane.branch !== `refs/heads/${source.candidate.branch}`) {
    throw new Error("Candidate lane is absent, dirty, invalid, or on another branch.");
  }
  const pullRequest = readPullRequest(input, lease);
  const headSha = runGit(input.targetPath, ["rev-parse", "HEAD"]).trim();
  if (pullRequest.headRefOid !== headSha) {
    throw new Error("Admitted candidate pull request head differs from local HEAD.");
  }
  const dormantReceipt = verifyDormantPreservation({
    repository: input.repository, targetRepository: input.targetRepository, lanes,
    worktreePaths: input.selection.lanes.map(item => item.worktreePath),
    pullRequestReferences: input.selection.lanes.map(item => item.pullRequest)
      .filter(value => value !== null).map(String),
    operatorDecisionDigest: input.plan.planDigest, sessionId: input.sessionId,
    remoteAuthorityVerification: verified.verification,
    verifiedAt: verified.verification.verifiedAt,
  });
  const candidateLineage = readCandidateLineage(input.targetPath);
  const { treeSha, parentSha, parentCount } = candidateLineage;
  if (lease.admission.status === "planned") {
    try {
      Evidence.assertDormantPreservationAdmissionPlannedContinuation(input.plan, {
        controller: repositoryProjection(input.controllerRoot, input.git, true),
        canonical: buildCurrentCanonical(input, postLaneState),
        candidateLease: lease, candidateLineage, postLaneState,
        dormantPreservationReceipt: dormantReceipt, postCloudInventory: verified.verification,
        manifest: input.manifest, files: { selectionFileDigest: fileDigest(input.selectionPath),
          manifestFileDigest: fileDigest(input.manifestPath),
          cloudAuthorityFileDigest: fileDigest(input.cloudAuthorityPath) },
      });
    } catch (error) {
      if (postLaneState.canonicalBaseSha === source.canonical.headSha) throw error;
      const files = { selectionFileDigest: fileDigest(input.selectionPath), manifestFileDigest: fileDigest(input.manifestPath), cloudAuthorityFileDigest: fileDigest(input.cloudAuthorityPath) };
      assertPlannedContinuationIdentity({ plan: input.plan,
        controller: repositoryProjection(input.controllerRoot, input.git, true),
        candidateLease: lease, candidateLineage, manifest: input.manifest, files });
      const protectedDeltaPaths = observeProtectedDescendant({ baseRevision: source.canonical.headSha, protectedRevision: postLaneState.canonicalBaseSha, manifest: input.manifest,
        gitText: input.git });
      continuePlannedScopedLaneAdmission({ lease, cloudAuthority: verified.authority, remoteAuthorityVerification: verified.verification,
        manifest: input.manifest, lanes, protectedRevision: postLaneState.canonicalBaseSha, protectedDeltaPaths,
        dormantPreservationReceipt: dormantReceipt, operatorDecisionDigest: input.plan.planDigest });
    }
    return Object.freeze({ state: "planned", evidence: null });
  }
  const mutation = assertAdmissionMutationAuthority({ lease,
    cloudAuthority: verified.authority, remoteAuthorityVerification: verified.verification });
  const execution = Evidence.buildDormantPreservationAdmissionExecutionEvidence({
    plan: input.plan, operationKey: input.operationKey,
    dormantPreservationReceipt: dormantReceipt, postLaneState,
    postCloudInventory: verified.verification,
    admissionReportDigest: lease.admission.admittedReportDigest,
    admissionReceiptDigest: lease.admission.admissionReceiptDigest,
    preservationReceiptDigest: lease.admission.preservationReceiptDigest,
    mutationAuthorityReceipt: mutation,
    candidate: {
      path: input.targetPath, branch: lease.branch,
      headSha,
      treeSha, parentSha, parentCount,
      stateDigest: lane.stateDigest, leaseDigest: digestValue(lease), leaseEpoch: lease.epoch,
      sessionId: lease.sessionId, pullRequestNumber: pullRequest.number,
      pullRequestNodeId: pullRequest.id, pullRequestUrl: pullRequest.url,
      pullRequestHeadSha: pullRequest.headRefOid,
    },
  });
  return Object.freeze({ state: "complete", evidence: execution });
}
function readCandidateLineage(targetPath) {
  const headSha = runGit(targetPath, ["rev-parse", "HEAD"]).trim();
  const treeSha = runGit(targetPath, ["rev-parse", "HEAD^{tree}"]).trim();
  const parents = runGit(targetPath, ["rev-list", "--parents", "-n", "1", "HEAD"])
    .trim().split(/\s+/u).slice(1);
  return Object.freeze({ headSha, treeSha, parentSha: parents[0], parentCount: parents.length });
}
function buildCurrentCanonical(input, postLaneState) {
  const source = input.plan.sourceEvidence, targetPath = path.resolve(input.targetPath);
  const existingLanes = postLaneState.lanes.filter(item => path.resolve(item.path) !== targetPath)
    .map(item => ({ path: path.resolve(item.path), stateDigest: item.stateDigest }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return { ...source.canonical, ...repositoryProjection(input.repository, input.git, false),
    canonicalSourceDisposition: postLaneState.canonicalSourceDisposition,
    canonicalLaneStateDigest: existingLanes.find(item => item.path === input.repository)?.stateDigest,
    laneSetDigest: digestValue(existingLanes), existingLanes };
}
function readPullRequest(input, lease) {
  const args = ["pr", "view", lease.pullRequestUrl, "--json",
    "id,url,number,state,isDraft,headRefName,headRefOid,headRepository,baseRefName"];
  const value = JSON.parse(input.ghText ? input.ghText(args) : runCommand("gh", args, input.targetPath));
  return assertDormantPreservationCandidatePullRequest(input.plan, lease, value);
}
function readJson(filePath, label) {
  try { return JSON.parse(readFileSync(path.resolve(filePath), "utf8")); }
  catch (error) { throw new Error(`Could not read ${label}: ${error.message}`); }
}
function runGit(cwd, args) {
  const child = spawnSync("git", args, {
    cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${publicMessage(child.stderr)}`);
  return child.stdout;
}
function runCommand(command, args, cwd) {
  const child = spawnSync(command, args, {
    cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.status !== 0) throw new Error(`${command} failed: ${publicMessage(child.stderr)}`);
  return child.stdout;
}
function optionalGit(gitText, args) {
  try { return String(gitText(args)).trim(); } catch { return ""; }
}
function readRemoteMain(git) {
  const value = git(["ls-remote", "origin", "refs/heads/main"]).trim().split(/\s+/u)[0];
  return requiredSha(value, "remote main SHA");
}
function fileDigest(filePath) { return createHash("sha256").update(readFileSync(filePath)).digest("hex"); }
function claimIdFromAuthority(source) { return requiredDigest(source?.claim?.claimId || source?.result?.claim?.claimId, "claim ID"); }
function option(args, name) {
  const prefix = `--${name}=`;
  const match = args.find(value => value.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}
function requiredOption(args, name) {
  const prefix = `--${name}=`, values = args.filter(item => item.startsWith(prefix))
    .map(item => item.slice(prefix.length).trim());
  if (values.length !== 1 || !values[0]) throw new Error(`--${name}=<value> is required exactly once.`);
  return values[0];
}
function unique(values) { return Object.freeze([...new Set(values)].sort()); }
function laneStates(lanes) { return lanes.map(lane => ({ path: path.resolve(lane.path), stateDigest: lane.stateDigest })).sort((left, right) => left.path.localeCompare(right.path)); }
function canonicalJson(value) { return JSON.stringify(value); }
function positiveInteger(value) { const number = Number(value); if (!Number.isSafeInteger(number) || number <= 0) throw new Error("TTL must be a positive integer."); return number; }
function requiredRepository(value) { const text = requiredText(value, "target repository"); if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(text)) throw new Error("Target repository must be owner/name."); return text; }
function requiredText(value, label) { const text = String(value ?? "").trim(); if (!text) throw new Error(`${label} is required.`); return text; }
function requiredDigest(value, label) { const digest = requiredText(value, label); if (!DIGEST_PATTERN.test(digest)) throw new Error(`${label} must be a SHA-256 digest.`); return digest; }
function requiredSha(value, label) { const sha = requiredText(value, label); if (!/^[0-9a-f]{40}$/u.test(sha)) throw new Error(`${label} must be a Git SHA.`); return sha; }
function publicMessage(value) { return String(value || "blocked").replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]").slice(0, 500); }
