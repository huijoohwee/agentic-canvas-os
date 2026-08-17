import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { classifyEntry, deletionDecision } from "../scripts/teardown-inventory.mjs";
import { validateArchiveCoverage, validateRemovalManifest } from "../scripts/teardown-archive.mjs";
import {
  validateImportClosure,
  validateReferenceClosure,
  validateStageSequence,
  worktreeRemovalDecision,
} from "../scripts/teardown-measure.mjs";

const classifications = ["redundant", "constrained", "dead", "retained"];
const evidenceKeys = ["packageScripts", "staticImports", "workflowSteps", "githooks", "markdownReferences"];
const identifier = fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/u);
const pathArbitrary = identifier.map(value => `scripts/${value}.mjs`);
const evidenceArbitrary = fc.record(Object.fromEntries(
  evidenceKeys.map(key => [key, fc.array(identifier, { maxLength: 4 })]),
));
const property = (name, arbitrary, predicate) => test(name, () => (
  fc.assert(fc.property(arbitrary, predicate), { numRuns: 100 })
));

function emptyEvidence() {
  return Object.fromEntries(evidenceKeys.map(key => [key, []]));
}
function entry({ evidence = emptyEvidence(), unresolvedReferences = [], proven = false } = {}) {
  return {
    path: "scripts/subject.mjs",
    evidence,
    unresolvedReferences,
    provenPath: { isProvenPath: proven },
  };
}

// Feature: repository-teardown, Property 1: Classification totality and exclusivity.
property("Property 1: the production classifier returns exactly one classification", fc.array(fc.record({
  evidence: evidenceArbitrary,
  unresolvedReferences: fc.array(identifier, { maxLength: 2 }),
  proven: fc.boolean(),
  concurrencyDiffers: fc.boolean(),
}), { maxLength: 30 }), values => {
  const results = values.map(value => classifyEntry(entry(value), value));
  assert.ok(results.every(result => classifications.includes(result.classification)));
  const counts = Object.fromEntries(classifications.map(classification => [
    classification,
    results.filter(result => result.classification === classification).length,
  ]));
  assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), values.length);
});

// Feature: repository-teardown, Property 2: Evidence structure completeness and dead-emptiness equivalence.
property("Property 2: explicit empty evidence is exactly the dead base case", evidenceArbitrary, evidence => {
  assert.deepEqual(Object.keys(evidence).sort(), [...evidenceKeys].sort());
  const allEmpty = evidenceKeys.every(key => evidence[key].length === 0);
  assert.equal(classifyEntry(entry({ evidence })).classification === "dead", allEmpty);
});

// Feature: repository-teardown, Property 3: Ambiguity and missing evidence force retention.
property("Property 3: missing inventory, archive, or resolved references blocks deletion", fc.record({
  missingEntry: fc.boolean(),
  archiveCovered: fc.boolean(),
  unresolved: fc.array(identifier, { maxLength: 3 }),
}), value => {
  const subject = value.missingEntry ? null : {
    ...entry({ unresolvedReferences: value.unresolved }),
    classification: "dead",
  };
  const decision = deletionDecision(subject, { archiveCovered: value.archiveCovered });
  const blocked = value.missingEntry || !value.archiveCovered || value.unresolved.length > 0;
  assert.equal(decision.removable, !blocked);
});

// Feature: repository-teardown, Property 4: Classification decision procedure is deterministic and total.
property("Property 4: classification is deterministic under replay", fc.record({
  evidence: evidenceArbitrary,
  unresolvedReferences: fc.array(identifier, { maxLength: 3 }),
  proven: fc.boolean(),
  concurrencyDiffers: fc.boolean(),
  readinessKey: fc.boolean(),
  configuredFalse: fc.boolean(),
}), value => {
  const subject = entry(value);
  const first = classifyEntry(subject, value);
  const second = classifyEntry(structuredClone(subject), structuredClone(value));
  assert.deepEqual(first, second);
  assert.ok(classifications.includes(first.classification));
});

// Feature: repository-teardown, Property 5: No deletion without archive coverage.
property("Property 5: archive coverage is required for both ref and tip", fc.uniqueArray(pathArbitrary, { maxLength: 20 }), refs => {
  const targets = refs.map((ref, index) => ({ ref, sha: index.toString(16).padStart(40, "0") }));
  const coveredRefs = refs.filter((_, index) => index % 2 === 0);
  const coveredShas = targets.filter((_, index) => index % 3 === 0).map(target => target.sha);
  const decisions = validateArchiveCoverage({ targets, coveredRefs, coveredShas });
  decisions.forEach((decision, index) => {
    assert.equal(decision.covered, index % 2 === 0 && index % 3 === 0);
  });
});

// Feature: repository-teardown, Property 6: Removal Manifest completeness per commit.
property("Property 6: removal manifests accept one exact row per deleted path", fc.uniqueArray(pathArbitrary, { maxLength: 20 }), paths => {
  const stageCommit = "a".repeat(40);
  const rows = paths.map(path => ({ path, stage: 5, stageCommit,
    preTeardownBlobSha: "b".repeat(40), classification: "dead" }));
  assert.equal(validateRemovalManifest({ deletedPaths: paths, rows, stage: 5, stageCommit }), true);
  if (rows.length) {
    assert.equal(validateRemovalManifest({ deletedPaths: paths, rows: rows.slice(1), stage: 5, stageCommit }), false);
  }
});

// Feature: repository-teardown, Property 7: Import closure holds at every stage commit.
property("Property 7: import closure rejects an edge to a removed path", fc.uniqueArray(pathArbitrary, { minLength: 1, maxLength: 20 }), paths => {
  const survivingPaths = paths.filter((_, index) => index % 2 === 0);
  const importsByPath = Object.fromEntries(survivingPaths.map(path => [path, survivingPaths.slice(0, 2)]));
  assert.equal(validateImportClosure({ survivingPaths, importsByPath }), true);
  const removed = paths.find(path => !survivingPaths.includes(path));
  if (removed) {
    importsByPath[survivingPaths[0]] = [removed];
    assert.equal(validateImportClosure({ survivingPaths, importsByPath }), false);
  }
});

// Feature: repository-teardown, Property 8: Same-commit reference closure.
property("Property 8: references to same-commit removals are rejected", fc.uniqueArray(pathArbitrary, { maxLength: 20 }), paths => {
  const removedPaths = paths.filter((_, index) => index % 2 === 0);
  const references = paths.filter(path => !removedPaths.includes(path));
  assert.equal(validateReferenceClosure({ removedPaths, references }), true);
  if (removedPaths.length) {
    assert.equal(validateReferenceClosure({ removedPaths, references: [...references, removedPaths[0]] }), false);
  }
});

// Feature: repository-teardown, Property 9: Stage sequence discipline.
property("Property 9: only a contiguous one-based prefix is valid", fc.array(fc.integer({ min: 0, max: 12 }), { maxLength: 12 }), stages => {
  const expected = stages.every((stage, index) => stage === index + 1);
  assert.equal(validateStageSequence(stages), expected);
});

// Feature: repository-teardown, Property 10: Dirty worktree fails closed.
property("Property 10: every porcelain line blocks worktree removal", fc.array(identifier, { maxLength: 10 }), payloads => {
  const porcelain = payloads.map((payload, index) => `${index % 2 ? "??" : " M"} ${payload}`).join("\n");
  assert.deepEqual(worktreeRemovalDecision(porcelain), { allowed: payloads.length === 0, lineCount: payloads.length });
});
