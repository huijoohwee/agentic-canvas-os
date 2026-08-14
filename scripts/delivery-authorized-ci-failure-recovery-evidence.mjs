// Responsibility: Normalize exact evidence for one failed delivery-authorized lane.
import { digestValue, normalizeWriteSet, writeSetsOverlap } from "./cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "./github-cloud-collaboration-mapping.mjs";
import { projectWriterLeasePullRequestMarker } from "./writer-lease-lib.mjs";
import { normalizeCurrentClaimInventory } from "./scoped-lane-cloud-reconciliation.mjs";
export const DELIVERY_AUTHORIZED_CI_FAILURE_RECOVERY_EVIDENCE_SCHEMA =
  "agentic-delivery-authorized-ci-failure-recovery-evidence/v1";
const SHA = /^[0-9a-f]{40}$/u, DIGEST = /^[0-9a-f]{64}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const LEASE_KEYS = Object.freeze(("schema status epoch sessionId device scope branch worktreePath baseSha fenceSha pullRequestUrl autoDelivery runtimeRequired admission cloudAuthority acquiredAt heartbeatAt expiresAt integration deliveryHeadSha").split(" "));
const ADMISSION_KEYS = Object.freeze(("schema status semanticScope declaredWriteSet writeSetDigest manifestDigest planReceiptDigest admissionReceiptDigest existingLaneStateDigest admittedReportDigest preservationReceiptDigest").split(" "));
const INTEGRATION_KEYS = Object.freeze(("candidateRevision reviewRequestId focusedEvidenceDigest dependencyClosureDigest namedChecksDigest handoffEvidenceDigest operatorDecisionDigest integrationIntentDigest integratedAt").split(" "));
const AUTHORITY_KEYS = Object.freeze(("schema provider ledgerRepository targetRepository claimId claimDigest ledgerRevision ledgerDigest claimLedgerRevision entrySchema claimIdentitySchema operationReceiptDigest mutationAuthorityEligible canonicalBaseSha laneRevision cloudDeclaredWriteScope writeSetDigest deviceId sessionId reviewRequestId leaseEpoch transitionCounter state expiresAt integrationReceiptDigest integration focusedEvidenceDigest manifestDigest").split(" "));
const PUBLIC_CLAIM_KEYS = Object.freeze(["claimId", "entrySchema", "claimIdentitySchema",
  "state", "writeAuthority", "scopeReserved", "actorId", "repositoryId", "workItemId",
  "canonicalBaseRevision", "laneRevision", "declaredWriteScope", "writeSetDigest",
  "leaseEpoch", "transitionCounter", "heartbeatCounter", "reviewRequestId",
  "predecessorClaimId", "expiresAt", "fenceRevision", "transitionDigest",
  "operationReceiptDigest", "integrationReceiptDigest", "integration"]);
const PRIVATE_CLAIM_KEYS = Object.freeze(PUBLIC_CLAIM_KEYS.filter(key => key !== "transitionDigest")
  .concat(["recordedState", "deviceId", "sessionId", "ledgerRevision"]));
export function buildDeliveryAuthorizedCiFailureRecoveryEvidence(input = {}) {
  const core = normalizeCore({ ...input,
    schema: DELIVERY_AUTHORIZED_CI_FAILURE_RECOVERY_EVIDENCE_SCHEMA });
  return freeze({ ...core, evidenceDigest: digestValue(core) });
}
export function normalizeDeliveryAuthorizedCiFailureRecoveryEvidence(value) {
  if (value?.schema !== DELIVERY_AUTHORIZED_CI_FAILURE_RECOVERY_EVIDENCE_SCHEMA) {
    invalid("evidence schema");
  }
  exact(value, [...CORE_KEYS, "schema", "evidenceDigest"], "evidence");
  const { evidenceDigest: ignored, ...rawCore } = value, core = normalizeCore(rawCore);
  if (digest(value.evidenceDigest, "evidence digest") !== digestValue(core)) {
    invalid("evidence digest");
  }
  return freeze({ ...core, evidenceDigest: value.evidenceDigest });
}
const CORE_KEYS = Object.freeze(["repository", "actor", "controller", "source", "lease",
  "authority", "cloud", "provider", "protectedAdvance"]);
