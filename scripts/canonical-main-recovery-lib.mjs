import { realpathSync } from "node:fs";
import path from "node:path";

import {
  createWorkingStateManifest,
  describeCapturedStash,
  hasWorkingState,
  parsePorcelainV1,
  proveIgnoredStateRetention,
  verifyCapturedStashManifest,
} from "./canonical-main-recovery-evidence.mjs";
import { provePatchEquivalentDivergence } from "./canonical-main-recovery-history.mjs";
import {
  CANONICAL_MAIN_RECOVERY_JOURNAL_SCHEMA,
  canonicalJson,
  createCaptureReceiptBody,
  createCompletionReceiptBody,
  createPreparedReceiptBody,
  digestValue,
  ensureCommitRef,
  pinReceipt,
  readJournal,
  requireJournalIdentity,
  requireSha,
  updateJournal,
  withJournalDigest,
  writeJournal,
} from "./canonical-main-recovery-receipts.mjs";
import {
  assertNoUnmergedPaths,
  assertRegisteredWorktree,
  parseWorktreeRecords,
} from "./repository-guards.mjs";
import {
  captureParkStash,
  requireParkStashObject,
  withParkStashLock,
} from "./device-park-lib.mjs";

const RESULT_SCHEMA = "agentic-canonical-main-recovery-result/v1";

export function recoverCanonicalMain({
  acknowledged,
  invocationPath,
  repo,
  sessionId,
  expectedLocalHead,
  expectedOriginHead,
  gitText,
  gitOptional,
  gitSucceeds,
  gitPatchId,
  gitHashObject,
  run,
  now = () => new Date(),
  log = console.log,
}) {
  requireExplicitAuthority({ acknowledged, sessionId, expectedLocalHead, expectedOriginHead });
  const canonical = requirePrimaryCanonicalWorktree({ invocationPath, repo, gitText });
  run("git", ["fetch", "--no-tags", "origin", "main"]);
  const fetchedOriginHead = requireSha(gitText(["rev-parse", "origin/main"]).trim(), "Fetched origin/main");
  if (fetchedOriginHead !== expectedOriginHead) {
    throw new Error(`Fetched origin/main ${fetchedOriginHead} does not match expected ${expectedOriginHead}.`);
  }

  return withParkStashLock({ repo: canonical.repoRoot, gitText }, parkStashLock => {
    const result = recoverCanonicalMainLocked({
      canonical,
      sessionId,
      expectedLocalHead,
      expectedOriginHead,
      gitText,
      gitOptional,
      gitSucceeds,
      gitPatchId,
      gitHashObject,
      run,
      now,
      parkStashLock,
    });
    log(result.replayed
      ? `Canonical main recovery ${result.recoveryId} is already complete at ${result.headSha.slice(0, 12)}.`
      : `Canonical main recovery ${result.recoveryId} preserved local state and realigned main to ${result.headSha.slice(0, 12)}.`);
    return result;
  });
}

