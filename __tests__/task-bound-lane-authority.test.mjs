import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  createTaskAuthorityBinding,
  createTaskAuthorityProof,
  createTaskAuthorityTransitionPlan,
  verifyTaskAuthorityProof,
} from "../scripts/task-bound-lane-authority-contract.mjs";
import {
  authorizeTaskBoundLeaseMutation,
  continueTaskAuthorityCloudSuccessorBinding,
  continueTaskAuthorityBinding,
  readTaskAuthorityCapability,
  writeTaskAuthorityCapability,
} from "../scripts/task-bound-lane-authority-store.mjs";
import {
  createWriterLeaseStore,
  parseWriterLeasePullRequestBody,
  renderWriterLeasePullRequestBody,
} from "../scripts/writer-lease-lib.mjs";

const SHA = "1".repeat(40);
const CLAIM = "2".repeat(64);
const SESSION = "visible-session-correlation";

test("proof of possession, not the visible session string, owns a bound lane", () => {
  const root = temporaryRoot();
  const ownerPath = path.join(root, "owner.json");
  const impostorPath = path.join(root, "impostor.json");
  writeTaskAuthorityCapability({ outputPath: ownerPath });
  writeTaskAuthorityCapability({ outputPath: impostorPath });
  const owner = readTaskAuthorityCapability(ownerPath);
  const lease = leaseFixture();
  const binding = createTaskAuthorityBinding({
    capability: owner,
    lease,
    boundAt: "2026-08-13T00:00:00.000Z",
  });
  const boundLease = { ...lease, taskAuthority: binding };

  assert.equal(
    authorizeTaskBoundLeaseMutation({
      lease: boundLease,
      capabilityPath: ownerPath,
      operation: "edit",
      now: new Date("2026-08-13T00:00:01.000Z"),
    }).status,
    "verified",
  );
  assert.throws(
    () => authorizeTaskBoundLeaseMutation({
      lease: boundLease,
      capabilityPath: impostorPath,
      operation: "edit",
      now: new Date("2026-08-13T00:00:01.000Z"),
    }),
    /does not own/,
  );
  assert.equal(
    authorizeTaskBoundLeaseMutation({
      lease: { ...boundLease, sessionId: "another-visible-session" },
      capabilityPath: ownerPath,
      operation: "edit",
      now: new Date("2026-08-13T00:00:02.000Z"),
    }).status,
    "verified",
  );
});

test("a proof is fresh, operation-bound, and single-use", () => {
  const root = temporaryRoot();
  const capabilityPath = path.join(root, "owner.json");
  writeTaskAuthorityCapability({ outputPath: capabilityPath });
  const capability = readTaskAuthorityCapability(capabilityPath);
  const lease = leaseFixture();
  const binding = createTaskAuthorityBinding({
    capability,
    lease,
    boundAt: "2026-08-13T00:00:00.000Z",
  });
  const boundLease = { ...lease, taskAuthority: binding };
  const proof = createTaskAuthorityProof({
    capability,
    binding,
    lease: boundLease,
    operation: "review",
    issuedAt: "2026-08-13T00:00:01.000Z",
    nonce: "3".repeat(64),
  });
  const consumed = new Set();
  verifyTaskAuthorityProof({
    proof,
    binding,
    lease: boundLease,
    operation: "review",
    now: new Date("2026-08-13T00:00:02.000Z"),
    consumedProofDigests: consumed,
  });
  assert.throws(() => verifyTaskAuthorityProof({
    proof,
    binding,
    lease: boundLease,
    operation: "review",
    now: new Date("2026-08-13T00:00:02.000Z"),
    consumedProofDigests: consumed,
  }), /replay/);
  assert.throws(() => verifyTaskAuthorityProof({
    proof,
    binding,
    lease: boundLease,
    operation: "integrate",
    now: new Date("2026-08-13T00:00:02.000Z"),
  }), /mutation subject/);
});