function normalizeCore(value) {
  exact(value, [...CORE_KEYS, "schema"], "evidence core");
  const authority = boundRecord(value.authority, "authority", authorityRecord);
  const core = { schema: DELIVERY_AUTHORIZED_CI_FAILURE_RECOVERY_EVIDENCE_SCHEMA,
    repository: identity(value.repository, "repository"), actor: actor(value.actor),
    controller: controller(value.controller), source: source(value.source), lease: lease(value.lease),
    authority, cloud: cloud(value.cloud, authority.record),
    provider: provider(value.provider), protectedAdvance: protectedAdvance(value.protectedAdvance) };
  assertJoined(core);
  return freeze(core);
}
function identity(value, label) {
  const result = { fullName: text(value?.fullName, `${label} name`),
    nodeId: text(value?.nodeId, `${label} node ID`),
    databaseId: integer(value?.databaseId, `${label} database ID`) };
  exact(value, Object.keys(result), label);
  if (!REPOSITORY.test(result.fullName)) invalid(`${label} name`);
  return freeze(result);
}
function actor(value) {
  const result = { id: integer(value?.id, "actor ID"), nodeId: text(value?.nodeId,
    "actor node ID"), login: text(value?.login, "actor login"),
  type: value?.type === "User" ? "User" : invalid("actor type") };
  exact(value, Object.keys(result), "actor");
  return freeze(result);
}
function controller(value) {
  const result = { revisionSha: sha(value?.revisionSha, "controller revision"),
    observedMainSha: sha(value?.observedMainSha, "observed main") };
  exact(value, Object.keys(result), "controller");
  return freeze(result);
}
function source(value) {
  const result = { branch: text(value?.branch, "source branch"), headSha: sha(value?.headSha,
    "source head"), treeSha: sha(value?.treeSha, "source tree"), remoteHeadSha:
      sha(value?.remoteHeadSha, "remote head"),
    worktreeIdentityDigest: digest(value?.worktreeIdentityDigest, "worktree identity"),
    indexDigest: digest(value?.indexDigest, "source index"),
    clean: value?.clean === true ? true : invalid("clean source") };
  exact(value, Object.keys(result), "source");
  return freeze(result);
}
function lease(value) {
  exact(value, ["record", "leaseDigest"], "source lease wrapper");
  const record = clone(value.record, "source lease");
  exact(record, LEASE_KEYS, "source lease");
  if (record.schema !== "agentic-writer-lease/v2" || record.status !== "delivery"
    || !Number.isSafeInteger(record.epoch) || record.epoch < 1
    || record.autoDelivery !== true || record.runtimeRequired !== true
    || Object.hasOwn(record, "taskAuthority")) invalid("legacy source lease shape");
  const admissionRecord = admission(record.admission);
  const integrationRecord = sourceIntegration(record.integration);
  const normalized = { ...record, sessionId: text(record.sessionId, "lease session"),
    device: text(record.device, "lease device"), scope: text(record.scope, "lease scope"),
    branch: text(record.branch, "lease branch"), worktreePath: text(record.worktreePath,
      "lease worktree"), baseSha: sha(record.baseSha, "lease base"),
    fenceSha: sha(record.fenceSha, "lease fence"), pullRequestUrl: pullUrl(record.pullRequestUrl),
    admission: admissionRecord, cloudAuthority: authorityRecord(record.cloudAuthority),
    acquiredAt: instant(record.acquiredAt, "lease acquisition"),
    heartbeatAt: instant(record.heartbeatAt, "lease heartbeat"),
    expiresAt: instant(record.expiresAt, "lease expiry"), integration: integrationRecord,
    deliveryHeadSha: sha(record.deliveryHeadSha, "delivery head") };
  const leaseDigest = digest(value.leaseDigest, "source lease digest");
  if (digestValue(normalized) !== leaseDigest) invalid("source lease digest");
  return freeze({ record: normalized, leaseDigest });
}
function admission(value) {
  exact(value, ADMISSION_KEYS, "admission");
  const result = { ...value, schema: value.schema === "agentic-lane-admission-lease/v1"
      ? value.schema : invalid("admission schema"),
    status: value.status === "admitted" ? value.status : invalid("admission status"),
    semanticScope: text(value.semanticScope, "admission scope"),
    declaredWriteSet: normalizeWriteSet(value.declaredWriteSet) };
  for (const key of ADMISSION_KEYS.filter(key => key.endsWith("Digest"))) {
    result[key] = digest(value[key], `admission ${key}`);
  }
  if (digestValue(result.declaredWriteSet) !== result.writeSetDigest) invalid("admission write set");
  return freeze(result);
}
function sourceIntegration(value) {
  const keys = ["schema", "commitSha", "treeSha", "commitMessage", "manifestDigest",
    "stagedDiffDigest", "paths", "recordedAt"];
  exact(value, keys, "source integration");
  const paths = pathArray(value.paths, "source integration paths"); return freeze({
    schema: value.schema === "agentic-integration-commit/v1"
      ? value.schema : invalid("integration schema"),
    commitSha: sha(value.commitSha, "integration commit"),
    treeSha: sha(value.treeSha, "integration tree"),
    commitMessage: text(value.commitMessage, "integration message"),
    manifestDigest: digest(value.manifestDigest, "integration manifest"),
    stagedDiffDigest: digest(value.stagedDiffDigest, "integration staged diff"), paths,
    recordedAt: instant(value.recordedAt, "integration time") });
}
function boundRecord(value, label, normalize) {
  exact(value, ["record", "recordDigest"], `${label} wrapper`);
  const record = normalize(value.record), recordDigest = digest(value.recordDigest,
    `${label} record digest`);
  if (digestValue(record) !== recordDigest) invalid(`${label} record digest`);
  return freeze({ record, recordDigest });
}
function integrationEvidence(value, label = "claim integration") {
  exact(value, INTEGRATION_KEYS, label);
  const result = { candidateRevision: sha(value.candidateRevision, `${label} candidate`),
    reviewRequestId: text(value.reviewRequestId, `${label} review`),
    focusedEvidenceDigest: digest(value.focusedEvidenceDigest, `${label} focused evidence`),
    dependencyClosureDigest: digest(value.dependencyClosureDigest, `${label} dependency closure`),
    namedChecksDigest: digest(value.namedChecksDigest, `${label} named checks`),
    handoffEvidenceDigest: digest(value.handoffEvidenceDigest, `${label} handoff evidence`),
    operatorDecisionDigest: digest(value.operatorDecisionDigest, `${label} operator decision`),
    integrationIntentDigest: digest(value.integrationIntentDigest, `${label} intent`),
    integratedAt: instant(value.integratedAt, `${label} time`) };
  return freeze(result);
}
function authorityRecord(value) {
  exact(value, AUTHORITY_KEYS, "authority record");
  const scope = normalizeWriteSet(value.cloudDeclaredWriteScope);
  if (digestValue(scope) !== value.writeSetDigest) invalid("authority write set");
  return freeze({ schema: value.schema === "agentic-lane-cloud-authority/v1" ? value.schema
      : invalid("authority schema"), provider: value.provider === "github" ? value.provider
      : invalid("authority provider"),
    ledgerRepository: repositoryName(value.ledgerRepository, "authority ledger repository"),
    targetRepository: repositoryName(value.targetRepository, "authority target repository"),
    claimId: digest(value.claimId, "authority claim ID"),
    claimDigest: digest(value.claimDigest, "authority claim digest"),
    ledgerRevision: sha(value.ledgerRevision, "authority ledger revision"),
    ledgerDigest: digest(value.ledgerDigest, "authority ledger digest"),
    claimLedgerRevision: digest(value.claimLedgerRevision, "authority claim ledger revision"),
    entrySchema: claimSchema(value.entrySchema, "authority entry schema"),
    claimIdentitySchema: claimSchema(value.claimIdentitySchema, "authority identity schema"),
    operationReceiptDigest: digest(value.operationReceiptDigest, "authority operation receipt"),
    mutationAuthorityEligible: value.mutationAuthorityEligible === true ? true
      : invalid("authority mutation eligibility"),
    canonicalBaseSha: sha(value.canonicalBaseSha, "authority canonical base"),
    laneRevision: sha(value.laneRevision, "authority lane revision"),
    cloudDeclaredWriteScope: scope, writeSetDigest: digest(value.writeSetDigest,
      "authority write-set digest"), deviceId: text(value.deviceId, "authority device"),
    sessionId: text(value.sessionId, "authority session"),
    reviewRequestId: text(value.reviewRequestId, "authority review"),
    leaseEpoch: integer(value.leaseEpoch, "authority epoch"),
    transitionCounter: integer(value.transitionCounter, "authority transition"),
    state: value.state === "delivery_authorized" ? value.state : invalid("authority state"),
    expiresAt: instant(value.expiresAt, "authority expiry"),
    integrationReceiptDigest: digest(value.integrationReceiptDigest, "authority integration receipt"),
    integration: integrationEvidence(value.integration, "authority integration"),
    focusedEvidenceDigest: digest(value.focusedEvidenceDigest, "authority focused evidence"),
    manifestDigest: digest(value.manifestDigest, "authority manifest") });
}
function publicClaimRecord(value) {
  exact(value, PUBLIC_CLAIM_KEYS, "public claim record");
  return claimRecord(value, false);
}
function privateClaimRecord(value) {
  exact(value, PRIVATE_CLAIM_KEYS, "private claim record");
  return claimRecord(value, true);
}
function claimRecord(value, privateProjection) {
  const scope = normalizeWriteSet(value.declaredWriteScope);
  if (digestValue(scope) !== value.writeSetDigest) invalid("claim write set");
  const result = { claimId: digest(value.claimId, "claim ID"),
    entrySchema: claimSchema(value.entrySchema, "claim entry schema"),
    claimIdentitySchema: claimSchema(value.claimIdentitySchema, "claim identity schema"),
    state: value.state === "dormant-preserved" ? value.state : invalid("claim state"),
    writeAuthority: value.writeAuthority === false ? false : invalid("claim write authority"),
    scopeReserved: value.scopeReserved === true ? true : invalid("claim reservation"),
    actorId: text(value.actorId, "claim actor"), repositoryId: text(value.repositoryId,
      "claim repository"), workItemId: text(value.workItemId, "claim work item"),
    canonicalBaseRevision: sha(value.canonicalBaseRevision, "claim canonical base"),
    laneRevision: sha(value.laneRevision, "claim lane revision"), declaredWriteScope: scope,
    writeSetDigest: digest(value.writeSetDigest, "claim write-set digest"),
    leaseEpoch: integer(value.leaseEpoch, "claim epoch"),
    transitionCounter: integer(value.transitionCounter, "claim transition"),
    heartbeatCounter: counter(value.heartbeatCounter, "claim heartbeat"),
    reviewRequestId: text(value.reviewRequestId, "claim review"),
    predecessorClaimId: value.predecessorClaimId === null ? null : invalid("claim predecessor"),
    expiresAt: instant(value.expiresAt, "claim expiry"),
    fenceRevision: digest(value.fenceRevision, "claim fence"),
    operationReceiptDigest: digest(value.operationReceiptDigest, "claim operation receipt"),
    integrationReceiptDigest: digest(value.integrationReceiptDigest, "claim integration receipt"),
    integration: integrationEvidence(value.integration) };
  if (!privateProjection) result.transitionDigest = digest(value.transitionDigest,
    "public claim transition");
  else Object.assign(result, { recordedState: value.recordedState === "integrated-preserved"
      ? value.recordedState : invalid("private recorded state"),
    deviceId: text(value.deviceId, "private claim device"),
    sessionId: text(value.sessionId, "private claim session"),
    ledgerRevision: digest(value.ledgerRevision, "private claim ledger revision") });
  return freeze(result);
}
function cloud(value, authority) {
  exact(value, ["ledgerRevision", "ledgerDigest", "inventoryDigest", "publicClaim",
    "privateClaim", "inventory", "overlappingReservedClaimIds"], "cloud");
  const overlap = digestArray(value.overlappingReservedClaimIds, "overlapping claims"),
    inventory = currentInventory(value.inventory, authority), derived = inventory.claims
      .filter(claim => claim.claimId !== authority.claimId
        && writeSetsOverlap(claim.declaredWriteScope, authority.cloudDeclaredWriteScope))
      .map(claim => claim.claimId).sort();
  if (overlap.length !== 0 || JSON.stringify(overlap) !== JSON.stringify(derived)) {
    invalid("overlapping reserved claim");
  }
  if (value.ledgerRevision !== inventory.observedLedgerHeadRevision
    || value.ledgerDigest !== inventory.ledgerDigest
    || value.inventoryDigest !== inventory.inventoryDigest) invalid("cloud inventory head");
  return freeze({ ledgerRevision: sha(value.ledgerRevision, "ledger revision"),
    ledgerDigest: digest(value.ledgerDigest, "ledger digest"), inventoryDigest:
      digest(value.inventoryDigest, "claim inventory"),
    publicClaim: boundRecord(value.publicClaim, "public claim", publicClaimRecord),
    privateClaim: boundRecord(value.privateClaim, "private claim", privateClaimRecord),
    inventory, overlappingReservedClaimIds: overlap });
}
function currentInventory(value, authority) {
  exact(value, ["schema", "complete", "totalCount", "pageCount", "observedLedgerHeadRevision",
    "ledgerDigest", "evaluationTime", "claims", "inventoryDigest"], "current inventory");
  if (value.complete !== true || !Array.isArray(value.claims) || value.claims.length < 1
    || integer(value.totalCount, "inventory count") !== value.claims.length
    || integer(value.pageCount, "inventory pages") > 10) invalid("complete inventory");
  const target = value.claims.filter(claim => claim.claimId === authority.claimId);
  if (target.length !== 1) invalid("inventory target");
  const normalized = normalizeCurrentClaimInventory({ inventoryResult: {
    schema: "agentic-cloud-collaboration-result/v1", ok: true, action: "status", status: "ready",
    ledgerRevision: value.observedLedgerHeadRevision, ledgerDigest: value.ledgerDigest,
    claims: value.claims }, verificationResult: { ledgerRevision: value.observedLedgerHeadRevision,
    claimDigest: target[0].fenceRevision, claim: { transitionDigest: target[0].transitionDigest },
    receipt: { ledgerDigest: value.ledgerDigest, evaluationTime: value.evaluationTime } }, authority });
  const expected = { ...normalized, complete: true, totalCount: normalized.claims.length,
    pageCount: value.pageCount };
  exact(value, Object.keys(expected), "inventory projection");
  if (JSON.stringify(value) !== JSON.stringify(expected)) invalid("inventory proof");
  return freeze(expected);
}
function provider(value) {
  exact(value, ["rest", "graphql", "failure", "protection"], "provider");
  return freeze({ rest: pull(value.rest, "REST"), graphql: pull(value.graphql, "GraphQL"),
    failure: failure(value.failure), protection: protection(value.protection) });
}
function pull(value, label) {
  const keys = ["number", "nodeId", "url", "state", "isDraft", "merged", "title",
    "bodyDigest", "writerMarkerDigest", "writerMarkerCount", "headBranch", "headSha",
    "baseBranch", "baseSha", "author", "headRepository", "baseRepository",
    "isInMergeQueue", "mergeQueueEntry", "autoMergeRequest"];
  exact(value, keys, `${label} pull request`);
  const result = { number: integer(value.number, `${label} PR number`),
    nodeId: text(value.nodeId, `${label} PR node`), url: pullUrl(value.url),
    state: value.state === "OPEN" ? "OPEN" : invalid(`${label} PR state`),
    isDraft: value.isDraft === false ? false : invalid(`${label} PR draft`),
    merged: value.merged === false ? false : invalid(`${label} PR merged state`),
    title: text(value.title, `${label} PR title`),
    bodyDigest: digest(value.bodyDigest, `${label} body`),
    writerMarkerDigest: digest(value.writerMarkerDigest, `${label} writer marker`),
    writerMarkerCount: value.writerMarkerCount === 1 ? 1 : invalid(`${label} marker count`),
    headBranch: text(value.headBranch, `${label} head branch`),
    headSha: sha(value.headSha, `${label} head`),
    baseBranch: value.baseBranch === "main" ? "main" : invalid(`${label} base branch`),
    baseSha: sha(value.baseSha, `${label} base`), author: actor(value.author),
    headRepository: identity(value.headRepository, `${label} head repository`),
    baseRepository: identity(value.baseRepository, `${label} base repository`),
    isInMergeQueue: value.isInMergeQueue === false ? false : invalid(`${label} queue state`),
    mergeQueueEntry: value.mergeQueueEntry === null ? null : invalid(`${label} queue entry`),
    autoMergeRequest: autoMerge(value.autoMergeRequest, label) };
  return freeze(result);
}
function autoMerge(value, label) {
  const keys = ["mergeMethod", "commitHeadline", "commitBody", "enabledAt", "enabledBy"];
  exact(value, keys, `${label} auto-merge`);
  return freeze({ mergeMethod: value.mergeMethod === "SQUASH" ? "SQUASH"
      : invalid(`${label} merge method`),
    commitHeadline: text(value.commitHeadline, `${label} merge headline`),
    commitBody: value.commitBody === null ? null : text(value.commitBody, `${label} merge body`),
    enabledAt: instant(value.enabledAt, `${label} auto-merge time`),
    enabledBy: actor(value.enabledBy) });
}
function failure(value) {
  exact(value, ["check", "inventory", "run", "job"], "failure");
  const check = failedCheck(value.check), inventory = checkInventory(value.inventory);
  const run = workflowRun(value.run), job = workflowJob(value.job);
  const peers = inventory.items.filter(item => item.name === check.name
    && item.appId === check.appId && item.headSha === check.headSha);
  const selected = peers.find(item => item.id === check.id);
  if (!selected || peers.at(-1).id !== check.id
    || digestValue(selected) !== digestValue({ ...check, workflowRunAttempt: run.attempt })
    || peers.some(item => ["queued", "in_progress"].includes(item.status))
    || job.id !== check.id || job.runId !== run.id || job.name !== check.name
    || job.headSha !== check.headSha || job.runAttempt !== run.attempt
    || run.id !== check.workflowRunId || run.checkSuiteId !== check.checkSuiteId
    || run.headSha !== check.headSha
    || digestValue(run.pullRequests[0]) !== digestValue(check.pullRequests[0])) {
    invalid("latest failed check/run/job/attempt join");
  }
  return freeze({ check, inventory, run, job });
}
function failedCheck(value) {
  const keys = ["id", "checkSuiteId", "name", "headSha", "status", "conclusion",
    "startedAt", "completedAt", "detailsUrl", "externalIdDigest", "appId", "appSlug",
    "workflowRunId", "pullRequests"];
  exact(value, keys, "failed check");
  const pulls = value.pullRequests.map((item, index) => checkPull(item, index));
  if (pulls.length !== 1) invalid("failed check pull-request cardinality");
  const result = { id: integer(value.id, "check ID"),
    checkSuiteId: integer(value.checkSuiteId, "check suite"),
    name: text(value.name, "check name"), headSha: sha(value.headSha, "check head"),
    status: value.status === "completed" ? "completed" : invalid("check status"),
    conclusion: value.conclusion === "failure" ? "failure" : invalid("check conclusion"),
    startedAt: instant(value.startedAt, "check start"),
    completedAt: instant(value.completedAt, "check completion"),
    detailsUrl: actionUrl(value.detailsUrl),
    externalIdDigest: digest(value.externalIdDigest, "check external ID"),
    appId: integer(value.appId, "check app ID"),
    appSlug: value.appSlug === "github-actions" ? value.appSlug : invalid("check app"),
    workflowRunId: integer(value.workflowRunId, "check workflow run"),
    pullRequests: freeze(pulls) };
  const url = result.detailsUrl.match(/\/actions\/runs\/(\d+)\/job\/(\d+)$/u);
  if (!url || Number(url[1]) !== result.workflowRunId || Number(url[2]) !== result.id
    || Date.parse(result.completedAt) < Date.parse(result.startedAt)) invalid("check identity");
  return freeze(result);
}
function checkPull(value, index) {
  const result = { number: integer(value?.number, `check PR ${index}`),
    headSha: sha(value?.headSha, `check PR ${index} head`),
    headRef: text(value?.headRef, `check PR ${index} ref`),
    baseSha: sha(value?.baseSha, `check PR ${index} base`),
    baseRef: value?.baseRef === "main" ? "main" : invalid(`check PR ${index} base ref`) };
  exact(value, Object.keys(result), `check PR ${index}`);
  return freeze(result);
}
function checkInventory(value) {
  exact(value, ["complete", "totalCount", "pageCount", "items", "inventoryDigest"],
    "check inventory");
  const items = value.items.map((item, index) => checkInventoryItem(item, index));
  if (value.complete !== true || integer(value.totalCount, "check inventory count") !== items.length
    || items.length > 1_000 || integer(value.pageCount, "check inventory pages") > 10
    || new Set(items.map(item => item.id)).size !== items.length
    || JSON.stringify(items) !== JSON.stringify([...items].sort((a, b) => a.id - b.id))) {
    invalid("complete check inventory");
  }
  const core = { complete: true, totalCount: items.length, pageCount: value.pageCount, items };
  if (digest(value.inventoryDigest, "check inventory digest") !== digestValue(core)) {
    invalid("check inventory digest");
  }
  return freeze({ ...core, inventoryDigest: value.inventoryDigest });
}
function checkInventoryItem(value, index) {
  const keys = ["id", "checkSuiteId", "name", "headSha", "status", "conclusion",
    "startedAt", "completedAt", "detailsUrl", "externalIdDigest", "appId", "appSlug",
    "workflowRunId", "workflowRunAttempt", "pullRequests"];
  exact(value, keys, `check item ${index}`);
  const result = { id: integer(value.id, `check item ${index}`),
    checkSuiteId: integer(value.checkSuiteId, `check item ${index} suite`),
    name: text(value.name, `check item ${index} name`),
    headSha: sha(value.headSha, `check item ${index} head`),
    status: text(value.status, `check item ${index} status`),
    conclusion: value.conclusion === null ? null : text(value.conclusion,
      `check item ${index} conclusion`),
    startedAt: value.startedAt === null ? null : instant(value.startedAt,
      `check item ${index} start`),
    completedAt: value.completedAt === null ? null : instant(value.completedAt,
      `check item ${index} completion`), detailsUrl: actionUrl(value.detailsUrl),
    externalIdDigest: digest(value.externalIdDigest, `check item ${index} external ID`),
    appId: integer(value.appId, `check item ${index} app`),
    appSlug: value.appSlug === "github-actions" ? value.appSlug
      : invalid(`check item ${index} app`),
    workflowRunId: integer(value.workflowRunId, `check item ${index} run`),
    workflowRunAttempt: integer(value.workflowRunAttempt, `check item ${index} attempt`),
    pullRequests: freeze(value.pullRequests.map((item, pullIndex) => checkPull(item,
      `${index}.${pullIndex}`))) };
  return freeze(result);
}
function workflowRun(value) {
  const keys = ["id", "workflowId", "checkSuiteId", "path", "event", "headBranch",
    "headSha", "status", "conclusion", "attempt", "repository", "pullRequests"];
  exact(value, keys, "workflow run");
  const pulls = value.pullRequests.map((item, index) => checkPull(item, index));
  if (pulls.length !== 1) invalid("workflow pull-request cardinality");
  return freeze({ id: integer(value.id, "run ID"), workflowId: integer(value.workflowId,
      "workflow ID"), checkSuiteId: integer(value.checkSuiteId, "run check suite"),
    path: workflowPath(value.path),
    event: value.event === "pull_request" ? value.event : invalid("workflow event"),
    headBranch: text(value.headBranch, "workflow branch"),
    headSha: sha(value.headSha, "workflow head"),
    status: value.status === "completed" ? value.status : invalid("workflow status"),
    conclusion: value.conclusion === "failure" ? value.conclusion : invalid("workflow conclusion"),
    attempt: integer(value.attempt, "workflow attempt"),
    repository: identity(value.repository, "workflow repository"), pullRequests: freeze(pulls) });
}
function workflowJob(value) {
  const result = { id: integer(value?.id, "job ID"), runId: integer(value?.runId, "job run"),
    runAttempt: integer(value?.runAttempt, "job run attempt"),
    name: text(value?.name, "job name"), headSha: sha(value?.headSha, "job head"),
    status: value?.status === "completed" ? value.status : invalid("job status"),
    conclusion: value?.conclusion === "failure" ? value.conclusion : invalid("job conclusion") };
  exact(value, Object.keys(result), "workflow job");
  return freeze(result);
}
function protection(value) {
  exact(value, ["repository", "branch", "strict", "contexts", "checks", "inventoryDigest"],
    "protection");
  const contexts = stringArray(value.contexts, "required contexts"), checks = value.checks
    .map((item, index) => { exact(item, ["context", "appId"], `required check ${index}`);
      return { context: text(item.context, `required check ${index}`),
        appId: integer(item.appId, `required check ${index} app`) }; })
    .sort((a, b) => a.context.localeCompare(b.context) || a.appId - b.appId);
  const core = { repository: text(value.repository, "protected repository"),
    branch: value.branch === "main" ? "main" : invalid("protected branch"),
    strict: value.strict === true ? true : invalid("strict protection"), contexts, checks };
  if (digest(value.inventoryDigest, "protection digest") !== digestValue(core)) {
    invalid("protection digest");
  }
  return freeze({ ...core, inventoryDigest: value.inventoryDigest });
}
function protectedAdvance(value) {
  const keys = ["sourceBaseSha", "checkAttemptBaseSha", "pullRequestBaseSha",
    "controllerRevisionSha", "currentMainSha", "changedWriteScope", "changedWriteScopeDigest",
    "sourceBaseAncestorOfCheckAttemptBase", "checkAttemptBaseAncestorOfPullRequestBase",
    "pullRequestBaseAncestorOfCurrentMain", "controllerRevisionAncestorOfCurrentMain",
    "disposition"];
  exact(value, keys, "protected advance");
  const scope = value.changedWriteScope.length === 0 ? [] : normalizeWriteSet(value.changedWriteScope);
  if (scope.length > 512 || digest(value.changedWriteScopeDigest, "changed scope digest")
      !== digestValue(scope)) invalid("protected changed scope");
  return freeze({ ...value, sourceBaseSha: sha(value.sourceBaseSha, "protected source base"),
    pullRequestBaseSha: sha(value.pullRequestBaseSha, "protected PR base"),
    checkAttemptBaseSha: sha(value.checkAttemptBaseSha, "protected check base"),
    controllerRevisionSha: sha(value.controllerRevisionSha, "protected controller"),
    currentMainSha: sha(value.currentMainSha, "protected current main"), changedWriteScope: scope,
    sourceBaseAncestorOfCheckAttemptBase: value.sourceBaseAncestorOfCheckAttemptBase === true,
    checkAttemptBaseAncestorOfPullRequestBase: value.checkAttemptBaseAncestorOfPullRequestBase === true,
    pullRequestBaseAncestorOfCurrentMain: value.pullRequestBaseAncestorOfCurrentMain === true,
    controllerRevisionAncestorOfCurrentMain: value.controllerRevisionAncestorOfCurrentMain === true,
    disposition: value.disposition === "disjoint-preserved" ? value.disposition
      : invalid("protected disposition") });
}
function assertJoined(value) {
  const { repository: repo, actor: owner, controller: control, source: sourceRecord,
    lease, authority, cloud, provider: github, protectedAdvance: advance } = value;
  const writer = lease.record, bound = authority.record, publicClaim = cloud.publicClaim.record;
  const privateClaim = cloud.privateClaim.record, rest = github.rest, graph = github.graphql;
  if (digestValue(rest) !== digestValue(graph)) invalid("REST/GraphQL pull join");
  const review = `github-pull-request:${rest.nodeId}`, check = github.failure.check;
  const publicPrivate = PUBLIC_CLAIM_KEYS.filter(key => key !== "transitionDigest");
  if (publicPrivate.some(key => digestValue(publicClaim[key]) !== digestValue(privateClaim[key]))) {
    invalid("public/private claim join");
  }
  const inventoryClaim = cloud.inventory.claims.filter(item => item.claimId === publicClaim.claimId);
  const admittedPaths = writer.admission.declaredWriteSet.filter(item => item.startsWith("path:"))
    .map(item => item.slice(5));
  const { writeAuthority: ignoredWrite, scopeReserved: ignoredScope,
    predecessorClaimId: ignoredPredecessor, integrationReceiptDigest: ignoredReceipt,
    integration: ignoredIntegration, ...inventoryProjection } = publicClaim;
  inventoryProjection.mutationAuthorityEligible = true; inventoryProjection.state = "parked";
  if (publicClaim.transitionDigest !== privateClaim.ledgerRevision
    || inventoryClaim.length !== 1 || inventoryClaim[0].fenceRevision !== publicClaim.fenceRevision
    || inventoryClaim[0].transitionDigest !== publicClaim.transitionDigest
    || inventoryClaim[0].recordDigest !== digestValue(inventoryProjection)
    || publicClaim.workItemId !== pseudonymousIdentifier("work-item", writer.scope)
    || JSON.stringify(writer.integration.paths) !== JSON.stringify(admittedPaths)
    || privateClaim.recordedState !== "integrated-preserved"
    || privateClaim.integration?.candidateRevision !== sourceRecord.headSha
    || privateClaim.integration?.reviewRequestId !== review
    || publicClaim.actorId !== `github-user:${owner.id}`
    || publicClaim.repositoryId !== `github-repository:${repo.nodeId}`
    || privateClaim.deviceId !== pseudonymousIdentifier("device", writer.device)
    || privateClaim.sessionId !== pseudonymousIdentifier("session", writer.sessionId)
    || writer.branch !== sourceRecord.branch || writer.deliveryHeadSha !== sourceRecord.headSha
    || writer.integration.commitSha !== sourceRecord.headSha
    || writer.integration.treeSha !== sourceRecord.treeSha
    || sourceRecord.remoteHeadSha !== sourceRecord.headSha
    || writer.admission.semanticScope !== writer.scope
    || writer.baseSha !== publicClaim.canonicalBaseRevision
    || digestValue(writer.cloudAuthority) !== authority.recordDigest
    || bound.claimId !== publicClaim.claimId || bound.claimDigest !== publicClaim.fenceRevision
    || bound.claimLedgerRevision !== publicClaim.transitionDigest
    || bound.entrySchema !== publicClaim.entrySchema
    || bound.claimIdentitySchema !== publicClaim.claimIdentitySchema
    || bound.operationReceiptDigest !== publicClaim.operationReceiptDigest
    || bound.integrationReceiptDigest !== publicClaim.integrationReceiptDigest
    || bound.operationReceiptDigest !== bound.integrationReceiptDigest
    || bound.canonicalBaseSha !== writer.baseSha || bound.laneRevision !== sourceRecord.headSha
    || bound.reviewRequestId !== review || bound.writeSetDigest !== writer.admission.writeSetDigest
    || digestValue(bound.cloudDeclaredWriteScope) !== digestValue(writer.admission.declaredWriteSet)
    || digestValue(bound.cloudDeclaredWriteScope) !== digestValue(publicClaim.declaredWriteScope)
    || bound.deviceId !== writer.device || bound.sessionId !== writer.sessionId
    || bound.leaseEpoch !== publicClaim.leaseEpoch
    || bound.transitionCounter !== publicClaim.transitionCounter
    || bound.expiresAt !== publicClaim.expiresAt
    || bound.focusedEvidenceDigest !== publicClaim.integration.focusedEvidenceDigest
    || bound.manifestDigest !== writer.admission.manifestDigest
    || digestValue(bound.integration) !== digestValue(publicClaim.integration)
    || bound.ledgerRepository !== repo.fullName || bound.targetRepository !== repo.fullName
    || rest.url !== `https://github.com/${repo.fullName}/pull/${rest.number}`
    || rest.author.id !== owner.id || rest.author.nodeId !== owner.nodeId
    || rest.author.login !== owner.login || rest.author.type !== owner.type
    || digestValue(rest.headRepository) !== digestValue(repo)
    || digestValue(rest.baseRepository) !== digestValue(repo)
    || rest.headBranch !== sourceRecord.branch || rest.headSha !== sourceRecord.headSha
    || writer.pullRequestUrl !== rest.url
    || rest.autoMergeRequest.enabledBy.id !== owner.id
    || rest.autoMergeRequest.enabledBy.nodeId !== owner.nodeId
    || rest.autoMergeRequest.enabledBy.login !== owner.login
    || rest.autoMergeRequest.commitHeadline !== rest.title
    || rest.writerMarkerDigest !== digestValue(projectWriterLeasePullRequestMarker(writer))
    || check.headSha !== sourceRecord.headSha || check.pullRequests[0].number !== rest.number
    || check.pullRequests[0].headSha !== rest.headSha || check.pullRequests[0].headRef !== rest.headBranch
    || github.failure.run.pullRequests[0].number !== rest.number
    || github.failure.run.headBranch !== rest.headBranch
    || digestValue(github.failure.run.repository) !== digestValue(repo)
    || github.protection.repository !== repo.fullName || github.protection.branch !== "main"
    || !github.protection.contexts.includes(check.name)
    || !github.protection.checks.some(item => item.context === check.name && item.appId === check.appId)
    || advance.sourceBaseSha !== writer.baseSha
    || advance.checkAttemptBaseSha !== check.pullRequests[0].baseSha
    || advance.checkAttemptBaseSha !== github.failure.run.pullRequests[0].baseSha
    || advance.pullRequestBaseSha !== rest.baseSha
    || advance.controllerRevisionSha !== control.revisionSha
    || advance.currentMainSha !== control.observedMainSha
    || !advance.sourceBaseAncestorOfCheckAttemptBase
    || !advance.checkAttemptBaseAncestorOfPullRequestBase
    || !advance.pullRequestBaseAncestorOfCurrentMain
    || !advance.controllerRevisionAncestorOfCurrentMain
    || writeSetsOverlap(advance.changedWriteScope, writer.admission.declaredWriteSet)) {
    invalid("joined recovery subject");
  }
}
function clone(value, label) { if (!value || typeof value !== "object" || Array.isArray(value))
  invalid(label); const json = JSON.stringify(value); if (json.length > 524_288) invalid(label);
  return JSON.parse(json); }
