import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  createActiveDirtyScopeExpansionSuccessorRolloverController,
  createSuccessorRolloverJournalStore,
} from "../scripts/active-dirty-scope-expansion-successor-rollover-controller.mjs";
import { main as runSuccessorRolloverCli }
  from "../scripts/active-dirty-scope-expansion-successor-rollover.mjs";

const sha = character => character.repeat(40);
const digest = character => character.repeat(64);
const C1 = digest("1"), C2 = digest("2"), C3 = digest("3");
const SOURCE_FENCE = sha("a"), OLD_BASE = sha("b"), CURRENT_MAIN = sha("c");
const OPERATOR = "recovery-controller-session";
const SOURCE = ["path:a.mjs", "path:b.mjs", "semantic:commerce"];
const STALE = ["path:a.mjs", "path:b.mjs", "path:c.mjs",
  "path:device-branch-lib.mjs", "semantic:commerce"];
const CORRECTED = ["path:a.mjs", "path:b.mjs", "path:c.mjs", "semantic:commerce"];
function sourceClaimIdentity() { const core = { repositoryId: "github-repository:1",
  actorId: "github-user:1", deviceId: "device:pseudonymous", sessionId: "session:pseudonymous",
  workItemId: "work-item:pseudonymous" }; return { ...core, identityDigest: digestValue(core) }; }

function seal(core) { return { ...core, observationDigest: digestValue(core) }; }
function retirementObservation(overrides = {}) {
  const core = {
    schema: "agentic-active-dirty-scope-expansion-successor-rollover-retirement-observation/v2",
    sourceClaimIdentity: sourceClaimIdentity(), controllerDigest: digest("a"),
    protectedMainSha: CURRENT_MAIN, protectedMainTreeSha: sha("d"),
    protectedMainAdvanceDigest: digest("b"), protectedMainChangedPaths: ["device-branch-lib.mjs"],
    branch: "agent/device/commerce", sourceSessionId: "source-session", semanticScope: "commerce",
    sourceFenceSha: SOURCE_FENCE, sourceLeaseDigest: digest("c"), sourceClaimId: C1,
    sourceClaimDigest: digest("d"), sourceReviewRequestId: "github-pull-request:PR_808",
    sourceWriteSetDigest: digestValue(SOURCE), sourceManifestDigest: digest("e"),
    sourceDeclaredWriteSet: SOURCE, sourceDirtDigest: digest("f"), sourceChangedPaths: ["a.mjs"],
    sourceIntentDigest: digest("4"), sourceIntentPlanDigest: digest("5"),
    sourceIntentStatus: "source-retired", sourceRetirementReceiptDigest: digest("6"),
    staleSuccessorClaimId: C2, staleSuccessorClaimDigest: digest("7"),
    staleSuccessorTransitionDigest: digest("8"), staleSuccessorTransitionCounter: 1,
    staleSuccessorState: "waiting-successor", staleSuccessorPredecessorClaimId: C1,
    staleTargetCanonicalBaseSha: OLD_BASE, staleTargetWriteSetDigest: digestValue(STALE),
    staleTargetManifestDigest: digest("9"), staleTargetDeclaredWriteSet: STALE,
    staleExpiresAt: "2099-08-30T00:00:00.000Z", pullRequestNumber: 808,
    pullRequestNodeId: "PR_808", pullRequestMarkerDigest: digest("a"),
    pullRequestBodyDigest: digest("b"), ...overrides,
  };
  return seal(core);
}
function targetManifest() { return { schema: "agentic-declared-write-scope/v1",
  semanticScope: "commerce", declaredWriteSet: CORRECTED,
  writeSetDigest: digestValue(CORRECTED), manifestDigest: digest("3") }; }

