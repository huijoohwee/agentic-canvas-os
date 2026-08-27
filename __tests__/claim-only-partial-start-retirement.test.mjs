// Responsibility: Prove the two exact-authorized claim-only transactions and private replay store.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  RETIREMENT_OPERATION,
  ROLLOVER_OPERATION,
  advanceClaimOnlyJournal,
  authorizeClaimOnlyPlan,
  buildClaimOnlyCompletionReceipt,
  buildClaimOnlyTerminalVerification,
  buildRetirementPlan,
  buildRolloverPlan,
  claimOnlyOperationKey,
  createClaimOnlyJournal,
  normalizeClaimOnlyCompletionReceipt,
  normalizeClaimOnlyJournal,
  normalizeClaimOnlyPlan,
  startClaimOnlyJournal,
} from "../scripts/claim-only-partial-start-retirement-contract.mjs";
import {
  captureClaimOnlyRepositoryIdentity,
  claimOnlyRetirementRequestDigest,
  createClaimOnlyPartialStartRetirementStore,
  readClaimOnlyPrivateJson,
} from "../scripts/claim-only-partial-start-retirement-store.mjs";
import { createClaimOnlyPartialStartRetirementController,
  validateClaimOnlyReplacementTerminal, validateClaimOnlyRetirementTerminal }
  from "../scripts/claim-only-partial-start-retirement-controller.mjs";
import { main as claimOnlyCliMain }
  from "../scripts/claim-only-partial-start-retirement.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
