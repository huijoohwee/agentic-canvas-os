#!/usr/bin/env node

import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { sanitizeCloudAuthorityDiagnostic } from "./cloud-authority-scope-expansion-lineage-contract.mjs";
import { createDeliveryAuthorizedBaseRecoveryController } from "./delivery-authorized-base-recovery-controller.mjs";
import { createRepositoryDeliveryAuthorizedBaseRecoveryAdapter } from "./delivery-authorized-base-recovery-repository-adapter.mjs";

export async function runDeliveryAuthorizedBaseRecovery({
  mode,
  repository,
  sessionId,
  authorization = null,
  ttlSeconds = 3_600,
} = {}) {
  if (!["plan", "run"].includes(mode)) {
    throw new Error("Delivery-authorized base recovery mode must be plan or run.");
  }
  const controller = createDeliveryAuthorizedBaseRecoveryController({
    adapter: createRepositoryDeliveryAuthorizedBaseRecoveryAdapter({
      repository,
      sessionId,
      ttlSeconds,
    }),
  });
  return mode === "plan" ? controller.plan() : controller.run({ authorization });
}

async function main() {
  const result = await runDeliveryAuthorizedBaseRecovery(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function parseArguments(argumentsList) {
  const mode = argumentsList.shift();
  const options = Object.fromEntries(argumentsList.map(argument => {
    const match = argument.match(/^--([^=]+)=(.*)$/u);
    if (!match) throw new Error(`Invalid recovery argument: ${argument}`);
    return [match[1], match[2]];
  }));
  const ttlSeconds = Number(options.ttl || 3_600);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 300 || ttlSeconds > 86_400) {
    throw new Error("ttl must be an integer from 300 through 86400.");
  }
  return {
    mode,
    repository: realpathSync(path.resolve(required(options.repository, "repository"))),
    sessionId: required(options.session, "session"),
    authorization: options.authorize || null,
    ttlSeconds,
  };
}

function required(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new Error(`${label} is required and whitespace-exact.`);
  }
  return value;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch(error => {
    process.stderr.write(`${sanitizeCloudAuthorityDiagnostic(error)}\n`);
    process.exitCode = 1;
  });
}
