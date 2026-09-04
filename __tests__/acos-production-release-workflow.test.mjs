import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalJson as canonicalAdmissionJson } from "../agent-api/src/commerce-admission-contract.js";
import {
  createProductionCandidate,
  digestValue,
} from "../scripts/acos-production-release-contract.mjs";
import {
  ACOS_RELEASE_LIVE_DEFAULTS,
  bindingTopologyDigestFromConfig,
  materializeProductionConfig,
  readRemoteBindingEvidence,
  versionIdsByTag,
  webArtifactDigestFromDirectory,
} from "../scripts/acos-production-release-live.mjs";

const workflow = await readFile(".github/workflows/production-release.yml", "utf8");
const live = await readFile("scripts/acos-production-release-live.mjs", "utf8");
const configText = await readFile("wrangler.jsonc", "utf8");
const config = JSON.parse(configText.replace(/^\s*\/\/.*$/gmu, ""));
const AUTHORITY_ISSUED_AT = Date.now() - 60_000;

function authorizedReleaseCandidate(sourceRevision, sourceTree) {
  const unsigned = {
    schema: "agentic-production-release-candidate/v1",
    status: "awaiting-human-authorization",
    source: {
      repository: "huijoohwee/agentic-graph",
      revision: "1".repeat(40),
      tree: "2".repeat(40),
    },
    agenticCanvasOs: {
      repository: "huijoohwee/agentic-canvas-os",
      revision: sourceRevision,
      tree: sourceTree,
    },
    catalogRevision: sourceRevision,
    artifact: { algorithm: "sha256", digest: "3".repeat(64) },
    immutableManifest: { algorithm: "sha256", digest: "4".repeat(64) },
    localReviewCandidateDigest: "5".repeat(64),
  };
  return { ...unsigned, candidateDigest: digestValue(unsigned) };
}

function graphEvidence() {
  return {
    admissionContract: "commerce.agentic-os-admission-provider/v3",
    admissionInputsDigest: "6".repeat(64),
    admissionRequestDigest: "7".repeat(64),
    authorityRef: "authority://agentic-graph/commerce-admission/production",
    candidateAuthorizationRef: `authorization://agentic-graph/commerce-admission/${"8".repeat(64)}`,
    expiresAtMs: AUTHORITY_ISSUED_AT + 6 * 24 * 60 * 60 * 1_000,
    issuedAtMs: AUTHORITY_ISSUED_AT,
    issuerRepository: "huijoohwee/agentic-graph",
    issuerRevision: "9".repeat(40),
    operatorInstructionRef: "operator://agentic-graph/commerce-adapter-admission/production",
    permitDigest: "a".repeat(64),
    schema: "agentic-graph-commerce-admission-authority/v1",
    signature: "b".repeat(64),
    targetRepository: "huijoohwee/agentic-canvas-os",
  };
}

function candidate() {
  const sourceRevision = "c".repeat(40);
  const sourceTree = "d".repeat(40);
  const evidence = graphEvidence();
  return createProductionCandidate({
    sourceRevision,
    sourceTree,
    configurationDigest: "e".repeat(64),
    bindingTopologyDigest: bindingTopologyDigestFromConfig(config),
    storageCompatibilityRevision: "f".repeat(64),
    webArtifactDigest: "0".repeat(64),
    requiredSecrets: config.secrets.required,
    releaseCandidate: authorizedReleaseCandidate(sourceRevision, sourceTree),
    graphAuthority: {
      authorityRef: evidence.authorityRef,
      operatorInstructionRef: evidence.operatorInstructionRef,
      issuerRevision: evidence.issuerRevision,
      evidenceDigest: createHash("sha256").update(canonicalAdmissionJson(evidence)).digest("hex"),
    },
    publicReadyOrigin: "https://airvio.co",
  });
}

function jobBlock(name, next = null) {
  const start = workflow.indexOf(`  ${name}:`);
  const end = next ? workflow.indexOf(`  ${next}:`, start + 1) : workflow.length;
  assert.notEqual(start, -1, `missing ${name}`);
  return workflow.slice(start, end);
}

test("workflow has one read-only seal job and one protected production mutation job", () => {
  const seal = jobBlock("seal-candidate", "production-release");
  const release = jobBlock("production-release");
  for (const input of [
    "candidate_sha",
    "candidate_digest",
    "authorized_release_candidate_json",
    "graph_authority_ref",
    "graph_operator_instruction_ref",
    "graph_authority_issuer_revision",
    "graph_authority_evidence_digest",
    "public_ready_origin",
    "preserve_receipt_json",
  ]) assert.match(workflow, new RegExp(`^      ${input}:`, "mu"));
  assert.match(workflow, /^permissions:\n  actions: read\n  contents: read\n  deployments: read$/mu);
  assert.doesNotMatch(workflow, /\bwrite\b/u);
  assert.match(release, /environment:\s*\n\s+name: production/u);
  assert.doesNotMatch(seal, /secrets\.|CLOUDFLARE|GITHUB_TOKEN|ADMISSION_AUTHORITY_EVIDENCE/u);
  assert.equal(release.match(/secrets\.CLOUDFLARE_API_TOKEN/g)?.length, 1);
  assert.equal(release.match(/secrets\.ACOS_RELEASE_PROBE_TOKEN/g)?.length, 1);
  assert.equal(release.match(/secrets\.AGENTIC_OS_ADMISSION_AUTHORITY_EVIDENCE/g)?.length, 1);
  assert.equal(release.match(/inputs\.preserve_receipt_json/g)?.length, 1);
  assert.match(workflow, /concurrency:[\s\S]*cancel-in-progress: false/u);
  assert.equal(workflow.match(/persist-credentials: false/g)?.length, 2);
  for (const action of workflow.matchAll(/uses: [^@\s]+@([^\s]+)/gu)) {
    assert.match(action[1], /^[0-9a-f]{40}$/u);
  }
});

