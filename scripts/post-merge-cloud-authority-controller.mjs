// Responsibility: converge an exact merged delivery claim to terminal retirement.
import { digestValue, validateLedger } from "./cloud-collaboration-contract.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import {
  INTEGRATED_DELIVERY_TERMINAL_RETIREMENT_RUN_SCHEMA,
  inspectIntegratedDeliveryTerminal,
  terminalVerification,
} from "./integrated-delivery-terminal-retirement.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const LEDGER_REF = "agentic/collaboration-ledger";
const LEDGER_PATH = [".agentic", "collaboration-ledger.json"];

export const POST_MERGE_CLOUD_AUTHORITY_CONTROLLER_RECEIPT_SCHEMA =
  "agentic-post-merge-cloud-authority-controller-receipt/v1";
export const INTEGRATED_DELIVERY_TERMINAL_READBACK_SCHEMA =
  "agentic-integrated-delivery-terminal-readback/v1";
export const INTEGRATED_DELIVERY_TERMINAL_READBACKS_SCHEMA =
  "agentic-integrated-delivery-terminal-readbacks/v1";

export function createPostMergeCloudAuthorityController({
  environment = process.env,
  ghText,
  readLedger,
  readPullRequest,
  retireClaim,
  validate = validateLedger,
  verifyLive,
} = {}) {
  requireFunction(verifyLive, "live cloud authority verifier");
  const pullRequestReader = readPullRequest || (options => readGitHubPullRequest({
    pullRequestUrl: options.pullRequestUrl,
    ghText,
  }));
  const ledgerReader = readLedger || (ledgerRepository => readGitHubLedgerSnapshot({
    ledgerRepository,
    ghText,
  }));
  const retirement = retireClaim || (({ ledgerRepository, request }) =>
    invokeRepositoryCloudAction({
      action: "retire",
      ledgerRepository,
      request,
      environment,
    }));

  return options => {
    let liveResult;
    let liveError;
    try { liveResult = verifyLive(options); }
    catch (error) { liveError = error; }

    if (!liveError && liveResult?.configured === false) return liveResult;

    const initialPullRequest = pullRequestReader(options);
    if (initialPullRequest?.state === "OPEN") {
      if (liveError) throw liveError;
      requireOpenPullRequestSubject(initialPullRequest, options);
      return liveResult;
    }
    if (initialPullRequest?.state !== "MERGED") {
      throw new Error("Post-merge controller requires an exact open or merged pull request.");
    }

    try {
      const initial = snapshot({
        ledgerReader,
        options,
        pullRequest: initialPullRequest,
      });
      const inspectionOptions = inspectionInput(options, validate);
      const inspected = inspectIntegratedDeliveryTerminal({
        ...inspectionOptions,
        ledger: initial.ledger,
        ledgerRevision: initial.ledgerRevision,
        pullRequest: initial.pullRequest,
      });
      if (inspected.state === "complete") {
        const confirmed = snapshot({ ledgerReader, options, pullRequestReader });
        const readbackReceipt = verifyIntegratedDeliveryTerminalReadbacks({
          expectedRun: inspected.run,
          options: inspectionOptions,
          snapshots: [initial, confirmed],
        });
        const terminal = inspectIntegratedDeliveryTerminal({
          ...inspectionOptions,
          ledger: confirmed.ledger,
          ledgerRevision: confirmed.ledgerRevision,
          pullRequest: confirmed.pullRequest,
        });
        return buildResult({
          disposition: "already-retired",
          inspected: terminal,
          mutationAttempted: false,
          mutationResult: null,
          readbackReceipt,
          responseLossRecovered: false,
        });
      }

      let mutationError = null;
      let mutationResult = null;
      try {
        mutationResult = retirement({
          ledgerRepository: options.cloudAuthority.ledgerRepository,
          request: inspected.request,
          run: inspected.run,
        });
        requireRetirementMutationResult(mutationResult, inspected);
      } catch (error) {
        mutationError = error;
        mutationResult = null;
      }

      const { errors, snapshots } = readTerminalSnapshots({
        ledgerReader,
        options,
        pullRequestReader,
      });
      if (snapshots.length !== 2) {
        const cause = mutationError || errors[0] || new Error("Terminal retirement readback was unavailable.");
        throw cause;
      }
      let readbackReceipt;
      try {
        readbackReceipt = verifyIntegratedDeliveryTerminalReadbacks({
          expectedRun: inspected.run,
          options: inspectionOptions,
          snapshots,
        });
      } catch (readbackError) {
        throw mutationError || readbackError;
      }
      const terminal = inspectIntegratedDeliveryTerminal({
        ...inspectionOptions,
        ledger: snapshots[1].ledger,
        ledgerRevision: snapshots[1].ledgerRevision,
        pullRequest: snapshots[1].pullRequest,
      });
      const ownEffect = terminal.retirement.idempotencyKey
        === digestValue(inspected.request.idempotencyKey);
      if (ownEffect
        && terminal.retirement.claimCore.retirement?.bytesDigest !== inspected.request.bytesDigest) {
        throw new Error("Terminal retirement operation key is bound to different evidence.");
      }
      return buildResult({
        disposition: ownEffect
          ? mutationError ? "response-loss-recovered" : "retired"
          : "concurrent-retirement-reconciled",
        inspected: terminal,
        mutationAttempted: true,
        mutationResult,
        readbackReceipt,
        responseLossRecovered: Boolean(mutationError && ownEffect),
      });
    } catch (error) {
      throw new Error(
        `Post-merge cloud authority controller failed: ${publicMessage(error)}`,
      );
    }
  };
}

