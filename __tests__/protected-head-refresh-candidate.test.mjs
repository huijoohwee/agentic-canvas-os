import assert from "node:assert/strict";
import test from "node:test";

import {
  createProtectedHeadRefreshCandidate,
  PROTECTED_HEAD_REFRESH_BOT_EMAIL,
  PROTECTED_HEAD_REFRESH_BOT_NAME,
  PROTECTED_HEAD_REFRESH_COMMIT_SCHEMA,
  renderProtectedHeadRefreshCommitMessage,
  verifyProtectedHeadRefreshCandidate,
  verifyProtectedHeadRefreshMergedCommit,
} from "../scripts/protected-main-refresh-lib.mjs";
import {
  candidate,
  candidateGitValues,
  createCandidateGitText,
  createMappedGitText,
  delivered,
  mainOne,
  mergedCommitGitValues,
  normalizedProjection,
  parentTimestamp,
  pullRequestTitle,
  refreshTwo,
  targetMain,
  treeOne,
  treeTwo,
} from "./protected-head-refresh-fixtures.mjs";

test("renders and verifies deterministic exact two-parent candidate bytes", () => {
  const operationId = normalizedProjection().operation_id;
  const message = renderProtectedHeadRefreshCommitMessage({
    operationId,
    observedHeadSha: delivered,
    targetMainSha: targetMain,
  });
  assert.equal(message, [
    "Protected head refresh",
    "",
    `Agentic-Schema: ${PROTECTED_HEAD_REFRESH_COMMIT_SCHEMA}`,
    "Agentic-Operation: protected-head-refresh",
    `Agentic-Operation-Id: ${operationId}`,
    `Agentic-Observed-Head: ${delivered}`,
    `Agentic-Target-Main: ${targetMain}`,
    "",
  ].join("\n"));

  const receipt = verifyProtectedHeadRefreshCandidate({
    candidateSha: candidate,
    observedHeadSha: delivered,
    targetMainSha: targetMain,
    operationId,
    gitText: createCandidateGitText({ operationId }),
  });
  assert.deepEqual(receipt, {
    candidateSha: candidate,
    observedHeadSha: delivered,
    targetMainSha: targetMain,
    operationId,
    treeSha: treeTwo,
    timestamp: parentTimestamp,
  });
  assert.equal(
    renderProtectedHeadRefreshCommitMessage({
      operationId,
      observedHeadSha: delivered,
      targetMainSha: targetMain,
    }),
    message,
    "identical immutable inputs produce identical commit message bytes",
  );
});

test("candidate construction freezes exact parent order, tree, identity, date, and message", () => {
  const operationId = normalizedProjection().operation_id;
  const gitCommands = [];
  const fixtureGitText = createCandidateGitText({ operationId });
  let request;
  const receipt = createProtectedHeadRefreshCandidate({
    observedHeadSha: delivered,
    targetMainSha: targetMain,
    operationId,
    gitText: args => {
      gitCommands.push(args.join(" "));
      return fixtureGitText(args);
    },
    commitTree: value => {
      request = value;
      return candidate;
    },
  });
  assert.equal(receipt.candidateSha, candidate);
  assert.deepEqual(request.parents, [delivered, targetMain]);
  assert.equal(request.treeSha, treeTwo);
  assert.equal(request.authorName, PROTECTED_HEAD_REFRESH_BOT_NAME);
  assert.equal(request.committerName, PROTECTED_HEAD_REFRESH_BOT_NAME);
  assert.equal(request.authorEmail, PROTECTED_HEAD_REFRESH_BOT_EMAIL);
  assert.equal(request.committerEmail, PROTECTED_HEAD_REFRESH_BOT_EMAIL);
  assert.equal(request.authorDate, parentTimestamp);
  assert.equal(request.committerDate, request.authorDate);
  assert.equal(request.message, renderProtectedHeadRefreshCommitMessage({
    operationId,
    observedHeadSha: delivered,
    targetMainSha: targetMain,
  }));
  assert.equal(Object.isFrozen(request), true);
  assert.equal(Object.isFrozen(request.parents), true);
  assert.equal(gitCommands.some(command => command.includes("--format=%cI")), false);
});

test("candidate construction preserves an exact raw UTC committer timestamp", () => {
  const operationId = normalizedProjection().operation_id;
  const utcTimestamp = "1786443889 +0000";
  const values = candidateGitValues({ operationId });
  const observedKey = `cat-file commit ${delivered}`;
  const candidateKey = `cat-file commit ${candidate}`;
  const overrides = {
    [observedKey]: values[observedKey].replaceAll(parentTimestamp, utcTimestamp),
    [candidateKey]: values[candidateKey].replaceAll(parentTimestamp, utcTimestamp),
  };
  const gitCommands = [];
  const fixtureGitText = createCandidateGitText({ operationId, overrides });
  let request;
  const receipt = createProtectedHeadRefreshCandidate({
    observedHeadSha: delivered,
    targetMainSha: targetMain,
    operationId,
    gitText: args => {
      gitCommands.push(args.join(" "));
      return fixtureGitText(args);
    },
    commitTree: value => {
      request = value;
      return candidate;
    },
  });
  assert.equal(receipt.timestamp, utcTimestamp);
  assert.equal(request.authorDate, utcTimestamp);
  assert.equal(request.committerDate, utcTimestamp);
  assert.equal(gitCommands.some(command => command.includes("--format=%cI")), false);
});

