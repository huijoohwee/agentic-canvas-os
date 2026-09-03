import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCTION_AUTHORIZATION_LOCAL_FORMATTER_PATH,
  PRODUCTION_RELEASE_AUTHORIZATION_SCHEMA,
  createProductionAuthorizationPrompt,
  createLocalReviewCandidate,
  createProductionReleaseCandidate,
  formatProductionAuthorizationPrompt,
  validateProductionAuthorizationPrompt,
  validateProductionReleaseAuthorization,
} from "../scripts/production-release-authorization-contract.mjs";
const sourceRevision = "a".repeat(40);
const sourceTree = "b".repeat(40);
const docsRevision = "c".repeat(40);
const docsTree = "d".repeat(40);
const runtime = {
  status: "runtime-ready",
  ready: true,
  source: { repository: "huijoohwee/agentic-graph", revision: sourceRevision },
  agenticCanvasOs: { repository: "huijoohwee/agentic-canvas-os", revision: docsRevision },
  catalogRevision: docsRevision,
  probes: { apex: 200, storage: 200, storageProxy: 200 },
  protectedChecks: { "agentic-graph": ["Integration Gate"], "agentic-canvas-os": ["test"] },
  ownershipTokenDigest: "e".repeat(64),
  host: "127.0.0.1",
  ports: { apex: 5173, storage: 8787 },
};
const trees = {
  source: { repository: "huijoohwee/agentic-graph", revision: sourceRevision, tree: sourceTree },
  agenticCanvasOs: { repository: "huijoohwee/agentic-canvas-os", revision: docsRevision, tree: docsTree },
};
const readiness = {
  schema: "agentic-os-production-runtime-readiness/v2",
  status: "verified-build",
  source: { repository: "huijoohwee/agentic-graph", revision: sourceRevision, tree: sourceTree },
  agenticCanvasOs: { repository: "huijoohwee/agentic-canvas-os", revision: docsRevision },
  catalogRevision: docsRevision,
  artifact: { algorithm: "sha256", digest: "f".repeat(64) },
  immutableManifest: { algorithm: "sha256", digest: "1".repeat(64) },
  mirror: { repository: "huijoohwee/huijoohwee" },
  surfaces: ["/", "/agentic-graph"],
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
    }),
    true,
  );
});
test("shared canonical hashing preserves the migrated runtime digest contract", () => {
  const localReview = createLocalReviewCandidate(runtime, trees);
  const candidate = createProductionReleaseCandidate(localReview, readiness);
  const prompt = createProductionAuthorizationPrompt(runtime, localReview, candidate, {
    runRef: "run:30426035584",
  });
  assert.equal(localReview.candidateDigest, "580e3778b93ae7c0b925cc353de76369b1f74e54b6ce823f4c0e96445812b2ed");
  assert.equal(candidate.candidateDigest, "91be61ed6dd10929e6b10d604a8bc345c94c92f0c6ba7a3ef6d9653dde2c7a3b");
  assert.equal(prompt.promptDigest, "3c84d92cd735bb47ced309923feaa4e65004178992cee130c6122c05f3a35a78");
});
for (const [name, mutate] of [
  ["source drift", current => { current.readiness = { ...current.readiness, source: { ...current.readiness.source, revision: "2".repeat(40) } }; }],
  ["Agentic Canvas OS drift", current => { current.readiness = {
    ...current.readiness,
    agenticCanvasOs: { ...current.readiness.agenticCanvasOs, revision: "2".repeat(40) },
    catalogRevision: "2".repeat(40),
  }; }],
  ["artifact rebuild", current => { current.readiness = { ...current.readiness, artifact: { algorithm: "sha256", digest: "2".repeat(64) } }; }],
  ["manifest rebuild", current => { current.readiness = { ...current.readiness, immutableManifest: { algorithm: "sha256", digest: "2".repeat(64) } }; }],
]) {
  test(`production authorization fails closed on ${name}`, () => {
    const localReview = createLocalReviewCandidate(runtime, trees);
    const candidate = createProductionReleaseCandidate(localReview, readiness);
    const current = {
      localReview,
      readiness,
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
    }),
    /malformed/,
  );
});
test("runtime-ready localhost review emits the exact future human authorization template", () => {
  const localReview = createLocalReviewCandidate(runtime, trees);
  const candidate = createProductionReleaseCandidate(localReview, readiness);
  const prompt = createProductionAuthorizationPrompt(runtime, localReview, candidate, {
    runRef: "run:30426035584",
  });
  assert.equal(validateProductionAuthorizationPrompt(prompt), prompt);
  assert.equal(
    formatProductionAuthorizationPrompt(prompt),
    [
      "The release is verified and awaiting fresh human authorization.",
      "",
      `Candidate: \`${candidate.candidateDigest}\``,
      `Source: \`${sourceRevision}\``,
      "Run: `run:30426035584`",
      "localhost: `http://127.0.0.1:5173/`",
      `Local formatter source: \`${PRODUCTION_AUTHORIZATION_LOCAL_FORMATTER_PATH}\``,
      "",
      "Template: `agentic-canvas-os/scripts/production-release-authorization-contract.mjs`",
      "",
      "Reply exactly:",
      "",
      `\`authorize ${candidate.candidateDigest}\``,
    ].join("\n"),
  );
});
test("authorization prompt accepts a redacted runtime ownership token when the reviewed identity still matches", () => {
  const localReview = createLocalReviewCandidate(runtime, trees);
  const candidate = createProductionReleaseCandidate(localReview, readiness);
  const prompt = createProductionAuthorizationPrompt({
    ...runtime,
    ownershipTokenDigest: "[redacted]",
  }, localReview, candidate, {
    runRef: "run:30426035584",
  });
  assert.equal(prompt.candidateDigest, candidate.candidateDigest);
});
test("authorization prompt fails closed without current runtime readiness or a bound loopback review surface", () => {
  const localReview = createLocalReviewCandidate(runtime, trees);
  const candidate = createProductionReleaseCandidate(localReview, readiness);
  for (const drift of [
    { status: "blocked", ready: false },
    { host: "review.example.test" },
    { ports: { ...runtime.ports, apex: 0 } },
    { probes: { ...runtime.probes, apex: 503 } },
  ]) {
    assert.throws(
      () => createProductionAuthorizationPrompt(
        { ...runtime, ...drift },
        localReview,
        candidate,
        { runRef: "run:30426035584" },
      ),
      /runtime-ready|loopback|probes|drifted/,
    );
  }
});
test("authorization prompt rejects candidate, source, run-reference, and rendered-evidence drift", () => {
  const localReview = createLocalReviewCandidate(runtime, trees);
  const candidate = createProductionReleaseCandidate(localReview, readiness);
  assert.throws(
    () => createProductionAuthorizationPrompt(runtime, localReview, {
      ...candidate,
      localReviewCandidateDigest: "2".repeat(64),
    }, { runRef: "run:30426035584" }),
    /digest|drifted/,
  );
  assert.throws(
    () => createProductionAuthorizationPrompt(runtime, localReview, candidate, {
      runRef: "run with whitespace",
    }),
    /bounded run reference/,
  );
  const prompt = createProductionAuthorizationPrompt(runtime, localReview, candidate, {
    runRef: "run:30426035584",
  });
  assert.throws(
    () => validateProductionAuthorizationPrompt({
      ...prompt,
      localhostReviewUrl: "https://review.example.test/",
    }),
    /localhost|malformed/,
  );
});
