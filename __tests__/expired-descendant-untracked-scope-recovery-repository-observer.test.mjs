import assert from "node:assert/strict";
import test from "node:test";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  assertExpiredDescendantControllerContinuation,
  createExpiredDescendantUntrackedScopeRecoveryRepositoryObserver,
  preservedExpiredDescendantPullRequestDigest,
} from "../scripts/expired-descendant-untracked-scope-recovery-repository-observer.mjs";
import { updateWriterLeasePullRequestBody }
  from "../scripts/writer-lease-lib.mjs";

const SHA = value => value.repeat(40);

test("pull observer seals the exact raw body and rejects byte drift", () => {
  const lease = { schema: "agentic-writer-lease/v2", status: "active", epoch: 1,
    sessionId: "session:owner", device: "device.local", scope: "scope",
    branch: "agent/device.local/scope", baseSha: SHA("1"), fenceSha: SHA("2"),
    pullRequestUrl: "https://github.com/owner/repository/pull/1",
    autoDelivery: false, runtimeRequired: false,
    heartbeatAt: "2026-08-31T00:00:00.000Z",
    expiresAt: "2026-08-31T01:00:00.000Z",
    cloudAuthority: { targetRepository: "owner/repository" } };
  let body = updateWriterLeasePullRequestBody("# Authored review\n\nKeep this byte exact.\n", lease);
  const gh = () => JSON.stringify({ id: "PR_node", number: 1,
    url: lease.pullRequestUrl, state: "OPEN", isDraft: true, autoMergeRequest: null,
    headRefName: lease.branch, headRefOid: lease.fenceSha,
    headRepository: { nameWithOwner: "owner/repository" },
    baseRefName: "main", baseRefOid: lease.baseSha, body });
  const observer = createExpiredDescendantUntrackedScopeRecoveryRepositoryObserver({
    repository: "/source", controllerRoot: "/controller", git: () => "",
    gitRaw: () => "", gh, invoke: () => ({}), captureDirt: () => ({}),
  });
  const first = observer.pullFrame(lease, { requireSourceMarker: true });
  assert.equal(first.rawBodyDigest, digestValue(body));
  assert.match(preservedExpiredDescendantPullRequestDigest(first), /^[0-9a-f]{64}$/u);
  body = `${body}\n`;
  assert.throws(() => observer.pullFrame(lease, {
    expected: first.incident, expectedRawBodyDigest: first.rawBodyDigest,
    expectedStructuralMarkerDigest: first.structuralMarkerDigest,
  }), /byte-exact preserved pull request/u);
});

test("controller resume accepts only a clean descendant with the installed implementation", () => {
  const sealed = { repository: "git@github.com:owner/repository.git", branch: "main",
    headSha: SHA("a"), originMainSha: SHA("a"), treeSha: SHA("b"),
    implementationDigest: digestValue("implementation") };
  const current = { ...sealed, headSha: SHA("c"), originMainSha: SHA("c"),
    treeSha: SHA("d") };
  const calls = [];
  assert.equal(assertExpiredDescendantControllerContinuation({ sealed, current,
    isAncestor: (ancestor, descendant) => {
      calls.push([ancestor, descendant]); return true;
    } }), current);
  assert.deepEqual(calls, [[sealed.headSha, current.headSha]]);
  assert.throws(() => assertExpiredDescendantControllerContinuation({ sealed,
    current: { ...current, implementationDigest: digestValue("changed") },
    isAncestor: () => true }), /protected controller continuation/u);
  assert.throws(() => assertExpiredDescendantControllerContinuation({ sealed, current,
    isAncestor: () => false }), /protected controller continuation/u);
  assert.throws(() => assertExpiredDescendantControllerContinuation({ sealed,
    current: { ...current, originMainSha: SHA("e") }, isAncestor: () => true }),
  /protected controller continuation/u);
});
