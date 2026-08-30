// Responsibility: Join exact protected GitHub/C3 evidence to the two cloud-only effects.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalJson, digestValue, validateLedger, writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import { applyCloudTransition } from "./cloud-collaboration-contract.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { normalizeCloudAuthority } from "./scoped-lane-admission-lib.mjs";
import {
  WRITER_LEASE_SCHEMA, createWriterLeaseStore, parseWriterLeasePullRequestBody,
} from "./writer-lease-lib.mjs";
import {
  BRIDGE_RETIREMENT_EVIDENCE_SCHEMA, BRIDGE_RETIREMENT_OPERATION,
  SUCCESSOR_PROMOTION_EVIDENCE_SCHEMA, SUCCESSOR_PROMOTION_OPERATION,
  bridgeRetirementRequestDigest, normalizeWaitingBridgeJournal,
  normalizeWaitingBridgeResult, successorPromotionEntryRequestDigest,
  waitingBridgeEffectDigest, waitingBridgeOperationKey,
  waitingBridgePreservationDigest, waitingBridgeTerminalRelevantDigest,
} from "./claim-only-waiting-bridge-reconciliation-contract.mjs";
import {
  requireStableWaitingBridgeEvidence, stableWaitingBridgeEvidenceDigest,
} from "./claim-only-waiting-bridge-reconciliation-controller.mjs";
import {
  buildClaimOnlyRetirementRequest,
  captureClaimOnlyControllerEvidence, captureClaimOnlyRepositoryIdentity,
  claimOnlyOperationReceiptForEntry, claimOnlyOverlapFrame,
  claimOnlyRepositoryName, createClaimOnlyPartialStartRetirementStore,
  projectClaimOnlyClaim, projectClaimOnlyEntry, readClaimOnlyPrivateJson,
} from "./claim-only-partial-start-retirement-store.mjs";
import {
  validateClaimOnlyRetirementTerminal,
} from "./claim-only-partial-start-retirement-controller.mjs";

const CONTROLLER_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENTRY_SCHEMA = "agentic-cloud-collaboration-entry/v2";
const DIGEST = /^[0-9a-f]{64}$/u;
const MAX_PULL_REQUEST_PAGES = 1_000;
const PULL_REQUEST_QUERY = [
  "query($owner:String!,$name:String!,$after:String)",
  "{repository(owner:$owner,name:$name)",
  "{pullRequests(first:100,after:$after)",
  "{totalCount nodes{number id state isDraft mergedAt closedAt headRefName headRefOid",
  "baseRefName baseRefOid body}pageInfo{hasNextPage endCursor}}}}",
].join(" ");
const RUNTIME_FILES = Object.freeze([
  "scripts/claim-only-waiting-bridge-reconciliation-contract.mjs",
  "scripts/claim-only-waiting-bridge-reconciliation-controller.mjs",
  "scripts/claim-only-waiting-bridge-reconciliation-repository-adapter.mjs",
  "scripts/claim-only-waiting-bridge-reconciliation.mjs",
  "scripts/claim-only-partial-start-retirement-store.mjs",
]);

export function readAllWaitingBridgeProviderPullRequests({ targetRepository, gh }) {
  const parts = claimOnlyRepositoryName(targetRepository).split("/");
  const [owner, name] = parts;
  const pulls = [];
  const seenNodeIds = new Set();
  const seenNumbers = new Set();
  const seenCursors = new Set();
  let after = null;
  let pageCount = 0;
  let totalCount = null;
  while (true) {
    pageCount += 1;
    if (pageCount > MAX_PULL_REQUEST_PAGES) {
      throw new Error("Waiting-bridge provider pagination exceeded 1000 pages.");
    }
    let envelope;
    try {
      envelope = JSON.parse(gh([
        "api", "graphql", "-f", `query=${PULL_REQUEST_QUERY}`,
        "-F", `owner=${owner}`, "-F", `name=${name}`,
        ...(after ? ["-F", `after=${after}`] : []),
      ]));
    } catch {
      throw new Error("Waiting-bridge provider pagination returned invalid JSON.");
    }
    const connection = envelope?.data?.repository?.pullRequests;
    const pageInfo = connection?.pageInfo;
    if (envelope?.errors !== undefined || !connection
      || !Number.isSafeInteger(connection.totalCount) || connection.totalCount < 0
      || !Array.isArray(connection.nodes) || !pageInfo
      || typeof pageInfo.hasNextPage !== "boolean"
      || !(pageInfo.endCursor === null || typeof pageInfo.endCursor === "string")) {
      throw new Error("Waiting-bridge provider pagination envelope is incomplete.");
    }
    totalCount ??= connection.totalCount;
    if (connection.totalCount !== totalCount) {
      throw new Error("Waiting-bridge provider pagination total count changed.");
    }
    for (const pull of connection.nodes) {
      const number = Number(pull?.number);
      const nodeId = String(pull?.id || "").trim();
      if (!Number.isSafeInteger(number) || number <= 0 || !nodeId
        || typeof pull.state !== "string" || typeof pull.isDraft !== "boolean"
        || typeof pull.headRefName !== "string" || typeof pull.baseRefName !== "string"
        || !(pull.body === null || typeof pull.body === "string")) {
        throw new Error("Waiting-bridge provider pagination returned a malformed pull request.");
      }
      if (seenNumbers.has(number) || seenNodeIds.has(nodeId)) {
        throw new Error("Waiting-bridge provider pagination returned a duplicate pull request.");
      }
      seenNumbers.add(number);
      seenNodeIds.add(nodeId);
      pulls.push(pull);
    }
    if (!pageInfo.hasNextPage) break;
    const nextCursor = String(pageInfo.endCursor || "").trim();
    if (!nextCursor || nextCursor === after || seenCursors.has(nextCursor)) {
      throw new Error("Waiting-bridge provider pagination cursor did not advance.");
    }
    seenCursors.add(nextCursor);
    after = nextCursor;
  }
  if (pulls.length !== totalCount) {
    throw new Error("Waiting-bridge provider pagination did not return its total inventory.");
  }
  return Object.freeze({ pulls: Object.freeze(pulls), pageCount, totalCount });
}

