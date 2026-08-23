import assert from "node:assert/strict";
import test from "node:test";

import { buildActiveDirtyScopeExpansionPlan }
  from "../scripts/active-dirty-scope-expansion-contract.mjs";
import { captureActiveDirtyScopeExpansionProtectedMain }
  from "../scripts/active-dirty-scope-expansion-protected-main.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { normalizeDeclaredWriteScopeManifest }
  from "../scripts/scoped-lane-admission-lib.mjs";

const BASE = "a".repeat(40);
const PULL_BASE = "b".repeat(40);
const MAIN = "c".repeat(40);
const FENCE = "d".repeat(40);

test("stale-base expansion seals an exact disjoint canonical-descendant proof", () => {
  const calls = [];
  const result = captureActiveDirtyScopeExpansionProtectedMain({
    sourceBaseSha: BASE,
    pullRequestBaseSha: PULL_BASE,
    protectedMainSha: MAIN,
    targetDeclaredWriteSet: ["path:scripts/owned.mjs", "semantic:owned"],
    gitText: argumentsList => {
      calls.push(argumentsList);
      if (argumentsList[0] === "diff") return "docs/unrelated.md\0";
      if (argumentsList[0] === "rev-parse") return "e".repeat(40);
      return "";
    },
  });

  assert.equal(result.canonicalDescendantProof.sourceBaseSha, BASE);
  assert.equal(result.canonicalDescendantProof.targetBaseSha, MAIN);
  assert.deepEqual(result.canonicalDescendantProof.canonicalChangedPaths, ["docs/unrelated.md"]);
  assert.deepEqual(result.canonicalDescendantProof.preservedChangedPaths, ["scripts/owned.mjs"]);
  assert.equal(result.protectedMainAdvance.baseSha, BASE);
  assert.ok(calls.some(argumentsList => argumentsList[0] === "merge-base"));
});

test("stale-base expansion rejects protected changes overlapping its expanded target", () => {
  assert.throws(() => captureActiveDirtyScopeExpansionProtectedMain({
    sourceBaseSha: BASE,
    pullRequestBaseSha: PULL_BASE,
    protectedMainSha: MAIN,
    targetDeclaredWriteSet: ["path:scripts/owned.mjs", "semantic:owned"],
    gitText: argumentsList => {
      if (argumentsList[0] === "diff") return "scripts/owned.mjs\0";
      if (argumentsList[0] === "rev-parse") return "e".repeat(40);
      return "";
    },
  }), /advanced within the admitted recovery write set/u);
});

test("same-base expansion preserves the legacy plan shape", () => {
  const result = captureActiveDirtyScopeExpansionProtectedMain({
    sourceBaseSha: BASE,
    pullRequestBaseSha: BASE,
    protectedMainSha: BASE,
    targetDeclaredWriteSet: ["path:scripts/owned.mjs", "semantic:owned"],
    gitText: argumentsList => argumentsList[0] === "rev-parse" ? "e".repeat(40) : "",
  });
  assert.equal(result.canonicalDescendantProof, null);
});

test("plan authorization binds the complete stale-base proof", () => {
  const sourceManifest = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "owned",
    paths: ["scripts/owned.mjs"],
  });
  const targetManifest = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "owned",
    paths: ["scripts/new.mjs", "scripts/owned.mjs"],
  });
  const authority = {
    schema: "agentic-lane-cloud-authority/v1",
    state: "active",
    claimId: "1".repeat(64),
    claimDigest: "2".repeat(64),
    canonicalBaseSha: BASE,
    laneRevision: FENCE,
    cloudDeclaredWriteScope: sourceManifest.declaredWriteSet,
    writeSetDigest: sourceManifest.writeSetDigest,
    transitionCounter: 2,
    reviewRequestId: "github-pull-request:test",
  };
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    scope: "owned",
    branch: "agent/device/owned",
    baseSha: BASE,
    fenceSha: FENCE,
    admission: {
      schema: "agentic-lane-admission-lease/v1",
      status: "admitted",
      declaredWriteSet: sourceManifest.declaredWriteSet,
      writeSetDigest: sourceManifest.writeSetDigest,
      manifestDigest: sourceManifest.manifestDigest,
    },
    cloudAuthority: authority,
  };
  const proof = captureActiveDirtyScopeExpansionProtectedMain({
    sourceBaseSha: BASE,
    pullRequestBaseSha: PULL_BASE,
    protectedMainSha: MAIN,
    targetDeclaredWriteSet: targetManifest.declaredWriteSet,
    gitText: argumentsList => {
      if (argumentsList[0] === "diff") return "docs/unrelated.md\0";
      if (argumentsList[0] === "rev-parse") return "e".repeat(40);
      return "";
    },
  }).canonicalDescendantProof;
  const source = {
    lease,
    branch: lease.branch,
    fenceSha: FENCE,
    claimId: authority.claimId,
    claimDigest: authority.claimDigest,
    changedPaths: ["scripts/owned.mjs"],
    untrackedPaths: [],
    dirtyDigest: digestValue({ dirty: true }),
  };
  const plan = buildActiveDirtyScopeExpansionPlan({
    source,
    targetManifest,
    targetCanonicalBaseSha: BASE,
    canonicalDescendantProof: proof,
  });
  const changedProof = { ...proof, canonicalChangedPaths: ["docs/other.md"] };

  assert.equal(plan.canonicalDescendantProof.evidenceDigest, proof.evidenceDigest);
  assert.throws(() => buildActiveDirtyScopeExpansionPlan({
    source,
    targetManifest,
    targetCanonicalBaseSha: BASE,
    canonicalDescendantProof: changedProof,
  }), /canonical-descendant proof is invalid/u);
});
