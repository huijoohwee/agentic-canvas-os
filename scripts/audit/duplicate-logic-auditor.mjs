// Responsibility: Compare digest-bound capability assignments and report declared frontend implementations.

import {
  AUDITED_REPOSITORY_NAMES,
  collectTrackedAuthoredFiles,
  digestAuthoredText,
  normalizeAuthoredFiles,
  normalizeRepositoryPath,
  normalizeUnscannedSubjects,
} from "./path-portability-auditor.mjs";

export const DUPLICATE_LOGIC_AUDIT_SCHEMA =
  "agentic-game-os-duplicate-logic-audit/v1";
export const DUPLICATE_LOGIC_DEADLINE_MS = 120_000;
export const SHARED_CAPABILITY_IDS = Object.freeze([
  "animation",
  "camera",
  "city-builder",
  "flight-sim",
  "game-mode",
  "geo",
  "immersive-input",
  "media",
  "motion-control",
]);

const IMPLEMENTATION_DIRECTIVE =
  /^\/\/ Shared-Capability-Implementation: ([a-z0-9]+(?:-[a-z0-9]+)*)$/gmu;
const DELEGATION_DIRECTIVE =
  /^\/\/ Shared-Capability-Delegation: ([a-z0-9]+(?:-[a-z0-9]+)*)$/gmu;
const FRONTEND_ONLY_DIRECTIVE = /^\/\/ Shared-Capability-Frontend-Only$/mu;
const EXECUTABLE_SOURCE_PATTERN = /\.(?:cjs|js|jsx|mjs|swift|ts|tsx)$/u;
const PUBLIC_SURFACE_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._/-]*|[A-Za-z][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)+|[A-Z][A-Za-z0-9._-]{2,})$/u;

export const digestAuditedSource = digestAuthoredText;

export function auditDuplicateLogic({
  modules = [],
  capabilities = SHARED_CAPABILITY_IDS,
  expectedModulePaths,
  authoritativeAssignments,
  sharedSubstrateRoot = "agentic-graph",
  elapsedMs = 0,
  deadlineMs = DUPLICATE_LOGIC_DEADLINE_MS,
} = {}) {
  const capabilityIds = normalizeCapabilities(capabilities);
  const sharedRoot = normalizeRepositoryPath(sharedSubstrateRoot);
  const normalizedModules = normalizeAuthoredFiles(modules, { includeExcluded: true });
  const expectedPaths = normalizeExpectedPaths(expectedModulePaths);
  const assignments = normalizeAssignments(authoritativeAssignments);
  const unscannedModules = collectUnscannedModules({
    modules: normalizedModules,
    expectedPaths,
    assignments,
    capabilityIds,
    sharedRoot,
    elapsedMs,
    deadlineMs,
  });
  const duplicates = new Map(capabilityIds.map((capability) => [capability, []]));
  let scannedModuleCount = 0;

  for (const module of normalizedModules) {
    if (!module.path || module.readError || module.text === null) {
      continue;
    }
    scannedModuleCount += 1;
    if (pathIsWithin(module.path, sharedRoot)) continue;
    const sourceClassification = classifyModule(module);
    const assignment = assignments.byPath.get(module.path);
    const implementationIds = new Set([
      ...sourceClassification.implementationIds,
      ...(assignment?.role === "implementation" ? assignment.capabilities : []),
    ]);
    for (const capability of implementationIds) {
      if (!duplicates.has(capability)) continue;
      duplicates.get(capability).push(module.path);
    }
  }

  const violations = [...duplicates.entries()].flatMap(([capability, paths]) => {
    const modulePaths = [...new Set(paths)].sort(compareText);
    return modulePaths.length === 0 ? [] : [{
      code: "duplicate-logic",
      capability,
      modulePaths,
      moduleCount: modulePaths.length,
    }];
  });
  violations.sort((left, right) => left.capability.localeCompare(right.capability, "en"));
  unscannedModules.sort(comparePaths);
  const sharedCapabilityOwners = capabilityIds.flatMap((capability) => {
    const owners = sharedOwnersForCapability({ assignments, capability, sharedRoot });
    return owners.length === 1 ? [{
      capability,
      modulePath: owners[0].path,
      publicSurface: publicSurfaceFor(owners[0], capability),
      sourceDigest: owners[0].sourceDigest,
    }] : [];
  });
  const status = unscannedModules.length > 0
    ? "incomplete"
    : violations.length > 0 ? "failed" : "passed";
  return {
    schema: DUPLICATE_LOGIC_AUDIT_SCHEMA,
    proofScope: "digest-bound-responsibility-assignments",
    status,
    outcome: status === "passed"
      ? "declared-implementation-free"
      : status === "failed" ? "duplicate-logic" : "audit-incomplete",
    capabilityIds,
    sharedCapabilityOwners,
    violations,
    unscannedModules,
    summary: {
      expectedCapabilityCount: capabilityIds.length,
      scannedModuleCount,
      duplicateModuleCount:
        violations.reduce((count, violation) => count + violation.moduleCount, 0),
      unscannedModuleCount: unscannedModules.length,
      complete: unscannedModules.length === 0,
    },
  };
}

