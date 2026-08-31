// Responsibility: Observe and byte-seal one stopped descendant lane without mutating it.
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  activeDescendantUntrackedEntriesDigest,
} from "./active-descendant-untracked-scope-recovery-evidence.mjs";
import { canonicalJson, digestValue }
  from "./cloud-collaboration-primitives.mjs";
import {
  buildExpiredDescendantTargetAdditionProof,
  expiredDescendantRelevantClaims,
  stableWriterMarkerDigest,
} from "./expired-descendant-untracked-scope-recovery-evidence.mjs";
import {
  parseWriterLeasePullRequestBody,
  projectWriterLeasePullRequestMarker,
} from "./writer-lease-lib.mjs";

const IMPLEMENTATION_FILES = Object.freeze([
  "scripts/expired-descendant-untracked-scope-recovery-contract.mjs",
  "scripts/expired-descendant-untracked-scope-recovery-controller.mjs",
  "scripts/expired-descendant-untracked-scope-recovery-evidence.mjs",
  "scripts/expired-descendant-untracked-scope-recovery-repository-adapter.mjs",
  "scripts/expired-descendant-untracked-scope-recovery-repository-observer.mjs",
  "scripts/expired-descendant-untracked-scope-recovery-repository-terminal.mjs",
  "scripts/expired-descendant-untracked-scope-recovery.mjs",
  "scripts/active-descendant-untracked-scope-recovery-evidence.mjs",
  "scripts/active-dirty-scope-expansion-controller.mjs",
  "scripts/active-dirty-scope-expansion-successor-projection.mjs",
]);