function createHarness({ crashPhase = null } = {}) {
  let journal = null, crashUsed = false, completedChecks = 0, ledgerVersion = 1,
    retirementLedgerValidations = 0;
  const live = new Map(), calls = [], counts = { fences: 0, writes: 0, authorizations: 0 };
  const retirement = plan => ({
    schema: "agentic-active-dirty-scope-expansion-successor-rollover-retirement/v1",
    staleSuccessorClaimId: C2, priorClaimDigest: plan.observation.staleSuccessorClaimDigest,
    retiredClaimDigest: digest("d"), retirementTransitionDigest: digest("e"),
    transitionCounter: 2, state: "retired", reason: "successor-rollover",
    receiptDigest: digest("f"),
  });
  const claim = plan => ({ claimId: C3, claimDigest: digest("4"), ledgerRevision: sha("3"),
    claimLedgerRevision: digest("5"), transitionCounter: 1, state: "current",
    predecessorClaimId: null, canonicalBaseSha: CURRENT_MAIN, laneRevision: SOURCE_FENCE,
    writeSetDigest: plan.target.writeSetDigest, leaseEpoch: 1,
    expiresAt: "2099-08-30T01:00:00.000Z" });
  const effects = {
    "stale-successor-retired": ({ plan }) => retirement(plan),
    "replacement-claimed": ({ plan }) => ({ claim: claim(plan), receiptDigest: digest("6") }),
    "replacement-promoted": ({ plan }) => ({ claim: claim(plan), promoted: false,
      receiptDigest: digest("7") }),
    "replacement-bound": ({ plan }) => ({ authority: { claimId: C3,
      claimDigest: digest("8"), claimLedgerRevision: digest("9"), transitionCounter: 2,
      canonicalBaseSha: CURRENT_MAIN, laneRevision: SOURCE_FENCE,
      writeSetDigest: plan.target.writeSetDigest, manifestDigest: plan.target.manifestDigest,
      leaseEpoch: 1, reviewRequestId: plan.sourceReviewRequestId,
      expiresAt: "2099-08-30T02:00:00.000Z", authorityDigest: digest("a") },
    receiptDigest: digest("b") }),
    "local-cas": ({ plan }) => ({ leaseDigest: digest("7"),
      sourceIntentDigest: plan.observation.sourceIntentDigest,
      replacementIntentDigest: digest("d"), taskAuthorityBindingDigest: digest("e"),
      receiptDigest: digest("f") }),
    "pr-marker": () => ({ markerDigest: digest("0"), bodyDigest: digest("1"),
      receiptDigest: digest("2") }),
    verified: ({ plan }) => { const core = { leaseDigest: digest("7"),
      replacementIntentDigest: digest("d"), cloudAuthorityDigest: digest("a"),
      taskAuthorityBindingDigest: digest("e"), markerDigest: digest("0"),
      bodyDigest: digest("1"), dirtDigest: plan.observation.sourceDirtDigest };
    return { ...core, verificationDigest: digestValue(core) }; },
  };
  async function effect(input) {
    calls.push(input.phase); const values = effects[input.phase](input); live.set(input.phase, values);
    if (crashPhase === input.phase && !crashUsed) { crashUsed = true; throw new Error("lost response"); }
    return values;
  }
  const adapter = {
    withEntrypointFence: async (_input, action) => { counts.fences += 1; return action(); },
    readRecoveryJournal: async () => journal,
    writeRecoveryJournal: async ({ expectedJournal, nextJournal }) => {
      assert.equal(journal?.journalDigest || null, expectedJournal?.journalDigest || null);
      journal = nextJournal; counts.writes += 1; return journal;
    },
    readPhaseAObservation: async () => retirementObservation(),
    authorizeEffect: async input => { counts.authorizations += 1; calls.push(`authorize:${input.phase}`); },
    reconcilePhase: async ({ phase }) => {
      if (phase === "stale-successor-retired") {
        retirementLedgerValidations += 1; void ledgerVersion;
      }
      return live.get(phase) || null;
    },
    retireStaleSuccessor: effect,
    readPhaseBState: async () => {
      const source = retirementObservation(), retired = live.get("stale-successor-retired");
      return seal({ schema: "agentic-active-dirty-scope-expansion-successor-rollover-replacement-observation/v2",
        sourceClaimIdentity: source.sourceClaimIdentity, controllerDigest: digest("1"), protectedMainSha: CURRENT_MAIN,
        protectedMainTreeSha: sha("1"), protectedMainAdvanceDigest: digest("1"),
        protectedMainChangedPaths: ["device-branch-lib.mjs"], branch: source.branch,
        sourceLeaseDigest: source.sourceLeaseDigest,
        sourceDirtDigest: source.sourceDirtDigest, sourceIntentDigest: source.sourceIntentDigest,
        pullRequestMarkerDigest: source.pullRequestMarkerDigest,
        pullRequestBodyDigest: source.pullRequestBodyDigest, staleSuccessorClaimId: C2,
        staleRetirementClaimDigest: retired.retiredClaimDigest,
        staleRetirementTransitionDigest: retired.retirementTransitionDigest,
        staleRetirementTransitionCounter: retired.transitionCounter,
        staleRetirementReceiptDigest: retired.receiptDigest });
    },
    claimReplacement: effect, promoteReplacement: effect, bindReplacement: effect,
    supersedeLocal: effect, projectPullRequest: effect, observePhaseBComplete: effect,
    verifyCompleted: async () => { completedChecks += 1; return live.get("verified"); },
  };
  return { adapter, controller: createActiveDirtyScopeExpansionSuccessorRolloverController(adapter),
    calls, counts, advanceLedger() { ledgerVersion += 1; }, get journal() { return journal; },
    get retirementLedgerValidations() { return retirementLedgerValidations; },
    get completedChecks() { return completedChecks; } };
}

