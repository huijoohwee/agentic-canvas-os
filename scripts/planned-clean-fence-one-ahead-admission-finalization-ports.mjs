// Responsibility: Provide bounded no-shell process and external-input ports for admission finalization.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export function defaultGit(environment) {
  return (cwd, args) => execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8", env: { ...environment, GIT_OPTIONAL_LOCKS: "0" },
    maxBuffer: 32 * 1024 * 1024, timeout: 60_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function defaultGh(environment) {
  return args => execFileSync("gh", args, {
    encoding: "utf8", env: environment, maxBuffer: 8 * 1024 * 1024,
    timeout: 60_000, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function readJson(file, label) {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error(`Admission-finalization ${label} is invalid JSON.`);
  }
}

export function absolute(value, label) {
  if (!path.isAbsolute(String(value || ""))) throw new Error(`${label} must be absolute.`);
  return path.resolve(value);
}
export function required(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value;
}
export function inside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}
