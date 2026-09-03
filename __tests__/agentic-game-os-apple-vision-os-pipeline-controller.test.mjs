// Responsibility: Prove the Agentic Game OS pipeline controller preserves stage order, digest identity, clean-Dev evidence, and one-use deploy gates.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import fc from "fast-check";

import {
  AGENTIC_GAME_OS_PIPELINE_AUDIT_SCHEMA,
  AGENTIC_GAME_OS_PIPELINE_SCHEMA,
  createPipelineController,
} from "../scripts/pipeline-controller.mjs";

const NOW = Date.parse("2026-08-09T12:00:00.000Z");
const DEV_ROOT = path.resolve("fixtures/agentic-graph");
const candidate = Object.freeze({
  sourceRevision: "a".repeat(40),
  artifactDigest: "b".repeat(64),
  pinStatus: "matched",
});
const cleanGitEvidence = Object.freeze({
  root: DEV_ROOT,
  remote: "git@github.com:huijoohwee/agentic-graph.git",
  branch: "main",
  status: "",
  headRevision: candidate.sourceRevision,
  originMainRevision: candidate.sourceRevision,
});

function authorization(targetStage, overrides = {}) {
  return {
    authorizationId: `${targetStage}-authorization`,
    operatorIdentity: "github-user:8945812",
    targetStage,
    candidateRevision: candidate.sourceRevision,
    candidateDigest: candidate.artifactDigest,
    issuedAtMs: NOW - 1_000,
    ...overrides,
  };
}

function harness(overrides = {}, { gitEvidence = cleanGitEvidence } = {}) {
  const calls = { dev: 0, checks: 0, prod: 0, prodVerifications: 0, deliveryInspections: 0, delivery: 0, deliveryVerifications: 0 };
  const adapters = {
    async startDev({ candidate: requestedCandidate, worktree }) {
      calls.dev += 1;
      return { reachable: true, sourceRevision: requestedCandidate.sourceRevision, repositoryPath: worktree.repositoryPath };
    },
    async checkDeployGate({ authorization: value }) {
      calls.checks += 1;
      return value;
    },
    async writeProdMirror() {
      calls.prod += 1;
      return { completed: true };
    },
    async verifyProdMirror() {
      calls.prodVerifications += 1;
      return { sourceRevision: candidate.sourceRevision, artifactDigest: candidate.artifactDigest };
    },
    async inspectDeliveryArtifact() {
      calls.deliveryInspections += 1;
      return { artifactDigest: candidate.artifactDigest };
    },
    async deployDeliverySurface() {
      calls.delivery += 1;
      return { completed: true };
    },
    async verifyDeliverySurface() {
      calls.deliveryVerifications += 1;
      return { reachable: true, sourceRevision: candidate.sourceRevision, artifactDigest: candidate.artifactDigest };
    },
    ...overrides,
  };
  return {
    calls,
    controller: createPipelineController({
      candidate,
      adapters,
      devRepositoryPath: DEV_ROOT,
      runGit: async ({ args }) => gitOutput(args, gitEvidence),
      now: () => NOW,
      authorizationTimeoutMs: 5,
      devTimeoutMs: 5,
    }),
  };
}

async function completeDev(controller) {
  return controller.runDev({ command: "npm run dev:apex" });
}

async function completeProd(controller, supplied = authorization("prod-mirror")) {
  return controller.advanceProdMirror({ authorization: supplied });
}

test("clean canonical Dev can report only local-runtime-ready", async () => {
  const { controller, calls } = harness();
  const result = await completeDev(controller);
  assert.equal(result.ok, true);
  assert.equal(result.status, "local-runtime-ready");
  assert.equal(calls.dev, 1);
  assert.equal(result.pipeline.schema, AGENTIC_GAME_OS_PIPELINE_SCHEMA);
  assert.equal(result.pipeline.stages["prod-mirror"], null);
  assert.equal(result.pipeline.stages["delivery-surface"], null);
});

