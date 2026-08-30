import { normalizeDeclaredWriteScopeManifest } from "./scoped-lane-admission-lib.mjs";

export function assertActivePublishPathsAdmitted({ paths, admission } = {}) {
  return assertPathsAdmitted({
    paths,
    admission,
    subject: "Active publish successor",
  });
}

export function assertPathsAdmitted({
  paths,
  admission,
  subject = "Changed-path operation",
} = {}) {
  if (admission?.schema !== "agentic-lane-admission-lease/v1" ||
      admission.status !== "admitted" || !Array.isArray(admission.declaredWriteSet)) {
    throw new Error(`${subject} requires admitted write-set evidence.`);
  }
  const semantic = `semantic:${admission.semanticScope}`;
  if (!admission.declaredWriteSet.includes(semantic)) {
    throw new Error(`${subject} semantic scope changed from admission.`);
  }
  const normalized = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: admission.semanticScope,
    paths,
  }, { expectedScope: admission.semanticScope });
  const admittedPaths = admission.declaredWriteSet
    .filter(item => item.startsWith("path:"))
    .map(item => item.slice("path:".length));
  const outside = normalized.paths.filter(changed => !admittedPaths.some(
    admitted => changed === admitted || changed.startsWith(`${admitted}/`),
  ));
  if (outside.length > 0) {
    throw new Error(
      `${subject} paths changed from the admitted write-set evidence: ${outside.join(", ")}.`,
    );
  }
  return Object.freeze({
    paths: normalized.paths,
    admittedPaths: Object.freeze([...admittedPaths]),
  });
}
