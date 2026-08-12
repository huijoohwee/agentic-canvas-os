#!/usr/bin/env node
// Responsibility: Terminalize one exact planned owner after provider-first cloud retirement.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { isRetiredAdmissionOwnerLane } from "./scoped-lane-bootstrap-maintenance.mjs";
import { assertRootSourceBootstrapCurrent } from "./scoped-lane-bootstrap-authorization.mjs";
import { verifyAdmissionCloudAuthority } from "./scoped-lane-cloud-authority.mjs";
import { collectScopedLaneState } from "./scoped-lane-admission-state.mjs";
import {
  buildRetiredPlannedAdmissionOwnerReceipt,
  isRetiredPlannedAdmissionOwnerLane,
} from "./retired-planned-admission-owner-lib.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";

const argumentsList = process.argv.slice(2);
const json = argumentsList.includes("--json");

try {
  const candidateRepository = path.resolve(requiredOption("repository"));
  const sourcePath = path.resolve(requiredOption("source-worktree"));
  const sourceSession = requiredOption("source-session");
  const candidateSession = requiredOption("candidate-session");
  const expectedSourceHead = requiredSha(requiredOption("expected-source-head"), "source head");
  const expectedSourceClaim = requiredDigest(requiredOption("expected-source-claim"), "source claim");
  const report = readJson(requiredOption("admission-report"));
  const result = retirePlannedAdmissionOwner({
    candidateRepository,
    sourcePath,
    sourceSession,
    candidateSession,
    expectedSourceHead,
    expectedSourceClaim,
    report,
  });
  process.stdout.write(`${JSON.stringify(result, null, json ? 0 : 2)}\n`);
} catch (error) {
  if (!json) throw error;
  process.stdout.write(`${JSON.stringify({
    schema: "agentic-retired-planned-admission-owner-result/v1",
    ok: false,
    status: "error",
    error: { message: String(error?.message || error).slice(0, 500) },
  })}\n`);
  process.exitCode = 1;
}

