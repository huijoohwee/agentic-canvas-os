// Responsibility: prove exact-authority recovery orchestration, crash replay, and fail-closed drift handling.
import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  createExpiredActiveDirtyScopeExpansionRecoveryController,
} from "../scripts/expired-active-dirty-scope-expansion-recovery-controller.mjs";
import {
  buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence,
} from "../scripts/expired-active-dirty-scope-expansion-recovery-evidence.mjs";
import {
  pseudonymousIdentifier,
} from "../scripts/github-cloud-collaboration-mapping.mjs";
import { writerLeaseDigest } from "../scripts/writer-lease-registry-cas.mjs";

const PHASES = Object.freeze([
  "cloud-recovered",
  "local-rebound",
  "pr-projected",
  "complete",
]);
const EFFECTS = Object.freeze([
  ["cloud-recovered", "recoverCloud"],
  ["local-rebound", "persistLocalAuthority"],
  ["pr-projected", "persistPullRequestMarker"],
]);
const digest = label => digestValue({ label });
const sha = label => digest(label).slice(0, 40);

test("plan is read-only and returns one repository-derived exact token", async () => {
  const harness = createHarness();
  const result = await harness.controller.plan({ planDigest: null });

  assert.equal(result.status, "planned");
  assert.equal(result.planDigest, result.plan.planDigest);
  assert.equal(result.exactAuthorization,
    `authorize expired-active-dirty-scope-expansion-recovery ${result.planDigest}`);
  assert.deepEqual(harness.counts, {
    effects: 0, fences: 0, intentReads: 1, observations: 0,
    sourceReads: 1, writes: 0,
  });
});

test("run rejects missing digest and non-byte-exact authorization before intent or effect", async () => {
  const harness = createHarness();
  const planned = await harness.controller.plan();

  await assert.rejects(
    harness.controller.run({ authorization: planned.exactAuthorization }),
    /requires an exact plan digest/u,
  );
  assert.equal(harness.counts.fences, 0);
  for (const authorization of [
    `${planned.exactAuthorization}\n`,
    planned.exactAuthorization.toUpperCase(),
    ` ${planned.exactAuthorization}`,
  ]) {
    await assert.rejects(harness.controller.run({
      planDigest: planned.planDigest,
      authorization,
    }), /requires exact authorization/u);
  }
  assert.equal(harness.intent, null);
  assert.equal(harness.counts.writes, 0);
  assert.equal(harness.counts.effects, 0);
});

test("persists authorized intent before effects and advances exact phases in order", async () => {
  const harness = createHarness();
  const planned = await harness.controller.plan();
  const result = await runPlanned(harness, planned);

  assert.equal(result.status, "complete");
  assert.equal(result.planDigest, planned.planDigest);
  assert.equal(result.receipt.planDigest, planned.planDigest);
  assert.deepEqual(harness.persistedStatuses, ["authorized", ...PHASES]);
  assert.deepEqual(harness.effectNames, EFFECTS.map(([, method]) => method));
  for (const [phase, method] of EFFECTS) {
    const effectIndex = harness.events.indexOf(`effect:${method}`);
    assert.ok(effectIndex > harness.events.indexOf("persist:authorized"));
    assert.equal(harness.events[effectIndex - 1], `observe:${phase}`);
  }
});

test("reconciles every lost effect response and complete replay performs no live work", async (context) => {
  for (const [, method] of EFFECTS) {
    await context.test(method, async () => {
      const harness = createHarness({ failAfterEffect: method });
      const planned = await harness.controller.plan();
      const result = await runPlanned(harness, planned);
      assert.equal(result.status, "complete");
      assert.equal(harness.effectNames.filter(name => name === method).length, 1);

      const beforeReplay = { ...harness.counts };
      const replay = await runPlanned(harness, planned);
      assert.deepEqual(replay.receipt, result.receipt);
      assert.equal(harness.counts.effects, beforeReplay.effects);
      assert.equal(harness.counts.observations, beforeReplay.observations);
    });
  }
});