test("handoff is a distinct subject with exactly one generation advance", () => {
  const root = temporaryRoot();
  const sourcePath = path.join(root, "source.json");
  const targetPath = path.join(root, "target.json");
  const skippedPath = path.join(root, "skipped.json");
  writeTaskAuthorityCapability({ outputPath: sourcePath, generation: 1 });
  writeTaskAuthorityCapability({ outputPath: targetPath, generation: 2 });
  writeTaskAuthorityCapability({ outputPath: skippedPath, generation: 3 });
  const lease = leaseFixture();
  const current = createTaskAuthorityBinding({
    capability: readTaskAuthorityCapability(sourcePath),
    lease,
    boundAt: "2026-08-13T00:00:00.000Z",
  });
  const plan = createTaskAuthorityTransitionPlan({
    operation: "handoff",
    lease: { ...lease, taskAuthority: current },
    headSha: SHA,
    worktreeStateDigest: digestValue({ clean: true }),
    targetCapability: readTaskAuthorityCapability(targetPath),
    currentBinding: current,
    plannedAt: "2026-08-13T00:00:01.000Z",
  });
  assert.match(plan.exactAuthorization, new RegExp(plan.planDigest));
  assert.throws(() => createTaskAuthorityTransitionPlan({
    operation: "handoff",
    lease: { ...lease, taskAuthority: current },
    headSha: SHA,
    worktreeStateDigest: digestValue({ clean: true }),
    targetCapability: readTaskAuthorityCapability(skippedPath),
    currentBinding: current,
    plannedAt: "2026-08-13T00:00:01.000Z",
  }), /advance exactly once/);
});

test("capability files reject broad permissions and symlinks", () => {
  const root = temporaryRoot();
  const capabilityPath = path.join(root, "owner.json");
  const linkPath = path.join(root, "owner-link.json");
  writeTaskAuthorityCapability({ outputPath: capabilityPath });
  chmodSync(capabilityPath, 0o644);
  assert.throws(() => readTaskAuthorityCapability(capabilityPath), /owner-only/);
  chmodSync(capabilityPath, 0o600);
  symlinkSync(capabilityPath, linkPath);
  assert.throws(() => readTaskAuthorityCapability(linkPath), /non-symlink/);
});

test("required writer leases reject unbound or wrong-capability mutations", () => {
  const root = temporaryRoot();
  const common = path.join(root, "git-common");
  const ownerPath = path.join(root, "owner.json");
  const wrongPath = path.join(root, "wrong.json");
  writeTaskAuthorityCapability({ outputPath: ownerPath });
  writeTaskAuthorityCapability({ outputPath: wrongPath });
  const now = () => new Date("2026-08-13T00:00:00.000Z");
  const store = createWriterLeaseStore({
    gitCommonDir: createDirectory(common),
    now,
    taskAuthorityFile: ownerPath,
    taskAuthorityPolicy: "required",
  });
  const fixture = leaseFixture();
  const claimed = store.claim({
    sessionId: fixture.sessionId,
    device: fixture.device,
    scope: fixture.scope,
    branch: fixture.branch,
    worktreePath: root,
    baseSha: fixture.baseSha,
    ttlMs: 120_000,
  });
  assert.equal(claimed.taskAuthority.generation, 1);
  store.verify({ sessionId: SESSION, branch: claimed.branch });
  const marker = parseWriterLeasePullRequestBody(renderWriterLeasePullRequestBody({
    ...claimed,
    fenceSha: SHA,
  }));
  assert.equal(marker.taskAuthority.bindingDigest, claimed.taskAuthority.bindingDigest);

  const wrongStore = createWriterLeaseStore({
    gitCommonDir: common,
    now,
    taskAuthorityFile: wrongPath,
    taskAuthorityPolicy: "required",
  });
  assert.throws(
    () => wrongStore.verify({ sessionId: SESSION, branch: claimed.branch }),
    /does not own/,
  );
  const missingStore = createWriterLeaseStore({
    gitCommonDir: common,
    now,
    taskAuthorityPolicy: "required",
  });
  assert.throws(
    () => missingStore.verify({ sessionId: SESSION, branch: claimed.branch }),
    /path must be absolute/,
  );
});

