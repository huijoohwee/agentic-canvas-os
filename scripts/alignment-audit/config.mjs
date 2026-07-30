import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { normalizeOperatorInstruction } from "./deploy-gate.mjs";

export const DEFAULT_READINESS_LADDER = Object.freeze([
  "undocumented",
  "spec-complete",
  "dev-proven",
  "runtime-ready",
  "production-verified",
]);

export const DEFAULT_ECONOMICS_STATEMENTS = Object.freeze([
  "return-on-investment",
  "12-month-total-cost-of-ownership",
  "token-budget",
  "time-to-value",
]);

export class AuditConfigError extends Error {
  constructor(field, message) {
    super(`${field}: ${message}`);
    this.name = "AuditConfigError";
    this.field = field;
  }
}

export async function resolveAuditConfig(supplied, options = {}) {
  const shaped = validateAuditConfigShape(supplied);
  const baseDirectory = path.resolve(options.baseDirectory ?? process.cwd());
  const environment = options.environment ?? process.env;
  const canonicalizeInput = options.canonicalizeInput ?? realpath;
  const canonicalizeOutput =
    options.canonicalizeOutput ??
    ((locator) => canonicalizeProspectivePath(locator, { canonicalize: realpath }));
  const assertWritable = options.assertWritable ?? assertProspectiveWritable;

  const guidelineRoots = await resolveRoots(
    shaped.guidelineRoots,
    "guidelineRoots",
    baseDirectory,
    canonicalizeInput,
    environment,
  );
  const runtimeRoots = await resolveRoots(
    shaped.runtimeRoots,
    "runtimeRoots",
    baseDirectory,
    canonicalizeInput,
    environment,
  );
  const unresolvedOutput = path.resolve(
    baseDirectory,
    expandEnvironmentReferences(shaped.auditOutputDirectory, environment),
  );

  let auditOutputDirectory;
  try {
    auditOutputDirectory = path.resolve(await canonicalizeOutput(unresolvedOutput));
    await assertWritable(auditOutputDirectory);
  } catch (error) {
    throw new AuditConfigError(
      "auditOutputDirectory",
      `cannot resolve a writable output directory (${errorMessage(error)})`,
    );
  }

  for (const root of [...guidelineRoots, ...runtimeRoots]) {
    if (pathsOverlap(auditOutputDirectory, root.locator)) {
      throw new AuditConfigError(
        "auditOutputDirectory",
        `must be disjoint from input root ${root.roleLabel}`,
      );
    }
  }

  return Object.freeze({
    guidelineRoots,
    runtimeRoots,
    auditOutputDirectory,
    operatorDeployInstruction: shaped.operatorDeployInstruction,
    readinessLadder: Object.freeze([...shaped.readinessLadder]),
    requiredFrontmatterKeys: Object.freeze([...shaped.requiredFrontmatterKeys]),
    economicsStatements: Object.freeze([...shaped.economicsStatements]),
    resolved: true,
  });
}

export function validateAuditConfigShape(supplied) {
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) {
    throw new AuditConfigError("config", "must be an object");
  }

  const guidelineRoots = normalizeRootList(supplied.guidelineRoots, "guidelineRoots");
  const runtimeRoots = normalizeRootList(supplied.runtimeRoots, "runtimeRoots");
  const auditOutputDirectory = populatedString(
    supplied.auditOutputDirectory,
    "auditOutputDirectory",
  );
  const readinessLadder = normalizeUniqueList(
    supplied.readinessLadder ?? DEFAULT_READINESS_LADDER,
    "readinessLadder",
  );
  if (
    readinessLadder.length !== DEFAULT_READINESS_LADDER.length ||
    readinessLadder.some((level, index) => level !== DEFAULT_READINESS_LADDER[index])
  ) {
    throw new AuditConfigError(
      "readinessLadder",
      `must equal the canonical ordered ladder: ${DEFAULT_READINESS_LADDER.join(", ")}`,
    );
  }
  const requiredFrontmatterKeys = normalizeUniqueList(
    supplied.requiredFrontmatterKeys,
    "requiredFrontmatterKeys",
  );
  const economicsStatements = normalizeUniqueList(
    supplied.economicsStatements ?? DEFAULT_ECONOMICS_STATEMENTS,
    "economicsStatements",
  );

  let operatorDeployInstruction = null;
  if (
    supplied.operatorDeployInstruction !== undefined &&
    supplied.operatorDeployInstruction !== null
  ) {
    operatorDeployInstruction = normalizeOperatorInstruction(
      supplied.operatorDeployInstruction,
    );
    if (operatorDeployInstruction === null) {
      throw new AuditConfigError(
        "operatorDeployInstruction",
        "must be null or a populated instruction reference",
      );
    }
  }

  return {
    guidelineRoots,
    runtimeRoots,
    auditOutputDirectory,
    operatorDeployInstruction,
    readinessLadder,
    requiredFrontmatterKeys,
    economicsStatements,
  };
}