test("resumes after every lost journal response without repeating an effect", async (context) => {
  const cases = [
    ["authorized", null],
    ...EFFECTS,
    ["complete", "persistPullRequestMarker"],
  ];
  for (const [phase, method] of cases) {
    await context.test(phase, async () => {
      const harness = createHarness({ failAfterPersist: phase });
      const planned = await harness.controller.plan();
      await assert.rejects(runPlanned(harness, planned), /journal response lost/u);
      assert.equal(harness.intent.status, phase);
      const effectCount = method == null
        ? harness.counts.effects
        : harness.effectNames.filter(name => name === method).length;

      assert.equal((await runPlanned(harness, planned)).status, "complete");
      if (method == null) assert.equal(effectCount, 0);
      else assert.equal(harness.effectNames.filter(name => name === method).length, effectCount);
    });
  }
});

test("adopts an already-live exact phase and never invokes its effect", async () => {
  const harness = createHarness({ liveThrough: "cloud-recovered" });
  const planned = await harness.controller.plan();
  assert.equal((await runPlanned(harness, planned)).status, "complete");
  assert.equal(harness.effectNames.includes("recoverCloud"), false);
  assert.deepEqual(harness.persistedStatuses, ["authorized", ...PHASES]);
});

test("live drift before each effect fails before that effect", async (context) => {
  for (const [phase, method] of EFFECTS) {
    await context.test(phase, async () => {
      const harness = createHarness({ driftBeforeEffect: phase });
      const planned = await harness.controller.plan();
      await assert.rejects(runPlanned(harness, planned), /live recovery drift/u);
      assert.equal(harness.effectNames.includes(method), false);
    });
  }
});

test("same-phase live evidence drift after persistence blocks later effects", async () => {
  const harness = createHarness({ driftAfterPersist: "cloud-recovered" });
  const planned = await harness.controller.plan();
  await assert.rejects(runPlanned(harness, planned), /drifted after persistence/u);
  assert.equal(harness.intent.status, "cloud-recovered");
  assert.deepEqual(harness.effectNames, ["recoverCloud"]);
  assert.equal(harness.effectNames.includes("persistLocalAuthority"), false);
});

test("rejects an effect response that changes its exact operation key", async () => {
  const harness = createHarness({ wrongOperationKey: "recoverCloud" });
  const planned = await harness.controller.plan();
  await assert.rejects(runPlanned(harness, planned), /changed its operation key/u);
  assert.equal(harness.intent.status, "authorized");
  assert.deepEqual(harness.effectNames, ["recoverCloud"]);
});

test("rejects authorization and journal tampering without another effect", async () => {
  const authority = createHarness({ driftBeforeEffect: "cloud-recovered" });
  const planned = await authority.controller.plan();
  await assert.rejects(runPlanned(authority, planned), /live recovery drift/u);
  const altered = clone(authority.intent);
  altered.authorizationDigest = digest("foreign authorization");
  resealIntent(altered);
  authority.replaceIntent(altered);
  await assert.rejects(
    runPlanned(authority, planned),
    /authorization drifted|digest-invalid/u,
  );
  assert.equal(authority.counts.effects, 0);

  const journal = createHarness();
  const completePlan = await journal.controller.plan();
  await runPlanned(journal, completePlan);
  const effects = journal.counts.effects;
  const corrupted = clone(journal.intent);
  corrupted.intentDigest = digest("corrupted journal");
  journal.replaceIntent(corrupted);
  await assert.rejects(runPlanned(journal, completePlan), /digest-invalid/u);
  assert.equal(journal.counts.effects, effects);
});

