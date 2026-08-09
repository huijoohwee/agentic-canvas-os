// Responsibility: prove stable read composition and private subject-bound journal persistence.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import * as Contract from "../scripts/retired-handoff-successor-disposition-contract.mjs";
import {
  createRepositoryRetiredHandoffSuccessorDispositionAdapter,
  createRetiredHandoffSuccessorDispositionIntentStore,
} from "../scripts/retired-handoff-successor-disposition-repository-adapter.mjs";
const digest = character => character.repeat(64);
const sha = character => character.repeat(40);
const RUNTIME_ROOT = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
test("repository adapter rereads every mutable identity and returns one normalized bundle", async context => {
  const fixture = createEvidenceFixture();
  const temporaryRoot = temporaryDirectories(context);
  const calls = [];
  const readers = injectedReaders(fixture, calls);
  const adapter = createRepositoryRetiredHandoffSuccessorDispositionAdapter({
    repository: temporaryRoot.repository,
    controllerRoot: temporaryRoot.controller,
    targetRepository: fixture.evidence.source.repository,
    ledgerRepository: fixture.evidence.ledger.repository,
    sourcePr: 712,
    sourceClaimId: fixture.evidence.claim.claimId,
    successorPr: 742,
    portDecision: fixture.portDecision,
    readers,
    gitText: args => {
      assert.deepEqual(args, ["rev-parse", "--git-common-dir"]);
      return ".git";
    },
    stateRoot: path.join(temporaryRoot.root, "state"),
  });

  const bundle = await adapter.readEvidence({ operation: "plan" });
  assert.deepEqual(bundle.evidence, fixture.evidence);
  assert.deepEqual(bundle.portDecision, fixture.portDecision);
  assert.equal(calls.filter(call => call === "ledger").length, 2);
  assert.equal(calls.filter(call => call === "repository").length, 2);
  assert.equal(calls.filter(call => call === "controller").length, 2);
  assert.equal(calls.filter(call => call === "source").length, 2);
  assert.equal(calls.filter(call => call === "successor").length, 2);
  assert.equal(calls.filter(call => call === "local").length, 2);
  assert.deepEqual(calls.filter(call => call.startsWith("commits:")), [
    "commits:712", "commits:742",
  ]);
  assert.equal(typeof adapter.withSubjectFence, "function");
  assert.equal(typeof adapter.writeReceipt, "function");
});
test("adapter defers stale decision validation and honors an explicit null replay read", async context => {
  const fixture = createEvidenceFixture(); const temporaryRoot = temporaryDirectories(context);
  const readers = injectedReaders(fixture, []);
  readers.readSuccessor = () => ({ ...fixture.evidence.successor, protectedMainSha: sha("a") });
  const adapter = createRepositoryRetiredHandoffSuccessorDispositionAdapter({
    repository: temporaryRoot.repository, controllerRoot: RUNTIME_ROOT,
    targetRepository: "org/product", ledgerRepository: "org/ledger", sourcePr: 712,
    sourceClaimId: fixture.evidence.claim.claimId, successorPr: 742, portDecision: fixture.portDecision,
    readers, gitText: () => ".git", stateRoot: path.join(temporaryRoot.root, "stale-decision") });
  const stale = await adapter.readEvidence({});
  assert.deepEqual(stale.portDecision, fixture.portDecision);
  assert.notEqual(stale.evidence.evidenceDigest, fixture.evidence.evidenceDigest);
  assert.throws(() => Contract.buildRetiredHandoffSuccessorDispositionPlan(stale), /evidence binding/u);
  const replay = await adapter.readEvidence({ portDecision: null });
  assert.equal(replay.portDecision, null); assert.deepEqual(replay.evidence, stale.evidence);
});

