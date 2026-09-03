import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PIN = "https://codeload.github.com/huijoohwee/agentic-os/tar.gz/89256623e4a09a4b8e337c9d3572593c0d188700";
const INTEGRITY = "sha512-Vsa3kF+rr9/aY5h4XpvM9TsaXyJRuvCz2kX1LAgcpVI48ZTrZFPKoiAAmlrg0uGxHDf75C3i/PNJ/sti9rBY/g==";
const UPSTREAM = path.join(ROOT, "node_modules", "agentic-os");
const read = relativePath => readFileSync(path.join(ROOT, relativePath), "utf8");

function markdownUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownUnder(absolutePath);
    return entry.isFile() && entry.name.endsWith(".md") ? [absolutePath] : [];
  });
}

test("ACOS pins one reviewed ADLC package and delegates lifecycle commands directly", () => {
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(pkg.devDependencies["agentic-os"], PIN);
  assert.equal(lock.packages[""].devDependencies["agentic-os"], PIN);
  assert.equal(lock.packages["node_modules/agentic-os"].resolved, PIN);
  assert.equal(lock.packages["node_modules/agentic-os"].integrity, INTEGRITY);
  assert.deepEqual(Object.fromEntries([
    "setup", "doctor", "lane", "land", "status", "reap", "queue:show",
    "autonomy-class", "git:configure", "sync:canonical",
  ].map(name => [name, pkg.scripts[name]])), {
    setup: "agentic-os setup",
    doctor: "agentic-os doctor",
    lane: "agentic-os start",
    land: "agentic-os land",
    status: "agentic-os status",
    reap: "agentic-os reap",
    "queue:show": "agentic-os queue show",
    "autonomy-class": "agentic-os autonomy-class",
    "git:configure": "agentic-os git-configure",
    "sync:canonical": "agentic-os canonical-sync",
  });
});

test("global ADLC guidance and runtime prompt remain the installed SSOT", () => {
  const instructions = read("AGENTS.md");
  const guideline = readFileSync(path.join(UPSTREAM, "docs", "adlc-guidelines.md"), "utf8");
  const guide = readFileSync(path.join(UPSTREAM, "guides", "AUTONOMOUS-GOAL-PURSUIT.md"), "utf8");
  const promptBytes = readFileSync(path.join(UPSTREAM, "templates", "SYSTEM-PROMPT-RUNTIME.md"));
  assert.equal(promptBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false);
  assert.equal(promptBytes.includes(0x0d), false);
  assert.equal(promptBytes.at(-1), 0x0a);
  const prompt = new TextDecoder("utf-8", { fatal: true }).decode(promptBytes);
  assert.match(guideline, /^schema: agentic-os\/adlc-guidelines\/v1$/mu);
  assert.match(guideline, /^version: 1\.1\.0$/mu);
  assert.match(guideline, /^supersedes: agentic-sdlc$/mu);
  assert.match(guideline, /^runtime_contract: enforced$/mu);
  assert.match(guideline, /^runtime_evaluator: npm run evals$/mu);
  assert.match(guideline, /^execution_policy: lean-time-bound-budget-driven-sprints$/mu);
  assert.match(guideline, /^load_policy: lazy-beyond-always-load$/mu);
  assert.match(guideline, /^integration_policy: minimal-diff-protected-merge$/mu);
  assert.match(guideline, /^runtime_policy: fail-closed$/mu);
  assert.match(guideline, /^lifecycle_status: active$/mu);
  assert.equal(Buffer.byteLength(prompt, "utf8"), 1_000);
  assert.ok(Buffer.byteLength(prompt, "utf8") <= 1_000);
  assert.equal([...prompt].length, 988);
  assert.ok(prompt.split("\n").every((line) => [...line].length <= 120));
  assert.equal(createHash("sha256").update(promptBytes).digest("hex"),
    "c72415b3f0c1886bc2e98cc8779e9561501f589cca726c1441c7b8dafc531ee0");
  assert.match(prompt, /Lean time-bound sprints: state ETA\+time\/byte\/module caps;/u);
  assert.match(prompt, /External wait: blocker\+recheck, not ETA\./u);
  assert.match(guide, /on-demand ADLC guide, not an always-load instruction/u);
  assert.match(guide, /smallest valuable vertical slice/u);
  assert.match(guide, /minimal scoped hunks/u);
  assert.match(guide, /After the same approach fails twice/u);
  assert.match(guide, /shared-state repair gets one attempt/u);
  for (const owner of [
    "node_modules/agentic-os/templates/SYSTEM-PROMPT-RUNTIME.md",
    "node_modules/agentic-os/docs/adlc-guidelines.md",
    "node_modules/agentic-os/docs/START-WORKFLOW.md",
    "node_modules/agentic-os/docs/RELEASE-WORKFLOW.md",
  ]) assert.match(instructions, new RegExp(owner.replaceAll(".", "\\.")));
  assert.match(instructions, /Continuously comply/u);
  assert.match(instructions, /Do not\s+copy or redefine/u);
  for (const owner of ["docs/START-WORKFLOW.md", "docs/RELEASE-WORKFLOW.md",
    "docs/SYSTEM-PROMPT-RUNTIME.md", "docs/AUTONOMOUS-GOAL-PURSUIT.md",
    "docs/CANONICAL-LIFECYCLE.md"]) {
    assert.equal(existsSync(path.join(ROOT, owner)), false, owner);
  }
});