test("a successor epoch requires the same capability and records binding continuity", () => {
  const root = temporaryRoot();
  const common = createDirectory(path.join(root, "git-common"));
  const ownerPath = path.join(root, "owner.json");
  const hijackerPath = path.join(root, "hijacker.json");
  writeTaskAuthorityCapability({ outputPath: ownerPath });
  writeTaskAuthorityCapability({ outputPath: hijackerPath });
  let instant = new Date("2026-08-13T00:00:00.000Z");
  const now = () => instant;
  const ownerStore = createWriterLeaseStore({
    gitCommonDir: common,
    now,
    taskAuthorityFile: ownerPath,
    taskAuthorityPolicy: "required",
  });
  const fixture = leaseFixture();
  const first = ownerStore.claim({
    sessionId: fixture.sessionId,
    device: fixture.device,
    scope: fixture.scope,
    branch: fixture.branch,
    worktreePath: root,
    baseSha: fixture.baseSha,
    ttlMs: 60_000,
  });
  instant = new Date("2026-08-13T00:02:00.000Z");
  const hijackerStore = createWriterLeaseStore({
    gitCommonDir: common,
    now,
    taskAuthorityFile: hijackerPath,
    taskAuthorityPolicy: "required",
  });
  assert.throws(() => hijackerStore.claim({
    sessionId: "copied-visible-session",
    device: fixture.device,
    scope: fixture.scope,
    branch: fixture.branch,
    worktreePath: root,
    baseSha: fixture.baseSha,
    ttlMs: 60_000,
  }), /cannot replace task authority/);
  const continued = ownerStore.claim({
    sessionId: "new-correlation-session",
    device: fixture.device,
    scope: fixture.scope,
    branch: fixture.branch,
    worktreePath: root,
    baseSha: fixture.baseSha,
    ttlMs: 60_000,
  });
  assert.equal(continued.epoch, first.epoch + 1);
  assert.equal(continued.taskAuthority.bindingMode, "continuation");
  assert.equal(continued.taskAuthority.priorBindingDigest, first.taskAuthority.bindingDigest);
  assert.equal(continued.taskAuthority.authoritySubjectId, first.taskAuthority.authoritySubjectId);
});

test("active-owned-dirt recovery continuation rebinds the exact next lease epoch", () => {
  const ownerPath = createCapabilityFile(1);
  const capability = readTaskAuthorityCapability(ownerPath);
  const sourceLease = leaseFixture();
  const sourceBinding = createTaskAuthorityBinding({
    capability,
    lease: sourceLease,
    boundAt: "2026-08-13T00:00:00.000Z",
  });
  const boundSource = { ...sourceLease, taskAuthority: sourceBinding };
  const nextLease = { ...boundSource, epoch: sourceLease.epoch + 1 };
  const continued = continueTaskAuthorityBinding({
    sourceLease: boundSource,
    nextLease,
    capabilityPath: ownerPath,
    boundAt: "2026-08-13T00:01:00.000Z",
  });
  assert.equal(continued.bindingMode, "continuation");
  assert.equal(continued.priorBindingDigest, sourceBinding.bindingDigest);
  assert.doesNotThrow(() => authorizeTaskBoundLeaseMutation({
    lease: { ...nextLease, taskAuthority: continued },
    capabilityPath: ownerPath,
    operation: "edit",
    now: new Date("2026-08-13T00:01:01.000Z"),
  }));
});

test("scope expansion continues task authority across one cloud successor claim", () => {
  const root = temporaryRoot();
  const ownerPath = path.join(root, "owner.json");
  writeTaskAuthorityCapability({ outputPath: ownerPath });
  const sourceLease = leaseFixture();
  const sourceBinding = createTaskAuthorityBinding({
    capability: readTaskAuthorityCapability(ownerPath),
    lease: sourceLease,
    boundAt: "2026-08-13T00:00:00.000Z",
  });
  const boundSource = { ...sourceLease, taskAuthority: sourceBinding };
  const nextLease = {
    ...boundSource,
    cloudAuthority: { claimId: "3".repeat(64) },
  };
  const continued = continueTaskAuthorityCloudSuccessorBinding({
    sourceLease: boundSource,
    nextLease,
    capabilityPath: ownerPath,
    boundAt: "2026-08-13T00:01:00.000Z",
  });
  assert.equal(continued.bindingMode, "continuation");
  assert.equal(continued.priorBindingDigest, sourceBinding.bindingDigest);
  assert.doesNotThrow(() => authorizeTaskBoundLeaseMutation({
    lease: { ...nextLease, taskAuthority: continued },
    capabilityPath: ownerPath,
    operation: "edit",
    now: new Date("2026-08-13T00:01:01.000Z"),
  }));
  assert.throws(() => continueTaskAuthorityCloudSuccessorBinding({
    sourceLease: boundSource,
    nextLease: { ...nextLease, epoch: nextLease.epoch + 1 },
    capabilityPath: ownerPath,
    boundAt: "2026-08-13T00:01:02.000Z",
  }), /exact stable lane/);
});