function recoverCanonicalMainLocked({
  canonical,
  sessionId,
  expectedLocalHead,
  expectedOriginHead,
  gitText,
  gitOptional,
  gitSucceeds,
  gitPatchId,
  gitHashObject,
  run,
  now,
  parkStashLock,
}) {
  requirePrimaryCanonicalWorktree({
    invocationPath: canonical.repoRoot,
    repo: canonical.repoRoot,
    gitText,
  });
  assertNoUnmergedPaths({
    conflictPaths: gitText(["diff", "--name-only", "--diff-filter=U"]),
    indexEntries: gitText(["ls-files", "-u"]),
  });
  if (gitText(["rev-parse", "origin/main"]).trim() !== expectedOriginHead) {
    throw new Error("origin/main moved after the protected fetch; restart with new exact expectations.");
  }

  const recoveryId = deriveRecoveryId({
    repoRoot: canonical.repoRoot,
    sessionId,
    expectedLocalHead,
    expectedOriginHead,
  });
  const refs = createRecoveryRefs(recoveryId);
  const journalPath = path.join(
    canonical.commonDir,
    "agentic-canvas-os",
    "canonical-main-recovery",
    `${recoveryId}.json`,
  );
  let journal = readJournal(journalPath);
  if (journal) {
    requireJournalIdentity(journal, {
      recoveryId,
      repoRoot: canonical.repoRoot,
      sessionId,
      expectedLocalHead,
      expectedOriginHead,
      refs,
    });
  }

  const observed = observeRecoveryState({ gitText, gitOptional });
  if (!journal) {
    requireInitialState(observed, expectedLocalHead);
    const equivalence = provePatchEquivalentDivergence({
      localHead: expectedLocalHead,
      originHead: expectedOriginHead,
      gitText,
      gitPatchId,
    });
    const manifest = createWorkingStateManifest({ repo: canonical.repoRoot, gitText });
    const ignoredRetention = proveIgnoredStateRetention({
      localHead: expectedLocalHead,
      originHead: expectedOriginHead,
      gitText,
      gitOptional,
    });
    journal = withJournalDigest({
      schema: CANONICAL_MAIN_RECOVERY_JOURNAL_SCHEMA,
      state: "prepared",
      recoveryId,
      sessionId,
      repository: canonical.repoRoot,
      branch: "main",
      remoteRef: "origin/main",
      expectedLocalHead,
      expectedOriginHead,
      preparedAt: now().toISOString(),
      equivalence,
      manifest,
      manifestDigest: digestValue(manifest),
      ignoredRetention,
      refs,
      stash: null,
      preparedReceipt: null,
      captureReceipt: null,
      completionReceipt: null,
    });
    writeJournal(journalPath, journal);
  }

  requireReplayState(observed, { expectedLocalHead, expectedOriginHead });
  const preparedBody = createPreparedReceiptBody(journal);
  const preparedReceipt = pinReceipt({
    ref: refs.prepared,
    body: preparedBody,
    gitText,
    gitOptional,
    gitHashObject,
    run,
  });
  journal = updateJournal(journalPath, journal, {
    preparedReceipt,
  });
  ensureCommitRef({
    ref: refs.head,
    sha: expectedLocalHead,
    gitText,
    gitOptional,
    run,
  });
  const ignoredRetention = proveIgnoredStateRetention({
    localHead: expectedLocalHead,
    originHead: expectedOriginHead,
    gitText,
    gitOptional,
  });
  if (canonicalJson(ignoredRetention) !== canonicalJson(journal.ignoredRetention)) {
    throw new Error("Ignored local state changed after the prepared canonical recovery receipt.");
  }

  let stash = resolveCapturedStash({
    journal,
    refs,
    repo: canonical.repoRoot,
    expectedLocalHead,
    expectedOriginHead,
    gitText,
    gitOptional,
    run,
    parkStashLock,
  });
  if (journal.manifest.length > 0 && !stash) {
    throw new Error("Prepared working-state manifest is non-empty but no exact recovery stash was captured.");
  }
  if (journal.manifest.length === 0 && stash) {
    throw new Error("An unexpected recovery stash exists for an empty prepared working-state manifest.");
  }
  if (stash) {
    const capturedStash = describeCapturedStash({ stash, gitText, gitOptional });
    verifyCapturedStashManifest({ stash: capturedStash, manifest: journal.manifest, gitText });
    if (journal.stash && canonicalJson(journal.stash) !== canonicalJson(capturedStash)) {
      throw new Error("Captured stash trees disagree with the canonical recovery journal.");
    }
    if (!journal.stash) {
      journal = updateJournal(journalPath, journal, {
        state: "captured",
        stash: capturedStash,
      });
    }
  } else if (!stash && journal.state === "prepared") {
    journal = updateJournal(journalPath, journal, { state: "captured" });
  }

  const captureBody = createCaptureReceiptBody(journal);
  const captureReceipt = pinReceipt({
    ref: refs.capture,
    body: captureBody,
    gitText,
    gitOptional,
    gitHashObject,
    run,
  });
  journal = updateJournal(journalPath, journal, { captureReceipt });

  completeRefRealignment({
    expectedLocalHead,
    expectedOriginHead,
    ignoredRetention: journal.ignoredRetention,
    gitText,
    gitOptional,
    gitSucceeds,
    run,
  });

  const completionBody = createCompletionReceiptBody(journal);
  const completionReceipt = pinReceipt({
    ref: refs.completed,
    body: completionBody,
    gitText,
    gitOptional,
    gitHashObject,
    run,
  });
  const replayed = journal.state === "completed";
  journal = updateJournal(journalPath, journal, {
    state: "completed",
    completedAt: journal.completedAt || now().toISOString(),
    completionReceipt,
  });
  requireCompletedState({ expectedOriginHead, gitText, gitOptional });

  return Object.freeze({
    schema: RESULT_SCHEMA,
    status: "completed",
    recoveryId,
    replayed,
    repository: canonical.repoRoot,
    branch: "main",
    headSha: expectedOriginHead,
    originHeadSha: expectedOriginHead,
    preservedHeadSha: expectedLocalHead,
    preservedHeadRef: refs.head,
    stashRef: journal.stash?.ref || null,
    stashSha: journal.stash?.sha || null,
    manifestDigest: journal.manifestDigest,
    pathCount: journal.manifest.length,
    ignoredDisposition: journal.ignoredRetention.disposition,
    ignoredPathCount: journal.ignoredRetention.pathCount,
    ignoredPathsDigest: journal.ignoredRetention.pathsDigest,
    receiptPath: journalPath,
    preparedReceipt,
    captureReceipt,
    completionReceipt,
  });
}