function exact(value, keys, label) { if (!value || typeof value !== "object" || Array.isArray(value)
  || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) invalid(label); }
function text(value, label) { if (typeof value !== "string" || !value || value !== value.trim()
  || value.includes("\0")) invalid(label); return value; }
function repositoryName(value, label) { const result = text(value, label); if (!REPOSITORY.test(result))
  invalid(label); return result; }
function claimSchema(value, label) { return value === "agentic-cloud-collaboration-entry/v2" ? value
  : invalid(label); }
function sha(value, label) { const result = text(value, label); if (!SHA.test(result)) invalid(label); return result; }
function digest(value, label) { const result = text(value, label); if (!DIGEST.test(result)) invalid(label); return result; }
function integer(value, label) { if (!Number.isSafeInteger(value) || value < 1) invalid(label); return value; }
function counter(value, label) { if (!Number.isSafeInteger(value) || value < 0) invalid(label); return value; }
function instant(value, label) { const result = text(value, label), parsed = Date.parse(result);
  if (!Number.isFinite(parsed) || ![new Date(parsed).toISOString(), new Date(parsed).toISOString()
    .replace(/\.000Z$/u, "Z")].includes(result)) invalid(label); return new Date(parsed).toISOString(); }
function pullUrl(value) { const result = text(value, "pull-request URL");
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*$/u.test(result))
    invalid("pull-request URL"); return result; }