export function projectWaitingBridgeProviderInventory(value, {
  targetClaimIds = [],
} = {}) {
  const frame = Array.isArray(value)
    ? { pulls: value, pageCount: value.length ? 1 : 0, totalCount: value.length }
    : value;
  if (!frame || !Array.isArray(frame.pulls)
    || !Number.isSafeInteger(frame.pageCount) || frame.pageCount < 0
    || !Number.isSafeInteger(frame.totalCount) || frame.totalCount !== frame.pulls.length) {
    invalid("complete provider inventory");
  }
  const claimOwners = new Map();
  const markers = new Map();
  const strictClaimIds = new Set(targetClaimIds.map(claimId =>
    digest(claimId, "strict provider claim ID")));
  const projected = frame.pulls.map(pull => {
    const body = String(pull.body || "");
    const hasMarkerToken = body.includes(WRITER_LEASE_SCHEMA);
    const rawMarkerTokenCount = (body.match(/agentic-writer-lease\/v2/gu) || []).length;
    const markerMatches = [...body.matchAll(
      /<!--\s*agentic-writer-lease\/v2\s+(\{[\s\S]*?\})\s*-->/gu,
    )];
    const markerCount = markerMatches.length;
    let canonicalMarker = null;
    try { canonicalMarker = parseWriterLeasePullRequestBody(body); } catch {
      invalid("malformed pull-request ownership marker");
    }
    if ((hasMarkerToken && (markerCount !== 1 || rawMarkerTokenCount !== 2))
      || (!hasMarkerToken && canonicalMarker !== null)) {
      invalid("malformed or duplicate pull-request ownership marker");
    }
    let rawMarker = null;
    if (markerCount === 1) {
      try { rawMarker = JSON.parse(markerMatches[0][1]); } catch {
        invalid("malformed pull-request ownership marker");
      }
      if (!rawMarker || typeof rawMarker !== "object" || Array.isArray(rawMarker)
        || rawMarker.schema !== WRITER_LEASE_SCHEMA) {
        invalid("malformed pull-request ownership marker");
      }
    }
    const rawClaimId = rawMarker?.cloudAuthority?.claimId ?? null;
    if (rawClaimId !== null) digest(rawClaimId, "raw provider marker claim ID");
    const markerDisposition = canonicalMarker ? "canonical"
      : rawMarker && rawClaimId !== null && !strictClaimIds.has(rawClaimId)
        ? "semantic-stale-unrelated" : rawMarker ? invalid(
          "target or unattributed semantic-stale pull-request ownership marker",
        ) : null;
    const marker = canonicalMarker || rawMarker;
    if (rawClaimId) {
      const claimId = rawClaimId;
      if (claimOwners.has(claimId)) invalid("duplicate claim pull-request marker");
      claimOwners.set(claimId, pull.number);
      markers.set(pull.number, marker);
    }
    return Object.freeze({
      number: pull.number,
      nodeId: pull.id,
      state: pull.state,
      isDraft: pull.isDraft,
      mergedAt: pull.mergedAt ?? null,
      closedAt: pull.closedAt ?? null,
      headRefName: pull.headRefName,
      headRefOid: pull.headRefOid ?? null,
      baseRefName: pull.baseRefName,
      baseRefOid: pull.baseRefOid ?? null,
      bodyDigest: digestValue(body),
      markerDigest: marker ? digestValue(marker) : null,
      markerClaimId: rawClaimId,
      markerDisposition,
    });
  }).sort((left, right) => left.number - right.number);
  return Object.freeze({
    totalCount: frame.totalCount,
    pageCount: frame.pageCount,
    projected: Object.freeze(projected),
    associations(claimId) {
      return Object.freeze(projected.flatMap(pull => {
        const marker = markers.get(pull.number);
        return marker?.cloudAuthority?.claimId === claimId ? [Object.freeze({
          claimId,
          markerClaimDigest: marker.cloudAuthority.claimDigest,
          number: pull.number,
          nodeId: pull.nodeId,
          state: pull.state,
          isDraft: pull.isDraft,
          headRefName: pull.headRefName,
          headRefOid: pull.headRefOid,
          baseRefName: pull.baseRefName,
          baseRefOid: pull.baseRefOid,
          bodyDigest: pull.bodyDigest,
          markerDigest: pull.markerDigest,
          markerBranch: marker.branch,
          markerLaneRevision: marker.cloudAuthority.laneRevision,
          markerFenceSha: marker.fenceSha,
        })] : [];
      }));
    },
  });
}

export function projectWaitingBridgeDirectSuccessorTopology({
  ledger, statusClaims, bridgeClaimId, successorClaimId,
  registryAssociations = () => [], providerAssociations = () => [],
}) {
  objectLike(ledger, "direct-successor ledger");
  if (!Array.isArray(ledger.entries) || !Array.isArray(statusClaims)) {
    invalid("direct-successor inventory");
  }
  digest(bridgeClaimId, "direct-successor bridge claim ID");
  digest(successorClaimId, "direct-successor selected claim ID");
  const genesis = ledger.entries.filter(entry => entry.action === "claim"
    && entry.claimCore?.predecessorClaimId === bridgeClaimId);
  const claimIds = [...new Set(genesis.map(entry => entry.claimId))].sort();
  if (claimIds.length !== genesis.length) invalid("duplicate direct-successor genesis");
  const live = [];
  const terminal = [];
  for (const claimId of claimIds) {
    digest(claimId, "direct-successor claim ID");
    const current = statusClaims.filter(claim => claim.claimId === claimId);
    if (current.length > 1) invalid("duplicate direct-successor current projection");
    const lineage = ledger.entries.filter(entry => entry.claimId === claimId);
    if (current.length === 1) {
      live.push(claimId);
      continue;
    }
    const first = lineage[0];
    const last = lineage.at(-1);
    if (lineage.length !== 2 || first?.action !== "claim"
      || first?.schema !== ENTRY_SCHEMA || first?.claimId !== claimId
      || first?.claimCore?.claimId !== claimId
      || first?.claimCore?.predecessorClaimId !== bridgeClaimId
      || first?.claimCore?.state !== "waiting-successor"
      || first?.claimCore?.transitionCounter !== 1
      || first?.claimCore?.heartbeatCounter !== 0
      || first?.claimCore?.reviewRequestId !== null
      || last?.action !== "retire" || last?.claimCore?.state !== "retired"
      || last?.schema !== ENTRY_SCHEMA
      || last?.claimId !== claimId || last?.claimCore?.claimId !== claimId
      || last?.claimCore?.predecessorClaimId !== bridgeClaimId
      || last?.claimCore?.transitionCounter !== 2
      || last?.claimCore?.heartbeatCounter !== 0
      || last?.claimCore?.reviewRequestId !== null
      || last?.claimCore?.retirement?.reason !== "superseded"
      || last?.claimCore?.retirement?.finalRevision !== first.claimCore.laneRevision
      || last?.claimCore?.retirement?.reviewRequestId !== null
      || last?.claimCore?.retirement?.integrationReceiptDigest !== null
      || !DIGEST.test(String(last?.claimCore?.retirement?.bytesDigest || ""))
      || !DIGEST.test(String(last?.claimCore?.retirement?.namedChecksDigest || ""))
      || !DIGEST.test(String(last?.claimCore?.retirement?.handoffEvidenceDigest || ""))
      || !Number.isFinite(Date.parse(last?.claimCore?.retirement?.retiredAt))
      || !sameDirectSuccessorSubject(first.claimCore, last.claimCore)) {
      invalid("nonterminal direct-successor history");
    }
    const registry = registryAssociations(claimId);
    const pulls = providerAssociations(claimId);
    if (!Array.isArray(registry) || !Array.isArray(pulls)
      || registry.length !== 0 || pulls.length !== 0) {
      invalid("terminal direct-successor association");
    }
    terminal.push(Object.freeze({
      claimId,
      lineageCount: lineage.length,
      lineageDigest: digestValue(lineage),
      genesisEntryDigest: digestValue(first),
      terminalEntryDigest: digestValue(last),
      terminalClaimDigest: digest(last.claimDigest,
        "terminal direct-successor claim digest"),
      predecessorClaimId: bridgeClaimId,
      terminalAction: "retire",
      terminalState: "retired",
      terminalTransitionCounter: 2,
      retirementReason: "superseded",
      finalRevision: first.claimCore.laneRevision,
      registryAssociationDigest: digestValue(registry),
      pullRequestMarkerAssociationDigest: digestValue(pulls),
    }));
  }
  const sortedLive = live.sort();
  if (canonicalJson(sortedLive) !== canonicalJson([successorClaimId])) {
    invalid("sole live direct successor");
  }
  return Object.freeze({
    bridgeDirectSuccessorClaimIds: Object.freeze(claimIds),
    bridgeLiveDirectSuccessorClaimIds: Object.freeze(sortedLive),
    bridgeTerminalDirectSuccessors: Object.freeze(terminal.sort((left, right) =>
      left.claimId.localeCompare(right.claimId))),
  });
}

