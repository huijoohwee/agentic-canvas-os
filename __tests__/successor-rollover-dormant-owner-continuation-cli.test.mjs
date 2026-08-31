import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  advanceDormantOwnerContinuationJournal,
  buildDormantOwnerContinuationPlan,
  createDormantOwnerContinuationJournal,
} from "../scripts/successor-rollover-dormant-owner-continuation-contract.mjs";
import {
  createDormantOwnerContinuationJournalStore,
  writePrivateContinuationJsonExclusive,
} from "../scripts/successor-rollover-dormant-owner-continuation-store.mjs";
import { main } from "../scripts/successor-rollover-dormant-owner-continuation.mjs";

test("CLI writes a private plan and consumes its exact run inputs", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "dormant-owner-cli-"));
  const repository = path.join(root, "repository");
  execFileSync("git", ["init", repository]);
  const output = path.join(root, "plan.json"), journal = path.join(root, "state.json");
  const common = [
    `--repository=${repository}`, "--session=session", "--pull-request=808",
    `--rollover-plan=${path.join(root, "rollover-plan.json")}`,
    `--rollover-journal=${path.join(root, "rollover-journal.json")}`,
    `--successor-promotion-journal=${path.join(root, "promotion.json")}`,
    `--controller-root=${repository}`, `--journal=${journal}`,
  ];
  const fakeStore = { read: () => null, write: value => value };
  const planned = await main(["plan", ...common, `--output=${output}`], {
    createAdapter: () => ({ captureEvidence: async () => evidence() }),
    createJournalStore: () => fakeStore,
  });
  assert.equal(planned.status, "authorization-required");
  assert.equal((await import("node:fs")).statSync(output).mode & 0o777, 0o600);
  const saved = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(saved.planDigest, planned.planDigest);
  chmodSync(output, 0o600);

  const result = await main([
    "run", ...common, `--plan=${output}`, `--task-authority=${path.join(root, "task.json")}`,
    `--authorization=${planned.requiredAuthorization}`,
  ], {
    createAdapter: () => ({}),
    createJournalStore: () => fakeStore,
    createController: () => ({ run: async ({ plan, authorization }) => ({
      planDigest: plan.planDigest,
      authorization,
    }) }),
  });
  assert.equal(result.status, "complete");
  assert.equal(result.result.planDigest, planned.planDigest);
  assert.equal(result.result.authorization, planned.requiredAuthorization);
});

test("CLI keeps task authority out of planning and output out of execution", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "dormant-owner-cli-options-"));
  const repository = path.join(root, "repository");
  execFileSync("git", ["init", repository]);
  const common = [
    `--repository=${repository}`, "--session=session", "--pull-request=808",
    `--rollover-plan=${path.join(root, "a")}`, `--rollover-journal=${path.join(root, "b")}`,
    `--successor-promotion-journal=${path.join(root, "c")}`,
    `--controller-root=${repository}`, `--journal=${path.join(root, "journal")}`,
  ];
  const dependencies = {
    createAdapter: () => ({ captureEvidence: async () => evidence() }),
    createJournalStore: () => ({ read: () => null, write: value => value }),
  };
  await assert.rejects(
    main(["plan", ...common, `--output=${path.join(root, "out")}`, `--task-authority=${path.join(root, "task")}`], dependencies),
    /plan does not accept/u,
  );
  await assert.rejects(
    main(["run", ...common, `--output=${path.join(root, "out")}`], dependencies),
    /run does not accept/u,
  );
});

test("run uses only the plan-sealed TTL and rejects a runtime override", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "dormant-owner-cli-ttl-"));
  const repository = path.join(root, "repository");
  execFileSync("git", ["init", repository]);
  const output = path.join(root, "plan.json");
  const common = [
    `--repository=${repository}`, "--session=session", "--pull-request=808",
    `--rollover-plan=${path.join(root, "a")}`, `--rollover-journal=${path.join(root, "b")}`,
    `--successor-promotion-journal=${path.join(root, "c")}`,
    `--controller-root=${repository}`, `--journal=${path.join(root, "journal")}`,
  ];
  const store = { read: () => null, write: value => value };
  const planned = await main(["plan", ...common, "--ttl-seconds=60", `--output=${output}`], {
    createAdapter: () => ({ captureEvidence: async () => evidence() }),
    createJournalStore: () => store,
  });
  await assert.rejects(
    main(["run", ...common, "--ttl-seconds=61", `--plan=${output}`,
      `--task-authority=${path.join(root, "task")}`,
      `--authorization=${planned.requiredAuthorization}`], {
      createAdapter: () => ({}), createJournalStore: () => store,
      createController: () => ({ run: async () => ({ status: "unexpected" }) }),
    }),
    /TTL.*plan/u,
  );
});

