import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { main, runCli } from
  "../scripts/admitted-prepared-descendant-canonical-supersession-retirement.mjs";

const digest = "a".repeat(64);

function common(repository) {
  return [
    `--repository=${repository}`, "--subject-worktree=/subject",
    "--target-repository=owner/repo", "--pull-request=7", `--claim-id=${digest}`,
    "--state-path=/private/state.json", "--source-task-authority=/private/source.json",
    "--successor-task-authority=/private/successor.json",
    "--successor-write-scope-manifest=/private/scope.json",
    "--successor-manifest=/private/supersession.json",
  ];
}

test("CLI transports one exact authorization from an external owner-private file", async t => {
  const root = mkdtempSync(path.join(tmpdir(), "prepared-supersession-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository"), privateRoot = path.join(root, "private");
  mkdirSync(repository); mkdirSync(privateRoot);
  const authorization = path.join(privateRoot, "authorization.txt");
  const phrase = `authorize admitted-prepared-descendant-canonical-supersession-retirement ${digest}`;
  writeFileSync(authorization, `${phrase}\n`, { mode: 0o600 }); chmodSync(authorization, 0o600);
  const calls = [];
  const dependencies = {
    createAdapter: options => (calls.push(options), {}),
    createController: () => ({
      plan: async () => ({ status: "planned" }),
      run: async input => (calls.push(input), { status: "complete" }),
    }),
  };
  await main(["run", ...common(repository), `--plan-digest=${digest}`,
    `--auth-file=${authorization}`], dependencies);
  assert.deepEqual(calls.at(-1), { planDigest: digest, authorization: phrase });
  assert.equal(calls[0].repository, repository);
});

test("CLI rejects relative, in-repository, permissive, and multiline authorization files", async t => {
  const root = mkdtempSync(path.join(tmpdir(), "prepared-supersession-cli-reject-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository"), privateRoot = path.join(root, "private");
  mkdirSync(repository); mkdirSync(privateRoot);
  const dependencies = { createAdapter: () => ({}), createController: () => ({ run: async () => ({}) }) };

  await assert.rejects(main(["run", ...common(repository), `--plan-digest=${digest}`,
    "--auth-file=relative.txt"], dependencies), /absolute path/u);

  const inside = path.join(repository, "authorization.txt");
  writeFileSync(inside, "secret", { mode: 0o600 }); chmodSync(inside, 0o600);
  await assert.rejects(main(["run", ...common(repository), `--plan-digest=${digest}`,
    `--auth-file=${inside}`], dependencies), /outside repository/u);

  const permissive = path.join(privateRoot, "permissive.txt");
  writeFileSync(permissive, "secret", { mode: 0o644 }); chmodSync(permissive, 0o644);
  await assert.rejects(main(["run", ...common(repository), `--plan-digest=${digest}`,
    `--auth-file=${permissive}`], dependencies), /exact mode 0600/u);

  const multiline = path.join(privateRoot, "multiline.txt");
  writeFileSync(multiline, "first\nsecond\n", { mode: 0o600 }); chmodSync(multiline, 0o600);
  await assert.rejects(main(["run", ...common(repository), `--plan-digest=${digest}`,
    `--auth-file=${multiline}`], dependencies), /exactly one line/u);
});

test("planning forbids authorization inputs and option duplication", async () => {
  const dependencies = { createAdapter: () => ({}), createController: () => ({ plan: async () => ({}) }) };
  await assert.rejects(main(["plan", ...common("/repository"), `--plan-digest=${digest}`],
    dependencies), /forbids/u);
  await assert.rejects(main(["plan", ...common("/repository"), "--pull-request=8"],
    dependencies), /provided once/u);
});

test("public diagnostics redact tokens and local capability paths", async () => {
  const writes = [], original = process.stdout.write;
  process.stdout.write = value => (writes.push(String(value)), true);
  try {
    assert.equal(await runCli(["plan", "--unknown=github_pat_SECRET123"]), 1);
    assert.equal(await runCli(["plan", "--unknown=/Users/person/private-capability.json"]), 1);
  } finally {
    process.stdout.write = original;
  }
  assert.match(writes[0], /\[redacted\]/u);
  assert.doesNotMatch(writes[0], /SECRET123/u);
  assert.match(writes[1], /\[local-path\]/u);
  assert.doesNotMatch(writes[1], /private-capability/u);
});
