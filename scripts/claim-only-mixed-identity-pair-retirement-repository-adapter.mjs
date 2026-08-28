// Responsibility: Join pair-relevant GitHub/C3 evidence to exactly two cloud retire transitions.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJson, digestValue, validateLedger, writeSetsOverlap,
} from "./cloud-collaboration-primitives.mjs";
import { invokeRepositoryCloudAction } from "./scoped-lane-cloud-authority.mjs";
import { createWriterLeaseStore } from "./writer-lease-lib.mjs";
import {
  captureClaimOnlyControllerEvidence, captureClaimOnlyRepositoryIdentity,
  projectClaimOnlyClaim, projectClaimOnlyEntry,
} from "./claim-only-partial-start-retirement-store.mjs";
import { projectClaimOnlyProviderPulls }
  from "./claim-only-partial-start-retirement-controller.mjs";
import {
  buildMixedIdentityPairRetirementEvidence,
} from "./claim-only-mixed-identity-pair-retirement-evidence.mjs";
import {
  mixedIdentityPairRetirementOperationKey,
} from "./claim-only-mixed-identity-pair-retirement-contract.mjs";
import {
  buildMixedIdentityPairRetirementRequest,
  createMixedIdentityPairRetirementStore,
  validateMixedIdentityPairRetirementTerminal,
} from "./claim-only-mixed-identity-pair-retirement-store.mjs";
const CONTROLLER_ROOT = fileURLToPath(new URL("..", import.meta.url));
const RUNTIME_FILES = Object.freeze([
  "scripts/claim-only-mixed-identity-pair-retirement-evidence.mjs",
  "scripts/claim-only-mixed-identity-pair-retirement-contract.mjs",
  "scripts/claim-only-mixed-identity-pair-retirement-controller.mjs",
  "scripts/claim-only-mixed-identity-pair-retirement-repository-adapter.mjs",
  "scripts/claim-only-mixed-identity-pair-retirement-store.mjs",
  "scripts/claim-only-mixed-identity-pair-retirement.mjs",
]);
const DIGEST = /^[0-9a-f]{64}$/u;
export function createRepositoryMixedIdentityPairRetirementAdapter(
  options = {}, dependencies = {},
) {
  const repository = realpathSync(path.resolve(text(options.repository, "repository")));
  const controllerRoot = realpathSync(path.resolve(options.controllerRoot || CONTROLLER_ROOT));
  if (controllerRoot !== realpathSync(CONTROLLER_ROOT)) {
    invalid("installed controller root");
  }
  const targetRepository = repositoryName(options.targetRepository);
  const ledgerRepository = repositoryName(
    options.ledgerRepository || "huijoohwee/agentic-canvas-os",
  );
  const sourceClaimId = digest(options.sourceClaimId, "source claim ID");
  const waitingSuccessorClaimId = digest(
    options.waitingSuccessorClaimId, "waiting-successor claim ID",
  );
  if (sourceClaimId === waitingSuccessorClaimId) invalid("distinct claim IDs");
  const environment = dependencies.environment || process.env;
  const now = dependencies.now || (() => new Date());
  const execute = dependencies.execute || ((command, argumentsList, cwd = repository) =>
    execFileSync(command, argumentsList, {
      cwd,
      encoding: "utf8",
      env: environment,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    }));
  const git = dependencies.git || ((argumentsList, cwd = repository) =>
    String(execute("git", argumentsList, cwd)).trim());
  const gitRaw = dependencies.gitRaw || ((argumentsList, cwd = repository) =>
    String(execute("git", argumentsList, cwd)));
  const gh = dependencies.gh || (argumentsList => String(execute("gh", argumentsList)).trim());
  const invoke = dependencies.invoke || invokeRepositoryCloudAction;
  const commonDirectory = realpathSync(path.resolve(
    repository, git(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  ));
  const controllerCommonDirectory = realpathSync(path.resolve(
    controllerRoot,
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"], controllerRoot),
  ));
  const leaseStore = dependencies.leaseStore || createWriterLeaseStore({
    gitCommonDir: commonDirectory,
  });
  const store = dependencies.store || createMixedIdentityPairRetirementStore({
    statePath: options.statePath,
    now,
  });
  const confirmedResults = new Map();
  function cloudStatus() {
    const result = dependencies.readCloud ? dependencies.readCloud({
      ledgerRepository, targetRepository,
    }) : invoke({
      action: "status",
      ledgerRepository,
      request: { targetRepository },
      environment,
    });
    if (result?.schema !== "agentic-cloud-collaboration-result/v1" || result.ok !== true
      || result.action !== "status" || !Array.isArray(result.claims)
      || !Number.isSafeInteger(result.sequence)) invalid("cloud status");
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
      throw new Error(`Validated C3 ledger mismatch: ${failures.join("; ")}`);
    }
    return ledger;
  }
  function repositoryEvidence() {
    const value = captureClaimOnlyRepositoryIdentity({
      repository,
      commonDirectory,
      targetRepository,
      git,
      readProvider: () => dependencies.readRepositoryIdentity
        ? dependencies.readRepositoryIdentity({ targetRepository })
        : JSON.parse(gh(["repo", "view", targetRepository, "--json", "id,nameWithOwner"])),
    });
    return Object.freeze({ ...value, ledgerRepository });
  }
  function controllerEvidence() {
    const value = captureClaimOnlyControllerEvidence({
      controllerRoot,
      commonDirectory: controllerCommonDirectory,
      repository: ledgerRepository,
      git: argumentsList => git(argumentsList, controllerRoot),
      gitRaw: argumentsList => gitRaw(argumentsList, controllerRoot),
      readProvider: () => dependencies.readRepositoryIdentity
        ? dependencies.readRepositoryIdentity({ targetRepository: ledgerRepository })
        : JSON.parse(gh(["repo", "view", ledgerRepository, "--json", "id,nameWithOwner"])),
      readProtection: () => dependencies.readProtection
        ? dependencies.readProtection({ ledgerRepository })
        : JSON.parse(gh(["api", `repos/${ledgerRepository}/branches/main`])),
      runtimeFiles: RUNTIME_FILES,
    });
    return Object.freeze({
      repository: value.repository,
      branch: value.branch,
      headSha: value.headSha,
      originMainSha: value.originMainSha,
      remoteMainSha: value.remoteMainSha,
      runtimeDigest: value.runtimeDigest,
      policyDigest: value.protectionDigest,
      clean: value.clean,
      protected: value.protected,
    });
  }
  function associationFrame() {
    const registry = leaseStore.read();
    const pulls = dependencies.readProviderPullRequests
      ? dependencies.readProviderPullRequests({ targetRepository })
      : JSON.parse(gh([
        "pr", "list", "--repo", targetRepository, "--state", "all", "--limit", "1000",
        "--json", "number,id,state,isDraft,mergedAt,closedAt,headRefName,headRefOid,baseRefName,baseRefOid,body",
      ]));
    const provider = projectClaimOnlyProviderPulls(pulls);
    const subject = claimId => {
      const writerLeaseMatches = Object.entries(registry.leases || {}).flatMap(
        ([branch, lease]) => lease?.cloudAuthority?.claimId === claimId
          ? [{ branch, leaseDigest: digestValue(lease) }] : [],
      );
      const pullRequestMarkerMatches = provider.associations(claimId);
      const authoredRevisionAssociations = [
        ...writerLeaseMatches.map(item => ({ kind: "writer-lease", digest: item.leaseDigest })),
        ...pullRequestMarkerMatches.map(item => ({
          kind: "pull-request-marker", digest: item.markerDigest,
        })),
      ];
      return Object.freeze({
        writerLeaseMatches, pullRequestMarkerMatches, authoredRevisionAssociations,
      });
    };
    return Object.freeze({
      source: subject(sourceClaimId),
      waitingSuccessor: subject(waitingSuccessorClaimId),
    });
  }
  function frame(plan = null) {
    const observedAt = now().toISOString();
    const status = cloudStatus();
    const ledger = ledgerFor(status);
    const sourceEntries = ledger.entries.filter(entry => entry.claimId === sourceClaimId);
    const waitingEntries = ledger.entries.filter(entry => entry.claimId === waitingSuccessorClaimId);
    if (!sourceEntries.length || !waitingEntries.length) invalid("claim lineage presence");
    const sourceMatches = status.claims.filter(claim => claim.claimId === sourceClaimId);
    const waitingMatches = status.claims.filter(claim => claim.claimId === waitingSuccessorClaimId);
    if (sourceMatches.length > 1 || waitingMatches.length > 1) invalid("subject cardinality");
    const source = sourceMatches.length
      ? projectClaimOnlyClaim(sourceMatches[0], sourceEntries[0]) : plan?.evidence.source ?? null;
    const waitingSuccessor = waitingMatches.length
      ? projectClaimOnlyClaim(waitingMatches[0], waitingEntries[0])
      : plan?.evidence.waitingSuccessor ?? null;
    const union = plan?.evidence.scopeComparison.union
      || [...new Set([...(source?.declaredWriteScope || []),
        ...(waitingSuccessor?.declaredWriteScope || [])])];
    const relevantClaims = status.claims.filter(claim =>
      writeSetsOverlap(claim.declaredWriteScope, union));
    const waiting = relevantClaims.filter(claim => claim.state === "waiting-successor")
      .sort(compareWaiting);
    const waitingIndex = waiting.findIndex(claim => claim.claimId === waitingSuccessorClaimId);
    const unrelated = status.claims.filter(claim => !relevantClaims.includes(claim));
    const targetMainSha = firstSha(git(["ls-remote", "origin", "refs/heads/main"]));
    return Object.freeze({
      observedAt,
      status,
      ledger,
      repository: repositoryEvidence(),
      controller: controllerEvidence(),
      canonical: {
        mainSha: targetMainSha,
        sourceBaseContained: isAncestor(plan?.evidence.source.canonicalBaseRevision
          || source.canonicalBaseRevision, targetMainSha),
        waitingSuccessorBaseContained: isAncestor(
          plan?.evidence.waitingSuccessor.canonicalBaseRevision
            || waitingSuccessor.canonicalBaseRevision,
          targetMainSha,
        ),
      },
      sourceEntries,
      waitingEntries,
      sourceMatches,
      waitingMatches,
      source,
      waitingSuccessor,
      associations: associationFrame(),
      overlap: {
        overlappingClaimIds: relevantClaims.map(claim => claim.claimId).sort(),
        reservedClaimIds: relevantClaims.filter(claim => claim.scopeReserved)
          .map(claim => claim.claimId).sort(),
        waitingClaimIds: waiting.map(claim => claim.claimId),
        higherPriorityWaitingClaimIds: waitingIndex < 0 ? []
          : waiting.slice(0, waitingIndex).map(claim => claim.claimId),
      },
      disjointMovement: {
        classification: "keep",
        currentClaimCount: unrelated.length,
        inventoryDigest: digestValue(unrelated.map(projectInventoryClaim)),
      },
    });
  }
  function observePlan() {
    const current = frame();
    if (current.sourceMatches.length !== 1 || current.waitingMatches.length !== 1) {
      invalid("planning subject cardinality");
    }
    return buildMixedIdentityPairRetirementEvidence({
      schema: "agentic-claim-only-mixed-identity-pair-retirement-evidence/v1",
      observedAt: current.observedAt,
      repository: current.repository,
      controller: current.controller,
      canonical: current.canonical,
      cloud: {
        ledgerRevision: current.status.ledgerRevision,
        ledgerDigest: current.status.ledgerDigest,
        validatedLedgerDigest: digestValue(current.ledger),
        sequence: current.status.sequence,
        inventoryDigest: digestValue(current.status.claims),
      },
      source: current.source,
      waitingSuccessor: current.waitingSuccessor,
      sourceEntry: projectClaimOnlyEntry(current.sourceEntries[0]),
      waitingSuccessorEntry: projectClaimOnlyEntry(current.waitingEntries[0]),
      sourceLineageCount: current.sourceEntries.length,
      waitingSuccessorLineageCount: current.waitingEntries.length,
      identityComparison: identityComparison(current.source, current.waitingSuccessor),
      scopeComparison: scopeComparison(current.source, current.waitingSuccessor),
      associations: current.associations,
      overlap: current.overlap,
      disjointMovement: current.disjointMovement,
    });
  }
  function prepare({ plan }) {
    const current = frame(plan);
    assertInitialFrame(plan, current);
    return Object.freeze({
      relevantFrameDigest: relevantFrameDigest(plan, current, "initial"),
      disjointMovementDigest: digestValue(current.disjointMovement),
      disjointMovementClassification: "keep",
    });
  }
  function classify(context, role, immediateResult = null) {
    const current = frame(context.plan);
    const claim = role === "waiting" ? context.plan.evidence.waitingSuccessor
      : context.plan.evidence.source;
    const matches = role === "waiting" ? current.waitingMatches : current.sourceMatches;
    const entries = role === "waiting" ? current.waitingEntries : current.sourceEntries;
    if (matches.length === 1) {
      if (role === "waiting") assertInitialFrame(context.plan, current);
      else assertSourceReadyFrame(context.plan, current);
      assertCurrentClaim(claim, matches[0], entries[0], role);
      return Object.freeze({ state: "pending" });
    }
    if (matches.length !== 0) invalid(`${role} terminal cardinality`);
    if (role === "waiting" && current.sourceMatches.length === 1) {
      assertSourcePreserved(context.plan, current);
    } else {
      assertTerminalBase(context.plan, current);
      requireWaitingTerminal(context.plan, current);
    }
    const result = immediateResult || confirmedResults.get(context.operationKey) || null;
    const terminal = entries.at(-1);
    const outcome = validateMixedIdentityPairRetirementTerminal({
      plan: context.plan,
      claim,
      phase: context.phase,
      operationKey: context.operationKey,
      entry: terminal,
      result,
    });
    if (immediateResult) confirmedResults.set(context.operationKey, immediateResult);
    return Object.freeze({
      state: "complete",
      values: {
        operationKey: context.operationKey,
        claimId: claim.claimId,
        ...outcome,
        disposition: result ? "projected" : "adopted",
        cloudMutation: true,
      },
    });
  }
  async function retire(context, role) {
    return convergeRetirementAtFreshLedger({
      readFrame: () => frame(context.plan),
      classify: (current, result) => classifyFromFrame(context, role, current, result),
      invoke: current => invoke({
        action: "retire",
        ledgerRepository,
        request: {
          targetRepository,
          ...buildMixedIdentityPairRetirementRequest({
            plan: context.plan,
            claim: role === "waiting" ? context.plan.evidence.waitingSuccessor
              : context.plan.evidence.source,
            phase: context.phase,
            operationKey: context.operationKey,
            expectedLedgerDigest: current.status.ledgerDigest,
          }),
        },
        environment,
      }),
    });
  }
  function classifyFromFrame(context, role, current, result) {
    const claim = role === "waiting" ? context.plan.evidence.waitingSuccessor
      : context.plan.evidence.source;
    const matches = role === "waiting" ? current.waitingMatches : current.sourceMatches;
    const entries = role === "waiting" ? current.waitingEntries : current.sourceEntries;
    if (matches.length === 1) {
      if (role === "waiting") assertInitialFrame(context.plan, current);
      else assertSourceReadyFrame(context.plan, current);
      assertCurrentClaim(claim, matches[0], entries[0], role);
      return { state: "pending" };
    }
    if (role === "waiting" && current.sourceMatches.length === 1) {
      assertSourcePreserved(context.plan, current);
    } else {
      assertTerminalBase(context.plan, current);
      requireWaitingTerminal(context.plan, current);
    }
    const outcome = validateMixedIdentityPairRetirementTerminal({
      plan: context.plan, claim, phase: context.phase, operationKey: context.operationKey,
      entry: entries.at(-1), result,
    });
    if (result) confirmedResults.set(context.operationKey, result);
    return { state: "complete", values: outcome };
  }
  function verifyTerminal({ plan, journal }) {
    const current = frame(plan);
    if (current.sourceMatches.length || current.waitingMatches.length) {
      invalid("terminal pair cardinality");
    }
    const waitingContext = effectContext(plan, journal, "waiting-successor-retired");
    const sourceContext = effectContext(plan, journal, "source-retired");
    const waiting = classify(waitingContext, "waiting");
    const source = classify(sourceContext, "source");
    if (waiting.state !== "complete" || source.state !== "complete") {
      invalid("terminal effects");
    }
    assertEffectJoin(journal.state.receipts["waiting-successor-retired"], waiting.values);
    assertEffectJoin(journal.state.receipts["source-retired"], source.values);
    return Object.freeze({
      effectReceiptDigest: digestValue({
        waitingSuccessor: effectReceiptValues(journal.state.receipts["waiting-successor-retired"]),
        source: effectReceiptValues(journal.state.receipts["source-retired"]),
      }),
      terminalRelevantDigest: digestValue({
        sourceTerminalEntryDigest: current.sourceEntries.at(-1).digest,
        waitingTerminalEntryDigest: current.waitingEntries.at(-1).digest,
        associations: current.associations,
        controller: current.controller,
      }),
      disjointMovementDigest: digestValue(current.disjointMovement),
      disjointMovementClassification: "keep",
    });
  }
  return Object.freeze({
    withOperationLock: store.withOperationLock,
    readJournal: store.readJournal,
    writeJournal: store.writeJournal,
    observePlan,
    prepare,
    classifyWaitingSuccessorRetired: context => classify(context, "waiting"),
    retireWaitingSuccessor: context => retire(context, "waiting"),
    classifySourceRetired: context => classify(context, "source"),
    retireSource: context => retire(context, "source"),
    verifyTerminal,
  });
  function isAncestor(base, head) {
    try { git(["merge-base", "--is-ancestor", base, head]); return true; } catch { return false; }
  }
}
export async function convergeRetirementAtFreshLedger({
  readFrame, classify, invoke, maximumAttempts = 3,
}) {
  let lastError = null;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const before = await readFrame();
    const prior = await classify(before, null);
    if (prior.state === "complete") return prior;
    let result = null;
    try { result = await invoke(before); } catch (error) { lastError = error; }
    const after = await readFrame();
    const terminal = await classify(after, result);
    if (terminal.state === "complete") return terminal;
    if (result) throw new Error("Cloud retirement response did not reach its exact terminal state.");
  }
  if (lastError) throw lastError;
  throw new Error("Cloud retirement did not converge at a fresh ledger head.");
}