const digest = character => String(character).repeat(64);
const sha = character => character.repeat(40);
const SOURCE_ID = digest("1");
const SUCCESSOR_ID = digest("2");
const BASE = sha("a");
const MAIN = sha("b");
const SCOPE = Object.freeze([
  "path:__tests__/active-dirty-scope-expansion-repository-adapter.test.mjs",
  "path:scripts/active-dirty-scope-expansion-controller.mjs",
]);
test("retirement plan seals the exact inert source and waiting successor", () => {
  const plan = buildRetirementPlan(retirementEvidence());
  assert.equal(plan.operation, RETIREMENT_OPERATION);
  assert.equal(plan.evidence.source.claimId, SOURCE_ID);
  assert.equal(plan.evidence.successor.claimId, SUCCESSOR_ID);
  assert.equal(plan.exactAuthorization, `authorize claim-only-partial-start-retirement ${plan.planDigest}`);
  assert.deepEqual(normalizeClaimOnlyPlan(plan), plan);
  assert.equal(authorizeClaimOnlyPlan(plan, plan.exactAuthorization).length, 64);
  assert.throws(() => authorizeClaimOnlyPlan(plan, "APPROVE retirement"), /Exact authorization required/u);
  assert.throws(() => normalizeClaimOnlyPlan({ ...plan, action: "broader-effect" }), /plan drift/u);
});
test("retirement rejects a non-genesis source or an associated local projection", () => {
  const heartbeat = retirementEvidence();
  heartbeat.source.heartbeatCounter = 1;
  assert.throws(() => buildRetirementPlan(heartbeat), /genesis claim-only source/u);
  const association = retirementEvidence();
  association.associations.sourceRegistryMatches.push("branch:owned");
  assert.throws(() => buildRetirementPlan(association), /bound projection association/u);
  const queue = retirementEvidence();
  queue.overlap.higherPriorityWaitingClaimIds.push(digest("9"));
  assert.throws(() => buildRetirementPlan(queue), /overlap cardinality or priority/u);
});
test("source and direct successor require one exact owner, repository, work item, and scope", () => {
  const drifts = [["actorId", "github-user:2"], ["repositoryId", "github-repository:fork"], ["workItemId", "work-item:foreign"], ["deviceId", "device:other"], ["sessionId", "session:other"], ["writeSetDigest", digest("f")]];
  for (const [field, value] of drifts) { const evidence = retirementEvidence(); evidence.successor[field] = value; assert.throws(() => buildRetirementPlan(evidence), /source\/successor|write-set/u, field);
  }
  const scope = retirementEvidence(); scope.successor.declaredWriteScope = ["path:foreign"];
  scope.successor.writeSetDigest = digestValue(scope.successor.declaredWriteScope);
  assert.throws(() => buildRetirementPlan(scope), /declared write scope|writeSetDigest/u);
});
test("retirement journal is ordered, sealed, and emits a terminal receipt", () => {
  const plan = buildRetirementPlan(retirementEvidence());
  let journal = createClaimOnlyJournal(plan);
  assert.equal(journal.state, null);
  assert.throws(() => advanceClaimOnlyJournal(journal, "prepared", {}), /not authorized/u);
  journal = startClaimOnlyJournal(journal, plan.exactAuthorization);
  assert.throws(() => advanceClaimOnlyJournal(journal, "verified", { terminalEvidenceDigest: digest("3"), preservationDigest: digest("4"),
  }), /cannot advance/u);
  journal = advanceClaimOnlyJournal(journal, "prepared", { operationKey: claimOnlyOperationKey(plan, "prepared"), freshFrameDigest: digest("3"),
  });
  journal = advanceClaimOnlyJournal(journal, "source-retired", { operationKey: claimOnlyOperationKey(plan, "source-retired"), requestDigest: claimOnlyRetirementRequestDigest(plan, plan.evidence.source, "source-retired"), operationReceiptDigest: digest("4"), terminalEntryDigest: digest("5"), disposition: "projected", cloudMutation: true,
  });
  journal = advanceClaimOnlyJournal(journal, "verified", buildClaimOnlyTerminalVerification(journal));
  const receipt = buildClaimOnlyCompletionReceipt(journal);
  assert.equal(receipt.operation, RETIREMENT_OPERATION);
  assert.equal(receipt.cloudRetirementReceiptDigest, digest("4"));
  assert.equal(receipt.preservation.writerRegistry, "unchanged");
  assert.deepEqual(normalizeClaimOnlyCompletionReceipt(receipt), receipt);
  const complete = advanceClaimOnlyJournal(journal, "complete", { receipt });
  assert.equal(normalizeClaimOnlyJournal(complete).state.phase, "complete");
  assert.throws(() => normalizeClaimOnlyJournal({ ...complete, journalDigest: digest("0") }), /journal seal/u);
});
test("rollover binds protected-main ancestry and an epoch-2 replacement", () => {
  const retirement = completedRetirement();
  const evidence = rolloverEvidence(retirement.receipt);
  const plan = buildRolloverPlan(evidence);
  assert.equal(plan.operation, ROLLOVER_OPERATION);
  assert.equal(plan.evidence.replacement.leaseEpoch, 2);
  assert.equal(plan.evidence.replacement.canonicalBaseRevision, MAIN);
  assert.equal(plan.exactAuthorization, `authorize claim-only-successor-rollover ${plan.planDigest}`);
  const staleProof = rolloverEvidence(retirement.receipt);
  staleProof.canonical.canonicalDescendantProof.canonicalChangedPaths = ["docs/drift.md"];
  assert.throws(() => buildRolloverPlan(staleProof), /canonicalDescendantProof/u);
  const wrongEpoch = rolloverEvidence(retirement.receipt);
  wrongEpoch.replacement.leaseEpoch = 3;
  assert.throws(() => buildRolloverPlan(wrongEpoch), /replacement identity/u);
});
test("rollover rejects forged source-retirement entry and resealed receipt joins", () => {
  const completed = completedRetirement();
  for (const mutate of [ value => { value.retirement.sourceTerminalEntry.retirement.reason = "abandoned"; }, value => { value.retirement.sourceTerminalEntry.retirement.finalRevision = MAIN; }, value => { value.retirement.sourceTerminalEntry.retirement.bytesDigest = digest("f"); }, value => { value.retirement.sourceTerminalEntry.idempotencyKey = digest("f"); },
  ]) { const evidence = rolloverEvidence(completed.receipt); mutate(evidence); assert.throws(() => buildRolloverPlan(evidence), /source terminal entry|lineage/u);
  }
  const forged = rolloverEvidence(completed.receipt);
  forged.retirement.receipt = structuredClone(forged.retirement.receipt);
  forged.retirement.receipt.cloudRetirementRequestDigest = digest("f");
  const receiptCore = { ...forged.retirement.receipt }; delete receiptCore.receiptDigest;
  forged.retirement.receipt.receiptDigest = digestValue(receiptCore);
  assert.throws(() => buildRolloverPlan(forged), /source retirement lineage/u);
});
test("rollover receipt binds stale retirement, raw output, and new authority", () => {
  const retirement = completedRetirement();
  const plan = buildRolloverPlan(rolloverEvidence(retirement.receipt));
  let journal = startClaimOnlyJournal(createClaimOnlyJournal(plan), plan.exactAuthorization);
  journal = advanceClaimOnlyJournal(journal, "prepared", { operationKey: claimOnlyOperationKey(plan, "prepared"), freshFrameDigest: digest("3"),
  });
  journal = advanceClaimOnlyJournal(journal, "stale-successor-retired", { operationKey: claimOnlyOperationKey(plan, "stale-successor-retired"), requestDigest: claimOnlyRetirementRequestDigest(plan, plan.evidence.successor, "stale-successor-retired"), operationReceiptDigest: digest("4"), terminalEntryDigest: digest("5"), disposition: "adopted", cloudMutation: true,
  });
  journal = advanceClaimOnlyJournal(journal, "replacement-claimed", { operationKey: claimOnlyOperationKey(plan, "replacement-claimed"), requestDigest: digest("5"), operationReceiptDigest: digest("6"), terminalEntryDigest: digest("7"), replacementClaimId: plan.evidence.replacement.expectedClaimId, rawClaimResultDigest: digest("8"), outputReceiptDigest: digest("9"), authorityDigest: digest("a"), disposition: "projected", cloudMutation: true,
  });
  journal = advanceClaimOnlyJournal(journal, "verified", buildClaimOnlyTerminalVerification(journal));
  const receipt = buildClaimOnlyCompletionReceipt(journal);
  assert.equal(receipt.sourceRetirementReceiptDigest, retirement.receipt.receiptDigest);
  assert.equal(receipt.replacementClaimId, plan.evidence.replacement.expectedClaimId);
  assert.equal(receipt.rawClaimResultDigest, digest("8"));
  assert.equal(receipt.claimOutputReceiptDigest, digest("9"));
  assert.deepEqual(normalizeClaimOnlyCompletionReceipt(receipt), receipt);
});
test("private store uses exact CAS and preserves raw claim output byte content", async t => {
  const root = await mkdtemp(path.join(path.dirname(process.cwd()), ".claim-only-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const statePath = path.join(root, "journal.json");
  const outputPath = path.join(root, "claim-output.json");
  const store = createClaimOnlyPartialStartRetirementStore({ statePath, claimOutputPath: outputPath });
  const plan = buildRetirementPlan(retirementEvidence());
  const first = createClaimOnlyJournal(plan);
  const second = startClaimOnlyJournal(first, plan.exactAuthorization);
  assert.equal(store.readJournal(), null);
  assert.deepEqual(store.writeJournal({ expected: null, next: first }), first);
  assert.deepEqual(store.writeJournal({ expected: first, next: second }), second);
  assert.throws(() => store.writeJournal({ expected: first, next: second }), /changed before its exact compare-and-swap/u);
  assert.deepEqual(readClaimOnlyPrivateJson(statePath), second);
  const raw = { schema: "agentic-cloud-collaboration-result/v1", ok: true, action: "claim", claim: { claimId: digest("d") } };
  assert.deepEqual(store.writeClaimOutput(raw), raw);
  assert.deepEqual(store.writeClaimOutput(raw), raw);
  assert.throws(() => store.writeClaimOutput({ ...raw, ok: false }), /different result/u);
  assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), raw);
});
test("private store rejects broad permissions and symlink traversal", async t => {
  const root = await mkdtemp(path.join(path.dirname(process.cwd()), ".claim-only-private-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const broad = path.join(root, "broad");
  mkdirSync(broad, { mode: 0o755 });
  chmodSync(broad, 0o755);
  const broadStore = createClaimOnlyPartialStartRetirementStore({ statePath: path.join(broad, "journal.json"),
  });
  await assert.rejects(() => broadStore.withOperationLock({}, async () => null), /mode 0700/u);
  const target = path.join(root, "target");
  mkdirSync(target, { mode: 0o700 });
  const link = path.join(root, "link");
  symlinkSync(target, link);
  assert.throws(() => createClaimOnlyPartialStartRetirementStore({ statePath: path.join(link, "journal.json"),
  }), /symbolic link/u);
});
test("controller converges source retirement once and terminal replay is effect-free", async () => {
  const fake = fakeAdapter({ retirement: retirementEvidence() });
  const controller = createClaimOnlyPartialStartRetirementController({ adapter: fake.adapter });
  const plan = await controller.planRetirement();
  await assert.rejects(() => controller.runRetirement({ planDigest: plan.planDigest, authorization: "APPROVE" }), /Exact authorization required/u);
  const first = await controller.runRetirement({ planDigest: plan.planDigest, authorization: plan.exactAuthorization });
  const replay = await controller.runRetirement({ planDigest: plan.planDigest, authorization: plan.exactAuthorization });
  assert.equal(first.operation, RETIREMENT_OPERATION);
  assert.deepEqual(replay, first);
  assert.equal(fake.calls.retireSource, 1);
  assert.equal(fake.calls.claimReplacement, 0);
  assert.equal(fake.journal().state.phase, "complete");
});
test("controller adopts source-retirement response loss only after classification", async () => {
  const fake = fakeAdapter({ retirement: retirementEvidence(), failSourceResponse: true });
  const controller = createClaimOnlyPartialStartRetirementController({ adapter: fake.adapter });
  const plan = await controller.planRetirement();
  const receipt = await controller.runRetirement({ planDigest: plan.planDigest, authorization: plan.exactAuthorization });
  assert.equal(receipt.status, "complete");
  assert.equal(fake.calls.retireSource, 1);
  assert.equal(fake.journal().state.receipts["source-retired"].disposition, "adopted");
});
test("controller orders stale-successor retirement before one replacement claim", async () => {
  const retirement = completedRetirement();
  const fake = fakeAdapter({ rollover: rolloverEvidence(retirement.receipt) });
  const controller = createClaimOnlyPartialStartRetirementController({ adapter: fake.adapter });
  const plan = await controller.planRollover();
  const receipt = await controller.runRollover({ planDigest: plan.planDigest, authorization: plan.exactAuthorization });
  assert.equal(receipt.operation, ROLLOVER_OPERATION);
  assert.deepEqual(fake.calls.order, ["retire-stale", "claim-replacement"]);
  assert.equal(fake.calls.retireStaleSuccessor, 1);
  assert.equal(fake.calls.claimReplacement, 1);
  assert.equal(receipt.replacementClaimId, plan.evidence.replacement.expectedClaimId);
});
test("rollover preflight failure happens before either cloud effect", async () => {
  const retirement = completedRetirement();
  const fake = fakeAdapter({ rollover: rolloverEvidence(retirement.receipt), failPrepare: true });
  const controller = createClaimOnlyPartialStartRetirementController({ adapter: fake.adapter });
  const plan = await controller.planRollover();
  await assert.rejects(() => controller.runRollover({ planDigest: plan.planDigest, authorization: plan.exactAuthorization }), /simulated C3 preflight block/u);
  assert.deepEqual(fake.calls.order, []);
  assert.equal(fake.journal().state.phase, "authorized");
});
test("retirement terminal validator accepts both phases and rejects forged response-loss evidence", () => {
  const sourcePlan = buildRetirementPlan(retirementEvidence());
  const rollover = completedRetirement();
  const stalePlan = buildRolloverPlan(rolloverEvidence(rollover.receipt));
  for (const [plan, subject, phase] of [[sourcePlan, sourcePlan.evidence.source, "source-retired"], [stalePlan, stalePlan.evidence.successor, "stale-successor-retired"]]) { const entry = rawRetirementEntry(plan, subject, phase); const input = { entry, plan, claim: subject, phase, operationKey: claimOnlyOperationKey(plan, phase) }; assert.equal(validateClaimOnlyRetirementTerminal(input).terminalEntryDigest, entry.digest); assert.equal(validateClaimOnlyRetirementTerminal({ ...input, result: retirementResult(entry) }).operationReceiptDigest, operationReceipt(entry).receiptDigest); for (const mutate of [value => { value.retirement.reason = "abandoned"; }, value => { value.retirement.finalRevision = MAIN; }, value => { value.retirement.namedChecksDigest = digest("f"); }, value => { value.retirement.handoffEvidenceDigest = digest("e"); }]) { const forged = structuredClone(entry); mutate(forged.claimCore); resealEntry(forged); assert.throws(() => validateClaimOnlyRetirementTerminal({ ...input, entry: forged }), /terminal semantics/u); } for (const field of ["idempotencyKey", "requestDigest"]) { const foreign = structuredClone(entry); foreign[field] = digest("f"); resealEntry(foreign); assert.throws(() => validateClaimOnlyRetirementTerminal({ ...input, entry: foreign }), /terminal semantics/u); } const bad = retirementResult(entry); bad.operationReceipt.receiptDigest = digest("f"); assert.throws(() => validateClaimOnlyRetirementTerminal({ ...input, result: bad }), /operation result/u);
  }
});
test("replacement classifier joins the raw claim result to its exact ledger entry", () => {
  const completed = completedRetirement();
  const plan = buildRolloverPlan(rolloverEvidence(completed.receipt));
  const exact = rawReplacement(plan), key = claimOnlyOperationKey(plan, "replacement-claimed");
  assert.equal(validateClaimOnlyReplacementTerminal(exact.frame, plan, key,
    exact.result).digest, exact.entry.digest);
  const foreign = structuredClone(exact); foreign.frame.ledger.entries[0].requestDigest = digest("f");
  resealEntry(foreign.frame.ledger.entries[0]);
  assert.throws(() => validateClaimOnlyReplacementTerminal(foreign.frame, plan, key,
    foreign.result), /terminal semantics/u);
  const forged = structuredClone(exact.result); forged.operationReceipt.receiptDigest = digest("f");
  assert.throws(() => validateClaimOnlyReplacementTerminal(exact.frame, plan, key, forged),
    /operation result/u);
});
test("repository identity requires exact root, common directory, origin, and stable provider", () => {
  const root = process.cwd();
  const provider = () => ({ id: "R_controller", nameWithOwner: "huijoohwee/agentic-canvas-os" });
  const git = args => args.includes("--show-toplevel") ? root : args.includes("--git-common-dir") ? root : "git@github.com:huijoohwee/agentic-canvas-os.git";
  assert.equal(captureClaimOnlyRepositoryIdentity({ repository: root, commonDirectory: root, targetRepository: "huijoohwee/agentic-canvas-os", git, readProvider: provider }).nameWithOwner,
  "huijoohwee/agentic-canvas-os");
  assert.throws(() => captureClaimOnlyRepositoryIdentity({ repository: root, commonDirectory: root, targetRepository: "huijoohwee/agentic-canvas-os", git: args => args.includes("remote") ? "git@github.com:other/fork.git" : git(args), readProvider: provider }), /repository identity/u);
  for (const drift of ["--show-toplevel", "--git-common-dir"]) assert.throws(() => captureClaimOnlyRepositoryIdentity({ repository: root, commonDirectory: root, targetRepository: "huijoohwee/agentic-canvas-os", git: args => args.includes(drift) ? path.dirname(root) : git(args), readProvider: provider }), /repository identity/u);
  assert.throws(() => captureClaimOnlyRepositoryIdentity({ repository: root, commonDirectory: root, targetRepository: "huijoohwee/agentic-canvas-os", git, readProvider: () => ({ id: "R_fork", nameWithOwner: "other/fork" }) }), /repository identity/u);
  let reads = 0;
  assert.throws(() => captureClaimOnlyRepositoryIdentity({ repository: root, commonDirectory: root, targetRepository: "huijoohwee/agentic-canvas-os", git, readProvider: () => ({ id: `R_${reads += 1}`, nameWithOwner: "huijoohwee/agentic-canvas-os" }) }), /double-read/u);
});
test("CLI routes rollover TTL and only distinct external private paths", async t => {
  const root = await mkdtemp(path.join(path.dirname(process.cwd()), ".claim-only-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let adapterOptions = null;
  const result = await claimOnlyCliMain([ "plan-rollover", `--repository=${process.cwd()}`, "--target-repository=huijoohwee/agentic-canvas-os", `--source-claim-id=${SOURCE_ID}`, `--successor-claim-id=${SUCCESSOR_ID}`, `--state-path=${path.join(root, "rollover.json")}`, `--retirement-state-path=${path.join(root, "retirement.json")}`, `--claim-output=${path.join(root, "claim.json")}`, "--ttl-seconds=777",
  ], { createAdapter: options => { adapterOptions = options; return {}; }, createController: () => ({ planRollover: () => ({ planned: true }) }),
  });
  assert.deepEqual(result, { planned: true });
  assert.equal(adapterOptions.ttlSeconds, 777);
  assert.equal(adapterOptions.statePath, path.join(root, "rollover.json"));
  await assert.rejects(() => claimOnlyCliMain([ "plan-retirement", `--repository=${process.cwd()}`, "--target-repository=huijoohwee/agentic-canvas-os", `--source-claim-id=${SOURCE_ID}`, `--successor-claim-id=${SUCCESSOR_ID}`, `--state-path=${path.join(root, "source.json")}`, `--claim-output=${path.join(root, "ignored.json")}`,
  ]), /--claim-output is not accepted/u);
  await assert.rejects(() => claimOnlyCliMain([ "plan-retirement", `--repository=${process.cwd()}`, "--target-repository=huijoohwee/agentic-canvas-os", `--source-claim-id=${SOURCE_ID}`, `--successor-claim-id=${SUCCESSOR_ID}`, `--state-path=${path.join(process.cwd(), "private.json")}`,
  ]), /outside repository and controller worktrees/u);
  await assert.rejects(() => claimOnlyCliMain([ "plan-retirement", `--repository=${process.cwd()}`, "--target-repository=huijoohwee/agentic-canvas-os", `--source-claim-id=${SOURCE_ID}`, `--successor-claim-id=${SUCCESSOR_ID}`, "--state-path=relative-private.json",
  ]), /absolute path/u);
});
test("CLI requires an exact mode-0600 one-line external authorization", async t => {
  const root = await mkdtemp(path.join(path.dirname(process.cwd()), ".claim-only-auth-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const auth = path.join(root, "authorization.txt");
  const state = path.join(root, "retirement.json");
  const phrase = `authorize claim-only-partial-start-retirement ${digest("e")}`;
  writeFileSync(auth, `${phrase}\n`, { mode: 0o600 });
  const command = ["run-retirement", `--repository=${process.cwd()}`, "--target-repository=huijoohwee/agentic-canvas-os", `--source-claim-id=${SOURCE_ID}`, `--successor-claim-id=${SUCCESSOR_ID}`, `--state-path=${state}`, `--plan-digest=${digest("e")}`, `--auth-file=${auth}`];
  const result = await claimOnlyCliMain(command, { createAdapter: () => ({}), createController: () => ({ runRetirement: input => input }),
  });
  assert.deepEqual(result, { planDigest: digest("e"), authorization: phrase });
  chmodSync(auth, 0o700);
  await assert.rejects(() => claimOnlyCliMain(command, { createAdapter: () => ({}), createController: () => ({ runRetirement: input => input }),
  }), /exact mode 0600/u);
});
function completedRetirement() {
  const plan = buildRetirementPlan(retirementEvidence());
  const terminal = retirementTerminal(plan, plan.evidence.source);
  let journal = startClaimOnlyJournal(createClaimOnlyJournal(plan), plan.exactAuthorization);
  journal = advanceClaimOnlyJournal(journal, "prepared", { operationKey: claimOnlyOperationKey(plan, "prepared"), freshFrameDigest: digest("3"),
  });
  journal = advanceClaimOnlyJournal(journal, "source-retired", { operationKey: claimOnlyOperationKey(plan, "source-retired"), requestDigest: terminal.requestDigest, operationReceiptDigest: operationReceipt(terminal).receiptDigest, terminalEntryDigest: terminal.digest, disposition: "projected", cloudMutation: true,
  });
  journal = advanceClaimOnlyJournal(journal, "verified", buildClaimOnlyTerminalVerification(journal));
  const receipt = buildClaimOnlyCompletionReceipt(journal);
  return { plan, receipt, terminal, journal: advanceClaimOnlyJournal(journal, "complete", { receipt }) };
}
function retirementEvidence() {
  const source = claim({ claimId: SOURCE_ID, state: "dormant-preserved", recordedState: "current", reserved: true, predecessorClaimId: null, base: BASE, expiry: "2026-08-24T00:00:00.000Z" });
  const successor = claim({ claimId: SUCCESSOR_ID, state: "waiting-successor", recordedState: "waiting-successor", reserved: false, predecessorClaimId: SOURCE_ID, base: BASE, expiry: "2026-08-24T01:00:00.000Z" });
  return { schema: "agentic-claim-only-partial-start-retirement-evidence/v1", observedAt: "2026-08-24T02:00:00.000Z", repository: repositoryEvidence(), controller: controller(), canonical: { targetRepository: "huijoohwee/agentic-canvas-os", mainSha: MAIN, sourceBaseContained: true, successorBaseContained: true }, cloud: cloud(), source, successor, sourceEntry: entry(source, { state: "current", predecessorClaimId: null, sequence: 1 }), successorEntry: entry(successor, { state: "waiting-successor", predecessorClaimId: SOURCE_ID, sequence: 2 }), sourceLineageCount: 1, successorLineageCount: 1, associations: associations(), preservation: preservation(), overlap: { reservedClaimIds: [SOURCE_ID], waitingClaimIds: [SUCCESSOR_ID], higherPriorityWaitingClaimIds: [] },
  };
}
function rolloverEvidence(retirementReceipt) {
  const source = claim({ claimId: SOURCE_ID, state: "retired", recordedState: "retired", reserved: false, predecessorClaimId: null, base: BASE, expiry: "2026-08-24T00:00:00.000Z" });
  const successor = claim({ claimId: SUCCESSOR_ID, state: "waiting-successor", recordedState: "waiting-successor", reserved: false, predecessorClaimId: SOURCE_ID, base: BASE, expiry: "2026-08-24T01:00:00.000Z" });
  const proofCore = { schema: "agentic-legacy-review-current-base-disjoint-proof/v1", sourceBaseSha: BASE, targetBaseSha: MAIN, protectedMainSha: MAIN, canonicalChangedPaths: ["docs/controller.md"], canonicalChangedPathsDigest: digestValue(["docs/controller.md"]), preservedChangedPaths: ["scripts/scope-expansion.mjs"], preservedChangedPathsDigest: digestValue(["scripts/scope-expansion.mjs"]), ancestry: "source-base-to-current-protected-main", overlap: "none",
  };
  const replacementCore = { actorId: successor.actorId, canonicalBaseRevision: MAIN, leaseEpoch: 2, repositoryId: successor.repositoryId, workItemId: successor.workItemId, writeSetDigest: successor.writeSetDigest };
  return { schema: "agentic-claim-only-successor-rollover-evidence/v1", observedAt: "2026-08-24T03:00:00.000Z", repository: repositoryEvidence(), controller: controller(), canonical: { targetRepository: "huijoohwee/agentic-canvas-os", mainSha: MAIN, sourceBaseContained: true, successorBaseContained: true, canonicalDescendantProof: { ...proofCore, evidenceDigest: digestValue(proofCore) } }, cloud: cloud(), source, successor, sourceEntry: entry(source, { state: "current", predecessorClaimId: null, sequence: 1 }), successorEntry: entry(successor, { state: "waiting-successor", predecessorClaimId: SOURCE_ID, sequence: 2 }), sourceLineageCount: 2, successorLineageCount: 1, sourceCurrentCount: 0, associations: associations(), preservation: preservation(), overlap: { reservedClaimIds: [], waitingClaimIds: [SUCCESSOR_ID], higherPriorityWaitingClaimIds: [] }, retirement: { receipt: retirementReceipt, sourceTerminalEntry: retirementTerminalFromReceipt(retirementReceipt, source, successor) }, replacement: { expectedClaimId: digestValue(replacementCore), ...replacementCore, laneRevision: MAIN, predecessorClaimId: SUCCESSOR_ID, declaredWriteScope: successor.declaredWriteScope, deviceId: successor.deviceId, sessionId: successor.sessionId, ttlSeconds: 1800 },
  };
}
function claim({ claimId, state, recordedState, reserved, predecessorClaimId, base, expiry }) {
  return { claimId, claimDigest: digest("3"), transitionDigest: digest("4"), operationReceiptDigest: digest("5"), writeSetDigest: digestValue(SCOPE), canonicalBaseRevision: base, laneRevision: base, actorId: "github-user:8945812", repositoryId: "github-repository:R_controller", workItemId: "work-item:scope-expansion", deviceId: "device:local", sessionId: "session:controller", state, recordedState, entrySchema: "agentic-cloud-collaboration-entry/v2", claimIdentitySchema: "agentic-cloud-collaboration-entry/v2", declaredWriteScope: [...SCOPE], leaseEpoch: 1, transitionCounter: 1, heartbeatCounter: 0, expiresAt: expiry, writeAuthority: false, scopeReserved: reserved, reviewRequestId: null, predecessorClaimId, evidenceDigest: null, recovery: null, integration: null, retirement: null, eligibleSince: state === "waiting-successor" ? "2026-08-23T23:59:00.000Z" : null, handoff: null, release: null, canonicalDescendantProof: null };
}
function entry(subject, { state, predecessorClaimId, sequence, action = "claim" }) {
  return { schema: "agentic-cloud-collaboration-entry/v2", action, state, claimId: subject.claimId, claimDigest: subject.claimDigest, digest: digest(sequence % 10 || 9), idempotencyKey: digest("e"), sequence, transitionCounter: 1, heartbeatCounter: 0, recordedExpiresAt: subject.expiresAt, reviewRequestId: null, predecessorClaimId };
}
function retirementTerminal(plan, subject) {
  return retirementTerminalCore(plan.planDigest, subject, plan.evidence.successor, claimOnlyOperationKey(plan, "source-retired"));
}
function retirementTerminalFromReceipt(receipt, subject, successor) {
  return retirementTerminalCore(receipt.planDigest, subject, successor, receipt.cloudRetirementOperationKey);
}
function retirementTerminalCore(planDigest, subject, successor, operationKey,
  phase = "source-retired") {
  const retirement = { reason: "superseded", finalRevision: subject.laneRevision, reviewRequestId: null, bytesDigest: digestValue({ planDigest, phase, kind: "bytes" }), namedChecksDigest: digestValue({ planDigest, phase, kind: "checks" }), handoffEvidenceDigest: digestValue({ planDigest, phase, successorClaimId: successor.claimId, kind: "handoff" }), integrationReceiptDigest: null, retiredAt: "2026-08-24T02:00:01.000Z" };
  const intent = { repositoryId: subject.repositoryId, actorId: subject.actorId, deviceId: subject.deviceId, sessionId: subject.sessionId, claimId: subject.claimId, expectedFenceRevision: subject.claimDigest, expectedTransitionCounter: subject.transitionCounter, ...retirement }; delete intent.retiredAt;
  return { schema: "agentic-cloud-collaboration-entry/v2", action: "retire", sequence: 3, claimId: subject.claimId, claimDigest: digest("4"), digest: digest("5"), repositoryId: subject.repositoryId, idempotencyKey: digestValue(operationKey), requestDigest: digestValue({ action: "retire", intent }), evaluationTime: retirement.retiredAt, state: "retired", transitionCounter: 2, heartbeatCounter: 0, recordedExpiresAt: subject.expiresAt, predecessorClaimId: subject.predecessorClaimId, reviewRequestId: null, retirement };
}
function operationReceipt(entry, status = entry.action === "retire" ? "retired" : "current") {
  const core = { schema: `agentic-collaboration-${entry.action === "retire" ? "retirement" : entry.action}-receipt/v1`, operation: entry.action, status, repositoryId: entry.repositoryId, claimId: entry.claimId, claimDigest: entry.claimDigest, fenceRevision: entry.claimDigest, ledgerRevision: entry.digest, ledgerSequence: entry.sequence, idempotencyKey: entry.idempotencyKey, requestDigest: entry.requestDigest, evaluationTime: entry.evaluationTime };
  return { ...core, receiptDigest: digestValue(core) };
}
function rawRetirementEntry(plan, subject, phase) {
  const projected = retirementTerminalCore(plan.planDigest, subject, plan.evidence.successor, claimOnlyOperationKey(plan, phase), phase);
  const claimCore = { claimId: subject.claimId, actorId: subject.actorId, deviceId: subject.deviceId, sessionId: subject.sessionId, repositoryId: subject.repositoryId, workItemId: subject.workItemId, canonicalBaseRevision: subject.canonicalBaseRevision, declaredWriteScope: subject.declaredWriteScope, writeSetDigest: subject.writeSetDigest, laneRevision: subject.laneRevision, leaseEpoch: subject.leaseEpoch, transitionCounter: subject.transitionCounter + 1, heartbeatCounter: subject.heartbeatCounter, state: "retired", expiresAt: subject.expiresAt, evidenceDigest: subject.evidenceDigest, reviewRequestId: null, predecessorClaimId: subject.predecessorClaimId, eligibleSince: subject.eligibleSince, handoff: null, release: null, recovery: subject.recovery ?? null, integration: subject.integration ?? null, canonicalDescendantProof: subject.canonicalDescendantProof ?? null, retirement: projected.retirement };
  const draft = { schema: projected.schema, sequence: 3, parentDigest: digest("9"), action: "retire", repositoryId: subject.repositoryId, claimId: subject.claimId, idempotencyKey: projected.idempotencyKey, requestDigest: projected.requestDigest, evaluationTime: projected.evaluationTime, claimCore, claimDigest: digestValue(claimCore) };
  return { ...draft, digest: digestValue(draft) };
}
function resealEntry(entry) { entry.claimDigest = digestValue(entry.claimCore);
  const draft = { ...entry }; delete draft.digest; entry.digest = digestValue(draft); }
function retirementResult(entry) { return mutationResult(entry, "retired"); }
function mutationResult(entry, status) {
  const operation = operationReceipt(entry, status), active = status === "current";
  const claim = { ...entry.claimCore, entrySchema: entry.schema, claimIdentitySchema: entry.schema, writeAuthority: active, scopeReserved: active, fenceRevision: entry.claimDigest, transitionDigest: entry.digest, operationReceiptDigest: operation.receiptDigest, integrationReceiptDigest: null, integration: null, recovery: null };
  const transportCore = { schema: "agentic-cloud-collaboration-github-receipt/v1", action: entry.action, ledgerRevision: sha("d"), ledgerDigest: entry.digest, claimId: entry.claimId, claimDigest: entry.claimDigest, contractReceiptDigest: operation.receiptDigest, sequence: entry.sequence, evaluationTime: entry.evaluationTime };
  return { schema: "agentic-cloud-collaboration-result/v1", ok: true, action: entry.action, status, replayed: false, attempts: 1, ledgerRevision: sha("d"), claim, claimDigest: entry.claimDigest, operationReceipt: operation, receipt: { ...transportCore, receiptDigest: digestValue(transportCore) } };
}
function rawReplacement(plan) {
  const target = plan.evidence.replacement, evaluationTime = "2026-08-24T03:00:01.000Z";
  const expiresAt = new Date(Date.parse(evaluationTime) + target.ttlSeconds * 1_000).toISOString();
  const claimCore = { claimId: target.expectedClaimId, actorId: target.actorId, deviceId: target.deviceId, sessionId: target.sessionId, repositoryId: target.repositoryId, workItemId: target.workItemId, canonicalBaseRevision: target.canonicalBaseRevision, declaredWriteScope: target.declaredWriteScope, writeSetDigest: target.writeSetDigest, laneRevision: target.laneRevision, leaseEpoch: 2, transitionCounter: 1, heartbeatCounter: 0, state: "current", expiresAt, evidenceDigest: null, reviewRequestId: null, predecessorClaimId: target.predecessorClaimId, canonicalDescendantProof: plan.evidence.canonical.canonicalDescendantProof, eligibleSince: null, handoff: null, release: null };
  const intent = { repositoryId: target.repositoryId, actorId: target.actorId, deviceId: target.deviceId, sessionId: target.sessionId, workItemId: target.workItemId, canonicalBaseRevision: target.canonicalBaseRevision, declaredWriteScope: target.declaredWriteScope, writeSetDigest: target.writeSetDigest, laneRevision: target.laneRevision, leaseEpoch: 2, predecessorClaimId: target.predecessorClaimId, canonicalDescendantProof: plan.evidence.canonical.canonicalDescendantProof, expiresAt, claimId: target.expectedClaimId };
  const draft = { schema: "agentic-cloud-collaboration-entry/v2", sequence: 4, parentDigest: digest("9"), action: "claim", repositoryId: target.repositoryId, claimId: target.expectedClaimId, idempotencyKey: digestValue(claimOnlyOperationKey(plan, "replacement-claimed")), requestDigest: digestValue({ action: "claim", intent }), evaluationTime, claimCore, claimDigest: digestValue(claimCore) };
  const entry = { ...draft, digest: digestValue(draft) }, result = mutationResult(entry, "current");
  return { entry, result, frame: { ledger: { entries: [entry] }, status: { claims: [result.claim] } } };
}
function controller() { return { repository: "huijoohwee/agentic-canvas-os",
  providerRepositoryId: "R_controller", nameWithOwner: "huijoohwee/agentic-canvas-os",
  branch: "main", clean: true, protected: true,
  headSha: MAIN, originMainSha: MAIN, remoteMainSha: MAIN,
  runtimeDigest: digest("6"), protectionDigest: digest("7") }; }
function cloud() { return { ledgerRepository: "huijoohwee/agentic-canvas-os",
  ledgerRevision: sha("c"), ledgerDigest: digest("8"), validatedLedgerDigest: digest("8"),
  inventoryDigest: digest("9"), sequence: 10 }; }
function associations() { return { sourceRegistryMatches: [],
  sourcePullRequestMarkerMatches: [], successorRegistryMatches: [],
  successorPullRequestMarkerMatches: [] }; }
function preservation() { return { gitRefsDigest: digest("a"),
  gitWorktreesDigest: digest("b"), registryDigest: digest("c"), providerDigest: digest("d") }; }
function repositoryEvidence() { return { targetRepository: "huijoohwee/agentic-canvas-os",
  providerRepositoryId: "R_controller", nameWithOwner: "huijoohwee/agentic-canvas-os",
  topLevelDigest: digest("a"), gitCommonDirectoryDigest: digest("b"),
  originUrlDigest: digest("c") }; }
function fakeAdapter({ retirement = null, rollover = null, failSourceResponse = false,
  failPrepare = false }) {
  let journal = null, sourceRetired = false, staleRetired = false, replacementClaimed = false;
  const calls = { retireSource: 0, retireStaleSuccessor: 0, claimReplacement: 0, order: [] };
  const adapter = { withOperationLock: async (_context, action) => action(), readJournal: async () => journal, writeJournal: async ({ expected, next }) => { assert.deepEqual(expected, journal); journal = next; return journal; }, observeRetirement: async () => retirement, observeRollover: async () => rollover, prepare: async () => { if (failPrepare) throw new Error("simulated C3 preflight block"); return { freshFrameDigest: digest("f") }; }, classifySourceRetired: async context => sourceRetired ? { state: "complete", values: retirementEffectValues(context, failSourceResponse ? "adopted" : "projected") } : { state: "pending" }, retireSource: async () => { calls.retireSource += 1; sourceRetired = true; if (failSourceResponse) throw new Error("simulated response loss"); }, classifyStaleSuccessorRetired: async context => staleRetired ? { state: "complete", values: retirementEffectValues(context, "projected") } : { state: "pending" }, retireStaleSuccessor: async () => { calls.retireStaleSuccessor += 1; calls.order.push("retire-stale"); staleRetired = true; }, classifyReplacementClaimed: async context => replacementClaimed ? { state: "complete", values: replacementEffectValues(context) } : { state: "pending" }, claimReplacement: async () => { assert.equal(staleRetired, true); calls.claimReplacement += 1; calls.order.push("claim-replacement"); replacementClaimed = true; }, verifyRetirement: async ({ journal: current }) => buildClaimOnlyTerminalVerification(current), verifyRollover: async ({ journal: current }) => buildClaimOnlyTerminalVerification(current),
  };
  return { adapter, calls, journal: () => journal };
}
function retirementEffectValues(context, disposition) {
  const claim = context.phase === "source-retired"
    ? context.plan.evidence.source : context.plan.evidence.successor;
  return { operationKey: context.operationKey, requestDigest: claimOnlyRetirementRequestDigest(context.plan, claim, context.phase), operationReceiptDigest: digest("4"), terminalEntryDigest: digest("5"), disposition, cloudMutation: true };
}
function replacementEffectValues(context) {
  return { operationKey: context.operationKey, requestDigest: digest("5"), operationReceiptDigest: digest("6"), terminalEntryDigest: digest("7"), replacementClaimId: context.plan.evidence.replacement.expectedClaimId, rawClaimResultDigest: digest("8"), outputReceiptDigest: digest("9"), authorityDigest: digest("a"), disposition: "projected", cloudMutation: true };
}
