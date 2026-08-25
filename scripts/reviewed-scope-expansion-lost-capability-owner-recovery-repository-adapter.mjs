// Responsibility: Join lost-capability owner recovery to Git, GitHub, cloud, lease CAS, and PR marker.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { createTaskAuthorityBinding, createTaskAuthorityProof, projectTaskAuthorityCapability,
  verifyTaskAuthorityProof } from "./task-bound-lane-authority-contract.mjs";
import { readTaskAuthorityCapability } from "./task-bound-lane-authority-store.mjs";
import { createWriterLeaseStore, parseWriterLeasePullRequestBody, projectWriterLeasePullRequestMarker,
  updateWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";
import { mutateWriterLeaseRegistry, writerLeaseDigest } from "./writer-lease-registry-cas.mjs";
import { buildLostCapabilityOwnerRecoveryReceipt, OPERATION }
  from "./reviewed-scope-expansion-lost-capability-owner-recovery-contract.mjs";
import { readReviewedTerminalHandoffSourceJournal, normalizeScopeExpansionTargetManifest,
  scopeCoversPath } from "./reviewed-terminal-handoff-scope-expansion-recovery-evidence.mjs";
import { sealLostCapabilityOwnerRecoveryEvidence, EVIDENCE_SCHEMA }
  from "./reviewed-scope-expansion-lost-capability-owner-recovery-evidence.mjs";

export function createLostCapabilityOwnerRecoveryRepositoryAdapter(options = {}, dependencies = {}) {
  const repository = realpathSync(path.resolve(required(options.repository, "repository")));
  const capabilityPath = external(repository, options.taskAuthorityFile, "replacement capability");
  const manifestPath = external(repository, options.targetManifestFile, "target manifest");
  const environment = options.environment || process.env;
  const execute = (command, args) => execFileSync(command, args, { cwd: repository, encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).trim();
  const git = dependencies.gitText || (args => execute("git", args));
  const gh = dependencies.ghText || (args => execute("gh", args));
  const ghJson = dependencies.ghJson || (args => JSON.parse(execute("gh", args)));
  const cloud = dependencies.cloud || invokeRepositoryCloudAction;
  const branch = required(git(["branch", "--show-current"]), "branch");
  const common = path.resolve(repository, git(["rev-parse", "--git-common-dir"]));
  const store = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir: common });
  const journalRoot = path.join(common, "agentic-canvas-os", OPERATION);

  function lease() { const value = store.read(branch); if (!value) throw new Error("Owner-recovery lease is missing."); return value; }
  function pull(value = lease()) {
    const number = Number(value.pullRequestUrl.split("/").at(-1));
    return ghJson(["pr", "view", String(number), "--repo", value.cloudAuthority.targetRepository,
      "--json", "url,number,id,state,isDraft,headRefName,headRefOid,baseRefOid,body,files"]);
  }
  function sourceClaim(value, sourceJournal) {
    const status = cloud({ action: "status", ledgerRepository: value.cloudAuthority.ledgerRepository,
      request: { targetRepository: value.cloudAuthority.targetRepository }, environment });
    const matches = (status.claims || []).filter(item => item.claimId === sourceJournal.successor.claimId);
    if (matches.length !== 1) throw new Error("Owner recovery requires one immutable live successor record.");
    return matches[0];
  }
  function frame() {
    const record = assertRegisteredWorktree({ cwd: repository,
      porcelain: git(["worktree", "list", "--porcelain", "-z"]) });
    if (realpathSync(record.path) !== repository || record.branch !== `refs/heads/${branch}`) {
      throw new Error("Owner recovery requires the registered source worktree.");
    }
    const value = lease();
    if (value.status !== "review_ready" || value.admission?.status !== "admitted"
      || value.worktreePath !== repository || git(["status", "--porcelain"])) {
      throw new Error("Owner recovery requires one clean review-ready admitted lane.");
    }
    const headSha = sha(git(["rev-parse", "HEAD"]), "HEAD");
    const remote = git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).split(/\s+/u)[0];
    if (headSha !== value.reviewHeadSha || remote !== headSha) throw new Error("Owner recovery source bytes drifted.");
    const sourceJournal = readReviewedTerminalHandoffSourceJournal({ commonDirectory: common, branch });
    const request = pull(value);
    const files = (request.files || []).map(item => item.path).sort();
    const marker = parseWriterLeasePullRequestBody(request.body);
    if (request.state !== "OPEN" || request.isDraft || request.headRefName !== branch
      || request.headRefOid !== headSha || digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(value))) {
      throw new Error("Owner recovery pull request no longer joins the source lease.");
    }
    const manifest = normalizeScopeExpansionTargetManifest(JSON.parse(readFileSync(manifestPath, "utf8")),
      value.admission.semanticScope);
    const missing = files.filter(item => !scopeCoversPath(value.admission.declaredWriteSet, item));
    const additions = manifest.declaredWriteSet.filter(item => !value.admission.declaredWriteSet.includes(item));
    if (!files.every(item => scopeCoversPath(manifest.declaredWriteSet, item))
      || JSON.stringify(additions) !== JSON.stringify(missing.map(item => `path:${item}`).sort())) {
      throw new Error("Owner recovery manifest must add exactly the uncovered pull-request paths.");
    }
    const replacement = projectTaskAuthorityCapability(readTaskAuthorityCapability(capabilityPath));
    if (replacement.generation !== value.taskAuthority.generation + 1
      || replacement.authoritySubjectId === value.taskAuthority.authoritySubjectId) {
      throw new Error("Owner recovery requires one distinct next-generation capability.");
    }
    return { value, headSha, sourceJournal, claim: sourceClaim(value, sourceJournal), request, files,
      missing, manifest, replacement };
  }

  return Object.freeze({
    now: () => new Date().toISOString(),
    captureEvidence() {
      const current = frame();
      const core = { schema: EVIDENCE_SCHEMA, repository, branch, headSha: current.headSha,
        treeSha: sha(git(["show", "-s", "--format=%T", current.headSha]), "tree"),
        sourceLeaseDigest: writerLeaseDigest(current.value), sourceBinding: current.value.taskAuthority,
        sourceClaim: current.claim, sourceJournalPath: current.sourceJournal.path,
        sourceJournalBytesDigest: current.sourceJournal.bytesDigest,
        pullRequest: { url: current.request.url, number: current.request.number, id: current.request.id,
          baseSha: current.request.baseRefOid, headSha: current.request.headRefOid,
          bodyRemainderDigest: remainderDigest(current.request.body), filesDigest: digestValue(current.files) },
        changedPaths: current.files, missingPaths: current.missing, targetManifest: current.manifest,
        targetCapability: current.replacement, targetCapabilityDigest: digestValue(current.replacement) };
      return sealLostCapabilityOwnerRecoveryEvidence(core);
    },
    assertStable(plan) { assertStable(plan); },
    readJournal(digest) { const file = journalFile(digest); return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null; },
    writeJournal(digest, value) {
      mkdirSync(journalRoot, { recursive: true, mode: 0o700 });
      const target = journalFile(digest), temporary = `${target}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); renameSync(temporary, target);
    },
    projectBinding(plan, authorization) {
      const current = assertStable(plan, { allowTarget: true });
      const capability = readTaskAuthorityCapability(capabilityPath);
      if (digestValue(projectTaskAuthorityCapability(capability)) !== plan.evidence.targetCapabilityDigest) {
        throw new Error("Replacement capability changed after authorization.");
      }
      if (current.value.taskAuthority.bindingMode === "handoff"
        && current.value.taskAuthority.transitionPlanDigest === plan.planDigest
        && current.value.taskAuthority.authoritySubjectId === plan.evidence.targetCapability.authoritySubjectId) {
        return bindingResult(plan, current.value, capability, authorization, true);
      }
      if (writerLeaseDigest(current.value) !== plan.evidence.sourceLeaseDigest
        || current.value.taskAuthority.bindingDigest !== plan.evidence.sourceBinding.bindingDigest) {
        throw new Error("Source task binding changed before owner-recovery CAS.");
      }
      const boundAt = new Date().toISOString();
      const binding = createTaskAuthorityBinding({ capability, lease: current.value, bindingMode: "handoff",
        boundAt, transitionPlanDigest: plan.planDigest,
        priorBindingDigest: current.value.taskAuthority.bindingDigest });
      const target = { ...current.value, taskAuthority: binding };
      const operation = `${OPERATION}:${plan.planDigest}:local-cas`;
      const proof = createTaskAuthorityProof({ capability, binding, lease: target, operation });
      const verified = verifyTaskAuthorityProof({ proof, binding, lease: target, operation });
      const result = mutateWriterLeaseRegistry({ leaseStore: store, branch,
        expectedLeaseDigest: plan.evidence.sourceLeaseDigest, expectedClaimId: current.value.cloudAuthority.claimId,
        action: ({ registry, lease: source }) => {
          if (writerLeaseDigest(source) !== plan.evidence.sourceLeaseDigest) throw new Error("Owner-recovery registry CAS drifted.");
          return { registry: { ...registry, leases: { ...registry.leases, [branch]: target } }, lease: target, changed: true };
        } });
      return { sourceLeaseDigest: plan.evidence.sourceLeaseDigest, targetLeaseDigest: writerLeaseDigest(result.lease),
        targetBindingDigest: binding.bindingDigest, proofDigest: verified.proofDigest,
        authorizationReceiptDigest: authorization.receiptDigest, replayed: false };
    },
    projectPullRequest(plan, authorization, bindingValues) {
      const current = assertStable(plan, { allowTarget: true });
      const expected = projectWriterLeasePullRequestMarker(current.value);
      if (remainderDigest(current.request.body) !== plan.evidence.pullRequest.bodyRemainderDigest) {
        throw new Error("Pull-request authored body changed during owner recovery.");
      }
      if (digestValue(parseWriterLeasePullRequestBody(current.request.body)) !== digestValue(expected)) {
        gh(["pr", "edit", current.request.url, "--body", updateWriterLeasePullRequestBody(current.request.body, current.value)]);
      }
      const markerDigest = digestValue(parseWriterLeasePullRequestBody(pull(current.value).body));
      if (markerDigest !== digestValue(expected)) throw new Error("Owner-recovery PR marker did not converge.");
      return buildLostCapabilityOwnerRecoveryReceipt({ plan, authorization,
        sourceLeaseDigest: bindingValues.sourceLeaseDigest, targetLeaseDigest: bindingValues.targetLeaseDigest,
        targetBindingDigest: bindingValues.targetBindingDigest, proofDigest: bindingValues.proofDigest,
        markerDigest, recoveredAt: new Date().toISOString(), replayed: bindingValues.replayed });
    },
    verifyComplete(plan, completion) {
      const current = assertStable(plan, { allowTarget: true });
      if (current.value.taskAuthority.bindingDigest !== completion.targetBindingDigest
        || writerLeaseDigest(current.value) !== completion.targetLeaseDigest) {
        throw new Error("Owner-recovery completion no longer matches the live lease.");
      }
    },
  });

  function assertStable(plan, { allowTarget = false } = {}) {
    const current = frame();
    const source = writerLeaseDigest(current.value) === plan.evidence.sourceLeaseDigest;
    const target = allowTarget && current.value.taskAuthority.transitionPlanDigest === plan.planDigest
      && current.value.taskAuthority.authoritySubjectId === plan.evidence.targetCapability.authoritySubjectId;
    if (!source && !target) throw new Error("Owner-recovery lease drifted from the sealed plan.");
    if (current.headSha !== plan.evidence.headSha || current.request.baseRefOid !== plan.evidence.pullRequest.baseSha
      || digestValue(current.files) !== plan.evidence.pullRequest.filesDigest
      || current.sourceJournal.bytesDigest !== plan.evidence.sourceJournalBytesDigest
      || current.claim.claimId !== plan.evidence.sourceClaim.claimId
      || current.claim.fenceRevision !== plan.evidence.sourceClaim.fenceRevision) {
      throw new Error("Owner-recovery evidence drifted from the sealed plan.");
    }
    return current;
  }
  function bindingResult(plan, value, capability, authorization, replayed) {
    const operation = `${OPERATION}:${plan.planDigest}:local-cas`;
    const proof = createTaskAuthorityProof({ capability, binding: value.taskAuthority, lease: value, operation });
    const verified = verifyTaskAuthorityProof({ proof, binding: value.taskAuthority, lease: value, operation });
    return { sourceLeaseDigest: plan.evidence.sourceLeaseDigest, targetLeaseDigest: writerLeaseDigest(value),
      targetBindingDigest: value.taskAuthority.bindingDigest, proofDigest: verified.proofDigest,
      authorizationReceiptDigest: authorization.receiptDigest, replayed };
  }
  function journalFile(digest) { return path.join(journalRoot, `${digest}.json`); }
}

function remainderDigest(body) { return digestValue(String(body || "").replace(/<!--\s*agentic-writer-lease\/v2\s+\{.*?\}\s*-->/su, "").trim()); }
function external(repository, value, label) { const target = path.resolve(required(value, label)); if (!target.startsWith(`${repository}${path.sep}`)) return target; throw new Error(`${label} must remain outside the source repository.`); }
function required(value, label) { const text = String(value || "").trim(); if (!text) throw new Error(`${label} is required.`); return text; }
function sha(value, label) { if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) throw new Error(`${label} is invalid.`); return value; }
