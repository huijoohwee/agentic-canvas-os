#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const API_VERSION = "2026-03-10";
const CHECK_NAME = "cloud-collaboration";
const EVENT_LIMIT_BYTES = 2 * 1024 * 1024;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

try {
  requireTrustedContext();
  const event = await readEvent(process.env.GITHUB_EVENT_PATH);
  const subject = requirePullRequestSubject(event);
  const token = required(process.env.GH_TOKEN || process.env.GITHUB_TOKEN, "GitHub token");
  const check = await createCheckRun({ token, subject });
  const verification = runVerification();
  const conclusion = verification.ok ? "success" : "failure";
  await completeCheckRun({
    token,
    subject,
    checkId: check.id,
    conclusion,
    output: verification.output,
  });
  process.stdout.write(`${JSON.stringify({
    schema: "agentic-cloud-collaboration-check-run-result/v1",
    ok: verification.ok,
    checkRunId: check.id,
    headSha: subject.headSha,
    conclusion,
  })}\n`);
  if (!verification.ok) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`[cloud-collaboration-check] ${publicMessage(error)}\n`);
  process.exitCode = 1;
}

function requireTrustedContext() {
  if (process.env.GITHUB_ACTIONS !== "true") {
    throw new Error("Exact-head check publication is available only in GitHub Actions.");
  }
  if (process.env.GITHUB_EVENT_NAME !== "pull_request_target") {
    throw new Error("Exact-head check publication requires pull_request_target.");
  }
  required(process.env.GITHUB_EVENT_PATH, "GITHUB_EVENT_PATH");
  required(process.env.GITHUB_RUN_ID, "GITHUB_RUN_ID");
}

async function readEvent(eventPath) {
  const bytes = await readFile(eventPath);
  if (bytes.byteLength === 0 || bytes.byteLength > EVENT_LIMIT_BYTES) {
    throw new Error("GitHub event payload is empty or exceeds the controller bound.");
  }
  const event = JSON.parse(bytes.toString("utf8"));
  if (!event || Array.isArray(event) || typeof event !== "object") {
    throw new Error("GitHub event payload must be an object.");
  }
  return event;
}

function requirePullRequestSubject(event) {
  const repository = required(event.repository?.full_name, "event repository");
  if (
    !REPOSITORY_PATTERN.test(repository) ||
    repository.toLowerCase() !== required(process.env.GITHUB_REPOSITORY, "GITHUB_REPOSITORY").toLowerCase()
  ) {
    throw new Error("Event repository does not match the workflow repository.");
  }
  const pullRequest = event.pull_request;
  const headRepository = required(pullRequest?.head?.repo?.full_name, "pull-request head repository");
  const baseRepository = required(pullRequest?.base?.repo?.full_name, "pull-request base repository");
  if (
    headRepository.toLowerCase() !== repository.toLowerCase() ||
    baseRepository.toLowerCase() !== repository.toLowerCase()
  ) {
    throw new Error("Cloud collaboration requires an exact same-repository pull request.");
  }
  const headSha = required(pullRequest?.head?.sha, "pull-request head SHA");
  if (!SHA_PATTERN.test(headSha)) {
    throw new Error("Pull-request head SHA must be a lowercase 40-character Git SHA.");
  }
  const number = Number(pullRequest?.number);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error("Pull-request number must be a positive integer.");
  }
  return { repository, headSha, pullRequestNumber: number };
}

function runVerification() {
  const child = spawnSync(
    process.execPath,
    [
      "scripts/cloud-collaboration.mjs",
      "verify-event",
      "--event-path",
      process.env.GITHUB_EVENT_PATH,
      "--json",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const result = parseVerificationResult(child.stdout);
  const ok = child.status === 0 && result?.ok === true;
  return {
    ok,
    output: {
      title: ok ? "Cloud collaboration verified" : "Cloud collaboration blocked",
      summary: ok
        ? "The exact pull-request head has a current, unexpired, non-overlapping cloud claim."
        : failureSummary(result),
    },
  };
}

function parseVerificationResult(stdout) {
  const rows = String(stdout || "").trim().split(/\r?\n/u).filter(Boolean);
  if (rows.length !== 1 || rows[0].length > 100_000) return null;
  try {
    const value = JSON.parse(rows[0]);
    return value && !Array.isArray(value) && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function failureSummary(result) {
  const findingCodes = Array.isArray(result?.findings)
    ? result.findings
      .map((finding) => String(finding?.code || finding))
      .filter((code) => /^[a-z0-9._-]{1,80}$/u.test(code))
      .slice(0, 8)
    : [];
  const message = publicMessage(result?.error?.message || "")
    .replace(/\s+/gu, " ")
    .trim();
  const code = String(result?.error?.code || "");
  const suffix = findingCodes.length > 0
    ? ` Findings: ${findingCodes.join(", ")}.`
    : message
      ? ` Failure: ${message}.`
    : /^[a-z0-9._-]{1,80}$/u.test(code)
      ? ` Failure: ${code}.`
      : "";
  return `The exact pull-request head did not satisfy current cloud collaboration authority.${suffix}`;
}

async function createCheckRun({ token, subject }) {
  return requestGitHub({
    token,
    repository: subject.repository,
    method: "POST",
    path: "/check-runs",
    expectedStatus: 201,
    body: {
      name: CHECK_NAME,
      head_sha: subject.headSha,
      status: "in_progress",
      external_id: checkExternalId(subject),
      details_url: runUrl(subject.repository),
      output: {
        title: "Cloud collaboration verification running",
        summary: "Trusted default-branch code is verifying the exact pull-request head against cloud authority.",
      },
    },
  });
}

async function completeCheckRun({ token, subject, checkId, conclusion, output }) {
  await requestGitHub({
    token,
    repository: subject.repository,
    method: "PATCH",
    path: `/check-runs/${checkId}`,
    expectedStatus: 200,
    body: {
      name: CHECK_NAME,
      status: "completed",
      conclusion,
      details_url: runUrl(subject.repository),
      output,
    },
  });
}

async function requestGitHub({
  token,
  repository,
  method,
  path,
  expectedStatus,
  body,
}) {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "agentic-canvas-os-cloud-collaboration-check",
      "X-GitHub-Api-Version": API_VERSION,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let value = null;
  if (text) {
    try {
      value = JSON.parse(text);
    } catch {
      value = null;
    }
  }
  if (response.status !== expectedStatus) {
    throw new Error(`GitHub check-run request failed with status ${response.status}.`);
  }
  if (!Number.isInteger(Number(value?.id)) || Number(value.id) <= 0) {
    throw new Error("GitHub check-run response did not include a valid ID.");
  }
  return value;
}

function checkExternalId(subject) {
  return `cloud-collaboration:${process.env.GITHUB_RUN_ID}:${subject.pullRequestNumber}:${subject.headSha}`;
}

function runUrl(repository) {
  const server = required(process.env.GITHUB_SERVER_URL || "https://github.com", "GITHUB_SERVER_URL");
  return `${server}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
}

function required(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function publicMessage(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]")
    .slice(0, 300);
}
