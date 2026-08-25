// Responsibility: Bind reviewed-handoff scope repair to Git, GitHub, cloud, task proof, and lease CAS.
import { execFileSync } from "node:child_process";
import {
  existsSync, mkdirSync, readFileSync, realpathSync, renameSync,
} from "node:fs";
import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import {
  bindAdmissionCloudAuthority, invokeRepositoryCloudAction,
  reviewReadyAdmissionCloudAuthority, verifyReviewReadyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import { normalizeBoundAuthority } from "./scoped-lane-cloud-reconciliation.mjs";
import {
  createTaskAuthorityBinding, createTaskAuthorityProof, projectTaskAuthorityCapability,
  verifyTaskAuthorityProof,
} from "./task-bound-lane-authority-contract.mjs";
import { readTaskAuthorityCapability } from "./task-bound-lane-authority-store.mjs";
import {
  createWriterLeaseStore, parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import { mutateWriterLeaseRegistry, writerLeaseDigest }
  from "./writer-lease-registry-cas.mjs";
import { createScopeExpansionRecoveryJournalStore }
  from "./reviewed-terminal-handoff-scope-expansion-recovery-contract.mjs";
import {
  buildScopeExpansionTargetAdmission, normalizeScopeExpansionTargetManifest,
  readReviewedTerminalHandoffSourceJournal, scopeCoversPath,
  sealScopeExpansionRecoveryEvidence,
} from "./reviewed-terminal-handoff-scope-expansion-recovery-evidence.mjs";

export function createReviewedTerminalHandoffScopeExpansionRecoveryRepositoryAdapter(
  options = {}, dependencies = {},
) {
  const repository = realpathSync(path.resolve(requiredText(options.repository, "repository")));
  const manifestPath = externalPath(repository, options.targetManifestFile, "target manifest");
  const capabilityPath = externalPath(repository, options.taskAuthorityFile, "task capability");
  const environment = options.environment || process.env;
  const execute = (command, args, settings = {}) => execFileSync(command, args, {
    cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024, ...settings,
  });
  const git = dependencies.gitText || (args => execute("git", args).trim());
  const gh = dependencies.ghText || (args => execute("gh", args).trim());
  const ghJson = dependencies.ghJson || (args => JSON.parse(execute("gh", args)));
  const invoke = dependencies.invoke || invokeRepositoryCloudAction;
  const verify = dependencies.verify;
  const branch = requiredText(git(["branch", "--show-current"]), "branch");
  const common = path.resolve(repository, git(["rev-parse", "--git-common-dir"]));
  const store = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir: common });
  const journal = createScopeExpansionRecoveryJournalStore({ commonDirectory: common, branch });

  function readLease() {
    const lease = store.read(branch);
    if (!lease || lease.branch !== branch) throw new Error("Scope repair writer lease is missing.");
    return lease;
  }
  function status(lease = readLease()) {
    const result = invoke({ action: "status", ledgerRepository: lease.cloudAuthority.ledgerRepository,
      request: { targetRepository: lease.cloudAuthority.targetRepository }, environment });
    if (result?.ok !== true || result.action !== "status" || !Array.isArray(result.claims)) {
      throw new Error("Scope repair cloud status is incomplete.");
    }
    return result;
  }
  function pull(lease = readLease()) {
    const number = positive(Number(lease.pullRequestUrl.split("/").at(-1)), "pull-request number");
    const value = ghJson(["pr", "view", String(number), "--repo", lease.cloudAuthority.targetRepository,
      "--json", "url,number,id,state,isDraft,headRefName,headRefOid,baseRefOid,body,files"]);
    return Object.freeze({ ...value, files: (value.files || []).map(item => item.path).sort() });
  }
  function remoteHead() {
    const line = git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
    return sha(line.split(/\s+/u)[0], "remote branch head");
  }
  function targetManifest(scope) {
    return normalizeScopeExpansionTargetManifest(JSON.parse(readFileSync(manifestPath, "utf8")), scope);
  }

  function captureEvidence() {
    const record = assertRegisteredWorktree({ cwd: repository,
      porcelain: git(["worktree", "list", "--porcelain", "-z"]) });
    if (realpathSync(record.path) !== repository || record.branch !== `refs/heads/${branch}`) {
      throw new Error("Scope repair branch does not own its registered worktree.");
    }
    const lease = readLease();
    if (lease.schema !== "agentic-writer-lease/v2" || lease.status !== "review_ready"
      || lease.admission?.status !== "admitted" || lease.worktreePath !== repository) {
      throw new Error("Scope repair requires the exact locally review-ready source lease.");
    }
    const headSha = sha(git(["rev-parse", "HEAD"]), "HEAD");
    if (headSha !== lease.reviewHeadSha || remoteHead() !== headSha
      || git(["status", "--porcelain"])) {
      throw new Error("Scope repair requires clean joined local and remote reviewed bytes.");
    }
    const sourceJournal = readReviewedTerminalHandoffSourceJournal({ commonDirectory: common, branch });
    const cloud = status(lease);
    const sourceMatches = cloud.claims.filter(item => item.claimId === sourceJournal.successor.claimId);
    if (sourceMatches.length !== 1) throw new Error("Bound recovery successor is not uniquely live.");
    const sourceClaim = sourceMatches[0];
    if (sourceClaim.fenceRevision !== sourceJournal.successor.claimDigest
      || sourceClaim.canonicalBaseRevision !== lease.cloudAuthority.canonicalBaseSha
      || sourceClaim.laneRevision !== headSha
      || sourceClaim.writeSetDigest !== lease.admission.writeSetDigest
      || sourceClaim.reviewRequestId !== lease.cloudAuthority.reviewRequestId
      || !["active", "current", "dormant-preserved"].includes(sourceClaim.state)) {
      throw new Error("Bound recovery successor drifted from its immutable source journal.");
    }
    const request = pull(lease);
    const marker = parseWriterLeasePullRequestBody(request.body);
    if (request.state !== "OPEN" || request.isDraft || request.headRefName !== branch
      || request.headRefOid !== headSha
      || digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))) {
      throw new Error("Scope repair pull request no longer joins the source lease.");
    }
    const target = targetManifest(lease.admission.semanticScope);
    const changedPaths = request.files;
    const missingPaths = changedPaths.filter(item => !scopeCoversPath(lease.admission.declaredWriteSet, item));
    const additions = target.declaredWriteSet.filter(item => !lease.admission.declaredWriteSet.includes(item));
    if (!changedPaths.every(item => scopeCoversPath(target.declaredWriteSet, item))
      || JSON.stringify(additions) !== JSON.stringify(missingPaths.map(item => `path:${item}`).sort())) {
      throw new Error("Target manifest must add exactly the uncovered pull-request paths.");
    }
    const capability = projectTaskAuthorityCapability(readTaskAuthorityCapability(capabilityPath));
    if (capability.authoritySubjectId !== lease.taskAuthority?.authoritySubjectId
      || capability.generation !== lease.taskAuthority?.generation
      || capability.publicKeyDigest !== lease.taskAuthority?.publicKeyDigest) {
      throw new Error("Scope repair task capability does not match the bound task subject.");
    }
    const core = { branch, headSha, treeSha: sha(git(["show", "-s", "--format=%T", headSha]), "tree"),
      localLeaseDigest: writerLeaseDigest(lease), localClaimId: lease.cloudAuthority.claimId,
      sourceAdmission: lease.admission, sourceJournalPath: sourceJournal.path,
      sourceJournalBytesDigest: sourceJournal.bytesDigest, sourceJournalEnvelopeDigest: sourceJournal.envelopeDigest,
      sourceJournalIntentDigest: sourceJournal.intentDigest, sourceJournalPlanDigest: sourceJournal.planDigest,
      sourceJournalPhase: sourceJournal.phase, sourceJournalSuccessor: sourceJournal.successor,
      sourceOperatorSessionId: sourceJournal.operatorSessionId, sourceClaim,
      pullRequest: { url: request.url, number: request.number, id: request.id,
        baseSha: request.baseRefOid, headSha: request.headRefOid,
        bodyRemainderDigest: bodyRemainderDigest(request.body), filesDigest: digestValue(changedPaths) },
      changedPaths, missingPaths, targetManifest: target,
      taskCapabilityDigest: digestValue(capability) };
    return sealScopeExpansionRecoveryEvidence(core);
  }

  function claimById(claimId) {
    const inventory = status();
    const matches = inventory.claims.filter(item => item.claimId === claimId);
    return { inventory, claim: matches.length === 1 ? matches[0] : null };
  }
  function sourceValues(context) { return context.intent.receipts["source-recovered"].values; }
  function successorValues(context) { return context.intent.receipts["successor-claimed"].values; }
  function resultValues(kind, result) {
    const claim = result.claim;
    return effect(kind, { claimId: claim.claimId, claimDigest: claim.fenceRevision,
      transitionCounter: claim.transitionCounter, state: claim.state,
      expiresAt: claim.expiresAt, ledgerRevision: result.ledgerRevision,
      ledgerDigest: result.ledgerDigest || result.receipt?.ledgerDigest,
      operationReceiptDigest: claim.operationReceiptDigest,
      receiptDigest: result.receipt?.receiptDigest || claim.operationReceiptDigest });
  }
  function manifest(plan) { return plan.evidence.targetManifest; }
  function targetAdmission(plan, result) {
    return buildScopeExpansionTargetAdmission({ sourceAdmission: plan.evidence.sourceAdmission,
      targetManifest: manifest(plan), planDigest: plan.planDigest,
      operationReceiptDigest: result.operationReceiptDigest, claimId: result.claimId });
  }
  function authorityFromInventory(plan, values) {
    const { inventory, claim } = claimById(values.claimId);
    if (!claim) throw new Error("Scope repair successor is no longer uniquely live.");
    const result = { schema: "agentic-cloud-collaboration-result/v1", ok: true, action: "continue",
      ledgerRevision: inventory.ledgerRevision, ledgerDigest: inventory.ledgerDigest,
      claim, claimDigest: claim.fenceRevision };
    return normalizeBoundAuthority({ result,
      authority: { ...plan.evidence.sourceJournalSuccessor,
        ledgerRepository: readLease().cloudAuthority.ledgerRepository,
        targetRepository: readLease().cloudAuthority.targetRepository,
        deviceId: readLease().device, sessionId: plan.operatorSessionId },
      manifest: manifest(plan), deviceId: readLease().device, sessionId: plan.operatorSessionId });
  }

  const adapter = {
    captureEvidence, readIntent: journal.read, writeIntent: journal.write, withFence: journal.withFence,
    recoverSource(context) {
      const source = context.plan.evidence.sourceClaim;
      const result = invoke({ action: "continue", ledgerRepository: readLease().cloudAuthority.ledgerRepository,
        request: { targetRepository: readLease().cloudAuthority.targetRepository,
          claimId: source.claimId, expectedFenceRevision: source.fenceRevision,
          expectedTransitionCounter: source.transitionCounter, mode: "recovery",
          ttlSeconds: context.plan.ttlSeconds, recoveryEvidenceDigest: context.operationKey,
          deviceId: readLease().device, sessionId: context.plan.evidence.sourceOperatorSessionId,
          idempotencyKey: `${context.plan.operation}:recover:${context.plan.planDigest}` }, environment });
      if (result?.ok !== true || result.action !== "continue" || result.claim?.claimId !== source.claimId
        || result.claim.state !== "current") throw new Error("Source successor recovery did not converge.");
      return resultValues("source-recovered", result);
    },
    claimSuccessor(context) {
      const source = sourceValues(context);
      const result = invoke({ action: "claim", ledgerRepository: readLease().cloudAuthority.ledgerRepository,
        request: { targetRepository: readLease().cloudAuthority.targetRepository,
          workItemId: context.plan.evidence.sourceClaim.workItemId,
          canonicalBaseSha: context.plan.evidence.sourceClaim.canonicalBaseRevision,
          headSha: context.plan.evidence.headSha,
          declaredWriteSet: manifest(context.plan).declaredWriteSet,
          predecessorClaimId: source.claimId, leaseEpoch: context.plan.targetCloudLeaseEpoch,
          ttlSeconds: context.plan.ttlSeconds, deviceId: readLease().device,
          sessionId: context.plan.operatorSessionId,
          idempotencyKey: `${context.plan.operation}:claim:${context.plan.planDigest}` }, environment });
      if (result?.ok !== true || result.action !== "claim" || result.claim?.state !== "waiting-successor"
        || result.claim.predecessorClaimId !== source.claimId
        || result.claim.writeSetDigest !== manifest(context.plan).writeSetDigest) {
        throw new Error("Cloud did not create the exact expanded waiting successor.");
      }
      return resultValues("successor-claimed", result);
    },
    retireSource(context) {
      const source = sourceValues(context), successor = successorValues(context);
      const result = invoke({ action: "retire", ledgerRepository: readLease().cloudAuthority.ledgerRepository,
        request: { targetRepository: readLease().cloudAuthority.targetRepository,
          claimId: source.claimId, expectedFenceRevision: source.claimDigest,
          expectedTransitionCounter: source.transitionCounter, reason: "superseded",
          finalRevision: context.plan.evidence.headSha,
          reviewRequestId: context.plan.evidence.sourceClaim.reviewRequestId,
          bytesDigest: digestValue({ operationKey: context.operationKey, kind: "bytes" }),
          namedChecksDigest: digestValue({ operationKey: context.operationKey, kind: "checks" }),
          handoffEvidenceDigest: digestValue({ operationKey: context.operationKey, successor: successor.claimId }),
          deviceId: readLease().device, sessionId: context.plan.evidence.sourceOperatorSessionId,
          idempotencyKey: `${context.plan.operation}:retire:${context.plan.planDigest}` }, environment });
      if (result?.ok !== true || result.action !== "retire" || result.claim?.claimId !== source.claimId
        || !["retired", "released"].includes(result.claim.state)) throw new Error("Source retirement did not converge.");
      return resultValues("source-retired", result);
    },
    promoteSuccessor(context) {
      const successor = successorValues(context);
      const result = invoke({ action: "continue", ledgerRepository: readLease().cloudAuthority.ledgerRepository,
        request: { targetRepository: readLease().cloudAuthority.targetRepository,
          claimId: successor.claimId, expectedFenceRevision: successor.claimDigest,
          expectedTransitionCounter: successor.transitionCounter, mode: "promote",
          ttlSeconds: context.plan.ttlSeconds, deviceId: readLease().device,
          sessionId: context.plan.operatorSessionId,
          idempotencyKey: `${context.plan.operation}:promote:${context.plan.planDigest}` }, environment });
      if (result?.ok !== true || result.claim?.state !== "current") throw new Error("Expanded successor promotion failed.");
      return resultValues("successor-promoted", result);
    },
    bindSuccessor(context) {
      const promoted = context.intent.receipts["successor-promoted"].values;
      const seed = authorityFromInventory(context.plan, promoted);
      const admission = targetAdmission(context.plan, promoted);
      const result = bindAdmissionCloudAuthority({ authority: seed, manifest: admission,
        branch, headSha: context.plan.evidence.headSha,
        reviewRequestId: context.plan.evidence.sourceClaim.reviewRequestId,
        pullRequestNumber: context.plan.evidence.pullRequest.number,
        deviceId: readLease().device, sessionId: context.plan.operatorSessionId,
        idempotencyKey: `${context.plan.operation}:bind:${context.plan.planDigest}`,
        returnVerification: true, environment, invoke, inspect: invoke, ...(verify ? { verify } : {}) });
      return effect("successor-bound", { authority: result.authority,
        verificationDigest: result.verification.receiptDigest,
        receiptDigest: result.verification.receiptDigest });
    },
    markSuccessorReviewReady(context) {
      const bound = context.intent.receipts["successor-bound"].values.authority;
      const admission = targetAdmission(context.plan,
        context.intent.receipts["successor-promoted"].values);
      const result = reviewReadyAdmissionCloudAuthority({ authority: bound, manifest: admission,
        branch, headSha: context.plan.evidence.headSha,
        pullRequestNumber: context.plan.evidence.pullRequest.number,
        reviewRequestId: context.plan.evidence.sourceClaim.reviewRequestId,
        deviceId: readLease().device, sessionId: context.plan.operatorSessionId,
        environment, invoke, inspect: invoke, ...(verify ? { verify } : {}) });
      return effect("successor-review-ready", { authority: result.authority,
        verificationDigest: result.verification.receiptDigest,
        receiptDigest: result.verification.receiptDigest });
    },
    projectLocal(context) {
      requireCurrentBytes(context.plan);
      const source = readLease();
      const promoted = context.intent.receipts["successor-promoted"].values;
      const authority = context.intent.receipts["successor-review-ready"].values.authority;
      const admission = targetAdmission(context.plan, promoted);
      const capability = readTaskAuthorityCapability(capabilityPath);
      if (digestValue(projectTaskAuthorityCapability(capability)) !== context.plan.evidence.taskCapabilityDigest) {
        throw new Error("Task capability changed before local scope-repair CAS.");
      }
      const projectedAt = new Date().toISOString();
      const targetCore = { ...source, sessionId: context.plan.operatorSessionId,
        expiresAt: authority.expiresAt, heartbeatAt: projectedAt,
        admission, cloudAuthority: authority };
      const binding = createTaskAuthorityBinding({ capability, lease: targetCore,
        bindingMode: "handoff", boundAt: projectedAt,
        transitionPlanDigest: context.plan.planDigest,
        priorBindingDigest: source.taskAuthority.bindingDigest });
      const target = { ...targetCore, taskAuthority: binding };
      const operation = `${context.plan.operation}:${context.plan.planDigest}:local-cas`;
      const proof = createTaskAuthorityProof({ capability, binding, lease: target, operation });
      const verified = verifyTaskAuthorityProof({ proof, binding, lease: target, operation });
      const result = mutateWriterLeaseRegistry({ leaseStore: store, branch,
        expectedLeaseDigest: context.plan.evidence.localLeaseDigest,
        expectedClaimId: context.plan.evidence.localClaimId,
        action: ({ registry, lease }) => {
          if (writerLeaseDigest(lease) !== context.plan.evidence.localLeaseDigest) {
            throw new Error("Source lease changed before scope-repair CAS.");
          }
          return { registry: { ...registry, leases: { ...registry.leases, [branch]: target } },
            lease: target, changed: true };
        } });
      return effect("local-cas", { targetLeaseDigest: writerLeaseDigest(result.lease),
        targetBindingDigest: binding.bindingDigest, proofDigest: verified.proofDigest,
        receiptDigest: digestValue({ lease: writerLeaseDigest(result.lease), proof: verified.proofDigest }) });
    },
    projectPullRequest(context) {
      const lease = readLease(), request = pull(lease);
      if (bodyRemainderDigest(request.body) !== context.plan.evidence.pullRequest.bodyRemainderDigest) {
        throw new Error("Pull-request body changed outside its writer marker.");
      }
      const expected = projectWriterLeasePullRequestMarker(lease);
      if (digestValue(parseWriterLeasePullRequestBody(request.body)) !== digestValue(expected)) {
        gh(["pr", "edit", request.url, "--body", updateWriterLeasePullRequestBody(request.body, lease)]);
      }
      const marker = parseWriterLeasePullRequestBody(pull(lease).body);
      if (digestValue(marker) !== digestValue(expected)) throw new Error("Pull-request marker did not converge.");
      return effect("pr-marker", { markerDigest: digestValue(marker), leaseDigest: writerLeaseDigest(lease),
        receiptDigest: digestValue({ marker, lease: writerLeaseDigest(lease) }) });
    },
    archiveSourceJournal(context) {
      const source = context.plan.evidence.sourceJournalPath;
      const archiveRoot = path.join(path.dirname(source), "archive");
      const target = path.join(archiveRoot, `${path.basename(source, ".json")}.${context.plan.planDigest}.json`);
      if (existsSync(target)) return archiveReceipt(context.plan, target);
      if (!existsSync(source) || digestValue(readFileSync(source, "utf8"))
        !== context.plan.evidence.sourceJournalBytesDigest) {
        throw new Error("Source recovery journal changed before archival.");
      }
      mkdirSync(archiveRoot, { recursive: true, mode: 0o700 });
      renameSync(source, target);
      return archiveReceipt(context.plan, target);
    },
    verifyTerminal(context) {
      const lease = readLease();
      if (lease.status !== "review_ready" || lease.reviewHeadSha !== context.plan.evidence.headSha
        || lease.admission.writeSetDigest !== manifest(context.plan).writeSetDigest
        || lease.cloudAuthority.claimId !== successorValues(context).claimId
        || lease.cloudAuthority.state !== "review_ready") throw new Error("Terminal lease is not expanded review-ready.");
      requireCurrentBytes(context.plan);
      verifyReviewReadyAdmissionCloudAuthority({ authority: lease.cloudAuthority,
        manifest: lease.admission, headSha: lease.reviewHeadSha, branch,
        environment, ...(verify ? { invoke: verify } : {}) });
      const request = pull(lease);
      if (digestValue(parseWriterLeasePullRequestBody(request.body))
        !== digestValue(projectWriterLeasePullRequestMarker(lease))) {
        throw new Error("Terminal pull-request marker is invalid.");
      }
      const archive = context.intent.receipts["source-journal-archived"].values.archivePath;
      if (!existsSync(archive)) throw new Error("Terminal source journal archive is missing.");
      return effect("verified", { leaseDigest: writerLeaseDigest(lease),
        cloudAuthorityDigest: digestValue(lease.cloudAuthority), markerDigest: digestValue(parseWriterLeasePullRequestBody(request.body)),
        archiveDigest: digestValue(readFileSync(archive, "utf8")),
        receiptDigest: digestValue({ plan: context.plan.planDigest, lease: writerLeaseDigest(lease), archive }) });
    },
    reconcile(context) { return reconcilePhase(context); },
  };
  return Object.freeze(adapter);

  function reconcilePhase(context) {
    try {
      if (context.phase === "source-recovered") {
        const { inventory, claim } = claimById(context.plan.sourceClaimId);
        if (!claim || !["current", "active"].includes(claim.state)) return null;
        return resultValues("source-recovered", resultFromInventory(inventory, claim));
      }
      if (context.phase === "successor-claimed") {
        const inventory = status(), matches = inventory.claims.filter(item =>
          item.predecessorClaimId === context.plan.sourceClaimId
          && item.writeSetDigest === manifest(context.plan).writeSetDigest);
        if (matches.length !== 1) return null;
        return resultValues("successor-claimed", resultFromInventory(inventory, matches[0]));
      }
      if (context.phase === "source-retired") {
        const successor = successorValues(context), source = claimById(context.plan.sourceClaimId).claim;
        if (source || !claimById(successor.claimId).claim) return null;
        return effect("source-retired", { claimId: context.plan.sourceClaimId,
          receiptDigest: digestValue({ plan: context.plan.planDigest, phase: context.phase }) });
      }
      if (["successor-promoted", "successor-bound", "successor-review-ready"].includes(context.phase)) {
        const successor = successorValues(context), { inventory, claim } = claimById(successor.claimId);
        if (!claim) return null;
        if (context.phase === "successor-promoted" && ["current", "active", "review_ready"].includes(claim.state)) {
          return resultValues("successor-promoted", resultFromInventory(inventory, claim));
        }
        if (context.phase === "successor-bound" && ["active", "review_ready"].includes(claim.state)
          && claim.reviewRequestId === context.plan.evidence.sourceClaim.reviewRequestId) {
          return adapter.bindSuccessor(context);
        }
        if (context.phase === "successor-review-ready" && claim.state === "review_ready") {
          return adapter.markSuccessorReviewReady(context);
        }
      }
      if (context.phase === "local-cas") {
        const lease = readLease();
        if (lease.cloudAuthority?.claimId !== successorValues(context).claimId) return null;
        return effect("local-cas", { targetLeaseDigest: writerLeaseDigest(lease),
          targetBindingDigest: lease.taskAuthority.bindingDigest, proofDigest: digestValue(lease.taskAuthority),
          receiptDigest: digestValue({ lease: writerLeaseDigest(lease) }) });
      }
      if (context.phase === "pr-marker") {
        const lease = readLease(), marker = parseWriterLeasePullRequestBody(pull(lease).body);
        if (digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))) return null;
        return effect("pr-marker", { markerDigest: digestValue(marker), leaseDigest: writerLeaseDigest(lease),
          receiptDigest: digestValue({ marker, lease: writerLeaseDigest(lease) }) });
      }
      if (context.phase === "source-journal-archived") {
        const source = context.plan.evidence.sourceJournalPath;
        const target = path.join(path.dirname(source), "archive",
          `${path.basename(source, ".json")}.${context.plan.planDigest}.json`);
        return existsSync(target) ? archiveReceipt(context.plan, target) : null;
      }
      if (context.phase === "verified") return adapter.verifyTerminal(context);
    } catch { return null; }
    return null;
  }
  function requireCurrentBytes(plan) {
    if (sha(git(["rev-parse", "HEAD"]), "HEAD") !== plan.evidence.headSha
      || remoteHead() !== plan.evidence.headSha || git(["status", "--porcelain"])) {
      throw new Error("Scope repair source bytes drifted from the exact plan.");
    }
  }
}