test("repository-owned inspection rejects wrong, dirty, untracked, stale, or non-main Dev state", async () => {
  for (const gitEvidence of [
    { ...cleanGitEvidence, remote: "git@github.com:huijoohwee/GameXR.git" },
    { ...cleanGitEvidence, root: path.resolve("fixtures/other") },
    { ...cleanGitEvidence, branch: "agent/device/scope" },
    { ...cleanGitEvidence, status: " M src/runtime.ts" },
    { ...cleanGitEvidence, status: "?? local.txt" },
    { ...cleanGitEvidence, originMainRevision: "c".repeat(40) },
  ]) {
    const { controller, calls } = harness({}, { gitEvidence });
    const result = await controller.runDev({
      command: "npm run dev",
      worktree: { branch: "main", trackedFileModificationCount: 0, untrackedFileCount: 0 },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "unclean-worktree");
    assert.equal(calls.dev, 0);
  }
});

test("gated stages cannot run out of order", async () => {
  const { controller, calls } = harness();
  const prod = await completeProd(controller);
  assert.equal(prod.error.code, "stage-order");
  assert.equal(calls.checks, 0);
  assert.equal(calls.prod, 0);

  const delivery = await controller.advanceDeliverySurface({
    artifactDigest: candidate.artifactDigest,
    authorization: authorization("delivery-surface"),
  });
  assert.equal(delivery.error.code, "stage-order");
  assert.equal(calls.delivery, 0);
});

test("a pin-mismatched artifact is retained and never offered to the gate or mirror", async () => {
  const calls = { checks: 0, prod: 0 };
  const controller = createPipelineController({
    candidate: { ...candidate, pinStatus: "pin-mismatched", pinMismatch: { dependency: "grph-shared" } },
    now: () => NOW,
    adapters: {
      startDev: async ({ candidate: requestedCandidate, worktree }) => ({
        reachable: true,
        sourceRevision: requestedCandidate.sourceRevision,
        repositoryPath: worktree.repositoryPath,
      }),
      checkDeployGate: async () => { calls.checks += 1; return authorization("prod-mirror"); },
      writeProdMirror: async () => { calls.prod += 1; return { completed: true }; },
      verifyProdMirror: async () => ({ sourceRevision: candidate.sourceRevision, artifactDigest: candidate.artifactDigest }),
      inspectDeliveryArtifact: async () => ({ artifactDigest: candidate.artifactDigest }),
      deployDeliverySurface: async () => ({ completed: true }),
      verifyDeliverySurface: async () => ({ reachable: true, sourceRevision: candidate.sourceRevision, artifactDigest: candidate.artifactDigest }),
    },
    devRepositoryPath: DEV_ROOT,
    runGit: async ({ args }) => gitOutput(args, cleanGitEvidence),
  });
  await completeDev(controller);
  const result = await completeProd(controller);
  assert.equal(result.error.code, "pin-mismatch");
  assert.equal(result.error.artifactDigest, candidate.artifactDigest);
  assert.equal(result.error.dependency, "grph-shared");
  assert.deepEqual(calls, { checks: 0, prod: 0 });
});

test("Feature: agentic-game-os-apple-vision-os, Property 39: Deploy gate is fail closed", async () => {
  const cases = [
    null,
    authorization("prod-mirror", { operatorIdentity: "" }),
    authorization("delivery-surface"),
    authorization("prod-mirror", { candidateRevision: "c".repeat(40) }),
    authorization("prod-mirror", { candidateDigest: "d".repeat(64) }),
    authorization("prod-mirror", { issuedAtMs: NOW - 60 * 60 * 1000 - 1 }),
    authorization("prod-mirror", { issuedAtMs: NOW + 1 }),
  ];
  await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: cases.length - 1 }), async (index) => {
    const { controller, calls } = harness();
    await completeDev(controller);
    const result = await completeProd(controller, cases[index]);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "authorization-missing");
    assert.equal(calls.prod, 0);
    assert.equal(result.pipeline.auditEntries.filter((entry) => entry.stage === "prod-mirror").length, 1);
  }), { numRuns: 100, seed: 39 });
});

