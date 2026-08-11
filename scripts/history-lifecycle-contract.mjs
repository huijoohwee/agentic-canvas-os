// Responsibility: Normalize read-only history evidence and derive advisory, non-authorizing lifecycle plans.

import { canonicalJson, digestValue } from "./cloud-collaboration-primitives.mjs";

export const HISTORY_LIFECYCLE_EVIDENCE_SCHEMA = "agentic-history-lifecycle-evidence/v1";
export const HISTORY_LIFECYCLE_PLAN_SCHEMA = "agentic-history-lifecycle-plan/v1";
export const HISTORY_LIFECYCLE_RESULT_SCHEMA = "agentic-history-lifecycle-result/v1";

const SHA256 = /^[0-9a-f]{64}$/u;
const BRANCH_RELATIONSHIPS = new Set(["same", "ancestor", "ahead", "diverged", "unrelated"]);
const PATCH_STATES = new Set(["not-evaluated", "incomplete", "equivalent", "different"]);
const AUTHORITIES = new Set(["terminal", "nonterminal", "unknown"]);
const PLAN_MODES = new Set(["audit", "plan"]);

export function normalizeHistoryLifecycleEvidence(value) {
  exact(value, [
    "schema", "repository", "comparison", "worktrees", "branches", "stashes",
    "recoveryAnchors", "leases", "providerChanges", "completeness", "evidenceDigest",
  ], "history evidence");
  const repository = normalizeRepository(value.repository);
  const oid = oidReader(repository.objectFormat);
  const core = {
    schema: text(value.schema, "evidence schema"),
    repository,
    comparison: normalizeComparison(value.comparison, oid),
    worktrees: sortedUnique(value.worktrees, normalizeWorktree, item => item.path, "worktrees", oid),
    branches: sortedUnique(value.branches, normalizeBranch, item => item.ref, "branches", oid),
    stashes: sortedUnique(value.stashes, normalizeStash, item => item.revision, "stashes", oid),
    recoveryAnchors: sortedUnique(
      value.recoveryAnchors, normalizeAnchor, item => item.ref, "recovery anchors", oid,
    ),
    leases: normalizeLeases(value.leases, oid),
    providerChanges: sortedUnique(
      value.providerChanges, normalizeProviderChange, item => item.id, "provider changes", oid,
    ),
    completeness: normalizeCompleteness(value.completeness),
  };
  if (core.schema !== HISTORY_LIFECYCLE_EVIDENCE_SCHEMA) {
    throw new Error(`History evidence schema must be ${HISTORY_LIFECYCLE_EVIDENCE_SCHEMA}.`);
  }
  assertEvidenceJoins(core);
  if (value.evidenceDigest !== digestValue(core)) throw new Error("History evidence digest is invalid.");
  return freeze({ ...core, evidenceDigest: value.evidenceDigest });
}

export function buildHistoryLifecyclePlan(evidenceValue) {
  const evidence = normalizeHistoryLifecycleEvidence(evidenceValue);
  const branchPlans = evidence.branches.map(branch => classifyBranch(branch, evidence));
  const stashPlans = classifyStashes(evidence.stashes, evidence);
  const core = {
    schema: HISTORY_LIFECYCLE_PLAN_SCHEMA,
    status: "planned",
    evidence,
    evidenceDigest: evidence.evidenceDigest,
    branches: branchPlans,
    stashes: stashPlans,
    summary: {
      branchDispositions: countDispositions(branchPlans),
      stashDispositions: countDispositions(stashPlans),
      completenessReasons: evidence.completeness.reasons,
    },
    effects: [],
    mutationAuthorized: false,
    mutationAuthority: null,
  };
  return freeze({ ...core, planDigest: digestValue(core) });
}

