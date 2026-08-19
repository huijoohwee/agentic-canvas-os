// Responsibility: Resolve roots, read authored inputs, validate receipts, and write projection documents as the only projector IO owner.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { RECEIPT_INPUTS, validateRedactedFields, validateStructural } from "./orchestration-projection-contract.mjs";

const DEFAULT_REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_OVERRIDE = "AGENTIC_ORCHESTRATION_PROJECTION_STATE_ROOT";

export function resolveRoots({ env = process.env, repositoryRoot = DEFAULT_REPOSITORY_ROOT, git = runGit } = {}) {
  const root = path.resolve(repositoryRoot);
  const workspaceRoot = path.dirname(root);
  const runtimeStateRoot = path.join(workspaceRoot, ".runtime-state", "agentic-canvas-os");
  const projectionOutputRoot = path.resolve(String(env[OUTPUT_OVERRIDE] || "").trim() || path.join(runtimeStateRoot, "orchestration-projection"));
  const gitCommonDir = path.resolve(root, git(root, ["rev-parse", "--git-common-dir"]).trim());
  return { repositoryRoot: root, workspaceRoot, runtimeStateRoot, projectionOutputRoot, gitCommonDir };
}

export function readAuthoredAxis({ repositoryRoot = DEFAULT_REPOSITORY_ROOT } = {}) {
  const text = readFileSync(path.join(repositoryRoot, "docs", "START-WORKFLOW.md"), "utf8");
  const stageMatch = text.match(/^stage_order:\s*(\[[^\n]+\])/mu);
  const ttlMatch = text.match(/^coordination:\s*$[\s\S]*?^\s{2}writer_lease_ttl_seconds:\s*(\d+)\s*$/mu);
  if (!stageMatch) return { ok: false, reason: "input-absent", detail: { expected: "stage_order" } };
  if (!ttlMatch) return { ok: false, reason: "input-absent", detail: { expected: "coordination.writer_lease_ttl_seconds" } };
  const stageAxis = JSON.parse(stageMatch[1]);
  if (!Array.isArray(stageAxis) || stageAxis.length === 0) return { ok: false, reason: "input-absent", detail: { expected: "stage_order" } };
  return { ok: true, stageAxis, stalenessBoundSeconds: Number(ttlMatch[1]), authoredDate: authoredDate(text) };
}

export function readReceiptInputs({ roots, overrides = {} } = {}) {
  const records = [];
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  for (const descriptor of RECEIPT_INPUTS) {
    const location = receiptLocation({ descriptor, roots, overrides });
    const loaded = readJson(location);
    if (!loaded.ok) return loaded;
    if (loaded.value?.schema !== descriptor.schemaId) return { ok: false, reason: "schema-id-mismatch", detail: { expected: descriptor.schemaId, observed: loaded.value?.schema ?? null } };
    if (descriptor.formal) {
      const schema = JSON.parse(readFileSync(path.join(roots.repositoryRoot, descriptor.schemaPath), "utf8"));
      const validate = ajv.compile(schema);
      if (!validate(loaded.value)) return { ok: false, reason: "schema-validation-failed", detail: { expected: descriptor.schemaId, observed: validate.errors?.[0]?.instancePath || "schema" } };
      const failure = validateRedactedFields(descriptor.schemaId, loaded.value);
      if (failure) return { ok: false, ...failure };
    } else {
      const failure = validateStructural(descriptor.schemaId, loaded.value);
      if (failure) return { ok: false, ...failure };
    }
    records.push(loaded.value);
  }
  return { ok: true, records };
}

export function writeProjection({ projectionOutputRoot, text }) {
  mkdirSync(projectionOutputRoot, { recursive: true });
  const outputPath = path.join(projectionOutputRoot, "orchestration-projection.md");
  writeFileSync(outputPath, text, "utf8");
  return { path: outputPath };
}

export function writeRawReceiptProjection({ projectionOutputRoot, text }) {
  mkdirSync(projectionOutputRoot, { recursive: true });
  const outputPath = path.join(projectionOutputRoot, "orchestration-projection-receipts.json");
  writeFileSync(outputPath, text, "utf8");
  return { path: outputPath };
}

function receiptLocation({ descriptor, roots, overrides }) {
  if (overrides[descriptor.schemaId]) return overrides[descriptor.schemaId];
  if (descriptor.schemaId === "agentic-local-runtime-readiness/v1") return path.join(roots.runtimeStateRoot, "knowgrph-local-runtime", "readiness.json");
  if (descriptor.schemaId === "agentic-writer-lease-registry/v2") return path.join(roots.gitCommonDir, "agentic-canvas-os", "writer-leases.json");
  return path.join(roots.projectionOutputRoot, "receipts", descriptor.slug + ".json");
}

function readJson(file) {
  if (!existsSync(file)) return { ok: false, reason: "input-absent", detail: { location: file } };
  try { return { ok: true, value: JSON.parse(readFileSync(file, "utf8")) }; }
  catch { return { ok: false, reason: "malformed-json", detail: { location: file } }; }
}
function authoredDate(text) { return text.match(/^date:\s*"?([^"\n]+)"?\s*$/mu)?.[1] || null; }
function runGit(cwd, args) { return execFileSync("git", args, { cwd, encoding: "utf8" }); }