test("cloud successor continuation advances to the successor canonical base", () => {
  const root = temporaryRoot();
  const ownerPath = path.join(root, "owner.json");
  writeTaskAuthorityCapability({ outputPath: ownerPath });
  const sourceLease = {
    ...leaseFixture(),
    cloudAuthority: { claimId: CLAIM, canonicalBaseSha: SHA },
  };
  const sourceBinding = createTaskAuthorityBinding({
    capability: readTaskAuthorityCapability(ownerPath),
    lease: sourceLease,
    boundAt: "2026-08-13T00:00:00.000Z",
  });
  const boundSource = { ...sourceLease, taskAuthority: sourceBinding };
  const successorBaseSha = "4".repeat(40);
  const nextLease = {
    ...boundSource,
    baseSha: successorBaseSha,
    cloudAuthority: {
      claimId: "3".repeat(64),
      canonicalBaseSha: successorBaseSha,
    },
  };
  const continued = continueTaskAuthorityCloudSuccessorBinding({
    sourceLease: boundSource,
    nextLease,
    capabilityPath: ownerPath,
    boundAt: "2026-08-13T00:01:00.000Z",
  });
  assert.doesNotThrow(() => authorizeTaskBoundLeaseMutation({
    lease: { ...nextLease, taskAuthority: continued },
    capabilityPath: ownerPath,
    operation: "edit",
    now: new Date("2026-08-13T00:01:01.000Z"),
  }));
  assert.throws(() => continueTaskAuthorityCloudSuccessorBinding({
    sourceLease: boundSource,
    nextLease: { ...nextLease, baseSha: "5".repeat(40) },
    capabilityPath: ownerPath,
    boundAt: "2026-08-13T00:01:02.000Z",
  }), /exact stable lane/);
});

test("writer authority handoff requires both keys and invalidates the predecessor", () => {
  const root = temporaryRoot();
  const common = createDirectory(path.join(root, "git-common"));
  const sourcePath = path.join(root, "source.json");
  const targetPath = path.join(root, "target.json");
  const wrongPath = path.join(root, "wrong.json");
  writeTaskAuthorityCapability({ outputPath: sourcePath, generation: 1 });
  writeTaskAuthorityCapability({ outputPath: targetPath, generation: 2 });
  writeTaskAuthorityCapability({ outputPath: wrongPath, generation: 1 });
  const now = () => new Date("2026-08-13T00:00:00.000Z");
  const sourceStore = createWriterLeaseStore({
    gitCommonDir: common,
    now,
    taskAuthorityFile: sourcePath,
    taskAuthorityPolicy: "required",
  });
  const fixture = leaseFixture();
  const claimed = sourceStore.claim({
    sessionId: fixture.sessionId,
    device: fixture.device,
    scope: fixture.scope,
    branch: fixture.branch,
    worktreePath: root,
    baseSha: fixture.baseSha,
    ttlMs: 120_000,
  });
  assert.throws(() => sourceStore.handoffTaskAuthority({
    sessionId: SESSION,
    branch: claimed.branch,
    sourceCapabilityFile: wrongPath,
    targetCapabilityFile: targetPath,
    planDigest: "4".repeat(64),
    boundAt: "2026-08-13T00:00:01.000Z",
  }), /does not own/);
  const handedOff = sourceStore.handoffTaskAuthority({
    sessionId: SESSION,
    branch: claimed.branch,
    sourceCapabilityFile: sourcePath,
    targetCapabilityFile: targetPath,
    planDigest: "4".repeat(64),
    boundAt: "2026-08-13T00:00:01.000Z",
  });
  assert.equal(handedOff.taskAuthority.generation, 2);
  assert.throws(
    () => sourceStore.verify({ sessionId: SESSION, branch: claimed.branch }),
    /does not own/,
  );
  const targetStore = createWriterLeaseStore({
    gitCommonDir: common,
    now,
    taskAuthorityFile: targetPath,
    taskAuthorityPolicy: "required",
  });
  assert.equal(
    targetStore.verify({ sessionId: SESSION, branch: claimed.branch }).taskAuthority.generation,
    2,
  );
});

