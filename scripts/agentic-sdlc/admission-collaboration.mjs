import {
  array,
  normalizePath,
  object,
  pathWithinScope,
  text,
  uniqueSortedStrings,
} from "./normalize.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const WRITER_IDENTITY_FIELDS = Object.freeze([
  "actorId",
  "deviceId",
  "sessionId",
  "worktreeId",
  "branchId",
  "scopeId",
]);
const LANE_IDENTITY_FIELDS = Object.freeze([
  "worktreeId",
  "branchId",
  "scopeId",
]);

export function validateAdmissionCollaboration(
  collaborationInput,
  evaluationTime,
  tasks,
  collector,
) {
  const collaboration = object(collaborationInput);
  validateWriterFence(
    collaboration,
    evaluationTime,
    "collaboration",
    collector,
  );
  if (collaboration.inventoryComplete !== true) {
    collector.add("parallel-scope-collision", {
      artifactReference: "collaboration.inventoryComplete",
      evidenceExcerpt:
        "Admission requires a complete active-writer inventory before overlap can be ruled out.",
    });
  }

  const currentScopes = uniqueSortedStrings(
    collaboration.declaredWriteScope,
  );
  for (const task of tasks) {
    for (const artifact of uniqueSortedStrings(task.writeSet)) {
      if (!currentScopes.some((scope) => pathWithinScope(artifact, scope))) {
        collector.add("parallel-scope-collision", {
          artifactReference: `task:${text(task.taskId)}:${artifact}`,
          evidenceExcerpt:
            "Every task write must fit the currently fenced collaboration scope.",
        });
      }
    }
  }

  const writers = [collaboration];
  const identities = new Set([writerIdentity(collaboration)]);
  for (const [index, peerInput] of array(
    collaboration.peerWriters,
  ).entries()) {
    const peer = object(peerInput);
    const reference = `collaboration.peerWriters[${index}]`;
    validateWriterFence(peer, evaluationTime, reference, collector);
    const identity = writerIdentity(peer);
    if (!identity || identities.has(identity)) {
      collector.add("parallel-scope-collision", {
        artifactReference: reference,
        evidenceExcerpt:
          "Every active writer record must carry one distinct collaboration identity tuple.",
      });
    }
    identities.add(identity);
    for (const writer of writers) {
      const sharedLane = LANE_IDENTITY_FIELDS.find((field) =>
        text(writer[field]) === text(peer[field]));
      const overlap = firstScopeOverlap(
        writer.declaredWriteScope,
        peer.declaredWriteScope,
      );
      if (sharedLane || overlap) {
        collector.add("parallel-scope-collision", {
          artifactReference: sharedLane
            ? `${reference}:${sharedLane}:${text(peer[sharedLane])}`
            : `${reference}:${overlap.left}:${overlap.right}`,
          evidenceExcerpt:
            "Active writers must occupy distinct lanes with non-overlapping scopes.",
        });
      }
    }
    writers.push(peer);
  }
}

function validateWriterFence(
  writerInput,
  evaluationTime,
  reference,
  collector,
) {
  const writer = object(writerInput);
  const evaluatedAt = Date.parse(text(evaluationTime));
  const expiresAt = Date.parse(text(writer.expiresAt));
  const identityComplete = WRITER_IDENTITY_FIELDS.every((field) =>
    Boolean(text(writer[field])));
  const scopes = uniqueSortedStrings(writer.declaredWriteScope);
  const scopesValid = scopes.length > 0
    && scopes.every((scope) => Boolean(normalizePath(scope)));
  if (
    !identityComplete
    || writer.status !== "active"
    || !Number.isSafeInteger(writer.leaseEpoch)
    || writer.leaseEpoch < 1
    || !SHA_PATTERN.test(text(writer.fenceRevision))
    || !Number.isFinite(evaluatedAt)
    || !Number.isFinite(expiresAt)
    || expiresAt <= evaluatedAt
    || !scopesValid
  ) {
    collector.add("stale-collaboration-fence", {
      artifactReference: reference,
      evidenceExcerpt:
        "Admission requires a current active writer fence with a bounded write scope.",
    });
  }
}

function writerIdentity(writer) {
  const values = WRITER_IDENTITY_FIELDS.map((field) => text(writer[field]));
  if (values.some((value) => !value)) return "";
  return values.join("\u0000");
}

function firstScopeOverlap(leftInput, rightInput) {
  const leftScopes = uniqueSortedStrings(leftInput);
  const rightScopes = uniqueSortedStrings(rightInput);
  for (const left of leftScopes) {
    for (const right of rightScopes) {
      if (scopesOverlap(left, right)) return { left, right };
    }
  }
  return null;
}

function scopesOverlap(leftInput, rightInput) {
  const left = scopeDescriptor(leftInput);
  const right = scopeDescriptor(rightInput);
  if (!left.root || !right.root) return false;
  if (left.root === right.root) return true;
  return (
    left.recursive && right.root.startsWith(`${left.root}/`)
  ) || (
    right.recursive && left.root.startsWith(`${right.root}/`)
  );
}

function scopeDescriptor(value) {
  const normalized = normalizePath(value);
  const recursive = normalized.endsWith("/**");
  return {
    recursive,
    root: recursive ? normalized.slice(0, -3) : normalized,
  };
}
