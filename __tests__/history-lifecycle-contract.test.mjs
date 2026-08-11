import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  buildHistoryLifecyclePlan,
  buildHistoryLifecycleResult,
  HISTORY_LIFECYCLE_EVIDENCE_SCHEMA,
  HISTORY_LIFECYCLE_PLAN_SCHEMA,
  HISTORY_LIFECYCLE_RESULT_SCHEMA,
  normalizeHistoryLifecycleEvidence,
  normalizeHistoryLifecyclePlan,
  normalizeHistoryLifecycleResult,
} from "../scripts/history-lifecycle-contract.mjs";

const oid = character => character.repeat(40);
const sha256 = character => character.repeat(64);
const MAIN = oid("a");
const MAIN_TREE = oid("b");

test("evidence normalization is deterministic under input permutations", () => {
  const source = evidence({
    branches: [
      branch("refs/heads/zeta", oid("c"), oid("d")),
      branch("refs/heads/main", MAIN, MAIN_TREE, { relationship: "same" }),
      branch("refs/heads/alpha", oid("e"), oid("f")),
    ],
    worktrees: [
      worktree("/repo", MAIN, "refs/heads/main"),
      worktree("/tasks/zeta", oid("c"), "refs/heads/zeta"),
      worktree("/tasks/alpha", oid("e"), "refs/heads/alpha"),
    ],
    recoveryAnchors: [
      anchor("refs/tags/zeta", oid("c")),
      anchor("refs/tags/alpha", oid("e")),
    ],
    completeness: completeness({ reasons: ["zeta", "alpha"] }),
  });
  const permuted = {
    ...source,
    branches: [...source.branches].reverse(),
    worktrees: [...source.worktrees].reverse(),
    recoveryAnchors: [...source.recoveryAnchors].reverse(),
    completeness: { ...source.completeness, reasons: [...source.completeness.reasons].reverse() },
  };

  const first = normalizeHistoryLifecycleEvidence(source);
  const second = normalizeHistoryLifecycleEvidence(permuted);
  assert.deepEqual(second, first);
  assert.deepEqual(first.branches.map(item => item.ref), [
    "refs/heads/alpha", "refs/heads/main", "refs/heads/zeta",
  ]);
  assert.deepEqual(first.completeness.reasons, ["alpha", "zeta"]);
  assert.ok(Object.isFrozen(first));
});

test("evidence rejects unknown fields, digest substitution, and frontier drift", () => {
  const source = evidence();
  assert.throws(() => normalizeHistoryLifecycleEvidence({ ...source, unknown: true }),
    /missing or unknown fields/u);
  assert.throws(() => normalizeHistoryLifecycleEvidence({
    ...source, evidenceDigest: sha256("f"),
  }), /evidence digest is invalid/u);

  const drifted = structuredClone(source);
  drifted.comparison.frontierAfter.refsDigest = sha256("9");
  drifted.comparison.frontierAfter = sealFrontier(drifted.comparison.frontierAfter);
  drifted.evidenceDigest = digestValue(withoutDigest(drifted));
  assert.throws(() => normalizeHistoryLifecycleEvidence(drifted), /identical stable frontiers/u);
});

test("audit and plan results are sealed advisory values without mutation authority", () => {
  const source = evidence();
  const plan = buildHistoryLifecyclePlan(source);
  const audit = buildHistoryLifecycleResult({ mode: "audit", evidence: source });
  const planned = buildHistoryLifecycleResult({ mode: "plan", evidence: source, plan });

  assert.equal(plan.schema, HISTORY_LIFECYCLE_PLAN_SCHEMA);
  assert.deepEqual(plan.effects, []);
  assert.equal(plan.mutationAuthorized, false);
  assert.equal(plan.mutationAuthority, null);
  assert.equal(Object.hasOwn(plan, "exactAuthorization"), false);
  assert.equal(audit.schema, HISTORY_LIFECYCLE_RESULT_SCHEMA);
  assert.equal(audit.status, "audited");
  assert.equal(audit.plan, null);
  assert.deepEqual(audit.effects, []);
  assert.equal(audit.mutationAuthorized, false);
  assert.equal(audit.mutationAuthority, null);
  assert.equal(planned.status, "planned");
  assert.equal(planned.planDigest, plan.planDigest);
  assert.deepEqual(normalizeHistoryLifecyclePlan(plan), plan);
  assert.deepEqual(normalizeHistoryLifecycleResult(audit), audit);
  assert.deepEqual(normalizeHistoryLifecycleResult(planned), planned);
  assert.throws(() => buildHistoryLifecycleResult({ mode: "run", evidence: source }),
    /mode must be audit or plan/u);
  assert.throws(() => buildHistoryLifecycleResult({ mode: "audit", evidence: source, plan }),
    /cannot carry a plan/u);
});

