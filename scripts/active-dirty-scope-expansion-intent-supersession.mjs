#!/usr/bin/env node
// Responsibility: Expose read-only planning and exact-authorized barrier-then-archive-clear.
import { createActiveDirtyScopeExpansionIntentSupersessionRepositoryController }
  from "./active-dirty-scope-expansion-intent-supersession-repository-adapter.mjs";

const [command, ...tokens] = process.argv.slice(2);
const options = parse(tokens);
if (!["plan", "run"].includes(command)) usage();

try {
  const controller =
    createActiveDirtyScopeExpansionIntentSupersessionRepositoryController({
      sourceRepository: options.sourceRepository,
      controllerRoot: options.controllerRoot,
      sessionId: options.session,
      pullRequestNumber: Number(options.pullRequest),
      targetManifestPath: options.targetManifest,
      targetRepository: options.targetRepository,
      ledgerRepository: options.ledgerRepository,
      taskAuthorityFile: options.taskAuthority,
    });
  const result = command === "plan"
    ? await controller.plan()
    : await controller.run({
      planDigest: options.planDigest,
      authorization: options.authorize,
    });
  process.stdout.write(`${JSON.stringify(result, null, options.json ? 2 : 0)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}

function parse(values) {
  const parsed = {};
  for (const value of values) {
    if (value === "--json") {
      parsed.json = true;
      continue;
    }
    const match = /^--([a-z-]+)=(.*)$/u.exec(value);
    if (!match) usage();
    parsed[match[1].replace(/-([a-z])/gu, (_whole, letter) => letter.toUpperCase())]
      = match[2];
  }
  return parsed;
}

function usage() {
  process.stderr.write([
    "Usage: active-dirty-scope-expansion-intent-supersession.mjs <plan|run>",
    "(run creates one force-false identical-tree coordination-ledger barrier before local clear)",
    "--source-repository=<dirty-worktree>",
    "--session=<source-session>",
    "--pull-request=<number>",
    "--target-manifest=<expanded-write-scope.json>",
    "--target-repository=<owner/repository>",
    "[--ledger-repository=<owner/repository>]",
    "[--controller-root=<clean-protected-main>]",
    "[--task-authority=<source-capability.json>]",
    "[--plan-digest=<sha256>]",
    "[--authorize=<exact-statement>]",
    "[--json]",
  ].join(" ") + "\n");
  process.exit(1);
}
