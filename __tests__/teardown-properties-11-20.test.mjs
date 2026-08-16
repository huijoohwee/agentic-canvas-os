import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import {
  deletionDecision,
  validateLifecycleKeyTransition,
  validateSurvivingSetDisjointness,
} from "../scripts/teardown-inventory.mjs";
import {
  compareRouteStatuses,
  deriveReadiness,
  PRESERVED_ROUTE_SET,
  workerFirstMatches,
} from "../scripts/teardown-route-baseline.mjs";
import {
  reductionPercentage,
  thresholdBreaches,
  validateSurfaceCoverage,
} from "../scripts/teardown-measure.mjs";
import { firstOffender } from "../scripts/state-path-check.mjs";

const property = (name, arbitrary, predicate) => test(name, () => (
  fc.assert(fc.property(arbitrary, predicate), { numRuns: 100 })
));
const readinessKeys = ["configured", "auth", "controlPlane", "modelProviders", "functionCalling"];
const identifier = fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/u);
const pathArbitrary = identifier.map(value => `scripts/${value}.mjs`);

// Feature: repository-teardown, Property 11: Route status preservation.
property("Property 11: route comparison detects exactly the changed statuses", fc.array(fc.integer({ min: 100, max: 599 }), { minLength: 17, maxLength: 17 }), statuses => {
  const baseline = PRESERVED_ROUTE_SET.map((route, index) => ({ ...route, status: statuses[index] }));
  assert.deepEqual(compareRouteStatuses({ baseline, observed: structuredClone(baseline) }), []);
  const observed = structuredClone(baseline);
  observed[0].status = observed[0].status === 599 ? 598 : observed[0].status + 1;
  assert.deepEqual(compareRouteStatuses({ baseline, observed }), [observed[0]]);
});

// Feature: repository-teardown, Property 12: Readiness is derived from bindings and reports only five keys.
property("Property 12: readiness is binding-derived and has exactly five booleans", fc.record({
  api: fc.boolean(), review: fc.boolean(), control: fc.boolean(), model: fc.boolean(), functionCalling: fc.boolean(),
}), flags => {
  const bindings = {
    ...(flags.api ? { AGENT_API_JWT_SECRET: "set" } : {}),
    ...(flags.review ? { AGENT_REVIEW_JWT_SECRET: "set" } : {}),
    ...(flags.control ? { CONTROL_PLANE_URL: "set" } : {}),
    ...(flags.model ? { MODEL_PROVIDER: "set" } : {}),
    ...(flags.functionCalling ? { FUNCTION_CALLING: "set" } : {}),
  };
  const readiness = deriveReadiness(bindings);
  assert.deepEqual(Object.keys(readiness), readinessKeys);
  assert.ok(Object.values(readiness).every(value => typeof value === "boolean"));
  assert.equal(readiness.configured, flags.api && flags.review && flags.control && flags.model);
});

// Feature: repository-teardown, Property 13: Worker configuration invariants.
property("Property 13: worker-first literals and API globs preserve matching without capturing root", fc.constantFrom(...PRESERVED_ROUTE_SET.map(item => item.path)), requestPath => {
  assert.equal(workerFirstMatches(requestPath, requestPath), true);
  assert.equal(workerFirstMatches("/api/*", requestPath), requestPath.startsWith("/api/"));
  assert.equal(workerFirstMatches("/api/*", "/"), false);
  assert.equal(workerFirstMatches("/*", "/"), false);
});

// Feature: repository-teardown, Property 14: Surviving tests cover the surviving surface.
property("Property 14: coverage requires every unique surviving subject", fc.uniqueArray(pathArbitrary, { maxLength: 20 }), surface => {
  assert.equal(validateSurfaceCoverage({ surface, covered: surface }), true);
  if (surface.length) {
    assert.equal(validateSurfaceCoverage({ surface, covered: surface.slice(1) }), false);
  }
});