export function createExpiredDescendantUntrackedScopeRecoveryRepositoryObserver({
  repository, controllerRoot, git, gitRaw, gh, invoke, captureDirt,
  alternateControllerWitness = null,
}) {
  function captureFrame(lease) {
    const branch = text(git(["branch", "--show-current"]), "attached branch");
    const headSha = sha(git(["rev-parse", "HEAD"]), "source HEAD");
    const remoteFence = firstSha(git(["ls-remote", "--heads", "origin",
      `refs/heads/${branch}`]));
    if (branch !== lease.branch || remoteFence !== lease.fenceSha
      || headSha === lease.fenceSha || gitExit(["merge-base", "--is-ancestor",
        lease.fenceSha, headSha]) !== 0) invalid("strict unpublished descendant");
    const firstParent = lines(git(["rev-list", "--reverse", "--first-parent",
      `${lease.fenceSha}..${headSha}`]));
    const all = lines(git(["rev-list", "--reverse", `${lease.fenceSha}..${headSha}`]));
    if (!firstParent.length || canonicalJson(firstParent) !== canonicalJson(all)) {
      invalid("linear descendant commits");
    }
    const dirt = captureDirt();
    const trackedDirtyPaths = dirt.entries.filter(item => !item.untracked)
      .map(item => item.path).sort();
    const untrackedPaths = dirt.entries.filter(item => item.untracked)
      .map(item => item.path).sort();
    if (!trackedDirtyPaths.length || !untrackedPaths.length || dirt.headSha !== headSha) {
      invalid("mixed tracked and untracked stopped dirt");
    }
    return Object.freeze({
      headSha,
      headTreeSha: sha(git(["rev-parse", `${headSha}^{tree}`]), "source tree"),
      commitInventoryDigest: digestValue(firstParent),
      rangeDiffDigest: digestValue(gitRaw(["diff", "--binary", "--full-index",
        lease.fenceSha, headSha, "--"])),
      committedPaths: nul(gitRaw(["diff", "--name-only", "--no-renames", "-z",
        lease.fenceSha, headSha, "--"])).sort(),
      dirt, trackedDirtyPaths, untrackedPaths,
    });
  }

  function pullFrame(lease, { requireSourceMarker = false, expected = null,
    expectedRawBodyDigest = null, expectedStructuralMarkerDigest = null } = {}) {
    const value = JSON.parse(gh(["pr", "view", lease.pullRequestUrl, "--json",
      "id,number,url,state,isDraft,autoMergeRequest,headRefName,headRefOid,headRepository,baseRefName,baseRefOid,body"]));
    const markers = String(value.body || "").match(
      /<!--\s*agentic-writer-lease\/v2\s+\{.*?\}\s*-->/gsu,
    ) || [];
    const marker = parseWriterLeasePullRequestBody(value.body);
    if (!marker || markers.length !== 1 || value.state !== "OPEN" || value.isDraft !== true
      || value.autoMergeRequest !== null || value.headRefOid !== lease.fenceSha
      || value.baseRefName !== "main" || value.url !== lease.pullRequestUrl
      || value.headRepository?.nameWithOwner !== lease.cloudAuthority.targetRepository) {
      invalid("exact same-repository draft pull request");
    }
    if (requireSourceMarker && stableWriterMarkerDigest(marker)
      !== stableWriterMarkerDigest(projectWriterLeasePullRequestMarker(lease))) {
      invalid("stable source pull-request marker");
    }
    const incident = Object.freeze({
      repository: lease.cloudAuthority.targetRepository,
      nodeId: value.id, number: value.number, url: value.url, state: value.state,
      draft: value.isDraft, autoMerge: value.autoMergeRequest,
      branch: value.headRefName, headSha: value.headRefOid,
      baseBranch: value.baseRefName, baseSha: value.baseRefOid,
      visibleBodyDigest: digestValue(bodyWithoutMarker(value.body)),
      sourceMarkerDigest: digestValue(marker),
    });
    const result = Object.freeze({ incident,
      rawBodyDigest: digestValue(String(value.body || "")),
      structuralMarkerDigest: stableWriterMarkerDigest(marker) });
    if ((expected && canonicalJson(incident) !== canonicalJson(expected))
      || (expectedRawBodyDigest && result.rawBodyDigest !== expectedRawBodyDigest)
      || (expectedStructuralMarkerDigest
        && result.structuralMarkerDigest !== expectedStructuralMarkerDigest)) {
      invalid("byte-exact preserved pull request");
    }
    return result;
  }

  function statusCloud(lease) {
    const status = invoke({ action: "status",
      ledgerRepository: lease.cloudAuthority.ledgerRepository,
      request: { targetRepository: lease.cloudAuthority.targetRepository } });
    if (status?.schema !== "agentic-cloud-collaboration-result/v1"
      || status.ok !== true || status.action !== "status"
      || !/^[0-9a-f]{40}$/u.test(String(status.ledgerRevision || ""))
      || !/^[0-9a-f]{64}$/u.test(String(status.ledgerDigest || ""))
      || !Number.isSafeInteger(status.sequence) || status.sequence < 1
      || !Array.isArray(status.claims)) invalid("validated cloud status");
    return { status, ledgerDigest: status.ledgerDigest };
  }

  function repositorySubject(name = null) {
    const args = ["repo", "view", ...(name ? [name] : []), "--json", "id,nameWithOwner"];
    const value = JSON.parse(gh(args));
    const actor = text(gh(["api", "user", "--jq", ".id"]), "GitHub actor ID");
    return Object.freeze({ nameWithOwner: text(value.nameWithOwner, "repository name"),
      nodeId: text(value.id, "repository node ID"), actorId: `github-user:${actor}` });
  }

  function captureTargetAdditions({ lease, target, frame, cloud }) {
    const additions = target.declaredWriteSet.filter(item => item.startsWith("path:")
      && !lease.admission.declaredWriteSet.includes(item)).map(item => item.slice(5)).sort();
    const absent = additions.filter(item => !frame.untrackedPaths.includes(item));
    for (const file of absent) assertAbsent(file);
    const source = cloud.status.claims.find(item =>
      item.claimId === lease.cloudAuthority.claimId);
    const overlaps = expiredDescendantRelevantClaims(cloud.status.claims, {
      sourceClaimId: source.claimId, sourceRepositoryId: source.repositoryId,
      sourceWorkItemId: source.workItemId, targetDeclaredWriteSet: target.declaredWriteSet,
    }).filter(item => item.claimId !== source.claimId).map(item => item.claimId);
    return buildExpiredDescendantTargetAdditionProof({ targetAdditionPaths: additions,
      untrackedAdditionPaths: frame.untrackedPaths, absentAdditionPaths: absent,
      overlappingClaimIds: overlaps });
  }

  function assertAbsent(file) {
    if (gitRaw(["ls-files", "--stage", "--", file])
      || gitExit(["cat-file", "-e", `HEAD:${file}`]) === 0) invalid("absent target addition");
    const parts = file.split("/"); let cursor = repository;
    for (let index = 0; index < parts.length; index += 1) {
      cursor = path.join(cursor, parts[index]);
      try {
        const stat = lstatSync(cursor);
        if (index === parts.length - 1 || stat.isSymbolicLink() || !stat.isDirectory()) {
          invalid("clean absent target addition");
        }
      } catch (error) { if (error?.code === "ENOENT") return; throw error; }
    }
  }

  function controllerWitness() {
    if (alternateControllerWitness) return alternateControllerWitness();
    const branch = git(["branch", "--show-current"], controllerRoot);
    const headSha = sha(git(["rev-parse", "HEAD"], controllerRoot), "controller HEAD");
    const originMainSha = sha(git(["rev-parse", "origin/main"], controllerRoot),
      "controller origin/main");
    if (branch !== "main" || headSha !== originMainSha
      || gitRaw(["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        controllerRoot)) invalid("clean protected controller");
    return Object.freeze({
      repository: text(git(["remote", "get-url", "origin"], controllerRoot),
        "controller repository"),
      branch, headSha, originMainSha,
      treeSha: sha(git(["rev-parse", "HEAD^{tree}"], controllerRoot), "controller tree"),
      implementationDigest: digestValue(IMPLEMENTATION_FILES.map(file => ({
        file, digest: digestValue(readFileSync(path.join(controllerRoot, file))),
      }))),
    });
  }

  function controllerContinuation(sealed) {
    const current = controllerWitness();
    return assertExpiredDescendantControllerContinuation({ sealed, current,
      isAncestor: (ancestor, descendant) => gitExit(
        ["merge-base", "--is-ancestor", ancestor, descendant], controllerRoot,
      ) === 0 });
  }

  return Object.freeze({ captureFrame, pullFrame, statusCloud, repositorySubject,
    captureTargetAdditions, controllerWitness, controllerContinuation });

  function gitExit(args, cwd = repository) { try { git(args, cwd); return 0; } catch { return 1; } }
}

export function preservedExpiredDescendantPullRequestDigest(pull) {
  return digestValue({ ...pull.incident, rawBodyDigest: pull.rawBodyDigest,
    structuralMarkerDigest: pull.structuralMarkerDigest });
}

export function assertExpiredDescendantControllerContinuation({
  sealed, current, isAncestor,
}) {
  if (sealed?.repository !== current?.repository
    || sealed?.branch !== "main" || current?.branch !== "main"
    || sealed.headSha !== sealed.originMainSha
    || current.headSha !== current.originMainSha
    || sealed.implementationDigest !== current.implementationDigest
    || typeof isAncestor !== "function"
    || isAncestor(sealed.headSha, current.headSha) !== true) {
    invalid("protected controller continuation");
  }
  return Object.freeze(current);
}

function bodyWithoutMarker(value) {
  return String(value || "").replace(
    /<!--\s*agentic-writer-lease\/v2\s+\{.*?\}\s*-->/gsu, "",
  );
}
function nul(value) { return String(value).split("\0").filter(Boolean); }
function lines(value) { return String(value).split(/\r?\n/u).filter(Boolean); }
function firstSha(value) { return sha(String(value).trim().split(/\s+/u)[0], "remote SHA"); }
function sha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) invalid(label);
  return value;
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim()) invalid(label);
  return value.trim();
}
function invalid(label) {
  throw new Error(`Expired descendant/untracked recovery has invalid ${label}.`);
}
