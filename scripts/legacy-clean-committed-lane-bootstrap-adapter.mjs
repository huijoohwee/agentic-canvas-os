import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  digestValue,
  normalizeWriteSet,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import {
  bindAdmissionCloudAuthority,
  claimLegacyReviewAdmissionCloudAuthority,
  invokeRepositoryCloudAction,
  verifyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import {
  createWriterLeaseStore,
  parseDeviceBranch,
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import {
  readOwnershipPullRequest,
  waitForOwnershipPullRequestHead,
} from "./device-pull-request-state.mjs";
import { verifyProtectedMainRefreshChain } from "./protected-main-refresh-lib.mjs";

export async function createLegacyBootstrapAdapter({ requestPath } = {}) {
  const bootstrapRequest = readJson(path.resolve(String(requestPath || "")));
  const worktreePath = path.resolve(String(bootstrapRequest?.worktreePath || ""));
  const repository = gitText(["rev-parse", "--show-toplevel"], { cwd: worktreePath });
  const gitCommonDirRaw = gitText(["rev-parse", "--git-common-dir"], { cwd: worktreePath });
  const gitCommonDir = path.isAbsolute(gitCommonDirRaw)
    ? gitCommonDirRaw
    : path.resolve(repository, gitCommonDirRaw);
  const stateDir = path.join(gitCommonDir, "agentic-canvas-os", "legacy-clean-bootstrap");
  mkdirSync(stateDir, { recursive: true });
  const leaseStore = createWriterLeaseStore({ gitCommonDir });

  return {
    inspectLane: request => inspectLane({ request, repository, leaseStore, stateDir }),
    readCheckpoint: identityDigest => readCheckpoint({ identityDigest, stateDir }),
    writeCheckpoint: checkpoint => writeCheckpoint({ checkpoint, stateDir }),
    verifyFinal: context => verifyFinal({ context, repository, leaseStore, stateDir }),
    claimCloudAuthority: context => claimCloudAuthority({ context, repository, leaseStore, stateDir }),
    claimLocalLease: context => claimLocalLease({ context, repository, leaseStore, stateDir }),
    publishExactBranch: context => publishExactBranch({ context, repository, stateDir }),
    createDraftOwnershipRequest: context => createDraftOwnershipRequest({ context, repository, leaseStore, stateDir }),
    bindCloudAuthority: context => bindCloudAuthority({ context, repository, leaseStore, stateDir }),
    projectOwnerReceipt: context => projectOwnerReceipt({ context, repository, leaseStore, stateDir }),
  };
}

function inspectLane({ request, repository, leaseStore, stateDir }) {
  const worktreePath = path.resolve(request.worktreePath);
  const headSha = gitText(["rev-parse", "HEAD"], { cwd: worktreePath });
  const treeSha = gitText(["rev-parse", `${headSha}^{tree}`], { cwd: worktreePath });
  const authoredHeadSha = resolveAuthoredHeadSha({
    branch: request.branch,
    headSha,
    leaseStore,
    worktreePath,
  });
  const changedPaths = diffPaths({
    cwd: worktreePath,
    from: request.expectedBaseSha,
    to: authoredHeadSha,
  });
  const identity = createIdentity({ request, headSha, treeSha, changedPaths });
  const checkpoint = readCheckpoint({ identityDigest: identity.identityDigest, stateDir });
  const pullRequest = findOpenPullRequest({ branch: request.branch, repository });
  const claimInventory = readCurrentClaims({ request });
  const projectedClaimId = checkpoint?.outputs?.cloudClaim?.authority?.claimId || null;
  return {
    clean: gitText(["status", "--short"], { cwd: worktreePath }) === "",
    registeredWorktree: listedWorktrees(repository).includes(worktreePath),
    attachedBranch: gitText(["branch", "--show-current"], { cwd: worktreePath }),
    worktreePath,
    baseSha: request.expectedBaseSha,
    headSha,
    treeSha,
    baseIsAncestor: gitExitCode(["merge-base", "--is-ancestor", request.expectedBaseSha, headSha], { cwd: worktreePath }) === 0,
    changedPaths,
    competingScopeOwners: listScopeOwners({
      branch: request.branch,
      semanticScope: request.semanticScope,
      repository,
    }),
    overlappingClaims: claimInventory
      .filter(claim => claim.claimId !== projectedClaimId)
      .filter(claim => claim.state !== "parked" && claim.state !== "waiting-successor")
      .filter(claim => writeSetsOverlap(claim.declaredWriteScope, request.declaredWriteScope))
      .map(claim => claim.claimId),
    projections: {
      ...(checkpoint?.outputs || {}),
      ...(pullRequest ? { pullRequestState: pullRequest } : {}),
    },
  };
}

function readCheckpoint({ identityDigest, stateDir }) {
  const filePath = checkpointPath({ identityDigest, stateDir });
  if (!existsSync(filePath)) return null;
  return readJson(filePath);
}

function writeCheckpoint({ checkpoint, stateDir }) {
  writeJson(checkpointPath({
    identityDigest: checkpoint?.identity?.identityDigest,
    stateDir,
  }), checkpoint);
}

function claimCloudAuthority({ context, leaseStore, stateDir }) {
  const request = context.request;
  const leaseEpoch = 1;
  const canonicalBaseSha = projectionBaseSha({
    headSha: request.expectedHeadSha,
    requestBaseSha: request.expectedBaseSha,
    worktreePath: request.worktreePath,
  });
  const claim = claimLegacyReviewAdmissionCloudAuthority({
    ledgerRepository: request.ledgerRepository,
    targetRepository: request.targetRepository,
    manifest: admissionManifest(request),
    canonicalBaseSha,
    branch: request.branch,
    headSha: request.expectedHeadSha,
    deviceId: request.deviceId,
    sessionId: request.sessionId,
    leaseEpoch,
  });
  const output = phaseOutput("cloudClaim", context.identity.identityDigest, {
    branch: request.branch,
    leaseEpoch,
    authority: claim.authority,
    verification: claim.verification,
  });
  persistProjectedOutput({ context, output, stateDir });
  return output;
}

function claimLocalLease({ context, leaseStore, stateDir }) {
  const request = context.request;
  const baseSha = projectionBaseSha({
    headSha: request.expectedHeadSha,
    requestBaseSha: request.expectedBaseSha,
    worktreePath: request.worktreePath,
  });
  const currentPullRequest = findOpenPullRequest({
    branch: request.branch,
    repository: path.resolve(request.worktreePath),
  });
  const lease = leaseStore.claim({
    sessionId: request.sessionId,
    device: request.deviceId,
    scope: request.semanticScope,
    branch: request.branch,
    worktreePath: request.worktreePath,
    baseSha,
    previousEpoch: nextLeaseEpoch({ branch: request.branch, leaseStore }) - 1,
  });
  const annotated = leaseStore.annotate({
    sessionId: request.sessionId,
    branch: request.branch,
    values: {
      fenceSha: request.expectedHeadSha,
      ...(currentPullRequest ? { pullRequestUrl: currentPullRequest.url } : {}),
    },
  });
  const output = phaseOutput("localLease", context.identity.identityDigest, {
    branch: request.branch,
    lease: annotated,
  });
  persistProjectedOutput({ context, output, stateDir });
  return output;
}

function publishExactBranch({ context, repository, stateDir }) {
  const request = context.request;
  git(["push", "--set-upstream", "origin", request.branch], { cwd: request.worktreePath });
  const remoteHeadSha = lsRemoteHead({
    repository,
    branch: request.branch,
  });
  if (remoteHeadSha !== request.expectedHeadSha) {
    throw new Error(`Legacy bootstrap push published ${remoteHeadSha || "missing"} instead of ${request.expectedHeadSha}.`);
  }
  const output = phaseOutput("remoteBranch", context.identity.identityDigest, {
    branch: request.branch,
    remoteHeadSha,
  });
  persistProjectedOutput({ context, output, stateDir });
  return output;
}

function createDraftOwnershipRequest({ context, repository, leaseStore, stateDir }) {
  const request = context.request;
  const lease = requireLease({ branch: request.branch, leaseStore });
  const existing = findOpenPullRequest({ branch: request.branch, repository });
  const url = existing?.url || createDraftPullRequest({
    branch: request.branch,
    title: gitText(["log", "-1", "--pretty=%s"], { cwd: request.worktreePath }),
    body: updateWriterLeasePullRequestBody("", lease),
    repository,
  });
  const pullRequest = ensureDraftOwnershipPullRequest({
    url,
    branch: request.branch,
    expectedHeadSha: request.expectedHeadSha,
    repository,
  });
  const updatedLease = leaseStore.annotate({
    sessionId: request.sessionId,
    branch: request.branch,
    values: { pullRequestUrl: pullRequest.url },
  });
  updatePullRequestBody({
    url: pullRequest.url,
    body: updateWriterLeasePullRequestBody(pullRequest.body, updatedLease),
    repository,
  });
  const verified = readOwnershipPullRequest({
    url: pullRequest.url,
    branch: request.branch,
    ghText: args => ghText(args, { cwd: repository }),
  });
  const output = phaseOutput("pullRequest", context.identity.identityDigest, {
    branch: request.branch,
    pullRequest: {
      url: verified.url,
      number: pullRequestNumber(verified.url),
      isDraft: verified.isDraft,
      headRefOid: verified.headRefOid,
    },
  });
  persistProjectedOutput({ context, output, stateDir });
  return output;
}

function bindCloudAuthority({ context, leaseStore, stateDir }) {
  const request = context.request;
  const lease = requireLease({ branch: request.branch, leaseStore });
  if (!lease.pullRequestUrl) {
    throw new Error("Legacy bootstrap bind requires an ownership pull request URL.");
  }
  const priorAuthority = context.checkpoint?.outputs?.cloudClaim?.authority;
  if (!priorAuthority) {
    throw new Error("Legacy bootstrap bind requires the claimed cloud authority output.");
  }
  const bound = bindAdmissionCloudAuthority({
    authority: priorAuthority,
    manifest: admissionManifest(request),
    branch: request.branch,
    headSha: request.expectedHeadSha,
    pullRequestNumber: pullRequestNumber(lease.pullRequestUrl),
    deviceId: request.deviceId,
    sessionId: request.sessionId,
    returnVerification: true,
  });
  const output = phaseOutput("boundAuthority", context.identity.identityDigest, {
    branch: request.branch,
    authority: bound.authority,
    verification: bound.verification,
  });
  persistProjectedOutput({ context, output, stateDir });
  return output;
}

function projectOwnerReceipt({ context, leaseStore, repository, stateDir }) {
  const request = context.request;
  const lease = requireLease({ branch: request.branch, leaseStore });
  if (!lease.pullRequestUrl) {
    throw new Error("Legacy bootstrap owner projection requires an ownership pull request.");
  }
  const verification = context.checkpoint?.outputs?.boundAuthority?.verification;
  const authority = context.checkpoint?.outputs?.boundAuthority?.authority;
  if (!authority || !verification) {
    throw new Error("Legacy bootstrap owner projection requires the bound authority output.");
  }
  const admission = createAdmissionProjection({
    request,
    lease,
    authority,
    verification,
  });
  const baseSha = projectionBaseSha({
    headSha: request.expectedHeadSha,
    requestBaseSha: request.expectedBaseSha,
    worktreePath: request.worktreePath,
  });
  const annotated = leaseStore.annotate({
    sessionId: request.sessionId,
    branch: request.branch,
    values: {
      baseSha,
      fenceSha: request.expectedHeadSha,
      pullRequestUrl: lease.pullRequestUrl,
      admission,
      cloudAuthority: authority,
    },
  });
  const pullRequest = readOwnershipPullRequest({
    url: annotated.pullRequestUrl,
    branch: request.branch,
    ghText: args => ghText(args, { cwd: repository }),
  });
  const body = updateWriterLeasePullRequestBody(pullRequest.body, annotated);
  updatePullRequestBody({
    url: annotated.pullRequestUrl,
    body,
    repository,
  });
  const projected = readOwnershipPullRequest({
    url: annotated.pullRequestUrl,
    branch: request.branch,
    ghText: args => ghText(args, { cwd: repository }),
  });
  const marker = parseWriterLeasePullRequestBody(projected.body);
  if (!marker || digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(annotated))) {
    throw new Error("Legacy bootstrap owner projection did not preserve the exact writer lease marker.");
  }
  const output = phaseOutput("ownerProjection", context.identity.identityDigest, {
    branch: request.branch,
    admission,
    authority,
    pullRequestUrl: annotated.pullRequestUrl,
    markerDigest: digestValue(marker),
  });
  persistProjectedOutput({ context, output, stateDir });
  return output;
}

function verifyFinal({ context, repository, leaseStore, stateDir }) {
  const request = context.request;
  const lease = requireLease({ branch: request.branch, leaseStore });
  const pullRequest = readOwnershipPullRequest({
    url: lease.pullRequestUrl,
    branch: request.branch,
    ghText: args => ghText(args, { cwd: repository }),
  });
  if (pullRequest.headRefOid !== request.expectedHeadSha) {
    throw new Error(`Legacy bootstrap PR head ${pullRequest.headRefOid} drifted from ${request.expectedHeadSha}.`);
  }
  const marker = parseWriterLeasePullRequestBody(pullRequest.body);
  if (!marker || digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))) {
    throw new Error("Legacy bootstrap final PR marker drifted.");
  }
  verifyAdmissionCloudAuthority({
    authority: lease.cloudAuthority,
    manifest: lease.admission,
    canonicalBaseSha: projectionBaseSha({
      headSha: request.expectedHeadSha,
      requestBaseSha: request.expectedBaseSha,
      worktreePath: request.worktreePath,
    }),
  });
  return inspectLane({ request, repository, leaseStore, stateDir });
}

