import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildRepositoryValidationPolicy,
  normalizeRepositoryValidationPolicy,
  normalizeRepositoryValidationResult,
  REPOSITORY_VALIDATION_BOUNDS,
  REPOSITORY_VALIDATION_POLICY_SCHEMA,
  REPOSITORY_VALIDATION_RESULT_SCHEMA,
  runRepositoryValidation,
} from "../scripts/repository-validation-adapter.mjs";

test("npm-check/v1 seals exact manifests and executes structured argv deterministically", t => {
  const repository = fixture(t, {
    "package.json": JSON.stringify({ scripts: { check: "node --test" } }),
    "package-lock.json": JSON.stringify({ lockfileVersion: 3 }),
    "src/app.js": "export const value = 1;\n",
  });
  const baseSha = head(repository);
  write(repository, "src/app.js", "export const value = 2;\n");
  commit(repository, "candidate");
  const candidateSha = head(repository);
  const policy = postcommitPolicy(repository, {
    adapter: "npm-check/v1",
    baseSha,
    candidateSha,
    paths: ["src/app.js"],
  });
  assert.equal(policy.schema, REPOSITORY_VALIDATION_POLICY_SCHEMA);
  assert.deepEqual(policy.command, { executable: "npm", argv: ["run", "check"], shell: false });
  assert.deepEqual(normalizeRepositoryValidationPolicy(policy), policy);

  const calls = [];
  const execute = (command, args, options) => {
    if (command === "npm") {
      calls.push({ command, args, shell: options.shell, cwd: options.cwd });
      return Buffer.from("bounded output\n");
    }
    return execFileSync(command, args, options);
  };
  const first = runRepositoryValidation({ repository, policy }, { execute });
  const second = runRepositoryValidation({ repository, policy }, { execute });
  assert.equal(first.schema, REPOSITORY_VALIDATION_RESULT_SCHEMA);
  assert.equal(first.status, "passed");
  assert.equal(first.receiptDigest, second.receiptDigest);
  assert.deepEqual(normalizeRepositoryValidationResult(first), first);
  assert.deepEqual(calls, [
    { command: "npm", args: ["run", "check"], shell: false, cwd: repository },
    { command: "npm", args: ["run", "check"], shell: false, cwd: repository },
  ]);
});

test("npm-check/v1 rejects changed manifest entries whose manifest evidence is stale", async t => {
  for (const [name, field, baseValue, candidateValue] of [
    ["package.json", "packageJson",
      JSON.stringify({ scripts: { check: "node --test" }, version: "1.0.0" }),
      JSON.stringify({ scripts: { check: "node --test" }, version: "1.0.1" })],
    ["package-lock.json", "packageLock",
      JSON.stringify({ lockfileVersion: 3, version: "1.0.0" }),
      JSON.stringify({ lockfileVersion: 3, version: "1.0.1" })],
  ]) {
    await t.test(name, t => {
      const repository = fixture(t, {
        "package.json": name === "package.json" ? baseValue
          : JSON.stringify({ scripts: { check: "node --test" } }),
        "package-lock.json": name === "package-lock.json" ? baseValue
          : JSON.stringify({ lockfileVersion: 3 }),
      });
      const baseSha = head(repository);
      write(repository, name, candidateValue);
      commit(repository, `change ${name}`);
      const candidateSha = head(repository);
      const manifest = {
        packageJson: gitEntry(repository, candidateSha, "package.json"),
        packageLock: gitEntry(repository, candidateSha, "package-lock.json"),
      };
      manifest[field] = gitEntry(repository, baseSha, name);
      const policy = buildRepositoryValidationPolicy({
        adapter: "npm-check/v1", mode: "postcommit", baseSha, candidateSha,
        candidateTreeSha: git(repository, ["rev-parse", `${candidateSha}^{tree}`]).trim(),
        entries: [gitEntry(repository, candidateSha, name)], manifest,
      });
      let invoked = false;
      assert.throws(() => runRepositoryValidation({ repository, policy }, {
        execute: (command, args, options) => {
          if (command === "npm") { invoked = true; return Buffer.alloc(0); }
          return execFileSync(command, args, options);
        },
      }), /path, source, mode, blob, content, or size drifted/u);
      assert.equal(invoked, false);
    });
  }
});

test("git-content/v1 validates one exact committed Markdown delta without a manifest", t => {
  const repository = fixture(t, { "README.md": "# Base\n" });
  const baseSha = head(repository);
  write(repository, "specs/plan.md", "# Plan\n\nOffline-first.\n");
  commit(repository, "docs candidate");
  const candidateSha = head(repository);
  const policy = postcommitPolicy(repository, {
    adapter: "git-content/v1",
    baseSha,
    candidateSha,
    paths: ["specs/plan.md"],
  });
  const result = runRepositoryValidation({ repository, policy });
  assert.equal(result.validation.kind, "content");
  assert.equal(result.validation.checkedEntries, 1);
  assert.equal(result.validation.checkedBytes, Buffer.byteLength("# Plan\n\nOffline-first.\n"));
  assert.equal(result.invariants.unchanged, true);
});