test("constructor rejects a controller root distinct from the executing runtime", context => {
  const fixture = createEvidenceFixture();
  const temporaryRoot = temporaryDirectories(context);
  const wrongController = path.join(temporaryRoot.root, "wrong-controller");
  mkdirSync(wrongController);
  assert.throws(() => createRepositoryRetiredHandoffSuccessorDispositionAdapter({
    repository: temporaryRoot.repository,
    controllerRoot: wrongController,
    targetRepository: fixture.evidence.source.repository,
    ledgerRepository: fixture.evidence.ledger.repository,
    sourcePr: 712,
    sourceClaimId: fixture.evidence.claim.claimId,
    successorPr: 742,
    readers: injectedReaders(fixture, []),
    gitText: () => ".git",
  }), /exact executing module root/u);
});

test("production controller reader joins canonical origin and clean protected-main bytes", async context => {
  const fixture = createEvidenceFixture();
  const temporaryRoot = temporaryDirectories(context);
  const readers = injectedReaders(fixture, []);
  delete readers.readController;
  const gitCalls = [];
  const githubCalls = [];
  const controllerGitText = args => {
    gitCalls.push(args.join(" "));
    const key = args.join(" ");
    if (key === "remote get-url origin") return "git@github.com:org/ledger.git\n";
    if (key === "rev-parse HEAD") return `${sha("f")}\n`;
    if (key === "rev-parse HEAD^{tree}") return `${sha("e")}\n`;
    if (key === "rev-parse refs/heads/main") return `${sha("f")}\n`;
    if (key === "rev-parse refs/remotes/origin/main") return `${sha("f")}\n`;
    if (key === "ls-remote --refs origin refs/heads/main") {
      return `${sha("f")}\trefs/heads/main\n`;
    }
    if (key === "status --porcelain=v1 --untracked-files=all") return "";
    throw new Error(`Unexpected controller git call: ${key}`);
  };
  const adapter = createRepositoryRetiredHandoffSuccessorDispositionAdapter({
    repository: temporaryRoot.repository,
    controllerRoot: RUNTIME_ROOT,
    targetRepository: fixture.evidence.source.repository,
    ledgerRepository: fixture.evidence.ledger.repository,
    sourcePr: 712,
    sourceClaimId: fixture.evidence.claim.claimId,
    successorPr: 742,
    readers,
    githubJson: async endpoint => {
      githubCalls.push(endpoint);
      assert.equal(endpoint, `repos/org/ledger/git/commits/${sha("f")}`);
      return { tree: { sha: sha("e") } };
    },
    gitText: () => ".git",
    controllerGitText,
    stateRoot: path.join(temporaryRoot.root, "controller-state"),
  });
  const bundle = await adapter.readEvidence({});
  const files = [
    "scripts/provider-scope-disposition.mjs",
    "scripts/retired-handoff-successor-disposition-contract.mjs",
    "scripts/retired-handoff-successor-disposition-controller.mjs",
    "scripts/retired-handoff-successor-disposition-repository-adapter.mjs",
    "scripts/retired-handoff-successor-disposition.mjs",
  ].map(file => ({ path: file, digest: createHash("sha256")
    .update(readFileSync(path.join(RUNTIME_ROOT, file))).digest("hex") }));
  assert.equal(bundle.evidence.controller.repository, "org/ledger");
  assert.equal(bundle.evidence.controller.headSha, sha("f"));
  assert.equal(bundle.evidence.controller.remoteMainTreeSha, sha("e"));
  assert.equal(bundle.evidence.controller.runtimeFileSetDigest, digestValue(files));
  assert.equal(bundle.evidence.controller.clean, true);
  assert.equal(githubCalls.length, 2);
  assert.equal(gitCalls.filter(call => call === "remote get-url origin").length, 4);
});

