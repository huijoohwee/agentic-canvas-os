export const PROTECTED_MAIN_REFRESH_SCHEMA =
  "agentic-protected-main-refresh/v1";
export const PROTECTED_MAIN_REFRESH_CHAIN_SCHEMA =
  "agentic-protected-main-refresh-chain/v1";
export const PROTECTED_HEAD_REFRESH_OPERATION_SCHEMA =
  "agentic-protected-head-refresh-operation/v1";
export const PROTECTED_HEAD_REFRESH_HANDSHAKE_SCHEMA =
  "agentic-protected-head-refresh-handshake/v1";
export const PROTECTED_HEAD_REFRESH_COMMIT_SCHEMA =
  "agentic-protected-head-refresh-commit/v1";
export const PROTECTED_HEAD_REFRESH_CI_RUN_PREFIX = "Protected head refresh";
export const PROTECTED_HEAD_REFRESH_BOT_NAME = "github-actions[bot]";
export const PROTECTED_HEAD_REFRESH_BOT_EMAIL =
  "41898282+github-actions[bot]@users.noreply.github.com";
export const PROTECTED_HEAD_REFRESH_ACTIONS_APP_ID = 15368;
export const PROTECTED_HEAD_REFRESH_REQUIRED_CI_CONTEXTS = Object.freeze([
  "test",
  "build",
  "docs-contract",
  "collaboration-integration",
  "agentic-sdlc-policy-runtime",
]);

export const SHA_PATTERN = /^[0-9a-f]{40}$/;
export const MAX_REFRESH_HOPS = 256;
export const RECEIPT_STEPS = Symbol("protected-main-refresh-steps");
export const OPEN_MERGE_STATES = new Set([
  "behind",
  "blocked",
  "clean",
  "dirty",
  "has_hooks",
  "unknown",
  "unstable",
]);
export const TERMINAL_CI_CONCLUSIONS = new Set([
  "action_required",
  "cancelled",
  "failure",
  "neutral",
  "skipped",
  "stale",
  "startup_failure",
  "success",
  "timed_out",
]);

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

export function requireSha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} must be an exact lowercase 40-character Git SHA.`);
  }
  return value;
}

export function requireDigest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} must be an exact lowercase SHA-256 digest.`);
  }
  return value;
}

export function requireRepository(value, label) {
  if (!REPOSITORY_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} must be an owner/repository name.`);
  }
  return value;
}

export function requireExactText(value, label) {
  const text = String(value || "");
  if (
    !text
    || text !== text.trim()
    || text.length > 512
    || /[\u0000-\u001f\u007f]/u.test(text)
  ) {
    throw new Error(`${label} must be exact bounded text.`);
  }
  return text;
}

export function requireNullableTextJson(value, label) {
  let parsed;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    throw new Error(`${label} must be exact JSON null or a bounded string.`);
  }
  if (
    parsed !== null
    && (typeof parsed !== "string"
    || parsed.length > 4_096
    || /[\u0000\u007f]/u.test(parsed))
  ) {
    throw new Error(`${label} must be exact JSON null or a bounded string.`);
  }
  return JSON.stringify(parsed);
}

export function requireBranch(value, label) {
  const branch = requireExactText(value, label);
  if (
    branch.startsWith("-")
    || branch.startsWith("/")
    || branch.endsWith("/")
    || branch.endsWith(".")
    || branch.endsWith(".lock")
    || branch.includes("..")
    || branch.includes("//")
    || branch.includes("@{")
    || !/^[A-Za-z0-9._/-]+$/u.test(branch)
  ) {
    throw new Error(`${label} must be an exact safe Git branch name.`);
  }
  return branch;
}

export function requireCanonicalPositiveInteger(value, label) {
  const text = String(value ?? "");
  const number = Number(text);
  if (!/^[1-9]\d*$/u.test(text) || !Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${label} must be a canonical positive integer.`);
  }
  return number;
}

export function stripGitCommandLineFeed(value) {
  const text = String(value);
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

export function commitHeaderLines(rawCommit) {
  const separator = String(rawCommit || "").indexOf("\n\n");
  if (separator < 0) {
    throw new Error("Protected-head refresh commit object is malformed.");
  }
  return rawCommit.slice(0, separator).split("\n");
}

export function requireCommitTimestamp(header, label) {
  const match = String(header || "").match(/ (\d+ [+-]\d{4})$/u);
  if (!match) {
    throw new Error(`${label} timestamp is malformed.`);
  }
  return match[1];
}
