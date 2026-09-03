import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestValue } from "./product-contract-primitives.mjs";
import { loadAgenticOsModule } from "./pr825-retained-authority-record.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SUCCESSOR_COORDINATE =
  "17cf6632dc3c951d4600325e79dada1ac05b318b84a8bdf9931b27cb3daa5b15";
const SUCCESSOR_AUTHORITY_REF = `refs/remotes/origin/adlc/authority/${SUCCESSOR_COORDINATE}`;
const SUCCESSOR_AUTHORITY_HEAD_REF = `refs/heads/adlc/authority/${SUCCESSOR_COORDINATE}`;
const SUCCESSOR_EVIDENCE_PATH = `.agentic-os/authority/transitions/${SUCCESSOR_COORDINATE}.json`;

export const PR825_SUCCESSOR_INTEGRATION_RECEIPT_SCHEMA =
  "agentic-canvas-os/pr825-successor-integration-receipt/v1";

function fail(message) {
  throw new Error(message);
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function tryGit(cwd, args) {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

function readGitHubToken(repoRoot) {
  const direct = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;
  if (typeof direct === "string" && direct.length > 0) return direct;
  try {
    return execFileSync("gh", ["auth", "token"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch (error) {
    fail(`PR825 successor integration receipt could not resolve a GitHub token: ${error.message}`);
  }
}

function ensureSuccessorAuthorityRef(repoRoot) {
  if (tryGit(repoRoot, ["rev-parse", "--verify", `${SUCCESSOR_AUTHORITY_REF}^{commit}`])) {
    return SUCCESSOR_AUTHORITY_REF;
  }
  try {
    git(repoRoot, [
      "fetch",
      "--no-tags",
      "origin",
      `${SUCCESSOR_AUTHORITY_HEAD_REF}:${SUCCESSOR_AUTHORITY_REF}`,
    ]);
  } catch (error) {
    fail(
      `PR825 successor authority ref is unavailable locally and exact fetch failed: ${error.message}`,
    );
  }
  if (!tryGit(repoRoot, ["rev-parse", "--verify", `${SUCCESSOR_AUTHORITY_REF}^{commit}`])) {
    fail(`PR825 successor authority ref is still unavailable after fetching ${SUCCESSOR_AUTHORITY_HEAD_REF}.`);
  }
  return SUCCESSOR_AUTHORITY_REF;
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

export async function readPr825SuccessorStoredTransition({
  repoRoot = REPO_ROOT,
} = {}) {
  const transitionClient = await loadAgenticOsModule("github-transition-client.mjs", { repoRoot });
  const authorityRef = ensureSuccessorAuthorityRef(repoRoot);
  const raw = git(repoRoot, ["show", `${authorityRef}:${SUCCESSOR_EVIDENCE_PATH}`]);
  return transitionClient.validateGitHubStoredTransition(JSON.parse(raw));
}

export async function readPr825SuccessorIntegrationReceipt({
  repoRoot = REPO_ROOT,
} = {}) {
  const [completion, transitionAuthority, storedTransition] = await Promise.all([
    loadAgenticOsModule("completion.mjs", { repoRoot }),
    loadAgenticOsModule("github-transition-authority.mjs", { repoRoot }),
    readPr825SuccessorStoredTransition({ repoRoot }),
  ]);
  const verifier = transitionAuthority.createGitHubTransitionAuthorityVerifier({
    repository: storedTransition.authorityRepository,
    targetRepository: storedTransition.targetRepository,
    operationInput: storedTransition.operationInput,
    workflowRun: storedTransition.workflowRun,
    policy: storedTransition.policy,
    providerProof: storedTransition.providerProof,
    token: readGitHubToken(repoRoot),
  });
  const receipt = await completion.replayAuthenticatedTransitionOperationReceipt(
    {
      request: storedTransition.operationInput.request,
      planBytes: completion.encodeEffectPlan(storedTransition.operationInput.plan),
    },
    verifier,
  );
  const core = {
    schema: PR825_SUCCESSOR_INTEGRATION_RECEIPT_SCHEMA,
    coordinate: storedTransition.coordinate,
    authorityRef: SUCCESSOR_AUTHORITY_REF,
    evidencePath: SUCCESSOR_EVIDENCE_PATH,
    storedTransitionDigest: storedTransition.storedDigest,
    operationInputDigest: storedTransition.operationInputDigest,
    requestDigest: storedTransition.operationInput.request.requestDigest,
    planByteDigest: storedTransition.operationInput.planByteDigest,
    providerProofDigest: storedTransition.providerProofDigest,
    publicationDigest: receipt.authorityOperation.operationReceiptDigest,
    sourcePublishedAt: receipt.authorityOperation.transitionedAt,
    sourceExpiresAt: receipt.authorityOperation.expiresAt,
    storedTransition: freeze(storedTransition),
    receipt: freeze(receipt),
  };
  return freeze({
    ...core,
    recordDigest: digestValue(core),
  });
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--json")) {
    fail("usage: node ./scripts/pr825-successor-integration-receipt.mjs [--json]");
  }
  const record = await readPr825SuccessorIntegrationReceipt();
  if (argv[0] === "--json") {
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `PR 825 successor integration receipt: ${record.recordDigest}`,
      `coordinate: ${record.coordinate}`,
      `receipt: ${record.receipt.receiptDigest}`,
      `publication digest: ${record.publicationDigest}`,
    ].join("\n"),
  );
  process.stdout.write("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