test("production target reader binds provider, origin, top-level, and common-directory identity", async context => {
  const fixture = createEvidenceFixture();
  const temporaryRoot = temporaryDirectories(context);
  const readers = injectedReaders(fixture, []);
  delete readers.readRepository;
  const gitCalls = [];
  const gitText = args => {
    const key = args.join(" ");
    gitCalls.push(key);
    if (key === "rev-parse --git-common-dir") return ".git";
    if (key === "remote get-url origin") return "git@github.com:org/product.git\n";
    if (key === "rev-parse --show-toplevel") return `${temporaryRoot.repository}\n`;
    throw new Error(`Unexpected target git call: ${key}`);
  };
  const adapter = createRepositoryRetiredHandoffSuccessorDispositionAdapter({
    repository: temporaryRoot.repository, controllerRoot: RUNTIME_ROOT,
    targetRepository: "org/product", ledgerRepository: "org/ledger",
    sourcePr: 712, sourceClaimId: fixture.evidence.claim.claimId, successorPr: 742,
    readers, githubJson: async endpoint => {
      assert.equal(endpoint, "repos/org/product");
      return { full_name: "org/product", node_id: "R_product" };
    }, gitText, stateRoot: path.join(temporaryRoot.root, "target-state"),
  });
  const bundle = await adapter.readEvidence({});
  const commonDirectoryRealpath = realpathSync(path.join(temporaryRoot.repository, ".git"));
  assert.equal(bundle.evidence.repositoryId, digestValue({
    schema: "agentic-target-repository-observation/v1", repository: "org/product",
    providerRepositoryId: "github-repository:R_product",
    rootRealpath: realpathSync(temporaryRoot.repository), commonDirectoryRealpath,
    originUrlDigest: digestValue("git@github.com:org/product.git"),
  }));
  assert.equal(gitCalls.filter(call => call === "remote get-url origin").length, 2);
});

test("production target reader rejects origin, top-level, or common-directory mismatch", async context => {
  const fixture = createEvidenceFixture();
  const temporaryRoot = temporaryDirectories(context);
  const otherRoot = path.join(temporaryRoot.root, "other-root");
  const otherCommon = path.join(temporaryRoot.repository, ".git-other");
  mkdirSync(otherRoot); mkdirSync(otherCommon);
  for (const [name, values, pattern] of [
    ["origin", { origin: "git@github.com:other/product.git", top: temporaryRoot.repository,
      common: ".git" }, /Target origin/u],
    ["top", { origin: "git@github.com:org/product.git", top: otherRoot,
      common: ".git" }, /top-level/u],
    ["common", { origin: "git@github.com:org/product.git", top: temporaryRoot.repository,
      common: ".git-other" }, /common directory/u],
  ]) {
    const readers = injectedReaders(fixture, []); delete readers.readRepository;
    let commonReads = 0;
    const adapter = createRepositoryRetiredHandoffSuccessorDispositionAdapter({
      repository: temporaryRoot.repository, controllerRoot: RUNTIME_ROOT,
      targetRepository: "org/product", ledgerRepository: "org/ledger",
      sourcePr: 712, sourceClaimId: fixture.evidence.claim.claimId, successorPr: 742,
      readers, githubJson: async () => ({ full_name: "org/product", node_id: "R_product" }),
      gitText: args => {
        const key = args.join(" ");
        if (key === "rev-parse --git-common-dir") return commonReads++ === 0 ? ".git" : values.common;
        if (key === "remote get-url origin") return values.origin;
        if (key === "rev-parse --show-toplevel") return values.top;
        throw new Error(`Unexpected target git call: ${key}`);
      }, stateRoot: path.join(temporaryRoot.root, `mismatch-${name}`),
    });
    await assert.rejects(() => adapter.readEvidence({}), pattern);
  }
});

