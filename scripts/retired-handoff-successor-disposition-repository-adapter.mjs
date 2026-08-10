// Responsibility: collect stable read-only provider evidence and durably journal one exact disposition subject.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync,
  renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateLedger } from "./cloud-collaboration-contract.mjs";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { DEFAULT_LEDGER_PATH, DEFAULT_LEDGER_REF } from "./github-cloud-collaboration-adapter.mjs";
import * as Contract from "./retired-handoff-successor-disposition-contract.mjs";
const ADAPTER_METHODS = Object.freeze(["withSubjectFence", "readEvidence", "readIntent",
  "writeIntent", "readReceipt", "writeReceipt"]);
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const INTENT_JOURNAL_SCHEMA = "agentic-retired-handoff-successor-disposition-intent-journal/v1";
const RECEIPT_JOURNAL_SCHEMA = "agentic-retired-handoff-successor-disposition-receipt-journal/v1";
const SUCCESSOR_MERGE_QUERY = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){mergeCommit{oid}}}}";
const RUNTIME_FILES = Object.freeze(["scripts/provider-scope-disposition.mjs",
  "scripts/retired-handoff-successor-disposition-contract.mjs", "scripts/retired-handoff-successor-disposition-controller.mjs",
  "scripts/retired-handoff-successor-disposition-repository-adapter.mjs", "scripts/retired-handoff-successor-disposition.mjs"]);
