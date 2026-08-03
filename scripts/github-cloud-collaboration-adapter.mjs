import {
  applyCloudTransition,
  createEmptyLedger,
  digestValue,
  listCurrentClaims,
  validateLedger,
  verifyCloudClaim,
} from "./cloud-collaboration-contract.mjs";
import {
  contractActor,
  contractRepository,
  prepareMutationRequest,
  prepareReadRequest,
  projectPublicClaim,
  selectVerificationClaim,
} from "./github-cloud-collaboration-mapping.mjs";
import {
  createGitHubRequest,
  positiveInteger,
  projectActor,
  projectPullRequest,
  projectRepository,
  publicTransportError,
  requireRepositoryName,
  requireServerTime,
  requireSha,
  requireStatus,
  resolveGitHubToken,
} from "./github-cloud-collaboration-api.mjs";

export { createGitHubRequest } from "./github-cloud-collaboration-api.mjs";

export const DEFAULT_LEDGER_REF = "agentic/collaboration-ledger";
export const DEFAULT_LEDGER_PATH = ".agentic/collaboration-ledger.json";
export const CLOUD_RESULT_SCHEMA = "agentic-cloud-collaboration-result/v1";

const MUTATING_ACTIONS = new Set([
  "claim",
  "bind",
  "heartbeat",
  "review-ready",
  "delivery-authorize",
  "handoff",
  "release",
]);
const MAX_LEDGER_BYTES = 4_000_000;

export function createGitHubCloudCollaborationAdapter({
  ledgerRepository,
  token = "",
  request = null,
  ledgerRef = DEFAULT_LEDGER_REF,
  ledgerPath = DEFAULT_LEDGER_PATH,
  maxAttempts = 4,
} = {}) {
  requireRepositoryName(ledgerRepository, "ledgerRepository");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 8) {
    throw new Error("maxAttempts must be an integer from 1 through 8.");
  }
  const send = request || createGitHubRequest({ token: token || resolveGitHubToken() });

  return Object.freeze({
    async execute(action, input = {}) {
      const ledgerIdentity = await resolveRepository(send, ledgerRepository, "ledger repository");
      const context = await resolveRequestContext({ action, input, send });
      if (["status", "verify"].includes(action)) {
        return readOnlyResult({
          action,
          context,
          send,
          ledgerRepository,
          ledgerIdentity,
          ledgerRef,
          ledgerPath,
        });
      }
      if (!MUTATING_ACTIONS.has(action)) {
        throw new Error(`Unsupported cloud collaboration action: ${action}`);
      }
      return mutateLedger({
        action,
        context,
        send,
        ledgerRepository,
        ledgerIdentity,
        ledgerRef,
        ledgerPath,
        maxAttempts,
      });
    },

    async inspect() {
      const ledgerIdentity = await resolveRepository(send, ledgerRepository, "ledger repository");
      const snapshot = await readLedger({
        send,
        ledgerRepository,
        ledgerIdentity,
        ledgerRef,
        ledgerPath,
        allowMissing: true,
      });
      return snapshot
        ? publicSnapshot(snapshot)
        : emptyResult("status");
    },

    async listClaims({ targetRepository = null } = {}) {
      const ledgerIdentity = await resolveRepository(send, ledgerRepository, "ledger repository");
      const snapshot = await readLedger({
        send,
        ledgerRepository,
        ledgerIdentity,
        ledgerRef,
        ledgerPath,
        allowMissing: true,
      });
      if (!snapshot) return [];
      const repository = targetRepository
        ? await resolveRepository(send, targetRepository, "target repository")
        : null;
      return listCurrentClaims(
        snapshot.ledger,
        requireServerTime(snapshot.evaluationTime),
        repository ? { repositoryId: contractRepository(repository).repositoryId } : {},
      );
    },

    async pullRequestsForCommit({ targetRepository, commitSha }) {
      requireRepositoryName(targetRepository, "targetRepository");
      requireSha(commitSha, "commitSha");
      const repository = await resolveRepository(send, targetRepository, "target repository");
      const response = await send({
        path: `/repos/${repository.fullName}/commits/${commitSha}/pulls`,
      });
      requireStatus(response, [200], "list pull requests for commit");
      return (Array.isArray(response.value) ? response.value : [])
        .map((value) => projectPullRequest(value, repository));
    },
  });
}

