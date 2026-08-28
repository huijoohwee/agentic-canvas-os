// Responsibility: Persist and replay one exact prepared-descendant supersession retirement.
import { createHash } from "node:crypto";

import {
  advanceState, authorizePlan, buildPlan, buildReceipt, createState,
  normalizeState, phaseReceipt,
} from "./admitted-prepared-descendant-canonical-supersession-retirement-contract.mjs";
import { canonicalJson, digestValue, validateLedger } from "./cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";

const MANIFEST_SCHEMA = "agentic-prepared-descendant-canonical-supersession-manifest/v1";

export function normalizeSupersessionManifest(value) {
  exactObjectKeys(value, ["entries", "expectedCanonicalRevision", "schema", "semanticScope",
    "sourceIntegrationRevision", "targetRevision"], "supersession manifest");
  if (value.schema !== MANIFEST_SCHEMA || !Array.isArray(value.entries) || value.entries.length === 0) {
    throw new Error("Supersession manifest is invalid.");
  }
  const entries = value.entries.map((entry, index) => {
    exactObjectKeys(entry, ["fieldKey", "fieldParent", "integrationWitnessRevision", "path"],
      `supersession entry ${index}`);
    return {
      path: relativeManifestPath(entry.path),
      integrationWitnessRevision: manifestSha(entry.integrationWitnessRevision, "integration witness"),
      fieldParent: yamlKey(entry.fieldParent, "field parent"),
      fieldKey: yamlKey(entry.fieldKey, "field key"),
    };
  }).sort((left, right) => compareUtf8(left.path, right.path));
  if (new Set(entries.map(entry => entry.path)).size !== entries.length) {
    throw new Error("Supersession path is duplicated.");
  }
  return deepFreeze({
    schema: MANIFEST_SCHEMA,
    semanticScope: manifestText(value.semanticScope, "semantic scope"),
    targetRevision: manifestSha(value.targetRevision, "target revision"),
    expectedCanonicalRevision: manifestSha(value.expectedCanonicalRevision, "expected canonical revision"),
    sourceIntegrationRevision: manifestSha(value.sourceIntegrationRevision, "source integration revision"),
    entries,
  });
}

export function compareStructuredSupersessionDocuments(subjectBytes, canonicalBytes, selector) {
  const source = selectYamlRevision(subjectBytes, selector);
  const current = selectYamlRevision(canonicalBytes, selector);
  if (Buffer.compare(source.normalized, current.normalized) !== 0) {
    throw new Error("Canonical document differs outside the selected structured field.");
  }
  return deepFreeze({
    subjectValue: source.value,
    canonicalValue: current.value,
    normalizedDocumentDigest: createHash("sha256").update(source.normalized).digest("hex"),
  });
}

export function normalizePullCloseChronology({
  pull, timeline, targetRepository, observedAt = null, expectedCloseEvent = undefined,
}) {
  if (!pull || !Array.isArray(timeline)) throw new Error("Pull-request close chronology is malformed.");
  pull = { ...pull, closedAt: pull.closedAt === null ? null : normalizeProviderInstant(pull.closedAt) };
  timeline = timeline.map(item => ({ ...item, createdAt: normalizeProviderInstant(item?.createdAt) }));
  if (expectedCloseEvent) expectedCloseEvent = { ...expectedCloseEvent,
    createdAt: normalizeProviderInstant(expectedCloseEvent.createdAt) };
  if (observedAt) observedAt = normalizeProviderInstant(observedAt);
  if (pull.state === "OPEN") {
    if (pull.closedAt !== null || timeline.length !== 0 || expectedCloseEvent) {
      throw new Error("Open pull request has ambiguous close or reopen chronology.");
    }
    return null;
  }
  if (pull.state !== "CLOSED" || pull.mergedAt !== null || !canonicalInstant(pull.closedAt)
    || timeline.length !== 1 || timeline[0]?.event !== "closed") {
    throw new Error("Pull request has no unique unmerged close event.");
  }
  const { event: _event, ...closeEvent } = timeline[0];
  const owner = String(targetRepository || "").split("/")[0];
  if (!Number.isSafeInteger(closeEvent.eventId) || closeEvent.eventId < 1
    || !Number.isSafeInteger(closeEvent.actorId) || closeEvent.actorId < 1
    || typeof closeEvent.nodeId !== "string" || !closeEvent.nodeId
    || closeEvent.actorLogin !== owner || closeEvent.actorType !== "User"
    || closeEvent.performedViaGitHubApp !== null || !canonicalInstant(closeEvent.createdAt)
    || Date.parse(closeEvent.createdAt) < Date.parse(pull.closedAt)
    || (observedAt && Date.parse(closeEvent.createdAt) > Date.parse(observedAt))) {
    throw new Error("Pull-request close event identity is foreign.");
  }
  if (expectedCloseEvent && canonicalJson(closeEvent) !== canonicalJson(expectedCloseEvent)) {
    throw new Error("Sealed pull-request close event drifted.");
  }
  return deepFreeze(closeEvent);
}

