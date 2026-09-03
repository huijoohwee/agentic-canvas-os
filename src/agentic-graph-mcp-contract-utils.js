import { createHash } from "node:crypto";

export const SHA256_DIGEST = /^[0-9a-f]{64}$/u;
export const GRAPH_ID = /^kg:graph:[0-9a-f]{32}$/u;
export const PROJECTION_TOKEN = /^kg:projection:[0-9a-f]{24}$/u;
export const EDGE_ID = /^kg:edge:[0-9a-f]{28}$/u;
export const SOURCE_REVISION = /^[0-9a-f]{40}$/u;
export const SAFE_TOKEN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

export const compareStableStrings = (leftRaw, rightRaw) => {
  const left = String(leftRaw);
  const right = String(rightRaw);
  return left < right ? -1 : left > right ? 1 : 0;
};

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort(compareStableStrings).map((key) => [key, stableValue(value[key])]),
  );
}

export const stableStringify = (value) => `${JSON.stringify(stableValue(value))}\n`;
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const isCanonicalOrder = (values, select = (value) => value) => (
  Array.isArray(values)
  && values.every((value, index) => (
    index === 0 || compareStableStrings(select(values[index - 1]), select(value)) < 0
  ))
);
export const isPlainObject = (value) => (
  Boolean(value) && typeof value === "object" && !Array.isArray(value)
);
export const hasText = (value) => typeof value === "string" && Boolean(value.trim());
export const hasExactKeys = (value, allowed, required = allowed) => {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key))
    && required.every((key) => Object.hasOwn(value, key));
};
export const isUniqueStringArray = (value, pattern, maximum, { required = false } = {}) => (
  Array.isArray(value)
  && (!required || value.length >= 1)
  && value.length <= maximum
  && value.every((entry) => typeof entry === "string" && pattern.test(entry))
  && new Set(value).size === value.length
);
export const boundedText = (value, maximum = 2_000) => (
  hasText(value) && value === value.trim() && value.length <= maximum
);