test("candidate construction rejects a malformed raw committer timestamp before commit creation", () => {
  const operationId = normalizedProjection().operation_id;
  const values = candidateGitValues({ operationId });
  const observedKey = `cat-file commit ${delivered}`;
  let commitTreeCalls = 0;
  assert.throws(() => createProtectedHeadRefreshCandidate({
    observedHeadSha: delivered,
    targetMainSha: targetMain,
    operationId,
    gitText: createCandidateGitText({
      operationId,
      overrides: {
        [observedKey]: values[observedKey].replace(
          `committer Developer <developer@example.com> ${parentTimestamp}`,
          "committer Developer <developer@example.com> invalid-timestamp",
        ),
      },
    }),
    commitTree: () => {
      commitTreeCalls += 1;
      return candidate;
    },
  }), /committer timestamp is malformed/u);
  assert.equal(commitTreeCalls, 0);
});

test("candidate proof rejects parent, tree, identity, timestamp, and message drift", async t => {
  const operationId = normalizedProjection().operation_id;
  const valid = candidateGitValues({ operationId });
  const raw = valid[`cat-file commit ${candidate}`];
  for (const [name, replacement, error] of [
    ["parent", raw.replace(`parent ${delivered}`, `parent ${mainOne}`), /not deterministic/u],
    ["tree", raw.replace(`tree ${treeTwo}`, `tree ${treeOne}`), /not deterministic/u],
    ["identity", raw.replace(PROTECTED_HEAD_REFRESH_BOT_NAME, "other-bot"), /not deterministic/u],
    ["timestamp", raw.replace(parentTimestamp, "1770000001 +0800"), /not deterministic/u],
    ["message", raw.replace("Protected head refresh", "Authored change"), /message is not exact/u],
  ]) {
    await t.test(name, () => assert.throws(() => verifyProtectedHeadRefreshCandidate({
      candidateSha: candidate,
      observedHeadSha: delivered,
      targetMainSha: targetMain,
      operationId,
      gitText: createCandidateGitText({
        operationId,
        overrides: { [`cat-file commit ${candidate}`]: replacement },
      }),
    }), error));
  }
});

test("exact squash proof binds parent, tree, subject, explicit body, and main ancestry", async t => {
  const projection = normalizedProjection();
  const explicitBody = JSON.parse(projection.candidate_auto_merge_commit_message);
  const values = mergedCommitGitValues({ body: explicitBody });
  const verify = (overrides = {}, commitMessageJson = projection.candidate_auto_merge_commit_message) => (
    verifyProtectedHeadRefreshMergedCommit({
      mergeCommitSha: refreshTwo,
      candidateSha: candidate,
      targetMainSha: targetMain,
      commitTitle: pullRequestTitle,
      commitMessageJson,
      gitText: createMappedGitText({ ...values, ...overrides }),
    })
  );
  assert.equal(verify().treeSha, treeTwo);
  assert.equal(verify({
    [`show -s --format=%b ${refreshTwo}`]: "provider-generated body\n",
  }, "null").commitMessageJson, "null");

  for (const [name, overrides, error] of [
    ["extra parent", {
      [`rev-list --parents -n 1 ${refreshTwo}`]:
        `${refreshTwo} ${targetMain} ${mainOne}\n`,
    }, /one-parent target-main squash/u],
    ["wrong direct parent despite descendant ancestry", {
      [`rev-list --parents -n 1 ${refreshTwo}`]: `${refreshTwo} ${mainOne}\n`,
    }, /one-parent target-main squash/u],
    ["wrong tree", {
      [`rev-parse ${refreshTwo}^{tree}`]: `${treeOne}\n`,
    }, /differs from the candidate tree/u],
    ["wrong subject", {
      [`show -s --format=%s ${refreshTwo}`]: "Substituted subject\n",
    }, /subject differs/u],
    ["wrong explicit body", {
      [`show -s --format=%b ${refreshTwo}`]: "Substituted body\n",
    }, /body differs/u],
    ["not on fetched main", {
      [`merge-base --is-ancestor ${refreshTwo} refs/remotes/origin/main`]:
        new Error("not an ancestor"),
    }, /not an ancestor/u],
  ]) {
    await t.test(name, () => assert.throws(() => verify(overrides), error));
  }
});