async function resolveRequestContext({ action, input, send }) {
  const normalized = { ...input };
  const actor = MUTATING_ACTIONS.has(action)
    ? await resolveActor({ input: normalized, send })
    : null;
  if (action === "status" && !normalized.targetRepository) {
    return { actor, repository: null, pullRequest: null, canonicalRevision: null, input: normalized };
  }
  requireRepositoryName(normalized.targetRepository, "targetRepository");
  const repository = await resolveRepository(send, normalized.targetRepository, "target repository");
  normalized.targetRepository = repository.fullName;
  let pullRequest = null;
  if (normalized.pullRequestNumber !== undefined && normalized.pullRequestNumber !== null) {
    const number = positiveInteger(normalized.pullRequestNumber, "pullRequestNumber");
    const response = await send({ path: `/repos/${repository.fullName}/pulls/${number}` });
    requireStatus(response, [200], "resolve pull request");
    pullRequest = projectPullRequest(response.value, repository);
    normalized.pullRequestNumber = number;
  }
  let canonicalRevision = null;
  if (action === "claim") {
    const response = await send({
      path: `/repos/${repository.fullName}/git/ref/heads/${repository.defaultBranch}`,
    });
    requireStatus(response, [200], "read protected source revision");
    canonicalRevision = String(response.value?.object?.sha || "");
    requireSha(canonicalRevision, "protected source revision");
  }
  return { actor, repository, pullRequest, canonicalRevision, input: normalized };
}

async function resolveRepository(send, fullName, label) {
  const response = await send({ path: `/repos/${fullName}` });
  requireStatus(response, [200], `resolve ${label}`);
  const repository = projectRepository(response.value);
  if (repository.fullName.toLowerCase() !== fullName.toLowerCase()) {
    throw new Error(`${label} identity changed during resolution.`);
  }
  return repository;
}

async function resolveActor({ input, send }) {
  if (
    process.env.GITHUB_ACTIONS === "true"
    && Number.isInteger(Number(input.actorId))
    && String(input.actorLogin || "").trim()
  ) {
    return { id: Number(input.actorId), login: String(input.actorLogin).trim() };
  }
  const response = await send({ path: "/user" });
  requireStatus(response, [200], "resolve authenticated actor");
  return projectActor(response.value);
}

async function mutateLedger({
  action,
  context,
  send,
  ledgerRepository,
  ledgerIdentity,
  ledgerRef,
  ledgerPath,
  maxAttempts,
}) {
  let preparedRequest = null;
  let lastConflict = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let snapshot = await readLedger({
      send,
      ledgerRepository,
      ledgerIdentity,
      ledgerRef,
      ledgerPath,
      allowMissing: true,
    });
    if (!snapshot) {
      snapshot = await bootstrapLedger({
        send, ledgerRepository, ledgerIdentity, ledgerRef, ledgerPath,
      });
      if (!snapshot) {
        lastConflict = "collaboration ledger ref is not yet visible";
        continue;
      }
    }
    const evaluationTime = requireServerTime(snapshot.evaluationTime);
    if (!preparedRequest) {
      preparedRequest = prepareMutationRequest({
        action,
        input: context.input,
        actor: context.actor,
        repository: context.repository,
        pullRequest: context.pullRequest,
        evaluationTime,
      });
    }
    const repository = contractRepository(
      context.repository,
      action === "claim" ? context.canonicalRevision : null,
    );
    const transition = applyCloudTransition({
      ledger: snapshot.ledger,
      action,
      request: preparedRequest,
      actor: contractActor(context.actor, context.input),
      repository,
      evaluationTime,
    });
    if (transition.replayed) {
      return createPublicResult({
        action,
        transition,
        ledgerRevision: snapshot.revision,
        evaluationTime,
        attempts: attempt,
      });
    }
    const candidate = await createLedgerCommit({
      send,
      ledgerRepository,
      ledgerPath,
      snapshot,
      ledger: transition.ledger,
      action,
    });
    let update;
    try {
      update = await send({
        method: "PATCH",
        path: `/repos/${ledgerRepository}/git/refs/heads/${ledgerRef}`,
        body: { sha: candidate.commitSha, force: false },
      });
    } catch (error) {
      lastConflict = publicTransportError(error);
      continue;
    }
    if ([404, 409, 422].includes(update.status)) {
      lastConflict = `compare-and-swap conflict at ${snapshot.revision}`;
      continue;
    }
    requireStatus(update, [200], "advance collaboration ledger");
    return createPublicResult({
      action,
      transition,
      ledgerRevision: candidate.commitSha,
      evaluationTime: requireServerTime(update.date || evaluationTime),
      attempts: attempt,
    });
  }
  throw new Error(
    `Cloud collaboration compare-and-swap exhausted ${maxAttempts} attempts${lastConflict ? `: ${lastConflict}` : "."}`,
  );
}

