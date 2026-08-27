import assert from "node:assert/strict";

import { digestValue }
  from "../../scripts/cloud-collaboration-primitives.mjs";
import { createPlannedCleanFenceAdmissionFinalizationRepositoryAdapter }
  from "../../scripts/planned-clean-fence-one-ahead-admission-finalization-repository-adapter.mjs";
import { readExactWriterMarker }
  from "../../scripts/planned-clean-fence-one-ahead-admission-finalization-evidence.mjs";
import { projectWriterLeasePullRequestMarker }
  from "../../scripts/writer-lease-lib.mjs";
import { writerLeaseDigest }
  from "../../scripts/writer-lease-registry-cas.mjs";

const D = value => digestValue({ value });

export function executionFixture({ plan, authorization, casFailure = null,
  markerFailure = null, thirdState = false } = {}) {
  const branch = plan.evidence.sourceLease.branch;
  const source = structuredClone(plan.evidence.sourceLease);
  const initialLease = thirdState
    ? { ...source, heartbeatAt: "2026-08-26T00:01:00.000Z" }
    : source;
  let registry = {
    schema: "agentic-writer-lease-registry/v2",
    revision: plan.evidence.sourceRegistry.revision,
    leases: { [branch]: initialLease },
  };
  let currentBody = plan.evidence.review.body;
  let currentReview = reviewProjection(plan, currentBody);
  let currentCasFailure = casFailure;
  let currentMarkerFailure = markerFailure;
  let indexDriftAtCall = null;
  let driftAfterNextLeaseRead = false;
  let registryLockCalls = 0;
  let registryDriftAtLockCall = null;
  const calls = { authorize: 0, cas: 0, marker: 0, cloud: 0,
    controller: 0, indexes: 0, terminal: 0 };
  const preview = admittedPreview(plan);
  const stable = {
    cloud: {
      targetAuthority: plan.evidence.targetCloudAuthority,
      heartbeatProjection: plan.evidence.heartbeatProjection,
    },
    preview,
  };
  const leaseStore = {
    statePath: "/authority/writer-leases.json",
    read: requested => {
      if (requested !== branch) return null;
      const value = structuredClone(registry.leases[branch]);
      if (driftAfterNextLeaseRead) {
        driftAfterNextLeaseRead = false;
        driftRegistryLease();
      }
      return value;
    },
    readRegistry: () => structuredClone(registry),
    withRegistryLock: action => {
      registryLockCalls += 1;
      if (registryLockCalls === registryDriftAtLockCall) driftRegistryLease();
      return action(structuredClone(registry));
    },
  };
  const captureIndexes = () => {
    calls.indexes += 1;
    return indexDriftAtCall !== null && calls.indexes >= indexDriftAtCall
      ? { ...plan.evidence.rawIndexFrame,
      indexFrameDigest: D("drifted indexes") } : plan.evidence.rawIndexFrame;
  };
  const mutateRegistry = ({ expectedLeaseDigest, expectedClaimId, action }) => {
    calls.cas += 1;
    if (currentCasFailure === "contention") {
      throw new Error("simulated CAS contention");
    }
    const current = registry.leases[branch];
    assert.equal(writerLeaseDigest(current), expectedLeaseDigest);
    assert.equal(current.cloudAuthority.claimId, expectedClaimId);
    const mutation = action({ registry: structuredClone(registry),
      lease: structuredClone(current) });
    const registryRevision = registry.revision + (mutation.changed ? 1 : 0);
    registry = { ...structuredClone(mutation.registry), revision: registryRevision };
    const result = { lease: structuredClone(mutation.lease),
      intent: mutation.intent || null, registryRevision };
    if (currentCasFailure === "response-loss") {
      currentCasFailure = null;
      throw new Error("simulated post-CAS response loss");
    }
    return result;
  };
  const gh = args => {
    if (args[1] === "view") return JSON.stringify(currentReview);
    assert.deepEqual(args.slice(0, 2), ["pr", "edit"]);
    calls.marker += 1;
    if (currentMarkerFailure === "before-apply") {
      throw new Error("simulated marker failure");
    }
    currentBody = args[args.indexOf("--body") + 1];
    currentReview = reviewProjection(plan, currentBody, currentReview);
    if (currentMarkerFailure === "response-loss") {
      currentMarkerFailure = null;
      throw new Error("simulated marker response loss");
    }
    return "";
  };
  const adapter = createPlannedCleanFenceAdmissionFinalizationRepositoryAdapter({
    canonicalRepository: plan.evidence.repository.canonicalPath,
    repository: plan.evidence.repository.candidatePath,
    branch,
    sessionId: source.sessionId,
    manifestFile: "/authority/manifest.json",
    rootAuthorizationFile: "/authority/root-authorization.json",
    taskAuthorityFile: "/authority/task-authority.json",
  }, {
    git: (_cwd, args) => {
      if (args.join(" ") === "rev-parse --git-common-dir") return "/controller/.git";
      throw new Error(`unexpected Git call: ${args.join(" ")}`);
    },
    gh,
    leaseStore,
    captureController: () => {
      calls.controller += 1;
      return plan.evidence.protectedController;
    },
    captureIndexes,
    recapture: () => structuredClone(stable),
    authorize: () => {
      calls.authorize += 1;
      return { receiptDigest: D("task receipt"), proofDigest: D("task proof") };
    },
    mutateRegistry,
    inspectCloud: () => { calls.cloud += 1; throw new Error("unexpected cloud status"); },
    verifyCloud: () => { calls.cloud += 1; throw new Error("unexpected cloud verify"); },
    verifyTerminal: ({ lease, bodyDigest }) => {
      calls.terminal += 1;
      assert.equal(bodyDigest, digestValue(currentBody));
      const marker = readExactWriterMarker(currentBody).value;
      assert.deepEqual(marker, projectWriterLeasePullRequestMarker(lease));
      return { bodyDigest, markerDigest: digestValue(marker) };
    },
    clock: () => new Date(plan.evidence.observedAt),
  });
  return {
    adapter,
    authorization,
    calls,
    execute: () => adapter.execute({ plan, authorization }),
    registry: () => structuredClone(registry),
    body: () => currentBody,
    setCasFailure: value => { currentCasFailure = value; },
    setMarkerFailure: value => { currentMarkerFailure = value; },
    setIndexDriftAtCall: value => { indexDriftAtCall = value; },
    setDriftAfterNextLeaseRead: () => { driftAfterNextLeaseRead = true; },
    setRegistryDriftAtLockCall: value => { registryDriftAtLockCall = value; },
    registryLockCalls: () => registryLockCalls,
    setReview: changes => {
      currentReview = { ...currentReview, ...changes };
      if (Object.hasOwn(changes, "body")) currentBody = changes.body;
    },
  };

  function driftRegistryLease() {
    registry = { ...registry, leases: { ...registry.leases,
      [branch]: { ...registry.leases[branch],
        heartbeatAt: "2026-08-26T00:02:00.000Z" } } };
  }
}