export function normalizeHistoryLifecyclePlan(value) {
  exact(value, [
    "schema", "status", "evidence", "evidenceDigest", "branches", "stashes", "summary",
    "effects", "mutationAuthorized", "mutationAuthority", "planDigest",
  ], "history plan");
  const rebuilt = buildHistoryLifecyclePlan(value.evidence);
  if (canonicalJson(value) !== canonicalJson(rebuilt)) {
    throw new Error("History plan is malformed, incomplete, or drifted.");
  }
  return rebuilt;
}

export function buildHistoryLifecycleResult({ mode, evidence: evidenceValue, plan: planValue = null }) {
  if (!PLAN_MODES.has(mode)) throw new Error("History lifecycle result mode must be audit or plan.");
  const evidence = normalizeHistoryLifecycleEvidence(evidenceValue);
  const plan = mode === "plan" ? normalizeHistoryLifecyclePlan(planValue) : null;
  if (mode === "audit" && planValue !== null) throw new Error("History audit result cannot carry a plan.");
  if (plan && plan.evidenceDigest !== evidence.evidenceDigest) {
    throw new Error("History result evidence and plan are not identical.");
  }
  const core = {
    schema: HISTORY_LIFECYCLE_RESULT_SCHEMA,
    mode,
    status: mode === "audit" ? "audited" : "planned",
    evidence,
    evidenceDigest: evidence.evidenceDigest,
    plan,
    planDigest: plan?.planDigest || null,
    effects: [],
    mutationAuthorized: false,
    mutationAuthority: null,
  };
  return freeze({ ...core, resultDigest: digestValue(core) });
}

export function normalizeHistoryLifecycleResult(value) {
  exact(value, [
    "schema", "mode", "status", "evidence", "evidenceDigest", "plan", "planDigest",
    "effects", "mutationAuthorized", "mutationAuthority", "resultDigest",
  ], "history lifecycle result");
  if (value.schema !== HISTORY_LIFECYCLE_RESULT_SCHEMA) throw new Error("History result schema is invalid.");
  const rebuilt = buildHistoryLifecycleResult({ mode: value.mode, evidence: value.evidence, plan: value.plan });
  if (canonicalJson(value) !== canonicalJson(rebuilt)) {
    throw new Error("History lifecycle result is malformed, incomplete, or drifted.");
  }
  return rebuilt;
}

function normalizeRepository(value) {
  exact(value, ["root", "gitCommonDir", "objectFormat", "shallow", "replaceRefs", "grafts"], "repository");
  const objectFormat = oneOf(value.objectFormat, ["sha1", "sha256"], "object format");
  const oid = oidReader(objectFormat);
  return {
    root: absolutePath(value.root, "repository root"),
    gitCommonDir: absolutePath(value.gitCommonDir, "Git common directory"),
    objectFormat,
    shallow: normalizeFileObservation(value.shallow, "shallow observation"),
    replaceRefs: sortedUnique(value.replaceRefs, (item, nestedOid) => {
      exact(item, ["ref", "revision"], "replace ref");
      return { ref: ref(item.ref, "replace ref"), revision: nestedOid(item.revision, "replace revision") };
    }, item => item.ref, "replace refs", oid),
    grafts: normalizeFileObservation(value.grafts, "grafts observation"),
  };
}

function normalizeComparison(value, oid) {
  exact(value, [
    "ref", "revision", "tree", "clean", "frontierBefore", "frontierAfter", "stable", "remote", "provider",
  ], "comparison");
  const before = normalizeFrontier(value.frontierBefore, oid);
  const after = normalizeFrontier(value.frontierAfter, oid);
  return {
    ref: ref(value.ref, "comparison ref"),
    revision: oid(value.revision, "comparison revision"),
    tree: oid(value.tree, "comparison tree"),
    clean: boolean(value.clean, "comparison clean"),
    frontierBefore: before,
    frontierAfter: after,
    stable: boolean(value.stable, "comparison stability"),
    remote: value.remote === null ? null : normalizeRemote(value.remote, oid),
    provider: value.provider === null ? null : normalizeProvider(value.provider),
  };
}

