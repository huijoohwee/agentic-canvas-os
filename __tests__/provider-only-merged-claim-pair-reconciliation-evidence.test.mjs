// Responsibility: prove the exact pair, provider, controller, and local-absence joins.
import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  digestValue,
  normalizeWriteSet,
} from "../scripts/cloud-collaboration-primitives.mjs";
import {
  PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_EVIDENCE_SCHEMA,
  PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_RUNTIME_PATHS,
  buildProviderOnlyMergedClaimPairReconciliationEvidence,
  normalizeProviderOnlyMergedClaimPairReconciliationEvidence,
  providerOnlyMergedClaimPairInventoryDigest,
  providerOnlyMergedClaimPairRelevantClaims,
} from "../scripts/provider-only-merged-claim-pair-reconciliation-evidence.mjs";

const digest = label => digestValue({ label });
const sha = label => digestValue({ sha: label }).slice(0, 40);
const isEntrypoint = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isEntrypoint) {
test("seals one immutable provider-only pair with byte, check, and handoff evidence", () => {
  const raw = providerOnlyEvidenceFixture();
  const evidence = buildProviderOnlyMergedClaimPairReconciliationEvidence(raw);

  assert.equal(
    evidence.schema,
    PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_EVIDENCE_SCHEMA,
  );
  assert.deepEqual(normalizeProviderOnlyMergedClaimPairReconciliationEvidence(evidence), evidence);
  assert.deepEqual(evidence.cloud.relevantClaimIds, [
    raw.cloud.source.claimId,
    raw.cloud.waiter.claimId,
  ].sort());
  assert.equal(evidence.cloud.sourceLineageDigest, digestValue(evidence.cloud.sourceLineage));
  assert.equal(evidence.cloud.waiterLineageDigest, digestValue(evidence.cloud.waiterLineage));
  assert.match(evidence.bytesDigest, /^[0-9a-f]{64}$/u);
  assert.match(evidence.namedChecksDigest, /^[0-9a-f]{64}$/u);
  assert.match(evidence.handoffEvidenceDigest, /^[0-9a-f]{64}$/u);
  assert.equal(evidence.preservation.providerDeployment, "forbidden");
  assert.equal(Object.isFrozen(evidence.cloud.source), true);
});

test("rejects forged pair identity, incomplete lineage, and a third relevant claim", () => {
  const cases = [
    raw => { raw.cloud.waiter.predecessorClaimId = digest("other-predecessor"); },
    raw => { raw.cloud.waiter.leaseEpoch = raw.cloud.source.leaseEpoch + 2; },
    raw => { raw.cloud.sourceLineage.pop(); },
    raw => { raw.cloud.sourceLineage[1].digest = digest("unjoined-transition"); },
    raw => { raw.cloud.currentClaims.push(additionalRelevantClaim(raw.cloud.source)); },
  ];
  for (const corrupt of cases) {
    const raw = providerOnlyEvidenceFixture();
    corrupt(raw);
    assert.throws(
      () => buildProviderOnlyMergedClaimPairReconciliationEvidence(raw),
      /pair|lineage|successor|identity|relevant/iu,
    );
  }
});

test("fails closed when provider merge, path, protection, or required-check proof drifts", () => {
  const cases = [
    raw => { raw.provider.mergeCommit.parents[0] = sha("wrong-squash-parent"); },
    raw => { raw.provider.changedPaths.mergeCommit = ["outside/runtime.mjs"]; },
    raw => { raw.provider.protectedMainPaths[0].objectSha = "x".repeat(40); },
    raw => { raw.provider.protection.liveRequiredChecks[0].source = "ruleset"; },
    raw => {
      raw.provider.checkRuns.find(run => run.headSha === raw.provider.mergeCommit.sha).conclusion = "FAILURE";
    },
    raw => { raw.provider.writerMarkerPresent = true; },
  ];
  for (const corrupt of cases) {
    const raw = providerOnlyEvidenceFixture();
    corrupt(raw);
    assert.throws(() => buildProviderOnlyMergedClaimPairReconciliationEvidence(raw));
  }
});

test("canonicalizes provider checks and projects rerun-stable required witnesses", async context => {
  const baseline = buildProviderOnlyMergedClaimPairReconciliationEvidence(
    providerOnlyEvidenceFixture(),
  );
  await context.test("order stability", () => {
    const reordered = providerOnlyEvidenceFixture();
    reordered.provider.checkRuns.reverse();
    assert.equal(
      buildProviderOnlyMergedClaimPairReconciliationEvidence(reordered).evidenceDigest,
      baseline.evidenceDigest,
    );
  });
  await context.test("duplicate/rerun stability", () => {
    const duplicated = providerOnlyEvidenceFixture();
    duplicated.provider.checkRuns.push(structuredClone(duplicated.provider.checkRuns[0]));
    duplicated.provider.checkRuns.push({ ...structuredClone(duplicated.provider.checkRuns[0]),
      status: "COMPLETED", conclusion: "FAILURE" });
    duplicated.provider.protection.liveRequiredChecks.push({
      context: "Unrelated Advisory", appId: 99, source: "classic", strict: false,
    });
    assert.equal(
      buildProviderOnlyMergedClaimPairReconciliationEvidence(duplicated).namedChecksDigest,
      baseline.namedChecksDigest,
    );
  });
});

test("requires a clean exact-main controller and complete local source absence", async context => {
  const cases = [
    ["dirty controller", raw => { raw.controller.clean = false; }],
    ["runtime digest drift", raw => { raw.controller.runtimeDigest = digest("stale-runtime"); }],
    ["runtime path substitution", raw => {
      raw.controller.runtimeFiles[0].path = "scripts/unrelated-controller.mjs";
      raw.controller.runtimeFiles.sort((left, right) => left.path.localeCompare(right.path));
      raw.controller.runtimeDigest = digestValue(raw.controller.runtimeFiles);
    }],
    ["historical controller ancestry", raw => {
      raw.provider.protection.historicalController.isAncestorOfCurrentController = false;
    }],
    ["historical controller semantic drift", raw => {
      raw.provider.protection.historicalController.entrypoint = "scripts/other.mjs";
    }],
    ["workflow path substitution", raw => {
      raw.provider.protection.enrollment.workflowPath = ".github/workflows/other.yml";
    }],
    ["wrong local origin", raw => { raw.local.originRepository = "other/target"; }],
    ["non-main local anchor", raw => { raw.local.branch = "agent/device/old-source"; }],
    ["local main non-ancestor", raw => { raw.local.headIsAncestorOfProviderProtectedMain = false; }],
    ["historical lease present", raw => { raw.local.matchingLeaseCount = 1; }],
  ];
  for (const [label, corrupt] of cases) {
    await context.test(label, () => {
      const raw = providerOnlyEvidenceFixture();
      corrupt(raw);
      assert.throws(() => buildProviderOnlyMergedClaimPairReconciliationEvidence(raw));
    });
  }
});

test("accepts live af3 delivery enrollment against current 4f controller and inert Git residue", () => {
  const raw = providerOnlyEvidenceFixture();
  assert.equal(raw.provider.protection.enrollment.controllerRevision,
    "af3bff6f15ea2e6e7a01e461c077a6c99ac22a28");
  assert.equal(raw.controller.protectedMainSha,
    "4f497143c445aaa125da06cddf59469c5c6d85a5");
  raw.provider.remoteHeadRefPresent = true;
  raw.local.sourceRemoteTrackingRefPresent = true;
  raw.local.sourceObjectPresent = true;
  assert.doesNotThrow(() => buildProviderOnlyMergedClaimPairReconciliationEvidence(raw));
});

test("inventory digests are order-stable and relevance includes overlap and lineage edges", () => {
  const raw = providerOnlyEvidenceFixture();
  const unrelated = additionalClaim(raw.cloud.source, {
    workItemId: "work-item:unrelated",
    leaseEpoch: 7,
    declaredWriteScope: ["path:docs/unrelated"],
    predecessorClaimId: null,
  });
  assert.equal(
    providerOnlyMergedClaimPairInventoryDigest([raw.cloud.source, unrelated]),
    providerOnlyMergedClaimPairInventoryDigest([unrelated, raw.cloud.source]),
  );

  const overlapping = additionalClaim(raw.cloud.source, {
    workItemId: "work-item:overlap",
    leaseEpoch: 8,
    declaredWriteScope: ["path:src/runtime/deep"],
    predecessorClaimId: null,
  });
  const successor = additionalClaim(raw.cloud.source, {
    workItemId: "work-item:successor",
    leaseEpoch: 9,
    declaredWriteScope: ["path:docs/successor"],
    predecessorClaimId: raw.cloud.waiter.claimId,
  });
  assert.deepEqual(
    providerOnlyMergedClaimPairRelevantClaims(
      [unrelated, successor, raw.cloud.waiter, overlapping, raw.cloud.source],
      raw.cloud.source,
      raw.cloud.waiter,
    ).map(claim => claim.claimId).sort(),
    [raw.cloud.source.claimId, raw.cloud.waiter.claimId, overlapping.claimId, successor.claimId].sort(),
  );
});
}