test("production successor reader accepts a GraphQL-only merge SHA and rejects REST disagreement", async context => {
  const fixture = createEvidenceFixture();
  const temporaryRoot = temporaryDirectories(context);
  const graphqlCalls = [];
  for (const [label, restMergeSha, errorPattern] of [
    ["rest-null", null, null], ["mismatch", sha("9"), /REST and GraphQL merge commit SHAs differ/u],
  ]) {
    const readers = injectedReaders(fixture, []); delete readers.readSuccessor;
    const adapter = createRepositoryRetiredHandoffSuccessorDispositionAdapter({
      repository: temporaryRoot.repository, controllerRoot: RUNTIME_ROOT,
      targetRepository: "org/product", ledgerRepository: "org/ledger",
      sourcePr: 712, sourceClaimId: fixture.evidence.claim.claimId, successorPr: 742, readers,
      githubJson: async endpoint => {
        if (endpoint === "repos/org/product/pulls/742") return {
          number: 742, node_id: "PR_successor", merged: true, merge_commit_sha: restMergeSha,
          head: { sha: sha("6"), ref: "agent/device/xr-successor", repo: { full_name: "org/product" } },
          base: { ref: "main", repo: { full_name: "org/product" } },
        };
        if (endpoint === "repos/org/product/git/ref/heads/main") return { object: { sha: sha("8") } };
        if (endpoint.includes("/compare/")) return { status: "ahead", total_commits: 0, commits: [] };
        if (endpoint.endsWith("/required_status_checks")) return { checks: [], contexts: [] };
        if (endpoint.includes("/check-runs?")) return { total_count: 0, check_runs: [] };
        throw new Error(`Unexpected successor GitHub read: ${endpoint}`);
      },
      githubGraphqlJson: async request => {
        graphqlCalls.push(request);
        return { data: { repository: { pullRequest: { mergeCommit: { oid: sha("7") } } } } };
      },
      gitText: () => ".git", stateRoot: path.join(temporaryRoot.root, `successor-${label}`),
    });
    if (errorPattern) await assert.rejects(() => adapter.readEvidence({}), errorPattern);
    else assert.equal((await adapter.readEvidence({})).evidence.successor.mergeCommitSha, sha("7"));
  }
  assert.equal(graphqlCalls.length, 3);
  for (const call of graphqlCalls) {
    assert.deepEqual(call.variables, { owner: "org", name: "product", number: 742 });
    assert.match(call.query, /pullRequest\(number:\$number\)\{mergeCommit\{oid\}\}/u);
  }
});

test("production commit reader excludes nonempty merges and retains one-parent functional commits", async context => {
  const fixture = createEvidenceFixture();
  const temporaryRoot = temporaryDirectories(context);
  const readers = injectedReaders(fixture, []);
  delete readers.readCommits;
  const gitCalls = [];
  const gitText = (args, options = {}) => {
    const key = args.join(" ");
    gitCalls.push(key);
    if (key === "rev-parse --git-common-dir") return ".git";
    if (key === `show -s --format=%P ${sha("3")}`) return sha("1");
    if (key === `show -s --format=%P ${sha("4")}`) return `${sha("3")} ${sha("2")}`;
    if (key === `show -s --format=%P ${sha("6")}`) return sha("5");
    if (key.startsWith("diff --name-only")) return "runtime.txt\n";
    if (key.startsWith("diff --numstat")) return "1\t0\truntime.txt\n";
    if (key.startsWith("diff --full-index")) return `diff --git a/runtime.txt b/runtime.txt\n${key}\n`;
    if (key === "patch-id --stable") {
      return `${String(options.input).includes(sha("3")) ? sha("a") : sha("c")} commit\n`;
    }
    throw new Error(`Unexpected target git call: ${key}`);
  };
  const adapter = createRepositoryRetiredHandoffSuccessorDispositionAdapter({
    repository: temporaryRoot.repository,
    controllerRoot: RUNTIME_ROOT,
    targetRepository: fixture.evidence.source.repository,
    ledgerRepository: fixture.evidence.ledger.repository,
    sourcePr: 712,
    sourceClaimId: fixture.evidence.claim.claimId,
    successorPr: 742,
    readers,
    githubJson: async endpoint => {
      if (endpoint.includes("/pulls/712/commits")) {
        return [{ sha: sha("3") }, { sha: sha("4") }];
      }
      if (endpoint.includes("/pulls/742/commits")) return [{ sha: sha("6") }];
      throw new Error(`Unexpected GitHub read: ${endpoint}`);
    },
    gitText,
    stateRoot: path.join(temporaryRoot.root, "commit-state"),
  });
  const bundle = await adapter.readEvidence({});
  assert.deepEqual(bundle.evidence.functionalSourceCommits.map(commit => commit.sha), [sha("3")]);
  assert.deepEqual(bundle.evidence.successorCommits.map(commit => commit.sha), [sha("6")]);
  assert.ok(!gitCalls.some(call => call.startsWith("diff ") && call.includes(sha("4"))),
    "merge commits must be excluded before any first-parent diff");
});

