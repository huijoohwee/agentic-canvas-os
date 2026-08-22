import { applyCloudTransition, createEmptyLedger, digestValue, listCurrentClaims, validateLedger, verifyCloudClaim } from "./cloud-collaboration-contract.mjs";
import { CLOUD_RESULT_SCHEMA, contractActor, contractRepository, createPublicResult, emptyResult, prepareMutationRequest, prepareReadRequest, projectPublicClaim, publicSnapshot, selectVerificationClaim, verificationResult } from "./github-cloud-collaboration-mapping.mjs";
import { createGitHubRequest, positiveInteger, projectActor, projectPullRequest, projectRepository, projectRepositoryIdentity, publicTransportError, requireRepositoryName, requireServerTime, requireSha, requireStatus, resolveGitHubToken } from "./github-cloud-collaboration-api.mjs";
import { createSmartGitLedgerCommit } from "./github-cloud-collaboration-git-transport.mjs";
export { createGitHubRequest } from "./github-cloud-collaboration-api.mjs";
export const DEFAULT_LEDGER_REF = "agentic/collaboration-ledger";
export const DEFAULT_LEDGER_PATH = ".agentic/collaboration-ledger.json";
export { CLOUD_RESULT_SCHEMA } from "./github-cloud-collaboration-mapping.mjs";
const MUTATING_ACTIONS = new Set(["claim", "continue", "integrate", "retire"]);
const PULL_REQUEST_FILES_PAGE_SIZE = 100;
const PULL_REQUEST_FILES_PAGE_LIMIT = 100;
export const SMART_GIT_LEDGER_THRESHOLD_BYTES = 10 * 1024 * 1024;
export function requiresSmartGitLedgerTransport(response, content, thresholdBytes = SMART_GIT_LEDGER_THRESHOLD_BYTES) {
  return response?.status === 400
    && Number.isSafeInteger(thresholdBytes)
    && thresholdBytes > 0
    && Buffer.byteLength(String(content || ""), "utf8") >= thresholdBytes;
}
export function createGitHubCloudCollaborationAdapter({ ledgerRepository, token = "", request = null,
  ledgerRef = DEFAULT_LEDGER_REF, ledgerPath = DEFAULT_LEDGER_PATH, maxAttempts = 4,
  workflowContext = null, smartGitLedgerCommit = createSmartGitLedgerCommit } = {}) {
  requireRepositoryName(ledgerRepository, "ledgerRepository");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 8) {
    throw new Error("maxAttempts must be an integer from 1 through 8.");
  }
  const resolvedToken = token || (request ? "" : resolveGitHubToken());
  const send = request || createGitHubRequest({ token: resolvedToken });
  return Object.freeze({
    async execute(action, input = {}) {
      const ledgerIdentity = await resolveRepository(send, ledgerRepository, "ledger repository");
      const context = await resolveRequestContext({ action, input, send, workflowContext });
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
        smartGitLedgerCommit,
        token: resolvedToken,
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
async function resolveRequestContext({ action, input, send, workflowContext }) {
  const normalized = { ...input };
  const actor = MUTATING_ACTIONS.has(action)
    ? await resolveActor({ input: normalized, send, workflowContext })
    : null;
  if (action === "status" && !normalized.targetRepository) {
    return { actor, repository: null, pullRequest: null, canonicalRevision: null, input: normalized };
  }
  requireRepositoryName(normalized.targetRepository, "targetRepository");
  const repository = await resolveRepository(send, normalized.targetRepository, "target repository");
  normalized.targetRepository = repository.fullName;
  if (MUTATING_ACTIONS.has(action)) {
    if (normalized.pullRequestNumber !== undefined && normalized.pullRequestNumber !== null) {
      normalized.pullRequestNumber = positiveInteger(normalized.pullRequestNumber, "pullRequestNumber");
    }
    return { actor, repository, pullRequest: null, canonicalRevision: null, input: normalized };
  }
  let pullRequest = null;
  if (normalized.pullRequestNumber !== undefined && normalized.pullRequestNumber !== null) {
    const number = positiveInteger(normalized.pullRequestNumber, "pullRequestNumber");
    const response = await send({ path: `/repos/${repository.fullName}/pulls/${number}` });
    requireStatus(response, [200], "resolve pull request");
    pullRequest = projectPullRequest(response.value, repository);
    normalized.pullRequestNumber = number;
  }
  return { actor, repository, pullRequest, canonicalRevision: null, input: normalized };
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
async function listPullRequestChangedPaths({ send, repository, pullRequestNumber }) {
  const changedPaths = [];
  for (let page = 1; page <= PULL_REQUEST_FILES_PAGE_LIMIT; page += 1) {
    const response = await send({
      path: `/repos/${repository.fullName}/pulls/${pullRequestNumber}/files?per_page=${PULL_REQUEST_FILES_PAGE_SIZE}&page=${page}`,
    });
    requireStatus(response, [200], "list pull request files");
    const files = Array.isArray(response.value) ? response.value : [];
    for (const file of files) {
      const filename = String(file?.filename || "").trim();
      if (!filename) throw new Error("Pull request file entries must include filename.");
      changedPaths.push(filename);
      const previousFilename = String(file?.previous_filename || "").trim();
      if (previousFilename) changedPaths.push(previousFilename);
    }
    if (files.length < PULL_REQUEST_FILES_PAGE_SIZE) {
      return [...new Set(changedPaths)].sort();
    }
  }
  throw new Error("Pull request file listing exceeded the supported pagination bound.");
}
async function resolveActor({ input, send, workflowContext }) {
  const userResponse = await send({ path: "/user" });
  if (userResponse.status === 200) {
    return requireAuthenticatedActorIdentity(projectActor(userResponse.value), input);
  }
  if (userResponse.status >= 500) {
    const authenticated = await resolveActorViaGraphQl(send);
    if (authenticated) {
      return requireAuthenticatedActorIdentity(authenticated, input);
    }
  }
  if (userResponse.status !== 403) requireStatus(userResponse, [200], "resolve authenticated actor");
  if (workflowContext?.trustedSource !== "github-actions") {
    throw new Error("GitHub App actor fallback requires trusted GitHub Actions runtime context.");
  }
  {
    requireRepositoryName(workflowContext.repository, "workflowRepository");
    const runId = positiveInteger(workflowContext.runId, "workflowRunId");
    const response = await send({ path: `/repos/${workflowContext.repository}/actions/runs/${runId}` });
    requireStatus(response, [200], "resolve authenticated workflow actor");
    const authenticated = projectActor(response.value?.actor);
    const workflowRepository = projectRepositoryIdentity(response.value?.repository);
    requireSha(workflowContext.revision, "workflowRevision");
    if (workflowRepository.fullName !== workflowContext.repository
      || workflowRepository.id !== Number(workflowContext.repositoryId)
      || response.value?.head_sha !== workflowContext.revision
      || response.value?.status !== "in_progress"
      || Number(response.value?.run_attempt) !== Number(workflowContext.runAttempt)
      || !actorIdentityMatchesInput(authenticated, input)) {
      throw new Error("Workflow actor metadata does not match the authenticated GitHub run identity.");
    }
    return authenticated;
  }
}
async function resolveActorViaGraphQl(send) {
  const response = await send({
    method: "POST",
    path: "/graphql",
    body: {
      query: "query { viewer { login databaseId } }",
    },
  });
  if (response.status !== 200) return null;
  const login = String(response.value?.data?.viewer?.login || "").trim();
  const id = Number(response.value?.data?.viewer?.databaseId);
  if (!login || !Number.isInteger(id) || id < 1) return null;
  return projectActor({ login, id });
}
function requireAuthenticatedActorIdentity(authenticated, input) {
  if (!actorIdentityMatchesInput(authenticated, input)) {
    throw new Error("Actor metadata does not match the authenticated GitHub token identity.");
  }
  return authenticated;
}
function actorIdentityMatchesInput(authenticated, input) {
  return (input.actorId === undefined || Number(input.actorId) === authenticated.id)
    && (!input.actorLogin || String(input.actorLogin).trim() === authenticated.login);
}
async function resolveMutationSubject({ action, context, send }) {
  let pullRequest = null;
  if (context.input.pullRequestNumber) {
    const response = await send({ path: `/repos/${context.repository.fullName}/pulls/${context.input.pullRequestNumber}` });
    requireStatus(response, [200], "resolve pull request");
    pullRequest = projectPullRequest(response.value, context.repository);
  }
  let canonicalRevision = null;
  if (action === "claim") {
    const response = await send({ path: `/repos/${context.repository.fullName}/git/ref/heads/${context.repository.defaultBranch}` });
    requireStatus(response, [200], "read protected source revision");
    canonicalRevision = String(response.value?.object?.sha || "");
    requireSha(canonicalRevision, "protected source revision");
  }
  return { pullRequest, canonicalRevision };
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
  smartGitLedgerCommit,
  token,
}) {
  let lastConflict = null;
  let semanticRequest = null;
  let subjectDigest = null;
  let committedReplay = false;
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
    const snapshotTime = requireServerTime(snapshot.evaluationTime);
    const subject = await resolveMutationSubject({ action, context, send });
    const nextSubjectDigest = digestValue(subject);
    subjectDigest ??= nextSubjectDigest;
    if (subjectDigest !== nextSubjectDigest) {
      throw new Error("Mutation subject changed during collaboration compare-and-swap.");
    }
    const prior = findIdempotentEntry(snapshot.ledger, context.input.idempotencyKey);
    committedReplay ||= Boolean(prior?.action === action);
    const fixedExpiresAt = semanticRequest?.expiresAt
      || (committedReplay && mutationUsesExpiry(action, context.input) ? prior.claimCore.expiresAt : null);
    semanticRequest ??= {
      ...prepareMutationRequest({
        action, input: { ...context.input, expectedLedgerDigest: snapshot.ledger.headDigest },
        actor: context.actor, repository: context.repository, pullRequest: subject.pullRequest,
        evaluationTime: snapshotTime, fixedExpiresAt,
      }),
    };
    if (!committedReplay && semanticRequest.expiresAt
      && Date.parse(semanticRequest.expiresAt) <= Date.parse(snapshotTime)) {
      throw new Error("Frozen collaboration expiry elapsed before compare-and-swap completed.");
    }
    const evaluationTime = snapshotTime;
    const preparedRequest = { ...semanticRequest, expectedLedgerDigest: snapshot.ledger.headDigest };
    const repository = contractRepository(
      context.repository,
      action === "claim" ? subject.canonicalRevision : null,
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
      ledgerRef,
      ledgerPath,
      snapshot,
      ledger: transition.ledger,
      action,
      smartGitLedgerCommit,
      token,
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
function mutationUsesExpiry(action, input) {
  return action === "claim" || (action === "continue" && ["renewal", "recovery", "promote"].includes(input.mode));
}
function findIdempotentEntry(ledger, rawKey) {
  if (typeof rawKey !== "string" || !rawKey.normalize("NFC").trim()) return null;
  const key = digestValue(rawKey.normalize("NFC").trim());
  return ledger.entries.find((entry) => entry.idempotencyKey === key) || null;
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
  const observedChangedPaths = action === "verify" && context.pullRequest
    ? await listPullRequestChangedPaths({
      send,
      repository: context.repository,
      pullRequestNumber: context.pullRequest.number,
    })
    : undefined;
  const request = prepareReadRequest({
    input: { ...context.input, observedChangedPaths },
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
    claims,
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
  if (bytes.length === 0) throw new Error("Collaboration ledger must not be empty.");
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
    send, ledgerRepository, ledgerRef,
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
  ledgerRef = DEFAULT_LEDGER_REF,
  ledgerPath,
  snapshot,
  ledger,
  action,
  smartGitLedgerCommit = createSmartGitLedgerCommit,
  token = "",
}) {
  requireValidLedger(ledger);
  const content = `${JSON.stringify(ledger, null, 2)}\n`;
  const blobResponse = await send({
    method: "POST",
    path: `/repos/${ledgerRepository}/git/blobs`,
    body: { content, encoding: "utf-8" },
  });
  if (requiresSmartGitLedgerTransport(blobResponse, content)) {
    return smartGitLedgerCommit({
      ledgerRepository,
      ledgerRef,
      ledgerPath,
      snapshot,
      content,
      action,
      token,
    });
  }
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
function requireValidLedger(ledger) {
  const findings = validateLedger(ledger);
  if (findings.length > 0) {
    throw new Error(`Collaboration ledger failed validation: ${findings.join("; ")}`);
  }
}
