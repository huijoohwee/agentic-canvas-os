import {
  DEFAULT_SEVERITY,
  SEVERITY_RANK,
} from "../alignment-audit/finding.mjs";
import {
  LIFECYCLE_FINDING_SEVERITIES,
} from "../lifecycle-conformance-gate.mjs";
import {
  lifecyclePolicyRuleText,
} from "../lifecycle-conformance-policy.mjs";
import {
  compareText,
  deepFreeze,
  stableJson,
  text,
} from "./normalize.mjs";

export const ADMISSION_FINDING_TYPES = Object.freeze([
  "runtime-readiness-unproven",
  "unnamed-evaluator",
  "self-graded-verdict",
  "ungrounded-task",
  "unexecuted-condition",
  "task-cycle",
  "concurrent-write-conflict",
  "parallel-scope-collision",
  "stale-collaboration-fence",
  "oversized-task",
  "self-escalated-capability",
  "out-of-scope-write",
  "ungated-irreversible-operation",
  "unbounded-task",
  "evidence-without-run",
  "unproven-property",
  "deploy-boundary-breach",
  "dependency-closure-drift",
]);

const FINDING_RULES = Object.freeze({
  "runtime-readiness-unproven": "runtime-readiness-enforcement#5",
  "unnamed-evaluator": "agent-roles--independence#7",
  "self-graded-verdict": "agent-roles--independence#6",
  "ungrounded-task": "specification-to-task-bridge#1",
  "unexecuted-condition": "specification-to-task-bridge#2",
  "task-cycle": "task-model#15",
  "concurrent-write-conflict": "task-model#17",
  "parallel-scope-collision": "validation-checklist#6",
  "stale-collaboration-fence": "validation-checklist#6",
  "oversized-task": "task-model#13",
  "self-escalated-capability": "tool-permission--blast-radius#2",
  "out-of-scope-write": "tool-permission--blast-radius#6",
  "ungated-irreversible-operation": "tool-permission--blast-radius#3",
  "unbounded-task": "per-task-budgets#1",
  "evidence-without-run": "verification-strategy#11",
  "unproven-property": "verification-strategy#5",
  "deploy-boundary-breach": "tool-permission--blast-radius#4",
  "dependency-closure-drift": "runtime-readiness-enforcement#2",
});

export function createAdmissionFindingCollector() {
  const findings = [];
  return Object.freeze({
    add(findingType, details = {}) {
      if (!ADMISSION_FINDING_TYPES.includes(findingType)) {
        throw new TypeError(`Unsupported admission finding: ${findingType}`);
      }
      const guidelineAnchor = admissionFindingRuleId(findingType);
      const ruleText = lifecyclePolicyRuleText(guidelineAnchor);
      if (!ruleText) {
        throw new TypeError(
          `Admission finding ${findingType} has no pinned lifecycle rule.`,
        );
      }
      findings.push({
        findingType,
        severity: admissionFindingSeverity(findingType),
        guidelineAnchor,
        artifactReference: text(details.artifactReference) || "admission",
        evidenceExcerpt: boundedText(
          details.evidenceExcerpt || "Admission conformance rule violated.",
        ),
        remediation: {
          class: "local-reproducible-check",
          statement: boundedText(`Satisfy ${guidelineAnchor}: ${ruleText}`),
          state: "proposed",
          operatorInstructionRef: null,
        },
      });
    },
    finalize() {
      const deduplicated = new Map();
      for (const finding of findings) {
        const key = stableJson([
          finding.findingType,
          finding.guidelineAnchor,
          finding.artifactReference,
        ]);
        if (!deduplicated.has(key)) deduplicated.set(key, finding);
      }
      const ordered = [...deduplicated.values()]
        .sort(compareAdmissionFindings);
      const counts = Object.fromEntries(
        ADMISSION_FINDING_TYPES.map((findingType) => [findingType, 0]),
      );
      ordered.forEach((finding) => {
        counts[finding.findingType] += 1;
      });
      return deepFreeze({ findings: ordered, findingCounts: counts });
    },
  });
}

export function admissionFindingSeverity(findingType) {
  return DEFAULT_SEVERITY[findingType]
    ?? LIFECYCLE_FINDING_SEVERITIES[findingType];
}

export function admissionFindingRuleId(findingType) {
  return FINDING_RULES[findingType] ?? "";
}

export function compareAdmissionFindings(left, right) {
  return (
    SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
    || compareText(left.findingType, right.findingType)
    || compareText(left.guidelineAnchor, right.guidelineAnchor)
    || compareText(left.artifactReference, right.artifactReference)
  );
}

function boundedText(value) {
  const normalized = text(value);
  return normalized.length <= 500
    ? normalized
    : `${normalized.slice(0, 499)}…`;
}