test("branch dispositions remain conservative across authority and history observations", () => {
  const mergedRevision = oid("c");
  const mergedTree = oid("d");
  const patchRevision = oid("e");
  const patchTree = oid("f");
  const source = evidence({
    branches: [
      branch("refs/heads/main", MAIN, MAIN_TREE, { relationship: "same" }),
      branch("refs/heads/checked-out", oid("1"), oid("2")),
      branch("refs/heads/nonterminal", oid("3"), oid("4")),
      branch("refs/heads/remote", oid("5"), oid("6"), { remoteRevision: oid("5") }),
      branch("refs/heads/merged", mergedRevision, mergedTree),
      branch("refs/heads/ancestor", oid("7"), oid("8"), { relationship: "ancestor" }),
      branch("refs/heads/patch-only", patchRevision, patchTree, {
        patch: patch("equivalent", sha256("7")),
      }),
    ],
    worktrees: [
      worktree("/repo", MAIN, "refs/heads/main"),
      worktree("/tasks/checked", oid("1"), "refs/heads/checked-out"),
    ],
    leases: leases([
      lease("refs/heads/nonterminal", "active", "nonterminal"),
    ]),
    providerChanges: [providerChange("change:merged", "refs/heads/merged", mergedRevision,
      mergedTree)],
  });
  const dispositions = new Map(buildHistoryLifecyclePlan(source).branches
    .map(item => [item.ref, item.disposition]));

  assert.equal(dispositions.get("refs/heads/main"), "retain-comparison");
  assert.equal(dispositions.get("refs/heads/checked-out"), "retain-worktree-bound");
  assert.equal(dispositions.get("refs/heads/nonterminal"), "retain-nonterminal-authority");
  assert.equal(dispositions.get("refs/heads/remote"), "retain-remote-present");
  assert.equal(dispositions.get("refs/heads/merged"), "archive-before-retirement");
  assert.equal(dispositions.get("refs/heads/ancestor"), "review-history-contained");
  assert.equal(dispositions.get("refs/heads/patch-only"), "review-patch-equivalent");

  const incomplete = reseal({
    ...source,
    completeness: completeness({ providerChanges: false, reasons: ["provider-incomplete"] }),
    providerChanges: [],
  });
  const incompletePlan = buildHistoryLifecyclePlan(incomplete);
  const localOnly = new Map(incompletePlan.branches.map(item => [item.ref, item.disposition]));
  assert.equal(localOnly.get("refs/heads/merged"), "preserve-unique-or-unproven");
  assert.equal(localOnly.get("refs/heads/ancestor"), "review-history-contained");
  assert.equal(localOnly.get("refs/heads/patch-only"), "review-patch-equivalent");

  const shallow = reseal({ ...source, repository: { ...source.repository,
    shallow: { present: true, digest: sha256("c") } } });
  const shallowPlan = new Map(buildHistoryLifecyclePlan(shallow).branches
    .map(item => [item.ref, item.disposition]));
  assert.equal(shallowPlan.get("refs/heads/merged"), "review-incomplete-evidence");
  assert.equal(shallowPlan.get("refs/heads/ancestor"), "review-incomplete-evidence");
});

test("stash anatomy binds object identities and unknown projections stay preserved", () => {
  const source = evidence({ stashes: [stash(oid("c"))] });
  const normalized = normalizeHistoryLifecycleEvidence(source);
  assert.deepEqual(normalized.stashes[0].parents, [oid("1"), oid("2")]);
  assert.equal(buildHistoryLifecyclePlan(source).stashes[0].disposition, "preserve-unproven");

  const malformed = structuredClone(source);
  malformed.stashes[0].trees.untracked = oid("9");
  malformed.evidenceDigest = digestValue(withoutDigest(malformed));
  assert.throws(() => normalizeHistoryLifecycleEvidence(malformed),
    /Two-parent stash cannot carry an untracked tree/u);
});

