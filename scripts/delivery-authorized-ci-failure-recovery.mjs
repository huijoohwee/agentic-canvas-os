#!/usr/bin/env node

// Responsibility: Expose the exact delivery-authorized CI-failure recovery lifecycle.
import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { sanitizeCloudAuthorityDiagnostic }
  from "./cloud-authority-scope-expansion-lineage-contract.mjs";
import { createDeliveryAuthorizedCiFailureRecoveryController }
  from "./delivery-authorized-ci-failure-recovery-controller.mjs";
import { createRepositoryDeliveryAuthorizedCiFailureRecoveryAdapter }
  from "./delivery-authorized-ci-failure-recovery-repository-adapter.mjs";

export async function runDeliveryAuthorizedCiFailureRecovery({
  mode,
  repository,
  sessionId,
  pullRequestNumber,
  checkRunId,
  authorization = null,
  ttlSeconds = 3_600,
} = {}) {
  if (!["plan", "run"].includes(mode)) {
    throw new Error("Delivery-authorized CI-failure recovery mode must be plan or run.");
  }
  const controller = createDeliveryAuthorizedCiFailureRecoveryController({
    adapter: createRepositoryDeliveryAuthorizedCiFailureRecoveryAdapter({
      repository,
      sessionId,
      pullRequestNumber,
      checkRunId,
      ttlSeconds,
    }),
  });
  return mode === "plan"
    ? controller.plan({ ttlSeconds })
    : controller.run({ authorization, ttlSeconds });
}

function parseArguments(argumentsList) {
  const mode = argumentsList.shift();
  const options = Object.fromEntries(argumentsList.map(argument => {
    const match = argument.match(/^--([^=]+)=(.*)$/u);
    if (!match) throw new Error(`Invalid recovery argument: ${argument}`);
    return [match[1], match[2]];
  }));
  const pullRequestNumber = positiveInteger(options["pull-request"], "pull-request");
  const checkRunId = positiveInteger(options["check-run"], "check-run");
  const ttlSeconds = positiveInteger(options.ttl || 3_600, "ttl");
  if (ttlSeconds < 300 || ttlSeconds > 86_400) {
    throw new Error("ttl must be an integer from 300 through 86400.");
  }
  return {
    mode,
    repository: realpathSync(path.resolve(required(options.repository, "repository"))),
    sessionId: required(options.session, "session"),
    pullRequestNumber,
    checkRunId,
    authorization: options.authorize || null,
    ttlSeconds,
  };
}

function positiveInteger(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return result;
}

function required(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new Error(`${label} is required and whitespace-exact.`);
  }
  return value;
}

async function main() {
  const result = await runDeliveryAuthorizedCiFailureRecovery(
    parseArguments(process.argv.slice(2)),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch(error => {
    process.stderr.write(`${sanitizeCloudAuthorityDiagnostic(error)}\n`);
    process.exitCode = 1;
  });
}