async function retire(harness) {
  const plan = await harness.controller.planRetirement({ operatorSessionId: OPERATOR });
  const result = await harness.controller.runRetirement({ plan, operatorSessionId: OPERATOR,
    authorization: plan.exactAuthorization });
  return { plan, result };
}

test("runs two independently authorized phases and verifies complete replay", async () => {
  const harness = createHarness();
  const { plan: retirementPlan, result: retired } = await retire(harness);
  assert.equal(retired.status, "stale-successor-retired");
  assert.equal(harness.journal.retirement.planDigest, retirementPlan.planDigest);
  const replacementPlan = await harness.controller.planReplacement({
    operatorSessionId: OPERATOR, targetManifest: targetManifest(),
  });
  assert.notEqual(replacementPlan.exactAuthorization, retirementPlan.exactAuthorization);
  const complete = await harness.controller.runReplacement({ plan: replacementPlan,
    operatorSessionId: OPERATOR, authorization: replacementPlan.exactAuthorization });
  assert.equal(complete.status, "complete");
  assert.equal(complete.receipt.status, "successor-replaced");
  assert.equal(complete.receipt.replacementClaimId, C3);
  assert.equal(harness.counts.authorizations, 6);
  const writes = harness.counts.writes;
  const replay = await harness.controller.runReplacement({ plan: replacementPlan,
    operatorSessionId: OPERATOR, authorization: replacementPlan.exactAuthorization });
  assert.equal(replay.receipt.receiptDigest, complete.receipt.receiptDigest);
  assert.equal(harness.counts.writes, writes);
  assert.equal(harness.completedChecks, 1);
  assert.equal((await harness.controller.inspect()).status, "complete");
});

test("rejects wrong authorization and drift before fences or journal writes", async () => {
  const harness = createHarness();
  const plan = await harness.controller.planRetirement({ operatorSessionId: OPERATOR });
  await assert.rejects(harness.controller.runRetirement({ plan, operatorSessionId: OPERATOR,
    authorization: `${plan.exactAuthorization} ` }), /exact authorization/u);
  assert.deepEqual(harness.counts, { fences: 0, writes: 0, authorizations: 0 });
  const drifted = structuredClone(plan); drifted.observation.protectedMainTreeSha = sha("f");
  await assert.rejects(harness.controller.runRetirement({ plan: drifted,
    operatorSessionId: OPERATOR, authorization: plan.exactAuthorization }), /projection|semantics/u);
  assert.equal(harness.counts.writes, 0);
});

test("rejects an authorized v1 retirement plan before fencing or effects", async () => {
  const harness = createHarness();
  const plan = await harness.controller.planRetirement({ operatorSessionId: OPERATOR });
  const legacy = { ...plan,
    schema: "agentic-active-dirty-scope-expansion-successor-rollover-retire-plan/v1" };
  await assert.rejects(harness.controller.runRetirement({ plan: legacy,
    operatorSessionId: OPERATOR, authorization: legacy.exactAuthorization }), /plan schema/u);
  assert.deepEqual(harness.counts, { fences: 0, writes: 0, authorizations: 0 });
  assert.deepEqual(harness.calls, []);
});