export function normalizeAbandonedRecoveryLineage({ ledger, status, lease, pull, expected = null }) {
  const claimId = expected?.claimId || lease?.cloudAuthority?.claimId;
  const entries = Array.isArray(ledger?.entries) ? ledger.entries.filter(item => item.claimId === claimId) : [];
  const retired = entries.filter(item => item.action === "retire");
  const entry = retired[0], core = entry?.claimCore, end = core?.retirement;
  const recovery = entry && { retirementEntryDigest: entry.digest, claimId: entry.claimId,
    claimDigest: entry.claimDigest, state: core.state, canonicalBaseRevision: core.canonicalBaseRevision,
    laneRevision: core.laneRevision, writeSetDigest: core.writeSetDigest,
    declaredWriteScope: core.declaredWriteScope, deviceId: core.deviceId, sessionId: core.sessionId,
    transitionCounter: core.transitionCounter, reviewRequestId: core.reviewRequestId, reason: end?.reason,
    finalRevision: end?.finalRevision, integrationReceiptDigest: end?.integrationReceiptDigest,
    bytesDigest: end?.bytesDigest, namedChecksDigest: end?.namedChecksDigest,
    handoffEvidenceDigest: end?.handoffEvidenceDigest, idempotencyKey: entry.idempotencyKey,
    retiredAt: end?.retiredAt };
  const authority = lease?.cloudAuthority;
  const source = authority && entries.filter(item => item.claimDigest === authority.claimDigest);
  const exactSource = source?.length === 1 && source[0].action === "continue"
    && source[0].claimCore?.state === "current"
    && source[0].claimCore.transitionCounter === authority.transitionCounter
    && source[0].claimCore.canonicalBaseRevision === lease.baseSha
    && source[0].claimCore.laneRevision === lease.fenceSha
    && source[0].claimCore.writeSetDigest === lease.admission?.writeSetDigest
    && canonicalJson(source[0].claimCore.declaredWriteScope) === canonicalJson(lease.admission?.declaredWriteSet)
    && core?.transitionCounter === source[0].claimCore.transitionCounter + 1;
  const exactLineage = expected ? canonicalJson(recovery) === canonicalJson(expected) : exactSource;
  const owner = (namespace, projected, local) => typeof local === "string" && local.length > 0
    && (projected === local || projected === pseudonymousIdentifier(namespace, local));
  if (!claimId || validateLedger(ledger).length || ledger.headDigest !== status?.ledgerDigest
    || ledger.sequence !== status?.sequence || status.claims?.filter(item => item.claimId === claimId).length !== 0
    || retired.length !== 1 || entry !== entries.at(-1) || !exactLineage || core?.state !== "retired"
    || recovery.reason !== "abandoned" || recovery.finalRevision !== lease.fenceSha
    || recovery.canonicalBaseRevision !== lease.baseSha || recovery.laneRevision !== lease.fenceSha
    || recovery.reviewRequestId !== `github-pull-request:${pull?.nodeId}`
    || recovery.integrationReceiptDigest !== null || !owner("device", recovery.deviceId, lease.device)
    || !owner("session", recovery.sessionId, lease.sessionId)) {
    throw new Error("Cloud claim is not one exact preserved abandoned retirement.");
  }
  return deepFreeze({ entry, recovery });
}

