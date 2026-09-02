import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  bindingTopologyDigestFromConfig,
  readRemoteBindingEvidence,
} from "../scripts/acos-production-release-live.mjs";

const workflow = await readFile(".github/workflows/production-release.yml", "utf8");
const live = await readFile("scripts/acos-production-release-live.mjs", "utf8");
const config = await readFile("wrangler.jsonc", "utf8");

test("the protected workflow separates candidate sealing from the environment-gated mutation job", () => {
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /candidate_digest:/u);
  assert.match(workflow, /seal-candidate:[\s\S]*production-release:/u);
  assert.match(workflow, /production-release:[\s\S]*environment:\s*\n\s+name: production/u);
  assert.equal(workflow.match(/secrets\.CLOUDFLARE_API_TOKEN/g)?.length, 1);
  assert.equal(workflow.match(/secrets\.ACOS_RELEASE_PROBE_TOKEN/g)?.length, 1);
  const sealSection = workflow.slice(workflow.indexOf("  seal-candidate:"), workflow.indexOf("  production-release:"));
  assert.doesNotMatch(sealSection, /CLOUDFLARE|RELEASE_PROBE_TOKEN/u);
  assert.match(workflow, /concurrency:[\s\S]*cancel-in-progress: false/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.equal(workflow.match(/timeout-minutes:/g)?.length, 2);
  assert.match(workflow, /Persist mandatory deployed receipt[\s\S]*if: success\(\)[\s\S]*if-no-files-found: error/u);
  assert.match(workflow, /Persist best-effort failed release evidence[\s\S]*if: failure\(\)[\s\S]*if-no-files-found: warn/u);
});

test("release source uploads an inactive strict keep-vars version and injects every exact identity pin", () => {
  assert.match(live, /"versions", "upload"/u);
  assert.match(live, /"--strict", "--keep-vars"/u);
  assert.match(live, /ACOS_SOURCE_REVISION:/u);
  assert.match(live, /ACOS_CANDIDATE_DIGEST:/u);
  assert.match(live, /ACOS_CONFIGURATION_DIGEST:/u);
  assert.match(live, /ACOS_STORAGE_COMPATIBILITY_REVISION:/u);
  assert.match(live, /ACOS_UNMANAGED_BINDINGS_DIGEST:/u);
  assert.match(live, /findVersionsByTag/u);
  assert.match(live, /deployIfBaseline/u);
  assert.match(live, /MAX_EVIDENCE_BYTES = 65_536/u);
  assert.match(live, /SUBPROCESS_TIMEOUT_MS = 300_000/u);
  assert.match(live, /timeout: SUBPROCESS_TIMEOUT_MS/u);
  assert.match(live, /killSignal: "SIGKILL"/u);
});

test("root and Dev configs expose version metadata but retain release-controller placeholders", () => {
  assert.equal(config.match(/"version_metadata": \{ "binding": "CF_VERSION_METADATA" \}/g)?.length, 2);
  for (const variable of [
    "ACOS_SOURCE_REVISION",
    "ACOS_CANDIDATE_DIGEST",
    "ACOS_CONFIGURATION_DIGEST",
    "ACOS_STORAGE_COMPATIBILITY_REVISION",
    "ACOS_UNMANAGED_BINDINGS_DIGEST",
  ]) {
    assert.equal(config.match(new RegExp(`"${variable}"`, "g"))?.length, 2, variable);
  }
  assert.equal(config.match(/__PROTECTED_RELEASE_/g)?.length, 10);
  assert.doesNotMatch(config, /enable_ctx_exports/u);
});

