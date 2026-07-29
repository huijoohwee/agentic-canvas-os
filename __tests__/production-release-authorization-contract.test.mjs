import assert from "node:assert/strict";
import test from "node:test";

import {
  PRODUCTION_RELEASE_AUTHORIZATION_SCHEMA,
  createLocalReviewCandidate,
  createProductionReleaseCandidate,
  validateProductionReleaseAuthorization,
} from "../scripts/production-release-authorization-contract.mjs";

const sourceRevision = "a".repeat(40);
const sourceTree = "b".repeat(40);
const docsRevision = "c".repeat(40);
const docsTree = "d".repeat(40);

const runtime = {
  status: "runtime-ready",
  ready: true,
  source: { repository: "huijoohwee/knowgrph", revision: sourceRevision },
  agenticCanvasOs: { repository: "huijoohwee/agentic-canvas-os", revision: docsRevision },
  catalogRevision: docsRevision,
  probes: { apex: 200, storage: 200, storageProxy: 200 },
  protectedChecks: { knowgrph: ["Integration Gate"], "agentic-canvas-os": ["test"] },
  ownershipTokenDigest: "e".repeat(64),
};

const trees = {
  source: { repository: "huijoohwee/knowgrph", revision: sourceRevision, tree: sourceTree },
  agenticCanvasOs: { repository: "huijoohwee/agentic-canvas-os", revision: docsRevision, tree: docsTree },
};

const readiness = {
  schema: "knowgrph-production-runtime-readiness/v2",
  status: "verified-build",
  source: { repository: "huijoohwee/knowgrph", revision: sourceRevision, tree: sourceTree },
  agenticCanvasOs: { repository: "huijoohwee/agentic-canvas-os", revision: docsRevision },
  catalogRevision: docsRevision,
  artifact: { algorithm: "sha256", digest: "f".repeat(64) },
  immutableManifest: { algorithm: "sha256", digest: "1".repeat(64) },
  mirror: { repository: "huijoohwee/huijoohwee" },
  surfaces: ["/", "/knowgrph"],
};

function authorized(candidate) {
  return {
    schema: PRODUCTION_RELEASE_AUTHORIZATION_SCHEMA,
    status: "authorized",
    environment: "production",
    reviewer: "operator@example.test",
    authorizedAt: "2026-07-29T00:00:00.000Z",
    candidateDigest: candidate.candidateDigest,
  };
}

test("localhost review and production candidate bind exact source, trees, artifact, and manifest", () => {
  const localReview = createLocalReviewCandidate(runtime, trees);
  const candidate = createProductionReleaseCandidate(localReview, readiness);
  assert.equal(candidate.source.revision, sourceRevision);
  assert.equal(candidate.agenticCanvasOs.tree, docsTree);
  assert.equal(candidate.artifact.digest, readiness.artifact.digest);
  assert.equal(candidate.immutableManifest.digest, readiness.immutableManifest.digest);
  assert.equal(
    validateProductionReleaseAuthorization(candidate, authorized(candidate), {
      localReview,
      readiness,
      originMainSha: sourceRevision,
      localMainSha: sourceRevision,
      agenticCanvasOsSha: docsRevision,
    }),
    true,
  );
});

for (const [name, mutate] of [
  ["origin/main drift", current => { current.originMainSha = "2".repeat(40); }],
  ["local main drift", current => { current.localMainSha = "2".repeat(40); }],
  ["Agentic Canvas OS drift", current => { current.agenticCanvasOsSha = "2".repeat(40); }],
  ["artifact rebuild", current => { current.readiness = { ...current.readiness, artifact: { algorithm: "sha256", digest: "2".repeat(64) } }; }],
  ["manifest rebuild", current => { current.readiness = { ...current.readiness, immutableManifest: { algorithm: "sha256", digest: "2".repeat(64) } }; }],
]) {
  test(`production authorization fails closed on ${name}`, () => {
    const localReview = createLocalReviewCandidate(runtime, trees);
    const candidate = createProductionReleaseCandidate(localReview, readiness);
    const current = {
      localReview,
      readiness,
      originMainSha: sourceRevision,
      localMainSha: sourceRevision,
      agenticCanvasOsSha: docsRevision,
    };
    mutate(current);
    assert.throws(
      () => validateProductionReleaseAuthorization(candidate, authorized(candidate), current),
      /drifted/,
    );
  });
}

test("authorization cannot be reused for another candidate", () => {
  const localReview = createLocalReviewCandidate(runtime, trees);
  const candidate = createProductionReleaseCandidate(localReview, readiness);
  assert.throws(
    () => validateProductionReleaseAuthorization(candidate, {
      ...authorized(candidate),
      candidateDigest: "3".repeat(64),
    }, {
      localReview,
      readiness,
      originMainSha: sourceRevision,
      localMainSha: sourceRevision,
      agenticCanvasOsSha: docsRevision,
    }),
    /another candidate/,
  );
});

test("authorization rejects unknown fields", () => {
  const localReview = createLocalReviewCandidate(runtime, trees);
  const candidate = createProductionReleaseCandidate(localReview, readiness);
  assert.throws(
    () => validateProductionReleaseAuthorization(candidate, {
      ...authorized(candidate),
      inferredFromMerge: true,
    }, {
      localReview,
      readiness,
      originMainSha: sourceRevision,
      localMainSha: sourceRevision,
      agenticCanvasOsSha: docsRevision,
    }),
    /malformed/,
  );
});