test("git-content/v1 supports the exact dirty-untracked Markdown precommit case", t => {
  const repository = fixture(t, { "README.md": "# Base\n" });
  write(repository, ".kiro/specs/product/requirements.md", "# Requirements\n\nLocal-first.\n");
  const candidateSha = head(repository);
  const policy = buildRepositoryValidationPolicy({
    adapter: "git-content/v1",
    mode: "precommit",
    baseSha: candidateSha,
    candidateSha,
    candidateTreeSha: git(repository, ["rev-parse", "HEAD^{tree}"]).trim(),
    entries: [workingEntry(repository, ".kiro/specs/product/requirements.md")],
    manifest: null,
  });
  const result = runRepositoryValidation({ repository, policy });
  assert.equal(result.mode, "precommit");
  assert.equal(result.validation.checkedEntries, 1);
  assert.equal(git(repository, ["status", "--porcelain"]), "?? .kiro/\n");
});

test("policy normalization rejects mixed sources, code, special modes, and oversize input", t => {
  const repository = fixture(t, { "README.md": "# Base\n" });
  const sha = head(repository);
  write(repository, "draft.md", "draft\n");
  const working = workingEntry(repository, "draft.md");
  const tracked = gitEntry(repository, sha, "README.md");
  const input = entries => ({
    adapter: "git-content/v1",
    mode: "precommit",
    baseSha: sha,
    candidateSha: sha,
    candidateTreeSha: git(repository, ["rev-parse", "HEAD^{tree}"]).trim(),
    entries,
    manifest: null,
  });
  assert.throws(() => buildRepositoryValidationPolicy(input([working, tracked])), /mix sources/u);
  assert.throws(() => buildRepositoryValidationPolicy(input([{ ...working, path: "draft.js" }])), /only Markdown/u);
  assert.throws(() => buildRepositoryValidationPolicy(input([{ ...working, mode: "120000" }])), /symlink or submodule/u);
  assert.throws(() => buildRepositoryValidationPolicy(input([{ ...working, mode: "160000" }])), /symlink or submodule/u);
  assert.throws(() => buildRepositoryValidationPolicy(input([{
    ...working,
    size: REPOSITORY_VALIDATION_BOUNDS.maxFileBytes + 1,
  }])), /out of bounds/u);
});

for (const [name, bytes, pattern] of [
  ["NUL", Buffer.from("# Bad\n\0binary\n"), /NUL or binary/u],
  ["invalid UTF-8", Buffer.from([0x23, 0x20, 0xff, 0x0a]), /not bounded UTF-8/u],
  ["conflict marker", Buffer.from("# Bad\n<<<<<<< ours\n=======\n>>>>>>> theirs\n"), /conflict markers/u],
]) {
  test(`git-content/v1 rejects ${name} Markdown`, t => {
    const repository = fixture(t, { "README.md": "# Base\n" });
    write(repository, "unsafe.md", bytes);
    const sha = head(repository);
    const policy = precommitPolicy(repository, sha, ["unsafe.md"]);
    assert.throws(() => runRepositoryValidation({ repository, policy }), pattern);
  });
}

test("git-content/v1 rejects recognized manifests and symlinked working-tree files", async t => {
  await t.test("manifest", t => {
    const repository = fixture(t, {
      "README.md": "# Base\n",
      "package.json": JSON.stringify({ scripts: { check: "true" } }),
    });
    write(repository, "draft.md", "# Draft\n");
    const sha = head(repository);
    const policy = precommitPolicy(repository, sha, ["draft.md"]);
    assert.throws(() => runRepositoryValidation({ repository, policy }), /recognized repository manifest/u);
  });
  await t.test("symlink", t => {
    const repository = fixture(t, { "README.md": "# Base\n", "target.txt": "target\n" });
    symlinkSync("target.txt", path.join(repository, "linked.md"));
    const bytes = readFileSync(path.join(repository, "linked.md"));
    const sha = head(repository);
    const policy = buildRepositoryValidationPolicy({
      adapter: "git-content/v1",
      mode: "precommit",
      baseSha: sha,
      candidateSha: sha,
      candidateTreeSha: git(repository, ["rev-parse", "HEAD^{tree}"]).trim(),
      entries: [{
        path: "linked.md",
        source: "working-tree",
        mode: "100644",
        blobSha: git(repository, ["hash-object", "--no-filters", "--stdin"], bytes).trim(),
        contentDigest: digest(bytes),
        size: bytes.length,
      }],
      manifest: null,
    });
    assert.throws(() => runRepositoryValidation({ repository, policy }), /contains a symlink/u);
  });
});

