// Responsibility: Verify the live device gate, durable journal CAS, and strict subprocess JSON boundary.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  authorizeDormantPreservationAdmission,
  buildDormantPreservationAdmissionPlan,
  createDormantPreservationAdmissionIntent,
} from "../scripts/dormant-preservation-decision-contract.mjs";
import {
  buildDormantPreservationAdmissionSourceEvidence,
  DORMANT_PRESERVATION_ADMISSION_SELECTION_SCHEMA,
} from "../scripts/dormant-preservation-decision-evidence.mjs";
import {
  assertDormantPreservationCandidatePullRequest, invokeDormantPreservationDevice,
} from "../scripts/dormant-preservation-decision-controller.mjs";
import {
  createDeviceDormantPreservationAdmissionGate,
  createDeviceDormantPreservationPlannedContinuationGate,
  createDormantPreservationAdmissionIntentStore,
  parseDormantPreservationDeviceResult, projectExistingPlannedTarget,
} from "../scripts/dormant-preservation-decision-repository-adapter.mjs";
import {
  markOperationDerivedCloudVerification,
  normalizeDeclaredWriteScopeManifest,
} from "../scripts/scoped-lane-admission-lib.mjs";
import { assertPlannedContinuationIdentity, continuePlannedAdmissionFromRepository } from "../scripts/scoped-lane-admission-continuation.mjs";
import {
  verifyCurrentCloudInventory, verifyDormantPreservation,
} from "../scripts/scoped-lane-authority-state.mjs";

const digest = label => digestValue({ label });
const sha = label => digest(label).slice(0, 40);
const DEVICE_SCRIPT = fileURLToPath(new URL("../scripts/device-branch.mjs", import.meta.url));

test("planner observes an exact existing planned target without provisioning it", () => {
  const targetPath = "/tmp/existing-planned-target";
  const branch = "agent/device/existing-planned";
  const lease = {
    status: "active", branch, sessionId: "session", epoch: 7,
    worktreePath: targetPath, baseSha: sha("base"), fenceSha: sha("fence"),
    admission: { status: "planned", planReceiptDigest: digest("admission plan") },
  };
  const candidateLane = {
    path: targetPath, branch: `refs/heads/${branch}`, dirty: false, invalid: false,
    leaseAmbiguous: false, head: sha("prepared head"), treeSha: sha("prepared tree"),
    stateDigest: digest("candidate state"),
    preparedIntegrationReceiptDigest: digest("prepared integration"),
  };

  const result = projectExistingPlannedTarget({
    candidateLane, canonicalSourceDisposition: "exact", lease,
    sessionId: "session", targetPath,
  });
  assert.match(result.targetObservationDigest, /^[0-9a-f]{64}$/u);
  assert.equal(result.canonicalSourceDisposition, "exact");
  assert.throws(() => projectExistingPlannedTarget({
    candidateLane: { ...candidateLane, dirty: true },
    canonicalSourceDisposition: "exact", lease, sessionId: "session", targetPath,
  }), /exact clean active planned candidate/u);
});

test("device gate accepts one exact materialized plan and rejects post-plan dormant drift", (context) => {
  const fixture = createGateFixture(context);
  const result = fixture.gate.verify({
    laneState: fixture.snapshot, targetPlan: fixture.target,
  });

  assert.equal(result.plan.planDigest, fixture.plan.planDigest);
  assert.deepEqual(result.plan.deviceStartArgv, fixture.plan.deviceStartArgv);
  assert.equal(result.decision.exactAuthorization, fixture.plan.exactAuthorization);
  assert.equal(fixture.gate.revalidate({ expectedDecision: result.decision }).decision.planDigest,
    fixture.plan.planDigest);

  fixture.snapshot.lanes[1] = {
    ...fixture.snapshot.lanes[1], stateDigest: digest("drifted dormant lane"),
  };
  assert.throws(
    () => fixture.gate.revalidate({ expectedDecision: result.decision }),
    /drift|exact-current|argv/iu,
  );
});