export const auditSharedCapabilityOwnership = auditDuplicateLogic;

export function auditTrackedDuplicateLogic({
  githubRoot,
  capabilities = SHARED_CAPABILITY_IDS,
  authoritativeAssignments,
  elapsedMs,
  deadlineMs = DUPLICATE_LOGIC_DEADLINE_MS,
} = {}) {
  const startedAt = Date.now();
  const inventory = collectTrackedAuthoredFiles({
    githubRoot,
    repositoryNames: AUDITED_REPOSITORY_NAMES,
  });
  const sourcePaths = inventory.repositoryPaths.filter((path) => (
    EXECUTABLE_SOURCE_PATTERN.test(path)
  ));
  const modules = inventory.files.filter((file) => (
    file.readError
    || (file.path
      && (file.path.startsWith("agentic-graph/") || file.path.startsWith("GameXR/"))
      && EXECUTABLE_SOURCE_PATTERN.test(file.path))
  ));
  const audit = auditDuplicateLogic({
    modules,
    capabilities,
    expectedModulePaths: sourcePaths.filter((path) => path.startsWith("GameXR/")),
    authoritativeAssignments,
    sharedSubstrateRoot: "agentic-graph",
    elapsedMs: elapsedMs ?? Date.now() - startedAt,
    deadlineMs,
  });
  return { ...audit, scope: inventory.scope };
}

function normalizeCapabilities(values) {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source.map((value) => (
    typeof value === "string" ? value : value?.id
  )).filter((value) => typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)))]
    .sort(compareText);
}