function actionUrl(value) { const result = text(value, "Actions URL");
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[1-9]\d*\/job\/[1-9]\d*$/u.test(result))
    invalid("Actions URL"); return result; }
function workflowPath(value) { const result = text(value, "workflow path");
  if (!/^\.github\/workflows\/[A-Za-z0-9._-]+\.(?:yml|yaml)$/u.test(result)) invalid("workflow path");
  return result; }
function stringArray(value, label) { if (!Array.isArray(value)) invalid(label); const result = value
  .map(item => text(item, label)).sort(); if (new Set(result).size !== result.length) invalid(label);
  return freeze(result); }
function pathArray(value, label) { if (!Array.isArray(value) || value.some(item => typeof item !== "string"
  || !item || item.startsWith("/") || item.includes(".."))) invalid(label); const result = [...value];
  if (new Set(result).size !== result.length || result.join("\n") !== [...result].sort().join("\n")) invalid(label);
  return freeze(result); }
function digestArray(value, label) { if (!Array.isArray(value) || value.some(item => !DIGEST.test(item)))
  invalid(label); const result = [...value].sort(); if (new Set(result).size !== result.length
  || result.join("\n") !== value.join("\n")) invalid(label); return freeze(result); }
function freeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) {
  for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
function invalid(label) { throw new Error(`Delivery-authorized CI-failure recovery ${label} is invalid.`); }
