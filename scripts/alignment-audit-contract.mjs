import { scanFrontmatter } from "./alignment-audit/frontmatter.mjs";

const REQUIRED_REPORT_KEYS = [
  "title",
  "doc_type",
  "version",
  "date",
  "lang",
];

export function validateAlignmentAuditContractDocuments(documents) {
  const failures = [];
  for (const [name, text] of documentEntries(documents)) {
    if (typeof text !== "string" || !isAlignmentAuditDocument(text)) continue;
    try {
      validateDocument(name, text, failures);
    } catch (error) {
      failures.push(`${name}: alignment audit contract could not inspect document: ${messageOf(error)}`);
    }
  }
  return failures.sort((left, right) => left.localeCompare(right, "en"));
}

function validateDocument(name, text, failures) {
  const result = scanFrontmatter(text, REQUIRED_REPORT_KEYS);
  if (result.readState !== "ok") {
    failures.push(`${name}: malformed alignment audit frontmatter: ${result.error}`);
    return;
  }
  for (const key of result.missingKeys) {
    failures.push(`${name}: missing alignment audit frontmatter key ${key}`);
  }
  const schema = String(result.frontmatter.get("schema") ?? "");
  if (schema && !/^alignment-audit(?:[-/][a-z0-9.-]+)?$/u.test(schema)) {
    failures.push(`${name}: alignment audit schema must be alignment-audit or a versioned derivative`);
  }
  if (isReportType(result.frontmatter.get("doc_type"))) {
    for (const heading of [
      "## Alignment Summary",
      "## Readiness Gap Matrix",
      "## Findings",
      "## Pipeline Gate States",
    ]) {
      if (!result.body.includes(heading)) failures.push(`${name}: missing report section ${heading}`);
    }
  }
}

function isAlignmentAuditDocument(text) {
  const delimiter = text.indexOf("\n---\n", 4);
  const frontmatter = delimiter >= 0 ? text.slice(0, delimiter + 5) : text.slice(0, 2_000);
  return /^schema:\s*["']?alignment-audit(?:[-/][a-z0-9.-]+)?["']?\s*$/imu.test(frontmatter) ||
    /^doc_type:\s*["']?alignment[ _-]+audit[ _-]+report["']?\s*$/imu.test(frontmatter);
}

function isReportType(value) {
  return /^alignment[ _-]+audit[ _-]+report$/iu.test(String(value ?? ""));
}

function documentEntries(documents) {
  if (documents instanceof Map) return documents.entries();
  if (documents && typeof documents === "object") return Object.entries(documents);
  return [];
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