test("stash anchors and exact duplicate payloads never become mutation authority", () => {
  const first = stash(oid("c"));
  const second = stash(oid("d"), { selectors: ["stash@{1}"] });
  const duplicated = evidence({ stashes: [first, second] });
  const duplicatePlan = buildHistoryLifecyclePlan(duplicated);
  assert.deepEqual(duplicatePlan.stashes.map(item => item.disposition), [
    "archive-required-before-duplicate-review",
    "archive-required-before-duplicate-review",
  ]);
  assert.deepEqual(duplicatePlan.effects, []);
  assert.equal(duplicatePlan.mutationAuthorized, false);

  const anchoredStash = stash(oid("e"), {
    bindings: [{ kind: "anchor", id: "refs/tags/stash-e", status: "exact" }],
  });
  const anchored = evidence({
    stashes: [anchoredStash],
    recoveryAnchors: [anchor("refs/tags/stash-e", oid("e"))],
  });
  const anchoredPlan = buildHistoryLifecyclePlan(anchored);
  assert.equal(anchoredPlan.stashes[0].disposition, "retain-durable-anchor");
  assert.deepEqual(anchoredPlan.stashes[0].anchorRefs, ["refs/tags/stash-e"]);

  const leased = evidence({
    stashes: [stash(oid("f"), {
      bindings: [{ kind: "lease", id: "refs/heads/parked", status: "parked" }],
    })],
    leases: leases([{ ...lease("refs/heads/parked", "active", "nonterminal"),
      parkStashSha: oid("f"), parkStashStatus: "parked" }]),
  });
  assert.equal(buildHistoryLifecyclePlan(leased).stashes[0].disposition,
    "retain-nonterminal-authority");
});

test("refs/stash is not accepted as a durable recovery anchor", () => {
  const source = evidence({ recoveryAnchors: [anchor("refs/stash", oid("c"))] });
  assert.throws(() => normalizeHistoryLifecycleEvidence(source), /[Rr]ecovery anchor|refs\/stash/u);
});

test("Git identities are bytewise ordered without NFC folding", () => {
  const composed = "refs/heads/\u00e9";
  const decomposed = "refs/heads/e\u0301";
  assert.notEqual(composed, decomposed);
  const normalized = normalizeHistoryLifecycleEvidence(evidence({
    branches: [branch(composed, oid("c"), oid("d")),
      branch("refs/heads/main", MAIN, MAIN_TREE, { relationship: "same" }),
      branch(decomposed, oid("e"), oid("f"))],
    worktrees: [worktree("/repo", MAIN, "refs/heads/main")],
  }));
  assert.deepEqual(normalized.branches.map(item => item.ref), [decomposed, "refs/heads/main", composed]);
  assert.equal(normalized.branches[0].ref.normalize("NFC"), normalized.branches[2].ref);

  const unicodeStash = stash(oid("9"), {
    deltas: deltas([deltaEntry("e\u0301.txt", "M", oid("1"), oid("2")),
      deltaEntry("\u00e9.txt", "M", oid("3"), oid("4"))]),
  });
  const stashEvidence = normalizeHistoryLifecycleEvidence(evidence({ stashes: [unicodeStash] }));
  assert.deepEqual(stashEvidence.stashes[0].deltas.headToWorktree.entries.map(item => item.path),
    ["e\u0301.txt", "\u00e9.txt"]);
});

function evidence(overrides = {}) {
  const frontier = sealFrontier({
    comparisonRevision: MAIN,
    refsDigest: sha256("1"),
    worktreesDigest: sha256("2"),
    leaseSourceDigest: sha256("3"),
    statusDigest: sha256("4"),
    remoteDigest: sha256("5"),
    providerDigest: sha256("6"),
  });
  const core = {
    schema: HISTORY_LIFECYCLE_EVIDENCE_SCHEMA,
    repository: {
      root: "/repo",
      gitCommonDir: "/repo/.git",
      objectFormat: "sha1",
      shallow: { present: false, digest: null },
      replaceRefs: [],
      grafts: { present: false, digest: null },
    },
    comparison: {
      ref: "refs/heads/main",
      revision: MAIN,
      tree: MAIN_TREE,
      clean: true,
      frontierBefore: frontier,
      frontierAfter: structuredClone(frontier),
      stable: true,
      remote: { ref: "refs/heads/main", revision: MAIN },
      provider: { kind: "github", repository: "owner/repository" },
    },
    worktrees: [worktree("/repo", MAIN, "refs/heads/main")],
    branches: [branch("refs/heads/main", MAIN, MAIN_TREE, { relationship: "same" })],
    stashes: [],
    recoveryAnchors: [],
    leases: leases([]),
    providerChanges: [],
    completeness: completeness(),
    ...overrides,
  };
  return reseal(core);
}