test("CLI migration is clean-state, exact-plan, and observable without the capability", () => {
  const root = temporaryRoot();
  const repository = path.join(root, "repository");
  const capabilityPath = path.join(root, "owner.json");
  const planPath = path.join(root, "migration-plan.json");
  mkdirSync(repository);
  git(repository, ["init", "--initial-branch=main"]);
  git(repository, ["config", "user.email", "test@example.com"]);
  git(repository, ["config", "user.name", "Test"]);
  git(repository, ["commit", "--allow-empty", "-m", "base"]);
  const branch = "agent/device.local/task-bound-lane-authority";
  git(repository, ["switch", "--create", branch]);
  const common = path.resolve(repository, git(repository, ["rev-parse", "--git-common-dir"]));
  const leaseStore = createWriterLeaseStore({ gitCommonDir: common });
  leaseStore.claim({
    sessionId: SESSION,
    device: "device.local",
    scope: "task-bound-lane-authority",
    branch,
    worktreePath: repository,
    baseSha: git(repository, ["rev-parse", "HEAD"]),
    ttlMs: 600_000,
  });
  const issue = runCli([
    "issue",
    `--output=${capabilityPath}`,
    "--json",
  ]);
  assert.equal(issue.status, "issued");
  assert.doesNotMatch(JSON.stringify(issue), /PRIVATE KEY/);
  const planned = runCli([
    "plan-migration",
    `--repository=${repository}`,
    `--session=${SESSION}`,
    `--capability=${capabilityPath}`,
    `--output=${planPath}`,
    "--json",
  ]);
  assert.equal(planned.status, "planned");
  const dirtyPath = path.join(repository, "unowned-dirt.txt");
  writeFileSync(dirtyPath, "preserve me");
  assert.throws(() => runCli([
    "migrate",
    `--repository=${repository}`,
    `--session=${SESSION}`,
    `--capability=${capabilityPath}`,
    `--plan=${planPath}`,
    `--authorize=${planned.exactAuthorization}`,
    "--json",
  ]), /Dirty lanes cannot/);
  unlinkSync(dirtyPath);
  assert.throws(() => runCli([
    "migrate",
    `--repository=${repository}`,
    `--session=${SESSION}`,
    `--capability=${capabilityPath}`,
    `--plan=${planPath}`,
    "--authorize=wrong",
    "--json",
  ]), /exact authorization/);
  const migrated = runCli([
    "migrate",
    `--repository=${repository}`,
    `--session=${SESSION}`,
    `--capability=${capabilityPath}`,
    `--plan=${planPath}`,
    `--authorize=${planned.exactAuthorization}`,
    "--json",
  ]);
  assert.equal(migrated.taskAuthority.status, "bound");
  const observed = runCli([
    "inspect",
    `--repository=${repository}`,
    "--json",
  ]);
  assert.equal(observed.taskAuthority.bindingDigest, migrated.taskAuthority.bindingDigest);
});

