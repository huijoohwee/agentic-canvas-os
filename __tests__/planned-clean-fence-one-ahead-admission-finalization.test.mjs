import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, utimesSync,
  writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  OPERATION,
  buildPlannedCleanFenceAdmissionFinalizationPlan,
  buildPlannedCleanFenceAdmissionFinalizationResult,
  normalizePlannedCleanFenceAdmissionFinalizationPlan,
  requirePlannedCleanFenceAdmissionFinalizationAuthorization,
} from "../scripts/planned-clean-fence-one-ahead-admission-finalization-contract.mjs";
import { evidenceFixture, D, OBSERVED }
  from "./helpers/planned-dirty-admission-recovery-fixtures.mjs";
import { projectWriterLeasePullRequestMarker }
  from "../scripts/writer-lease-lib.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";
import { createPlannedCleanFenceAdmissionFinalizationRepositoryAdapter }
  from "../scripts/planned-clean-fence-one-ahead-admission-finalization-repository-adapter.mjs";
import { collectScopedLaneState } from "../scripts/scoped-lane-admission-state.mjs";
import { defaultGit } from "../scripts/planned-clean-fence-one-ahead-admission-finalization-ports.mjs";
import { assertStatusVerificationJoin, capturePlannedCleanFenceProtectedController,
  captureRegisteredRawIndexFrame, projectStatusVerifiedCloudAuthority,
  rawIndexSha256, readExactWriterMarker,
  recoverProtectedDescendantCandidateRegistration, replacePlannedCleanFenceWriterMarker }
  from "../scripts/planned-clean-fence-one-ahead-admission-finalization-evidence.mjs";
import { executionFixture }
  from "./helpers/planned-clean-fence-one-ahead-finalization-fixture.mjs";

const BASE = "a".repeat(40);
const FENCE = "b".repeat(40);

function evidence(changes = {}) {
  const source = evidenceFixture({ oneAhead: true });
  const sourceLease = source.sourceLease;
  const reviewBody = source.pullRequest.body;
  const rootCore = {
    schema: "agentic-root-source-bootstrap-preservation-authorization/v1",
    maintenanceSourcePath: "/controller/maintenance",
  };
  const rootSourceBootstrapAuthorization = {
    ...rootCore,
    authorizationDigest: digestValue(rootCore),
  };
  const preview = Object.fromEntries([
    "peerLaneStateDigest", "protectedMainAdvanceDigest",
    "candidateCreateRegisterResultDigest", "recoveredPlanReportDigest",
    "recoveredAdmissionReceiptDigest", "recoveredExistingLaneStateDigest",
    "preservationReceiptDigest", "admittedReportDigest", "planRecoveryReceiptDigest",
  ].map(field => [field, D(field)]));
  return {
    observedAt: OBSERVED,
    repository: {
      canonicalPath: "/controller",
      candidatePath: sourceLease.worktreePath,
      protectedMainAdvance: {},
      peerLaneStateDigest: preview.peerLaneStateDigest,
      candidateCreateRegisterResultDigest: preview.candidateCreateRegisterResultDigest,
      recoveredExistingLaneStateDigest: preview.recoveredExistingLaneStateDigest,
    },
    sourceLease,
    sourceLeaseDigest: digestValue(sourceLease),
    sourceRegistry: { revision: 42, registryDigest: D("registry") },
    manifest: source.manifest,
    sourceGit: {
      branch: sourceLease.branch,
      headSha: FENCE,
      treeSha: "c".repeat(40),
      localRefSha: FENCE,
      remoteRefSha: FENCE,
      parentSha: BASE,
      parentShas: [BASE],
      baseTreeSha: "c".repeat(40),
      clean: true,
      statusDigest: D("clean status"),
      changedPaths: [],
      indexSha256: D("index bytes"),
    },
    review: {
      id: "PR_1",
      number: 1,
      url: sourceLease.pullRequestUrl,
      state: "OPEN",
      draft: true,
      autoMergeRequest: null,
      branch: sourceLease.branch,
      headSha: FENCE,
      baseSha: BASE,
      body: reviewBody,
      bodyDigest: digestValue(reviewBody),
      markerDigest: digestValue(projectWriterLeasePullRequestMarker(sourceLease)),
    },
    targetCloudAuthority: source.targetCloudAuthority,
    targetCloudAuthorityDigest: digestValue(source.targetCloudAuthority),
    heartbeatProjectionDigest: source.heartbeatProjection.projectionDigest,
    protectedController: {
      schema: "agentic-planned-clean-fence-protected-controller/v1",
      branch: "main", headSha: BASE, treeSha: "c".repeat(40),
      localMainSha: BASE, originMainSha: BASE, remoteMainSha: BASE,
      clean: true, statusDigest: digestValue(""), implementationDigest: D("implementation"),
    },
    rawIndexFrame: { schema: "agentic-registered-raw-index-frame/v1",
      laneCount: 2, candidateIndexSha256: D("index bytes"),
      indexFrameDigest: D("all indexes") },
    rootSourceBootstrapAuthorization,
    rootSourceBootstrapAuthorizationDigest:
      rootSourceBootstrapAuthorization.authorizationDigest,
    preview,
    ...changes,
  };
}