function requireExplicitAuthority({ acknowledged, sessionId, expectedLocalHead, expectedOriginHead }) {
  if (acknowledged !== true) {
    throw new Error("Canonical main recovery requires --acknowledge-equivalent-realignment.");
  }
  if (!String(sessionId || "").trim() || /[\u0000-\u001f\u007f]/.test(sessionId) || sessionId.length > 512) {
    throw new Error("Canonical main recovery requires one stable, non-control-character session id.");
  }
  requireSha(expectedLocalHead, "Expected local main HEAD");
  requireSha(expectedOriginHead, "Expected origin/main HEAD");
  if (expectedLocalHead === expectedOriginHead) {
    throw new Error("Canonical main recovery requires distinct local and origin heads.");
  }
}

function requirePrimaryCanonicalWorktree({ invocationPath, repo, gitText }) {
  const invocation = realpathSync(path.resolve(invocationPath));
  const repoRoot = realpathSync(path.resolve(repo));
  if (invocation !== repoRoot) {
    throw new Error(`Canonical main recovery must start at the repository root ${repoRoot}; received ${invocation}.`);
  }
  const porcelain = gitText(["worktree", "list", "--porcelain", "-z"]);
  const worktree = assertRegisteredWorktree({ cwd: repoRoot, porcelain });
  const records = parseWorktreeRecords(porcelain);
  if (!records.length || realpathSync(records[0].path) !== repoRoot) {
    throw new Error("Canonical main recovery is restricted to the primary registered worktree.");
  }
  const gitDir = realpathSync(path.resolve(repoRoot, gitText(["rev-parse", "--git-dir"]).trim()));
  const commonDir = realpathSync(path.resolve(repoRoot, gitText(["rev-parse", "--git-common-dir"]).trim()));
  if (gitDir !== commonDir || worktree.bare || worktree.prunable) {
    throw new Error("Canonical main recovery is restricted to the live primary worktree.");
  }
  return Object.freeze({ repoRoot, commonDir, worktree });
}

function requireInitialState(observed, expectedLocalHead) {
  if (observed.symbolicBranch !== "main" ||
      observed.head !== expectedLocalHead ||
      observed.mainRef !== expectedLocalHead) {
    throw new Error("Initial canonical recovery requires primary main checked out at the exact expected local HEAD.");
  }
}

function requireReplayState(observed, { expectedLocalHead, expectedOriginHead }) {
  const valid =
    (observed.symbolicBranch === "main" &&
      observed.head === expectedLocalHead &&
      observed.mainRef === expectedLocalHead) ||
    (!observed.symbolicBranch &&
      observed.head === expectedOriginHead &&
      [expectedLocalHead, expectedOriginHead].includes(observed.mainRef)) ||
    (observed.symbolicBranch === "main" &&
      observed.head === expectedOriginHead &&
      observed.mainRef === expectedOriginHead);
  if (!valid) {
    throw new Error(
      `Recovery replay state is not recognized (branch=${observed.symbolicBranch || "detached"}, ` +
      `HEAD=${observed.head}, main=${observed.mainRef}).`,
    );
  }
}