test("journal compare-and-swap persists exact intent and rejects stale writers", (context) => {
  const fixture = createGateFixture(context);
  const statePath = path.join(fixture.temporaryRoot, "journal", "intent.json");
  const store = createDormantPreservationAdmissionIntentStore({
    statePath, now: () => new Date("2026-08-10T01:00:00.000Z"),
  });
  const authorization = authorizeDormantPreservationAdmission(
    fixture.plan, fixture.plan.exactAuthorization,
  );
  const intent = createDormantPreservationAdmissionIntent(fixture.plan, authorization);

  assert.equal(store.readIntent(), null);
  assert.equal(store.writeIntent({ expectedIntent: null, nextIntent: intent }).intentDigest,
    intent.intentDigest);
  assert.equal(store.readIntent().intentDigest, intent.intentDigest);
  assert.throws(
    () => store.writeIntent({ expectedIntent: null, nextIntent: intent }),
    /changed before CAS/u,
  );
});

test("subprocess boundary accepts exactly one object and rejects logs or malformed JSON", () => {
  const value = { schema: "agentic-device-command-result/v1", ok: true };
  assert.deepEqual(parseDormantPreservationDeviceResult(JSON.stringify(value)), value);
  assert.throws(
    () => parseDormantPreservationDeviceResult(`${JSON.stringify(value)}\nlog`),
    /exactly one JSON object/u,
  );
  assert.throws(() => parseDormantPreservationDeviceResult("[]"), /invalid JSON/u);
});

test("candidate pull request must use the canonical repository and canonical URL", (context) => {
  const fixture = createGateFixture(context);
  const repository = fixture.plan.sourceEvidence.canonical.targetRepository;
  const lease = { branch: fixture.plan.sourceEvidence.candidate.branch,
    pullRequestUrl: `https://github.com/${repository}/pull/101` };
  const pullRequest = { number: 101, url: lease.pullRequestUrl, state: "OPEN", isDraft: true,
    headRefName: lease.branch, headRefOid: sha("candidate head"), baseRefName: "main",
    headRepository: { nameWithOwner: repository } };
  assert.equal(assertDormantPreservationCandidatePullRequest(
    fixture.plan, lease, pullRequest,
  ), pullRequest);
  assert.throws(() => assertDormantPreservationCandidatePullRequest(fixture.plan, lease,
    { ...pullRequest, headRepository: { nameWithOwner: "other/repository" } }), /same-repository/u);
  assert.throws(() => assertDormantPreservationCandidatePullRequest(fixture.plan,
    { ...lease, pullRequestUrl: "https://github.test/owner/repository/pull/101" },
    { ...pullRequest, url: "https://github.test/owner/repository/pull/101" }), /same-repository/u);
});

