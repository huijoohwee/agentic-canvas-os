import assert from "node:assert/strict";
import test from "node:test";

import {
  createGitHubRequest,
  projectPullRequest,
  projectRepository,
  projectRepositoryIdentity,
  requireServerTime,
} from "../scripts/github-cloud-collaboration-api.mjs";

test("GitHub request pins API headers and never returns its token", async () => {
  let observed;
  const request = createGitHubRequest({
    token: "test-token-value",
    fetchImpl: async (url, options) => {
      observed = { url: String(url), options };
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { date: "Thu, 30 Jul 2026 04:00:00 GMT" },
      });
    },
  });

  const result = await request({
    method: "PATCH",
    path: "/repos/owner/repo/git/refs/heads/agentic/collaboration-ledger",
    body: { sha: "a".repeat(40), force: false },
  });

  assert.equal(observed.url, "https://api.github.com/repos/owner/repo/git/refs/heads/agentic/collaboration-ledger");
  assert.equal(observed.options.headers.Authorization, "Bearer test-token-value");
  assert.equal(observed.options.headers["X-GitHub-Api-Version"], "2026-03-10");
  assert.deepEqual(JSON.parse(observed.options.body), { sha: "a".repeat(40), force: false });
  assert.equal(JSON.stringify(result).includes("test-token-value"), false);
});

test("Actions repository identity is accepted without weakening full repository projection", () => {
  const simpleRepository = {
    id: 7,
    node_id: "R_7",
    full_name: "owner/repo",
  };

  assert.deepEqual(projectRepositoryIdentity(simpleRepository), {
    id: 7,
    nodeId: "R_7",
    fullName: "owner/repo",
  });
  assert.throws(
    () => projectRepository(simpleRepository),
    /incomplete repository identity/u,
  );
  assert.throws(
    () => projectRepositoryIdentity({ ...simpleRepository, node_id: "" }),
    /incomplete repository identity/u,
  );
});

test("repository and pull-request projection bind immutable same-repository identity", () => {
  const repository = projectRepository({
    id: 7,
    node_id: "R_7",
    full_name: "owner/repo",
    default_branch: "main",
  });
  const pull = projectPullRequest({
    id: 9,
    node_id: "PR_9",
    number: 12,
    html_url: "https://example.invalid/owner/repo/pull/12",
    state: "open",
    draft: true,
    head: { ref: "agent/device/scope", sha: "a".repeat(40), repo: { full_name: "owner/repo" } },
    base: { ref: "main", sha: "b".repeat(40), repo: { full_name: "owner/repo" } },
  }, repository);

  assert.equal(pull.number, 12);
  assert.equal(pull.headSha, "a".repeat(40));
  assert.throws(
    () => projectPullRequest({
      id: 9,
      node_id: "PR_9",
      number: 12,
      html_url: "https://example.invalid/owner/repo/pull/12",
      head: { ref: "fork", sha: "a".repeat(40), repo: { full_name: "other/repo" } },
      base: { ref: "main", sha: "b".repeat(40), repo: { full_name: "owner/repo" } },
    }, repository),
    /same-repository projection/u,
  );
});

test("expiry time accepts only a valid server Date value", () => {
  assert.equal(
    requireServerTime("Thu, 30 Jul 2026 04:00:00 GMT"),
    "2026-07-30T04:00:00.000Z",
  );
  assert.throws(() => requireServerTime("not-a-date"), /server Date header/u);
});
