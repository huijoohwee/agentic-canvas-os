import { deduplicationKey } from "../alignment-audit/finding.mjs";
import {
  array,
  deepFreeze,
} from "./normalize.mjs";

export function compareFindingSets(currentInput, priorInput) {
  const currentByKey = uniqueByAuthoringKey(currentInput);
  const priorByKey = uniqueByAuthoringKey(priorInput);
  const currentKeys = new Set(currentByKey.keys());
  const priorKeys = new Set(priorByKey.keys());
  const introduced = [...currentByKey]
    .filter(([key]) => !priorKeys.has(key))
    .map(([, finding]) => finding);

  return deepFreeze({
    newCount: introduced.length,
    resolvedCount: [...priorKeys].filter((key) => !currentKeys.has(key)).length,
    unchangedCount: [...currentKeys].filter((key) => priorKeys.has(key)).length,
    newBlockerCount: introduced.filter(
      (finding) => finding?.severity === "blocker",
    ).length,
  });
}

function uniqueByAuthoringKey(findingsInput) {
  const result = new Map();
  for (const finding of array(findingsInput)) {
    const key = deduplicationKey(finding ?? {});
    if (!result.has(key)) result.set(key, finding);
  }
  return result;
}
