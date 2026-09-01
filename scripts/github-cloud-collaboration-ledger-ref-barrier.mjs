// Responsibility: Fence one cloud-ledger snapshot with an identical-tree, non-forced commit.
import { digestValue } from "./cloud-collaboration-primitives.mjs";

export const LEDGER_REF_BARRIER_SCHEMA =
  "agentic-github-cloud-collaboration-ledger-ref-barrier/v1";
export const LEDGER_REF_BARRIER_RECEIPT_SCHEMA =
  "agentic-github-cloud-collaboration-ledger-ref-barrier-receipt/v1";

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const MAX_LINEAGE_DEPTH = 256;

export function buildGithubCloudCollaborationLedgerRefBarrierRequest({
  operation,
  operationDigest,
  repository,
  ref,
  sourceRevision,
  sourceTreeSha,
  ledgerBlobSha,
  rawDigest,
  ledgerDigest,
  sequence,
}) {
  const metadata = {
    schema: LEDGER_REF_BARRIER_SCHEMA,
    operation: text(operation, "operation"),
    operationDigest: digest(operationDigest, "operation digest"),
    repository: repositoryName(repository),
    ref: refName(ref),
    sourceRevision: sha(sourceRevision, "source revision"),
    sourceTreeSha: sha(sourceTreeSha, "source tree SHA"),
    ledgerBlobSha: sha(ledgerBlobSha, "ledger blob SHA"),
    rawDigest: digest(rawDigest, "raw ledger digest"),
    ledgerDigest: digest(ledgerDigest, "ledger head digest"),
    sequence: positive(sequence, "ledger sequence"),
  };
  const metadataDigest = digestValue(metadata);
  const sealedMetadata = Object.freeze({ ...metadata, metadataDigest });
  const message = [
    "chore(cloud-collaboration): fence ledger snapshot",
    "",
    "Agentic-Cloud-Collaboration-Ledger-Ref-Barrier:",
    JSON.stringify(sealedMetadata),
  ].join("\n");
  return deepFreeze({
    ...sealedMetadata,
    message,
    messageDigest: digestValue(message),
  });
}

export function normalizeGithubCloudCollaborationLedgerRefBarrierRequest(value) {
  object(value, "barrier request");
  exactKeys(value, ["schema", "operation", "operationDigest", "repository", "ref",
    "sourceRevision", "sourceTreeSha", "ledgerBlobSha", "rawDigest", "ledgerDigest",
    "sequence", "metadataDigest", "message", "messageDigest"], "barrier request");
  const expected = buildGithubCloudCollaborationLedgerRefBarrierRequest(value);
  if (value.schema !== LEDGER_REF_BARRIER_SCHEMA
    || value.metadataDigest !== expected.metadataDigest
    || value.message !== expected.message
    || value.messageDigest !== expected.messageDigest) {
    throw new Error("Cloud-ledger ref-barrier request drifted from its sealed metadata.");
  }
  return expected;
}

