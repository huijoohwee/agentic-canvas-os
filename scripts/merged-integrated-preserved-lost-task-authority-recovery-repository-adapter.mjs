// Responsibility: read merged delivery evidence and CAS only its lost task-authority binding.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { validateLedger } from "./cloud-collaboration-contract.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { createDeviceDeliveryEvidence } from "./device-delivery-evidence.mjs";
import { inspectIntegratedDeliveryTerminal } from "./integrated-delivery-terminal-retirement.mjs";
import {
  buildMergedIntegratedPreservedLostAuthorityEvidence,
  OPERATION,
} from "./merged-integrated-preserved-lost-task-authority-recovery-contract.mjs";
import { assertOnlyTaskAuthorityChanged } from "./orphaned-task-authority-recovery-evidence.mjs";
import { verifyProtectedMainRefreshChain } from "./protected-main-refresh-lib.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import {
  assertTaskAuthorityBinding,
  createTaskAuthorityBinding,
  createTaskAuthorityProof,
  projectTaskAuthorityCapability,
  verifyTaskAuthorityProof,
} from "./task-bound-lane-authority-contract.mjs";
import { readTaskAuthorityCapability } from "./task-bound-lane-authority-store.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";
import { mutateWriterLeaseRegistry, writerLeaseDigest } from "./writer-lease-registry-cas.mjs";

const LEDGER_REF = "agentic/collaboration-ledger";
const LEDGER_PATH = ".agentic/collaboration-ledger.json";

