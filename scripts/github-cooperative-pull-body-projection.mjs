// Responsibility: Project one GitHub pull-request body under the repository cooperative-writer fence.
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  canonicalJson,
  digestValue,
} from "./cloud-collaboration-primitives.mjs";

const PULL_FIELDS = [
  "id", "number", "url", "state", "isDraft", "headRefName", "headRefOid",
  "headRepository", "baseRefName", "baseRefOid", "body",
].join(",");
const TOKEN_PREFIX = "agentic-snapshot-sha256:";

export function createGitHubCooperativePullBodyProjectionPort({
  repository,
  execute = defaultExecute(repository),
  temporaryRoot = os.tmpdir(),
  bodyFileSystem = {},
} = {}) {
  const root = path.resolve(required(repository, "repository"));
  const tempRoot = path.resolve(required(temporaryRoot, "temporary root"));
  let armed = null;

  function readConditionalPull({ targetRepository, pullRequestNumber }) {
    const subject = pullSubject(targetRepository, pullRequestNumber);
    const snapshot = stableSnapshot({ execute, root, subject });
    const etag = snapshotToken(snapshot);
    armed = Object.freeze({ subject, etag });
    return Object.freeze({ ...snapshot, etag });
  }

  function patchConditionalPull({
    targetRepository,
    pullRequestNumber,
    expectedEtag,
    body,
  }) {
    const subject = pullSubject(targetRepository, pullRequestNumber);
    const expected = required(expectedEtag, "cooperative pull snapshot token");
    if (!armed || canonicalJson(armed.subject) !== canonicalJson(subject)
      || armed.etag !== expected || !validSnapshotToken(expected)) {
      invalid("armed cooperative pull snapshot token");
    }
    const before = stableSnapshot({ execute, root, subject });
    if (snapshotToken(before) !== expected) {
      armed = null;
      invalid("pull request changed before cooperative projection");
    }
    armed = null;
    const targetBody = String(body ?? "");
    const temporary = createPrivateBodyFile(tempRoot, targetBody, bodyFileSystem);
    try {
      execute("gh", [
        "pr", "edit", String(subject.number),
        "--repo", subject.repository,
        "--body-file", temporary.file,
      ], { cwd: root });
    } finally {
      temporary.remove();
    }
    const after = stableSnapshot({ execute, root, subject });
    requireSameImmutablePull(before, after);
    if (after.body !== targetBody) invalid("cooperative pull-request body readback");
    return Object.freeze({
      beforeSnapshotToken: expected,
      afterSnapshotToken: snapshotToken(after),
      bodyDigest: digestValue(targetBody),
      providerAtomicCompareAndSwap: false,
      cooperativeWriterFenceRequired: true,
    });
  }

  return Object.freeze({ readConditionalPull, patchConditionalPull });
}

function stableSnapshot({ execute, root, subject }) {
  const first = readSnapshot({ execute, root, subject });
  const second = readSnapshot({ execute, root, subject });
  if (canonicalJson(first) !== canonicalJson(second)) {
    invalid("stable cooperative pull-request snapshot");
  }
  return first;
}

function readSnapshot({ execute, root, subject }) {
  let raw;
  try {
    raw = JSON.parse(String(execute("gh", [
      "pr", "view", String(subject.number),
      "--repo", subject.repository,
      "--json", PULL_FIELDS,
    ], { cwd: root })));
  } catch {
    invalid("cooperative pull-request JSON");
  }
  const snapshot = Object.freeze({
    id: required(raw?.id, "pull-request ID"),
    number: positive(raw?.number, "pull-request number"),
    url: required(raw?.url, "pull-request URL"),
    state: required(raw?.state, "pull-request state").toUpperCase(),
    isDraft: raw?.isDraft === true,
    headBranch: required(raw?.headRefName, "pull-request head branch"),
    headSha: sha(raw?.headRefOid, "pull-request head SHA"),
    headRepository: required(
      raw?.headRepository?.nameWithOwner,
      "pull-request head repository",
    ),
    baseBranch: required(raw?.baseRefName, "pull-request base branch"),
    baseSha: sha(raw?.baseRefOid, "pull-request base SHA"),
    body: String(raw?.body ?? ""),
  });
  const expectedUrl = `https://github.com/${subject.repository}/pull/${subject.number}`;
  if (snapshot.number !== subject.number || snapshot.url !== expectedUrl
    || snapshot.headRepository !== subject.repository
    || snapshot.baseBranch !== "main") {
    invalid("exact same-repository pull-request subject");
  }
  return snapshot;
}

function requireSameImmutablePull(before, after) {
  for (const field of [
    "id", "number", "url", "state", "isDraft", "headBranch", "headSha",
    "headRepository", "baseBranch", "baseSha",
  ]) {
    if (before[field] !== after[field]) {
      invalid(`cooperative pull-request ${field} readback`);
    }
  }
}

function snapshotToken(snapshot) {
  return `"${TOKEN_PREFIX}${digestValue({
    schema: "agentic-github-cooperative-pull-snapshot/v1",
    snapshot,
  })}"`;
}

function validSnapshotToken(value) {
  return new RegExp(`^"${TOKEN_PREFIX}[0-9a-f]{64}"$`, "u").test(value);
}

export function createPrivateBodyFile(root, body, overrides = {}) {
  const fileSystem = {
    chmodSync,
    closeSync,
    fsyncSync,
    mkdtempSync,
    openSync,
    readFileSync,
    rmSync,
    writeFileSync,
    ...overrides,
  };
  let directory = null;
  let descriptor = null;
  try {
    directory = fileSystem.mkdtempSync(path.join(root, "agentic-pull-body-"));
    fileSystem.chmodSync(directory, 0o700);
    const file = path.join(directory, "body.md");
    descriptor = fileSystem.openSync(file, "wx", 0o600);
    fileSystem.writeFileSync(descriptor, body);
    fileSystem.fsyncSync(descriptor);
    fileSystem.closeSync(descriptor);
    descriptor = null;
    // Re-read the exact bytes before they leave the process boundary.
    if (fileSystem.readFileSync(file, "utf8") !== body) {
      invalid("private pull body file");
    }
    return Object.freeze({
      file,
      remove() {
        removePrivateBodyDirectory(fileSystem, directory);
      },
    });
  } catch (error) {
    if (descriptor !== null) {
      try {
        fileSystem.closeSync(descriptor);
      } catch {
        // Preserve the primary creation or verification failure.
      }
    }
    removePrivateBodyDirectory(fileSystem, directory);
    throw error;
  }
}

function removePrivateBodyDirectory(fileSystem, directory) {
  if (!directory) return;
  try {
    fileSystem.rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 2,
      retryDelay: 10,
    });
  } catch {
    // Cleanup is bounded and best-effort; never replace the provider result.
  }
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

function pullSubject(repository, number) {
  const owner = required(repository, "target repository");
  const pullNumber = positive(number, "pull-request number");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(owner)) {
    invalid("target repository");
  }
  return Object.freeze({ repository: owner, number: pullNumber });
}

function positive(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) invalid(label);
  return result;
}

function sha(value, label) {
  const result = required(value, label);
  if (!/^[0-9a-f]{40,64}$/u.test(result)) invalid(label);
  return result;
}

function required(value, label) {
  const result = String(value || "").trim();
  if (!result) invalid(label);
  return result;
}

function invalid(label) {
  throw new Error(`Invalid ${label}.`);
}