test("private paths resolve intermediate symlinks and exclude the controller repository", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "dormant-owner-cli-paths-"));
  const repository = path.join(root, "repository"), controller = path.join(root, "controller");
  execFileSync("git", ["init", repository]);
  execFileSync("git", ["init", controller]);
  mkdirSync(path.join(repository, "secret"));
  const alias = path.join(root, "alias");
  symlinkSync(repository, alias);
  assert.throws(
    () => writePrivateContinuationJsonExclusive(
      path.join(alias, "secret", "escaped.json"),
      { escaped: true },
      { forbiddenRoots: [repository] },
    ),
    /outside repositories/u,
  );
  const common = [
    `--repository=${repository}`, "--session=session", "--pull-request=808",
    `--rollover-plan=${path.join(root, "a")}`, `--rollover-journal=${path.join(root, "b")}`,
    `--successor-promotion-journal=${path.join(root, "c")}`,
    `--controller-root=${controller}`, `--journal=${path.join(root, "journal")}`,
  ];
  await assert.rejects(
    main(["plan", ...common, `--output=${path.join(controller, "plan.json")}`], {
      createAdapter: () => ({ captureEvidence: async () => evidence() }),
      createJournalStore: () => ({ read: () => null }),
    }),
    /outside repositories/u,
  );
});

test("journal compare-and-swap is fenced by an exclusive multiprocess lock", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "dormant-owner-store-cas-"));
  const journalPath = path.join(root, "journal.json");
  const store = createDormantOwnerContinuationJournalStore({ journalPath });
  const plan = buildDormantOwnerContinuationPlan({ evidence: evidence() });
  const initial = createDormantOwnerContinuationJournal(plan, plan.exactAuthorization);
  store.write(initial, null);
  const next = advanceDormantOwnerContinuationJournal(initial, "task-authority-verified", {
    taskAuthorityReceiptDigest: d("task"),
  });
  writeFileSync(`${journalPath}.lock`, "locked\n", { flag: "wx", mode: 0o600 });
  try {
    assert.throws(() => store.write(next, initial.journalDigest), /lock|compare-and-swap/u);
  } finally {
    rmSync(`${journalPath}.lock`, { force: true });
  }
});

function evidence() {
  const claimId = d("claim"), writeSetDigest = d("write set"), fenceSha = s("fence");
  const core = { schema: "agentic-successor-rollover-dormant-owner-continuation-evidence/v1",
    repository: "/repository", controllerRoot: "/controller",
    source: { branch: "agent/device/scope", sessionId: "session", worktreePath: "/repository",
      leaseDigest: d("lease"), claimId, claimDigest: d("claim digest"), transitionCounter: 2,
      localEpoch: 7, cloudLeaseEpoch: 1, baseSha: s("base"), fenceSha, writeSetDigest,
      manifestDigest: d("manifest"), reviewRequestId: "PR_test",
      taskAuthorityBindingDigest: d("binding"), expiresAt: "2026-01-01T00:00:00.000Z" },
    rollover: { continuationPlanDigest: d("continuation"), rolloverJournalDigest: d("journal"),
      replacementPlanDigest: d("replacement"), historicalBindProofDigest: d("history"),
      tombstoneDigest: d("tombstone"), tombstoneReceiptDigest: d("receipt") },
    promotion: { journalDigest: d("promotion"), resultDigest: d("result"),
      bridgeClaimId: d("bridge"), successorClaimId: d("successor") },
    pullRequest: { id: "PR_test", number: 808, url: "https://github.com/o/r/pull/808",
      state: "OPEN", isDraft: true, autoMergeRequest: null, headBranch: "agent/device/scope",
      headSha: fenceSha, baseSha: s("pr base"), etag: "\"e\"", bodyDigest: d("body"),
      bodyRemainderDigest: d("remainder"), markerDigest: d("marker"), markerClaimId: claimId },
    dirt: { evidenceDigest: d("dirt") }, controller: { evidenceDigest: d("controller") },
    cloud: { topologyDigest: d("topology"), anchorClaimId: claimId,
      anchorWriteSetDigest: writeSetDigest }, registryRevision: 9,
    observedAt: "2026-08-31T00:00:00.000Z" };
  return { ...core, evidenceDigest: digestValue(core) };
}
function d(value) { return digestValue({ value }); }
function s(value) { return d(value).slice(0, 40); }