test("production local reader retains detached and renamed worktrees at either relevant revision", async context => {
  const fixture = createEvidenceFixture();
  const temporaryRoot = temporaryDirectories(context);
  const readers = injectedReaders(fixture, []); delete readers.readLocal;
  const detachedPath = path.join(temporaryRoot.root, "detached");
  const renamedPath = path.join(temporaryRoot.root, "renamed");
  const porcelain = `worktree ${detachedPath}\0HEAD ${sha("4")}\0detached\0\0`
    + `worktree ${renamedPath}\0HEAD ${sha("3")}\0branch refs/heads/renamed-source\0\0`;
  const adapter = createRepositoryRetiredHandoffSuccessorDispositionAdapter({
    repository: temporaryRoot.repository, controllerRoot: RUNTIME_ROOT,
    targetRepository: "org/product", ledgerRepository: "org/ledger",
    sourcePr: 712, sourceClaimId: fixture.evidence.claim.claimId, successorPr: 742,
    readers, gitText: args => {
      const key = args.join(" ");
      if (key === "rev-parse --git-common-dir") return ".git";
      if (key === "for-each-ref --format=%(refname) %(objectname) refs/heads") {
        return `refs/heads/renamed-source ${sha("4")}\n`;
      }
      if (key === "worktree list --porcelain -z") return porcelain;
      throw new Error(`Unexpected local git call: ${key}`);
    },
    gitAtText: (worktree, args) => {
      const key = args.join(" ");
      const head = worktree === detachedPath ? sha("4") : sha("3");
      if (key === "rev-parse HEAD") return head;
      if (key === "rev-parse HEAD^{tree}") return worktree === detachedPath ? sha("a") : sha("b");
      if (key === "ls-files --stage -z") return `100644 ${head} 0\truntime.txt\0`;
      if (key === "status --porcelain=v1 --untracked-files=all -z") return "";
      throw new Error(`Unexpected worktree git call: ${key}`);
    }, stateRoot: path.join(temporaryRoot.root, "local-state"),
  });
  const bundle = await adapter.readEvidence({});
  assert.equal(bundle.evidence.local.worktreeCount, 2);
  assert.equal(bundle.evidence.local.branchPresent, true);
  assert.equal(bundle.evidence.local.leasePresent, false);
});

test("production local reader detects a claim-bound lease after branch drift", async context => {
  const fixture = createEvidenceFixture();
  const temporaryRoot = temporaryDirectories(context);
  const registryDirectory = path.join(temporaryRoot.repository, ".git", "agentic-canvas-os");
  mkdirSync(registryDirectory, { recursive: true });
  writeFileSync(path.join(registryDirectory, "writer-leases.json"), JSON.stringify({
    schema: "agentic-writer-lease-registry/v2", revision: 1, leases: {
      drifted: { branch: "agent/device/renamed-away", status: "released",
        cloudAuthority: { claimId: fixture.evidence.claim.claimId } },
    },
  }));
  const readers = injectedReaders(fixture, []); delete readers.readLocal;
  const adapter = createRepositoryRetiredHandoffSuccessorDispositionAdapter({
    repository: temporaryRoot.repository, controllerRoot: RUNTIME_ROOT,
    targetRepository: "org/product", ledgerRepository: "org/ledger",
    sourcePr: 712, sourceClaimId: fixture.evidence.claim.claimId, successorPr: 742,
    readers, gitText: args => {
      const key = args.join(" ");
      if (key === "rev-parse --git-common-dir") return ".git";
      if (key === "for-each-ref --format=%(refname) %(objectname) refs/heads"
        || key === "worktree list --porcelain -z") return "";
      throw new Error(`Unexpected local git call: ${key}`);
    }, stateRoot: path.join(temporaryRoot.root, "lease-state"),
  });
  await assert.rejects(() => adapter.readEvidence({}), /evidence semantics are invalid/u);
});