export function providerOnlyEvidenceFixture() {
  const declaredWriteScope = normalizeWriteSet(["semantic:runtime", "path:src/runtime"]);
  const actorId = "github-user:7";
  const repositoryId = "github-repository:R_target";
  const workItemId = "work-item:provider-only-merge";
  const canonicalBaseRevision = sha("canonical-base");
  const laneRevision = sha("reviewed-head");
  const writeSetDigest = digestValue(declaredWriteScope);
  const sourceIdentity = {
    actorId, canonicalBaseRevision, leaseEpoch: 4, repositoryId, workItemId, writeSetDigest,
  };
  const sourceClaimId = digestValue(sourceIdentity);
  const waiterClaimId = digestValue({ ...sourceIdentity, leaseEpoch: 5 });
  const source = {
    claimId: sourceClaimId, claimDigest: digest("source-fence"),
    transitionDigest: digest("source-transition-reviewed"),
    operationReceiptDigest: digest("source-operation"),
    state: "dormant-preserved", recordedState: "reviewed",
    writeAuthority: false, scopeReserved: true,
    actorId, deviceId: "device:provider", sessionId: "session:provider",
    repositoryId, workItemId, canonicalBaseRevision, laneRevision,
    declaredWriteScope, writeSetDigest, leaseEpoch: 4, transitionCounter: 2,
    heartbeatCounter: 0, reviewRequestId: "github-pull-request:PR_784",
    predecessorClaimId: null, evidenceDigest: digest("focused-review-evidence"),
    integrationReceiptDigest: null, integration: null, retirement: null,
  };
  const waiter = {
    ...structuredClone(source), claimId: waiterClaimId, claimDigest: digest("waiter-fence"),
    transitionDigest: digest("waiter-transition"), operationReceiptDigest: digest("waiter-operation"),
    state: "waiting-successor", recordedState: "waiting-successor", scopeReserved: false,
    leaseEpoch: 5, transitionCounter: 1, reviewRequestId: null,
    predecessorClaimId: sourceClaimId, evidenceDigest: null,
  };
  const runtimeFiles = PROVIDER_ONLY_MERGED_CLAIM_PAIR_RECONCILIATION_RUNTIME_PATHS.map(runtimePath => ({
    path: runtimePath,
    blobSha: sha(`runtime-blob-${runtimePath}`),
    contentDigest: digest(`runtime-content-${runtimePath}`),
  })).sort((left, right) => left.path.localeCompare(right.path));
  const headCommit = {
    sha: laneRevision, treeSha: sha("reviewed-tree"), parents: [canonicalBaseRevision],
  };
  const mergeCommit = {
    sha: sha("squash-merge"), treeSha: headCommit.treeSha, parents: [canonicalBaseRevision],
  };
  const protectedMain = {
    sha: sha("protected-main"), treeSha: sha("protected-main-tree"),
    parents: [mergeCommit.sha],
  };
  const requiredContext = "Integration Gate";
  const controllerRevision = "4f497143c445aaa125da06cddf59469c5c6d85a5";
  const historicalRevision = "af3bff6f15ea2e6e7a01e461c077a6c99ac22a28";
  const historicalSemantic = {
    repository: "huijoohwee/agentic-canvas-os", revision: historicalRevision,
    treeSha: sha("historical-controller-tree"), entrypoint: "scripts/sync-open-pr.mjs",
    mode: "--protected-head-refresh", entrypointBlobSha: sha("historical-entrypoint"),
    entrypointContentDigest: digest("historical-entrypoint-content"),
    adapterPath: "scripts/protected-head-refresh-github-adapter.mjs",
    adapterBlobSha: sha("historical-adapter"),
    adapterContentDigest: digest("historical-adapter-content"),
    executableWitnessDigest: digest("historical-executable-witness"),
  };
  const enrollmentSemantic = {
    workflowPath: ".github/workflows/auto-delivery.yml",
    workflowJob: "protected-head-refresh",
    checkoutActionRevision: sha("checkout-action"),
    controllerPath: ".",
    controllerRevision: historicalRevision,
    runCommand: "node scripts/sync-open-pr.mjs --protected-head-refresh",
    classicRequiredChecks: [requiredContext],
    rulesetRequiredChecks: [],
    requiredCiContexts: [requiredContext],
  };
  const ledgerDigest = digest("ledger-head");
  const sequence = 3;
  return {
    controller: {
      repositoryRoot: "/controller", branch: "main", headSha: controllerRevision,
      originRepository: "huijoohwee/agentic-canvas-os",
      protectedMainSha: controllerRevision, baselineProtectedMainSha: controllerRevision,
      headIsAncestorOfProtectedMain: true, baselineIsAncestorOfProtectedMain: true,
      clean: true, runtimeFiles, runtimeDigest: digestValue(runtimeFiles),
      protectedRuntimeDigest: digestValue(runtimeFiles),
    },
    cloud: {
      ledgerRepository: "huijoohwee/agentic-canvas-os",
      ledgerRevision: sha("ledger-ref"), ledgerDigest,
      sequence, ledgerValidationDigest: digestValue({ sequence, ledgerDigest, failures: [] }),
      source, waiter, currentClaims: [waiter, source],
      sourceLineage: [
        lineageEntry(source, { sequence: 1, action: "claim", counter: 1,
          claimDigest: digest("source-genesis-fence"), entryDigest: digest("source-genesis"),
          recordedState: "current" }),
        lineageEntry(source, { sequence: 2, action: "continue", counter: 2,
          claimDigest: source.claimDigest, entryDigest: source.transitionDigest,
          recordedState: source.recordedState }),
      ],
      waiterLineage: [lineageEntry(waiter, {
        sequence: 3, action: "claim", counter: 1, claimDigest: waiter.claimDigest,
        entryDigest: waiter.transitionDigest, recordedState: waiter.recordedState,
      })],
    },
    provider: {
      provider: "github", repository: "owner/target", repositoryId,
      actorId, actorLogin: "runtime-owner",
      pullRequest: {
        number: 784, nodeId: "PR_784", url: "https://github.com/owner/target/pull/784",
        state: "CLOSED", draft: false, merged: true, mergedAt: "2026-08-28T10:00:00.000Z",
        headRepository: "owner/target", headBranch: "agent/device/provider-only",
        headSha: laneRevision, baseRepository: "owner/target", baseBranch: "main",
        baseSha: canonicalBaseRevision, mergeCommitSha: mergeCommit.sha,
      },
      headCommit, mergeCommit, protectedMain, plannedProtectedMainSha: protectedMain.sha,
      plannedProtectedMainIsAncestorOfProtectedMain: true,
      mergePathObjects: [{ path: "src/runtime/index.mjs", type: "file", objectSha: sha("main-file") }],
      protectedMainPaths: [{ path: "src/runtime/index.mjs", type: "file", objectSha: sha("main-file") }],
      mergeCommitIsAncestorOfProtectedMain: true,
      changedPaths: {
        pullRequest: ["src/runtime/index.mjs"], mergeCommit: ["src/runtime/index.mjs"],
      },
      protection: {
        enrollment: {
          ...enrollmentSemantic,
          contentDigest: digest("workflow"),
          semanticDigest: digestValue(enrollmentSemantic),
        },
        historicalController: { ...historicalSemantic,
          currentControllerRevision: controllerRevision, isAncestorOfCurrentController: true,
          semanticDigest: digestValue(historicalSemantic) },
        liveRequiredChecks: [
          { context: requiredContext, appId: 15368, source: "classic", strict: true },
        ],
        applicableRulesDigest: digest("applicable-rules"),
      },
      checkRuns: [headCommit.sha, mergeCommit.sha].map(revision => ({
        name: requiredContext, appId: 15368, headSha: revision,
        status: "COMPLETED", conclusion: "SUCCESS",
      })),
      remoteHeadRefPresent: false, writerMarkerPresent: false,
    },
    local: {
      repositoryRoot: "/clean-main", originRepository: "owner/target",
      branch: "main", headSha: protectedMain.sha,
      protectedMainSha: protectedMain.sha, providerProtectedMainSha: protectedMain.sha,
      headIsAncestorOfProviderProtectedMain: true, clean: true,
      sourceBranchRefPresent: false, sourceRemoteTrackingRefPresent: false,
      sourceObjectPresent: false, registeredSourceWorktreeCount: 0, matchingLeaseCount: 0,
    },
    recoveryTtlSeconds: 1_800,
  };
}

