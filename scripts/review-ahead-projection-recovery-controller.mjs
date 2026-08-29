import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  continueExpiredReviewLaneAuthority,
  createRepositoryCloudAuthorityHandoffControllerAdapter,
} from "./cloud-authority-handoff-controller.mjs";
import {
  createScopeExpansionLineageProjectionProof,
} from "./cloud-authority-scope-expansion-lineage-projection.mjs";
import {
  githubLedgerCommandOptions,
  readScopeExpansionLineageLedger,
} from "./cloud-authority-scope-expansion-lineage-migration.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  assertReviewAheadAuthorization,
  createReviewAheadPlan,
  REVIEW_AHEAD_RESULT_SCHEMA,
} from "./review-ahead-projection-recovery-contract.mjs";
import { captureReviewAheadProjectionEvidence } from "./review-ahead-projection-recovery-evidence.mjs";
import { partitionChangedPathsByScope } from "./expired-committed-heartbeat-evidence.mjs";
import {
  captureProtectedMainSharedAncestorPathEquivalence,
  fetchProtectedMain,
} from "./protected-main-path-equivalence-lib.mjs";

export function createReviewAheadProjectionController({
  adapter,
  now = () => new Date(),
  reclaim = continueExpiredReviewLaneAuthority,
} = {}) {
  if (!adapter) throw new Error("Review-ahead recovery requires a repository adapter.");
  return Object.freeze({
    async plan({ branch, sessionId }) {
      const captured = await captureReviewAheadProjectionEvidence({ adapter, branch, sessionId });
      return createReviewAheadPlan(captured.evidence, { now: now() });
    },
    async execute({ branch, sessionId, authorization, ttlSeconds = 1800 }) {
      const before = await captureReviewAheadProjectionEvidence({ adapter, branch, sessionId });
      const plan = createReviewAheadPlan(before.evidence, { now: now() });
      assertReviewAheadAuthorization(plan, authorization);
      const projection = before.evidence.leaseStatus === "active"
        ? await adapter.persistReviewProjection({
          lane: before.lane,
          authority: before.lane.authority,
        })
        : Object.freeze({ receiptDigest: digestValue({
          schema: "agentic-review-ahead-existing-projection/v1",
          branch,
          claimId: before.evidence.claimId,
          reviewHeadSha: before.evidence.reviewHeadSha,
        }) });
      const projected = await captureReviewAheadProjectionEvidence({ adapter, branch, sessionId });
      if (projected.evidence.leaseStatus !== "review_ready"
          || projected.evidence.claimId !== before.evidence.claimId
          || projected.evidence.localHeadSha !== before.evidence.localHeadSha
          || projected.evidence.localDescendantReceiptDigest
            !== before.evidence.localDescendantReceiptDigest
          || projected.evidence.reviewHeadSha !== before.evidence.reviewHeadSha) {
        throw new Error("Review-ahead local projection did not preserve exact identity.");
      }
      const reclaimRequest = Object.freeze({
        transition: "reclaim",
        branch,
        sessionId,
        successorSessionId: sessionId,
        successorDeviceId: before.lane.lease.device,
        ttlSeconds,
      });
      const lineageProjectionProof = projected.claim?.leaseEpoch === 1
          && projected.claim.predecessorClaimId
        ? await adapter.createLineageProjectionProof({
          lane: projected.lane,
          status: projected.status,
          request: reclaimRequest,
          observedAt: now(),
        })
        : null;
      const reclaimed = await reclaim(reclaimRequest, {
        adapter,
        lineageProjectionProof,
      });
      if (!String(reclaimed.outcome || "").startsWith("reclaimed-live")) {
        const findingTypes = Array.isArray(reclaimed.blockingFindings)
          ? reclaimed.blockingFindings.map(item => item?.type).filter(Boolean).join(",")
          : "";
        throw new Error(
          `Review-ahead cloud reclaim did not converge to live review authority${
            findingTypes ? `: ${findingTypes}` : "."
          }`,
        );
      }
      const core = {
        schema: REVIEW_AHEAD_RESULT_SCHEMA,
        ok: true,
        status: "review-ready-reclaimed",
        branch,
        planDigest: plan.planDigest,
        sourceClaimId: before.evidence.claimId,
        successorClaimId: reclaimed.successorClaimId,
        projectionReceiptDigest: projection.receiptDigest,
        reclaimResultDigest: digestValue(reclaimed),
        sourceBytes: "preserved",
        deployment: false,
      };
      return Object.freeze({ ...core, receiptDigest: digestValue(core) });
    },
  });
}

