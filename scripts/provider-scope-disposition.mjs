// Responsibility: Suppress only an exact live provider subject backed by one valid disposition receipt.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import * as DispositionContract from "./retired-handoff-successor-disposition-contract.mjs";

export const PROVIDER_SCOPE_DISPOSITION_VALIDATION_SCHEMA =
  "agentic-provider-scope-disposition-validation/v1";
export const PROVIDER_SCOPE_DISPOSITION_SET_SCHEMA =
  "agentic-provider-scope-disposition-set/v1";
const DISPOSITION_CLASSIFICATION =
  "retired-handoff-superseded-by-merged-successor";

const SOURCE_KEYS = Object.freeze([
  "repository", "pullRequestNumber", "pullRequestNodeId", "state", "isDraft",
  "branch", "headSha", "baseSha", "bodyDigest", "providerVersion",
]);

export function validateLiveProviderScopeDisposition(
  { receipt, intent, observation } = {},
  { contract = DispositionContract } = {},
) {
  const api = contractApi(contract);
  const normalizedReceipt = api.normalizeReceipt(receipt);
  const normalizedIntent = api.normalizeIntent(intent);
  const evidence = api.normalizeEvidence(observation);
  const subjectKey = api.subjectKey(evidence);
  if (normalizedReceipt.status !== "complete"
    || normalizedReceipt.admissionEffect !== "suppress-exact-provider-subject"
    || normalizedReceipt.cleanupEligible !== false) {
    throw new Error("Provider disposition receipt cannot suppress an active subject.");
  }
  if (normalizedReceipt.subjectKey !== subjectKey) {
    throw new Error("Provider disposition receipt does not match the live subject evidence.");
  }
  const plan = normalizedIntent.planSnapshot;
  const verified = normalizedIntent.phases?.verified?.values;
  const complete = normalizedIntent.phases?.complete?.values;
  if (normalizedIntent.status !== "complete"
    || normalizedIntent.subjectKey !== subjectKey
    || normalizedReceipt.planDigest !== normalizedIntent.planDigest
    || normalizedReceipt.planDigest !== plan?.planDigest
    || normalizedReceipt.evidenceDigest !== plan?.evidenceDigest
    || normalizedReceipt.portDecisionDigest !== plan?.portDecisionDigest
    || normalizedReceipt.authorizationDigest !== normalizedIntent.authorizationDigest
    || normalizedReceipt.verifiedOperationKey !== verified?.operationKey
    || normalizedReceipt.completeOperationKey !== complete?.operationKey
    || complete?.receiptDigest !== normalizedReceipt.receiptDigest) {
    throw new Error("Provider disposition receipt is not backed by its exact complete intent.");
  }
  const authorizedSubject = projectRetiredHandoffSuccessorDurableSubject(plan.evidence);
  const liveSubject = projectRetiredHandoffSuccessorDurableSubject(evidence);
  if (digestValue(authorizedSubject) !== digestValue(liveSubject)) {
    throw new Error("Provider disposition durable subject changed after authorization.");
  }
  const provider = normalizeProviderProjection(evidence.source);
  return Object.freeze({
    schema: PROVIDER_SCOPE_DISPOSITION_VALIDATION_SCHEMA,
    status: "valid",
    classification: DISPOSITION_CLASSIFICATION,
    subjectKey,
    planDigest: normalizedReceipt.planDigest,
    intentDigest: normalizedIntent.intentDigest,
    receiptDigest: normalizedReceipt.receiptDigest,
    evidenceDigest: evidence.evidenceDigest,
    durableSubjectDigest: digestValue(liveSubject),
    provider,
    validationDigest: digestValue({
      schema: PROVIDER_SCOPE_DISPOSITION_VALIDATION_SCHEMA,
      classification: DISPOSITION_CLASSIFICATION,
      subjectKey,
      planDigest: normalizedReceipt.planDigest,
      intentDigest: normalizedIntent.intentDigest,
      receiptDigest: normalizedReceipt.receiptDigest,
      evidenceDigest: evidence.evidenceDigest,
      durableSubjectDigest: digestValue(liveSubject),
      provider,
    }),
  });
}