export function verifyIntegratedDeliveryTerminalReadbacks({ expectedRun, options,
  snapshots } = {}) {
  if (!Array.isArray(snapshots) || snapshots.length !== 2) {
    throw new Error("Terminal retirement requires exactly two authoritative readbacks.");
  }
  const run = normalizeRun(expectedRun);
  const readbacks = snapshots.map((snapshot, index) => {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw new Error("Terminal retirement readback is malformed.");
    }
    const inspected = inspectIntegratedDeliveryTerminal({ ...options,
      ledger: snapshot.ledger, ledgerRevision: snapshot.ledgerRevision ?? null,
      pullRequest: snapshot.pullRequest });
    if (inspected.state !== "complete" || inspected.run.runDigest !== run.runDigest) {
      throw new Error("Terminal retirement readback does not match the exact operation run.");
    }
    const core = { schema: INTEGRATED_DELIVERY_TERMINAL_READBACK_SCHEMA,
      ordinal: index + 1, runDigest: run.runDigest,
      ledgerRevision: inspected.ledgerRevision, ledgerDigest: inspected.ledgerDigest,
      pullRequestNumber: inspected.subject.pullRequestNumber,
      pullRequestNodeId: inspected.subject.pullRequestNodeId,
      mergeCommitSha: inspected.subject.mergeCommitSha,
      integrationEntryDigest: inspected.integration.digest,
      retirementEntryDigest: inspected.retirement.digest };
    return Object.freeze({ ...core, readbackDigest: digestValue(core) });
  });
  const identity = ["pullRequestNumber", "pullRequestNodeId", "mergeCommitSha",
    "integrationEntryDigest", "retirementEntryDigest"];
  if (identity.some(field => readbacks[0][field] !== readbacks[1][field])) {
    throw new Error("Terminal retirement authoritative readbacks disagree.");
  }
  const core = { schema: INTEGRATED_DELIVERY_TERMINAL_READBACKS_SCHEMA,
    runDigest: run.runDigest, readbacks };
  return Object.freeze({ ...core, receiptDigest: digestValue(core) });
}

function normalizeRun(value) {
  if (value?.schema !== INTEGRATED_DELIVERY_TERMINAL_RETIREMENT_RUN_SCHEMA) {
    throw new Error("Terminal retirement run is malformed.");
  }
  const { runDigest, ...core } = value;
  if (!DIGEST_PATTERN.test(String(runDigest || "")) || runDigest !== digestValue(core)) {
    throw new Error("Terminal retirement run digest is invalid.");
  }
  return value;
}

