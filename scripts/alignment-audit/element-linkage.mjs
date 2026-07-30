import { frontmatterValue } from "./frontmatter.mjs";

const ELEMENT_ID_KEYS = Object.freeze([
  "element_id",
  "element_ids",
  "elementId",
  "elementIds",
  "guideline_element_id",
  "guideline_element_ids",
  "guidelineElementId",
  "guidelineElementIds",
]);

export function extractDeclaredElementIds(frontmatter, body = "") {
  const values = [];
  for (const key of ELEMENT_ID_KEYS) {
    const value = frontmatterValue(frontmatter, key);
    if (value !== undefined) values.push(value);
  }
  for (const line of String(body).split("\n")) {
    const match = /^\s*(?:[-*+]\s+)?(?:guideline[ _-]?)?element[ _-]?ids?\s*:\s*(.+?)\s*$/iu
      .exec(line);
    if (match) values.push(match[1]);
  }
  return normalizeElementIds(values.flatMap(parseElementIdList));
}

export function parseElementIdList(value) {
  if (Array.isArray(value)) return value.flatMap(parseElementIdList);
  const text = String(value ?? "").trim();
  if (!text) return [];
  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.flatMap(parseElementIdList);
    } catch {
      // The flat frontmatter subset also permits a non-JSON inline list.
    }
  }
  const fenced = [...text.matchAll(/`([^`]+)`/gu)].map((match) => match[1].trim());
  if (fenced.length > 0) return fenced;
  return text
    .replace(/^\[|\]$/gu, "")
    .split(/\s*[,;]\s*/u)
    .map((item) => item.trim().replace(/^["'`]|["'`]$/gu, ""))
    .filter(Boolean);
}

export function normalizeElementIds(values = []) {
  return [...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "en"));
}
