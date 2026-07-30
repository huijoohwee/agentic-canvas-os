import { execFileSync } from "node:child_process";

const API_VERSION = "2026-03-10";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;

export function createGitHubRequest({
  token,
  apiBaseUrl = "https://api.github.com",
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  if (!String(token || "").trim()) throw new Error("A GitHub token is required.");
  const base = new URL(apiBaseUrl);
  return async ({ method = "GET", path, body = undefined }) => {
    const response = await fetchImpl(new URL(path, base), {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "agentic-canvas-os-cloud-collaboration",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let value = null;
    if (text) {
      try {
        value = JSON.parse(text);
      } catch {
        value = { message: "GitHub returned a non-JSON response." };
      }
    }
    return {
      status: response.status,
      value,
      date: response.headers.get("date"),
    };
  };
}

export function projectRepository(value) {
  const repository = {
    id: Number(value?.id),
    nodeId: String(value?.node_id || ""),
    fullName: String(value?.full_name || ""),
    defaultBranch: String(value?.default_branch || ""),
  };
  if (
    !Number.isInteger(repository.id) ||
    repository.id <= 0 ||
    !repository.nodeId ||
    !repository.fullName ||
    !repository.defaultBranch
  ) {
    throw new Error("GitHub returned an incomplete repository identity.");
  }
  return repository;
}

export function projectActor(value) {
  const actor = { id: Number(value?.id), login: String(value?.login || "") };
  if (!Number.isInteger(actor.id) || actor.id <= 0 || !actor.login) {
    throw new Error("GitHub returned an incomplete actor identity.");
  }
  return actor;
}

export function projectPullRequest(value, repository) {
  const pullRequest = {
    id: Number(value?.id),
    nodeId: String(value?.node_id || ""),
    number: Number(value?.number),
    url: String(value?.html_url || ""),
    branch: String(value?.head?.ref || ""),
    headSha: String(value?.head?.sha || ""),
    baseSha: String(value?.base?.sha || ""),
    state: String(value?.state || ""),
    draft: Boolean(value?.draft),
  };
  if (
    !Number.isInteger(pullRequest.id) ||
    pullRequest.id <= 0 ||
    !Number.isInteger(pullRequest.number) ||
    pullRequest.number <= 0 ||
    value?.head?.repo?.full_name !== repository.fullName ||
    value?.base?.repo?.full_name !== repository.fullName ||
    !pullRequest.nodeId ||
    !pullRequest.url ||
    !pullRequest.branch ||
    !SHA_PATTERN.test(pullRequest.headSha) ||
    !SHA_PATTERN.test(pullRequest.baseSha)
  ) {
    throw new Error("Pull request is not an exact same-repository projection.");
  }
  return pullRequest;
}

export function requireStatus(response, statuses, operation) {
  if (!statuses.includes(response?.status)) {
    const message = String(response?.value?.message || "request failed").slice(0, 240);
    throw new Error(`GitHub could not ${operation} (${response?.status || "unknown"}): ${message}`);
  }
}

export function requireRepositoryName(value, label) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(String(value || ""))) {
    throw new Error(`${label} must be an owner/repository name.`);
  }
}

export function requireSha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} must be a lowercase 40-character Git SHA.`);
  }
}

export function requireServerTime(value) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) {
    throw new Error("GitHub response did not provide a valid server Date header.");
  }
  return date.toISOString();
}

export function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer.`);
  return number;
}

export function resolveGitHubToken() {
  const environmentToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (environmentToken) return environmentToken;
  try {
    return execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new Error("GitHub authentication is required through GH_TOKEN, GITHUB_TOKEN, or gh auth.");
  }
}

export function publicTransportError(error) {
  return error instanceof Error
    ? error.message.replace(/[A-Za-z0-9_-]{32,}/gu, "[redacted]").slice(0, 240)
    : "transport failed";
}