function normalizeFrontier(value, oid) {
  exact(value, [
    "comparisonRevision", "refsDigest", "worktreesDigest", "leaseSourceDigest", "statusDigest",
    "remoteDigest", "providerDigest", "digest",
  ], "frontier");
  const core = {
    comparisonRevision: oid(value.comparisonRevision, "frontier comparison revision"),
    refsDigest: digest(value.refsDigest, "frontier refs digest"),
    worktreesDigest: digest(value.worktreesDigest, "frontier worktrees digest"),
    leaseSourceDigest: nullableDigest(value.leaseSourceDigest, "frontier lease digest"),
    statusDigest: digest(value.statusDigest, "frontier status digest"),
    remoteDigest: nullableDigest(value.remoteDigest, "frontier remote digest"),
    providerDigest: nullableDigest(value.providerDigest, "frontier provider digest"),
  };
  if (value.digest !== digestValue(core)) throw new Error("History frontier digest is invalid.");
  return { ...core, digest: value.digest };
}

function normalizeRemote(value, oid) {
  exact(value, ["ref", "revision"], "remote comparison");
  return { ref: ref(value.ref, "remote comparison ref"), revision: oid(value.revision, "remote comparison revision") };
}

function normalizeProvider(value) {
  exact(value, ["kind", "repository"], "provider comparison");
  return { kind: text(value.kind, "provider kind"), repository: text(value.repository, "provider repository") };
}

function normalizeWorktree(value, oid) {
  exact(value, ["path", "head", "branch", "detached", "bare", "locked", "prunable"], "worktree");
  return {
    path: absolutePath(value.path, "worktree path"),
    head: value.head === null ? null : oid(value.head, "worktree head"),
    branch: value.branch === null ? null : ref(value.branch, "worktree branch"),
    detached: boolean(value.detached, "worktree detached"),
    bare: boolean(value.bare, "worktree bare"),
    locked: boolean(value.locked, "worktree locked"),
    prunable: boolean(value.prunable, "worktree prunable"),
  };
}

function normalizeBranch(value, oid) {
  const allowed = [
    "ref", "revision", "tree", "upstreamRef", "remoteRevision", "relationship", "ahead", "behind",
    "reflog", "patch",
  ];
  exact(value, allowed, "branch");
  return {
    ref: ref(value.ref, "branch ref"),
    revision: oid(value.revision, "branch revision"),
    tree: oid(value.tree, "branch tree"),
    upstreamRef: value.upstreamRef === null ? null : ref(value.upstreamRef, "branch upstream"),
    remoteRevision: value.remoteRevision === null ? null : oid(value.remoteRevision, "remote branch revision"),
    relationship: oneOf(value.relationship, BRANCH_RELATIONSHIPS, "branch relationship"),
    ahead: integer(value.ahead, "branch ahead"),
    behind: integer(value.behind, "branch behind"),
    reflog: normalizeReflog(value.reflog, oid),
    patch: normalizePatch(value.patch),
  };
}

function normalizeReflog(value, oid) {
  const keys = ["complete", "entryCount", "digest", "uniqueRevisions"];
  if (Object.hasOwn(value || {}, "reason")) keys.push("reason");
  if (Object.hasOwn(value || {}, "uncontainedRevisions")) keys.push("uncontainedRevisions");
  exact(value, keys, "branch reflog");
  const result = {
    complete: boolean(value.complete, "reflog complete"),
    entryCount: integer(value.entryCount, "reflog entry count"),
    digest: digest(value.digest, "reflog digest"),
    uniqueRevisions: sortedUnique(value.uniqueRevisions, item => oid(item, "reflog revision"), item => item, "reflog revisions"),
  };
  if (keys.includes("reason")) result.reason = value.reason === null ? null : text(value.reason, "reflog reason");
  if (keys.includes("uncontainedRevisions")) result.uncontainedRevisions = sortedUnique(
    value.uncontainedRevisions, item => oid(item, "uncontained reflog revision"), item => item,
    "uncontained reflog revisions",
  );
  return result;
}

