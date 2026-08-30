// Responsibility: prove the sealed contract, journaled controller, and owned-dirt preservation boundary.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PHASES,
  authorizeReanchor,
  buildReanchorPlan,
  normalizeReanchorPlan,
} from "../scripts/active-owned-dirt-current-base-reanchor-contract.mjs";
import { captureActiveOwnedDirtEvidence }
  from "../scripts/active-owned-dirt-recovery-evidence.mjs";
import { createActiveOwnedDirtCurrentBaseReanchorController }
  from "../scripts/active-owned-dirt-current-base-reanchor-controller.mjs";
import {
  createActiveOwnedDirtCurrentBaseReanchorRepositoryAdapter,
  updateReanchorPullRequestBodyConditionally,
}
  from "../scripts/active-owned-dirt-current-base-reanchor-repository-adapter.mjs";
import { runActiveOwnedDirtCurrentBaseReanchorCli }
  from "../scripts/active-owned-dirt-current-base-reanchor.mjs";
import {
  digestValue,
  normalizeWriteSet,
} from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier }
  from "../scripts/github-cloud-collaboration-mapping.mjs";
import {
  createTaskAuthorityBinding,
  createTaskAuthorityCapability,
} from "../scripts/task-bound-lane-authority-contract.mjs";
import { updateWriterLeasePullRequestBody }
  from "../scripts/writer-lease-lib.mjs";

const EFFECT_METHODS = Object.freeze({
  "source-authorized": "authorizeSource",
  snapshotted: "snapshot",
  "reanchor-prepared": "prepareReanchor",
  "local-reanchored": "reanchorLocal",
  "remote-reanchored": "reanchorRemote",
  "successor-waiting": "claimWaitingSuccessor",
  "source-retired": "retireSource",
  "successor-current": "promoteSuccessor",
  "successor-bound": "bindSuccessor",
  "local-cas": "projectLocal",
  "pr-projected": "projectPullRequest",
  verified: "verifyTerminal",
});

test("plan seals exact authorization and rejects a tampered projection", () => {
  const plan = buildReanchorPlan({ evidence: evidenceFixture(), ttlSeconds: 900 });
  assert.equal(plan.exactAuthorization,
    `authorize active-owned-dirt-current-base-reanchor ${plan.planDigest}`);
  assert.equal(authorizeReanchor({
    plan,
    authorization: plan.exactAuthorization,
  }).status, "authorized");
  assert.throws(() => authorizeReanchor({
    plan,
    authorization: `authorize active-owned-dirt-current-base-reanchor ${hex("other")}`,
  }), /requires exact authorization/u);
  assert.throws(() => normalizeReanchorPlan({
    ...plan,
    targetCanonicalBaseSha: objectId("tampered-target"),
  }), /plan projection/u);
});

test("planning rejects a pull-request body without conservative target-marker capacity", () => {
  const evidence = structuredClone(evidenceFixture());
  evidence.pullRequest.bodyByteLength = 49_153;
  resealEvidence(evidence);
  assert.throws(() => buildReanchorPlan({ evidence }), /target pull-request body capacity/u);
});

test("protected advance rejects parent and child overlap with the full admitted path write set",
  () => {
    for (const [declaredPath, protectedPath] of [
      ["reserved", "reserved/nested/file.txt"],
      ["reserved/nested/file.txt", "reserved"],
    ]) {
      const evidence = evidenceFixture({
        declaredPath,
        protectedChangedPaths: [protectedPath],
      });
      assert.throws(() => buildReanchorPlan({ evidence }),
        /protected.*(?:write.?set|scope).*overlap|disjoint protected-main advance/iu);
    }
  });

test("planning rejects a historical successor epoch that task continuation cannot adopt", () => {
  const historical = {
    claimId: hex("historical-successor"),
    leaseEpoch: 8,
    transitionCounter: 4,
    transitionDigest: hex("historical-successor-transition"),
    state: "retired",
  };
  assert.throws(() => buildReanchorPlan({
    evidence: evidenceFixture({ historicalClaims: [historical] }),
  }), /target cloud epoch derivation/u);
});

test("target projection preserves exact untracked owned bytes", () => {
  const evidence = evidenceFixture();
  const plan = buildReanchorPlan({ evidence });
  const source = plan.evidence.dirt.entries.find(entry => entry.untracked);
  const target = plan.evidence.reanchor.targetDirt.entries
    .find(entry => entry.path === source.path);
  assert.deepEqual(target, source);
  assert.equal(target.worktreeBlob, objectId("untracked-blob"));
  assert.equal(plan.sourceUntrackedPathCount, 1);

  const forged = structuredClone(evidence);
  const entry = forged.reanchor.targetDirt.entries.find(item => item.untracked);
  entry.worktreeBlob = objectId("different-untracked-blob");
  forged.reanchor.targetDirt = sealDirt(forged.reanchor.targetDirt);
  resealEvidence(forged);
  assert.throws(() => buildReanchorPlan({ evidence: forged }),
    /owned-dirt.*(?:preserv|projection|disposition)|deterministic reanchor projection/iu);
});

test("controller executes every protected phase once and replays the completion", async () => {
  const evidence = evidenceFixture();
  const fixture = fakeAdapter(evidence);
  const controller = createActiveOwnedDirtCurrentBaseReanchorController(fixture.adapter);
  const plan = await controller.plan({ ttlSeconds: 1_200 });
  assert.equal(fixture.state.captureCount, 2, "planning must double-read evidence");

  const completion = await controller.run({
    plan,
    authorization: plan.exactAuthorization,
  });
  assert.equal(completion.status, "authoring-authority-reanchored");
  assert.equal(completion.targetDirtEvidenceDigest, plan.targetDirtEvidenceDigest);
  assert.equal(completion.authoredBytesPreserved, true);
  assert.equal(completion.untrackedBytesPreserved, true);
  assert.equal(completion.authoredCommitCreated, false);
  assert.deepEqual(fixture.state.effects,
    PHASES.filter(phase => Object.hasOwn(EFFECT_METHODS, phase)));
  assert.deepEqual(fixture.state.writes, PHASES);
  assert.equal(fixture.state.captureCount, 4,
    "execution must double-read exact-current evidence before journaling");

  const beforeReplay = snapshotCounts(fixture.state);
  const replay = await controller.run({ plan, authorization: plan.exactAuthorization });
  assert.deepEqual(replay, completion);
  assert.deepEqual(snapshotCounts(fixture.state), {
    ...beforeReplay,
    fences: beforeReplay.fences + 1,
  });
});