function observeRecoveryState({ gitText, gitOptional }) {
  return Object.freeze({
    symbolicBranch: gitOptional(["symbolic-ref", "--quiet", "--short", "HEAD"]).trim(),
    head: requireSha(gitText(["rev-parse", "HEAD"]).trim(), "Observed HEAD"),
    mainRef: requireSha(gitText(["rev-parse", "refs/heads/main"]).trim(), "Observed main ref"),
    status: hasWorkingState({ gitText }),
  });
}

function resolveCapturedStash({
  journal,
  refs,
  repo,
  expectedLocalHead,
  expectedOriginHead,
  gitText,
  gitOptional,
  run,
  parkStashLock,
}) {
  const message = createRecoveryStashMessage({
    recoveryId: journal.recoveryId,
    expectedLocalHead,
    expectedOriginHead,
  });
  const referencedSha = gitOptional(["show-ref", "--hash", "--verify", refs.stash]).trim();
  if (journal.stash) {
    if (journal.stash.ref !== refs.stash || journal.stash.message !== message) {
      throw new Error("Recovery journal stash identity does not match its deterministic ref and message.");
    }
    return requireParkStashObject({
      branch: "main",
      branchHeadSha: expectedLocalHead,
      message,
      ref: refs.stash,
      sha: journal.stash.sha,
      gitText,
      gitOptional,
    });
  }
  if (referencedSha) {
    return requireParkStashObject({
      branch: "main",
      branchHeadSha: expectedLocalHead,
      message,
      ref: refs.stash,
      sha: referencedSha,
      gitText,
      gitOptional,
    });
  }
  const observed = observeRecoveryState({ gitText, gitOptional });
  if (observed.symbolicBranch !== "main" ||
      observed.head !== expectedLocalHead ||
      observed.mainRef !== expectedLocalHead) {
    if (journal.manifest.length) {
      throw new Error("Recovery entered a detached or realigned phase without its exact captured stash ref.");
    }
    return null;
  }
  const matchingStashes = findRecoveryStashes({ branch: "main", message, gitText });
  if (matchingStashes.length > 1) {
    throw new Error(`Multiple stash objects match canonical recovery ${journal.recoveryId}.`);
  }
  if (!matchingStashes.length) {
    const currentManifest = createWorkingStateManifest({ repo, gitText });
    if (digestValue(currentManifest) !== journal.manifestDigest) {
      throw new Error("Working state changed after the prepared canonical recovery receipt.");
    }
  }
  return captureParkStash({
    branch: "main",
    branchHeadSha: expectedLocalHead,
    message,
    ref: refs.stash,
    repo,
    gitText,
    gitOptional,
    run,
    parkStashLock,
  });
}

function findRecoveryStashes({ branch, message, gitText }) {
  const subject = `On ${branch}: ${message}`;
  return String(gitText(["stash", "list", "--format=%H%x00%gs"]) || "").split("\n").flatMap(line => {
    const separator = line.indexOf("\0");
    return separator > 0 && line.slice(separator + 1) === subject ? [line.slice(0, separator)] : [];
  });
}

