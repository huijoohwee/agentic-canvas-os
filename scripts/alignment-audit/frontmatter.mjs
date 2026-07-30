// Shared frontmatter scanner for the alignment audit capability.
//
// The supported subset is the one `scripts/docs-contract.mjs` already relies on and nothing
// wider: an opening `---\n` delimiter, a closing `\n---\n` delimiter searched from offset 4,
// and flat `key: value` scalars with no nesting, no sequences, and no block scalars. A required
// key counts as present only when its value is non-empty, matching the lane's `^key:\s*\S` test.
// Both lanes therefore share one definition of frontmatter and cannot drift.
//
// Input-shaped defects never throw: they return `readState: "malformed"` with the recoverable
// body retained, so an Audit_Run completes (Requirement 13.5). Required keys are always supplied
// by the caller (Requirement 2.6); this module declares no required-key constant.

import { normalizeContent } from "./normalize.mjs";

export function scanFrontmatter(text, requiredKeysOrOptions = []) {
  if (typeof text !== "string") {
    return malformed("", "frontmatter input is not a string");
  }

  const normalized = normalizeContent(text);
  if (!normalized.startsWith("---\n")) {
    return malformed(normalized, "missing opening frontmatter delimiter");
  }

  const closingIndex = normalized.indexOf("\n---\n", 4);
  if (closingIndex < 0) {
    return malformed(normalized, "missing closing frontmatter delimiter");
  }

  const raw = normalized.slice(4, closingIndex);
  const body = normalized.slice(closingIndex + 5);
  const parsed = parseFlatScalars(raw);
  if (!parsed.ok) return malformed(body, parsed.error);
  if (hasUnterminatedFence(body)) {
    return malformed(body, "unterminated fenced block");
  }

  const requiredKeys = Array.isArray(requiredKeysOrOptions)
    ? requiredKeysOrOptions
    : requiredKeysOrOptions?.requiredKeys ?? [];
  const missingKeys = missingFrontmatterKeys(parsed.frontmatter, requiredKeys);
  return {
    frontmatter: parsed.frontmatter,
    body,
    raw,
    readState: "ok",
    missingKeys,
    error: null,
  };
}

export const parseFrontmatter = scanFrontmatter;

export function missingFrontmatterKeys(frontmatter, requiredKeys = []) {
  const entries =
    frontmatter instanceof Map
      ? new Map(frontmatter)
      : new Map(Object.entries(frontmatter ?? {}));
  return [...new Set((requiredKeys ?? []).map(String))]
    .filter((key) => !isPopulatedValue(entries.get(key)))
    .sort((left, right) => left.localeCompare(right, "en"));
}

export function frontmatterValue(frontmatter, ...keys) {
  for (const key of keys) {
    const value = frontmatter instanceof Map ? frontmatter.get(key) : frontmatter?.[key];
    if (value !== undefined) return value;
  }
  return undefined;
}

export function frontmatterObject(frontmatter) {
  return frontmatter instanceof Map
    ? Object.fromEntries(frontmatter.entries())
    : { ...(frontmatter ?? {}) };
}

function parseFlatScalars(raw) {
  const frontmatter = new Map();
  if (raw.length === 0) return { ok: true, frontmatter };

  for (const [index, line] of raw.split("\n").entries()) {
    if (line.trim().length === 0) continue;
    if (/^[ \t]/u.test(line)) {
      return { ok: false, error: `invalid frontmatter indentation on line ${index + 1}` };
    }
    const match = /^([A-Za-z_][A-Za-z0-9_.-]*):(?:[ \t]*(.*))?$/u.exec(line);
    if (!match) {
      return { ok: false, error: `invalid flat frontmatter scalar on line ${index + 1}` };
    }
    const [, key, rawValue = ""] = match;
    if (frontmatter.has(key)) {
      return { ok: false, error: `duplicate frontmatter key ${key}` };
    }
    const scalar = parseScalar(rawValue);
    if (!scalar.ok) {
      return { ok: false, error: `${scalar.error} for frontmatter key ${key}` };
    }
    frontmatter.set(key, scalar.value);
  }
  return { ok: true, frontmatter };
}

function parseScalar(rawValue) {
  if (rawValue === "|" || rawValue === ">") {
    return { ok: false, error: "block scalars are unsupported" };
  }
  if (rawValue.startsWith('"')) {
    if (!rawValue.endsWith('"') || rawValue.length === 1) {
      return { ok: false, error: "unterminated double-quoted scalar" };
    }
    try {
      return { ok: true, value: JSON.parse(rawValue) };
    } catch {
      return { ok: false, error: "invalid double-quoted scalar" };
    }
  }
  if (rawValue.startsWith("'")) {
    if (!rawValue.endsWith("'") || rawValue.length === 1) {
      return { ok: false, error: "unterminated single-quoted scalar" };
    }
    return { ok: true, value: rawValue.slice(1, -1).replace(/''/gu, "'") };
  }
  if (/^[[{]/u.test(rawValue) && !matchingInlineDelimiters(rawValue)) {
    return { ok: false, error: "unbalanced inline scalar delimiters" };
  }
  return { ok: true, value: rawValue.trim() };
}

function matchingInlineDelimiters(value) {
  const opening = value[0];
  return (opening === "[" && value.endsWith("]")) || (opening === "{" && value.endsWith("}"));
}

function hasUnterminatedFence(body) {
  let open = null;
  for (const line of body.split("\n")) {
    if (!open) {
      const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
      if (match) open = { marker: match[1][0], length: match[1].length };
      continue;
    }
    const close = new RegExp(`^ {0,3}${open.marker}{${open.length},}[ \\t]*$`, "u");
    if (close.test(line)) open = null;
  }
  return open !== null;
}

function isPopulatedValue(value) {
  return value !== undefined && value !== null && String(value).trim().length > 0;
}

function malformed(body, error) {
  return {
    frontmatter: null,
    body,
    raw: null,
    readState: "malformed",
    missingKeys: [],
    error,
  };
}