export function normalizeGithubCloudCollaborationLedgerRefBarrierReceipt(value) {
  object(value, "barrier receipt");
  exactKeys(value, ["schema", "status", "operation", "operationDigest", "repository", "ref",
    "sourceRevision", "barrierRevision", "observedRevision", "sourceTreeSha",
    "barrierTreeSha", "ledgerBlobSha", "rawDigest", "ledgerDigest", "sequence",
    "metadataDigest", "messageDigest", "ancestry", "force", "disposition",
    "commitCreationAcknowledged", "refUpdateAcknowledged", "receiptDigest"],
  "barrier receipt");
  const disposition = ["projected", "adopted-response-loss", "replayed"]
    .includes(value.disposition) ? value.disposition : invalid("barrier disposition");
  const core = {
    schema: value.schema === LEDGER_REF_BARRIER_RECEIPT_SCHEMA
      ? value.schema : invalid("barrier receipt schema"),
    status: value.status === "established" ? value.status : invalid("barrier status"),
    operation: text(value.operation, "receipt operation"),
    operationDigest: digest(value.operationDigest, "receipt operation digest"),
    repository: repositoryName(value.repository),
    ref: refName(value.ref),
    sourceRevision: sha(value.sourceRevision, "receipt source revision"),
    barrierRevision: sha(value.barrierRevision, "barrier revision"),
    observedRevision: sha(value.observedRevision, "observed revision"),
    sourceTreeSha: sha(value.sourceTreeSha, "receipt source tree"),
    barrierTreeSha: sha(value.barrierTreeSha, "receipt barrier tree"),
    ledgerBlobSha: sha(value.ledgerBlobSha, "receipt ledger blob"),
    rawDigest: digest(value.rawDigest, "receipt raw ledger digest"),
    ledgerDigest: digest(value.ledgerDigest, "receipt ledger head digest"),
    sequence: positive(value.sequence, "receipt ledger sequence"),
    metadataDigest: digest(value.metadataDigest, "receipt metadata digest"),
    messageDigest: digest(value.messageDigest, "receipt message digest"),
    ancestry: value.ancestry === "barrier-or-descendant"
      ? value.ancestry : invalid("receipt ancestry"),
    force: value.force === false ? false : invalid("receipt force flag"),
    disposition,
    commitCreationAcknowledged: typeof value.commitCreationAcknowledged === "boolean"
      ? value.commitCreationAcknowledged : invalid("commit-creation acknowledgement"),
    refUpdateAcknowledged: typeof value.refUpdateAcknowledged === "boolean"
      ? value.refUpdateAcknowledged : invalid("ref-update acknowledgement"),
  };
  if (core.sourceTreeSha !== core.barrierTreeSha
    || core.commitCreationAcknowledged !== (disposition !== "replayed")
    || core.refUpdateAcknowledged !== (disposition === "projected")) {
    throw new Error("Cloud-ledger ref-barrier receipt has inconsistent mutation evidence.");
  }
  const sealedRequest = buildGithubCloudCollaborationLedgerRefBarrierRequest({
    operation: core.operation,
    operationDigest: core.operationDigest,
    repository: core.repository,
    ref: core.ref,
    sourceRevision: core.sourceRevision,
    sourceTreeSha: core.sourceTreeSha,
    ledgerBlobSha: core.ledgerBlobSha,
    rawDigest: core.rawDigest,
    ledgerDigest: core.ledgerDigest,
    sequence: core.sequence,
  });
  if (core.metadataDigest !== sealedRequest.metadataDigest
    || core.messageDigest !== sealedRequest.messageDigest) {
    throw new Error("Cloud-ledger ref-barrier receipt drifted from its rebuilt sealed request.");
  }
  const receiptDigest = digest(value.receiptDigest, "barrier receipt digest");
  if (receiptDigest !== digestValue(core)) {
    throw new Error("Cloud-ledger ref-barrier receipt digest drifted.");
  }
  return deepFreeze({ ...core, receiptDigest });
}

export async function establishGithubCloudCollaborationLedgerRefBarrier({
  request,
  provider,
}) {
  const sealed = normalizeGithubCloudCollaborationLedgerRefBarrierRequest(request);
  const ports = providerPorts(provider);
  const initialRevision = sha(await ports.readReference(), "initial ledger ref");
  let barrierRevision = null;
  let disposition = "replayed";
  let commitCreationAcknowledged = false;
  let refUpdateAcknowledged = false;

  if (initialRevision === sealed.sourceRevision) {
    const sourceCommit = normalizeCommit(
      await ports.readCommit(sealed.sourceRevision),
      sealed.sourceRevision,
    );
    if (sourceCommit.treeSha !== sealed.sourceTreeSha) {
      throw new Error("Cloud-ledger ref-barrier source tree drifted before commit creation.");
    }
    const created = normalizeCommit(await ports.createCommit({
      message: sealed.message,
      treeSha: sealed.sourceTreeSha,
      parentSha: sealed.sourceRevision,
    }));
    assertExactBarrierCommit(created, sealed);
    barrierRevision = created.sha;
    commitCreationAcknowledged = true;
    disposition = "projected";
    try {
      await ports.updateReference({ sha: barrierRevision, force: false });
      refUpdateAcknowledged = true;
    } catch (error) {
      const afterError = sha(await ports.readReference(), "post-error ledger ref");
      try {
        await verifyBarrierLineage({
          headRevision: afterError,
          expectedBarrierRevision: barrierRevision,
          request: sealed,
          readCommit: ports.readCommit,
        });
      } catch {
        throw new Error(
          `Cloud-ledger ref barrier lost its non-fast-forward CAS: ${error?.message || error}`,
        );
      }
      disposition = "adopted-response-loss";
      refUpdateAcknowledged = false;
    }
  } else {
    const lineage = await verifyBarrierLineage({
      headRevision: initialRevision,
      expectedBarrierRevision: null,
      request: sealed,
      readCommit: ports.readCommit,
    });
    barrierRevision = lineage.barrierRevision;
  }

  const observedRevision = sha(await ports.readReference(), "verified ledger ref");
  await verifyBarrierLineage({
    headRevision: observedRevision,
    expectedBarrierRevision: barrierRevision,
    request: sealed,
    readCommit: ports.readCommit,
  });
  const snapshot = await ports.readLedgerSnapshot(observedRevision);
  assertUnchangedLedgerSnapshot(snapshot, sealed, observedRevision);
  const core = {
    schema: LEDGER_REF_BARRIER_RECEIPT_SCHEMA,
    status: "established",
    operation: sealed.operation,
    operationDigest: sealed.operationDigest,
    repository: sealed.repository,
    ref: sealed.ref,
    sourceRevision: sealed.sourceRevision,
    barrierRevision,
    observedRevision,
    sourceTreeSha: sealed.sourceTreeSha,
    barrierTreeSha: sealed.sourceTreeSha,
    ledgerBlobSha: sealed.ledgerBlobSha,
    rawDigest: sealed.rawDigest,
    ledgerDigest: sealed.ledgerDigest,
    sequence: sealed.sequence,
    metadataDigest: sealed.metadataDigest,
    messageDigest: sealed.messageDigest,
    ancestry: "barrier-or-descendant",
    force: false,
    disposition,
    commitCreationAcknowledged,
    refUpdateAcknowledged,
  };
  return deepFreeze({
    receipt: {
      ...core,
      receiptDigest: digestValue(core),
    },
    ledger: snapshot.ledger,
  });
}

