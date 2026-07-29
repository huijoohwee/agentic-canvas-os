import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createInMemoryWriteSink,
  createWriteSink,
  incrementPatchVersion,
  OutputBoundaryViolation,
} from "../scripts/alignment-audit/output-boundary.mjs";
import { writeReport } from "../scripts/alignment-audit/report-writer.mjs";

test("write sink rejects escaping and absolute names before writing", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "alignment-boundary-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const outputRoot = path.join(temporaryRoot, "audit");
  const sink = await createWriteSink(outputRoot);

  for (const hostileName of [
    "../outside.md",
    "nested/../../outside.md",
    "/absolute.md",
    "C:/absolute.md",
    "\\\\server\\share\\outside.md",
  ]) {
    await assert.rejects(
      sink.write(hostileName, "must not be written"),
      OutputBoundaryViolation,
    );
  }
  assert.deepEqual(await readdir(outputRoot), []);
});

test("write sink writes strict descendants once and never reopens them", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "alignment-write-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const outputRoot = path.join(temporaryRoot, "audit");
  const sink = await createWriteSink(outputRoot);
  const canonicalOutputRoot = await realpath(outputRoot);

  const artifact = await sink.write("nested/report.md", "first publication\n");
  assert.equal(
    path.relative(canonicalOutputRoot, artifact.absolutePath),
    path.join("nested", "report.md"),
  );
  await assert.rejects(sink.write("nested/report.md", "replacement\n"), {
    code: "EEXIST",
  });
  assert.equal(await readFile(artifact.absolutePath, "utf8"), "first publication\n");
  assert.equal(await artifact.discard(), true);
  assert.equal(await artifact.discard(), false);
  await assert.rejects(readFile(artifact.absolutePath, "utf8"), { code: "ENOENT" });
  assert.deepEqual(await readdir(outputRoot), ["nested"]);
});

test("write sink removes a file when an internal write attempt fails", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "alignment-failure-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const outputRoot = path.join(temporaryRoot, "audit");
  const sink = await createWriteSink(outputRoot);
  const invalidContent = {
    toString() {
      throw new Error("content conversion failed");
    },
  };

  await assert.rejects(sink.write("partial.md", invalidContent), /content conversion failed/u);
  assert.deepEqual(await readdir(outputRoot), []);
});

test("sequential report emission retains prior semantic versions", async () => {
  const sink = createInMemoryWriteSink();
  const run = minimalRun();
  const first = await writeReport(run, sink);
  const firstBytes = new Map(sink.files);
  const second = await writeReport(run, sink);

  assert.equal(first.version, "1.0.0");
  assert.equal(second.version, "1.0.1");
  assert.equal(incrementPatchVersion(first.version), second.version);
  assert.equal(sink.files.size, 6);
  for (const [name, content] of firstBytes) {
    assert.equal(sink.files.get(name), content);
  }
});

test("version allocation advances beyond gaps and incomplete bundles", async () => {
  const sink = createInMemoryWriteSink();
  await sink.write("artifact-index-v1.0.0.md", "interrupted bundle\n");
  await sink.write("guideline-digest-v1.0.2.md", "later retained artifact\n");

  const result = await writeReport(minimalRun(), sink);
  assert.equal(result.version, "1.0.3");
  assert.equal(
    [...sink.files.keys()].filter((name) => name.startsWith("alignment-audit-report-")).length,
    1,
  );
  assert.equal(sink.files.has("guideline-digest-v1.0.0.md"), false);
});

test("report emission rejects a sink without version discovery", async () => {
  await assert.rejects(
    writeReport(minimalRun(), { async write() {} }),
    /version-aware WriteSink/u,
  );
});

function minimalRun() {
  return {
    guidelineDigest: "# Guideline Digest\n",
    artifactIndexMarkdown: "# Artifact Index\n",
    findings: [],
    counts: {
      auditedDocuments: 0,
      normativeElements: 0,
      artifactEntries: 0,
      findings: 0,
    },
    coverage: {
      artifactBearingTotal: 0,
      artifactBearingLinked: 0,
      linkedRatio: 1,
    },
    readiness: { assignments: [] },
    gates: { gates: [] },
    baselineVerified: true,
    modifiedOutsideOutputCount: 0,
    deployBoundaryState: "closed",
    elapsedMs: 0,
  };
}
