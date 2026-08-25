// Responsibility: Bind reviewed terminal-handoff recovery to Git, GitHub, cloud, proof, and lease CAS.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

import { validateLedger } from "./cloud-collaboration-contract.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { readOwnershipPullRequest } from "./device-pull-request-state.mjs";
import { DEFAULT_LEDGER_PATH, DEFAULT_LEDGER_REF }
  from "./github-cloud-collaboration-adapter.mjs";
import {
  captureOrphanedTaskAuthorityGitEvidence,
  requireSameOrphanedTaskAuthorityGitEvidence,
  writerLeaseBodyRemainder,
} from "./orphaned-task-authority-recovery-evidence.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import {
  bindAdmissionCloudAuthority,
  invokeRepositoryCloudAction,
  reviewReadyAdmissionCloudAuthority,
  verifyAdmissionCloudAuthority,
} from "./scoped-lane-cloud-authority.mjs";
import { normalizeBoundAuthority } from "./scoped-lane-cloud-reconciliation.mjs";
import {
  createTaskAuthorityBinding, createTaskAuthorityProof,
  projectTaskAuthorityCapability, verifyTaskAuthorityProof,
} from "./task-bound-lane-authority-contract.mjs";
import { readTaskAuthorityCapability } from "./task-bound-lane-authority-store.mjs";
import {
  createWriterLeaseStore, parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import { mutateWriterLeaseRegistry, writerLeaseDigest }
  from "./writer-lease-registry-cas.mjs";
import { createRecoveryJournalStore }
  from "./reviewed-terminal-handoff-successor-recovery-contract.mjs";
import {
  EVIDENCE_SCHEMA, assertNoLiveReviewedTerminalOverlap,
  sealReviewedTerminalHandoffEvidence, selectReviewedTerminalHandoffProof,
} from "./reviewed-terminal-handoff-successor-recovery-evidence.mjs";

export function createReviewedTerminalHandoffSuccessorRecoveryRepositoryAdapter(
  options = {}, dependencies = {},
) {
  const repository = realpathSync(path.resolve(text(options.repository, "repository")));
  const capabilityPath = externalPath(repository, options.taskAuthorityFile, "task capability");
  const execute = (command, args, settings = {}) => execFileSync(command, args, {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
    ...settings,
  });
  const git = dependencies.gitText || (args => execute("git", args).trim());
  const gh = dependencies.ghText || (args => execute("gh", args).trim());
  const ghJson = dependencies.ghJson || (args => JSON.parse(execute("gh", args)));
  const invoke = dependencies.invoke || invokeRepositoryCloudAction;
  const verify = dependencies.verify;
  const environment = options.environment || process.env;
  const branch = text(git(["branch", "--show-current"]), "branch");
  if (options.branch && options.branch !== branch) throw new Error("Requested branch differs from checkout.");
  const common = path.resolve(repository, git(["rev-parse", "--git-common-dir"]));
  const store = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir: common });
  const journal = createRecoveryJournalStore({ commonDirectory: common, branch });

  function readLease() {
    const lease = store.read(branch);
    if (!lease || lease.branch !== branch) throw new Error("Recovery writer lease is missing.");
    return lease;
  }

  function status(lease = readLease()) {
    const result = invoke({
      action: "status",
      ledgerRepository: lease.cloudAuthority.ledgerRepository,
      request: { targetRepository: lease.cloudAuthority.targetRepository },
      environment,
    });
    if (result?.ok !== true || result.action !== "status" || !Array.isArray(result.claims)) {
      throw new Error("Cloud status did not return a complete claim inventory.");
    }
    return result;
  }

  function rawLedger(lease) {
    const ledgerRepository = text(lease.cloudAuthority.ledgerRepository, "ledger repository");
    const reference = ghJson([
      "api", `repos/${ledgerRepository}/git/ref/heads/${encodeURIComponent(DEFAULT_LEDGER_REF)}`,
    ]);
    const revision = sha(reference?.object?.sha, "ledger ref revision");
    const metadata = ghJson([
      "api", `repos/${ledgerRepository}/contents/${DEFAULT_LEDGER_PATH}?ref=${revision}`,
    ]);
    const blob = ghJson([
      "api", `repos/${ledgerRepository}/git/blobs/${sha(metadata?.sha, "ledger blob SHA")}`,
    ]);
    if (blob?.encoding !== "base64" || !blob.content) throw new Error("Raw ledger blob is incomplete.");
    const ledger = JSON.parse(Buffer.from(
      String(blob.content).replaceAll("\n", ""), "base64",
    ).toString("utf8"));
    const failures = validateLedger(ledger);
    if (failures.length) throw new Error(`Raw collaboration ledger is invalid: ${failures.join("; ")}`);
    return ledger;
  }

  function readPull(lease) {
    return readOwnershipPullRequest({
      url: text(lease.pullRequestUrl, "pull-request URL"),
      branch,
      ghText: gh,
    });
  }

  function remoteHead() {
    const output = git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
    const lines = output.split("\n").filter(Boolean);
    if (lines.length !== 1) throw new Error("Recovery branch has no unique remote ref.");
    return sha(lines[0].split(/\s+/u)[0], "remote branch head");
  }

  function captureEvidence() {
    const record = assertRegisteredWorktree({
      cwd: repository,
      porcelain: git(["worktree", "list", "--porcelain", "-z"]),
    });
    if (realpathSync(record.path) !== repository || record.branch !== `refs/heads/${branch}`) {
      throw new Error("Recovery branch does not own the registered worktree.");
    }
    const lease = readLease();
    if (lease.schema !== "agentic-writer-lease/v2"
      || lease.status !== "review_ready"
      || lease.admission?.status !== "admitted"
      || lease.cloudAuthority?.state !== "review_ready"
      || lease.worktreePath !== repository) {
      throw new Error("Recovery requires one admitted locally review-ready source lease.");
    }
    const headSha = sha(git(["rev-parse", "HEAD"]), "source HEAD");
    const treeSha = sha(git(["show", "-s", "--format=%T", headSha]), "source tree");
    if (headSha !== lease.reviewHeadSha || remoteHead() !== headSha) {
      throw new Error("Source HEAD, remote branch, and reviewed head do not join exactly.");
    }
    const clean = captureOrphanedTaskAuthorityGitEvidence({
      repository,
      gitText: git,
      headSha,
      treeSha,
      declaredWriteSet: lease.admission.declaredWriteSet,
    });
    if (clean.kind !== "clean") throw new Error("Reviewed terminal-handoff recovery requires clean Git state.");
    const pull = readPull(lease);
    const marker = parseWriterLeasePullRequestBody(pull.body);
    if (!marker
      || digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))
      || pull.headRefOid !== headSha
      || pull.state !== "OPEN"
      || pull.isDraft) {
      throw new Error("Source PR, marker, ready state, and HEAD do not join exactly.");
    }
    const lineage = selectReviewedTerminalHandoffProof({
      entries: rawLedger(lease).entries,
      lease,
    });
    const cloud = status(lease);
    const liveInventory = assertNoLiveReviewedTerminalOverlap({
      claims: cloud.claims,
      ...lineage,
    });
    const capability = projectTaskAuthorityCapability(
      readTaskAuthorityCapability(capabilityPath),
    );
    if (capability.authoritySubjectId !== lease.taskAuthority?.authoritySubjectId
      || capability.generation !== lease.taskAuthority?.generation
      || capability.publicKeyDigest !== lease.taskAuthority?.publicKeyDigest
      || capability.proofAdapterId !== lease.taskAuthority?.proofAdapterId) {
      throw new Error("Recovery task capability does not match the current bound subject.");
    }
    const core = {
      schema: EVIDENCE_SCHEMA,
      branch,
      headSha,
      treeSha,
      lease,
      leaseDigest: writerLeaseDigest(lease),
      reviewedSource: lineage.reviewedSource,
      handoffSource: lineage.handoffSource,
      clean,
      cleanEvidenceDigest: clean.evidenceDigest,
      pullRequest: {
        id: text(pull.id, "pull-request ID"),
        url: pull.url,
        number: positive(Number(pull.url.split("/").at(-1)), "pull-request number"),
        headSha: pull.headRefOid,
        baseSha: pull.baseRefOid,
        bodyDigest: digestValue(pull.body || ""),
        bodyRemainderDigest: digestValue(writerLeaseBodyRemainder(pull.body)),
        isDraft: pull.isDraft,
        state: pull.state,
      },
      pullRequestMarkerDigest: digestValue(marker),
      liveInventory,
      targetCapability: capability,
      targetCapabilityDigest: digestValue(capability),
    };
    return sealReviewedTerminalHandoffEvidence({
      ...core,
      evidenceDigest: digestValue(core),
    });
  }

  function successorClaim(plan, claimed) {
    const inventory = status(plan.evidence.lease);
    const matches = inventory.claims.filter(item => item.claimId === claimed.claimId);
    if (matches.length !== 1) throw new Error("Recovery successor is no longer unique.");
    return { inventory, claim: matches[0] };
  }

  function normalizedSuccessorAuthority(plan, claimed) {
    const lease = plan.evidence.lease;
    const { inventory, claim } = successorClaim(plan, claimed);
    return normalizeBoundAuthority({
      result: {
        schema: "agentic-cloud-collaboration-result/v1",
        ok: true,
        action: "claim",
        ledgerRevision: inventory.ledgerRevision,
        ledgerDigest: inventory.ledgerDigest,
        claimDigest: claim.fenceRevision,
        claim,
      },
      authority: {
        ...lease.cloudAuthority,
        deviceId: lease.device,
        sessionId: plan.operatorSessionId,
        leaseEpoch: plan.targetLeaseEpoch,
        reviewRequestId: claim.reviewRequestId,
        state: claim.state,
      },
      manifest: lease.admission,
      deviceId: lease.device,
      sessionId: plan.operatorSessionId,
      ...(claim.evidenceDigest ? { focusedEvidenceDigest: claim.evidenceDigest } : {}),
    });
  }

  function currentTarget(plan, claimed, authority) {
    const source = readLease();
    const target = {
      ...source,
      sessionId: plan.operatorSessionId,
      expiresAt: authority.expiresAt,
      cloudAuthority: authority,
    };
    const capability = readTaskAuthorityCapability(capabilityPath);
    if (digestValue(projectTaskAuthorityCapability(capability)) !== plan.targetCapabilityDigest) {
      throw new Error("Recovery task capability changed from the authorized plan.");
    }
    const binding = createTaskAuthorityBinding({
      capability,
      lease: target,
      bindingMode: "handoff",
      boundAt: claimed.evaluationTime,
      transitionPlanDigest: plan.planDigest,
      priorBindingDigest: plan.evidence.lease.taskAuthority.bindingDigest,
    });
    const operation = `${plan.operation}:${plan.planDigest}:local-cas`;
    const proof = createTaskAuthorityProof({ capability, binding, lease: target, operation });
    const verified = verifyTaskAuthorityProof({ proof, binding, lease: target, operation });
    return {
      lease: { ...target, taskAuthority: binding },
      binding,
      proofDigest: verified.proofDigest,
    };
  }

  const adapter = {
    captureEvidence,
    readIntent: journal.read,
    writeIntent: journal.write,
    withFence: journal.withFence,
    claimSuccessor({ plan }) {
      requireCurrent(plan);
      const source = plan.evidence.handoffSource;
      const lease = plan.evidence.lease;
      const result = invoke({
        action: "claim",
        ledgerRepository: lease.cloudAuthority.ledgerRepository,
        request: {
          targetRepository: lease.cloudAuthority.targetRepository,
          workItemId: source.workItemId,
          canonicalBaseSha: source.canonicalBaseRevision,
          headSha: source.laneRevision,
          declaredWriteSet: source.declaredWriteScope,
          predecessorClaimId: source.claimId,
          leaseEpoch: plan.targetLeaseEpoch,
          ttlSeconds: plan.ttlSeconds,
          deviceId: lease.device,
          sessionId: plan.operatorSessionId,
          idempotencyKey: `${plan.operation}:claim:${plan.planDigest}`,
        },
        environment,
      });
      const claim = result?.claim;
      if (result?.ok !== true
        || result.action !== "claim"
        || claim?.state !== "current"
        || claim.predecessorClaimId !== source.claimId
        || claim.leaseEpoch !== plan.targetLeaseEpoch
        || claim.laneRevision !== plan.evidence.headSha
        || claim.writeSetDigest !== source.writeSetDigest) {
        throw new Error("Cloud did not create the exact current successor.");
      }
      return receipt("claim", {
        claimId: claim.claimId,
        claimDigest: result.claimDigest || claim.fenceRevision,
        transitionCounter: claim.transitionCounter,
        ledgerRevision: result.ledgerRevision,
        claimLedgerRevision: claim.transitionDigest,
        expiresAt: claim.expiresAt,
        evaluationTime: result.operationReceipt?.evaluationTime,
        operationReceiptDigest: result.operationReceipt?.receiptDigest,
        providerReceiptDigest: result.receipt?.receiptDigest,
        receiptDigest: result.receipt?.receiptDigest,
      });
    },
    bindSuccessor({ plan, intent }) {
      const claimed = intent.receipts["successor-claimed"].values;
      const lease = plan.evidence.lease;
      const { claim } = successorClaim(plan, claimed);
      const seed = normalizedSuccessorAuthority(plan, claimed);
      if (claim.reviewRequestId === plan.evidence.lease.cloudAuthority.reviewRequestId
        && new Set(["active", "review_ready"]).has(claim.state)) {
        const verification = verifyAdmissionCloudAuthority({
          authority: seed,
          manifest: lease.admission,
          canonicalBaseSha: seed.canonicalBaseSha,
          environment,
          inspect: invoke,
          ...(verify ? { invoke: verify } : {}),
        });
        return receipt("bind", {
          authority: verification.authority,
          verificationDigest: verification.receiptDigest,
          receiptDigest: verification.receiptDigest,
        });
      }
      if (claim.fenceRevision !== claimed.claimDigest || claim.state !== "current") {
        throw new Error("Recovery successor changed before review-request binding.");
      }
      const bound = bindAdmissionCloudAuthority({
        authority: seed,
        manifest: lease.admission,
        branch,
        headSha: plan.evidence.headSha,
        reviewRequestId: lease.cloudAuthority.reviewRequestId,
        deviceId: lease.device,
        sessionId: plan.operatorSessionId,
        idempotencyKey: `${plan.operation}:bind:${plan.planDigest}`,
        returnVerification: true,
        environment,
        invoke,
        inspect: invoke,
        ...(verify ? { verify } : {}),
      });
      return receipt("bind", {
        authority: bound.authority,
        verificationDigest: bound.verification.receiptDigest,
        receiptDigest: bound.verification.receiptDigest,
      });
    },
    markSuccessorReviewReady({ plan, intent }) {
      const lease = plan.evidence.lease;
      const bound = intent.receipts["successor-bound"].values.authority;
      const ready = reviewReadyAdmissionCloudAuthority({
        authority: bound,
        manifest: lease.admission,
        branch,
        headSha: plan.evidence.headSha,
        pullRequestNumber: plan.evidence.pullRequest.number,
        reviewRequestId: lease.cloudAuthority.reviewRequestId,
        focusedEvidenceDigest: lease.cloudAuthority.focusedEvidenceDigest,
        deviceId: lease.device,
        sessionId: plan.operatorSessionId,
        environment,
        invoke,
        inspect: invoke,
        ...(verify ? { verify } : {}),
      });
      if (ready.authority.state !== "review_ready") {
        throw new Error("Recovery successor did not reach review-ready authority.");
      }
      return receipt("review-ready", {
        authority: ready.authority,
        verificationDigest: ready.receiptDigest,
        receiptDigest: ready.receiptDigest,
      });
    },
    projectLocal({ plan, intent }) {
      requireSameCleanEvidence(plan);
      const claimed = intent.receipts["successor-claimed"].values;
      const authority = intent.receipts["successor-review-ready"].values.authority;
      const target = currentTarget(plan, claimed, authority);
      const result = mutateWriterLeaseRegistry({
        leaseStore: store,
        branch,
        expectedLeaseDigest: plan.sourceLeaseDigest,
        expectedClaimId: plan.sourceClaimId,
        action: ({ registry, lease }) => {
          if (writerLeaseDigest(lease) !== plan.sourceLeaseDigest) {
            throw new Error("Source lease changed before CAS.");
          }
          return {
            registry: { ...registry, leases: { ...registry.leases, [branch]: target.lease } },
            lease: target.lease,
            changed: true,
          };
        },
      });
      return receipt("local-cas", {
        targetLeaseDigest: writerLeaseDigest(result.lease),
        targetBindingDigest: target.binding.bindingDigest,
        proofDigest: target.proofDigest,
        cloudAuthorityDigest: digestValue(target.lease.cloudAuthority),
      });
    },
    projectPullRequest({ plan }) {
      const lease = readLease();
      const pull = readPull(lease);
      if (digestValue(writerLeaseBodyRemainder(pull.body))
        !== plan.evidence.pullRequest.bodyRemainderDigest) {
        throw new Error("Pull-request non-marker body changed before projection.");
      }
      const expected = projectWriterLeasePullRequestMarker(lease);
      let marker = parseWriterLeasePullRequestBody(pull.body);
      if (digestValue(marker) !== digestValue(expected)) {
        gh(["pr", "edit", pull.url, "--body", updateWriterLeasePullRequestBody(pull.body, lease)]);
        marker = parseWriterLeasePullRequestBody(readPull(lease).body);
      }
      if (digestValue(marker) !== digestValue(expected)) throw new Error("PR marker did not converge.");
      return receipt("pr-marker", {
        markerDigest: digestValue(marker),
        leaseDigest: writerLeaseDigest(lease),
      });
    },
    verifyTerminal({ plan, intent }) {
      const lease = readLease();
      const local = intent.receipts["local-cas"].values;
      if (writerLeaseDigest(lease) !== local.targetLeaseDigest
        || lease.status !== "review_ready"
        || lease.reviewHeadSha !== plan.evidence.headSha
        || lease.cloudAuthority.state !== "review_ready"
        || lease.cloudAuthority.claimId
          !== intent.receipts["successor-claimed"].values.claimId) {
        throw new Error("Terminal lease does not carry the review-ready successor.");
      }
      requireSameCleanEvidence(plan);
      verifyAdmissionCloudAuthority({
        authority: lease.cloudAuthority,
        manifest: lease.admission,
        canonicalBaseSha: lease.cloudAuthority.canonicalBaseSha,
        environment,
        inspect: invoke,
        ...(verify ? { invoke: verify } : {}),
      });
      const pull = readPull(lease);
      const marker = parseWriterLeasePullRequestBody(pull.body);
      if (digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))
        || pull.headRefOid !== plan.evidence.headSha
        || pull.state !== "OPEN"
        || pull.isDraft) {
        throw new Error("Terminal PR projection is invalid.");
      }
      const core = {
        schema: "agentic-reviewed-terminal-handoff-recovery-verification/v1",
        status: "review-ready",
        planDigest: plan.planDigest,
        successorClaimId: lease.cloudAuthority.claimId,
        leaseDigest: writerLeaseDigest(lease),
        taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
        cleanEvidenceDigest: plan.evidence.cleanEvidenceDigest,
        sourceBytesChanged: false,
        integrationAuthorityRestored: false,
      };
      return receipt("terminal", {
        leaseDigest: writerLeaseDigest(lease),
        cloudAuthorityDigest: digestValue(lease.cloudAuthority),
        markerDigest: digestValue(marker),
        cleanEvidenceDigest: plan.evidence.cleanEvidenceDigest,
        reviewAuthorityReceiptDigest: digestValue(core),
      });
    },
    reconcile({ plan, intent, phase: name }) {
      try {
        if (name === "successor-claimed") {
          const inventory = status(plan.evidence.lease);
          const matches = inventory.claims.filter(item => (
            item.predecessorClaimId === plan.handoffClaimId
          ));
          if (matches.length !== 1
            || !new Set(["current", "active", "review_ready"]).has(matches[0].state)) return null;
          const claim = matches[0];
          return receipt("claim", {
            claimId: claim.claimId,
            claimDigest: claim.fenceRevision,
            transitionCounter: claim.transitionCounter,
            ledgerRevision: inventory.ledgerRevision,
            claimLedgerRevision: claim.transitionDigest,
            expiresAt: claim.expiresAt,
            evaluationTime: claim.eligibleSince || plan.evidence.handoffSource.retiredAt,
            operationReceiptDigest: claim.operationReceiptDigest,
            providerReceiptDigest: claim.operationReceiptDigest,
            receiptDigest: claim.operationReceiptDigest,
          });
        }
        if (name === "successor-bound") {
          const claimed = intent.receipts["successor-claimed"]?.values;
          if (!claimed) return null;
          const { claim } = successorClaim(plan, claimed);
          if (!new Set(["active", "review_ready"]).has(claim.state)
            || claim.reviewRequestId !== plan.evidence.lease.cloudAuthority.reviewRequestId) return null;
          return adapter.bindSuccessor({ plan, intent });
        }
        if (name === "successor-review-ready") {
          const claimed = intent.receipts["successor-claimed"]?.values;
          if (!claimed || successorClaim(plan, claimed).claim.state !== "review_ready") return null;
          return adapter.markSuccessorReviewReady({ plan, intent });
        }
        if (name === "local-cas") {
          const lease = readLease();
          if (lease.cloudAuthority?.claimId
            !== intent.receipts["successor-claimed"]?.values.claimId) return null;
          return receipt("local-cas", {
            targetLeaseDigest: writerLeaseDigest(lease),
            targetBindingDigest: lease.taskAuthority.bindingDigest,
            proofDigest: digestValue(lease.taskAuthority),
            cloudAuthorityDigest: digestValue(lease.cloudAuthority),
          });
        }
        if (name === "pr-marker") {
          const lease = readLease();
          const marker = parseWriterLeasePullRequestBody(readPull(lease).body);
          if (digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))) return null;
          return receipt("pr-marker", {
            markerDigest: digestValue(marker),
            leaseDigest: writerLeaseDigest(lease),
          });
        }
        if (name === "verified") return adapter.verifyTerminal({ plan, intent });
      } catch {
        return null;
      }
      return null;
    },
  };
  return Object.freeze(adapter);

  function requireCurrent(plan) {
    if (captureEvidence().evidenceDigest !== plan.evidenceDigest) {
      throw new Error("Recovery source drifted from its plan.");
    }
  }

  function requireSameCleanEvidence(plan) {
    const observed = captureOrphanedTaskAuthorityGitEvidence({
      repository,
      gitText: git,
      headSha: sha(git(["rev-parse", "HEAD"]), "source HEAD"),
      treeSha: sha(git(["show", "-s", "--format=%T", "HEAD"]), "source tree"),
      declaredWriteSet: plan.evidence.lease.admission.declaredWriteSet,
    });
    requireSameOrphanedTaskAuthorityGitEvidence(plan.evidence.clean, observed);
    if (remoteHead() !== plan.evidence.headSha) throw new Error("Remote source head changed from the plan.");
  }
}

function receipt(kind, values) {
  const core = {
    schema: "agentic-reviewed-terminal-handoff-recovery-effect/v1",
    kind,
    ...values,
  };
  return Object.freeze({ ...core, receiptDigest: values.receiptDigest || digestValue(core) });
}
function externalPath(repository, value, label) {
  const target = realpathSync(path.resolve(text(value, label)));
  const relative = path.relative(repository, target);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== "..")) {
    throw new Error(`${label} must be outside the source repository.`);
  }
  return target;
}
function text(value, label) { const result = String(value ?? "").trim();
  if (!result) throw new Error(`${label} is required.`); return result; }
function sha(value, label) { const result = text(value, label);
  if (!/^[0-9a-f]{40}$/u.test(result)) throw new Error(`${label} is invalid.`); return result; }
function positive(value, label) { if (!Number.isSafeInteger(value) || value < 1)
  throw new Error(`${label} is invalid.`); return value; }