function normalizePatch(value) {
  const keys = Object.hasOwn(value || {}, "localOnlyCount")
    ? ["status", "id", "advisory", "localOnlyCount", "accountedCount"]
    : ["status", "id", "advisory"];
  exact(value, keys, "branch patch advisory");
  const result = {
    status: oneOf(value.status, PATCH_STATES, "patch status"),
    id: nullableDigest(value.id, "patch digest"),
    advisory: oneOf(value.advisory, ["non-authoritative"], "patch authority"),
  };
  if (keys.includes("localOnlyCount")) {
    result.localOnlyCount = integer(value.localOnlyCount, "patch local-only count");
    result.accountedCount = integer(value.accountedCount, "patch accounted count");
  }
  return result;
}

function normalizeStash(value, oid) {
  const keys = [
    "revision", "selectors", "parents", "trees", "messageDigest", "deltas", "untrackedEntries",
    "bindings", "projection",
  ];
  if (Object.hasOwn(value || {}, "anatomy")) keys.push("anatomy");
  exact(value, keys, "stash");
  const result = {
    revision: oid(value.revision, "stash revision"),
    selectors: sortedUnique(value.selectors, item => text(item, "stash selector"), item => item, "stash selectors"),
    parents: array(value.parents, "stash parents").map(item => oid(item, "stash parent")),
    trees: normalizeStashTrees(value.trees, oid),
    messageDigest: digest(value.messageDigest, "stash message digest"),
    deltas: normalizeStashDeltas(value.deltas, oid),
    untrackedEntries: sortedUnique(
      value.untrackedEntries, normalizeTreeEntry, item => item.path, "stash untracked entries", oid,
    ),
    bindings: sortedUnique(value.bindings, normalizeBinding, item => `${item.kind}\0${item.id}`, "stash bindings"),
    projection: normalizeProjection(value.projection),
  };
  if (keys.includes("anatomy")) result.anatomy = normalizeAnatomy(value.anatomy);
  return result;
}

function normalizeStashTrees(value, oid) {
  exact(value, ["head", "index", "worktree", "untracked"], "stash trees");
  return { head: oid(value.head, "stash head tree"), index: oid(value.index, "stash index tree"),
    worktree: oid(value.worktree, "stash worktree tree"),
    untracked: value.untracked === null ? null : oid(value.untracked, "stash untracked tree") };
}

function normalizeStashDeltas(value, oid) {
  exact(value, ["headToIndex", "indexToWorktree", "headToWorktree"], "stash deltas");
  return { headToIndex: normalizeDelta(value.headToIndex, oid),
    indexToWorktree: normalizeDelta(value.indexToWorktree, oid),
    headToWorktree: normalizeDelta(value.headToWorktree, oid) };
}

function normalizeDelta(value, oid) {
  exact(value, ["digest", "entries"], "stash delta");
  const entries = sortedUnique(value.entries, (entry, nestedOid) => {
    exact(entry, ["path", "status", "oldMode", "oldOid", "newMode", "newOid"], "stash delta entry");
    return { path: byteText(entry.path, "stash path"), status: text(entry.status, "stash status"),
      oldMode: mode(entry.oldMode), oldOid: nestedOid(entry.oldOid, "old stash object", true),
      newMode: mode(entry.newMode), newOid: nestedOid(entry.newOid, "new stash object", true) };
  }, item => item.path, "stash delta paths", oid);
  if (value.digest !== digestValue(entries)) throw new Error("Stash delta digest is invalid.");
  return { digest: value.digest, entries };
}

function normalizeTreeEntry(value, oid) {
  exact(value, ["path", "mode", "oid"], "tree entry");
  return { path: byteText(value.path, "tree path"), mode: mode(value.mode), oid: oid(value.oid, "tree object") };
}

function normalizeBinding(value) {
  exact(value, ["kind", "id", "status"], "stash binding");
  return { kind: oneOf(value.kind, ["anchor", "lease"], "binding kind"),
    id: text(value.id, "binding identity"), status: text(value.status, "binding status") };
}