export function pathsOverlap(left, right) {
  const first = path.resolve(left);
  const second = path.resolve(right);
  return isSameOrDescendant(first, second) || isSameOrDescendant(second, first);
}

export function expandEnvironmentReferences(value, environment = process.env) {
  return String(value).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu, (_match, name) => {
    const replacement = environment[name];
    if (typeof replacement !== "string" || replacement.trim().length === 0) {
      throw new AuditConfigError("environment", `missing required variable ${name}`);
    }
    return replacement;
  });
}

async function resolveRoots(roots, field, baseDirectory, canonicalize, environment) {
  const resolved = [];
  for (const [index, root] of roots.entries()) {
    const candidate = path.resolve(
      baseDirectory,
      expandEnvironmentReferences(root.locator, environment),
    );
    let locator;
    try {
      locator = path.resolve(await canonicalize(candidate));
    } catch (error) {
      throw new AuditConfigError(
        `${field}[${index}].locator`,
        `cannot resolve input root (${errorMessage(error)})`,
      );
    }
    resolved.push(Object.freeze({ ...root, locator }));
  }
  return Object.freeze(resolved);
}

function normalizeRootList(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AuditConfigError(field, "must contain at least one input root");
  }
  return value.map((entry, index) => normalizeRoot(entry, `${field}[${index}]`));
}

function normalizeRoot(value, field) {
  if (typeof value === "string") {
    return Object.freeze({
      roleLabel: `${field}`,
      locator: populatedString(value, `${field}.locator`),
      includeGlobs: Object.freeze(["**/*"]),
      excludeGlobs: Object.freeze([]),
      revisionIdentifier: null,
    });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuditConfigError(field, "must be a locator string or root object");
  }
  const locator = populatedString(value.locator ?? value.path, `${field}.locator`);
  const roleLabel = populatedString(
    value.roleLabel ?? value.role ?? `${field}`,
    `${field}.roleLabel`,
  );
  return Object.freeze({
    roleLabel,
    locator,
    includeGlobs: Object.freeze(normalizeGlobList(value.includeGlobs, ["**/*"])),
    excludeGlobs: Object.freeze(normalizeGlobList(value.excludeGlobs, [])),
    documentDefaults: normalizeDocumentDefaults(
      value.documentDefaults,
      `${field}.documentDefaults`,
    ),
    revisionIdentifier:
      value.revisionIdentifier === undefined || value.revisionIdentifier === null
        ? null
        : populatedString(value.revisionIdentifier, `${field}.revisionIdentifier`),
  });
}

function normalizeDocumentDefaults(value, field) {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuditConfigError(field, "must be a flat scalar object");
  }
  const entries = Object.entries(value).map(([key, scalar]) => {
    if (
      !/^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(key) ||
      !["string", "number", "boolean"].includes(typeof scalar)
    ) {
      throw new AuditConfigError(field, "must contain only named scalar values");
    }
    return [key, String(scalar)];
  });
  return Object.freeze(Object.fromEntries(entries));
}

function normalizeGlobList(value, fallback) {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value)) throw new AuditConfigError("includeGlobs", "must be an array");
  return value.map((entry) => populatedString(entry, "glob"));
}

function normalizeUniqueList(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AuditConfigError(field, "must be a non-empty array");
  }
  const normalized = value.map((entry) => populatedString(entry, field));
  if (new Set(normalized).size !== normalized.length) {
    throw new AuditConfigError(field, "must not contain duplicates");
  }
  return normalized;
}

async function canonicalizeProspectivePath(locator, { canonicalize }) {
  let cursor = path.resolve(locator);
  const suffix = [];
  while (true) {
    try {
      const existing = await canonicalize(cursor);
      return path.join(existing, ...suffix.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      suffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

async function assertProspectiveWritable(locator) {
  let cursor = path.resolve(locator);
  let first = true;
  while (true) {
    try {
      const info = await stat(cursor);
      if (first && !info.isDirectory()) {
        throw new Error("output locator exists and is not a directory");
      }
      if (!info.isDirectory()) throw new Error("output ancestor is not a directory");
      await access(cursor, constants.W_OK);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      cursor = parent;
      first = false;
    }
  }
}

function isSameOrDescendant(candidate, ancestor) {
  const relative = path.relative(ancestor, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function populatedString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AuditConfigError(field, "must be a populated string");
  }
  return value.trim();
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