test("repository adapter fails closed on A/B ledger, provider, or local drift", async context => {
  const fixture = createEvidenceFixture();
  const temporaryRoot = temporaryDirectories(context);
  for (const [label, override, pattern] of [
    ["ledger", { readLedger: alternating(
      ledgerReaderValue(fixture),
      { ...ledgerReaderValue(fixture), ledger: {
        ...ledgerReaderValue(fixture).ledger, rawDigest: digest("f"),
      } },
    ) }, /raw ledger ref\/blob changed/u],
    ["source", { readSource: alternating(
      fixture.evidence.source,
      { ...fixture.evidence.source, bodyDigest: digest("e") },
    ) }, /source provider subject changed/u],
    ["local", { readLocal: alternating(
      fixture.evidence.local,
      { ...fixture.evidence.local, projectionDigest: digest("d") },
    ) }, /local preservation changed/u],
  ]) {
    const readers = { ...injectedReaders(fixture, []), ...override };
    const adapter = createRepositoryRetiredHandoffSuccessorDispositionAdapter({
      repository: temporaryRoot.repository,
      controllerRoot: temporaryRoot.controller,
      targetRepository: fixture.evidence.source.repository,
      ledgerRepository: fixture.evidence.ledger.repository,
      sourcePr: 712,
      sourceClaimId: fixture.evidence.claim.claimId,
      successorPr: 742,
      readers,
      gitText: () => ".git",
      stateRoot: path.join(temporaryRoot.root, `state-${label}`),
    });
    await assert.rejects(() => adapter.readEvidence({}), pattern);
  }
});

test("intent and receipt journals use subject CAS, immutable replay, atomic 0600 files, and a distinct fence", async context => {
  const fixture = createEvidenceFixture();
  const plan = Contract.buildRetiredHandoffSuccessorDispositionPlan({
    evidence: fixture.evidence,
    portDecision: fixture.portDecision,
  });
  const authorizationReceipt = Contract.authorizeRetiredHandoffSuccessorDisposition({
    plan,
    authorization: plan.exactAuthorization,
  });
  const authorized = Contract.createRetiredHandoffSuccessorDispositionIntent({
    plan, authorizationReceipt,
  });
  const verified = Contract.advanceRetiredHandoffSuccessorDispositionIntent(authorized, {
    status: "verified",
    values: {
      operationKey: Contract.retiredHandoffSuccessorDispositionOperationKey({
        planDigest: plan.planDigest, subjectKey: plan.subjectKey, phase: "verified",
      }),
      evidenceDigest: plan.evidenceDigest,
    },
  });
  const receipt = Contract.buildRetiredHandoffSuccessorDispositionReceipt({
    plan, intent: verified, evidence: fixture.evidence,
  });
  const root = mkdtempSync(path.join(os.tmpdir(), "retired-handoff-store-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const store = createRetiredHandoffSuccessorDispositionIntentStore({
    stateRoot: root,
    now: () => new Date("2026-08-10T02:00:00.000Z"),
  });

  await store.withSubjectFence({
    subjectKey: plan.subjectKey, planDigest: plan.planDigest,
  }, async fence => {
    assert.match(fence.fenceDigest, /^[0-9a-f]{64}$/u);
    await assert.rejects(() => store.withSubjectFence({
      subjectKey: plan.subjectKey, planDigest: plan.planDigest,
    }, () => null), /already fenced/u);
    assert.deepEqual(store.writeIntent({
      subjectKey: plan.subjectKey, expectedIntent: null, nextIntent: authorized,
    }), authorized);
    assert.deepEqual(store.writeIntent({
      subjectKey: plan.subjectKey, expectedIntent: authorized, nextIntent: verified,
    }), verified);
    assert.deepEqual(store.writeReceipt({
      subjectKey: plan.subjectKey, expectedReceipt: null, nextReceipt: receipt,
    }), receipt);
    assert.deepEqual(store.writeReceipt({
      subjectKey: plan.subjectKey, expectedReceipt: receipt, nextReceipt: receipt,
    }), receipt);
  });

  assert.deepEqual(store.readIntent(plan.subjectKey), verified);
  assert.deepEqual(store.readReceipt(plan.subjectKey), receipt);
  assert.throws(() => store.writeIntent({
    subjectKey: plan.subjectKey, expectedIntent: null, nextIntent: verified,
  }), /changed before compare-and-swap/u);
  assert.throws(() => store.writeReceipt({
    subjectKey: plan.subjectKey, expectedReceipt: null, nextReceipt: receipt,
  }), /changed before compare-and-swap/u);
  const intentPath = path.join(root, "intents", `${plan.subjectKey}.json`);
  const receiptPath = path.join(root, "receipts", `${plan.subjectKey}.json`);
  assert.equal(statSync(intentPath).mode & 0o777, 0o600);
  assert.equal(statSync(receiptPath).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(path.join(root, "intents")), [`${plan.subjectKey}.json`]);
  assert.deepEqual(readdirSync(path.join(root, "receipts")), [`${plan.subjectKey}.json`]);
});

