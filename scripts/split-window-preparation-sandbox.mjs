// Responsibility: create and verify disposable credential-free preparation clones.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { digestValue } from "./cloud-collaboration-primitives.mjs";

const SHA = /^[0-9a-f]{40}$/u;
const SAFE_PROFILE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

export function withPreparationSandbox({ sourceRepository, baseRevision, profiles = {}, temporaryRoot = os.tmpdir() }, callback) {
  const source = realDirectory(sourceRepository); const base = requiredSha(baseRevision);
  const root = fs.mkdtempSync(path.join(realDirectory(temporaryRoot), "acos-split-window-"));
  const workspace = path.join(root, "workspace"); const home = path.join(root, "home"); fs.mkdirSync(home, { mode: 0o700 });
  try {
    run("git", ["clone", "--no-hardlinks", "--no-local", "--no-checkout", source, workspace], root, scrubbedEnvironment(home));
    run("git", ["checkout", "--detach", base], workspace, scrubbedEnvironment(home));
    run("git", ["remote", "remove", "origin"], workspace, scrubbedEnvironment(home));
    const gitDirectory = fs.realpathSync(path.join(workspace, ".git"));
    const identity = Object.freeze({ workspace, baseRevision: base,
      baseTree: git(workspace, ["rev-parse", "HEAD^{tree}"]),
      gitDirectoryDigest: fileIdentityDigest(gitDirectory), credentialEnvironment: [] });
    const api = Object.freeze({ identity, workspace,
      runProfile(profileId) { return runProfile({ profileId, profiles, workspace, home }); },
      assertUnchanged() { assertSandboxBoundary(workspace, base); },
    });
    const result = callback(api); assertSandboxBoundary(workspace, base); return result;
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

export function normalizeVerifierProfiles(value) {
  const result = {};
  for (const [id, profile] of Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b))) {
    const executableName = path.basename(String(profile?.executable || ""));
    if (!SAFE_PROFILE.test(id) || !profile || typeof profile !== "object" || Array.isArray(profile)
      || Object.keys(profile).sort().join(",") !== "args,executable,timeoutMs"
      || !path.isAbsolute(profile.executable) || !Array.isArray(profile.args)
      || profile.args.some(arg => typeof arg !== "string" || arg.includes("\0"))
      || (["sh", "bash", "zsh", "fish"].includes(executableName) && profile.args.includes("-c"))
      || (["node", "python", "python3", "ruby", "perl"].includes(executableName)
        && profile.args.some(arg => ["-e", "-c"].includes(arg)))
      || !Number.isSafeInteger(profile.timeoutMs) || profile.timeoutMs < 1 || profile.timeoutMs > 1_800_000) {
      throw new Error("Verifier profile is malformed or unsafe.");
    }
    result[id] = Object.freeze({ executable: profile.executable, args: Object.freeze([...profile.args]),
      timeoutMs: profile.timeoutMs, profileDigest: digestValue({ id, executable: profile.executable,
        args: profile.args, timeoutMs: profile.timeoutMs }) });
  }
  return Object.freeze(result);
}

function runProfile({ profileId, profiles, workspace, home }) {
  const normalized = normalizeVerifierProfiles(profiles); const profile = normalized[profileId];
  if (!profile) throw new Error("Verifier profile is not registered.");
  const startedAt = new Date().toISOString();
  try {
    const stdout = execFileSync(profile.executable, profile.args, { cwd: workspace,
      env: scrubbedEnvironment(home), timeout: profile.timeoutMs, encoding: "utf8", maxBuffer: 1_048_576 });
    const core = { profileId, profileDigest: profile.profileDigest, status: "passed", startedAt,
      outputDigest: sha256(stdout), exitCode: 0 };
    return Object.freeze({ ...core, receiptDigest: digestValue(core) });
  } catch (error) {
    const core = { profileId, profileDigest: profile.profileDigest, status: "failed", startedAt,
      outputDigest: sha256(String(error?.stdout || error?.message || "")), exitCode: Number.isInteger(error?.status) ? error.status : 1 };
    throw Object.assign(new Error(`Verifier profile ${profileId} failed.`), { receipt: Object.freeze({ ...core, receiptDigest: digestValue(core) }) });
  }
}

function assertSandboxBoundary(workspace, base) {
  if (git(workspace, ["rev-parse", "HEAD"]) !== base || git(workspace, ["branch", "--show-current"]) !== ""
    || git(workspace, ["remote"]) !== "") throw new Error("Preparation sandbox changed its detached source or gained a remote.");
}
function scrubbedEnvironment(home) {
  return Object.freeze({ PATH: process.env.PATH || "/usr/bin:/bin", LANG: "C", LC_ALL: "C",
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/usr/bin/false",
    SSH_ASKPASS: "/usr/bin/false", GIT_OPTIONAL_LOCKS: "0" });
}
function run(executable, args, cwd, env) { return execFileSync(executable, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] }); }
function git(root, args) { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).trim(); }
function realDirectory(value) { const result = fs.realpathSync(value); if (!fs.statSync(result).isDirectory()) throw new Error("Sandbox boundary is not a directory."); return result; }
function requiredSha(value) { if (!SHA.test(String(value))) throw new Error("Sandbox base revision is invalid."); return value; }
function fileIdentityDigest(file) { const stat = fs.lstatSync(file); return digestValue({ dev: String(stat.dev), ino: String(stat.ino), mode: stat.mode, birthtimeMs: stat.birthtimeMs }); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