test("plan seals one exact clean fence and one-ahead cloud heartbeat", () => {
  const plan = buildPlannedCleanFenceAdmissionFinalizationPlan(evidence());
  assert.equal(plan.operation, OPERATION);
  assert.equal(plan.evidence.heartbeatProjection.disposition, "one-ahead");
  assert.equal(plan.evidence.sourceGit.changedPaths.length, 0);
  assert.deepEqual(normalizePlannedCleanFenceAdmissionFinalizationPlan(plan), plan);
  const token = `authorize ${OPERATION} ${plan.planDigest}`;
  assert.equal(requirePlannedCleanFenceAdmissionFinalizationAuthorization(
    plan, token).planDigest, plan.planDigest);
  assert.throws(() => requirePlannedCleanFenceAdmissionFinalizationAuthorization(
    plan, `${token}-wrong`), /Exact authorization/u);
});

test("plan rejects dirt, nonempty fences, marker drift, and non-successor heartbeats", () => {
  const dirty = evidence();
  dirty.sourceGit.clean = false;
  assert.throws(() => buildPlannedCleanFenceAdmissionFinalizationPlan(dirty),
    /clean empty coordination fence/u);
  const changed = evidence();
  changed.sourceGit.changedPaths = ["docs/a.md"];
  assert.throws(() => buildPlannedCleanFenceAdmissionFinalizationPlan(changed),
    /clean empty coordination fence/u);
  const marker = evidence();
  marker.review.markerDigest = D("foreign marker");
  assert.throws(() => buildPlannedCleanFenceAdmissionFinalizationPlan(marker),
    /open draft review/u);
  const same = evidence();
  same.targetCloudAuthority = { ...same.sourceLease.cloudAuthority, heartbeatCounter: 0 };
  same.targetCloudAuthorityDigest = digestValue(same.targetCloudAuthority);
  assert.throws(() => buildPlannedCleanFenceAdmissionFinalizationPlan(same),
    /one-ahead heartbeat projection/u);
  const mergeFence = evidence();
  mergeFence.sourceGit.parentShas = [BASE, "d".repeat(40)];
  assert.throws(() => buildPlannedCleanFenceAdmissionFinalizationPlan(mergeFence),
    /clean empty coordination fence/u);
});

test("marker projection preserves every non-marker byte and rejects ambiguous bodies", () => {
  const value = evidence();
  const source = `Unicode π\r\n${value.review.body}\r\n  \n\t`;
  const targetLease = { ...value.sourceLease, admission: {
    ...value.sourceLease.admission, status: "admitted",
    admittedReportDigest: D("admitted"), preservationReceiptDigest: D("preserved") } };
  const before = readExactWriterMarker(source);
  const target = replacePlannedCleanFenceWriterMarker(source, targetLease);
  const after = readExactWriterMarker(target);
  assert.equal(target.slice(0, after.start), source.slice(0, before.start));
  assert.equal(target.slice(after.end), source.slice(before.end));
  assert.equal(target.endsWith("\r\n  \n\t"), true);
  assert.deepEqual(after.value, projectWriterLeasePullRequestMarker(targetLease));
  assert.equal(replacePlannedCleanFenceWriterMarker(target, targetLease), target);
  assert.throws(() => readExactWriterMarker("none"), /one exact writer marker/u);
  assert.throws(() => readExactWriterMarker(`${source}${source}`), /one exact writer marker/u);
  assert.throws(() => readExactWriterMarker(`<!-- agentic-writer-lease/v2 {} -->`),
    /malformed/u);
});

