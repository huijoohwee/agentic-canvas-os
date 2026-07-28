import { createHash } from "node:crypto";

const IDENTITY_KEYS = Object.freeze([
  "document_id",
  "documentId",
  "id",
  "graphId",
  "graph_id",
]);

export function normalizeContent(value) {
  if (typeof value !== "string") {
    throw new TypeError("normalizeContent expects a string");
  }

  const lines = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""));
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

export function normalizeScalar(value) {
  if (typeof value !== "string") {
    throw new TypeError("normalizeScalar expects a string");
  }
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n");
}

export function contentDigest(value) {
  const content =
    typeof value === "string"
      ? normalizeContent(value)
      : Buffer.isBuffer(value) || value instanceof Uint8Array
        ? value
        : stableSerialize(value);
  return createHash("sha256").update(content).digest("hex");
}

export function slugify(value, fallback = "document") {
  const slug = String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-{2,}/gu, "-");
  return slug || fallback;
}

export function documentKeyFrom(input = {}, content = "", occupiedKeys = []) {
  const frontmatter = asFrontmatter(input);
  const sourceContent =
    typeof content === "string" && content.length > 0
      ? content
      : typeof input?.body === "string"
        ? input.body
        : typeof input?.content === "string"
          ? input.content
          : "";

  const declaredIdentity = IDENTITY_KEYS
    .map((key) => getFrontmatterValue(frontmatter, key))
    .find(isPopulated);
  const declaredTitle = getFrontmatterValue(frontmatter, "title");
  const digest = contentDigest(stableSerialize({
    content: normalizeContent(sourceContent),
    frontmatter,
  }));
  const semanticBase = declaredIdentity
    ? slugify(declaredIdentity)
    : isPopulated(declaredTitle)
      ? slugify(declaredTitle)
      : "document";
  const base = `${semanticBase}-${digest.slice(0, 12)}`;

  const occupied = new Set(occupiedKeys ?? []);
  if (!occupied.has(base)) return base;

  for (let length = 8; length <= digest.length; length += 4) {
    const candidate = `${base}-${digest.slice(0, length)}`;
    if (!occupied.has(candidate)) return candidate;
  }
  return `${base}-${digest}`;
}

export function elementIdFrom(sectionAnchor, text) {
  const anchor = slugify(sectionAnchor, "section");
  const digest = contentDigest(
    stableSerialize([String(sectionAnchor ?? ""), normalizeContent(String(text ?? ""))]),
  );
  return `${anchor}-${digest.slice(0, 16)}`;
}

export function entryIdFrom(documentKey, entryKind, discriminator = "") {
  const key = slugify(documentKey, "document");
  const kind = slugify(entryKind, "entry");
  const digest = contentDigest(stableSerialize(discriminator));
  return `${key}--${kind}--${digest.slice(0, 16)}`;
}

export function stableSerialize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value instanceof Map) {
    return stableSerialize(
      [...value.entries()].sort(([left], [right]) =>
        String(left).localeCompare(String(right), "en"),
      ),
    );
  }
  const keys = Object.keys(value).sort((left, right) => left.localeCompare(right, "en"));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
}

function asFrontmatter(input) {
  if (input instanceof Map) return input;
  if (input?.frontmatter instanceof Map) return input.frontmatter;
  if (input?.frontmatter && typeof input.frontmatter === "object") return input.frontmatter;
  return input && typeof input === "object" ? input : {};
}

function getFrontmatterValue(frontmatter, key) {
  const value = frontmatter instanceof Map ? frontmatter.get(key) : frontmatter?.[key];
  return typeof value === "string" ? value.trim() : value;
}

function isPopulated(value) {
  return value !== undefined && value !== null && String(value).trim().length > 0;
}
