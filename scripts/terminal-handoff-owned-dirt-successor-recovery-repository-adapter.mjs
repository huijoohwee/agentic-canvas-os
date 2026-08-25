// Responsibility: Bind terminal-handoff recovery to Git, GitHub, cloud, proof, and lease CAS.
import { execFileSync } from "node:child_process";
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";

import { createActiveOwnedDirtSnapshot, captureActiveOwnedDirtEvidence,
  assertActiveOwnedDirtWithinWriteSet, requireSameActiveOwnedDirtEvidence }
  from "./active-owned-dirt-recovery-evidence.mjs";
import { validateLedger } from "./cloud-collaboration-contract.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { DEFAULT_LEDGER_PATH, DEFAULT_LEDGER_REF }
  from "./github-cloud-collaboration-adapter.mjs";
import { readOwnershipPullRequest } from "./device-pull-request-state.mjs";
import { writerLeaseBodyRemainder }
  from "./orphaned-task-authority-recovery-evidence.mjs";
import { assertRegisteredWorktree } from "./repository-guards.mjs";
import { invokeRepositoryCloudAction, bindAdmissionCloudAuthority,
  verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { normalizeBoundAuthority } from "./scoped-lane-cloud-reconciliation.mjs";
import { createTaskAuthorityBinding, createTaskAuthorityProof,
  projectTaskAuthorityCapability, verifyTaskAuthorityProof }
  from "./task-bound-lane-authority-contract.mjs";
import { readTaskAuthorityCapability } from "./task-bound-lane-authority-store.mjs";
import { createWriterLeaseStore, parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody }
  from "./writer-lease-lib.mjs";
import { mutateWriterLeaseRegistry, writerLeaseDigest }
  from "./writer-lease-registry-cas.mjs";
import { normalizeRecoveryIntent }
  from "./terminal-handoff-owned-dirt-successor-recovery-contract.mjs";
import { EVIDENCE_SCHEMA, assertNoLiveOverlap, sealTerminalHandoffEvidence,
  selectTerminalHandoffClaimProof }
  from "./terminal-handoff-owned-dirt-successor-recovery-evidence.mjs";

const JOURNAL_SCHEMA = "agentic-terminal-handoff-owned-dirt-successor-recovery-journal/v1";

export function createTerminalHandoffOwnedDirtSuccessorRecoveryRepositoryAdapter(
  options = {}, dependencies = {},
) {
  const repository = realpathSync(path.resolve(text(options.repository, "repository")));
  const capabilityPath = externalPath(repository, options.taskAuthorityFile, "task capability");
  const execute = (command, args, settings = {}) => execFileSync(command, args, {
    cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024, ...settings,
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
  const state = secureState(common, branch);

  function readLease() {
    const lease = store.read(branch);
    if (!lease || lease.branch !== branch) throw new Error("Recovery writer lease is missing.");
    return lease;
  }
  function status(lease = readLease()) {
    const result = invoke({ action: "status",
      ledgerRepository: lease.cloudAuthority.ledgerRepository,
      request: { targetRepository: lease.cloudAuthority.targetRepository }, environment });
    if (result?.ok !== true || result.action !== "status" || !Array.isArray(result.claims)) {
      throw new Error("Cloud status did not return a complete claim inventory.");
    }
    return result;
  }
  function rawLedger(lease) {
    const ledgerRepository = text(lease.cloudAuthority.ledgerRepository, "ledger repository");
    const reference = ghJson(["api", `repos/${ledgerRepository}/git/ref/heads/${encodeURIComponent(DEFAULT_LEDGER_REF)}`]);
    const revision = sha(reference?.object?.sha, "ledger ref revision");
    const metadata = ghJson(["api", `repos/${ledgerRepository}/contents/${DEFAULT_LEDGER_PATH}?ref=${revision}`]);
    const blob = ghJson(["api", `repos/${ledgerRepository}/git/blobs/${sha(metadata?.sha, "ledger blob SHA")}`]);
    if (blob?.encoding !== "base64" || !blob.content) throw new Error("Raw ledger blob is incomplete.");
    const ledger = JSON.parse(Buffer.from(String(blob.content).replaceAll("\n", ""), "base64").toString("utf8"));
    const failures = validateLedger(ledger);
    if (failures.length) throw new Error(`Raw collaboration ledger is invalid: ${failures.join("; ")}`);
    return ledger;
  }
  function readPull(lease) {
    return readOwnershipPullRequest({ url: text(lease.pullRequestUrl, "pull-request URL"),
      branch, ghText: gh });
  }
  function captureEvidence() {
    const record = assertRegisteredWorktree({ cwd: repository,
      porcelain: git(["worktree", "list", "--porcelain", "-z"]) });
    if (realpathSync(record.path) !== repository || record.branch !== `refs/heads/${branch}`) {
      throw new Error("Recovery branch does not own the registered worktree.");
    }
    const lease = readLease();
    if (lease.schema !== "agentic-writer-lease/v2" || lease.status !== "active"
      || lease.admission?.status !== "admitted" || lease.cloudAuthority?.state !== "active"
      || lease.worktreePath !== repository) {
      throw new Error("Recovery requires one admitted locally active source lease.");
    }
    const headSha = sha(git(["rev-parse", "HEAD"]), "source HEAD");
    if (headSha !== lease.fenceSha) throw new Error("Source HEAD differs from its lease fence.");
    const dirty = assertActiveOwnedDirtWithinWriteSet({
      evidence: captureActiveOwnedDirtEvidence({ repository }),
      declaredWriteSet: lease.admission.declaredWriteSet,
    });
    const pull = readPull(lease);
    const marker = parseWriterLeasePullRequestBody(pull.body);
    const expectedMarker = projectWriterLeasePullRequestMarker(lease);
    if (!marker || digestValue(marker) !== digestValue(expectedMarker)
      || pull.headRefOid !== headSha || pull.state !== "OPEN" || !pull.isDraft) {
      throw new Error("Source PR, marker, draft state, and HEAD do not join exactly.");
    }
    const sourceClaim = selectTerminalHandoffClaimProof({ entries: rawLedger(lease).entries, lease });
    const cloud = status(lease);
    const liveInventory = assertNoLiveOverlap({ claims: cloud.claims, sourceProof: sourceClaim });
    const capability = projectTaskAuthorityCapability(readTaskAuthorityCapability(capabilityPath));
    if (capability.authoritySubjectId !== lease.taskAuthority?.authoritySubjectId
      || capability.generation !== lease.taskAuthority?.generation
      || capability.publicKeyDigest !== lease.taskAuthority?.publicKeyDigest
      || capability.proofAdapterId !== lease.taskAuthority?.proofAdapterId) {
      throw new Error("Successor task capability does not match the lane's current bound subject.");
    }
    const core = {
      schema: EVIDENCE_SCHEMA, branch, headSha,
      treeSha: sha(git(["show", "-s", "--format=%T", headSha]), "source tree"),
      lease, leaseDigest: writerLeaseDigest(lease), sourceClaim,
      dirt: dirty, dirtEvidenceDigest: dirty.evidenceDigest,
      pullRequest: { id: text(pull.id, "pull-request ID"), url: pull.url,
        number: Number(pull.url.split("/").at(-1)), headSha: pull.headRefOid,
        baseSha: pull.baseRefOid, bodyDigest: digestValue(pull.body || ""),
        bodyRemainderDigest: digestValue(writerLeaseBodyRemainder(pull.body)),
        isDraft: pull.isDraft, state: pull.state },
      pullRequestMarkerDigest: digestValue(marker), liveInventory,
      targetCapability: capability, targetCapabilityDigest: digestValue(capability),
    };
    return sealTerminalHandoffEvidence({ ...core, evidenceDigest: digestValue(core) });
  }
  function currentTarget(plan, successorValues, authority) {
    const source = readLease();
    const successor = successorValues;
    const target = { ...source, sessionId: plan.operatorSessionId,
      expiresAt: authority.expiresAt, cloudAuthority: authority };
    const capability = readTaskAuthorityCapability(capabilityPath);
    if (digestValue(projectTaskAuthorityCapability(capability)) !== plan.targetCapabilityDigest) {
      throw new Error("Successor task capability changed from the authorized plan.");
    }
    const binding = createTaskAuthorityBinding({ capability, lease: target,
      bindingMode: "handoff", boundAt: successor.evaluationTime,
      transitionPlanDigest: plan.planDigest,
      priorBindingDigest: plan.evidence.lease.taskAuthority.bindingDigest });
    const operation = `terminal-handoff-owned-dirt-successor-recovery:${plan.planDigest}:local-cas`;
    const proof = createTaskAuthorityProof({ capability, binding, lease: target, operation });
    const verified = verifyTaskAuthorityProof({ proof, binding, lease: target, operation });
    return { lease: { ...target, taskAuthority: binding }, binding, proofDigest: verified.proofDigest };
  }
  const adapter = {
    captureEvidence,
    readIntent: () => readJournal(state.journal),
    writeIntent: ({ expected, value }) => writeJournal(state.journal, expected, value),
    withFence: action => withLock(state.lock, action),
    snapshot({ plan }) {
      requireCurrent(plan);
      const result = createActiveOwnedDirtSnapshot({ repository, evidence: plan.evidence.dirt,
        claimId: plan.sourceClaimId, planDigest: plan.planDigest,
        timestamp: plan.evidence.sourceClaim.retiredAt });
      return receipt("snapshot", { snapshotRef: result.snapshotRef,
        snapshotCommitSha: result.commitSha, snapshotReceiptDigest: result.snapshotReceiptDigest });
    },
    claimSuccessor({ plan }) {
      requireCurrent(plan);
      const source = plan.evidence.sourceClaim;
      const lease = plan.evidence.lease;
      const result = invoke({ action: "claim", ledgerRepository: lease.cloudAuthority.ledgerRepository,
        request: { targetRepository: lease.cloudAuthority.targetRepository,
          workItemId: source.workItemId, canonicalBaseSha: source.canonicalBaseRevision,
          headSha: source.laneRevision, declaredWriteSet: source.declaredWriteScope,
          predecessorClaimId: source.claimId, leaseEpoch: plan.targetLeaseEpoch,
          ttlSeconds: plan.ttlSeconds, deviceId: lease.device,
          sessionId: plan.operatorSessionId,
          idempotencyKey: `${plan.operation}:claim:${plan.planDigest}` }, environment });
      const claim = result?.claim;
      if (result?.ok !== true || result.action !== "claim" || claim?.state !== "current"
        || claim.predecessorClaimId !== source.claimId || claim.leaseEpoch !== plan.targetLeaseEpoch
        || claim.laneRevision !== plan.evidence.headSha
        || claim.writeSetDigest !== source.writeSetDigest) {
        throw new Error("Cloud did not create the exact current epoch-2 successor.");
      }
      return receipt("claim", { claimId: claim.claimId,
        claimDigest: result.claimDigest || claim.fenceRevision,
        transitionCounter: claim.transitionCounter, ledgerRevision: result.ledgerRevision,
        claimLedgerRevision: claim.transitionDigest, expiresAt: claim.expiresAt,
        evaluationTime: result.operationReceipt?.evaluationTime,
        operationReceiptDigest: result.operationReceipt?.receiptDigest,
        providerReceiptDigest: result.receipt?.receiptDigest,
        receiptDigest: result.receipt?.receiptDigest });
    },
    bindSuccessor({ plan, intent }) {
      const claimed = intent.receipts["successor-claimed"].values;
      const lease = plan.evidence.lease, manifest = lease.admission;
      const inventory = status(lease);
      const matches = inventory.claims.filter(item => item.claimId === claimed.claimId);
      if (matches.length !== 1) throw new Error("Epoch-2 successor is no longer unique.");
      const observed = matches[0];
      const seed = normalizeBoundAuthority({
        result: { schema: "agentic-cloud-collaboration-result/v1", ok: true, action: "claim",
          ledgerRevision: inventory.ledgerRevision, ledgerDigest: inventory.ledgerDigest,
          claimDigest: observed.fenceRevision, claim: observed },
        authority: { ...lease.cloudAuthority, deviceId: lease.device,
          sessionId: plan.operatorSessionId, leaseEpoch: plan.targetLeaseEpoch,
          reviewRequestId: null, state: "active" }, manifest,
        deviceId: lease.device, sessionId: plan.operatorSessionId,
      });
      if (observed.reviewRequestId === plan.evidence.sourceClaim.reviewRequestId
        && observed.state === "active" && observed.fenceRevision !== claimed.claimDigest) {
        const verification = verifyAdmissionCloudAuthority({ authority: seed, manifest,
          canonicalBaseSha: seed.canonicalBaseSha, environment, inspect: invoke,
          ...(verify ? { invoke: verify } : {}) });
        return receipt("bind", { authority: verification.authority,
          verificationDigest: verification.receiptDigest,
          receiptDigest: verification.receiptDigest });
      }
      if (observed.fenceRevision !== claimed.claimDigest || observed.state !== "current") {
        throw new Error("Epoch-2 successor changed before active binding.");
      }
      const bound = bindAdmissionCloudAuthority({ authority: seed, manifest, branch,
        headSha: plan.evidence.headSha,
        reviewRequestId: plan.evidence.sourceClaim.reviewRequestId,
        deviceId: lease.device, sessionId: plan.operatorSessionId,
        idempotencyKey: `${plan.operation}:bind:${plan.planDigest}`,
        returnVerification: true, environment, invoke, inspect: invoke,
        ...(verify ? { verify } : {}) });
      return receipt("bind", { authority: bound.authority,
        verificationDigest: bound.verification.receiptDigest,
        receiptDigest: bound.verification.receiptDigest });
    },
    projectLocal({ plan, intent }) {
      requireSameActiveOwnedDirtEvidence(plan.evidence.dirt,
        captureActiveOwnedDirtEvidence({ repository }));
      const target = currentTarget(plan, intent.receipts["successor-claimed"].values,
        intent.receipts["successor-bound"].values.authority);
      const result = mutateWriterLeaseRegistry({ leaseStore: store, branch,
        expectedLeaseDigest: plan.sourceLeaseDigest, expectedClaimId: plan.sourceClaimId,
        action: ({ registry, lease }) => {
          if (writerLeaseDigest(lease) !== plan.sourceLeaseDigest) throw new Error("Source lease changed before CAS.");
          return { registry: { ...registry, leases: { ...registry.leases, [branch]: target.lease } },
            lease: target.lease, changed: true };
        } });
      return receipt("local-cas", { targetLeaseDigest: writerLeaseDigest(result.lease),
        targetBindingDigest: target.binding.bindingDigest, proofDigest: target.proofDigest,
        cloudAuthorityDigest: digestValue(target.lease.cloudAuthority) });
    },
    projectPullRequest({ plan }) {
      const lease = readLease(), pull = readPull(lease);
      if (digestValue(writerLeaseBodyRemainder(pull.body)) !== plan.evidence.pullRequest.bodyRemainderDigest) {
        throw new Error("Pull-request non-marker body changed before projection.");
      }
      const expected = projectWriterLeasePullRequestMarker(lease);
      let marker = parseWriterLeasePullRequestBody(pull.body);
      if (digestValue(marker) !== digestValue(expected)) {
        gh(["pr", "edit", pull.url, "--body", updateWriterLeasePullRequestBody(pull.body, lease)]);
        marker = parseWriterLeasePullRequestBody(readPull(lease).body);
      }
      if (digestValue(marker) !== digestValue(expected)) throw new Error("PR marker did not converge.");
      return receipt("pr-marker", { markerDigest: digestValue(marker), leaseDigest: writerLeaseDigest(lease) });
    },
    verifyTerminal({ plan, intent }) {
      const lease = readLease();
      const local = intent.receipts["local-cas"].values;
      if (writerLeaseDigest(lease) !== local.targetLeaseDigest
        || lease.cloudAuthority.claimId !== intent.receipts["successor-claimed"].values.claimId) {
        throw new Error("Terminal lease does not carry the epoch-2 successor.");
      }
      requireSameActiveOwnedDirtEvidence(plan.evidence.dirt,
        captureActiveOwnedDirtEvidence({ repository }));
      verifyAdmissionCloudAuthority({ authority: lease.cloudAuthority, manifest: lease.admission,
        canonicalBaseSha: lease.cloudAuthority.canonicalBaseSha, environment,
        inspect: invoke, ...(verify ? { invoke: verify } : {}) });
      const pull = readPull(lease), marker = parseWriterLeasePullRequestBody(pull.body);
      if (digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))
        || pull.headRefOid !== plan.evidence.headSha) throw new Error("Terminal PR projection is invalid.");
      const mutationCore = { schema: "agentic-terminal-handoff-mutation-authority/v1",
        status: "ready", planDigest: plan.planDigest, successorClaimId: lease.cloudAuthority.claimId,
        leaseDigest: writerLeaseDigest(lease), taskAuthorityBindingDigest: lease.taskAuthority.bindingDigest,
        dirtEvidenceDigest: plan.evidence.dirtEvidenceDigest,
        sourceBytesChanged: false };
      return receipt("terminal", { leaseDigest: writerLeaseDigest(lease),
        cloudAuthorityDigest: digestValue(lease.cloudAuthority), markerDigest: digestValue(marker),
        dirtEvidenceDigest: plan.evidence.dirtEvidenceDigest,
        mutationAuthorityReceiptDigest: digestValue(mutationCore) });
    },
    reconcile({ plan, intent, phase: name }) {
      try {
        if (name === "snapshotted") return null;
        if (name === "successor-claimed") {
          const matches = status(plan.evidence.lease).claims.filter(
            item => item.predecessorClaimId === plan.sourceClaimId);
          if (matches.length !== 1 || matches[0].state !== "current") return null;
          const claim = matches[0];
          return receipt("claim", { claimId: claim.claimId, claimDigest: claim.fenceRevision,
            transitionCounter: claim.transitionCounter, ledgerRevision: status(plan.evidence.lease).ledgerRevision,
            claimLedgerRevision: claim.transitionDigest, expiresAt: claim.expiresAt,
            evaluationTime: claim.eligibleSince || plan.evidence.sourceClaim.retiredAt,
            operationReceiptDigest: claim.operationReceiptDigest,
            providerReceiptDigest: claim.operationReceiptDigest, receiptDigest: claim.operationReceiptDigest });
        }
        if (name === "local-cas") {
          const lease = readLease();
          if (lease.cloudAuthority?.claimId !== intent.receipts["successor-claimed"]?.values.claimId) return null;
          return receipt("local-cas", { targetLeaseDigest: writerLeaseDigest(lease),
            targetBindingDigest: lease.taskAuthority.bindingDigest, proofDigest: digestValue(lease.taskAuthority),
            cloudAuthorityDigest: digestValue(lease.cloudAuthority) });
        }
        if (name === "pr-marker") {
          const lease = readLease(), marker = parseWriterLeasePullRequestBody(readPull(lease).body);
          if (digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))) return null;
          return receipt("pr-marker", { markerDigest: digestValue(marker), leaseDigest: writerLeaseDigest(lease) });
        }
        if (name === "verified") return adapter.verifyTerminal({ plan, intent });
      } catch { return null; }
      return null;
    },
  };
  return Object.freeze(adapter);

  function requireCurrent(plan) {
    const current = captureEvidence();
    if (current.evidenceDigest !== plan.evidenceDigest) throw new Error("Recovery source drifted from its plan.");
  }
}

