#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import {
  planReviewedCiRevisionRecovery,
  runReviewedCiRevisionRecovery,
} from "./reviewed-ci-revision-controller.mjs";
import { createReviewedCiRevisionRepositoryAdapter } from "./reviewed-ci-revision-repository-adapter.mjs";
import { createReviewedCiRevisionPullRequestBootstrap } from "./reviewed-ci-revision-contract.mjs";

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const { command, options } = parseArguments(argv);
  const createAdapter = dependencies.createAdapter || createReviewedCiRevisionRepositoryAdapter;
  const adapter = guardInvocation(createAdapter({
    repository: options.repository,
    sessionId: options.session,
    pullRequestNumber: options.pr,
    checkRunId: options["check-run"],
    ttlSeconds: options.ttl,
    minimumMarginSeconds: options["minimum-margin"],
    environment: dependencies.environment || process.env,
  }), { command, options });
  if (command === "plan") {
    const planRecovery = dependencies.planRecovery || planReviewedCiRevisionRecovery;
    const plan = await planRecovery({}, { adapter });
    return {
      schema: "agentic-reviewed-ci-revision-cli-plan/v1",
      plan: publicPlan(plan),
      authorization: `authorize reviewed-ci-revision-recovery ${plan.planDigest}`,
    };
  }
  const runRecovery = dependencies.runRecovery || runReviewedCiRevisionRecovery;
  const result = await runRecovery({ authorization: options.authorize }, { adapter });
  return publicSuccess(result);
}

function publicPlan(plan) {
  const evidence = plan.failureEvidence;
  const bootstrap = createReviewedCiRevisionPullRequestBootstrap(plan);
  return Object.freeze({
    schema: plan.schema,
    strategy: plan.strategy,
    repository: plan.repository,
    pullRequestNumber: plan.pullRequestNumber,
    pullRequestNodeId: plan.pullRequestNodeId,
    canonicalBaseSha: plan.successorCanonicalBaseSha,
    observedProtectedMainSha: plan.observedProtectedMainSha,
    headSha: plan.sourceHeadSha,
    check: Object.freeze({
      id: evidence.checkRunId,
      name: evidence.checkName,
      appId: evidence.appId,
      workflowId: evidence.workflowId,
      workflowPath: evidence.workflowPath,
      runId: evidence.workflowRunId,
      runAttempt: evidence.workflowRunAttempt,
      jobId: evidence.workflowJobId,
      requiredContext: evidence.requiredContext,
      requiredContextAppId: evidence.requiredContextAppId,
    }),
    failureEvidenceDigest: plan.failureEvidenceDigest,
    manifestDigest: plan.manifestDigest,
    writeSetDigest: plan.writeSetDigest,
    sourceVerifiedAt: plan.sourceVerifiedAt,
    sourceExpiresAt: plan.sourceExpiresAt,
    minimumMarginSeconds: plan.minimumMarginSeconds,
    providerPolicy: Object.freeze({
      sourcePullRequest: Object.freeze({
        disposition: "close-unmerged-and-preserve",
        number: plan.pullRequestNumber,
        nodeId: plan.pullRequestNodeId,
        url: plan.pullRequestUrl,
        requiredFinalState: "CLOSED",
        merged: false,
      }),
      replacementPullRequest: Object.freeze({
        disposition: "create-one-distinct-open-draft",
        repository: plan.repository,
        branch: plan.sourceBranch,
        headSha: plan.sourceHeadSha,
        baseSha: plan.observedProtectedMainSha,
        title: bootstrap.title,
        bodyDigest: bootstrap.bodyDigest,
        recoveryNonce: plan.replacementNonce,
        backlink: plan.pullRequestUrl,
        carryOver: Object.freeze({ reviews: false, labels: false, autoMerge: false, mergeQueue: false }),
      }),
      terminalProjection: Object.freeze({
        localPullRequestUrl: "replace-with-provider-assigned-replacement-url",
        sourceBytesChanged: false,
        commit: false,
        push: false,
        merge: false,
      }),
      basePolicy: Object.freeze({
        sourceCloudCanonicalBaseSha: plan.sourceBaseSha,
        replacementProtectedMainSha: plan.observedProtectedMainSha,
        ancestryReceiptDigest: plan.protectedMainAdvanceDigest,
        ancestryHopCount: plan.protectedMainAdvance.ancestryPath.length,
        unchangedHeadSha: plan.sourceHeadSha,
        boundedAncestryProofRequired: true,
        silentRebase: false,
        headMutation: false,
      }),
    }),
    planDigest: plan.planDigest,
  });
}

