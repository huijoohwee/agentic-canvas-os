import assert from "node:assert/strict";
import test from "node:test";

import { populatedResult } from "../scripts/agentic-sdlc/normalize.mjs";

function result(overrides = {}) {
  return {
    ran: true,
    status: "passed",
    exitCode: 0,
    summary: "Tests run: 10, Failures: 0, Errors: 0, Skipped: 0",
    counts: {
      total: 10,
      passed: 10,
      failed: 0,
      errored: 0,
      skipped: 0,
    },
    ...overrides,
  };
}

test("standard Maven count summaries are concrete passing results", () => {
  assert.equal(populatedResult(result()), true);
});

test("structured counts must balance and agree with exit status", () => {
  assert.equal(populatedResult(result({
    counts: {
      total: 10,
      passed: 9,
      failed: 0,
      errored: 0,
      skipped: 0,
    },
  })), false);
  assert.equal(populatedResult(result({
    counts: {
      total: 10,
      passed: 9,
      failed: 1,
      errored: 0,
      skipped: 0,
    },
  })), false);
});

test("measurements derive satisfaction from typed comparators", () => {
  const measurementOnly = result({
    counts: undefined,
    summary: "Latency check completed",
    measurements: [{
      name: "latency_ms",
      observed: 42,
      comparator: "lte",
      expected: 50,
      unit: "ms",
    }],
  });
  assert.equal(populatedResult(measurementOnly), true);

  measurementOnly.measurements[0].observed = 51;
  measurementOnly.status = "failed";
  measurementOnly.exitCode = 1;
  assert.equal(populatedResult(measurementOnly), true);

  measurementOnly.measurements[0].comparator = "eq";
  measurementOnly.measurements[0].expected = "51";
  assert.equal(populatedResult(measurementOnly), false);
});