test("response loss adopts the exact reconciled phase without repeating its effect", async () => {
  const evidence = evidenceFixture();
  const fixture = fakeAdapter(evidence, { responseLossPhase: "remote-reanchored" });
  const controller = createActiveOwnedDirtCurrentBaseReanchorController(fixture.adapter);
  const plan = buildReanchorPlan({ evidence });
  const completion = await controller.run({ plan, authorization: plan.exactAuthorization });
  assert.equal(completion.status, "authoring-authority-reanchored");
  assert.equal(fixture.state.effects.filter(phase => phase === "remote-reanchored").length, 1);
  assert.equal(fixture.state.reconciles.filter(phase => phase === "remote-reanchored").length, 2,
    "the second reconciliation adopts the committed remote target after response loss");
  assert.equal(fixture.state.writes.filter(phase => phase === "remote-reanchored").length, 1);
});

test("successor reservation and current authority precede every Git reanchor", async () => {
  const evidence = evidenceFixture();
  const fixture = fakeAdapter(evidence, { responseLossPhase: "successor-waiting" });
  const controller = createActiveOwnedDirtCurrentBaseReanchorController(fixture.adapter);
  const plan = buildReanchorPlan({ evidence });
  const completion = await controller.run({ plan, authorization: plan.exactAuthorization });
  assert.equal(completion.status, "authoring-authority-reanchored");
  assert.equal(
    fixture.state.effects.filter(phase => phase === "successor-waiting").length,
    1,
  );
  assert.ok(
    fixture.state.effects.indexOf("successor-waiting")
      < fixture.state.effects.indexOf("local-reanchored"),
  );
  assert.ok(
    fixture.state.effects.indexOf("successor-waiting")
      < fixture.state.effects.indexOf("remote-reanchored"),
  );
  for (const phase of ["local-reanchored", "remote-reanchored"]) {
    assert.ok(fixture.state.effects.indexOf("source-retired")
      < fixture.state.effects.indexOf(phase));
    assert.ok(fixture.state.effects.indexOf("successor-current")
      < fixture.state.effects.indexOf(phase));
  }
});

test("promotion response loss adopts the exact current successor before any Git effect",
  async () => {
    const evidence = evidenceFixture();
    const fixture = fakeAdapter(evidence, { responseLossPhase: "successor-current" });
    const controller = createActiveOwnedDirtCurrentBaseReanchorController(fixture.adapter);
    const plan = buildReanchorPlan({ evidence });
    const completion = await controller.run({ plan, authorization: plan.exactAuthorization });
    assert.equal(completion.status, "authoring-authority-reanchored");
    assert.equal(
      fixture.state.effects.filter(phase => phase === "successor-current").length,
      1,
    );
    assert.equal(
      fixture.state.reconciles.filter(phase => phase === "successor-current").length,
      2,
    );
    assert.ok(fixture.state.effects.indexOf("successor-current")
      < fixture.state.effects.indexOf("local-reanchored"));
    assert.ok(fixture.state.writes.includes("successor-current"));
});

test("a failed phase stops before later effects and leaves the last durable checkpoint", async () => {
  const evidence = evidenceFixture();
  const fixture = fakeAdapter(evidence, { failurePhase: "source-retired" });
  const controller = createActiveOwnedDirtCurrentBaseReanchorController(fixture.adapter);
  const plan = buildReanchorPlan({ evidence });
  await assert.rejects(() => controller.run({
    plan,
    authorization: plan.exactAuthorization,
  }), /injected source-retired failure/u);
  assert.equal(fixture.state.intent.phase, "successor-waiting");
  assert.equal(fixture.state.effects.at(-1), "source-retired");
  assert.equal(fixture.state.effects.includes("successor-current"), false);
  assert.equal(fixture.state.writes.includes("source-retired"), false);
});

test("invalid authorization creates no fence, intent, or effect", async () => {
  const evidence = evidenceFixture();
  const fixture = fakeAdapter(evidence);
  const controller = createActiveOwnedDirtCurrentBaseReanchorController(fixture.adapter);
  const plan = buildReanchorPlan({ evidence });
  await assert.rejects(() => controller.run({
    plan,
    authorization: "authorize a neighboring controller",
  }), /requires exact authorization/u);
  assert.deepEqual(snapshotCounts(fixture.state), {
    captures: 0,
    effects: 0,
    fences: 0,
    reconciles: 0,
    writes: 0,
  });
});

test("repository adapter requires explicit identity and an external owner-only journal", t => {
  const fixture = adapterConstructorFixture(t);
  const create = options => createActiveOwnedDirtCurrentBaseReanchorRepositoryAdapter(
    options,
    fixture.dependencies,
  );
  assert.throws(() => create({}), /repository is invalid/u);
  assert.throws(() => create({
    repository: fixture.repository,
  }), /session ID is invalid/u);
  assert.throws(() => create({
    repository: fixture.repository,
    sessionId: "source-session",
  }), /task-authority file is invalid/u);
  assert.throws(() => create({
    repository: fixture.repository,
    sessionId: "source-session",
    taskAuthorityFile: fixture.taskAuthorityFile,
  }), /external journal file is invalid/u);

  const adapter = create(fixture.options);
  assert.equal(typeof adapter.captureEvidence, "function");
  const inWorktreeCapability = path.join(fixture.repository, "capability.json");
  writeFileSync(inWorktreeCapability, "{}\n", { mode: 0o600 });
  assert.throws(() => create({
    ...fixture.options,
    taskAuthorityFile: inWorktreeCapability,
  }), /task-authority capability containment/u);
  const linkedCapability = path.join(fixture.privateRoot, "linked-capability.json");
  linkSync(fixture.taskAuthorityFile, linkedCapability);
  assert.throws(() => create({
    ...fixture.options,
    taskAuthorityFile: linkedCapability,
  }), /task-authority capability privacy/u);
  rmSync(linkedCapability);
  assert.throws(() => create({
    ...fixture.options,
    journalFile: path.join(fixture.repository, "journal.json"),
  }), /external journal containment/u);

  chmodSync(fixture.privateRoot, 0o755);
  assert.throws(() => create(fixture.options), /owner-only journal parent/u);
  chmodSync(fixture.privateRoot, 0o700);
  writeFileSync(fixture.journalFile, "{}\n", { mode: 0o600 });
  chmodSync(fixture.journalFile, 0o644);
  assert.throws(() => create(fixture.options), /reanchor journal privacy/u);
});

