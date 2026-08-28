import assert from "node:assert/strict";
import {
  chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { main }
  from "../scripts/orphaned-absent-authored-lane-retirement.mjs";

const claimId = "a".repeat(64);
const planDigest = "b".repeat(64);
const authorization = `authorize orphaned-absent-authored-lane-retirement ${planDigest}`;

test("CLI transports exact plan and owner-only file authorization", async t => {
  const fixture = cliFixture(t);
  const calls = [];
  const adapter = { authorityForbiddenRoots: [fixture.repository, fixture.controllerRoot] };
  const dependencies = {
    createAdapter(options) {
      calls.push({ kind: "adapter", options });
      return adapter;
    },
    createRuntimeController(input) {
      assert.equal(input.adapter, adapter);
      return {
        plan: async () => ({ status: "planned", planDigest }),
        run: async input => (calls.push({ kind: "run", input }), { status: "complete" }),
      };
    },
  };

  const planned = await main(["plan", ...fixture.common], dependencies);
  assert.deepEqual(planned, { status: "planned", planDigest });
  assert.deepEqual(calls[0].options, {
    repository: fixture.repository,
    controllerRoot: fixture.controllerRoot,
    targetRepository: "owner/repository",
    ledgerRepository: "owner/controller",
    pullRequestNumber: 868,
    claimId,
    statePath: fixture.statePath,
    privateTaskRoot: fixture.privateTaskRoot,
  });

  const completed = await main(["run", ...fixture.common,
    `--plan-digest=${planDigest}`, `--auth-file=${fixture.authorizationPath}`], dependencies);
  assert.deepEqual(completed, { status: "complete" });
  assert.deepEqual(calls.at(-1), {
    kind: "run", input: { planDigest, authorization },
  });

  await assert.rejects(main(["plan", ...fixture.common,
    `--auth-file=${fixture.authorizationPath}`], dependencies), /does not accept/u);
  await assert.rejects(main(["run", ...fixture.common,
    `--plan-digest=${planDigest}`, `--authorize=${authorization}`], dependencies),
  /Unsupported option/u);
});

test("CLI rejects malformed identities, repeated options, and non-absolute private paths", async t => {
  const fixture = cliFixture(t);
  const dependencies = inertDependencies();
  const replace = (prefix, value) => fixture.common.map(argument =>
    argument.startsWith(prefix) ? value : argument);

  await assert.rejects(main(["plan", ...replace("--repository=", "--repository=relative")],
    dependencies), /repository.*absolute/u);
  await assert.rejects(main(["plan", ...replace("--state-path=", "--state-path=relative.json")],
    dependencies), /state-path.*absolute/u);
  await assert.rejects(main(["plan", ...replace("--private-task-root=", "--private-task-root=relative")],
    dependencies), /private-task-root.*absolute/u);
  await assert.rejects(main(["plan", ...replace("--target-repository=", "--target-repository=owner")],
    dependencies), /owner\/name/u);
  await assert.rejects(main(["plan", ...replace("--pull-request=", "--pull-request=0")],
    dependencies), /positive integer/u);
  await assert.rejects(main(["plan", ...replace("--claim-id=", "--claim-id=ABC")],
    dependencies), /lowercase SHA-256/u);
  await assert.rejects(main(["plan", ...fixture.common, "--json"], dependencies),
    /json.*at most once/u);
});

test("CLI rejects non-private, symlinked, multiline, colocated, and forbidden authorization files", async t => {
  const fixture = cliFixture(t);
  const dependencies = inertDependencies({
    authorityForbiddenRoots: [fixture.repository, fixture.controllerRoot],
  });
  const run = authorizationPath => main(["run", ...fixture.common,
    `--plan-digest=${planDigest}`, `--auth-file=${authorizationPath}`], dependencies);

  chmodSync(fixture.authorizationPath, 0o644);
  await assert.rejects(run(fixture.authorizationPath), /private owner-only regular file/u);
  chmodSync(fixture.authorizationPath, 0o600);

  const symlinkPath = path.join(fixture.privateRoot, "authorization-link.txt");
  symlinkSync(fixture.authorizationPath, symlinkPath);
  await assert.rejects(run(symlinkPath), /private owner-only regular file|symbolic link/u);

  writeFileSync(fixture.authorizationPath, `${authorization}\nforeign\n`, { mode: 0o600 });
  await assert.rejects(run(fixture.authorizationPath), /one exact newline-normalized/u);

  const forbidden = path.join(fixture.repository, "authorization.txt");
  writeFileSync(forbidden, `${authorization}\n`, { mode: 0o600 });
  await assert.rejects(run(forbidden), /outside repositories and worktrees/u);

  writeFileSync(fixture.statePath, `${authorization}\n`, { mode: 0o600 });
  await assert.rejects(run(fixture.statePath), /distinct|authorization.*journal/u);
});

test("CLI emits one sanitized blocked JSON result for argument errors", () => {
  const script = new URL("../scripts/orphaned-absent-authored-lane-retirement.mjs",
    import.meta.url);
  const result = spawnSync(process.execPath, [script.pathname, "plan",
    "--bad=github_pat_SECRET/Users/alice/private"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.schema, "agentic-orphaned-absent-authored-lane-retirement-result/v1");
  assert.equal(output.status, "blocked");
  assert.doesNotMatch(output.error, /github_pat_|\/Users\/alice/u);
});

function cliFixture(t) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "orphaned-lane-cli-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository");
  const controllerRoot = path.join(root, "controller");
  const privateTaskRoot = path.join(root, "task-state");
  const privateRoot = path.join(root, "private");
  for (const directory of [repository, controllerRoot, privateTaskRoot, privateRoot]) {
    mkdirSync(directory, { mode: 0o700 });
  }
  const statePath = path.join(privateRoot, "retirement.json");
  const authorizationPath = path.join(privateRoot, "authorization.txt");
  writeFileSync(authorizationPath, `${authorization}\n`, { mode: 0o600 });
  chmodSync(authorizationPath, 0o600);
  const common = [
    `--repository=${repository}`,
    "--target-repository=owner/repository",
    "--ledger-repository=owner/controller",
    "--pull-request=868",
    `--claim-id=${claimId}`,
    `--private-task-root=${privateTaskRoot}`,
    `--state-path=${statePath}`,
    `--controller-root=${controllerRoot}`,
    "--json",
  ];
  return { root, repository, controllerRoot, privateTaskRoot, privateRoot,
    statePath, authorizationPath, common };
}

function inertDependencies(adapter = { authorityForbiddenRoots: [] }) {
  return {
    createAdapter: () => adapter,
    createRuntimeController: () => ({
      plan: async () => ({ status: "planned" }),
      run: async () => ({ status: "complete" }),
    }),
  };
}
