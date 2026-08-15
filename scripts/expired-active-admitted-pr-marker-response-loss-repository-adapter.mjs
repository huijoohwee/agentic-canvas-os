// Responsibility: Join one sealed expired lane to a marker-only provider repair.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  digestValue,
} from "./cloud-collaboration-primitives.mjs";
import { normalizeActiveAdmittedPrMarkerResponseLossPlan }
  from "./active-admitted-pr-marker-response-loss-contract.mjs";
import {
  buildExpiredActiveAdmittedPrMarkerResponseLossEvidence,
  normalizeExpiredActiveAdmittedPrMarkerResponseLossEvidence,
} from "./expired-active-admitted-pr-marker-response-loss-evidence.mjs";
import {
  normalizeExpiredActiveAdmittedPrMarkerResponseLossIntent,
  normalizeExpiredActiveAdmittedPrMarkerResponseLossPlan,
} from "./expired-active-admitted-pr-marker-response-loss-contract.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { authorizeTaskBoundLeaseMutation }
  from "./task-bound-lane-authority-store.mjs";
import {
  createWriterLeaseStore,
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
const PROVIDER_SEMANTICS = "observable-pre-read-edit-post-read";
const PROVIDER_ADAPTER_ID = "github-cli-pull-request-body/v1";
const CLOUD_OBSERVATION_SCHEMA =
  "agentic-expired-active-admitted-pr-marker-cloud-observation/v1";
export function createRepositoryExpiredActiveAdmittedPrMarkerResponseLossAdapter(
  options = {},
  dependencies = {},
) {
  const resolveRealpath = dependencies.realpath || realpathSync;
  const repository = resolveRealpath(path.resolve(required(options.repository, "repository")));
  const pullRequestNumber = positive(options.pullRequestNumber, "pull-request number");
  const planningPredecessor = options.predecessorPlan
    ? normalizeActiveAdmittedPrMarkerResponseLossPlan(options.predecessorPlan)
    : null;
  const taskAuthorityFile = options.taskAuthorityFile
    ? resolveRealpath(path.resolve(options.taskAuthorityFile))
    : null;
  const environment = dependencies.environment || process.env;
  const execute = dependencies.execute || ((command, argumentsList) => execFileSync(
    command,
    argumentsList,
    {
      cwd: repository,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  ));
  const git = dependencies.git
    || (argumentsList => String(execute("git", argumentsList)).trim());
  const gh = dependencies.gh
    || (argumentsList => String(execute("gh", argumentsList)).trim());
  const now = dependencies.now || (() => new Date());
  const authorizeTaskMutation = dependencies.authorizeTaskMutation
    || authorizeTaskBoundLeaseMutation;
  const readCloudStatus = dependencies.readCloudStatus || (({
    ledgerRepository,
    targetRepository,
  }) => invokeRepositoryCloudAction({
    action: "status",
    ledgerRepository,
    request: { targetRepository },
    environment,
  }));
  const uuid = dependencies.randomUUID || randomUUID;
  const branch = required(git(["branch", "--show-current"]), "attached branch");
  const commonDirectory = resolveRealpath(path.resolve(
    repository,
    git(["rev-parse", "--git-common-dir"]),
  ));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    taskAuthorityPolicy: "projected",
  });
  const journalDirectory = path.join(
    commonDirectory,
    "agentic-canvas-os",
    "expired-active-admitted-pr-marker-response-loss",
  );
  const operationId = digestValue({ branch, pullRequestNumber });
  const statePath = path.join(journalDirectory, `${operationId}.json`);
  const operationLockPath = path.join(journalDirectory, `${operationId}.lock`);
  const writerLockPath = path.join(commonDirectory, "agentic-canvas-os", "writer-leases.lock");
  const readLedgerSnapshot = dependencies.readLedgerSnapshot || (({
    ledgerRepository,
    revision,
  }) => {
    const raw = gh([
      "api", "--method", "GET",
      `repos/${ledgerRepository}/contents/.agentic/collaboration-ledger.json`,
      "-f", `ref=${revision}`,
      "-H", "Accept: application/vnd.github.raw+json",
    ]);
    return Object.freeze({ revision, ledger: parseJson(raw, "collaboration ledger") });
  });

  function readLease() {
    const value = leaseStore.read(branch);
    if (!value || value.schema !== "agentic-writer-lease/v2"
      || value.status !== "active" || value.branch !== branch
      || path.resolve(value.worktreePath || "") !== repository
      || value.admission?.status !== "admitted" || !value.taskAuthority
      || !value.cloudAuthority
      || value.pullRequestUrl?.split("/").at(-1) !== String(pullRequestNumber)) {
      invalid("expired admitted task-bound lease");
    }
    return value;
  }
  function readProviderReview() {
    const value = parseJson(gh([
      "pr", "view", String(pullRequestNumber), "--json",
      "number,id,url,state,isDraft,headRefName,headRefOid,headRepository,"
        + "baseRefName,baseRefOid,autoMergeRequest,body",
    ]), "provider review");
    if (value.number !== pullRequestNumber || typeof value.body !== "string") {
      invalid("provider review identity");
    }
    return value;
  }
  function capture(plan = null) {
    const sealedPlan = plan
      ? normalizeExpiredActiveAdmittedPrMarkerResponseLossPlan(plan)
      : null;
    const predecessorPlan = sealedPlan
      ? normalizeActiveAdmittedPrMarkerResponseLossPlan(
        sealedPlan.evidence.predecessorPlanSnapshot,
      )
      : requirePlanningPredecessor(planningPredecessor);
    const currentLease = readLease();
    const predecessor = predecessorPlan.evidence;
    if (writerLeaseDigest(currentLease) !== predecessor.lease.leaseDigest
      || digestValue(currentLease.cloudAuthority) !== predecessor.lease.cloudAuthorityDigest
      || currentLease.taskAuthority.bindingDigest
        !== predecessor.lease.taskAuthorityBindingDigest) {
      invalid("unchanged expired lease");
    }

    const review = readProviderReview();
    const currentMarker = parseWriterLeasePullRequestBody(review.body);
    if (!currentMarker) invalid("provider writer marker");
    const currentBodyDigest = digestValue(review.body);
    const currentMarkerDigest = digestValue(currentMarker);
    const targetMarkerDigest = digestValue(projectWriterLeasePullRequestMarker(currentLease));
    if (targetMarkerDigest !== predecessor.providerReview.targetMarkerDigest) {
      invalid("sealed target marker");
    }
    const providerState = classifyProviderState({
      currentBodyDigest,
      currentMarkerDigest,
      providerReview: predecessor.providerReview,
    });

    const registered = assertRegisteredWorktree({
      cwd: repository,
      porcelain: git(["worktree", "list", "--porcelain", "-z"]),
    });
    const headSha = sha(git(["rev-parse", "HEAD"]), "HEAD");
    const treeSha = sha(git(["rev-parse", "HEAD^{tree}"]), "tree");
    const remoteHeadSha = remoteHead(git, branch);
    const protectedMainSha = sha(git(["rev-parse", "origin/main"]), "protected main");
    const status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
    const repositoryName = required(gh([
      "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner",
    ]), "repository identity");
    const headRepository = required(review.headRepository?.nameWithOwner, "head repository");
    if (registered.branch !== `refs/heads/${branch}` || registered.head !== headSha
      || status !== "" || remoteHeadSha !== headSha || review.headRefOid !== headSha
      || review.headRefName !== branch || headRepository !== repositoryName
      || review.baseRefName !== "main" || review.state !== "OPEN"
      || review.isDraft !== true || review.autoMergeRequest !== null
      || review.url !== currentLease.pullRequestUrl || currentLease.fenceSha !== headSha
      || currentLease.cloudAuthority.targetRepository !== repositoryName
      || repositoryName !== predecessor.repository) {
      invalid("joined local and provider projection");
    }

    const observedAt = instant(now(), "observation time");
    let liveCloud = captureCloud({
      currentLease,
      observedAt,
      readCloudStatus,
    });
    const ledgerRepository = required(
      currentLease.cloudAuthority.ledgerRepository,
      "ledger repository",
    );
    const currentLedgerSnapshot = readLedgerSnapshot({
      ledgerRepository,
      revision: liveCloud.ledgerRevision,
    });
    liveCloud = attachRecordedStates(liveCloud, currentLedgerSnapshot.ledger);
    const evidence = buildExpiredActiveAdmittedPrMarkerResponseLossEvidence({
      predecessorPlan,
      repository: repositoryName,
      observedAt,
      currentLedgerSnapshot,
      liveCloud,
      worktree: {
        identityDigest: digestValue({ path: repository, ...registered }),
        branch,
        headSha,
        treeSha,
        remoteHeadSha,
        protectedMainSha,
        statusDigest: digestValue(status),
        registered: true,
        clean: true,
      },
      lease: leaseEvidence(currentLease),
      providerReview: {
        adapterId: PROVIDER_ADAPTER_ID,
        id: required(review.id, "provider review ID"),
        url: review.url,
        state: review.state.toLowerCase(),
        draft: review.isDraft,
        autoDeliveryAbsent: review.autoMergeRequest === null,
        headRepository,
        headBranch: review.headRefName,
        headSha: review.headRefOid,
        baseBranch: review.baseRefName,
        baseSha: review.baseRefOid,
        sourceBodyDigest: predecessor.providerReview.sourceBodyDigest,
        sourceMarkerDigest: predecessor.providerReview.sourceMarkerDigest,
        targetBodyDigest: predecessor.providerReview.targetBodyDigest,
        targetMarkerDigest: predecessor.providerReview.targetMarkerDigest,
        currentBodyDigest,
        currentMarkerDigest,
        providerState,
        mutationSemantics: PROVIDER_SEMANTICS,
      },
    });
    if (sealedPlan && digestValue(stableEvidence(evidence))
      !== digestValue(stableEvidence(sealedPlan.evidence))) {
      invalid("plan-bound expired recovery subject drift");
    }
    return Object.freeze({
      evidence,
      currentLease,
      review,
      providerState,
      currentBodyDigest,
    });
  }
  return Object.freeze({
    readPlanEvidence() {
      return capture().evidence;
    },
    async withOperationLock(callback) {
      if (typeof callback !== "function") invalid("operation lock callback");
      ensureJournalDirectory();
      const operationLock = acquireLock(operationLockPath, uuid());
      let writerLock;
      try {
        writerLock = acquireLock(writerLockPath, uuid());
        return await callback();
      } finally {
        if (writerLock) releaseLock(writerLockPath, writerLock);
        releaseLock(operationLockPath, operationLock);
      }
    },
    readIntent() {
      if (!existsSync(statePath)) return null;
      requirePrivateFile(statePath, "journal");
      return normalizeExpiredActiveAdmittedPrMarkerResponseLossIntent(
        parseJson(readFileSync(statePath, "utf8"), "journal"),
      );
    },
    writeIntent({ expected, value }) {
      const normalized = normalizeExpiredActiveAdmittedPrMarkerResponseLossIntent(value);
      const current = existsSync(statePath)
        ? normalizeExpiredActiveAdmittedPrMarkerResponseLossIntent(
          parseJson(readFileSync(statePath, "utf8"), "journal"),
        )
        : null;
      const expectedValue = expected
        ? normalizeExpiredActiveAdmittedPrMarkerResponseLossIntent(expected)
        : null;
      if (digestValue(current) !== digestValue(expectedValue)) {
        invalid("journal compare-and-swap");
      }
      writePrivateJson(statePath, normalized);
    },
    authorizeTask(plan) {
      const sealedPlan = normalizeExpiredActiveAdmittedPrMarkerResponseLossPlan(plan);
      const observed = capture(sealedPlan);
      if (!taskAuthorityFile) {
        throw new Error("Expired marker response-loss run requires --task-authority.");
      }
      const receipt = authorizeTaskMutation({
        lease: observed.currentLease,
        capabilityPath: taskAuthorityFile,
        operation: sealedPlan.taskAuthorityOperation,
        now: now(),
      });
      return Object.freeze({
        taskAuthorityReceiptDigest: receipt.receiptDigest,
        bindingDigest: observed.currentLease.taskAuthority.bindingDigest,
      });
    },
    revalidate(plan, stage) {
      const sealedPlan = normalizeExpiredActiveAdmittedPrMarkerResponseLossPlan(plan);
      const observed = capture(sealedPlan);
      const projectionDigest = sealedPlan.evidence.providerReview.targetBodyDigest;
      if (stage === "after-provider-error") {
        if (observed.providerState !== "target") {
          invalid("provider response-loss projection");
        }
        return Object.freeze({
          disposition: "adopted-response-loss",
          providerMutation: false,
          providerProjected: true,
          projectionDigest,
        });
      }
      if (!["before-authority", "before-provider"].includes(stage)) {
        invalid("revalidation stage");
      }
      return Object.freeze({
        revalidationDigest: digestValue({
          planDigest: sealedPlan.planDigest,
          stableEvidence: stableEvidence(observed.evidence),
          providerState: observed.providerState,
        }),
        providerState: observed.providerState,
      });
    },
    projectProviderBody(plan) {
      const sealedPlan = normalizeExpiredActiveAdmittedPrMarkerResponseLossPlan(plan);
      const before = capture(sealedPlan);
      let disposition = "adopted-response-loss";
      let providerMutation = false;
      if (before.providerState === "source") {
        const body = updateWriterLeasePullRequestBody(before.review.body, before.currentLease);
        if (digestValue(body) !== sealedPlan.evidence.providerReview.targetBodyDigest) {
          invalid("canonical target body");
        }
        execute("gh", ["pr", "edit", before.review.url, "--body", body]);
        disposition = "projected";
        providerMutation = true;
      }
      const after = readProviderReview();
      const marker = parseWriterLeasePullRequestBody(after.body);
      if (digestValue(after.body) !== sealedPlan.evidence.providerReview.targetBodyDigest
        || digestValue(marker) !== sealedPlan.evidence.providerReview.targetMarkerDigest) {
        invalid("provider post-read target");
      }
      return Object.freeze({
        disposition,
        providerMutation,
        projectionDigest: sealedPlan.evidence.providerReview.targetBodyDigest,
      });
    },
    verifyTerminal(plan) {
      const sealedPlan = normalizeExpiredActiveAdmittedPrMarkerResponseLossPlan(plan);
      const observed = capture(sealedPlan);
      if (observed.providerState !== "target") invalid("terminal provider projection");
      return Object.freeze({
        verificationDigest: digestValue({
          planDigest: sealedPlan.planDigest,
          stableEvidence: stableEvidence(observed.evidence),
          providerProjectionDigest: sealedPlan.evidence.providerReview.targetBodyDigest,
          terminalStatus: "projection-restored-expired",
        }),
      });
    },
  });

  function ensureJournalDirectory() {
    const root = path.join(commonDirectory, "agentic-canvas-os");
    for (const directory of [root, journalDirectory]) {
      if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
      const metadata = lstatSync(directory);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        invalid("journal directory");
      }
    }
  }

  function writePrivateJson(file, value) {
    ensureJournalDirectory();
    const temporary = `${file}.${process.pid}.${uuid()}.tmp`;
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    try {
      renameSync(temporary, file);
      syncDirectory(journalDirectory);
    } catch (error) {
      try { unlinkSync(temporary); } catch {}
      throw error;
    }
    requirePrivateFile(file, "journal");
  }
}
function captureCloud({ currentLease, observedAt, readCloudStatus }) {
  const ledgerRepository = required(
    currentLease.cloudAuthority.ledgerRepository,
    "ledger repository",
  );
  const targetRepository = required(
    currentLease.cloudAuthority.targetRepository,
    "target repository",
  );
  const status = readCloudStatus({ ledgerRepository, targetRepository });
  if (status?.schema !== "agentic-cloud-collaboration-result/v1"
    || status.ok !== true || status.action !== "status" || status.status !== "ready"
    || !Array.isArray(status.claims)) {
    invalid("complete raw cloud status");
  }
  const claims = structuredClone(status.claims);
  const matches = claims.filter(candidate => (
    candidate?.claimId === currentLease.cloudAuthority.claimId
  ));
  if (matches.length !== 1) invalid("dormant claim cardinality");
  const observation = {
    schema: CLOUD_OBSERVATION_SCHEMA,
    ledgerRepository,
    targetRepository,
    evaluatedAt: observedAt,
    ledgerRevision: sha(status.ledgerRevision, "cloud ledger revision"),
    ledgerDigest: digest(status.ledgerDigest, "cloud ledger digest"),
    inventoryDigest: digestValue(claims),
    claimDigest: digestValue(matches[0]),
  };
  return Object.freeze({
    status: "ready",
    evaluatedAt: observedAt,
    ledgerRevision: observation.ledgerRevision,
    ledgerDigest: observation.ledgerDigest,
    inventoryDigest: observation.inventoryDigest,
    verificationReceiptDigest: digestValue(observation),
    claim: matches[0],
    claims,
  });
}

