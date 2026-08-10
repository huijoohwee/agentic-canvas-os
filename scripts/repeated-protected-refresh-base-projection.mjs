const SHA_PATTERN = /^[0-9a-f]{40}$/u;

export function projectRepeatedProtectedRefreshBase({
  acceptedHeadSha,
  refreshReceipt,
}) {
  requireSha(acceptedHeadSha, "accepted protected-refresh head");
  if (!refreshReceipt || typeof refreshReceipt !== "object") {
    throw new Error("Repeated protected-refresh base projection requires a refresh receipt.");
  }
  const deliveredHeadSha = requireSha(
    refreshReceipt.deliveredHeadSha,
    "protected-refresh receipt delivered head",
  );
  if (deliveredHeadSha !== acceptedHeadSha) {
    throw new Error("Protected-refresh receipt does not continue the accepted head.");
  }
  const refreshes = Array.isArray(refreshReceipt.refreshes)
    ? refreshReceipt.refreshes
    : [{
      previousHeadSha: deliveredHeadSha,
      refreshedHeadSha: refreshReceipt.refreshedHeadSha,
      mainParentSha: refreshReceipt.mainParentSha,
    }];
  if (refreshes.length === 0) {
    throw new Error("Protected-refresh receipt must contain at least one refresh step.");
  }
  let previousHeadSha = deliveredHeadSha;
  let canonicalBaseSha = null;
  for (const refresh of refreshes) {
    if (requireSha(
      refresh.previousHeadSha,
      "protected-refresh step previous head",
    ) !== previousHeadSha) {
      throw new Error("Protected-refresh receipt steps do not form one exact chain.");
    }
    previousHeadSha = requireSha(
      refresh.refreshedHeadSha,
      "protected-refresh step refreshed head",
    );
    canonicalBaseSha = requireSha(
      refresh.mainParentSha,
      "protected-refresh step main parent",
    );
  }
  if (previousHeadSha !== refreshReceipt.refreshedHeadSha) {
    throw new Error("Protected-refresh receipt terminal head is inconsistent.");
  }
  return Object.freeze({
    acceptedHeadSha: previousHeadSha,
    canonicalBaseSha,
  });
}

function requireSha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} must be an exact SHA.`);
  }
  return value;
}