function completeRefRealignment({
  expectedLocalHead,
  expectedOriginHead,
  ignoredRetention,
  gitText,
  gitOptional,
  gitSucceeds,
  run,
}) {
  let observed = observeRecoveryState({ gitText, gitOptional });
  requireReplayState(observed, { expectedLocalHead, expectedOriginHead });
  requireIgnoredRetentionStable({
    expected: ignoredRetention,
    localHead: expectedLocalHead,
    originHead: expectedOriginHead,
    gitText,
    gitOptional,
  });
  if (observed.symbolicBranch === "main" && observed.head === expectedLocalHead) {
    if (observed.status) throw new Error("Recovery worktree changed after exact stash capture.");
    run("git", ["switch", "--no-overwrite-ignore", "--detach", expectedOriginHead]);
    observed = observeRecoveryState({ gitText, gitOptional });
    requireIgnoredRetentionStable({
      expected: ignoredRetention,
      localHead: expectedLocalHead,
      originHead: expectedOriginHead,
      gitText,
      gitOptional,
    });
  }
  if (!observed.symbolicBranch &&
      observed.head === expectedOriginHead &&
      observed.mainRef === expectedLocalHead) {
    requireCleanDetachedTarget({ expectedOriginHead, gitText, gitOptional, gitSucceeds });
    requireIgnoredRetentionStable({
      expected: ignoredRetention,
      localHead: expectedLocalHead,
      originHead: expectedOriginHead,
      gitText,
      gitOptional,
    });
    run("git", ["update-ref", "refs/heads/main", expectedOriginHead, expectedLocalHead]);
    observed = observeRecoveryState({ gitText, gitOptional });
    requireIgnoredRetentionStable({
      expected: ignoredRetention,
      localHead: expectedLocalHead,
      originHead: expectedOriginHead,
      gitText,
      gitOptional,
    });
  }
  if (!observed.symbolicBranch &&
      observed.head === expectedOriginHead &&
      observed.mainRef === expectedOriginHead) {
    requireCleanDetachedTarget({ expectedOriginHead, gitText, gitOptional, gitSucceeds });
    requireIgnoredRetentionStable({
      expected: ignoredRetention,
      localHead: expectedLocalHead,
      originHead: expectedOriginHead,
      gitText,
      gitOptional,
    });
    run("git", ["switch", "--no-overwrite-ignore", "main"]);
  }
  requireCompletedState({ expectedOriginHead, gitText, gitOptional });
  requireIgnoredRetentionStable({
    expected: ignoredRetention,
    localHead: expectedLocalHead,
    originHead: expectedOriginHead,
    gitText,
    gitOptional,
  });
}

function requireIgnoredRetentionStable({ expected, localHead, originHead, gitText, gitOptional }) {
  const observed = proveIgnoredStateRetention({
    localHead,
    originHead,
    gitText,
    gitOptional,
  });
  if (canonicalJson(observed) !== canonicalJson(expected)) {
    throw new Error("Ignored local state changed after the prepared canonical recovery receipt.");
  }
}

function requireCleanDetachedTarget({ expectedOriginHead, gitText, gitOptional, gitSucceeds }) {
  const observed = observeRecoveryState({ gitText, gitOptional });
  if (observed.symbolicBranch ||
      observed.head !== expectedOriginHead ||
      observed.status ||
      !gitSucceeds(["diff", "--quiet", expectedOriginHead, "--"])) {
    throw new Error("Detached recovery phase does not exactly match the pinned origin tree.");
  }
}

function requireCompletedState({ expectedOriginHead, gitText, gitOptional }) {
  const observed = observeRecoveryState({ gitText, gitOptional });
  if (observed.symbolicBranch !== "main" ||
      observed.head !== expectedOriginHead ||
      observed.mainRef !== expectedOriginHead ||
      observed.status) {
    throw new Error("Canonical main recovery did not finish as an exact clean protected main checkout.");
  }
}

function createRecoveryRefs(recoveryId) {
  const base = `refs/agentic-canvas-os/recovery/canonical-main/${recoveryId}`;
  return Object.freeze({
    head: `${base}/head`,
    prepared: `${base}/prepared`,
    capture: `${base}/capture`,
    completed: `${base}/completed`,
    stash: `refs/agentic-canvas-os/parked/canonical-main-recovery/${recoveryId}`,
  });
}

function createRecoveryStashMessage({ recoveryId, expectedLocalHead, expectedOriginHead }) {
  return `recovery: canonical main ${recoveryId} ${expectedLocalHead} -> ${expectedOriginHead}`;
}

function deriveRecoveryId({ repoRoot, sessionId, expectedLocalHead, expectedOriginHead }) {
  const digest = digestValue({
    schema: CANONICAL_MAIN_RECOVERY_JOURNAL_SCHEMA,
    repository: repoRoot,
    sessionId,
    expectedLocalHead,
    expectedOriginHead,
  });
  return `recovery-${digest.slice(0, 32)}`;
}

export const canonicalMainRecoveryInternals = Object.freeze({
  createRecoveryRefs,
  createRecoveryStashMessage,
  deriveRecoveryId,
  parsePorcelainV1,
});
