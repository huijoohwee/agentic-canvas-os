import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import * as configModule from "../scripts/alignment-audit/config.mjs";
import {
  AuditConfigError,
  expandEnvironmentReferences,
  pathsOverlap,
  resolveAuditConfig,
  validateAuditConfigShape,
} from "../scripts/alignment-audit/config.mjs";
import { main } from "../scripts/alignment-audit.mjs";

const BASE = Object.freeze({
  guidelineRoots: [{ roleLabel: "guide", locator: "/inputs/guideline" }],
  runtimeRoots: [{ roleLabel: "runtime", locator: "/inputs/runtime" }],
  auditOutputDirectory: "/outputs/audit",
  operatorDeployInstruction: null,
  readinessLadder: [
    "undocumented",
    "spec-complete",
    "dev-proven",
    "runtime-ready",
    "production-verified",
  ],
  requiredFrontmatterKeys: ["title"],
  economicsStatements: ["token-budget"],
});

for (const [name, mutate, field] of [
  ["zero guideline roots", (value) => ({ ...value, guidelineRoots: [] }), "guidelineRoots"],
  ["zero runtime roots", (value) => ({ ...value, runtimeRoots: [] }), "runtimeRoots"],
  ["empty readiness ladder", (value) => ({ ...value, readinessLadder: [] }), "readinessLadder"],
  [
    "duplicate readiness ladder",
    (value) => ({ ...value, readinessLadder: ["runtime-ready", "runtime-ready"] }),
    "readinessLadder",
  ],
  [
    "noncanonical readiness ladder",
    (value) => ({ ...value, readinessLadder: ["undocumented", "runtime-ready"] }),
    "readinessLadder",
  ],
  [
    "empty required frontmatter keys",
    (value) => ({ ...value, requiredFrontmatterKeys: [] }),
    "requiredFrontmatterKeys",
  ],
  [
    "malformed operator instruction",
    (value) => ({ ...value, operatorDeployInstruction: {} }),
    "operatorDeployInstruction",
  ],
]) {
  test(`configuration rejects ${name}`, () => {
    assert.throws(
      () => validateAuditConfigShape(mutate(BASE)),
      (error) => error instanceof AuditConfigError && error.field === field,
    );
  });
}

test("configuration rejects unresolvable roots and output locators", async () => {
  await assert.rejects(
    resolveForTest(BASE, {
      canonicalizeInput: async () => {
        const error = new Error("missing input");
        error.code = "ENOENT";
        throw error;
      },
    }),
    (error) => error instanceof AuditConfigError && error.field.includes(".locator"),
  );
  await assert.rejects(
    resolveForTest(BASE, {
      canonicalizeOutput: async () => {
        throw new Error("cannot resolve output");
      },
    }),
    (error) => error instanceof AuditConfigError && error.field === "auditOutputDirectory",
  );
});

test("configuration rejects an unwritable output locator", async () => {
  await assert.rejects(
    resolveForTest(BASE, {
      assertWritable: async () => {
        throw new Error("permission denied");
      },
    }),
    (error) =>
      error instanceof AuditConfigError &&
      error.field === "auditOutputDirectory" &&
      /permission denied/u.test(error.message),
  );
});

for (const [name, input, output] of [
  ["equal to an input", "/workspace/source", "/workspace/source"],
  ["containing an input", "/workspace/source/child", "/workspace/source"],
  ["contained by an input", "/workspace/source", "/workspace/source/audit"],
]) {
  test(`configuration rejects output ${name}`, async () => {
    const supplied = {
      ...BASE,
      guidelineRoots: [{ roleLabel: "guide", locator: input }],
      auditOutputDirectory: output,
    };
    await assert.rejects(
      resolveForTest(supplied),
      (error) =>
        error instanceof AuditConfigError &&
        error.field === "auditOutputDirectory" &&
        /disjoint/u.test(error.message),
    );
  });
}

test("two distinct configured root sets resolve from caller-supplied values", async () => {
  const first = await resolveForTest(BASE);
  const second = await resolveForTest({
    ...BASE,
    guidelineRoots: [{ roleLabel: "policy", locator: "/other/policy" }],
    runtimeRoots: [{ roleLabel: "service", locator: "/other/service" }],
    auditOutputDirectory: "/other/output",
  });

  assert.notDeepEqual(
    first.guidelineRoots.map((root) => root.locator),
    second.guidelineRoots.map((root) => root.locator),
  );
  assert.deepEqual(second.guidelineRoots.map((root) => root.roleLabel), ["policy"]);
  assert.deepEqual(second.runtimeRoots.map((root) => root.roleLabel), ["service"]);
  assert.equal(
    Object.keys(configModule).some((name) => /default.*root|root.*default/iu.test(name)),
    false,
  );
});

test("environment references expand or fail with a typed configuration error", async () => {
  assert.equal(
    expandEnvironmentReferences("${GITHUB_ROOT}/spec", {
      GITHUB_ROOT: "/workspace",
    }),
    "/workspace/spec",
  );
  assert.throws(
    () => expandEnvironmentReferences("${MISSING_ROOT}/spec", {}),
    (error) => error instanceof AuditConfigError && error.field === "environment",
  );

  const resolved = await resolveForTest(
    {
      ...BASE,
      guidelineRoots: [{ roleLabel: "guide", locator: "${GITHUB_ROOT}/guide" }],
      runtimeRoots: [{ roleLabel: "runtime", locator: "${RUNTIME_ROOT}" }],
    },
    {
      environment: {
        GITHUB_ROOT: "/workspace",
        RUNTIME_ROOT: "/runtime",
      },
    },
  );
  assert.equal(resolved.guidelineRoots[0].locator, path.resolve("/workspace/guide"));
  assert.equal(resolved.runtimeRoots[0].locator, path.resolve("/runtime"));
});

test("invalid configuration reaches neither reader nor sink construction", async () => {
  let readers = 0;
  let sinks = 0;
  await assert.rejects(
    main(["config.json", "--mode", "run"], {
      currentDirectory: "/workspace",
      readText: async () => JSON.stringify({ ...BASE, guidelineRoots: [] }),
      createReader: () => {
        readers += 1;
      },
      createRunSink: async () => {
        sinks += 1;
      },
    }),
    AuditConfigError,
  );
  assert.equal(readers, 0);
  assert.equal(sinks, 0);
});

test("pathsOverlap treats equality and containment symmetrically", () => {
  assert.equal(pathsOverlap("/a/b", "/a/b"), true);
  assert.equal(pathsOverlap("/a/b", "/a/b/c"), true);
  assert.equal(pathsOverlap("/a/b/c", "/a/b"), true);
  assert.equal(pathsOverlap("/a/b", "/a/beta"), false);
});

function resolveForTest(supplied, options = {}) {
  return resolveAuditConfig(supplied, {
    baseDirectory: "/",
    canonicalizeInput: async (locator) => locator,
    canonicalizeOutput: async (locator) => locator,
    assertWritable: async () => {},
    ...options,
  });
}
