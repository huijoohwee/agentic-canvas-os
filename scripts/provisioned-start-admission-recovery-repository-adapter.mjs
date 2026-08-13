// Responsibility: Map Git, provider, cloud, and writer-registry state to recovery ports.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { normalizeDeclaredWriteScopeManifest } from "./scoped-lane-admission-lib.mjs";
import { verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { createWriterLeaseStore, parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker, updateWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";
import { casWriterLeaseProjection } from "./writer-lease-registry-cas.mjs";
import { projectProvisionedStartAdmissionRecovery } from "./provisioned-start-admission-recovery-contract.mjs";
import { attestProvisionedStartCloudAuthoritySubject,
  PROVISIONED_START_CLOUD_AUTHORITY_SUBJECT_SCHEMA,
  PROVISIONED_START_CLOUD_VERIFIER_ADAPTER_ID, PROVISIONED_START_CLOUD_VERIFIER_VERSION,
  projectProvisionedStartCloudAuthoritySubject,
  requireProvisionedStartCloudAuthorityAttestation,
} from "./provisioned-start-cloud-authority-subject.mjs";

export function createProvisionedStartAdmissionRecoveryRepositoryAdapter({
  repository,
  sessionId,
  taskAuthorityFile,
  environment = process.env,
  git = defaultGit,
  gh = defaultGh,
  verifyCloud = verifyAdmissionCloudAuthority,
  createLeaseStore = createWriterLeaseStore,
  clock = () => new Date(),
} = {}) {
  const repo = path.resolve(repository || "");
  const capability = path.resolve(taskAuthorityFile || "");
  if (!path.isAbsolute(repository || "") || !path.isAbsolute(taskAuthorityFile || "")) {
    throw new Error("Recovery requires absolute repository and external task-authority paths.");
  }
  if (capability === repo || capability.startsWith(`${repo}${path.sep}`)) {
    throw new Error("Task authority capability must remain outside the repository.");
  }
  const common = path.resolve(repo, git(repo, ["rev-parse", "--git-common-dir"]));
  const store = createLeaseStore({ gitCommonDir: common, taskAuthorityFile: capability,
    taskAuthorityPolicy: "required", now: clock });

  function readEvidence() {
    const branch = git(repo, ["branch", "--show-current"]);
    const lease = store.assertTaskAuthority({ branch, operation: "provisioned-start-admission-recovery-plan" });
    requireOwner(lease, sessionId, repo);
    const descendant = readDescendant({ repo, lease, git });
    const provider = readPullRequest({ lease, gh });
    const manifest = manifestFromLease(lease);
    const verified = verifyCloud({ authority: lease.cloudAuthority, manifest,
      canonicalBaseSha: lease.baseSha, environment });
    const cloud = cloudEvidence(verified, lease, manifest).cloud;
    return Object.freeze({ lease, descendant, pullRequest: provider.evidence, cloud,
      privateState: Object.freeze({ manifest, pullRequestBody: provider.body }) });
  }

  function assertPlanPreimage(plan, operation) {
    const live = readEvidence();
    const comparable = { lease: plan.evidence.lease, descendant: plan.evidence.descendant,
      pullRequest: plan.evidence.pullRequest, cloud: plan.evidence.cloud };
    const liveComparable = projectComparable(live);
    if (digestValue(liveComparable) !== digestValue(comparable)) {
      throw new Error(`Recovery preimage drifted before ${operation}.`);
    }
    store.assertTaskAuthority({ branch: plan.evidence.lease.branch, operation });
    return live;
  }

  function assertFreshVerification(plan, operation) {
    const lease = store.assertTaskAuthority({ branch: plan.evidence.lease.branch, operation });
    requireCloudFrame({ lease, plan, verifyCloud, environment });
    return true;
  }

  function projectLocal({ plan, projectedAt }) {
    const branch = plan.evidence.lease.branch;
    const current = store.read(branch);
    const sourceLease = current?.admission?.status === "admitted"
      ? store.assertTaskAuthority({ branch, operation: "provisioned-start-admission-recovery-local-adopt" })
      : assertPlanPreimage(plan, "provisioned-start-admission-recovery-local-cas").lease;
    const sourceProof = capabilityReceipt(plan.evidence.lease, "source-local-cas");
    const targetProjection = projectProvisionedStartAdmissionRecovery({ plan, projectedAt,
      mutationReceiptDigests: [sourceProof, capabilityReceipt(plan.evidence.lease, "target-local-cas")] });
    if (current?.admission?.status === "admitted") {
      requireProjectedLease(current, plan, targetProjection);
      assertRepositoryFrame({ repo, plan, git });
      requireProviderFrame(readPullRequest({ lease: current, gh }).evidence, plan.evidence.pullRequest);
      requireCloudFrame({ lease: current, plan, verifyCloud, environment });
      return { lease: current, projection: targetProjection, adopted: true };
    }
    const lease = casWriterLeaseProjection({ leaseStore: store, branch,
      expectedLeaseDigest: plan.evidence.lease.leaseDigest,
      expectedClaimId: plan.evidence.cloud.claimId, values: {
      integration: targetProjection.integration,
      admission: targetProjection.admission,
      provisionedStartAdmissionRecovery: targetProjection.preservation,
    } }).lease;
    requireProjectedLease(lease, plan, targetProjection);
    return { lease, projection: targetProjection, adopted: false };
  }

  function projectMarker({ plan, projectedAt }) {
    const branch = plan.evidence.lease.branch;
    const lease = store.assertTaskAuthority({ branch, operation: "provisioned-start-admission-recovery-pr-marker" });
    if (lease.admission?.status !== "admitted" || lease.integration?.commitSha !== plan.evidence.descendant.headSha) {
      throw new Error("Recovery marker projection requires the exact local admission projection.");
    }
    assertRepositoryFrame({ repo, plan, git });
    const provider = readPullRequest({ lease: { ...lease, pullRequestUrl: plan.evidence.pullRequest.url }, gh });
    requireProviderFrame(provider.evidence, plan.evidence.pullRequest);
    requireCloudFrame({ lease, plan, verifyCloud, environment });
    const expectedBody = updateWriterLeasePullRequestBody(planPrivateBody(plan, provider.body), lease);
    const currentDigest = digestValue(provider.body);
    const sourceDigest = plan.evidence.pullRequest.bodyDigest;
    const targetDigest = digestValue(expectedBody);
    if (currentDigest === targetDigest) return { lease, bodyDigest: targetDigest, adopted: true,
      markerDigest: digestValue(projectWriterLeasePullRequestMarker(lease)), projectedAt };
    if (currentDigest !== sourceDigest) throw new Error("Pull-request body drifted outside the deterministic marker projection.");
    gh(["pr", "edit", plan.evidence.pullRequest.url, "--body", expectedBody]);
    const updated = readPullRequest({ lease: { ...lease, pullRequestUrl: plan.evidence.pullRequest.url }, gh });
    if (digestValue(updated.body) !== targetDigest) throw new Error("Pull-request marker projection did not persist exact bytes.");
    return { lease, bodyDigest: targetDigest, adopted: false,
      markerDigest: digestValue(projectWriterLeasePullRequestMarker(lease)), projectedAt };
  }

  function verifyTerminal({ plan, expectedBodyDigest }) {
    const branch = plan.evidence.lease.branch;
    const lease = store.assertTaskAuthority({ branch, operation: "provisioned-start-admission-recovery-terminal" });
    const projection = projectProvisionedStartAdmissionRecovery({ plan,
      projectedAt: lease.provisionedStartAdmissionRecovery?.projectedAt,
      mutationReceiptDigests: lease.provisionedStartAdmissionRecovery?.taskAuthorityMutationReceiptDigests || [] });
    requireProjectedLease(lease, plan, projection);
    assertRepositoryFrame({ repo, plan, git });
    const live = readPullRequest({ lease, gh });
    if (digestValue(live.body) !== expectedBodyDigest) throw new Error("Terminal pull-request body drifted.");
    const marker = parseWriterLeasePullRequestBody(live.body);
    if (digestValue(marker) !== digestValue(projectWriterLeasePullRequestMarker(lease))) {
      throw new Error("Terminal pull-request marker does not match the admitted lease.");
    }
    const cloud = requireCloudFrame({ lease, plan, verifyCloud, environment });
    return Object.freeze({ leaseDigest: digestValue(lease), bodyDigest: expectedBodyDigest,
      cloudAuthoritySubjectDigest: cloud.verifier.subjectDigest,
      cloudVerificationReceiptDigest: cloud.verificationReceiptDigest,
      cloudVerificationAttestationReceiptDigest: cloud.verificationAttestationReceiptDigest,
      descendantDigest: digestValue(readDescendant({ repo, lease, git })) });
  }

  return Object.freeze({ assertFreshVerification, assertPlanPreimage, projectLocal, projectMarker, readEvidence, verifyTerminal,
    gitCommonDir: common });
}

function readDescendant({ repo, lease, git }) {
  const status = git(repo, ["status", "--porcelain"]);
  const headSha = git(repo, ["rev-parse", "HEAD"]);
  const fenceSha = lease.fenceSha;
  if (status || git(repo, ["merge-base", fenceSha, headSha]) !== fenceSha) {
    throw new Error("Recovery requires a clean authored descendant of the fence.");
  }
  const shas = git(repo, ["rev-list", "--reverse", "--first-parent", `${fenceSha}..${headSha}`])
    .split("\n").filter(Boolean);
  const allShas = git(repo, ["rev-list", "--reverse", `${fenceSha}..${headSha}`]).split("\n").filter(Boolean);
  if (!shas.length || JSON.stringify(shas) !== JSON.stringify(allShas)) {
    throw new Error("Recovery authored range must be nonempty and linear.");
  }
  const commits = shas.map(sha => ({ sha, treeSha: git(repo, ["show", "-s", "--format=%T", sha]),
    parentSha: git(repo, ["show", "-s", "--format=%P", sha]),
    message: git(repo, ["show", "-s", "--format=%B", sha]).trim() }));
  if (commits.some(commit => commit.parentSha.includes(" "))) throw new Error("Recovery range cannot contain merge commits.");
  const paths = git(repo, ["diff", "--name-only", fenceSha, headSha]).split("\n").filter(Boolean).sort();
  const rangeDiffDigest = digestValue({ patch: git(repo, ["diff", "--binary", "--full-index", fenceSha, headSha]) });
  return Object.freeze({ fenceSha, headSha, treeSha: git(repo, ["rev-parse", `${headSha}^{tree}`]),
    clean: true, linear: true, paths, rangeDiffDigest, commits });
}

function readPullRequest({ lease, gh }) {
  const value = JSON.parse(gh(["pr", "view", lease.pullRequestUrl, "--json",
    "id,number,url,state,isDraft,autoMergeRequest,headRefName,headRefOid,baseRefOid,body"]));
  return { body: value.body || "", evidence: Object.freeze({ id: value.id, number: value.number,
    url: value.url, state: value.state, isDraft: value.isDraft, autoMergeRequest: value.autoMergeRequest,
    branch: value.headRefName, headSha: value.headRefOid, baseSha: value.baseRefOid,
    bodyDigest: digestValue(value.body || "") }) };
}

function cloudEvidence(verified, lease, manifest) {
  const claim = verified.verification.inventory.claims.find(item => item.claimId === lease.cloudAuthority.claimId);
  if (!claim) throw new Error("Cloud verification omitted the exact claim.");
  const subject = projectProvisionedStartCloudAuthoritySubject({ verified, lease, manifest });
  const attestation = attestProvisionedStartCloudAuthoritySubject({ verified, subject });
  const cloud = Object.freeze({ status: verified.verification.status, state: verified.authority.state,
    writeAuthority: claim.writeAuthority, scopeReserved: claim.scopeReserved,
    claimId: verified.authority.claimId, claimDigest: verified.authority.claimDigest,
    laneRevision: verified.authority.laneRevision, transitionCounter: verified.authority.transitionCounter,
    heartbeatCounter: claim.heartbeatCounter, ledgerRevision: verified.authority.ledgerRevision,
    ledgerDigest: verified.verification.ledgerDigest,
    verifier: Object.freeze({ adapterId: PROVISIONED_START_CLOUD_VERIFIER_ADAPTER_ID,
      schema: PROVISIONED_START_CLOUD_AUTHORITY_SUBJECT_SCHEMA,
      version: PROVISIONED_START_CLOUD_VERIFIER_VERSION,
      subjectDigest: digestValue(subject) }) });
  requireProvisionedStartCloudAuthorityAttestation(attestation, cloud.verifier.subjectDigest);
  return Object.freeze({ cloud, attestation });
}

function manifestFromLease(lease) {
  return normalizeDeclaredWriteScopeManifest({ schema: "agentic-declared-write-scope/v1",
    semanticScope: lease.admission.semanticScope,
    paths: lease.admission.declaredWriteSet.filter(item => item.startsWith("path:")).map(item => item.slice(5)) },
  { expectedScope: lease.scope });
}

function projectComparable(live) {
  return { lease: normalizeLeaseComparable(live.lease), descendant: live.descendant,
    pullRequest: live.pullRequest, cloud: live.cloud };
}

function normalizeLeaseComparable(lease) {
  return { schema: lease.schema, status: lease.status, sessionId: lease.sessionId, device: lease.device,
    scope: lease.scope, branch: lease.branch, worktreePath: lease.worktreePath, epoch: lease.epoch,
    fenceSha: lease.fenceSha, pullRequestUrl: lease.pullRequestUrl,
    taskAuthorityDigest: digestValue(lease.taskAuthority), cloudClaimId: lease.cloudAuthority.claimId,
    cloudAuthorityDigest: digestValue(lease.cloudAuthority),
    admission: { schema: lease.admission.schema, status: lease.admission.status,
      semanticScope: lease.admission.semanticScope, declaredWriteSet: lease.admission.declaredWriteSet,
      writeSetDigest: lease.admission.writeSetDigest, manifestDigest: lease.admission.manifestDigest,
      planReceiptDigest: lease.admission.planReceiptDigest, admissionReceiptDigest: lease.admission.admissionReceiptDigest,
      existingLaneStateDigest: lease.admission.existingLaneStateDigest }, leaseDigest: digestValue(lease) };
}

function requireOwner(lease, sessionId, repo) {
  if (lease.sessionId !== sessionId || path.resolve(lease.worktreePath) !== repo) {
    throw new Error("Recovery session or attached worktree does not own the exact lease.");
  }
}
function requireProviderFrame(actual, expected) { if (digestValue(actual) !== digestValue(expected)) throw new Error("Pull-request identity or frame drifted."); }
function requireCloudFrame({ lease, plan, verifyCloud, environment }) { const manifest = manifestFromLease(lease);
  const verified = verifyCloud({ authority: lease.cloudAuthority, manifest, canonicalBaseSha: lease.baseSha, environment });
  const { cloud, attestation } = cloudEvidence(verified, lease, manifest);
  if (digestValue(cloud) !== digestValue(plan.evidence.cloud)) {
    throw new Error("Cloud authority drifted from the sealed recovery plan."); }
  requireProvisionedStartCloudAuthorityAttestation(attestation, plan.evidence.cloud.verifier.subjectDigest);
  return { ...cloud, verificationReceiptDigest: attestation.sourceReceiptDigest,
    verificationAttestationReceiptDigest: attestation.receiptDigest }; }
function assertRepositoryFrame({ repo, plan, git }) { if (digestValue(readDescendant({ repo, lease: { fenceSha: plan.evidence.descendant.fenceSha }, git })) !== digestValue(plan.evidence.descendant)) throw new Error("Authored descendant drifted."); }
function capabilityReceipt(lease, operation) { return digestValue({ schema: "agentic-task-authority-mutation-proof/v1", operation,
  taskAuthorityDigest: lease.taskAuthorityDigest, leaseDigest: lease.leaseDigest }); }
function requireProjectedLease(lease, plan, projection) { if (lease.integration?.commitSha !== plan.evidence.descendant.headSha
  || digestValue(lease.integration) !== digestValue(projection.integration)
  || digestValue(lease.admission) !== digestValue(projection.admission)
  || digestValue(lease.provisionedStartAdmissionRecovery) !== digestValue(projection.preservation)) throw new Error("Local recovery projection drifted."); }
function planPrivateBody(plan, currentBody) { if (digestValue(currentBody) !== plan.evidence.pullRequest.bodyDigest) return currentBody; return currentBody; }
function defaultGit(repo, args) { return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim(); }
function defaultGh(args) { return execFileSync("gh", args, { encoding: "utf8" }).trim(); }