test("Phase-A replay ignores ambient ledger-head advance after fresh ledger validation", async () => {
  const harness = createHarness();
  const { plan, result } = await retire(harness);
  const writes = harness.counts.writes, validations = harness.retirementLedgerValidations;
  harness.advanceLedger();
  const replay = await harness.controller.runRetirement({ plan, operatorSessionId: OPERATOR,
    authorization: plan.exactAuthorization });
  assert.equal(replay.retirementReceiptDigest, result.retirementReceiptDigest);
  assert.equal(harness.counts.writes, writes);
  assert.equal(harness.calls.filter(value => value === "stale-successor-retired").length, 1);
  assert.equal(harness.retirementLedgerValidations, validations + 1);
});

for (const phase of ["stale-successor-retired", "replacement-claimed", "local-cas", "pr-marker"]) {
  test(`reconciles one ${phase} response loss without repeating its effect`, async () => {
    const harness = createHarness({ crashPhase: phase });
    if (phase === "stale-successor-retired") {
      await retire(harness);
    } else {
      await retire(harness);
      const plan = await harness.controller.planReplacement({
        operatorSessionId: OPERATOR, targetManifest: targetManifest(),
      });
      await harness.controller.runReplacement({ plan, operatorSessionId: OPERATOR,
        authorization: plan.exactAuthorization });
    }
    assert.equal(harness.calls.filter(item => item === phase).length, 1);
    assert.equal(harness.journal.replacement?.status || harness.journal.retirement.status,
      phase === "stale-successor-retired" ? "stale-successor-retired" : "complete");
  });
}

test("blocks replacement planning before terminal retirement", async () => {
  const harness = createHarness();
  await assert.rejects(harness.controller.planReplacement({ operatorSessionId: OPERATOR,
    targetManifest: targetManifest() }), /terminal.*retirement/u);
});

