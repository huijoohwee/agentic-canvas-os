import assert from "node:assert/strict";
import test from "node:test";
import { containsArchive, enumerateRefs, parseOptions, verifyArchive } from "../scripts/teardown-archive.mjs";

test("accepts the documented separated option form and the equivalent inline form", () => {
  assert.deepEqual(parseOptions(["--tag", "archive", "--bundle", "/tmp/archive.bundle"]), {
    tag: "archive", bundle: "/tmp/archive.bundle",
  });
  assert.deepEqual(parseOptions(["--tag=archive", "--bundle=/tmp/archive.bundle"]), {
    tag: "archive", bundle: "/tmp/archive.bundle",
  });
});

test("enumerates deterministic branch refs with exact tips", () => {
  const values = new Map([["branch -a --format=%(refname)", "refs/remotes/origin/z\nrefs/heads/a"], ["rev-parse refs/remotes/origin/z", "2".repeat(40)], ["rev-parse refs/heads/a", "1".repeat(40)]]);
  const refs = enumerateRefs(args => values.get(args.join(" ")));
  assert.deepEqual(refs.map(item => item.fullName), ["refs/heads/a", "refs/remotes/origin/z"]);
});

test("contains answers exact refs and reachable object ids", () => {
  const dependencies = { gitText: () => `${"a".repeat(40)} refs/heads/main`, isAncestor: sha => sha === "b".repeat(40) };
  assert.equal(containsArchive({ bundle: "/tmp/archive.bundle", ref: "refs/heads/main" }, dependencies).status, "ok");
  assert.equal(containsArchive({ bundle: "/tmp/archive.bundle", sha: "b".repeat(40) }, dependencies).status, "ok");
  assert.equal(containsArchive({ bundle: "/tmp/archive.bundle", sha: "c".repeat(40) }, dependencies).status, "missing");
});

test("verification stops on a corrupt bundle or vanished remote tag", () => {
  const corrupt = {
    git: args => { if (args[0] === "bundle") throw new Error("corrupt bundle"); },
    gitText: () => "", isAncestor: () => false,
  };
  assert.throws(() => verifyArchive({ tag: "archive", bundle: "/tmp/archive.bundle" }, corrupt), /corrupt bundle/u);
  const vanished = {
    git: () => {},
    gitText: args => args[0] === "rev-parse" ? "a".repeat(40) : "",
    isAncestor: () => false,
  };
  assert.throws(() => verifyArchive({ tag: "archive", bundle: "/tmp/archive.bundle" }, vanished), /absent or changed/u);
});
