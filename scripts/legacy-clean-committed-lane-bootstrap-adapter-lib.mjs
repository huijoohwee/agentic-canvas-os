import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  digestValue,
  normalizeWriteSet,
} from "./cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { parseDeviceBranch } from "./writer-lease-lib.mjs";
import {
  readOwnershipPullRequest,
  waitForOwnershipPullRequestHead,
} from "./device-pull-request-state.mjs";
import { verifyProtectedMainRefreshChain } from "./protected-main-refresh-lib.mjs";

export function projectionBaseSha({ headSha, requestBaseSha, worktreePath }) {
  const currentMainSha = gitText(["rev-parse", "origin/main"], { cwd: worktreePath });
  if (gitExitCode(["merge-base", "--is-ancestor", currentMainSha, headSha], { cwd: worktreePath }) === 0) {
    return currentMainSha;
  }
  return requestBaseSha;
}

export function listScopeOwners({ branch, semanticScope, repository }) {
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

export function readCurrentClaims({ request }) {
  return readCurrentClaimInventory({ request }).claims;
}

export function readCurrentClaimInventory({ request }) {
  const result = invokeRepositoryCloudAction({
    action: "status",
    ledgerRepository: request.ledgerRepository,
    request: {
      targetRepository: request.targetRepository,
    },
  });
  const claims = Array.isArray(result?.claims)
    ? result.claims.map(claim => Object.freeze({
      ...claim,
      declaredWriteScope: normalizeWriteSet(claim.declaredWriteScope),
    }))
    : [];
  return Object.freeze({ result, claims: Object.freeze(claims) });
}

export function findRecoverableLegacyBootstrapClaim({
  claims,
  request,
  checkpoint,
  identity,
  canonicalBaseSha,
} = {}) {
  if (
    checkpoint?.schema !== "agentic-legacy-clean-committed-lane-bootstrap-checkpoint/v1"
    || checkpoint.status !== "prepared"
    || checkpoint.identity?.identityDigest !== identity?.identityDigest
    || Object.keys(checkpoint.outputs || {}).length !== 0
  ) return null;
  const declaredWriteScope = normalizeWriteSet(request?.declaredWriteScope);
  const recoveryEvidenceDigest = legacyBootstrapRecoveryEvidenceDigest({
    request,
    identity,
  });
  const matches = (Array.isArray(claims) ? claims : []).filter(claim => {
    const initial = claim.state === "current"
      && claim.transitionCounter === 1
      && claim.heartbeatCounter === 0
      && !claim.recovery;
    const dormantInitial = claim.state === "dormant-preserved"
      && claim.transitionCounter === 1
      && claim.heartbeatCounter === 0
      && !claim.recovery;
    const recovered = ["current", "dormant-preserved"].includes(claim.state)
      && claim.transitionCounter >= 2
      && claim.heartbeatCounter === 0
      && claim.recovery?.evidenceDigest === recoveryEvidenceDigest;
    return (initial || dormantInitial || recovered)
      && claim.writeAuthority === (claim.state === "current")
      && claim.entrySchema === "agentic-cloud-collaboration-entry/v2"
      && claim.claimIdentitySchema === "agentic-cloud-collaboration-entry/v2"
      && /^[0-9a-f]{64}$/u.test(String(claim.claimId || ""))
      && /^[0-9a-f]{64}$/u.test(String(claim.operationReceiptDigest || ""))
      && claim.scopeReserved === true
      && claim.workItemId === pseudonymousIdentifier("work-item", request.branch)
      && claim.deviceId === pseudonymousIdentifier("device", request.deviceId)
      && claim.sessionId === pseudonymousIdentifier("session", request.sessionId)
      && claim.canonicalBaseRevision === canonicalBaseSha
      && claim.laneRevision === canonicalBaseSha
      && claim.writeSetDigest === request.writeSetDigest
      && JSON.stringify(claim.declaredWriteScope) === JSON.stringify(declaredWriteScope)
      && claim.leaseEpoch === 1
      && claim.reviewRequestId === null
      && claim.predecessorClaimId === null
      && claim.integrationReceiptDigest === null
      && claim.integration === null;
  });
  if (matches.length > 1) {
    throw new Error("Legacy bootstrap response-loss recovery found multiple exact candidate claims.");
  }
  return matches[0] || null;
}

export function legacyBootstrapRecoveryEvidenceDigest({ request, identity } = {}) {
  return digestValue({
    schema: "agentic-legacy-clean-committed-lane-bootstrap-response-loss-evidence/v1",
    identityDigest: identity?.identityDigest,
    targetRepository: request?.targetRepository,
    branch: request?.branch,
    baseSha: request?.expectedBaseSha,
    headSha: request?.expectedHeadSha,
    writeSetDigest: request?.writeSetDigest,
  });
}

export function createLegacyBootstrapRecoveryRequest({
  claim,
  request,
  identity,
  ttlSeconds = 1_800,
} = {}) {
  if (claim?.state !== "dormant-preserved") {
    throw new Error("Legacy bootstrap response-loss recovery requires dormant authority.");
  }
  const recoveryEvidenceDigest = legacyBootstrapRecoveryEvidenceDigest({ request, identity });
  return Object.freeze({
    targetRepository: request.targetRepository,
    claimId: claim.claimId,
    expectedFenceRevision: claim.fenceRevision,
    expectedTransitionCounter: claim.transitionCounter,
    mode: "recovery",
    ttlSeconds,
    recoveryEvidenceDigest,
    deviceId: request.deviceId,
    sessionId: request.sessionId,
    idempotencyKey: [
      "legacy-bootstrap-response-loss-recovery",
      claim.claimId,
      recoveryEvidenceDigest,
      claim.transitionCounter,
      claim.fenceRevision,
    ].join(":"),
  });
}

export function requireRecoveredLegacyBootstrapClaim({
  claim,
  sourceClaim,
  request,
  identity,
  canonicalBaseSha,
  now = new Date(),
} = {}) {
  const recoveryEvidenceDigest = legacyBootstrapRecoveryEvidenceDigest({ request, identity });
  if (
    claim?.claimId !== sourceClaim?.claimId
    || claim?.entrySchema !== sourceClaim?.entrySchema
    || claim?.claimIdentitySchema !== sourceClaim?.claimIdentitySchema
    || !/^[0-9a-f]{64}$/u.test(String(claim?.operationReceiptDigest || ""))
    || claim?.state !== "current"
    || claim?.writeAuthority !== true
    || claim?.scopeReserved !== true
    || claim?.transitionCounter !== sourceClaim.transitionCounter + 1
    || claim?.heartbeatCounter !== sourceClaim.heartbeatCounter
    || claim?.fenceRevision === sourceClaim.fenceRevision
    || claim?.transitionDigest === sourceClaim.transitionDigest
    || claim?.actorId !== sourceClaim.actorId
    || claim?.repositoryId !== sourceClaim.repositoryId
    || claim?.workItemId !== sourceClaim.workItemId
    || claim?.deviceId !== sourceClaim.deviceId
    || claim?.sessionId !== sourceClaim.sessionId
    || claim?.recovery?.evidenceDigest !== recoveryEvidenceDigest
    || claim?.canonicalBaseRevision !== canonicalBaseSha
    || claim?.laneRevision !== canonicalBaseSha
    || claim?.writeSetDigest !== request.writeSetDigest
    || JSON.stringify(normalizeWriteSet(claim?.declaredWriteScope))
      !== JSON.stringify(normalizeWriteSet(request.declaredWriteScope))
    || claim?.leaseEpoch !== sourceClaim.leaseEpoch
    || claim?.reviewRequestId !== null
    || claim?.predecessorClaimId !== null
    || claim?.integrationReceiptDigest !== null
    || claim?.integration !== null
    || Date.parse(claim?.expiresAt || "") <= now.getTime()
  ) {
    throw new Error("Recovered legacy bootstrap claim changed its exact response-loss subject.");
  }
  return claim;
}

export function projectRecoveredLegacyBootstrapResult({ statusResult, claim } = {}) {
  return Object.freeze({
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "continue",
    status: "current",
    ledgerRevision: statusResult?.ledgerRevision,
    ledgerDigest: statusResult?.ledgerDigest,
    claim,
    claimDigest: claim?.fenceRevision,
  });
}

export function requireLease({ branch, leaseStore }) {
  const lease = leaseStore.read(branch);
  if (!lease || lease.branch !== branch) {
    throw new Error(`Legacy bootstrap could not find a local writer lease for ${branch}.`);
  }
  return lease;
}

export function nextLeaseEpoch({ branch, leaseStore }) {
  const registry = leaseStore.readRegistry();
  const current = leaseStore.read(branch);
  const highest = Object.values(registry.leases || {})
    .reduce((max, lease) => Math.max(max, Number(lease?.epoch || 0)), 0);
  return Math.max(highest, Number(current?.epoch || 0)) + 1;
}

export function createIdentity({ request, headSha, treeSha, changedPaths }) {
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

export function resolveAuthoredHeadSha({ branch, headSha, leaseStore, worktreePath }) {
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

export function deriveProtectedRefreshSourceHead({ headSha, worktreePath }) {
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

export function persistProjectedOutput({ context, output, stateDir }) {
  const checkpoint = {
    ...context.checkpoint,
    outputs: {
      ...(context.checkpoint?.outputs || {}),
      [phaseName(output.schema)]: output,
    },
  };
  writeJson(checkpointPath({
    identityDigest: context.identity.identityDigest,
    stateDir,
  }), {
    ...checkpoint,
    identity: context.identity,
    schema: context.checkpoint.schema,
    status: context.checkpoint.status,
  });
}

export function checkpointPath({ identityDigest, stateDir }) {
  return path.join(stateDir, `${String(identityDigest || "").trim()}.checkpoint.json`);
}

export function phaseOutput(name, identityDigest, fields) {
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

export function phaseName(schema) {
  return String(schema || "")
    .replace(/^agentic-legacy-bootstrap-/u, "")
    .replace(/\/v1$/u, "");
}

export function listedWorktrees(repository) {
  const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: repository,
    encoding: "utf8",
  });
  return output
    .split(/\r?\n/u)
    .filter(line => line.startsWith("worktree "))
    .map(line => path.resolve(line.slice("worktree ".length).trim()));
}

export function diffPaths({ cwd, from, to }) {
  return gitText(["diff", "--name-only", `${from}..${to}`, "--"], { cwd })
    .split(/\r?\n/u)
    .map(value => value.trim())
    .filter(Boolean)
    .sort();
}

export function findOpenPullRequest({ branch, repository }) {
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

export function ensureDraftOwnershipPullRequest({ url, branch, expectedHeadSha, repository }) {
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

export function createDraftPullRequest({ branch, title, body, repository }) {
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

export function updatePullRequestBody({ url, body, repository }) {
  gh([
    "pr",
    "edit",
    url,
    "--body",
    body,
  ], { cwd: repository });
}

export function pullRequestNumber(url) {
  const match = String(url || "").match(/\/pull\/([1-9]\d*)(?:[/?#]|$)/u);
  if (!match) throw new Error(`Expected an ownership pull request URL, received ${url || "missing"}.`);
  return Number(match[1]);
}

export function lsRemoteHead({ repository, branch }) {
  const line = gitText([
    "ls-remote",
    "--heads",
    "origin",
    `refs/heads/${branch}`,
  ], { cwd: repository });
  return line.split(/\s+/u)[0] || "";
}

export function git(args, { cwd }) {
  execFileSync("git", args, { cwd, stdio: "inherit" });
}

export function gitText(args, { cwd }) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
  }).trim();
}

export function gitExitCode(args, { cwd }) {
  try {
    execFileSync("git", args, { cwd, stdio: "ignore" });
    return 0;
  } catch (error) {
    return Number(error?.status || 1);
  }
}

export function gh(args, { cwd }) {
  execFileSync("gh", args, { cwd, stdio: "inherit" });
}

export function ghText(args, { cwd }) {
  return execFileSync("gh", args, {
    cwd,
    encoding: "utf8",
  }).trim();
}

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, filePath);
}