function leaseEvidence(value) {
  return Object.freeze({
    leaseDigest: writerLeaseDigest(value),
    cloudAuthorityDigest: digestValue(value.cloudAuthority),
    admissionDigest: digestValue(value.admission),
    taskAuthorityBindingDigest: value.taskAuthority.bindingDigest,
    cloudClaimId: value.cloudAuthority.claimId,
    cloudTransitionCounter: value.cloudAuthority.transitionCounter,
    cloudHeartbeatCounter: value.cloudAuthority.heartbeatCounter,
    status: value.status,
    admissionStatus: value.admission.status,
    sessionId: value.sessionId,
    deviceId: value.device,
    scope: value.scope,
    branch: value.branch,
    epoch: value.epoch,
    baseSha: value.baseSha,
    fenceSha: value.fenceSha,
    heartbeatAt: value.heartbeatAt,
    expiresAt: value.expiresAt,
    providerReviewUrl: value.pullRequestUrl,
  });
}

function stableEvidence(value) {
  const evidence = structuredClone(
    normalizeExpiredActiveAdmittedPrMarkerResponseLossEvidence(value),
  );
  delete evidence.evidenceDigest;
  delete evidence.observedAt;
  for (const field of [
    "providerState", "currentBodyDigest", "currentMarkerDigest",
    "observedBodyDigest", "observedMarkerDigest",
  ]) delete evidence.providerReview[field];
  for (const field of [
    "evaluatedAt", "ledgerRevision", "ledgerDigest", "inventoryDigest",
    "verificationReceiptDigest", "currentClaimInventoryDigest", "currentClaimCount",
    "unrelatedSuffixEntryCount", "cloudProofDigest",
  ]) delete evidence.cloud[field];
  return evidence;
}

