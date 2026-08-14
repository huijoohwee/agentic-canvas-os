import { normalizeDeclaredWriteScopeManifest } from "./scoped-lane-admission-lib.mjs";

export function assertActivePublishPathsAdmitted({ paths, admission } = {}) {
  if (admission?.schema !== "agentic-lane-admission-lease/v1" ||
      admission.status !== "admitted" || !Array.isArray(admission.declaredWriteSet)) {
    throw new Error("Active publish successor requires admitted write-set evidence.");
  }
  const semantic = `semantic:${admission.semanticScope}`;
  if (!admission.declaredWriteSet.includes(semantic)) {
    throw new Error("Active publish successor semantic scope changed from admission.");
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
      `Active publish successor paths changed from the admitted write-set evidence: ${outside.join(", ")}.`,
    );
  }
  return Object.freeze({
    paths: normalized.paths,
    admittedPaths: Object.freeze([...admittedPaths]),
  });
}