function admittedPreview(plan) {
  const source = plan.evidence.sourceLease.admission;
  const admissionReceipt = { receiptDigest: D("fresh admission receipt") };
  const preservationReceipt = { receiptDigest: D("fresh preservation receipt") };
  const mutationAuthorityReceipt = { receiptDigest: D("fresh mutation receipt") };
  const admittedReport = {
    schema: "agentic-lane-admission-report/v1",
    reportDigest: D("fresh admitted report"),
    planReportDigest: D("fresh plan report"),
    authoringAdmission: { status: "admitted" },
    candidate: {
      semanticScope: source.semanticScope,
      declaredWriteSet: source.declaredWriteSet,
      writeSetDigest: source.writeSetDigest,
      manifestDigest: source.manifestDigest,
    },
    admissionReceipt,
    existingLaneStateDigest: source.existingLaneStateDigest,
    preservationReceipt,
    mutationAuthorityReceipt,
    evaluatedAt: plan.evidence.observedAt,
  };
  return { admittedReport, preservationReceipt,
    planRecoveryReceipt: { receiptDigest: D("fresh plan recovery receipt") } };
}

function reviewProjection(plan, body, source = {}) {
  const sealed = plan.evidence.review;
  return {
    ...source,
    id: sealed.id,
    number: sealed.number,
    url: sealed.url,
    state: sealed.state,
    isDraft: sealed.draft,
    autoMergeRequest: sealed.autoMergeRequest,
    headRefName: sealed.branch,
    headRefOid: sealed.headSha,
    baseRefName: "main",
    baseRefOid: sealed.baseSha,
    body,
  };
}