async function readOnlyResult({
  action,
  context,
  send,
  ledgerRepository,
  ledgerIdentity,
  ledgerRef,
  ledgerPath,
}) {
  const snapshot = await readLedger({
    send,
    ledgerRepository,
    ledgerIdentity,
    ledgerRef,
    ledgerPath,
    allowMissing: action === "status",
  });
  if (!snapshot) return emptyResult(action);
  const evaluationTime = requireServerTime(snapshot.evaluationTime);
  const repositoryId = context.repository
    ? contractRepository(context.repository).repositoryId
    : null;
  const claims = listCurrentClaims(snapshot.ledger, evaluationTime, { repositoryId });
  if (action === "status") {
    const selected = context.input.claimId
      ? claims.filter((claim) => claim.claimId === context.input.claimId)
      : claims;
    return {
      schema: CLOUD_RESULT_SCHEMA,
      ok: true,
      action,
      status: "ready",
      ledgerRevision: snapshot.revision,
      ledgerDigest: snapshot.ledger.headDigest,
      sequence: snapshot.ledger.sequence,
      claims: selected.map(projectPublicClaim),
    };
  }
  const request = prepareReadRequest({
    input: context.input,
    repository: context.repository,
    pullRequest: context.pullRequest,
  });
  request.claimId = selectVerificationClaim(claims, request);
  const verification = verifyCloudClaim({
    ledger: snapshot.ledger,
    request,
    evaluationTime,
  });
  if (context.input.expectedLedgerRevision) {
    await verifyProjectedRevision({
      send,
      ledgerRepository,
      ledgerPath,
      expectedRevision: context.input.expectedLedgerRevision,
      currentSnapshot: snapshot,
      expectedClaimDigest: context.input.expectedClaimDigest,
    });
  }
  return verificationResult({
    verification,
    snapshot,
    evaluationTime,
    context,
  });
}

async function readLedger({
  send,
  ledgerRepository,
  ledgerIdentity,
  ledgerRef,
  ledgerPath,
  allowMissing,
}) {
  const refResponse = await send({
    path: `/repos/${ledgerRepository}/git/ref/heads/${ledgerRef}`,
  });
  if (refResponse.status === 404 && allowMissing) return null;
  requireStatus(refResponse, [200], "read collaboration ledger ref");
  const revision = String(refResponse.value?.object?.sha || "");
  requireSha(revision, "ledger revision");
  const commitResponse = await send({
    path: `/repos/${ledgerRepository}/git/commits/${revision}`,
  });
  requireStatus(commitResponse, [200], "read collaboration ledger commit");
  const treeSha = String(commitResponse.value?.tree?.sha || "");
  requireSha(treeSha, "ledger tree");
  const bytes = await readLedgerBytes({
    send,
    ledgerRepository,
    treeSha,
    ledgerPath,
    actionLabel: "read collaboration ledger file",
  });
  const ledger = JSON.parse(bytes.toString("utf8"));
  requireValidLedger(ledger);
  const expectedLedgerId = contractRepository(ledgerIdentity).repositoryId;
  if (ledger.ledgerRepositoryId !== expectedLedgerId) {
    throw new Error("Collaboration ledger repository identity does not match its Git ref.");
  }
  return {
    ledger,
    revision,
    treeSha,
    evaluationTime: requireServerTime(refResponse.date || commitResponse.date),
  };
}

async function readLedgerBytes({
  send,
  ledgerRepository,
  treeSha,
  ledgerPath,
  actionLabel,
}) {
  const blobSha = await resolveLedgerBlobSha({
    send,
    ledgerRepository,
    treeSha,
    ledgerPath,
    actionLabel,
  });
  const blobResponse = await send({
    path: `/repos/${ledgerRepository}/git/blobs/${blobSha}`,
  });
  requireStatus(blobResponse, [200], actionLabel);
  if (blobResponse.value?.encoding !== "base64") {
    throw new Error("Collaboration ledger content must use base64 encoding.");
  }
  const bytes = Buffer.from(String(blobResponse.value?.content || "").replace(/\s/gu, ""), "base64");
  if (bytes.length === 0 || bytes.length > MAX_LEDGER_BYTES) {
    throw new Error(`Collaboration ledger must contain 1 through ${MAX_LEDGER_BYTES} bytes.`);
  }
  return bytes;
}

