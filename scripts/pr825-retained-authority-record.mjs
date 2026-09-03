import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PR825_RETAINED_AUTHORITY = Object.freeze({
  reviewLocator: "https://github.com/huijoohwee/agentic-canvas-os/pull/825",
  authorityRef:
    "refs/remotes/origin/adlc/authority/592053e6f976f55757177e686ceacb0cc6a8ba3be7846a8de10ec51d3f5fdfff",
  evidencePath:
    "authority-evidence/592053e6f976f55757177e686ceacb0cc6a8ba3be7846a8de10ec51d3f5fdfff.json",
  branch: "agent/katrinas-macbook-pro.local/active-dirt-marker-replay-order",
  baseSha: "c49dfb670ab3f2863d06098e45c742b68b1b13be",
  headSha: "c16dee29507a26cb0c8b2e8e6f9b9d80204e4a57",
  mergeSha: "ed7461e5b272da1cba4cd31c079e12259965eaf1",
});

const RECORD_SCHEMA = "agentic-canvas-os/pr825-retained-authority-record/v1";
const DIGEST = /^[0-9a-f]{64}$/u;
const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const AUTHORITY_HEAD_REF = PR825_RETAINED_AUTHORITY.authorityRef.replace(
  "refs/remotes/origin/",
  "refs/heads/",
);

function fail(message) {
  throw new Error(message);
}

function git(cwd, args) {
  return String(
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  ).trim();
}

