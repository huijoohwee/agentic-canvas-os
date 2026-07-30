import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { lifecyclePolicyIdentity } from "./lifecycle-conformance-policy.mjs";
import { compareLexicalText } from "./lexical-compare.mjs";

export const LIFECYCLE_EVALUATOR_REPOSITORY =
  "huijoohwee/agentic-canvas-os";
export const ADMISSION_EVALUATOR_MECHANISM_ID =
  "agentic-canvas-os:lifecycle-conformance:admission/v1";

export const ADMISSION_EVALUATOR_MODULES = Object.freeze([
  "agent-api/src/upstream-dependency-admission.js",
  "package-lock.json",
  "scripts/agentic-sdlc/admission-collaboration.mjs",
  "scripts/agentic-sdlc/admission-domain.mjs",
  "scripts/agentic-sdlc/admission-evidence.mjs",
  "scripts/agentic-sdlc/admission-evaluator.mjs",
  "scripts/agentic-sdlc/admission-findings.mjs",
  "scripts/agentic-sdlc/admission-schema-validation.mjs",
  "scripts/agentic-sdlc/attestation.mjs",
  "scripts/agentic-sdlc/baseline-digest.mjs",
  "scripts/agentic-sdlc/constants.mjs",
  "scripts/agentic-sdlc/graph.mjs",
  "scripts/agentic-sdlc/normalize.mjs",
  "scripts/lexical-compare.mjs",
  "scripts/alignment-audit/finding.mjs",
  "scripts/lifecycle-conformance-gate.mjs",
  "scripts/lifecycle-conformance-identity.mjs",
  "scripts/lifecycle-conformance-policy.mjs",
  "scripts/lifecycle-conformance.mjs",
]);

export const ADMISSION_SCHEMA_MODULES = Object.freeze([
  "docs/schemas/agentic-sdlc-admission-evidence.v1.schema.json",
  "docs/schemas/agentic-sdlc-admission-stage-receipt.v1.schema.json",
]);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = path.resolve(scriptDirectory, "..");
const SHA_PATTERN = /^[0-9a-f]{40}$/u;

export function resolveLifecycleConformanceIdentities(options = {}) {
  const repositoryRoot = path.resolve(
    options.repositoryRoot ?? defaultRepositoryRoot,
  );
  const gitText = options.gitText ?? ((arguments_) => execFileSync(
    "git",
    arguments_,
    { cwd: repositoryRoot, encoding: "utf8" },
  ));
  const revision = gitText(["rev-parse", "HEAD"]).trim();
  if (!SHA_PATTERN.test(revision)) {
    throw identityError(
      "AGENTIC_SDLC_EVALUATOR_IDENTITY_UNAVAILABLE",
      "The checked-out evaluator revision is unavailable.",
    );
  }
  const readBytes = options.readBytes ?? ((relativePath) => execFileSync(
    "git",
    ["show", `${revision}:${relativePath}`],
    { cwd: repositoryRoot },
  ));

  assertImmutableClosure({
    gitText,
    paths: [...ADMISSION_EVALUATOR_MODULES, ...ADMISSION_SCHEMA_MODULES],
  });

  const evaluator = Object.freeze({
    repository: LIFECYCLE_EVALUATOR_REPOSITORY,
    revision,
    digest: computeArtifactClosureDigest(
      ADMISSION_EVALUATOR_MODULES.map((modulePath) => ({
        id: modulePath,
        bytes: readBytes(modulePath),
      })),
    ),
    mechanismId: ADMISSION_EVALUATOR_MECHANISM_ID,
  });
  const schema = Object.freeze({
    repository: LIFECYCLE_EVALUATOR_REPOSITORY,
    revision,
    digest: computeArtifactClosureDigest(
      ADMISSION_SCHEMA_MODULES.map((modulePath) => ({
        id: modulePath,
        bytes: readBytes(modulePath),
      })),
    ),
  });
  return Object.freeze({
    policy: lifecyclePolicyIdentity(),
    evaluator,
    schema,
  });
}

export function computeArtifactClosureDigest(modules) {
  const ordered = [...modules].sort((left, right) =>
    compareLexicalText(left.id, right.id));
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

function assertImmutableClosure({ gitText, paths }) {
  const status = gitText([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ...paths,
  ]).trim();
  if (status) {
    throw identityError(
      "AGENTIC_SDLC_EVALUATOR_IDENTITY_UNAVAILABLE",
      "Evaluator and schema artifacts must be tracked and byte-identical to the checked-out revision.",
    );
  }
  for (const artifactPath of paths) {
    try {
      gitText(["ls-files", "--error-unmatch", "--", artifactPath]);
    } catch {
      throw identityError(
        "AGENTIC_SDLC_EVALUATOR_IDENTITY_UNAVAILABLE",
        `Evaluator closure artifact is not tracked: ${artifactPath}`,
      );
    }
  }
}

function identityError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function lengthPrefix(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(value));
  return buffer;
}
