#!/usr/bin/env node
// Responsibility: Record real paired-writer trials against one protected resource.
import { spawn } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [command, ...argumentsList] = process.argv.slice(2);
const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect && command === "run") {
  try {
    const options = parseOptions(argumentsList);
    const result = await runTrial(options);
    await writeFile(path.resolve(required(options.out, "--out")), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    process.stdout.write(`${JSON.stringify({ status: "ok", trialId: result.trialId, runs: result.runs.length })}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
} else if (isDirect) {
  process.stderr.write("Usage: teardown-concurrency-trial.mjs run --trial-id=<id> --entry=<inventory-path> --worktree-a=<path> --worktree-b=<path> --writer=<script> --resource=<path> --out=<path>\n");
  process.exitCode = 1;
}

export async function runTrial(options, { runsPerMode = 3, now = () => performance.now() } = {}) {
  const trialId = required(options["trial-id"], "--trial-id");
  const writer = path.resolve(required(options.writer, "--writer"));
  const resource = path.resolve(required(options.resource, "--resource"));
  const worktrees = [path.resolve(required(options["worktree-a"], "--worktree-a")), path.resolve(required(options["worktree-b"], "--worktree-b"))];
  const runs = [];
  for (const mechanism of ["active", "bypassed"]) {
    for (let index = 0; index < runsPerMode; index += 1) {
      const starts = [];
      const launch = (cwd, writerId) => {
        starts.push(now());
        return collect(spawn(process.execPath, [writer, `--resource=${resource}`, `--mechanism=${mechanism}`, `--writer=${writerId}`], { cwd, stdio: ["ignore", "pipe", "pipe"] }));
      };
      const [left, right] = await Promise.all([launch(worktrees[0], "A"), launch(worktrees[1], "B")]);
      const resourceState = JSON.stringify(await serializeResource(resource));
      runs.push({
        runIndex: index + 1, mechanism, worktreeA: worktrees[0], worktreeB: worktrees[1],
        startSkewMs: Math.abs(starts[1] - starts[0]),
        exitStatusA: left.exitStatus, exitStatusB: right.exitStatus,
        protectedResourceState: resourceState,
      });
    }
  }
  if (runs.some(run => run.startSkewMs > 5000)) throw new Error("Writer start skew exceeded 5000 ms.");
  const activeRuns = runs.filter(run => run.mechanism === "active");
  const bypassedRuns = runs.filter(run => run.mechanism === "bypassed");
  const activeStates = activeRuns.map(observationKey).sort();
  const bypassedStates = bypassedRuns.map(observationKey).sort();
  const differs = JSON.stringify(activeStates) !== JSON.stringify(bypassedStates);
  return {
    schema: "agentic-teardown-concurrency-trial/v1", trialId,
    entryPath: required(options.entry, "--entry"), resource, runs,
    activeStates, bypassedStates, differs,
    concurrencyGroundForConstrained: differs,
  };
}

function collect(child) { return new Promise(resolve => { let stdout = ""; let stderr = ""; child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; }); child.on("close", exitStatus => resolve({ exitStatus, stdout, stderr })); }); }
function observationKey(run) { return JSON.stringify([run.exitStatusA, run.exitStatusB, run.protectedResourceState]); }
async function serializeResource(resource) { try { const info = await stat(resource); return info.isFile() ? { kind: "file", bytesBase64: (await readFile(resource)).toString("base64") } : { kind: "other", mode: info.mode }; } catch (error) { if (error.code === "ENOENT") return { kind: "absent" }; throw error; } }
export function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const inline = argument.match(/^--([^=]+)=(.*)$/u);
    if (inline) {
      options[inline[1]] = inline[2];
      continue;
    }
    if (!argument.startsWith("--") || index + 1 >= args.length
      || args[index + 1].startsWith("--")) {
      throw new Error(`Unsupported argument ${argument}.`);
    }
    options[argument.slice(2)] = args[index + 1];
    index += 1;
  }
  return options;
}
function required(value, label) { if (!String(value || "").trim()) throw new Error(`${label} is required.`); return String(value); }