function classifyProviderState({ currentBodyDigest, currentMarkerDigest, providerReview }) {
  if (currentBodyDigest === providerReview.sourceBodyDigest
    && currentMarkerDigest === providerReview.sourceMarkerDigest) return "source";
  if (currentBodyDigest === providerReview.targetBodyDigest
    && currentMarkerDigest === providerReview.targetMarkerDigest) return "target";
  invalid("provider body is neither the sealed source nor target");
}

function attachRecordedStates(liveCloud, ledger) {
  const latest = new Map();
  for (const entry of ledger?.entries || []) latest.set(entry.claimId, entry);
  const claims = liveCloud.claims.map(claim => Object.freeze({
    ...claim,
    recordedState: required(
      latest.get(claim.claimId)?.claimCore?.state,
      "recorded cloud claim state",
    ),
  }));
  const target = claims.filter(claim => claim.claimId === liveCloud.claim.claimId);
  if (target.length !== 1) invalid("recorded target claim cardinality");
  return Object.freeze({ ...liveCloud, claim: target[0], claims });
}

function acquireLock(file, token) {
  let descriptor;
  try {
    descriptor = openSync(file, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    throw new Error("A cooperative writer or marker-recovery operation is already in progress.");
  }
  try {
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token }));
    fsyncSync(descriptor);
  } catch (error) {
    closeSync(descriptor);
    try { unlinkSync(file); } catch {}
    throw error;
  }
  return Object.freeze({ descriptor, token });
}