function effect(kind, values) { const core = { schema: "agentic-reviewed-handoff-scope-repair-effect/v1", kind, ...values };
  return Object.freeze({ ...core, receiptDigest: values.receiptDigest || digestValue(core) }); }
function resultFromInventory(inventory, claim) { return { schema: "agentic-cloud-collaboration-result/v1",
  ok: true, action: "continue", ledgerRevision: inventory.ledgerRevision,
  ledgerDigest: inventory.ledgerDigest, claim, claimDigest: claim.fenceRevision,
  receipt: { ledgerDigest: inventory.ledgerDigest } }; }
function archiveReceipt(plan, target) { const bytes = readFileSync(target, "utf8");
  if (digestValue(bytes) !== plan.evidence.sourceJournalBytesDigest) throw new Error("Archived source journal bytes drifted.");
  return effect("source-journal-archived", { archivePath: target, archiveDigest: digestValue(bytes),
    receiptDigest: digestValue({ plan: plan.planDigest, archivePath: target, archiveDigest: digestValue(bytes) }) }); }
function bodyRemainderDigest(body) { return digestValue(String(body).replace(
  /<!-- agentic-writer-lease\/v2 [\s\S]*? -->/gu, "<!-- agentic-writer-lease/v2 [marker] -->")); }
function externalPath(repository, value, label) { const target = realpathSync(path.resolve(requiredText(value, label)));
  const relative = path.relative(repository, target);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== "..")) throw new Error(`${label} must be external.`);
  return target; }
function requiredText(value, label) { const result = String(value ?? "").trim(); if (!result) throw new Error(`${label} is required.`); return result; }
function sha(value, label) { const result = requiredText(value, label); if (!/^[0-9a-f]{40}$/u.test(result)) throw new Error(`${label} is invalid.`); return result; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid.`); return value; }