test("CLI writes one private external plan and forwards exact run authority", async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), "active-reanchor-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository");
  const privateRoot = path.join(root, "private");
  mkdirSync(privateRoot, { mode: 0o700 });
  chmodSync(privateRoot, 0o700);
  execFileSync("git", ["init", "-q", repository]);
  chmodSync(repository, 0o700);
  const taskAuthorityFile = path.join(privateRoot, "capability.json");
  writeFileSync(taskAuthorityFile, "{}\n", { mode: 0o600 });
  const journalFile = path.join(privateRoot, "journal.json");
  const planFile = path.join(privateRoot, "plan.json");
  const plan = buildReanchorPlan({ evidence: evidenceFixture(), ttlSeconds: 600 });
  const adapterOptions = [];
  let planInput;
  let runInput;
  const dependencies = {
    createAdapter(options) {
      adapterOptions.push(options);
      return Object.freeze({ adapter: true });
    },
    createController(adapter) {
      assert.deepEqual(adapter, { adapter: true });
      return Object.freeze({
        async plan(input) {
          planInput = input;
          return plan;
        },
        async run(input) {
          runInput = input;
          return Object.freeze({ status: "authoring-authority-reanchored" });
        },
      });
    },
  };
  const common = [
    `--repository=${repository}`,
    "--session=source-session",
    `--task-authority=${taskAuthorityFile}`,
    `--journal=${journalFile}`,
  ];
  const inWorktreeCapability = path.join(repository, "capability.json");
  writeFileSync(inWorktreeCapability, "{}\n", { mode: 0o600 });
  await assert.rejects(() => runActiveOwnedDirtCurrentBaseReanchorCli([
    "plan",
    ...common.map(value => value.startsWith("--task-authority=")
      ? `--task-authority=${inWorktreeCapability}` : value),
    `--output=${planFile}`,
  ], dependencies), /task authority capability must remain outside/u);
  const planned = await runActiveOwnedDirtCurrentBaseReanchorCli([
    "plan", ...common, `--output=${planFile}`, "--ttl-seconds=600", "--json",
  ], dependencies);
  assert.deepEqual(planInput, { ttlSeconds: 600 });
  assert.equal(planned.status, "planned");
  assert.equal(planned.planDigest, plan.planDigest);
  assert.deepEqual(JSON.parse(readFileSync(planFile, "utf8")), plan);
  assert.equal(statSync(planFile).mode & 0o777, 0o600);
  assert.equal(adapterOptions[0].journalFile, journalFile);

  const complete = await runActiveOwnedDirtCurrentBaseReanchorCli([
    "run", ...common, `--plan=${planFile}`,
    `--authorization=${plan.exactAuthorization}`,
  ], dependencies);
  assert.equal(complete.status, "authoring-authority-reanchored");
  assert.equal(complete.authoringAuthorityReanchored, true);
  assert.equal(runInput.plan.planDigest, plan.planDigest);
  assert.equal(runInput.authorization, plan.exactAuthorization);
  assert.equal(adapterOptions.length, 2);
});

test("pull-request marker projection uses an exact ETag and never overwrites concurrent body drift",
  () => {
    const identity = Object.freeze({
      etag: '"v1"',
      id: "PR_node",
      number: 821,
      url: "https://github.com/acme/repo/pull/821",
      state: "OPEN",
      isDraft: true,
      headBranch: "agent/device/reanchor",
      headSha: objectId("head"),
      headRepository: "acme/repo",
      baseSha: objectId("base"),
      body: "human body",
    });
    let current = identity;
    const patched = [];
    const result = updateReanchorPullRequestBodyConditionally({
      read: () => current,
      patch: ({ expectedEtag, body }) => {
        assert.equal(expectedEtag, '"v1"');
        patched.push(body);
        current = { ...current, etag: '"v2"', body };
      },
      expected: identity,
      body: "target body",
    });
    assert.equal(result.bodyDigest, digestValue("target body"));
    assert.deepEqual(patched, ["target body"]);

    current = identity;
    assert.throws(() => updateReanchorPullRequestBodyConditionally({
      read: () => current,
      patch: ({ expectedEtag }) => {
        current = { ...current, etag: '"human"', body: "concurrent human edit" };
        assert.equal(expectedEtag, '"v1"');
        throw new Error("HTTP 412 Precondition Failed");
      },
      expected: identity,
      body: "must not win",
    }), /412 Precondition Failed/u);
    assert.equal(current.body, "concurrent human edit");
  });