function assertInitialFrame(plan, frame) {
  assertStableBase(plan, frame);
  assertCurrentClaim(plan.evidence.source, frame.sourceMatches[0], frame.sourceEntries[0], "source");
  assertCurrentClaim(plan.evidence.waitingSuccessor, frame.waitingMatches[0],
    frame.waitingEntries[0], "waiting successor");
  assertAssociations(frame.associations);
  const expected = [plan.sourceClaimId, plan.waitingSuccessorClaimId].sort();
  if (canonicalJson(frame.overlap.overlappingClaimIds) !== canonicalJson(expected)
    || canonicalJson(frame.overlap.reservedClaimIds) !== canonicalJson([plan.sourceClaimId])
    || canonicalJson(frame.overlap.waitingClaimIds)
      !== canonicalJson([plan.waitingSuccessorClaimId])
    || frame.overlap.higherPriorityWaitingClaimIds.length) invalid("initial relevant overlap");
}

function assertSourceReadyFrame(plan, frame) {
  assertStableBase(plan, frame);
  requireWaitingTerminal(plan, frame);
  assertCurrentClaim(plan.evidence.source, frame.sourceMatches[0], frame.sourceEntries[0], "source");
  assertAssociations(frame.associations);
  if (canonicalJson(frame.overlap.overlappingClaimIds)
      !== canonicalJson([plan.sourceClaimId])
    || canonicalJson(frame.overlap.reservedClaimIds)
      !== canonicalJson([plan.sourceClaimId])
    || frame.overlap.waitingClaimIds.length) invalid("source-ready relevant overlap");
}