// Feature: repository-teardown, Property 15: Threshold breaches report incomplete.
property("Property 15: each exceeded production threshold emits one row", fc.record({
  files: fc.integer({ min: 0, max: 100 }), lines: fc.integer({ min: 0, max: 10000 }),
}), value => {
  const breaches = thresholdBreaches(new Map([
    ["scripts/.files", value.files], ["scripts/.lines", value.lines],
  ])).filter(item => item.threshold.startsWith("scripts/"));
  assert.deepEqual(breaches.map(item => item.threshold), [
    ...(value.files > 15 ? ["scripts/.files"] : []),
    ...(value.lines > 3000 ? ["scripts/.lines"] : []),
  ]);
});

// Feature: repository-teardown, Property 16: State Path Check reports the first offender and nothing else.
property("Property 16: first-offender ordering is file then source line", fc.tuple(identifier, identifier), ([first, second]) => {
  const sources = new Map([
    ["scripts/b.mjs", `mkdirSync("../${second}")`],
    ["scripts/a.mjs", `mkdirSync("inside")\nmkdirSync("../${first}")`],
  ]);
  const offender = firstOffender({
    repositoryRoot: "/repository",
    files: [...sources.keys()],
    read: file => sources.get(file.replace("/repository/", "")),
  });
  assert.equal(offender.file, "scripts/a.mjs");
  assert.equal(offender.line, 2);
  assert.equal(offender.target, `/${first}`);
});

// Feature: repository-teardown, Property 17: Retention monotonicity.
property("Property 17: adding unresolved evidence cannot create deletion authority", fc.boolean(), archiveCovered => {
  const base = { path: "scripts/x.mjs", classification: "dead", unresolvedReferences: [] };
  const before = deletionDecision(base, { archiveCovered });
  const after = deletionDecision({ ...base, unresolvedReferences: ["ambiguous"] }, { archiveCovered });
  assert.equal(after.removable, false);
  assert.ok(!after.removable || before.removable);
});

// Feature: repository-teardown, Property 18: Reduction arithmetic and measurement integrity.
property("Property 18: production reduction arithmetic reconstructs the current count", fc.record({
  baseline: fc.integer({ min: 1, max: 100000 }),
  current: fc.integer({ min: 0, max: 100000 }),
}).filter(value => value.current <= value.baseline), ({ baseline, current }) => {
  const reduction = reductionPercentage(baseline, current);
  assert.ok(reduction >= 0 && reduction <= 100);
  assert.ok(Math.abs(current - baseline * (1 - reduction / 100)) < 1e-9);
});

// Feature: repository-teardown, Property 19: Lifecycle script keys are absent at completion and intact before their stage.
property("Property 19: lifecycle keys remain byte-exact before stage 7 and absent after", fc.dictionary(identifier, identifier, { maxKeys: 20 }), extras => {
  const lifecycle = { "device:start": "node scripts/device.mjs", "turn:end": "node scripts/end.mjs" };
  const before = { ...extras, ...lifecycle };
  assert.equal(validateLifecycleKeyTransition({ before, after: structuredClone(before), assignedStageReached: false }), true);
  assert.equal(validateLifecycleKeyTransition({ before, after: extras, assignedStageReached: true }), true);
  assert.equal(validateLifecycleKeyTransition({ before, after: { ...extras, "device:start": "changed" }, assignedStageReached: false }), false);
});

// Feature: repository-teardown, Property 20: Surviving tests and documents are disjoint from the lifecycle layer.
property("Property 20: production disjointness rejects every lifecycle survivor", fc.uniqueArray(pathArbitrary, { maxLength: 30 }), paths => {
  const lifecyclePaths = paths.filter((_, index) => index % 2 === 0);
  const survivingPaths = paths.filter(path => !lifecyclePaths.includes(path));
  assert.equal(validateSurvivingSetDisjointness({ survivingPaths, lifecyclePaths }), true);
  if (lifecyclePaths.length) {
    assert.equal(validateSurvivingSetDisjointness({ survivingPaths: [...survivingPaths, lifecyclePaths[0]], lifecyclePaths }), false);
  }
});