function admissionManifest(request) {
  return {
    schema: "agentic-declared-write-scope/v1",
    semanticScope: request.semanticScope,
    declaredWriteSet: normalizeWriteSet(request.declaredWriteScope),
    writeSetDigest: request.writeSetDigest,
    manifestDigest: digestValue({
      schema: "agentic-declared-write-scope/v1",
      semanticScope: request.semanticScope,
      declaredWriteSet: normalizeWriteSet(request.declaredWriteScope),
    }),
    admittedReportDigest: digestValue({
      schema: "agentic-legacy-bootstrap-admitted-report-input/v1",
      branch: request.branch,
      semanticScope: request.semanticScope,
      writeSetDigest: request.writeSetDigest,
      headSha: request.expectedHeadSha,
    }),
  };
}

function createAdmissionProjection({ request, lease, authority, verification }) {
  const manifest = admissionManifest(request);
  const baseSha = projectionBaseSha({
    headSha: request.expectedHeadSha,
    requestBaseSha: request.expectedBaseSha,
    worktreePath: request.worktreePath,
  });
  const existingLaneStateDigest = digestValue({
    schema: "agentic-root-source-legacy-review-state/v1",
    branch: request.branch,
    worktreePath: path.resolve(request.worktreePath),
    baseSha,
    fenceSha: request.expectedHeadSha,
    headSha: request.expectedHeadSha,
    epoch: lease.epoch,
    pullRequestUrl: lease.pullRequestUrl,
  });
  const planReceiptDigest = digestValue({
    schema: "agentic-root-source-legacy-review-plan/v1",
    branch: request.branch,
    semanticScope: manifest.semanticScope,
    manifestDigest: manifest.manifestDigest,
    writeSetDigest: manifest.writeSetDigest,
    existingLaneStateDigest,
  });
  const preservationReceiptDigest = digestValue({
    schema: "agentic-root-source-legacy-review-preservation/v1",
    branch: request.branch,
    claimId: authority.claimId,
    claimDigest: authority.claimDigest,
    manifestDigest: manifest.manifestDigest,
    existingLaneStateDigest,
  });
  const admittedReportDigest = digestValue({
    schema: "agentic-root-source-legacy-review-admission/v1",
    branch: request.branch,
    semanticScope: manifest.semanticScope,
    manifestDigest: manifest.manifestDigest,
    writeSetDigest: manifest.writeSetDigest,
    canonicalBaseSha: authority.canonicalBaseSha,
    laneRevision: authority.laneRevision,
    claimId: authority.claimId,
    claimDigest: authority.claimDigest,
    verificationReceiptDigest: verification.receiptDigest,
    preservationReceiptDigest,
  });
  return Object.freeze({
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: manifest.semanticScope,
    declaredWriteSet: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest,
    manifestDigest: manifest.manifestDigest,
    planReceiptDigest,
    admissionReceiptDigest: verification.receiptDigest,
    existingLaneStateDigest,
    admittedReportDigest,
    preservationReceiptDigest,
  });
}