test("status and verifier inventories must expose the same heartbeat transition", () => {
  const authority = { claimId: D("claim"), transitionCounter: 3, heartbeatCounter: 1,
    claimDigest: D("fence"), claimLedgerRevision: D("transition") };
  const claim = { claimId: authority.claimId, transitionCounter: 3, heartbeatCounter: 1,
    fenceRevision: authority.claimDigest, transitionDigest: authority.claimLedgerRevision };
  assert.deepEqual(assertStatusVerificationJoin({ statusClaim: claim,
    verification: { inventory: { claims: [claim] } }, authority }), claim);
  const sourceAuthority = { ...authority };
  delete sourceAuthority.heartbeatCounter;
  const projected = projectStatusVerifiedCloudAuthority({ statusClaim: claim,
    verification: { inventory: { claims: [claim] } }, authority: sourceAuthority });
  assert.equal(projected.heartbeatCounter, claim.heartbeatCounter);
  assert.equal(sourceAuthority.heartbeatCounter, undefined);
  assert.throws(() => assertStatusVerificationJoin({ statusClaim: claim,
    verification: { inventory: { claims: [{ ...claim, heartbeatCounter: 2 }] } }, authority }),
  /status and verified cloud transition disagree/u);
});

test("protected controller capture requires clean integrated main and exact implementation bytes", () => {
  for (const objectFormat of ["sha1", "sha256"]) {
    const fixture = controllerFixture({ objectFormat });
    const frame = capturePlannedCleanFenceProtectedController(fixture.options);
    assert.equal(frame.branch, "main");
    assert.equal(frame.headSha, BASE);
    assert.match(frame.implementationDigest, /^[0-9a-f]{64}$/u);
  }
  assert.throws(() => capturePlannedCleanFenceProtectedController(
    controllerFixture({ status: "?? scripts/new.mjs" }).options),
  /clean integrated protected controller main/u);
  assert.throws(() => capturePlannedCleanFenceProtectedController(
    controllerFixture({ branch: "hotfix/uncommitted" }).options),
  /clean integrated protected controller main/u);
  assert.throws(() => capturePlannedCleanFenceProtectedController(
    controllerFixture({ remoteMainSha: "d".repeat(40) }).options),
  /clean integrated protected controller main/u);
  assert.throws(() => capturePlannedCleanFenceProtectedController(
    controllerFixture({ badImplementationOid: true }).options),
  /not byte-exact at protected main/u);
  assert.throws(() => capturePlannedCleanFenceProtectedController(
    controllerFixture({ postRemoteDrift: true }).options),
  /changed during exact implementation capture/u);
});