async function resolveLedgerBlobSha({
  send,
  ledgerRepository,
  treeSha,
  ledgerPath,
  actionLabel,
}) {
  const segments = String(ledgerPath || "").split("/").filter(Boolean);
  if (segments.length === 0) throw new Error("Collaboration ledger path is required.");
  let currentTreeSha = treeSha;
  for (const [index, segment] of segments.entries()) {
    const treeResponse = await send({
      path: `/repos/${ledgerRepository}/git/trees/${currentTreeSha}`,
    });
    requireStatus(treeResponse, [200], actionLabel);
    const entry = (Array.isArray(treeResponse.value?.tree) ? treeResponse.value.tree : [])
      .find((candidate) => candidate.path === segment);
    if (!entry?.sha) {
      throw new Error("Collaboration ledger path was not present in the resolved Git tree.");
    }
    const isLeaf = index === segments.length - 1;
    if (isLeaf) {
      if (entry.type !== "blob") {
        throw new Error("Collaboration ledger path must resolve to a blob.");
      }
      requireSha(entry.sha, "ledger blob");
      return entry.sha;
    }
    if (entry.type !== "tree") {
      throw new Error("Collaboration ledger path must resolve through Git trees.");
    }
    requireSha(entry.sha, "ledger subtree");
    currentTreeSha = entry.sha;
  }
  throw new Error("Collaboration ledger path could not be resolved.");
}

async function bootstrapLedger({ send, ledgerRepository, ledgerIdentity, ledgerRef, ledgerPath }) {
  const baseResponse = await send({
    path: `/repos/${ledgerRepository}/git/ref/heads/${ledgerIdentity.defaultBranch}`,
  });
  requireStatus(baseResponse, [200], "read ledger bootstrap base");
  const baseSha = String(baseResponse.value?.object?.sha || "");
  requireSha(baseSha, "ledger bootstrap base");
  const commitResponse = await send({
    path: `/repos/${ledgerRepository}/git/commits/${baseSha}`,
  });
  requireStatus(commitResponse, [200], "read ledger bootstrap commit");
  const treeSha = String(commitResponse.value?.tree?.sha || "");
  requireSha(treeSha, "ledger bootstrap tree");
  const ledger = createEmptyLedger(contractRepository(ledgerIdentity));
  const candidate = await createLedgerCommit({
    send,
    ledgerRepository,
    ledgerPath,
    snapshot: { revision: baseSha, treeSha },
    ledger,
    action: "bootstrap",
  });
  const response = await send({
    method: "POST",
    path: `/repos/${ledgerRepository}/git/refs`,
    body: { ref: `refs/heads/${ledgerRef}`, sha: candidate.commitSha },
  });
  if (response.status === 422) return null;
  requireStatus(response, [201], "create collaboration ledger ref");
  return {
    ledger,
    revision: candidate.commitSha,
    treeSha: candidate.treeSha,
    evaluationTime: requireServerTime(response.date),
  };
}

async function createLedgerCommit({
  send,
  ledgerRepository,
  ledgerPath,
  snapshot,
  ledger,
  action,
}) {
  requireValidLedger(ledger);
  const content = `${JSON.stringify(ledger, null, 2)}\n`;
  if (Buffer.byteLength(content) > MAX_LEDGER_BYTES) {
    throw new Error(`Collaboration ledger exceeds the ${MAX_LEDGER_BYTES}-byte transport bound.`);
  }
  const blobResponse = await send({
    method: "POST",
    path: `/repos/${ledgerRepository}/git/blobs`,
    body: { content, encoding: "utf-8" },
  });
  requireStatus(blobResponse, [201], "create collaboration ledger blob");
  const blobSha = String(blobResponse.value?.sha || "");
  requireSha(blobSha, "ledger blob");
  const treeResponse = await send({
    method: "POST",
    path: `/repos/${ledgerRepository}/git/trees`,
    body: {
      base_tree: snapshot.treeSha,
      tree: [{ path: ledgerPath, mode: "100644", type: "blob", sha: blobSha }],
    },
  });
  requireStatus(treeResponse, [201], "create collaboration ledger tree");
  const treeSha = String(treeResponse.value?.sha || "");
  requireSha(treeSha, "candidate ledger tree");
  const commitResponse = await send({
    method: "POST",
    path: `/repos/${ledgerRepository}/git/commits`,
    body: {
      message: `chore(collaboration): ${action} ledger transition`,
      tree: treeSha,
      parents: [snapshot.revision],
    },
  });
  requireStatus(commitResponse, [201], "create collaboration ledger commit");
  const commitSha = String(commitResponse.value?.sha || "");
  requireSha(commitSha, "candidate ledger commit");
  return { commitSha, treeSha };
}

