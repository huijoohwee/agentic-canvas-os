// Responsibility: Own secure capability files and proof-of-possession checks without storing private material in leases.
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { digestValue } from "./cloud-collaboration-primitives.mjs";
import {
  assertCapabilityMatchesBinding,
  assertTaskAuthorityBinding,
  createTaskAuthorityBinding,
  createTaskAuthorityCapability,
  createTaskAuthorityProof,
  normalizeTaskAuthorityBinding,
  normalizeTaskAuthorityCapability,
  projectTaskAuthorityCapability,
  verifyTaskAuthorityProof,
} from "./task-bound-lane-authority-contract.mjs";

const consumedProofDigests = new Set();

export function writeTaskAuthorityCapability({
  outputPath,
  authoritySubjectId,
  generation = 1,
  issuedAt = new Date().toISOString(),
}) {
  const target = requireAbsolutePath(outputPath, "capability output path");
  const parent = path.dirname(target);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  requireRealDirectory(parent, "capability parent directory");
  if (existsSync(target)) throw new Error("Task authority capability output already exists.");
  const capability = createTaskAuthorityCapability({
    authoritySubjectId,
    generation,
    issuedAt,
  });
  const descriptor = openSync(target, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(capability, null, 2)}\n`);
  } finally {
    closeSync(descriptor);
  }
  assertSecureCapabilityFile(target);
  return Object.freeze({
    path: target,
    capability: projectTaskAuthorityCapability(capability),
  });
}

export function readTaskAuthorityCapability(capabilityPath) {
  const target = requireAbsolutePath(capabilityPath, "task authority capability path");
  assertSecureCapabilityFile(target);
  let source;
  try {
    source = JSON.parse(readFileSync(target, "utf8"));
  } catch (error) {
    throw new Error(`Could not read task authority capability: ${error.message}`);
  }
  return Object.freeze(normalizeTaskAuthorityCapability(source));
}

export function createTaskAuthorityLeaseBinding({
  lease,
  capabilityPath,
  bindingMode = "claim",
  boundAt = new Date().toISOString(),
  transitionPlanDigest = null,
  priorBindingDigest = null,
}) {
  return createTaskAuthorityBinding({
    capability: readTaskAuthorityCapability(capabilityPath),
    lease,
    bindingMode,
    boundAt,
    transitionPlanDigest,
    priorBindingDigest,
  });
}

export function authorizeTaskBoundLeaseMutation({
  lease,
  capabilityPath,
  operation,
  now = new Date(),
}) {
  const binding = assertTaskAuthorityBinding({ binding: lease?.taskAuthority, lease });
  const capability = readTaskAuthorityCapability(capabilityPath);
  assertCapabilityMatchesBinding(capability, binding);
  const proof = createTaskAuthorityProof({
    capability,
    binding,
    lease,
    operation,
    issuedAt: now.toISOString(),
  });
  const verified = verifyTaskAuthorityProof({
    proof,
    binding,
    lease,
    operation,
    now,
    consumedProofDigests,
  });
  compactConsumedProofs();
  return Object.freeze({
    schema: "agentic-task-authority-verification-receipt/v1",
    status: "verified",
    authoritySubjectId: binding.authoritySubjectId,
    proofAdapterId: binding.proofAdapterId,
    generation: binding.generation,
    bindingDigest: binding.bindingDigest,
    proofDigest: verified.proofDigest,
    operation,
    verifiedAt: now.toISOString(),
    receiptDigest: digestValue({
      authoritySubjectId: binding.authoritySubjectId,
      bindingDigest: binding.bindingDigest,
      proofDigest: verified.proofDigest,
      operation,
      verifiedAt: now.toISOString(),
    }),
  });
}

export function assertTaskAuthorityTransition({
  operation,
  lease,
  sourceCapabilityPath = null,
  targetCapabilityPath,
  planDigest,
  boundAt = new Date().toISOString(),
}) {
  const targetCapability = readTaskAuthorityCapability(targetCapabilityPath);
  const currentBinding = normalizeTaskAuthorityBinding(lease?.taskAuthority);
  if (operation === "migration") {
    if (currentBinding) throw new Error("Task authority migration requires an unbound lease.");
    return createTaskAuthorityBinding({
      capability: targetCapability,
      lease,
      bindingMode: "migration",
      boundAt,
      transitionPlanDigest: planDigest,
    });
  }
  if (operation !== "handoff") throw new Error("Unsupported task authority transition.");
  if (!currentBinding) throw new Error("Task authority handoff requires a bound lease.");
  authorizeTaskBoundLeaseMutation({
    lease,
    capabilityPath: sourceCapabilityPath,
    operation: "task-authority-handoff-release",
    now: new Date(boundAt),
  });
  const target = projectTaskAuthorityCapability(targetCapability);
  if (target.generation !== currentBinding.generation + 1) {
    throw new Error("Task authority handoff generation must advance exactly once.");
  }
  if (target.authoritySubjectId === currentBinding.authoritySubjectId) {
    throw new Error("Task authority handoff requires a distinct target subject.");
  }
  return createTaskAuthorityBinding({
    capability: targetCapability,
    lease,
    bindingMode: "handoff",
    boundAt,
    transitionPlanDigest: planDigest,
    priorBindingDigest: currentBinding.bindingDigest,
  });
}

export function publicTaskAuthorityStatus(lease) {
  const binding = normalizeTaskAuthorityBinding(lease?.taskAuthority);
  return binding ? Object.freeze({
    status: "bound",
    authoritySubjectId: binding.authoritySubjectId,
    proofAdapterId: binding.proofAdapterId,
    generation: binding.generation,
    bindingMode: binding.bindingMode,
    bindingDigest: binding.bindingDigest,
    boundAt: binding.boundAt,
  }) : Object.freeze({ status: "unbound" });
}

function assertSecureCapabilityFile(target) {
  const parent = path.dirname(target);
  requireRealDirectory(parent, "capability parent directory");
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Task authority capability must be a regular non-symlink file.");
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error("Task authority capability permissions must be owner-only.");
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error("Task authority capability must be owned by the current user.");
  }
  if (realpathSync(target) !== target) {
    throw new Error("Task authority capability path must be canonical.");
  }
}

function requireRealDirectory(candidate, label) {
  const stat = lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real non-symlink directory.`);
  }
}

function requireAbsolutePath(value, label) {
  const source = String(value || "").trim();
  if (!source || !path.isAbsolute(source)) throw new Error(`${label} must be absolute.`);
  return path.resolve(source);
}

function compactConsumedProofs() {
  if (consumedProofDigests.size <= 1024) return;
  const retained = [...consumedProofDigests].slice(-512);
  consumedProofDigests.clear();
  for (const digest of retained) consumedProofDigests.add(digest);
}