export function applyProviderScopeDispositionReceipts(
  { pullRequests = [], receipts = [], intents = [], observations = [] } = {},
  options = {},
) {
  requireArray(pullRequests, "pull requests");
  requireArray(receipts, "disposition receipts");
  requireArray(intents, "disposition intents");
  requireArray(observations, "disposition observations");
  if (receipts.length !== observations.length || receipts.length !== intents.length) {
    throw new Error("Every provider disposition receipt requires its intent and one live observation.");
  }
  const providers = pullRequests.map(normalizeProviderProjection);
  rejectDuplicateProviders(providers);
  const validations = receipts.map((receipt, index) =>
    validateLiveProviderScopeDisposition({
      receipt, intent: intents[index], observation: observations[index],
    }, options));
  rejectDuplicateValidations(validations);

  const activePullRequests = [];
  const suppressedSubjects = [];
  for (const provider of providers) {
    const matches = validations.filter(validation =>
      providerEqual(provider, validation.provider));
    if (matches.length > 1) {
      throw new Error("Multiple receipts matched one provider subject.");
    }
    if (matches.length === 0) {
      activePullRequests.push(provider);
      continue;
    }
    const validation = matches[0];
    suppressedSubjects.push(Object.freeze({
      subjectKey: validation.subjectKey,
      classification: validation.classification,
      planDigest: validation.planDigest,
      intentDigest: validation.intentDigest,
      receiptDigest: validation.receiptDigest,
      evidenceDigest: validation.evidenceDigest,
      durableSubjectDigest: validation.durableSubjectDigest,
      validationDigest: validation.validationDigest,
      provider,
    }));
  }
  const unused = validations.filter(validation =>
    !suppressedSubjects.some(subject => subject.subjectKey === validation.subjectKey));
  if (unused.length > 0) {
    throw new Error("A disposition receipt did not match an active provider projection.");
  }
  const blockingSubjects = activePullRequests.map(provider => Object.freeze({
    repository: provider.repository,
    pullRequestNumber: provider.pullRequestNumber,
    pullRequestNodeId: provider.pullRequestNodeId,
    headSha: provider.headSha,
    providerDigest: digestValue(provider),
  }));
  const core = {
    schema: PROVIDER_SCOPE_DISPOSITION_SET_SCHEMA,
    activePullRequests: Object.freeze(activePullRequests),
    suppressedSubjects: Object.freeze(suppressedSubjects),
    blockingSubjects: Object.freeze(blockingSubjects),
  };
  return Object.freeze({
    ...core,
    receiptSetDigest: digestValue(core),
  });
}

function normalizeProviderProjection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Provider projection must be an object.");
  }
  const result = Object.fromEntries(SOURCE_KEYS.map(key => [key, value[key]]));
  requireRepository(result.repository);
  requirePositiveInteger(result.pullRequestNumber, "pull-request number");
  requireText(result.pullRequestNodeId, "pull-request node ID");
  if (!new Set(["OPEN", "CLOSED", "MERGED"]).has(result.state)) {
    throw new Error("Provider state must be OPEN, CLOSED, or MERGED.");
  }
  if (typeof result.isDraft !== "boolean") {
    throw new Error("Provider draft projection must be boolean.");
  }
  requireText(result.branch, "provider branch");
  requireSha(result.headSha, "provider head");
  requireSha(result.baseSha, "provider base");
  requireDigest(result.bodyDigest, "provider body digest");
  requireText(result.providerVersion, "provider version");
  return Object.freeze(result);
}

export function projectRetiredHandoffSuccessorDurableSubject(evidence) {
  return Object.freeze({
    schema: "agentic-provider-scope-durable-subject/v1",
    provider: evidence.provider,
    repositoryId: evidence.repositoryId,
    controllerRepository: evidence.controller?.repository,
    ledgerRepository: evidence.ledger?.repository,
    claim: evidence.claim,
    source: select(evidence.source, [
      "repository", "pullRequestNumber", "pullRequestNodeId", "state", "isDraft",
      "branch", "headSha", "bodyDigest", "remoteHeadSha",
      "handoffMarkerFinalRevision", "retiredRevisionReachable",
    ]),
    successor: select(evidence.successor, [
      "pullRequestNumber", "pullRequestNodeId", "state", "branch", "headSha",
      "mergeCommitSha", "protectedMainContainsMerge",
    ]),
    local: evidence.local,
    functionalSourceCommits: evidence.functionalSourceCommits,
    successorCommits: evidence.successorCommits,
  });
}

function select(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Durable provider subject projection is incomplete.");
  }
  return Object.freeze(Object.fromEntries(keys.map(key => [key, value[key]])));
}

function contractApi(value) {
  const methods = {
    normalizeReceipt: value?.normalizeRetiredHandoffSuccessorDispositionReceipt,
    normalizeIntent: value?.normalizeRetiredHandoffSuccessorDispositionIntent,
    normalizeEvidence: value?.normalizeRetiredHandoffSuccessorDispositionEvidence,
    subjectKey: value?.retiredHandoffSuccessorDispositionSubjectKey,
  };
  for (const [name, method] of Object.entries(methods)) {
    if (typeof method !== "function") {
      throw new Error(`Provider disposition contract requires ${name}().`);
    }
  }
  return methods;
}

function providerEqual(left, right) {
  return SOURCE_KEYS.every(key => left[key] === right[key]);
}

function rejectDuplicateProviders(values) {
  const keys = values.map(value =>
    `${value.repository}\0${value.pullRequestNodeId}\0${value.headSha}`);
  if (new Set(keys).size !== keys.length) {
    throw new Error("Provider inventory contains duplicate subjects.");
  }
}

function rejectDuplicateValidations(values) {
  const keys = values.map(value => value.subjectKey);
  if (new Set(keys).size !== keys.length) {
    throw new Error("Provider disposition set contains duplicate subjects.");
  }
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
}

function requireRepository(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(String(value || ""))) {
    throw new Error("Provider repository must be owner/name.");
  }
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new Error(`${label} must be canonical non-empty text.`);
  }
}

function requireSha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) {
    throw new Error(`${label} must be a lowercase Git SHA.`);
  }
}

function requireDigest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
}