function lineageEntry(claim, {
  sequence, action, counter, claimDigest, entryDigest, recordedState,
}) {
  return {
    schema: "agentic-cloud-collaboration-entry/v2", sequence, action,
    claimId: claim.claimId, claimDigest, digest: entryDigest,
    evaluationTime: `2026-08-28T10:0${sequence}:00.000Z`,
    transitionCounter: counter, recordedState,
  };
}

function additionalRelevantClaim(source) {
  return additionalClaim(source, {
    workItemId: source.workItemId,
    leaseEpoch: 11,
    declaredWriteScope: ["path:docs/third-claim"],
    predecessorClaimId: null,
  });
}

function additionalClaim(source, {
  workItemId, leaseEpoch, declaredWriteScope: rawScope, predecessorClaimId,
}) {
  const declaredWriteScope = normalizeWriteSet(rawScope);
  const writeSetDigest = digestValue(declaredWriteScope);
  const claimId = digestValue({
    actorId: source.actorId,
    canonicalBaseRevision: source.canonicalBaseRevision,
    leaseEpoch,
    repositoryId: source.repositoryId,
    workItemId,
    writeSetDigest,
  });
  return {
    ...structuredClone(source), claimId, claimDigest: digest(`fence-${claimId}`),
    transitionDigest: digest(`transition-${claimId}`),
    operationReceiptDigest: digest(`receipt-${claimId}`),
    workItemId, declaredWriteScope, writeSetDigest, leaseEpoch,
    predecessorClaimId,
  };
}
