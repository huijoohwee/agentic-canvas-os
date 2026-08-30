import assert from "node:assert/strict";
import test from "node:test";

import {
  createGitHubConditionalPullBodyPort,
} from "../scripts/github-conditional-pull-body.mjs";
import {
  composeReanchorAdapterDependencies,
} from "../scripts/active-owned-dirt-current-base-reanchor.mjs";

const TARGET = "acme/example";
const NUMBER = 823;
const STRONG = '"0123456789abcdef"';
const WEAK = `W/${STRONG}`;

function pull({ body = "source body", etag = WEAK } = {}) {
  return response({
    headers: [`Etag: ${etag}`],
    body: JSON.stringify({
      node_id: "PR_node",
      number: NUMBER,
      html_url: `https://github.com/${TARGET}/pull/${NUMBER}`,
      state: "open",
      draft: true,
      head: {
        ref: "agent/device/scope",
        sha: "a".repeat(40),
        repo: { full_name: TARGET },
      },
      base: { sha: "b".repeat(40) },
      body,
    }),
  });
}

function head(etag = STRONG) {
  return response({ headers: [`Etag: ${etag}`] });
}

function response({ status = 200, headers = [], body = "" } = {}) {
  return [
    `HTTP/2.0 ${status} ${status === 200 ? "OK" : "Precondition Failed"}`,
    ...headers,
    "",
    body,
  ].join("\r\n");
}

function redirectThen({ finalHeaders = [], body = "" } = {}) {
  return [
    response({ status: 302, headers: ['Etag: "redirect"'] }),
    response({ headers: finalHeaders, body }),
  ].join("");
}

function fixture(outputs) {
  const calls = [];
  const execute = (command, args) => {
    calls.push({ command, args: [...args] });
    const next = outputs.shift();
    if (next instanceof Error) throw next;
    assert.notEqual(next, undefined, "unexpected provider command");
    return next;
  };
  return {
    calls,
    port: createGitHubConditionalPullBodyPort({
      repository: "/workspace/repository",
      execute,
    }),
  };
}

test("strong HEAD joins a weak GET representation without promoting the weak tag", () => {
  const { calls, port } = fixture([head(), pull()]);
  const snapshot = port.readConditionalPull({
    targetRepository: TARGET,
    pullRequestNumber: NUMBER,
  });
  assert.equal(snapshot.etag, STRONG);
  assert.equal(snapshot.body, "source body");
  assert.equal(snapshot.headRepository, TARGET);
  assert.match(calls[0].args.join(" "), /--method HEAD/u);
  assert.match(calls[1].args.join(" "), /--method GET/u);
  assert.ok(calls[1].args.includes(`If-Match: ${STRONG}`));
  assert.ok(!calls.flatMap(call => call.args).some(value => /If-Unmodified-Since/iu.test(value)));
});

test("weak, missing, multiple, and malformed HEAD validators fail before GET", () => {
  for (const output of [
    head(WEAK),
    response(),
    response({ headers: [`Etag: ${STRONG}`, 'Etag: "other"'] }),
    redirectThen({ finalHeaders: [`Etag: ${STRONG}`] }),
    redirectThen(),
    head("unquoted"),
    head("*"),
  ]) {
    const { calls, port } = fixture([output]);
    assert.throws(() => port.readConditionalPull({
      targetRepository: TARGET,
      pullRequestNumber: NUMBER,
    }), /strong entity tag/u);
    assert.equal(calls.length, 1);
  }
});

test("conditional GET rejects status, validator, JSON, and opaque-token drift", () => {
  for (const output of [
    response({ status: 412, headers: [`Etag: ${WEAK}`] }),
    redirectThen({ finalHeaders: [`Etag: ${WEAK}`], body: "{}" }),
    redirectThen({ body: "{}" }),
    pull({ etag: 'W/"different"' }),
    response({ headers: [`Etag: ${WEAK}`], body: "{" }),
    response({ body: "{}" }),
  ]) {
    const { port } = fixture([head(), output]);
    assert.throws(() => port.readConditionalPull({
      targetRepository: TARGET,
      pullRequestNumber: NUMBER,
    }), /conditional pull-request/u);
  }
});

test("PATCH rechecks and carries the exact provider-issued strong validator", () => {
  const { calls, port } = fixture([head(), "{}"]);
  port.patchConditionalPull({
    targetRepository: TARGET,
    pullRequestNumber: NUMBER,
    expectedEtag: STRONG,
    body: "target body",
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].args.join(" "), /--method HEAD/u);
  assert.match(calls[1].args.join(" "), /--method PATCH/u);
  assert.ok(calls[1].args.includes(`If-Match: ${STRONG}`));
  assert.ok(calls[1].args.includes("body=target body"));
  assert.ok(!calls.flatMap(call => call.args).some(value => value === WEAK));
});

test("the reanchor composition root injects one complete provider port", () => {
  const pair = {
    readConditionalPull() {},
    patchConditionalPull() {},
  };
  let created = 0;
  const result = composeReanchorAdapterDependencies({
    repository: "/workspace/repository",
    createPort: () => {
      created += 1;
      return pair;
    },
  });
  assert.equal(created, 1);
  assert.equal(result.readConditionalPull, pair.readConditionalPull);
  assert.equal(result.patchConditionalPull, pair.patchConditionalPull);

  const supplied = composeReanchorAdapterDependencies({
    repository: "/workspace/repository",
    adapterDependencies: pair,
    createPort: () => assert.fail("supplied pair must not be replaced"),
  });
  assert.equal(supplied.readConditionalPull, pair.readConditionalPull);
  assert.throws(() => composeReanchorAdapterDependencies({
    repository: "/workspace/repository",
    adapterDependencies: { readConditionalPull() {} },
  }), /dependency pair must be complete/u);
});

test("PATCH rejects stale, weak, or provider-failed preconditions without fallback", () => {
  for (const expectedEtag of [WEAK, "unquoted", "*"]) {
    const { calls, port } = fixture([]);
    assert.throws(() => port.patchConditionalPull({
      targetRepository: TARGET,
      pullRequestNumber: NUMBER,
      expectedEtag,
      body: "target body",
    }), /strong entity tag/u);
    assert.equal(calls.length, 0);
  }

  const stale = fixture([head('"new"')]);
  assert.throws(() => stale.port.patchConditionalPull({
    targetRepository: TARGET,
    pullRequestNumber: NUMBER,
    expectedEtag: STRONG,
    body: "target body",
  }), /changed before conditional PATCH/u);
  assert.equal(stale.calls.length, 1);

  const failed = fixture([head(), new Error("HTTP 412 Precondition Failed")]);
  assert.throws(() => failed.port.patchConditionalPull({
    targetRepository: TARGET,
    pullRequestNumber: NUMBER,
    expectedEtag: STRONG,
    body: "target body",
  }), /412 Precondition Failed/u);
  assert.equal(failed.calls.length, 2);
});
