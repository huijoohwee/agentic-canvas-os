import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectHybridWorkspace, READ_ONLY_GIT_COMMANDS } from "../scripts/cloud-workspace.mjs";
const SCRIPT = fileURLToPath(new URL("../scripts/cloud-workspace.mjs", import.meta.url));
const SIGNALS = ["CODESPACES", "GITPOD_WORKSPACE_ID", "CLOUD_WORKSTATION_CONFIG",
  "CLOUD_SHELL", "REMOTE_CONTAINERS", "DEVCONTAINER", "container"];
const CLOUD_SIGNALS = new Set(SIGNALS.slice(0, 4));
const CONTAINER_SIGNALS = new Set(["CODESPACES", "REMOTE_CONTAINERS", "DEVCONTAINER", "container"]);
const LIFECYCLE = { status: "deferred-to-admission", scope: "declared-write-scope", nextWorkflow: "node_modules/agentic-os/docs/START-WORKFLOW.md" };
function fixtureEnvironment() {
  const result = { ...process.env };
  for (const name of Object.keys(result)) if (name.startsWith("GIT_")) delete result[name];
  return {
    ...result, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: os.devNull, GIT_TERMINAL_PROMPT: "0",
  };
}
function command(cwd, executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd, encoding: "utf8", env: options.env || fixtureEnvironment(),
  });
  assert.equal(result.status, options.status ?? 0,
    result.stderr || `${executable} ${args.join(" ")} failed`);
  return result.stdout.trim();
}
function optionalCommand(cwd, executable, args) {
  const result = spawnSync(executable, args,
    { cwd, encoding: "utf8", env: fixtureEnvironment() });
  return result.status === 0 ? result.stdout.trim() : null;
}
function write(root, relativePath, source) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, source);
}
function configureAuthor(repository) {
  command(repository, "git", ["config", "user.name", "Hybrid Test"]);
  command(repository, "git", ["config", "user.email", "hybrid-test@example.invalid"]);
  command(repository, "git", ["config", "commit.gpgSign", "false"]);
  command(repository, "git", ["config", "tag.gpgSign", "false"]);
}
function commit(repository, message) {
  command(repository, "git", ["add", "."]);
  command(repository, "git", ["commit", "-q", "-m", message]);
  return command(repository, "git", ["rev-parse", "HEAD"]);
}
function createRepository() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hybrid-workspace-")));
  const [remote, workspace, template] = ["remote.git", "workspace", "empty-template"].map(
    (name) => path.join(root, name));
  fs.mkdirSync(workspace);
  fs.mkdirSync(template);
  command(root, "git", ["init", "-q", "--bare", `--template=${template}`, remote]);
  command(workspace, "git", ["init", "-q", "-b", "main", `--template=${template}`]);
  configureAuthor(workspace);
  write(workspace, "tracked.txt", "initial\n");
  commit(workspace, "initial");
  command(workspace, "git", ["remote", "add", "origin", remote]);
  command(workspace, "git", ["push", "-q", "-u", "origin", "main"]);
  command(root, "git", ["--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/main"]);
  return { root, remote, workspace };
}
function environment(overrides = {}) {
  const result = { ...process.env };
  for (const name of [...SIGNALS, "AGENTIC_WORKSPACE_PLACEMENT"]) delete result[name];
  for (const name of Object.keys(result)) if (name.startsWith("GIT_")) delete result[name];
  return { ...result, ...overrides };
}
function runFixtureGit(args, options) {
  return spawnSync("git", args,
    { cwd: options.cwd, env: options.environment, encoding: "utf8" });
}
function runBootstrap(cwd, { args = [], env = environment() } = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, "bootstrap", "--json", ...args],
    { cwd, env, encoding: "utf8" });
  return { status: result.status, output: result.stdout ? JSON.parse(result.stdout) : null,
    stdout: result.stdout, stderr: result.stderr };
}
function adminDigest(repository) {
  const gitDirectory = path.resolve(repository, command(repository, "git", ["rev-parse", "--git-dir"]));
  const hash = createHash("sha256");
  for (const relative of fs.readdirSync(gitDirectory, { recursive: true }).sort()) {
    const target = path.join(gitDirectory, relative);
    const stat = fs.lstatSync(target);
    hash.update(`${relative}\0${stat.mode}\0`);
    if (stat.isFile()) hash.update(fs.readFileSync(target));
    else if (stat.isSymbolicLink()) hash.update(fs.readlinkSync(target));
  }
  return hash.digest("hex");
}
function snapshot(fixture, siblingPaths = []) {
  return {
    head: command(fixture.workspace, "git", ["rev-parse", "HEAD"]),
    branch: optionalCommand(fixture.workspace, "git", ["symbolic-ref", "--short", "HEAD"]),
    status: command(fixture.workspace, "git", ["status", "--porcelain=v1", "--untracked-files=all"]),
    refs: command(fixture.workspace, "git", ["for-each-ref", "--format=%(refname) %(objectname)"]),
    worktrees: command(fixture.workspace, "git", ["worktree", "list", "--porcelain"]),
    remoteRefs: command(path.dirname(fixture.remote), "git", ["--git-dir", fixture.remote,
      "for-each-ref", "--format=%(refname) %(objectname)"]),
    siblings: siblingPaths.map((sibling) => ({
      path: sibling, head: command(sibling, "git", ["rev-parse", "HEAD"]),
      branch: optionalCommand(sibling, "git", ["symbolic-ref", "--short", "HEAD"]),
      status: command(sibling, "git", ["status", "--porcelain=v1", "--untracked-files=all"]),
    })),
    adminDigest: adminDigest(fixture.workspace),
  };
}
function findingCodes(output) { return output.findings.map((finding) => finding.code); }
function assertEnvelope(output) {
  assert.deepEqual(Object.keys(output).sort(), [
    "findings", "lifecycle", "mutationAuthority", "placement", "repository", "schema", "status",
  ]);
  assert.deepEqual(Object.keys(output.placement).sort(), ["containerized", "kind", "source"]);
  assert.deepEqual(Object.keys(output.repository).sort(), [
    "branch", "canonical", "clean", "headSha", "originMainSha",
    "registered", "relation",
  ]);
  for (const finding of output.findings) {
    assert.deepEqual(Object.keys(finding).sort(), ["code", "message"]);
  }
  assert.equal(output.schema, "agentic-hybrid-workspace-bootstrap/v1");
  assert.deepEqual(output.lifecycle, LIFECYCLE);
  assert.equal(output.mutationAuthority, false);
}
test("clean canonical bootstrap is deterministic and read-only", (t) => {
  const fixture = createRepository();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const before = snapshot(fixture);
  const first = inspectHybridWorkspace({ cwd: fixture.workspace, env: environment() });
  const second = inspectHybridWorkspace({ cwd: fixture.workspace, env: environment() });
  const execution = runBootstrap(fixture.workspace);
  assert.deepEqual(first, second);
  assert.equal(execution.status, 0, execution.stderr);
  assert.deepEqual(execution.output, first);
  assert.equal(first.status, "ready");
  assert.deepEqual(first.placement, { kind: "local", source: "default", containerized: false });
  assert.equal(first.repository.relation, "equal");
  assert.equal(first.repository.clean, true);
  assert.equal(first.repository.registered, true);
  assert.equal(first.repository.canonical, true);
  assert.deepEqual(first.findings, []);
  const oldNode = inspectHybridWorkspace({
    cwd: fixture.workspace, env: environment(), nodeVersion: "21.9.0",
  });
  assert.equal(oldNode.status, "blocked");
  assert.equal(oldNode.repository.canonical, true);
  assert.deepEqual(findingCodes(oldNode), ["unsupported-node-version"]);
  assertEnvelope(first);
  assert.deepEqual(snapshot(fixture), before);
});
test("dirty current bytes are blocked and preserved", (t) => {
  const fixture = createRepository();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  write(fixture.workspace, "tracked.txt", "changed but preserved\n");
  write(fixture.workspace, "private-token.txt", "do-not-project-this-value\n");
  const before = snapshot(fixture);
  const execution = runBootstrap(fixture.workspace);
  const rendered = `${execution.stdout}${execution.stderr}`;
  assert.equal(execution.status, 1);
  assert.deepEqual(findingCodes(execution.output), ["dirty-worktree"]);
  assert.equal(execution.output.repository.clean, false);
  assert.equal(execution.output.repository.relation, "equal");
  assert.equal(rendered.includes("do-not-project-this-value"), false);
  assert.equal(rendered.includes("private-token.txt"), false);
  assert.equal(fs.readFileSync(path.join(fixture.workspace, "tracked.txt"), "utf8"), "changed but preserved\n");
  assert.equal(fs.readFileSync(path.join(fixture.workspace, "private-token.txt"), "utf8"), "do-not-project-this-value\n");
  assertEnvelope(execution.output);
  assert.deepEqual(snapshot(fixture), before);
});
test("detached HEAD blocks without moving the commit", (t) => {
  const fixture = createRepository();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  command(fixture.workspace, "git", ["switch", "-q", "--detach"]);
  const before = snapshot(fixture);
  const execution = runBootstrap(fixture.workspace);
  assert.equal(execution.status, 1);
  assert.deepEqual(findingCodes(execution.output), ["detached-head"]);
  assert.equal(execution.output.repository.branch, null);
  assert.equal(execution.output.repository.clean, true);
  assert.equal(execution.output.repository.registered, true);
  assert.equal(execution.output.repository.canonical, false);
  assertEnvelope(execution.output);
  assert.deepEqual(snapshot(fixture), before);
});
test("true main divergence is classified without reconciliation", (t) => {
  const fixture = createRepository();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const peer = path.join(fixture.root, "peer");
  command(fixture.root, "git", ["clone", "-q", "--branch", "main", fixture.remote, peer]);
  configureAuthor(peer);
  write(fixture.workspace, "local.txt", "local\n");
  commit(fixture.workspace, "local advance");
  write(peer, "remote.txt", "remote\n");
  commit(peer, "remote advance");
  command(peer, "git", ["push", "-q", "origin", "main"]);
  command(fixture.workspace, "git", ["fetch", "-q", "origin", "main"]);
  const localHead = command(fixture.workspace, "git", ["rev-parse", "HEAD"]);
  const remoteHead = command(fixture.workspace, "git", ["rev-parse", "origin/main"]);
  command(fixture.workspace, "git", ["merge-base", "--is-ancestor", localHead, remoteHead], { status: 1 });
  command(fixture.workspace, "git", ["merge-base", "--is-ancestor", remoteHead, localHead], { status: 1 });
  const before = snapshot(fixture);
  const execution = runBootstrap(fixture.workspace);
  assert.equal(execution.status, 1);
  assert.equal(execution.output.repository.relation, "diverged");
  assert.equal(execution.output.repository.clean, true);
  assert.equal(execution.output.repository.canonical, false);
  assert.deepEqual(findingCodes(execution.output), ["divergent-main"]);
  assertEnvelope(execution.output);
  assert.deepEqual(snapshot(fixture), before);
});
test("missing origin is distinct from dirt", (t) => {
  const fixture = createRepository();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  command(fixture.workspace, "git", ["remote", "remove", "origin"]);
  const before = snapshot(fixture);
  const execution = runBootstrap(fixture.workspace);
  assert.equal(execution.status, 1);
  assert.equal(execution.output.repository.originMainSha, null);
  assert.equal(execution.output.repository.relation, "unavailable");
  assert.equal(execution.output.repository.clean, true);
  assert.deepEqual(findingCodes(execution.output), ["missing-origin"]);
  assertEnvelope(execution.output);
  assert.deepEqual(snapshot(fixture), before);
});
test("non-main and missing origin/main states block distinctly", (t) => {
  const fixture = createRepository();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  command(fixture.workspace, "git", ["switch", "-q", "-c", "feature"]);
  const nonMainBefore = snapshot(fixture);
  const nonMain = runBootstrap(fixture.workspace);
  assert.equal(nonMain.status, 1);
  assert.equal(nonMain.output.status, "blocked");
  assert.deepEqual(findingCodes(nonMain.output), ["non-main-branch"]);
  assert.deepEqual(nonMain.output.repository, {
    branch: "feature",
    headSha: command(fixture.workspace, "git", ["rev-parse", "HEAD"]),
    originMainSha: command(fixture.workspace, "git", ["rev-parse", "origin/main"]),
    relation: "equal",
    clean: true,
    registered: true,
    canonical: false,
  });
  assert.deepEqual(snapshot(fixture), nonMainBefore);
  command(fixture.workspace, "git", ["switch", "-q", "main"]);
  command(fixture.workspace, "git", ["update-ref", "-d", "refs/remotes/origin/main"]);
  const missingBefore = snapshot(fixture);
  const missingTrackingRef = runBootstrap(fixture.workspace);
  assert.equal(missingTrackingRef.status, 1);
  assert.equal(missingTrackingRef.output.status, "blocked");
  assert.equal(missingTrackingRef.output.repository.originMainSha, null);
  assert.equal(missingTrackingRef.output.repository.relation, "unavailable");
  assert.equal(missingTrackingRef.output.repository.clean, true);
  assert.equal(missingTrackingRef.output.repository.registered, true);
  assert.equal(missingTrackingRef.output.repository.canonical, false);
  assert.deepEqual(findingCodes(missingTrackingRef.output), ["origin-main-unavailable"]);
  assertEnvelope(nonMain.output);
  assertEnvelope(missingTrackingRef.output);
  assert.deepEqual(snapshot(fixture), missingBefore);
});
test("ahead and behind main remain distinct blocked observations", (t) => {
  const ahead = createRepository();
  const behind = createRepository();
  t.after(() => fs.rmSync(ahead.root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(behind.root, { recursive: true, force: true }));
  write(ahead.workspace, "ahead.txt", "ahead\n");
  commit(ahead.workspace, "local advance");
  const aheadBefore = snapshot(ahead);
  const aheadExecution = runBootstrap(ahead.workspace);
  const peer = path.join(behind.root, "peer");
  command(behind.root, "git", ["clone", "-q", "--branch", "main", behind.remote, peer]);
  configureAuthor(peer);
  write(peer, "behind.txt", "behind\n");
  commit(peer, "remote advance");
  command(peer, "git", ["push", "-q", "origin", "main"]);
  command(behind.workspace, "git", ["fetch", "-q", "origin", "main"]);
  const behindBefore = snapshot(behind);
  const behindExecution = runBootstrap(behind.workspace);
  for (const [execution, fixture, before, relation, finding] of [
    [aheadExecution, ahead, aheadBefore, "ahead", "ahead-of-origin-main"],
    [behindExecution, behind, behindBefore, "behind", "behind-origin-main"],
  ]) {
    assert.equal(execution.status, 1, execution.stderr);
    assert.equal(execution.output.status, "blocked");
    assert.equal(execution.output.repository.canonical, false);
    assert.equal(execution.output.repository.relation, relation);
    assert.deepEqual(findingCodes(execution.output), [finding]);
    assertEnvelope(execution.output);
    assert.deepEqual(snapshot(fixture), before);
  }
});
test("runtime signals project only neutral placement booleans", (t) => {
  const fixture = createRepository();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  for (const [index, signal] of SIGNALS.entries()) {
    const secret = `opaque-runtime-value-${index}`;
    const execution = runBootstrap(fixture.workspace, { env: environment({ [signal]: secret }) });
    assert.equal(execution.status, 0, execution.stderr);
    assert.equal(execution.output.placement.kind, CLOUD_SIGNALS.has(signal) ? "cloud" : "local");
    assert.equal(execution.output.placement.source, CLOUD_SIGNALS.has(signal) ? "runtime-signal" : "default");
    assert.equal(execution.output.placement.containerized, CONTAINER_SIGNALS.has(signal));
    const rendered = `${execution.stdout}${execution.stderr}`;
    assert.equal(rendered.includes(secret), false);
    assert.equal(rendered.includes(`"${signal}"`), false);
    assertEnvelope(execution.output);
  }
  const falseButPresent = runBootstrap(fixture.workspace, {
    env: environment({ CODESPACES: "false" }),
  });
  assert.deepEqual(falseButPresent.output.placement, {
    kind: "cloud", source: "runtime-signal", containerized: true,
  });
});
test("placement overrides are explicit and fail closed", (t) => {
  const fixture = createRepository();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const selected = runBootstrap(fixture.workspace, {
    args: ["--placement=LOCAL"],
    env: environment({ AGENTIC_WORKSPACE_PLACEMENT: "cloud" }),
  });
  assert.equal(selected.status, 0, selected.stderr);
  assert.deepEqual(selected.output.placement, {
    kind: "local", source: "override", containerized: false,
  });
  const invalid = runBootstrap(fixture.workspace, {
    args: ["--placement=opaque-secret-choice"],
  });
  assert.equal(invalid.status, 1);
  assert.deepEqual(invalid.output.placement, {
    kind: "unknown", source: "invalid-override", containerized: false,
  });
  assert.deepEqual(findingCodes(invalid.output), ["invalid-placement-override"]);
  assert.equal(`${invalid.stdout}${invalid.stderr}`.includes("opaque-secret-choice"), false);
  const emptyEnvironmentOverride = runBootstrap(fixture.workspace, {
    env: environment({ AGENTIC_WORKSPACE_PLACEMENT: "  " }),
  });
  assert.equal(emptyEnvironmentOverride.status, 0);
  assert.deepEqual(emptyEnvironmentOverride.output.placement, {
    kind: "local", source: "default", containerized: false,
  });
  for (const output of [selected.output, invalid.output, emptyEnvironmentOverride.output]) {
    assertEnvelope(output);
  }
});
test("usage errors do not inspect or mutate Git", (t) => {
  const fixture = createRepository();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const before = snapshot(fixture);
  for (const args of [
    [], ["unknown"], ["bootstrap", "extra"],
    ["bootstrap", "--unknown"], ["bootstrap", "--placement"],
  ]) {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: fixture.workspace,
      env: environment(),
      encoding: "utf8",
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage: cloud-workspace\.mjs bootstrap/u);
  }
  assert.deepEqual(snapshot(fixture), before);
});
test("inspection uses only the sanitized read-only Git allowlist", (t) => {
  const fixture = createRepository();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  write(fixture.workspace, "ahead.txt", "ahead\n");
  commit(fixture.workspace, "ahead for allowlist");
  const observations = [];
  const runGit = (args, options) => {
    observations.push({ args, options });
    if (JSON.stringify(args) === JSON.stringify(READ_ONLY_GIT_COMMANDS.gitVersion)) {
      return { status: 0, stdout: "git version 2.45.0\n" };
    }
    return runFixtureGit(args, options);
  };
  const output = inspectHybridWorkspace({
    cwd: fixture.workspace,
    env: environment({
      CODESPACES: "secret-codespaces",
      GITPOD_WORKSPACE_ID: "secret-gitpod",
      AGENTIC_WORKSPACE_PLACEMENT: "cloud",
    }),
    runGit,
  });
  const staticSignatures = new Set(
    Object.values(READ_ONLY_GIT_COMMANDS).map((args) => JSON.stringify(args)),
  );
  assert.ok(observations.length > 0);
  for (const { args, options } of observations) {
    const dynamicAncestry = args.length === 4
      && args[0] === "merge-base"
      && args[1] === "--is-ancestor"
      && args.slice(2).every((value) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value));
    assert.equal(staticSignatures.has(JSON.stringify(args)) || dynamicAncestry, true);
    assert.equal([
      "fetch", "pull", "merge", "rebase", "reset", "switch", "checkout",
      "stash", "clean", "worktree-add", "push",
    ].includes(args[0]), false);
    assert.deepEqual(options.prefix, [
      "-c", "core.fsmonitor=false", "-c", "submodule.recurse=false",
    ]);
    assert.equal(options.noLazyFetch, args[0] !== "--version");
    const gitEnvironment = options.environment;
    for (const name of [...SIGNALS, "AGENTIC_WORKSPACE_PLACEMENT"]) {
      assert.equal(Object.hasOwn(gitEnvironment, name), false);
    }
    assert.equal(Object.values(gitEnvironment).some(
      (value) => String(value).startsWith("secret-"),
    ), false);
    assert.deepEqual({
      global: gitEnvironment.GIT_CONFIG_GLOBAL,
      noSystem: gitEnvironment.GIT_CONFIG_NOSYSTEM,
      system: gitEnvironment.GIT_CONFIG_SYSTEM,
      optionalLocks: gitEnvironment.GIT_OPTIONAL_LOCKS,
      noLazyFetch: gitEnvironment.GIT_NO_LAZY_FETCH,
      noReplace: gitEnvironment.GIT_NO_REPLACE_OBJECTS,
      prompt: gitEnvironment.GIT_TERMINAL_PROMPT,
    }, {
      global: os.devNull, noSystem: "1", system: os.devNull,
      optionalLocks: "0", noLazyFetch: "1", noReplace: "1", prompt: "0",
    });
  }
  assertEnvelope(output);
});
test("failed remote and branch probes are not confirmed absence states", (t) => {
  const fixture = createRepository();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const injectFailure = (commandName) => (args, options) => args[0] === commandName
    ? { status: 128, stdout: "", stderr: "private failure" }
    : runFixtureGit(args, options);
  const remoteFailure = inspectHybridWorkspace({
    cwd: fixture.workspace, env: environment(), runGit: injectFailure("remote"),
  });
  const branchFailure = inspectHybridWorkspace({
    cwd: fixture.workspace, env: environment(), runGit: injectFailure("symbolic-ref"),
  });
  assert.ok(findingCodes(remoteFailure).includes("remote-inventory-unavailable"));
  assert.equal(findingCodes(remoteFailure).includes("missing-origin"), false);
  assert.ok(findingCodes(branchFailure).includes("branch-unavailable"));
  assert.equal(findingCodes(branchFailure).includes("detached-head"), false);
  assert.equal(JSON.stringify([remoteFailure, branchFailure]).includes("private failure"), false);
  assertEnvelope(remoteFailure);
  assertEnvelope(branchFailure);
});
test("shallow or failed ancestry never fabricates divergence", (t) => {
  const fixture = createRepository();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  write(fixture.workspace, "ahead.txt", "ahead\n");
  commit(fixture.workspace, "ahead for shallow proof");
  const runGit = (args, options) => {
    if (args[0] === "merge-base") return { status: 1, stdout: "" };
    if (JSON.stringify(args) === JSON.stringify(READ_ONLY_GIT_COMMANDS.shallow)) {
      return { status: 0, stdout: "true\n" };
    }
    return runFixtureGit(args, options);
  };
  const shallow = inspectHybridWorkspace({
    cwd: fixture.workspace, env: environment(), runGit,
  });
  const failed = inspectHybridWorkspace({
    cwd: fixture.workspace,
    env: environment(),
    runGit: (args, options) => args[0] === "merge-base"
      ? { status: 1, stdout: "", error: new Error("private ancestry failure") }
      : runFixtureGit(args, options),
  });
  for (const output of [shallow, failed]) {
    assert.equal(output.repository.relation, "unavailable");
    assert.ok(findingCodes(output).includes("main-relation-unavailable"));
    assert.equal(findingCodes(output).includes("divergent-main"), false);
    assertEnvelope(output);
  }
});
test("configured clean and process filters block before external execution", (t) => {
  const fixture = createRepository();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  write(fixture.workspace, ".gitattributes", "tracked.txt filter=review\n");
  commit(fixture.workspace, "declare test filter");
  command(fixture.workspace, "git", ["push", "-q", "origin", "main"]);
  const [helper, marker] = ["filter-side-effect.mjs", "filter-invoked"]
    .map((name) => path.join(fixture.root, name));
  fs.writeFileSync(helper, "import fs from 'node:fs'; fs.writeFileSync(process.argv[2], 'invoked\\n'); process.stdin.pipe(process.stdout);\n");
  const externalFilter = [process.execPath, helper, marker].map(JSON.stringify).join(" ");
  for (const kind of ["clean", "process"]) {
    command(fixture.workspace, "git", ["config", `filter.review.${kind}`, externalFilter]);
  }
  write(fixture.workspace, "tracked.txt", "changed but preserved\n");
  const state = () => ({ admin: adminDigest(fixture.workspace),
    tracked: fs.readFileSync(path.join(fixture.workspace, "tracked.txt"), "utf8") });
  const before = state();
  const execution = runBootstrap(fixture.workspace);
  assert.equal(execution.status, 1, execution.stderr);
  assert.deepEqual(findingCodes(execution.output), ["repository-filter-unsafe"]);
  assert.equal(fs.existsSync(marker), false);
  assert.deepEqual(state(), before);
  assertEnvelope(execution.output);
});
test("legacy promisor checkout blocks before object-reading probes", (t) => {
  const fixture = createRepository();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const before = snapshot(fixture);
  const calls = [];
  const runGit = (args, options) => {
    calls.push(args);
    if (JSON.stringify(args) === JSON.stringify(READ_ONLY_GIT_COMMANDS.gitVersion))
      return { status: 0, stdout: "git version 2.44.1\n" };
    if (JSON.stringify(args) === JSON.stringify(READ_ONLY_GIT_COMMANDS.promisorConfig))
      return { status: 0, stdout: "extensions.partialclone origin\n" };
    return runFixtureGit(args, options);
  };
  const output = inspectHybridWorkspace({ cwd: fixture.workspace, env: environment(), runGit });
  assert.equal(output.status, "blocked");
  assert.equal(output.repository.canonical, false);
  assert.deepEqual(findingCodes(output), ["promisor-lazy-fetch-unsafe"]);
  assert.deepEqual(calls, [READ_ONLY_GIT_COMMANDS.gitVersion,
    READ_ONLY_GIT_COMMANDS.repositoryRoot, READ_ONLY_GIT_COMMANDS.promisorConfig]);
  assertEnvelope(output);
  assert.deepEqual(snapshot(fixture), before);
});
test("locked or ambiguous current registration blocks bootstrap", (t) => {
  const fixture = createRepository();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const registrationResult = runFixtureGit(READ_ONLY_GIT_COMMANDS.registration,
    { cwd: fixture.workspace, environment: fixtureEnvironment() });
  const locked = registrationResult.stdout.replace(/\0\0$/u, "\0locked lifecycle\0\0");
  for (const registration of [locked, `${registrationResult.stdout}${registrationResult.stdout}`]) {
    const output = inspectHybridWorkspace({
      cwd: fixture.workspace,
      env: environment(),
      runGit: (args, options) => (
        JSON.stringify(args) === JSON.stringify(READ_ONLY_GIT_COMMANDS.registration)
          ? { status: 0, stdout: registration }
          : runFixtureGit(args, options)
      ),
    });
    assert.ok(findingCodes(output).includes("invalid-current-registration"));
    assert.equal(output.repository.registered, false);
    assert.equal(output.repository.canonical, false);
    assertEnvelope(output);
  }
});
test("status failure remains distinct from confirmed dirt", (t) => {
  const fixture = createRepository();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const runGit = (args, options) => args[0] === "status"
    ? { status: 128, stdout: "", stderr: "never-project-this-diagnostic" }
    : runFixtureGit(args, options);
  const output = inspectHybridWorkspace({
    cwd: fixture.workspace, env: environment(), runGit,
  });
  assert.equal(output.status, "blocked");
  assert.equal(output.repository.clean, null);
  assert.deepEqual(findingCodes(output), ["status-unavailable"]);
  assert.equal(JSON.stringify(output).includes("never-project"), false);
  assertEnvelope(output);
});
test("dirty sibling lane is deferred to admission without blocking bootstrap", (t) => {
  const fixture = createRepository();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const sibling = path.join(fixture.root, "sibling");
  command(fixture.workspace, "git", ["branch", "disjoint-peer"]);
  command(fixture.workspace, "git", ["worktree", "add", "-q", sibling, "disjoint-peer"]);
  write(sibling, "peer-owned.txt", "preserve peer\n");
  const before = snapshot(fixture, [sibling]);
  const execution = runBootstrap(fixture.workspace);
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.output.status, "ready");
  assert.equal(execution.output.repository.canonical, true);
  assert.equal(fs.readFileSync(path.join(sibling, "peer-owned.txt"), "utf8"), "preserve peer\n");
  assertEnvelope(execution.output);
  assert.deepEqual(snapshot(fixture, [sibling]), before);
});
test("repository cloud-workspace wiring is exact", () => {
  const readJson = (relativePath) => JSON.parse(
    fs.readFileSync(new URL(relativePath, import.meta.url), "utf8"),
  );
  const packageJson = readJson("../package.json");
  assert.deepEqual(readJson("../.devcontainer/devcontainer.json"), {
    name: "Agentic Canvas OS hybrid workspace",
    image: "node:22-bookworm",
    remoteUser: "node",
    updateRemoteUserUID: true,
    postCreateCommand: "node ./scripts/cloud-workspace.mjs bootstrap --json",
  });
  assert.deepEqual({
    bootstrap: packageJson.scripts?.["workspace:cloud:bootstrap"],
    check: packageJson.scripts?.["workspace:cloud:check"],
  }, {
    bootstrap: "node ./scripts/cloud-workspace.mjs bootstrap --json",
    check: "node --test __tests__/cloud-workspace.test.mjs",
  });
  assert.equal(packageJson.scripts?.["preworkspace:cloud:bootstrap"], undefined);
  assert.equal(packageJson.scripts?.["postworkspace:cloud:bootstrap"], undefined);
});
