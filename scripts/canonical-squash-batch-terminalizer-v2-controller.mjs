// Responsibility: own the durable journal and serial intent-before-effect execution.
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildBatchPlan, CAPABILITY_REPORT_SCHEMA, FIXED_PULL_REQUESTS,
  FIXED_TERMINAL_CLOUD, FORBIDDEN_EFFECTS, ITEM_PHASES, JOURNAL_SCHEMA,
  normalizeBatchPlan, OPERATION, RECEIPT_SCHEMA,
} from "./canonical-squash-batch-terminalizer-v2-contract.mjs";
import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";

const METHODS = Object.freeze([
  "withOperationLock", "readJournal", "writeJournal", "observe",
  "assertStableEvidence", "preflightCapabilities", "withItemFence",
  "verifyItemEvidence", "classifyRetirementAdoption",
  "classifyCompletionProjection", "projectCompletion", "verifyItemTerminal",
  "verifyBatchTerminal",
]);

export function createCanonicalSquashBatchTerminalizerV2Controller({ adapter } = {}) {
  for (const method of METHODS) if (typeof adapter?.[method] !== "function") {
    throw new Error(`Canonical squash batch adapter requires ${method}().`);
  }
  return Object.freeze({ plan: () => plan(adapter),
    execute: input => execute(adapter, input), status: () => status(adapter) });
}