function guardInvocation(adapter, { command, options }) {
  return Object.freeze({ ...adapter, async readState() {
    const state = await adapter.readState();
    const plan = state.intent?.planSnapshot || state.archive?.intentSnapshot?.planSnapshot || null;
    const pullRequestNumber = plan?.pullRequestNumber ?? state.source?.failureEvidence?.pullRequestNumber;
    const checkRunId = plan?.failureEvidence?.checkRunId ?? state.source?.failureEvidence?.checkRunId;
    if (Number(options.pr) !== pullRequestNumber || Number(options["check-run"]) !== checkRunId) {
      throw new Error("CLI PR/check-run identity differs from the stored or observed recovery subject.");
    }
    if (command === "execute" && plan) {
      const expected = `authorize reviewed-ci-revision-recovery ${plan.planDigest}`;
      if (String(options.authorize || "").trim() !== expected) {
        throw new Error("Stored recovery replay requires its exact plan authorization.");
      }
    }
    return state;
  } });
}

function publicSuccess(result) {
  if (result?.status === "aborted-delivery-won") return Object.freeze({
    schema: "agentic-reviewed-ci-revision-cli-result/v1", status: result.status,
    planDigest: requiredDigest(result.planDigest, "plan digest"),
    sourceClaimId: requiredDigest(result.sourceClaimId, "source claim ID"),
    deliveryReceiptDigest: requiredDigest(result.deliveryReceiptDigest, "delivery receipt digest"),
    cleanupReceiptDigest: requiredDigest(result.cleanupReceiptDigest, "cleanup receipt digest"),
    abortReceiptDigest: requiredDigest(result.abortReceiptDigest, "abort receipt digest"),
    archiveReceiptDigest: requiredDigest(result.archiveReceiptDigest, "archive receipt digest"),
  });
  if (result?.status !== "recovered") throw new Error("Recovery result status is not public.");
  const receiptDigests = Array.isArray(result?.receipts)
    ? result.receipts.map(receipt => requiredDigest(receipt.receiptDigest, "receipt digest")) : [];
  return Object.freeze({
    schema: "agentic-reviewed-ci-revision-cli-result/v1",
    status: result.status,
    planDigest: requiredDigest(result?.planDigest, "plan digest"),
    sourceClaimId: requiredDigest(result?.sourceClaimId, "source claim ID"),
    successorClaimId: requiredDigest(result?.successorClaimId, "successor claim ID"),
    finalReceiptDigest: requiredDigest(result?.finalReceiptDigest, "final receipt digest"),
    archiveReceiptDigest: requiredDigest(result?.archiveReceiptDigest, "archive receipt digest"),
    receiptDigests,
  });
}

function requiredDigest(value, label) {
  const text = String(value || "");
  if (!/^[0-9a-f]{64}$/u.test(text)) throw new Error(`Public ${label} is invalid.`);
  return text;
}

export function parseArguments(argv) {
  const [command, ...tokens] = argv;
  if (!["plan", "execute"].includes(command)) {
    throw new Error("Usage: reviewed-ci-revision <plan|execute> --repository=PATH --session=ID --pr=N --check-run=N [--authorize=TEXT]");
  }
  const options = {};
  for (const token of tokens) {
    const match = String(token).match(/^--([a-z][a-z-]*)=(.*)$/u);
    if (!match || Object.hasOwn(options, match[1])) throw new Error("CLI options must be unique --name=value arguments.");
    options[match[1]] = match[2];
  }
  for (const name of ["repository", "session", "pr", "check-run"]) {
    if (!options[name]) throw new Error(`Missing required --${name}= value.`);
  }
  for (const name of ["pr", "check-run", "ttl", "minimum-margin"]) {
    if (options[name] !== undefined && (!/^\d+$/u.test(options[name]) || Number(options[name]) < 1)) {
      throw new Error(`--${name}= must be a positive integer.`);
    }
  }
  const allowed = new Set(["repository", "session", "pr", "check-run", "ttl", "minimum-margin", "authorize"]);
  const unknown = Object.keys(options).filter(name => !allowed.has(name));
  if (unknown.length) throw new Error(`Unknown CLI option: --${unknown[0]}.`);
  if (command === "execute" && !options.authorize) throw new Error("Execute requires exact --authorize= text.");
  return { command, options };
}

export function publicError(value) {
  return String(value?.message || value || "blocked")
    .replace(/(?:github_pat_|gh[opusr]_)[A-Za-z0-9_]+/gu, "[credential]")
    .replace(/https?:\/\/[^\s/@:]+:[^\s/@]+@/gu, "https://[credential]@")
    .replace(/[A-Za-z]:\\Users(?:\\[^\s"']+)*/gu, "[local-path]")
    .replace(/\/(?:Users|home)(?:\/[A-Za-z0-9._~!$&'()+,;=:@%-]+)*/gu, "[local-path]")
    .replace(/\b(?:Users|home)\b/gu, "[local-path]")
    .replace(/[\r\n\t]+/gu, " ")
    .slice(0, 300);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().then(result => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({ error: publicError(error) })}\n`);
    process.exitCode = 1;
  });
}
