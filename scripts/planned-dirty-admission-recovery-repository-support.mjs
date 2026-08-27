// Responsibility: Validate repository identities and bounded deterministic review projections.

import path from "node:path";

import { updateWriterLeasePullRequestBody } from "./writer-lease-lib.mjs";

const GITHUB_PULL_REQUEST_BODY_LIMIT_BYTES = 65_536;

export function reviewRequestId(value) {
  const id = required(value, "review identity");
  return id.startsWith("github-pull-request:") ? id : `github-pull-request:${id}`;
}

export function assertProjectedAdmissionMarkerBodyCapacity({ body, lease }) {
  if (lease.admission?.status !== "planned") return;
  const placeholder = "0".repeat(64);
  const projected = {
    ...lease,
    admission: {
      ...lease.admission,
      status: "admitted",
      admittedReportDigest: placeholder,
      preservationReceiptDigest: placeholder,
    },
  };
  const targetBody = updateWriterLeasePullRequestBody(body, projected);
  if (Buffer.byteLength(targetBody) > GITHUB_PULL_REQUEST_BODY_LIMIT_BYTES) {
    invalid("bounded target pull-request marker body");
  }
}

export function assertExactTargetMarkerBodyCapacity({ sourceBody, targetLease }) {
  const targetBody = updateWriterLeasePullRequestBody(sourceBody, targetLease);
  if (Buffer.byteLength(targetBody) > GITHUB_PULL_REQUEST_BODY_LIMIT_BYTES) {
    invalid("bounded exact target pull-request marker body");
  }
}

export function githubRepositoryFromRemoteUrl(value) {
  const source = required(value, "origin remote URL");
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/u.exec(source);
  if (!match) invalid("GitHub origin repository");
  return match[1];
}

export function firstSha(value) {
  return sha(String(value || "").trim().split(/\s+/u)[0], "remote SHA");
}

export function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function required(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label);
  return value.trim();
}

export function sha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label);
  return value;
}

export function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(label);
  return value;
}

export function digestPattern(value) {
  return /^[0-9a-f]{64}$/u.test(String(value || ""));
}

export function invalid(label) {
  throw new Error(`Planned-dirty admission recovery has invalid ${label}.`);
}