export function buildWaitingBridgePromotionAuthorityOutput({
  plan, terminal, receipt, status, ledgerRepository, targetRepository,
}) {
  const claimCore = terminal.claimCore;
  const claim = Object.freeze({
    ...claimCore,
    claimId: terminal.claimId,
    fenceRevision: terminal.claimDigest,
    transitionDigest: terminal.digest,
    ledgerRevision: terminal.digest,
    ledgerSequence: terminal.sequence,
    entrySchema: ENTRY_SCHEMA,
    claimIdentitySchema: ENTRY_SCHEMA,
    operationReceiptDigest: receipt.receiptDigest,
    operationTime: terminal.evaluationTime,
    recordedState: "current",
    state: "current",
    writeAuthority: true,
    scopeReserved: true,
    integrationReceiptDigest: null,
  });
  const result = Object.freeze({
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "continue",
    status: "current",
    ledgerRevision: status.ledgerRevision,
    ledgerDigest: status.ledgerDigest,
    sequence: status.sequence,
    claim,
    claimDigest: terminal.claimDigest,
    operationReceipt: receipt,
  });
  const authorityDigest = digestValue({
    schema: "agentic-claim-only-existing-successor-promotion-authority-proof/v1",
    planDigest: plan.planDigest,
    claimId: terminal.claimId,
    claimDigest: terminal.claimDigest,
    transitionDigest: terminal.digest,
    operationReceiptDigest: receipt.receiptDigest,
    expiresAt: terminal.claimCore.expiresAt,
  });
  return Object.freeze({
    schema: "agentic-claim-only-existing-successor-promotion-authority-output/v1",
    ledgerRepository,
    targetRepository,
    result,
    authorityDigest,
  });
}