export async function verifyBarrierLineage({
  headRevision,
  expectedBarrierRevision = null,
  request,
  readCommit,
}) {
  const sealed = normalizeGithubCloudCollaborationLedgerRefBarrierRequest(request);
  if (typeof readCommit !== "function") invalid("commit reader");
  let revision = sha(headRevision, "lineage head revision");
  let barrierRevision = null;
  for (let depth = 0; depth < MAX_LINEAGE_DEPTH; depth += 1) {
    if (revision === sealed.sourceRevision) break;
    const commit = normalizeCommit(await readCommit(revision), revision);
    if (commit.parentShas.length !== 1) {
      throw new Error("Cloud-ledger ref-barrier lineage is not an exact linear descendant.");
    }
    if (commit.parentShas[0] === sealed.sourceRevision) {
      assertExactBarrierCommit(commit, sealed);
      barrierRevision = commit.sha;
      break;
    }
    revision = commit.parentShas[0];
  }
  if (!barrierRevision
    || (expectedBarrierRevision !== null
      && barrierRevision !== sha(expectedBarrierRevision, "expected barrier revision"))) {
    throw new Error("Cloud-ledger ref-barrier commit is absent from the current lineage.");
  }
  return Object.freeze({ barrierRevision, headRevision });
}

function assertExactBarrierCommit(commit, request) {
  if (commit.treeSha !== request.sourceTreeSha
    || commit.parentShas.length !== 1
    || commit.parentShas[0] !== request.sourceRevision
    || commit.message !== request.message) {
    throw new Error("Cloud-ledger ref-barrier commit does not match its sealed parent/tree/message.");
  }
}

function assertUnchangedLedgerSnapshot(value, request, observedRevision) {
  object(value, "verified ledger snapshot");
  if (value.revision !== observedRevision
    || value.blobSha !== request.ledgerBlobSha
    || value.rawDigest !== request.rawDigest
    || value.ledgerDigest !== request.ledgerDigest
    || value.sequence !== request.sequence
    || !value.ledger || typeof value.ledger !== "object") {
    throw new Error("Cloud-ledger ref-barrier changed or lost the sealed ledger payload.");
  }
}

function normalizeCommit(value, expectedSha = null) {
  object(value, "Git commit");
  const result = {
    sha: sha(value.sha, "commit SHA"),
    treeSha: sha(value.treeSha, "commit tree SHA"),
    parentShas: Array.isArray(value.parentShas)
      ? value.parentShas.map((entry, index) => sha(entry, `commit parent ${index + 1}`))
      : invalid("commit parents"),
    message: text(value.message, "commit message", { trim: false }),
  };
  if (expectedSha !== null && result.sha !== expectedSha) {
    throw new Error("Cloud-ledger ref-barrier commit lookup returned another object.");
  }
  return Object.freeze(result);
}

function providerPorts(value) {
  object(value, "provider ports");
  for (const name of ["readReference", "readCommit", "createCommit",
    "updateReference", "readLedgerSnapshot"]) {
    if (typeof value[name] !== "function") invalid(`${name} port`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const sealed = [...expected].sort();
  if (actual.length !== sealed.length
    || actual.some((entry, index) => entry !== sealed[index])) {
    invalid(`${label} fields`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
function object(value, label) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); }
function text(value, label, { trim = true } = {}) { if (typeof value !== "string" || !value.trim()) invalid(label); return trim ? value.trim() : value; }
function sha(value, label) { if (!SHA.test(String(value || ""))) invalid(label); return String(value); }
function digest(value, label) { if (!DIGEST.test(String(value || ""))) invalid(label); return String(value); }
function positive(value, label) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) invalid(label); return number; }
function repositoryName(value) { const result = text(value, "repository"); if (!/^[^/\s]+\/[^/\s]+$/u.test(result)) invalid("repository"); return result; }
function refName(value) { const result = text(value, "ref"); if (!/^refs\/heads\/[A-Za-z0-9._/-]+$/u.test(result) || result.includes("..")) invalid("ref"); return result; }
function invalid(label) { throw new Error(`GitHub cloud-collaboration ledger-ref barrier has invalid ${label}.`); }
