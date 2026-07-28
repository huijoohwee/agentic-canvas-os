import {
  FINDING_TYPES,
  makeFinding,
} from "../alignment-audit/finding.mjs";
import { finalizeFindings } from "../alignment-audit/finding-pipeline.mjs";
import {
  EXECUTION_FINDING_TYPES,
} from "./constants.mjs";
import { isFindingRulePair } from "./finding-rules.mjs";
import {
  matchesPinnedRuleBindings,
  PINNED_EXECUTION_RULE_CATALOG,
} from "./guideline-baseline.mjs";
import {
  deepFreeze,
  object,
  text,
} from "./normalize.mjs";

const RULE_ID_PATTERN = /^[a-z0-9-]+#[1-9]\d*$/u;

export function assertRuleBindings(ruleBindingsInput) {
  const bindings = object(ruleBindingsInput);
  const invalid = EXECUTION_FINDING_TYPES.filter((findingType) =>
    !RULE_ID_PATTERN.test(bindingRuleId(bindings[findingType])));
  const extra = Object.keys(bindings).filter(
    (findingType) => !EXECUTION_FINDING_TYPES.includes(findingType),
  );
  if (invalid.length > 0 || extra.length > 0 || !matchesPinnedRuleBindings(bindings)) {
    throw new TypeError(
      `${invalid.length > 0
        ? `ruleBindings must supply a canonical Rule ID for: ${invalid.join(",")}; `
        : ""}`
      + "ruleBindings must exactly match the pinned execution finding bindings"
      + `${invalid.length > 0 ? `; invalid=${invalid.join(",")}` : ""}`
      + `${extra.length > 0 ? `; extra=${extra.join(",")}` : ""}`,
    );
  }
  return bindings;
}

export function createFindingCollector(ruleBindingsInput) {
  const ruleBindings = assertRuleBindings(ruleBindingsInput);
  const findings = [];

  function add(findingType, details = {}) {
    if (!FINDING_TYPES.includes(findingType)) {
      throw new TypeError(`unknown conformance finding type: ${String(findingType)}`);
    }
    const ruleId = text(details.ruleId);
    const ruleText = text(PINNED_EXECUTION_RULE_CATALOG[ruleId]);
    if (
      !RULE_ID_PATTERN.test(ruleId)
      || !ruleText
      || !isFindingRulePair(findingType, ruleId)
    ) {
      throw new TypeError(
        `finding ${findingType} requires one type-bound pinned execution Rule ID`,
      );
    }
    const taskId = text(details.taskId);
    const suppliedReference = text(details.artifactReference);
    const artifactReference = taskId
      ? `task:${taskId}:${suppliedReference || "execution"}`
      : suppliedReference || "execution-run";
    const violation = text(details.evidenceExcerpt) || "Conformance rule violated.";
    findings.push(makeFinding({
      findingType,
      guidelineAnchor: ruleId,
      artifactReference,
      evidenceExcerpt: boundedEvidence(violation, ruleText),
      remediation: {
        class: "local-reproducible-check",
        statement: ruleText
          ? `Satisfy ${ruleId}: ${ruleText}`
          : `Satisfy execution rule ${ruleId}.`,
        state: "proposed",
        operatorInstructionRef: null,
      },
    }));
  }

  function finalize() {
    const ordered = finalizeFindings(findings);
    const counts = Object.fromEntries(
      FINDING_TYPES.map((findingType) => [findingType, 0]),
    );
    const severityCounts = { blocker: 0, major: 0, minor: 0 };
    for (const finding of ordered) {
      counts[finding.findingType] += 1;
      severityCounts[finding.severity] += 1;
    }
    return deepFreeze({
      findings: ordered,
      findingCounts: counts,
      severityCounts,
    });
  }

  return Object.freeze({ add, finalize });
}

function bindingRuleId(binding) {
  return typeof binding === "object" && binding !== null
    ? text(binding.ruleId ?? binding.id)
    : text(binding);
}

function boundedEvidence(violation, ruleText) {
  const combined = ruleText
    ? `${violation} Violated rule: ${ruleText}`
    : violation;
  return combined.length <= 500 ? combined : `${combined.slice(0, 499)}…`;
}

export { RULE_ID_PATTERN };