export function createRepositoryRetiredHandoffSuccessorDispositionAdapter({
  repository, controllerRoot, targetRepository, ledgerRepository, sourcePr, sourceClaimId, successorPr, portDecision = null,
  readers = {}, githubJson = null, githubGraphqlJson = null, gitText = null, gitAtText = null,
  controllerGitText = null, stateRoot = null, intentStore = null, now = () => new Date(),
} = {}) {
  const root = realpathSync(path.resolve(requiredText(repository, "repository")));
  const controller = realpathSync(path.resolve(requiredText(controllerRoot, "controller root")));
  const runtimeModuleRoot = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  if (controller !== runtimeModuleRoot) throw new Error("Disposition controller root must be the exact executing module root.");
  const target = requiredRepository(targetRepository, "target repository");
  const ledgerRepositoryName = requiredRepository(ledgerRepository, "ledger repository");
  const sourcePullNumber = positiveInteger(sourcePr, "source pull request");
  const successorPullNumber = positiveInteger(successorPr, "successor pull request");
  const claimId = requiredDigest(sourceClaimId, "source claim ID");
  const git = gitText || ((args, options = {}) => runGit(root, args, options));
  const gitAt = gitAtText || ((workingDirectory, args, options = {}) => runGit(workingDirectory, args, options));
  const controllerGit = controllerGitText || ((args, options = {}) => runGit(controller, args, options));
  const github = githubJson || createGitHubReader({ sourceRoot: root });
  const githubGraphql = githubGraphqlJson || createGitHubGraphqlReader({ sourceRoot: root });
  const commonDirectory = realpathSync(resolveCommonDirectory(root, git(["rev-parse", "--git-common-dir"])));
  const store = intentStore || createRetiredHandoffSuccessorDispositionIntentStore({ stateRoot:
    stateRoot || path.join(commonDirectory, "agentic-canvas-os", "provider-scope-dispositions"), now });
  const context = Object.freeze({
    claimId, commonDirectory, controllerGit, controllerRoot: controller, git, gitAt, github, githubGraphql,
    ledgerRepository: ledgerRepositoryName, root, runtimeModuleRoot, sourcePullNumber,
    successorPullNumber, targetRepository: target,
  });
  const live = Object.freeze({
    readRepository: readers.readRepository || (() => readRepositoryProjection(context)),
    readController: readers.readController || (() => readControllerProjection(context)),
    readLedger: readers.readLedger || (() => readLedgerProjection(context)),
    readSource: readers.readSource || (() => readSourceProjection(context)),
    readSuccessor: readers.readSuccessor || (() => readSuccessorProjection(context)),
    readLocal: readers.readLocal || (source => readLocalProjection(context, source)),
    readCommits: readers.readCommits || (pull => readFunctionalCommits(context, pull)),
  });
  requireReaders(live);
  return createAdapter({
    withSubjectFence: (fenceContext, callback) => store.withSubjectFence(fenceContext, callback),
    readIntent: subjectKey => store.readIntent(subjectKey),
    writeIntent: input => store.writeIntent(input),
    readReceipt: subjectKey => store.readReceipt(subjectKey),
    writeReceipt: input => store.writeReceipt(input),
    async readEvidence(readContext = {}) {
      const ledgerA = await live.readLedger();
      const [repositoryA, controllerA, sourceA, successorA] = await Promise.all(
        [live.readRepository(), live.readController(), live.readSource(), live.readSuccessor()]);
      const localA = await live.readLocal(sourceA);
      const [functionalSourceCommits, successorCommits] = await Promise.all([
        live.readCommits({ expectedHeadSha: sourceA.headSha, pullRequestNumber: sourcePullNumber }),
        live.readCommits({ expectedHeadSha: successorA.headSha, pullRequestNumber: successorPullNumber })]);
      const ledgerB = await live.readLedger();
      const [repositoryB, controllerB, sourceB, successorB] = await Promise.all(
        [live.readRepository(), live.readController(), live.readSource(), live.readSuccessor()]);
      const localB = await live.readLocal(sourceB);
      requireStable("repository identity", repositoryA, repositoryB);
      requireStable("controller source", controllerA, controllerB);
      requireStable("raw ledger ref/blob", ledgerA, ledgerB);
      requireStable("source provider subject", sourceA, sourceB);
      requireStable("successor provider subject", successorA, successorB);
      requireStable("local preservation", localA, localB);
      const evidenceCore = {
        schema: Contract.RETIRED_HANDOFF_SUCCESSOR_DISPOSITION_EVIDENCE_SCHEMA,
        provider: "github",
        repositoryId: requiredText(repositoryB.repositoryId, "repository ID"),
        controller: controllerB,
        ledger: { ...ledgerA.ledger, rereadRevision: ledgerB.ledger.revision,
          rereadBlobSha: ledgerB.ledger.blobSha, rereadRawDigest: ledgerB.ledger.rawDigest },
        claim: ledgerB.claim,
        source: sourceB,
        successor: successorB,
        local: localB,
        functionalSourceCommits,
        successorCommits,
      };
      const evidence = Contract.normalizeRetiredHandoffSuccessorDispositionEvidence(
        { ...evidenceCore, evidenceDigest: digestValue(evidenceCore) });
      const requestedDecision = Object.hasOwn(readContext, "portDecision")
        ? readContext.portDecision : portDecision;
      return Object.freeze({ evidence, portDecision: requestedDecision == null ? null : requestedDecision });
    },
  });
}
export function createRetiredHandoffSuccessorDispositionIntentStore({ stateRoot,
  now = () => new Date() } = {}) {
  const root = path.resolve(requiredText(stateRoot, "disposition state root"));
  const intentPath = key => path.join(root, "intents", `${requiredDigest(key, "subject key")}.json`);
  const receiptPath = key => path.join(root, "receipts", `${requiredDigest(key, "subject key")}.json`);
  const lockPath = (key, kind) => path.join(root, "locks",
    `${requiredDigest(key, "subject key")}.${kind}.lock`);
  function readIntent(subjectKey) {
    const stored = readJournal(intentPath(subjectKey), INTENT_JOURNAL_SCHEMA, subjectKey);
    if (!stored) return null;
    return Contract.normalizeRetiredHandoffSuccessorDispositionIntent(stored.value);
  }
  function writeIntent({ subjectKey, expectedIntent = null, nextIntent } = {}) {
    const key = requiredDigest(subjectKey, "subject key");
    const candidate = Contract.normalizeRetiredHandoffSuccessorDispositionIntent(nextIntent);
    if (candidate.subjectKey !== key) throw new Error("Disposition intent subject key drifted.");
    return withLock(lockPath(key, "intent-cas"), { operation: "intent-cas", subjectKey: key }, () => {
      const current = readIntent(key);
      if (valueDigest(current) !== valueDigest(expectedIntent)) {
        throw new Error("Disposition intent changed before compare-and-swap.");
      }
      writeJournalAtomic(intentPath(key), {
        schema: INTENT_JOURNAL_SCHEMA, subjectKey: key, value: candidate,
        valueDigest: digestValue(candidate), updatedAt: now().toISOString(),
      });
      return candidate;
    });
  }
  function readReceipt(subjectKey) {
    const stored = readJournal(receiptPath(subjectKey), RECEIPT_JOURNAL_SCHEMA, subjectKey);
    if (!stored) return null;
    return Contract.normalizeRetiredHandoffSuccessorDispositionReceipt(stored.value);
  }
  function writeReceipt({ subjectKey, expectedReceipt = null, nextReceipt } = {}) {
    const key = requiredDigest(subjectKey, "subject key");
    const candidate = Contract.normalizeRetiredHandoffSuccessorDispositionReceipt(nextReceipt);
    if (candidate.subjectKey !== key) throw new Error("Disposition receipt subject key drifted.");
    return withLock(lockPath(key, "receipt-cas"), { operation: "receipt-cas", subjectKey: key }, () => {
      const current = readReceipt(key);
      if (valueDigest(current) !== valueDigest(expectedReceipt)) {
        throw new Error("Disposition receipt changed before compare-and-swap.");
      }
      if (current && current.receiptDigest !== candidate.receiptDigest) {
        throw new Error("Immutable disposition receipt cannot be replaced.");
      }
      if (!current) writeJournalAtomic(receiptPath(key), {
        schema: RECEIPT_JOURNAL_SCHEMA, subjectKey: key, value: candidate,
        valueDigest: digestValue(candidate), updatedAt: now().toISOString(),
      });
      return current || candidate;
    });
  }
  async function withSubjectFence(fenceContext, callback) {
    const subjectKey = requiredDigest(fenceContext?.subjectKey, "fence subject key");
    if (typeof callback !== "function") throw new Error("Subject fence requires a callback.");
    const release = acquireLock(lockPath(subjectKey, "subject"), {
      operation: "subject", planDigest: fenceContext.planDigest, subjectKey,
    });
    try {
      return await callback(Object.freeze({
        acquiredAt: now().toISOString(),
        fenceDigest: digestValue({ root, subjectKey, planDigest: fenceContext.planDigest }),
      }));
    } finally { release(); }
  }
  return Object.freeze({ readIntent, readReceipt, root, withSubjectFence, writeIntent, writeReceipt });
}
function createAdapter(methods) {
  for (const name of ADAPTER_METHODS) {
    if (typeof methods[name] !== "function") throw new Error(`Disposition adapter requires ${name}().`);
  }
  return Object.freeze(Object.fromEntries(ADAPTER_METHODS.map(name => [name, methods[name]])));
}
async function readRepositoryProjection({ commonDirectory, git, github, root, targetRepository }) {
  const origin = requiredText(git(["remote", "get-url", "origin"]), "target origin URL");
  if (repositoryFromRemote(origin) !== targetRepository) {
    throw new Error("Target origin does not join the target repository.");
  }
  const rootRealpath = realpathSync(path.resolve(requiredText(
    git(["rev-parse", "--show-toplevel"]), "target top-level")));
  if (rootRealpath !== root) throw new Error("Target repository top-level does not join the configured root.");
  const commonDirectoryRealpath = realpathSync(resolveCommonDirectory(
    root, git(["rev-parse", "--git-common-dir"])));
  if (commonDirectoryRealpath !== commonDirectory) {
    throw new Error("Target git common directory changed after construction.");
  }
  const repository = await github(`repos/${targetRepository}`);
  if (requiredRepository(repository.full_name, "provider repository") !== targetRepository) {
    throw new Error("Provider repository identity drifted.");
  }
  return Object.freeze({ repositoryId: digestValue({
    schema: "agentic-target-repository-observation/v1", repository: targetRepository,
    providerRepositoryId: `github-repository:${requiredText(repository.node_id, "repository node ID")}`,
    rootRealpath, commonDirectoryRealpath, originUrlDigest: digestValue(origin.trim()),
  }) });
}
async function readControllerProjection({ controllerGit, controllerRoot, github,
  ledgerRepository, runtimeModuleRoot }) {
  const repository = repositoryFromRemote(controllerGit(["remote", "get-url", "origin"]));
  if (repository !== ledgerRepository) throw new Error("Controller origin does not join the ledger repository.");
  const headSha = requiredSha(controllerGit(["rev-parse", "HEAD"]), "controller HEAD");
  const headTreeSha = requiredSha(controllerGit(["rev-parse", "HEAD^{tree}"]), "controller HEAD tree");
  const mainSha = requiredSha(controllerGit(["rev-parse", "refs/heads/main"]), "controller main");
  const originMainSha = requiredSha(controllerGit(["rev-parse", "refs/remotes/origin/main"]), "controller origin/main");
  const remoteLine = requiredText(controllerGit(
    ["ls-remote", "--refs", "origin", "refs/heads/main"]), "remote main").split(/\s+/u);
  const remoteMainSha = requiredSha(remoteLine[0], "remote main SHA");
  const remoteCommit = await github(`repos/${repository}/git/commits/${remoteMainSha}`);
  const status = String(controllerGit(["status", "--porcelain=v1", "--untracked-files=all"]));
  const runtimeFiles = RUNTIME_FILES.map(file => ({ path: file, digest: createHash("sha256")
    .update(readFileSync(path.join(controllerRoot, file))).digest("hex") }));
  return Object.freeze({
    repository, rootRealpath: controllerRoot, runtimeModuleRootRealpath: runtimeModuleRoot,
    headSha, headTreeSha, mainSha, originMainSha, remoteMainSha,
    remoteMainTreeSha: requiredSha(remoteCommit.tree?.sha, "remote main tree SHA"),
    originUrlDigest: digestValue(String(controllerGit(["remote", "get-url", "origin"])).trim()),
    statusDigest: digestValue(status), clean: status === "", runtimeFileSetDigest: digestValue(runtimeFiles),
  });
}
async function readLedgerProjection({ claimId, github, ledgerRepository }) {
  const reference = await github(
    `repos/${ledgerRepository}/git/ref/heads/${encodeURIComponent(DEFAULT_LEDGER_REF)}`,
  );
  const revision = requiredSha(reference.object?.sha, "ledger ref revision");
  const metadata = await github(
    `repos/${ledgerRepository}/contents/${DEFAULT_LEDGER_PATH}?ref=${revision}`,
  );
  const blobSha = requiredSha(metadata.sha, "ledger blob SHA");
  const blob = await github(`repos/${ledgerRepository}/git/blobs/${blobSha}`);
  if (blob.encoding !== "base64" || !blob.content) throw new Error("Ledger blob is not complete base64 content.");
  const raw = Buffer.from(String(blob.content).replaceAll("\n", ""), "base64").toString("utf8");
  const ledger = JSON.parse(raw);
  const failures = validateLedger(ledger);
  if (failures.length > 0) throw new Error(`Raw collaboration ledger is invalid: ${failures.join("; ")}`);
  const entries = ledger.entries.filter(entry => entry.claimId === claimId);
  if (entries.length === 0) throw new Error("Raw collaboration ledger has no exact source claim.");
  const entry = entries.at(-1);
  const retirement = entry.claimCore?.retirement;
  const claim = Object.freeze({
    claimId: requiredDigest(entry.claimId, "claim ID"),
    claimDigest: requiredDigest(entry.claimDigest, "claim digest"),
    transitionDigest: requiredDigest(entry.digest, "claim transition digest"),
    transitionCounter: positiveInteger(entry.claimCore?.transitionCounter, "claim transition counter"),
    state: requiredText(entry.claimCore?.state, "claim state"),
    retirementReason: requiredText(retirement?.reason, "claim retirement reason"),
    finalRevision: requiredSha(retirement?.finalRevision, "claim final revision"),
    reviewRequestId: requiredText(retirement?.reviewRequestId, "claim review request ID"),
    handoffEvidenceDigest: requiredDigest(retirement?.handoffEvidenceDigest, "handoff evidence digest"),
    entryDigest: requiredDigest(entry.digest, "claim entry digest"),
  });
  return Object.freeze({
    ledger: Object.freeze({
      repository: ledgerRepository, revision, blobSha,
      rawDigest: createHash("sha256").update(raw).digest("hex"),
      digest: requiredDigest(ledger.headDigest, "ledger head digest"),
      sequence: positiveInteger(ledger.entries.at(-1)?.sequence, "ledger sequence"),
    }),
    claim,
  });
}
async function readSourceProjection({ claimId, github, sourcePullNumber, targetRepository }) {
  const pull = await github(`repos/${targetRepository}/pulls/${sourcePullNumber}`);
  requirePullRepository(pull, targetRepository, "source");
  const body = String(pull.body ?? "");
  const marker = readWriterLeaseMarker(body);
  if (marker.cloudAuthority?.claimId !== claimId) throw new Error("Source PR marker does not bind the exact claim.");
  const branch = requiredText(pull.head?.ref, "source branch");
  const remote = await github(
    `repos/${targetRepository}/git/ref/heads/${encodeURIComponent(branch)}`,
  );
  const headSha = requiredSha(pull.head?.sha, "source head SHA");
  return Object.freeze({
    repository: targetRepository,
    pullRequestNumber: positiveInteger(pull.number, "source pull request number"),
    pullRequestNodeId: requiredText(pull.node_id, "source pull request node ID"),
    state: requiredText(pull.state, "source pull request state").toUpperCase(),
    isDraft: pull.draft === true,
    branch,
    headSha,
    baseSha: requiredSha(pull.base?.sha, "source base SHA"),
    bodyDigest: digestValue(body),
    providerVersion: requiredText(pull.updated_at, "source provider version"),
    remoteHeadSha: requiredSha(remote.object?.sha, "source remote head SHA"),
    handoffMarkerFinalRevision: requiredSha(marker.cloudAuthority?.laneRevision || marker.fenceSha,
      "source handoff marker final revision"),
    retiredRevisionReachable: await compareContains(github, targetRepository,
      marker.cloudAuthority?.laneRevision || marker.fenceSha, headSha),
  });
}
async function readSuccessorProjection({ github, githubGraphql, successorPullNumber, targetRepository }) {
  const pull = await github(`repos/${targetRepository}/pulls/${successorPullNumber}`);
  requirePullRepository(pull, targetRepository, "successor");
  if (pull.merged !== true) throw new Error("Successor pull request must be merged.");
  const headSha = requiredSha(pull.head?.sha, "successor head SHA");
  const [owner, name] = targetRepository.split("/");
  const graph = await githubGraphql({ query: SUCCESSOR_MERGE_QUERY,
    variables: { owner, name, number: successorPullNumber } });
  const mergeCommitSha = requiredSha(graph.data?.repository?.pullRequest?.mergeCommit?.oid,
    "successor GraphQL merge commit SHA");
  if (pull.merge_commit_sha != null
    && requiredSha(pull.merge_commit_sha, "successor REST merge commit SHA") !== mergeCommitSha) {
    throw new Error("Successor REST and GraphQL merge commit SHAs differ.");
  }
  const main = await github(`repos/${targetRepository}/git/ref/heads/main`);
  const protectedMainSha = requiredSha(main.object?.sha, "protected main SHA");
  const protectedMainContainsMerge = await compareContains(github, targetRepository,
    mergeCommitSha, protectedMainSha);
  const required = await github(
    `repos/${targetRepository}/branches/main/protection/required_status_checks`,
  );
  const checkRuns = await readCompleteCheckRuns(github, targetRepository, headSha);
  const requiredChecks = normalizeRequiredChecks(required);
  requireSuccessfulChecks(requiredChecks, checkRuns);
  return Object.freeze({
    pullRequestNumber: positiveInteger(pull.number, "successor pull request number"),
    pullRequestNodeId: requiredText(pull.node_id, "successor pull request node ID"),
    state: "MERGED",
    branch: requiredText(pull.head?.ref, "successor branch"),
    headSha,
    mergeCommitSha,
    protectedMainSha,
    protectedMainContainsMerge,
    requiredChecksDigest: digestValue({ requiredChecks, checkRuns: projectCheckRuns(checkRuns) }),
  });
}
function readLocalProjection({ claimId, commonDirectory, git, gitAt }, source) {
  const ref = `refs/heads/${source.branch}`;
  const relevantShas = new Set([source.headSha, source.handoffMarkerFinalRevision]);
  const refs = lines(git(["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"]))
    .map(line => { const [name, sha] = line.split(" "); return { name, sha: requiredSha(sha, "local ref SHA") }; })
    .filter(localRef => localRef.name === ref || relevantShas.has(localRef.sha))
    .sort((left, right) => left.name.localeCompare(right.name));
  const worktrees = parseWorktrees(git(["worktree", "list", "--porcelain", "-z"]))
    .filter(record => record.branch === ref || relevantShas.has(record.head))
    .map(record => {
      const headSha = requiredSha(gitAt(record.path, ["rev-parse", "HEAD"]), "local worktree HEAD");
      if (headSha !== record.head) throw new Error("Local worktree HEAD changed during projection.");
      return Object.freeze({ path: record.path, branch: record.branch, registeredHeadSha: record.head,
        headSha, treeSha: requiredSha(gitAt(record.path, ["rev-parse", "HEAD^{tree}"]), "local worktree tree"),
        indexDigest: digestValue(gitAt(record.path, ["ls-files", "--stage", "-z"])),
        workingTreeDigest: digestValue(gitAt(record.path,
          ["status", "--porcelain=v1", "--untracked-files=all", "-z"])) });
    }).sort((left, right) => left.path.localeCompare(right.path));
  const registryPath = path.join(commonDirectory, "agentic-canvas-os", "writer-leases.json");
  const registry = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, "utf8")) : null;
  const leases = Object.values(registry?.leases || {}).filter(lease => (
    lease?.branch === source.branch || lease?.cloudAuthority?.claimId === claimId
  )).sort((left, right) => digestValue(left).localeCompare(digestValue(right)));
  const projection = { sourceBranch: source.branch, relevantShas: [...relevantShas].sort(), refs, worktrees, leases };
  return Object.freeze({ projectionDigest: digestValue(projection), worktreeCount: worktrees.length,
    branchPresent: refs.length > 0, leasePresent: leases.length > 0, cleanupEligible: false });
}
async function readFunctionalCommits({ git, github, targetRepository }, {
  expectedHeadSha, pullRequestNumber,
}) {
  const commits = await readCompletePullRequestCommits(github, targetRepository, pullRequestNumber);
  if (commits.at(-1)?.sha !== expectedHeadSha) throw new Error("Pull-request commit list drifted from its exact head.");
  const projected = [];
  for (const value of commits) {
    const sha = requiredSha(value.sha, "functional commit SHA");
    const parents = String(git(["show", "-s", "--format=%P", sha])).trim().split(/\s+/u).filter(Boolean);
    if (parents.length === 0) throw new Error(`Functional commit ${sha} has no parent.`);
    if (parents.length > 1) continue;
    const changedPaths = lines(git(["diff", "--name-only", "--no-renames", parents[0], sha, "--"]));
    if (changedPaths.length === 0) continue;
    const numstat = git(["diff", "--numstat", "--no-renames", parents[0], sha, "--"]);
    if (String(numstat).split("\n").some(line => line.startsWith("-\t-\t"))) {
      throw new Error(`Functional commit ${sha} contains binary changes.`);
    }
    const patch = git(["diff", "--full-index", "--no-ext-diff", "--no-renames", parents[0], sha, "--"]);
    const patchIdOutput = String(git(["patch-id", "--stable"], { input: patch })).trim();
    const stablePatchId = patchIdOutput.split(/\s+/u)[0];
    if (!/^[0-9a-f]{40}$/u.test(stablePatchId)) throw new Error(`Functional commit ${sha} has no stable patch identity.`);
    projected.push(Object.freeze({
      sha,
      patchId: stablePatchId,
      changedPathsDigest: digestValue([...new Set(changedPaths)].sort()),
    }));
  }
  return Object.freeze(projected);
}
async function readCompletePullRequestCommits(github, repository, pullRequestNumber) {
  const commits = [];
  for (let page = 1; page <= 30; page += 1) {
    const values = await github(
      `repos/${repository}/pulls/${pullRequestNumber}/commits?per_page=100&page=${page}`,
    );
    if (!Array.isArray(values)) throw new Error("Pull-request commit page is malformed.");
    commits.push(...values);
    if (values.length < 100) return commits;
  }
  throw new Error("Pull-request commits exceed the complete pagination bound.");
}
async function readCompleteCheckRuns(github, repository, sha) {
  const value = await github(`repos/${repository}/commits/${sha}/check-runs?filter=latest&per_page=100&page=1`);
  if (!Array.isArray(value.check_runs) || value.total_count !== value.check_runs.length) {
    throw new Error("Required check-run response is incomplete.");
  }
  return value.check_runs;
}
async function compareContains(github, repository, ancestor, descendant) {
  const value = await github(`repos/${repository}/compare/${requiredSha(ancestor, "ancestor SHA")}...${requiredSha(descendant, "descendant SHA")}`);
  if (!Array.isArray(value.commits) || value.total_commits !== value.commits.length) {
    throw new Error("Provider ancestry comparison is incomplete.");
  }
  return ["ahead", "identical"].includes(value.status);
}
function normalizeRequiredChecks(value) {
  const checks = (value.checks || []).map(check => ({
    context: requiredText(check.context, "required check context"),
    appId: check.app_id == null ? null : positiveInteger(check.app_id, "required check app ID"),
  }));
  const names = new Set(checks.map(check => check.context));
  for (const context of value.contexts || []) {
    if (!names.has(context)) checks.push({ context: requiredText(context, "required check context"), appId: null });
  }
  return checks.sort((left, right) => left.context.localeCompare(right.context));
}
function requireSuccessfulChecks(required, runs) {
  for (const check of required) {
    const found = runs.some(run => run.name === check.context
      && (check.appId == null || run.app?.id === check.appId)
      && run.status === "completed" && run.conclusion === "success");
    if (!found) throw new Error(`Successor required check ${check.context} is not successful.`);
  }
}
function projectCheckRuns(runs) {
  return runs.map(run => ({
    name: requiredText(run.name, "check-run name"),
    appId: run.app?.id ?? null,
    headSha: requiredSha(run.head_sha, "check-run head SHA"),
    status: requiredText(run.status, "check-run status"),
    conclusion: requiredText(run.conclusion, "check-run conclusion"),
  })).sort((left, right) => `${left.name}\0${left.appId}`.localeCompare(`${right.name}\0${right.appId}`));
}
function readWriterLeaseMarker(body) {
  const match = /<!--\s*agentic-writer-lease\/v2\s+(\{[\s\S]*?\})\s*-->/u.exec(body);
  if (!match) throw new Error("Source PR body has no exact writer lease marker.");
  const marker = JSON.parse(match[1]);
  if (marker.schema !== "agentic-writer-lease/v2") throw new Error("Source PR writer lease marker is malformed.");
  return marker;
}
function requirePullRepository(pull, repository, label) {
  if (pull.head?.repo?.full_name !== repository || pull.base?.repo?.full_name !== repository
    || pull.base?.ref !== "main") throw new Error(`${label} pull request is not same-repository against main.`);
}
function repositoryFromRemote(value) {
  const remote = requiredText(value, "controller origin URL").replace(/\.git$/u, "");
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/]+)$/u.exec(remote);
  if (!match) throw new Error("Controller origin must be a canonical GitHub repository URL.");
  return requiredRepository(match[1], "controller origin repository");
}
function parseWorktrees(value) {
  const records = [];
  let current = null;
  for (const field of String(value).split("\0")) {
    if (field.startsWith("worktree ")) {
      if (current) records.push(current);
      current = { path: field.slice(9), branch: null, head: null };
    } else if (current && field.startsWith("HEAD ")) current.head = requiredSha(field.slice(5), "registered worktree HEAD");
    else if (current && field.startsWith("branch ")) current.branch = field.slice(7);
  }
  if (current) records.push(current);
  return records;
}
function readJournal(filePath, schema, subjectKey) {
  if (!existsSync(filePath)) return null;
  requirePrivateMode(filePath);
  const stored = JSON.parse(readFileSync(filePath, "utf8"));
  if (stored?.schema !== schema || stored.subjectKey !== subjectKey
    || stored.valueDigest !== valueDigest(stored.value)) {
    throw new Error("Disposition journal is malformed or digest-invalid.");
  }
  return stored;
}
function writeJournalAtomic(filePath, value) {
  mkdirPrivate(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${process.hrtime.bigint()}.tmp`;
  let descriptor = null;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, filePath);
    syncDirectory(path.dirname(filePath));
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
function withLock(filePath, subject, callback) {
  const release = acquireLock(filePath, subject);
  try { return callback(); } finally { release(); }
}
function acquireLock(filePath, subject) {
  mkdirPrivate(path.dirname(filePath));
  const token = `${process.pid}:${Date.now()}:${process.hrtime.bigint()}`;
  try { return createOwnedLock(filePath, subject, token); }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  const owner = readLock(filePath);
  if (!owner) throw new Error("Disposition subject lock is malformed.");
  if (processIsAlive(owner.pid)) throw new Error("Disposition subject is already fenced.");
  if (readLock(filePath)?.token !== owner.token) throw new Error("Disposition subject lock changed during recovery.");
  const stalePath = `${filePath}.stale.${token}`;
  renameSync(filePath, stalePath);
  const release = createOwnedLock(filePath, subject, token);
  unlinkSync(stalePath);
  return release;
}
function createOwnedLock(filePath, subject, token) {
  const descriptor = openSync(filePath, "wx", 0o600);
  writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, subject, token })}\n`);
  fsyncSync(descriptor);
  return () => {
    closeSync(descriptor);
    if (readLock(filePath)?.token === token) unlinkSync(filePath);
  };
}
function readLock(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const value = JSON.parse(readFileSync(filePath, "utf8"));
    return Number.isSafeInteger(value.pid) && typeof value.token === "string" ? value : null;
  } catch { return null; }
}
function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}
function mkdirPrivate(directory) { mkdirSync(directory, { recursive: true, mode: 0o700 }); }
function syncDirectory(directory) {
  const descriptor = openSync(directory, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}
function requirePrivateMode(filePath) {
  const metadata = lstatSync(filePath);
  if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) throw new Error("Disposition journal must be a regular mode 0600 file.");
}
function createGitHubReader({ sourceRoot, execute = execFileSync }) {
  return async endpoint => JSON.parse(execute("gh", ["api", "-H", "Accept: application/vnd.github+json",
    "-H", "X-GitHub-Api-Version: 2026-03-10", endpoint], subprocess(sourceRoot)));
}
function createGitHubGraphqlReader({ sourceRoot, execute = execFileSync }) {
  return async ({ query, variables }) => JSON.parse(execute("gh", ["api", "graphql", "-f", `query=${query}`,
    ...Object.entries(variables).flatMap(([key, value]) => ["-F", `${key}=${value}`])], subprocess(sourceRoot)));
}
function runGit(cwd, args, options = {}) { return execFileSync("git", args, { ...subprocess(cwd), input: options.input }); }
function subprocess(cwd) { return { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }; }
function resolveCommonDirectory(root, value) { return path.resolve(root, requiredText(value, "git common directory")); }
function lines(value) { return String(value).split("\n").map(item => item.trim()).filter(Boolean); }
function requireStable(label, first, second) {
  if (digestValue(first) !== digestValue(second)) throw new Error(`${label} changed during evidence collection.`);
}
function requireReaders(readers) {
  for (const [name, reader] of Object.entries(readers)) {
    if (typeof reader !== "function") throw new Error(`Disposition evidence requires ${name}().`);
  }
}
function valueDigest(value) { return value == null ? null : digestValue(value); }
function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}
function requiredRepository(value, label) {
  const repository = requiredText(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) throw new Error(`${label} must be owner/name.`);
  return repository;
}
function requiredSha(value, label) {
  const sha = requiredText(value, label);
  if (!SHA_PATTERN.test(sha)) throw new Error(`${label} must be a 40-character SHA.`);
  return sha;
}
function requiredDigest(value, label) {
  const digest = requiredText(value, label);
  if (!DIGEST_PATTERN.test(digest)) throw new Error(`${label} must be a SHA-256 digest.`);
  return digest;
}
function positiveInteger(value, label) {
  const integer = Number(value);
  if (!Number.isSafeInteger(integer) || integer < 1) throw new Error(`${label} must be a positive integer.`);
  return integer;
}
