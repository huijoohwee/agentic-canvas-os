// Responsibility: Bind repair to exact GitHub, cloud, worktree, and writer-registry state.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import {
  createWriterLeaseStore, parseWriterLeasePullRequestBody, projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody, WRITER_LEASE_REGISTRY_SCHEMA,
} from "./writer-lease-lib.mjs";
import {
  createAdmissionManifestProjectionRepairIntent,
  deriveAdmissionManifestProjection,
  normalizeAdmissionManifestProjectionRepairIntent,
} from "./admission-manifest-projection-repair-contract.mjs";

export function createRepositoryAdmissionManifestProjectionRepairAdapter(options = {}, dependencies = {}) {
  const repository = realpathSync(path.resolve(required(options.repository, "repository")));
  const pullRequestNumber = positive(options.pullRequestNumber, "pull request");
  const environment = options.environment || process.env;
  const execute = dependencies.execute || ((command, args, settings = {}) => execFileSync(command, args, {
    cwd: repository, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...settings,
  }));
  const git = dependencies.git || (args => String(execute("git", args)).trim());
  const gh = dependencies.gh || (args => String(execute("gh", args)).trim());
  const cloud = dependencies.cloud || invokeRepositoryCloudAction;
  const commonDir = realpathSync(path.resolve(repository, git(["rev-parse", "--git-common-dir"])));
  const store = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir: commonDir });
  const journalDirectory = path.join(commonDir, "agentic-canvas-os", "admission-manifest-projection-repair");

  function readSubject() {
    const repo = JSON.parse(gh(["repo", "view", "--json", "nameWithOwner,id"]));
    const pull = JSON.parse(gh(["pr", "view", String(pullRequestNumber), "--repo", repo.nameWithOwner, "--json",
      "number,url,state,isDraft,headRefName,headRefOid,baseRefName,baseRefOid,headRepository,author,body,autoMergeRequest"]));
    const viewer = JSON.parse(gh(["api", "user"]));
    if (pull.state !== "OPEN" || pull.isDraft !== false || pull.baseRefName !== "main" || pull.autoMergeRequest !== null
      || pull.headRepository?.nameWithOwner !== repo.nameWithOwner || pull.author?.login !== viewer.login) fail("provider subject");
    const marker = parseWriterLeasePullRequestBody(pull.body);
    if (!marker || marker.status !== "review_ready" || marker.reviewHeadSha !== pull.headRefOid
      || marker.branch !== pull.headRefName) fail("provider writer marker");
    const registry = store.readRegistry();
    if (registry.schema !== WRITER_LEASE_REGISTRY_SCHEMA || !Number.isSafeInteger(registry.revision)) fail("writer registry");
    const lease = registry.leases[pull.headRefName];
    if (!lease || lease.status !== "review_ready" || lease.reviewHeadSha !== pull.headRefOid
      || digestValue(projectWriterLeasePullRequestMarker(lease)) !== digestValue(marker)) fail("writer lease join");
    const mainSha = remoteSha("refs/heads/main");
    const branchSha = remoteSha(`refs/heads/${pull.headRefName}`);
    if (git(["rev-parse", "HEAD"]) !== mainSha || branchSha !== pull.headRefOid
      || git(["status", "--porcelain=v1", "-z", "--untracked-files=all"])) fail("protected canonical main");
    requireCleanTarget(lease);
    const authority = lease.cloudAuthority;
    const status = cloud({ action: "status", ledgerRepository: authority?.ledgerRepository,
      request: { targetRepository: authority?.targetRepository }, environment });
    if (status?.schema !== "agentic-cloud-collaboration-result/v1" || status.ok !== true || status.action !== "status") fail("cloud status");
    const claims = status.claims.filter(item => item.claimId === authority.claimId);
    if (claims.length !== 1) fail("claim cardinality");
    const claim = claims[0];
    if (claim.state !== "reviewed" || claim.writeAuthority !== false || claim.scopeReserved !== true
      || claim.fenceRevision !== authority.claimDigest || claim.transitionDigest !== authority.ledgerDigest
      || claim.laneRevision !== pull.headRefOid || claim.reviewRequestId !== authority.reviewRequestId
      || claim.writeSetDigest !== lease.admission.writeSetDigest) fail("claim identity");
    return { repo, pull, viewer, marker, registry, lease, status, claim, mainSha };
  }

  function buildEvidence(subject) {
    const { repo, pull, viewer, marker, registry, lease, status, claim, mainSha } = subject;
    const projection = deriveAdmissionManifestProjection({ semanticScope: lease.admission.semanticScope,
      declaredWriteSet: lease.admission.declaredWriteSet });
    if (lease.admission.manifestDigest !== projection.legacyManifestDigest
      || lease.cloudAuthority.manifestDigest !== projection.legacyManifestDigest) fail("legacy manifest provenance");
    const newLease = repairedLease(lease, projection.canonicalManifestDigest);
    const newMarker = projectWriterLeasePullRequestMarker(newLease);
    const newBody = updateWriterLeasePullRequestBody(pull.body, newLease);
    return {
      repository: { nameWithOwner: repo.nameWithOwner, nodeId: repo.id, actorId: `github-user:${viewer.id}` },
      canonical: { headSha: mainSha, clean: true },
      pullRequest: { number: pull.number, url: pull.url, state: pull.state, isDraft: pull.isDraft,
        branch: pull.headRefName, headSha: pull.headRefOid, baseBranch: pull.baseRefName, baseSha: pull.baseRefOid,
        reviewRequestId: lease.cloudAuthority.reviewRequestId },
      lease: { status: lease.status, epoch: lease.epoch, sessionId: lease.sessionId, branch: lease.branch,
        reviewHeadSha: lease.reviewHeadSha, worktreePath: lease.worktreePath, claimId: lease.cloudAuthority.claimId },
      claim: { claimId: claim.claimId, state: claim.state, writeAuthority: claim.writeAuthority,
        scopeReserved: claim.scopeReserved, laneRevision: claim.laneRevision, transitionCounter: claim.transitionCounter,
        fenceRevision: claim.fenceRevision, operationReceiptDigest: claim.operationReceiptDigest,
        ledgerRevision: status.ledgerRevision, ledgerDigest: status.ledgerDigest },
      projection: { semanticScope: lease.admission.semanticScope, declaredWriteSet: projection.declaredWriteSet,
        writeSetDigest: projection.writeSetDigest, legacyManifestDigest: projection.legacyManifestDigest,
        canonicalManifestDigest: projection.canonicalManifestDigest,
        registryRevision: registry.revision, registryDigest: digestValue(registry),
        oldLeaseDigest: digestValue(lease), newLeaseDigest: digestValue(newLease),
        oldMarkerDigest: digestValue(marker), newMarkerDigest: digestValue(newMarker),
        oldBodyDigest: digestValue(pull.body), newBodyDigest: digestValue(newBody) },
    };
  }

  function observe(plan) {
    const repo = JSON.parse(gh(["repo", "view", "--json", "nameWithOwner,id"]));
    const pull = JSON.parse(gh(["pr", "view", String(pullRequestNumber), "--repo", repo.nameWithOwner, "--json",
      "number,url,state,isDraft,headRefName,headRefOid,baseRefName,baseRefOid,headRepository,author,body,autoMergeRequest"]));
    const registry = store.readRegistry();
    const lease = registry.leases[plan.evidence.pullRequest.branch];
    if (!lease) fail("target lease absence");
    return { pull, registry, lease, marker: parseWriterLeasePullRequestBody(pull.body),
      bodyDigest: digestValue(pull.body), registryDigest: digestValue(registry), leaseDigest: digestValue(lease) };
  }

  function assertStable(plan, observed) {
    const evidence = plan.evidence;
    if (remoteSha("refs/heads/main") !== evidence.canonical.headSha || git(["rev-parse", "HEAD"]) !== evidence.canonical.headSha
      || git(["status", "--porcelain=v1", "-z", "--untracked-files=all"])) fail("canonical drift");
    if (observed.pull.state !== "OPEN" || observed.pull.isDraft !== false
      || observed.pull.headRefOid !== evidence.pullRequest.headSha || observed.pull.headRefName !== evidence.pullRequest.branch
      || observed.pull.baseRefName !== evidence.pullRequest.baseBranch || observed.pull.baseRefOid !== evidence.pullRequest.baseSha
      || observed.pull.headRepository?.nameWithOwner !== evidence.repository.nameWithOwner
      || observed.pull.autoMergeRequest !== null
      || remoteSha(`refs/heads/${evidence.pullRequest.branch}`) !== evidence.pullRequest.headSha) fail("pull request drift");
    requireCleanTarget(observed.lease);
    assertClaimStable(plan, observed.lease.cloudAuthority);
  }

  function assertClaimStable(plan, authority) {
    const status = cloud({ action: "status", ledgerRepository: authority?.ledgerRepository,
      request: { targetRepository: authority?.targetRepository }, environment });
    const matches = status?.claims?.filter(item => item.claimId === plan.evidence.claim.claimId) || [];
    if (status?.schema !== "agentic-cloud-collaboration-result/v1" || status.ok !== true
      || status.action !== "status" || matches.length !== 1) fail("claim revalidation");
    const claim = matches[0], expected = plan.evidence.claim;
    if (claim.state !== expected.state || claim.writeAuthority !== false || claim.scopeReserved !== true
      || claim.laneRevision !== expected.laneRevision || claim.transitionCounter !== expected.transitionCounter
      || claim.fenceRevision !== expected.fenceRevision || claim.operationReceiptDigest !== expected.operationReceiptDigest
      || claim.reviewRequestId !== plan.evidence.pullRequest.reviewRequestId
      || claim.writeSetDigest !== plan.evidence.projection.writeSetDigest) fail("claim drift");
  }

  function providerState(plan, observed) {
    const projection = plan.evidence.projection;
    if (observed.bodyDigest === projection.oldBodyDigest && digestValue(observed.marker) === projection.oldMarkerDigest) return "old";
    if (observed.bodyDigest === projection.newBodyDigest && digestValue(observed.marker) === projection.newMarkerDigest) return "new";
    fail("provider projection drift");
  }

  function registryState(plan, observed) {
    const projection = plan.evidence.projection;
    if (observed.leaseDigest === projection.oldLeaseDigest) return "old";
    if (observed.leaseDigest === projection.newLeaseDigest) return "new";
    fail("registry projection drift");
  }

  return Object.freeze({
    readPlanEvidence() { return buildEvidence(readSubject()); },
    withOperationLock({ operationId }, action) { return withLock(path.join(journalDirectory, `${operationId}.lock`), action); },
    readIntent({ plan }) { return readJournal(journalPath(plan)); },
    writeIntent({ expected, value }) { writeJournal(journalPath(value.plan), expected, value); },
    revalidate({ plan, phase }) {
      const observed = observe(plan); assertStable(plan, observed);
      const provider = providerState(plan, observed), registry = registryState(plan, observed);
      if (phase === "provider-projected" && (provider !== "old" || registry !== "old")) fail("provider precondition");
      if (phase === "registry-projected" && (provider !== "new" || registry !== "old")) fail("registry precondition");
    },
    reconcile({ plan, phase }) {
      const observed = observe(plan); assertStable(plan, observed);
      const provider = providerState(plan, observed), registry = registryState(plan, observed);
      if (phase === "provider-projected") return provider === "new"
        ? { bodyDigest: observed.bodyDigest, markerDigest: digestValue(observed.marker) } : null;
      if (phase === "registry-projected") return registry === "new"
        ? { registryDigest: observed.registryDigest, leaseDigest: observed.leaseDigest } : null;
      fail("reconciliation phase");
    },
    projectProvider({ plan }) {
      const source = observe(plan); assertStable(plan, source);
      if (providerState(plan, source) !== "old" || registryState(plan, source) !== "old") fail("provider CAS");
      const nextLease = repairedLease(source.lease, plan.evidence.projection.canonicalManifestDigest);
      const body = updateWriterLeasePullRequestBody(source.pull.body, nextLease);
      if (digestValue(body) !== plan.evidence.projection.newBodyDigest) fail("provider body derivation");
      gh(["pr", "edit", String(pullRequestNumber), "--repo", plan.evidence.repository.nameWithOwner, "--body", body]);
    },
    projectRegistry({ plan }) {
      store.withRegistryLock(registry => {
        const lease = registry.leases[plan.evidence.pullRequest.branch];
        if (digestValue(lease) !== plan.evidence.projection.oldLeaseDigest) fail("registry CAS lease");
        const nextLease = repairedLease(lease, plan.evidence.projection.canonicalManifestDigest);
        if (digestValue(nextLease) !== plan.evidence.projection.newLeaseDigest) fail("registry lease derivation");
        writeRegistry({ ...registry, revision: registry.revision + 1,
          leases: { ...registry.leases, [plan.evidence.pullRequest.branch]: nextLease } });
      });
    },
    verify({ plan }) {
      const observed = observe(plan); assertStable(plan, observed);
      if (providerState(plan, observed) !== "new" || registryState(plan, observed) !== "new") fail("final projection");
      return { providerBodyDigest: observed.bodyDigest, registryDigest: observed.registryDigest,
        leaseDigest: observed.leaseDigest };
    },
  });

  function repairedLease(lease, manifestDigest) {
    return Object.freeze({ ...lease,
      admission: Object.freeze({ ...lease.admission, manifestDigest }),
      cloudAuthority: Object.freeze({ ...lease.cloudAuthority, manifestDigest }) });
  }
  function requireCleanTarget(lease) {
    if (git(["-C", lease.worktreePath, "rev-parse", "HEAD"]) !== lease.reviewHeadSha
      || git(["-C", lease.worktreePath, "branch", "--show-current"]) !== lease.branch
      || git(["-C", lease.worktreePath, "status", "--porcelain=v1", "-z", "--untracked-files=all"])) fail("target worktree");
  }
  function remoteSha(ref) {
    const rows = git(["ls-remote", "origin", ref]).split(/\r?\n/u).filter(Boolean);
    if (rows.length !== 1 || !/^[0-9a-f]{40}$/u.test(rows[0].split(/\s+/u)[0])) fail("remote ref");
    return rows[0].split(/\s+/u)[0];
  }
  function writeRegistry(value) { writeAtomic(store.statePath, value); }
  function journalPath(plan) { return path.join(journalDirectory, `${createAdmissionManifestProjectionRepairIntent(plan).operationId}.json`); }
  function readJournal(file) {
    if (!existsSync(file)) return null;
    requirePrivateFile(file); return normalizeAdmissionManifestProjectionRepairIntent(JSON.parse(readFileSync(file, "utf8")));
  }
  function writeJournal(file, expected, value) {
    ensureJournalDirectory();
    if (digestValue(readJournal(file)) !== digestValue(expected)) fail("journal compare-and-swap");
    writeAtomic(file, value);
  }
  function writeAtomic(file, value) {
    const directory = path.dirname(file); mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    const descriptor = openSync(temporary, "wx", 0o600);
    try { writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(descriptor); }
    finally { closeSync(descriptor); }
    try { renameSync(temporary, file); syncDirectory(directory); }
    catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
    requirePrivateFile(file);
  }
  function ensureJournalDirectory() {
    mkdirSync(journalDirectory, { recursive: true, mode: 0o700 });
    const stat = lstatSync(journalDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("journal directory");
  }
  function withLock(file, action) {
    ensureJournalDirectory();
    const descriptor = openSync(file, "wx", 0o600), token = randomUUID();
    try { writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token })); fsyncSync(descriptor); return action(); }
    finally { closeSync(descriptor); try { unlinkSync(file); syncDirectory(journalDirectory); } catch {} }
  }
}

function requirePrivateFile(file) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) fail("private file");
}
function syncDirectory(directory) { const descriptor = openSync(directory, "r"); try { fsyncSync(descriptor); } finally { closeSync(descriptor); } }
function required(value, label) { if (typeof value !== "string" || !value.trim()) fail(label); return value; }
function positive(value, label) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) fail(label); return number; }
function fail(label) { throw new Error(`Admission manifest projection repair ${label} is invalid.`); }