function selectYamlRevision(value, selector) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const document = bytes.toString("utf8");
  if (!Buffer.from(document, "utf8").equals(bytes) || document.startsWith("\uFEFF")
    || !document.startsWith("---\n") || document.includes("\r")) {
    throw new Error("Supersession document must be canonical UTF-8 frontmatter.");
  }
  const end = document.indexOf("\n---\n", 4);
  if (end < 0) throw new Error("Supersession document frontmatter is unterminated.");
  const frontmatter = document.slice(4, end), lines = frontmatter.split("\n");
  if (frontmatter.includes("\t") || lines.some(line => line.trim() === "...")) {
    throw new Error("Supersession frontmatter contains ambiguous YAML structure.");
  }
  const nodes = lines.map((line, index) => parseYamlNode(line, index)).filter(Boolean);
  const parents = nodes.filter(node => node.indent === 0 && node.key === selector.fieldParent);
  if (parents.length !== 1 || parents[0].rawKey !== selector.fieldParent || parents[0].value !== "") {
    throw new Error("Supersession field parent must be one exact bare mapping.");
  }
  const parent = parents[0];
  const blockEnd = nodes.find(node => node.index > parent.index && node.indent === 0)?.index ?? lines.length;
  const block = nodes.filter(node => node.index > parent.index && node.index < blockEnd);
  if (block.some(node => node.complex || node.blockScalar || node.yamlReference)) {
    throw new Error("Supersession field parent contains ambiguous YAML nodes.");
  }
  const matches = block.filter(node => node.key === selector.fieldKey);
  if (matches.length !== 1 || matches[0].indent !== 2 || matches[0].rawKey !== selector.fieldKey) {
    throw new Error("Supersession field key must be one exact direct child mapping.");
  }
  const selected = matches[0], revision = selected.value.match(/^"([0-9a-f]{40})"$/u)?.[1];
  if (!revision) throw new Error("Supersession field revision must be one quoted SHA.");
  lines[selected.index] = `  ${selected.rawKey}: "<agentic-supersession-revision>"`;
  return { value: revision, normalized: Buffer.from(`---\n${lines.join("\n")}${document.slice(end)}`, "utf8") };
}

function parseYamlNode(line, index) {
  if (!line.trim() || line.trimStart().startsWith("#")) return null;
  const indent = line.length - line.trimStart().length, content = line.slice(indent);
  if (indent % 2 !== 0 || content.startsWith("?") || content.startsWith("-")) {
    return { index, indent, complex: true, blockScalar: false, yamlReference: false };
  }
  const colon = yamlMappingColon(content);
  if (colon < 1) return { index, indent, complex: true, blockScalar: false, yamlReference: false };
  const rawKey = content.slice(0, colon).trim(), result = content.slice(colon + 1).trim();
  const key = yamlScalarKey(rawKey);
  return { index, indent, key, rawKey, value: result, complex: key === null,
    blockScalar: /^[>|][0-9+-]*$/u.test(result),
    yamlReference: /(^|\s)(?:[&*!]|<<\s*:)/u.test(content) };
}

function yamlMappingColon(value) {
  let quote = null, escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === "\"") {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
    } else if (quote === "'") {
      if (character === "'" && value[index + 1] === "'") index += 1;
      else if (character === quote) quote = null;
    } else if (character === "\"" || character === "'") quote = character;
    else if (character === ":") return index;
  }
  return -1;
}

function yamlScalarKey(value) {
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/u.test(value)) return value;
  if (value.startsWith("\"") && value.endsWith("\"")) {
    try { const result = JSON.parse(value); return typeof result === "string" ? result : null; }
    catch { return null; }
  }
  return value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1).replace(/''/gu, "'") : null;
}

function exactObjectKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort(compareUtf8)) !== JSON.stringify([...expected].sort(compareUtf8))) {
    throw new Error(`${label} keys are invalid.`);
  }
}
function manifestText(value, label) {
  if (typeof value !== "string" || !value || value.trim() !== value) throw new Error(`${label} is invalid.`);
  return value;
}
function manifestSha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) throw new Error(`${label} is invalid.`);
  return value;
}
function relativeManifestPath(value) {
  const result = manifestText(value, "supersession path");
  if (result.startsWith("/") || result.split("/").includes("..")) throw new Error("supersession path is invalid.");
  return result;
}
function yamlKey(value, label) {
  const result = manifestText(value, label);
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/u.test(result)) throw new Error(`${label} is invalid.`);
  return result;
}
function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
function canonicalInstant(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
export function normalizeProviderInstant(value) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{3}))?Z$/u.exec(String(value || ""));
  if (!match) throw new Error("Provider timestamp is not canonical UTC RFC3339 seconds or milliseconds.");
  const canonical = `${match[1]}.${match[2] || "000"}Z`, parsed = Date.parse(canonical);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== canonical)
    throw new Error("Provider timestamp is not a valid canonical UTC instant.");
  return canonical;
}
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value;
}