function normalizeProjection(value) {
  exact(value, ["status", "digest"], "stash projection");
  return { status: text(value.status, "projection status"), digest: nullableDigest(value.digest, "projection digest") };
}

function normalizeAnatomy(value) {
  exact(value, ["status", "reason"], "stash anatomy");
  return { status: text(value.status, "stash anatomy status"), reason: value.reason === null ? null : text(value.reason, "stash anatomy reason") };
}

function normalizeAnchor(value, oid) {
  exact(value, ["ref", "revision", "peeledRevision", "kind"], "recovery anchor");
  const anchorRef = ref(value.ref, "recovery anchor ref");
  if (!isDurableAnchorRef(anchorRef)) throw new Error("Recovery anchor ref is not in a durable namespace.");
  return { ref: anchorRef, revision: oid(value.revision, "anchor revision"),
    peeledRevision: oid(value.peeledRevision, "peeled anchor revision"), kind: text(value.kind, "anchor kind") };
}

function normalizeLeases(value, oid) {
  exact(value, ["schema", "revision", "digest", "entries"], "leases");
  return { schema: value.schema === null ? null : text(value.schema, "lease schema"),
    revision: value.revision === null ? null : integer(value.revision, "lease revision"),
    digest: nullableDigest(value.digest, "lease registry digest"),
    entries: sortedUnique(value.entries, item => {
      const keys = ["branchRef", "status", "leaseDigest", "authority"];
      const hasParkEvidence = Object.hasOwn(item || {}, "parkStashSha")
        || Object.hasOwn(item || {}, "parkStashStatus");
      if (hasParkEvidence) keys.push("parkStashSha", "parkStashStatus");
      exact(item, keys, "lease entry");
      const result = { branchRef: ref(item.branchRef, "lease branch"), status: text(item.status, "lease status"),
        leaseDigest: digest(item.leaseDigest, "lease digest"),
        authority: oneOf(item.authority, AUTHORITIES, "lease authority") };
      if (hasParkEvidence) {
        result.parkStashSha = item.parkStashSha === null ? null : oid(item.parkStashSha, "parked stash revision");
        result.parkStashStatus = item.parkStashStatus === null ? null : text(item.parkStashStatus, "parked stash status");
      }
      return result;
    }, item => item.branchRef, "lease entries") };
}

function normalizeProviderChange(value, oid) {
  exact(value, [
    "id", "provider", "state", "draft", "sourceRef", "sourceRevision", "targetRef",
    "integrationRevision", "complete", "sourceTree", "integrationTree", "integratedInComparison",
  ], "provider change");
  return { id: text(value.id, "provider change id"), provider: text(value.provider, "provider"),
    state: text(value.state, "provider state"), draft: boolean(value.draft, "provider draft"),
    sourceRef: ref(value.sourceRef, "provider source ref"), sourceRevision: oid(value.sourceRevision, "provider source revision"),
    targetRef: ref(value.targetRef, "provider target ref"),
    integrationRevision: value.integrationRevision === null ? null : oid(value.integrationRevision, "provider integration revision"),
    complete: boolean(value.complete, "provider completeness"),
    sourceTree: value.sourceTree === null ? null : oid(value.sourceTree, "provider source tree"),
    integrationTree: value.integrationTree === null ? null : oid(value.integrationTree, "provider integration tree"),
    integratedInComparison: boolean(value.integratedInComparison, "provider integration containment") };
}

function normalizeCompleteness(value) {
  exact(value, [
    "refs", "worktrees", "stashes", "recoveryAnchors", "leases", "providerChanges",
    "bounded", "corruptionFree", "raceFree", "reasons",
  ], "completeness");
  const result = {};
  for (const key of ["refs", "worktrees", "stashes", "recoveryAnchors", "leases", "providerChanges", "bounded", "corruptionFree", "raceFree"]) {
    result[key] = boolean(value[key], `completeness ${key}`);
  }
  result.reasons = sortedUnique(value.reasons, item => text(item, "completeness reason"), item => item, "completeness reasons");
  return result;
}

