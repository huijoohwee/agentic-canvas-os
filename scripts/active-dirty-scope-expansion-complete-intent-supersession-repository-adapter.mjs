// Responsibility: Prove PR844's live terminal fence and atomically archive-and-seed its registry intent.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

import { buildActiveDirtyScopeExpansionPlan }
  from "./active-dirty-scope-expansion-contract.mjs";
import { captureActiveOwnedDirtEvidence }
  from "./active-owned-dirt-recovery-evidence.mjs";
import { captureActiveDirtyScopeExpansionProtectedMain }
  from "./active-dirty-scope-expansion-protected-main.mjs";
import {
  COMPLETE_INTENT_SUPERSESSION_ARCHIVES_KEY,
  COMPLETE_INTENT_SUPERSESSION_RECEIPTS_KEY,
  OPERATION,
  authorizeCompleteIntentSupersession,
  buildCompleteIntentSupersessionEvidence,
  buildCompleteIntentSupersessionPlan,
  buildCompleteIntentSupersessionResult,
  buildScopeExpansionCompleteIntentArchive,
  buildSeededScopeExpansionIntent,
  buildSeededScopeExpansionIntentReceipt,
  classifyCompleteIntentSupersessionRegistryState,
  normalizeCompleteIntentSupersessionPlan,
} from "./active-dirty-scope-expansion-complete-intent-supersession-contract.mjs";
import { canonicalJson, digestValue }
  from "./cloud-collaboration-primitives.mjs";
import { invokeRepositoryCloudVerifier }
  from "./cloud-collaboration-delivery-verifier.mjs";
import { readOwnershipPullRequest } from "./device-pull-request-state.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import {
  invokeRepositoryCloudAction,
  reconcileAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import { authorizeTaskBoundLeaseMutation }
  from "./task-bound-lane-authority-store.mjs";
import {
  createWriterLeaseStore,
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
} from "./writer-lease-lib.mjs";
import { writerLeaseBodyRemainder }
  from "./orphaned-task-authority-recovery-evidence.mjs";
import {
  mutateWriterLeaseRegistry,
  readScopeExpansionIntent,
  writerLeaseDigest,
} from "./writer-lease-registry-cas.mjs";
const CURRENT_CLAIM_JOIN_FIELDS = Object.freeze([
  "claimId", "entrySchema", "claimIdentitySchema", "operationReceiptDigest",
  "writeAuthority", "scopeReserved", "actorId", "deviceId", "sessionId", "repositoryId",
  "workItemId", "predecessorClaimId", "canonicalBaseRevision", "laneRevision",
  "declaredWriteScope", "writeSetDigest", "leaseEpoch", "transitionCounter", "heartbeatCounter",
  "reviewRequestId", "expiresAt", "fenceRevision", "transitionDigest",
]);

export function createCompleteIntentSupersessionRepositoryController(
  options = {},
  dependencies = {},
) {
  const runtime = dependencies.runtime || createRuntime(options, dependencies);
  return Object.freeze({
    async plan() {
      const replay = await runtime.readReplay();
      if (replay) return replay.plan;
      const plan = buildCompleteIntentSupersessionPlan({ evidence: await runtime.inspect() });
      runtime.assertReady(plan);
      return plan;
    },
    async run({ authorization } = {}) {
      const replay = await runtime.readReplay();
      if (replay) {
        authorizeCompleteIntentSupersession({ plan: replay.plan, authorization });
        return replay.result;
      }
      const plan = buildCompleteIntentSupersessionPlan({ evidence: await runtime.inspect() });
      runtime.assertReady(plan);
      const authorizationReceipt = authorizeCompleteIntentSupersession({ plan, authorization });
      return runtime.supersede({ plan, authorizationReceipt });
    },
  });
}

export const createActiveDirtyScopeExpansionCompleteIntentSupersessionRepositoryController =
  createCompleteIntentSupersessionRepositoryController;

export function assertCompleteIntentSupersessionExternalCapability({
  capabilityPath,
  repositoryRoots,
}) {
  for (const root of repositoryRoots) {
    const relative = path.relative(root, capabilityPath);
    if (relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative))) {
      throw new Error("Task authority capability must remain outside every repository worktree and Git common directory.");
    }
  }
  return capabilityPath;
}

