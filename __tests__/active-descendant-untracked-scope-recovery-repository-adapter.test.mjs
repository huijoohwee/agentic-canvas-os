import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  activeDescendantUntrackedEntriesDigest,
  activeDescendantUntrackedIndexEvidenceDigest,
  assertActiveDescendantUntrackedScopePartition,
  buildActiveDescendantUntrackedOwnerStopEvidence,
  requireFreshActiveDescendantUntrackedOwnerStop,
} from "../scripts/active-descendant-untracked-scope-recovery-evidence.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";

const S = digit => digit.repeat(40), D = value => digestValue(value);
const HEAD = S("1"), FENCE = S("2"), BRANCH = "agent/device.local/scope";
const TRACKED = "scripts/tracked.mjs", UNTRACKED = "scripts/untracked.mjs";
const ISSUED = "2026-08-31T00:00:00.000Z", EXPIRES = "2026-08-31T00:30:00.000Z";

test("owner stop is content-bound and expires closed", () => {
  const dirt = dirtEvidence(S("7"));
  const stop = buildActiveDescendantUntrackedOwnerStopEvidence({
    sourceSessionId: "session:owner", sourceBranch: BRANCH,
    sourceHeadSha: HEAD, sourceFenceSha: FENCE,
    sourceDirtEvidenceDigest: dirt.evidenceDigest,
    sourceIndexEvidenceDigest: activeDescendantUntrackedIndexEvidenceDigest(dirt),
    untrackedEntriesDigest: activeDescendantUntrackedEntriesDigest(dirt),
    taskAuthorityReceiptDigest: D("receipt"), taskAuthorityProofDigest: D("proof"),
    taskAuthorityBindingDigest: D("binding"), untrackedPaths: [UNTRACKED],
    issuedAt: ISSUED, expiresAt: EXPIRES,
  });
  const input = { ownerStop: stop, lease: { branch: BRANCH, fenceSha: FENCE },
    frame: { headSha: HEAD, dirt, untrackedPaths: [UNTRACKED] },
    sourceSessionId: "session:owner", ttlSeconds: 1_800,
    now: new Date("2026-08-31T00:10:00.000Z") };
  assert.equal(requireFreshActiveDescendantUntrackedOwnerStop(input).receiptDigest,
    stop.receiptDigest);
  assert.throws(() => requireFreshActiveDescendantUntrackedOwnerStop({
    ...input,
    frame: { ...input.frame, dirt: dirtEvidence(S("8")) },
  }), /fresh content-bound owner stop/u);
  assert.throws(() => requireFreshActiveDescendantUntrackedOwnerStop({
    ...input, now: new Date(EXPIRES),
  }), /fresh content-bound owner stop/u);
});

test("scope partition admits only the exact strict-superset untracked additions", () => {
  const incident = { sourceDeclaredWriteSet: ["semantic:scope", `path:${TRACKED}`],
    targetDeclaredWriteSet: ["semantic:scope", `path:${TRACKED}`, `path:${UNTRACKED}`],
    committedPaths: [TRACKED], trackedDirtyPaths: [TRACKED],
    untrackedPaths: [UNTRACKED] };
  assert.equal(assertActiveDescendantUntrackedScopePartition(incident), incident);
  assert.throws(() => assertActiveDescendantUntrackedScopePartition({
    ...incident,
    targetDeclaredWriteSet: incident.sourceDeclaredWriteSet,
  }), /strict-superset target scope/u);
  assert.throws(() => assertActiveDescendantUntrackedScopePartition({
    ...incident,
    targetDeclaredWriteSet: [...incident.targetDeclaredWriteSet, "path:scripts/other.mjs"],
    untrackedPaths: ["scripts/missing.mjs"],
  }), /scope partition/u);
});

test("adapter is bounded and delegates mutations to integrated scope expansion", () => {
  const source = readFileSync(new URL(
    "../scripts/active-descendant-untracked-scope-recovery-repository-adapter.mjs",
    import.meta.url), "utf8");
  assert.ok(source.split("\n").length < 600);
  assert.match(source, /runActiveDirtyScopeExpansion/u);
  assert.match(source, /createRepositoryActiveDirtyScopeExpansionAdapter/u);
  assert.match(source, /expectedLedgerDigest: activePlan\.incident\.sourceLedgerDigest/u);
  assert.match(source, /projectWriterLeasePullRequestMarker/u);
  assert.doesNotMatch(source, /\["(?:add|commit|push|reset|checkout)"/u);
  assert.doesNotMatch(source, /"pr",\s*"(?:ready|merge|close)"/u);
});

function dirtEvidence(untrackedBlob) {
  const entries = [
    { path: TRACKED, staged: false, unstaged: true, untracked: false,
      headMode: "100644", headBlob: S("3"), indexMode: "100644", indexBlob: S("3"),
      worktreeType: "file", worktreeMode: "100644", worktreeBlob: S("4") },
    { path: UNTRACKED, staged: false, unstaged: false, untracked: true,
      headMode: null, headBlob: null, indexMode: null, indexBlob: null,
      worktreeType: "file", worktreeMode: "100644", worktreeBlob: untrackedBlob },
  ];
  const core = { schema: "agentic-active-owned-dirt-evidence/v1", headSha: HEAD,
    entries, pathCount: 2, stagedPathCount: 0, unstagedPathCount: 1,
    untrackedPathCount: 1 };
  return { ...core, evidenceDigest: D(core) };
}
