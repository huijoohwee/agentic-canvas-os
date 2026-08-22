// Responsibility: Join one exact partial journal to its source marker and admitted successor lease.
import { execFileSync } from "node:child_process";
import { readdirSync, realpathSync } from "node:fs";
import path from "node:path";

import { captureActiveOwnedDirtEvidence }
  from "./active-owned-dirt-recovery-evidence.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { invokeRepositoryCloudVerifier }
  from "./cloud-collaboration-delivery-verifier.mjs";
import { assertAdmissionMutationAuthority }
  from "./scoped-lane-admission-state.mjs";
import { invokeRepositoryCloudAction, verifyAdmissionCloudAuthority }
  from "./scoped-lane-cloud-authority.mjs";
import { authorizeTaskBoundLeaseMutation }
  from "./task-bound-lane-authority-store.mjs";
import { createWriterLeaseStore, parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody }
  from "./writer-lease-lib.mjs";
import { withHeartbeatProjectionFence, writerLeaseDigest }
  from "./writer-lease-registry-cas.mjs";
import { requireSamePlannedOwnedDirt }
  from "./planned-owned-dirt-scope-expansion-recovery-evidence.mjs";
import { createRepositoryPlannedOwnedDirtScopeExpansionRecoveryAdapter }
  from "./planned-owned-dirt-scope-expansion-recovery-repository-adapter.mjs";
import { createPlannedOwnedDirtScopeExpansionStore }
  from "./planned-owned-dirt-scope-expansion-recovery-store.mjs";
import { buildPlan, OPERATION }
  from "./planned-owned-dirt-pr-marker-continuation-contract.mjs";