async function verifyProjectedRevision({
  send,
  ledgerRepository,
  ledgerPath,
  expectedRevision,
  currentSnapshot,
  expectedClaimDigest,
}) {
  requireSha(expectedRevision, "expectedLedgerRevision");
  if (expectedRevision !== currentSnapshot.revision) {
    const comparison = await send({
      path: `/repos/${ledgerRepository}/compare/${expectedRevision}...${currentSnapshot.revision}`,
    });
    requireStatus(comparison, [200], "verify projected ledger ancestry");
    if (!["ahead", "identical"].includes(comparison.value?.status)) {
      throw new Error("Projected ledger revision is not an ancestor of the current ledger.");
    }
  }
  if (!expectedClaimDigest) return;
  const commitResponse = await send({
    path: `/repos/${ledgerRepository}/git/commits/${expectedRevision}`,
  });
  requireStatus(commitResponse, [200], "read projected collaboration ledger commit");
  const treeSha = String(commitResponse.value?.tree?.sha || "");
  requireSha(treeSha, "projected ledger tree");
  const bytes = await readLedgerBytes({
    send,
    ledgerRepository,
    treeSha,
    ledgerPath,
    actionLabel: "read projected collaboration ledger",
  });
  const ledger = JSON.parse(bytes.toString("utf8"));
  requireValidLedger(ledger);
  if (!ledger.entries.some((entry) => entry.claimDigest === expectedClaimDigest)) {
    throw new Error("Projected ledger revision did not contain the expected claim digest.");
  }
}

function createPublicResult({ action, transition, ledgerRevision, evaluationTime, attempts }) {
  const claim = transition.claim || null;
  const receipt = {
    schema: "agentic-cloud-collaboration-github-receipt/v1",
    action,
    ledgerRevision,
    ledgerDigest: transition.ledger.headDigest,
    claimId: claim?.claimId || null,
    claimDigest: transition.claimDigest || null,
    contractReceiptDigest: transition.receipt?.receiptDigest || null,
    sequence: transition.ledger.sequence,
    evaluationTime,
  };
  return {
    schema: CLOUD_RESULT_SCHEMA,
    ok: true,
    action,
    status: claim?.state || "released",
    replayed: Boolean(transition.replayed),
    attempts,
    ledgerRevision,
    claim: claim ? projectPublicClaim(claim) : null,
    claimDigest: transition.claimDigest || null,
    receipt: { ...receipt, receiptDigest: digestValue(receipt) },
  };
}

function verificationResult({
  verification,
  snapshot,
  evaluationTime,
  context,
}) {
  const claimDigest = verification.claimDigest || verification.claim?.fenceRevision || null;
  const receipt = {
    schema: "agentic-cloud-collaboration-github-verification/v1",
    ok: verification.ok,
    ledgerRevision: snapshot.revision,
    ledgerDigest: snapshot.ledger.headDigest,
    claimId: verification.claimId,
    claimDigest,
    contractReceiptDigest: verification.receiptDigest,
    evaluationTime,
    findings: verification.findings,
  };
  return {
    schema: CLOUD_RESULT_SCHEMA,
    ok: verification.ok,
    action: "verify",
    status: verification.ok ? "ready" : "blocked",
    ledgerRevision: snapshot.revision,
    claimDigest,
    claim: verification.claim ? projectPublicClaim(verification.claim) : null,
    ...(context.pullRequest ? {
      subject: {
        repository: context.repository.fullName,
        pullRequestNumber: context.pullRequest.number,
        branch: context.pullRequest.branch,
        headSha: context.pullRequest.headSha,
        canonicalBaseSha: context.pullRequest.baseSha,
      },
    } : {}),
    findings: verification.findings,
    receipt: { ...receipt, receiptDigest: digestValue(receipt) },
  };
}

function publicSnapshot(snapshot) {
  const claims = listCurrentClaims(
    snapshot.ledger,
    snapshot.evaluationTime,
  ).map(projectPublicClaim);
  return {
    schema: CLOUD_RESULT_SCHEMA,
    ok: true,
    action: "status",
    status: "ready",
    ledgerRevision: snapshot.revision,
    ledgerDigest: snapshot.ledger.headDigest,
    sequence: snapshot.ledger.sequence,
    claims,
  };
}

function emptyResult(action) {
  return {
    schema: CLOUD_RESULT_SCHEMA,
    ok: action === "status",
    action,
    status: action === "status" ? "empty" : "blocked",
    ledgerRevision: null,
    claims: [],
  };
}

function requireValidLedger(ledger) {
  const findings = validateLedger(ledger);
  if (findings.length > 0) {
    throw new Error(`Collaboration ledger failed validation: ${findings.join("; ")}`);
  }
}