test("CLI migrates one clean unbound delivery-authorized legacy lease", () => {
  const root = temporaryRoot();
  const repository = path.join(root, "repository");
  const capabilityPath = path.join(root, "owner.json");
  const planPath = path.join(root, "delivery-migration-plan.json");
  mkdirSync(repository);
  git(repository, ["init", "--initial-branch=main"]);
  git(repository, ["config", "user.email", "test@example.com"]);
  git(repository, ["config", "user.name", "Test"]);
  git(repository, ["commit", "--allow-empty", "-m", "base"]);
  const branch = "agent/device.local/delivery-authority-migration";
  git(repository, ["switch", "--create", branch]);
  const common = path.resolve(repository, git(repository, ["rev-parse", "--git-common-dir"]));
  const leaseStore = createWriterLeaseStore({ gitCommonDir: common });
  leaseStore.claim({
    sessionId: SESSION,
    device: "device.local",
    scope: "delivery-authority-migration",
    branch,
    worktreePath: repository,
    baseSha: git(repository, ["rev-parse", "HEAD"]),
    ttlMs: 600_000,
  });
  leaseStore.annotate({
    sessionId: SESSION,
    branch,
    values: { status: "delivery", cloudAuthority: { claimId: CLAIM } },
  });
  runCli(["issue", `--output=${capabilityPath}`, "--json"]);
  const planned = runCli([
    "plan-migration",
    `--repository=${repository}`,
    `--session=${SESSION}`,
    `--capability=${capabilityPath}`,
    `--output=${planPath}`,
    "--json",
  ]);
  const migrated = runCli([
    "migrate",
    `--repository=${repository}`,
    `--session=${SESSION}`,
    `--capability=${capabilityPath}`,
    `--plan=${planPath}`,
    `--authorize=${planned.exactAuthorization}`,
    "--json",
  ]);
  assert.equal(migrated.taskAuthority.status, "bound");
  assert.equal(leaseStore.read(branch).status, "delivery");
});

test("the public schema validates each canonical authority artifact", () => {
  const schema = JSON.parse(readFileSync(new URL(
    "../docs/schemas/task-bound-lane-authority.v1.schema.json",
    import.meta.url,
  ), "utf8"));
  const validate = new Ajv2020({
    strict: true,
    allErrors: true,
    validateFormats: false,
  }).compile(schema);
  const capability = readTaskAuthorityCapability(createCapabilityFile(1));
  const lease = leaseFixture();
  const binding = createTaskAuthorityBinding({
    capability,
    lease,
    boundAt: "2026-08-13T00:00:00.000Z",
  });
  const boundLease = { ...lease, taskAuthority: binding };
  const proof = createTaskAuthorityProof({
    capability,
    binding,
    lease: boundLease,
    operation: "test",
    issuedAt: "2026-08-13T00:00:01.000Z",
    nonce: "5".repeat(64),
  });
  const plan = createTaskAuthorityTransitionPlan({
    operation: "migration",
    lease,
    headSha: SHA,
    worktreeStateDigest: digestValue({ clean: true }),
    targetCapability: capability,
    plannedAt: "2026-08-13T00:00:00.000Z",
  });
  for (const artifact of [capability, binding, proof, plan]) {
    assert.equal(validate(artifact), true, JSON.stringify(validate.errors));
  }
});

test("device lifecycle publicly requires an external task authority capability", () => {
  const source = readFileSync(new URL("../scripts/device-branch.mjs", import.meta.url), "utf8");
  assert.match(source, /--task-authority=<external-capability\.json>/);
  assert.match(source, /taskAuthorityPolicy: "required"/);
  assert.match(source, /assertExternalTaskAuthorityFile\(taskAuthorityFile, canonicalRepo\)/);
  assert.match(source, /delete process\.env\.AGENTIC_TASK_AUTHORITY_FILE/);
  assert.doesNotMatch(source, /sessionId.*bearer/iu);
});

function leaseFixture() {
  return {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 7,
    sessionId: SESSION,
    device: "device.local",
    scope: "task-bound-lane-authority",
    branch: "agent/device.local/task-bound-lane-authority",
    worktreePath: "/workspace/task-bound-lane-authority",
    baseSha: SHA,
    fenceSha: SHA,
    cloudAuthority: { claimId: CLAIM },
    expiresAt: "2026-08-13T01:00:00.000Z",
  };
}

function temporaryRoot() {
  return realpathSync(mkdtempSync(path.join(os.tmpdir(), "task-authority-")));
}

function createDirectory(directory) {
  mkdirSync(directory, { recursive: true });
  return directory;
}

function createCapabilityFile(generation) {
  const root = temporaryRoot();
  const capabilityPath = path.join(root, `generation-${generation}.json`);
  writeTaskAuthorityCapability({ outputPath: capabilityPath, generation });
  return capabilityPath;
}

function git(repository, args) {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function runCli(args) {
  const script = new URL("../scripts/task-bound-lane-authority-cli.mjs", import.meta.url);
  const result = spawnSync(process.execPath, [script.pathname, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const payload = JSON.parse(result.stdout);
  if (result.status !== 0) throw new Error(payload.error || result.stderr);
  return payload;
}