test("CLI forwards sealed plans and exact tokens and rejects irrelevant options", async () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "successor-rollover-cli-"));
  try {
    const repository = path.join(root, "repository"); fs.mkdirSync(repository);
    const state = path.join(root, "journal.json"), output = path.join(root, "plan.json");
    const plan = { planDigest: digest("a"), exactAuthorization: `authorize token ${digest("a")}` };
    const calls = [];
    const controller = { inspect: async () => ({}), planRetirement: async input => {
      calls.push(["plan", input]); return plan;
    }, runRetirement: async input => { calls.push(["run", input]); return { status: "done" }; } };
    const common = [`--repository=${repository}`, `--state-path=${state}`,
      "--source-session=source", "--pull-request=808"];
    const planned = await runSuccessorRolloverCli(["plan-retirement", ...common,
      `--operator-session=${OPERATOR}`, `--output=${output}`], {
      createAdapter: () => ({}), createController: () => controller,
    });
    assert.equal(planned.exactAuthorization, plan.exactAuthorization);
    assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), plan);
    const authority = path.join(root, "authority.json");
    fs.writeFileSync(authority, "{}\n", { mode: 0o600 });
    const ran = await runSuccessorRolloverCli(["run-retirement", ...common,
      `--operator-session=${OPERATOR}`, `--plan=${output}`,
      `--task-authority=${authority}`, `--authorization=${plan.exactAuthorization}`], {
      createAdapter: () => ({}), createController: () => controller,
    });
    assert.equal(ran.receipt.status, "done");
    assert.equal(calls[1][1].authorization, plan.exactAuthorization);
    await assert.rejects(runSuccessorRolloverCli(["inspect", "--authorization=nope"]),
      /does not accept --authorization/u);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("CLI seals and replays a separately authorized promoted-successor continuation", async () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "rollover-continuation-cli-"));
  try {
    const repository = path.join(root, "repository"); fs.mkdirSync(repository);
    const journalFile = path.join(root, "journal.json");
    const replacementFile = path.join(root, "replacement.json");
    const continuationFile = path.join(root, "continuation.json");
    const continuationState = path.join(root, "continuation-state.json");
    const authority = path.join(root, "authority.json");
    const manifest = path.join(root, "manifest.json");
    const oldPlan = { planDigest: digest("a"), exactAuthorization: `authorize replace ${digest("a")}` };
    const continuationPlan = { planDigest: digest("b"), exactAuthorization: `authorize continue ${digest("b")}`,
      replacementPlanSnapshot: oldPlan };
    const authorizationRecord = { planDigest: continuationPlan.planDigest,
      authorizationDigest: digest("c"), statement: continuationPlan.exactAuthorization };
    for (const [file, value] of [[replacementFile, oldPlan], [authority, {}]]) {
      fs.writeFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    }
    fs.writeFileSync(manifest, "{}\n");
    const journal = { status: "replacement-promoted" }, frame = { stable: true };
    const calls = { builds: 0, frames: 0, journals: 0, replays: 0, runs: [] };
    const adapter = {
      readRecoveryJournal: async () => { calls.journals += 1; return journal; },
      readContinuationFrame: async ({ plan }) => {
        calls.frames += 1; assert.deepEqual(plan, oldPlan); return frame;
      },
    };
    const controller = { runReplacement: async input => {
      calls.runs.push(input); return { status: "complete" };
    } };
    const dependencies = {
      createAdapter: options => {
        if (options.continuationPlan) assert.deepEqual(options.continuationPlan, continuationPlan);
        return adapter;
      },
      createController: () => controller,
      normalizeContinuationPlan: value => { assert.deepEqual(value, continuationPlan); return value; },
      buildContinuationPlan: input => {
        calls.builds += 1;
        assert.deepEqual(input.replacementPlan, oldPlan);
        assert.deepEqual(input.journal, journal);
        assert.deepEqual(input.frame, frame);
        assert.equal(input.operatorSessionId, OPERATOR);
        return continuationPlan;
      },
      authorizeContinuation: ({ plan, authorization }) => {
        assert.deepEqual(plan, continuationPlan);
        if (authorization !== continuationPlan.exactAuthorization) throw new Error("exact authorization");
        return authorizationRecord;
      },
      normalizeContinuationAuthorization: (value, { plan }) => {
        assert.deepEqual(value, authorizationRecord); assert.deepEqual(plan, continuationPlan);
        return value;
      },
      requireContinuationJournal: input => {
        calls.replays += 1; assert.deepEqual(input, { plan: continuationPlan, journal });
      },
    };
    const common = [`--repository=${repository}`, `--state-path=${journalFile}`,
      "--source-session=source", "--pull-request=808", `--operator-session=${OPERATOR}`,
      `--corrected-manifest=${manifest}`];
    const planned = await runSuccessorRolloverCli(["plan-continuation", ...common,
      `--replacement-plan=${replacementFile}`, `--output=${continuationFile}`], dependencies);
    assert.equal(planned.phase, "continuation");
    assert.deepEqual(JSON.parse(fs.readFileSync(continuationFile, "utf8")), continuationPlan);
    assert.equal(fs.statSync(continuationFile).mode & 0o777, 0o600);

    const runArguments = ["run-continuation", ...common, `--plan=${continuationFile}`,
      `--continuation-state=${continuationState}`, `--task-authority=${authority}`,
      `--authorization=${continuationPlan.exactAuthorization}`];
    const ran = await runSuccessorRolloverCli(runArguments, dependencies);
    assert.equal(ran.phase, "continuation");
    assert.deepEqual(JSON.parse(fs.readFileSync(continuationState, "utf8")), authorizationRecord);
    assert.equal(fs.statSync(continuationState).mode & 0o777, 0o600);
    assert.equal(calls.frames, 2);
    assert.deepEqual(calls.runs[0], { plan: oldPlan, operatorSessionId: OPERATOR,
      authorization: oldPlan.exactAuthorization });

    await runSuccessorRolloverCli(runArguments, dependencies);
    assert.equal(calls.frames, 2, "replay must not require the pre-effect frame");
    assert.equal(calls.replays, 1);
    assert.equal(calls.runs.length, 2);
    const beforeWrongAuthorization = { journals: calls.journals, runs: calls.runs.length };
    await assert.rejects(runSuccessorRolloverCli(runArguments.map(value =>
      value.startsWith("--authorization=") ? "--authorization=wrong" : value), dependencies),
    /exact authorization/u);
    assert.deepEqual({ journals: calls.journals, runs: calls.runs.length }, beforeWrongAuthorization);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("external journal store provides private atomic CAS and an awaited entrypoint fence", async () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "successor-rollover-store-"));
  try {
    const repository = path.join(root, "repository"); fs.mkdirSync(repository, { mode: 0o755 });
    const statePath = path.join(root, "journal.json");
    const store = createSuccessorRolloverJournalStore({ statePath, repositoryRoot: repository });
    const harness = createHarness(); await retire(harness);
    const journal = harness.journal;
    assert.equal(store.readRecoveryJournal(), null);
    assert.equal(store.writeRecoveryJournal({ expectedJournal: null,
      nextJournal: journal }).journalDigest, journal.journalDigest);
    assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
    assert.equal(store.readRecoveryJournal().journalDigest, journal.journalDigest);
    await assert.rejects(async () => store.writeRecoveryJournal({ expectedJournal: null,
      nextJournal: journal }), /changed before CAS/u);

    let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    const blocked = new Promise(resolve => { release = resolve; });
    const first = store.withEntrypointFence({ phase: "retirement" }, async () => {
      entered(); await blocked;
    });
    await started;
    await assert.rejects(store.withEntrypointFence({ phase: "replacement" }, async () => {}),
      /already fenced/u);
    release(); await first;
    await store.withEntrypointFence({ phase: "replacement" }, async () => {});
    const staleLock = `${statePath}.entrypoint.lock`;
    fs.writeFileSync(staleLock, `${JSON.stringify({ pid: 999999, token: "dead-token",
      subject: { phase: "retirement" }, acquiredAt: "2026-08-30T00:00:00.000Z" })}\n`,
    { mode: 0o600 });
    const recovering = createSuccessorRolloverJournalStore({ statePath,
      repositoryRoot: repository, processAlive: () => false });
    await recovering.withEntrypointFence({ phase: "replacement" }, async () => {});
    assert.equal(fs.existsSync(staleLock), false);
    assert.throws(() => createSuccessorRolloverJournalStore({
      statePath: path.join(repository, "journal.json"), repositoryRoot: repository,
    }), /outside the source repository/u);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("concurrent stale reapers never move or overwrite a newly acquired live lock", async () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "successor-rollover-reaper-"));
  try {
    const repository = path.join(root, "repository"); fs.mkdirSync(repository, { mode: 0o755 });
    const statePath = path.join(root, "journal.json");
    const lockPath = `${statePath}.entrypoint.lock`;
    fs.writeFileSync(lockPath, `${JSON.stringify({ pid: 999999, token: "dead-token",
      subject: { phase: "retirement" }, acquiredAt: "2026-08-30T00:00:00.000Z" })}\n`,
    { mode: 0o600 });
    let releaseLive, livePromise, started = false;
    const liveStore = createSuccessorRolloverJournalStore({ statePath,
      repositoryRoot: repository, processAlive: () => false });
    const racingStore = createSuccessorRolloverJournalStore({ statePath,
      repositoryRoot: repository, processAlive: pid => {
        if (pid === 999999 && !started) {
          started = true;
          livePromise = liveStore.withEntrypointFence({ phase: "live" }, async () =>
            new Promise(resolve => { releaseLive = resolve; }));
          return false;
        }
        return true;
      } });
    await assert.rejects(racingStore.withEntrypointFence({ phase: "racing" }, async () => {}),
      /changed during stale-owner fencing/u);
    const liveToken = JSON.parse(fs.readFileSync(lockPath, "utf8")).token;
    assert.notEqual(liveToken, "dead-token");
    const observer = createSuccessorRolloverJournalStore({ statePath, repositoryRoot: repository });
    await assert.rejects(observer.withEntrypointFence({ phase: "observer" }, async () => {}),
      /already fenced/u);
    assert.equal(JSON.parse(fs.readFileSync(lockPath, "utf8")).token, liveToken);
    releaseLive(); await livePromise;
    assert.equal(fs.existsSync(lockPath), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