function assertSourcePreserved(plan, frame) {
  assertStableBase(plan, frame);
  if (frame.sourceMatches.length !== 1) invalid("preserved source cardinality");
  assertCurrentClaim(plan.evidence.source, frame.sourceMatches[0], frame.sourceEntries[0], "source");
  assertAssociations(frame.associations);
}

function assertTerminalBase(plan, frame) {
  assertStableBase(plan, frame);
  assertAssociations(frame.associations);
  if (frame.sourceMatches.length || frame.waitingMatches.length) {
    invalid("terminal pair cardinality");
  }
}

function requireWaitingTerminal(plan, frame) {
  if (frame.waitingMatches.length !== 0) invalid("waiting successor still current");
  validateMixedIdentityPairRetirementTerminal({
    plan,
    claim: plan.evidence.waitingSuccessor,
    phase: "waiting-successor-retired",
    operationKey: mixedIdentityPairRetirementOperationKey(plan, "waiting-successor-retired"),
    entry: frame.waitingEntries.at(-1),
  });
}

function assertStableBase(plan, frame) {
  if (canonicalJson(frame.repository) !== canonicalJson(plan.evidence.repository)
    || canonicalJson(frame.controller) !== canonicalJson(plan.evidence.controller)
    || canonicalJson(frame.canonical) !== canonicalJson(plan.evidence.canonical)) {
    invalid("repository/controller/canonical drift");
  }
}