export function createController({ adapter }) {
  requireAdapter(adapter);
  return Object.freeze({
    async plan() {
      return adapter.withLock({ action: "plan" }, async () => {
        const current = await adapter.readState();
        if (current) return normalizeState(current).plan;
        const plan = buildPlan(await adapter.observe());
        return (await adapter.writeState({ expected: null, next: createState(plan) })).plan;
      });
    },
    async run({ planDigest, authorization }) {
      return adapter.withLock({ action: "run", planDigest }, async () =>
        execute({ adapter, planDigest, authorization }));
    },
  });
}

async function execute({ adapter, planDigest, authorization }) {
  let state = normalizeState(await adapter.readState());
  if (state.plan.planDigest !== planDigest) {
    throw new Error("Run digest does not match the persisted supersession retirement plan.");
  }
  authorizePlan(state.plan, authorization);
  if (state.phase === "complete") {
    const terminal = await adapter.verifyTerminal(state.plan);
    if (terminal.terminalEvidenceDigest
      !== state.receipts.complete.receipt.terminalEvidenceDigest) {
      throw new Error("Supersession retirement terminal evidence drifted after completion.");
    }
    return state.receipts.complete.receipt;
  }
  if (state.phase === "planned") {
    state = await advance(adapter, state, "authorized", phaseReceipt("authorized", {
      authorizationDigest: digestValue({ planDigest, authorization }),
    }));
  }
  if (state.phase === "authorized") {
    const proof = await adapter.verifySourceAuthority(state.plan);
    state = await advance(adapter, state, "source-authority-verified",
      phaseReceipt("source-authority-verified", proof));
  }
  if (state.phase === "source-authority-verified") {
    const result = await converge(adapter.classifyClaim, adapter.retireClaim,
      state.plan, "cloud claim retirement");
    state = await advance(adapter, state, "claim-retired", phaseReceipt("claim-retired", result));
  }
  if (state.phase === "claim-retired") {
    const result = await converge(adapter.classifyPullRequest, adapter.closePullRequest,
      state.plan, "pull-request closure");
    state = await advance(adapter, state, "pull-request-closed",
      phaseReceipt("pull-request-closed", result));
  }
  if (state.phase === "pull-request-closed") {
    const result = await converge(adapter.classifyOwnerReleased, adapter.releaseOwner,
      state.plan, "local owner release");
    state = await advance(adapter, state, "owner-released", phaseReceipt("owner-released", result));
  }
  if (state.phase === "owner-released") {
    const terminal = await adapter.verifyTerminal(state.plan);
    const receipt = buildReceipt(state, terminal.terminalEvidenceDigest);
    state = await advance(adapter, state, "complete", phaseReceipt("complete", { receipt }));
  }
  if (state.phase !== "complete") throw new Error(`Supersession retirement stopped at ${state.phase}.`);
  return state.receipts.complete.receipt;
}

async function converge(classify, effect, plan, label) {
  const before = await classify(plan);
  if (before?.state === "complete") return before.values;
  if (before?.state !== "pending") throw new Error(`${label} classification is invalid.`);
  let failure;
  try { await effect(plan); } catch (error) { failure = error; }
  const after = await classify(plan);
  if (after?.state !== "complete") {
    if (failure) throw failure;
    throw new Error(`${label} did not converge.`);
  }
  return after.values;
}

async function advance(adapter, state, phase, receipt) {
  const next = advanceState(state, phase, receipt);
  return normalizeState(await adapter.writeState({ expected: state, next }));
}

function requireAdapter(adapter) {
  for (const method of [
    "observe", "readState", "writeState", "withLock", "verifySourceAuthority",
    "classifyClaim", "retireClaim", "classifyPullRequest", "closePullRequest",
    "classifyOwnerReleased", "releaseOwner", "verifyTerminal",
  ]) {
    if (typeof adapter?.[method] !== "function") {
      throw new Error(`Supersession retirement adapter requires ${method}().`);
    }
  }
}