test("authorization check errors and timeouts are not retried", async () => {
  for (const checkDeployGate of [
    async () => { throw new Error("provider error"); },
    async () => new Promise(() => {}),
  ]) {
    const { controller, calls } = harness({ checkDeployGate: async (input) => {
      calls.checks += 1;
      return checkDeployGate(input);
    } });
    await completeDev(controller);
    const result = await completeProd(controller);
    assert.equal(result.error.code, "authorization-missing");
    assert.equal(calls.checks, 1);
    assert.equal(calls.prod, 0);
  }
});

test("a consumed authorization cannot mutate twice", async () => {
  const { controller, calls } = harness();
  await completeDev(controller);
  assert.equal((await completeProd(controller)).ok, true);
  const replay = await controller.advanceDeliverySurface({
    authorization: authorization("delivery-surface", { authorizationId: "prod-mirror-authorization" }),
  });
  assert.equal(replay.error.code, "authorization-missing");
  assert.deepEqual(replay.error.fields, ["authorizationId-consumed"]);
  assert.equal(calls.prod, 1);
  assert.equal(calls.delivery, 0);
});

test("Feature: agentic-game-os-apple-vision-os, Property 40: Pipeline digest continuity", async () => {
  await fc.assert(fc.asyncProperty(
    fc.hexaString({ minLength: 64, maxLength: 64 }).filter((value) => value !== candidate.artifactDigest),
    async (observedDigest) => {
      const { controller, calls } = harness({
        async inspectDeliveryArtifact() {
          calls.deliveryInspections += 1;
          return { artifactDigest: observedDigest };
        },
      });
      await completeDev(controller);
      await completeProd(controller);
      const result = await controller.advanceDeliverySurface({
        authorization: authorization("delivery-surface"),
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "digest-mismatch");
      assert.equal(result.error.recordedDigest, candidate.artifactDigest);
      assert.equal(result.error.observedDigest, observedDigest);
      assert.equal(calls.delivery, 0);
    },
  ), { numRuns: 100, seed: 40 });
});

test("one candidate reaches production readiness with immutable per-stage audit", async () => {
  let recordedCandidate;
  const { controller, calls } = harness({
    async writeProdMirror(input) {
      calls.prod += 1;
      recordedCandidate = input.recordedCandidate;
      return { completed: true };
    },
  });
  await completeDev(controller);
  await completeProd(controller);
  const result = await controller.advanceDeliverySurface({
    authorization: authorization("delivery-surface"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "production-runtime-ready");
  assert.deepEqual(calls, { dev: 1, checks: 2, prod: 1, prodVerifications: 1, deliveryInspections: 1, delivery: 1, deliveryVerifications: 1 });
  assert.deepEqual(recordedCandidate, {
    stage: "prod-mirror",
    sourceRevision: candidate.sourceRevision,
    artifactDigest: candidate.artifactDigest,
    outcome: "pending",
  });
  assert.deepEqual(result.pipeline.auditEntries.map((entry) => entry.outcome), ["completed", "completed", "completed"]);
  for (const entry of result.pipeline.auditEntries) {
    assert.equal(entry.schema, AGENTIC_GAME_OS_PIPELINE_AUDIT_SCHEMA);
    assert.equal(entry.sourceRevision, candidate.sourceRevision);
    assert.equal(entry.artifactDigest, candidate.artifactDigest);
    assert.equal(Object.isFrozen(entry), true);
  }
  assert.equal(result.pipeline.consumedAuthorizationIds.length, 2);
});

test("concurrent gated requests serialize before authorization consumption and mutation", async () => {
  let releaseGate;
  let gateStarted;
  const started = new Promise((resolve) => { gateStarted = resolve; });
  const { controller, calls } = harness({
    checkDeployGate: async ({ authorization: value }) => {
      calls.checks += 1;
      gateStarted();
      return new Promise((resolve) => { releaseGate = () => resolve(value); });
    },
  });
  await completeDev(controller);
  const first = controller.advanceProdMirror({ authorization: authorization("prod-mirror") });
  await started;
  const second = await controller.advanceProdMirror({ authorization: authorization("prod-mirror") });
  assert.equal(second.error.code, "pipeline-busy");
  assert.equal(calls.checks, 1);
  assert.equal(calls.prod, 0);
  releaseGate();
  assert.equal((await first).ok, true);
  assert.equal(calls.prod, 1);
  assert.deepEqual(controller.read().auditEntries.filter((entry) => entry.stage === "prod-mirror").map((entry) => entry.outcome), ["rejected", "completed"]);
});

test("delivered readiness requires an independent exact revision and digest read", async () => {
  const { controller, calls } = harness({
    async verifyDeliverySurface() {
      calls.deliveryVerifications += 1;
      return { reachable: true, sourceRevision: candidate.sourceRevision, artifactDigest: "f".repeat(64) };
    },
  });
  await completeDev(controller);
  await completeProd(controller);
  const result = await controller.advanceDeliverySurface({ authorization: authorization("delivery-surface") });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "digest-mismatch");
  assert.equal(result.status, "local-runtime-ready");
  assert.equal(calls.delivery, 1);
  assert.equal(calls.deliveryVerifications, 1);
});

test("Prod completion requires an independent exact revision and digest read", async () => {
  const { controller, calls } = harness({
    async verifyProdMirror() {
      calls.prodVerifications += 1;
      return { sourceRevision: candidate.sourceRevision, artifactDigest: "f".repeat(64) };
    },
  });
  await completeDev(controller);
  const result = await completeProd(controller);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "prod-mirror-rejected");
  assert.equal(result.error.observedDigest, "f".repeat(64));
  assert.equal(result.status, "local-runtime-ready");
  assert.equal(calls.prod, 1);
  assert.equal(calls.prodVerifications, 1);
});

test("public timeout overrides cannot exceed the mandatory bounds", async () => {
  let observedDevDeadline = null;
  let observedAuthorizationDeadline = null;
  const controller = createPipelineController({
    candidate,
    adapters: {
      startDev: async ({ candidate: requestedCandidate, worktree, deadlineMs }) => {
        observedDevDeadline = deadlineMs;
        return { reachable: true, sourceRevision: requestedCandidate.sourceRevision, repositoryPath: worktree.repositoryPath };
      },
      checkDeployGate: async ({ authorization: value, deadlineMs }) => {
        observedAuthorizationDeadline = deadlineMs;
        return value;
      },
      writeProdMirror: async () => ({ completed: true }),
      verifyProdMirror: async () => ({ sourceRevision: candidate.sourceRevision, artifactDigest: candidate.artifactDigest }),
      inspectDeliveryArtifact: async () => ({ artifactDigest: candidate.artifactDigest }),
      deployDeliverySurface: async () => ({ completed: true }),
      verifyDeliverySurface: async () => ({ reachable: true, sourceRevision: candidate.sourceRevision, artifactDigest: candidate.artifactDigest }),
    },
    devRepositoryPath: DEV_ROOT,
    runGit: async ({ args }) => gitOutput(args, cleanGitEvidence),
    now: () => NOW,
    authorizationTimeoutMs: Number.POSITIVE_INFINITY,
    devTimeoutMs: Number.POSITIVE_INFINITY,
  });
  await controller.runDev({ command: "npm run dev" });
  await controller.advanceProdMirror({ authorization: authorization("prod-mirror") });
  assert.equal(observedDevDeadline, 120_000);
  assert.equal(observedAuthorizationDeadline, 10_000);
});

function gitOutput(args, evidence) {
  const command = args.join(" ");
  if (command === "rev-parse --show-toplevel") return `${evidence.root}\n`;
  if (command === "remote get-url origin") return `${evidence.remote}\n`;
  if (command === "symbolic-ref --quiet --short HEAD") return `${evidence.branch}\n`;
  if (command === "status --porcelain=v1 --untracked-files=all") return evidence.status === "" ? "" : `${evidence.status}\n`;
  if (command === "rev-parse HEAD") return `${evidence.headRevision}\n`;
  if (command === "rev-parse origin/main") return `${evidence.originMainRevision}\n`;
  throw new Error(`Unexpected git arguments: ${command}`);
}
