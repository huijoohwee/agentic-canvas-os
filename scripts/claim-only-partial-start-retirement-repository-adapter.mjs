// Responsibility: Join protected GitHub/C3 evidence to claim-only cloud effects and no local effects.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, digestValue, validateLedger, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
import { proveLegacyReviewCanonicalDescendant } from "./legacy-clean-committed-lane-bootstrap-adapter-lib.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { invokeRepositoryCloudVerifier } from "./cloud-collaboration-delivery-verifier.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";
import {
  RETIREMENT_OPERATION, ROLLOVER_OPERATION, buildClaimOnlyTerminalVerification,
  claimOnlyOperationKey, normalizeClaimOnlyCompletionReceipt, normalizeClaimOnlyJournal,
} from "./claim-only-partial-start-retirement-contract.mjs";
import {
  buildClaimOnlyRetirementRequest as retirementRequest,
  captureClaimOnlyControllerEvidence, captureClaimOnlyRepositoryIdentity,
  claimOnlyOverlapFrame as overlapFrame,
  claimOnlyReplacementEvidence as replacementEvidence,
  claimOnlyRepositoryName as repositoryName,
  createClaimOnlyPartialStartRetirementStore,
  projectClaimOnlyClaim as projectClaim, projectClaimOnlyEntry as projectEntry,
  readClaimOnlyPrivateJson,
} from "./claim-only-partial-start-retirement-store.mjs";
import {
  assertClaimOnlyOverlap, assertClaimOnlyReplacement as assertReplacement,
  assertClaimOnlyRetirementOverlap as assertRetirementOverlap,
  buildClaimOnlyObservedEvidence, preflightClaimOnlyRollover,
  projectClaimOnlyProviderPulls, requireLiveClaimOnlyClaim as requireLiveClaim,
  requireStableClaimOnlyPlanEvidence as requireStablePlanEvidence,
  requireStableClaimOnlyTerminalBase as requireStableTerminalBase,
  stableClaimOnlyEvidence as stableEvidence, validateClaimOnlyRawAuthority,
  validateClaimOnlyReplacementTerminal, validateClaimOnlyRetirementTerminal,
} from "./claim-only-partial-start-retirement-controller.mjs";
const CONTROLLER_ROOT = fileURLToPath(new URL("..", import.meta.url));
const RUNTIME_FILES = Object.freeze([
  "scripts/claim-only-partial-start-retirement-contract.mjs",
  "scripts/claim-only-partial-start-retirement-controller.mjs",
  "scripts/claim-only-partial-start-retirement-repository-adapter.mjs",
  "scripts/claim-only-partial-start-retirement-store.mjs",
  "scripts/claim-only-partial-start-retirement.mjs",
]);
const DIGEST = /^[0-9a-f]{64}$/u;
export function createRepositoryClaimOnlyPartialStartRetirementAdapter(options = {}, dependencies = {}) {
  const repository = realpathSync(path.resolve(text(options.repository, "repository")));
  const controllerRoot = realpathSync(path.resolve(options.controllerRoot || CONTROLLER_ROOT));
  if (controllerRoot !== realpathSync(CONTROLLER_ROOT)) {
    throw new Error("Claim-only operation requires its exact installed controller root.");
  }
  const targetRepository = repositoryName(options.targetRepository);
  const ledgerRepository = repositoryName(options.ledgerRepository || "huijoohwee/agentic-canvas-os");
  if (targetRepository !== ledgerRepository) {
    invalid("target/controller/ledger repository equality");
  }
  const sourceClaimId = digest(options.sourceClaimId, "source claim ID");
  const successorClaimId = digest(options.successorClaimId, "successor claim ID");
  const ttlSeconds = integer(options.ttlSeconds ?? 1_800, "replacement TTL", 60, 86_400);
  const environment = dependencies.environment || process.env;
  const now = dependencies.now || (() => new Date());
  const execute = dependencies.execute || ((command, argumentsList, cwd = repository) => execFileSync(command, argumentsList, {
    cwd,
    encoding: "utf8",
    env: environment,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000
  }));
  const git = dependencies.git || ((argumentsList, cwd = repository) => String(execute("git", argumentsList, cwd)).trim());
  const gitRaw = dependencies.gitRaw || ((argumentsList, cwd = repository) => String(execute("git", argumentsList, cwd)));
  const gh = dependencies.gh || (argumentsList => String(execute("gh", argumentsList)).trim());
  const invoke = dependencies.invoke || invokeRepositoryCloudAction;
  const verify = dependencies.verify || invokeRepositoryCloudVerifier;
  const commonDirectory = realpathSync(path.resolve(repository, git(["rev-parse", "--path-format=absolute", "--git-common-dir"])));
  const controllerCommonDirectory = realpathSync(path.resolve(controllerRoot, git(["rev-parse", "--path-format=absolute", "--git-common-dir"], controllerRoot)));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory
  });
  const store = dependencies.store || createClaimOnlyPartialStartRetirementStore({
    statePath: options.statePath,
    claimOutputPath: options.claimOutputPath || null,
    now
  });
  const confirmed = new Set();
  const rejectedResults = new Set();
  function repositoryEvidence() {
    return captureClaimOnlyRepositoryIdentity({
      repository,
      commonDirectory,
      targetRepository,
      git,
      readProvider: () => dependencies.readRepositoryIdentity ? dependencies.readRepositoryIdentity({
        targetRepository
      }) : JSON.parse(gh(["repo", "view", targetRepository, "--json", "id,nameWithOwner"]))
    });
  }
  function cloudStatus(claimId = null) {
    const result = dependencies.readCloud ? dependencies.readCloud({
      ledgerRepository,
      targetRepository,
      claimId
    }) : invoke({
      action: "status",
      ledgerRepository,
      request: {
        targetRepository,
        ...(claimId ? {
          claimId
        } : {})
      },
      environment
    });
    if (result?.schema !== "agentic-cloud-collaboration-result/v1" || result.ok !== true || result.action !== "status" || !Array.isArray(result.claims) || !Number.isSafeInteger(result.sequence)) invalid("cloud status");
    return result;
  }
  function ledgerFor(status) {
    const ledger = dependencies.readLedger ? dependencies.readLedger({
      ledgerRepository,
      revision: status.ledgerRevision
    }) : JSON.parse(gh(["api", "--method", "GET", "-H", "Accept: application/vnd.github.raw+json", `repos/${ledgerRepository}/contents/.agentic/collaboration-ledger.json`, "-f", `ref=${status.ledgerRevision}`]));
    const failures = validateLedger(ledger);
    if (failures.length || ledger.sequence !== status.sequence || ledger.headDigest !== status.ledgerDigest) {
      throw new Error(`Validated C3 ledger mismatch: ${failures.join("; ")}`);
    }
    return ledger;
  }
  function controllerEvidence() {
    return captureClaimOnlyControllerEvidence({
      controllerRoot,
      commonDirectory: controllerCommonDirectory,
      repository: ledgerRepository,
      git: args => git(args, controllerRoot),
      gitRaw: args => gitRaw(args, controllerRoot),
      readProvider: () => dependencies.readRepositoryIdentity ? dependencies.readRepositoryIdentity({
        targetRepository: ledgerRepository
      }) : JSON.parse(gh(["repo", "view", ledgerRepository, "--json", "id,nameWithOwner"])),
      readProtection: () => dependencies.readProtection ? dependencies.readProtection({
        ledgerRepository
      }) : JSON.parse(gh(["api", `repos/${ledgerRepository}/branches/main`])),
      runtimeFiles: RUNTIME_FILES
    });
  }
  function providerFrame() {
    const pulls = dependencies.readProviderPullRequests ? dependencies.readProviderPullRequests({
      targetRepository
    }) : JSON.parse(gh(["pr", "list", "--repo", targetRepository, "--state", "all", "--limit", "1000", "--json", "number,id,state,isDraft,mergedAt,closedAt,headRefName,headRefOid,baseRefName,baseRefOid,body"]));
    return projectClaimOnlyProviderPulls(pulls);
  }
  function preservationFrame() {
    const registry = leaseStore.read();
    const provider = providerFrame();
    const registryAssociations = claimId => Object.entries(registry.leases || {}).flatMap(([branch, lease]) => lease?.cloudAuthority?.claimId === claimId ? [{
      branch,
      leaseDigest: digestValue(lease)
    }] : []);
    return Object.freeze({
      associations: {
        sourceRegistryMatches: registryAssociations(sourceClaimId),
        sourcePullRequestMarkerMatches: provider.associations(sourceClaimId),
        successorRegistryMatches: registryAssociations(successorClaimId),
        successorPullRequestMarkerMatches: provider.associations(successorClaimId)
      },
      preservation: {
        gitRefsDigest: digestValue(gitRaw(["show-ref"])),
        gitWorktreesDigest: digestValue(gitRaw(["worktree", "list", "--porcelain", "-z"])),
        registryDigest: digestValue(registry),
        providerDigest: digestValue(provider.projected)
      }
    });
  }
  function baseFrame() {
    const observedAt = now().toISOString();
    const repositoryIdentity = repositoryEvidence();
    const controller = controllerEvidence();
    const status = cloudStatus();
    const ledger = ledgerFor(status);
    const sourceEntries = ledger.entries.filter(entry => entry.claimId === sourceClaimId);
    const successorEntries = ledger.entries.filter(entry => entry.claimId === successorClaimId);
    if (!sourceEntries.length || !successorEntries.length) invalid("claim lineage cardinality");
    const sourceGenesis = sourceEntries[0],
      successorGenesis = successorEntries[0];
    const sourceMatches = status.claims.filter(claim => claim.claimId === sourceClaimId);
    const successorMatches = status.claims.filter(claim => claim.claimId === successorClaimId);
    const provider = preservationFrame();
    const mainSha = controller.remoteMainSha;
    const currentJournalValue = store.readJournal();
    const currentJournal = currentJournalValue ? normalizeClaimOnlyJournal(currentJournalValue) : null;
    const priorJournal = retirementJournal();
    const sourceFromJournal = priorJournal?.plan?.evidence?.source || currentJournal?.plan?.evidence?.source || null;
    const sourceEntryFromJournal = priorJournal?.plan?.evidence?.sourceEntry || currentJournal?.plan?.evidence?.sourceEntry || null;
    const successorFromJournal = currentJournal?.plan?.evidence?.successor || null;
    const successorEntryFromJournal = currentJournal?.plan?.evidence?.successorEntry || null;
    const source = sourceMatches.length === 1 ? projectClaim(sourceMatches[0], sourceGenesis) : sourceFromJournal;
    const sourceEntry = sourceEntryFromJournal || projectEntry(sourceGenesis);
    const successor = successorMatches.length === 1 ? projectClaim(successorMatches[0], successorGenesis) : successorFromJournal;
    const successorEntry = successorEntryFromJournal || projectEntry(successorGenesis);
    if (!source || !sourceEntry || !successor || !successorEntry || sourceMatches.length > 1 || successorMatches.length > 1) {
      invalid("current claim cardinality");
    }
    const overlap = overlapFrame(status.claims, successor);
    return Object.freeze({
      observedAt,
      repositoryIdentity,
      controller,
      status,
      ledger,
      sourceEntries,
      successorEntries,
      sourceMatches,
      successorMatches,
      source,
      successor,
      sourceEntry,
      successorEntry,
      mainSha,
      overlap,
      ...provider
    });
  }
  function retirementJournal() {
    if (!options.retirementStatePath) return null;
    const value = readClaimOnlyPrivateJson(path.resolve(options.retirementStatePath), "retirement journal");
    return value ? normalizeClaimOnlyJournal(value) : null;
  }
  function commonEvidence(frame, schema) {
    return buildClaimOnlyObservedEvidence({
      frame: {
        ...frame,
        sourceBaseContained: isAncestor(frame.source.canonicalBaseRevision, frame.mainSha),
        successorBaseContained: isAncestor(frame.successor.canonicalBaseRevision, frame.mainSha)
      },
      schema,
      targetRepository,
      ledgerRepository
    });
  }
  function observeRetirement() {
    const frame = baseFrame();
    if (frame.sourceMatches.length !== 1 || frame.successorMatches.length !== 1) {
      invalid("retirement source/successor cardinality");
    }
    return commonEvidence(frame, "agentic-claim-only-partial-start-retirement-evidence/v1");
  }
  function observeRollover() {
    const frame = baseFrame();
    const prior = retirementJournal();
    if (!prior || prior.operation !== RETIREMENT_OPERATION || prior.state?.phase !== "complete") {
      invalid("complete source-retirement journal");
    }
    if (frame.sourceMatches.length !== 0 || frame.successorMatches.length !== 1) {
      invalid("rollover source/successor inventory cardinality");
    }
    const receipt = normalizeClaimOnlyCompletionReceipt(prior.state.receipts.complete.receipt, RETIREMENT_OPERATION);
    const terminal = frame.sourceEntries.at(-1);
    const priorKey = claimOnlyOperationKey(prior.plan, "source-retired");
    const terminalOutcome = validateClaimOnlyRetirementTerminal({
      entry: terminal,
      plan: prior.plan,
      claim: prior.plan.evidence.source,
      phase: "source-retired",
      operationKey: priorKey
    });
    if (receipt.cloudRetirementOperationKey !== priorKey || receipt.cloudRetirementRequestDigest !== terminalOutcome.requestDigest || receipt.cloudRetirementReceiptDigest !== terminalOutcome.operationReceiptDigest || receipt.cloudRetirementEntryDigest !== terminalOutcome.terminalEntryDigest) {
      invalid("source retirement receipt/entry join");
    }
    const changedPaths = gitRaw(["diff", "--name-only", "--no-renames", "-z", frame.successor.canonicalBaseRevision, frame.mainSha, "--"]).split("\0").filter(Boolean);
    if (frame.successor.canonicalBaseRevision === frame.mainSha || !changedPaths.length) {
      invalid("strict protected-main descendant");
    }
    const canonicalDescendantProof = proveLegacyReviewCanonicalDescendant({
      sourceBaseSha: frame.successor.canonicalBaseRevision,
      targetBaseSha: frame.mainSha,
      protectedMainSha: frame.mainSha,
      canonicalChangedPaths: changedPaths,
      preservedChangedPaths: frame.successor.declaredWriteScope.filter(scope => scope.startsWith("path:")).map(scope => scope.slice(5)),
      sourceIsAncestor: isAncestor(frame.successor.canonicalBaseRevision, frame.mainSha),
      targetIsProtectedAncestor: true
    });
    const replacement = replacementEvidence(frame.successor, frame.mainSha, ttlSeconds);
    const evidence = commonEvidence(frame, "agentic-claim-only-successor-rollover-evidence/v1");
    evidence.sourceCurrentCount = 0;
    evidence.canonical.canonicalDescendantProof = canonicalDescendantProof;
    evidence.retirement = {
      receipt,
      sourceTerminalEntry: projectEntry(terminal)
    };
    evidence.replacement = replacement;
    return evidence;
  }
  function prepare({
    plan
  }) {
    const current = plan.operation === RETIREMENT_OPERATION ? observeRetirement() : observeRollover();
    requireStablePlanEvidence(plan.evidence, current, plan.operation);
    if (plan.operation === ROLLOVER_OPERATION) preflightRollover(plan, current);
    return Object.freeze({
      freshFrameDigest: digestValue(stableEvidence(current, plan.operation))
    });
  }
  function preflightRollover(plan) {
    const status = cloudStatus();
    preflightClaimOnlyRollover({
      plan,
      status,
      ledger: ledgerFor(status),
      simulationTime: now().toISOString()
    });
  }
  function classifyRetired(context, claimId, phase, result = null) {
    if (rejectedResults.has(context.operationKey)) invalid(`${phase} immediate result`);
    const frame = baseFrame();
    requireStableTerminalBase(context.plan.evidence, frame, context.plan.operation);
    if (context.plan.operation === RETIREMENT_OPERATION) {
      requireLiveClaim(context.plan.evidence.successor, frame.successorMatches, frame.successorEntries[0], "waiting successor");
    }
    const current = frame.status.claims.filter(claim => claim.claimId === claimId);
    const entries = frame.ledger.entries.filter(entry => entry.claimId === claimId);
    const terminal = entries.at(-1);
    if (current.length === 1) {
      const expected = claimId === sourceClaimId ? context.plan.evidence.source : context.plan.evidence.successor;
      requireLiveClaim(expected, current, entries[0], phase);
      return Object.freeze({
        state: "pending"
      });
    }
    if (current.length !== 0) {
      throw new Error(`${phase} reached a foreign terminal state.`);
    }
    const expected = claimId === sourceClaimId ? context.plan.evidence.source : context.plan.evidence.successor;
    const outcome = validateClaimOnlyRetirementTerminal({
      entry: terminal,
      plan: context.plan,
      claim: expected,
      phase: context.phase,
      operationKey: context.operationKey,
      result
    });
    return Object.freeze({
      state: "complete",
      values: {
        operationKey: context.operationKey,
        requestDigest: outcome.requestDigest,
        operationReceiptDigest: outcome.operationReceiptDigest,
        terminalEntryDigest: outcome.terminalEntryDigest,
        disposition: result || confirmed.has(context.operationKey) ? "projected" : "adopted",
        cloudMutation: true
      }
    });
  }
  function retire(context, claim, phase) {
    const before = baseFrame();
    requireStableTerminalBase(context.plan.evidence, before, context.plan.operation);
    assertRetirementOverlap(before.overlap, context.plan, phase);
    const matches = before.status.claims.filter(item => item.claimId === claim.claimId);
    const entries = before.ledger.entries.filter(item => item.claimId === claim.claimId);
    requireLiveClaim(claim, matches, entries[0], phase);
    const result = invoke({
      action: "retire",
      ledgerRepository,
      request: {
        targetRepository,
        ...retirementRequest(context.plan, claim, phase, context.operationKey, before.status.ledgerDigest)
      },
      environment
    });
    try {
      classifyRetired(context, claim.claimId, phase, result);
    } catch (error) {
      rejectedResults.add(context.operationKey);
      throw error;
    }
    confirmed.add(context.operationKey);
    return result;
  }
  function claimReplacement(context) {
    const target = context.plan.evidence.replacement;
    const frame = replacementReadyFrame(context.plan);
    const result = invoke({
      action: "claim",
      ledgerRepository,
      request: {
        targetRepository,
        workItemId: target.workItemId,
        canonicalBaseSha: target.canonicalBaseRevision,
        headSha: target.laneRevision,
        declaredWriteSet: target.declaredWriteScope,
        predecessorClaimId: target.predecessorClaimId,
        canonicalDescendantProof: context.plan.evidence.canonical.canonicalDescendantProof,
        leaseEpoch: target.leaseEpoch,
        ttlSeconds: target.ttlSeconds,
        deviceId: target.deviceId,
        sessionId: target.sessionId,
        expectedLedgerDigest: frame.status.ledgerDigest,
        idempotencyKey: context.operationKey
      },
      environment
    });
    const authority = validateRawClaimResult(result, context.plan);
    const complete = validateClaimOnlyReplacementTerminal(baseFrame(), context.plan, context.operationKey, result);
    if (!complete) invalid("immediate replacement terminal state");
    store.writeClaimOutput(result);
    confirmed.add(context.operationKey);
    return authority;
  }
  function classifyReplacementClaimed(context) {
    const raw = store.readClaimOutput();
    if (!raw) {
      replacementReadyFrame(context.plan);
      return Object.freeze({
        state: "pending"
      });
    }
    const authority = validateRawClaimResult(raw, context.plan);
    const frame = baseFrame();
    requireStableTerminalBase(context.plan.evidence, frame, ROLLOVER_OPERATION);
    const target = context.plan.evidence.replacement;
    const matches = frame.status.claims.filter(claim => claim.claimId === target.expectedClaimId);
    if (matches.length !== 1) invalid("replacement current cardinality");
    assertReplacement(matches[0], target);
    const entry = validateClaimOnlyReplacementTerminal(frame, context.plan, context.operationKey, raw);
    const operationReceiptDigest = raw.operationReceipt?.receiptDigest || raw.receipt?.receiptDigest;
    const rawClaimResultDigest = digestValue(raw);
    return Object.freeze({
      state: "complete",
      values: {
        operationKey: context.operationKey,
        operationReceiptDigest: digest(operationReceiptDigest, "replacement operation receipt"),
        terminalEntryDigest: digest(entry.digest, "replacement terminal entry"),
        requestDigest: digest(entry.requestDigest, "replacement request"),
        replacementClaimId: target.expectedClaimId,
        rawClaimResultDigest,
        outputReceiptDigest: digestValue({
          pathDigest: digestValue(store.claimOutputPath),
          rawClaimResultDigest
        }),
        authorityDigest: digestValue(authority),
        disposition: confirmed.has(context.operationKey) ? "projected" : "adopted",
        cloudMutation: true
      }
    });
  }
  function verifyRetirement({
    plan,
    journal
  }) {
    const context = {
      plan,
      journal,
      phase: "source-retired",
      operationKey: claimOnlyOperationKey(plan, "source-retired")
    };
    const retired = classifyRetired(context, sourceClaimId, "source retirement");
    if (retired.state !== "complete") invalid("source retirement terminal state");
    const frame = baseFrame();
    assertClaimOnlyOverlap(frame.overlap, {
      reservedClaimIds: [],
      waitingClaimIds: [successorClaimId]
    });
    if (canonicalJson(projectClaim(frame.successorMatches[0], frame.successorEntries[0])) !== canonicalJson(plan.evidence.successor)) invalid("preserved waiting successor");
    return terminalValues(plan, journal, frame, {
      sourceRetirement: retired.values
    });
  }
  function verifyRollover({
    plan,
    journal
  }) {
    const staleContext = {
      plan,
      journal,
      phase: "stale-successor-retired",
      operationKey: claimOnlyOperationKey(plan, "stale-successor-retired")
    };
    const stale = classifyRetired(staleContext, successorClaimId, "stale successor retirement");
    const replacementContext = {
      plan,
      journal,
      operationKey: claimOnlyOperationKey(plan, "replacement-claimed")
    };
    const replacement = classifyReplacementClaimed(replacementContext);
    if (stale.state !== "complete" || replacement.state !== "complete") {
      invalid("rollover terminal state");
    }
    const frame = baseFrame();
    assertClaimOnlyOverlap(frame.overlap, {
      reservedClaimIds: [plan.evidence.replacement.expectedClaimId],
      waitingClaimIds: []
    });
    return terminalValues(plan, journal, frame, {
      staleSuccessorRetirement: stale.values,
      replacementClaim: replacement.values
    });
  }
  function validateRawClaimResult(raw, plan) {
    return validateClaimOnlyRawAuthority({
      raw,
      plan,
      ledgerRepository,
      targetRepository,
      now: now(),
      environment,
      verify
    });
  }
  function replacementReadyFrame(plan) {
    const frame = baseFrame(),
      target = plan.evidence.replacement;
    requireStableTerminalBase(plan.evidence, frame, ROLLOVER_OPERATION);
    const terminal = frame.successorEntries.at(-1);
    const staleKey = claimOnlyOperationKey(plan, "stale-successor-retired");
    if (frame.successorMatches.length !== 0) invalid("stale successor terminal predecessor");
    validateClaimOnlyRetirementTerminal({
      entry: terminal,
      plan,
      claim: plan.evidence.successor,
      phase: "stale-successor-retired",
      operationKey: staleKey
    });
    const competing = frame.status.claims.filter(claim => (claim.scopeReserved || claim.state === "waiting-successor") && writeSetsOverlap(claim.declaredWriteScope, target.declaredWriteScope) && claim.claimId !== target.expectedClaimId);
    if (competing.length) invalid("replacement competing overlap");
    const replacement = frame.status.claims.filter(claim => claim.claimId === target.expectedClaimId);
    if (replacement.length > 1) invalid("replacement response-loss cardinality");
    if (replacement.length === 1) assertReplacement(replacement[0], target);
    assertClaimOnlyOverlap(frame.overlap, {
      reservedClaimIds: replacement.length ? [target.expectedClaimId] : [],
      waitingClaimIds: []
    });
    return frame;
  }
  function terminalValues(plan, journal, frame, effects) {
    requireStableTerminalBase(plan.evidence, frame, plan.operation);
    return buildClaimOnlyTerminalVerification(journal, {
      effects,
      preservation: frame.preservation
    });
  }
  return Object.freeze({
    withOperationLock: store.withOperationLock,
    readJournal: store.readJournal,
    writeJournal: store.writeJournal,
    observeRetirement,
    observeRollover,
    prepare,
    classifySourceRetired: context => classifyRetired(context, sourceClaimId, "source retirement"),
    retireSource: context => retire(context, context.plan.evidence.source, "source-retired"),
    classifyStaleSuccessorRetired: context => classifyRetired(context, successorClaimId, "stale successor retirement"),
    retireStaleSuccessor: context => retire(context, context.plan.evidence.successor, "stale-successor-retired"),
    classifyReplacementClaimed,
    claimReplacement,
    verifyRetirement,
    verifyRollover
  });
  function isAncestor(base, head) {
    try {
      git(["merge-base", "--is-ancestor", base, head]);
      return true;
    } catch {
      return false;
    }
  }
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
function invalid(label) {
  throw new Error(`Claim-only repository ${label} is invalid.`);
}