export function createRepositoryAdapter(options = {}, dependencies = {}) {
  const repository = realpathSync(path.resolve(required(options.repository, "repository")));
  const sourceSessionId = required(options.sourceSessionId, "source session");
  const originalPlanDigest = digest(options.originalPlanDigest, "original plan digest");
  const pullRequestNumber = positive(options.pullRequestNumber, "pull request number");
  const taskAuthorityFile = realpathSync(path.resolve(required(options.taskAuthorityFile,
    "task-authority capability")));
  if (inside(repository, taskAuthorityFile)) invalid("external task-authority capability");
  const environment = dependencies.environment || process.env;
  const execute = dependencies.execute || ((command, argumentsList, cwd = repository) =>
    execFileSync(command, argumentsList, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"], env: environment }));
  const git = dependencies.git || (argumentsList => String(execute("git", argumentsList)).trim());
  const gh = dependencies.gh || (argumentsList => String(execute("gh", argumentsList)).trim());
  const invoke = dependencies.invoke || invokeRepositoryCloudAction;
  const verify = dependencies.verify || invokeRepositoryCloudVerifier;
  const now = dependencies.now || (() => new Date());
  const commonDirectory = realpathSync(path.resolve(repository, git(["rev-parse", "--git-common-dir"])));
  const branch = required(git(["branch", "--show-current"]), "attached branch");
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory, taskAuthorityPolicy: "projected",
  });
  const journalPath = resolveJournal(commonDirectory, originalPlanDigest);
  const store = dependencies.store || createPlannedOwnedDirtScopeExpansionStore({ statePath: journalPath });
  const original = dependencies.originalAdapter
    || createRepositoryPlannedOwnedDirtScopeExpansionRecoveryAdapter({
      repository, sessionId: sourceSessionId, taskAuthorityFile, environment,
    }, { invoke, verify, now });

  function intent() {
    const value = store.read();
    if (!value || value.planDigest !== originalPlanDigest
      || !["local-projected", "pr-marker-projected", "complete"].includes(value.status)) {
      invalid("exact local-projected journal");
    }
    const evidence = value.planSnapshot.evidence;
    if (evidence.branch !== branch || evidence.sessionId !== sourceSessionId
      || evidence.pullRequestUrl !== `https://github.com/${evidence.targetRepository}/pull/${pullRequestNumber}`) {
      invalid("journal source identity");
    }
    return value;
  }

  function targetLease(value) {
    const lease = leaseStore.read(branch);
    const evidence = value.planSnapshot.evidence;
    const authority = value.phases["successor-bound"]?.values?.authority;
    if (lease?.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
      || lease.sessionId !== sourceSessionId || path.resolve(lease.worktreePath || "") !== repository
      || lease.fenceSha !== evidence.fenceSha || lease.admission?.status !== "admitted"
      || lease.admission.writeSetDigest !== value.planSnapshot.target.writeSetDigest
      || lease.cloudAuthority?.claimId !== authority?.claimId
      || lease.taskAuthority?.priorBindingDigest !== evidence.taskAuthorityBindingDigest) {
      invalid("admitted successor lease");
    }
    requireSamePlannedOwnedDirt(evidence, captureActiveOwnedDirtEvidence({ repository }));
    if (git(["rev-parse", "HEAD"]) !== evidence.fenceSha || remoteHead() !== evidence.fenceSha) {
      invalid("unchanged source fence");
    }
    return lease;
  }

  function pullRequest() {
    const value = JSON.parse(gh(["pr", "view", String(pullRequestNumber), "--json",
      "url,number,state,isDraft,headRefName,headRefOid,baseRefName,body,autoMergeRequest"]));
    if (value.number !== pullRequestNumber || value.state !== "OPEN" || value.isDraft !== true
      || value.headRefName !== branch || value.autoMergeRequest !== null) invalid("open draft pull request");
    return value;
  }

  function remoteHead() {
    return remoteSha(git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]));
  }

  function frame(value) {
    const lease = targetLease(value);
    const pull = pullRequest();
    if (pull.headRefOid !== lease.fenceSha) invalid("pull-request head");
    const marker = parseWriterLeasePullRequestBody(pull.body);
    if (!marker) invalid("pull-request writer marker");
    const source = sourceMarker(marker, value.planSnapshot.evidence);
    const target = canonical(marker) === canonical(projectWriterLeasePullRequestMarker(lease));
    if (!source && !target) invalid("source-or-target marker");
    const manifest = targetManifest(value.planSnapshot);
    const verified = verifyAdmissionCloudAuthority({ authority: lease.cloudAuthority, manifest,
      canonicalBaseSha: value.planSnapshot.evidence.baseSha, environment, inspect: invoke,
      invoke: verify });
    const mutation = assertAdmissionMutationAuthority({ lease,
      cloudAuthority: verified.authority, remoteAuthorityVerification: verified.verification });
    return { lease, pull, marker, source, target, verified, mutation };
  }

  return Object.freeze({
    capture() {
      const value = intent();
      const current = frame(value);
      const evidence = value.planSnapshot.evidence;
      return buildPlan({ originalPlanDigest, originalIntentDigest: value.intentDigest,
        repositoryPathDigest: digestValue(repository), branch, sourceSessionId,
        pullRequestUrl: current.pull.url, pullRequestNumber,
        headSha: evidence.fenceSha, remoteHeadSha: remoteHead(), dirtDigest: evidence.dirtDigest,
        successorClaimId: current.lease.cloudAuthority.claimId,
        successorClaimDigest: current.lease.cloudAuthority.claimDigest,
        targetLeaseDigest: writerLeaseDigest(current.lease),
        targetTaskAuthorityBindingDigest: current.lease.taskAuthority.bindingDigest,
        sourceMarkerDigest: digestValue(current.marker), sourceBodyDigest: digestValue(current.pull.body),
        targetMarkerDigest: digestValue(projectWriterLeasePullRequestMarker(current.lease)),
        cloudVerificationReceiptDigest: current.verified.verification.receiptDigest,
        mutationAuthorityReceiptDigest: current.mutation.receiptDigest,
        observedAt: now().toISOString() });
    },
    withLock(_plan, action) { return original.withOperationLock(intent().planSnapshot, action); },
    readIntent(plan) { const value = intent(); assertSealed(plan, value, frame(value)); return value; },
    writeIntent({ expected, next }) { return store.write({ expected, next }); },
    authorizeTask({ plan, intent: value }) {
      const current = frame(value); assertSealed(plan, value, current);
      return authorizeTaskBoundLeaseMutation({ lease: current.lease, capabilityPath: taskAuthorityFile,
        operation: `${OPERATION}:${plan.planDigest}`, now: now() });
    },
    projectMarker({ plan, intent: value }) {
      let current = frame(value); assertSealed(plan, value, current);
      if (!current.target) {
        const intendedBody = updateWriterLeasePullRequestBody(current.pull.body, current.lease);
        withHeartbeatProjectionFence({ leaseStore, branch,
          expectedLeaseDigest: writerLeaseDigest(current.lease),
          expectedClaimId: current.lease.cloudAuthority.claimId,
          action: () => execute("gh", ["pr", "edit", current.pull.url, "--body", intendedBody]) });
        current = frame(value);
      }
      if (!current.target) invalid("projected target marker");
      return Object.freeze({ markerDigest: digestValue(current.marker),
        receiptDigest: digestValue({ schema: "agentic-planned-owned-dirt-pr-marker-continuation-receipt/v1",
          continuationPlanDigest: plan.planDigest, originalPlanDigest,
          pullRequestUrl: current.pull.url, markerDigest: digestValue(current.marker) }) });
    },
    verifyTerminal({ plan, intent: value, replay }) {
      return original.verifyTerminal({ plan, intent: value, replay });
    },
  });

  function assertSealed(plan, value, current) {
    const targetDigest = digestValue(projectWriterLeasePullRequestMarker(current.lease));
    const markerDigest = digestValue(current.marker);
    if (value.planDigest !== plan.originalPlanDigest
      || (value.intentDigest !== plan.originalIntentDigest && value.status === "local-projected")
      || digestValue(repository) !== plan.repositoryPathDigest || branch !== plan.branch
      || current.pull.url !== plan.pullRequestUrl || current.pull.headRefOid !== plan.headSha
      || remoteHead() !== plan.remoteHeadSha || writerLeaseDigest(current.lease) !== plan.targetLeaseDigest
      || current.lease.cloudAuthority.claimId !== plan.successorClaimId
      || current.lease.cloudAuthority.claimDigest !== plan.successorClaimDigest
      || current.lease.taskAuthority.bindingDigest !== plan.targetTaskAuthorityBindingDigest
      || targetDigest !== plan.targetMarkerDigest
      || ![plan.sourceMarkerDigest, plan.targetMarkerDigest].includes(markerDigest)
      || (markerDigest === plan.sourceMarkerDigest && digestValue(current.pull.body) !== plan.sourceBodyDigest)) {
      invalid("sealed execution frame");
    }
  }
}

