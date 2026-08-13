#!/usr/bin/env node
// Responsibility: Expose plan and exact-authorized run commands for completed source-correction fence recovery.
import { createCompletedSourceCorrectionFenceRecoveryRepositoryController } from "./completed-source-correction-fence-recovery-repository-adapter.mjs";

const [command, ...tokens] = process.argv.slice(2);
const options = parse(tokens);
if (!["plan", "run"].includes(command)) fail("Usage: completed-source-correction-fence-recovery.mjs <plan|run> --repository=<path> --source-session=<id> --operator-session=<id> --pull-request=<number> [--task-authority=<path>] [--authorization=<statement>] [--json]");
try {
  const controller = createCompletedSourceCorrectionFenceRecoveryRepositoryController({ repository: options.repository, sourceSessionId: options.sourceSession, operatorSessionId: options.operatorSession, pullRequestNumber: Number(options.pullRequest), taskAuthorityFile: options.taskAuthority, ttlSeconds: options.ttlSeconds ? Number(options.ttlSeconds) : undefined });
  const result = command === "plan"
    ? await controller.plan({ operatorSessionId: options.operatorSession })
    : await controller.run({ operatorSessionId: options.operatorSession, authorization: options.authorization });
  process.stdout.write(`${JSON.stringify(result, null, options.json ? 2 : 0)}\n`);
} catch (error) { fail(error.message); }

function parse(tokens) { const result = {}; for (const token of tokens) { if (token === "--json") { result.json = true; continue; } const match = /^--([a-z-]+)=(.*)$/u.exec(token); if (!match) fail(`Unknown argument: ${token}`); result[match[1].replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = match[2]; } return result; }
function fail(message) { process.stderr.write(`${message}\n`); process.exit(1); }