export function canonicalizeCompleteIntentSupersessionCurrentClaim({
  authority,
  verifiedClaims,
  rawClaims,
}) {
  const verified = verifiedClaims?.filter(claim => claim?.claimId === authority?.claimId) || [];
  const raw = rawClaims?.filter(claim => claim?.claimId === authority?.claimId) || [];
  const project = claim => Object.fromEntries(
    CURRENT_CLAIM_JOIN_FIELDS.map(field => [field, claim?.[field]]),
  );
  if (verified.length !== 1 || raw.length !== 1
    || authority?.state !== "active" || verified[0].state !== "active"
    || raw[0].state !== "current"
    || canonicalJson(project(verified[0])) !== canonicalJson(project(raw[0]))) {
    invalid("verified active/raw current claim equivalence");
  }
  return Object.freeze({ ...verified[0], state: "current" });
}

export function applyCompleteIntentSupersession({
  leaseStore,
  branch,
  plan,
  authorizationReceipt,
  taskAuthorityReceipt = null,
}) {
  const normalized = normalizeCompleteIntentSupersessionPlan(plan);
  if (branch !== normalized.evidence.lease.branch) invalid("registry branch plan join");
  const expectedLeaseDigest = normalized.evidence.leaseDigest;
  const expectedClaimId = normalized.evidence.currentClaim.claimId;
  const applied = mutateWriterLeaseRegistry({
    leaseStore,
    branch,
    expectedLeaseDigest,
    expectedClaimId,
    action: ({ registry, lease }) => {
      const archives = history(registry, COMPLETE_INTENT_SUPERSESSION_ARCHIVES_KEY, branch);
      const receipts = history(registry, COMPLETE_INTENT_SUPERSESSION_RECEIPTS_KEY, branch);
      const currentIntent = registry.scopeExpansionIntents?.[branch] ?? null;
      const state = classifyCompleteIntentSupersessionRegistryState({
        plan: normalized,
        currentIntent,
        archives,
        receipts,
      });
      if (state.state === "replay") {
        return {
          registry,
          lease,
          intent: { archive: state.archive, seedReceipt: state.seedReceipt, replayed: true },
          changed: false,
        };
      }
      if (!taskAuthorityReceipt || !authorizationReceipt) {
        throw new Error("Complete-intent supersession requires fresh authorization receipts.");
      }
      const archive = buildScopeExpansionCompleteIntentArchive({
        plan: normalized,
        authorizationReceipt,
        taskAuthorityReceipt,
        priorArchiveDigest: archives.at(-1)?.archiveDigest ?? null,
      });
      const seedReceipt = buildSeededScopeExpansionIntentReceipt({
        plan: normalized,
        archive,
        taskAuthorityReceipt,
        registryRevision: Number(registry.revision || 0) + 1,
      });
      const seededIntent = buildSeededScopeExpansionIntent({ plan: normalized });
      return {
        registry: {
          ...registry,
          scopeExpansionIntents: {
            ...(registry.scopeExpansionIntents || {}),
            [branch]: seededIntent,
          },
          [COMPLETE_INTENT_SUPERSESSION_ARCHIVES_KEY]: {
            ...(registry[COMPLETE_INTENT_SUPERSESSION_ARCHIVES_KEY] || {}),
            [branch]: [...archives, archive],
          },
          [COMPLETE_INTENT_SUPERSESSION_RECEIPTS_KEY]: {
            ...(registry[COMPLETE_INTENT_SUPERSESSION_RECEIPTS_KEY] || {}),
            [branch]: [...receipts, seedReceipt],
          },
        },
        lease,
        intent: { archive, seedReceipt, replayed: false },
        changed: true,
      };
    },
  });
  return buildCompleteIntentSupersessionResult({
    plan: normalized,
    archive: applied.intent.archive,
    seedReceipt: applied.intent.seedReceipt,
    replayed: applied.intent.replayed,
  });
}