test("planned heartbeat binds the authorized journal and materializes every decision option", (context) => {
  const fixture = createGateFixture(context);
  const source = fixture.plan.sourceEvidence;
  const statePath = fixture.statePath;
  const store = createDormantPreservationAdmissionIntentStore({ statePath });
  const authorization = authorizeDormantPreservationAdmission(
    fixture.plan, fixture.plan.exactAuthorization,
  );
  store.writeIntent({ expectedIntent: null,
    nextIntent: createDormantPreservationAdmissionIntent(fixture.plan, authorization) });
  const continuationArguments = [
    `--operator-decision-digest=${fixture.plan.planDigest}`,
    `--dormant-preservation-evidence-digest=${fixture.plan.sourceEvidenceDigest}`,
    `--dormant-preservation-authorization=${fixture.plan.exactAuthorization}`,
    `--dormant-preservation-state=${statePath}`,
    `--dormant-preservation-selection=${source.candidate.selectionPath}`,
    `--write-scope-manifest=${source.candidate.manifestPath}`,
    `--workspace-guard-controller=${source.controller.path}`,
    `--dormant-preservation=${fixture.dormantPath}`,
  ];
  const gate = createDeviceDormantPreservationPlannedContinuationGate({
    argumentsList: continuationArguments, repository: source.candidate.targetPath,
    branch: source.candidate.branch, sessionId: source.candidate.sessionId,
    leaseStore: { verify() { throw new Error("not invoked before wrapped verification"); } },
    manifestSource: source.candidate.manifest, worktreePaths: [fixture.dormantPath],
  });
  assert.equal(gate.planDigest, fixture.plan.planDigest);
  assert.equal(typeof gate.verifyCloudAuthority, "function");
  const copiedStatePath = path.join(fixture.temporaryRoot, "copied.json");
  copyFileSync(statePath, copiedStatePath);
  assert.throws(() => createDeviceDormantPreservationPlannedContinuationGate({
    argumentsList: continuationArguments.map(value => value.startsWith("--dormant-preservation-state=")
      ? `--dormant-preservation-state=${copiedStatePath}` : value),
    repository: source.candidate.targetPath, branch: source.candidate.branch,
    sessionId: source.candidate.sessionId, leaseStore: {},
    manifestSource: source.candidate.manifest, worktreePaths: [fixture.dormantPath],
  }), /durable exact decision/iu);

  let invocation;
  const result = invokeDormantPreservationDevice({
    action: "heartbeat", plan: fixture.plan, operationKey: digest("operation"),
    targetPath: source.candidate.targetPath, sessionId: source.candidate.sessionId,
    scope: source.candidate.semanticScope, manifestPath: source.candidate.manifestPath,
    selectionPath: source.candidate.selectionPath, statePath,
    controllerRoot: source.controller.path,
    selection: { lanes: [{ worktreePath: fixture.dormantPath, pullRequest: null }] },
    spawn(executable, argv, options) {
      invocation = { executable, argv, options };
      return { status: 0, signal: null, error: null, stderr: "", stdout: JSON.stringify({
        schema: "agentic-device-command-result/v1", ok: true, action: "heartbeat",
        status: "active", worktreePath: source.candidate.targetPath,
        lease: { sessionId: source.candidate.sessionId, scope: source.candidate.semanticScope },
        pullRequest: { isDraft: true }, admission: { status: "admitted" },
        cloudAuthority: { claimId: source.candidate.candidateClaim.claimId },
        mutationAuthorityReceipt: { status: "ready" },
      }) };
    },
  });
  assert.equal(result.operationKey, digest("operation"));
  assert.equal(invocation.executable, process.execPath);
  assert.equal(invocation.options.cwd, source.candidate.targetPath);
  for (const argument of continuationArguments.slice(0, 7)) {
    assert.ok(invocation.argv.includes(argument), `missing ${argument}`);
  }
});