function normalizeFileObservation(value, label) {
  exact(value, ["present", "digest"], label);
  const present = boolean(value.present, `${label} present`);
  const observedDigest = nullableDigest(value.digest, `${label} digest`);
  if (present !== Boolean(observedDigest)) throw new Error(`${label} presence and digest disagree.`);
  return { present, digest: observedDigest };
}

function assertEvidenceJoins(evidence) {
  if (!evidence.comparison.stable
    || canonicalJson(evidence.comparison.frontierBefore) !== canonicalJson(evidence.comparison.frontierAfter)) {
    throw new Error("History evidence requires identical stable frontiers.");
  }
  if (evidence.comparison.frontierBefore.comparisonRevision !== evidence.comparison.revision) {
    throw new Error("History evidence comparison revision is not frontier-bound.");
  }
  if (evidence.comparison.remote && evidence.comparison.remote.revision !== evidence.comparison.revision) {
    throw new Error("History evidence requires exact local and remote comparison parity.");
  }
  const branches = new Map(evidence.branches.map(item => [item.ref, item]));
  if (evidence.comparison.ref.startsWith("refs/heads/")
    && branches.get(evidence.comparison.ref)?.revision !== evidence.comparison.revision) {
    throw new Error("Comparison branch is absent or revision-drifted.");
  }
  if (evidence.comparison.clean && !evidence.worktrees.some(item => item.path === evidence.repository.root
    && item.head === evidence.comparison.revision && item.branch === evidence.comparison.ref
    && !item.detached && !item.bare && !item.prunable)) {
    throw new Error("Clean comparison evidence is not bound to the exact root worktree.");
  }
  if (evidence.comparison.remote === null
    && evidence.branches.some(item => item.remoteRevision !== null)) {
    throw new Error("Remote branch evidence requires an explicit comparison remote.");
  }
  if (evidence.comparison.provider === null && evidence.providerChanges.length) {
    throw new Error("Provider change evidence requires an explicit provider observation.");
  }
  if (evidence.comparison.provider
    && evidence.providerChanges.some(item => item.provider !== evidence.comparison.provider.kind)) {
    throw new Error("Provider change evidence is mixed across provider identities.");
  }
  if (evidence.leases.schema === null && (evidence.leases.revision !== null
    || evidence.leases.digest !== null || evidence.leases.entries.length)) {
    throw new Error("Absent lease registry evidence cannot contain lease projections.");
  }
  for (const worktree of evidence.worktrees) {
    if (worktree.branch && !branches.has(worktree.branch) && !worktree.prunable) {
      throw new Error("Registered worktree branch is absent from local branch evidence.");
    }
    if (worktree.branch && branches.has(worktree.branch) && branches.get(worktree.branch).revision !== worktree.head) {
      throw new Error("Worktree and local branch revisions disagree.");
    }
  }
  const anchors = new Map(evidence.recoveryAnchors.map(item => [item.ref, item]));
  const leases = new Map(evidence.leases.entries.map(item => [item.branchRef, item]));
  for (const stash of evidence.stashes) {
    if (![2, 3].includes(stash.parents.length)) throw new Error("Stash parent anatomy is unsupported.");
    if (stash.parents.length === 2 && stash.trees.untracked !== null) throw new Error("Two-parent stash cannot carry an untracked tree.");
    if (stash.parents.length === 3 && stash.trees.untracked === null) throw new Error("Three-parent stash requires an untracked tree.");
    for (const binding of stash.bindings) {
      if (binding.kind === "anchor") {
        const anchor = anchors.get(binding.id);
        if (!anchor || anchor.peeledRevision !== stash.revision || binding.status !== "exact") {
          throw new Error("Stash anchor binding is not an exact peeled durable reference.");
        }
      } else {
        const lease = leases.get(binding.id);
        if (!lease || lease.parkStashSha !== stash.revision || lease.parkStashStatus !== binding.status) {
          throw new Error("Stash lease binding is absent or drifted from typed lease evidence.");
        }
      }
    }
  }
}