export function createPrivateBatchJournalStore(file) {
  const target = path.resolve(file);
  const store = { path: target, read() {
    if (!existsSync(target)) return null;
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
      || (stat.mode & 0o777) !== 0o600) throw new Error("Journal is not private mode-0600.");
    return normalizeBatchJournal(JSON.parse(readFileSync(target, "utf8")));
  }, write({ expected, next }) {
    const current = store.read();
    if ((current?.journalDigest || null) !== (expected?.journalDigest || null)) {
      throw new Error("Journal compare-and-swap precondition changed.");
    }
    const normalized = normalizeBatchJournal(next);
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.tmp.${randomUUID()}`;
    const descriptor = openSync(temporary, "wx", 0o600);
    try { writeFileSync(descriptor, `${JSON.stringify(normalized)}\n`); fsyncSync(descriptor); }
    finally { closeSync(descriptor); }
    renameSync(temporary, target);
    const directory = openSync(path.dirname(target), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
    return normalized;
  } };
  return Object.freeze(store);
}

export function classifyV2RetiredCloud(snapshot, lease, pull, fixed) {
  const identity = FIXED_TERMINAL_CLOUD.find(row => row.pullRequest === fixed.pullRequest);
  const lineage = snapshot.value.entries.filter(entry => entry.claimId === fixed.claimId);
  const integrate = lineage.at(-2); const terminal = lineage.at(-1);
  if (lineage.length !== identity.lineageLength || digestValue(lineage) !== identity.lineageDigest
    || integrate?.action !== "integrate" || integrate.digest !== identity.integrateEntryDigest
    || integrate.claimDigest !== fixed.claimDigest
    || integrate.claimCore?.state !== "integrated-preserved"
    || integrate.claimCore?.transitionCounter !== identity.integrationCounter
    || terminal?.action !== "retire" || terminal.parentDigest !== integrate.digest
    || terminal.sequence !== identity.retireSequence
    || terminal.idempotencyKey !== identity.retireIdempotencyKey
    || terminal.requestDigest !== identity.retireRequestDigest
    || terminal.digest !== identity.terminalEntryDigest
    || terminal.claimDigest !== identity.terminalClaimDigest
    || terminal.claimCore?.state !== "retired"
    || terminal.claimCore?.transitionCounter !== identity.terminalCounter
    || terminal.claimCore?.leaseEpoch !== fixed.cloudEpoch
    || terminal.claimCore?.retirement?.reason !== "integrated"
    || terminal.claimCore.retirement.finalRevision !== fixed.headSha
    || terminal.claimCore.retirement.reviewRequestId !== `github-pull-request:${fixed.nodeId}`
    || terminal.claimCore.retirement.integrationReceiptDigest !== fixed.integrationReceiptDigest
    || integrate.claimCore?.reviewRequestId !== `github-pull-request:${fixed.nodeId}`
    || lease?.cloudAuthority?.claimId !== fixed.claimId
    || lease.cloudAuthority.claimDigest !== fixed.claimDigest
    || lease.cloudAuthority.integrationReceiptDigest !== fixed.integrationReceiptDigest
    || pull.nodeId !== fixed.nodeId) throw new Error(`PR ${fixed.pullRequest} retired lineage is not exact.`);
  const core = { claimId: fixed.claimId, integratedClaimDigest: fixed.claimDigest,
    lineageDigest: identity.lineageDigest, lineageLength: identity.lineageLength,
    terminalState: "retired", retirementReason: "integrated", leaseEpoch: fixed.cloudEpoch,
    integrationCounter: identity.integrationCounter, terminalCounter: identity.terminalCounter,
    reviewRequestId: `github-pull-request:${fixed.nodeId}`, finalRevision: fixed.headSha,
    integrateEntryDigest: identity.integrateEntryDigest, retireSequence: identity.retireSequence,
    retireIdempotencyKey: identity.retireIdempotencyKey,
    retireRequestDigest: identity.retireRequestDigest,
    terminalEntryDigest: identity.terminalEntryDigest,
    terminalClaimDigest: identity.terminalClaimDigest,
    integrationReceiptDigest: fixed.integrationReceiptDigest };
  return freeze({ ...core, deliveryEvidenceDigest: digestValue(lease.cloudAuthority.integration),
    authorityDigest: digestValue(lease.cloudAuthority), terminalCloudDigest: digestValue(core) });
}

export function createBatchJournal(plan) {
  const normalized = normalizeBatchPlan(plan);
  return sealJournal({ schema: JOURNAL_SCHEMA, operation: OPERATION, plan: normalized,
    authorizationDigest: null, cursor: 0, items: normalized.evidence.items.map(item =>
      ({ pullRequest: item.pullRequest.number, phase: "pending", receipts: {} })),
    status: "planned" });
}

export function authorizeBatchJournal(journal, authorization) {
  const current = normalizeBatchJournal(journal);
  const authorizationDigest = sealedAuthorizationDigest(current.plan, authorization);
  if (current.authorizationDigest) {
    if (current.authorizationDigest !== authorizationDigest) invalid("authorization replay");
    return current;
  }
  return sealJournal({ ...journalCore(current), authorizationDigest, status: "running" });
}

export function itemOperationKey(plan, pullRequest, phaseName) {
  const normalized = normalizeBatchPlan(plan);
  return sealedOperationKey(normalized.planDigest, pullRequest, phaseName);
}
function sealedOperationKey(planDigest, pullRequest, phaseName) {
  if (!FIXED_PULL_REQUESTS.includes(pullRequest) || !ITEM_PHASES.includes(phaseName)) {
    invalid("item operation identity");
  }
  return digestValue({ operation: OPERATION, planDigest, pullRequest, phase: phaseName });
}
function sealedAuthorizationDigest(plan, authorization) {
  if (authorization !== plan.exactAuthorization) throw new Error(`Exact authorization required: ${plan.exactAuthorization}`);
  return digestValue({ operation: OPERATION, planDigest: plan.planDigest, authorization });
}

export function advanceBatchItem(journal, { pullRequest, phase: nextPhase, values } = {}) {
  const current = normalizeBatchJournal(journal);
  if (!current.authorizationDigest) throw new Error("Batch journal is not authorized.");
  if (pullRequest !== FIXED_PULL_REQUESTS[current.cursor]) {
    throw new Error(`Batch cursor requires PR ${FIXED_PULL_REQUESTS[current.cursor]}.`);
  }
  const item = current.items[current.cursor];
  if (ITEM_PHASES.indexOf(nextPhase) !== ITEM_PHASES.indexOf(item.phase) + 1) {
    throw new Error(`PR ${pullRequest} cannot advance from ${item.phase} to ${nextPhase}.`);
  }
  const normalizedValues = normalizePhaseValues(nextPhase, values, current.plan, pullRequest);
  const core = { pullRequest, phase: nextPhase,
    operationKey: sealedOperationKey(current.plan.planDigest, pullRequest, nextPhase),
    priorJournalDigest: current.journalDigest, values: normalizedValues };
  const receipt = freeze({ ...core, receiptDigest: digestValue(core) });
  const items = current.items.map((candidate, index) => index === current.cursor
    ? { pullRequest, phase: nextPhase,
      receipts: { ...candidate.receipts, [nextPhase]: receipt } }
    : structuredClone(candidate));
  const cursor = current.cursor + (nextPhase === "complete" ? 1 : 0);
  return sealJournal({ ...journalCore(current), cursor, items,
    status: cursor === FIXED_PULL_REQUESTS.length ? "complete" : "running" });
}

export function normalizeBatchJournal(value) {
  exactKeys(value, ["schema", "operation", "plan", "authorizationDigest", "cursor",
    "items", "status", "journalDigest"], "batch journal");
  if (value.schema !== JOURNAL_SCHEMA || value.operation !== OPERATION) invalid("journal identity");
  const plan = normalizeBatchPlan(value.plan);
  if (value.authorizationDigest !== null) {
    requireDigest(value.authorizationDigest, "authorization");
    if (value.authorizationDigest !== sealedAuthorizationDigest(plan, plan.exactAuthorization)) {
      invalid("journal authorization digest");
    }
  }
  if (!Number.isInteger(value.cursor) || value.cursor < 0
    || value.cursor > FIXED_PULL_REQUESTS.length
    || !Array.isArray(value.items) || value.items.length !== FIXED_PULL_REQUESTS.length) {
    invalid("journal cursor/items");
  }
  const items = value.items.map((item, index) => normalizeJournalItem(item,
    FIXED_PULL_REQUESTS[index], index < value.cursor, index === value.cursor, plan));
  const status = value.authorizationDigest === null ? "planned"
    : value.cursor === FIXED_PULL_REQUESTS.length ? "complete" : "running";
  if (value.status !== status) invalid("journal status");
  const core = { schema: JOURNAL_SCHEMA, operation: OPERATION, plan,
    authorizationDigest: value.authorizationDigest, cursor: value.cursor, items, status };
  if (value.journalDigest !== digestValue(core)) invalid("journal digest");
  const normalized = freeze({ ...core, journalDigest: value.journalDigest });
  const terminalDigests = [];
  for (const item of normalized.items) if (item.phase === "complete") {
    terminalDigests.push(item.receipts["terminal-verified"].values.terminalEvidenceDigest);
    if (item.receipts.complete.values.terminalPrefixDigest !== digestValue({ operation: OPERATION,
      planDigest: plan.planDigest, terminalDigests })) invalid("terminal prefix digest");
  }
  verifyJournalHistory(normalized);
  return normalized;
}

export function buildBatchReceipt(journal, terminalStatuses = null) {
  const state = normalizeBatchJournal(journal);
  if (state.status !== "complete") throw new Error("Batch is not complete.");
  const recordedItems = state.items.map((item, index) => {
    const evidence = state.plan.evidence.items[index];
    const retired = item.receipts["retirement-adopted"].values;
    return { pullRequest: item.pullRequest, branch: evidence.branch,
      headSha: evidence.pullRequest.headSha, treeSha: evidence.sourceCommit.treeSha,
      mergeSha: evidence.pullRequest.mergeSha, claimId: evidence.cloud.claimId,
      terminalCloudDigest: retired.terminalCloudDigest,
      terminalEvidenceDigest: item.receipts["terminal-verified"].values.terminalEvidenceDigest,
      recordedTerminalStatus: item.receipts.complete.values.terminalStatus,
      retirementDisposition: retired.disposition,
      recordedContinuation: structuredClone(item.receipts.complete.values.continuation) };
  });
  const recordedPending = recordedItems.some(item =>
    item.recordedContinuation.disposition === "required");
  const core = { schema: RECEIPT_SCHEMA, operation: OPERATION,
    planDigest: state.plan.planDigest, authorizationDigest: state.authorizationDigest,
    terminalBatchDigest: state.items.at(-1).receipts.complete.values.terminalPrefixDigest,
    bridge: structuredClone(state.plan.evidence.bridge),
    recordedStatus: recordedPending ? "completion-ready" : "completed", recordedItems,
    recordedContinuation: recordedPending
      ? "ordinary-unchanged-session-device:integrate" : "none-already-cleaned",
    forbiddenEffects: [...FORBIDDEN_EFFECTS] };
  const receiptDigest = digestValue(core);
  const live = buildLiveContinuationProjection(state, receiptDigest, recordedItems,
    terminalStatuses || recordedItems.map(item => item.recordedTerminalStatus));
  return freeze({ ...core, receiptDigest, status: live.status, items: live.items,
    continuation: live.continuation, liveContinuationDigest: live.projectionDigest });
}

export function normalizeBatchReceipt(value, journal, terminalStatuses = null) {
  requireObject(value, "batch receipt");
  const rebuilt = buildBatchReceipt(journal, terminalStatuses);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("receipt rebuild");
  return rebuilt;
}

function buildLiveContinuationProjection(state, receiptDigest, recordedItems, statuses) {
  if (!Array.isArray(statuses) || statuses.length !== FIXED_PULL_REQUESTS.length) {
    invalid("live continuation statuses");
  }
  const items = statuses.map((terminalStatus, index) => {
    const recorded = recordedItems[index];
    if (!["completion-ready", "completed"].includes(terminalStatus)
      || (recorded.recordedTerminalStatus === "completed" && terminalStatus !== "completed")) {
      invalid("live continuation monotonicity");
    }
    const { recordedTerminalStatus, recordedContinuation, ...identity } = recorded;
    return { ...identity, terminalStatus,
      continuation: completionContinuation(state.plan.evidence.items[index], terminalStatus) };
  });
  const pending = items.some(item => item.continuation.disposition === "required");
  const core = { schema: `agentic-${OPERATION}-live-continuations/v1`, receiptDigest,
    terminalBatchDigest: state.items.at(-1).receipts.complete.values.terminalPrefixDigest,
    status: pending ? "completion-ready" : "completed", items,
    continuation: pending
      ? "ordinary-unchanged-session-device:integrate" : "none-already-cleaned" };
  return freeze({ ...core, projectionDigest: digestValue(core) });
}

export function buildCapabilityReport({ journal, entries } = {}) {
  const state = normalizeBatchJournal(journal);
  if (!Array.isArray(entries) || entries.length !== FIXED_PULL_REQUESTS.length) {
    invalid("capability report items");
  }
  const items = entries.map((entry, index) => {
    exactKeys(entry, ["pullRequest", "requirement", "status", "bindingDigest",
      "capabilityProjectionDigest"], "capability item");
    const expectedBinding = state.plan.evidence.items[index].taskAuthority.bindingDigest;
    const phaseIndex = ITEM_PHASES.indexOf(state.items[index].phase);
    const baseline = index < state.cursor ? "none-complete"
      : phaseIndex >= ITEM_PHASES.indexOf("completion-projected") ? "none-terminal"
        : "mutation";
    const allowed = baseline === "mutation"
      ? ["mutation", "none-response-loss"] : [baseline];
    const required = entry.requirement === "mutation";
    if (entry.pullRequest !== FIXED_PULL_REQUESTS[index]
      || !allowed.includes(entry.requirement) || entry.bindingDigest !== expectedBinding
      || (required && !["available", "missing", "invalid"].includes(entry.status))
      || (!required && entry.status !== "not-required")) invalid("capability item identity");
    if (entry.status === "available") {
      requireDigest(entry.capabilityProjectionDigest, "capability projection");
    } else if (entry.capabilityProjectionDigest !== null) invalid("unused capability projection");
    return structuredClone(entry);
  });
  const core = { schema: CAPABILITY_REPORT_SCHEMA, planDigest: state.plan.planDigest,
    evidenceDigest: state.plan.evidence.evidenceDigest, journalDigest: state.journalDigest,
    cursor: state.cursor, status: items.every(item =>
      ["available", "not-required"].includes(item.status)) ? "ready" : "blocked", items };
  return freeze({ ...core, reportDigest: digestValue(core) });
}

export function normalizeCapabilityReport(value, journal) {
  exactKeys(value, ["schema", "planDigest", "evidenceDigest", "journalDigest", "cursor",
    "status", "items", "reportDigest"], "capability report");
  const rebuilt = buildCapabilityReport({ journal, entries: value.items });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) invalid("capability report seal");
  return rebuilt;
}

function normalizeJournalItem(value, pullRequest, completed, current, plan) {
  exactKeys(value, ["pullRequest", "phase", "receipts"], "journal item");
  if (value.pullRequest !== pullRequest || !ITEM_PHASES.includes(value.phase)
    || (completed && value.phase !== "complete")
    || (!completed && !current && value.phase !== "pending")) invalid("journal item identity");
  requireObject(value.receipts, "journal receipts");
  const phases = ITEM_PHASES.slice(1, ITEM_PHASES.indexOf(value.phase) + 1);
  if (canonicalJson(Object.keys(value.receipts)) !== canonicalJson(phases)) {
    invalid("journal receipt phase set");
  }
  const receipts = {};
  for (const phaseName of phases) {
    const receipt = value.receipts[phaseName];
    exactKeys(receipt, ["pullRequest", "phase", "operationKey", "priorJournalDigest",
      "values", "receiptDigest"], "phase receipt");
    if (receipt.pullRequest !== pullRequest || receipt.phase !== phaseName
      || receipt.operationKey !== sealedOperationKey(plan.planDigest, pullRequest, phaseName)) {
      invalid("phase receipt identity");
    }
    requireDigest(receipt.priorJournalDigest, "prior journal digest");
    const values = normalizePhaseValues(phaseName, receipt.values, plan, pullRequest);
    const core = { pullRequest, phase: phaseName, operationKey: receipt.operationKey,
      priorJournalDigest: receipt.priorJournalDigest, values };
    if (receipt.receiptDigest !== digestValue(core)) invalid("phase receipt digest");
    receipts[phaseName] = freeze({ ...core, receiptDigest: receipt.receiptDigest });
  }
  const terminalStatus = receipts["terminal-verified"]?.values.terminalStatus;
  if (value.phase === "complete" && (terminalStatus === "completed"
    ? receipts.complete.values.terminalStatus !== "completed"
    : !["completion-ready", "completed"].includes(receipts.complete.values.terminalStatus))) {
    invalid("terminal status monotonicity");
  }
  return freeze({ pullRequest, phase: value.phase, receipts });
}

function normalizePhaseValues(phaseName, value, plan, pullRequest) {
  requireObject(value, `${phaseName} values`);
  const evidence = plan.evidence.items[FIXED_PULL_REQUESTS.indexOf(pullRequest)];
  if (!evidence) invalid("phase subject");
  if (phaseName === "evidence-verified") {
    exactKeys(value, ["evidenceVerificationDigest", "stableEvidenceDigest",
      "fenceLeaseDigest", "capabilityReportDigest"], phaseName);
    ["evidenceVerificationDigest", "fenceLeaseDigest", "capabilityReportDigest"]
      .forEach(name => requireDigest(value[name], `${phaseName} ${name}`));
    if (value.stableEvidenceDigest !== plan.evidence.stableDigest) invalid(phaseName);
  } else if (phaseName === "retirement-adoption-intent") {
    exactKeys(value, ["claimId", "terminalClaimDigest", "adoptionOperationKey",
      "cloudMutation"], phaseName);
    if (value.claimId !== evidence.cloud.claimId
      || value.terminalClaimDigest !== evidence.cloud.terminalClaimDigest
      || value.adoptionOperationKey !== sealedOperationKey(plan.planDigest, pullRequest,
        "retirement-adopted") || value.cloudMutation !== false) invalid(phaseName);
  } else if (phaseName === "retirement-adopted") {
    exactKeys(value, ["disposition", "terminalCloudDigest", "lineageDigest",
      "lineageLength", "integrateEntryDigest", "terminalEntryDigest",
      "terminalClaimDigest", "retirementReceiptDigest", "cloudMutation"], phaseName);
    const receiptCore = { schema: `agentic-${OPERATION}-retirement-adoption/v1`,
      planDigest: plan.planDigest, pullRequest,
      terminalCloudDigest: value.terminalCloudDigest,
      terminalEntryDigest: value.terminalEntryDigest,
      terminalClaimDigest: value.terminalClaimDigest, cloudMutation: false };
    if (value.disposition !== "response-loss-adopted" || value.cloudMutation !== false
      || value.terminalCloudDigest !== evidence.cloud.terminalCloudDigest
      || value.lineageDigest !== evidence.cloud.lineageDigest
      || value.lineageLength !== evidence.cloud.lineageLength
      || value.integrateEntryDigest !== evidence.cloud.integrateEntryDigest
      || value.terminalEntryDigest !== evidence.cloud.terminalEntryDigest
      || value.terminalClaimDigest !== evidence.cloud.terminalClaimDigest
      || value.retirementReceiptDigest !== digestValue(receiptCore)) invalid(phaseName);
  } else if (phaseName === "completion-intent") {
    exactKeys(value, ["taskAuthorityBindingDigest", "effectOperationKey"], phaseName);
    if (value.taskAuthorityBindingDigest !== evidence.taskAuthority.bindingDigest
      || value.effectOperationKey !== sealedOperationKey(plan.planDigest, pullRequest,
        "completion-projected")) invalid(phaseName);
  } else if (phaseName === "completion-projected") {
    exactKeys(value, ["relation"], phaseName);
    if (value.relation !== "protected-descendant") invalid(phaseName);
  } else if (phaseName === "terminal-verified") {
    exactKeys(value, ["terminalEvidenceDigest", "terminalStatus"], phaseName);
    requireDigest(value.terminalEvidenceDigest, `${phaseName} digest`);
    if (!["completion-ready", "completed"].includes(value.terminalStatus)) invalid(phaseName);
  } else if (phaseName === "complete") {
    exactKeys(value, ["terminalPrefixDigest", "terminalStatus", "continuation"], phaseName);
    requireDigest(value.terminalPrefixDigest, `${phaseName} prefix`);
    if (!["completion-ready", "completed"].includes(value.terminalStatus)) invalid(phaseName);
    if (canonicalJson(value.continuation) !== canonicalJson(
      completionContinuation(evidence, value.terminalStatus))) invalid(phaseName);
  } else invalid("phase values identity");
  return freeze(structuredClone(value));
}

function verifyJournalHistory(value) {
  let replay = sealJournal({ schema: JOURNAL_SCHEMA, operation: OPERATION, plan: value.plan,
    authorizationDigest: value.authorizationDigest, cursor: 0,
    items: value.plan.evidence.items.map(item => ({ pullRequest: item.pullRequest.number,
      phase: "pending", receipts: {} })),
    status: value.authorizationDigest === null ? "planned" : "running" });
  for (let index = 0; index < value.items.length; index += 1) {
    const item = value.items[index];
    for (const phaseName of ITEM_PHASES.slice(1, ITEM_PHASES.indexOf(item.phase) + 1)) {
      const receipt = item.receipts[phaseName];
      if (receipt.priorJournalDigest !== replay.journalDigest) invalid("journal predecessor chain");
      const values = normalizePhaseValues(phaseName, receipt.values, value.plan, item.pullRequest);
      const core = { pullRequest: item.pullRequest, phase: phaseName,
        operationKey: sealedOperationKey(value.plan.planDigest, item.pullRequest, phaseName),
        priorJournalDigest: replay.journalDigest, values };
      const expected = { ...core, receiptDigest: digestValue(core) };
      if (canonicalJson(receipt) !== canonicalJson(expected)) invalid("journal phase rebuild");
      const items = replay.items.map((candidate, itemIndex) => itemIndex === index
        ? { pullRequest: item.pullRequest, phase: phaseName,
          receipts: { ...candidate.receipts, [phaseName]: expected } }
        : structuredClone(candidate));
      const cursor = replay.cursor + (phaseName === "complete" ? 1 : 0);
      replay = sealJournal({ ...journalCore(replay), cursor, items,
        status: cursor === FIXED_PULL_REQUESTS.length ? "complete" : "running" });
    }
  }
  if (canonicalJson(replay) !== canonicalJson(value)) invalid("journal history rebuild");
}

function sealJournal(core) {
  const frozen = freeze(structuredClone(core));
  return freeze({ ...frozen, journalDigest: digestValue(frozen) });
}
function journalCore(value) {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== "journalDigest"));
}
function exactKeys(value, expected, label) {
  requireObject(value, label);
  if (canonicalJson(Object.keys(value)) !== canonicalJson(expected)) invalid(`${label} keys`);
}
function invalid(label) { throw new Error(`Canonical squash batch ${label} is invalid.`); }
function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value); Object.values(value).forEach(freeze); return value;
}

async function plan(adapter) {
  return adapter.withOperationLock({ action: "plan" }, async () => {
    const existing = await adapter.readJournal();
    if (existing) {
      const journal = normalizeBatchJournal(existing);
      await adapter.assertStableEvidence({ sealedEvidence: journal.plan.evidence,
        freshEvidence: await adapter.observe(), phase: "plan-replay" });
      return journal.plan;
    }
    const first = await adapter.observe();
    const second = await adapter.observe();
    await adapter.assertStableEvidence({ sealedEvidence: first, freshEvidence: second,
      phase: "plan" });
    const next = createBatchJournal(buildBatchPlan(second));
    const stored = await adapter.writeJournal({ expected: null, next });
    return normalizeBatchJournal(stored || next).plan;
  });
}

async function execute(adapter, { planDigest, authorization } = {}) {
  requireDigest(planDigest, "execute plan digest");
  return adapter.withOperationLock({ action: "execute", planDigest }, async () => {
    let journal = normalizeBatchJournal(await adapter.readJournal());
    if (journal.plan.planDigest !== planDigest) {
      throw new Error("Execute digest does not match the persisted batch plan.");
    }
    sealedAuthorizationDigest(journal.plan, authorization);
    if (!journal.authorizationDigest) {
      journal = await persist(adapter, journal, authorizeBatchJournal(journal, authorization));
    }
    if (journal.status === "complete") return completedReplay(adapter, journal);
    while (journal.cursor < FIXED_PULL_REQUESTS.length) {
      const prior = journal.items[journal.cursor - 1]?.receipts.complete.values
        .terminalPrefixDigest;
      if (prior && requireDigest((await adapter.verifyBatchTerminal({ plan: journal.plan,
        journal, resumedPrefix: true })).terminalBatchDigest, "resumed terminal prefix") !== prior) {
        throw new Error("Completed batch prefix drifted before the next item.");
      }
      const report = normalizeCapabilityReport(
        await adapter.preflightCapabilities({ plan: journal.plan, journal }), journal);
      if (report.status !== "ready") {
        const error = new Error("Batch capability preflight is blocked; no effect was attempted.");
        error.capabilityReport = report;
        throw error;
      }
      journal = await executeCurrentItem(adapter, journal, report);
    }
    return completedReplay(adapter, journal);
  });
}

async function completedReplay(adapter, journal) {
  const replay = requireObject(await adapter.verifyBatchTerminal({
    plan: journal.plan, journal, completedReplay: true,
  }), "completed batch verification");
  const expected = journal.items.at(-1).receipts.complete.values.terminalPrefixDigest;
  if (requireDigest(replay.terminalBatchDigest, "terminal batch digest") !== expected) {
    throw new Error("Completed batch terminal replay drifted.");
  }
  return normalizeBatchReceipt(buildBatchReceipt(journal, replay.terminalStatuses), journal,
    replay.terminalStatuses);
}

async function executeCurrentItem(adapter, initial, capabilityReport) {
  const index = initial.cursor;
  const pullRequest = FIXED_PULL_REQUESTS[index];
  const evidence = initial.plan.evidence.items[index];
  return adapter.withItemFence({ plan: initial.plan, journal: initial, evidence,
    pullRequest, capabilityReport }, async fence => {
    let journal = initial; let transitioned = false;
    const verified = requireObject(await adapter.verifyItemEvidence({ plan: journal.plan,
      journal, evidence, pullRequest, capabilityReport, fence }),
    "item evidence verification");
    if (phase(journal, index) === "pending") {
      journal = await advance(adapter, journal, pullRequest, "evidence-verified", {
        evidenceVerificationDigest: requireDigest(verified.evidenceVerificationDigest,
          "item evidence verification digest"),
        stableEvidenceDigest: journal.plan.evidence.stableDigest,
        fenceLeaseDigest: requireDigest(verified.fenceLeaseDigest, "fence lease digest"),
        capabilityReportDigest: capabilityReport.reportDigest,
      });
    }
    if (phase(journal, index) === "evidence-verified") {
      journal = await advance(adapter, journal, pullRequest, "retirement-adoption-intent", {
        claimId: evidence.cloud.claimId,
        terminalClaimDigest: evidence.cloud.terminalClaimDigest,
        adoptionOperationKey: sealedOperationKey(journal.plan.planDigest, pullRequest,
          "retirement-adopted"), cloudMutation: false,
      });
    }
    if (phase(journal, index) === "retirement-adoption-intent") {
      const retired = requireObject(await adapter.classifyRetirementAdoption({
        plan: journal.plan, journal, evidence, pullRequest,
      }), "retirement adoption classification");
      if (retired.status !== "retired") {
        throw new Error(`PR ${pullRequest} exact prior retirement is unavailable.`);
      }
      journal = await advance(adapter, journal, pullRequest, "retirement-adopted", {
        disposition: "response-loss-adopted", terminalCloudDigest: retired.terminalCloudDigest,
        lineageDigest: retired.lineageDigest, lineageLength: retired.lineageLength,
        integrateEntryDigest: retired.integrateEntryDigest,
        terminalEntryDigest: retired.terminalEntryDigest,
        terminalClaimDigest: retired.terminalClaimDigest,
        retirementReceiptDigest: retired.retirementReceiptDigest, cloudMutation: false,
      });
    }
    if (phase(journal, index) === "retirement-adopted") {
      journal = await advance(adapter, journal, pullRequest, "completion-intent", {
        taskAuthorityBindingDigest: evidence.taskAuthority.bindingDigest,
        effectOperationKey: sealedOperationKey(journal.plan.planDigest, pullRequest,
          "completion-projected"),
      });
    }
    if (phase(journal, index) === "completion-intent") {
      const before = requireObject(await adapter.classifyCompletionProjection({
        plan: journal.plan, journal, evidence, pullRequest,
      }), "completion classification");
      let projected;
      if (before.status === "completion-ready") {
        projected = before;
      } else if (before.status === "pending") {
        projected = requireObject(await adapter.projectCompletion({
          plan: journal.plan, journal, evidence, pullRequest,
          operationKey: sealedOperationKey(journal.plan.planDigest, pullRequest,
            "completion-projected"),
        }), "completion effect receipt");
        transitioned = true;
      } else throw new Error(`PR ${pullRequest} completion is blocked by ${before.status}.`);
      journal = await advance(adapter, journal, pullRequest, "completion-projected", {
        relation: projected.relation,
      });
    }
    if (phase(journal, index) === "completion-projected") {
      const terminal = requireObject(await adapter.verifyItemTerminal({ plan: journal.plan,
        journal, evidence, pullRequest, transitioned }),
      "item terminal verification");
      journal = await advance(adapter, journal, pullRequest, "terminal-verified", {
        terminalEvidenceDigest: requireDigest(terminal.terminalEvidenceDigest,
          "item terminal evidence digest"), terminalStatus: terminal.terminalStatus,
      });
    }
    if (phase(journal, index) === "terminal-verified") {
      const live = requireObject(await adapter.verifyItemTerminal({ plan: journal.plan,
        journal, evidence, pullRequest, transitioned }),
      "complete continuation terminal verification");
      const recorded = journal.items[index].receipts["terminal-verified"].values;
      if (live.terminalEvidenceDigest !== recorded.terminalEvidenceDigest) {
        throw new Error(`PR ${pullRequest} terminal evidence drifted before completion.`);
      }
      const prefix = requireObject(await adapter.verifyBatchTerminal({ plan: journal.plan,
        journal, pendingPullRequest: pullRequest }), "terminal prefix verification");
      journal = await advance(adapter, journal, pullRequest, "complete", {
        terminalPrefixDigest: requireDigest(prefix.terminalBatchDigest,
          "terminal prefix digest"),
        terminalStatus: live.terminalStatus,
        continuation: completionContinuation(evidence, live.terminalStatus),
      });
    }
    return journal;
  });
}

async function status(adapter) {
  return adapter.withOperationLock({ action: "status" }, async () => {
    const stored = await adapter.readJournal();
    if (!stored) return Object.freeze({ status: "unplanned", journal: null });
    const journal = normalizeBatchJournal(stored);
    const capabilityReport = journal.status === "complete" ? null
      : normalizeCapabilityReport(await adapter.preflightCapabilities({ plan: journal.plan,
        journal, readOnly: true }), journal);
    return Object.freeze({ status: journal.status, cursor: journal.cursor,
      nextPullRequest: FIXED_PULL_REQUESTS[journal.cursor] || null,
      planDigest: journal.plan.planDigest, capabilityReport, journal });
  });
}

function phase(journal, index) { return journal.items[index].phase; }
function completionContinuation(evidence, terminalStatus) {
  if (terminalStatus === "completed") return { disposition: "already-cleaned" };
  if (terminalStatus !== "completion-ready") invalid("terminal continuation status");
  return { disposition: "required", command: "device:integrate",
    repository: evidence.worktreePath, sessionId: evidence.lease.sessionId,
    runtime: "canonical" };
}
async function advance(adapter, current, pullRequest, nextPhase, values) {
  return persist(adapter, current,
    advanceBatchItem(current, { pullRequest, phase: nextPhase, values }));
}
async function persist(adapter, expected, next) {
  return normalizeBatchJournal(await adapter.writeJournal({ expected, next }) || next);
}
function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}
function requireDigest(value, label) {
  if (typeof value !== "string" || !/^(?!0{64}$)[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}
function requireSha(value, label) {
  if (typeof value !== "string" || !/^(?!0{40}$)[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}