function projectionBaseSha({ headSha, requestBaseSha, worktreePath }) {
  const currentMainSha = gitText(["rev-parse", "origin/main"], { cwd: worktreePath });
  if (gitExitCode(["merge-base", "--is-ancestor", currentMainSha, headSha], { cwd: worktreePath }) === 0) {
    return currentMainSha;
  }
  return requestBaseSha;
}

function listScopeOwners({ branch, semanticScope, repository }) {
  const pulls = JSON.parse(ghText([
    "pr",
    "list",
    "--state",
    "open",
    "--base",
    "main",
    "--limit",
    "100",
    "--json",
    "number,headRefName,url",
  ], { cwd: repository }));
  return pulls
    .filter(pull => pull.headRefName !== branch)
    .filter(pull => parseDeviceBranch(pull.headRefName)?.scope === semanticScope)
    .map(pull => pull.url);
}

function readCurrentClaims({ request }) {
  const result = invokeRepositoryCloudAction({
    action: "status",
    ledgerRepository: request.ledgerRepository,
    request: {
      targetRepository: request.targetRepository,
    },
  });
  return Array.isArray(result?.claims)
    ? result.claims.map(claim => ({
      claimId: claim.claimId,
      branch: claim.workItemId,
      state: claim.state,
      declaredWriteScope: normalizeWriteSet(claim.declaredWriteScope),
    }))
    : [];
}