function createRuntime(options, dependencies) {
  const sourceRepository = (dependencies.realpath || realpathSync)(
    path.resolve(required(options.sourceRepository, "source repository")),
  );
  const sessionId = required(options.sessionId, "session");
  const pullRequestNumber = positive(options.pullRequestNumber, "pull request number");
  const targetManifest = options.targetManifest;
  if (options.taskAuthorityFile && !path.isAbsolute(options.taskAuthorityFile)) {
    throw new Error("Task authority capability path must be absolute.");
  }
  const taskAuthorityFile = options.taskAuthorityFile
    ? (dependencies.realpath || realpathSync)(options.taskAuthorityFile)
    : null;
  const execute = dependencies.execute || ((command, argumentsList) => execFileSync(
    command,
    argumentsList,
    { cwd: sourceRepository, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ));
  const git = dependencies.git
    || (argumentsList => String(execute("git", argumentsList)).trim());
  const gh = dependencies.gh
    || (argumentsList => String(execute("gh", argumentsList)).trim());
  const now = dependencies.now || (() => new Date());
  const invoke = dependencies.invoke || invokeRepositoryCloudAction;
  const verify = dependencies.verify || invokeRepositoryCloudVerifier;
  const commonDirectory = path.resolve(sourceRepository, git(["rev-parse", "--git-common-dir"]));
  if (taskAuthorityFile) {
    const realpath = dependencies.realpath || realpathSync;
    const worktrees = git(["worktree", "list", "--porcelain", "-z"]).split("\0")
      .filter(field => field.startsWith("worktree ")).map(field => realpath(field.slice(9)));
    assertCompleteIntentSupersessionExternalCapability({
      capabilityPath: taskAuthorityFile,
      repositoryRoots: [realpath(commonDirectory), ...worktrees],
    });
  }
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    taskAuthorityFile,
    taskAuthorityPolicy: "projected",
  });

  function branchName() {
    const branch = required(git(["branch", "--show-current"]), "checked-out branch");
    const registered = assertRegisteredWorktree({
      cwd: sourceRepository,
      porcelain: git(["worktree", "list", "--porcelain", "-z"]),
    });
    if (registered.branch !== `refs/heads/${branch}`) invalid("registered source branch");
    return branch;
  }

  function currentLease(branch) {
    const lease = leaseStore.read(branch);
    if (lease?.status !== "active" || lease.sessionId !== sessionId
      || realpathSync(lease.worktreePath) !== sourceRepository
      || lease.admission?.status !== "admitted"
      || lease.cloudAuthority?.state !== "active"
      || lease.cloudAuthority?.mutationAuthorityEligible !== true
      || !lease.taskAuthority?.bindingDigest
      || Date.parse(lease.expiresAt) <= now().getTime()) {
      invalid("current admitted mutation-authority lease");
    }
    return lease;
  }

  function pullRequest(branch, lease, repository) {
    const pull = readOwnershipPullRequest({ url: lease.pullRequestUrl, branch, ghText: gh });
    const details = JSON.parse(gh([
      "pr", "view", String(pullRequestNumber), "--json",
      "id,number,url,state,isDraft,headRefName,headRefOid,headRepository,baseRefName,baseRefOid,body,autoMergeRequest",
    ]));
    if (details.url !== pull.url || details.number !== pullRequestNumber
      || details.state !== "OPEN" || details.isDraft !== true
      || details.headRefName !== branch || details.headRefOid !== lease.fenceSha
      || details.headRepository?.nameWithOwner !== repository.nameWithOwner
      || details.autoMergeRequest !== null) invalid("exact open draft pull request");
    const marker = parseWriterLeasePullRequestBody(details.body);
    if (canonicalJson(marker) !== canonicalJson(projectWriterLeasePullRequestMarker(lease))) {
      invalid("exact pull-request writer marker");
    }
    return {
      targetRepository: repository.nameWithOwner,
      repositoryId: `github-repository:${repository.id}`,
      number: details.number,
      nodeId: details.id,
      url: details.url,
      state: details.state,
      isDraft: details.isDraft,
      autoMergeRequest: details.autoMergeRequest,
      headRepository: details.headRepository.nameWithOwner,
      headRepositoryId: details.headRepository.id,
      headRefName: details.headRefName,
      headRefOid: details.headRefOid,
      baseRefName: details.baseRefName,
      baseRefOid: details.baseRefOid,
      bodyDigest: digestValue(details.body),
      writerMarker: marker,
      writerMarkerDigest: digestValue(marker),
      bodyRemainderDigest: digestValue(writerLeaseBodyRemainder(details.body)),
    };
  }

  function dirt() {
    return captureActiveOwnedDirtEvidence({ repository: sourceRepository });
  }

  function currentClaim(lease, branch) {
    let rawStatus = null;
    const reconciled = reconcileAdmissionCloudAuthority({
      authority: lease.cloudAuthority,
      manifest: lease.admission,
      branch,
      headSha: lease.fenceSha,
      pullRequestNumber,
      inspect: request => {
        const result = invoke(request);
        if (request?.action === "status") rawStatus = result;
        return result;
      },
      verify,
    });
    const authority = reconciled.authority;
    if (authority.claimDigest !== lease.cloudAuthority.claimDigest
      || authority.claimLedgerRevision !== lease.cloudAuthority.claimLedgerRevision
      || authority.transitionCounter !== lease.cloudAuthority.transitionCounter
      || authority.operationReceiptDigest !== lease.cloudAuthority.operationReceiptDigest
      || authority.expiresAt !== lease.cloudAuthority.expiresAt
      || authority.state !== "active") invalid("stable current cloud claim");
    return canonicalizeCompleteIntentSupersessionCurrentClaim({
      authority,
      verifiedClaims: reconciled.verification.inventory.claims,
      rawClaims: rawStatus?.claims,
    });
  }

  function capture() {
    if ((dependencies.realpath || realpathSync)(git(["rev-parse", "--show-toplevel"]))
      !== sourceRepository) invalid("exact source worktree root");
    const branch = branchName();
    const lease = currentLease(branch);
    const repository = JSON.parse(gh(["repo", "view", "--json", "id,nameWithOwner"]));
    const pull = pullRequest(branch, lease, repository);
    const remoteHead = firstSha(git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]));
    if (git(["rev-parse", "HEAD"]) !== lease.fenceSha || remoteHead !== lease.fenceSha) {
      invalid("unchanged local and remote fence");
    }
    const currentDirt = dirt();
    const protectedMainSha = firstSha(git([
      "ls-remote", "--heads", "origin", "refs/heads/main",
    ]));
    const protectedMain = captureActiveDirtyScopeExpansionProtectedMain({
      sourceBaseSha: lease.baseSha,
      pullRequestBaseSha: pull.baseRefOid,
      protectedMainSha,
      targetDeclaredWriteSet: targetManifest.declaredWriteSet,
      gitText: git,
    });
    const claim = currentClaim(lease, branch);
    const source = {
      lease,
      branch,
      fenceSha: lease.fenceSha,
      claimId: lease.cloudAuthority.claimId,
      claimDigest: lease.cloudAuthority.claimDigest,
      changedPaths: currentDirt.entries.map(entry => entry.path),
      untrackedPaths: currentDirt.entries.filter(entry => entry.untracked).map(entry => entry.path),
      dirtyDigest: currentDirt.evidenceDigest,
    };
    const successorPlan = buildActiveDirtyScopeExpansionPlan({
      source,
      targetManifest,
      targetCanonicalBaseSha: pull.baseRefOid,
      canonicalDescendantProof: protectedMain.canonicalDescendantProof,
    });
    return { branch, lease, repository, pull, claim, currentDirt, successorPlan };
  }

  async function inspect() {
    const frame = capture();
    const registry = leaseStore.readRegistry();
    const archives = history(registry, COMPLETE_INTENT_SUPERSESSION_ARCHIVES_KEY, frame.branch);
    const receipts = history(registry, COMPLETE_INTENT_SUPERSESSION_RECEIPTS_KEY, frame.branch);
    return buildCompleteIntentSupersessionEvidence({
      targetRepository: frame.repository.nameWithOwner,
      lease: frame.lease,
      leaseDigest: writerLeaseDigest(frame.lease),
      currentClaim: frame.claim,
      pullRequest: frame.pull,
      dirt: frame.currentDirt,
      sourceIntent: readScopeExpansionIntent({ leaseStore, branch: frame.branch }),
      priorArchiveDigest: archives.at(-1)?.archiveDigest ?? null,
      priorReceiptDigest: receipts.at(-1)?.receiptDigest ?? null,
      targetManifest,
      successorPlan: frame.successorPlan,
    });
  }

  function assertReady(plan) {
    const normalized = normalizeCompleteIntentSupersessionPlan(plan);
    const registry = leaseStore.readRegistry();
    classifyCompleteIntentSupersessionRegistryState({
      plan: normalized,
      currentIntent: registry.scopeExpansionIntents?.[normalized.evidence.lease.branch] ?? null,
      archives: history(registry, COMPLETE_INTENT_SUPERSESSION_ARCHIVES_KEY,
        normalized.evidence.lease.branch),
      receipts: history(registry, COMPLETE_INTENT_SUPERSESSION_RECEIPTS_KEY,
        normalized.evidence.lease.branch),
    });
  }

  async function readReplay() {
    const branch = branchName();
    const registry = leaseStore.readRegistry();
    const archives = history(registry, COMPLETE_INTENT_SUPERSESSION_ARCHIVES_KEY, branch);
    const receipts = history(registry, COMPLETE_INTENT_SUPERSESSION_RECEIPTS_KEY, branch);
    const archive = archives.at(-1);
    if (!archive?.planSnapshot) return null;
    const plan = normalizeCompleteIntentSupersessionPlan(archive.planSnapshot);
    if (plan.evidence.targetManifest.manifestDigest !== targetManifest.manifestDigest
      || plan.evidence.targetManifest.writeSetDigest !== targetManifest.writeSetDigest) {
      invalid("replay target manifest");
    }
    const state = classifyCompleteIntentSupersessionRegistryState({
      plan,
      currentIntent: registry.scopeExpansionIntents?.[branch] ?? null,
      archives,
      receipts,
    });
    if (state.state !== "replay") return null;
    verifyExternalEvidence(plan.evidence, capture());
    return {
      plan,
      result: buildCompleteIntentSupersessionResult({
        plan,
        archive: state.archive,
        seedReceipt: state.seedReceipt,
        replayed: true,
      }),
    };
  }

  async function supersede({ plan, authorizationReceipt }) {
    if (!taskAuthorityFile) {
      throw new Error("Complete-intent supersession run requires --task-authority.");
    }
    const refreshed = buildCompleteIntentSupersessionPlan({ evidence: await inspect() });
    if (canonicalJson(refreshed) !== canonicalJson(plan)) invalid("live plan after authorization");
    const branch = refreshed.evidence.lease.branch;
    const lease = currentLease(branch);
    const taskAuthorityReceipt = authorizeTaskBoundLeaseMutation({
      lease,
      capabilityPath: taskAuthorityFile,
      operation: OPERATION,
      now: now(),
    });
    const result = applyCompleteIntentSupersession({
      leaseStore,
      branch,
      plan: refreshed,
      authorizationReceipt,
      taskAuthorityReceipt,
    });
    const replay = await readReplay();
    if (!replay || replay.result.receiptDigest !== result.receiptDigest) {
      invalid("durable replay after registry CAS");
    }
    return result;
  }

  return { inspect, assertReady, readReplay, supersede };
}