test("production adapter reanchors an exact untracked executable through remote force-with-lease",
  { timeout: 30_000 }, t => {
    const fixture = productionAdapterFixture(t);
    const first = fixture.createAdapter();
    const second = fixture.createAdapter();
    const firstEvidence = first.captureEvidence();
    const secondEvidence = second.captureEvidence();
    assert.equal(secondEvidence.evidenceDigest, firstEvidence.evidenceDigest,
      "process-like adapter instances must capture the same operationAt-bound evidence");
    assert.deepEqual(firstEvidence.reanchor.ignoredRetention.pathComparison, {
      caseFold: false,
      caseFoldStrategy: "none",
      unicodeNormalization: "NFC",
    });
    assert.equal(firstEvidence.operationAt, fixture.operationAt);
    assert.equal(firstEvidence.dirt.untrackedPathCount, 1);
    assert.equal(firstEvidence.dirt.entries[0].worktreeMode, "100755");

    for (const [label, override] of [
      ["head", { headRefOid: fixture.protectedMainSha }],
      ["base", { baseRefOid: fixture.protectedMainSha }],
      ["body", { body: fixture.pullBody.replace('"epoch":320', '"epoch":321') }],
    ]) {
      assert.throws(() => fixture.createAdapter(override).captureEvidence(),
        /source pull-request projection|strict protected-main advance/u,
        `capture must reject ${label} drift`);
    }

    const plan = buildReanchorPlan({ evidence: firstEvidence, ttlSeconds: 1_800 });
    const snapshot = first.snapshot({ plan });
    const snapshotIntent = Object.freeze({
      receipts: Object.freeze({
        snapshotted: Object.freeze({ values: snapshot }),
      }),
    });
    const prepared = first.prepareReanchor({ plan, intent: snapshotIntent });
    assert.equal(prepared.coordinationCommitSha, plan.targetLaneRevision);
    const waiting = fixture.reserveSuccessor(plan);
    const current = fixture.promoteSuccessor(plan);
    const intent = Object.freeze({
      receipts: Object.freeze({
        ...snapshotIntent.receipts,
        "successor-waiting": Object.freeze({ values: waiting }),
        "successor-current": Object.freeze({ values: current }),
      }),
    });
    const local = first.reanchorLocal({ plan, intent });
    assert.equal(local.targetDirtEvidenceDigest, plan.targetDirtEvidenceDigest);
    const projectedDirt = captureActiveOwnedDirtEvidence({
      repository: fixture.repository,
    });
    assert.equal(projectedDirt.evidenceDigest, plan.targetDirtEvidenceDigest);
    assert.equal(readFileSync(fixture.untrackedFile, "utf8"), "#!/bin/sh\necho owned\n");
    assert.equal(statSync(fixture.untrackedFile).mode & 0o777, 0o755);
    assert.equal(readFileSync(path.join(fixture.repository, "protected.txt"), "utf8"),
      "protected-current\n");

    let remote;
    try {
      remote = first.reanchorRemote({ plan, intent });
    } catch (error) {
      const afterDirt = captureActiveOwnedDirtEvidence({ repository: fixture.repository });
      assert.fail(`${error.message}; remote=${fixture.remoteRef(
        `refs/heads/${fixture.branch}`,
      )}; expected=${plan.targetLaneRevision}; lastPull=${fixture.pullReads.at(-1)}; `
        + `head=${runGit(fixture.repository, ["rev-parse", "HEAD"])}; `
        + `branchHead=${runGit(fixture.repository, ["rev-parse", `refs/heads/${fixture.branch}`])}; `
        + `tree=${runGit(fixture.repository, ["write-tree"])}; `
        + `dirt=${afterDirt.evidenceDigest}/${plan.targetDirtEvidenceDigest}`);
    }
    assert.equal(remote.remoteHeadSha, plan.targetLaneRevision);
    assert.equal(fixture.remoteRef(`refs/heads/${fixture.branch}`), plan.targetLaneRevision);
    assert.equal(fixture.remoteRef("refs/heads/main"), fixture.protectedMainSha);
    assert.equal(fixture.pushes.length, 1);
    assert.deepEqual(fixture.pushes[0], [
      "push",
      `--force-with-lease=refs/heads/${fixture.branch}:${fixture.sourceFenceSha}`,
      "git@github.com:acme/repo.git",
      `${plan.targetLaneRevision}:refs/heads/${fixture.branch}`,
    ]);
  });

test("interrupted local reanchor never restores a foreign-deleted untracked owned path",
  { timeout: 30_000 }, t => {
    const fixture = productionAdapterFixture(t);
    const adapter = fixture.createAdapter();
    const plan = buildReanchorPlan({ evidence: adapter.captureEvidence(), ttlSeconds: 1_800 });
    const snapshot = adapter.snapshot({ plan });
    const snapshotIntent = Object.freeze({
      receipts: Object.freeze({ snapshotted: Object.freeze({ values: snapshot }) }),
    });
    adapter.prepareReanchor({ plan, intent: snapshotIntent });
    const waiting = fixture.reserveSuccessor(plan);
    const current = fixture.promoteSuccessor(plan);
    const intent = Object.freeze({
      receipts: Object.freeze({
        ...snapshotIntent.receipts,
        "successor-waiting": Object.freeze({ values: waiting }),
        "successor-current": Object.freeze({ values: current }),
      }),
    });
    runGit(fixture.repository, [
      "update-ref",
      `refs/heads/${fixture.branch}`,
      plan.targetLaneRevision,
      plan.sourceFenceSha,
    ]);
    rmSync(fixture.untrackedFile);
    assert.throws(() => adapter.reanchorLocal({ plan, intent }),
      /recognized interrupted local reanchor overlay/u);
    assert.equal(existsSync(fixture.untrackedFile), false,
      "foreign deletion must remain untouched on fail-closed recovery");
  });