test("ACOS has no competing lane, worktree, session, guard, or synchronization controller", () => {
  for (const relativePath of [
    "scripts/worktree-lifecycle.mjs",
    "scripts/scoped-lane-admission-state.mjs",
    "scripts/session-start-policy.mjs",
    "scripts/live-sync.mjs",
    "scripts/workspace-sync.mjs",
    "scripts/workspace-sync-lib.mjs",
    "scripts/workspace-guard-hook.mjs",
    "scripts/workspace-parallelism-guard.mjs",
    "scripts/workspace-parallelism-lib.mjs",
    "scripts/install-workspace-guards.mjs",
    "scripts/history-lifecycle.mjs",
    "scripts/split-window-preparation.mjs",
    "scripts/split-window-preparation-contract.mjs",
    "scripts/split-window-preparation-controller.mjs",
    "scripts/split-window-preparation-repository-adapter.mjs",
    "scripts/split-window-preparation-sandbox.mjs",
    "scripts/split-window-preparation-store.mjs",
    "scripts/task-worktree-owned-containers.mjs",
    "scripts/lifecycle-monitor.mjs",
    "scripts/lifecycle-monitor-contract.mjs",
    "scripts/lifecycle-monitor-controller.mjs",
    "scripts/lifecycle-monitor-json-adapter.mjs",
    "scripts/cloud-collaboration-primitives.mjs",
    "scripts/teardown-archive.mjs",
    "scripts/teardown-concurrency-trial.mjs",
    "scripts/teardown-inventory.mjs",
    "scripts/teardown-measure.mjs",
    "scripts/teardown-route-baseline.mjs",
    "scripts/collaborative-release-lifecycle-contract.mjs",
    "scripts/collaborative-release-terminal-receipts.mjs",
    "scripts/collaborative-release-schema.mjs",
    "docs/SPLIT-WINDOW-PREPARATION.md",
    "docs/MANAGED-IMPLEMENTATION-RUNS.md",
    "docs/LIFECYCLE-MONITORING.md",
    "docs/schemas/collaborative-release-lifecycle.v1.schema.json",
    "docs/schemas/collaborative-release-lifecycle.v2.schema.json",
    "docs/schemas/scoped-lane-admission-report.v1.schema.json",
    ".githooks/git-guarded",
    ".githooks/pre-commit",
    ".githooks/pre-push",
    ".githooks/reference-transaction",
  ]) assert.equal(existsSync(path.join(ROOT, relativePath)), false, relativePath);

  for (const spec of [
    "active-dirty-scope-expansion-canonical-drift",
    "orphaned-task-authority-recovery",
    "repeated-dormant-bind-recovery",
    "repeated-expired-committed-heartbeat-recovery",
    "repeated-heartbeat-bind-recovery",
    "repeated-successor-fence-recovery",
    "reviewed-historical-base-cloud-verification",
    "reviewed-predecessor-base-continuation",
    "reviewed-source-correction-prepared-supersession",
    "source-correction-binding-clean-head",
    "task-authority-loss-incident-recovery",
    "repository-teardown",
  ]) {
    for (const file of [".config.kiro", "design.md", "requirements.md", "tasks.md"]) {
      const relativePath = path.join(".kiro", "specs", spec, file);
      assert.equal(existsSync(path.join(ROOT, relativePath)), false, relativePath);
    }
  }
});

test("ACOS docs expose only the non-promoting observation compatibility route", () => {
  const sources = [
    path.join(ROOT, "COLLABORATION.md"),
    path.join(ROOT, "README.md"),
    path.join(ROOT, "llms.txt"),
    path.join(ROOT, ".gitignore"),
    path.join(ROOT, ".vscode", "agentic.code-snippets"),
    path.join(ROOT, "scripts", "native-skill-harness", "prerequisite-gate.json"),
    path.join(ROOT, "scripts", "native-skill-harness-module-budget.mjs"),
    ...markdownUnder(path.join(ROOT, "docs")),
    ...markdownUnder(path.join(ROOT, ".kiro", "specs")),
  ]
    .map(absolutePath => readFileSync(absolutePath, "utf8"))
    .join("\n");
  for (const removed of [
    "/session.start",
    "/implementation.run",
    "/workspace.parallelism.check",
    "/workspace.guards.install",
    "/workspace.operation.review",
    "agentic-graph.implementation_run.",
    "#managed-implementation-run",
    "#destructive-operation-guard",
    "@workspace-lane",
    "@recovery-reference",
    "MANAGED-IMPLEMENTATION-RUNS.md",
    "SPLIT-WINDOW-PREPARATION.md",
    "LIFECYCLE-MONITORING.md",
    "repository-teardown",
    "teardown budget",
    "repository-reduction planning decision",
    "historical reduction target",
    "waive-prerequisite-gate-and-sequencing",
    "teardown-route-baseline",
    "collaborative-release-lifecycle",
    "joined terminal receipt chain",
    "Adaptive lifecycle monitoring",
    "orphaned-task-authority-recovery",
  ]) assert.equal(sources.includes(removed), false, removed);

  const observation = read("docs/IMPLEMENTATION-RUN-OBSERVATION.md");
  assert.match(observation, /^status: "spec-complete"$/mu);
  assert.match(observation, /\/sdlc\.observe #agentic-sdlc-observability/u);
  assert.match(observation, /grants no Agentic SDLC\s+lifecycle authority/u);
});
