#!/usr/bin/env node
// Responsibility: Decide what an observed head means for a recorded lane
// projection, without reading, writing, or trusting any other projection.
//
// Owner of the rules: huijoohwee.github.io/guidelines/
//   agentic-sdlc-cloud-collaboration.md, "Deciding Divergence"
//
// A recorded fence, marker, or lane revision that differs from the observed head
// is not evidence of a foreign writer. Concluding that from inequality alone is a
// false positive that strands authored work behind a gate no operation can open:
// the lane's own unrecorded advance and a genuine takeover produce the same
// inequality and are told apart by ancestry plus claim ownership, both of which
// are decidable locally at no cost.
//
// Deliberately NOT consulted: commit authorship, committer identity, and
// pull-request ownership. Each is settable by anyone who can write a commit and
// proves nothing about authorization. The ledger is the only authority on who owns
// a lane.
//
// Deterministic: no clock, no randomness, no network, no model call, no write.

const SHA_PATTERN = /^[0-9a-f]{40}$/u;

export const PROJECTION_CURRENT = "current";
export const PROJECTION_OWN_ADVANCE = "own-advance";
export const PROJECTION_DIVERGENT = "divergent";
export const PROJECTION_CONTENDED = "contended";
export const PROJECTION_ABSENT = "absent";

// Reconcilable without an Operator decision. Every other state escalates.
export const RECONCILABLE_STATES = Object.freeze([PROJECTION_CURRENT, PROJECTION_OWN_ADVANCE]);

export function classifyObservedHead({
  recordedSha,
  observedSha,
  integrationSha = null,
  competingClaims = [],
  isDescendant,
}) {
  if (typeof isDescendant !== "function") {
    throw new Error("Projection classification requires an ancestry oracle.");
  }
  const recorded = normalizeSha(recordedSha);
  const observed = normalizeSha(observedSha);
  const integration = normalizeSha(integrationSha);

  if (!observed) {
    return frame(PROJECTION_ABSENT, "the observed head is missing or unreadable");
  }
  if (!recorded) {
    return frame(PROJECTION_ABSENT, "the projection records no revision to compare");
  }
  if (observed === recorded || (integration && observed === integration)) {
    return frame(PROJECTION_CURRENT, "the observed head already matches the projection");
  }
  // Contention outranks ancestry: a descendant advance under a competing claim is
  // still someone else's lane to reconcile.
  if (competingClaims.length > 0) {
    return frame(
      PROJECTION_CONTENDED,
      `${competingClaims.length} competing claim(s) cover this branch or scope`,
    );
  }
  if (isDescendant(recorded, observed)) {
    return frame(PROJECTION_OWN_ADVANCE, "the observed head descends from the projection");
  }
  return frame(PROJECTION_DIVERGENT, "the observed head does not descend from the projection");
}

export function isReconcilable(classification) {
  return RECONCILABLE_STATES.includes(classification.state);
}

export function projectionDivergenceError({ branch, classification, recordedSha, observedSha }) {
  return new Error(
    `Remote head for ${branch} is ${observedSha || "missing"}, not ${recordedSha || "unclaimed"}: `
    + `${classification.reason}; reconcile at the owning claim or hand off.`,
  );
}

function frame(state, reason) {
  return Object.freeze({ state, reason, reconcilable: RECONCILABLE_STATES.includes(state) });
}

function normalizeSha(value) {
  const text = String(value || "").trim();
  return SHA_PATTERN.test(text) ? text : null;
}