function evidenceFixture({
  declaredPath = "reserved/nested",
  protectedChangedPaths = ["upstream.txt"],
  historicalClaims = [],
} = {}) {
  const sourceBaseSha = objectId("source-base");
  const sourceFenceSha = objectId("source-fence");
  const targetProtectedSha = objectId("protected-main");
  const coordinationCommitSha = objectId("coordination");
  const sourceTreeSha = objectId("source-tree");
  const targetTreeSha = objectId("target-tree");
  const declaredWriteSet = normalizeWriteSet([
    "path:owned",
    `path:${declaredPath}`,
    "path:staged.txt",
    "semantic:active-owned-dirt-current-base-reanchor",
  ]);
  const writeSetDigest = digestValue(declaredWriteSet);
  const claimId = hex("source-claim");
  const claimDigest = hex("source-claim-revision");
  const sourceTransitionDigest = hex("source-transition");
  const pullRequestId = "PR_test";
  const reviewRequestId = `github-pull-request:${pullRequestId}`;
  const pullRequestUrl = "https://github.com/example/repository/pull/821";
  const dirt = sealDirt({
    schema: "agentic-active-owned-dirt-evidence/v1",
    headSha: sourceFenceSha,
    entries: [
      {
        path: "owned/new.txt",
        staged: false,
        unstaged: false,
        untracked: true,
        headMode: null,
        headBlob: null,
        indexMode: null,
        indexBlob: null,
        worktreeType: "file",
        worktreeMode: "100644",
        worktreeBlob: objectId("untracked-blob"),
      },
      {
        path: "staged.txt",
        staged: true,
        unstaged: false,
        untracked: false,
        headMode: "100644",
        headBlob: objectId("staged-head"),
        indexMode: "100644",
        indexBlob: objectId("staged-index"),
        worktreeType: "file",
        worktreeMode: "100644",
        worktreeBlob: objectId("staged-index"),
      },
    ],
  });
  const targetDirt = sealDirt({
    ...structuredClone(dirt),
    headSha: coordinationCommitSha,
    evidenceDigest: undefined,
  });
  const protectedChangedPathsDigest = digestValue(protectedChangedPaths);
  const noOverlap = [];
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 320,
    branch: "agent/device/active-owned-dirt-current-base-reanchor",
    sessionId: "source-session",
    device: "device",
    scope: "active-owned-dirt-current-base-reanchor",
    worktreePath: "/preserved/dirty-worktree",
    baseSha: sourceBaseSha,
    fenceSha: sourceFenceSha,
    expiresAt: "2026-08-30T16:00:00.000Z",
    pullRequestUrl,
    admission: {
      status: "admitted",
      semanticScope: "active-owned-dirt-current-base-reanchor",
      declaredWriteSet,
      writeSetDigest,
      manifestDigest: hex("manifest"),
    },
    cloudAuthority: {
      state: "active",
      targetRepository: "example/repository",
      claimId,
      claimDigest,
      reviewRequestId,
      leaseEpoch: 7,
    },
  };
  const capability = createTaskAuthorityCapability({
    authoritySubjectId: `urn:agentic-task:${hex("authority-subject")}`,
    generation: 1,
    issuedAt: "2026-08-30T14:00:00.000Z",
  });
  lease.taskAuthority = createTaskAuthorityBinding({
    capability,
    lease,
    boundAt: "2026-08-30T14:00:00.000Z",
  });
  const core = {
    schema: "agentic-active-owned-dirt-current-base-reanchor-evidence/v1",
    operationAt: "2026-08-30T15:00:00.000Z",
    lease,
    leaseDigest: digestValue(lease),
    sourceClaim: {
      claimId,
      fenceRevision: claimDigest,
      repositoryId: "example/repository",
      actorId: "github-user:123",
      workItemId: pseudonymousIdentifier(
        "work-item",
        lease.scope,
      ),
      canonicalBaseRevision: sourceBaseSha,
      laneRevision: sourceFenceSha,
      declaredWriteScope: declaredWriteSet,
      state: "active",
      writeAuthority: true,
      reviewRequestId,
      writeSetDigest,
      leaseEpoch: 7,
      transitionCounter: 3,
      transitionDigest: sourceTransitionDigest,
      operationReceiptDigest: hex("source-operation"),
      expiresAt: "2026-08-30T16:00:00.000Z",
      predecessorClaimId: null,
      deviceId: pseudonymousIdentifier("device", lease.device),
      sessionId: pseudonymousIdentifier("session", lease.sessionId),
    },
    targetEpochProof: targetEpochProofFixture({
      claimId,
      leaseEpoch: 7,
      transitionCounter: 3,
      transitionDigest: sourceTransitionDigest,
      repositoryId: "example/repository",
      workItemId: pseudonymousIdentifier("work-item", lease.scope),
      writeSetDigest,
      historicalClaims,
    }),
    sourceFence: {
      headSha: sourceFenceSha,
      parentSha: sourceBaseSha,
      treeSha: sourceTreeSha,
      baseTreeSha: sourceTreeSha,
    },
    targetProtectedMain: {
      sourceBaseSha,
      protectedMainSha: targetProtectedSha,
      mergeBaseSha: sourceBaseSha,
      ancestryVerified: true,
      localMainSha: targetProtectedSha,
      localOriginMainSha: targetProtectedSha,
      remoteMainSha: targetProtectedSha,
      treeSha: targetTreeSha,
      changedPaths: protectedChangedPaths,
      changedPathsDigest: protectedChangedPathsDigest,
      dirtyOverlapPaths: noOverlap,
      dirtyOverlapPathsDigest: digestValue(noOverlap),
    },
    pullRequest: {
      id: pullRequestId,
      url: pullRequestUrl,
      number: 821,
      state: "OPEN",
      isDraft: true,
      headSha: sourceFenceSha,
      baseSha: sourceBaseSha,
      autoMerge: null,
      bodyDigest: hex("pull-request-body"),
      bodyRemainderDigest: hex("pull-request-remainder"),
      bodyByteLength: 8_192,
      targetMarkerGrowthReserveBytes: 16_384,
      targetBodyLimitBytes: 65_536,
      headRepository: "example/repository",
    },
    repositoryIdentity: repositoryIdentityFixture({
      targetRepository: "example/repository",
      pullRequestUrl,
      branch: lease.branch,
    }),
    dirt,
    ignoredRetention: [],
    reanchor: {
      coordination: {
        commitSha: coordinationCommitSha,
        treeSha: targetTreeSha,
        parents: [sourceFenceSha, targetProtectedSha],
      },
      sourceIndexTreeSha: objectId("source-index-tree"),
      sourceWorktreeTreeSha: objectId("source-worktree-tree"),
      targetIndexTreeSha: objectId("target-index-tree"),
      targetWorktreeTreeSha: objectId("target-worktree-tree"),
      targetDirt,
      dispositions: [
        {
          path: "owned/new.txt",
          base: { mode: null, blob: null },
          protected: { mode: null, blob: null },
          sourceIndex: { mode: null, blob: null },
          sourceWorktree: {
            type: "file",
            mode: "100644",
            blob: objectId("untracked-blob"),
          },
          targetIndex: { mode: null, blob: null },
          targetWorktree: {
            type: "file",
            mode: "100644",
            blob: objectId("untracked-blob"),
          },
          indexDisposition: "protected",
          worktreeDisposition: "source",
        },
        {
          path: "staged.txt",
          base: { mode: "100644", blob: objectId("staged-head") },
          protected: { mode: "100644", blob: objectId("staged-head") },
          sourceIndex: { mode: "100644", blob: objectId("staged-index") },
          sourceWorktree: {
            type: "file",
            mode: "100644",
            blob: objectId("staged-index"),
          },
          targetIndex: { mode: "100644", blob: objectId("staged-index") },
          targetWorktree: {
            type: "file",
            mode: "100644",
            blob: objectId("staged-index"),
          },
          indexDisposition: "source",
          worktreeDisposition: "source",
        },
      ],
      ignoredRetention: [],
    },
    overlapClaimIds: [],
    controllerRevision: objectId("controller"),
  };
  return { ...core, evidenceDigest: digestValue(core) };
}