test("both jobs build and seal the same candidate before the sole credentialed mutation", () => {
  assert.equal(workflow.match(/npm run web:build/g)?.length, 2);
  assert.equal(workflow.match(/acos-production-release-controller\.mjs prepare/g)?.length, 2);
  assert.equal(workflow.match(/acos-production-release-controller\.mjs release/g)?.length, 1);
  assert.doesNotMatch(workflow, /scripts\/acos-production-release\.mjs/u);
  assert.match(workflow, /cmp "\$RUNNER_TEMP\/acos-production-candidate\/acos-production-candidate\.json"/u);
  assert.match(workflow, /if: success\(\)[\s\S]*if-no-files-found: error/u);
  assert.match(workflow, /if: failure\(\)[\s\S]*if-no-files-found: warn/u);
});

test("ephemeral config replaces exactly five production placeholders without mutating checked config", () => {
  const before = JSON.stringify(config);
  const value = candidate();
  const evidence = graphEvidence();
  const rawEvidence = JSON.stringify(evidence);
  const materialized = materializeProductionConfig(config, {
    repositoryRoot: "/tmp/acos-release-repository",
    candidate: value,
    graphAuthorityEvidence: rawEvidence,
  });
  assert.equal(JSON.stringify(config), before);
  assert.equal(Object.hasOwn(materialized, "$schema"), false);
  assert.equal(Object.hasOwn(materialized, "env"), false);
  assert.equal(materialized.main, "/tmp/acos-release-repository/worker/index.js");
  assert.equal(materialized.assets.directory, "/tmp/acos-release-repository/web/dist");
  assert.equal(materialized.vars.ACOS_SOURCE_REVISION, value.sourceRevision);
  assert.equal(materialized.vars.ACOS_CANDIDATE_DIGEST, value.candidateDigest);
  assert.equal(materialized.vars.AGENTIC_OS_ADMISSION_AUTHORITY_REF, value.graphAuthority.authorityRef);
  assert.equal(
    materialized.vars.AGENTIC_OS_ADMISSION_OPERATOR_INSTRUCTION_REF,
    value.graphAuthority.operatorInstructionRef,
  );
  assert.equal(materialized.vars.AGENTIC_OS_ADMISSION_AUTHORITY_EVIDENCE, rawEvidence);
  assert.equal(configText.includes(rawEvidence), false);
  assert.doesNotMatch(live, /"--var"/u);
  assert.match(live, /flag: "wx",\s*mode: 0o600/u);
  assert.match(live, /rm\(temporary, \{ recursive: true, force: true \}\)/u);
});

test("remote readback binds ctx export, five dynamic values, secrets, and unmanaged preservation", () => {
  const value = candidate();
  const evidence = graphEvidence();
  const dynamic = {
    ACOS_SOURCE_REVISION: value.sourceRevision,
    ACOS_CANDIDATE_DIGEST: value.candidateDigest,
    AGENTIC_OS_ADMISSION_AUTHORITY_REF: value.graphAuthority.authorityRef,
    AGENTIC_OS_ADMISSION_OPERATOR_INSTRUCTION_REF: value.graphAuthority.operatorInstructionRef,
    AGENTIC_OS_ADMISSION_AUTHORITY_EVIDENCE: JSON.stringify(evidence),
  };
  const bindings = [
    ...Object.entries(config.vars).map(([name, text]) => ({
      name,
      type: "plain_text",
      text: dynamic[name] ?? text,
    })),
    ...config.secrets.required.map((name) => ({ name, type: "secret_text" })),
    ...config.durable_objects.bindings.map((item) => ({
      name: item.name,
      type: "durable_object_namespace",
      class_name: item.class_name,
    })),
    ...config.ratelimits.map((item) => ({ name: item.name, type: "ratelimit", ...item })),
    { name: config.version_metadata.binding, type: "version_metadata" },
    { name: config.assets.binding, type: "assets" },
    { name: "BASELINE_ONLY", type: "plain_text", text: "preserved" },
  ];
  const raw = {
    resources: {
      script: {
        handlers: ["fetch"],
        named_handlers: [{ name: "CommerceAdmissionProbe", handlers: ["fetch"] }],
      },
      script_runtime: {
        compatibility_date: config.compatibility_date,
        compatibility_flags: config.compatibility_flags,
        exports: { CommerceAdmissionProbe: { type: "worker", state: "created" } },
      },
      bindings,
    },
  };
  const exact = readRemoteBindingEvidence(raw, config);
  assert.equal(exact.bindingTopologyDigest, bindingTopologyDigestFromConfig(config));
  const exportDrift = structuredClone(raw);
  exportDrift.resources.script_runtime.exports = {};
  assert.notEqual(
    readRemoteBindingEvidence(exportDrift, config).bindingTopologyDigest,
    exact.bindingTopologyDigest,
  );
  const unmanagedDrift = structuredClone(raw);
  unmanagedDrift.resources.bindings.at(-1).text = "changed";
  assert.notEqual(
    readRemoteBindingEvidence(unmanagedDrift, config).unmanagedBindingsDigest,
    exact.unmanagedBindingsDigest,
  );
});