function assertCurrentClaim(expected, actual, genesis, label) {
  if (!actual || canonicalJson(projectClaimOnlyClaim(actual, genesis)) !== canonicalJson(expected)) {
    invalid(`${label} fence or identity drift`);
  }
}

function assertAssociations(value) {
  if (Object.values(value).some(subject =>
    Object.values(subject).some(matches => matches.length !== 0))) {
    invalid("claim-bound association drift");
  }
}

function relevantFrameDigest(plan, frame, phase) {
  return digestValue({
    phase,
    repository: frame.repository,
    controller: frame.controller,
    canonical: frame.canonical,
    source: plan.evidence.source,
    waitingSuccessor: plan.evidence.waitingSuccessor,
    associations: frame.associations,
    overlap: frame.overlap,
  });
}

function identityComparison(source, waiting) {
  const fields = ["workItemId", "deviceId", "sessionId", "writeSetDigest",
    "declaredWriteScope"];
  const equalFields = [], differentFields = [];
  for (const field of fields) {
    const same = canonicalJson(source[field]) === canonicalJson(waiting[field]);
    (same ? equalFields : differentFields).push(field);
  }
  return {
    actorIdEqual: source.actorId === waiting.actorId,
    repositoryIdEqual: source.repositoryId === waiting.repositoryId,
    equalFields,
    differentFields,
    comparisonDigest: digestValue({ equalFields, differentFields }),
  };
}