function fakeAdapter(evidence, { failurePhase = null, responseLossPhase = null } = {}) {
  const state = {
    captureCount: 0,
    committed: new Set(),
    effects: [],
    fences: 0,
    intent: null,
    reconciles: [],
    writes: [],
  };
  const adapter = {
    async withFence(callback) {
      state.fences += 1;
      return callback();
    },
    async captureEvidence() {
      state.captureCount += 1;
      return structuredClone(evidence);
    },
    async readIntent() {
      return state.intent;
    },
    async writeIntent({ expected, value }) {
      if (expected === null) assert.equal(state.intent, null);
      else assert.equal(state.intent?.intentDigest, expected.intentDigest);
      state.intent = value;
      state.writes.push(value.phase);
      return value;
    },
    async reconcile({ phase }) {
      state.reconciles.push(phase);
      return state.committed.has(phase) ? phaseValues(phase) : null;
    },
  };
  for (const [phase, method] of Object.entries(EFFECT_METHODS)) {
    adapter[method] = async () => {
      state.effects.push(phase);
      if (phase === failurePhase) throw new Error(`injected ${phase} failure`);
      if (phase === responseLossPhase) {
        state.committed.add(phase);
        throw new Error(`lost ${phase} response`);
      }
      return phaseValues(phase);
    };
  }
  return { adapter: Object.freeze(adapter), state };
}

function adapterConstructorFixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "active-reanchor-adapter-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository");
  const commonDirectory = path.join(root, "git-common");
  const privateRoot = path.join(root, "private");
  for (const directory of [repository, commonDirectory, privateRoot]) {
    mkdirSync(directory, { mode: 0o700 });
    chmodSync(directory, 0o700);
  }
  const taskAuthorityFile = path.join(privateRoot, "capability.json");
  writeFileSync(taskAuthorityFile, "{}\n", { mode: 0o600 });
  const journalFile = path.join(privateRoot, "journal.json");
  const branch = "agent/device/active-owned-dirt-current-base-reanchor";
  const git = args => {
    if (args[0] === "branch" && args[1] === "--show-current") return branch;
    if (args[0] === "rev-parse" && args.includes("--git-common-dir")) {
      return commonDirectory;
    }
    if (args[0] === "worktree" && args[1] === "list") {
      return `worktree ${repository}\0HEAD ${objectId("head")}\0branch refs/heads/${branch}\0\0`;
    }
    throw new Error(`Unexpected constructor Git command: ${args.join(" ")}`);
  };
  return {
    repository,
    privateRoot,
    taskAuthorityFile,
    journalFile,
    options: {
      repository,
      sessionId: "source-session",
      taskAuthorityFile,
      journalFile,
    },
    dependencies: {
      controllerRevision: objectId("controller-revision"),
      git,
      leaseStore: Object.freeze({ read: () => {
        throw new Error("constructor must not read the writer lease");
      } }),
    },
  };
}