test("final planned verification rejects relevant cloud drift before continuation mutation", (context) => {
  const fixture = createGateFixture(context);
  const source = fixture.plan.sourceEvidence;
  const store = createDormantPreservationAdmissionIntentStore({ statePath: fixture.statePath });
  const authorization = authorizeDormantPreservationAdmission(
    fixture.plan, fixture.plan.exactAuthorization,
  );
  store.writeIntent({ expectedIntent: null,
    nextIntent: createDormantPreservationAdmissionIntent(fixture.plan, authorization) });
  const branch = source.candidate.branch;
  git(fixture.repository, ["worktree", "add", "-b", branch, source.candidate.targetPath, "HEAD"]);
  git(source.candidate.targetPath, ["commit", "--allow-empty", "-m", "fence"]);
  const candidateHead = git(source.candidate.targetPath, ["rev-parse", "HEAD"]).trim();
  const candidateLane = {
    path: source.candidate.targetPath, head: candidateHead,
    treeSha: source.canonical.treeSha, branch: `refs/heads/${branch}`,
    detached: false, dirty: false, invalid: false, leaseAmbiguous: false,
    stateDigest: digest("planned candidate lane"), lease: null,
  };
  const lanes = [...fixture.snapshot.lanes, candidateLane];
  const postLaneState = { ...fixture.snapshot, canonicalSourceDisposition: "exact", lanes,
    laneStateDigest: digestValue(lanes.map(lane => ({ path: path.resolve(lane.path),
      stateDigest: lane.stateDigest })).sort((left, right) => left.path.localeCompare(right.path))) };
  const lease = {
    schema: "agentic-writer-lease/v2", status: "active", epoch: 7,
    worktreePath: source.candidate.targetPath, branch, sessionId: source.candidate.sessionId,
    scope: source.candidate.semanticScope, baseSha: source.canonical.headSha,
    fenceSha: candidateHead, cloudAuthority: { ...fixture.authority,
      targetRepository: source.canonical.targetRepository },
    admission: { schema: "agentic-lane-admission-lease/v1", status: "planned",
      semanticScope: source.candidate.semanticScope,
      manifestDigest: source.candidate.manifest.manifestDigest,
      writeSetDigest: source.candidate.manifest.writeSetDigest,
      declaredWriteSet: source.candidate.manifest.declaredWriteSet },
  };
  candidateLane.lease = lease;
  let cloudVerifications = 0;
  let continuationMutations = 0;
  const leaseStore = { verify: () => lease,
    annotate() { continuationMutations += 1; throw new Error("unexpected continuation mutation"); } };
  const gate = createDeviceDormantPreservationPlannedContinuationGate({
    argumentsList: continuationArguments(fixture), repository: source.candidate.targetPath,
    branch, sessionId: source.candidate.sessionId,
    leaseStore, manifestSource: source.candidate.manifest,
    worktreePaths: [fixture.dormantPath], collectLaneState: () => postLaneState,
    verifyDormant: fixture.verifyDormant,
    verifyCloud: () => ({ authority: fixture.authority,
      verification: cloudVerifications++ === 0
        ? fixture.verification : fixture.driftedVerification }),
  });
  assert.throws(() => continuePlannedAdmissionFromRepository({
    repository: source.candidate.targetPath, branch,
    sessionId: source.candidate.sessionId, leaseStore,
    manifestSource: source.candidate.manifest,
    dormantWorktreePaths: [fixture.dormantPath], dormantPullRequests: [],
    operatorDecisionDigest: fixture.plan.planDigest,
    gitText: () => "", collectLaneState: () => postLaneState,
    verifyDormant: gate.verifyDormant, verifyCloudAuthority: gate.verifyCloudAuthority,
  }), /relevant cloud records changed/u);
  assert.equal(cloudVerifications, 2);
  assert.equal(continuationMutations, 0);
});

test("protected-descendant adapter preserves immutable planned identity", (context) => {
  const fixture = createGateFixture(context);
  const source = fixture.plan.sourceEvidence;
  const headSha = sha("planned candidate");
  const lease = {
    worktreePath: source.candidate.targetPath,
    branch: source.candidate.branch,
    sessionId: source.candidate.sessionId,
    scope: source.candidate.semanticScope,
    baseSha: source.canonical.headSha,
    fenceSha: headSha,
    admission: {
      status: "planned",
      manifestDigest: source.candidate.manifest.manifestDigest,
      writeSetDigest: source.candidate.manifest.writeSetDigest,
    },
    cloudAuthority: { claimId: source.candidate.candidateClaim.claimId },
  };
  const input = {
    plan: fixture.plan,
    controller: source.controller,
    candidateLease: lease,
    candidateLineage: {
      headSha,
      treeSha: source.canonical.treeSha,
      parentSha: source.canonical.headSha,
      parentCount: 1,
    },
    manifest: source.candidate.manifest,
    files: {
      selectionFileDigest: source.candidate.selectionFileDigest,
      manifestFileDigest: source.candidate.manifestFileDigest,
      cloudAuthorityFileDigest: source.candidate.cloudAuthorityFileDigest,
    },
  };
  assert.equal(assertPlannedContinuationIdentity(input), true);
  for (const drifted of [
    { ...input, controller: { ...input.controller, headSha: sha("controller drift") } },
    { ...input, candidateLineage: { ...input.candidateLineage,
      parentSha: sha("parent drift") } },
    { ...input, candidateLease: { ...lease,
      cloudAuthority: { claimId: digest("claim drift") } } },
  ]) {
    assert.throws(
      () => assertPlannedContinuationIdentity(drifted),
      /immutable planned identity/u,
    );
  }
});

