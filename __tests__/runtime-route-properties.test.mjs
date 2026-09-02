import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";

import {
  compareRouteStatuses,
  deriveReadiness,
  PRESERVED_ROUTE_SET,
  workerFirstMatches,
} from "../scripts/runtime-route-contract.mjs";
import { firstOffender } from "../scripts/state-path-check.mjs";

const property = (name, arbitrary, predicate) => test(name, () => (
  fc.assert(fc.property(arbitrary, predicate), { numRuns: 100 })
));
const readinessKeys = ["configured", "auth", "controlPlane", "modelProviders", "functionCalling"];
const identifier = fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/u);

property(
  "route comparison detects exactly the changed product statuses",
  fc.array(fc.integer({ min: 100, max: 599 }), { minLength: 17, maxLength: 17 }),
  (statuses) => {
    const baseline = PRESERVED_ROUTE_SET.map((route, index) => ({
      ...route,
      status: statuses[index],
    }));
    assert.deepEqual(compareRouteStatuses({ baseline, observed: structuredClone(baseline) }), []);
    const observed = structuredClone(baseline);
    observed[0].status = observed[0].status === 599 ? 598 : observed[0].status + 1;
    assert.deepEqual(compareRouteStatuses({ baseline, observed }), [observed[0]]);
  },
);

property("readiness is binding-derived and has exactly five booleans", fc.record({
  api: fc.boolean(),
  review: fc.boolean(),
  control: fc.boolean(),
  model: fc.boolean(),
  functionCalling: fc.boolean(),
}), (flags) => {
  const bindings = {
    ...(flags.api ? { AGENT_API_JWT_SECRET: "set" } : {}),
    ...(flags.review ? { AGENT_REVIEW_JWT_SECRET: "set" } : {}),
    ...(flags.control ? { CONTROL_PLANE_URL: "set" } : {}),
    ...(flags.model ? { MODEL_PROVIDER: "set" } : {}),
    ...(flags.functionCalling ? { FUNCTION_CALLING: "set" } : {}),
  };
  const readiness = deriveReadiness(bindings);
  assert.deepEqual(Object.keys(readiness), readinessKeys);
  assert.ok(Object.values(readiness).every((value) => typeof value === "boolean"));
  assert.equal(readiness.configured, flags.api && flags.review && flags.control && flags.model);
});

property(
  "worker-first route patterns preserve API matching without capturing root",
  fc.constantFrom(...PRESERVED_ROUTE_SET.map((item) => item.path)),
  (requestPath) => {
    assert.equal(workerFirstMatches(requestPath, requestPath), true);
    assert.equal(workerFirstMatches("/api/*", requestPath), requestPath.startsWith("/api/"));
    assert.equal(workerFirstMatches("/api/*", "/"), false);
    assert.equal(workerFirstMatches("/*", "/"), false);
  },
);

property("state-path checks report the first source offender", fc.tuple(
  identifier,
  identifier,
), ([first, second]) => {
  const sources = new Map([
    ["scripts/b.mjs", `mkdirSync("../${second}")`],
    ["scripts/a.mjs", `mkdirSync("inside")\nmkdirSync("../${first}")`],
  ]);
  const offender = firstOffender({
    repositoryRoot: "/repository",
    files: [...sources.keys()],
    read: (file) => sources.get(file.replace("/repository/", "")),
  });
  assert.equal(offender.file, "scripts/a.mjs");
  assert.equal(offender.line, 2);
  assert.equal(offender.target, `/${first}`);
});
