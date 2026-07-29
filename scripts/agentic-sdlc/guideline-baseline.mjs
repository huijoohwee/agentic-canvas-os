import { readFileSync } from "node:fs";

import {
  deepFreeze,
  sameStableValue,
} from "./normalize.mjs";

const manifest = JSON.parse(readFileSync(
  new URL(
    "../../docs/schemas/agentic-sdlc-guideline-baseline.v1.json",
    import.meta.url,
  ),
  "utf8",
));

if (
  manifest?.schema !== "agentic-sdlc-guideline-baseline/v1"
  || !manifest.repository?.revision
  || !Array.isArray(manifest.documents)
  || !manifest.executionFindingRuleBindings
  || !manifest.executionRuleCatalog
  || !manifest.guidelineLoadProfiles
) {
  throw new TypeError("invalid pinned Agentic SDLC guideline baseline");
}

const documentsByRole = new Map(
  manifest.documents.map((document) => [document.role, document]),
);

export const PINNED_GUIDELINE_BASELINE = deepFreeze(Object.fromEntries(
  ["authoring", "execution"].map((role) => {
    const document = documentsByRole.get(role);
    if (!document?.version || !document?.sha256) {
      throw new TypeError(`missing pinned ${role} guideline document`);
    }
    return [role, {
      version: document.version,
      revision: manifest.repository.revision,
      digest: document.sha256,
    }];
  }),
));

export const PINNED_EXECUTION_RULE_BINDINGS = deepFreeze(
  structuredClone(manifest.executionFindingRuleBindings),
);

export const PINNED_EXECUTION_RULE_CATALOG = deepFreeze(
  structuredClone(manifest.executionRuleCatalog),
);

export const PINNED_GUIDELINE_LOAD_PROFILES = deepFreeze(
  structuredClone(manifest.guidelineLoadProfiles),
);

export const PINNED_GUIDELINE_SECTION_ANCHORS = deepFreeze({
  authoring: [...new Set([
    ...manifest.requiredSectionAnchors.authoring,
    ...Object.values(manifest.guidelineLoadProfiles.authoring).flat(),
  ])].sort(),
  execution: [...new Set([
    ...manifest.requiredSectionAnchors.execution,
    ...Object.values(manifest.guidelineLoadProfiles.execution).flat(),
    ...Object.keys(manifest.executionRuleCatalog).map(
      (ruleId) => ruleId.split("#", 1)[0],
    ),
  ])].sort(),
});

export function matchesPinnedGuidelineBaseline(candidate) {
  return sameStableValue(candidate, PINNED_GUIDELINE_BASELINE);
}

export function matchesPinnedRuleBindings(candidate) {
  return sameStableValue(candidate, PINNED_EXECUTION_RULE_BINDINGS);
}
