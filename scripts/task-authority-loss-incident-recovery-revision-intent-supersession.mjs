#!/usr/bin/env node
// Responsibility: Expose read-only planning and exact-authorized execution for one stale revision-intent supersession.
import {
  createRevisionIntentSupersessionRepositoryController,
} from "./task-authority-loss-incident-recovery-revision-intent-supersession-repository-adapter.mjs";

const [command, ...tokens] = process.argv.slice(2);
const options = parse(tokens);
if (!["plan", "run"].includes(command)) {
  fail("Usage: task-authority-loss-incident-recovery-revision-intent-supersession.mjs <plan|run> --repository=<path> --branch=<name> --session=<id> --pull-request=<number> [--task-authority=<path>] [--authorization=<statement>] [--json]");
}
try {
  const controller = createRevisionIntentSupersessionRepositoryController({
    repository: options.repository,
    branch: options.branch,
    sessionId: options.session,
    pullRequestNumber: Number(options.pullRequest),
    taskAuthorityFile: options.taskAuthority,
  });
  const result = command === "plan"
    ? await controller.plan()
    : await controller.run({ authorization: options.authorization });
  process.stdout.write(`${JSON.stringify(result, null, options.json ? 2 : 0)}\n`);
} catch (error) {
  fail(error.message);
}

function parse(tokens) {
  const result = {};
  for (const token of tokens) {
    if (token === "--json") { result.json = true; continue; }
    const match = /^--([a-z-]+)=(.*)$/u.exec(token);
    if (!match) fail(`Unknown argument: ${token}`);
    result[match[1].replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = match[2];
  }
  return result;
}
function fail(message) { process.stderr.write(`${message}\n`); process.exit(1); }