function sourceMarker(marker, evidence) {
  return marker?.schema === "agentic-writer-lease/v2" && marker.status === "active"
    && marker.sessionId === evidence.sessionId && marker.device === evidence.device
    && marker.scope === evidence.scope && marker.branch === evidence.branch
    && marker.baseSha === evidence.baseSha && marker.fenceSha === evidence.fenceSha
    && marker.admission?.status === "planned"
    && marker.admission.writeSetDigest === evidence.writeSetDigest
    && marker.cloudAuthority?.claimId === evidence.claimId
    && marker.taskAuthority?.bindingDigest === evidence.taskAuthorityBindingDigest;
}
function targetManifest(plan) {
  return { schema: "agentic-declared-write-scope/v1", semanticScope: plan.target.semanticScope,
    declaredWriteSet: plan.target.declaredWriteSet, writeSetDigest: plan.target.writeSetDigest,
    manifestDigest: plan.target.manifestDigest };
}
function resolveJournal(commonDirectory, planDigest) {
  const directory = path.join(commonDirectory, "agentic-canvas-os",
    "planned-owned-dirt-scope-expansion-recovery");
  const matches = readdirSync(directory).filter(name => name.endsWith(`.${planDigest}.json`));
  if (matches.length !== 1) invalid("unique original journal");
  return path.join(directory, matches[0]);
}
function remoteSha(value) { return String(value).trim().split(/\s+/u)[0]; }
function inside(root, candidate) { const relative = path.relative(root, candidate);
  return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
function canonical(value) { return JSON.stringify(value); }
function required(value, label) { if (typeof value !== "string" || !value.trim()) invalid(label); return value; }
function digest(value, label) { if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) invalid(label); return value; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function invalid(label) { throw new Error(`Planned-owned-dirt PR-marker continuation has invalid ${label}.`); }