function requireLease({ branch, leaseStore }) {
  const lease = leaseStore.read(branch);
  if (!lease || lease.branch !== branch) {
    throw new Error(`Legacy bootstrap could not find a local writer lease for ${branch}.`);
  }
  return lease;
}

function nextLeaseEpoch({ branch, leaseStore }) {
  const registry = leaseStore.readRegistry();
  const current = leaseStore.read(branch);
  const highest = Object.values(registry.leases || {})
    .reduce((max, lease) => Math.max(max, Number(lease?.epoch || 0)), 0);
  return Math.max(highest, Number(current?.epoch || 0)) + 1;
}

function createIdentity({ request, headSha, treeSha, changedPaths }) {
  const declaredWriteScope = normalizeWriteSet(request.declaredWriteScope);
  const unsigned = {
    schema: "agentic-legacy-clean-committed-lane-identity/v1",
    targetRepository: request.targetRepository,
    ledgerRepository: request.ledgerRepository,
    sessionId: request.sessionId,
    deviceId: request.deviceId,
    semanticScope: request.semanticScope,
    branch: request.branch,
    worktreeRegistrationDigest: digestValue({
      schema: "agentic-local-worktree-registration/v1",
      targetRepository: request.targetRepository,
      branch: request.branch,
      worktreePath: path.resolve(request.worktreePath),
    }),
    baseSha: request.expectedBaseSha,
    headSha,
    treeSha,
    changedPaths,
    declaredWriteScope,
    writeSetDigest: digestValue(declaredWriteScope),
  };
  return Object.freeze({
    ...unsigned,
    identityDigest: digestValue(unsigned),
  });
}

