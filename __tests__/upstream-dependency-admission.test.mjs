import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  UPSTREAM_ADMISSION_SCHEMA,
  evaluateUpstreamDependencies,
} from "../agent-api/src/upstream-dependency-admission.js";

const revision = (character) => character.repeat(40);
const digest = (character) => character.repeat(64);
const evaluationTime = "2026-07-30T00:00:00.000Z";

function owner(ownerId = "source-owner", scopeId = "source/scope") {
  return { ownerId, scopeId, fenceRevision: revision("f") };
}

function fallback(type = "omit") {
  if (type === "protected-equivalent") {
    return {
      type,
      capabilityId: "equivalent-capability",
      sourceRevision: revision("e"),
      evidenceDigest: digest("e"),
    };
  }
  return { type, capabilityId: null, sourceRevision: null, evidenceDigest: null };
}

function dependency(overrides = {}) {
  return {
    dependencyId: "upstream",
    capabilityId: "required-capability",
    sourceRevision: revision("a"),
    sourceState: "protected",
    owners: [owner()],
    closureDigest: digest("c"),
    evidenceRevision: revision("a"),
    requiredChecks: [{ name: "source-check", status: "pass" }],
    consumers: ["consumer"],
    decisionDeadline: "2026-07-30T00:10:00.000Z",
    fallback: fallback(),
    projectionRequested: false,
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    evaluationTime,
    units: [
      { unitId: "consumer", dependencies: [] },
      { unitId: "downstream", dependencies: ["consumer"] },
      { unitId: "independent", dependencies: [] },
    ],
    dependencies: [dependency()],
    requestedPlanStop: false,
    ...overrides,
  };
}