function createHarness({
  driftAfterPersist = null,
  driftBeforeEffect = null,
  failAfterEffect = null,
  failAfterPersist = null,
  liveThrough = null,
  wrongOperationKey = null,
} = {}) {
  const sourceEvidence = sourceEvidenceFixture();
  let intent = null;
  let liveIndex = liveThrough == null ? -1 : PHASES.indexOf(liveThrough);
  let effectFailure = false;
  let journalFailure = false;
  let persistedDrift = false;
  const events = [];
  const effectNames = [];
  const persistedStatuses = [];
  const counts = {
    effects: 0, fences: 0, intentReads: 0, observations: 0,
    sourceReads: 0, writes: 0,
  };
  const adapter = {
    async withEntrypointFence(_subject, action) {
      counts.fences += 1;
      return action();
    },
    async readSourceEvidence() {
      counts.sourceReads += 1;
      return { sourceEvidence, ttlSeconds: 1_800 };
    },
    async readIntent() {
      counts.intentReads += 1;
      return intent;
    },
    async writeIntent({ expectedIntent, nextIntent }) {
      counts.writes += 1;
      assert.equal(expectedIntent?.intentDigest ?? null, intent?.intentDigest ?? null);
      intent = nextIntent;
      persistedStatuses.push(intent.status);
      events.push(`persist:${intent.status}`);
      if (intent.status === driftAfterPersist) persistedDrift = true;
      if (intent.status === failAfterPersist && !journalFailure) {
        journalFailure = true;
        throw new Error(`${intent.status} journal response lost`);
      }
      return intent;
    },
    async observeRecovery(context) {
      counts.observations += 1;
      events.push(`observe:${context.phase}`);
      if (context.phase === driftBeforeEffect
        && liveIndex < PHASES.indexOf(context.phase)) {
        throw new Error(`live recovery drift before ${context.phase}`);
      }
      if (liveIndex < PHASES.indexOf(context.phase)) return { state: "pending" };
      return observationFixture(
        context,
        persistedDrift && context.phase === driftAfterPersist ? "drifted" : "stable",
      );
    },
  };
  for (const [phase, method] of EFFECTS) {
    adapter[method] = async ({ operationKey }) => {
      counts.effects += 1;
      effectNames.push(method);
      events.push(`effect:${method}`);
      liveIndex = method === "persistPullRequestMarker"
        ? PHASES.indexOf("complete")
        : PHASES.indexOf(phase);
      if (method === failAfterEffect && !effectFailure) {
        effectFailure = true;
        throw new Error(`${method} response lost`);
      }
      return { operationKey: method === wrongOperationKey ? digest("wrong key") : operationKey };
    };
  }
  return {
    controller: createExpiredActiveDirtyScopeExpansionRecoveryController({ adapter }),
    counts,
    effectNames,
    events,
    persistedStatuses,
    get intent() { return intent; },
    replaceIntent(value) { intent = value; },
  };
}

function runPlanned(harness, planned) {
  return harness.controller.run({
    planDigest: planned.planDigest,
    authorization: planned.exactAuthorization,
  });
}

function observationFixture({ intent, operationKey, phase, plan }, salt) {
  const core = {
    schema: "agentic-expired-active-dirty-scope-expansion-recovery-phase-observation/v1",
    state: "complete",
    phase,
    planDigest: plan.planDigest,
    operationKey,
    sourceEvidenceDigest: plan.sourceEvidenceDigest,
    values: {
      operationKey,
      evidenceDigest: digest(`${phase} evidence ${salt}`),
      liveStateDigest: digest(`${phase} live ${salt}`),
      claimDigest: digest(`${phase} claim ${salt}`),
      leaseDigest: digest(`${phase} lease ${salt}`),
      pullRequestMarkerLeaseDigest: digest(`${phase} marker ${salt}`),
      mutationAuthorityProjectionDigest:
        phase === "complete" ? digest(`authority ${salt}`) : null,
    },
  };
  assert.equal(intent.planDigest, plan.planDigest);
  return { ...core, observationDigest: digestValue(core) };
}