test("remote version evidence binds managed topology, private export, and preserved unmanaged bindings", () => {
  const candidate = {
    sourceRevision: "a".repeat(40),
    candidateDigest: "b".repeat(64),
    configurationDigest: "c".repeat(64),
    storageCompatibilityRevision: "d".repeat(64),
    unmanagedBindingsDigest: "e".repeat(64),
  };
  const expectedConfig = {
    compatibility_date: "2026-07-05",
    compatibility_flags: ["nodejs_compat"],
    assets: { binding: "ASSETS" },
    durable_objects: { bindings: [{ name: "AGENT_STATE", class_name: "AgentState" }] },
    ratelimits: [{ name: "AUTH", namespace_id: "41001", simple: { limit: 30, period: 60 } }],
    version_metadata: { binding: "CF_VERSION_METADATA" },
    vars: {
      ACOS_SOURCE_REVISION: "__PROTECTED_RELEASE_SOURCE_REVISION__",
      ACOS_CANDIDATE_DIGEST: "__PROTECTED_RELEASE_CANDIDATE_DIGEST__",
      ACOS_CONFIGURATION_DIGEST: "__PROTECTED_RELEASE_CONFIGURATION_DIGEST__",
      ACOS_STORAGE_COMPATIBILITY_REVISION: "__PROTECTED_RELEASE_STORAGE_COMPATIBILITY_REVISION__",
      ACOS_UNMANAGED_BINDINGS_DIGEST: "__PROTECTED_RELEASE_UNMANAGED_BINDINGS_DIGEST__",
      STATIC_VALUE: "exact",
    },
    secrets: { required: ["ACOS_ADMISSION_AUTH_SECRET", "ACOS_RELEASE_PROBE_TOKEN"] },
  };
  const raw = {
    resources: {
      script: {
        handlers: ["fetch"],
        named_handlers: [{ name: "CommerceAdmissionProbe", handlers: ["fetch"] }],
      },
      script_runtime: {
        compatibility_date: expectedConfig.compatibility_date,
        compatibility_flags: ["nodejs_compat"],
        exports: { CommerceAdmissionProbe: { type: "worker", state: "created" } },
      },
      bindings: [
        { name: "ACOS_SOURCE_REVISION", type: "plain_text", text: candidate.sourceRevision },
        { name: "ACOS_CANDIDATE_DIGEST", type: "plain_text", text: candidate.candidateDigest },
        { name: "ACOS_CONFIGURATION_DIGEST", type: "plain_text", text: candidate.configurationDigest },
        { name: "ACOS_STORAGE_COMPATIBILITY_REVISION", type: "plain_text", text: candidate.storageCompatibilityRevision },
        { name: "ACOS_UNMANAGED_BINDINGS_DIGEST", type: "plain_text", text: candidate.unmanagedBindingsDigest },
        { name: "STATIC_VALUE", type: "plain_text", text: "exact" },
        { name: "ACOS_RELEASE_PROBE_TOKEN", type: "secret_text" },
        { name: "ACOS_ADMISSION_AUTH_SECRET", type: "secret_text" },
        { name: "AGENT_STATE", type: "durable_object_namespace", class_name: "AgentState" },
        { name: "AUTH", type: "ratelimit", namespace_id: "41001", simple: { limit: 30, period: 60 } },
        { name: "CF_VERSION_METADATA", type: "version_metadata" },
        { name: "ASSETS", type: "assets" },
        { name: "BASELINE_ONLY", type: "plain_text", text: "preserved" },
      ],
    },
  };
  const exact = readRemoteBindingEvidence(raw, candidate, expectedConfig);
  assert.equal(exact.bindingTopologyDigest, bindingTopologyDigestFromConfig(expectedConfig));

  const drifted = structuredClone(raw);
  drifted.resources.bindings.find((binding) => binding.name === "STATIC_VALUE").text = "drifted";
  assert.notEqual(
    readRemoteBindingEvidence(drifted, candidate, expectedConfig).bindingTopologyDigest,
    exact.bindingTopologyDigest,
  );
  const missingHandler = structuredClone(raw);
  missingHandler.resources.script_runtime.exports = {};
  assert.notEqual(
    readRemoteBindingEvidence(missingHandler, candidate, expectedConfig).bindingTopologyDigest,
    exact.bindingTopologyDigest,
  );
  const unmanagedDrift = structuredClone(raw);
  unmanagedDrift.resources.bindings.at(-1).text = "changed";
  assert.notEqual(
    readRemoteBindingEvidence(unmanagedDrift, candidate, expectedConfig).unmanagedBindingsDigest,
    exact.unmanagedBindingsDigest,
  );
});
