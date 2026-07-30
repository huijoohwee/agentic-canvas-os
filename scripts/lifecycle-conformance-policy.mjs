import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export const LIFECYCLE_POLICY_SOURCE = Object.freeze({
  repository: "huijoohwee/huijoohwee.github.io",
  revision: "d399076375ccc7820f31c31fb17529ed9b7f9304",
  digest: "da199c4614e7e69033ae926fd03de01233ddb4ba32a7493ef43165ea3ac46bfc",
  guidelineVersion: "1.8.0",
  modules: Object.freeze([
    "guidelines/agentic-sdlc-conformance-runtime.md",
    "guidelines/agentic-sdlc-guidelines.md",
    "guidelines/agentic-sdlc-integration-order.md",
    "guidelines/agentic-sdlc-upstream-dependency-admission.md",
    "guidelines/prd-tad-adr-guidelines.md",
  ]),
});

export function lifecyclePolicyIdentity() {
  const { repository, revision, digest, guidelineVersion } = LIFECYCLE_POLICY_SOURCE;
  return Object.freeze({ repository, revision, digest, guidelineVersion });
}

export function verifyPinnedLifecyclePolicySource(repositoryRoot) {
  const root = path.resolve(String(repositoryRoot || ""));
  const revision = execFileSync(
    "git",
    ["rev-parse", "HEAD"],
    { cwd: root, encoding: "utf8" },
  ).trim();
  if (revision !== LIFECYCLE_POLICY_SOURCE.revision) {
    throw new Error(
      `Lifecycle policy source is ${revision || "unknown"}, expected ${LIFECYCLE_POLICY_SOURCE.revision}.`,
    );
  }
  const modules = LIFECYCLE_POLICY_SOURCE.modules.map((modulePath) => ({
    id: modulePath,
    bytes: readFileSync(path.join(root, modulePath)),
  }));
  const digest = computeLifecyclePolicyDigest(modules);
  if (digest !== LIFECYCLE_POLICY_SOURCE.digest) {
    throw new Error(
      `Lifecycle policy digest is ${digest}, expected ${LIFECYCLE_POLICY_SOURCE.digest}.`,
    );
  }
  return lifecyclePolicyIdentity();
}

export function computeLifecyclePolicyDigest(modules) {
  const ordered = [...modules].sort((left, right) =>
    String(left.id).localeCompare(String(right.id), "en"));
  const hash = createHash("sha256");
  for (const module of ordered) {
    const identity = Buffer.from(String(module.id), "utf8");
    const bytes = Buffer.isBuffer(module.bytes)
      ? module.bytes
      : Buffer.from(module.bytes);
    hash.update(lengthPrefix(identity.length));
    hash.update(identity);
    hash.update(lengthPrefix(bytes.length));
    hash.update(bytes);
  }
  return hash.digest("hex");
}

function lengthPrefix(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(value));
  return buffer;
}