function productionAdapterFixture(t) {
  const root = realpathSync(mkdtempSync(
    path.join(os.tmpdir(), "active-reanchor-production-"),
  ));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, "origin.git");
  const controller = path.join(root, "controller");
  const repository = path.join(root, "task-worktree");
  const privateRoot = path.join(root, "private");
  runGit(root, ["init", "--bare", "--initial-branch=main", origin]);
  runGit(root, ["clone", origin, controller]);
  runGit(controller, ["config", "user.name", "Agentic Test"]);
  runGit(controller, ["config", "user.email", "agentic-test@example.test"]);
  writeFileSync(path.join(controller, "protected.txt"), "protected-base\n");
  writeFileSync(path.join(controller, "source.txt"), "source-base\n");
  runGit(controller, ["add", "."]);
  runGit(controller, ["commit", "-m", "historical base"]);
  const sourceBaseSha = runGit(controller, ["rev-parse", "HEAD"]);
  runGit(controller, ["push", "origin", "main"]);
  writeFileSync(path.join(controller, "protected.txt"), "protected-current\n");
  runGit(controller, ["add", "protected.txt"]);
  runGit(controller, ["commit", "-m", "protected advance"]);
  const protectedMainSha = runGit(controller, ["rev-parse", "HEAD"]);
  runGit(controller, ["push", "origin", "main"]);
  const branch = "agent/device/active-owned-dirt-current-base-reanchor";
  runGit(controller, ["branch", branch, sourceBaseSha]);
  runGit(controller, ["worktree", "add", repository, branch]);
  runGit(repository, ["config", "core.ignorecase", "false"]);
  runGit(repository, ["config", "--unset-all", "core.ignorecase"]);
  runGit(repository, ["commit", "--allow-empty", "-m", "empty source fence"]);
  const sourceFenceSha = runGit(repository, ["rev-parse", "HEAD"]);
  runGit(repository, ["push", "-u", "origin", branch]);
  const ownedDirectory = path.join(repository, "owned");
  mkdirSync(ownedDirectory);
  const untrackedFile = path.join(ownedDirectory, "run.sh");
  writeFileSync(untrackedFile, "#!/bin/sh\necho owned\n");
  chmodSync(untrackedFile, 0o755);
  mkdirSync(privateRoot, { mode: 0o700 });
  chmodSync(privateRoot, 0o700);

  const operationAt = "2026-08-30T15:00:00.000Z";
  const expiresAt = "2026-08-30T16:00:00.000Z";
  const sessionId = "source-session";
  const device = "device";
  const claimId = hex("production-source-claim");
  const claimDigest = hex("production-source-claim-revision");
  const reviewRequestId = "github-pull-request:PR_production";
  const pullRequestUrl = "https://github.com/acme/repo/pull/821";
  const declaredWriteSet = normalizeWriteSet([
    "path:owned",
    "semantic:active-owned-dirt-current-base-reanchor",
  ]);
  const admission = {
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: "active-owned-dirt-current-base-reanchor",
    declaredWriteSet,
    writeSetDigest: digestValue(declaredWriteSet),
    manifestDigest: hex("production-manifest"),
    planReceiptDigest: hex("production-plan-receipt"),
    admissionReceiptDigest: hex("production-admission-receipt"),
    existingLaneStateDigest: hex("production-existing-lanes"),
    admittedReportDigest: hex("production-admitted-report"),
    preservationReceiptDigest: hex("production-preservation"),
  };
  const cloudAuthority = {
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "acme/ledger",
    targetRepository: "acme/repo",
    claimId,
    claimDigest,
    ledgerRevision: objectId("production-ledger-revision"),
    ledgerDigest: hex("production-ledger"),
    claimLedgerRevision: hex("production-claim-ledger"),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: hex("production-cloud-operation"),
    mutationAuthorityEligible: true,
    canonicalBaseSha: sourceBaseSha,
    laneRevision: sourceFenceSha,
    cloudDeclaredWriteScope: declaredWriteSet,
    writeSetDigest: admission.writeSetDigest,
    deviceId: device,
    sessionId,
    reviewRequestId,
    leaseEpoch: 7,
    transitionCounter: 3,
    state: "active",
    expiresAt,
    integrationReceiptDigest: null,
    integration: null,
    manifestDigest: admission.manifestDigest,
  };
  const leaseCore = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 320,
    sessionId,
    device,
    scope: "active-owned-dirt-current-base-reanchor",
    branch,
    worktreePath: repository,
    baseSha: sourceBaseSha,
    fenceSha: sourceFenceSha,
    pullRequestUrl,
    autoDelivery: true,
    runtimeRequired: true,
    heartbeatAt: operationAt,
    expiresAt,
    admission,
    cloudAuthority,
  };
  const capability = createTaskAuthorityCapability({
    authoritySubjectId: `urn:agentic-task:${hex("production-authority")}`,
    generation: 1,
    issuedAt: "2026-08-30T14:00:00.000Z",
  });
  const lease = Object.freeze({
    ...leaseCore,
    taskAuthority: createTaskAuthorityBinding({
      capability,
      lease: leaseCore,
      boundAt: "2026-08-30T14:00:00.000Z",
    }),
  });
  const taskAuthorityFile = path.join(privateRoot, "capability.json");
  writeFileSync(taskAuthorityFile, `${JSON.stringify(capability, null, 2)}\n`, { mode: 0o600 });
  chmodSync(taskAuthorityFile, 0o600);
  const journalFile = path.join(privateRoot, "journal.json");
  const pullBody = updateWriterLeasePullRequestBody("", lease);
  const sourceClaim = Object.freeze({
    claimId,
    fenceRevision: claimDigest,
    repositoryId: "acme/repo",
    actorId: "github-user:123",
    workItemId: pseudonymousIdentifier("work-item", lease.scope),
    canonicalBaseRevision: sourceBaseSha,
    laneRevision: sourceFenceSha,
    declaredWriteScope: declaredWriteSet,
    writeSetDigest: admission.writeSetDigest,
    leaseEpoch: 7,
    reviewRequestId,
    predecessorClaimId: null,
    state: "current",
    writeAuthority: true,
    scopeReserved: true,
    deviceId: pseudonymousIdentifier("device", device),
    sessionId: pseudonymousIdentifier("session", sessionId),
    transitionCounter: 3,
    transitionDigest: hex("production-transition"),
    operationReceiptDigest: hex("production-claim-operation"),
    expiresAt,
  });
  let claims = [sourceClaim];
  const status = () => Object.freeze({
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "status",
    status: "ready",
    sequence: 42,
    ledgerRevision: cloudAuthority.ledgerRevision,
    ledgerDigest: cloudAuthority.ledgerDigest,
    claims,
  });
  const pushes = [];
  const pullReads = [];
  const remoteRef = ref => runGit(root, ["--git-dir", origin, "rev-parse", ref]);
  const basePull = () => {
    const headRefOid = remoteRef(`refs/heads/${branch}`);
    return {
      id: "PR_production",
      url: pullRequestUrl,
      state: "OPEN",
      isDraft: true,
      headRefName: branch,
      headRefOid,
      headRepository: { nameWithOwner: "acme/repo" },
      baseRefName: "main",
      baseRefOid: headRefOid === sourceFenceSha ? sourceBaseSha : protectedMainSha,
      body: pullBody,
    };
  };
  const createAdapter = (pullOverride = {}) => {
    const git = args => {
      if (args[0] === "remote" && args[1] === "get-url") {
        return "git@github.com:acme/repo.git";
      }
      if (args[0] === "push") {
        pushes.push([...args]);
        const translated = [...args];
        translated[2] = origin;
        return runGit(repository, translated);
      }
      return runGit(repository, args);
    };
    return createActiveOwnedDirtCurrentBaseReanchorRepositoryAdapter({
      repository,
      sessionId,
      taskAuthorityFile,
      journalFile,
    }, {
      captureEpochProof: () => targetEpochProofFixture({
        claimId,
        leaseEpoch: sourceClaim.leaseEpoch,
        transitionCounter: sourceClaim.transitionCounter,
        transitionDigest: sourceClaim.transitionDigest,
        repositoryId: sourceClaim.repositoryId,
        workItemId: sourceClaim.workItemId,
        writeSetDigest: sourceClaim.writeSetDigest,
      }),
      controllerRevision: protectedMainSha,
      gh: () => {
        const pull = { ...basePull(), ...pullOverride };
        pullReads.push(pull.headRefOid);
        return JSON.stringify(pull);
      },
      ghJson: () => ({ autoMergeRequest: null }),
      git,
      gitRaw: args => runGitRaw(repository, args),
      invoke: ({ action }) => {
        assert.equal(action, "status");
        return status();
      },
      leaseStore: Object.freeze({
        read: requestedBranch => {
          assert.equal(requestedBranch, branch);
          return lease;
        },
      }),
      now: () => new Date(operationAt),
      operationAt,
    });
  };
  return {
    branch,
    createAdapter,
    operationAt,
    protectedMainSha,
    pullBody,
    pullReads,
    pushes,
    remoteRef,
    reserveSuccessor(plan) {
      const successor = Object.freeze({
        ...sourceClaim,
        claimId: hex("production-successor-claim"),
        fenceRevision: hex("production-successor-fence"),
        canonicalBaseRevision: plan.targetCanonicalBaseSha,
        laneRevision: plan.targetLaneRevision,
        leaseEpoch: plan.targetCloudLeaseEpoch,
        reviewRequestId: null,
        predecessorClaimId: plan.sourceClaimId,
        state: "waiting-successor",
        writeAuthority: false,
        scopeReserved: false,
        transitionCounter: 1,
        transitionDigest: hex("production-successor-transition"),
        operationReceiptDigest: hex("production-successor-operation"),
      });
      claims = Object.freeze([sourceClaim, successor]);
      return Object.freeze({
        claimId: successor.claimId,
        claimDigest: successor.fenceRevision,
        transitionCounter: successor.transitionCounter,
        transitionDigest: successor.transitionDigest,
        operationReceiptDigest: successor.operationReceiptDigest,
        expiresAt: successor.expiresAt,
        state: successor.state,
      });
    },
    promoteSuccessor(plan) {
      const waiting = claims.find(item => item.state === "waiting-successor");
      assert.ok(waiting);
      const current = Object.freeze({
        ...waiting,
        state: "current",
        recordedState: "current",
        writeAuthority: true,
        scopeReserved: true,
        transitionCounter: waiting.transitionCounter + 1,
        fenceRevision: hex("production-promoted-fence"),
        transitionDigest: hex("production-promoted-transition"),
        operationReceiptDigest: hex("production-promoted-operation"),
      });
      claims = Object.freeze([current]);
      return Object.freeze({
        claimId: current.claimId,
        claimDigest: current.fenceRevision,
        transitionCounter: current.transitionCounter,
        transitionDigest: current.transitionDigest,
        operationReceiptDigest: current.operationReceiptDigest,
        expiresAt: current.expiresAt,
        state: current.state,
      });
    },
    repository,
    sourceFenceSha,
    untrackedFile,
  };
}