function verifyExternalEvidence(evidence, frame) {
  const observed = {
    targetRepository: frame.repository.nameWithOwner,
    leaseDigest: writerLeaseDigest(frame.lease),
    currentClaim: frame.claim,
    pullRequest: frame.pull,
    dirt: frame.currentDirt,
    successorPlan: frame.successorPlan,
  };
  const expected = {
    targetRepository: evidence.targetRepository,
    leaseDigest: evidence.leaseDigest,
    currentClaim: evidence.currentClaim,
    pullRequest: evidence.pullRequest,
    dirt: evidence.dirt,
    successorPlan: evidence.successorPlan,
  };
  if (canonicalJson(observed) !== canonicalJson(expected)) {
    invalid("zero-effect replay evidence");
  }
}

function history(registry, key, branch) {
  const value = registry?.[key]?.[branch] ?? [];
  if (!Array.isArray(value)) invalid("append-only registry history");
  return value;
}

function firstSha(value) {
  const sha = String(value || "").trim().split(/\s+/u)[0];
  if (!/^[0-9a-f]{40}$/u.test(sha)) invalid("remote Git SHA");
  return sha;
}

function required(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label);
  return value.trim();
}

function positive(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) invalid(label);
  return number;
}

function invalid(label) {
  throw new Error(`Complete-intent supersession requires exact ${label}.`);
}