export function retirePlannedAdmissionOwner({
  candidateRepository,
  sourcePath,
  sourceSession,
  candidateSession,
  expectedSourceHead,
  expectedSourceClaim,
  report,
  now = () => new Date(),
}) {
  const candidateRoot = git(candidateRepository, ["rev-parse", "--show-toplevel"]);
  const candidateBranch = git(candidateRoot, ["branch", "--show-current"]);
  const commonDirectory = resolveCommonDirectory(candidateRoot);
  const leaseStore = createWriterLeaseStore({ gitCommonDir: commonDirectory });
  const candidateLease = leaseStore.verify({ sessionId: candidateSession, branch: candidateBranch });
  const verified = verifyAdmissionCloudAuthority({
    authority: candidateLease.cloudAuthority,
    manifest: candidateLease.admission,
    canonicalBaseSha: candidateLease.baseSha,
  });
  assertRootSourceBootstrapCurrent({ report, remoteAuthorityVerification: verified.verification });
  if (report.rootSourceBootstrapAuthorization?.operatorDecision?.authorizationToken
    !== "AUTHORIZE ROOT-SOURCE BOOTSTRAP EXCEPTION") {
    throw new Error("Retirement requires the exact root-source bootstrap operator decision.");
  }
  const first = collectScopedLaneState({ repository: candidateRoot });
  const second = collectScopedLaneState({ repository: candidateRoot });
  const source = second.lanes.find(lane => path.resolve(lane.path) === sourcePath);
  const firstSource = first.lanes.find(lane => path.resolve(lane.path) === sourcePath);
  if (!source || !firstSource || digestValue(source) !== digestValue(firstSource)) {
    throw new Error("Source owner changed during retirement inspection.");
  }
  const preserved = report.rootSourceBootstrapAuthorization.preservedLanes
    .find(item => path.resolve(item.path) === sourcePath);
  if (!preserved || preserved.stateDigest !== source.stateDigest
    || source.head !== expectedSourceHead || source.dirty
    || source.lease?.sessionId !== sourceSession
    || source.lease?.cloudAuthority?.claimId !== expectedSourceClaim
    || !isRetiredAdmissionOwnerLane({
      lane: source,
      lanePath: sourcePath,
      branch: source.branch,
      targetRepository: candidateLease.cloudAuthority.targetRepository,
    })) {
    throw new Error("Source is not the exact bootstrap-preserved retired admission owner.");
  }
  if (verified.verification.inventory.claims.some(claim => claim.claimId === expectedSourceClaim)) {
    throw new Error("Source cloud claim still reserves authority.");
  }
  const sourceBranch = source.lease.branch;
  const remoteHeadSha = remoteBranchHead(sourcePath, sourceBranch);
  if (remoteHeadSha !== source.lease.fenceSha || source.head === source.lease.fenceSha) {
    throw new Error("Source must preserve one clean committed descendant above its remote fence.");
  }
  execFileSync("git", ["-C", sourcePath, "merge-base", "--is-ancestor", source.lease.fenceSha, source.head]);
  const provider = readPullRequest(source.lease.pullRequestUrl);
  if (provider.headBranch !== sourceBranch || provider.headSha !== remoteHeadSha) {
    throw new Error("Closed pull request no longer preserves the source remote fence.");
  }
  const retiredAt = now().toISOString();
  const receipt = buildRetiredPlannedAdmissionOwnerReceipt({
    authorizationDigest: report.rootSourceBootstrapAuthorization.authorizationDigest,
    source: { ...source, lease: source.lease, remoteHeadSha },
    candidate: {
      claimId: candidateLease.cloudAuthority.claimId,
      branch: candidateBranch,
      sessionId: candidateSession,
      admissionReceiptDigest: candidateLease.admission.admissionReceiptDigest,
    },
    cloud: {
      ledgerRevision: verified.verification.ledgerRevision,
      ledgerDigest: verified.verification.ledgerDigest,
      verificationReceiptDigest: verified.verification.receiptDigest,
      sourceClaimId: expectedSourceClaim,
      sourceClaimAbsent: true,
    },
    provider,
    retiredAt,
  });
  const released = leaseStore.release({
    sessionId: sourceSession,
    branch: sourceBranch,
    expectedLease: source.lease,
    status: "released",
    timestamp: retiredAt,
    values: { admission: null, cloudAuthority: null, admissionOwnerRetirement: receipt },
  });
  const final = collectScopedLaneState({ repository: candidateRoot }).lanes
    .find(lane => path.resolve(lane.path) === sourcePath);
  if (!final || digestValue(final.lease) !== digestValue(released)
    || !isRetiredPlannedAdmissionOwnerLane({ lane: final })) {
    throw new Error("Released source did not reach retired-preserved state.");
  }
  return Object.freeze({
    schema: "agentic-retired-planned-admission-owner-result/v1",
    ok: true,
    status: "retired-preserved",
    sourceHead: source.head,
    sourceBranch,
    receiptDigest: receipt.receiptDigest,
    deployment: false,
  });
}

function readPullRequest(reference) {
  const value = JSON.parse(execFileSync("gh", ["pr", "view", reference, "--json",
    "url,number,state,isDraft,mergedAt,closedAt,headRefName,headRefOid,baseRefName,baseRefOid"],
  { encoding: "utf8" }));
  return {
    url: value.url,
    number: value.number,
    state: value.state,
    draft: value.isDraft,
    mergedAt: value.mergedAt,
    closedAt: value.closedAt,
    headBranch: value.headRefName,
    headSha: value.headRefOid,
    baseBranch: value.baseRefName,
    baseSha: value.baseRefOid,
  };
}
function remoteBranchHead(repository, branch) {
  const output = execFileSync("git", ["-C", repository, "ls-remote", "--heads", "origin", branch],
    { encoding: "utf8" }).trim();
  const lines = output.split("\n").filter(Boolean);
  if (lines.length !== 1) throw new Error("Source remote branch is missing or ambiguous.");
  return requiredSha(lines[0].split(/\s+/u)[0], "source remote head");
}
function resolveCommonDirectory(repository) {
  const value = git(repository, ["rev-parse", "--git-common-dir"]);
  return path.isAbsolute(value) ? value : path.resolve(repository, value);
}
function git(repository, args) {
  return execFileSync("git", ["-C", repository, ...args], { encoding: "utf8" }).trim();
}
function readJson(file) { return JSON.parse(readFileSync(path.resolve(file), "utf8")); }
function requiredOption(name) {
  const prefix = `--${name}=`;
  const value = argumentsList.find(item => item.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`--${name}=<value> is required.`);
  return value;
}
function requiredSha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) throw new Error(`${label} is invalid.`);
  return value;
}
function requiredDigest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) throw new Error(`${label} is invalid.`);
  return value;
}