function classifyBranch(branch, evidence) {
  const reasons = [];
  const bound = evidence.worktrees.some(item => item.branch === branch.ref);
  const lease = evidence.leases.entries.find(item => item.branchRef === branch.ref);
  const providerTarget = evidence.comparison.remote?.ref || evidence.comparison.ref;
  const provider = evidence.completeness.providerChanges && evidence.providerChanges.find(change => change.complete && change.state === "merged"
    && change.sourceRef === branch.ref && change.sourceRevision === branch.revision
    && change.targetRef === providerTarget
    && change.provider === evidence.comparison.provider?.kind
    && change.sourceTree === branch.tree && change.integrationTree === branch.tree
    && change.integratedInComparison);
  let disposition;
  if (branch.ref === evidence.comparison.ref) disposition = "retain-comparison";
  else if (bound) disposition = "retain-worktree-bound";
  else if (lease?.authority === "nonterminal") disposition = "retain-nonterminal-authority";
  else if (lease?.authority === "unknown") disposition = "retain-unknown-authority";
  else if (branch.remoteRevision !== null) disposition = "retain-remote-present";
  else if (!coreHistoryComplete(evidence) || !branch.reflog.complete) disposition = "review-incomplete-evidence";
  else if ((branch.reflog.uncontainedRevisions || branch.reflog.uniqueRevisions).some(
    revision => revision !== branch.revision && revision !== evidence.comparison.revision,
  )) disposition = "review-reflog-history";
  else if (provider && remoteEvidenceComplete(evidence) && evidence.comparison.clean) {
    disposition = "archive-before-retirement";
  } else if (provider) disposition = "review-provider-converged";
  else if (branch.relationship === "ancestor") disposition = "review-history-contained";
  else if (branch.patch.status === "equivalent") disposition = "review-patch-equivalent";
  else disposition = "preserve-unique-or-unproven";
  if (provider) reasons.push(`provider:${provider.id}`);
  if (lease) reasons.push(`lease:${lease.status}`);
  reasons.push(`relationship:${branch.relationship}`);
  return freeze({ ref: branch.ref, revision: branch.revision, disposition, reasons: byteSort(reasons) });
}

function classifyStashes(stashes, evidence) {
  const payloadGroups = new Map();
  for (const stash of stashes) {
    const payload = digestValue({ trees: stash.trees, deltas: stash.deltas,
      untrackedEntries: stash.untrackedEntries });
    const group = payloadGroups.get(payload) || [];
    group.push(stash.revision); payloadGroups.set(payload, group);
  }
  return stashes.map(stash => {
    const anchorRefs = stash.bindings.filter(item => item.kind === "anchor" && item.status === "exact").map(item => item.id);
    const authority = stash.bindings.some(item => item.kind === "lease"
      && !["completed", "retired", "released"].includes(item.status));
    const payload = digestValue({ trees: stash.trees, deltas: stash.deltas,
      untrackedEntries: stash.untrackedEntries });
    const peers = payloadGroups.get(payload).filter(revision => revision !== stash.revision);
    let disposition = "preserve-unproven";
    if (!coreHistoryComplete(evidence) || (stash.anatomy && !["valid", "canonical"].includes(stash.anatomy.status))) {
      disposition = "review-incomplete-evidence";
    } else if (authority) disposition = "retain-nonterminal-authority";
    else if (anchorRefs.length) disposition = stash.selectors.length > 1
      ? "review-duplicate-selector" : "retain-durable-anchor";
    else if (peers.length) disposition = "archive-required-before-duplicate-review";
    else if (stash.deltas.headToIndex.entries.length || stash.untrackedEntries.length) {
      disposition = "preserve-staged-or-untracked";
    }
    return freeze({ revision: stash.revision, selectors: stash.selectors, disposition,
      reasons: byteSort([`projection:${stash.projection.status}`, peers.length ? "exact-payload-peer" : "unique-payload"]),
      anchorRefs: byteSort(anchorRefs), duplicateOf: peers[0] || null });
  });
}