function scopeComparison(source, waiting) {
  const sourceSet = source.declaredWriteScope;
  const waitingSet = waiting.declaredWriteScope;
  const union = [...new Set([...sourceSet, ...waitingSet])].sort();
  const intersection = sourceSet.filter(item => waitingSet.includes(item));
  const sourceOnly = sourceSet.filter(item => !waitingSet.includes(item));
  const waitingSuccessorOnly = waitingSet.filter(item => !sourceSet.includes(item));
  const semantic = values => values.filter(item => item.startsWith("semantic:"));
  const core = { source: sourceSet, waitingSuccessor: waitingSet, union, intersection,
    sourceOnly, waitingSuccessorOnly, semanticUnion: semantic(union),
    semanticIntersection: semantic(intersection), semanticSourceOnly: semantic(sourceOnly),
    semanticWaitingSuccessorOnly: semantic(waitingSuccessorOnly) };
  const digests = Object.fromEntries(Object.entries(core).map(([name, values]) =>
    [`${name}Digest`, digestValue(values)]));
  return { ...core, ...digests, comparisonDigest: digestValue({ core, digests }) };
}

function effectContext(plan, journal, phase) {
  return { plan, journal, phase, operationKey: mixedIdentityPairRetirementOperationKey(plan, phase) };
}
function effectReceiptValues(value) {
  const result = { ...value }; delete result.phase; delete result.receiptDigest; return result;
}
function assertEffectJoin(sealed, fresh) {
  for (const name of ["operationKey", "claimId", "requestDigest", "operationReceiptDigest",
    "terminalEntryDigest", "terminalClaimDigest"]) {
    if (sealed[name] !== fresh[name]) invalid(`terminal ${name} join`);
  }
}
function projectInventoryClaim(claim) {
  return { claimId: claim.claimId, state: claim.state, fenceRevision: claim.fenceRevision,
    transitionCounter: claim.transitionCounter, writeSetDigest: claim.writeSetDigest };
}
function compareWaiting(left, right) {
  return String(left.eligibleSince).localeCompare(String(right.eligibleSince))
    || left.ledgerSequence - right.ledgerSequence || left.claimId.localeCompare(right.claimId);
}
function firstSha(value) {
  const result = String(value).trim().split(/\s+/u)[0];
  if (!/^[0-9a-f]{40}$/u.test(result)) invalid("remote main");
  return result;
}
function repositoryName(value) {
  const result = text(value, "repository");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) invalid("repository");
  return result;
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label);
  return value.trim();
}
function digest(value, label) {
  if (!DIGEST.test(String(value || ""))) invalid(label);
  return value;
}
function invalid(label) {
  throw new Error(`Mixed-identity pair repository ${label} is invalid.`);
}
