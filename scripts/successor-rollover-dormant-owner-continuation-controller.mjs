// Responsibility: Orchestrate the exact dormant same-owner continuation phase chain.
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  advanceDormantOwnerContinuationJournal,
  buildDormantOwnerContinuationResult,
  createDormantOwnerContinuationJournal,
  normalizeDormantOwnerContinuationJournal,
  normalizeDormantOwnerContinuationPlan,
  PHASES,
} from "./successor-rollover-dormant-owner-continuation-contract.mjs";
import { requireSameDormantOwnerContinuationEvidence }
  from "./successor-rollover-dormant-owner-continuation-evidence.mjs";

const METHODS = Object.freeze([
  "captureEvidence", "authorizeTaskAuthority", "recoverCloudAuthority",
  "projectLocalLease", "projectPullRequestMarker", "verifyCompletion",
]);

export function createDormantOwnerContinuationAdapter(methods = {}) {
  for (const name of METHODS) {
    if (typeof methods[name] !== "function") {
      throw new Error(`Dormant-owner continuation adapter requires ${name}().`);
    }
  }
  return Object.freeze(Object.fromEntries(METHODS.map(name => [name, methods[name]])));
}

export function createDormantOwnerContinuationController({ adapter, journalStore } = {}) {
  const effects = createDormantOwnerContinuationAdapter(adapter);
  if (!journalStore || typeof journalStore.read !== "function"
    || typeof journalStore.write !== "function") {
    throw new Error("Dormant-owner continuation requires a private journal store.");
  }

  async function run({ plan, authorization } = {}) {
    const sealedPlan = normalizeDormantOwnerContinuationPlan(plan);
    let journal = journalStore.read();
    let resumedPhase = null;
    if (journal) {
      journal = normalizeDormantOwnerContinuationJournal(journal);
      resumedPhase = journal.phase;
      if (journal.plan.planDigest !== sealedPlan.planDigest) {
        throw new Error("Private continuation journal belongs to another plan.");
      }
    }
    if (!journal || journal.phase === "authorized") {
      requireSameDormantOwnerContinuationEvidence(
        sealedPlan.evidenceSnapshot,
        await effects.captureEvidence({ plan: sealedPlan, journal }),
      );
    }
    if (!journal) {
      journal = createDormantOwnerContinuationJournal(sealedPlan, authorization);
      journal = await journalStore.write(journal, null);
    }
    if (journal.phase === "complete") {
      requireTerminalReplay(journal, await effects.verifyCompletion({
        plan: sealedPlan,
        journal,
      }));
      return buildDormantOwnerContinuationResult(journal);
    }

    let cloudRecovery = null;
    if (!atLeast(journal.phase, "task-authority-verified")) {
      const result = await effects.authorizeTaskAuthority({ plan: sealedPlan, journal });
      journal = await persist(journal, "task-authority-verified", {
        taskAuthorityReceiptDigest: requiredDigest(
          result?.receiptDigest,
          "task-authority receipt digest",
        ),
      });
    }
    if (!atLeast(journal.phase, "cloud-recovered")) {
      const result = await effects.recoverCloudAuthority({ plan: sealedPlan, journal });
      cloudRecovery = result;
      journal = await persist(journal, "cloud-recovered", {
        claimDigest: requiredDigest(result?.claimDigest, "recovered claim digest"),
        cloudReceiptDigest: requiredDigest(result?.receiptDigest, "cloud receipt digest"),
        expiresAt: requiredText(result?.expiresAt, "recovered cloud expiry"),
      });
    }
    if (!atLeast(journal.phase, "local-cas")) {
      const result = await effects.projectLocalLease({
        plan: sealedPlan,
        journal,
        cloudRecovery,
      });
      journal = await persist(journal, "local-cas", {
        leaseDigest: requiredDigest(result?.leaseDigest, "projected lease digest"),
        registryRevision: positive(result?.registryRevision, "registry revision"),
        taskAuthorityBindingDigest: requiredDigest(
          result?.taskAuthorityBindingDigest,
          "continued task-authority binding digest",
        ),
      });
    }
    if (!atLeast(journal.phase, "pr-marker")) {
      const result = await effects.projectPullRequestMarker({ plan: sealedPlan, journal });
      journal = await persist(journal, "pr-marker", {
        bodyDigest: requiredDigest(result?.bodyDigest, "pull-request body digest"),
        pullRequestMarkerDigest: requiredDigest(
          result?.markerDigest,
          "pull-request marker digest",
        ),
      });
    }
    if (!atLeast(journal.phase, "verified")) {
      const result = await effects.verifyCompletion({ plan: sealedPlan, journal });
      journal = await persist(journal, "verified", {
        claimDigest: requiredDigest(result?.claimDigest, "verified claim digest"),
        leaseDigest: requiredDigest(result?.leaseDigest, "verified lease digest"),
        pullRequestMarkerDigest: requiredDigest(
          result?.markerDigest,
          "verified marker digest",
        ),
        verificationDigest: requiredDigest(
          result?.verificationDigest,
          "completion verification digest",
        ),
      });
    }
    if (!atLeast(journal.phase, "complete")) {
      if (resumedPhase === "verified") {
        requireTerminalReplay(journal, await effects.verifyCompletion({
          plan: sealedPlan,
          journal,
        }));
      }
      journal = await persist(journal, "complete", {
        completionDigest: digestValue({
          planDigest: sealedPlan.planDigest,
          verifiedReceiptDigest: journal.receipts.verified.receiptDigest,
        }),
      });
    }
    return buildDormantOwnerContinuationResult(journal);
  }

  async function persist(current, phase, values) {
    const next = advanceDormantOwnerContinuationJournal(current, phase, values);
    return journalStore.write(next, current.journalDigest);
  }

  return Object.freeze({ run });
}

function atLeast(current, expected) { return PHASES.indexOf(current) >= PHASES.indexOf(expected); }
function requiredDigest(value, label) {
  if (!/^[0-9a-f]{64}$/u.test(String(value || ""))) throw new Error(`${label} is invalid.`);
  return value;
}
function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value;
}
function positive(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} is invalid.`);
  return value;
}

function requireTerminalReplay(journal, result) {
  requiredDigest(result?.verificationDigest, "completion verification digest");
  const expected = journal.receipts.verified.values;
  if (result?.claimDigest !== expected.claimDigest
    || result?.leaseDigest !== expected.leaseDigest
    || result?.markerDigest !== expected.pullRequestMarkerDigest) {
    throw new Error("Dormant-owner continuation terminal replay drifted.");
  }
}
