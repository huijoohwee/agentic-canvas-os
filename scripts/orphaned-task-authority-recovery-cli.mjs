#!/usr/bin/env node
// Responsibility: Expose path-redacted, always-JSON planning and exact-authority execution.
import { pathToFileURL } from "node:url";

import {
  planOrphanedTaskAuthorityRecovery,
  runOrphanedTaskAuthorityRecovery,
} from "./orphaned-task-authority-recovery-controller.mjs";
import { createOrphanedTaskAuthorityRecoveryRepositoryAdapter }
  from "./orphaned-task-authority-recovery-repository-adapter.mjs";
import {
  createOrphanedTaskAuthorityRecoveryJournalStore,
  readOrphanedTaskAuthorityRecoveryPlan,
  writeOrphanedTaskAuthorityRecoveryPlan,
} from "./orphaned-task-authority-recovery-store.mjs";

const OPTIONS = new Set([
  "authorize", "branch", "incident-reference", "loss-attestation-digest",
  "output", "plan", "repository", "state", "target-capability",
]);

export async function main(argumentsList = process.argv.slice(2), dependencies = {}) {
  const [command, ...tail] = argumentsList;
  if (!new Set(["plan", "run"]).has(command)) throw new Error(usage());
  const options = parseOptions(tail);
  const repository = required(options, "repository");
  const branch = required(options, "branch");
  const targetCapabilityPath = required(options, "target-capability");
  const adapter = (dependencies.createAdapter
    || createOrphanedTaskAuthorityRecoveryRepositoryAdapter)({
    repository,
    branch,
    targetCapabilityPath,
  }, dependencies.adapterDependencies || {});

  if (command === "plan") {
    forbid(options, ["authorize", "plan", "state"], "plan");
    const plan = await planOrphanedTaskAuthorityRecovery({
      incidentReference: required(options, "incident-reference"),
      lossAttestationDigest: required(options, "loss-attestation-digest"),
    }, { adapter });
    writeOrphanedTaskAuthorityRecoveryPlan({
      repository,
      outputPath: required(options, "output"),
      plan,
    });
    return Object.freeze({
      schema: "agentic-orphaned-task-authority-recovery-cli-result/v1",
      status: "planned",
      planDigest: plan.planDigest,
      exactAuthorization: plan.exactAuthorization,
      branch: plan.source.branch,
      sourceBindingDigest: plan.source.taskAuthority.bindingDigest,
      targetSubjectId: plan.targetCapability.authoritySubjectId,
      sourceBytesChanged: false,
      cloudMutated: false,
      merged: false,
      deployed: false,
    });
  }

  forbid(options, ["incident-reference", "loss-attestation-digest", "output"], "run");
  const plan = readOrphanedTaskAuthorityRecoveryPlan({
    repository,
    planPath: required(options, "plan"),
  });
  if (plan.source.branch !== branch) {
    throw new Error("Recovery plan belongs to another branch.");
  }
  const journalStore = (dependencies.createJournalStore
    || createOrphanedTaskAuthorityRecoveryJournalStore)({
    repository,
    statePath: required(options, "state"),
  });
  return journalStore.withLock(() => runOrphanedTaskAuthorityRecovery({
    plan,
    authorization: required(options, "authorize"),
  }, { adapter, journalStore }));
}

export async function runCli(argumentsList = process.argv.slice(2)) {
  try {
    console.log(JSON.stringify(await main(argumentsList)));
    return 0;
  } catch (error) {
    console.log(JSON.stringify({
      schema: "agentic-orphaned-task-authority-recovery-cli-result/v1",
      status: "blocked",
      error: publicMessage(error),
    }));
    return 1;
  }
}

function parseOptions(argumentsList) {
  const values = new Map();
  for (const argument of argumentsList) {
    const match = argument.match(/^--([a-z0-9-]+)=(.*)$/u);
    if (!match || !OPTIONS.has(match[1])) throw new Error(`Unsupported option: ${argument}`);
    if (values.has(match[1])) throw new Error(`--${match[1]} must be provided once.`);
    if (!match[2]) throw new Error(`--${match[1]} requires a value.`);
    values.set(match[1], match[2]);
  }
  return values;
}
function required(options, name) {
  const value = options.get(name);
  if (!value) throw new Error(`--${name}=<value> is required.`);
  return value;
}
function forbid(options, names, command) {
  const supplied = names.find(name => options.has(name));
  if (supplied) throw new Error(`${command} does not accept --${supplied}.`);
}
function publicMessage(error) {
  return String(error?.message || error || "blocked")
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/\/[A-Za-z0-9._@%+,:=~-]+(?:\/[A-Za-z0-9._@%+,:=~-]+)+/gu, "[path]")
    .slice(0, 1_000);
}
function usage() {
  return "Usage: orphaned-task-authority-recovery-cli.mjs plan|run "
    + "--repository=<worktree> --branch=<agent branch> --target-capability=<external file> "
    + "[--incident-reference=<reference> --loss-attestation-digest=<sha256> "
    + "--output=<external plan>] [--plan=<external plan> --state=<external journal> "
    + "--authorize=<exact statement>]";
}

const isEntrypoint = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntrypoint) process.exitCode = await runCli();
