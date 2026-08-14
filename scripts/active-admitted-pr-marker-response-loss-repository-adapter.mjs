// Responsibility: Join exact local, ledger, task-capability, and provider-body recovery effects.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  digestValue,
  writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import {
  buildActiveAdmittedPrMarkerResponseLossEvidence,
  normalizeActiveAdmittedPrMarkerResponseLossEvidence,
} from "./active-admitted-pr-marker-response-loss-evidence.mjs";
import {
  normalizeActiveAdmittedPrMarkerResponseLossIntent,
  normalizeActiveAdmittedPrMarkerResponseLossPlan,
} from "./active-admitted-pr-marker-response-loss-contract.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import { verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
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
const ADAPTER_ID = "github-cli-pull-request-body/v1";

export function createRepositoryActiveAdmittedPrMarkerResponseLossAdapter(
  options = {}, dependencies = {},
) {
  const repository = (dependencies.realpath || realpathSync)(path.resolve(
    required(options.repository, "repository"),
  ));
  const pullRequestNumber = positive(options.pullRequestNumber, "pull-request number");
  const taskAuthorityFile = options.taskAuthorityFile
    ? (dependencies.realpath || realpathSync)(path.resolve(options.taskAuthorityFile)) : null;
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
  const git = dependencies.git || (argumentsList => String(execute("git", argumentsList)).trim());
  const gh = dependencies.gh || (argumentsList => String(execute("gh", argumentsList)).trim());
  const now = dependencies.now || (() => new Date());
  const authorizeTaskMutation = dependencies.authorizeTaskMutation
    || authorizeTaskBoundLeaseMutation;
  const verifyCloud = dependencies.verifyCloud || verifyAdmissionCloudAuthority;
  const uuid = dependencies.randomUUID || randomUUID;
  const branch = required(git(["branch", "--show-current"]), "attached branch");
  const commonDirectory = (dependencies.realpath || realpathSync)(path.resolve(
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
    "active-admitted-pr-marker-response-loss",
  );
  const operationId = digestValue({ branch, pullRequestNumber });
  const statePath = path.join(journalDirectory, `${operationId}.json`);
  const operationLockPath = path.join(journalDirectory, `${operationId}.lock`);
  const writerLockPath = path.join(commonDirectory, "agentic-canvas-os", "writer-leases.lock");

  const readLedgerSnapshot = dependencies.readLedgerSnapshot || (({
    ledgerRepository, revision,
  }) => {
    const raw = gh([
      "api", "--method", "GET",
      `repos/${ledgerRepository}/contents/.agentic/collaboration-ledger.json`,
      "-f", `ref=${revision}`,
      "-H", "Accept: application/vnd.github.raw+json",
    ]);
    return Object.freeze({ revision, ledger: parseJson(raw, "collaboration ledger") });
  });

  function lease() {
    const value = leaseStore.read(branch);
    if (!value || value.schema !== "agentic-writer-lease/v2"
      || value.status !== "active" || value.branch !== branch
      || path.resolve(value.worktreePath || "") !== repository
      || value.admission?.status !== "admitted" || !value.taskAuthority
      || !value.cloudAuthority || value.pullRequestUrl?.split("/").at(-1) !== String(pullRequestNumber)) {
      invalid("active admitted task-bound lease");
    }
    return value;
  }

  function providerReview() {
    const value = parseJson(gh([
      "pr", "view", String(pullRequestNumber), "--json",
      "number,id,url,state,isDraft,headRefName,headRefOid,headRepository,baseRefName,baseRefOid,autoMergeRequest,body",
    ]), "provider review");
    if (value.number !== pullRequestNumber || typeof value.body !== "string") {
      invalid("provider review identity");
    }
    return value;
  }

  function cloudEvidence(currentLease) {
    const manifest = {
      manifestDigest: currentLease.admission.manifestDigest,
      declaredWriteSet: currentLease.admission.declaredWriteSet,
      writeSetDigest: currentLease.admission.writeSetDigest,
    };
    const verified = verifyCloud({
      authority: currentLease.cloudAuthority,
      manifest,
      canonicalBaseSha: currentLease.baseSha,
    });
    const verification = verified?.verification;
    const claims = verification?.inventory?.claims;
    if (verification?.status !== "ready" || !Array.isArray(claims)) {
      invalid("cloud verification");
    }
    const matches = claims.filter(candidate => (
      candidate.claimId === currentLease.cloudAuthority.claimId
    ));
    if (matches.length !== 1) invalid("live claim cardinality");
    const target = matches[0];
    const competitors = claims.filter(candidate => candidate.claimId !== target.claimId
      && (candidate.writeAuthority === true || candidate.scopeReserved === true)
      && (candidate.reviewRequestId === target.reviewRequestId
        || overlaps(candidate.declaredWriteScope, target.declaredWriteScope)));
    if (competitors.length) invalid("overlapping live cloud authority");
    return Object.freeze({
      verification,
      liveCloud: Object.freeze({
        status: "ready",
        ledgerRevision: verification.ledgerRevision,
        ledgerDigest: verification.ledgerDigest,
        inventoryDigest: verification.remoteClaimInventoryDigest,
        verificationReceiptDigest: verification.receiptDigest,
        claim: target,
        noOverlappingCompetitor: true,
      }),
    });
  }

  function capture(plan = null) {
    const sealedPlan = plan ? normalizeActiveAdmittedPrMarkerResponseLossPlan(plan) : null;
    const currentLease = lease();
    const review = providerReview();
    const targetMarker = projectWriterLeasePullRequestMarker(currentLease);
    const targetMarkerDigest = digestValue(targetMarker);
    const currentMarker = parseWriterLeasePullRequestBody(review.body);
    if (!currentMarker) invalid("provider writer marker");
    const currentBodyDigest = digestValue(review.body);
    let sourceAuthority;
    let sourceBodyDigest;
    let sourceMarkerDigest;
    let targetBodyDigest;
    if (sealedPlan) {
      sourceAuthority = sourceAuthorityFromPlan(currentLease.cloudAuthority, sealedPlan);
      ({ sourceBodyDigest, sourceMarkerDigest, targetBodyDigest } = sealedPlan.evidence.providerReview);
    } else {
      sourceAuthority = currentMarker.cloudAuthority;
      sourceBodyDigest = currentBodyDigest;
      sourceMarkerDigest = digestValue(currentMarker);
      targetBodyDigest = digestValue(updateWriterLeasePullRequestBody(review.body, currentLease));
    }
    const providerState = currentBodyDigest === sourceBodyDigest
      && digestValue(currentMarker) === sourceMarkerDigest ? "source"
      : currentBodyDigest === targetBodyDigest
        && digestValue(currentMarker) === targetMarkerDigest ? "target"
        : invalid("provider body is neither the sealed source nor target");
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
      || currentLease.cloudAuthority.targetRepository !== repositoryName) {
      invalid("joined local and provider projection");
    }
    const cloud = cloudEvidence(currentLease);
    const ledgerRepository = required(
      currentLease.cloudAuthority.ledgerRepository,
      "ledger repository",
    );
    const sourceSnapshot = readLedgerSnapshot({
      ledgerRepository,
      revision: sourceAuthority.ledgerRevision,
    });
    const targetSnapshot = readLedgerSnapshot({
      ledgerRepository,
      revision: currentLease.cloudAuthority.ledgerRevision,
    });
    const currentSnapshot = readLedgerSnapshot({
      ledgerRepository,
      revision: cloud.verification.ledgerRevision,
    });
    const observedAt = cloud.verification.verifiedAt || now().toISOString();
    const evidence = buildActiveAdmittedPrMarkerResponseLossEvidence({
      repository: repositoryName,
      observedAt,
      sourceAuthority,
      targetAuthority: currentLease.cloudAuthority,
      sourceLedgerSnapshot: sourceSnapshot,
      targetLedgerSnapshot: targetSnapshot,
      currentLedgerSnapshot: currentSnapshot,
      liveCloud: cloud.liveCloud,
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
      lease: {
        leaseDigest: writerLeaseDigest(currentLease),
        cloudAuthorityDigest: digestValue(currentLease.cloudAuthority),
        admissionDigest: digestValue(currentLease.admission),
        taskAuthorityBindingDigest: currentLease.taskAuthority.bindingDigest,
        cloudClaimId: currentLease.cloudAuthority.claimId,
        cloudTransitionCounter: currentLease.cloudAuthority.transitionCounter,
        cloudHeartbeatCounter: currentLease.cloudAuthority.heartbeatCounter,
        status: currentLease.status,
        sessionId: currentLease.sessionId,
        deviceId: currentLease.device,
        scope: currentLease.scope,
        branch,
        epoch: currentLease.epoch,
        baseSha: currentLease.baseSha,
        fenceSha: currentLease.fenceSha,
        heartbeatAt: currentLease.heartbeatAt,
        expiresAt: currentLease.expiresAt,
        providerReviewUrl: currentLease.pullRequestUrl,
      },
      providerReview: {
        adapterId: ADAPTER_ID,
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
        sourceBodyDigest,
        sourceMarkerDigest,
        targetBodyDigest,
        targetMarkerDigest,
        mutationSemantics: PROVIDER_SEMANTICS,
      },
    });
    if (sealedPlan && digestValue(stableEvidence(evidence))
      !== digestValue(stableEvidence(sealedPlan.evidence))) {
      invalid("plan-bound recovery subject drift");
    }
    return Object.freeze({
      evidence,
      currentLease,
      review,
      providerState,
      currentBodyDigest,
      targetMarkerDigest,
      targetBodyDigest,
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
      return normalizeActiveAdmittedPrMarkerResponseLossIntent(
        parseJson(readFileSync(statePath, "utf8"), "journal"),
      );
    },
    writeIntent({ expected, value }) {
      const normalized = normalizeActiveAdmittedPrMarkerResponseLossIntent(value);
      const current = existsSync(statePath)
        ? normalizeActiveAdmittedPrMarkerResponseLossIntent(
          parseJson(readFileSync(statePath, "utf8"), "journal"),
        ) : null;
      const expectedValue = expected
        ? normalizeActiveAdmittedPrMarkerResponseLossIntent(expected) : null;
      if (digestValue(current) !== digestValue(expectedValue)) invalid("journal compare-and-swap");
      writePrivateJson(statePath, normalized);
    },
    authorizeTask(plan) {
      const sealedPlan = normalizeActiveAdmittedPrMarkerResponseLossPlan(plan);
      const observed = capture(sealedPlan);
      if (!taskAuthorityFile) throw new Error("Marker response-loss run requires --task-authority.");
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
      const sealedPlan = normalizeActiveAdmittedPrMarkerResponseLossPlan(plan);
      const observed = capture(sealedPlan);
      const projectionDigest = providerProjectionDigest(sealedPlan, observed);
      if (stage === "after-provider-error") {
        if (observed.providerState !== "target") invalid("provider response-loss projection");
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
      const sealedPlan = normalizeActiveAdmittedPrMarkerResponseLossPlan(plan);
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
      const after = providerReview();
      const marker = parseWriterLeasePullRequestBody(after.body);
      if (digestValue(after.body) !== sealedPlan.evidence.providerReview.targetBodyDigest
        || digestValue(marker) !== sealedPlan.evidence.providerReview.targetMarkerDigest) {
        invalid("provider post-read target");
      }
      return Object.freeze({
        disposition,
        providerMutation,
        projectionDigest: providerProjectionDigest(sealedPlan, {
          ...before,
          providerState: "target",
          currentBodyDigest: digestValue(after.body),
        }),
      });
    },
    verifyTerminal(plan) {
      const sealedPlan = normalizeActiveAdmittedPrMarkerResponseLossPlan(plan);
      const observed = capture(sealedPlan);
      if (observed.providerState !== "target") invalid("terminal provider projection");
      return Object.freeze({
        verificationDigest: digestValue({
          planDigest: sealedPlan.planDigest,
          stableEvidence: stableEvidence(observed.evidence),
          providerProjectionDigest: providerProjectionDigest(sealedPlan, observed),
          terminalStatus: "projection-restored",
        }),
      });
    },
  });

  function ensureJournalDirectory() {
    const root = path.join(commonDirectory, "agentic-canvas-os");
    for (const directory of [root, journalDirectory]) {
      if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
      const metadata = lstatSync(directory);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) invalid("journal directory");
    }
  }
  function writePrivateJson(file, value) {
    ensureJournalDirectory();
    const temporary = `${file}.${process.pid}.${uuid()}.tmp`;
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
      fsyncSync(descriptor);
    } finally { closeSync(descriptor); }
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

function sourceAuthorityFromPlan(targetAuthority, plan) {
  const source = plan.evidence.renewal.source;
  return Object.freeze({
    ...targetAuthority,
    claimDigest: source.claimDigest,
    ledgerRevision: source.ledgerRevision,
    ledgerDigest: source.ledgerDigest,
    claimLedgerRevision: source.claimLedgerRevision,
    operationReceiptDigest: source.operationReceiptDigest,
    transitionCounter: source.transitionCounter,
    heartbeatCounter: source.heartbeatCounter,
    expiresAt: source.expiresAt,
  });
}

function stableEvidence(value) {
  const evidence = structuredClone(normalizeActiveAdmittedPrMarkerResponseLossEvidence(value));
  delete evidence.evidenceDigest;
  delete evidence.observedAt;
  evidence.renewal.current = {
    claimRecordDigest: evidence.renewal.current.claimRecordDigest,
    noOverlappingCompetitor: evidence.renewal.current.noOverlappingCompetitor,
  };
  delete evidence.renewal.renewalProofDigest;
  return evidence;
}

function providerProjectionDigest(plan, observed) {
  return digestValue({
    planDigest: plan.planDigest,
    providerReviewId: plan.evidence.providerReview.id,
    providerBodyDigest: observed.currentBodyDigest,
    providerMarkerDigest: plan.evidence.providerReview.targetMarkerDigest,
    providerState: observed.providerState,
    mutationSemantics: PROVIDER_SEMANTICS,
  });
}

function acquireLock(file, token) {
  let descriptor;
  try { descriptor = openSync(file, "wx", 0o600); }
  catch (error) {
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
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) {
    invalid(label);
  }
}

function syncDirectory(directory) {
  const descriptor = openSync(directory, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function remoteHead(git, branch) {
  const output = git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
  const [candidate, reference, extra] = String(output).split(/\s+/u);
  if (extra || reference !== `refs/heads/${branch}`) invalid("remote branch cardinality");
  return sha(candidate, "remote head");
}

function overlaps(left, right) {
  try { return writeSetsOverlap(left, right); } catch { return true; }
}
function parseJson(value, label) {
  try { return JSON.parse(String(value)); } catch { invalid(label); }
}
function required(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.includes("\0")) {
    invalid(label);
  }
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
function invalid(label) {
  throw new Error(`Active admitted PR marker response-loss repository adapter has invalid ${label}.`);
}
