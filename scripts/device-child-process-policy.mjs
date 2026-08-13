import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

import { textCommandOptions } from "./command-text-options.mjs";

export const TASK_AUTHORITY_LOCATOR_KEY = "AGENTIC_TASK_AUTHORITY_FILE";

const CANONICAL_SCOPE_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u;

export function createDeviceChildProcessPolicy({
  taskAuthorityFile = "",
  environment = process.env,
  json = false,
  execFile = execFileSync,
  spawn = spawnSync,
} = {}) {
  requireEnvironment(environment);
  if (typeof execFile !== "function" || typeof spawn !== "function") {
    throw new TypeError("Child-process adapters must be functions.");
  }
  const locator = String(taskAuthorityFile || "");
  const childEnvironment = (source, exposeLocator = false) => {
    requireEnvironment(source);
    const child = { ...source };
    delete child[TASK_AUTHORITY_LOCATOR_KEY];
    if (exposeLocator && locator) child[TASK_AUTHORITY_LOCATOR_KEY] = locator;
    return child;
  };
  const textOptions = options => textCommandOptions({
    ...options,
    env: childEnvironment(options?.env ?? environment),
  });
  const executeText = (command, argumentsList, options = {}) => {
    const normalized = normalizeInvocation(command, argumentsList);
    return execFile(
      normalized.command,
      normalized.argumentsList,
      textOptions(options),
    );
  };
  const executeOptional = (command, argumentsList) => {
    const normalized = normalizeInvocation(command, argumentsList);
    return spawn(
      normalized.command,
      normalized.argumentsList,
      textOptions({}),
    );
  };

  return Object.freeze({
    gitText: argumentsList => executeText("git", argumentsList),
    gitOptional(argumentsList) {
      const result = executeOptional("git", argumentsList);
      return result.status === 0 ? String(result.stdout || "").trim() : "";
    },
    ghText: argumentsList => executeText("gh", argumentsList),
    ghOptional(argumentsList) {
      const result = executeOptional("gh", argumentsList);
      return result.status === 0 ? String(result.stdout || "").trim() : "";
    },
    run(command, argumentsList) {
      const normalized = normalizeInvocation(command, argumentsList);
      const stdio = json ? ["ignore", "ignore", "inherit"] : "inherit";
      const result = spawn(normalized.command, normalized.argumentsList, {
        stdio,
        env: childEnvironment(environment),
      });
      if (result.status !== 0) {
        throw new Error(`${normalized.command} ${normalized.argumentsList.join(" ")} failed`);
      }
    },
    runText: executeText,
    commitCoordinationClaim({ scope, epoch, preserveOwnedDirt = false } = {}) {
      requireCoordinationClaimInput({ locator, scope, epoch, preserveOwnedDirt });
      if (!preserveOwnedDirt) {
        const indexProbe = spawn("git", ["diff", "--cached", "--quiet", "--"], {
          stdio: ["ignore", "ignore", "inherit"],
          env: childEnvironment(environment),
        });
        if (indexProbe.status === 1) {
          throw new Error("Coordination claim requires an empty staged index.");
        }
        if (indexProbe.status !== 0) {
          throw new Error("Coordination claim could not verify the staged index.");
        }
      }
      const argumentsList = [
        "commit",
        "--allow-empty",
        "--only",
        "-m",
        `chore(coordination): claim ${scope} lease ${epoch}`,
      ];
      const stdio = json ? ["ignore", "ignore", "inherit"] : "inherit";
      const result = spawn("git", argumentsList, {
        stdio,
        env: childEnvironment(environment, true),
      });
      if (result.status !== 0) {
        throw new Error(`git ${argumentsList.join(" ")} failed`);
      }
    },
  });
}

export function createCoordinationClaimRunAdapter({
  action,
  expectedScope,
  verifyExpectedClaim,
  run: genericRun,
  commitCoordinationClaim,
}) {
  if (typeof genericRun !== "function" || typeof commitCoordinationClaim !== "function") {
    throw new TypeError("Coordination claim adapter requires generic and typed runners.");
  }
  if (!["start", "resume"].includes(action)) return genericRun;
  if (!CANONICAL_SCOPE_PATTERN.test(String(expectedScope || ""))) {
    throw new TypeError("Coordination claim adapter requires the exact canonical lifecycle scope.");
  }
  if (typeof verifyExpectedClaim !== "function") {
    throw new TypeError("Coordination claim adapter requires an exact live-lease verifier.");
  }
  return (command, argumentsList) => {
    const claim = parseCoordinationClaimInvocation({ action, command, argumentsList });
    if (!claim || claim.scope !== expectedScope || verifyExpectedClaim(claim) !== true) {
      return genericRun(command, argumentsList);
    }
    return commitCoordinationClaim(claim);
  };
}

function requireCoordinationClaimInput({ locator, scope, epoch, preserveOwnedDirt }) {
  if (!locator || !path.isAbsolute(locator)) {
    throw new TypeError("Coordination claim requires an absolute external task-authority locator.");
  }
  if (typeof scope !== "string" || !CANONICAL_SCOPE_PATTERN.test(scope)) {
    throw new TypeError("Coordination claim scope must be canonical lowercase ASCII with at most 48 characters.");
  }
  if (!Number.isSafeInteger(epoch) || epoch <= 0) {
    throw new TypeError("Coordination claim epoch must be a positive safe integer.");
  }
  if (typeof preserveOwnedDirt !== "boolean") {
    throw new TypeError("Coordination claim owned-dirt preservation must be boolean.");
  }
}

function parseCoordinationClaimInvocation({ action, command, argumentsList }) {
  if (command !== "git" || !Array.isArray(argumentsList)) return null;
  const preserveOwnedDirt = action === "resume"
    && argumentsList.length === 5
    && argumentsList[0] === "commit"
    && argumentsList[1] === "--allow-empty"
    && argumentsList[2] === "--only"
    && argumentsList[3] === "-m";
  const ordinary = argumentsList.length === 4
    && argumentsList[0] === "commit"
    && argumentsList[1] === "--allow-empty"
    && argumentsList[2] === "-m";
  if (!ordinary && !preserveOwnedDirt) return null;
  const subject = argumentsList.at(-1);
  const match = typeof subject === "string" && subject.match(
    /^chore\(coordination\): claim ([a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?) lease ([1-9]\d*)$/u,
  );
  if (!match) return null;
  return { scope: match[1], epoch: Number(match[2]), preserveOwnedDirt };
}

function normalizeInvocation(command, argumentsList) {
  if (typeof command !== "string" || !command || command.includes("\0")) {
    throw new TypeError("Child-process command must be a non-empty string without NUL bytes.");
  }
  if (!Array.isArray(argumentsList) || argumentsList.some(value => (
    typeof value !== "string" || value.includes("\0")
  ))) {
    throw new TypeError("Child-process arguments must be an array of strings without NUL bytes.");
  }
  return { command, argumentsList: [...argumentsList] };
}

function requireEnvironment(environment) {
  if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
    throw new TypeError("Child-process environment must be an object.");
  }
}