function sealFrontier(value) {
  const { digest: ignored, ...core } = value;
  return { ...core, digest: digestValue(core) };
}

function reseal(value) {
  const core = withoutDigest(value);
  return { ...core, evidenceDigest: digestValue(normalizedCore(core)) };
}

function normalizedCore(value) {
  const copy = structuredClone(value);
  const byteSort = (items, key) => items.sort((left, right) => Buffer.compare(
    Buffer.from(key(left), "utf8"), Buffer.from(key(right), "utf8"),
  ));
  byteSort(copy.worktrees, item => item.path);
  byteSort(copy.branches, item => item.ref);
  byteSort(copy.stashes, item => item.revision);
  byteSort(copy.recoveryAnchors, item => item.ref);
  byteSort(copy.leases.entries, item => item.branchRef);
  byteSort(copy.providerChanges, item => item.id);
  byteSort(copy.completeness.reasons, item => item);
  for (const item of copy.stashes) {
    byteSort(item.selectors, value => value);
    byteSort(item.bindings, value => `${value.kind}\0${value.id}`);
    byteSort(item.untrackedEntries, value => value.path);
    for (const delta of Object.values(item.deltas)) byteSort(delta.entries, value => value.path);
  }
  for (const item of copy.branches) {
    byteSort(item.reflog.uniqueRevisions, value => value);
    if (item.reflog.uncontainedRevisions) byteSort(item.reflog.uncontainedRevisions, value => value);
  }
  return copy;
}

function withoutDigest(value) {
  const { evidenceDigest: ignored, ...core } = value;
  return core;
}

function worktree(path, head, branchRef) {
  return { path, head, branch: branchRef, detached: false, bare: false, locked: false, prunable: false };
}

function branch(ref, revision, tree, overrides = {}) {
  return {
    ref, revision, tree, upstreamRef: null, remoteRevision: null,
    relationship: "diverged", ahead: 1, behind: 1,
    reflog: { complete: true, entryCount: 1, digest: sha256("8"), uniqueRevisions: [revision] },
    patch: patch(),
    ...overrides,
  };
}

function patch(status = "not-evaluated", id = null) {
  return { status, id, advisory: "non-authoritative" };
}

function stash(revision, overrides = {}) {
  const emptyDeltas = deltas([]);
  return {
    revision,
    selectors: ["stash@{0}"],
    parents: [oid("1"), oid("2")],
    trees: { head: oid("3"), index: oid("4"), worktree: oid("5"), untracked: null },
    messageDigest: sha256("9"),
    deltas: emptyDeltas,
    untrackedEntries: [],
    bindings: [],
    projection: { status: "unknown", digest: null },
    ...overrides,
  };
}

function deltas(headToWorktreeEntries) {
  const empty = { entries: [], digest: digestValue([]) };
  return {
    headToIndex: structuredClone(empty),
    indexToWorktree: structuredClone(empty),
    headToWorktree: { entries: headToWorktreeEntries,
      digest: digestValue([...headToWorktreeEntries].sort((a, b) => Buffer.compare(
        Buffer.from(a.path, "utf8"), Buffer.from(b.path, "utf8"),
      ))) },
  };
}

function deltaEntry(path, status, oldOid, newOid) {
  return { path, status, oldMode: "100644", oldOid, newMode: "100644", newOid };
}

function anchor(ref, revision) {
  return { ref, revision, peeledRevision: revision, kind: "tag" };
}

function leases(entries) {
  return { schema: "agentic-writer-lease-registry/v2", revision: 1,
    digest: sha256("a"), entries };
}

function lease(branchRef, status, authority) {
  return { branchRef, status, leaseDigest: sha256("b"), authority };
}

function providerChange(id, sourceRef, sourceRevision, sourceTree) {
  return {
    id, provider: "github", state: "merged", draft: false, sourceRef, sourceRevision,
    targetRef: "refs/heads/main", integrationRevision: oid("9"), complete: true,
    sourceTree, integrationTree: sourceTree, integratedInComparison: true,
  };
}

function completeness(overrides = {}) {
  return {
    refs: true, worktrees: true, stashes: true, recoveryAnchors: true, leases: true,
    providerChanges: true, bounded: true, corruptionFree: true, raceFree: true, reasons: [],
    ...overrides,
  };
}
