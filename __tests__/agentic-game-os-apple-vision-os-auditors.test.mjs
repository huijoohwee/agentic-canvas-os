// Responsibility: Verify deterministic fail-closed Agentic Game OS source-audit contracts.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { ACCEPTANCE_CRITERION_IDS, AUTHORED_DOCUMENT_FIELDS, AUTHORED_DOCUMENT_PATH,
  GLOSSARY_COMPONENTS, SIBLING_DOCUMENT_PATHS, validateAuthoredDocument,
  validateFrontmatterContract, validateReadinessRungs } from "../scripts/audit/frontmatter-validator.mjs";
import { auditDuplicateLogic, auditTrackedDuplicateLogic, digestAuditedSource } from "../scripts/audit/duplicate-logic-auditor.mjs";
import { auditPathPortability, auditTrackedPathPortability, collectTrackedAuthoredFiles, digestAuthoredText } from "../scripts/audit/path-portability-auditor.mjs";
import { auditFileSizes, auditTrackedFileSizes, countNewlineSeparatedLines, parseResponsibilityContract } from "../scripts/audit/file-size-auditor.mjs";
const VALID_FIELDS = Object.freeze({
  title: "Agentic Game OS Apple visionOS",
  doc_type: "prd-tad-adr",
  version: "1.0.0",
  date: "2026-08-09",
  lang: "en-US",
  frontmatter_contract: "required",
  owner: "shared-portability",
  local_rung: "spec-complete",
  delivered_rung: "undocumented",
  lane: "root-source",
  universal_scope: "browser-native",
});
test("frontmatter validator accepts the complete authored-document contract", () => {
  const result = validateAuthoredDocument({ path: AUTHORED_DOCUMENT_PATH, text: fullDocument() });
  assert.equal(ACCEPTANCE_CRITERION_IDS.length, 146);
  assert.ok(ACCEPTANCE_CRITERION_IDS.includes("5.11"));
  assert.ok(ACCEPTANCE_CRITERION_IDS.includes("8.12"));
  assert.equal(result.status, "passed");
  assert.equal(result.outcome, "document-valid");
  assert.deepEqual(Object.keys(result.frontmatter).sort(), [...AUTHORED_DOCUMENT_FIELDS].sort());
});
test("frontmatter validator aggregates every field and part defect", () => {
  const text = [
    "---",
    "title:",
    "title: duplicate",
    ...AUTHORED_DOCUMENT_FIELDS.filter((field) => !["title", "lane"].includes(field))
      .map((field) => `${field}: ${VALID_FIELDS[field]}`),
    "undeclared_field: value",
    "---",
    "# Product Requirements",
    "# Technical Architecture",
  ].join("\n");
  const result = validateFrontmatterContract(text);
  assert.equal(result.status, "failed");
  const invalid = result.violations.find(({ code }) => code === "document-invalid");
  assert.deepEqual(invalid.fields, ["lane", "title", "undeclared_field"]);
  assert.deepEqual(invalid.missingParts, ["architectural-decision-record"]);
  assert.match(invalid.parseErrors.join(" "), /duplicate frontmatter key title/u);
});
test("frontmatter validator reports missing, misplaced, wrong-path, and uncovered inputs", () => {
  const missing = validateAuthoredDocument({ exists: false });
  assert.equal(missing.outcome, "document-missing");
  assert.equal(missing.path, AUTHORED_DOCUMENT_PATH);
  const misplaced = validateFrontmatterContract(contractDocument("Xcode 26.6\n"));
  assert.equal(misplaced.outcome, "placement-violation");
  assert.deepEqual(misplaced.violations[0].references[0], {
    literal: "Xcode 26.6",
    line: 16,
    nearestHeading: "Product Requirements",
  });
  const escapedModule = validateFrontmatterContract(
    contractDocument("Use `knowgrph/src/escape.js`.\n"),
  );
  assert.ok(escapedModule.violations[0].references.some(({ literal }) => (
    literal === "knowgrph/src/escape.js"
  )));
  const wrongPath = validateAuthoredDocument({ path: "docs/wrong-location.md",
    text: fullDocument() });
  assert.ok(wrongPath.violations.find(({ code, fields }) => (
    code === "document-invalid" && fields.includes("path")
  )));
  const criteria = ACCEPTANCE_CRITERION_IDS.filter((criterion) => criterion !== "14.8");
  const uncovered = validateAuthoredDocument({ text: fullDocument({ criteria }) });
  assert.deepEqual(uncovered.violations.find(({ code }) => code === "coverage-gap")
    .uncoveredCriterionIds, ["14.8"]);
  const shallowMatrix = validateAuthoredDocument({ text: fullDocument({ completeMatrixRows: false }) });
  assert.ok(shallowMatrix.violations.find(({ code, invalidComponents }) => (
    code === "rung-combination"
    && invalidComponents.some(({ reason }) => reason === "readiness-gap-row")
  )));
  const unmatchedMatrix = validateAuthoredDocument({
    text: fullDocument().replace("| blocked | npm test |", "| first<br>second | npm test |"),
  });
  assert.ok(unmatchedMatrix.violations.find(({ code, invalidComponents }) => (
    code === "rung-combination"
    && invalidComponents.some(({ reason }) => reason === "readiness-gap-row")
  )));
  const identifierOnlyChecklist = validateAuthoredDocument({ text: fullDocument({ completeChecklist: false }) });
  assert.equal(identifierOnlyChecklist
    .violations.find(({ code }) => code === "coverage-gap").uncoveredCriterionIds.length, 146);
  const unsupportedDelivery = fullDocument()
    .replace("delivered_rung: undocumented", "delivered_rung: spec-complete")
    .replaceAll("| undocumented | runtime-ready", "| spec-complete | runtime-ready");
  const unsupported = validateAuthoredDocument({ text: unsupportedDelivery });
  assert.deepEqual(unsupported.violations.find(({ code }) => code === "evidence-invalid")
    .components, [{ component: "document_readiness", localRung: "spec-complete",
      deliveredRung: "spec-complete" }]);
  const unsupportedLocal = validateAuthoredDocument({
    text: fullDocument().replace("local_rung: spec-complete", "local_rung: runtime-ready"),
  });
  assert.deepEqual(unsupportedLocal.violations.find(({ code }) => code === "evidence-invalid")
    .components, [{ component: "document_readiness", localRung: "runtime-ready",
      deliveredRung: "undocumented" }]);
});
test("readiness rung validation enforces closed order, component coverage, and evidence", () => {
  const evidence = {
    command: "npm test -- portability",
    revision: "abc123",
    observedOutput: "1 test passed",
    exitStatus: 0,
    criterionIds: ["1.1"],
  };
  assert.equal(validateReadinessRungs({
    localRung: "runtime-ready",
    deliveredRung: "runtime-ready",
    componentRungs: [{ component: "Shared_Substrate", rung: "runtime-ready", evidence }],
    expectedComponents: ["Shared_Substrate"],
  }).valid, true);
  const ordered = validateReadinessRungs({
    localRung: "spec-complete",
    deliveredRung: "runtime-ready",
    componentRungs: [{ component: "Shared_Substrate", rung: "undocumented" }],
    expectedComponents: ["Shared_Substrate"],
  });
  assert.equal(ordered.valid, false);
  assert.equal(ordered.orderingInvalid, true);
  const malformed = validateReadinessRungs({
    localRung: "runtime-ready",
    deliveredRung: "spec-complete",
    componentRungs: [
      { component: "Shared_Substrate", rung: "preview" },
      { component: "Unexpected", rung: "spec-complete" },
      { component: "MissingRung" },
    ],
    expectedComponents: ["Shared_Substrate"],
  });
  assert.equal(malformed.valid, false);
  assert.deepEqual(malformed.unexpectedComponents, ["Unexpected"]);
  assert.ok(malformed.invalidComponents.some(({ rung }) => rung === "preview"));
  assert.ok(malformed.invalidComponents.some(({ component }) => component === "MissingRung"));
  const badEvidence = validateReadinessRungs({
    localRung: "runtime-ready",
    deliveredRung: "runtime-ready",
    componentRungs: [{
      component: "Shared_Substrate",
      rung: "runtime-ready",
      evidence: { ...evidence, criterionIds: ["99.1"] },
    }],
    expectedComponents: ["Shared_Substrate"],
  });
  assert.equal(badEvidence.valid, false);
  assert.deepEqual(badEvidence.evidenceInvalid, [
    { component: "Shared_Substrate", rung: "runtime-ready" },
  ]);
});
test("duplicate auditor is exhaustive, fail-closed, and does not let delegation mask code", () => {
  const modules = [
    moduleFixture("knowgrph/src/camera.ts", "implementation", "camera"),
    moduleFixture("GameXR/src/view.ts", "delegation", "camera"),
    {
      ...moduleFixture("GameXR/src/camera.ts", "implementation", "camera"),
      delegatesCapabilities: ["camera"],
    },
  ];
  const expectedModulePaths = modules
    .map(({ path }) => path)
    .filter((path) => path.startsWith("GameXR/"));
  const authoritativeAssignments = {
    "knowgrph/src/camera.ts": assignmentFor(
      modules[0], "implementation", ["camera"], "@knowgrph/camera",
    ),
    "GameXR/src/view.ts": assignmentFor(
      modules[1], "delegation", ["camera"], "@knowgrph/camera",
    ),
    "GameXR/src/camera.ts": assignmentFor(modules[2], "implementation", ["camera"]),
  };
  const result = auditDuplicateLogic({
    modules, expectedModulePaths, authoritativeAssignments, capabilities: ["camera"],
  });
  assert.equal(result.status, "failed");
  assert.deepEqual(result.violations, [{
    code: "duplicate-logic",
    capability: "camera",
    modulePaths: ["GameXR/src/camera.ts"],
    moduleCount: 1,
  }]);
  const reversed = auditDuplicateLogic({
    modules: [...modules].reverse(),
    expectedModulePaths: [...expectedModulePaths].reverse(),
    authoritativeAssignments,
    capabilities: ["camera"],
  });
  assert.deepEqual(reversed, result);
  const wrongSurface = structuredClone(authoritativeAssignments);
  wrongSurface["GameXR/src/view.ts"].publicSurface = "@knowgrph/wrong";
  assert.equal(auditDuplicateLogic({ modules, expectedModulePaths, authoritativeAssignments: wrongSurface, capabilities: ["camera"] }).outcome, "audit-incomplete");
  const undeclaredOwner = moduleFixture("knowgrph/src/other-camera.ts", "implementation", "camera");
  assert.equal(auditDuplicateLogic({ modules: [...modules, undeclaredOwner], expectedModulePaths,
    authoritativeAssignments, capabilities: ["camera"] }).outcome, "audit-incomplete");
});
test("duplicate auditor never reports omitted, unlabeled, unreadable, or late scope as clean", () => {
  assert.equal(auditDuplicateLogic().outcome, "audit-incomplete");
  const unlabeled = auditDuplicateLogic({
    modules: [moduleFixture("GameXR/src/view.ts", "frontend-only")],
    expectedModulePaths: ["GameXR/src/view.ts"],
  });
  assert.equal(unlabeled.outcome, "audit-incomplete");
  assert.ok(unlabeled.unscannedModules.some(({ reason }) => /assignment is absent/u.test(reason)));
  const noOwner = moduleFixture("GameXR/src/view.ts", "frontend-only");
  const missingOwner = auditDuplicateLogic({
    modules: [noOwner], expectedModulePaths: [noOwner.path], capabilities: ["camera"],
    authoritativeAssignments: { [noOwner.path]: assignmentFor(noOwner, "frontend-only") },
  });
  assert.ok(missingOwner.unscannedModules.some(({ reason }) => /knowgrph owner/u.test(reason)));
  const unreadable = auditDuplicateLogic({
    modules: [{ path: "GameXR/src/view.ts", readError: "permission denied" }],
    expectedModulePaths: ["GameXR/src/view.ts", "GameXR/src/missing.ts"],
    authoritativeAssignments: {
      "GameXR/src/view.ts": assignmentFor({ text: "" }, "frontend-only"),
      "GameXR/src/missing.ts": assignmentFor({ text: "" }, "frontend-only"),
    },
  });
  assert.deepEqual(unreadable.unscannedModules.map(({ path }) => path)
    .filter((path) => path.startsWith("GameXR/")), [
    "GameXR/src/missing.ts",
    "GameXR/src/view.ts",
  ]);
  const late = auditDuplicateLogic({
    modules: [moduleFixture("GameXR/src/view.ts", "frontend-only")],
    expectedModulePaths: ["GameXR/src/view.ts"],
    authoritativeAssignments: {
      "GameXR/src/view.ts": assignmentFor(
        moduleFixture("GameXR/src/view.ts", "frontend-only"),
        "frontend-only",
      ),
    },
    elapsedMs: 120_001,
  });
  assert.equal(late.outcome, "audit-incomplete");
  assert.ok(late.unscannedModules.some(({ reason }) => /deadline exceeded/u.test(reason)));
});
test("path auditor detects rooted, account, unrooted, and unresolved references", () => {
  const knownPath = "knowgrph/src/portability/camera.ts";
  const portable = auditPathPortability({
    files: [{ path: "docs/portable.md", text: `See $GITHUB_ROOT/${knownPath}.` }],
    repositoryPaths: [knownPath],
  });
  assert.equal(portable.status, "passed");
  const posixPath = ["", "Users", "fixture-account", "project", "camera.ts"].join("/");
  const windowsPath = ["C:", "Users", "fixture-account", "camera.ts"].join("\\");
  const failed = auditPathPortability({
    files: [{
      path: "src/paths.mjs",
      text: [`"${posixPath}"`, `"${windowsPath}"`, '{"username":"fixture-account"}',
        `"${knownPath}"`, '"$GITHUB_ROOT/knowgrph/src/missing.ts"'].join("\n"),
    }],
    accountNames: ["fixture-account"],
    repositoryPaths: [knownPath],
  });
  assert.equal(failed.outcome, "path-portability");
  assert.ok(failed.violations.some(({ kind }) => kind === "filesystem-root"));
  assert.ok(failed.violations.some(({ kind }) => kind === "account-name"));
  assert.ok(failed.violations.some(({ kind }) => kind === "unrooted-repository-reference"));
  assert.ok(failed.violations.some(({ kind }) => kind === "unresolved-github-root-reference"));
  assert.deepEqual(failed.violations.map(({ path }) => path),
    Array(failed.violations.length).fill("src/paths.mjs"));
  const backtickedRoot = auditPathPortability({
    files: [{ path: "docs/root.md", text: "Use `/Applications/Foo.app`." }],
    repositoryPaths: ["docs/root.md"],
  });
  assert.equal(backtickedRoot.outcome, "path-portability");
  assert.equal(backtickedRoot.violations[0].literal, "/Applications/Foo.app");
  for (const literal of [
    "/bin/sh", "/dev/null", "/mnt/data", "/run/user/1", "/sbin/fsck", "/srv/app",
  ]) {
    const rooted = auditPathPortability({
      files: [{ path: "src/root.ts", text: `const root = \`${literal}\`;` }],
      repositoryPaths: ["src/root.ts"],
    });
    assert.equal(rooted.outcome, "path-portability", literal);
  }
  const webReferences = auditPathPortability({
    files: [{
      path: "src/web.ts",
      text: 'const pattern = /run id/; const matcher = /username=huijoohwee/; const ratio = knowgrph/docs; const rooted = "$GITHUB_ROOT/huijoohwee/content/file.md"; https://example.com/docs/path [docs](/docs/path) /api/run workspace:/agents/run /network down/ GitHub owner huijoohwee',
    }],
    accountNames: ["huijoohwee"],
    repositoryPaths: ["src/web.ts", "knowgrph/docs", "huijoohwee/content/file.md"],
  });
  assert.equal(webReferences.status, "passed");
});
test("path and size auditors fail closed on empty or unavailable scope", () => {
  const emptyPaths = auditPathPortability(); assert.equal(emptyPaths.outcome, "audit-incomplete");
  assert.equal(emptyPaths.summary.scannedFileCount, 0);
  assert.equal(auditFileSizes().outcome, "audit-incomplete");
  assert.equal(auditTrackedPathPortability({ githubRoot: "relative" }).outcome, "audit-incomplete");
  assert.equal(auditTrackedFileSizes({ githubRoot: "relative" }).outcome, "audit-incomplete");
  for (const [path, text] of [["x.swift", "#/run/#"], ["x.tsx", "<div>" + ["", "Users", "a", "x"].join("/") + "</div>"], ["x.mjs", "const value = `${ /run id/.test(name)}`;"]]) {
    const unsupported = auditPathPortability({ files: [{ path, text }], repositoryPaths: [path] }); assert.deepEqual([unsupported.outcome, unsupported.summary.scannedFileCount], ["audit-incomplete", 0]);
  }
});
test("tracked-file discovery binds Git roots and excludes generated and lock files", (t) => {
  const portableSource = [
    "// Responsibility: Keep the fixture portable.",
    "export const source = \"$GITHUB_ROOT/fixture-repo/src/portable.mjs\";",
    "// See $GITHUB_ROOT/shared-spec.",
  ].join("\n");
  const githubRoot = gitFixture(t, {
    "fixture-repo": {
      "src/portable.mjs": portableSource,
      "dist/generated.mjs": "export const generated = true;",
      "package-lock.json": "{}",
    },
  });
  mkdirSync(join(githubRoot, "shared-spec"));
  const inventory = collectTrackedAuthoredFiles({
    githubRoot,
    repositoryNames: ["fixture-repo"],
  });
  assert.equal(inventory.scope.rootBound, true);
  assert.deepEqual(inventory.files.map(({ path }) => path), [
    "fixture-repo/src/portable.mjs",
  ]);
  assert.equal(inventory.repositoryPaths.length, 4);
  assert.equal(auditTrackedPathPortability({
    githubRoot,
    repositoryNames: ["fixture-repo"],
  }).status, "passed");
  assert.equal(auditTrackedFileSizes({
    githubRoot,
    repositoryNames: ["fixture-repo"],
    authoritativeAssignments: {
      "fixture-repo/src/portable.mjs": exportAssignment(
        portableSource, "Keep the fixture portable.", ["source"],
      ),
    },
  }).status, "passed");
});
test("tracked duplicate audit covers every GameXR source classification", (t) => {
  const viewSource = moduleFixture("ignored", "frontend-only").text;
  const ownerSource = moduleFixture("ignored", "implementation", "camera").text;
  const githubRoot = gitFixture(t, {
    "agentic-canvas-os": {
      "README.md": "<!-- Responsibility: Describe the fixture. -->\n",
    },
    knowgrph: {
      "src/camera.ts": ownerSource,
    },
    GameXR: {
      "src/view.ts": viewSource,
    },
  });
  assert.equal(auditTrackedDuplicateLogic({ githubRoot, capabilities: ["camera"] })
    .outcome, "audit-incomplete");
  const ownerAssignment = assignmentFor(
    { text: ownerSource }, "implementation", ["camera"], "@knowgrph/camera",
  );
  assert.equal(auditTrackedDuplicateLogic({
    githubRoot, capabilities: ["camera"],
    authoritativeAssignments: {
      "knowgrph/src/camera.ts": ownerAssignment,
      "GameXR/src/view.ts": assignmentFor({ text: viewSource }, "frontend-only"),
    },
  }).status, "passed");
  writeFileSync(join(githubRoot, "GameXR", "src", "view.ts"),
    "export const unlabeledView = true;\n");
  const stale = auditTrackedDuplicateLogic({
    githubRoot, capabilities: ["camera"],
    authoritativeAssignments: {
      "knowgrph/src/camera.ts": ownerAssignment,
      "GameXR/src/view.ts": assignmentFor({ text: viewSource }, "frontend-only"),
    },
  });
  assert.equal(stale.outcome, "audit-incomplete");
  assert.match(stale.unscannedModules[0].reason, /source digest does not match/u);
});
test("file-size auditor enforces the 600-line boundary and responsibility grammar", () => {
  const atLimit = sourceWithLineCount(600);
  const overLimit = sourceWithLineCount(601);
  const files = [
    { path: "src/at-limit.mjs", text: atLimit },
    { path: "src/over-limit.mjs", text: overLimit },
  ];
  assert.equal(countNewlineSeparatedLines(`${atLimit}\n`), 600);
  const sized = auditFileSizes({
    files,
    authoritativeAssignments: Object.fromEntries(files.map(({ path, text }) => [
      path, exportAssignment(text, "Own one generated fixture.", ["fixture"]),
    ])),
  });
  assert.equal(sized.status, "failed");
  assert.deepEqual(sized.violations.filter(({ code }) => code === "file-size"), [{
    code: "file-size",
    path: "src/over-limit.mjs",
    lineCount: 601,
    limit: 600,
  }]);
  for (const [text, statement, symbol] of [
    ["export const missing = true;", "Declared fixture.", "missing"],
    ["export const before = true;\n// Responsibility: Too late.", "Too late.", "before"],
    ["// Responsibility: First.\n// Responsibility: Second.\nexport const value = true;",
      "First.", "value"],
  ]) {
    const result = auditFileSizes({
      files: [{ path: "src/invalid.mjs", text }],
      authoritativeAssignments: {
        "src/invalid.mjs": exportAssignment(text, statement, [symbol]),
      },
    });
    assert.equal(result.outcome, "single-responsibility");
  }
  assert.equal(auditFileSizes({
    files: [{ path: "config.json", text: "{}" }],
  }).outcome, "single-responsibility");
  const supported = sourceWithLineCount(2);
  assert.equal(auditFileSizes({
    files: [{ path: "src/missing-authority.mjs", text: supported }],
  }).outcome, "audit-incomplete");
  const markerOnly = "// Responsibility: Own a marker-only module.";
  assert.equal(auditFileSizes({
    files: [{ path: "src/marker-only.mjs", text: markerOnly }],
  }).outcome, "audit-incomplete");
  assert.equal(auditFileSizes({
    files: [{ path: "src/marker-only.mjs", text: markerOnly }],
    authoritativeAssignments: {
      "src/marker-only.mjs": exportAssignment(markerOnly, "Own a marker-only module.", []),
    },
  }).status, "passed");
  const staleAssignment = exportAssignment(supported, "Own one generated fixture.", ["fixture"]);
  staleAssignment.sourceDigest = "0".repeat(64);
  assert.equal(auditFileSizes({
    files: [{ path: "src/stale.mjs", text: supported }],
    authoritativeAssignments: { "src/stale.mjs": staleAssignment },
  }).outcome, "audit-incomplete");
  const mixed = "// Responsibility: Own two fixtures.\nexport const alpha = 1;\nexport const beta = 2;";
  const mixedAssignment = exportAssignment(mixed, "Own two fixtures.", ["alpha", "beta"]);
  mixedAssignment.exports[1].responsibilityStatement = "Wrong owner.";
  const mismatch = auditFileSizes({ files: [{ path: "src/mismatch.mjs", text: mixed }],
    authoritativeAssignments: { "src/mismatch.mjs": mixedAssignment } });
  assert.equal(mismatch.outcome, "single-responsibility");
  assert.deepEqual(mismatch.violations[0].offendingExports.map(({ symbol }) => symbol),
    ["beta"]);
  for (const [path, body] of [["unsupported.ts", "export type Value = string;"],
    ["computed.js", 'Object.defineProperty(exports, "hidden", { value: 1 });'],
    ["prefixed.mjs", "void 0; export const hidden = 1;"],
    ["comment.mjs", "/* comment */ export const hidden = 1;"]]) {
    const text = `// Responsibility: Own an unsupported fixture.\n${body}`;
    const result = auditFileSizes({ files: [{ path: `src/${path}`, text }], authoritativeAssignments: {
      [`src/${path}`]: exportAssignment(text, "Own an unsupported fixture.", []),
    } });
    assert.ok(result.unscannedFiles.some(({ reason }) => /unsupported export grammar/u.test(reason)), path);
  }
  const markdown = [
    "---",
    "title: Contract",
    "---",
    "<!-- Responsibility: Specify one contract. -->",
    "# Contract",
  ].join("\n");
  assert.equal(parseResponsibilityContract({ path: "docs/contract.md", text: markdown })
    .placementValid, true);
  assert.equal(parseResponsibilityContract({
    path: "docs/contract.md",
    text: markdown.replace("<!-- Responsibility", "# Before\n<!-- Responsibility"),
  }).placementValid, false);
});
test("the five audit-gate files satisfy their own size and responsibility contract", () => {
  const paths = [
    "scripts/audit/frontmatter-validator.mjs",
    "scripts/audit/duplicate-logic-auditor.mjs",
    "scripts/audit/path-portability-auditor.mjs",
    "scripts/audit/file-size-auditor.mjs",
    "__tests__/agentic-game-os-apple-vision-os-auditors.test.mjs",
  ];
  const files = paths.map((path) => ({
    path,
    text: readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
  }));
  const result = auditFileSizes({
    files,
    authoritativeAssignments: Object.fromEntries(files.map(({ path, text }) => {
      const parsed = parseResponsibilityContract({ path, text });
      return [path, exportAssignment(
        text,
        parsed.marker.statement,
        parsed.exports.map(({ symbol }) => symbol),
      )];
    })),
  });
  assert.equal(result.status, "passed", JSON.stringify(result.violations));
});
function contractDocument(productText = "") {
  return documentText([
    "# Product Requirements",
    productText,
    "# Technical Architecture",
    "Architecture boundary.",
    "# Architectural Decision Record",
    "Decision boundary.",
  ]);
}
function fullDocument({
  criteria = ACCEPTANCE_CRITERION_IDS,
  completeMatrixRows = true,
  completeChecklist = true,
} = {}) {
  const requirements = Array.from({ length: 13 }, (_, index) => `Requirement ${index + 2}`)
    .join(", ");
  const rows = GLOSSARY_COMPONENTS.map((component) => (
    completeMatrixRows
      ? `| ${component} | undocumented | runtime-ready | blocked | npm test |`
      : `| ${component} | undocumented |`
  ));
  const references = SIBLING_DOCUMENT_PATHS.map((path) => `- \`$GITHUB_ROOT/${path}\``);
  return documentText([
    "# Product Requirements",
    requirements,
    "## Readiness Gap Matrix",
    "| Component | Current rung | Target | Blocking condition | Command |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "## Validation Checklist",
    completeChecklist
      ? `- Command: \`npm test -- auditors\`; Observed exit status: 0; Criteria: ${criteria.join(", ")}`
      : `- Criteria: ${criteria.join(", ")}`,
    "# Technical Architecture",
    "Provider-neutral architecture.",
    "# Architectural Decision Record",
    "Source owners remain unchanged.",
    "## Reference Implementation",
    "Xcode 26.6, RealityKit, and SwiftUI are concrete references.",
    ...references,
  ]);
}
function documentText(bodyLines) {
  return [
    "---",
    ...AUTHORED_DOCUMENT_FIELDS.map((field) => `${field}: ${VALID_FIELDS[field]}`),
    "---",
    "<!-- Responsibility: Specify the portability document. -->",
    ...bodyLines,
  ].join("\n");
}
function moduleFixture(path, role, capability) {
  const classification = role === "frontend-only"
    ? "// Shared-Capability-Frontend-Only"
    : `// Shared-Capability-${role === "implementation" ? "Implementation" : "Delegation"}: ${capability}`;
  return {
    path,
    text: [
      "// Responsibility: Provide one audit fixture.",
      classification,
      "export const fixture = true;",
    ].join("\n"),
  };
}
function assignmentFor(module, role, capabilities = [], publicSurface) {
  return {
    role,
    capabilities,
    sourceDigest: digestAuditedSource(module.text),
    ...(publicSurface ? { publicSurface } : {}),
  };
}
function exportAssignment(text, responsibilityStatement, symbols) {
  return {
    sourceDigest: digestAuthoredText(text),
    responsibilityStatement,
    exports: symbols.map((symbol) => ({ symbol, responsibilityStatement })),
  };
}
function sourceWithLineCount(lineCount) {
  return [
    "// Responsibility: Own one generated fixture.",
    "export const fixture = true;",
    ...Array.from({ length: lineCount - 2 }, () => "// filler"),
  ].join("\n");
}
function gitFixture(t, repositories) {
  const githubRoot = mkdtempSync(join(tmpdir(), "agentic-game-os-audit-"));
  t.after(() => rmSync(githubRoot, { recursive: true, force: true }));
  for (const [repositoryName, files] of Object.entries(repositories)) {
    const repositoryRoot = join(githubRoot, repositoryName);
    mkdirSync(repositoryRoot, { recursive: true });
    execFileSync("git", ["init", "-q", repositoryRoot]);
    for (const [path, text] of Object.entries(files)) {
      const destination = join(repositoryRoot, path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, text);
    }
    execFileSync("git", ["-C", repositoryRoot, "add", "--", "."]);
  }
  return githubRoot;
}