test("ignored state is bounded, manifest-visible, and part of the invariant", async t => {
  await t.test("ignored manifest", t => {
    const repository = fixture(t, { ".gitignore": "package.json\n", "README.md": "# Base\n" });
    write(repository, "package.json", JSON.stringify({ scripts: { check: "true" } }));
    write(repository, "draft.md", "# Draft\n");
    const sha = head(repository);
    assert.throws(() => runRepositoryValidation({ repository,
      policy: precommitPolicy(repository, sha, ["draft.md"]) }), /recognized repository manifest/u);
  });
  await t.test("same-size ignored mutation", t => {
    const repository = fixture(t, {
      ".gitignore": "cache.bin\n",
      "package.json": JSON.stringify({ scripts: { check: "node --test" } }),
      "package-lock.json": JSON.stringify({ lockfileVersion: 3 }),
      "src/app.js": "one\n",
    });
    write(repository, "cache.bin", "AAAA");
    const baseSha = head(repository);
    write(repository, "src/app.js", "two\n");
    commit(repository, "candidate");
    const candidateSha = head(repository);
    const policy = postcommitPolicy(repository, {
      adapter: "npm-check/v1", baseSha, candidateSha, paths: ["src/app.js"],
    });
    const execute = (command, args, options) => {
      if (command === "npm") { write(repository, "cache.bin", "BBBB"); return Buffer.alloc(0); }
      return execFileSync(command, args, options);
    };
    assert.throws(() => runRepositoryValidation({ repository, policy }, { execute }),
      /subject drifted during validation/u);
  });
  await t.test("ignored file bound", t => {
    const repository = fixture(t, {
      ".gitignore": "cache.bin\n",
      "package.json": JSON.stringify({ scripts: { check: "node --test" } }),
      "package-lock.json": JSON.stringify({ lockfileVersion: 3 }),
      "src/app.js": "one\n",
    });
    write(repository, "cache.bin", Buffer.alloc(REPOSITORY_VALIDATION_BOUNDS.maxFileBytes + 1));
    const baseSha = head(repository);
    write(repository, "src/app.js", "two\n");
    commit(repository, "candidate");
    const candidateSha = head(repository);
    const policy = postcommitPolicy(repository, {
      adapter: "npm-check/v1", baseSha, candidateSha, paths: ["src/app.js"],
    });
    assert.throws(() => runRepositoryValidation({ repository, policy }), /exceeds its byte bound/u);
  });
});

test("precommit reads reject post-policy growth and path swaps", async t => {
  await t.test("bounded growth", t => {
    const repository = fixture(t, { "README.md": "# Base\n" });
    write(repository, "draft.md", "# Draft\n");
    const sha = head(repository);
    const policy = precommitPolicy(repository, sha, ["draft.md"]);
    write(repository, "draft.md", Buffer.alloc(REPOSITORY_VALIDATION_BOUNDS.maxFileBytes + 1, 0x61));
    assert.throws(() => runRepositoryValidation({ repository, policy }), /exceeds its byte bound/u);
  });
  await t.test("path swap", t => {
    const repository = fixture(t, { "README.md": "# Base\n", "target.txt": "target\n" });
    write(repository, "draft.md", "# Draft\n");
    const sha = head(repository);
    const policy = precommitPolicy(repository, sha, ["draft.md"]);
    let swapped = false;
    const execute = (command, args, options) => {
      if (command === "git" && args[0] === "ls-tree" && args.includes("-r") && !swapped) {
        rmSync(path.join(repository, "draft.md"));
        symlinkSync("target.txt", path.join(repository, "draft.md"));
        swapped = true;
      }
      return execFileSync(command, args, options);
    };
    assert.throws(() => runRepositoryValidation({ repository, policy }, { execute }), /contains a symlink/u);
    assert.equal(swapped, true);
  });
});

test("runner rejects incomplete path closure and repository drift", async t => {
  await t.test("path closure", t => {
    const repository = fixture(t, { "README.md": "# Base\n" });
    const baseSha = head(repository);
    write(repository, "one.md", "one\n");
    write(repository, "two.md", "two\n");
    commit(repository, "two paths");
    const candidateSha = head(repository);
    const policy = postcommitPolicy(repository, {
      adapter: "git-content/v1", baseSha, candidateSha, paths: ["one.md"],
    });
    assert.throws(() => runRepositoryValidation({ repository, policy }), /exact changed path set/u);
  });
  await t.test("command drift", t => {
    const repository = fixture(t, {
      "package.json": JSON.stringify({ scripts: { check: "node --test" } }),
      "package-lock.json": JSON.stringify({ lockfileVersion: 3 }),
      "src/app.js": "one\n",
    });
    const baseSha = head(repository);
    write(repository, "src/app.js", "two\n");
    commit(repository, "candidate");
    const candidateSha = head(repository);
    const policy = postcommitPolicy(repository, {
      adapter: "npm-check/v1", baseSha, candidateSha, paths: ["src/app.js"],
    });
    const execute = (command, args, options) => {
      if (command === "npm") {
        write(repository, "generated.txt", "drift\n");
        return Buffer.alloc(0);
      }
      return execFileSync(command, args, options);
    };
    assert.throws(() => runRepositoryValidation({ repository, policy }, { execute }),
      /clean repository|drifted during validation/u);
  });
});

