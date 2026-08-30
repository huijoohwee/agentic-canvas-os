// Responsibility: Bind one GitHub pull body snapshot and update to a provider-issued strong validator.
import { execFileSync } from "node:child_process";
import path from "node:path";

const ACCEPT = "Accept: application/vnd.github+json";
const API_VERSION = "X-GitHub-Api-Version: 2022-11-28";

export function createGitHubConditionalPullBodyPort({
  repository,
  execute = defaultExecute(repository),
} = {}) {
  const root = path.resolve(required(repository, "repository"));

  function strongHead({ targetRepository, pullRequestNumber }) {
    const endpoint = pullEndpoint(targetRepository, pullRequestNumber);
    const response = String(execute("gh", [
      "api", "--include", "--silent", "--method", "HEAD",
      "-H", ACCEPT,
      "-H", API_VERSION,
      endpoint,
    ], { cwd: root }));
    const headers = parseHeaders(response, "conditional pull-request HEAD");
    if (headers.status !== 200) invalid("conditional pull-request HEAD status");
    return providerTag(headers.etag, { requireStrong: true }).raw;
  }

  function readConditionalPull({ targetRepository, pullRequestNumber }) {
    const endpoint = pullEndpoint(targetRepository, pullRequestNumber);
    const etag = strongHead({ targetRepository, pullRequestNumber });
    const response = String(execute("gh", [
      "api", "--include", "--method", "GET",
      "-H", ACCEPT,
      "-H", API_VERSION,
      "-H", `If-Match: ${etag}`,
      endpoint,
    ], { cwd: root }));
    const split = response.search(/\r?\n\r?\n(?=\s*\{)/u);
    if (split < 0) invalid("conditional pull-request response");
    const headers = parseHeaders(response.slice(0, split), "conditional pull-request GET");
    if (headers.status !== 200) invalid("conditional pull-request GET status");
    const headTag = providerTag(etag, { requireStrong: true });
    const getTag = providerTag(headers.etag);
    if (getTag.opaque !== headTag.opaque) {
      invalid("conditional pull-request entity tag drift");
    }
    let raw;
    try {
      raw = JSON.parse(response.slice(response.indexOf("{", split)));
    } catch {
      invalid("conditional pull-request JSON");
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      invalid("conditional pull-request JSON");
    }
    return Object.freeze({
      etag,
      id: raw.node_id,
      number: raw.number,
      url: raw.html_url,
      state: String(raw.state || "").toUpperCase(),
      isDraft: raw.draft === true,
      headBranch: raw.head?.ref,
      headSha: raw.head?.sha,
      headRepository: raw.head?.repo?.full_name,
      baseSha: raw.base?.sha,
      body: String(raw.body || ""),
    });
  }

  function patchConditionalPull({
    targetRepository,
    pullRequestNumber,
    expectedEtag,
    body,
  }) {
    const etag = providerTag(expectedEtag, { requireStrong: true }).raw;
    const current = strongHead({ targetRepository, pullRequestNumber });
    if (current !== etag) invalid("pull request changed before conditional PATCH");
    return execute("gh", [
      "api", "--silent", "--method", "PATCH",
      "-H", ACCEPT,
      "-H", API_VERSION,
      "-H", `If-Match: ${etag}`,
      pullEndpoint(targetRepository, pullRequestNumber),
      "-f", `body=${String(body ?? "")}`,
    ], { cwd: root });
  }

  return Object.freeze({ readConditionalPull, patchConditionalPull });
}

function defaultExecute(repository) {
  const root = path.resolve(required(repository, "repository"));
  return (command, args) => execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function pullEndpoint(targetRepository, pullRequestNumber) {
  const owner = required(targetRepository, "target repository");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(owner)) {
    invalid("target repository");
  }
  const number = Number(pullRequestNumber);
  if (!Number.isSafeInteger(number) || number < 1) invalid("pull request number");
  return `repos/${owner}/pulls/${number}`;
}

function parseHeaders(value, label) {
  const text = String(value || "");
  const statuses = [...text.matchAll(/^HTTP\/[^\s]+\s+(\d{3})(?:\s|$)/gimu)];
  const etags = [...text.matchAll(/^etag:\s*([^\r\n]+)$/gimu)];
  if (statuses.length !== 1 || etags.length !== 1) {
    invalid(`${label} single response with strong entity tag`);
  }
  return Object.freeze({
    status: Number(statuses[0][1]),
    etag: etags[0][1],
  });
}

function providerTag(value, { requireStrong = false } = {}) {
  const raw = String(value || "").trim();
  const weak = raw.startsWith("W/");
  const quoted = weak ? raw.slice(2) : raw;
  if ((requireStrong && weak) || quoted.length < 2
    || quoted[0] !== '"' || quoted.at(-1) !== '"') {
    invalid("provider-issued strong entity tag");
  }
  const opaque = quoted.slice(1, -1);
  if (!opaque || /[\u0000-\u0020\u007f"]/u.test(opaque)) {
    invalid("provider-issued strong entity tag");
  }
  return Object.freeze({ raw, weak, opaque });
}

function required(value, label) {
  const result = String(value || "").trim();
  if (!result) invalid(label);
  return result;
}

function invalid(label) {
  throw new Error(`Invalid ${label}.`);
}
