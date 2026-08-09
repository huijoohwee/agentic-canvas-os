import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  digestValue,
  normalizeWriteSet,
} from "./cloud-collaboration-primitives.mjs";
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