test("npm-check/v1 rejects a non-exact manifest set", t => {
  const repository = fixture(t, {
    "package.json": JSON.stringify({ scripts: { check: "node --test" } }),
    "src/app.js": "one\n",
  });
  const baseSha = head(repository);
  write(repository, "src/app.js", "two\n");
  commit(repository, "candidate");
  const candidateSha = head(repository);
  const packageJson = gitEntry(repository, candidateSha, "package.json");
  const policy = buildRepositoryValidationPolicy({
    adapter: "npm-check/v1",
    mode: "postcommit",
    baseSha,
    candidateSha,
    candidateTreeSha: git(repository, ["rev-parse", `${candidateSha}^{tree}`]).trim(),
    entries: [gitEntry(repository, candidateSha, "src/app.js")],
    manifest: {
      packageJson,
      packageLock: { ...packageJson, path: "package-lock.json" },
    },
  });
  assert.throws(() => runRepositoryValidation({ repository, policy }, {
    execute: (command, args, options) => command === "npm" ? Buffer.alloc(0) : execFileSync(command, args, options),
  }), /requires exactly root package.json and package-lock.json/u);
});

function fixture(t, files) {
  const repository = realpathSync(mkdtempSync(path.join(os.tmpdir(), "repository-validation-")));
  t.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, ["init", "--quiet"]);
  git(repository, ["config", "user.name", "Validation Test"]);
  git(repository, ["config", "user.email", "validation@example.test"]);
  for (const [name, value] of Object.entries(files)) write(repository, name, value);
  commit(repository, "base");
  return repository;
}

function write(repository, name, value) {
  const target = path.join(repository, name);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, value);
}

function commit(repository, message) {
  git(repository, ["add", "--all"]);
  git(repository, ["commit", "--quiet", "-m", message]);
}

function head(repository) { return git(repository, ["rev-parse", "HEAD"]).trim(); }

function git(repository, args, input) {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    input,
    maxBuffer: 16_777_216,
  });
}

function postcommitPolicy(repository, { adapter, baseSha, candidateSha, paths }) {
  const manifest = adapter === "npm-check/v1" ? {
    packageJson: gitEntry(repository, candidateSha, "package.json"),
    packageLock: gitEntry(repository, candidateSha, "package-lock.json"),
  } : null;
  return buildRepositoryValidationPolicy({
    adapter,
    mode: "postcommit",
    baseSha,
    candidateSha,
    candidateTreeSha: git(repository, ["rev-parse", `${candidateSha}^{tree}`]).trim(),
    entries: paths.map(name => gitEntry(repository, candidateSha, name)),
    manifest,
  });
}

function precommitPolicy(repository, sha, paths) {
  return buildRepositoryValidationPolicy({
    adapter: "git-content/v1",
    mode: "precommit",
    baseSha: sha,
    candidateSha: sha,
    candidateTreeSha: git(repository, ["rev-parse", "HEAD^{tree}"]).trim(),
    entries: paths.map(name => workingEntry(repository, name)),
    manifest: null,
  });
}

function gitEntry(repository, sha, name) {
  const line = git(repository, ["ls-tree", sha, "--", name]).trim();
  const match = line.match(/^([0-9]{6}) blob ([0-9a-f]+)\t/u);
  assert.ok(match, `missing Git blob ${name}`);
  const bytes = execFileSync("git", ["cat-file", "blob", match[2]], { cwd: repository, encoding: null });
  return {
    path: name,
    source: "git-blob",
    mode: match[1],
    blobSha: match[2],
    contentDigest: digest(bytes),
    size: bytes.length,
  };
}

function workingEntry(repository, name) {
  const target = path.join(repository, name);
  const stat = lstatSync(target);
  assert.equal(stat.isFile(), true);
  const bytes = readFileSync(target);
  return {
    path: name,
    source: "working-tree",
    mode: (stat.mode & 0o111) === 0 ? "100644" : "100755",
    blobSha: git(repository, ["hash-object", "--no-filters", "--stdin"], bytes).trim(),
    contentDigest: digest(bytes),
    size: bytes.length,
  };
}

function digest(value) { return createHash("sha256").update(value).digest("hex"); }