function collectUnscannedModules({
  modules, expectedPaths, assignments, capabilityIds, sharedRoot, elapsedMs, deadlineMs,
}) {
  const unscanned = modules.flatMap((module) => (
    !module.path || module.readError || module.text === null
      ? [{
        path: module.path ?? "<invalid-repository-path>",
        reason: module.readError ?? "text is unavailable",
      }]
      : []
  ));
  if (expectedPaths.length === 0) unscanned.push({
    path: "<audit-scope>",
    reason: "authoritative frontend source inventory is required and cannot be empty",
  });
  if (capabilityIds.length === 0) unscanned.push({
    path: "<shared-capability-surface>",
    reason: "shared capability surface is empty",
  });
  if (!sharedRoot) unscanned.push({
    path: "<shared-substrate-root>",
    reason: "shared substrate root is not repository-relative",
  });
  unscanned.push(...assignments.invalid);
  const observed = new Set(modules.map(({ path }) => path).filter(Boolean));
  for (const capability of capabilityIds) {
    const owners = sharedOwnersForCapability({ assignments, capability, sharedRoot });
    if (owners.length !== 1) unscanned.push({
      path: `<shared-capability:${capability}>`,
      reason: `exactly one digest-bound agentic-graph owner/public-surface assignment is required; observed ${owners.length}`,
    });
    for (const owner of owners) {
      if (!observed.has(owner.path)) unscanned.push({
        path: owner.path,
        reason: `agentic-graph owner for ${capability} was not supplied from tracked source`,
      });
      if (!isPublicSurface(publicSurfaceFor(owner, capability))) {
        unscanned.push({
          path: owner.path,
          reason: `agentic-graph owner for ${capability} lacks one exact public capability surface`,
        });
      }
    }
  }
  for (const path of expectedPaths) {
    if (!observed.has(path)) {
      unscanned.push({ path, reason: "expected module was not supplied" });
    }
    if (!assignments.byPath.has(path)) unscanned.push({
      path,
      reason: "authoritative module responsibility assignment is absent",
    });
  }
  const expected = new Set(expectedPaths);
  for (const assignment of assignments.byPath.values()) {
    const unknownCapabilities = assignment.capabilities
      .filter((capability) => !capabilityIds.includes(capability));
    if (unknownCapabilities.length > 0) unscanned.push({
      path: assignment.path,
      reason: `responsibility assignment names unknown capabilities: ${unknownCapabilities.join(", ")}`,
    });
    const sharedOwner = pathIsWithin(assignment.path, sharedRoot)
      && assignment.role === "implementation";
    if (!expected.has(assignment.path) && !sharedOwner) unscanned.push({
      path: assignment.path,
      reason: "responsibility assignment is outside the authoritative frontend inventory",
    });
    if (assignment.role === "delegation") {
      for (const capability of assignment.capabilities) {
        if (!isPublicSurface(publicSurfaceFor(assignment, capability))) unscanned.push({
          path: assignment.path,
          reason: `delegation assignment lacks an exact public surface for ${capability}`,
        });
      }
    }
  }
  for (const module of modules) {
    if (!module.path || module.readError || module.text === null) continue;
    const shared = pathIsWithin(module.path, sharedRoot);
    const assignment = assignments.byPath.get(module.path);
    if (!shared && !expected.has(module.path)) {
      unscanned.push({
        path: module.path,
        reason: "module is absent from the authoritative frontend inventory",
      });
      continue;
    }
    const classification = classifyModule(module);
    if (shared && !assignment) {
      if (classification.implementationIds.size > 0) unscanned.push({
        path: module.path,
        reason: "declared agentic-graph capability owner lacks digest-bound authority",
      });
      continue;
    }
    if (assignment && assignment.sourceDigest !== digestAuditedSource(module.text)) {
      unscanned.push({
        path: module.path,
        reason: "responsibility assignment source digest does not match tracked bytes",
      });
    }
    const unknownCapabilities = [...new Set([
      ...classification.implementationIds,
      ...classification.delegationIds,
    ])].filter((capability) => !capabilityIds.includes(capability));
    if (unknownCapabilities.length > 0) unscanned.push({
      path: module.path,
      reason: `classification names unknown capabilities: ${unknownCapabilities.sort(compareText).join(", ")}`,
    });
    const declaredCount = classification.implementationIds.size
      + classification.delegationIds.size;
    if (declaredCount > 0 && classification.frontendOnly) unscanned.push({
      path: module.path,
      reason: "frontend-only and shared-capability classifications conflict",
    });
    if (assignment && !classificationAgrees(classification, assignment)) unscanned.push({
      path: module.path,
      reason: "source classification conflicts with authoritative responsibility assignment",
    });
    if (shared && assignment && (
      assignment.role !== "implementation"
      || classification.implementationIds.size !== assignment.capabilities.length
      || assignment.capabilities.some((capability) => (
        !classification.implementationIds.has(capability)
      ))
    )) unscanned.push({
      path: module.path,
      reason: "agentic-graph owner assignment does not exactly match implementation directives",
    });
    if (!shared && assignment?.role === "delegation") {
      for (const capability of assignment.capabilities) {
        const owners = sharedOwnersForCapability({ assignments, capability, sharedRoot });
        const publicSurface = publicSurfaceFor(assignment, capability);
        if (owners.length !== 1
          || publicSurface !== publicSurfaceFor(owners[0], capability)) {
          unscanned.push({
            path: module.path,
            reason: `delegation for ${capability} does not bind the authoritative agentic-graph public surface`,
          });
        }
      }
    }
  }
  const normalizedDeadline = Number.isFinite(deadlineMs) && deadlineMs >= 0
    ? deadlineMs
    : DUPLICATE_LOGIC_DEADLINE_MS;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > normalizedDeadline) {
    if (modules.length === 0) unscanned.push({
      path: "<audit-deadline>",
      reason: "audit elapsed time is invalid or exceeds its deadline",
    });
    for (const module of modules) {
      if (module.path && !unscanned.some(({ path }) => path === module.path)) {
        unscanned.push({ path: module.path, reason: "120-second audit deadline exceeded" });
      }
    }
  }
  return normalizeUnscannedSubjects(unscanned);
}

function declaredCapabilityIds(metadata, text, directive) {
  const values = Array.isArray(metadata) ? [...metadata] : [];
  directive.lastIndex = 0;
  for (const match of text.matchAll(directive)) values.push(match[1]);
  return new Set(values.filter((value) => typeof value === "string" && value.length > 0));
}

