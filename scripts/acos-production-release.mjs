#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { executeAcosProductionRelease } from "./acos-production-release-controller.mjs";
import { readProductionCandidate } from "./acos-production-release-contract.mjs";
import {
  createCandidateFromProtectedMain,
  createLiveReleaseAdapters,
} from "./acos-production-release-live.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || typeof process.argv[index + 1] !== "string") throw new TypeError(`${name} is required.`);
  return path.resolve(process.argv[index + 1]);
}

async function readBoundedCandidate(candidatePath) {
  const text = await readFile(candidatePath, "utf8");
  if (Buffer.byteLength(text) > 65_536) throw new RangeError("Candidate evidence is oversized.");
  const candidate = readProductionCandidate(JSON.parse(text));
  if (!candidate) throw new TypeError("Candidate evidence is malformed or digest-drifted.");
  return candidate;
}

async function main() {
  const command = process.argv[2];
  if (command === "prepare") {
    const outputPath = option("--output");
    const candidate = await createCandidateFromProtectedMain({ repositoryRoot: REPOSITORY_ROOT });
    const expectedDigest = process.env.ACOS_EXPECTED_CANDIDATE_DIGEST;
    if (expectedDigest && expectedDigest !== candidate.candidateDigest) {
      throw new TypeError("Requested candidate digest does not match protected-main source.");
    }
    await writeFile(outputPath, `${JSON.stringify(candidate, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    console.log(JSON.stringify({ status: "candidate-sealed", candidateDigest: candidate.candidateDigest }));
    return;
  }
  if (command === "release") {
    const candidatePath = option("--candidate");
    const receiptPath = option("--receipt");
    const candidate = await readBoundedCandidate(candidatePath);
    const receipt = await executeAcosProductionRelease({
      candidate,
      adapters: createLiveReleaseAdapters({ repositoryRoot: REPOSITORY_ROOT }),
    });
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    console.log(JSON.stringify({ status: receipt.status, receiptDigest: receipt.receiptDigest }));
    if (receipt.status !== "deployed") process.exitCode = 2;
    return;
  }
  throw new TypeError("Usage: acos-production-release.mjs <prepare|release> ...");
}

await main();
