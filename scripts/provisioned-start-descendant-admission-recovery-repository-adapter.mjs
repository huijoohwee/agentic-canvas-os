// Responsibility: Join exact Git, provider, cloud, task, and registry recovery effects.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { digestValue, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
import { phaseReceipt, projectProvisionedStartDescendantAdmissionLease }
  from "./provisioned-start-descendant-admission-recovery-contract.mjs";
import { buildProvisionedStartDescendantAdmissionRecoveryEvidence }
  from "./provisioned-start-descendant-admission-recovery-evidence.mjs";
import { bindAdmissionCloudAuthority, invokeRepositoryCloudAction, verifyAdmissionCloudAuthority }
  from "./scoped-lane-cloud-authority.mjs";
import { normalizeDeclaredWriteScopeManifest } from "./scoped-lane-admission-lib.mjs";
import { authorizeTaskBoundLeaseMutation } from "./task-bound-lane-authority-store.mjs";
import { casWriterLeaseProjection } from "./writer-lease-registry-cas.mjs";
import { createWriterLeaseStore, parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody }
  from "./writer-lease-lib.mjs";

const PHASES = ["prepared", "task-authorized", "cloud-bound", "local-projected",
  "marker-projected", "complete"];

export function projectProvisionedStartDescendantAdmissionStableSource(evidence) {
  const { observedAt: _observedAt, evidenceDigest: _evidenceDigest, cloud, ...source } = evidence;
  const { ledgerRevision: _ledgerRevision, ledgerDigest: _ledgerDigest, claim, ...cloudSource } = cloud;
  const stableClaim = ["current", "dormant-preserved"].includes(claim.state)
    ? { ...claim, state: "transition-1-reserved", writeAuthority: false }
    : claim;
  return { ...source, cloud: { ...cloudSource, claim: stableClaim } };
}