function sourceEvidenceFixture() {
  const branch = "agent/device/source-scope";
  const headSha = sha("source head");
  const baseSha = sha("source base");
  const treeSha = sha("same tree");
  const writeSet = ["path:scripts/source.mjs", "semantic:source-scope"];
  const rawDevice = "device";
  const rawSession = "source-session";
  const claim = {
    claimId: digest("claim"), claimDigest: digest("claim fence"),
    state: "dormant-preserved", recordedState: "current",
    writeAuthority: false, scopeReserved: true, actorId: "github-user:42",
    deviceId: pseudonymousIdentifier("device", rawDevice),
    sessionId: pseudonymousIdentifier("session", rawSession),
    repositoryId: "github-repository:R_repo", workItemId: "work-item:source",
    canonicalBaseRevision: baseSha, laneRevision: headSha,
    declaredWriteScope: writeSet, writeSetDigest: digestValue(writeSet),
    leaseEpoch: 1, transitionCounter: 3, heartbeatCounter: 2,
    reviewRequestId: "github-pull-request:PR_source",
    expiresAt: "2026-08-09T00:00:00.000Z",
    transitionDigest: digest("claim transition"),
    operationReceiptDigest: digest("claim operation"), recovery: null,
  };
  const lease = {
    schema: "agentic-writer-lease/v2", status: "active", epoch: 225,
    sessionId: rawSession, device: rawDevice, scope: "source-scope",
    branch, worktreePath: "/workspace/source", baseSha, fenceSha: headSha,
    pullRequestUrl: "https://github.com/owner/repository/pull/358",
    heartbeatAt: "2026-08-08T23:30:00.000Z", expiresAt: claim.expiresAt,
    admission: {
      schema: "agentic-lane-admission-lease/v1", status: "admitted",
      declaredWriteSet: writeSet, writeSetDigest: digestValue(writeSet),
    },
    cloudAuthority: {
      schema: "agentic-lane-cloud-authority/v1", claimId: claim.claimId,
      claimDigest: claim.claimDigest, transitionCounter: claim.transitionCounter,
      ledgerRepository: "owner/repository",
      laneRevision: headSha, canonicalBaseSha: baseSha, deviceId: rawDevice,
      sessionId: rawSession, reviewRequestId: claim.reviewRequestId,
    },
  };
  const leaseDigest = writerLeaseDigest(lease);
  return buildExpiredActiveDirtyScopeExpansionRecoverySourceEvidence({
    controller: {
      path: "/workspace/controller", origin: "git@github.com:owner/repository.git",
      targetRepository: "owner/repository", headSha: sha("controller"),
      originMainSha: sha("controller"), remoteMainSha: sha("controller"),
      treeSha: sha("controller tree"), clean: true,
      implementationDigest: digest("implementation"),
    },
    lane: {
      path: lease.worktreePath, branch, headSha, treeSha, parentSha: baseSha,
      parentTreeSha: treeSha, parentCount: 1, remoteHeadSha: headSha,
      detached: false, dirty: true, invalid: false,
      indexDigest: digest("lane index"), workingTreeDigest: digest("lane worktree"),
      stateDigest: digest("lane state"),
    },
    lease, leaseDigest,
    cloud: {
      ledgerRepository: "owner/repository",
      ledgerRevision: sha("ledger"), ledgerDigest: digest("ledger"), sequence: 10,
      claim, peers: [], authenticatedActor: { actorId: claim.actorId, login: "owner" },
    },
    pullRequest: {
      number: 358, nodeId: "PR_source", url: lease.pullRequestUrl,
      state: "OPEN", isDraft: true, baseRepository: "owner/repository",
      baseRefName: "main", baseRefOid: sha("controller"), headRefName: branch,
      headRefOid: headSha, headRepository: "owner/repository",
      markerLeaseDigest: leaseDigest, bodyFrameDigest: digest("body frame"),
    },
    dirt: {
      statusDigest: digest("status"), indexDigest: digest("dirt index"),
      unstagedDiffDigest: digest("unstaged"), stagedDiffDigest: digest("staged"),
      worktreeObjectsDigest: digest("objects"), changedPaths: ["scripts/source.mjs"],
      untrackedPaths: [], ownedDirtDigest: digest("owned dirt"), pathCount: 1,
    },
    scopeExpansionIntent: null,
  });
}

function resealIntent(intent) {
  const { intentDigest: ignored, ...core } = intent;
  intent.intentDigest = digestValue(core);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
