// Responsibility: prove immutable PR735 integration, then close only PR736 and release only its lease.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson, digestValue, validateLedger } from "./cloud-collaboration-primitives.mjs";
import { DEFAULT_LEDGER_PATH, DEFAULT_LEDGER_REF } from "./github-cloud-collaboration-adapter.mjs";
import { parseWorktreeRecords } from "./repository-guards.mjs";
import { authorizeTaskBoundLeaseMutation } from "./task-bound-lane-authority-store.mjs";
import { createWriterLeaseStore, parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker } from "./writer-lease-lib.mjs";
import { writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
import { EFFECTS, FIXED_SUBJECT, LOCAL_LEASE_RELEASE_PLAN_SCHEMA, OPERATION, PRESERVATION,
  TERMINAL_EVIDENCE_SCHEMA, normalizeEvidence, normalizePlan }
  from "./integrated-source-duplicate-pr-reconciliation-contract.mjs";

const SHA = /^[0-9a-f]{40}$/u, DG = /^[0-9a-f]{64}$/u;
const RELEASE_RECEIPT = `agentic-${OPERATION}-local-lease-release-receipt/v1`;
const PROVIDER_RECEIPT = `agentic-${OPERATION}-provider-close-receipt/v1`;
const RUNTIME = ["contract", "controller", "repository-adapter", ""].map(name =>
  `scripts/integrated-source-duplicate-pr-reconciliation${name ? `-${name}` : ""}.mjs`);
const EXACT = Object.freeze({ repository: "huijoohwee/agentic-canvas-os",
  sourceNode: "PR_kwDOSr5-fM8AAAABBBdusA", mergedNode: "PR_kwDOSr5-fM8AAAABBBYl7A",
  branch: "agent/katrinas-macbook-pro.local/planned-dirty-admission-recovery",
  base: "f9663ab045ee0331c2ec5548012e8959f67bd804",
  sourceBody: "35af90960dddccf862399149a2566258129478c37e32f70735588a45532a8541",
  sourceMarker: "0d93481fa98e1b272a322b299140002082b60aa084f31fce2f7c5a091b471e6d",
  integrationEntry: "4160884c814942ae19acd9cede38a52b3b96efe5b5ca58a03260b43510b25085",
  retirementEntry: "af628836c63255f59d64fff35187dd17219e4301f5837b740da499932047c16b",
  integrationReceipt: "d1646eb22083f328f4806ee0184523d10a5c20c215358a22987c7958652754e6",
  migration: "9c1737a22043e1ffe453a6be71e0acbc7f69a50c0e38b79ce7954d4cd6d9c325",
  lease: "0c71c917187cf03cee10363627868492366564f0d0e21b4f8e4bed512cead429",
  binding: "440f71469eb6f96439aa887ac4973b7e3e040e4a2aa2e00aea223b0e0b70c36c",
  currentMarker: "3e317c24ba0661abadf4b386a59c037ace9570be76e441d6406ea84afb80db19",
  checkpoint: "458c33936fac81eab0ade938d0c86db73dd08c56fd94ca2f1247203ff9a87cef",
  checkpointRaw: "d09dd035cf791be4049082ed88966e75630a68bc8dbc9a76fc689256d3b1238f" });

export function createIntegratedSourceDuplicatePrReconciliationRepositoryAdapter(options = {}, d = {}) {
  const exact = Object.freeze({ ...EXACT, ...(d.bindings || {}) }), real = d.realpath || realpathSync;
  const repo = real(path.resolve(text(options.repository, "repository")));
  const sourceRoot = real(path.resolve(text(options.sourceWorktree, "source worktree")));
  if (repo === sourceRoot) throw new Error("Controller and source worktrees must differ.");
  const sourcePrNumber = pos(options.sourcePullRequestNumber, "source PR");
  const mergedPrNumber = pos(options.integratedPullRequestNumber, "integrated PR");
  const claimId = dg(options.claimId, "claim ID"), checkpointPath = path.resolve(text(options.checkpointPath, "checkpoint"));
  const capabilityPath = options.taskAuthorityFile ? path.resolve(options.taskAuthorityFile) : null;
  if (sourcePrNumber !== FIXED_SUBJECT.sourcePullRequestNumber || mergedPrNumber !== FIXED_SUBJECT.integratedPullRequestNumber
    || claimId !== FIXED_SUBJECT.claimId) throw new Error("Reconciliation subject is not PR736/PR735/claim2523.");
  const exec = d.execute || ((command, args, o = {}) => execFileSync(command, args, { cwd: o.cwd || repo,
    encoding: "utf8", input: o.input, maxBuffer: 256 * 1024 * 1024,
    stdio: [o.input === undefined ? "ignore" : "pipe", "pipe", "pipe"] }));
  const git = d.gitText || ((cwd, args) => String(exec("git", ["-C", cwd, ...args], { cwd })).trim());
  const rawGit = d.gitRaw || ((cwd, args) => String(exec("git", ["-C", cwd, ...args], { cwd })));
  const gh = d.ghJson || (args => JSON.parse(String(exec("gh", args))));
  const now = d.now || (() => new Date()), authorize = d.authorizeTaskBoundLeaseMutation || authorizeTaskBoundLeaseMutation;
  const common = real(path.resolve(d.gitCommonDir || git(repo,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"])));
  const repoName = repositoryName(d.repositoryNameWithOwner || originName(repo, git));
  if (repoName !== exact.repository) throw new Error("Controller origin is not the authorized repository.");
  const store = d.leaseStore || createWriterLeaseStore({ gitCommonDir: common, now,
    taskAuthorityFile: capabilityPath, taskAuthorityPolicy: "required" });
  const key = digestValue({ repoName, sourcePrNumber, mergedPrNumber, claimId });
  const journalRoot = path.join(common, "agentic-canvas-os", OPERATION);
  const journalPath = path.resolve(d.journalPath || path.join(journalRoot, `${key}.json`));
  const lockPath = `${journalPath}.lock`;
  if (path.dirname(journalPath) !== journalRoot) throw new Error("Journal must remain in its private operation directory.");
  const readPrPort = d.readPullRequest || (x => gh(["api", "--method", "GET", `repos/${x.repository}/pulls/${x.number}`]));
  const readFilesPort = d.readPullRequestFiles || (x => pages(gh(["api", "--method", "GET", "--paginate", "--slurp",
    `repos/${x.repository}/pulls/${x.number}/files?per_page=100`])).map(v => v.filename));
  const readLedgerPort = d.readLedger || (() => githubLedger(repoName, gh));
  const closePort = d.providerClose || (x => JSON.parse(String(exec("gh", ["api", "--method", "PATCH",
    `repos/${x.repository}/pulls/${x.number}`, "--input", "-"], { input: JSON.stringify(x.patch) }))));

  const controller = () => d.captureControllerState ? structuredClone(d.captureControllerState({ repository: repo })) : (() => {
    const branch = git(repo, ["branch", "--show-current"]), headSha = sh(git(repo, ["rev-parse", "HEAD"]), "controller HEAD");
    const originMainSha = sh(git(repo, ["rev-parse", "refs/remotes/origin/main"]), "origin/main");
    const status = rawGit(repo, ["status", "--porcelain=v2", "--untracked-files=all", "-z"]);
    const blobs = RUNTIME.map(file => ({ file, blob: sh(git(repo, ["rev-parse", `${headSha}:${file}`]), "runtime blob") }));
    return { root: repo, headSha, originMainSha, treeSha: sh(git(repo, ["rev-parse", `${headSha}^{tree}`]), "controller tree"),
      runtimeDigest: digestValue(blobs), clean: !status, protected: branch === "main" && headSha === originMainSha };
  })();
  const source = () => d.captureSourceState ? structuredClone(d.captureSourceState({ repository: repo,
    sourceWorktree: sourceRoot })) : (() => {
    const branch = text(git(sourceRoot, ["branch", "--show-current"]), "source branch");
    const headSha = sh(git(sourceRoot, ["rev-parse", "HEAD"]), "source HEAD");
    const treeSha = sh(git(sourceRoot, ["rev-parse", `${headSha}^{tree}`]), "source tree");
    const parentShas = git(sourceRoot, ["show", "-s", "--format=%P", headSha]).split(/\s+/u).filter(Boolean);
    const baseSha = parentShas.length === 1 ? sh(parentShas[0], "source base") : "";
    const remote = git(sourceRoot, ["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).split("\n").filter(Boolean);
    if (remote.length !== 1) throw new Error("Source remote branch is missing or ambiguous.");
    const changedPaths = paths(nul(rawGit(sourceRoot, ["diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", baseSha, headSha, "--"])));
    const status = rawGit(sourceRoot, ["status", "--porcelain=v2", "--untracked-files=all", "-z"]);
    const registered = parseWorktreeRecords(rawGit(repo, ["worktree", "list", "--porcelain", "-z"])).some(w => {
      try { return real(w.path) === sourceRoot && w.branch === `refs/heads/${branch}` && w.head === headSha && !w.prunable; } catch { return false; }
    });
    return { worktreePath: sourceRoot, branch, headSha, treeSha, baseSha,
      localBranchSha: sh(git(sourceRoot, ["rev-parse", `refs/heads/${branch}`]), "local branch"),
      remoteBranchSha: sh(remote[0].split(/\s+/u)[0], "remote branch"), parentShas, changedPaths,
      changedPathsDigest: digestValue(changedPaths), statusDigest: digestValue(status), clean: !status, registered };
  })();
  const readPr = number => normalizePr(readPrPort({ repository: repoName, number }));
  const checkpoint = () => {
    const got = d.readCheckpoint ? d.readCheckpoint(checkpointPath) : privateJson(checkpointPath, "legacy checkpoint");
    const value = got.value ?? got, raw = typeof got.raw === "string" ? got.raw : `${JSON.stringify(value)}\n`, i = value.identity;
    if (value.schema !== "agentic-legacy-clean-committed-lane-bootstrap-checkpoint/v1" || value.status !== "pullRequest"
      || digestValue(without(i, "identityDigest")) !== i?.identityDigest || i.identityDigest !== exact.checkpoint
      || i.targetRepository !== repoName || i.ledgerRepository !== repoName
      || value.outputs?.pullRequest?.pullRequest?.number !== sourcePrNumber
      || value.outputs?.cloudClaim?.authority?.claimId !== claimId
      || digestValue(raw) !== exact.checkpointRaw) throw new Error("Legacy checkpoint subject changed.");
    return { path: checkpointPath, schema: value.schema, status: value.status, rawDigest: digestValue(raw),
      identityDigest: i.identityDigest, branch: i.branch, headSha: i.headSha, treeSha: i.treeSha,
      sourcePullRequestNumber: value.outputs.pullRequest.pullRequest.number, claimId };
  };
  const claim = src => {
    const got = readLedgerPort({ repository: repoName }), ledger = got?.ledger ?? got;
    const failures = validateLedger(ledger); if (failures.length) throw new Error(`Invalid ledger: ${failures.join("; ")}`);
    const history = ledger.entries.filter(e => e.claimId === claimId), integrated = history.findLast(e => e.action === "integrate");
    const retired = history.findLast(e => e.action === "retire"), c = retired?.claimCore, r = c?.retirement, x = integrated?.claimCore?.integration;
    if (integrated?.digest !== exact.integrationEntry || retired?.digest !== exact.retirementEntry
      || r?.integrationReceiptDigest !== exact.integrationReceipt || c?.state !== "retired" || r?.reason !== "integrated"
      || x?.candidateRevision !== FIXED_SUBJECT.sourceHeadSha || r?.finalRevision !== FIXED_SUBJECT.sourceHeadSha
      || c?.reviewRequestId !== `github-pull-request:${exact.mergedNode}`) throw new Error("Claim2523 integration lineage changed.");
    const covered = src.changedPaths.every(p => c.declaredWriteScope.some(s => s === "path:." || s === `path:${p}`
      || s.startsWith("path:") && p.startsWith(`${s.slice(5)}/`)));
    const lineage = { claimId, integrationEntryDigest: integrated.digest, retirementEntryDigest: retired.digest,
      integrationReceiptDigest: r.integrationReceiptDigest };
    return { claimId, state: c.state, retirementReason: r.reason, canonicalBaseSha: c.canonicalBaseRevision,
      laneRevision: c.laneRevision, candidateRevision: x.candidateRevision, finalRevision: r.finalRevision,
      reviewRequestId: c.reviewRequestId, ...lineage, declaredWriteScope: c.declaredWriteScope,
      writeSetDigest: c.writeSetDigest, lineageDigest: digestValue(lineage), changedPathsCovered: covered };
  };
  const pullEvidence = (src, ctl) => {
    const p = readPr(sourcePrNumber), marker = parseWriterLeasePullRequestBody(p.body);
    if (!marker || p.nodeId !== exact.sourceNode || digestValue(p.body) !== exact.sourceBody
      || digestValue(marker) !== exact.sourceMarker) throw new Error("PR736 body or marker changed.");
    const m = readPr(mergedPrNumber), changedPaths = paths(readFilesPort({ repository: repoName, number: mergedPrNumber }));
    const mergeCommitTreeSha = sh(git(repo, ["rev-parse", `${m.mergeCommitSha}^{tree}`]), "squash tree");
    const mergeCommitParentShas = git(repo, ["show", "-s", "--format=%P", m.mergeCommitSha]).split(/\s+/u).filter(Boolean);
    if (m.nodeId !== exact.mergedNode || m.state !== "MERGED" || m.isDraft || m.mergeCommitSha !== FIXED_SUBJECT.integratedSquashSha
      || mergeCommitTreeSha !== FIXED_SUBJECT.sourceTreeSha || exit(git, repo,
        ["merge-base", "--is-ancestor", m.mergeCommitSha, ctl.originMainSha])) throw new Error("PR735 integration changed.");
    return { marker, sourcePullRequest: { number: p.number, nodeId: p.nodeId, url: p.url, state: p.state,
      isDraft: p.isDraft, mergedAt: p.mergedAt, closedAt: p.closedAt, autoMergeRequest: p.autoMergeRequest,
      headRepository: p.headRepository, headBranch: p.headBranch, headSha: p.headSha,
      baseRepository: p.baseRepository, baseBranch: p.baseBranch, baseSha: p.baseSha,
      bodyDigest: digestValue(p.body), markerDigest: digestValue(marker), markerMode: "pre-task-authority-migration" },
    mergedPullRequest: { number: m.number, nodeId: m.nodeId, url: m.url, state: m.state, isDraft: m.isDraft,
      mergedAt: m.mergedAt, headRepository: m.headRepository, headBranch: m.headBranch, headSha: m.headSha,
      headTreeSha: sh(git(sourceRoot, ["rev-parse", `${m.headSha}^{tree}`]), "merged source tree"),
      baseRepository: m.baseRepository, baseBranch: m.baseBranch, baseSha: m.baseSha, mergeCommitSha: m.mergeCommitSha,
      mergeCommitTreeSha, mergeCommitParentShas, changedPaths, changedPathsDigest: digestValue(changedPaths),
      protectedMainSha: ctl.originMainSha, protectedMainContainsMerge: true } };
  };
  const leaseEvidence = (src, pr, marker) => {
    const lease = store.read(src.branch), binding = lease?.taskAuthority;
    if (!lease || lease.status !== "active") throw new Error("Exact active PR736 lease is absent.");
    const current = projectWriterLeasePullRequestMarker(lease), prior = structuredClone(current); delete prior.taskAuthority;
    if (writerLeaseDigest(lease) !== exact.lease || binding?.bindingDigest !== exact.binding
      || digestValue(current) !== exact.currentMarker || binding?.bindingMode !== "migration" || binding.priorBindingDigest !== null
      || binding.transitionPlanDigest !== exact.migration || canonicalJson(marker) !== canonicalJson(prior)
      || lease.branch !== src.branch || lease.worktreePath !== src.worktreePath || lease.baseSha !== src.baseSha
      || lease.fenceSha !== src.headSha || lease.pullRequestUrl !== pr.url) throw new Error("PR736 marker drift is not migration-only.");
    return { digest: writerLeaseDigest(lease), snapshot: structuredClone(lease), status: lease.status,
      expired: Date.parse(lease.expiresAt) <= now().getTime(), branch: lease.branch, sessionId: lease.sessionId,
      epoch: lease.epoch, worktreePath: lease.worktreePath, baseSha: lease.baseSha, fenceSha: lease.fenceSha,
      pullRequestUrl: lease.pullRequestUrl, taskAuthorityBindingDigest: binding.bindingDigest,
      taskAuthorityTransitionPlanDigest: binding.transitionPlanDigest,
      markerWithoutTaskAuthorityDigest: digestValue(prior), currentMarkerDigest: digestValue(current) };
  };
  function liveEvidence() {
    const ctl = controller(), src = source(), pulls = pullEvidence(src, ctl), cl = claim(src), cp = checkpoint();
    return normalizeEvidence({ observedAt: now().toISOString(), repository: { root: repo, nameWithOwner: repoName },
      controller: ctl, source: src, sourcePullRequest: pulls.sourcePullRequest,
      mergedPullRequest: pulls.mergedPullRequest, claim: cl,
      lease: leaseEvidence(src, pulls.sourcePullRequest, pulls.marker), checkpoint: cp,
      preservation: PRESERVATION, effects: EFFECTS });
  }
  function captureEvidence() { return normalizeEvidence(d.captureEvidence ? d.captureEvidence({ repository: repo,
    sourceWorktree: sourceRoot, checkpointPath, bindings: exact, preservation: PRESERVATION, effects: EFFECTS }) : liveEvidence()); }
  function planEvidence(plan) { const p = normalizePlan(plan); if (p.evidence.repository.root !== repo
    || p.evidence.repository.nameWithOwner !== repoName) throw new Error("Plan repository changed."); return p; }
  function stablePr(number) { const a = readPr(number), b = readPr(number);
    if (canonicalJson(a) !== canonicalJson(b)) throw new Error(`PR${number} changed during double read.`); return b; }
  function assertPull(p, e, closedOkay = true) {
    const marker = parseWriterLeasePullRequestBody(p.body), stable = { number: p.number, nodeId: p.nodeId, url: p.url,
      isDraft: p.isDraft, mergedAt: p.mergedAt, autoMergeRequest: p.autoMergeRequest, headRepository: p.headRepository,
      headBranch: p.headBranch, headSha: p.headSha, baseRepository: p.baseRepository, baseBranch: p.baseBranch,
      baseSha: p.baseSha, bodyDigest: digestValue(p.body), markerDigest: marker && digestValue(marker) };
    const sealed = manyWithout(e, ["state", "closedAt", "markerMode"]);
    if (!marker || canonicalJson(stable) !== canonicalJson(sealed) || !["OPEN", ...(closedOkay ? ["CLOSED"] : [])].includes(p.state)
      || p.mergedAt !== null || (p.state === "OPEN" ? p.closedAt !== null : !p.closedAt)) throw new Error("PR736 stable bytes changed.");
    return marker;
  }
  function frame(plan, releasedOkay = true) {
    const p = planEvidence(plan), ctl = controller(), src = source(); same(ctl, p.evidence.controller, "controller");
    same(src, p.evidence.source, "source"); const pr = stablePr(sourcePrNumber), marker = assertPull(pr, p.evidence.sourcePullRequest);
    const m = stablePr(mergedPrNumber); if (m.state !== "MERGED" || m.nodeId !== p.evidence.mergedPullRequest.nodeId
      || m.headSha !== p.evidence.mergedPullRequest.headSha || m.mergeCommitSha !== p.evidence.mergedPullRequest.mergeCommitSha)
      throw new Error("PR735 integration changed.");
    same(claim(src), p.evidence.claim, "claim"); same(checkpoint(), p.evidence.checkpoint, "checkpoint");
    const lease = store.read(src.branch), sourceLease = lease && writerLeaseDigest(lease) === p.evidence.lease.digest;
    const released = releasedOkay && releaseLooksExact(lease, p, pr, marker);
    if (!sourceLease && !released) throw new Error("Local lease is not source or exact release.");
    return { p, ctl, src, pr, marker, m, lease, sourceLease, released };
  }
  function reverify(plan, stage) { const name = text(stage, "stage"), sourceOpen = new Set([
    "before-task-authority-verification", "after-task-authority-verification", "before-close-intent",
    "provider-close"]), sourceEither = name === "before-pull-request-close", sourceClosed = new Set([
    "after-pull-request-close", "before-lease-release-preparation", "after-lease-release-preparation"]),
    eitherClosed = name === "before-local-lease-release", releasedClosed = new Set([
      "after-local-lease-release", "before-final-double-read"]);
    if (![...sourceOpen, ...sourceClosed, ...releasedClosed, "before-pull-request-close", "before-local-lease-release"].includes(name))
      throw new Error("Unsupported reconciliation revalidation stage.");
    const f = frame(plan, eitherClosed || releasedClosed.has(name));
    if (sourceOpen.has(name) && (!f.sourceLease || f.pr.state !== "OPEN")
      || sourceEither && !f.sourceLease
      || sourceClosed.has(name) && (!f.sourceLease || f.pr.state !== "CLOSED")
      || eitherClosed && (!f.sourceLease && !f.released || f.pr.state !== "CLOSED")
      || releasedClosed.has(name) && (!f.released || f.pr.state !== "CLOSED"))
      throw new Error(`Reconciliation state is invalid at ${name}.`);
    return { status: "verified", stage: name }; }
  function verifyTaskAuthority(plan, operation) { const f = frame(plan, false); if (!capabilityPath || !f.sourceLease)
    throw new Error("Task capability and exact active lease are required.");
    const r = authorize({ lease: f.lease, capabilityPath, operation: text(operation, "operation"), now: now() });
    if (r?.status !== "verified" || r.bindingDigest !== f.p.evidence.lease.taskAuthorityBindingDigest) throw new Error("Task capability mismatch.");
    return r; }
  function providerValues(plan, p, marker) { const core = { schema: PROVIDER_RECEIPT, status: "closed-unmerged",
    planDigest: plan.planDigest, pullRequestNumber: p.number, nodeId: p.nodeId, state: "CLOSED", headSha: p.headSha,
    bodyDigest: digestValue(p.body), markerDigest: digestValue(marker), closedAt: p.closedAt };
    return { pullRequestNumber: p.number, nodeId: p.nodeId, state: "CLOSED", headSha: p.headSha,
      bodyDigest: core.bodyDigest, markerDigest: core.markerDigest, closedAt: p.closedAt,
      providerReceiptDigest: digestValue(core) };
  }
  function classifyPullRequest(plan) { const p = planEvidence(plan), pr = stablePr(sourcePrNumber), marker = assertPull(pr, p.evidence.sourcePullRequest);
    return pr.state === "OPEN" ? { state: "pending" } : { state: "complete", values: providerValues(p, pr, marker) }; }
  function closePullRequest(plan) { const p = planEvidence(plan), before = classifyPullRequest(p); if (before.state === "complete") return before.values;
    reverify(p, "provider-close"); let failure; try { closePort({ repository: repoName, number: sourcePrNumber,
      nodeId: exact.sourceNode, expectedHeadSha: FIXED_SUBJECT.sourceHeadSha, patch: { state: "closed" } }); } catch (e) { failure = e; }
    const a = classifyPullRequest(p), b = classifyPullRequest(p); if (a.state === "complete" && canonicalJson(a) === canonicalJson(b)) return b.values;
    if (failure) throw failure; throw new Error("PR736 closure did not converge."); }
  function prepareProjection(plan) { const p = planEvidence(plan), core = { schema: LOCAL_LEASE_RELEASE_PLAN_SCHEMA,
    status: "prepared", planDigest: p.planDigest, branch: p.evidence.source.branch,
    sourceLeaseDigest: p.evidence.lease.digest, sourceLeaseEpoch: p.evidence.lease.epoch,
    headSha: p.evidence.source.headSha, treeSha: p.evidence.source.treeSha };
    return { ...core, releasePlanDigest: digestValue(core) }; }
  function prepareLeaseRelease(plan, receipts = {}) { const p = planEvidence(plan), t = receipts.taskAuthorityReceipt;
    dg(receipts.authorizationReceipt?.authorizationDigest, "authorization receipt");
    dg(t?.receiptDigest ?? t?.taskAuthorityReceiptDigest, "task receipt"); dg(receipts.pullRequestReceipt?.receiptDigest, "close receipt");
    if ((t.bindingDigest ?? t.taskAuthorityBindingDigest) !== p.evidence.lease.taskAuthorityBindingDigest) throw new Error("Task receipt binding changed.");
    return prepareProjection(p);
  }
  function releaseProjection(plan, v) { const expected = prepareProjection(plan);
    if (canonicalJson(v) !== canonicalJson(expected)) throw new Error("Lease release plan changed."); return expected; }
  function releaseTarget(plan, projection, provider, taskAuthorityReceiptDigest) { const p = planEvidence(plan), x = releaseProjection(p, projection), e = p.evidence;
    if (provider.state !== "CLOSED" || provider.headSha !== e.source.headSha || provider.bodyDigest !== e.sourcePullRequest.bodyDigest
      || provider.markerDigest !== e.sourcePullRequest.markerDigest) throw new Error("Provider receipt changed.");
    const core = { schema: RELEASE_RECEIPT, status: "released", planDigest: p.planDigest, branch: e.source.branch,
      sourceLeaseDigest: e.lease.digest, releasePlanDigest: x.releasePlanDigest, sourceHeadSha: e.source.headSha,
      sourceTreeSha: e.source.treeSha, pullRequestNumber: provider.pullRequestNumber, pullRequestNodeId: provider.nodeId,
      pullRequestClosedAt: provider.closedAt, providerReceiptDigest: provider.providerReceiptDigest,
      taskAuthorityBindingDigest: e.lease.taskAuthorityBindingDigest,
      taskAuthorityReceiptDigest: dg(taskAuthorityReceiptDigest, "release task receipt") };
    const receipt = { ...core, receiptDigest: digestValue(core) };
    return { receipt, lease: { ...structuredClone(e.lease.snapshot), integratedSourceDuplicatePrReconciliation: receipt,
      schema: "agentic-writer-lease/v2", status: "released", heartbeatAt: provider.closedAt, expiresAt: provider.closedAt } };
  }
  function releaseLooksExact(lease, p, pr, marker) { if (lease?.status !== "released" || pr.state !== "CLOSED") return false;
    const r = lease.integratedSourceDuplicatePrReconciliation;
    try { const x = prepareProjection(p), provider = providerValues(p, pr, marker);
      return canonicalJson(lease) === canonicalJson(releaseTarget(p, x, provider, r?.taskAuthorityReceiptDigest).lease); }
    catch { return false; } }
  function classifyLeaseRelease(plan, projection) { const p = planEvidence(plan), x = releaseProjection(p, projection), lease = store.read(p.evidence.source.branch);
    if (lease && writerLeaseDigest(lease) === p.evidence.lease.digest) return { state: "pending" };
    const closed = classifyPullRequest(p); if (closed.state !== "complete") throw new Error("Lease changed before PR closure.");
    const target = releaseTarget(p, x, closed.values,
      lease?.integratedSourceDuplicatePrReconciliation?.taskAuthorityReceiptDigest);
    if (canonicalJson(lease) !== canonicalJson(target.lease)) throw new Error("Released lease changed.");
    return { state: "complete", values: { branch: p.evidence.source.branch, status: "released",
      sourceLeaseDigest: p.evidence.lease.digest, releasedLeaseDigest: writerLeaseDigest(lease), releasePlanDigest: x.releasePlanDigest,
      releaseReceiptDigest: target.receipt.receiptDigest, sourcePreserved: true } };
  }
  function releaseLease(plan, projection) { const p = planEvidence(plan), x = releaseProjection(p, projection), before = classifyLeaseRelease(p, x);
    if (before.state === "complete") return before.values; if (!capabilityPath) throw new Error("Task capability is required.");
    let lease = store.read(p.evidence.source.branch); if (writerLeaseDigest(lease) !== p.evidence.lease.digest) throw new Error("Source lease changed.");
    const proof = authorize({ lease, capabilityPath, operation: `${OPERATION}:${p.planDigest}:local-lease-release`, now: now() });
    if (proof?.status !== "verified" || proof.bindingDigest !== p.evidence.lease.taskAuthorityBindingDigest) throw new Error("Release capability mismatch.");
    lease = store.read(p.evidence.source.branch); if (writerLeaseDigest(lease) !== p.evidence.lease.digest) throw new Error("Lease changed after proof.");
    const closed = classifyPullRequest(p); if (closed.state !== "complete") throw new Error("PR736 is not closed.");
    const target = releaseTarget(p, x, closed.values, dg(proof.receiptDigest, "release task receipt")); let failure;
    try { store.release({ sessionId: p.evidence.lease.sessionId, branch: p.evidence.source.branch,
      expectedLease: p.evidence.lease.snapshot, status: "released", timestamp: closed.values.closedAt,
      values: { integratedSourceDuplicatePrReconciliation: target.receipt } }); } catch (e) { failure = e; }
    const a = classifyLeaseRelease(p, x), b = classifyLeaseRelease(p, x);
    if (a.state === "complete" && canonicalJson(a) === canonicalJson(b)) return b.values;
    if (failure) throw failure; throw new Error("Lease release did not converge."); }
  function terminalFrame(plan, projection) { const f = frame(plan, true), closed = classifyPullRequest(f.p), released = classifyLeaseRelease(f.p, projection);
    if (closed.state !== "complete" || released.state !== "complete") throw new Error("Terminal effects are incomplete.");
    return { source: f.src, pr: f.pr, marker: f.marker, claim: f.p.evidence.claim,
      checkpoint: f.p.evidence.checkpoint, closed: closed.values, released: released.values };
  }
  function readTerminalEvidence(plan, projection) { if (d.readTerminalEvidence) return d.readTerminalEvidence({ plan, projection,
    preservation: PRESERVATION, effects: EFFECTS }); const p = planEvidence(plan), a = terminalFrame(p, projection), b = terminalFrame(p, projection);
    if (canonicalJson(a) !== canonicalJson(b)) throw new Error("Terminal evidence changed during double read.");
    const s = b.source, e = p.evidence, core = { schema: TERMINAL_EVIDENCE_SCHEMA, planDigest: p.planDigest,
      source: { worktreePath: s.worktreePath, branch: s.branch, headSha: s.headSha, treeSha: s.treeSha,
        localBranchSha: s.localBranchSha, remoteBranchSha: s.remoteBranchSha, statusDigest: s.statusDigest,
        clean: s.clean, registered: s.registered },
      sourcePullRequest: { number: b.pr.number, nodeId: b.pr.nodeId, state: b.pr.state, isDraft: b.pr.isDraft,
        mergedAt: b.pr.mergedAt, closedAt: b.pr.closedAt, headBranch: b.pr.headBranch, headSha: b.pr.headSha,
        bodyDigest: digestValue(b.pr.body), markerDigest: digestValue(b.marker) },
      mergedPullRequest: pick(e.mergedPullRequest, ["number", "nodeId", "state", "mergedAt", "headSha", "headTreeSha", "mergeCommitSha", "mergeCommitTreeSha"]),
      claim: pick(e.claim, ["claimId", "state", "retirementReason", "integrationEntryDigest", "retirementEntryDigest", "integrationReceiptDigest"]),
      lease: b.released, checkpoint: pick(e.checkpoint, ["path", "status", "rawDigest", "identityDigest"]),
      preservation: PRESERVATION, effects: EFFECTS };
    return { ...core, terminalEvidenceDigest: digestValue(core) }; }
  function readState() { if (!existsSync(journalPath)) return null; privateFile(journalPath, "journal");
    try { return JSON.parse(readFileSync(journalPath, "utf8")); } catch { throw new Error("Journal JSON is invalid."); } }
  function writeState({ expected, next } = {}) { if (!next || typeof next !== "object") throw new Error("Next intent is required.");
    if (canonicalJson(readState()) !== canonicalJson(expected ?? null)) throw new Error("Journal CAS changed.");
    ensureRoot(journalRoot); atomicJson(journalPath, next); const got = readState(); same(got, next, "journal"); return got; }
  async function withLock(context, action) { if (typeof action !== "function") throw new Error("Lock action is required.");
    ensureRoot(journalRoot); const token = digestValue({ key, planDigest: context?.planDigest ?? null, nonce: randomUUID(), pid: process.pid });
    let fd; try { fd = openSync(lockPath, "wx", 0o600); writeFileSync(fd, `${token}\n`); fsyncSync(fd); closeSync(fd); }
    catch (e) { if (fd !== undefined) try { closeSync(fd); } catch {} throw new Error(`Reconciliation lock unavailable: ${e.message}`); }
    try { return await action(); } finally { privateFile(lockPath, "operation lock");
      if (readFileSync(lockPath, "utf8") !== `${token}\n`) throw new Error("Operation lock ownership changed.");
      unlinkSync(lockPath); syncDir(journalRoot); } }
  return Object.freeze({ captureEvidence, reverify, verifyTaskAuthority, readState, writeState,
    readIntent: readState, writeIntent: writeState, withLock, classifyPullRequest, closePullRequest,
    prepareLeaseRelease, classifyLeaseRelease, releaseLease, readTerminalEvidence });
}

function normalizePr(v) { if (v?.nodeId && v?.headSha) return { ...structuredClone(v), body: String(v.body ?? ""),
  mergedAt: v.mergedAt ?? null, closedAt: v.closedAt ?? null, autoMergeRequest: v.autoMergeRequest ?? null };
  return { number: Number(v?.number), nodeId: v?.node_id, url: v?.html_url,
    state: v?.merged_at ? "MERGED" : String(v?.state || "").toUpperCase(), isDraft: v?.draft,
    mergedAt: v?.merged_at ?? null, closedAt: v?.closed_at ?? null, autoMergeRequest: v?.auto_merge ?? null,
    headRepository: v?.head?.repo?.full_name, headBranch: v?.head?.ref, headSha: v?.head?.sha,
    baseRepository: v?.base?.repo?.full_name, baseBranch: v?.base?.ref, baseSha: v?.base?.sha,
    mergeCommitSha: v?.merge_commit_sha ?? null, body: String(v?.body ?? "") }; }
function githubLedger(repository, gh) { const ref = gh(["api", `repos/${repository}/git/ref/heads/${encodeURIComponent(DEFAULT_LEDGER_REF)}`]);
  const rev = sh(ref?.object?.sha, "ledger ref"), meta = gh(["api", `repos/${repository}/contents/${DEFAULT_LEDGER_PATH}?ref=${rev}`]);
  const blob = gh(["api", `repos/${repository}/git/blobs/${sh(meta?.sha, "ledger blob")}`]);
  if (blob?.encoding !== "base64") throw new Error("Ledger blob is incomplete.");
  return { ledger: JSON.parse(Buffer.from(String(blob.content).replaceAll("\n", ""), "base64").toString("utf8")) }; }
function privateJson(file, label) { privateFile(file, label); const raw = readFileSync(file, "utf8");
  try { return { raw, value: JSON.parse(raw) }; } catch { throw new Error(`${label} JSON is invalid.`); } }
function privateFile(file, label) { regularFile(file, label); const s = lstatSync(file);
  if ((s.mode & 0o077) || typeof process.getuid === "function" && s.uid !== process.getuid()) throw new Error(`${label} must be owner-only.`); }
function regularFile(file, label) { const s = lstatSync(file); if (!s.isFile() || s.isSymbolicLink()) throw new Error(`${label} must be a regular file.`); }
function ensureRoot(root) { const parent = path.dirname(root), p = lstatSync(parent); if (!p.isDirectory() || p.isSymbolicLink()) throw new Error("State parent is invalid.");
  if (!existsSync(root)) mkdirSync(root, { mode: 0o700 }); const s = lstatSync(root);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077)) throw new Error("Journal directory must be private."); }
function atomicJson(file, value) { if (existsSync(file)) privateFile(file, "journal"); const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`; let fd;
  try { fd = openSync(tmp, "wx", 0o600); writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(tmp, file); syncDir(path.dirname(file)); privateFile(file, "journal"); }
  catch (e) { if (fd !== undefined) try { closeSync(fd); } catch {} if (existsSync(tmp)) unlinkSync(tmp); throw e; } }
function syncDir(dir) { let fd; try { fd = openSync(dir, "r"); fsyncSync(fd); }
  catch (e) { if (!["EINVAL", "ENOTSUP", "EBADF"].includes(e?.code)) throw e; } finally { if (fd !== undefined) closeSync(fd); } }
function originName(repo, git) { const url = text(git(repo, ["remote", "get-url", "origin"]), "origin"), m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/u);
  if (!m) throw new Error("Origin is not GitHub."); return `${m[1]}/${m[2].replace(/\.git$/u, "")}`; }
function repositoryName(v) { const x = text(v, "repository"); if (!/^[\w.-]+\/[\w.-]+$/u.test(x)) throw new Error("Repository name is invalid."); return x; }
function pages(v) { return Array.isArray(v) && v.every(Array.isArray) ? v.flat() : v; }
function paths(v) { if (!Array.isArray(v)) throw new Error("Paths must be an array."); const x = [...new Set(v.map(p => text(p, "path")))].sort();
  if (x.length !== v.length) throw new Error("Paths must be unique."); return x; }
function nul(v) { const x = String(v).split("\0"); if (x.at(-1) === "") x.pop(); return x; }
function pick(v, keys) { return Object.fromEntries(keys.map(k => [k, v[k]])); }
function without(v, key) { const x = { ...v }; delete x[key]; return x; }
function manyWithout(v, keys) { const x = { ...v }; keys.forEach(k => delete x[k]); return x; }
function same(a, b, label) { if (canonicalJson(a) !== canonicalJson(b)) throw new Error(`${label} changed.`); }
function exit(git, cwd, args) { try { git(cwd, args); return false; } catch { return true; } }
function text(v, label) { if (typeof v !== "string" || !v || v.trim() !== v) throw new Error(`${label} is required.`); return v; }
function pos(v, label) { const x = Number(v); if (!Number.isSafeInteger(x) || x < 1) throw new Error(`${label} is invalid.`); return x; }
function sh(v, label) { const x = String(v || ""); if (!SHA.test(x)) throw new Error(`${label} is invalid.`); return x; }
function dg(v, label) { const x = String(v || ""); if (!DG.test(x)) throw new Error(`${label} is invalid.`); return x; }