export function createProvisionedStartDescendantAdmissionRecoveryRepositoryAdapter(options = {}, dependencies = {}) {
  const repository = realpathSync(path.resolve(required(options.repository, "repository")));
  const sessionId = required(options.sessionId, "session ID");
  const capability = realpathSync(path.resolve(required(options.taskAuthorityFile, "task authority")));
  const controllerRepository = realpathSync(path.resolve(options.controllerRepository
    || path.join(path.dirname(new URL(import.meta.url).pathname), "..")));
  if (capability === repository || capability.startsWith(`${repository}${path.sep}`)) invalid("external task authority");
  const run = dependencies.run || ((command, args, cwd = repository) => execFileSync(command, args,
    { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim());
  const git = dependencies.git || ((args, cwd = repository) => run("git", args, cwd));
  const gh = dependencies.gh || (args => run("gh", args, repository));
  const cloudAction = dependencies.cloudAction || invokeRepositoryCloudAction;
  const bindCloud = dependencies.bindCloud || bindAdmissionCloudAuthority;
  const verifyCloud = dependencies.verifyCloud || verifyAdmissionCloudAuthority;
  const clock = dependencies.clock || (() => new Date());
  const common = realpathSync(path.resolve(repository, git(["rev-parse", "--git-common-dir"])));
  const store = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir: common,
    taskAuthorityFile: capability, taskAuthorityPolicy: "required", now: clock });
  const journalRoot = path.join(common, "agentic-canvas-os",
    "provisioned-start-descendant-admission-recovery");

  function branch() { return required(git(["branch", "--show-current"]), "attached branch"); }
  function sourceLease(operation = "plan") {
    const lease = store.assertTaskAuthority({ branch: branch(), operation: `provisioned-start-descendant-${operation}` });
    if (lease.sessionId !== sessionId || path.resolve(lease.worktreePath) !== repository
      || lease.status !== "active" || lease.admission?.status !== "planned"
      || lease.cloudAuthority?.transitionCounter !== 1) invalid("source lease");
    return lease;
  }
  function manifest(lease) {
    return normalizeDeclaredWriteScopeManifest({ schema: "agentic-declared-write-scope/v1",
      semanticScope: lease.admission.semanticScope,
      paths: lease.admission.declaredWriteSet.filter(item => item.startsWith("path:"))
        .map(item => item.slice(5)) }, { expectedScope: lease.scope });
  }
  function descendant(lease) {
    const status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
    const headSha = git(["rev-parse", "HEAD"]);
    if (status || git(["merge-base", lease.fenceSha, headSha]) !== lease.fenceSha) invalid("clean descendant");
    const shas = git(["rev-list", "--reverse", "--first-parent", `${lease.fenceSha}..${headSha}`])
      .split(/\r?\n/u).filter(Boolean);
    const all = git(["rev-list", "--reverse", `${lease.fenceSha}..${headSha}`]).split(/\r?\n/u).filter(Boolean);
    if (!shas.length || JSON.stringify(shas) !== JSON.stringify(all)) invalid("linear descendant");
    const commits = shas.map(sha => ({ sha, treeSha: git(["show", "-s", "--format=%T", sha]),
      parentSha: git(["show", "-s", "--format=%P", sha]),
      message: git(["show", "-s", "--format=%B", sha]).trim() }));
    if (commits.some(item => item.parentSha.includes(" "))) invalid("merge-free descendant");
    return Object.freeze({ fenceSha: lease.fenceSha, headSha, treeSha: git(["rev-parse", `${headSha}^{tree}`]),
      clean: true, linear: true, paths: git(["diff", "--name-only", lease.fenceSha, headSha])
        .split(/\r?\n/u).filter(Boolean).sort(),
      rangeDiffDigest: digestValue({ patch: git(["diff", "--binary", "--full-index", lease.fenceSha, headSha]) }), commits });
  }
  function pullRequest(lease) {
    const value = JSON.parse(gh(["pr", "view", lease.pullRequestUrl, "--json",
      "id,number,url,state,isDraft,autoMergeRequest,headRefName,headRefOid,baseRefOid,body"]));
    return { body: value.body || "", evidence: Object.freeze({ id: value.id,
      reviewRequestId: `github-pull-request:${value.id}`, number: value.number, url: value.url,
      state: value.state, isDraft: value.isDraft, autoMergeRequest: value.autoMergeRequest,
      branch: value.headRefName, headSha: value.headRefOid, baseSha: value.baseRefOid,
      bodyDigest: digestValue(value.body || "") }) };
  }
  function cloudStatus(lease) {
    const status = cloudAction({ action: "status", ledgerRepository: lease.cloudAuthority.ledgerRepository,
      request: { targetRepository: lease.cloudAuthority.targetRepository }, environment: options.environment || process.env });
    const matches = status?.claims?.filter(item => item.claimId === lease.cloudAuthority.claimId) || [];
    if (status?.ok !== true || status.status !== "ready" || matches.length !== 1) invalid("cloud inventory");
    const claim = matches[0];
    const overlaps = status.claims.filter(item => item.claimId !== claim.claimId
      && (item.writeAuthority === true || item.scopeReserved === true)
      && writeSetsOverlap(item.declaredWriteScope, claim.declaredWriteScope)).map(item => item.claimId).sort();
    return { status, claim, overlaps };
  }
  function controller() {
    const headSha = git(["rev-parse", "HEAD"], controllerRepository);
    if (git(["branch", "--show-current"], controllerRepository) !== "main"
      || headSha !== git(["rev-parse", "origin/main"], controllerRepository)
      || git(["status", "--porcelain=v1", "--untracked-files=all"], controllerRepository)) invalid("protected controller");
    return { repository: controllerRepository, headSha, treeSha: git(["rev-parse", "HEAD^{tree}"], controllerRepository),
      clean: true, protected: true };
  }
  function readEvidence() {
    const lease = sourceLease("plan"), range = descendant(lease), review = pullRequest(lease);
    const cloud = cloudStatus(lease);
    return buildProvisionedStartDescendantAdmissionRecoveryEvidence({ repository: lease.cloudAuthority.targetRepository,
      observedAt: clock().toISOString(), lease, sourceLeaseDigest: digestValue(lease), descendant: range,
      pullRequest: review.evidence, cloud: { ledgerRevision: cloud.status.ledgerRevision,
        ledgerDigest: cloud.status.ledgerDigest, claim: cloud.claim, overlappingClaimIds: cloud.overlaps },
      controller: controller(), mutationBoundary: { "cloud-claim-cas": true,
        "writer-registry-cas": true, "pull-request-marker-cas": true, sourceBytes: false,
        gitRefs: false, draftState: false, merge: false, deployment: false, cleanup: false } });
  }

  function authorizeTask(plan) {
    assertSource(plan);
    const receipt = authorizeTaskBoundLeaseMutation({ lease: sourceLease("authorize"), capabilityPath: capability,
      operation: `provisioned-start-descendant-admission-recovery:${plan.planDigest}`, now: clock() });
    return { receiptDigest: receipt.receiptDigest, bindingDigest: receipt.bindingDigest };
  }

  function bindCloudDescendant(plan) {
    const liveLease = assertStatic(plan);
    let observed = cloudStatus(liveLease);
    if (targetClaim(observed.claim, plan)) return { authority: authorityFrom(observed, plan), adopted: true };
    if (observed.claim.transitionCounter === 1 && observed.claim.state === "dormant-preserved") {
      const recoveryEvidenceDigest = digestValue({ schema: "agentic-provisioned-start-descendant-cloud-recovery/v1",
        planDigest: plan.planDigest, claimId: observed.claim.claimId,
        fenceRevision: observed.claim.fenceRevision, descendantSha: plan.evidence.descendant.headSha });
      cloudAction({ action: "continue", ledgerRepository: plan.evidence.lease.cloudAuthority.ledgerRepository,
        request: { targetRepository: plan.evidence.lease.cloudAuthority.targetRepository,
          claimId: observed.claim.claimId, expectedFenceRevision: observed.claim.fenceRevision,
          expectedTransitionCounter: observed.claim.transitionCounter, mode: "recovery", ttlSeconds: 7200,
          recoveryEvidenceDigest, deviceId: plan.evidence.lease.device, sessionId,
          idempotencyKey: `provisioned-start-descendant-recover:${plan.planDigest}` },
        environment: options.environment || process.env });
      observed = cloudStatus(liveLease);
    }
    if (targetClaim(observed.claim, plan)) return { authority: authorityFrom(observed, plan), adopted: true };
    const authority = authorityFrom(observed, plan);
    try {
      const bound = bindCloud({ authority, manifest: manifest(plan.evidence.lease),
        branch: plan.evidence.lease.branch, headSha: plan.evidence.descendant.headSha,
        pullRequestNumber: plan.evidence.pullRequest.number, deviceId: plan.evidence.lease.device,
        sessionId, idempotencyKey: `provisioned-start-descendant-bind:${plan.planDigest}`,
        environment: options.environment || process.env });
      if (!targetAuthority(bound, plan)) invalid("bound cloud authority");
      return { authority: bound, adopted: false };
    } catch (error) {
      const after = cloudStatus(liveLease);
      if (!targetClaim(after.claim, plan)) throw error;
      return { authority: authorityFrom(after, plan), adopted: true };
    }
  }

  function projectLocal(plan, taskValues, cloudValues) {
    const current = store.read(plan.evidence.lease.branch);
    const projection = projectProvisionedStartDescendantAdmissionLease({ plan,
      authority: cloudValues.authority, taskAuthorityReceiptDigest: taskValues.receiptDigest,
      projectedAt: plan.evidence.observedAt });
    if (digestValue(current) === projection.leaseDigest) return { leaseDigest: projection.leaseDigest,
      preservationReceiptDigest: projection.preservation.receiptDigest, adopted: true };
    if (digestValue(current) !== plan.evidence.sourceLeaseDigest) invalid("local CAS source");
    const result = casWriterLeaseProjection({ leaseStore: store, branch: current.branch,
      expectedLeaseDigest: plan.evidence.sourceLeaseDigest,
      expectedClaimId: plan.evidence.lease.cloudAuthority.claimId,
      values: { admission: projection.admission, integration: projection.integration,
        cloudAuthority: projection.lease.cloudAuthority, heartbeatAt: projection.lease.heartbeatAt,
        expiresAt: projection.lease.expiresAt,
        provisionedStartDescendantAdmissionRecovery: projection.preservation } });
    if (digestValue(result.lease) !== projection.leaseDigest) invalid("local CAS target");
    return { leaseDigest: projection.leaseDigest,
      preservationReceiptDigest: projection.preservation.receiptDigest, adopted: false };
  }

  function projectMarker(plan) {
    const lease = store.read(plan.evidence.lease.branch);
    if (lease?.admission?.status !== "admitted") invalid("marker admitted lease");
    const review = pullRequest({ ...lease, pullRequestUrl: plan.evidence.pullRequest.url });
    const expected = updateWriterLeasePullRequestBody(review.body, lease);
    const targetDigest = digestValue(expected), currentDigest = digestValue(review.body);
    if (currentDigest !== targetDigest) {
      if (currentDigest !== plan.evidence.pullRequest.bodyDigest) invalid("marker source body");
      gh(["pr", "edit", plan.evidence.pullRequest.url, "--body", expected]);
    }
    const final = pullRequest({ ...lease, pullRequestUrl: plan.evidence.pullRequest.url });
    if (digestValue(final.body) !== targetDigest) invalid("marker target body");
    return { bodyDigest: targetDigest,
      markerDigest: digestValue(projectWriterLeasePullRequestMarker(lease)), adopted: currentDigest === targetDigest };
  }

  function verify(plan) {
    const lease = store.read(plan.evidence.lease.branch);
    if (lease?.admission?.status !== "admitted" || lease.integration?.commitSha !== plan.evidence.descendant.headSha
      || git(["rev-parse", "HEAD"]) !== plan.evidence.descendant.headSha
      || git(["status", "--porcelain=v1", "--untracked-files=all"])) invalid("terminal local state");
    const review = pullRequest(lease), marker = parseWriterLeasePullRequestBody(review.body);
    if (review.evidence.headSha !== plan.evidence.descendant.headSha
      || digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))) invalid("terminal provider marker");
    const verified = verifyCloud({ authority: lease.cloudAuthority, manifest: manifest(lease),
      canonicalBaseSha: lease.baseSha, environment: options.environment || process.env });
    if (!targetAuthority(verified.authority, plan)) invalid("terminal cloud authority");
    return { leaseDigest: digestValue(lease), bodyDigest: digestValue(review.body),
      cloudAuthorityDigest: digestValue(verified.authority),
      cloudVerificationReceiptDigest: verified.verification.receiptDigest,
      descendantDigest: digestValue(descendant(lease)), sourceBytesChanged: false,
      gitRefsChanged: false, draftStateChanged: false, merged: false, deployed: false, cleaned: false };
  }

  function authorityFrom(observed, plan) {
    const claim = observed.claim, source = plan.evidence.lease.cloudAuthority;
    return Object.freeze({ ...source, claimDigest: claim.fenceRevision,
      ledgerRevision: observed.status.ledgerRevision, ledgerDigest: observed.status.ledgerDigest,
      claimLedgerRevision: claim.transitionDigest, entrySchema: claim.entrySchema,
      claimIdentitySchema: claim.claimIdentitySchema, operationReceiptDigest: claim.operationReceiptDigest,
      mutationAuthorityEligible: claim.mutationAuthorityEligible !== false,
      canonicalBaseSha: claim.canonicalBaseRevision, laneRevision: claim.laneRevision,
      cloudDeclaredWriteScope: claim.declaredWriteScope, writeSetDigest: claim.writeSetDigest,
      reviewRequestId: claim.reviewRequestId, leaseEpoch: claim.leaseEpoch,
      transitionCounter: claim.transitionCounter,
      state: claim.state === "current" ? "active" : claim.state,
      expiresAt: claim.expiresAt, integrationReceiptDigest: claim.integrationReceiptDigest || null,
      integration: claim.integration || null, manifestDigest: plan.evidence.lease.admission.manifestDigest });
  }
  function targetClaim(claim, plan) { return claim.claimId === plan.evidence.lease.cloudAuthority.claimId
    && claim.laneRevision === plan.evidence.descendant.headSha
    && claim.reviewRequestId === plan.evidence.pullRequest.reviewRequestId
    && claim.state === "current" && claim.writeAuthority === true && claim.scopeReserved === true
    && claim.transitionCounter >= 2; }
  function targetAuthority(authority, plan) { return authority?.claimId === plan.evidence.lease.cloudAuthority.claimId
    && authority.laneRevision === plan.evidence.descendant.headSha
    && authority.reviewRequestId === plan.evidence.pullRequest.reviewRequestId
    && authority.state === "active" && authority.transitionCounter >= 2; }
  function assertSource(plan) {
    const live = readEvidence();
    const stableLive = projectProvisionedStartDescendantAdmissionStableSource(live);
    const stablePlan = projectProvisionedStartDescendantAdmissionStableSource(plan.evidence);
    if (digestValue(stableLive) !== digestValue(stablePlan)) invalid("sealed source drift");
  }
  function assertStatic(plan) {
    const lease = sourceLease("static-revalidation"), range = descendant(lease), review = pullRequest(lease);
    if (digestValue(lease) !== plan.evidence.sourceLeaseDigest
      || digestValue(range) !== digestValue(plan.evidence.descendant)
      || digestValue(review.evidence) !== digestValue(plan.evidence.pullRequest)
      || digestValue(controller()) !== digestValue(plan.evidence.controller)) invalid("sealed static source drift");
    return lease;
  }

  function journalFile(plan) { return path.join(journalRoot, `${plan.planDigest}.json`); }
  function readJournal(plan) {
    const file = journalFile(plan); if (!existsSync(file)) return null; privateFile(file);
    return JSON.parse(readFileSync(file, "utf8"));
  }
  function writeJournal(plan, value) { mkdirSync(journalRoot, { recursive: true, mode: 0o700 });
    const file = journalFile(plan), temporary = `${file}.${randomUUID()}.tmp`;
    const descriptor = openSync(temporary, "wx", 0o600);
    try { writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(descriptor); }
    finally { closeSync(descriptor); }
    renameSync(temporary, file); const directory = openSync(journalRoot, "r");
    try { fsyncSync(directory); } finally { closeSync(directory); } }
  function begin({ plan, authorizationReceipt }) {
    const current = readJournal(plan); if (current) return current;
    assertSource(plan); const receipt = phaseReceipt({ planDigest: plan.planDigest, phase: "prepared",
      values: { authorizationReceiptDigest: authorizationReceipt.receiptDigest }, recordedAt: clock().toISOString() });
    const journal = { schema: "agentic-provisioned-start-descendant-admission-recovery-journal/v1",
      planDigest: plan.planDigest, phase: "prepared", phases: { prepared: receipt } };
    writeJournal(plan, journal); return journal;
  }
  function advance({ plan, expected, phase, values }) {
    const current = readJournal(plan); if (current?.phase === phase) return current;
    if (!current || current.phase !== expected || PHASES.indexOf(phase) !== PHASES.indexOf(expected) + 1) invalid("journal phase");
    const receipt = phaseReceipt({ planDigest: plan.planDigest, phase, values, recordedAt: clock().toISOString() });
    const next = { ...current, phase, phases: { ...current.phases, [phase]: receipt } };
    writeJournal(plan, next); return next;
  }
  function withLock(plan, action) { mkdirSync(journalRoot, { recursive: true, mode: 0o700 });
    const lock = `${journalFile(plan)}.lock`, descriptor = openSync(lock, "wx", 0o600);
    try { writeFileSync(descriptor, JSON.stringify({ pid: process.pid })); fsyncSync(descriptor); return action(); }
    finally { closeSync(descriptor); try { unlinkSync(lock); } catch {} } }
  return Object.freeze({ gitCommonDir: common, readEvidence, authorizeTask,
    bindCloud: bindCloudDescendant, projectLocal, projectMarker, verify, begin, advance, withLock });
}

function privateFile(file) { const stat = lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()
  || (stat.mode & 0o077) !== 0) invalid("private journal"); }
function required(value, label) { if (typeof value !== "string" || !value.trim()) invalid(label); return value; }
function invalid(label) { throw new Error(`Provisioned-start descendant recovery ${label} is invalid.`); }
