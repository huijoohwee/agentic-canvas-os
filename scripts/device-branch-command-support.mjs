import { readFileSync } from "node:fs";
import path from "node:path";

import { bindAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { readOwnershipPullRequest } from "./device-pull-request-state.mjs";

export function bindControllerHooksEnvironment(
  controllerRoot,
  environment = process.env,
) {
  const configuredCount = environment.GIT_CONFIG_COUNT === undefined
    || environment.GIT_CONFIG_COUNT === ""
    ? 0
    : Number(environment.GIT_CONFIG_COUNT);
  if (!Number.isInteger(configuredCount) || configuredCount < 0) {
    throw new Error("Workspace guard binding requires a valid ambient GIT_CONFIG_COUNT.");
  }
  const count = configuredCount;
  const hooksPath = path.resolve(controllerRoot, ".githooks");
  const matchingIndexes = [];
  for (let index = 0; index < count; index += 1) {
    if (environment[`GIT_CONFIG_KEY_${index}`] === "core.hooksPath") {
      matchingIndexes.push(index);
    }
  }
  if (matchingIndexes.length > 1) {
    throw new Error("Workspace guard binding found duplicate ambient core.hooksPath entries.");
  }
  if (matchingIndexes.length === 1) {
    environment[`GIT_CONFIG_VALUE_${matchingIndexes[0]}`] = hooksPath;
    return;
  }
  environment[`GIT_CONFIG_KEY_${count}`] = "core.hooksPath";
  environment[`GIT_CONFIG_VALUE_${count}`] = hooksPath;
  environment.GIT_CONFIG_COUNT = String(count + 1);
}

export function readMachinePullRequestDraft({
  action,
  branch,
  lease,
  ghText,
}) {
  const pullRequest = readOwnershipPullRequest({
    url: lease.pullRequestUrl,
    branch,
    ghText,
    requireOpen: action !== "publish",
  });
  const expected = ["start", "resume", "heartbeat", "park"].includes(action)
    ? true
    : ["review", "publish"].includes(action)
      ? false
      : null;
  if (expected !== null && pullRequest.isDraft !== expected) {
    throw new Error(
      `Machine result for ${action} cannot prove pull request draft state ${expected}.`,
    );
  }
  return pullRequest.isDraft;
}

export function resolveResultBranch(action, result, gitText) {
  if (action === "start") return result;
  if (action === "review" || action === "publish") {
    return gitText(["branch", "--show-current"]).trim();
  }
  return result?.branch || "";
}

export function exactPullRequestNumber(value) {
  return parseExactPullRequestUrl(
    value,
    "Provision recovery requires an exact HTTPS pull-request URL.",
  ).pullRequestNumber;
}

export function laneStateSignature(lanes) {
  return JSON.stringify([...lanes]
    .map(lane => ({ path: path.resolve(lane.path), stateDigest: lane.stateDigest }))
    .sort((left, right) => left.path.localeCompare(right.path)));
}

export function bindDeviceStartCloudAuthority({
  authority,
  admission,
  branch,
  headSha,
  pullRequestUrl,
  device,
  sessionId,
  bind = bindAdmissionCloudAuthority,
}) {
  const pullRequest = parseExactPullRequestUrl(
    pullRequestUrl,
    "Cloud bind requires an exact HTTPS pull-request URL.",
  );
  if (pullRequest.repository !== authority?.targetRepository) {
    throw new Error("Cloud bind pull request does not belong to the target repository.");
  }
  return bind({
    authority,
    manifest: admission,
    branch,
    headSha,
    pullRequestNumber: pullRequest.pullRequestNumber,
    deviceId: device,
    sessionId,
  });
}

function parseExactPullRequestUrl(value, errorMessage) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error(errorMessage);
  }
  const match = url.pathname.match(
    /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/([1-9]\d*)\/?$/u,
  );
  if (
    url.protocol !== "https:"
    || !url.hostname
    || url.username
    || url.password
    || url.search
    || url.hash
    || !match
  ) {
    throw new Error(errorMessage);
  }
  const [, owner, repository] = url.pathname.split("/");
  return Object.freeze({
    pullRequestNumber: Number(match[1]),
    repository: `${owner}/${repository}`,
  });
}

export function readJsonFile(file, label, readFile = readFileSync) {
  const absolutePath = path.resolve(file);
  let value;
  try {
    value = JSON.parse(readFile(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${label} at ${absolutePath}: ${error.message}`);
  }
  return requireJsonObject(value, label);
}

export function parseJsonObject(source, label) {
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`Could not parse ${label}: ${error.message}`);
  }
  return requireJsonObject(value, label);
}

export function readOption(values, name) {
  const prefix = `--${name}=`;
  const match = values.find(value => value.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : "";
}

function requireJsonObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value;
}