function receipt(kind, values) { const core = { schema: "agentic-terminal-handoff-recovery-effect/v1", kind, ...values };
  return Object.freeze({ ...core, receiptDigest: values.receiptDigest || digestValue(core) }); }
function secureState(common, branch) { const root = path.join(common, "agentic-canvas-os",
  "terminal-handoff-owned-dirt-successor-recovery"); mkdirSync(root, { recursive: true, mode: 0o700 });
  const key = digestValue({ branch }); return { journal: path.join(root, `${key}.json`), lock: path.join(root, `${key}.lock`) }; }
function readJournal(file) { if (!existsSync(file)) return null; const envelope = JSON.parse(readFileSync(file, "utf8"));
  if (envelope.schema !== JOURNAL_SCHEMA || envelope.intentDigest !== digestValue(envelope.intent)) throw new Error("Recovery journal is invalid.");
  return normalizeRecoveryIntent(envelope.intent); }
function writeJournal(file, expected, value) { const current = readJournal(file);
  if (digestValue(current) !== digestValue(expected)) throw new Error("Recovery journal changed before CAS.");
  const envelope = { schema: JOURNAL_SCHEMA, intent: value, intentDigest: digestValue(value) };
  const temporary = `${file}.${process.pid}.${process.hrtime.bigint()}.tmp`; let descriptor;
  try { descriptor = openSync(temporary, "wx", 0o600); writeFileSync(descriptor, `${JSON.stringify(envelope, null, 2)}\n`);
    fsyncSync(descriptor); closeSync(descriptor); descriptor = null; renameSync(temporary, file);
  } finally { if (descriptor) closeSync(descriptor); if (existsSync(temporary)) unlinkSync(temporary); } return value; }
async function withLock(file, action) { let descriptor;
  try { descriptor = openSync(file, "wx", 0o600); writeFileSync(descriptor, `${process.pid}\n`); fsyncSync(descriptor); return await action(); }
  catch (error) { if (error?.code === "EEXIST") throw new Error("Recovery is already fenced."); throw error; }
  finally { if (descriptor) closeSync(descriptor); if (existsSync(file)) unlinkSync(file); } }
function externalPath(repository, value, label) { const target = realpathSync(path.resolve(text(value, label)));
  const relative = path.relative(repository, target); if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".."))
    throw new Error(`${label} must be outside the source repository.`); return target; }
function text(value, label) { const result = String(value || "").trim(); if (!result) throw new Error(`${label} is required.`); return result; }
function sha(value, label) { const result = text(value, label); if (!/^[0-9a-f]{40}$/u.test(result)) throw new Error(`${label} is invalid.`); return result; }
