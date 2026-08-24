import assert from "node:assert/strict";
import test from "node:test";
import { assertTotality, buildInventory, classifyEntry, extractImports, inspectSiblingRepository, resolveReference, resolveSiblingRepositoryPath, tokenizeCommand } from "../scripts/teardown-inventory.mjs";

test("tokenizes chained scripts and preserves glob tokens", () => {
  assert.deepEqual(tokenizeCommand("node ./scripts/x.mjs arg && node --test '__tests__/*.test.mjs'"), ["node", "./scripts/x.mjs", "arg", "&&", "node", "--test", "__tests__/*.test.mjs"]);
});

test("extracts static, exported, literal dynamic, and unresolved dynamic imports", () => {
  const imports = extractImports('import x from "./x.js";\nexport { y } from "./y.js";\nimport("./z.js");\nimport(target);');
  assert.deepEqual(imports.map(item => [item.specifier, item.dynamic]), [["./x.js", false], ["./y.js", false], ["./z.js", false], ["target", true]]);
});

test("resolves only exact tracked relative imports", () => {
  assert.deepEqual(resolveReference("./x", "scripts/a.mjs", ["scripts/x.mjs"]), ["scripts/x.mjs"]);
  assert.deepEqual(resolveReference("fast-check", "scripts/a.mjs", ["scripts/x.mjs"]), []);
});

test("classification is fail-closed and totality rejects drift", () => {
  const entry = { evidence: { packageScripts: [], staticImports: [], workflowSteps: [], githooks: [], markdownReferences: [] }, unresolvedReferences: ["dynamic"], provenPath: { isProvenPath: false } };
  assert.equal(classifyEntry(entry).classification, "retained");
  assert.throws(() => assertTotality({ entries: [{ path: "x" }], countsByDirectory: { "scripts/": { redundant: 0, constrained: 0, dead: 0, retained: 0, trackedFileCount: 1 } } }), /totality/u);
});

test("Proven Path records a specific preserved handler and its static import chain", () => {
  const files = {
    "worker/index.js": 'import { subject } from "../agent-api/src/subject.js";\nif (url.pathname === "/api/auth/session") subject();',
    "agent-api/src/subject.js": 'import "./dependency.js";\nexport const subject = () => true;',
    "agent-api/src/dependency.js": "export const dependency = true;",
    "package.json": '{"scripts":{}}',
  };
  const gitText = args => {
    if (args[0] === "rev-parse") return "a".repeat(40);
    if (args[0] === "ls-tree") return Object.keys(files).join("\n");
    if (args[0] === "show") return files[args[1].split(":").slice(1).join(":")] || "";
    if (args[0] === "worktree") return "";
    if (args[0] === "for-each-ref") return "";
    throw new Error(`Unexpected git call: ${args.join(" ")}`);
  };
  const inventory = buildInventory({ commit: "HEAD", gitText,
    now: () => new Date("2026-08-16T00:00:00.000Z") });
  const subject = inventory.entries.find(entry => entry.path === "agent-api/src/subject.js");
  const dependency = inventory.entries.find(entry => entry.path === "agent-api/src/dependency.js");
  assert.equal(subject.provenPath.routeHandlerPath, "POST /api/auth/session");
  assert.deepEqual(subject.provenPath.importChain, ["worker/index.js", "agent-api/src/subject.js"]);
  assert.deepEqual(dependency.provenPath.importChain, [
    "worker/index.js", "agent-api/src/subject.js", "agent-api/src/dependency.js",
  ]);
});

test("inventory resolves tracked references inside multiline workflow run steps", () => {
  const files = {
    ".github/workflows/check.yml": "jobs:\n  check:\n    steps:\n      - name: Check\n        run: |\n          node scripts/subject.mjs\n          node --test __tests__/subject.test.mjs\n",
    "scripts/subject.mjs": "export const subject = true;",
    "__tests__/subject.test.mjs": "export const subjectTest = true;",
    "worker/index.js": "export default {};",
    "package.json": '{"scripts":{}}',
  };
  const gitText = args => {
    if (args[0] === "rev-parse") return "a".repeat(40);
    if (args[0] === "ls-tree") return Object.keys(files).join("\n");
    if (args[0] === "show") return files[args[1].split(":").slice(1).join(":")] || "";
    if (args[0] === "worktree" || args[0] === "for-each-ref") return "";
    throw new Error(`Unexpected git call: ${args.join(" ")}`);
  };
  const inventory = buildInventory({ commit: "HEAD", gitText,
    now: () => new Date("2026-08-16T00:00:00.000Z") });
  for (const target of ["scripts/subject.mjs", "__tests__/subject.test.mjs"]) {
    assert.deepEqual(inventory.entries.find(entry => entry.path === target)
      .evidence.workflowSteps, [".github/workflows/check.yml:check:1"]);
  }
});

test("shell case wildcards do not manufacture workflow evidence", () => {
  const files = {
    ".github/workflows/check.yml": "jobs:\n  check:\n    steps:\n      - run: |\n          case value in\n            *) exit 1 ;;\n          esac\n",
    "scripts/subject.mjs": "export const subject = true;",
    "worker/index.js": "export default {};",
    "package.json": '{"scripts":{}}',
  };
  const gitText = args => {
    if (args[0] === "rev-parse") return "a".repeat(40);
    if (args[0] === "ls-tree") return Object.keys(files).join("\n");
    if (args[0] === "show") return files[args[1].split(":").slice(1).join(":")] || "";
    if (args[0] === "worktree" || args[0] === "for-each-ref") return "";
    throw new Error(`Unexpected git call: ${args.join(" ")}`);
  };
  const inventory = buildInventory({ commit: "HEAD", gitText,
    now: () => new Date("2026-08-16T00:00:00.000Z") });
  assert.deepEqual(inventory.entries.find(entry => entry.path === "scripts/subject.mjs")
    .evidence.workflowSteps, []);
});

test("an absent sibling repository is explicit and undetermined", () => {
  assert.deepEqual(inspectSiblingRepository({
    checkedPath: "/missing/knowgrph", pathExists: () => false,
  }), {
    checkedPath: "/missing/knowgrph", repositoryPresent: false,
    readsExternalStateDirectory: null, determination: "undetermined",
    readingFileCount: 0, readingFiles: [],
  });
});

test("sibling resolution escapes nested worktree containers to the canonical workspace", () => {
  const pathExists = candidate => candidate === "/workspace/knowgrph/.git";
  assert.equal(resolveSiblingRepositoryPath({
    commonDirectory: "/workspace/.worktrees/controller/.git",
    pathExists,
  }), "/workspace/knowgrph");
  assert.equal(resolveSiblingRepositoryPath({
    commonDirectory: "/workspace/agentic-canvas-os/.git",
    pathExists,
  }), "/workspace/knowgrph");
});