function continuationArguments(fixture) {
  const source = fixture.plan.sourceEvidence;
  return [
    `--operator-decision-digest=${fixture.plan.planDigest}`,
    `--dormant-preservation-evidence-digest=${fixture.plan.sourceEvidenceDigest}`,
    `--dormant-preservation-authorization=${fixture.plan.exactAuthorization}`,
    `--dormant-preservation-state=${fixture.statePath}`,
    `--dormant-preservation-selection=${source.candidate.selectionPath}`,
    `--write-scope-manifest=${source.candidate.manifestPath}`,
    `--workspace-guard-controller=${source.controller.path}`,
    `--dormant-preservation=${fixture.dormantPath}`,
  ];
}

function createGateFixture(context) {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "acos-dormant-decision-"));
  context.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const origin = path.join(temporaryRoot, "origin.git");
  const repository = path.join(temporaryRoot, "repository");
  git(temporaryRoot, ["init", "--bare", "--initial-branch=main", origin]);
  git(temporaryRoot, ["init", "--initial-branch=main", repository]);
  git(repository, ["config", "user.email", "test@example.invalid"]);
  git(repository, ["config", "user.name", "Test"]);
  git(repository, ["config", "agentic.device", "device"]);
  mkdirSync(path.join(repository, "scripts"), { recursive: true });
  symlinkSync(DEVICE_SCRIPT, path.join(repository, "scripts", "device-branch.mjs"));
  git(repository, ["add", "scripts/device-branch.mjs"]);
  git(repository, ["commit", "-m", "initial"]);
  git(repository, ["remote", "add", "origin", origin]);
  git(repository, ["push", "-u", "origin", "main"]);
  const canonicalOrigin = "https://github.com/owner/repository.git";
  git(repository, ["remote", "set-url", "origin", canonicalOrigin]);
  git(repository, ["config", `url.file://${origin}.insteadOf`, canonicalOrigin]);

  const scope = "new-scope";
  const sessionId = "decision-session";
  const targetPath = path.join(temporaryRoot, "candidate");
  const dormantPath = path.join(temporaryRoot, "dormant");
  const manifestPath = path.join(temporaryRoot, "manifest.json");
  const authorityPath = path.join(temporaryRoot, "authority.json");
  const selectionPath = path.join(temporaryRoot, "selection.json");
  const statePath = path.join(temporaryRoot, "journal", "planned.json");
  const manifestSource = {
    schema: "agentic-declared-write-scope/v1", semanticScope: scope,
    paths: ["scripts/new-runtime.mjs"],
  };
  const manifest = normalizeDeclaredWriteScopeManifest(manifestSource, { expectedScope: scope });
  const selection = {
    schema: DORMANT_PRESERVATION_ADMISSION_SELECTION_SCHEMA,
    lanes: [{ worktreePath: dormantPath, pullRequest: null }],
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifestSource)}\n`);
  writeFileSync(selectionPath, `${JSON.stringify(selection)}\n`);

  const claimSource = cloudClaim(manifest, scope);
  const peerManifest = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1", semanticScope: "peer-scope",
    paths: ["scripts/peer-runtime.mjs"],
  }, { expectedScope: "peer-scope" });
  const peerClaimSource = cloudClaim(peerManifest, "peer-scope", "peer claim");
  const verification = verifyCurrentCloudInventory({
    ledgerRepository: "owner/ledger", targetRepository: "owner/repository",
    inspect: () => ({
      schema: "agentic-cloud-collaboration-result/v1", ok: true,
      action: "status", status: "ready", ledgerRevision: sha("ledger revision"),
      ledgerDigest: digest("ledger digest"), claims: [claimSource, peerClaimSource],
    }),
  });
  const candidateClaim = verification.inventory.claims.find(
    claim => claim.claimId === claimSource.claimId,
  );
  const authority = { claimId: candidateClaim.claimId, sessionId };
  writeFileSync(authorityPath, `${JSON.stringify({ claim: authority })}\n`);
  const driftedVerification = verifyCurrentCloudInventory({
    ledgerRepository: "owner/ledger", targetRepository: "owner/repository",
    inspect: () => ({ schema: "agentic-cloud-collaboration-result/v1", ok: true,
      action: "status", status: "ready", ledgerRevision: sha("drifted ledger revision"),
      ledgerDigest: digest("drifted ledger digest"), claims: [
        { ...claimSource, leaseEpoch: claimSource.leaseEpoch + 1 }, peerClaimSource,
      ] }),
  });
  const continuationVerification = continuationCloudVerification(verification);
  const driftedContinuationVerification = continuationCloudVerification(driftedVerification);

  const headSha = git(repository, ["rev-parse", "HEAD"]).trim();
  const treeSha = git(repository, ["rev-parse", "HEAD^{tree}"]).trim();
  const canonicalLane = {
    path: repository, head: headSha, treeSha, branch: "refs/heads/main",
    detached: false, dirty: false, invalid: false, leaseAmbiguous: false,
    stateDigest: digest("canonical lane state"), lease: null,
  };
  const dormantLane = {
    path: dormantPath, head: sha("dormant head"), treeSha: sha("dormant tree"),
    branch: "refs/heads/agent/old-device/old-scope", detached: false,
    dirty: true, invalid: false, leaseAmbiguous: false,
    indexDigest: digest("dormant index"), workingTreeDigest: digest("dormant worktree"),
    stateDigest: digest("dormant lane state"), lease: null,
  };
  const laneStates = [canonicalLane, dormantLane].map(lane => ({
    path: lane.path, stateDigest: lane.stateDigest,
  })).sort((left, right) => left.path.localeCompare(right.path));
  const snapshot = {
    canonicalBaseSha: headSha, registryDigest: digest("registry"),
    laneStateDigest: digestValue(laneStates), lanes: [canonicalLane, dormantLane],
  };
  const target = {
    targetObservationDigest: digest("target observation"),
    canonicalSourceDisposition: "exact",
  };
  const ghJson = argumentsList => argumentsList[0] === "api"
    ? { id: 42, login: "owner" }
    : { id: "R_repo", nameWithOwner: "owner/repository", owner: { login: "owner" } };
  const verifyDormant = input => verifyDormantPreservation({
    ...input, ghJson, verifiedAt: "2026-08-10T00:00:00.000Z",
  });
  const dormantReceipt = verifyDormant({
    repository, targetRepository: "owner/repository", lanes: snapshot.lanes,
    worktreePaths: [dormantPath], pullRequestReferences: [],
    operatorDecisionDigest: digest("planning probe"), sessionId,
    remoteAuthorityVerification: verification,
  });
  const sourceEvidence = buildDormantPreservationAdmissionSourceEvidence({
    controller: repositoryProjection(repository, headSha, treeSha),
    canonical: {
      repositoryPath: repository, canonicalPath: repository, origin: canonicalOrigin,
      targetRepository: "owner/repository", headSha, originMainSha: headSha,
      remoteMainSha: headSha, treeSha, clean: true, canonicalSourceDisposition: "exact",
      canonicalLaneStateDigest: canonicalLane.stateDigest,
      registryDigest: snapshot.registryDigest, laneSetDigest: snapshot.laneStateDigest,
      existingLanes: snapshot.lanes.map(lane => ({
        path: lane.path, stateDigest: lane.stateDigest,
      })),
    },
    candidate: {
      semanticScope: scope, deviceId: "device", branch: `agent/device/${scope}`,
      sessionId, targetPath, targetObservationDigest: target.targetObservationDigest,
      ttlSeconds: 1_800, selectionPath, selectionFileDigest: fileDigest(selectionPath),
      manifestPath, manifestFileDigest: fileDigest(manifestPath), manifest,
      cloudAuthorityPath: authorityPath, cloudAuthorityFileDigest: fileDigest(authorityPath),
      cloudAuthority: authority, candidateClaim,
      candidateClaimRecordDigest: candidateClaim.recordDigest,
    },
    remoteInventory: verification, dormantReceipt, selection,
  });
  const baseArguments = [
    `--session=${sessionId}`, `--repository=${repository}`, "--provision",
    `--worktree=${targetPath}`, `--write-scope-manifest=${manifestPath}`,
    `--cloud-authority=${authorityPath}`,
    `--dormant-preservation-selection=${selectionPath}`,
    `--dormant-preservation-state=${statePath}`, "--ttl-seconds=1800",
    `--dormant-preservation=${dormantPath}`, "--json",
    `--dormant-preservation-evidence-digest=${sourceEvidence.sourceEvidenceDigest}`,
  ];
  const plan = buildDormantPreservationAdmissionPlan({
    sourceEvidence,
    nestedDeviceStart: {
      schema: "agentic-dormant-preservation-device-start-invocation/v1",
      executable: process.execPath, cwd: repository,
      argvTemplate: [path.join(repository, "scripts/device-branch.mjs"), "start", scope, ...baseArguments,
        "--operator-decision-digest={planDigest}",
        "--dormant-preservation-authorization={authorization}"],
      derivedBindings: {
        operatorDecisionDigest: "planDigest", authorization: "exactAuthorization",
      },
    },
  });
  const argumentsList = [scope, ...baseArguments,
    `--operator-decision-digest=${plan.planDigest}`,
    `--dormant-preservation-authorization=${plan.exactAuthorization}`];
  const gate = createDeviceDormantPreservationAdmissionGate({
    argumentsList, controllerRoot: repository, repository,
    targetRepository: "owner/repository", targetPath, manifest, authority, sessionId,
    worktreePaths: [dormantPath], pullRequestReferences: [],
    gitText: argumentsValue => git(repository, argumentsValue),
    collectLaneState: () => snapshot, inspectTarget: () => target,
    verifyCloud: () => ({ authority, verification: continuationVerification }), verifyDormant,
  });
  return { authority, dormantPath, driftedVerification: driftedContinuationVerification,
    gate, plan, repository, snapshot,
    statePath, target, temporaryRoot, verification: continuationVerification, verifyDormant };
}

function continuationCloudVerification(source) {
  const inventoryCore = {
    schema: "agentic-cloud-claim-inventory/v1",
    observedLedgerHeadRevision: source.ledgerRevision,
    ledgerDigest: source.ledgerDigest,
    evaluationTime: "2026-08-10T00:00:00.000Z",
    claims: source.inventory.claims,
  };
  const inventory = { ...inventoryCore, inventoryDigest: digestValue(inventoryCore) };
  return markOperationDerivedCloudVerification(Object.freeze({
    schema: "agentic-lane-cloud-verification/v1", status: "ready",
    ledgerRevision: source.ledgerRevision, ledgerDigest: source.ledgerDigest,
    verifiedAt: inventory.evaluationTime, inventory,
    remoteClaimInventoryDigest: inventory.inventoryDigest,
    receiptDigest: digest("continuation verification receipt"),
  }));
}

function repositoryProjection(repository, headSha, treeSha) {
  return {
    path: repository, origin: git(repository, ["config", "--get-all", "remote.origin.url"]).trim(),
    headSha, originMainSha: headSha, remoteMainSha: headSha, treeSha, clean: true,
    deviceBranchScriptDigest: fileDigest(path.join(repository, "scripts/device-branch.mjs")),
  };
}

function cloudClaim(manifest, scope, label = "candidate claim") {
  return {
    claimId: digest(label), state: "current", actorId: "github-user:42",
    repositoryId: "github-repository:R_repo", workItemId: `candidate:${scope}`,
    canonicalBaseRevision: sha("base"), laneRevision: sha("base"),
    declaredWriteScope: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest, leaseEpoch: 1, transitionCounter: 1,
    heartbeatCounter: 0, reviewRequestId: null, expiresAt: "2099-08-10T00:00:00.000Z",
    fenceRevision: digest("claim fence"), transitionDigest: digest("claim transition"),
  };
}

function git(cwd, argumentsList) {
  return execFileSync("git", argumentsList, { cwd, encoding: "utf8" });
}
function fileDigest(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}
