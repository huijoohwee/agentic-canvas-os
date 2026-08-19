#!/usr/bin/env node
// Responsibility: Wire orchestration projection inputs, pure transform, document write, and run receipt output.
import path from "node:path";
import { buildProjection } from "./orchestration-projection-controller.mjs";
import { renderProjectionDocument } from "./orchestration-projection-document.mjs";
import { buildRunReceipt } from "./orchestration-projection-evidence.mjs";
import { renderRawReceiptProjection } from "./orchestration-projection-receipt-table.mjs";
import { readAuthoredAxis, readReceiptInputs, resolveRoots, writeProjection, writeRawReceiptProjection } from "./orchestration-projection-repository-adapter.mjs";

if (process.argv[1] && import.meta.url === new URL("file://" + path.resolve(process.argv[1])).href) {
  const result = await runOrchestrationProjection({ argv: process.argv.slice(2), env: process.env });
  process.stdout.write(JSON.stringify(buildRunReceipt(result)) + "\n");
  process.exitCode = result.ok ? 0 : 1;
}

export async function runOrchestrationProjection({ argv = [], env = process.env } = {}) {
  const options = parseArgs(argv);
  const roots = resolveRoots({ env });
  const axis = readAuthoredAxis({ repositoryRoot: roots.repositoryRoot });
  if (!axis.ok) return axis;
  const inputs = readReceiptInputs({ roots, overrides: options.receipts });
  if (!inputs.ok) return inputs;
  const projected = buildProjection({ receipts: inputs.records, stageAxis: axis.stageAxis, stalenessBoundSeconds: axis.stalenessBoundSeconds, authoredDate: axis.authoredDate });
  if (!projected.ok) return projected;
  const text = renderProjectionDocument(projected.value, projected.digest);
  writeProjection({ projectionOutputRoot: roots.projectionOutputRoot, text });
  writeRawReceiptProjection({ projectionOutputRoot: roots.projectionOutputRoot, text: renderRawReceiptProjection(inputs.records) });
  return projected;
}

function parseArgs(argv) {
  const receipts = {};
  for (const arg of argv) {
    const match = String(arg).match(/^--receipt=([^=]+)=(.+)$/u);
    if (match) receipts[match[1]] = path.resolve(match[2]);
  }
  return { receipts };
}