export function createRepositoryReviewAheadProjectionController({
  repository, sessionId, taskAuthorityFile = null,
} = {}) {
  const base = createRepositoryCloudAuthorityHandoffControllerAdapter({
    repository, sessionId, taskAuthorityFile,
  });
  const adapter = Object.freeze({
    ...base,
    readLocalHead() {
      return execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repository,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    },
    async createLineageProjectionProof({ lane, status, request, observedAt }) {
      const actor = await base.readAuthenticatedOwner();
      const ledger = readScopeExpansionLineageLedger({
        ledgerRepository: lane.authority.ledgerRepository,
        ghText: argumentsList => execFileSync(
          "gh",
          argumentsList,
          githubLedgerCommandOptions(repository),
        ),
      });
      return createScopeExpansionLineageProjectionProof({
        lane,
        actor,
        status,
        ledger,
        request,
        now: observedAt,
      });
    },
    readLocalDescendantReceipt({ baseSha, localHeadSha, reviewHeadSha, declaredWriteScope }) {
      const gitText = args => execFileSync("git", args, {
        cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      });
      fetchProtectedMain({
        run(command, args) {
          execFileSync(command, args, {
            cwd: repository, stdio: ["ignore", "ignore", "pipe"],
          });
        },
      });
      execFileSync("git", ["merge-base", "--is-ancestor", reviewHeadSha, localHeadSha], {
        cwd: repository,
        stdio: ["ignore", "ignore", "pipe"],
      });
      const commits = execFileSync("git", ["rev-list", "--reverse", `${reviewHeadSha}..${localHeadSha}`], {
        cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      }).trim().split("\n").filter(Boolean);
      if (commits.length === 0 || commits.length > 32) {
        throw new Error("Review-ahead local descendant range must contain 1 to 32 commits.");
      }
      const paths = execFileSync("git", ["diff", "--name-only", "-z", reviewHeadSha, localHeadSha], {
        cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      }).split("\0").filter(Boolean).sort();
      if (paths.length === 0) throw new Error("Review-ahead local descendant has no changed paths.");
      const partition = partitionChangedPathsByScope({
        changedPaths: paths, declaredWriteSet: declaredWriteScope,
      });
      const protectedMainSharedAncestorEquivalence =
        captureProtectedMainSharedAncestorPathEquivalence({
        baseSha, headSha: localHeadSha,
        exemptPaths: partition.protectedEquivalentPaths, gitText,
      });
      const binaryDiff = execFileSync("git", ["diff", "--binary", reviewHeadSha, localHeadSha], {
        cwd: repository, encoding: null, stdio: ["ignore", "pipe", "pipe"],
      });
      const receipt = Object.freeze({
        schema: "agentic-review-ahead-local-descendant-evidence/v1",
        reviewHeadSha, localHeadSha, commits, paths,
        declaredChangedPaths: partition.declaredChangedPaths,
        protectedEquivalentPaths: partition.protectedEquivalentPaths,
        protectedMainSharedAncestorEquivalence,
        protectedMainSharedAncestorEquivalenceDigest:
          digestValue(protectedMainSharedAncestorEquivalence),
        treeSha: execFileSync("git", ["rev-parse", `${localHeadSha}^{tree}`], {
          cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        }).trim(),
        binaryDiffDigest: createHash("sha256").update(binaryDiff).digest("hex"),
      });
      return Object.freeze({ receipt, receiptDigest: digestValue(receipt) });
    },
  });
  return createReviewAheadProjectionController({ adapter });
}
