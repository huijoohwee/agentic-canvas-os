import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  auditRepositoryRuntimeReadiness,
  REPOSITORY_RUNTIME_READINESS_SCHEMA,
} from "../scripts/repository-runtime-readiness.mjs";

const evaluatorSource = fs.readFileSync(
  new URL("../scripts/repository-runtime-readiness.mjs", import.meta.url),
  "utf8",
);
const contractSource = fs.readFileSync(
  new URL("../docs/REPOSITORY-RUNTIME-READINESS.md", import.meta.url),
  "utf8",
);

function run(cwd, command, args) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function write(root, relativePath, source) {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, source);
}

function createRepository({ coherent = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repository-readiness-"));
  run(root, "git", ["init", "-q"]);
  write(root, "package.json", JSON.stringify({
    packageManager: "npm@11.0.0",
    engines: { node: "24.x" },
    scripts: {
      build: "framework build",
      start: coherent ? "framework start" : "pnpm remote && framework start",
      e2e: "playwright test",
    },
  }, null, 2));
  write(root, "package-lock.json", "{}\n");
  write(root, ".env.example", "PUBLIC_ORIGIN=\nPRIVATE_TOKEN=\n");
  write(root, "app/api/health/route.ts",
    "export const GET = () => new Response('ok');\n");
  write(root, "e2e/playwright.config.ts",
    "export default { projects: [{ use: { viewport: { width: 390, height: 844 }, isMobile: true } }] };\n");
  write(root, "e2e/offline.spec.ts", "test('offline recovery', async () => {});\n");
  write(root, "performance-budget.json", "{\"routeBytes\":100000}\n");
  write(root, ".github/workflows/ci.yml", [
    "name: CI",
    "on:",
    "  pull_request:",
    "jobs:",
    "  check:",
    "    steps:",
    "      - run: npm ci",
    "      - run: npm run build",
    "      - run: npm run e2e",
    "      - run: node check-performance-budget.mjs",
    "",
  ].join("\n"));
  run(root, "git", ["add", "."]);
  run(root, "git", [
    "-c", "user.name=Runtime Readiness Test",
    "-c", "user.email=runtime-readiness@example.invalid",
    "commit", "-q", "-m", "fixture",
  ]);
  return root;
}

test("source admission passes for one immutable bounded repository contract", () => {
  const root = createRepository();
  const revision = run(root, "git", ["rev-parse", "HEAD"]);
  const result = auditRepositoryRuntimeReadiness({
    repositoryPath: root,
    expectedRevision: revision,
  });

  assert.equal(result.schema, REPOSITORY_RUNTIME_READINESS_SCHEMA);
  assert.equal(result.ready, true);
  assert.equal(result.layers.source.status, "ready");
  assert.equal(result.layers.local.status, "unverified");
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.cost, {
    modelCalls: 0,
    providerCalls: 0,
    paidCalls: 0,
    tokens: 0,
  });
  assert.deepEqual(result.boundaries, {
    mutation: false,
    network: false,
    integration: false,
    release: false,
    deployment: false,
  });
});

test("mixed package managers and mutable generation fail closed", () => {
  const root = createRepository({ coherent: false });
  const packagePath = path.join(root, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  packageJson.scripts.postinstall = "node scripts/update-remote-inputs.mjs";
  fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
  run(root, "git", ["add", "package.json"]);
  run(root, "git", [
    "-c", "user.name=Runtime Readiness Test",
    "-c", "user.email=runtime-readiness@example.invalid",
    "commit", "-q", "-m", "add drift",
  ]);
  const revision = run(root, "git", ["rev-parse", "HEAD"]);
  const result = auditRepositoryRuntimeReadiness({
    repositoryPath: root,
    expectedRevision: revision,
  });
  const reasons = result.findings.map((finding) => finding.reason);

  assert.equal(result.ready, false);
  assert.ok(reasons.includes("package-manager-drift"));
  assert.ok(reasons.includes("mutable-generation-input"));
  assert.equal(result.evidence.generatedInputClosure.ready, false);
});

test("revision drift and unsupported higher-layer claims remain blocked", () => {
  const root = createRepository();
  const result = auditRepositoryRuntimeReadiness({
    repositoryPath: root,
    expectedRevision: "0".repeat(40),
    layer: "browser",
  });

  assert.equal(result.ready, false);
  assert.equal(result.layers.source.status, "blocked");
  assert.equal(result.layers.browser.status, "unverified");
  assert.ok(result.findings.some(
    (finding) => finding.reason === "source-revision-mismatch",
  ));
});

test("evaluator remains independent from the external reference", () => {
  for (const forbidden of [
    "ava-labs",
    "Avalanche",
    "Builders Hub",
    "build.avax.network",
    "Next.js",
    "Vercel",
  ]) {
    assert.doesNotMatch(evaluatorSource, new RegExp(forbidden, "i"));
  }
  assert.doesNotMatch(evaluatorSource, /\bhttps?:\/\//);
});

test("contract binds the protected guideline revision", () => {
  assert.match(
    contractSource,
    /guideline_candidate_revision: "5b79529a5c791cdfceed70548543f82358fa100c"/,
  );
  assert.match(contractSource, /guideline_protected_status: "verified"/);
  assert.match(
    contractSource,
    /protected at\s+`5b79529a5c791cdfceed70548543f82358fa100c`/m,
  );
});