function tryGit(cwd, args) {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function resolveAgenticOsModule(modulePath, { repoRoot = REPO_ROOT } = {}) {
  const candidates = [];
  for (let current = repoRoot; ; current = path.dirname(current)) {
    candidates.push(path.join(current, "agentic-os", "src", modulePath));
    const parent = path.dirname(current);
    if (parent === current) break;
  }
  candidates.push(path.join(repoRoot, "node_modules", "agentic-os", "src", modulePath));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  fail(`Could not resolve agentic-os module ${modulePath}.`);
}

export async function loadAgenticOsModule(modulePath, options = {}) {
  return import(pathToFileURL(resolveAgenticOsModule(modulePath, options)).href);
}

export async function loadAuthorityIssuerModule(options = {}) {
  return loadAgenticOsModule("github-authority-issuer.mjs", options);
}

function ensurePr825AuthorityRef(repoRoot) {
  if (tryGit(repoRoot, ["rev-parse", "--verify", `${PR825_RETAINED_AUTHORITY.authorityRef}^{commit}`])) {
    return PR825_RETAINED_AUTHORITY.authorityRef;
  }
  try {
    git(repoRoot, [
      "fetch",
      "--no-tags",
      "origin",
      `${AUTHORITY_HEAD_REF}:${PR825_RETAINED_AUTHORITY.authorityRef}`,
    ]);
  } catch (error) {
    fail(
      `PR825 retained authority ref is unavailable locally and exact fetch failed: ${error.message}`,
    );
  }
  if (!tryGit(repoRoot, ["rev-parse", "--verify", `${PR825_RETAINED_AUTHORITY.authorityRef}^{commit}`])) {
    fail(`PR825 retained authority ref is still unavailable after fetching ${AUTHORITY_HEAD_REF}.`);
  }
  return PR825_RETAINED_AUTHORITY.authorityRef;
}

export async function readPr825RetainedAuthorityIssuance({
  repoRoot = REPO_ROOT,
} = {}) {
  const {
    createGitHubAuthorityIssuance,
    createGitHubPublicationReceipt,
    validateGitHubStoredAuthorityBundle,
  } = await loadAuthorityIssuerModule({ repoRoot });
  const authorityRef = ensurePr825AuthorityRef(repoRoot);

  const storedBundle = validateGitHubStoredAuthorityBundle(
    JSON.parse(
      git(repoRoot, ["show", `${authorityRef}:${PR825_RETAINED_AUTHORITY.evidencePath}`]),
    ),
  );
  const request = storedBundle.authorityBundle.request;
  const candidate = storedBundle.authorityBundle.candidate;
  const review = storedBundle.targetRepository.review;
  const retrospectiveProof = storedBundle.targetRepository.retrospectiveProof;
  if (request.reviewLocator !== PR825_RETAINED_AUTHORITY.reviewLocator) {
    fail(`PR825 retained authority review mismatch: ${request.reviewLocator}`);
  }
  if (candidate.branch !== PR825_RETAINED_AUTHORITY.branch) {
    fail(`PR825 retained authority branch mismatch: ${candidate.branch}`);
  }
  if (candidate.canonicalRevision !== PR825_RETAINED_AUTHORITY.baseSha) {
    fail(`PR825 retained authority base mismatch: ${candidate.canonicalRevision}`);
  }
  if (candidate.headRevision !== PR825_RETAINED_AUTHORITY.headSha) {
    fail(`PR825 retained authority head mismatch: ${candidate.headRevision}`);
  }
  if (retrospectiveProof?.mergeRevision !== PR825_RETAINED_AUTHORITY.mergeSha) {
    fail(
      `PR825 retained authority merge mismatch: ${retrospectiveProof?.mergeRevision ?? "missing"}`,
    );
  }

  const [publicationRevision, parentRevision, committedAt] = git(repoRoot, [
    "show",
    "--no-patch",
    "--format=%H%n%P%n%cI",
    authorityRef,
  ]).split("\n");

  const publicationReceipt = createGitHubPublicationReceipt({
    storedBundle,
    publication: {
      repository: storedBundle.authorityBundle.policy.evidenceRepository,
      ref: storedBundle.authorityBundle.evidenceRef,
      path: storedBundle.authorityBundle.evidencePath,
      revision: publicationRevision,
      parentRevision,
      committedAt: new Date(committedAt).toISOString(),
      storedDigest: storedBundle.storedDigest,
    },
    postProtection: clone(storedBundle.preProtection),
  });
  const issuance = createGitHubAuthorityIssuance({ storedBundle, publicationReceipt });
  return Object.freeze({ storedBundle, publicationReceipt, issuance });
}

export async function readPr825RetainedAuthorityRecord({
  repoRoot = REPO_ROOT,
  now = () => new Date(),
} = {}) {
  const { storedBundle, issuance } = await readPr825RetainedAuthorityIssuance({ repoRoot });
  const request = storedBundle.authorityBundle.request;
  const candidate = storedBundle.authorityBundle.candidate;
  const review = storedBundle.targetRepository.review;
  const retrospectiveProof = storedBundle.targetRepository.retrospectiveProof;
  const evaluatedAt = new Date(now()).toISOString();
  const predecessorCommittedAt = issuance.publicationReceipt.committedAt;
  const predecessorExpiresAt = issuance.storedBundle.authorityBundle.challenge.expiresAt;
  const currentStartWindowOpen =
    Date.parse(evaluatedAt) >= Date.parse(predecessorCommittedAt)
    && Date.parse(evaluatedAt) < Date.parse(predecessorExpiresAt);
  const millisecondsPastExpiry = Math.max(
    0,
    Date.parse(evaluatedAt) - Date.parse(predecessorExpiresAt),
  );

  const record = {
    schema: RECORD_SCHEMA,
    reviewLocator: request.reviewLocator,
    authorityRef: PR825_RETAINED_AUTHORITY.authorityRef,
    evidencePath: PR825_RETAINED_AUTHORITY.evidencePath,
    sourceBranch: candidate.branch,
    sourceBaseSha: candidate.canonicalRevision,
    sourceHeadSha: candidate.headRevision,
    protectedMergeSha: retrospectiveProof.mergeRevision,
    authoritySubject: request.authoritySubject,
    claimId: request.claimId,
    leaseEpoch: request.leaseEpoch,
    storedDigest: storedBundle.storedDigest,
    publicationReceiptDigest: issuance.publicationReceipt.receiptDigest,
    transitionReceiptDigest: issuance.transitionReceipt.receiptDigest,
    issuanceDigest: issuance.issuanceDigest,
    predecessorCommittedAt,
    predecessorExpiresAt,
    evaluatedAt,
    retrospectiveRecovery:
      issuance.storedBundle.authorityBundle.challenge.issuanceMode === "retrospective-recovery",
    reviewMerged: review.state === "merged",
    currentStartWindowOpen,
    millisecondsPastExpiry,
  };
  for (const key of ["storedDigest", "publicationReceiptDigest", "transitionReceiptDigest", "issuanceDigest"]) {
    if (!DIGEST.test(record[key])) fail(`${key} must be a sha256 digest.`);
  }
  return Object.freeze(record);
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--json")) {
    fail("usage: node ./scripts/pr825-retained-authority-record.mjs [--json]");
  }
  const record = await readPr825RetainedAuthorityRecord();
  if (argv[0] === "--json") {
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    [
      `PR 825 retained authority ref: ${record.authorityRef}`,
      `review: ${record.reviewLocator}`,
      `issuance: ${record.issuanceDigest}`,
      `window: ${record.predecessorCommittedAt} -> ${record.predecessorExpiresAt}`,
      `startable now: ${record.currentStartWindowOpen ? "yes" : "no"}`,
      `milliseconds past expiry: ${record.millisecondsPastExpiry}`,
    ].join("\n"),
  );
  process.stdout.write("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