function releaseLock(file, lock) {
  closeSync(lock.descriptor);
  let owner = null;
  try { owner = parseJson(readFileSync(file, "utf8"), "lock owner"); } catch {}
  if (owner?.token === lock.token) unlinkSync(file);
}

function requirePrivateFile(file, label) {
  const metadata = lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()
    || (metadata.mode & 0o777) !== 0o600) invalid(label);
}

function syncDirectory(directory) {
  const descriptor = openSync(directory, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function requirePlanningPredecessor(value) {
  if (!value) invalid("explicit sealed predecessor plan");
  return value;
}

function remoteHead(git, branch) {
  const output = git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
  const [candidate, reference, extra] = String(output).split(/\s+/u);
  if (extra || reference !== `refs/heads/${branch}`) {
    invalid("remote branch cardinality");
  }
  return sha(candidate, "remote head");
}

function parseJson(value, label) {
  try { return JSON.parse(String(value)); } catch { invalid(label); }
}
function required(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()
    || value.includes("\0")) invalid(label);
  return value;
}
function positive(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) invalid(label);
  return number;
}
function sha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label);
  return value;
}
function digest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label);
  return value;
}
function instant(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) invalid(label);
  return date.toISOString();
}
function invalid(label) {
  throw new Error(
    `Expired active admitted PR marker response-loss repository adapter has invalid ${label}.`,
  );
}
