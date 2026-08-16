// Responsibility: Join one expired planned descendant to a provider-body-only marker repair.
import { execFileSync } from "node:child_process";
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync,
  readFileSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { digestValue, validateLedger } from "./cloud-collaboration-primitives.mjs";
import {
  normalizeExpiredPlannedCommittedPrMarkerResponseLossIntent,
  normalizeExpiredPlannedCommittedPrMarkerResponseLossPlan,
} from "./expired-planned-committed-pr-marker-response-loss-contract.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { authorizeTaskBoundLeaseMutation } from "./task-bound-lane-authority-store.mjs";
import {
  createWriterLeaseStore, parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";

const PROVIDER_SEMANTICS = "observable-pre-read-edit-post-read";
const TRANSITION_FIELDS = Object.freeze([
  "claimDigest", "ledgerRevision", "ledgerDigest", "claimLedgerRevision",
  "operationReceiptDigest", "transitionCounter", "heartbeatCounter", "expiresAt", "state",
]);

export function createRepositoryExpiredPlannedCommittedPrMarkerResponseLossAdapter(
  options = {}, dependencies = {},
) {
  const resolveRealpath = dependencies.realpath || realpathSync;
  const repository = resolveRealpath(path.resolve(required(options.repository, "repository")));
  const pullRequestNumber = positive(options.pullRequestNumber, "pull-request number");
  const sessionId = required(options.sessionId, "session ID");
  const taskAuthorityFile = options.taskAuthorityFile
    ? resolveRealpath(path.resolve(options.taskAuthorityFile)) : null;
  const environment = dependencies.environment || process.env;
  const execute = dependencies.execute || ((command, argumentsList, executionOptions = {}) => (
    execFileSync(command, argumentsList, { cwd: repository, encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...executionOptions })
  ));
  const git = dependencies.git || (argumentsList => String(execute("git", argumentsList)).trim());
  const gh = dependencies.gh || (argumentsList => String(execute("gh", argumentsList)).trim());
  const now = dependencies.now || (() => new Date());
  const authorizeTaskMutation = dependencies.authorizeTaskMutation || authorizeTaskBoundLeaseMutation;
  const readCloudStatus = dependencies.readCloudStatus || (authority => invokeRepositoryCloudAction({
    action: "status", ledgerRepository: authority.ledgerRepository,
    request: { targetRepository: authority.targetRepository }, environment,
  }));
  const branch = required(git(["branch", "--show-current"]), "attached branch");
  const commonDirectory = resolveRealpath(path.resolve(repository,
    git(["rev-parse", "--git-common-dir"])));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory, taskAuthorityPolicy: "projected",
  });
  const journalDirectory = path.join(commonDirectory, "agentic-canvas-os",
    "expired-planned-committed-pr-marker-response-loss");
  const operationId = digestValue({ repository, branch, pullRequestNumber, sessionId });
  const statePath = path.join(journalDirectory, `${operationId}.json`);
  const lockPath = path.join(journalDirectory, `${operationId}.lock`);

  function readLease() {
    const lease = leaseStore.read(branch);
    if (!lease || lease.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
      || lease.admission?.status !== "admitted" || lease.branch !== branch
      || lease.sessionId !== sessionId || path.resolve(lease.worktreePath || "") !== repository
      || !lease.taskAuthority || !lease.cloudAuthority
      || lease.pullRequestUrl?.split("/").at(-1) !== String(pullRequestNumber)
      || Date.parse(lease.expiresAt) > now().getTime()) invalid("expired planned task-bound lease");
    return lease;
  }
  function readReview() {
    const review = json(gh(["pr", "view", String(pullRequestNumber), "--json",
      "number,id,url,state,isDraft,headRefName,headRefOid,headRepository,"
        + "baseRefName,autoMergeRequest,body"]), "provider review");
    if (review.number !== pullRequestNumber || typeof review.body !== "string") {
      invalid("provider review identity");
    }
    return review;
  }
  function verifyLedgerAuthority(authority) {
    const ledger = json(gh(["api", "--method", "GET",
      `repos/${authority.ledgerRepository}/contents/.agentic/collaboration-ledger.json`,
      "-f", `ref=${authority.ledgerRevision}`, "-H", "Accept: application/vnd.github.raw+json"]),
    "collaboration ledger");
    const failures = validateLedger(ledger);
    if (failures.length || ledger.headDigest !== authority.ledgerDigest) invalid("ledger snapshot");
    const entry = ledger.entries.filter(item => item.claimId === authority.claimId).at(-1);
    if (!entry || entry.digest !== authority.claimLedgerRevision
      || entry.claimDigest !== authority.claimDigest
      || entry.claimCore.transitionCounter !== authority.transitionCounter) {
      invalid("authority ledger entry");
    }
  }
  function capture(sealedPlan = null) {
    const lease = readLease();
    const registered = assertRegisteredWorktree({ cwd: repository,
      porcelain: git(["worktree", "list", "--porcelain", "-z"]) });
    const status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
    const headSha = sha(git(["rev-parse", "HEAD"]), "HEAD");
    const treeSha = sha(git(["rev-parse", "HEAD^{tree}"]), "tree");
    const remoteHeadSha = remoteHead();
    const review = readReview();
    const repositoryName = required(gh(["repo", "view", "--json", "nameWithOwner", "--jq",
      ".nameWithOwner"]), "repository identity");
    if (registered.branch !== `refs/heads/${branch}` || registered.head !== headSha || status
      || headSha === lease.fenceSha || remoteHeadSha !== lease.fenceSha
      || gitExit(["merge-base", "--is-ancestor", lease.fenceSha, headSha]) !== 0
      || review.state !== "OPEN" || review.isDraft !== true || review.autoMergeRequest !== null
      || review.headRefName !== branch || review.headRefOid !== lease.fenceSha
      || review.baseRefName !== "main" || review.url !== lease.pullRequestUrl
      || review.headRepository?.nameWithOwner !== repositoryName
      || lease.cloudAuthority.targetRepository !== repositoryName) invalid("joined descendant and review");
    const sourceMarker = parseWriterLeasePullRequestBody(review.body);
    const targetMarker = projectWriterLeasePullRequestMarker(lease);
    if (!sourceMarker?.cloudAuthority
      || digestValue(withoutAuthority(sourceMarker)) !== digestValue(withoutAuthority(targetMarker))) {
      invalid("marker drift outside cloud authority");
    }
    assertPredecessor(sourceMarker.cloudAuthority, lease.cloudAuthority);
    verifyLedgerAuthority(sourceMarker.cloudAuthority);
    verifyLedgerAuthority(lease.cloudAuthority);
    const cloud = readCloudStatus(lease.cloudAuthority);
    const matches = Array.isArray(cloud?.claims)
      ? cloud.claims.filter(item => item.claimId === lease.cloudAuthority.claimId) : [];
    if (cloud?.ok !== true || cloud.action !== "status" || cloud.status !== "ready"
      || matches.length !== 1) invalid("complete cloud status");
    const claim = matches[0];
    assertDormantClaim(claim, lease.cloudAuthority);
    const sourceBody = updateWriterLeasePullRequestBody(review.body, sourceMarker);
    const targetBody = updateWriterLeasePullRequestBody(review.body, lease);
    const sourceBodyDigest = digestValue(sourceBody);
    const targetBodyDigest = digestValue(targetBody);
    const currentBodyDigest = digestValue(review.body);
    const providerState = currentBodyDigest === sourceBodyDigest ? "source"
      : currentBodyDigest === targetBodyDigest ? "target" : invalid("source-or-target body");
    const evidence = {
      schema: "agentic-expired-planned-committed-pr-marker-response-loss-evidence/v1",
      repository: repositoryName, observedAt: now().toISOString(),
      worktree: { identityDigest: digestValue({ repository, ...registered }), branch, headSha,
        treeSha, clean: true, registered: true, fenceAncestorOfHead: true },
      remoteHeadSha,
      lease: { leaseDigest: writerLeaseDigest(lease), status: lease.status,
        admissionStatus: lease.admission.status, branch, baseSha: lease.baseSha,
        fenceSha: lease.fenceSha, expiresAt: lease.expiresAt,
        taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
        cloudAuthority: authorityEvidence(lease.cloudAuthority) },
      providerReview: { id: review.id, url: review.url, state: "open", draft: true,
        headBranch: branch, headSha: review.headRefOid, sourceBodyDigest, targetBodyDigest,
        sourceMarkerDigest: digestValue(sourceMarker), targetMarkerDigest: digestValue(targetMarker),
        providerState, currentBodyDigest, currentMarkerDigest: digestValue(
          providerState === "source" ? sourceMarker : targetMarker), mutationSemantics: PROVIDER_SEMANTICS },
      providerMarker: { stableLeaseDigest: digestValue({ status: lease.status,
        admissionStatus: lease.admission.status, branch, baseSha: lease.baseSha,
        fenceSha: lease.fenceSha, taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest }),
      cloudAuthority: authorityEvidence(sourceMarker.cloudAuthority) },
      cloudClaim: { state: claim.state, writeAuthority: claim.writeAuthority,
        scopeReserved: claim.scopeReserved, claimId: claim.claimId,
        fenceRevision: claim.fenceRevision, transitionDigest: claim.transitionDigest,
        operationReceiptDigest: claim.operationReceiptDigest,
        transitionCounter: claim.transitionCounter, heartbeatCounter: claim.heartbeatCounter ?? 0 },
    };
    if (sealedPlan) {
      const plan = normalizeExpiredPlannedCommittedPrMarkerResponseLossPlan(sealedPlan);
      if (digestValue(stableEvidence(evidence)) !== digestValue(stableEvidence(plan.evidence))) {
        invalid("plan-bound evidence drift");
      }
    }
    return { evidence, lease, review, targetBody, providerState };
  }

  return Object.freeze({
    readPlanEvidence() { return capture().evidence; },
    async withOperationLock(callback) {
      ensureJournalDirectory();
      const descriptor = openSync(lockPath, "wx", 0o600);
      try { return await callback(); } finally { closeSync(descriptor); unlinkSync(lockPath); }
    },
    readIntent() {
      if (!existsSync(statePath)) return null;
      return normalizeExpiredPlannedCommittedPrMarkerResponseLossIntent(
        json(readFileSync(statePath, "utf8"), "journal"));
    },
    writeIntent({ expected, value }) {
      const current = existsSync(statePath)
        ? normalizeExpiredPlannedCommittedPrMarkerResponseLossIntent(
          json(readFileSync(statePath, "utf8"), "journal")) : null;
      if (digestValue(current) !== digestValue(expected)) invalid("journal CAS");
      writePrivateJson(normalizeExpiredPlannedCommittedPrMarkerResponseLossIntent(value));
    },
    authorizeTask(plan) {
      const sealed = normalizeExpiredPlannedCommittedPrMarkerResponseLossPlan(plan);
      const observed = capture(sealed);
      if (!taskAuthorityFile) throw new Error("Marker repair run requires --task-authority.");
      const receipt = authorizeTaskMutation({ lease: observed.lease,
        capabilityPath: taskAuthorityFile, operation: sealed.taskAuthorityOperation, now: now() });
      return { taskAuthorityReceiptDigest: receipt.receiptDigest,
        bindingDigest: observed.lease.taskAuthority.bindingDigest };
    },
    revalidate(plan, stage) {
      const observed = capture(plan);
      if (stage === "after-provider-error") {
        if (observed.providerState !== "target") invalid("provider response-loss target");
        return { providerProjected: true, disposition: "adopted-response-loss",
          providerMutation: false, projectionDigest: plan.evidence.providerReview.targetBodyDigest };
      }
      if (!["before-authority", "before-provider"].includes(stage)) invalid("revalidation stage");
      return { providerState: observed.providerState,
        revalidationDigest: digestValue({ planDigest: plan.planDigest, stage,
          stableEvidence: stableEvidence(observed.evidence) }) };
    },
    projectProviderBody(plan) {
      const observed = capture(plan);
      let disposition = "adopted-response-loss", providerMutation = false;
      if (observed.providerState === "source") {
        editBody(observed.review.url, observed.targetBody);
        disposition = "projected"; providerMutation = true;
      }
      const after = capture(plan);
      if (after.providerState !== "target") invalid("provider target readback");
      return { disposition, providerMutation,
        projectionDigest: plan.evidence.providerReview.targetBodyDigest };
    },
    verifyTerminal(plan) {
      const observed = capture(plan);
      if (observed.providerState !== "target") invalid("terminal provider target");
      return { verificationDigest: digestValue({ planDigest: plan.planDigest,
        stableEvidence: stableEvidence(observed.evidence), terminal: "projection-restored" }) };
    },
  });

  function remoteHead() {
    const lines = git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`])
      .split(/\r?\n/u).filter(Boolean);
    if (lines.length !== 1) invalid("remote branch cardinality");
    return sha(lines[0].split(/\s+/u)[0], "remote head");
  }
  function gitExit(argumentsList) {
    try { execute("git", argumentsList, { stdio: "ignore" }); return 0; }
    catch (error) { return Number.isInteger(error?.status) ? error.status : 1; }
  }
  function editBody(url, body) {
    const directory = mkdtempSync(path.join(os.tmpdir(), "acos-marker-"));
    const bodyFile = path.join(directory, "body.md");
    try {
      writeFileSync(bodyFile, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
      execute("gh", ["pr", "edit", url, "--body-file", bodyFile]);
    } finally { try { unlinkSync(bodyFile); } catch {} try { rmdirSync(directory); } catch {} }
  }
  function ensureJournalDirectory() {
    const root = path.dirname(journalDirectory);
    for (const directory of [root, journalDirectory]) {
      if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
      const metadata = lstatSync(directory);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) invalid("journal directory");
    }
  }
  function writePrivateJson(value) {
    ensureJournalDirectory();
    const temporary = `${statePath}.${process.pid}.tmp`;
    const descriptor = openSync(temporary, "wx", 0o600);
    try { writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(descriptor); }
    finally { closeSync(descriptor); }
    renameSync(temporary, statePath);
  }
}

function authorityEvidence(authority) {
  return { schema: authority.schema, claimId: authority.claimId, claimDigest: authority.claimDigest,
    claimLedgerRevision: authority.claimLedgerRevision,
    operationReceiptDigest: authority.operationReceiptDigest, laneRevision: authority.laneRevision,
    writeSetDigest: authority.writeSetDigest, transitionCounter: authority.transitionCounter,
    heartbeatCounter: authority.heartbeatCounter ?? 0, expiresAt: authority.expiresAt };
}
function assertPredecessor(source, target) {
  if (source.transitionCounter + 1 !== target.transitionCounter
    || ![0, 1].includes((target.heartbeatCounter ?? 0) - (source.heartbeatCounter ?? 0))
    || digestValue(withoutTransitions(source)) !== digestValue(withoutTransitions(target))) {
    invalid("exact N-1 authority predecessor");
  }
}
function assertDormantClaim(claim, authority) {
  if (claim.state !== "dormant-preserved" || claim.writeAuthority !== false
    || claim.scopeReserved !== true || claim.claimId !== authority.claimId
    || claim.transitionCounter !== authority.transitionCounter
    || claim.fenceRevision !== authority.claimDigest
    || claim.transitionDigest !== authority.claimLedgerRevision
    || claim.operationReceiptDigest !== authority.operationReceiptDigest) invalid("dormant current claim");
}
function withoutAuthority(value) { const copy = structuredClone(value); delete copy.cloudAuthority; return copy; }
function withoutTransitions(value) {
  const copy = structuredClone(value);
  for (const field of TRANSITION_FIELDS) delete copy[field];
  return copy;
}
function stableEvidence(value) {
  const copy = structuredClone(value); delete copy.observedAt; delete copy.evidenceDigest;
  for (const field of ["providerState", "currentBodyDigest", "currentMarkerDigest"]) {
    delete copy.providerReview[field];
  }
  return copy;
}
function json(value, label) { try { return JSON.parse(String(value)); } catch { invalid(label); } }
function required(value, label) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) invalid(label);
  return value;
}
function positive(value, label) {
  const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) invalid(label);
  return number;
}
function sha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label); return value;
}
function invalid(label) {
  throw new Error(`Expired planned committed PR marker response-loss adapter has invalid ${label}.`);
}