function coreHistoryComplete(evidence) {
  return ["refs", "worktrees", "stashes", "recoveryAnchors", "leases", "bounded", "corruptionFree", "raceFree"]
    .every(key => evidence.completeness[key] === true)
    && !evidence.repository.shallow.present && !evidence.repository.grafts.present
    && evidence.repository.replaceRefs.length === 0;
}
function remoteEvidenceComplete(evidence) { return evidence.comparison.remote !== null; }

function countDispositions(items) {
  const counts = new Map();
  for (const item of items) counts.set(item.disposition, (counts.get(item.disposition) || 0) + 1);
  return byteSort([...counts].map(([disposition, count]) => ({ disposition, count })), item => item.disposition);
}

function sortedUnique(value, normalizer, key, label, context) {
  const items = array(value, label).map(item => normalizer(item, context));
  const sorted = byteSort(items, key);
  const keys = sorted.map(key);
  if (new Set(keys).size !== keys.length) throw new Error(`${label} contain duplicate identities.`);
  return sorted;
}

function array(value, label) { if (!Array.isArray(value)) throw new Error(`${label} must be an array.`); return value; }
function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(`${label} contains missing or unknown fields.`);
}
function text(value, label) { if (typeof value !== "string" || !value || value !== value.trim() || value.includes("\0")) throw new Error(`${label} must be exact non-empty text.`); return value; }
function byteText(value, label) { if (typeof value !== "string" || !value || value.includes("\0") || value.includes("\ufffd")) throw new Error(`${label} is not lossless UTF-8 text.`); return value; }
function absolutePath(value, label) { const result = byteText(value, label); if (!result.startsWith("/") && !/^[A-Za-z]:[\\/]/u.test(result) && !/^\\\\[^\\]+\\[^\\]+/u.test(result)) throw new Error(`${label} must be absolute.`); return result; }
function isDurableAnchorRef(value) { return value.startsWith("refs/heads/") || value.startsWith("refs/tags/") || value.startsWith("refs/original/") || /^refs\/agentic-canvas-os\/(?:history-retirement|parked|recovery|rescue)\//u.test(value); }
function ref(value, label) { const result = byteText(value, label); const parts = result.split("/"); if (!result.startsWith("refs/") || result.endsWith("/") || result.endsWith(".") || /[\u0000-\u0020\u007f~^:?*\\\[]/u.test(result) || result.includes("..") || result.includes("@{") || parts.some(part => !part || part === "." || part.endsWith(".lock"))) throw new Error(`${label} is invalid.`); return result; }
function mode(value) { if (typeof value !== "string" || !/^[0-7]{6}$/u.test(value)) throw new Error("Git mode is invalid."); return value; }
function boolean(value, label) { if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`); return value; }
function integer(value, label) { if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a nonnegative safe integer.`); return value; }
function oneOf(value, allowed, label) { if (!allowed.has?.(value) && !allowed.includes?.(value)) throw new Error(`${label} is invalid.`); return value; }
function digest(value, label) { if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be a SHA-256 digest.`); return value; }
function nullableDigest(value, label) { return value === null ? null : digest(value, label); }
function oidReader(format) { const pattern = format === "sha1" ? /^[0-9a-f]{40}$/u : /^[0-9a-f]{64}$/u; return (value, label, zero = false) => { const source = String(value); if (!pattern.test(source) && !(zero && /^0+$/.test(source) && source.length === (format === "sha1" ? 40 : 64))) throw new Error(`${label} is not a ${format} object identity.`); return source; }; }
function byteSort(values, key = item => item) { return [...values].sort((a, b) => Buffer.compare(Buffer.from(String(key(a)), "utf8"), Buffer.from(String(key(b)), "utf8"))); }
function freeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; }