function repositoryIdentityFixture({ targetRepository, pullRequestUrl, branch }) {
  const remoteUrl = `git@github.com:${targetRepository}.git`;
  const core = {
    schema:
      "agentic-retired-abandoned-owned-dirt-repository-identity-witness/v1",
    targetRepository,
    originFetchUrl: remoteUrl,
    originFetchRepository: targetRepository,
    originPushUrl: remoteUrl,
    originPushRepository: targetRepository,
    pullRequestUrl,
    pullRequestRepository: targetRepository,
    headRepository: targetRepository,
    baseRepository: targetRepository,
    headRefName: branch,
    baseRefName: "main",
  };
  return { ...core, identityDigest: digestValue(core) };
}

function targetEpochProofFixture({
  claimId,
  leaseEpoch,
  transitionCounter,
  transitionDigest,
  repositoryId,
  workItemId,
  writeSetDigest,
  historicalClaims = [],
}) {
  const matchingClaims = [
    {
      claimId,
      leaseEpoch,
      transitionCounter,
      transitionDigest,
      state: "current",
    },
    ...historicalClaims,
  ].sort((left, right) => left.claimId.localeCompare(right.claimId));
  const maximumHistoricalLeaseEpoch = matchingClaims.reduce(
    (maximum, claim) => Math.max(maximum, claim.leaseEpoch),
    0,
  );
  const core = {
    schema:
      "agentic-active-owned-dirt-current-base-reanchor-target-epoch-proof/v1",
    ledgerRevision: objectId("epoch-ledger-revision"),
    ledgerDigest: hex("epoch-ledger-digest"),
    ledgerSequence: 42,
    ledgerEntriesDigest: hex("epoch-ledger-entries"),
    repositoryId,
    workItemId,
    writeSetDigest,
    matchingClaims,
    matchingClaimsDigest: digestValue(matchingClaims),
    maximumHistoricalLeaseEpoch,
    targetCloudLeaseEpoch: maximumHistoricalLeaseEpoch + 1,
  };
  return { ...core, proofDigest: digestValue(core) };
}

function runGit(cwd, args) {
  return String(execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })).trim();
}

function runGitRaw(cwd, args) {
  return String(execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }));
}

function phaseValues(phase) {
  const receiptDigest = hex(`${phase}-receipt`);
  if (phase === "source-authorized") return { receiptDigest };
  if (phase === "snapshotted") return {
    receiptDigest,
    snapshotReceiptDigest: hex("snapshot"),
  };
  if (phase === "successor-current") return {
    claimId: hex("successor-claim"),
    receiptDigest,
  };
  if (phase === "local-cas") return {
    receiptDigest,
    taskContinuationReceiptDigest: hex("task-continuation"),
  };
  if (phase === "verified") return {
    mutationAuthorityReceiptDigest: hex("mutation-authority"),
    receiptDigest,
  };
  return { receiptDigest };
}

function sealDirt(value) {
  const entries = value.entries.map(entry => ({ ...entry }))
    .sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  const core = {
    schema: value.schema,
    headSha: value.headSha,
    entries,
    pathCount: entries.length,
    stagedPathCount: entries.filter(entry => entry.staged).length,
    unstagedPathCount: entries.filter(entry => entry.unstaged).length,
    untrackedPathCount: entries.filter(entry => entry.untracked).length,
  };
  return { ...core, evidenceDigest: digestValue(core) };
}

function resealEvidence(value) {
  const { evidenceDigest: _ignored, ...core } = value;
  value.evidenceDigest = digestValue(core);
  return value;
}

function snapshotCounts(state) {
  return {
    captures: state.captureCount,
    effects: state.effects.length,
    fences: state.fences,
    reconciles: state.reconciles.length,
    writes: state.writes.length,
  };
}

function objectId(label) {
  return digestValue({ object: label }).slice(0, 40);
}

function hex(label) {
  return digestValue({ digest: label });
}