export function createMergedIntegratedPreservedLostAuthorityRecoveryRepositoryAdapter(
  options = {},
  dependencies = {},
) {
  const repository = realpathSync(path.resolve(requiredText(options.repository, "repository")));
  const capabilityPath = requireExternalPath(repository, options.targetCapabilityPath, "target capability");
  const execute = (command, args, settings = {}) => execFileSync(command, args, {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
    ...settings,
  });
  const gitText = dependencies.gitText || (args => execute("git", args).trim());
  const ghText = dependencies.ghText || (args => execute("gh", args).trim());
  const branch = requiredText(gitText(["branch", "--show-current"]), "target branch");
  if (options.branch && options.branch !== branch) {
    throw new Error("Requested branch does not match the target worktree.");
  }
  const commonDirectory = path.resolve(repository, gitText(["rev-parse", "--git-common-dir"]));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({ gitCommonDir: commonDirectory });

  function readLease() {
    const lease = leaseStore.read(branch);
    if (!lease || lease.branch !== branch) throw new Error("Target writer lease is missing.");
    return lease;
  }

  function readCapability() {
    return readTaskAuthorityCapability(capabilityPath);
  }

  function captureSource() {
    return captureEvidence({ allowReplacementBinding: false });
  }

  function captureEvidence({
    allowReplacementBinding,
    sourceBinding = null,
    sourceLeaseDigest = null,
  } = {}) {
    const lease = readLease();
    const record = assertRegisteredWorktree({
      cwd: repository,
      porcelain: gitText(["worktree", "list", "--porcelain", "-z"]),
    });
    if (record.branch !== `refs/heads/${branch}` || realpathSync(record.path) !== repository) {
      throw new Error("Target worktree registration drifted.");
    }
    if (lease.status !== "review_ready" || path.resolve(lease.worktreePath) !== repository) {
      throw new Error("Recovery requires one exact review-ready target lease.");
    }
    const currentBinding = assertTaskAuthorityBinding({ binding: lease.taskAuthority, lease });
    if (sourceBinding) {
      if (!allowReplacementBinding || currentBinding.bindingDigest === sourceBinding.bindingDigest) {
        throw new Error("Recovery terminal did not retain its exact replacement binding.");
      }
      assertOnlyTaskAuthorityChanged({
        sourceLeaseDigest,
        sourceBinding,
        targetLease: lease,
      });
    }
    const status = gitText(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    if (status) throw new Error("Recovery requires a clean registered target worktree.");
    const headSha = requiredSha(gitText(["rev-parse", "HEAD"]), "target HEAD");
    const treeSha = requiredSha(gitText(["show", "-s", "--format=%T", headSha]), "target tree");
    const authority = lease.cloudAuthority;
    const reviewHeadSha = requiredSha(lease.reviewHeadSha, "review head SHA");
    if (authority?.state !== "review_ready" || authority.laneRevision !== reviewHeadSha) {
      throw new Error("Target review authority no longer joins its review head.");
    }
    const pull = readMergedPullRequest(lease.pullRequestUrl);
    if (pull.state !== "MERGED" || pull.headRefName !== branch || pull.baseRefName !== "main"
      || pull.isCrossRepository !== false) {
      throw new Error("Recovery requires the exact merged same-repository review subject.");
    }
    const protectedMainRefresh = pull.headRefOid === reviewHeadSha ? null
      : verifyProtectedMainRefreshChain({
        expectedHeadSha: reviewHeadSha,
        observedHeadSha: pull.headRefOid,
        gitText,
        mainRef: "origin/main",
      });
    const deliveryEvidence = createDeviceDeliveryEvidence({
      operation: "integrate",
      manifest: lease.admission,
      authority,
      branch,
      headSha: reviewHeadSha,
      headTreeSha: requiredSha(gitText(["rev-parse", `${reviewHeadSha}^{tree}`]), "review head tree"),
      pullRequestNumber: pull.number,
      deviceId: lease.device,
      sessionId: lease.sessionId,
    });
    const ledgerSnapshot = readLedgerSnapshot(authority.ledgerRepository);
    const terminal = inspectIntegratedDeliveryTerminal({
      authority,
      branch,
      canonicalBaseSha: lease.baseSha,
      deliveryEvidence,
      headSha: reviewHeadSha,
      ledger: ledgerSnapshot.ledger,
      ledgerRevision: ledgerSnapshot.ledgerRevision,
      protectedMainRefresh,
      pullRequest: pull,
      gitText,
    });
    if (terminal.state !== "pending") {
      throw new Error("Merged delivery is no longer pending its exact terminal retirement.");
    }
    return buildMergedIntegratedPreservedLostAuthorityEvidence({
      schema: `agentic-${OPERATION}-evidence/v1`,
      target: {
        repository: authority.targetRepository,
        branch,
        worktreePath: repository,
        headSha,
        treeSha,
        clean: true,
        status: lease.status,
      },
      sourceLeaseDigest: sourceLeaseDigest || writerLeaseDigest(lease),
      claimId: authority.claimId,
      reviewHeadSha,
      sourceBinding: sourceBinding || currentBinding,
      mergedPullRequest: {
        state: pull.state,
        number: pull.number,
        id: pull.id,
        url: pull.url,
        branch,
        headSha: pull.headRefOid,
        mergeCommitSha: pull.mergeCommit.oid,
        mergedAt: pull.mergedAt,
      },
      protectedMainRefresh,
      deliveryEvidence,
      integratedTerminal: {
        state: terminal.state,
        integrationEntryDigest: terminal.integration.digest,
        integrationReceiptDigest: terminal.integrationReceiptDigest,
        ledgerDigest: terminal.ledgerDigest,
        ledgerRevision: terminal.ledgerRevision,
        runDigest: terminal.run.runDigest,
        currentClaimDigest: terminal.request.expectedFenceRevision,
        transitionCounter: terminal.request.expectedTransitionCounter,
        subjectDigest: digestValue(terminal.subject),
      },
    });
  }

  function readTargetCapabilityProjection() {
    return projectTaskAuthorityCapability(readCapability());
  }

  function createTargetBinding(plan) {
    const capability = readCapability();
    if (digestValue(projectTaskAuthorityCapability(capability))
      !== digestValue(plan.targetCapability)) {
      throw new Error("Replacement capability drifted from the authorized plan.");
    }
    const lease = readLease();
    const binding = createTaskAuthorityBinding({
      capability,
      lease,
      bindingMode: "handoff",
      boundAt: plan.plannedAt,
      transitionPlanDigest: plan.planDigest,
      priorBindingDigest: plan.evidence.sourceBinding.bindingDigest,
    });
    const current = lease.taskAuthority?.bindingDigest;
    if (current !== plan.evidence.sourceBinding.bindingDigest && current !== binding.bindingDigest) {
      throw new Error("Target lease has neither the source nor exact replacement binding.");
    }
    const targetLease = { ...lease, taskAuthority: binding };
    assertTaskAuthorityBinding({ binding, lease: targetLease });
    const operation = `${OPERATION}:${plan.planDigest}:local-cas`;
    const proof = createTaskAuthorityProof({ capability, binding, lease: targetLease, operation });
    const verified = verifyTaskAuthorityProof({ proof, binding, lease: targetLease, operation });
    const core = {
      schema: `agentic-${OPERATION}-target-proof/v1`,
      planDigest: plan.planDigest,
      bindingDigest: binding.bindingDigest,
      proofDigest: verified.proofDigest,
      operation,
    };
    return Object.freeze({
      binding,
      proofReceipt: Object.freeze({ ...core, receiptDigest: digestValue(core) }),
    });
  }

  function localReceipt(plan, target, lease) {
    assertTaskAuthorityBinding({ binding: target.binding, lease });
    assertOnlyTaskAuthorityChanged({
      sourceLeaseDigest: plan.evidence.sourceLeaseDigest,
      sourceBinding: plan.evidence.sourceBinding,
      targetLease: lease,
    });
    const core = {
      schema: `agentic-${OPERATION}-local-cas-receipt/v1`,
      planDigest: plan.planDigest,
      sourceLeaseDigest: plan.evidence.sourceLeaseDigest,
      targetLeaseDigest: writerLeaseDigest(lease),
      targetBindingDigest: target.binding.bindingDigest,
      targetProofReceiptDigest: target.proofReceipt.receiptDigest,
    };
    return Object.freeze({ ...core, receiptDigest: digestValue(core) });
  }

  function replaceLocalBinding(plan, target) {
    const result = mutateWriterLeaseRegistry({
      leaseStore,
      branch,
      expectedLeaseDigest: plan.evidence.sourceLeaseDigest,
      expectedClaimId: plan.evidence.claimId,
      action: ({ registry, lease }) => {
        if (lease.taskAuthority?.bindingDigest !== plan.evidence.sourceBinding.bindingDigest) {
          throw new Error("Source authority changed before its recovery CAS.");
        }
        const targetLease = { ...lease, taskAuthority: target.binding };
        assertOnlyTaskAuthorityChanged({
          sourceLeaseDigest: plan.evidence.sourceLeaseDigest,
          sourceBinding: plan.evidence.sourceBinding,
          targetLease,
        });
        return {
          registry: { ...registry, leases: { ...registry.leases, [branch]: targetLease } },
          lease: targetLease,
          changed: true,
        };
      },
    });
    return localReceipt(plan, target, result.lease);
  }

  function observeLocalBinding(plan, target) {
    const lease = readLease();
    if (lease.taskAuthority?.bindingDigest !== target.binding.bindingDigest) return null;
    return localReceipt(plan, target, lease);
  }

  function verifyTerminal(plan, target) {
    const local = observeLocalBinding(plan, target);
    if (!local) throw new Error("Recovery terminal lacks its exact replacement binding.");
    const preserved = captureEvidence({
      allowReplacementBinding: true,
      sourceBinding: plan.evidence.sourceBinding,
      sourceLeaseDigest: plan.evidence.sourceLeaseDigest,
    });
    if (preserved.evidenceDigest !== plan.evidence.evidenceDigest) {
      throw new Error("Recovery terminal evidence drifted outside task authority.");
    }
    const core = {
      schema: `agentic-${OPERATION}-terminal-receipt/v1`,
      planDigest: plan.planDigest,
      evidenceDigest: plan.evidence.evidenceDigest,
      localReceiptDigest: local.receiptDigest,
      sourceBytesChanged: false,
      cloudMutated: false,
      pullRequestChanged: false,
      merged: false,
      cleaned: false,
      deployed: false,
    };
    return Object.freeze({ ...core, receiptDigest: digestValue(core) });
  }

  function readMergedPullRequest(url) {
    let pull;
    try {
      pull = JSON.parse(ghText([
        "pr", "view", requiredText(url, "pull request URL"), "--json",
        "number,id,url,state,isCrossRepository,headRefName,headRefOid,baseRefName,baseRefOid,mergeCommit,mergedAt",
      ]));
    } catch (error) {
      throw new Error(`Could not read merged pull request: ${error.message}`);
    }
    if (!pull?.mergeCommit?.oid || !pull.id) throw new Error("Merged pull request is incomplete.");
    return pull;
  }

  function readLedgerSnapshot(ledgerRepository) {
    const ref = ghJson(`repos/${requiredText(ledgerRepository, "ledger repository")}/git/ref/heads/${encodeURIComponent(LEDGER_REF)}`);
    const ledgerRevision = requiredSha(ref?.object?.sha, "ledger revision");
    const metadata = ghJson(
      `repos/${ledgerRepository}/contents/${LEDGER_PATH}?ref=${ledgerRevision}`,
    );
    const blobSha = requiredSha(metadata?.sha, "ledger blob");
    const blob = ghJson(`repos/${ledgerRepository}/git/blobs/${blobSha}`);
    if (blob?.encoding !== "base64" || !blob.content) throw new Error("Ledger blob is incomplete.");
    const ledger = JSON.parse(Buffer.from(String(blob.content).replaceAll("\n", ""), "base64").toString("utf8"));
    const failures = validateLedger(ledger);
    if (!Array.isArray(failures) || failures.length > 0) {
      throw new Error(`Ledger is invalid${failures?.length ? `: ${failures.join("; ")}` : "."}`);
    }
    return Object.freeze({ ledger, ledgerRevision });
  }

  function ghJson(endpoint) {
    return JSON.parse(ghText([
      "api", "-H", "Accept: application/vnd.github+json",
      "-H", "X-GitHub-Api-Version: 2026-03-10", endpoint,
    ]));
  }

  return Object.freeze({
    captureSource,
    readTargetCapabilityProjection,
    createTargetBinding,
    replaceLocalBinding,
    observeLocalBinding,
    verifyTerminal,
  });
}

export function createMergedIntegratedPreservedLostAuthorityJournalStore({
  journalPath,
  repository,
} = {}) {
  const root = realpathSync(path.resolve(requiredText(repository, "repository")));
  const target = requireExternalPath(root, journalPath, "journal");
  const parent = path.dirname(target);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (!statSync(parent).isDirectory()) throw new Error("Recovery journal parent is not a directory.");
  return Object.freeze({
    read() {
      if (!existsSync(target)) return null;
      try { return JSON.parse(readFileSync(target, "utf8")); }
      catch (error) { throw new Error(`Recovery journal is unreadable: ${error.message}`); }
    },
    write(value) {
      const temporary = `${target}.${randomUUID()}.tmp`;
      const descriptor = openSync(temporary, "wx", 0o600);
      try { writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); }
      finally { closeSync(descriptor); }
      renameSync(temporary, target);
      return value;
    },
    path: target,
  });
}

function requireExternalPath(repository, value, label) {
  const source = requiredText(value, `${label} path`);
  if (!path.isAbsolute(source)) throw new Error(`${label} path must be absolute.`);
  const target = path.resolve(source);
  const relative = path.relative(repository, target);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== "..")) {
    throw new Error(`${label} path must be outside the target repository.`);
  }
  return target;
}
function requiredText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}
function requiredSha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) throw new Error(`${label} is invalid.`);
  return value;
}
