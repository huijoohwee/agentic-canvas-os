#!/usr/bin/env node
// Responsibility: Expose read-only planning and exact-authorized stale-intent supersession.
import { createActiveOwnedDirtIntentSupersessionRepositoryController }
  from "./active-owned-dirt-task-authority-intent-supersession-repository-adapter.mjs";

const [command, ...tokens] = process.argv.slice(2);
const options = parse(tokens);
if (!['plan', 'run'].includes(command)) usage();
try {
  const controller = createActiveOwnedDirtIntentSupersessionRepositoryController({
    repository: options.repository,
    sessionId: options.session,
    pullRequestNumber: Number(options.pullRequest),
    authorityRecoveryJournal: options.authorityRecoveryJournal,
    taskAuthorityFile: options.taskAuthority,
  });
  const result = command === "plan"
    ? await controller.plan()
    : await controller.run({ authorization: options.authorization });
  process.stdout.write(`${JSON.stringify(result, null, options.json ? 2 : 0)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}

function parse(values) {
  const result = {};
  for (const value of values) {
    if (value === "--json") { result.json = true; continue; }
    const match = /^--([a-z-]+)=(.*)$/u.exec(value);
    if (!match) usage();
    result[match[1].replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = match[2];
  }
  return result;
}
function usage() {
  process.stderr.write("Usage: active-owned-dirt-task-authority-intent-supersession.mjs <plan|run> --repository=<worktree> --session=<id> --pull-request=<number> --authority-recovery-journal=<path> [--task-authority=<path> --authorization=<statement>] [--json]\n");
  process.exit(1);
}