function buildResult({ disposition, inspected, mutationAttempted, mutationResult,
  readbackReceipt, responseLossRecovered }) {
  const controllerCore = {
    schema: POST_MERGE_CLOUD_AUTHORITY_CONTROLLER_RECEIPT_SCHEMA,
    disposition,
    operationRunDigest: inspected.run.runDigest,
    claimId: inspected.authority.claimId,
    integrationReceiptDigest: inspected.integrationReceiptDigest,
    pullRequestNumber: inspected.subject.pullRequestNumber,
    pullRequestNodeId: inspected.subject.pullRequestNodeId,
    mergeCommitSha: inspected.subject.mergeCommitSha,
    retirementEntryDigest: inspected.retirement.digest,
    retirementBinding: inspected.retirementBinding,
    mutationAttempted,
    responseLossRecovered,
    mutationOperationReceiptDigest: mutationResult?.operationReceipt?.receiptDigest ?? null,
    terminalReadbacksReceiptDigest: readbackReceipt.receiptDigest,
  };
  const controllerReceipt = Object.freeze({
    ...controllerCore,
    receiptDigest: digestValue(controllerCore),
  });
  return terminalVerification(inspected, {
    disposition,
    mutationAttempted,
    responseLossRecovered,
    controllerReceipt,
    terminalReadbacks: readbackReceipt,
  });
}

function readTerminalSnapshots({ ledgerReader, options, pullRequestReader }) {
  const snapshots = [];
  const errors = [];
  for (let index = 0; index < 2; index += 1) {
    try { snapshots.push(snapshot({ ledgerReader, options, pullRequestReader })); }
    catch (error) { errors.push(error); }
  }
  return { errors, snapshots };
}

function snapshot({ ledgerReader, options, pullRequest = null, pullRequestReader = null }) {
  const observedPullRequest = pullRequest || pullRequestReader(options);
  const source = ledgerReader(options.cloudAuthority?.ledgerRepository, options);
  const ledgerSnapshot = normalizeLedgerSnapshot(source);
  return Object.freeze({
    ledger: ledgerSnapshot.ledger,
    ledgerRevision: ledgerSnapshot.ledgerRevision,
    pullRequest: observedPullRequest,
  });
}

function normalizeLedgerSnapshot(value) {
  if (value?.ledger && typeof value.ledger === "object") {
    return {
      ledger: value.ledger,
      ledgerRevision: value.ledgerRevision ?? value.revision ?? null,
    };
  }
  if (value && Array.isArray(value.entries)) {
    return { ledger: value, ledgerRevision: null };
  }
  throw new Error("Cloud collaboration ledger snapshot is malformed.");
}

function inspectionInput(options, validate) {
  return {
    authority: options.cloudAuthority,
    branch: options.branch,
    canonicalBaseSha: options.canonicalBaseSha,
    deliveryEvidence: options.deliveryEvidence ?? null,
    headSha: options.headSha,
    protectedMainRefresh: options.protectedMainRefresh ?? null,
    validate,
  };
}

function requireRetirementMutationResult(result, inspected) {
  const operation = result?.operationReceipt;
  const claim = result?.claim;
  if (result?.schema !== "agentic-cloud-collaboration-result/v1"
    || result.ok !== true
    || result.action !== "retire"
    || result.status !== "retired"
    || claim?.claimId !== inspected.authority.claimId
    || claim.state !== "retired"
    || claim.integrationReceiptDigest !== inspected.integrationReceiptDigest
    || operation?.schema !== "agentic-collaboration-retirement-receipt/v1"
    || operation.operation !== "retire"
    || operation.status !== "retired"
    || operation.claimId !== inspected.authority.claimId
    || operation.idempotencyKey !== digestValue(inspected.request.idempotencyKey)
    || !DIGEST_PATTERN.test(String(operation.receiptDigest || ""))) {
    throw new Error("Cloud retirement response is not bound to the exact operation run.");
  }
}