function resolveAuthoredHeadSha({ branch, headSha, leaseStore, worktreePath }) {
  const lease = leaseStore.read(branch);
  const integrationHeadSha = String(lease?.integration?.commitSha || "").trim();
  if (!integrationHeadSha || integrationHeadSha === headSha) {
    return deriveProtectedRefreshSourceHead({ headSha, worktreePath });
  }
  verifyProtectedMainRefreshChain({
    expectedHeadSha: integrationHeadSha,
    observedHeadSha: headSha,
    gitText: args => gitText(args, { cwd: worktreePath }),
  });
  return integrationHeadSha;
}

function deriveProtectedRefreshSourceHead({ headSha, worktreePath }) {
  let currentHeadSha = headSha;
  while (true) {
    const parents = gitText([
      "rev-list",
      "--parents",
      "-n",
      "1",
      currentHeadSha,
    ], { cwd: worktreePath }).split(/\s+/u).filter(Boolean);
    if (parents.length !== 3 || parents[0] !== currentHeadSha) {
      return currentHeadSha;
    }
    const previousHeadSha = parents[1];
    const mainParentSha = parents[2];
    if (gitExitCode(["merge-base", "--is-ancestor", mainParentSha, "origin/main"], {
      cwd: worktreePath,
    }) !== 0) {
      return currentHeadSha;
    }
    const expectedTreeSha = gitText([
      "merge-tree",
      "--write-tree",
      "--no-messages",
      previousHeadSha,
      mainParentSha,
    ], { cwd: worktreePath }).split(/\s+/u)[0];
    const observedTreeSha = gitText([
      "rev-parse",
      `${currentHeadSha}^{tree}`,
    ], { cwd: worktreePath });
    if (expectedTreeSha !== observedTreeSha) {
      return currentHeadSha;
    }
    currentHeadSha = previousHeadSha;
  }
}