export function createRepositoryClaimOnlyWaitingBridgeReconciliationAdapter(
  options = {}, dependencies = {},
) {
  const repository = realpathSync(path.resolve(text(options.repository, "repository")));
  const controllerRoot = realpathSync(path.resolve(options.controllerRoot || CONTROLLER_ROOT));
  if (controllerRoot !== realpathSync(CONTROLLER_ROOT)) {
    throw new Error("Waiting-bridge recovery requires its exact installed controller root.");
  }
  const targetRepository = claimOnlyRepositoryName(options.targetRepository);
  const ledgerRepository = claimOnlyRepositoryName(
    options.ledgerRepository || "huijoohwee/agentic-canvas-os",
  );
  if (targetRepository !== ledgerRepository) invalid("target/controller/ledger equality");
  const anchorClaimId = digest(options.anchorClaimId, "anchor claim ID");
  const bridgeClaimId = digest(options.bridgeClaimId, "bridge claim ID");
  const successorClaimId = digest(options.successorClaimId, "successor claim ID");
  if (new Set([anchorClaimId, bridgeClaimId, successorClaimId]).size !== 3) {
    invalid("distinct chain claim IDs");
  }
  const ttlSeconds = integer(options.ttlSeconds ?? 1_800, "promotion TTL", 60, 86_400);
  const environment = dependencies.environment || process.env;
  const now = dependencies.now || (() => new Date());
  const execute = dependencies.execute || ((command, argumentsList, cwd = repository) => (
    execFileSync(command, argumentsList, {
      cwd, encoding: "utf8", env: environment, maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"], timeout: 60_000,
    })
  ));
  const git = dependencies.git || ((args, cwd = repository) =>
    String(execute("git", args, cwd)).trim());
  const gitRaw = dependencies.gitRaw || ((args, cwd = repository) =>
    String(execute("git", args, cwd)));
  const gh = dependencies.gh || (args => String(execute("gh", args)).trim());
  const invoke = dependencies.invoke || invokeRepositoryCloudAction;
  const commonDirectory = realpathSync(path.resolve(repository,
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"])));
  const controllerCommonDirectory = realpathSync(path.resolve(controllerRoot,
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"], controllerRoot)));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
  });
  const currentStore = dependencies.store || createClaimOnlyPartialStartRetirementStore({
    statePath: options.statePath,
    claimOutputPath: options.authorityOutputPath || null,
    now,
  });
  const retirementStore = dependencies.retirementStore || (
    options.retirementStatePath
      ? createClaimOnlyPartialStartRetirementStore({
        statePath: options.retirementStatePath, now,
      }) : currentStore
  );
  if (options.retirementStatePath
    && retirementStore.statePath === currentStore.statePath) {
    invalid("distinct retirement and promotion journals");
  }
  const confirmed = new Map();

  function storeFor(operation) {
    return operation === BRIDGE_RETIREMENT_OPERATION ? retirementStore
      : operation === SUCCESSOR_PROMOTION_OPERATION ? currentStore
        : invalid("journal operation");
  }

  function repositoryEvidence() {
    return captureClaimOnlyRepositoryIdentity({
      repository, commonDirectory, targetRepository, git,
      readProvider: () => dependencies.readRepositoryIdentity
        ? dependencies.readRepositoryIdentity({ targetRepository })
        : JSON.parse(gh(["repo", "view", targetRepository, "--json", "id,nameWithOwner"])),
    });
  }

  function controllerEvidence() {
    return captureClaimOnlyControllerEvidence({
      controllerRoot,
      commonDirectory: controllerCommonDirectory,
      repository: ledgerRepository,
      git: args => git(args, controllerRoot),
      gitRaw: args => gitRaw(args, controllerRoot),
      readProvider: () => dependencies.readRepositoryIdentity
        ? dependencies.readRepositoryIdentity({ targetRepository: ledgerRepository })
        : JSON.parse(gh(["repo", "view", ledgerRepository, "--json", "id,nameWithOwner"])),
      readProtection: () => dependencies.readProtection
        ? dependencies.readProtection({ ledgerRepository })
        : JSON.parse(gh(["api", `repos/${ledgerRepository}/branches/main`])),
      runtimeFiles: RUNTIME_FILES,
    });
  }

  function cloudStatus() {
    const result = dependencies.readCloud ? dependencies.readCloud({
      ledgerRepository, targetRepository,
    }) : invoke({
      action: "status", ledgerRepository,
      request: { targetRepository }, environment,
    });
    if (result?.schema !== "agentic-cloud-collaboration-result/v1"
      || result.ok !== true || result.action !== "status"
      || !Array.isArray(result.claims) || !Number.isSafeInteger(result.sequence)
      || !DIGEST.test(String(result.ledgerDigest || ""))) {
      invalid("cloud status");
    }
    return result;
  }

  function ledgerFor(status) {
    const ledger = dependencies.readLedger ? dependencies.readLedger({
      ledgerRepository, revision: status.ledgerRevision,
    }) : JSON.parse(gh([
      "api", "--method", "GET", "-H", "Accept: application/vnd.github.raw+json",
      `repos/${ledgerRepository}/contents/.agentic/collaboration-ledger.json`,
      "-f", `ref=${status.ledgerRevision}`,
    ]));
    const failures = validateLedger(ledger);
    if (failures.length || ledger.sequence !== status.sequence
      || ledger.headDigest !== status.ledgerDigest) {
      throw new Error(`Waiting-bridge validated ledger mismatch: ${failures.join("; ")}`);
    }
    return ledger;
  }

  function providerInventory(targetClaimIds) {
    const raw = dependencies.readProviderPullRequests
      ? dependencies.readProviderPullRequests({ targetRepository })
      : readAllWaitingBridgeProviderPullRequests({ targetRepository, gh });
    return projectWaitingBridgeProviderInventory(raw, {
      targetClaimIds,
    });
  }

  function preservationFrame(ledger) {
    const registry = leaseStore.readRegistry ? leaseStore.readRegistry() : leaseStore.read();
    const directClaimIds = ledger.entries.filter(entry => entry.action === "claim"
      && entry.claimCore?.predecessorClaimId === bridgeClaimId).map(entry => entry.claimId);
    const provider = providerInventory([
      anchorClaimId, bridgeClaimId, successorClaimId, ...directClaimIds,
    ]);
    const registryRecords = Object.entries(registry.leases || {}).map(([branch, lease]) =>
      Object.freeze({
        claimId: lease?.cloudAuthority?.claimId || null,
        cloudClaimDigest: lease?.cloudAuthority?.claimDigest || null,
        branch,
        leaseDigest: digestValue(lease),
        pullRequestUrl: lease?.pullRequestUrl || null,
      }));
    const registryAssociations = claimId => registryRecords.filter(
      record => record.claimId === claimId,
    );
    const anchorPulls = provider.associations(anchorClaimId);
    const anchorPull = anchorPulls.length === 1 ? anchorPulls[0] : null;
    const anchorPullUrlSuffix = anchorPull ? `/pull/${anchorPull.number}` : null;
    const associations = Object.freeze({
      anchorRegistryMatches: registryAssociations(anchorClaimId),
      anchorPullRequestMarkerMatches: anchorPulls,
      anchorRegistryBranchCollisions: anchorPull ? registryRecords.filter(record =>
        record.claimId !== anchorClaimId && record.branch === anchorPull.markerBranch) : [],
      anchorRegistryPullRequestCollisions: anchorPull ? registryRecords.filter(record =>
        record.claimId !== anchorClaimId && String(record.pullRequestUrl || "")
          .endsWith(anchorPullUrlSuffix)) : [],
      bridgeRegistryMatches: registryAssociations(bridgeClaimId),
      bridgePullRequestMarkerMatches: provider.associations(bridgeClaimId),
      successorRegistryMatches: registryAssociations(successorClaimId),
      successorPullRequestMarkerMatches: provider.associations(successorClaimId),
    });
    validateAnchorAssociation(associations);
    const providerProjection = Object.freeze({
      totalCount: provider.totalCount,
      pageCount: provider.pageCount,
      pulls: provider.projected,
    });
    return Object.freeze({
      associations,
      registryAssociations,
      providerAssociations: claimId => provider.associations(claimId),
      preservation: Object.freeze({
        gitRefsDigest: digestValue(gitRaw(["show-ref"])),
        gitWorktreesDigest: digestValue(gitRaw(["worktree", "list", "--porcelain", "-z"])),
        registryDigest: digestValue(registry),
        providerDigest: digestValue(providerProjection),
        associationDigest: digestValue(associations),
      }),
    });
  }

  function validateAnchorAssociation(associations) {
    const registry = associations.anchorRegistryMatches;
    const pulls = associations.anchorPullRequestMarkerMatches;
    if (pulls.length !== 1 || ![0, 1].includes(registry.length)) return;
    if (pulls[0].state !== "OPEN" || pulls[0].markerBranch !== pulls[0].headRefName) {
      invalid("anchor exact open ownership-PR marker");
    }
    if (registry.length === 0) {
      if (associations.anchorRegistryBranchCollisions.length !== 0
        || associations.anchorRegistryPullRequestCollisions.length !== 0) {
        invalid("provider-only anchor local collision");
      }
      return;
    }
    const match = /\/pull\/(\d+)(?:\/?$)/u.exec(String(registry[0].pullRequestUrl || ""));
    if (!match || Number(match[1]) !== pulls[0].number
      || registry[0].branch !== pulls[0].markerBranch
      || registry[0].branch !== pulls[0].headRefName) {
      invalid("anchor registry/ownership-PR join");
    }
  }

  function priorRetirementJournal() {
    const raw = retirementStore.readJournal();
    if (!raw) return null;
    const journal = normalizeWaitingBridgeJournal(raw);
    if (journal.operation !== BRIDGE_RETIREMENT_OPERATION) invalid("Phase A journal operation");
    return journal;
  }

  function captureFrame() {
    const observedAt = now().toISOString();
    const repositoryIdentity = repositoryEvidence();
    const controller = controllerEvidence();
    const status = cloudStatus();
    const ledger = ledgerFor(status);
    const preservation = preservationFrame(ledger);
    const entriesFor = claimId => ledger.entries.filter(entry => entry.claimId === claimId);
    const matchesFor = claimId => status.claims.filter(claim => claim.claimId === claimId);
    const anchorEntries = entriesFor(anchorClaimId);
    const bridgeEntries = entriesFor(bridgeClaimId);
    const successorEntries = entriesFor(successorClaimId);
    const anchorMatches = matchesFor(anchorClaimId);
    const bridgeMatches = matchesFor(bridgeClaimId);
    const successorMatches = matchesFor(successorClaimId);
    if (!anchorEntries.length || !bridgeEntries.length || !successorEntries.length
      || anchorMatches.length !== 1 || bridgeMatches.length > 1 || successorMatches.length > 1) {
      invalid("chain inventory cardinality");
    }
    const retirement = priorRetirementJournal();
    const retirementEvidence = retirement?.plan?.evidence || null;
    const currentRetirementRaw = retirementStore.readJournal();
    const currentPromotionRaw = currentStore.readJournal();
    const currentRetirement = currentRetirementRaw
      ? normalizeWaitingBridgeJournal(currentRetirementRaw) : null;
    const currentPromotion = currentPromotionRaw
      ? normalizeWaitingBridgeJournal(currentPromotionRaw) : null;
    const sealedEvidence = currentPromotion?.plan?.evidence
      || currentRetirement?.plan?.evidence || retirementEvidence;
    const anchor = projectClaimOnlyClaim(anchorMatches[0], anchorEntries[0]);
    const bridge = bridgeMatches.length === 1
      ? projectClaimOnlyClaim(bridgeMatches[0], bridgeEntries[0])
      : sealedEvidence?.bridge || null;
    const successor = successorMatches.length === 1
      && successorMatches[0].recordedState === "waiting-successor"
      ? projectClaimOnlyClaim(successorMatches[0], successorEntries[0])
      : sealedEvidence?.successor || null;
    if (!bridge || !successor) invalid("sealed original chain subjects");
    const latestAnchorEntry = exactEntryProjection(anchorEntries.at(-1));
    const bridgeEntry = exactEntryProjection(bridgeEntries[0]);
    const successorEntry = exactEntryProjection(successorEntries[0]);
    const mainSha = controller.remoteMainSha;
    return Object.freeze({
      observedAt, repositoryIdentity, controller, status, ledger, mainSha,
      anchorEntries, bridgeEntries, successorEntries,
      anchorMatches, bridgeMatches, successorMatches,
      anchor, bridge, successor,
      anchorEntry: latestAnchorEntry, bridgeEntry, successorEntry,
      ...preservation,
    });
  }

  function isAncestor(base, head) {
    try { git(["merge-base", "--is-ancestor", base, head]); return true; }
    catch { return false; }
  }

  function directSuccessorTopology(frame) {
    return projectWaitingBridgeDirectSuccessorTopology({
      ledger: frame.ledger,
      statusClaims: frame.status.claims,
      bridgeClaimId,
      successorClaimId,
      registryAssociations: frame.registryAssociations,
      providerAssociations: frame.providerAssociations,
    });
  }

  function peerFrame(frame) {
    const triad = [frame.anchor, frame.bridge, frame.successor];
    const relevant = frame.status.claims.filter(claim => claim.repositoryId === frame.anchor.repositoryId
      && triad.some(member => writeSetsOverlap(
        claim.declaredWriteScope, member.declaredWriteScope,
      )));
    const triadIds = new Set(triad.map(claim => claim.claimId));
    const connected = frame.status.claims.filter(claim => (
      claim.repositoryId === frame.anchor.repositoryId
      && (triadIds.has(claim.claimId) || triadIds.has(claim.predecessorClaimId))
    ));
    return Object.freeze({
      reservedClaimIds: relevant.filter(claim => claim.scopeReserved)
        .map(claim => claim.claimId).sort(),
      waitingClaimIds: relevant.filter(claim => claim.state === "waiting-successor")
        .map(claim => claim.claimId).sort(),
      relevantClaimIds: relevant.map(claim => claim.claimId).sort(),
      predecessorConnectedClaimIds: connected.map(claim => claim.claimId).sort(),
      ...directSuccessorTopology(frame),
    });
  }

  function baseEvidence(frame, schema) {
    return {
      schema,
      observedAt: frame.observedAt,
      repository: frame.repositoryIdentity,
      controller: frame.controller,
      canonical: {
        targetRepository,
        mainSha: frame.mainSha,
        anchorBaseContained: isAncestor(frame.anchor.canonicalBaseRevision, frame.mainSha),
        bridgeBaseContained: isAncestor(frame.bridge.canonicalBaseRevision, frame.mainSha),
        successorBaseContained: isAncestor(frame.successor.canonicalBaseRevision, frame.mainSha),
      },
      cloud: {
        ledgerRepository,
        ledgerRevision: frame.status.ledgerRevision,
        ledgerDigest: frame.status.ledgerDigest,
        sequence: frame.status.sequence,
        validatedLedgerDigest: digestValue(frame.ledger),
        inventoryDigest: digestValue(frame.status.claims),
      },
      anchor: frame.anchor,
      bridge: frame.bridge,
      successor: frame.successor,
      anchorEntry: frame.anchorEntry,
      bridgeEntry: frame.bridgeEntry,
      successorEntry: frame.successorEntry,
      anchorLineageCount: frame.anchorEntries.length,
      bridgeLineageCount: frame.bridgeEntries.length,
      successorLineageCount: frame.successorEntries.length,
      associations: frame.associations,
      preservation: frame.preservation,
      directSuccessorTopology: directSuccessorTopology(frame),
      topology: {
        anchorBridge: writeSetsOverlap(frame.anchor.declaredWriteScope,
          frame.bridge.declaredWriteScope),
        bridgeSuccessor: writeSetsOverlap(frame.bridge.declaredWriteScope,
          frame.successor.declaredWriteScope),
        anchorSuccessor: writeSetsOverlap(frame.anchor.declaredWriteScope,
          frame.successor.declaredWriteScope),
      },
    };
  }

  function observeRetirement() {
    const frame = captureFrame();
    if (frame.bridgeMatches.length !== 1 || frame.successorMatches.length !== 1
      || frame.bridgeEntries.length !== 1 || frame.successorEntries.length !== 1) {
      invalid("Phase A original waiter cardinality");
    }
    return Object.freeze({
      ...baseEvidence(frame, BRIDGE_RETIREMENT_EVIDENCE_SCHEMA),
      peerFrame: peerFrame(frame),
    });
  }

  function promotionPriority(frame) {
    const liveSuccessor = frame.successorMatches[0];
    const overlap = claimOnlyOverlapFrame(frame.status.claims, liveSuccessor);
    const waiting = overlap.waitingClaimIds.map(claimId => {
      const claim = frame.status.claims.find(item => item.claimId === claimId);
      return Object.freeze({
        claimId,
        eligibleSince: claim.eligibleSince,
        ledgerSequence: claim.ledgerSequence,
      });
    });
    return Object.freeze({
      reservedOverlapClaimIds: overlap.reservedClaimIds,
      eligibleWaiting: Object.freeze(waiting),
      selectedClaimId: waiting[0]?.claimId || null,
      successorLedgerSequence: frame.successorEntry.sequence,
    });
  }

  function observePromotion() {
    const frame = captureFrame();
    const prior = priorRetirementJournal();
    if (!prior || prior.state?.phase !== "complete") {
      invalid("terminal Phase A journal");
    }
    if (frame.bridgeMatches.length !== 0 || frame.bridgeEntries.length !== 2
      || frame.successorMatches.length !== 1 || frame.successorEntries.length !== 1
      || frame.successorMatches[0].recordedState !== "waiting-successor") {
      invalid("Phase B original waiter/retired bridge cardinality");
    }
    const result = normalizeWaitingBridgeResult(
      prior.state.receipts.complete.result, BRIDGE_RETIREMENT_OPERATION,
    );
    const terminal = frame.bridgeEntries[1];
    validateClaimOnlyRetirementTerminal({
      entry: terminal,
      plan: prior.plan,
      claim: prior.plan.evidence.bridge,
      phase: "bridge-retired",
      operationKey: waitingBridgeOperationKey(prior.plan, "bridge-retired"),
    });
    return Object.freeze({
      ...baseEvidence(frame, SUCCESSOR_PROMOTION_EVIDENCE_SCHEMA),
      bridgeCurrentCount: 0,
      ttlSeconds,
      priority: promotionPriority(frame),
      phaseA: Object.freeze({
        plan: prior.plan,
        result,
        resultDigest: result.resultDigest,
        bridgeRetirementEntry: exactEntryProjection(terminal),
        effectDigest: result.effectDigest,
      }),
    });
  }

  function prepare({ plan }) {
    const fresh = plan.operation === BRIDGE_RETIREMENT_OPERATION
      ? observeRetirement() : observePromotion();
    requireStableWaitingBridgeEvidence(plan.evidence, fresh, plan.operation);
    if (plan.operation === SUCCESSOR_PROMOTION_OPERATION) {
      preflightPromotion(plan, captureFrame());
    }
    return Object.freeze({
      stableFrameDigest: stableWaitingBridgeEvidenceDigest(fresh, plan.operation),
    });
  }

  function requirePreservedPlanFrame(plan, frame) {
    const fresh = baseEvidence(frame, plan.evidence.schema);
    const keys = [
      "repository", "controller", "canonical", "anchor", "bridge", "successor",
      "anchorEntry", "bridgeEntry", "successorEntry", "anchorLineageCount",
      "associations", "preservation", "directSuccessorTopology", "topology",
    ];
    for (const key of keys) {
      if (canonicalJson(fresh[key]) !== canonicalJson(plan.evidence[key])) {
        invalid(`preserved ${key} frame`);
      }
    }
  }

  function requireOriginalClaim(expected, matches, genesis, label) {
    if (matches.length !== 1
      || canonicalJson(projectClaimOnlyClaim(matches[0], genesis)) !== canonicalJson(expected)) {
      invalid(`${label} original claim`);
    }
  }

  function requireRetirementReady(plan, frame) {
    requirePreservedPlanFrame(plan, frame);
    requireOriginalClaim(plan.evidence.anchor, frame.anchorMatches,
      frame.anchorEntries[0], "anchor");
    requireOriginalClaim(plan.evidence.bridge, frame.bridgeMatches,
      frame.bridgeEntries[0], "bridge");
    requireOriginalClaim(plan.evidence.successor, frame.successorMatches,
      frame.successorEntries[0], "successor");
    if (frame.bridgeEntries.length !== 1 || frame.successorEntries.length !== 1
      || canonicalJson(peerFrame(frame)) !== canonicalJson(plan.evidence.peerFrame)) {
      invalid("Phase A immediately-pre-CAS frame");
    }
  }

  function preflightPromotion(plan, frame) {
    requirePreservedPlanFrame(plan, frame);
    if (frame.bridgeMatches.length !== 0 || frame.bridgeEntries.length !== 2
      || frame.successorEntries.length !== 1) invalid("Phase B immediately-pre-CAS lineage");
    requireOriginalClaim(plan.evidence.successor, frame.successorMatches,
      frame.successorEntries[0], "successor");
    const priority = promotionPriority(frame);
    if (canonicalJson(priority) !== canonicalJson(plan.evidence.priority)) {
      invalid("Phase B canonical promotion priority");
    }
    const evaluationTime = frame.observedAt;
    const expiresAt = new Date(Date.parse(evaluationTime)
      + plan.evidence.ttlSeconds * 1_000).toISOString();
    applyCloudTransition({
      ledger: frame.ledger,
      action: "continue",
      actor: {
        actorId: plan.evidence.successor.actorId,
        deviceId: plan.evidence.successor.deviceId,
        sessionId: plan.evidence.successor.sessionId,
      },
      repository: { repositoryId: plan.evidence.successor.repositoryId },
      evaluationTime,
      request: {
        claimId: plan.successorClaimId,
        expectedFenceRevision: plan.evidence.successor.claimDigest,
        expectedTransitionCounter: 1,
        expectedLedgerDigest: frame.status.ledgerDigest,
        mode: "promote",
        expiresAt,
        deviceId: plan.evidence.successor.deviceId,
        sessionId: plan.evidence.successor.sessionId,
        idempotencyKey: waitingBridgeOperationKey(plan, "successor-promoted"),
      },
    });
  }

  function bridgeTerminal(frame, context, result = null) {
    requirePreservedPlanFrame(context.plan, frame);
    requireOriginalClaim(context.plan.evidence.anchor, frame.anchorMatches,
      frame.anchorEntries[0], "preserved anchor");
    requireOriginalClaim(context.plan.evidence.successor, frame.successorMatches,
      frame.successorEntries[0], "preserved successor");
    if (frame.bridgeMatches.length !== 0 || frame.bridgeEntries.length !== 2) {
      invalid("bridge retirement terminal cardinality");
    }
    const terminal = frame.bridgeEntries[1];
    const outcome = validateClaimOnlyRetirementTerminal({
      entry: terminal,
      plan: context.plan,
      claim: context.plan.evidence.bridge,
      phase: "bridge-retired",
      operationKey: context.operationKey,
      result,
    });
    const execution = confirmed.get(context.operationKey);
    const values = {
      operationKey: context.operationKey,
      claimId: context.plan.bridgeClaimId,
      requestDigest: outcome.requestDigest,
      operationReceiptDigest: outcome.operationReceiptDigest,
      terminalEntryDigest: outcome.terminalEntryDigest,
      terminalClaimDigest: terminal.claimDigest,
      transportReceiptDigest: execution?.receipt?.receiptDigest || null,
      disposition: execution ? "projected" : "adopted-response-loss",
      providerMutation: Boolean(execution),
    };
    return Object.freeze({ ...values, effectDigest: waitingBridgeEffectDigest(values) });
  }

  function classifyBridgeRetired(context) {
    const frame = captureFrame();
    if (frame.bridgeEntries.length === 1 && frame.bridgeMatches.length === 1) {
      requireRetirementReady(context.plan, frame);
      return Object.freeze({ state: "pending" });
    }
    return Object.freeze({
      state: "complete",
      values: bridgeTerminal(frame, context, confirmed.get(context.operationKey) || null),
    });
  }

  function retireBridge(context) {
    const before = captureFrame();
    requireRetirementReady(context.plan, before);
    const claim = context.plan.evidence.bridge;
    let result;
    try {
      result = invoke({
        action: "retire",
        ledgerRepository,
        request: {
          targetRepository,
          ...buildClaimOnlyRetirementRequest(
            context.plan, claim, "bridge-retired", context.operationKey,
            before.status.ledgerDigest,
          ),
        },
        environment,
      });
    } catch (error) {
      throw error;
    }
    try {
      const after = captureFrame();
      bridgeTerminal(after, context, result);
    } catch (error) { throw error; }
    confirmed.set(context.operationKey, result);
    return result;
  }

  function promotionEntry(frame, plan, operationKey) {
    const entries = frame.successorEntries;
    const expectedKey = digestValue(operationKey);
    const candidates = entries.filter(entry => entry.action === "continue"
      && entry.idempotencyKey === expectedKey);
    if (candidates.length === 0) return null;
    if (candidates.length !== 1 || entries[0].action !== "claim"
      || entries[0].claimId !== plan.successorClaimId) {
      invalid("promotion historical operation cardinality");
    }
    const terminal = candidates[0];
    if (entries.indexOf(terminal) !== 1 || terminal.schema !== ENTRY_SCHEMA
      || terminal.claimId !== plan.successorClaimId || terminal.claimCore.state !== "current"
      || terminal.claimCore.transitionCounter !== 2
      || terminal.claimCore.heartbeatCounter !== 0
      || terminal.claimCore.predecessorClaimId !== plan.bridgeClaimId
      || terminal.claimCore.eligibleSince !== plan.evidence.successor.eligibleSince
      || terminal.claimCore.promotedAt !== terminal.evaluationTime
      || terminal.claimCore.reviewRequestId !== null
      || terminal.claimCore.evidenceDigest !== null
      || terminal.claimCore.recovery !== undefined
      || terminal.claimCore.integration !== undefined
      || terminal.claimCore.retirement !== undefined) {
      invalid("exact historical successor promotion");
    }
    const expectedExpiry = new Date(Date.parse(terminal.evaluationTime)
      + plan.evidence.ttlSeconds * 1_000).toISOString();
    if (terminal.claimCore.expiresAt !== expectedExpiry
      || terminal.requestDigest !== successorPromotionEntryRequestDigest(plan, expectedExpiry)) {
      invalid("promotion fresh TTL/request digest");
    }
    const prefix = {
      ...frame.ledger,
      sequence: terminal.sequence - 1,
      headDigest: terminal.parentDigest,
      entries: frame.ledger.entries.slice(0, frame.ledger.entries.indexOf(terminal)),
    };
    const simulated = applyCloudTransition({
      ledger: prefix,
      action: "continue",
      actor: {
        actorId: plan.evidence.successor.actorId,
        deviceId: plan.evidence.successor.deviceId,
        sessionId: plan.evidence.successor.sessionId,
      },
      repository: { repositoryId: plan.evidence.successor.repositoryId },
      evaluationTime: terminal.evaluationTime,
      request: {
        claimId: plan.successorClaimId,
        expectedFenceRevision: plan.evidence.successor.claimDigest,
        expectedTransitionCounter: 1,
        expectedLedgerDigest: terminal.parentDigest,
        mode: "promote",
        expiresAt: expectedExpiry,
        deviceId: plan.evidence.successor.deviceId,
        sessionId: plan.evidence.successor.sessionId,
        idempotencyKey: operationKey,
      },
    });
    if (canonicalJson(simulated.entry) !== canonicalJson(terminal)) {
      invalid("operation-derived successor promotion");
    }
    return terminal;
  }

  function validatePromotionResult(result, terminal) {
    const receipt = claimOnlyOperationReceiptForEntry(terminal, "current");
    if (result?.schema !== "agentic-cloud-collaboration-result/v1"
      || result.ok !== true || result.action !== "continue"
      || result.status !== "current" || result.claim?.claimId !== terminal.claimId
      || result.claim?.fenceRevision !== terminal.claimDigest
      || result.claim?.transitionDigest !== terminal.digest
      || result.claim?.transitionCounter !== 2
      || canonicalJson(result.operationReceipt) !== canonicalJson(receipt)
      || result.receipt?.claimId !== terminal.claimId
      || result.receipt?.claimDigest !== terminal.claimDigest
      || result.receipt?.contractReceiptDigest !== receipt.receiptDigest
      || result.receipt?.receiptDigest !== digestValue((({ receiptDigest: _, ...core }) => core)(
        result.receipt,
      ))) {
      invalid("successor promotion provider result");
    }
    return receipt;
  }

  function authorityOutput(plan, terminal, receipt, frame) {
    const output = buildWaitingBridgePromotionAuthorityOutput({
      plan, terminal, receipt, status: frame.status, ledgerRepository, targetRepository,
    });
    const normalized = normalizeCloudAuthority(output, {
      ledgerRepository,
      targetRepository,
      manifest: {
        declaredWriteSet: plan.evidence.successor.declaredWriteScope,
        writeSetDigest: plan.evidence.successor.writeSetDigest,
      },
      canonicalBaseSha: plan.evidence.successor.canonicalBaseRevision,
      now: new Date(terminal.evaluationTime),
    });
    if (normalized.claimId !== terminal.claimId
      || normalized.claimDigest !== terminal.claimDigest
      || normalized.transitionCounter !== 2) {
      invalid("directly consumable promotion authority output");
    }
    return output;
  }

  function promotionTerminal(frame, context, result = null) {
    requirePreservedPlanFrame(context.plan, frame);
    requireOriginalClaim(context.plan.evidence.anchor, frame.anchorMatches,
      frame.anchorEntries[0], "preserved anchor");
    if (frame.bridgeMatches.length !== 0 || frame.bridgeEntries.length !== 2) {
      invalid("preserved retired bridge");
    }
    validateClaimOnlyRetirementTerminal({
      entry: frame.bridgeEntries[1],
      plan: context.plan.evidence.phaseA.plan,
      claim: context.plan.evidence.bridge,
      phase: "bridge-retired",
      operationKey: waitingBridgeOperationKey(
        context.plan.evidence.phaseA.plan, "bridge-retired",
      ),
    });
    const terminal = promotionEntry(frame, context.plan, context.operationKey);
    if (!terminal) return null;
    const receipt = result ? validatePromotionResult(result, terminal)
      : claimOnlyOperationReceiptForEntry(terminal, "current");
    const output = authorityOutput(context.plan, terminal, receipt, frame);
    if (currentStore.claimOutputPath) currentStore.writeClaimOutput(output);
    const execution = confirmed.get(context.operationKey);
    const values = {
      operationKey: context.operationKey,
      claimId: context.plan.successorClaimId,
      requestDigest: terminal.requestDigest,
      operationReceiptDigest: receipt.receiptDigest,
      terminalEntryDigest: terminal.digest,
      terminalClaimDigest: terminal.claimDigest,
      transportReceiptDigest: execution?.receipt?.receiptDigest || null,
      disposition: execution ? "projected" : "adopted-response-loss",
      providerMutation: Boolean(execution),
      authorityOutputDigest: output.authorityDigest,
      evaluationTime: terminal.evaluationTime,
      expiresAt: terminal.claimCore.expiresAt,
    };
    return Object.freeze({ ...values, effectDigest: waitingBridgeEffectDigest(values) });
  }

  function classifySuccessorPromoted(context) {
    const frame = captureFrame();
    const terminal = promotionTerminal(frame, context,
      confirmed.get(context.operationKey) || null);
    if (terminal) return Object.freeze({ state: "complete", values: terminal });
    preflightPromotion(context.plan, frame);
    return Object.freeze({ state: "pending" });
  }

  function promoteSuccessor(context) {
    const before = captureFrame();
    preflightPromotion(context.plan, before);
    const claim = context.plan.evidence.successor;
    let result;
    try {
      result = invoke({
        action: "continue",
        ledgerRepository,
        request: {
          targetRepository,
          claimId: claim.claimId,
          expectedFenceRevision: claim.claimDigest,
          expectedTransitionCounter: 1,
          expectedLedgerDigest: before.status.ledgerDigest,
          mode: "promote",
          ttlSeconds: context.plan.evidence.ttlSeconds,
          deviceId: claim.deviceId,
          sessionId: claim.sessionId,
          idempotencyKey: context.operationKey,
        },
        environment,
      });
    } catch (error) {
      throw error;
    }
    try {
      const after = captureFrame();
      const terminal = promotionTerminal(after, context, result);
      if (!terminal) invalid("immediate promotion terminal state");
    } catch (error) { throw error; }
    confirmed.set(context.operationKey, result);
    return result;
  }

  function verifyTerminal({ plan, journal }) {
    const frame = captureFrame();
    const phase = plan.operation === BRIDGE_RETIREMENT_OPERATION
      ? "bridge-retired" : "successor-promoted";
    const context = {
      plan, journal, phase, operationKey: waitingBridgeOperationKey(plan, phase),
    };
    const values = plan.operation === BRIDGE_RETIREMENT_OPERATION
      ? bridgeTerminal(frame, context, confirmed.get(context.operationKey) || null)
      : promotionTerminal(frame, context, confirmed.get(context.operationKey) || null);
    if (!values) invalid("terminal effect absence");
    const effectDigest = waitingBridgeEffectDigest(values);
    return Object.freeze({
      effectDigest,
      terminalRelevantDigest: waitingBridgeTerminalRelevantDigest(plan, values),
      preservationDigest: waitingBridgePreservationDigest(plan),
    });
  }

  return Object.freeze({
    withOperationLock(context, action) {
      return storeFor(context.operation).withOperationLock(context, action);
    },
    readJournal(operation) { return storeFor(operation).readJournal(); },
    writeJournal({ operation, expected, next }) {
      return storeFor(operation).writeJournal({ expected, next });
    },
    observeRetirement,
    observePromotion,
    prepare,
    classifyBridgeRetired,
    retireBridge,
    classifySuccessorPromoted,
    promoteSuccessor,
    verifyTerminal,
  });
}

function text(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label);
  return value.trim();
}
function digest(value, label) {
  if (!DIGEST.test(String(value || ""))) invalid(label);
  return value;
}
function integer(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) invalid(label);
  return value;
}
function objectLike(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value;
}
function sameDirectSuccessorSubject(left, right) {
  const immutable = value => {
    const { transitionCounter: _transition, heartbeatCounter: _heartbeat,
      state: _state, retirement: _retirement, ...subject } = value || {};
    return subject;
  };
  return canonicalJson(immutable(left)) === canonicalJson(immutable(right));
}
function invalid(label) {
  throw new Error(`Waiting-bridge repository ${label} is invalid.`);
}

function exactEntryProjection(entry) {
  return Object.freeze({
    ...projectClaimOnlyEntry(entry),
    actorId: entry.claimCore.actorId,
    deviceId: entry.claimCore.deviceId,
    sessionId: entry.claimCore.sessionId,
    workItemId: entry.claimCore.workItemId,
    canonicalBaseRevision: entry.claimCore.canonicalBaseRevision,
    laneRevision: entry.claimCore.laneRevision,
    declaredWriteScope: entry.claimCore.declaredWriteScope,
    writeSetDigest: entry.claimCore.writeSetDigest,
    leaseEpoch: entry.claimCore.leaseEpoch,
    eligibleSince: entry.claimCore.eligibleSince ?? null,
  });
}