test("protected source with joined evidence is eligible", () => {
  const result = evaluateUpstreamDependencies(input());

  assert.equal(result.schema, UPSTREAM_ADMISSION_SCHEMA);
  assert.equal(result.decisions[0].status, "eligible");
  assert.deepEqual(result.waitingUnits, []);
  assert.deepEqual(result.readyUnits, ["consumer", "downstream", "independent"]);
  assert.deepEqual(result.findings, []);
  assert.match(result.evidenceDigest, /^[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(result), true);
});

test("projection is admitted only when protected source evidence is eligible", () => {
  const result = evaluateUpstreamDependencies(input({
    dependencies: [dependency({ projectionRequested: true })],
  }));

  assert.equal(result.decisions[0].status, "eligible");
  assert.equal(
    result.findings.some((finding) => finding.type === "upstream-projection-premature"),
    false,
  );
});

test("candidate deferral isolates the exact consumer closure and continues disjoint work", () => {
  const result = evaluateUpstreamDependencies(input({
    dependencies: [dependency({
      sourceState: "candidate",
      fallback: fallback("defer"),
    })],
  }));

  assert.equal(result.decisions[0].status, "deferred");
  assert.deepEqual(result.waitingUnits, ["consumer", "downstream"]);
  assert.deepEqual(result.readyUnits, ["independent"]);
  assert.equal(result.nextEvaluationAt, "2026-07-30T00:10:00.000Z");
});

test("local-only source and premature projection fail closed", () => {
  const result = evaluateUpstreamDependencies(input({
    dependencies: [dependency({
      sourceState: "local-only",
      projectionRequested: true,
    })],
  }));

  assert.equal(result.decisions[0].status, "blocked");
  assert.deepEqual(
    result.findings.map((finding) => finding.type),
    ["upstream-projection-premature", "upstream-source-unadmitted"],
  );
  assert.deepEqual(result.readyUnits, ["independent"]);
});

test("ambiguous and overlapping owners are rejected", () => {
  const ambiguous = dependency({
    owners: [owner("alpha"), owner("beta")],
  });
  const result = evaluateUpstreamDependencies(input({ dependencies: [ambiguous] }));

  assert.equal(result.decisions[0].status, "blocked");
  assert.equal(
    result.findings.some((finding) => finding.type === "upstream-owner-ambiguous"),
    true,
  );

  const overlapping = evaluateUpstreamDependencies(input({
    dependencies: [
      dependency({ dependencyId: "alpha", owners: [owner("alpha", "shared")] }),
      dependency({
        dependencyId: "beta",
        sourceRevision: revision("b"),
        evidenceRevision: revision("b"),
        owners: [owner("beta", "shared")],
        consumers: ["independent"],
      }),
    ],
  }));
  assert.equal(
    overlapping.findings.filter((finding) => finding.type === "upstream-owner-ambiguous").length,
    2,
  );
});

test("stale source evidence invalidates protected eligibility", () => {
  const result = evaluateUpstreamDependencies(input({
    dependencies: [dependency({ evidenceRevision: revision("b") })],
  }));

  assert.equal(result.decisions[0].status, "blocked");
  assert.equal(result.findings[0].type, "upstream-evidence-stale");
});

test("elapsed candidate deadline applies omit or protected-equivalent fallback", () => {
  const omitted = evaluateUpstreamDependencies(input({
    dependencies: [dependency({
      sourceState: "candidate",
      decisionDeadline: "2026-07-29T23:59:00.000Z",
      fallback: fallback("omit"),
    })],
  }));
  assert.equal(omitted.decisions[0].fallbackApplied, "omit");
  assert.deepEqual(omitted.omittedUnits, ["consumer", "downstream"]);
  assert.deepEqual(omitted.readyUnits, ["independent"]);

  const superseded = evaluateUpstreamDependencies(input({
    dependencies: [dependency({
      sourceState: "candidate",
      decisionDeadline: "2026-07-29T23:59:00.000Z",
      fallback: fallback("protected-equivalent"),
    })],
  }));
  assert.equal(superseded.decisions[0].status, "superseded");
  assert.deepEqual(superseded.waitingUnits, []);
});

test("elapsed defer fallback cannot create an unbounded wait", () => {
  const result = evaluateUpstreamDependencies(input({
    dependencies: [dependency({
      sourceState: "candidate",
      decisionDeadline: "2026-07-29T23:59:00.000Z",
      fallback: fallback("defer"),
    })],
  }));

  assert.equal(result.decisions[0].status, "blocked");
  assert.equal(result.findings[0].type, "upstream-wait-unbounded");
  assert.equal(result.nextEvaluationAt, null);
});

test("an equivalent fallback cannot reuse the unprotected candidate revision", () => {
  const result = evaluateUpstreamDependencies(input({
    dependencies: [dependency({
      sourceState: "candidate",
      fallback: {
        type: "protected-equivalent",
        capabilityId: "equivalent-capability",
        sourceRevision: revision("a"),
        evidenceDigest: digest("e"),
      },
    })],
  }));

  assert.equal(result.decisions[0].status, "blocked");
  assert.equal(
    result.findings.some((finding) => finding.type === "upstream-fallback-invalid"),
    true,
  );
});

test("a plan-wide stop with continuable units emits an overblocking finding", () => {
  const result = evaluateUpstreamDependencies(input({
    dependencies: [dependency({ sourceState: "local-only" })],
    requestedPlanStop: true,
  }));

  assert.equal(result.readyUnits.includes("independent"), true);
  assert.equal(
    result.findings.some((finding) => finding.type === "upstream-plan-overblocked"),
    true,
  );
});

test("evaluation is deterministic across input order", () => {
  const first = evaluateUpstreamDependencies(input());
  const reordered = input({
    units: [...input().units].reverse(),
  });
  const second = evaluateUpstreamDependencies(reordered);

  assert.deepEqual(second, first);
});

test("structurally invalid inputs fail before evaluation", () => {
  assert.throws(
    () => evaluateUpstreamDependencies(input({ evaluationTime: "not-an-instant" })),
    /ISO-8601/,
  );
  assert.throws(
    () => evaluateUpstreamDependencies(input({
      units: [{ unitId: "consumer", dependencies: ["missing"] }],
    })),
    /Unknown plan dependency/,
  );
  assert.throws(
    () => evaluateUpstreamDependencies(input({
      dependencies: [dependency({ fallback: {
        type: "omit",
        capabilityId: "forbidden",
        sourceRevision: null,
        evidenceDigest: null,
      } })],
    })),
    /cannot carry equivalent-source evidence/,
  );
});

test("documentation binds the runtime to exact protected guideline provenance", async () => {
  const documentation = await readFile(
    new URL("../docs/UPSTREAM-DEPENDENCY-ADMISSION.md", import.meta.url),
    "utf8",
  );
  assert.match(documentation, /\nstatus: "runtime-ready"\n/);
  assert.match(documentation, /\nguideline_source_version: "1\.7\.0"\n/);
  assert.match(documentation, /\nguideline_module_version: "1\.0\.0"\n/);
  assert.match(
    documentation,
    /\nguideline_source_revision: "389c24aa0d292d292334ce020703b83c8ea55cb6"\n/,
  );
  assert.match(
    documentation,
    /\nguideline_module_digest: "08fc3a2e4525b4a39611167eba6ac11fe4895205d86b6d4005ea1ad17685dad7"\n/,
  );
  const [neutralCore, referenceAdapter] = documentation.split(
    "## Agentic Canvas OS Reference Implementation",
  );
  assert.ok(referenceAdapter);
  assert.doesNotMatch(neutralCore, /GitHub|Cloudflare|Agentic Canvas OS|agentic-graph|localhost/);
});
