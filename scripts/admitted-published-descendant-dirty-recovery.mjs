#!/usr/bin/env node
// Responsibility: Expose plan/run transport for the combined-state recovery.
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAdmittedPublishedDescendantDirtyRecoveryController }
  from "./admitted-published-descendant-dirty-recovery-controller.mjs";
import { createAdmittedPublishedDescendantDirtyRecoveryRepositoryAdapter }
  from "./admitted-published-descendant-dirty-recovery-repository-adapter.mjs";

async function main() {
  const [mode, ...tokens] = process.argv.slice(2);
  const options = Object.fromEntries(tokens.filter(token => token.startsWith("--") && token.includes("="))
    .map(token => { const index = token.indexOf("="); return [token.slice(2, index), token.slice(index + 1)]; }));
  const json = tokens.includes("--json");
  const required = name => { const value = options[name];
    if (!value) throw new Error(`--${name}=<value> is required.`); return value; };
  try {
  if (!new Set(["plan", "run"]).has(mode)) throw new Error("Action must be plan or run.");
  const repository = path.resolve(required("repository"));
  const taskAuthorityFile = mode === "run" ? privateFile(required("task-authority"), repository) : null;
  const adapter = createAdmittedPublishedDescendantDirtyRecoveryRepositoryAdapter({ repository,
    sessionId: required("session"), taskAuthorityFile });
  const controller = createAdmittedPublishedDescendantDirtyRecoveryController({ adapter });
  const result = mode === "plan"
    ? await controller.plan({ ttlSeconds: Number(options["ttl-seconds"] || 1_800) })
    : await controller.run({ plan: JSON.parse(readFileSync(privateFile(required("plan-file"), repository), "utf8")),
      authorization: required("authorize") });
  process.stdout.write(`${JSON.stringify({ schema: "agentic-admitted-published-descendant-dirty-recovery-result/v1",
    ok: true, mode, status: mode === "plan" ? "planned" : "complete", result }, null, json ? 2 : 0)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ schema: "agentic-admitted-published-descendant-dirty-recovery-result/v1",
      ok: false, mode: mode || null, status: "error", error: { message: error.message } })}\n`);
    process.exitCode = 1;
  }
}
function privateFile(value, repository) { const target = path.resolve(value); const metadata = lstatSync(target);
  if (target.startsWith(`${repository}${path.sep}`) || !metadata.isFile() || metadata.isSymbolicLink()
    || (metadata.mode & 0o077) !== 0) throw new Error("External inputs must be private regular files."); return target; }
function isMain() { return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); }
if (isMain()) await main();