function classifyModule(module) {
  return {
    implementationIds: declaredCapabilityIds(
      module.implementsCapabilities,
      module.text,
      IMPLEMENTATION_DIRECTIVE,
    ),
    delegationIds: declaredCapabilityIds(
      module.delegatesCapabilities,
      module.text,
      DELEGATION_DIRECTIVE,
    ),
    frontendOnly: module.frontendOnly === true || FRONTEND_ONLY_DIRECTIVE.test(module.text),
  };
}

function normalizeExpectedPaths(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(normalizeRepositoryPath).filter(Boolean))]
    .sort(compareText);
}

function normalizeAssignments(values) {
  const source = Array.isArray(values)
    ? values
    : values && typeof values === "object"
      ? Object.entries(values).map(([path, value]) => ({ ...value, path }))
      : [];
  const byPath = new Map();
  const invalid = [];
  for (const [index, value] of source.entries()) {
    const path = normalizeRepositoryPath(value?.path);
    const role = value?.role;
    const capabilities = Array.isArray(value?.capabilities)
      ? [...new Set(value.capabilities.filter((entry) => typeof entry === "string"))]
        .sort(compareText)
      : [];
    const sourceDigest = typeof value?.sourceDigest === "string"
      ? value.sourceDigest.toLowerCase()
      : "";
    const surfaceObject = value?.publicSurfaces
      && typeof value.publicSurfaces === "object" && !Array.isArray(value.publicSurfaces)
      ? value.publicSurfaces
      : null;
    const surfaceEntries = surfaceObject ? Object.entries(surfaceObject) : [];
    const publicSurfaces = Object.fromEntries(surfaceEntries);
    const singularSurface = typeof value?.publicSurface === "string"
      ? value.publicSurface
      : null;
    const surfaceShapeValid = (
      value?.publicSurfaces === undefined
      || (surfaceObject && surfaceEntries.length === Object.keys(surfaceObject).length
        && surfaceEntries.every(([capability, identifier]) => (
          capabilities.includes(capability) && isPublicSurface(identifier)
        )))
    ) && (
      singularSurface === null
      || (capabilities.length === 1 && surfaceEntries.length === 0
        && isPublicSurface(singularSurface))
    );
    if (singularSurface !== null) publicSurfaces[capabilities[0]] = singularSurface;
    const roleValid = ["delegation", "frontend-only", "implementation"].includes(role);
    const shapeValid = Boolean(
      path
      && roleValid
      && /^[a-f0-9]{64}$/u.test(sourceDigest)
      && (role === "frontend-only" ? capabilities.length === 0 : capabilities.length > 0)
      && surfaceShapeValid
      && (role !== "frontend-only" || Object.keys(publicSurfaces).length === 0)
      && !byPath.has(path),
    );
    if (!shapeValid) {
      invalid.push({
        path: path ?? `<responsibility-assignment-${index + 1}>`,
        reason: "responsibility assignment is malformed or duplicated",
      });
      continue;
    }
    byPath.set(path, { path, role, capabilities, sourceDigest, publicSurfaces });
  }
  return { byPath, invalid };
}

function sharedOwnersForCapability({ assignments, capability, sharedRoot }) {
  return [...assignments.byPath.values()].filter((assignment) => (
    pathIsWithin(assignment.path, sharedRoot)
    && assignment.role === "implementation"
    && assignment.capabilities.includes(capability)
  ));
}

function isPublicSurface(value) {
  return typeof value === "string" && PUBLIC_SURFACE_PATTERN.test(value);
}

function publicSurfaceFor(assignment, capability) {
  return assignment.publicSurfaces?.[capability] ?? null;
}

function classificationAgrees(classification, assignment) {
  if (
    classification.frontendOnly
    && assignment.role !== "frontend-only"
  ) return false;
  if (classification.implementationIds.size > 0) return Boolean(
    assignment.role === "implementation"
    && [...classification.implementationIds]
      .every((capability) => assignment.capabilities.includes(capability)),
  );
  if (classification.delegationIds.size > 0 && assignment.role !== "delegation") return false;
  const declared = new Set([
    ...classification.implementationIds,
    ...classification.delegationIds,
  ]);
  return [...declared].every((capability) => assignment.capabilities.includes(capability));
}

function pathIsWithin(path, root) {
  return Boolean(root && (path === root || path.startsWith(`${root}/`)));
}

function comparePaths(left, right) {
  return left.path.localeCompare(right.path, "en")
    || left.reason.localeCompare(right.reason, "en");
}

function compareText(left, right) {
  return left.localeCompare(right, "en");
}
