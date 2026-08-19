import assert from "node:assert/strict";
import test from "node:test";
import { DUPLICATE_LOGIC_AUDIT_SCHEMA, runDuplicateLogicAudit } from "../scripts/audit/orchestration-projection-duplicate-logic-auditor.mjs";

const sharedBody = "const result = values.map((value) => value.trim()).filter(Boolean).join(':'); return result.repeat(2);";

test("duplicate-logic auditor reports identical function bodies as an advisory", () => {
  const report = runDuplicateLogicAudit({ files: [
    { path: "scripts/orchestration-projection-alpha.mjs", text: "export function alpha(values) { " + sharedBody + " }" },
    { path: "scripts/orchestration-projection-beta.mjs", text: "export function beta(values) { " + sharedBody + " }" },
  ] });
  assert.equal(report.schema, DUPLICATE_LOGIC_AUDIT_SCHEMA);
  assert.equal(report.mode, "advisory");
  assert.equal(report.status, "completed");
  assert.deepEqual(report.findings[0].occurrences.map(({ path }) => path), ["scripts/orchestration-projection-alpha.mjs", "scripts/orchestration-projection-beta.mjs"]);
});

test("duplicate-logic auditor completes without findings for distinct module bodies", () => {
  const report = runDuplicateLogicAudit({ files: [
    { path: "scripts/orchestration-projection-alpha.mjs", text: "export function alpha() { return 'alpha'.repeat(30); }" },
    { path: "scripts/orchestration-projection-beta.mjs", text: "export function beta() { return 'beta'.repeat(30); }" },
  ] });
  assert.deepEqual(report.findings, []);
  assert.equal(report.summary.duplicateGroupCount, 0);
});
