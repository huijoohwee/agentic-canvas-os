import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createIntegrationPlan,
  deriveIntegrationWaves,
  recordBlockedUnit,
  recordCanonicalDisposition,
  recordProtectedIntegration,
  sealReleaseFrontier,
} from "../scripts/integration-order-contract.mjs";

const digest = (character) => character.repeat(64);

function unit({
  unitId,
  dependencies = [],
  writeScopes = [`scope/${unitId}`],
  kind = "source",
  runtimeImpact = false,
  changeDigest = digest(unitId.at(0)),
}) {
  return {
    unitId,
    sourceRevision: `${unitId}-revision`,
    changeDigest,
    writeScopes,
    dependencies,
    kind,
    namedChecks: [`check-${unitId}`],
    runtimeImpact,
  };
}

function plan(units) {
  return createIntegrationPlan({
    frontierRevision: "canonical-1",
    dependencyClosureDigest: digest("a"),
    units,
  });
}

function integrate(currentPlan, unitId, {
  protectedRevision = `${currentPlan.frontier.revision}-${unitId}`,
  runtimeConvergenceDigest = null,
} = {}) {
  return recordProtectedIntegration(currentPlan, {
    unitId,
    baseFrontierRevision: currentPlan.frontier.revision,
    protectedRevision,
    dependencyClosureDigest: digest("b"),
    integrationReceiptDigest: digest("c"),
    exactCanonicalChecksDigest: digest("d"),
    runtimeConvergenceDigest,
  });
}

test("plan identity and waves are deterministic across input order", () => {
  const units = [
    unit({ unitId: "control", kind: "control", changeDigest: digest("1") }),
    unit({
      unitId: "source",
      dependencies: ["control"],
      kind: "source",
      changeDigest: digest("2"),
    }),
    unit({
      unitId: "projection",
      dependencies: ["source"],
      kind: "projection",
      changeDigest: digest("3"),
    }),
  ];
  const forward = plan(units);
  const reverse = plan([...units].reverse());

  assert.equal(forward.planDigest, reverse.planDigest);
  assert.deepEqual(deriveIntegrationWaves(forward), [
    ["control"],
    ["source"],
    ["projection"],
  ]);
});

test("a wave contains only ready units with disjoint write scopes", () => {
  const integrationPlan = plan([
    unit({ unitId: "alpha", writeScopes: ["shared"], changeDigest: digest("1") }),
    unit({ unitId: "beta", writeScopes: ["shared"], changeDigest: digest("2") }),
    unit({ unitId: "gamma", writeScopes: ["independent"], changeDigest: digest("3") }),
  ]);

  assert.deepEqual(deriveIntegrationWaves(integrationPlan), [
    ["alpha", "gamma"],
    ["beta"],
  ]);
});

test("invalid dependency graphs and duplicate change identities fail closed", () => {
  assert.throws(() => plan([
    unit({ unitId: "alpha", dependencies: ["missing"], changeDigest: digest("1") }),
  ]), /Unknown dependency/);
  assert.throws(() => plan([
    unit({ unitId: "alpha", dependencies: ["beta"], changeDigest: digest("1") }),
    unit({ unitId: "beta", dependencies: ["alpha"], changeDigest: digest("2") }),
  ]), /cycle/);
  assert.throws(() => plan([
    unit({ unitId: "alpha", changeDigest: digest("1") }),
    unit({ unitId: "beta", changeDigest: digest("1") }),
  ]), /changeDigest values must be unique/);
});

test("a consumer cannot integrate before its dependency", () => {
  const integrationPlan = plan([
    unit({ unitId: "contract", kind: "contract", changeDigest: digest("1") }),
    unit({
      unitId: "consumer",
      dependencies: ["contract"],
      kind: "consumer",
      changeDigest: digest("2"),
    }),
  ]);

  assert.throws(() => integrate(integrationPlan, "consumer"), /unresolved dependencies/);
});

test("canonical no-op and supersession dispositions require explicit evidence", () => {
  const integrationPlan = plan([
    unit({ unitId: "present", changeDigest: digest("1") }),
    unit({
      unitId: "replacement",
      dependencies: ["present"],
      changeDigest: digest("2"),
    }),
  ]);
  assert.throws(() => recordCanonicalDisposition(integrationPlan, {
    unitId: "present",
    status: "already-integrated",
    baseFrontierRevision: "canonical-1",
    canonicalRevision: "canonical-1",
    equivalenceCheckDigest: null,
    capabilityCoverageDigest: null,
  }), /equivalenceCheckDigest/);

  const noOpPlan = recordCanonicalDisposition(integrationPlan, {
    unitId: "present",
    status: "already-integrated",
    baseFrontierRevision: "canonical-1",
    canonicalRevision: "canonical-1",
    equivalenceCheckDigest: digest("e"),
    capabilityCoverageDigest: null,
  });
  assert.equal(noOpPlan.frontier.revision, "canonical-1");
  assert.equal(noOpPlan.units[0].status, "already-integrated");

  assert.throws(() => recordCanonicalDisposition(noOpPlan, {
    unitId: "replacement",
    status: "superseded",
    baseFrontierRevision: "canonical-1",
    canonicalRevision: "canonical-1",
    equivalenceCheckDigest: digest("e"),
    capabilityCoverageDigest: null,
  }), /capabilityCoverageDigest/);
});