test("journals reject digest corruption and non-private persisted modes", context => {
  const fixture = createEvidenceFixture();
  const plan = Contract.buildRetiredHandoffSuccessorDispositionPlan({
    evidence: fixture.evidence, portDecision: fixture.portDecision,
  });
  const authorization = Contract.authorizeRetiredHandoffSuccessorDisposition({
    plan, authorization: plan.exactAuthorization,
  });
  const intent = Contract.createRetiredHandoffSuccessorDispositionIntent({
    plan, authorizationReceipt: authorization,
  });
  const root = mkdtempSync(path.join(os.tmpdir(), "retired-handoff-corruption-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const store = createRetiredHandoffSuccessorDispositionIntentStore({ stateRoot: root });
  store.writeIntent({ subjectKey: plan.subjectKey, expectedIntent: null, nextIntent: intent });
  const intentPath = path.join(root, "intents", `${plan.subjectKey}.json`);
  const journal = JSON.parse(readFileSync(intentPath, "utf8"));
  writeFileSync(intentPath, JSON.stringify({ ...journal, valueDigest: digest("f") }));
  assert.throws(() => store.readIntent(plan.subjectKey), /digest-invalid/u);
  writeFileSync(intentPath, JSON.stringify(journal));
  chmodSync(intentPath, 0o644);
  assert.throws(() => store.readIntent(plan.subjectKey), /mode 0600/u);
});

function createEvidenceFixture() {
  const ledger = {
    repository: "org/ledger", revision: sha("1"), blobSha: sha("2"),
    rawDigest: digest("1"), rereadRevision: sha("1"), rereadBlobSha: sha("2"),
    rereadRawDigest: digest("1"), digest: digest("2"), sequence: 1453,
  };
  const claim = {
    claimId: digest("3"), claimDigest: digest("4"), transitionDigest: digest("5"),
    transitionCounter: 4, state: "retired", retirementReason: "handoff",
    finalRevision: sha("3"), reviewRequestId: "github-pull-request:PR_source",
    handoffEvidenceDigest: digest("6"), entryDigest: digest("5"),
  };
  const source = {
    repository: "org/product", pullRequestNumber: 712,
    pullRequestNodeId: "PR_source", state: "OPEN", isDraft: true,
    branch: "agent/device/xr-source", headSha: sha("4"), baseSha: sha("5"),
    bodyDigest: digest("8"), providerVersion: "github-rest-2026-03-10",
    remoteHeadSha: sha("4"), handoffMarkerFinalRevision: sha("3"),
    retiredRevisionReachable: true,
  };
  const successor = {
    pullRequestNumber: 742, pullRequestNodeId: "PR_successor", state: "MERGED",
    branch: "agent/device/xr-successor", headSha: sha("6"), mergeCommitSha: sha("7"),
    protectedMainSha: sha("8"), protectedMainContainsMerge: true,
    requiredChecksDigest: digest("9"),
  };
  const local = {
    projectionDigest: digest("a"), worktreeCount: 0, branchPresent: false,
    leasePresent: false, cleanupEligible: false,
  };
  const controller = {
    repository: ledger.repository, rootRealpath: RUNTIME_ROOT,
    runtimeModuleRootRealpath: RUNTIME_ROOT, headSha: sha("f"), headTreeSha: sha("e"),
    mainSha: sha("f"), originMainSha: sha("f"), remoteMainSha: sha("f"),
    remoteMainTreeSha: sha("e"), originUrlDigest: digest("e"),
    statusDigest: digest("f"), clean: true, runtimeFileSetDigest: digest("0"),
  };
  const functionalSourceCommits = [
    { sha: sha("3"), patchId: sha("a"), changedPathsDigest: digest("b") },
    { sha: sha("4"), patchId: sha("b"), changedPathsDigest: digest("c") },
  ];
  const successorCommits = [
    { sha: sha("9"), patchId: sha("a"), changedPathsDigest: digest("b") },
    { sha: sha("6"), patchId: sha("c"), changedPathsDigest: digest("d") },
  ];
  const core = {
    schema: Contract.RETIRED_HANDOFF_SUCCESSOR_DISPOSITION_EVIDENCE_SCHEMA,
    provider: "github", repositoryId: "github-repository:R_fixture", controller,
    ledger, claim, source, successor, local, functionalSourceCommits, successorCommits,
  };
  const evidence = Contract.normalizeRetiredHandoffSuccessorDispositionEvidence({
    ...core, evidenceDigest: digestValue(core),
  });
  const decisionCore = {
    schema: Contract.RETIRED_HANDOFF_SUCCESSOR_PORT_DECISION_SCHEMA,
    evidenceDigest: evidence.evidenceDigest,
    entries: [
      { sourceCommitSha: sha("3"), kind: "patch-identical",
        successorCommitShas: [sha("9")], rationale: null },
      { sourceCommitSha: sha("4"), kind: "obsolete-by-successor",
        successorCommitShas: [], rationale: "The merged successor supersedes this refresh." },
    ],
  };
  const portDecision = Contract.normalizeRetiredHandoffSuccessorPortDecision({
    ...decisionCore, decisionDigest: digestValue(decisionCore),
  }, evidence);
  return { evidence, portDecision };
}

function ledgerReaderValue(fixture) {
  const { rereadRevision: _revision, rereadBlobSha: _blob,
    rereadRawDigest: _raw, ...ledger } = fixture.evidence.ledger;
  return { ledger, claim: fixture.evidence.claim };
}

function injectedReaders(fixture, calls) {
  return {
    readRepository() { calls.push("repository"); return { repositoryId: fixture.evidence.repositoryId }; },
    readController() { calls.push("controller"); return fixture.evidence.controller; },
    readLedger() { calls.push("ledger"); return ledgerReaderValue(fixture); },
    readSource() { calls.push("source"); return fixture.evidence.source; },
    readSuccessor() { calls.push("successor"); return fixture.evidence.successor; },
    readLocal() { calls.push("local"); return fixture.evidence.local; },
    readCommits({ pullRequestNumber }) {
      calls.push(`commits:${pullRequestNumber}`);
      return pullRequestNumber === 712
        ? fixture.evidence.functionalSourceCommits : fixture.evidence.successorCommits;
    },
  };
}

function alternating(first, second) {
  let count = 0;
  return () => count++ === 0 ? first : second;
}

function temporaryDirectories(context) {
  const root = mkdtempSync(path.join(os.tmpdir(), "retired-handoff-adapter-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository");
  mkdirSync(path.join(repository, ".git"), { recursive: true });
  return { controller: RUNTIME_ROOT, repository, root };
}