function requireOpenPullRequestSubject(pullRequest, options) {
  const authority = options.cloudAuthority;
  const expectedNumber = pullRequestNumber(options.pullRequestUrl);
  const expectedReviewRequest = `github-pull-request:${String(
    pullRequest.id ?? pullRequest.nodeId ?? "",
  ).trim()}`;
  if (!authority
    || pullRequest.number !== expectedNumber
    || pullRequest.url !== options.pullRequestUrl
    || pullRequest.headRefName !== options.branch
    || pullRequest.baseRefName !== "main"
    || pullRequest.isCrossRepository !== false
    || expectedReviewRequest !== authority.reviewRequestId) {
    throw new Error("Open pull request does not match the live delivery subject.");
  }
}

function readGitHubPullRequest({ pullRequestUrl, ghText }) {
  requireFunction(ghText, "GitHub command reader");
  return JSON.parse(ghText([
    "pr", "view", pullRequestUrl,
    "--json",
    "number,id,url,state,isCrossRepository,headRefName,headRefOid,baseRefName,baseRefOid,mergeCommit,mergedAt",
  ]));
}

function readGitHubLedgerSnapshot({ ledgerRepository, ghText }) {
  requireRepository(ledgerRepository, "ledger repository");
  requireFunction(ghText, "GitHub command reader");
  const reference = ghJson(
    ghText,
    `repos/${ledgerRepository}/git/ref/heads/${encodeURIComponent(LEDGER_REF)}`,
  );
  const ledgerRevision = requireSha(reference?.object?.sha, "ledger commit");
  const commit = ghJson(ghText, `repos/${ledgerRepository}/git/commits/${ledgerRevision}`);
  let treeSha = requireSha(commit?.tree?.sha, "ledger root tree");
  for (const [index, segment] of LEDGER_PATH.entries()) {
    const tree = ghJson(ghText, `repos/${ledgerRepository}/git/trees/${treeSha}`);
    const item = tree?.tree?.find(candidate => candidate.path === segment);
    const expectedType = index === LEDGER_PATH.length - 1 ? "blob" : "tree";
    if (item?.type !== expectedType) {
      throw new Error(`Collaboration ledger path segment ${segment} is missing.`);
    }
    treeSha = requireSha(item.sha, `ledger ${expectedType}`);
  }
  const blob = ghJson(ghText, `repos/${ledgerRepository}/git/blobs/${treeSha}`);
  if (blob?.encoding !== "base64") {
    throw new Error("Collaboration ledger blob is not base64 encoded.");
  }
  const bytes = Buffer.from(String(blob.content || "").replace(/\s/gu, ""), "base64");
  if (bytes.length === 0) throw new Error("Collaboration ledger blob is empty.");
  return Object.freeze({ ledger: JSON.parse(bytes.toString("utf8")), ledgerRevision });
}

function ghJson(ghText, endpoint) {
  return JSON.parse(ghText([
    "api",
    "-H", "Accept: application/vnd.github+json",
    "-H", "X-GitHub-Api-Version: 2026-03-10",
    endpoint,
  ]));
}

function pullRequestNumber(value) {
  let url;
  try { url = new URL(String(value || "")); }
  catch { throw new Error("Pull request URL is invalid."); }
  const match = url.hostname === "github.com"
    ? url.pathname.match(/^\/[^/]+\/[^/]+\/pull\/(\d+)\/?$/u)
    : null;
  const number = Number(match?.[1]);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error("Pull request URL has no exact pull request number.");
  }
  return number;
}

function requireFunction(value, label) {
  if (typeof value !== "function") throw new Error(`${label} is required.`);
}

function requireRepository(value, label) {
  if (!REPOSITORY_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} must be owner/repository.`);
  }
  return value;
}

function requireSha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) throw new Error(`${label} must be an exact SHA.`);
  return value;
}

function publicMessage(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/\/(?:Users|home)\/[^\s"']+/gu, "[local-path]")
    .slice(0, 500);
}