test("protected integration advances only the current exact frontier", () => {
  const integrationPlan = plan([
    unit({ unitId: "source", changeDigest: digest("1") }),
  ]);
  assert.throws(() => recordProtectedIntegration(integrationPlan, {
    unitId: "source",
    baseFrontierRevision: "stale",
    protectedRevision: "canonical-2",
    dependencyClosureDigest: digest("b"),
    integrationReceiptDigest: digest("c"),
    exactCanonicalChecksDigest: digest("d"),
    runtimeConvergenceDigest: null,
  }), /stale frontier/);

  const integratedPlan = integrate(integrationPlan, "source", {
    protectedRevision: "canonical-2",
  });
  assert.equal(integratedPlan.frontier.revision, "canonical-2");
  assert.equal(integratedPlan.units[0].status, "integrated");
});

test("runtime-impact units require runtime convergence and source-only units reject it", () => {
  const runtimePlan = plan([
    unit({ unitId: "runtime", runtimeImpact: true, changeDigest: digest("1") }),
  ]);
  assert.throws(() => integrate(runtimePlan, "runtime"), /runtimeConvergenceDigest/);

  const sourcePlan = plan([
    unit({ unitId: "source", changeDigest: digest("2") }),
  ]);
  assert.throws(() => integrate(sourcePlan, "source", {
    runtimeConvergenceDigest: digest("f"),
  }), /without runtime impact/);
});

test("release sealing rejects blocked or unfinished units and stale frontier evidence", () => {
  const pendingPlan = plan([
    unit({ unitId: "source", changeDigest: digest("1") }),
  ]);
  const blockedPlan = recordBlockedUnit(pendingPlan, {
    unitId: "source",
    baseFrontierRevision: "canonical-1",
    reason: "required protected check failed",
  });
  assert.throws(() => sealReleaseFrontier(blockedPlan, {
    canonicalRevision: "canonical-1",
    dependencyClosureDigest: digest("a"),
    exactCanonicalChecksDigest: digest("d"),
    runtimeConvergenceDigest: null,
  }), /non-success units/);

  const integratedPlan = integrate(pendingPlan, "source", {
    protectedRevision: "canonical-2",
  });
  assert.throws(() => sealReleaseFrontier(integratedPlan, {
    canonicalRevision: "canonical-1",
    dependencyClosureDigest: digest("b"),
    exactCanonicalChecksDigest: digest("d"),
    runtimeConvergenceDigest: null,
  }), /canonical revision is stale/);
});

test("release frontier binds completed dispositions and exact-canonical evidence", () => {
  const integrationPlan = plan([
    unit({ unitId: "contract", kind: "contract", changeDigest: digest("1") }),
    unit({
      unitId: "runtime",
      dependencies: ["contract"],
      runtimeImpact: true,
      changeDigest: digest("2"),
    }),
  ]);
  const contractPlan = recordCanonicalDisposition(integrationPlan, {
    unitId: "contract",
    status: "already-integrated",
    baseFrontierRevision: "canonical-1",
    canonicalRevision: "canonical-1",
    equivalenceCheckDigest: digest("e"),
    capabilityCoverageDigest: null,
  });
  const completePlan = integrate(contractPlan, "runtime", {
    protectedRevision: "canonical-2",
    runtimeConvergenceDigest: digest("f"),
  });
  const releaseFrontier = sealReleaseFrontier(completePlan, {
    canonicalRevision: "canonical-2",
    dependencyClosureDigest: digest("b"),
    exactCanonicalChecksDigest: digest("d"),
    runtimeConvergenceDigest: digest("f"),
  });

  assert.equal(releaseFrontier.status, "sealed");
  assert.equal(releaseFrontier.canonicalRevision, "canonical-2");
  assert.match(releaseFrontier.sealDigest, /^[0-9a-f]{64}$/);
});

test("mutated plans are rejected even when their digest remains well shaped", () => {
  const integrationPlan = plan([
    unit({ unitId: "source", changeDigest: digest("1") }),
  ]);
  const mutated = structuredClone(integrationPlan);
  mutated.frontier.revision = "untrusted";

  assert.throws(() => deriveIntegrationWaves(mutated), /digest does not match/);
});

test("documentation keeps the neutral core separate from the reference adapter", async () => {
  const documentation = await readFile(
    new URL("../docs/INTEGRATION-ORDER.md", import.meta.url),
    "utf8",
  );
  const [neutralCore, referenceAdapter] = documentation.split(
    "## Agentic Canvas OS Reference Implementation",
  );

  assert.ok(referenceAdapter, "reference implementation section is required");
  assert.doesNotMatch(neutralCore, /GitHub|Cloudflare|Agentic Canvas OS|Knowgrph/);
  for (const phrase of [
    "Integration Unit",
    "Integration Frontier",
    "already-integrated",
    "superseded",
    "dependency closure",
    "exact-canonical",
    "runtime convergence",
    "release frontier",
  ]) {
    assert.match(documentation, new RegExp(phrase, "i"));
  }
});