test("no-lock lane inspection preserves stale-stat candidate and peer index bytes", () => {
  const sandbox = realpathSync(mkdtempSync(
    path.join(os.tmpdir(), "planned-clean-index-frame-")));
  const canonical = path.join(sandbox, "main");
  const candidate = path.join(sandbox, "peer");
  mkdirSync(canonical);
  runGit(canonical, ["init", "-b", "main"]);
  runGit(canonical, ["config", "user.name", "Admission Test"]);
  runGit(canonical, ["config", "user.email", "admission@example.invalid"]);
  writeFileSync(path.join(canonical, "tracked.txt"), "stable bytes\n");
  runGit(canonical, ["add", "tracked.txt"]);
  runGit(canonical, ["commit", "-m", "initial"]);
  runGit(canonical, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  runGit(canonical, ["worktree", "add", "-b", "peer", candidate]);
  const git = defaultGit(process.env);
  const future = new Date(Date.now() + 10_000);
  utimesSync(path.join(canonical, "tracked.txt"), future, future);
  utimesSync(path.join(candidate, "tracked.txt"), future, future);
  const frame = captureRegisteredRawIndexFrame({ canonicalRepository: canonical,
    repository: candidate, git });
  const before = {
    canonical: rawIndexSha256(canonical, git),
    candidate: rawIndexSha256(candidate, git),
  };
  collectScopedLaneState({ repository: canonical, git });
  collectScopedLaneState({ repository: canonical, git });
  const afterFrame = captureRegisteredRawIndexFrame({ canonicalRepository: canonical,
    repository: candidate, git });
  const after = {
    canonical: rawIndexSha256(canonical, git),
    candidate: rawIndexSha256(candidate, git),
  };
  assert.deepEqual(afterFrame, frame);
  assert.deepEqual(after, before);
  assert.equal(frame.laneCount, 2);
  assert.equal(frame.candidateIndexSha256, before.candidate);
});

test("plan rejects root-bootstrap, preview, and source-lease drift", () => {
  const root = evidence();
  root.rootSourceBootstrapAuthorizationDigest = D("other root authorization");
  assert.throws(() => buildPlannedCleanFenceAdmissionFinalizationPlan(root),
    /root-source bootstrap authorization join/u);
  const preview = evidence();
  preview.preview.peerLaneStateDigest = "bad";
  assert.throws(() => buildPlannedCleanFenceAdmissionFinalizationPlan(preview),
    /preview peerLaneStateDigest/u);
  const lease = evidence();
  lease.sourceLeaseDigest = D("other lease");
  assert.throws(() => buildPlannedCleanFenceAdmissionFinalizationPlan(lease),
    /source lease digest join/u);
});

test("terminal result proves the closed mutation boundary", () => {
  const plan = buildPlannedCleanFenceAdmissionFinalizationPlan(evidence());
  const authorization = requirePlannedCleanFenceAdmissionFinalizationAuthorization(
    plan, `authorize ${OPERATION} ${plan.planDigest}`);
  const result = buildPlannedCleanFenceAdmissionFinalizationResult({
    plan,
    authorization,
    taskAuthorityReceiptDigest: D("task"),
    leaseDigest: D("lease"),
    markerDigest: D("marker"),
    bodyDigest: D("body"),
    admissionReportDigest: D("report"),
    preservationReceiptDigest: D("preservation"),
    mutationAuthorityReceiptDigest: D("mutation"),
    registryRevision: 43,
    disposition: "projected",
  });
  assert.equal(result.status, "admitted");
  assert.equal(result.sourceCommitChanged, false);
  assert.equal(result.sourceTreeChanged, false);
  assert.equal(result.sourceIndexChanged, false);
  assert.equal(result.cloudChanged, false);
  assert.equal(result.pullRequestStateChanged, false);
});

test("adapter executes one lease CAS, one exact marker projection, and adopts replay", () => {
  const plan = buildPlannedCleanFenceAdmissionFinalizationPlan(evidence());
  const authorization = requirePlannedCleanFenceAdmissionFinalizationAuthorization(
    plan, `authorize ${OPERATION} ${plan.planDigest}`);
  const fixture = executionFixture({ plan, authorization });
  const first = fixture.execute();
  assert.equal(first.disposition, "projected");
  assert.equal(first.registryRevision, plan.evidence.sourceRegistry.revision + 1);
  assert.equal(fixture.registry().revision, plan.evidence.sourceRegistry.revision + 1);
  assert.equal(fixture.registry().leases[plan.evidence.sourceLease.branch].admission.status,
    "admitted");
  assert.deepEqual(fixture.calls, { authorize: 1, cas: 1, marker: 1, cloud: 0,
    controller: 1, indexes: 2, terminal: 1 });
  const replay = fixture.execute();
  assert.equal(replay.disposition, "adopted");
  assert.equal(fixture.registry().revision, plan.evidence.sourceRegistry.revision + 1);
  assert.deepEqual(fixture.calls, { authorize: 1, cas: 1, marker: 1, cloud: 0,
    controller: 2, indexes: 4, terminal: 2 });
});

test("adapter fails closed on CAS contention without a registry or marker projection", () => {
  const plan = buildPlannedCleanFenceAdmissionFinalizationPlan(evidence());
  const authorization = requirePlannedCleanFenceAdmissionFinalizationAuthorization(
    plan, `authorize ${OPERATION} ${plan.planDigest}`);
  const fixture = executionFixture({ plan, authorization, casFailure: "contention" });
  assert.throws(() => fixture.execute(), /simulated CAS contention/u);
  assert.equal(fixture.registry().revision, plan.evidence.sourceRegistry.revision);
  assert.equal(writerLeaseDigest(fixture.registry().leases[plan.evidence.sourceLease.branch]),
    plan.evidence.sourceLeaseDigest);
  assert.equal(fixture.body(), plan.evidence.review.body);
  assert.equal(fixture.calls.marker, 0);
  assert.equal(fixture.calls.cloud, 0);
});

test("adapter adopts a landed CAS after response loss without a second revision", () => {
  const plan = buildPlannedCleanFenceAdmissionFinalizationPlan(evidence());
  const authorization = requirePlannedCleanFenceAdmissionFinalizationAuthorization(
    plan, `authorize ${OPERATION} ${plan.planDigest}`);
  const fixture = executionFixture({ plan, authorization, casFailure: "response-loss" });
  assert.throws(() => fixture.execute(), /post-CAS response loss/u);
  assert.equal(fixture.registry().revision, plan.evidence.sourceRegistry.revision + 1);
  assert.equal(fixture.calls.cas, 1);
  assert.equal(fixture.calls.marker, 0);
  const replay = fixture.execute();
  assert.equal(replay.disposition, "adopted");
  assert.equal(fixture.registry().revision, plan.evidence.sourceRegistry.revision + 1);
  assert.equal(fixture.calls.cas, 1);
  assert.equal(fixture.calls.marker, 1);
});

test("adapter adopts marker response loss and rejects later review identity drift", () => {
  const plan = buildPlannedCleanFenceAdmissionFinalizationPlan(evidence());
  const authorization = requirePlannedCleanFenceAdmissionFinalizationAuthorization(
    plan, `authorize ${OPERATION} ${plan.planDigest}`);
  const landed = executionFixture({ plan, authorization, markerFailure: "response-loss" });
  assert.throws(() => landed.execute(), /marker response loss/u);
  assert.notEqual(landed.body(), plan.evidence.review.body);
  assert.equal(landed.execute().disposition, "adopted");
  assert.equal(landed.calls.cas, 1);
  assert.equal(landed.calls.marker, 1);

  const drifted = executionFixture({ plan, authorization, markerFailure: "before-apply" });
  assert.throws(() => drifted.execute(), /simulated marker failure/u);
  drifted.setMarkerFailure(null);
  drifted.setReview({ baseRefOid: "d".repeat(40) });
  assert.throws(() => drifted.execute(), /review identity drifted/u);
  assert.equal(drifted.calls.cas, 1);
  assert.equal(drifted.calls.marker, 1);
  assert.equal(drifted.body(), plan.evidence.review.body);

  const thirdBody = executionFixture({ plan, authorization,
    markerFailure: "before-apply" });
  assert.throws(() => thirdBody.execute(), /simulated marker failure/u);
  thirdBody.setMarkerFailure(null);
  thirdBody.setReview({ body: `${plan.evidence.review.body}\nforeign byte` });
  assert.throws(() => thirdBody.execute(), /exact source\/target states/u);
  assert.equal(thirdBody.calls.cas, 1);
  assert.equal(thirdBody.calls.marker, 1);
});

test("target body capacity is checked before task proof, CAS, or marker mutation", () => {
  const input = evidence();
  const markerBytes = Buffer.byteLength(input.review.body);
  const body = `${"x".repeat(65_536 - markerBytes)}${input.review.body}`;
  input.review = { ...input.review, body, bodyDigest: digestValue(body) };
  const plan = buildPlannedCleanFenceAdmissionFinalizationPlan(input);
  const authorization = requirePlannedCleanFenceAdmissionFinalizationAuthorization(
    plan, `authorize ${OPERATION} ${plan.planDigest}`);
  const fixture = executionFixture({ plan, authorization });
  assert.equal(Buffer.byteLength(plan.evidence.review.body), 65_536);
  assert.throws(() => fixture.execute(), /bounded exact target pull-request marker body/u);
  assert.equal(fixture.registry().revision, plan.evidence.sourceRegistry.revision);
  assert.deepEqual({ authorize: fixture.calls.authorize, cas: fixture.calls.cas,
    marker: fixture.calls.marker }, { authorize: 0, cas: 0, marker: 0 });
  assert.equal(fixture.body(), plan.evidence.review.body);
});

test("adapter rejects third registry states and detects raw-index drift", () => {
  const plan = buildPlannedCleanFenceAdmissionFinalizationPlan(evidence());
  const authorization = requirePlannedCleanFenceAdmissionFinalizationAuthorization(
    plan, `authorize ${OPERATION} ${plan.planDigest}`);
  const third = executionFixture({ plan, authorization, thirdState: true });
  assert.throws(() => third.execute(), /not an exact replay target/u);
  assert.deepEqual({ authorize: third.calls.authorize, cas: third.calls.cas,
    marker: third.calls.marker }, { authorize: 0, cas: 0, marker: 0 });
  const drifted = executionFixture({ plan, authorization });
  drifted.setIndexDriftAtCall(2);
  assert.throws(() => drifted.execute(), /candidate or peer raw index bytes/u);
  assert.equal(drifted.calls.cloud, 0);
});

test("adopted replay joins and fences the live target lease under registry lock", () => {
  const plan = buildPlannedCleanFenceAdmissionFinalizationPlan(evidence());
  const authorization = requirePlannedCleanFenceAdmissionFinalizationAuthorization(
    plan, `authorize ${OPERATION} ${plan.planDigest}`);
  const staleRead = executionFixture({ plan, authorization });
  staleRead.execute();
  staleRead.setDriftAfterNextLeaseRead();
  assert.throws(() => staleRead.execute(), /target registry receipt is invalid/u);
  assert.equal(staleRead.calls.cas, 1);
  assert.equal(staleRead.calls.marker, 1);

  const adoptedFence = executionFixture({ plan, authorization });
  adoptedFence.execute();
  adoptedFence.setRegistryDriftAtLockCall(adoptedFence.registryLockCalls() + 2);
  assert.throws(() => adoptedFence.execute(), /Writer lease changed before/u);
  assert.equal(adoptedFence.calls.cas, 1);
  assert.equal(adoptedFence.calls.marker, 1);
  assert.equal(adoptedFence.calls.cloud, 0);
});

test("repository adapter has status-only cloud transport and one deterministic PR edit", () => {
  const source = readFileSync(new URL(
    "../scripts/planned-clean-fence-one-ahead-admission-finalization-repository-adapter.mjs",
    import.meta.url,
  ), "utf8");
  const evidenceSource = readFileSync(new URL(
    "../scripts/planned-clean-fence-one-ahead-admission-finalization-evidence.mjs",
    import.meta.url,
  ), "utf8");
  const portsSource = readFileSync(new URL(
    "../scripts/planned-clean-fence-one-ahead-admission-finalization-ports.mjs",
    import.meta.url,
  ), "utf8");
  assert.match(source, /action:\s*"status"/u);
  assert.doesNotMatch(source, /action:\s*"(?:claim|continue|integrate|retire)"/u);
  assert.equal((source.match(/\["pr",\s*"edit"/gu) || []).length, 1);
  assert.match(portsSource, /GIT_OPTIONAL_LOCKS:\s*"0"/u);
  assert.match(source, /captureRegisteredRawIndexFrame/u);
  assert.match(evidenceSource, /activeOwnedDirtRecoveryIntents/u);
  assert.match(source, /FINALIZATION_RECEIPTS_FIELD/u);
});

test("protected-main descendant evidence reconstructs only the clean registered fence", () => {
  const canonical = "/workspace/agentic-canvas-os";
  const candidate = "/workspace/.worktrees/agentic-canvas-os/repair";
  const main = "d".repeat(40);
  const tree = "c".repeat(40);
  const lease = { baseSha: BASE, fenceSha: FENCE, scope: "repair", epoch: 7 };
  const calls = [];
  const values = new Map([
    [`${canonical}\0worktree list --porcelain -z`, [
      `worktree ${canonical}`, `HEAD ${main}`, "branch refs/heads/main", "",
      `worktree ${candidate}`, `HEAD ${FENCE}`, "branch refs/heads/agent/device/repair", "",
    ].join("\0")],
    [`${canonical}\0rev-parse --git-common-dir`, `${canonical}/.git`],
    [`${candidate}\0rev-parse HEAD`, FENCE],
    [`${candidate}\0rev-parse HEAD^{tree}`, tree],
    [`${canonical}\0rev-parse ${BASE}^{tree}`, tree],
    [`${candidate}\0show -s --format=%P HEAD`, BASE],
    [`${candidate}\0status --porcelain=v1 -z --untracked-files=all`, ""],
    [`${candidate}\0log -1 --format=%s`, "chore(coordination): claim repair lease 7"],
    [`${canonical}\0ls-remote --heads origin refs/heads/agent/device/repair`,
      `${FENCE}\trefs/heads/agent/device/repair`],
    [`${canonical}\0merge-base --is-ancestor ${BASE} HEAD`, ""],
    [`${canonical}\0rev-parse HEAD`, main],
  ]);
  const git = (cwd, args) => {
    const key = `${cwd}\0${args.join(" ")}`;
    calls.push(key);
    if (!values.has(key)) throw new Error(`Unexpected Git call: ${key}`);
    return values.get(key);
  };
  const result = recoverProtectedDescendantCandidateRegistration({
    canonicalRepository: canonical,
    repository: candidate,
    lease,
    branch: "agent/device/repair",
    git,
  });
  assert.equal(result.status, "created");
  assert.equal(result.baseSha, BASE);
  assert.equal(result.baseTreeSha, tree);
  assert.equal(result.targetPath, candidate);
  assert.deepEqual(result.mutationSet, ["candidate-registration"]);
  assert.match(result.resultDigest, /^[0-9a-f]{64}$/u);
  assert.ok(calls.includes(`${canonical}\0merge-base --is-ancestor ${BASE} HEAD`));
  const dirtyValues = new Map(values);
  dirtyValues.set(`${candidate}\0status --porcelain=v1 -z --untracked-files=all`, " M file");
  assert.throws(() => recoverProtectedDescendantCandidateRegistration({
    canonicalRepository: canonical, repository: candidate, lease,
    branch: "agent/device/repair",
    git: (cwd, args) => dirtyValues.get(`${cwd}\0${args.join(" ")}`),
  }), /exact clean fence registration/u);
});

function controllerFixture({ objectFormat = "sha1", status = "", branch = "main",
  remoteMainSha = BASE, badImplementationOid = false, postRemoteDrift = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "planned-clean-controller-"));
  const relativePath = "impl.mjs";
  const bytes = Buffer.from("export const integrated = true;\n");
  writeFileSync(path.join(root, relativePath), bytes);
  const treeSha = "c".repeat(40);
  const expectedOid = badImplementationOid
    ? (objectFormat === "sha1" ? "e".repeat(40) : "e".repeat(64))
    : gitBlobOid(bytes, objectFormat);
  let remoteReads = 0;
  const git = (_cwd, args) => {
    const command = args.join(" ");
    if (command === "branch --show-current") return branch;
    if (command === "status --porcelain=v1 --untracked-files=all") return status;
    if (["rev-parse HEAD", "rev-parse refs/heads/main",
      "rev-parse refs/remotes/origin/main"].includes(command)) return BASE;
    if (command === "rev-parse HEAD^{tree}") return treeSha;
    if (command === "rev-parse --show-object-format") return objectFormat;
    if (command === `rev-parse ${BASE}:${relativePath}`) return expectedOid;
    if (command === "ls-remote --heads origin refs/heads/main") {
      remoteReads += 1;
      const sha = postRemoteDrift && remoteReads > 1 ? "d".repeat(40) : remoteMainSha;
      return `${sha}\trefs/heads/main`;
    }
    throw new Error(`Unexpected controller Git call: ${command}`);
  };
  return { options: { canonicalRepository: root, git,
    implementationFiles: [relativePath] } };
}

function gitBlobOid(bytes, algorithm) {
  return createHash(algorithm).update(Buffer.from(`blob ${bytes.length}\0`))
    .update(bytes).digest("hex");
}

function runGit(cwd, args) {
  execFileSync("git", ["-C", cwd, ...args], {
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
}
