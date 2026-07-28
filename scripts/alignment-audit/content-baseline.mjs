import { createHash } from "node:crypto";

export function captureContentBaseline(documents = [], roots = []) {
  const entries = new Map();
  const listedSubjects = new Map();
  for (const document of documents) {
    const listedHandle = String(document?.readHandle ?? document?.subject ?? "");
    if (listedHandle) {
      listedSubjects.set(listedHandle, String(document?.subject ?? listedHandle));
    }
    const readHandle = String(document.readHandle ?? document.subject ?? "");
    if (readHandle.length === 0) continue;
    const content = observedContent(document);
    const readState = normalizedReadState(document, content);
    const readable = readState === "ok";
    entries.set(readHandle, Object.freeze({
      readHandle,
      subject: String(document.subject ?? readHandle),
      readState,
      byteLength: readable ? Buffer.byteLength(content, "utf8") : null,
      digest: readable ? exactDigest(content) : null,
    }));
  }
  return Object.freeze({
    entries,
    listedSubjects,
    roots: Object.freeze([...(roots ?? [])]),
  });
}

export async function verifyContentBaseline(baseline, reader) {
  if (!baseline?.entries || !(baseline.entries instanceof Map)) {
    throw new TypeError("verifyContentBaseline expects a captured baseline");
  }
  if (!reader || typeof reader.read !== "function") {
    throw new TypeError("verifyContentBaseline expects a SourceReader");
  }

  const mismatches = new Map();
  if (typeof reader.list === "function") {
    const currentDescriptors = await reader.list(baseline.roots ?? []);
    const currentSubjects = new Map(currentDescriptors.map((descriptor) => [
      String(descriptor.readHandle ?? descriptor.subject ?? ""),
      String(descriptor.subject ?? descriptor.readHandle ?? ""),
    ]).filter(([readHandle]) => readHandle));
    for (const [readHandle, subject] of baseline.listedSubjects ?? []) {
      if (currentSubjects.has(readHandle)) continue;
      mismatches.set(readHandle, Object.freeze({
        subject,
        expected: { presence: "present" },
        actual: { presence: "removed" },
      }));
    }
    for (const [readHandle, subject] of currentSubjects) {
      if (baseline.listedSubjects?.has(readHandle)) continue;
      mismatches.set(readHandle, Object.freeze({
        subject,
        expected: { presence: "absent" },
        actual: { presence: "added" },
      }));
    }
  }
  for (const entry of baseline.entries.values()) {
    let current;
    try {
      current = await reader.read({
        readHandle: entry.readHandle,
        subject: entry.subject,
      });
    } catch {
      current = { readState: "unreadable", content: null };
    }
    const content = observedContent(current);
    const readState = normalizedReadState(current, content);
    const readable = readState === "ok";
    const comparison = {
      readState,
      byteLength: readable ? Buffer.byteLength(content, "utf8") : null,
      digest: readable ? exactDigest(content) : null,
    };
    if (
      comparison.readState !== entry.readState ||
      comparison.byteLength !== entry.byteLength ||
      comparison.digest !== entry.digest
    ) {
      mismatches.set(entry.readHandle, Object.freeze({
        subject: entry.subject,
        expected: {
          readState: entry.readState,
          byteLength: entry.byteLength,
          digest: entry.digest,
        },
        actual: comparison,
      }));
    }
  }

  const ordered = [...mismatches.values()].sort((left, right) =>
    left.subject.localeCompare(right.subject, "en"));
  return Object.freeze({
    verified: ordered.length === 0,
    baselineVerified: ordered.length === 0,
    modifiedOutsideOutputCount: ordered.length,
    mismatches: Object.freeze(ordered),
  });
}

export function serializeContentBaseline(baseline) {
  return [...(baseline?.entries?.values?.() ?? [])]
    .map((entry) => ({
      subject: entry.subject,
      readState: entry.readState,
      byteLength: entry.byteLength,
      digest: entry.digest,
    }))
    .sort((left, right) => left.subject.localeCompare(right.subject, "en"));
}

function observedContent(document) {
  if (typeof document === "string") return document;
  if (typeof document?.content === "string") return document.content;
  if (typeof document?.text === "string") return document.text;
  return null;
}

function normalizedReadState(document, content) {
  if (typeof document === "string") return "ok";
  const state = String(document?.readState ?? "").trim().toLowerCase();
  if (state === "unreadable") return "unreadable";
  if (content !== null && (!state || state === "ok")) return "ok";
  return "malformed";
}

function exactDigest(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
