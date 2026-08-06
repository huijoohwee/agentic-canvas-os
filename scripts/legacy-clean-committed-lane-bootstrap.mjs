#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  bootstrapLegacyCleanCommittedLane,
  LegacyBootstrapBlockedError,
} from "./legacy-clean-committed-lane-bootstrap-lib.mjs";

try {
  const options = parseArguments(process.argv.slice(2));
  const request = JSON.parse(await readFile(options.requestPath, "utf8"));
  const adapterModule = await import(pathToFileURL(options.adapterPath));
  if (typeof adapterModule.createLegacyBootstrapAdapter !== "function") {
    throw new Error("Adapter module must export createLegacyBootstrapAdapter().");
  }
  const adapter = await adapterModule.createLegacyBootstrapAdapter({
    requestPath: options.requestPath,
  });
  const result = await bootstrapLegacyCleanCommittedLane(request, { adapter });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const blocked = error instanceof LegacyBootstrapBlockedError;
  process.stderr.write(`${JSON.stringify({
    schema: "agentic-legacy-clean-committed-lane-bootstrap-error/v1",
    status: "blocked",
    code: blocked ? error.code : "bootstrap_failed",
    message: error.message,
  })}\n`);
  process.exitCode = blocked ? 1 : 2;
}

function parseArguments(argumentsList) {
  const values = Object.fromEntries(argumentsList.map(argument => {
    const match = argument.match(/^--([^=]+)=(.+)$/u);
    if (!match) throw new Error(`Unsupported argument: ${argument}`);
    return [match[1], match[2]];
  }));
  if (!values.request || !values.adapter) {
    throw new Error("Usage: legacy-lane:bootstrap -- --request=<json> --adapter=<module.mjs>");
  }
  return {
    requestPath: path.resolve(values.request),
    adapterPath: path.resolve(values.adapter),
  };
}