test("post-cutoff compatibility date enables ctx.exports and proof token stays secret in root and dev", () => {
  assert.ok(config.compatibility_date >= "2025-11-17");
  assert.deepEqual(config.compatibility_flags, ["nodejs_compat"]);
  assert.equal(config.compatibility_flags.includes("enable_ctx_exports"), false);
  for (const lane of [config, config.env.dev]) {
    assert.ok(lane.assets.run_worker_first.includes("/release-proof/*"));
    assert.ok(lane.secrets.required.includes("ACOS_RELEASE_PROBE_TOKEN"));
    assert.equal(lane.vars.ACOS_SOURCE_REVISION, "__PROTECTED_RELEASE_SOURCE_REVISION__");
    assert.equal(lane.vars.ACOS_CANDIDATE_DIGEST, "__PROTECTED_RELEASE_CANDIDATE_DIGEST__");
  }
  assert.equal(path.isAbsolute(config.main), false);
});

test("tag discovery consumes the bounded all-deployable Cloudflare inventory", () => {
  const tag = `acos-prod-${"1".repeat(64)}`;
  const items = Array.from({ length: 11 }, (_, index) => ({
    id: `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`,
    annotations: index === 0 ? { "workers/tag": tag } : {},
  }));
  assert.deepEqual(versionIdsByTag({ success: true, result: { items } }, tag), [items[0].id]);
  assert.throws(() => versionIdsByTag({
    success: true,
    result: { items: Array.from({ length: ACOS_RELEASE_LIVE_DEFAULTS.maxVersionRecords + 1 }, () => ({ id: "x" })) },
  }, tag), /malformed or oversized/u);
  assert.match(live, /versions\?deployable=true/u);
  assert.doesNotMatch(live, /\["versions", "list"/u);
});

test("web artifact sealing is deterministic and fails closed at every traversal/read bound", async (t) => {
  const temporary = [];
  t.after(async () => Promise.all(temporary.map((directory) => rm(directory, {
    recursive: true,
    force: true,
  }))));
  const createDirectory = async (label) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), `acos-artifact-${label}-`));
    temporary.push(directory);
    return directory;
  };

  const exact = await createDirectory("exact");
  await mkdir(path.join(exact, "nested"));
  await writeFile(path.join(exact, "index.html"), "exact");
  await writeFile(path.join(exact, "nested", "app.js"), "bounded");
  assert.equal(
    await webArtifactDigestFromDirectory(exact),
    await webArtifactDigestFromDirectory(exact),
  );

  const oversizedFile = await createDirectory("file");
  await writeFile(
    path.join(oversizedFile, "large.bin"),
    Buffer.alloc(ACOS_RELEASE_LIVE_DEFAULTS.artifactBounds.fileBytes + 1),
  );
  await assert.rejects(webArtifactDigestFromDirectory(oversizedFile), /file is oversized/u);

  const tooManyFiles = await createDirectory("files");
  await Promise.all(Array.from(
    { length: ACOS_RELEASE_LIVE_DEFAULTS.artifactBounds.files + 1 },
    (_, index) => writeFile(path.join(tooManyFiles, `${index}.txt`), ""),
  ));
  await assert.rejects(webArtifactDigestFromDirectory(tooManyFiles), /directory is oversized/u);

  const aggregate = await createDirectory("aggregate");
  const chunk = Buffer.alloc(ACOS_RELEASE_LIVE_DEFAULTS.artifactBounds.fileBytes);
  await Promise.all(Array.from({ length: 5 }, (_, index) => (
    writeFile(path.join(aggregate, `${index}.bin`), chunk)
  )));
  await assert.rejects(webArtifactDigestFromDirectory(aggregate), /web artifact is oversized/u);

  const deep = await createDirectory("directories");
  let current = deep;
  for (let index = 0; index < ACOS_RELEASE_LIVE_DEFAULTS.artifactBounds.directories; index += 1) {
    current = path.join(current, "d");
    await mkdir(current);
  }
  await writeFile(path.join(current, "index.html"), "deep");
  await assert.rejects(webArtifactDigestFromDirectory(deep), /too many directories/u);

  const linked = await createDirectory("symlink");
  await symlink(path.join(exact, "index.html"), path.join(linked, "index.html"));
  await assert.rejects(webArtifactDigestFromDirectory(linked), /non-file entry/u);
});