function persistProjectedOutput({ context, output, stateDir }) {
  const checkpoint = {
    ...context.checkpoint,
    outputs: {
      ...(context.checkpoint?.outputs || {}),
      [phaseName(output.schema)]: output,
    },
  };
  writeCheckpoint({
    checkpoint: {
      ...checkpoint,
      identity: context.identity,
      schema: context.checkpoint.schema,
      status: context.checkpoint.status,
    },
    stateDir,
  });
}

function checkpointPath({ identityDigest, stateDir }) {
  return path.join(stateDir, `${String(identityDigest || "").trim()}.checkpoint.json`);
}

function phaseOutput(name, identityDigest, fields) {
  const unsigned = {
    schema: `agentic-legacy-bootstrap-${name}/v1`,
    bootstrapIdentityDigest: identityDigest,
    ...fields,
  };
  return Object.freeze({
    ...unsigned,
    receiptDigest: digestValue(unsigned),
  });
}

function phaseName(schema) {
  return String(schema || "")
    .replace(/^agentic-legacy-bootstrap-/u, "")
    .replace(/\/v1$/u, "");
}

function listedWorktrees(repository) {
  const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: repository,
    encoding: "utf8",
  });
  return output
    .split(/\r?\n/u)
    .filter(line => line.startsWith("worktree "))
    .map(line => path.resolve(line.slice("worktree ".length).trim()));
}

function diffPaths({ cwd, from, to }) {
  return gitText(["diff", "--name-only", `${from}..${to}`, "--"], { cwd })
    .split(/\r?\n/u)
    .map(value => value.trim())
    .filter(Boolean)
    .sort();
}

function findOpenPullRequest({ branch, repository }) {
  const pulls = JSON.parse(ghText([
    "pr",
    "list",
    "--state",
    "open",
    "--head",
    branch,
    "--base",
    "main",
    "--json",
    "url,isDraft,headRefName,headRefOid,body",
  ], { cwd: repository }));
  return pulls.find(pull => pull.headRefName === branch) || null;
}

function ensureDraftOwnershipPullRequest({ url, branch, expectedHeadSha, repository }) {
  let pullRequest = readOwnershipPullRequest({
    url,
    branch,
    ghText: args => ghText(args, { cwd: repository }),
  });
  if (!pullRequest.isDraft) {
    gh(["pr", "ready", "--undo", url], { cwd: repository });
    pullRequest = readOwnershipPullRequest({
      url,
      branch,
      ghText: args => ghText(args, { cwd: repository }),
    });
  }
  if (!pullRequest.isDraft) {
    throw new Error(`Legacy bootstrap could not keep ${url} in draft state.`);
  }
  return waitForOwnershipPullRequestHead({
    url,
    branch,
    expectedHeadSha,
    ghText: args => ghText(args, { cwd: repository }),
  });
}

function createDraftPullRequest({ branch, title, body, repository }) {
  return ghText([
    "pr",
    "create",
    "--draft",
    "--base",
    "main",
    "--head",
    branch,
    "--title",
    title,
    "--body",
    body,
  ], { cwd: repository });
}

function updatePullRequestBody({ url, body, repository }) {
  gh([
    "pr",
    "edit",
    url,
    "--body",
    body,
  ], { cwd: repository });
}

function pullRequestNumber(url) {
  const match = String(url || "").match(/\/pull\/([1-9]\d*)(?:[/?#]|$)/u);
  if (!match) throw new Error(`Expected an ownership pull request URL, received ${url || "missing"}.`);
  return Number(match[1]);
}

function lsRemoteHead({ repository, branch }) {
  const line = gitText([
    "ls-remote",
    "--heads",
    "origin",
    `refs/heads/${branch}`,
  ], { cwd: repository });
  return line.split(/\s+/u)[0] || "";
}

function git(args, { cwd }) {
  execFileSync("git", args, { cwd, stdio: "inherit" });
}

function gitText(args, { cwd }) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
  }).trim();
}

function gitExitCode(args, { cwd }) {
  try {
    execFileSync("git", args, { cwd, stdio: "ignore" });
    return 0;
  } catch (error) {
    return Number(error?.status || 1);
  }
}

function gh(args, { cwd }) {
  execFileSync("gh", args, { cwd, stdio: "inherit" });
}

function ghText(args, { cwd }) {
  return execFileSync("gh", args, {
    cwd,
    encoding: "utf8",
  }).trim();
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, filePath);
}
